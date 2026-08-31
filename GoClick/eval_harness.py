import os
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image

from evidence_fusion import EvidenceFusionEngine
from evidence_signals import DOMElement, OCRSpan
from pipeline import PrivacyVisionPipeline
from semantic_judge import SemanticJudge
from verifier import RegionVerifier

BASE_DIR = os.path.dirname(__file__)

SCENARIOS: Dict[str, Dict[str, Any]] = {
    "payment": {
        "image_path": os.path.join(BASE_DIR, "test_payment.png"),
        "ocr_spans": [
            OCRSpan(text="Card Number", bbox=[35, 340, 130, 360]),
            OCRSpan(text="1234 5678 9012 3456", bbox=[35, 375, 300, 405]),
            OCRSpan(text="CVV", bbox=[262, 508, 290, 525]),
            OCRSpan(text="123", bbox=[262, 535, 300, 560]),
            OCRSpan(text="Expiry Date", bbox=[35, 508, 130, 525]),
        ],
        "dom_elements": [],
        "targets": [
            {"type": "credit_card_number", "referring_expression": "the credit card number field", "mode": "description"},
            {"type": "cvv", "referring_expression": "the CVV field", "mode": "description"},
            {"type": "signature_area", "referring_expression": "a signature box", "mode": "description"},
            {"type": "document_image", "referring_expression": "an ID document image", "mode": "description"},
        ],
        "ground_truth": {
            "credit_card_number": True,
            "cvv": True,
            "signature_area": False,   # negative test — payment page has none
            "document_image": False,   # negative test — payment page has none
        },
    },

    "passport": {
        "image_path": os.path.join(BASE_DIR, "test_passport.png"),
        "ocr_spans": [
            OCRSpan(text="Surname KUMAR", bbox=[220, 200, 350, 220]),
            OCRSpan(text="Passport No. U1234567", bbox=[400, 130, 550, 150]),
            OCRSpan(text="Date of Birth 15/08/1990", bbox=[400, 340, 560, 360]),
            OCRSpan(text="Signature", bbox=[260, 650, 340, 665]),
        ],
        "dom_elements": [],
        "targets": [
            {"type": "signature_area", "referring_expression": "the signature", "mode": "description"},
            # Guardrail test: faces must be routed away to a dedicated detector, never GoClick
            {"type": "face", "referring_expression": "a face photo", "mode": "description"},
        ],
        "ground_truth": {
            "signature_area": True,
            "face": True,
        },
    },

    "medical": {
        "image_path": os.path.join(BASE_DIR, "test_medical.png"),
        "ocr_spans": [
            OCRSpan(text="Diagnosis: Type 2 Diabetes Mellitus", bbox=[190, 600, 420, 630]),
            OCRSpan(text="Chief Complaint: Frequent urination", bbox=[190, 545, 420, 575]),
            OCRSpan(text="Doctor's Signature", bbox=[380, 780, 480, 800]),
        ],
        "dom_elements": [],
        "targets": [
            {"type": "health_diagnosis", "referring_expression": "the diagnosis field", "mode": "description"},
            {"type": "signature_area", "referring_expression": "the doctor's signature", "mode": "description"},
            {"type": "password_input", "referring_expression": "password input field", "mode": "description"},
        ],
        "ground_truth": {
            "health_diagnosis": True,
            "signature_area": True,
            "password_input": False,  # negative test: medical form has no password field
        },
    },

    "bank_form": {
        "image_path": os.path.join(BASE_DIR, "test_bank_form.png"),
        "ocr_spans": [
            OCRSpan(text="Account Opening Form", bbox=[90, 110, 390, 135]),
            OCRSpan(text="Full Name RAHUL KUMAR", bbox=[85, 215, 600, 235]),
            OCRSpan(text="rahul.kumar@email.com", bbox=[285, 340, 560, 360]),
            OCRSpan(text="Identity Proof Aadhaar Card", bbox=[85, 520, 370, 540]),
            OCRSpan(text="Signature Rahul Kumar", bbox=[85, 690, 360, 715]),
        ],
        "dom_elements": [],
        "targets": [
            {"type": "password_input", "referring_expression": "password input field", "mode": "description"},
            {"type": "signature_area", "referring_expression": "the signature box", "mode": "description"},
            {"type": "text_input_email", "referring_expression": "the email field", "mode": "description"},
            {"type": "face", "referring_expression": "applicant photo", "mode": "description"},
        ],
        "ground_truth": {
            "password_input": False,   # Primary negative test from PDF section 3
            "signature_area": True,
            "text_input_email": True,
            "face": True,              # Routing test
        },
    },
}


class MockGoClickGenerator:
    """Mock candidate generator for offline validation and unit tests."""

    def __init__(self):
        pass

    def generate_candidate(self, image, referring_expression, mode="description", max_new_tokens=64):
        # Deterministic mock returning plausible coordinates based on query keywords
        expr = referring_expression.lower()
        if "card" in expr:
            return {"found_coordinates": True, "point": (100, 390), "confidence": 0.82, "raw_text": "<loc_100>,<loc_390>"}
        elif "cvv" in expr:
            return {"found_coordinates": True, "point": (280, 545), "confidence": 0.85, "raw_text": "<loc_280>,<loc_545>"}
        elif "signature" in expr:
            return {"found_coordinates": True, "point": (300, 660), "confidence": 0.88, "raw_text": "<loc_300>,<loc_660>"}
        elif "diagnosis" in expr:
            return {"found_coordinates": True, "point": (250, 615), "confidence": 0.79, "raw_text": "<loc_250>,<loc_615>"}
        elif "email" in expr:
            return {"found_coordinates": True, "point": (350, 350), "confidence": 0.86, "raw_text": "<loc_350>,<loc_350>"}
        return {"found_coordinates": True, "point": (150, 150), "confidence": 0.75, "raw_text": "<loc_150>,<loc_150>"}


def classify_outcome(exists: bool, verdict: str, goclick_queried: bool, strategy: Optional[str] = None) -> Tuple[str, str]:
    """
    Classifies the outcome into structured categories:
    - TP: Target exists and was correctly grounded and accepted.
    - TN: Nonexistent target was correctly rejected (gate blocked or judge rejected).
    - FP: Nonexistent target was falsely accepted (hallucination).
    - FN: Existing target was missed / rejected.
    - ROUTED: Category correctly diverted away from GoClick to dedicated detector / regex.
    - UNCERTAIN: Flagged for secondary inspection (e.g. 3B semantic model).
    """
    if strategy in ("dedicated_detector", "regex_only"):
        if not goclick_queried:
            return "ROUTED", f"ROUTED - correctly deferred to {strategy} (not evaluated by GoClick)"
        return "MISROUTED", "MISROUTED - GoClick was queried despite routing guardrail"

    if exists and verdict == "ACCEPT":
        return "TP", "TP - target exists, correctly grounded"
    if exists and verdict == "REJECT":
        return "FN", "FN - target exists, system missed it"
    if not exists and verdict == "ACCEPT":
        return "FP", "FP - HALLUCINATION accepted (bad)"
    if not exists and verdict == "REJECT":
        return "TN", "TN - correctly rejected nonexistent target"
    return "UNCERTAIN", f"UNCERTAIN - needs review (target exists={exists})"


def run_scenario(
    name: str,
    scenario: Dict[str, Any],
    generator: Any,
    judge: Any,
    verifier: Optional[Any] = None,
    use_verification: bool = False,
    stats: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    image_path = scenario["image_path"]
    if not os.path.exists(image_path):
        print(f"\nSkipping Scenario {name}: Image not found at {image_path}")
        return {"regions": [], "all_results": []}

    image = Image.open(image_path).convert("RGB")
    fusion = EvidenceFusionEngine(generator, judge, verifier, use_verification)
    pipeline = PrivacyVisionPipeline(fusion)

    output = pipeline.run(image, scenario["targets"], scenario["ocr_spans"], scenario["dom_elements"])

    print(f"\n{'='*72}\nScenario: {name}\n{'='*72}")
    for r in output["all_results"]:
        exists = scenario["ground_truth"].get(r["type"], False)
        strategy = r["corroboration"]["grounding_strategy"] if r.get("corroboration") else None
        category, outcome_msg = classify_outcome(exists, r["verdict"], r["goclick_queried"], strategy)

        if stats is not None:
            stats[category] = stats.get(category, 0) + 1

        conf = r["goclick_candidate"]["confidence"] if r.get("goclick_candidate") else "N/A"
        point = (
            r["goclick_candidate"]["point"]
            if r.get("goclick_candidate") and r["goclick_candidate"].get("found_coordinates")
            else None
        )

        print(f"- {r['type']:20s} | queried={str(r['goclick_queried']):5} | verdict={r['verdict']:9} | confidence={conf}")
        if point:
            print(f"    raw_point: {point}")
        print(f"    outcome:   {outcome_msg}")
        print(f"    reason:    {r['reason']}")

    print("\nFinal accepted regions (enter PII map):")
    for region in output["regions"]:
        print(f"  {region}")

    return output


def run_all_scenarios(generator: Optional[Any] = None, judge: Optional[Any] = None) -> Dict[str, int]:
    if generator is None:
        from goclick_candidate_generator import GoClickCandidateGenerator
        generator = GoClickCandidateGenerator()
    if judge is None:
        judge = SemanticJudge()

    stats: Dict[str, int] = {"TP": 0, "TN": 0, "FP": 0, "FN": 0, "ROUTED": 0, "UNCERTAIN": 0, "MISROUTED": 0}

    for name, scenario in SCENARIOS.items():
        run_scenario(name, scenario, generator, judge, stats=stats)

    print(f"\n{'='*72}\nEVALUATION SCORECARD\n{'='*72}")
    print(f"  True Positives (TP):        {stats['TP']}")
    print(f"  True Negatives (TN):        {stats['TN']}")
    print(f"  False Positives / Halluc.:  {stats['FP']}")
    print(f"  False Negatives (FN):       {stats['FN']}")
    print(f"  Correctly Routed Guards:    {stats['ROUTED']}")
    print(f"  Uncertain / Deferred:       {stats['UNCERTAIN']}")
    print(f"  Misrouted (Guardrail Fail): {stats['MISROUTED']}")
    print(f"{'='*72}\n")
    return stats


if __name__ == "__main__":
    import sys
    use_mock = "--mock" in sys.argv
    if use_mock:
        print("Running eval harness with MockGoClickGenerator...")
        gen = MockGoClickGenerator()
    else:
        from goclick_candidate_generator import GoClickCandidateGenerator
        gen = GoClickCandidateGenerator()

    run_all_scenarios(generator=gen, judge=SemanticJudge())