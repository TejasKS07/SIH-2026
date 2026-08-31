from typing import Any, Dict, Optional, Sequence
from PIL import Image


class RegionVerifier:
    """
    Optional second-pass check: crop around a GoClick candidate and re-query
    GoClick scoped to just that crop. If it can't confidently re-find the
    element inside its own proposed region, that's a signal (not proof) of
    a possible hallucination.

    WEAK by design — it reuses GoClick against itself. Swap `self.generator`
    calls for the team's 3B semantic model when ready (Section 4.E of the
    architecture doc is the intended production path).
    """

    def __init__(self, generator: Any, crop_padding: int = 80, min_sub_confidence: float = 0.5):
        self.generator = generator
        self.crop_padding = crop_padding
        self.min_sub_confidence = min_sub_confidence

    def verify(
        self,
        image: Image.Image,
        candidate: Dict[str, Any],
        referring_expression: str,
        mode: str = "description",
    ) -> Dict[str, Any]:
        if not candidate or not candidate.get("found_coordinates") or candidate.get("point") is None:
            return {"verified": None, "reason": "no candidate to verify"}

        crop = self._crop_around(image, candidate["point"])
        if crop.size[0] == 0 or crop.size[1] == 0:
            return {"verified": False, "sub_confidence": 0.0, "sub_found": False}

        sub = self.generator.generate_candidate(crop, referring_expression, mode)

        verified = bool(sub.get("found_coordinates")) and (
            sub.get("confidence", 0.0) >= self.min_sub_confidence
        )
        return {
            "verified": verified,
            "sub_confidence": sub.get("confidence", 0.0),
            "sub_found": sub.get("found_coordinates", False),
        }

    def _crop_around(self, image: Image.Image, point: Sequence[int]) -> Image.Image:
        x, y = int(point[0]), int(point[1])
        w, h = image.size
        p = self.crop_padding
        box = (max(0, x - p), max(0, y - p), min(w, x + p), min(h, y + p))
        return image.crop(box)