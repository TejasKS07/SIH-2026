import math
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union


def _normalize_bbox(bbox: Any) -> Optional[Tuple[float, float, float, float]]:
    """Normalizes any valid bbox representation into (x1, y1, x2, y2)."""
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        try:
            x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
            return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
        except (ValueError, TypeError):
            return None
    elif isinstance(bbox, dict):
        try:
            if "x1" in bbox and "y1" in bbox and "x2" in bbox and "y2" in bbox:
                x1, y1, x2, y2 = float(bbox["x1"]), float(bbox["y1"]), float(bbox["x2"]), float(bbox["y2"])
                return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
            elif "x" in bbox and "y" in bbox and "width" in bbox and "height" in bbox:
                x1, y1 = float(bbox["x"]), float(bbox["y"])
                x2, y2 = x1 + float(bbox["width"]), y1 + float(bbox["height"])
                return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
        except (ValueError, TypeError):
            return None
    return None


def point_to_bbox_distance(point: Sequence[float], bbox: Any) -> float:
    """
    Shortest Euclidean distance from a point (x, y) to the nearest edge of a bbox
    [x1, y1, x2, y2]. Returns 0.0 if the point is located inside the bbox.
    """
    norm_box = _normalize_bbox(bbox)
    if norm_box is None or point is None or len(point) < 2:
        return float("inf")

    x, y = float(point[0]), float(point[1])
    x1, y1, x2, y2 = norm_box
    dx = max(x1 - x, 0.0, x - x2)
    dy = max(y1 - y, 0.0, y - y2)
    return math.hypot(dx, dy)


def check_spatial_agreement(
    candidate_point: Optional[Sequence[float]],
    corroboration_matches: List[Dict[str, Any]],
    max_agree_distance: float = 150.0,
) -> Dict[str, Any]:
    """
    Checks whether GoClick's candidate point lands near the evidence that
    justified querying it (an OCR span's bbox, a DOM element's bbox, etc.).
    Corroboration alone only proves the KEYWORD exists somewhere on the page;
    spatial agreement verifies whether GoClick actually pointed to the right place.

    Returns:
        {
            "has_spatial_evidence": bool,
            "agrees": Optional[bool],
            "nearest_distance": Optional[float],
            "nearest_match": Optional[Dict[str, Any]]
        }
    """
    if candidate_point is None:
        return {
            "has_spatial_evidence": False,
            "agrees": None,
            "nearest_distance": None,
            "nearest_match": None,
        }

    locatable = [m for m in corroboration_matches if _normalize_bbox(m.get("bbox")) is not None]
    if not locatable:
        return {
            "has_spatial_evidence": False,
            "agrees": None,
            "nearest_distance": None,
            "nearest_match": None,
        }

    scored = [(point_to_bbox_distance(candidate_point, m["bbox"]), m) for m in locatable]
    nearest_distance, nearest_match = min(scored, key=lambda s: s[0])

    return {
        "has_spatial_evidence": True,
        "agrees": nearest_distance <= max_agree_distance,
        "nearest_distance": round(nearest_distance, 1),
        "nearest_match": nearest_match,
    }