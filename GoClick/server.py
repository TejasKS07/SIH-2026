import base64
from io import BytesIO
import os
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image

from evidence_fusion import EvidenceFusionEngine
from evidence_signals import DOMElement, OCRSpan, auto_discover_targets
from pipeline import PrivacyVisionPipeline
from semantic_judge import SemanticJudge
from verifier import RegionVerifier

app = FastAPI(
    title="GoClick Privacy Gateway API",
    description="Privacy-Preserving Vision Agent element grounding and PII masking backend.",
    version="1.0.0",
)

# Enable CORS for browser extension and localhost clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import sys
from eval_harness import MockGoClickGenerator

USE_MOCK = "--mock" in sys.argv or os.getenv("MOCK_GOCLICK", "").lower() in ("1", "true", "yes")

# Global pipeline instance (lazy initialized)
_pipeline: Optional[PrivacyVisionPipeline] = None
_generator: Optional[Any] = None


def get_pipeline() -> PrivacyVisionPipeline:
    global _pipeline, _generator
    if _pipeline is None:
        if USE_MOCK:
            print("🚀 Running in Mock Generator mode (lightweight, instant responses)...")
            _generator = MockGoClickGenerator()
        else:
            print("⏳ Loading GoClick model...")
            from goclick_candidate_generator import GoClickCandidateGenerator
            _generator = GoClickCandidateGenerator()

        judge = SemanticJudge()
        verifier = RegionVerifier(_generator)
        fusion = EvidenceFusionEngine(_generator, judge, verifier=verifier, use_verification=False)
        _pipeline = PrivacyVisionPipeline(fusion)
    return _pipeline


class OCRSpanInput(BaseModel):
    text: str
    bbox: List[int]


class DOMElementInput(BaseModel):
    element_type: str
    input_type: Optional[str] = None
    label: Optional[str] = None
    bbox: Optional[List[int]] = None


class TargetInput(BaseModel):
    type: str
    referring_expression: str
    mode: str = "description"


class DetectPIIRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded screenshot (PNG/JPEG) or data URL")
    targets: Optional[List[TargetInput]] = Field(None, description="Explicit target queries (auto-discovered if omitted)")
    ocr_spans: Optional[List[OCRSpanInput]] = Field(default_factory=list, description="OCR text spans with bboxes")
    dom_elements: Optional[List[DOMElementInput]] = Field(default_factory=list, description="DOM input elements")


class LocateRequest(BaseModel):
    image_base64: str
    goal_info: str
    mode: str = "description"


def decode_image_base64(data_str: str) -> Image.Image:
    if "," in data_str:
        data_str = data_str.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(data_str)
        return Image.open(BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {e}")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "GoClick Privacy Gateway API"}


@app.post("/api/detect_pii")
def detect_pii(req: DetectPIIRequest):
    image = decode_image_base64(req.image_base64)
    pipeline = get_pipeline()

    ocr_spans = [OCRSpan(text=s.text, bbox=s.bbox) for s in (req.ocr_spans or [])]
    dom_elements = [
        DOMElement(
            element_type=el.element_type,
            input_type=el.input_type,
            label=el.label,
            bbox=el.bbox,
        )
        for el in (req.dom_elements or [])
    ]

    targets = None
    if req.targets is not None:
        targets = [t.model_dump() for t in req.targets]

    result = pipeline.run(image, targets=targets, ocr_spans=ocr_spans, dom_elements=dom_elements)
    return result


@app.post("/api/locate")
def locate(req: LocateRequest):
    image = decode_image_base64(req.image_base64)
    get_pipeline()  # Ensures generator is initialized
    candidate = _generator.generate_candidate(image, req.goal_info, mode=req.mode)
    return candidate


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
