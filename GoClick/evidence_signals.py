from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union


@dataclass
class OCRSpan:
    text: str
    bbox: List[int]


@dataclass
class DOMElement:
    element_type: str
    input_type: Optional[str] = None
    label: Optional[str] = None
    bbox: Optional[List[int]] = None


# Keyword/DOM signals that corroborate each sensitive element type.
# "high_risk" types get a stricter scoring path (see find_corroborating_evidence)
# since a single stray keyword match should NOT be enough to accept something
# like a password or API key.
CORROBORATION_RULES: Dict[str, Dict[str, Any]] = {
    "password_input": {
        "keywords": ["password", "pwd", "pass:"],
        "dom_input_types": ["password"],
        "high_risk": True,
        "grounding_strategy": "goclick",
        "default_referring_expression": "password input field",
    },
    "text_input_email": {
        "keywords": ["email", "e-mail", "mail id"],
        "dom_input_types": ["email"],
        "high_risk": False,
        "grounding_strategy": "goclick",
        "default_referring_expression": "email input field",
    },
    "signature_area": {
        "keywords": ["signature", "sign here", "sign inside", "authorized signatory", "doctor's signature"],
        "dom_input_types": [],
        "high_risk": False,
        "grounding_strategy": "goclick",
        "default_referring_expression": "signature area or signature box",
    },
    "document_image": {
        "keywords": ["photo", "id proof", "aadhaar", "passport", "upload document", "attach"],
        "dom_input_types": [],
        "high_risk": False,
        "grounding_strategy": "goclick",
        "default_referring_expression": "an embedded document or ID card image",
    },

    # --- Payment / Financial categories ---

    "credit_card_number": {
        "keywords": ["card number", "card no", "credit card", "debit card"],
        "dom_input_types": ["tel"],
        "high_risk": True,
        "grounding_strategy": "goclick",
        "default_referring_expression": "the credit card number field",
    },
    "cvv": {
        "keywords": ["cvv", "cvc", "security code"],
        "dom_input_types": ["password", "tel"],
        "high_risk": True,
        "grounding_strategy": "goclick",
        "default_referring_expression": "the CVV field",
    },
    "otp": {
        "keywords": ["otp", "one time password", "verification code"],
        "dom_input_types": ["tel"],
        "high_risk": True,
        "grounding_strategy": "goclick",
        "default_referring_expression": "OTP verification code field",
    },
    "upi_id": {
        "keywords": ["upi id", "@upi", "vpa"],
        "dom_input_types": [],
        "high_risk": True,
        "grounding_strategy": "goclick",
        "default_referring_expression": "UPI ID field",
    },
    "health_diagnosis": {
        "keywords": ["diagnosis", "prescribed", "condition", "medication", "dosage"],
        "dom_input_types": [],
        "high_risk": False,  # ambiguous, not high-risk-if-wrong the way a password is
        "grounding_strategy": "goclick",
        "default_referring_expression": "the diagnosis field",
    },

    # --- Types GoClick must NEVER be queried for ---
    # These require a dedicated detector or regex pattern, not a GUI-grounding model.
    # Routing them through GoClick would produce a plausible-looking box with no
    # actual reliability — the same failure mode as the password hallucination,
    # just for a category GoClick was never trained on at all.
    "face": {
        "keywords": ["face", "portrait", "photo"],
        "dom_input_types": [],
        "high_risk": True,
        "grounding_strategy": "dedicated_detector",  # e.g. a face detection model
        "default_referring_expression": "a face photo",
    },
    "biometric": {
        "keywords": ["biometric", "fingerprint", "iris", "thumb impression"],
        "dom_input_types": [],
        "high_risk": True,
        "grounding_strategy": "dedicated_detector",
        "default_referring_expression": "biometric scan",
    },
    "api_key": {
        "keywords": ["api_key", "api key", "secret", "sk-", "bearer "],
        "dom_input_types": [],
        "high_risk": True,
        "grounding_strategy": "regex_only",  # this is a text pattern, not a visual region
        "default_referring_expression": "API key",
    },
    "auth_token": {
        "keywords": ["auth token", "access_token", "bearer "],
        "dom_input_types": [],
        "high_risk": True,
        "grounding_strategy": "regex_only",
        "default_referring_expression": "auth token",
    },
}


def _get_field(obj: Any, key: str, default: Any = None) -> Any:
    """Helper to safely extract field from dict or object."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def find_corroborating_evidence(
    element_type: str,
    ocr_spans: Optional[List[Union[OCRSpan, Dict[str, Any]]]] = None,
    dom_elements: Optional[List[Union[DOMElement, Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """
    Evaluates evidence signals from OCR and DOM for a given element type.
    Handles both dataclass objects and standard dictionary representations.
    """
    ocr_spans = ocr_spans or []
    dom_elements = dom_elements or []

    rules = CORROBORATION_RULES.get(element_type)
    if rules is None:
        return {
            "has_corroboration": False,
            "strength": 0.0,
            "matches": [],
            "grounding_strategy": "unknown",
        }

    matches: List[Dict[str, Any]] = []

    # Check OCR spans
    for span in ocr_spans:
        text = _get_field(span, "text", "")
        bbox = _get_field(span, "bbox", None)
        if text and any(kw in text.lower() for kw in rules["keywords"]):
            matches.append({"source": "ocr", "text": text, "bbox": bbox})

    # Check DOM elements
    for el in dom_elements:
        input_type = _get_field(el, "input_type", None)
        label = _get_field(el, "label", None)
        bbox = _get_field(el, "bbox", None)

        if input_type and input_type in rules["dom_input_types"]:
            matches.append({"source": "dom", "input_type": input_type, "label": label, "bbox": bbox})
        elif label and any(kw in label.lower() for kw in rules["keywords"]):
            matches.append({"source": "dom_label", "label": label, "bbox": bbox})

    strategy = rules["grounding_strategy"]

    if not matches and strategy != "dedicated_detector":
        return {
            "has_corroboration": False,
            "strength": 0.0,
            "matches": [],
            "grounding_strategy": strategy,
        }

    has_dom_match = any(m["source"] == "dom" for m in matches)
    if rules["high_risk"] and not has_dom_match:
        strength = min(0.3, 0.15 * len(matches))
    else:
        strength = min(1.0, 0.5 + 0.1 * (len(matches) - 1) + (0.2 if has_dom_match else 0))

    return {
        "has_corroboration": strategy == "dedicated_detector" or bool(matches),
        "strength": strength,
        "matches": matches,
        "grounding_strategy": strategy,
    }


def auto_discover_targets(
    ocr_spans: Optional[List[Union[OCRSpan, Dict[str, Any]]]] = None,
    dom_elements: Optional[List[Union[DOMElement, Dict[str, Any]]]] = None,
    include_routed_types: bool = True,
) -> List[Dict[str, str]]:
    """
    Auto-discovers candidate targets from OCR spans and DOM elements by matching
    against known sensitive keywords and input types in CORROBORATION_RULES.
    
    Returns a list of target dicts ready for PrivacyVisionPipeline:
        [{"type": "credit_card_number", "referring_expression": "...", "mode": "description"}, ...]
    """
    ocr_spans = ocr_spans or []
    dom_elements = dom_elements or []

    discovered_types = set()

    for el_type, rule in CORROBORATION_RULES.items():
        if not include_routed_types and rule["grounding_strategy"] != "goclick":
            continue

        corrob = find_corroborating_evidence(el_type, ocr_spans, dom_elements)
        if corrob["has_corroboration"]:
            discovered_types.add(el_type)

    targets = [
        {
            "type": el_type,
            "referring_expression": CORROBORATION_RULES[el_type].get(
                "default_referring_expression", f"the {el_type.replace('_', ' ')}"
            ),
            "mode": "description",
        }
        for el_type in sorted(discovered_types)
    ]
    return targets