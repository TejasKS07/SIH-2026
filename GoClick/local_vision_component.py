import json
import os
import re
from typing import Any, Dict, List, Optional
from PIL import Image
import torch
import torch.nn.functional as F
from transformers import AutoModelForCausalLM, AutoProcessor

from bbox_sizing import get_bbox
from goclick_candidate_generator import resolve_device


class GoClickVisionComponent:
    """
    Local Vision component for the Privacy Gateway.
    Wraps GoClick to produce candidate regions matching the fixed contract:

        {"regions": [{"id": "v0", "type": "password_input", "bbox": [x1, y1, x2, y2], "confidence": 0.97}]}

    Scope: UI-region grounding only (inputs, buttons, embedded document/
    signature regions). Note: Faces and biometric identifiers must be handled
    by dedicated vision detectors, and API tokens by regex.
    """

    DEFAULT_BOX_HALF_SIZE = 25  # px fallback radius if element type not in bbox config

    def __init__(self, model_name: str = "HongxinLi/GoClick-Base", device: Optional[str] = None):
        self.device = resolve_device(device)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name, trust_remote_code=True, torch_dtype=torch.float32
        ).to(self.device)
        self.model.eval()
        self.processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)

    def _build_prompt(self, referring_expression: str, mode: str) -> str:
        if mode == "description":
            return f"Where is the {referring_expression} element? (Output the center coordinates of the target)"
        elif mode == "functionality":
            return (
                f"Locate the element according to its detailed functionality description. "
                f"{referring_expression} (Output the center coordinates of the target)"
            )
        elif mode == "intent":
            return (
                f"I want to {referring_expression}. Please locate the target element I "
                f"should interact with. (Output the center coordinates of the target)"
            )
        raise ValueError("mode must be 'description', 'functionality', or 'intent'")

    def _locate_with_confidence(self, image: Image.Image, prompt: str, max_new_tokens: int = 64):
        if image.mode != "RGB":
            image = image.convert("RGB")

        inputs = self.processor(
            images=image, text=prompt, return_tensors="pt", do_resize=True
        ).to(self.device, dtype=torch.float32)

        with torch.no_grad():
            output = self.model.generate(
                **inputs,
                do_sample=False,
                max_new_tokens=max_new_tokens,
                use_cache=True,
                output_scores=True,
                return_dict_in_generate=True,
            )

        raw_text = self.processor.tokenizer.batch_decode(
            output.sequences, skip_special_tokens=False
        )[0]

        match = re.findall(r"<loc_(\d+)>,<loc_(\d+)>", raw_text)
        if not match:
            return None, None, 0.0  # GoClick found nothing matching the query

        x_norm, y_norm = [int(v) for v in match[0]]
        w, h = image.size
        x_px, y_px = int(x_norm / 1000 * w), int(y_norm / 1000 * h)

        confidence = self._score_to_confidence(output.scores)
        return x_px, y_px, confidence

    @staticmethod
    def _score_to_confidence(scores) -> float:
        """Proxy confidence: mean top-token probability across generated steps.
        GoClick doesn't natively output a confidence score, so this approximates
        one from generation certainty. Treat as relative, not calibrated."""
        if not scores:
            return 0.0
        probs = [F.softmax(step[0], dim=-1).max().item() for step in scores]
        return round(sum(probs) / len(probs), 4)

    def _point_to_bbox(self, x: int, y: int, image_size: tuple, element_type: str, half_size: Optional[int] = None) -> List[int]:
        if half_size is not None:
            w, h = image_size
            return [
                max(0, x - half_size),
                max(0, y - half_size),
                min(w, x + half_size),
                min(h, y + half_size),
            ]
        return get_bbox(x, y, image_size, element_type)

    def detect_regions(self, image: Image.Image, queries: List[Dict[str, Any]], id_prefix: str = "v") -> Dict[str, Any]:
        """
        queries: [{"type": "password_input", "referring_expression": "password input field",
                   "mode": "description", "box_half_size": 30 (optional)}, ...]

        Returns the exact contract shape Evidence Fusion expects.
        """
        regions = []
        for i, q in enumerate(queries):
            prompt = self._build_prompt(q["referring_expression"], q.get("mode", "description"))
            x, y, confidence = self._locate_with_confidence(image, prompt)

            if x is None:
                continue  # don't fabricate a region if GoClick found nothing

            bbox = self._point_to_bbox(x, y, image.size, q["type"], q.get("box_half_size"))
            regions.append({
                "id": f"{id_prefix}{i}",
                "type": q["type"],
                "bbox": bbox,
                "confidence": confidence,
            })

        return {"regions": regions}


# Default query set for UI elements when DOM is insufficient
DEFAULT_UI_QUERIES = [
    {"type": "password_input", "referring_expression": "password input field", "mode": "description"},
    {"type": "text_input_email", "referring_expression": "email input field", "mode": "description"},
    {"type": "document_image", "referring_expression": "an embedded document or ID card image", "mode": "description"},
    {"type": "signature_area", "referring_expression": "a signature box or drawn signature", "mode": "description"},
]


if __name__ == "__main__":
    screenshot_path = os.path.join(os.path.dirname(__file__), "ui_screenshot.png")
    if os.path.exists(screenshot_path):
        vision = GoClickVisionComponent()
        image = Image.open(screenshot_path).convert("RGB")
        result = vision.detect_regions(image, DEFAULT_UI_QUERIES)
        print(json.dumps(result, indent=2))
    else:
        print(f"Screenshot file not found at {screenshot_path}")