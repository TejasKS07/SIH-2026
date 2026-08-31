from typing import Any, Dict, Optional, Tuple
from spatial_agreement import check_spatial_agreement


class SemanticJudge:
    """
    Default rule-based judge. Fuses corroboration strength, spatial
    agreement, and optional verification into a single score, thresholded
    into ACCEPT / UNCERTAIN / REJECT.

    GoClick's own confidence score is deliberately NOT part of this
    formula — proven unreliable (e.g. 0.78 confidence on a hallucinated
    password field with zero corroborating evidence).
    """

    ACCEPT_THRESHOLD = 0.5
    UNCERTAIN_THRESHOLD = 0.25
    MAX_AGREE_DISTANCE = 150.0  # px

    def judge(
        self,
        element_type: str,
        corroboration: Dict[str, Any],
        candidate: Dict[str, Any],
        verification: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, str, Optional[Dict[str, Any]]]:
        if not candidate or not candidate.get("found_coordinates"):
            return "REJECT", "GoClick returned no parseable coordinates", None

        score = float(corroboration.get("strength", 0.0))

        spatial = check_spatial_agreement(
            candidate.get("point"),
            corroboration.get("matches", []),
            self.MAX_AGREE_DISTANCE,
        )

        if spatial.get("has_spatial_evidence"):
            if spatial.get("agrees"):
                score += 0.25
            else:
                score -= 0.35

        if verification is not None:
            if verification.get("verified") is True:
                score += 0.3
            elif verification.get("verified") is False:
                score -= 0.4

        score = max(0.0, min(1.0, score))

        if score >= self.ACCEPT_THRESHOLD:
            verdict = "ACCEPT"
        elif score >= self.UNCERTAIN_THRESHOLD:
            verdict = "UNCERTAIN"
        else:
            verdict = "REJECT"

        reason = f"fused evidence score={score:.2f}"
        if spatial.get("has_spatial_evidence"):
            reason += f", spatial_agree={spatial.get('agrees')} (dist={spatial.get('nearest_distance')}px)"

        return verdict, reason, spatial


class ThreeBModelJudge(SemanticJudge):
    """
    Production judge — delegates the final decision to the local
    3B semantic model. Inherits MAX_AGREE_DISTANCE and spatial-check
    logic from SemanticJudge but overrides judge() to route through
    model_client instead of the rule-based score.
    """

    def __init__(self, model_client: Any):
        self.model_client = model_client  # anything exposing .classify(...)

    def judge(
        self,
        element_type: str,
        corroboration: Dict[str, Any],
        candidate: Dict[str, Any],
        verification: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, str, Optional[Dict[str, Any]]]:
        if not candidate or not candidate.get("found_coordinates"):
            return "REJECT", "GoClick returned no parseable coordinates", None

        spatial = check_spatial_agreement(
            candidate.get("point"),
            corroboration.get("matches", []),
            self.MAX_AGREE_DISTANCE,
        )

        try:
            response = self.model_client.classify({
                "element_type": element_type,
                "corroborating_evidence": corroboration.get("matches", []),
                "goclick_point": candidate.get("point"),
                "goclick_confidence": candidate.get("confidence"),
                "spatial_agreement": spatial,
                "verification": verification,
            })
        except Exception as e:
            return "UNCERTAIN", f"3B model evaluation failed: {e}", spatial

        if response.get("sensitive") is True:
            cat = response.get("category", element_type)
            conf = response.get("confidence", "N/A")
            return "ACCEPT", f"3B model: {cat} ({conf})", spatial
        elif response.get("sensitive") is False:
            return "REJECT", "3B model judged not present/not sensitive", spatial
        return "UNCERTAIN", "3B model returned ambiguous result", spatial