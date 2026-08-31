from typing import Any, Dict, List, Optional, Union
from PIL import Image

from bbox_sizing import get_bbox
from evidence_signals import DOMElement, OCRSpan, find_corroborating_evidence


class EvidenceFusionEngine:
    """
    Orchestrates the multi-signal evidence fusion pipeline:
    1. Routing Gate: Diverts non-UI elements (faces, biometrics, api keys) to dedicated tools.
    2. Corroboration Gate: Checks OCR/DOM presence before invoking GoClick.
    3. Candidate Generation: Prompts GoClick for point grounding if corroborated.
    4. Verification: Optional crop-and-recheck pass.
    5. Semantic Judgment: Fuses corroboration strength, spatial proximity, and verification.
    """

    def __init__(
        self,
        candidate_generator: Any,
        judge: Any,
        verifier: Optional[Any] = None,
        use_verification: bool = False,
    ):
        self.generator = candidate_generator
        self.judge = judge
        self.verifier = verifier
        self.use_verification = use_verification

    def evaluate(
        self,
        image: Image.Image,
        element_type: str,
        referring_expression: str,
        mode: str = "description",
        ocr_spans: Optional[List[Union[OCRSpan, Dict[str, Any]]]] = None,
        dom_elements: Optional[List[Union[DOMElement, Dict[str, Any]]]] = None,
    ) -> Dict[str, Any]:
        ocr_spans = ocr_spans or []
        dom_elements = dom_elements or []

        corroboration = find_corroborating_evidence(element_type, ocr_spans, dom_elements)
        strategy = corroboration["grounding_strategy"]

        # --- ROUTING GATE: some types must never reach GoClick ---
        if strategy == "dedicated_detector":
            return self._result(
                element_type,
                "UNCERTAIN",
                f"'{element_type}' requires a dedicated detector (not GoClick) — "
                f"not evaluated by this pipeline, route to dedicated detector",
                goclick_queried=False,
                corroboration=corroboration,
            )

        if strategy == "regex_only":
            return self._result(
                element_type,
                "UNCERTAIN",
                f"'{element_type}' is a text-pattern category — route to OCR+regex, "
                f"not visual grounding",
                goclick_queried=False,
                corroboration=corroboration,
            )

        # --- Corroboration Gate for GoClick-eligible types ---
        if not corroboration["has_corroboration"]:
            return self._result(
                element_type,
                "REJECT",
                "no corroborating DOM/OCR/accessibility evidence — GoClick not queried",
                goclick_queried=False,
                corroboration=corroboration,
            )

        candidate = self.generator.generate_candidate(image, referring_expression, mode)

        verification = None
        if self.use_verification and self.verifier and candidate.get("found_coordinates"):
            verification = self.verifier.verify(image, candidate, referring_expression, mode)

        verdict, reason, spatial = self.judge.judge(
            element_type, corroboration, candidate, verification
        )

        bbox = None
        if verdict in ("ACCEPT", "UNCERTAIN") and candidate.get("found_coordinates") and candidate.get("point") is not None:
            bbox = get_bbox(
                candidate["point"][0],
                candidate["point"][1],
                image.size,
                element_type,
            )

        return self._result(
            element_type,
            verdict,
            reason,
            goclick_queried=True,
            candidate=candidate,
            bbox=bbox,
            corroboration=corroboration,
            verification=verification,
            spatial=spatial,
        )

    @staticmethod
    def _result(
        element_type: str,
        verdict: str,
        reason: str,
        goclick_queried: bool,
        candidate: Optional[Dict[str, Any]] = None,
        bbox: Optional[List[int]] = None,
        corroboration: Optional[Dict[str, Any]] = None,
        verification: Optional[Dict[str, Any]] = None,
        spatial: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "type": element_type,
            "verdict": verdict,
            "reason": reason,
            "goclick_queried": goclick_queried,
            "bbox": bbox,
            "goclick_candidate": candidate,
            "corroboration": corroboration,
            "verification": verification,
            "spatial": spatial,
        }