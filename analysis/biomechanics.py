"""
Football AI Pro - Biomechanics Analyser
Extracts joint angles, body alignment, stride mechanics, running symmetry,
and balance from YOLO pose keypoints.

All conclusions are labelled with confidence levels.  Where results are
inferred rather than directly observed, confidence is reduced accordingly.
"""

import math
import numpy as np
from typing import Optional, Dict, Any, List, Tuple
from collections import deque

from config.settings import (
    KP_NOSE, KP_LEFT_EYE, KP_RIGHT_EYE,
    KP_LEFT_SHOULDER, KP_RIGHT_SHOULDER,
    KP_LEFT_ELBOW, KP_RIGHT_ELBOW,
    KP_LEFT_WRIST, KP_RIGHT_WRIST,
    KP_LEFT_HIP, KP_RIGHT_HIP,
    KP_LEFT_KNEE, KP_RIGHT_KNEE,
    KP_LEFT_ANKLE, KP_RIGHT_ANKLE,
    POSE_SKELETON, POSE_MIN_KEYPOINTS,
    BALANCE_SYMMETRY_TOLERANCE,
    KNEE_FLEXION_HEALTHY_RANGE,
    HIP_FLEXION_HEALTHY_RANGE,
)
from utils.geometry import angle_between_points, angle_to_vertical, midpoint


class BiomechanicsAnalyzer:
    """
    Runs pose estimation on a player crop and extracts comprehensive
    biomechanical metrics.
    """

    def __init__(self):
        self._stride_history: Dict[int, deque] = {}

    def analyze_frame(
        self,
        frame: np.ndarray,
        bbox: List[int],
        pose_model,
    ) -> Optional[Dict[str, Any]]:
        """
        Run pose estimation on the player crop and return structured
        biomechanics data, or None if pose cannot be determined.
        """
        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None

        results = pose_model.predict(crop, verbose=False)
        if not results or not results[0].keypoints:
            return None

        kp_data = results[0].keypoints
        if len(kp_data.xy) == 0:
            return None

        kp = kp_data.xy[0].cpu().numpy().copy()  # (17, 2)

        # Check we have enough visible keypoints
        visible = np.sum((kp[:, 0] > 0) & (kp[:, 1] > 0))
        if visible < POSE_MIN_KEYPOINTS:
            return None

        # Confidence from keypoint visibility
        if hasattr(kp_data, 'conf') and kp_data.conf is not None and len(kp_data.conf) > 0:
            kp_conf = kp_data.conf[0].cpu().numpy()
            reliable = kp_conf >= .50
            kp[~reliable] = 0
            visible = int(np.sum((kp[:, 0] > 0) & (kp[:, 1] > 0)))
            if visible < POSE_MIN_KEYPOINTS:
                return None
            avg_conf = float(np.mean(kp_conf[reliable]))
        else:
            avg_conf = float(visible / 17)

        # Convert to absolute coordinates
        kp_abs = kp.copy()
        known = (kp[:, 0] > 0) & (kp[:, 1] > 0)
        kp_abs[known] += (x1, y1)

        # ── Extract joint angles ────────────────────────────────────
        data: Dict[str, Any] = {
            "keypoints": kp_abs,
            "keypoints_local": kp,
            "confidence": round(avg_conf, 2),
            "visible_keypoints": int(visible),
        }

        # Helper: only compute angle if all three keypoints are visible
        def safe_angle(a_idx, b_idx, c_idx) -> Optional[float]:
            pts = [kp[a_idx], kp[b_idx], kp[c_idx]]
            if all(p[0] > 0 and p[1] > 0 for p in pts):
                return angle_between_points(
                    np.array(pts[0]), np.array(pts[1]), np.array(pts[2])
                )
            return None

        # Knee flexion
        lk = safe_angle(KP_LEFT_HIP, KP_LEFT_KNEE, KP_LEFT_ANKLE)
        rk = safe_angle(KP_RIGHT_HIP, KP_RIGHT_KNEE, KP_RIGHT_ANKLE)
        data["left_knee_angle"] = round(lk, 1) if lk else None
        data["right_knee_angle"] = round(rk, 1) if rk else None

        # Hip flexion
        lh = safe_angle(KP_LEFT_SHOULDER, KP_LEFT_HIP, KP_LEFT_KNEE)
        rh = safe_angle(KP_RIGHT_SHOULDER, KP_RIGHT_HIP, KP_RIGHT_KNEE)
        data["left_hip_angle"] = round(lh, 1) if lh else None
        data["right_hip_angle"] = round(rh, 1) if rh else None

        # Elbow angles
        le = safe_angle(KP_LEFT_SHOULDER, KP_LEFT_ELBOW, KP_LEFT_WRIST)
        re = safe_angle(KP_RIGHT_SHOULDER, KP_RIGHT_ELBOW, KP_RIGHT_WRIST)
        data["left_elbow_angle"] = round(le, 1) if le else None
        data["right_elbow_angle"] = round(re, 1) if re else None

        # Shoulder angle (arms relative to torso)
        ls = safe_angle(KP_LEFT_ELBOW, KP_LEFT_SHOULDER, KP_LEFT_HIP)
        rs = safe_angle(KP_RIGHT_ELBOW, KP_RIGHT_SHOULDER, KP_RIGHT_HIP)
        data["left_shoulder_angle"] = round(ls, 1) if ls else None
        data["right_shoulder_angle"] = round(rs, 1) if rs else None

        # ── Posture / body alignment ────────────────────────────────
        data.update(self._analyze_posture(kp))

        # ── Symmetry ────────────────────────────────────────────────
        data.update(self._analyze_symmetry(data))

        # ── Stride estimation ───────────────────────────────────────
        data.update(self._analyze_stride(kp))

        # ── Head orientation (scanning proxy) ───────────────────────
        data.update(self._analyze_head(kp))

        return data

    # ── Internal helpers ────────────────────────────────────────────

    def _analyze_posture(self, kp: np.ndarray) -> Dict[str, Any]:
        """Trunk lean and pelvic alignment."""
        result: Dict[str, Any] = {}

        lsh = kp[KP_LEFT_SHOULDER]
        rsh = kp[KP_RIGHT_SHOULDER]
        lhip = kp[KP_LEFT_HIP]
        rhip = kp[KP_RIGHT_HIP]

        if all(p[0] > 0 and p[1] > 0 for p in [lsh, rsh, lhip, rhip]):
            mid_sh = midpoint(tuple(lsh), tuple(rsh))
            mid_hip = midpoint(tuple(lhip), tuple(rhip))

            trunk_lean = angle_to_vertical(
                np.array(mid_hip), np.array(mid_sh)
            )
            result["trunk_lean_deg"] = round(trunk_lean, 1)

            if trunk_lean < 8:
                result["posture"] = "upright"
            elif trunk_lean < 20:
                result["posture"] = "slight_lean"
            else:
                result["posture"] = "excessive_lean"

            # Pelvic tilt (shoulder-hip horizontal offset)
            hip_tilt = abs(lhip[1] - rhip[1])
            shoulder_tilt = abs(lsh[1] - rsh[1])
            result["hip_tilt_px"] = round(float(hip_tilt), 1)
            result["shoulder_tilt_px"] = round(float(shoulder_tilt), 1)

            # Hip alignment
            hip_width = abs(lhip[0] - rhip[0])
            shoulder_width = abs(lsh[0] - rsh[0])
            if shoulder_width > 0:
                result["hip_to_shoulder_ratio"] = round(hip_width / shoulder_width, 2)
        else:
            result["posture"] = "unknown"

        return result

    def _analyze_symmetry(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Check left-right symmetry of joint angles."""
        result: Dict[str, Any] = {}
        issues = []

        # Knee symmetry
        lk = data.get("left_knee_angle")
        rk = data.get("right_knee_angle")
        if lk is not None and rk is not None:
            knee_diff = abs(lk - rk)
            result["knee_symmetry_diff"] = round(knee_diff, 1)
            if knee_diff > BALANCE_SYMMETRY_TOLERANCE:
                issues.append({
                    "joint": "knee",
                    "diff_deg": round(knee_diff, 1),
                    "confidence": 0.7,
                })

        # Hip symmetry
        lh = data.get("left_hip_angle")
        rh = data.get("right_hip_angle")
        if lh is not None and rh is not None:
            hip_diff = abs(lh - rh)
            result["hip_symmetry_diff"] = round(hip_diff, 1)
            if hip_diff > BALANCE_SYMMETRY_TOLERANCE:
                issues.append({
                    "joint": "hip",
                    "diff_deg": round(hip_diff, 1),
                    "confidence": 0.65,
                })

        # Shoulder symmetry
        ls = data.get("left_shoulder_angle")
        rs = data.get("right_shoulder_angle")
        if ls is not None and rs is not None:
            sh_diff = abs(ls - rs)
            result["shoulder_symmetry_diff"] = round(sh_diff, 1)
            if sh_diff > 20:
                issues.append({
                    "joint": "shoulder",
                    "diff_deg": round(sh_diff, 1),
                    "confidence": 0.6,
                })

        result["symmetry_issues"] = issues
        result["is_symmetric"] = len(issues) == 0
        return result

    def _analyze_stride(self, kp: np.ndarray) -> Dict[str, Any]:
        """Estimate stride length from ankle separation."""
        result: Dict[str, Any] = {}

        la = kp[KP_LEFT_ANKLE]
        ra = kp[KP_RIGHT_ANKLE]

        if la[0] > 0 and la[1] > 0 and ra[0] > 0 and ra[1] > 0:
            stride_px = float(np.linalg.norm(la - ra))
            result["stride_length_px"] = round(stride_px, 1)

            # Ground contact proxy: lower ankle y = closer to ground
            result["left_ankle_y"] = round(float(la[1]), 1)
            result["right_ankle_y"] = round(float(ra[1]), 1)

            # Which foot is grounded (higher y in image = lower position)
            if abs(la[1] - ra[1]) > 10:
                result["ground_foot"] = "left" if la[1] > ra[1] else "right"
            else:
                result["ground_foot"] = "both"

        return result

    def _analyze_head(self, kp: np.ndarray) -> Dict[str, Any]:
        """Head orientation as a proxy for scanning / awareness."""
        result: Dict[str, Any] = {}

        nose = kp[KP_NOSE]
        l_eye = kp[KP_LEFT_EYE]
        r_eye = kp[KP_RIGHT_EYE]

        if all(p[0] > 0 and p[1] > 0 for p in [nose, l_eye, r_eye]):
            eye_mid = midpoint(tuple(l_eye), tuple(r_eye))
            eye_width = abs(l_eye[0] - r_eye[0])

            # Horizontal head turn: if one eye is much closer to nose, head is turned
            l_dist = abs(nose[0] - l_eye[0])
            r_dist = abs(nose[0] - r_eye[0])

            if eye_width > 5:
                asymmetry = (l_dist - r_dist) / eye_width
                if asymmetry > 0.3:
                    result["head_direction"] = "looking_right"
                elif asymmetry < -0.3:
                    result["head_direction"] = "looking_left"
                else:
                    result["head_direction"] = "forward"
            else:
                result["head_direction"] = "forward"

            # Head tilt (vertical offset between eyes)
            head_tilt = abs(l_eye[1] - r_eye[1])
            result["head_tilt_px"] = round(float(head_tilt), 1)

            # Is head up (nose significantly above eye midpoint)
            head_up = eye_mid[1] - nose[1]
            result["head_elevation"] = "up" if head_up > 5 else ("down" if head_up < -5 else "level")

        return result

    def get_biomechanics_summary(self, pose_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        High-level summary suitable for UI display.
        Returns scores and observations with confidence levels.
        """
        summary: Dict[str, Any] = {
            "observations": [],
            "joint_angles": {},
            "posture_score": 0,
            "symmetry_score": 0,
            "overall_score": 0,
        }

        if not pose_data:
            return summary

        # Joint angles for display
        for key in [
            "left_knee_angle", "right_knee_angle",
            "left_hip_angle", "right_hip_angle",
            "left_elbow_angle", "right_elbow_angle",
        ]:
            if pose_data.get(key) is not None:
                clean_name = key.replace("_", " ").title()
                summary["joint_angles"][clean_name] = pose_data[key]

        # Posture scoring
        posture = pose_data.get("posture", "unknown")
        if posture == "upright":
            summary["posture_score"] = 90
        elif posture == "slight_lean":
            summary["posture_score"] = 70
            summary["observations"].append({
                "text": "Slight forward lean detected",
                "type": "info",
                "confidence": pose_data.get("confidence", 0.5),
            })
        elif posture == "excessive_lean":
            summary["posture_score"] = 40
            summary["observations"].append({
                "text": "Excessive forward lean may indicate weak core or fatigue",
                "type": "warning",
                "confidence": pose_data.get("confidence", 0.5) * 0.8,
            })
        else:
            summary["posture_score"] = 50

        # Symmetry scoring
        issues = pose_data.get("symmetry_issues", [])
        if not issues:
            summary["symmetry_score"] = 90
        else:
            summary["symmetry_score"] = max(30, 90 - len(issues) * 20)
            for iss in issues:
                summary["observations"].append({
                    "text": f"{iss['joint'].title()} asymmetry: {iss['diff_deg']}° difference",
                    "type": "warning",
                    "confidence": iss.get("confidence", 0.5),
                })

        # Knee angle check
        for side, key in [("Left", "left_knee_angle"), ("Right", "right_knee_angle")]:
            val = pose_data.get(key)
            if val is not None:
                lo, hi = KNEE_FLEXION_HEALTHY_RANGE
                if val > hi:
                    summary["observations"].append({
                        "text": f"{side} knee hyperextended ({val:.0f}°) – may indicate stiff gait",
                        "type": "warning",
                        "confidence": pose_data.get("confidence", 0.5) * 0.75,
                    })

        # Running mechanics
        trunk = pose_data.get("trunk_lean_deg")
        if trunk is not None and trunk > 25:
            summary["observations"].append({
                "text": f"Trunk lean {trunk:.0f}° exceeds optimal running posture",
                "type": "warning",
                "confidence": pose_data.get("confidence", 0.5) * 0.7,
            })

        # Overall
        summary["overall_score"] = int(
            summary["posture_score"] * 0.5 + summary["symmetry_score"] * 0.5
        )

        return summary
