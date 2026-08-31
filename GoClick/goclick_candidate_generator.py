import os
import re
from typing import Any, Dict, Optional, Tuple
from PIL import Image
import torch
import torch.nn.functional as F
from transformers import AutoModelForCausalLM, AutoProcessor


def resolve_device(preferred_device: Optional[str] = None) -> str:
    """
    Selects the most suitable compute device (cuda -> mps -> cpu)
    or respects explicit parameter / environment variable.
    """
    if preferred_device:
        return preferred_device

    env_device = os.getenv("GOCLICK_DEVICE")
    if env_device:
        return env_device

    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class GoClickCandidateGenerator:
    """
    Candidate location GENERATOR ONLY.

    GoClick is a grounding model, not a detector — it cannot say "this
    element isn't here." It will always try to point at *something* if
    asked (confirmed by the bank-form hallucination test). This class must
    never be used to decide existence; that belongs to the judge/fusion layer.
    """

    def __init__(self, model_name: str = "HongxinLi/GoClick-Base", device: Optional[str] = None):
        self.device = resolve_device(device)
        self.model_name = model_name
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            trust_remote_code=True,
            torch_dtype=torch.float32,
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
        raise ValueError(f"Invalid mode '{mode}'. Must be 'description', 'functionality', or 'intent'")

    def generate_candidate(
        self,
        image: Image.Image,
        referring_expression: str,
        mode: str = "description",
        max_new_tokens: int = 64,
    ) -> Dict[str, Any]:
        if image.mode != "RGB":
            image = image.convert("RGB")

        prompt = self._build_prompt(referring_expression, mode)
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

        raw_text = self.processor.tokenizer.batch_decode(output.sequences, skip_special_tokens=False)[0]
        match = re.findall(r"<loc_(\d+)>,<loc_(\d+)>", raw_text)

        if not match:
            return {
                "found_coordinates": False,
                "point": None,
                "confidence": 0.0,
                "raw_text": raw_text,
            }

        x_norm, y_norm = [int(v) for v in match[0]]
        w, h = image.size
        point = (int(x_norm / 1000 * w), int(y_norm / 1000 * h))
        confidence = self._score_to_confidence(output.scores)

        return {
            "found_coordinates": True,
            "point": point,
            "confidence": confidence,
            "raw_text": raw_text,
        }

    @staticmethod
    def _score_to_confidence(scores) -> float:
        """Proxy only — proven NOT to reliably separate hits from hallucinations
        (0.78 confidence on a nonexistent password field). Logged, never trusted alone."""
        if not scores:
            return 0.0
        probs = [F.softmax(step[0], dim=-1).max().item() for step in scores]
        return round(sum(probs) / len(probs), 4)