from typing import Dict, List, Sequence, Tuple

BBOX_SIZE_CONFIG: Dict[str, Dict[str, int]] = {
    "password_input":     {"half_width": 90,  "half_height": 25},
    "text_input_email":   {"half_width": 90,  "half_height": 25},
    "text_input":         {"half_width": 90,  "half_height": 25},
    "signature_area":     {"half_width": 200, "half_height": 65},
    "document_image":     {"half_width": 90,  "half_height": 75},
    "credit_card_number": {"half_width": 120, "half_height": 20},
    "cvv":                {"half_width": 25,  "half_height": 15},  # deliberately tight — small field
    "otp":                {"half_width": 60,  "half_height": 20},
    "upi_id":             {"half_width": 100, "half_height": 20},
    "health_diagnosis":   {"half_width": 150, "half_height": 30},
    "api_key":            {"half_width": 120, "half_height": 20},
    "auth_token":         {"half_width": 120, "half_height": 20},
    "face":               {"half_width": 60,  "half_height": 80},
    "biometric":          {"half_width": 60,  "half_height": 60},
    "default":            {"half_width": 40,  "half_height": 40},
}


def get_bbox(
    x: int,
    y: int,
    image_size: Sequence[int],
    element_type: str = "default",
) -> List[int]:
    """
    Synthesizes a bounding box [x1, y1, x2, y2] centered at point (x, y),
    dimensioned according to the specific element category, and clamped within
    the image boundary.
    """
    cfg = BBOX_SIZE_CONFIG.get(element_type, BBOX_SIZE_CONFIG["default"])
    w, h = int(image_size[0]), int(image_size[1])

    hw = cfg["half_width"]
    hh = cfg["half_height"]

    return [
        max(0, int(x - hw)),
        max(0, int(y - hh)),
        min(w, int(x + hw)),
        min(h, int(y + hh)),
    ]