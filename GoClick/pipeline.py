from typing import Any, Dict, List, Optional, Union
from PIL import Image

from evidence_signals import DOMElement, OCRSpan, auto_discover_targets


class PrivacyVisionPipeline:
    """
    Public entry point for the Privacy-Preserving Vision Agent.
    Evaluates an input UI screenshot against candidate target expressions,
    gating and verifying element presence via EvidenceFusionEngine.

    Only ACCEPTed regions enter the final PII mask/redaction map.
    """

    def __init__(self, fusion_engine: Any):
        self.fusion = fusion_engine

    def run(
        self,
        image: Image.Image,
        targets: Optional[List[Dict[str, Any]]] = None,
        ocr_spans: Optional[List[Union[OCRSpan, Dict[str, Any]]]] = None,
        dom_elements: Optional[List[Union[DOMElement, Dict[str, Any]]]] = None,
    ) -> Dict[str, Any]:
        ocr_spans = ocr_spans or []
        dom_elements = dom_elements or []

        # Auto-discover targets from OCR and DOM if none explicitly provided
        if targets is None:
            targets = auto_discover_targets(ocr_spans, dom_elements)

        results = [
            self.fusion.evaluate(
                image,
                t["type"],
                t["referring_expression"],
                t.get("mode", "description"),
                ocr_spans,
                dom_elements,
            )
            for t in targets
        ]

        accepted_regions = [
            {
                "id": f"v{i}",
                "type": r["type"],
                "bbox": r["bbox"],
                "confidence": r["goclick_candidate"]["confidence"] if r.get("goclick_candidate") else None,
            }
            for i, r in enumerate(results)
            if r.get("verdict") == "ACCEPT" and r.get("bbox") is not None
        ]

        uncertain_regions = [
            {
                "id": f"u{i}",
                "type": r["type"],
                "bbox": r["bbox"],
                "reason": r["reason"],
            }
            for i, r in enumerate(results)
            if r.get("verdict") == "UNCERTAIN"
        ]

        return {
            "regions": accepted_regions,
            "uncertain_regions": uncertain_regions,
            "all_results": results,
        }