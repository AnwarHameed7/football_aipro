"""
Football AI Pro - Sports Science Engine
Evaluates player performance, detects weaknesses, and generates
evidence-based corrective training recommendations.

Every finding distinguishes observations (what the camera saw) from
inferences (likely causes) and communicates confidence levels.
"""

from typing import Dict, Any, List, Optional

from config.settings import (
    SPRINT_SPEED_THRESHOLD,
    FATIGUE_SPEED_DROP_PERCENT,
    INJURY_RISK_ASYMMETRY,
    KNEE_FLEXION_HEALTHY_RANGE,
    HIP_FLEXION_HEALTHY_RANGE,
    SCORE_WEIGHTS,
)
from models.events import EventLog, EventType


# ── Evidence-based drill database ───────────────────────────────────────

DRILL_DATABASE = {
    "stiff_gait": {
        "observation": "Stiff running gait – limited knee flexion during stride",
        "likely_technical_cause": "Insufficient hip flexor engagement and ankle dorsiflexion",
        "likely_biomechanical_cause": "Tight hip flexors or weak glute complex reducing knee drive",
        "potential_impact": "Increased ground contact time, reduced acceleration ability, higher hamstring load",
        "severity": "moderate",
        "corrective_drills": "A-Skips 3×20m, High Knees 3×15s, Wall Drive Marches 3×12 each leg",
        "strength_exercises": "Hip Flexor Raises 3×15, Romanian Deadlifts 3×8, Glute Bridges 3×12",
        "mobility_exercises": "Hip Flexor Stretch 3×30s each side, Ankle Dorsiflexion Mobilisation 3×15",
        "football_exercises": "Dribble through cones with exaggerated knee lift, Quick-feet ladder drills",
        "sets_reps": "3-4 sets, 8-20 reps depending on exercise",
        "frequency": "3×/week, 40-45 min sessions",
        "progressions": "Add resistance bands at week 3, increase speed at week 5",
        "recovery": "Foam roll quads and hip flexors for 10 min post-session",
        "injury_prevention": "Avoid sudden sprint bursts without warm-up; progressive loading",
    },
    "excessive_lean": {
        "observation": "Excessive forward lean during movement",
        "likely_technical_cause": "Weak anterior core or poor trunk control habit",
        "likely_biomechanical_cause": "Anterior pelvic tilt shifting centre of mass forward",
        "potential_impact": "Reduced agility in direction changes, increased lower back stress",
        "severity": "moderate",
        "corrective_drills": "Dead Bug 3×10 each side, Pallof Press 3×8 each side, Bird Dogs 3×10",
        "strength_exercises": "Planks 3×45-60s, Anti-rotation Press 3×8, Single-leg RDL 3×8",
        "mobility_exercises": "Cat-Cow 2×10, Thoracic Rotation 3×8 each side",
        "football_exercises": "Shielding drills maintaining upright posture, Heading practice with core brace",
        "sets_reps": "3 sets, 8-12 reps",
        "frequency": "4×/week, 25-30 min sessions",
        "progressions": "Progress to single-leg planks at week 3, add perturbations at week 5",
        "recovery": "Gentle lower back stretching and foam rolling, 5 min",
        "injury_prevention": "Strengthen erector spinae; avoid prolonged sitting before training",
    },
    "intensity_drop": {
        "observation": "Significant drop in movement intensity during the session",
        "likely_technical_cause": "Aerobic capacity insufficient for sustained high-intensity work",
        "likely_biomechanical_cause": "Glycogen depletion in fast-twitch fibres; neuromuscular fatigue",
        "potential_impact": "Reduced decision-making quality, increased injury risk in late stages",
        "severity": "high",
        "corrective_drills": "HIIT 30s on / 30s off × 8, Tempo Runs 4 min × 4, Fartlek 15 min",
        "strength_exercises": "Box Jumps 3×8, Kettlebell Swings 3×15, Split Squats 3×10",
        "mobility_exercises": "Dynamic stretching circuit pre-session, yoga flow post-session",
        "football_exercises": "Small-sided games 4v4 with high press, Positional rondos with time pressure",
        "sets_reps": "As prescribed per drill",
        "frequency": "3×/week with 48h recovery between HIIT sessions",
        "progressions": "Increase HIIT duration by 5s every 2 weeks; add match-simulation at week 6",
        "recovery": "48h between high-intensity sessions; prioritise sleep and hydration",
        "injury_prevention": "Monitor resting heart rate; reduce volume if elevated >10% above baseline",
    },
    "knee_asymmetry": {
        "observation": "Significant left-right knee angle asymmetry during movement",
        "likely_technical_cause": "Unilateral strength imbalance or compensatory movement pattern",
        "likely_biomechanical_cause": "Possible prior injury adaptation, muscle imbalance, or flexibility deficit",
        "potential_impact": "Elevated risk of knee or ankle injury on the weaker side",
        "severity": "high",
        "corrective_drills": "Single-leg Squats 3×8 each side, Step-ups 3×10, Lateral Lunges 3×8",
        "strength_exercises": "Bulgarian Split Squats 3×10, Nordic Hamstring Curls 3×6, Calf Raises 3×15",
        "mobility_exercises": "IT Band Foam Roll 2 min each side, Pigeon Stretch 3×30s",
        "football_exercises": "Single-leg passing drills, Balance board dribbling",
        "sets_reps": "3 sets, 6-10 reps with focus on weak side",
        "frequency": "4×/week, 30 min",
        "progressions": "Add external load at week 3, increase range at week 4",
        "recovery": "Cold-water immersion post heavy sessions; contrast therapy",
        "injury_prevention": "Regular physiotherapy screening; avoid training through pain",
    },
    "hip_asymmetry": {
        "observation": "Left-right hip angle asymmetry detected",
        "likely_technical_cause": "Pelvic instability or glute inhibition on one side",
        "likely_biomechanical_cause": "Lateral pelvic tilt or hip mobility restriction",
        "potential_impact": "Altered running mechanics, increased load on lumbar spine",
        "severity": "moderate",
        "corrective_drills": "Clamshells 3×15 each side, Side-lying Hip Abduction 3×12, Monster Walks 3×20",
        "strength_exercises": "Single-leg Glute Bridge 3×12, Copenhagen Plank 3×20s, Lateral Band Walks 3×15",
        "mobility_exercises": "90/90 Hip Stretch 3×30s each side, Hip Circles 2×10",
        "football_exercises": "Lateral movement drills, Defensive slide exercises",
        "sets_reps": "3 sets, 12-15 reps",
        "frequency": "3-4×/week, 25 min",
        "progressions": "Add band resistance at week 2, progress to dynamic drills at week 4",
        "recovery": "Trigger point release on glute med/min; hip stretching routine",
        "injury_prevention": "Warm-up must include lateral activation; avoid cold starts",
    },
    "poor_arm_swing": {
        "observation": "Restricted or asymmetric arm swing during running",
        "likely_technical_cause": "Tight shoulders or poor running technique habit",
        "likely_biomechanical_cause": "Thoracic spine stiffness limiting shoulder mobility",
        "potential_impact": "Reduced running efficiency and balance; compensatory trunk rotation",
        "severity": "low",
        "corrective_drills": "Arm swing drills 3×30s, Standing arm drive practice, Skipping with arm focus",
        "strength_exercises": "Shoulder Press 3×10, Face Pulls 3×12, Rows 3×10",
        "mobility_exercises": "Thoracic spine rotation 3×10, Shoulder dislocates with band 2×10",
        "football_exercises": "Sprint technique drills with coach cues on arms",
        "sets_reps": "3 sets, 10-15 reps",
        "frequency": "2-3×/week, 15-20 min",
        "progressions": "Integrate into sprint warm-ups from week 2",
        "recovery": "Shoulder stretching and foam rolling thoracic spine",
        "injury_prevention": "Include upper-body mobility in every warm-up",
    },
    "limited_scanning": {
        "observation": "Low head movement frequency – limited scanning behaviour",
        "likely_technical_cause": "Habit of watching the ball rather than scanning surroundings",
        "likely_biomechanical_cause": "N/A – primarily a cognitive/tactical habit",
        "potential_impact": "Reduced awareness of teammates and opponents; slower decision-making",
        "severity": "moderate",
        "corrective_drills": "Rondo with scanning requirement, Colour-call passing drills",
        "strength_exercises": "N/A – this is a cognitive-tactical improvement area",
        "mobility_exercises": "Neck mobility exercises to ensure physical comfort in scanning",
        "football_exercises": "Small-sided games with awareness cues, Shadow play with check-shoulder requirement",
        "sets_reps": "Integrated into regular training sessions",
        "frequency": "Every training session",
        "progressions": "Add time pressure and complexity progressively",
        "recovery": "N/A",
        "injury_prevention": "Ensure neck mobility is maintained",
    },
}


class SportsScienceEngine:
    """
    Evaluates player performance and generates actionable findings.
    """

    def __init__(self):
        self._reported: Dict[int, set] = {}  # player_id → set of already-reported issues

    def evaluate(
        self,
        player,
        pose_data: Optional[Dict[str, Any]],
        event_log: EventLog,
        frame_idx: int,
    ) -> List[Dict[str, Any]]:
        """
        Check current frame data against known patterns.
        Returns list of new findings (avoids duplicate reporting).
        """
        pid = player.player_id
        if pid not in self._reported:
            self._reported[pid] = set()

        findings = []

        if pose_data is None:
            return findings

        speed = player.current_speed
        distance = player.total_distance_m
        conf = pose_data.get("confidence", 0.5)

        # ── Stiff gait ──────────────────────────────────────────────
        lk = pose_data.get("left_knee_angle")
        rk = pose_data.get("right_knee_angle")
        if lk is not None and rk is not None:
            avg_knee = (lk + rk) / 2
            if avg_knee > KNEE_FLEXION_HEALTHY_RANGE[1] and speed > 3.0:
                if "stiff_gait" not in self._reported[pid]:
                    self._reported[pid].add("stiff_gait")
                    f = self._make_finding("stiff_gait", conf * 0.75)
                    findings.append(f)
                    event_log.log(
                        frame_idx, EventType.BIOMECHANICS_ISSUE,
                        player_id=pid,
                        description=f["observation"],
                        severity="warning",
                        confidence=f["confidence"],
                    )

        # ── Excessive forward lean ──────────────────────────────────
        posture = pose_data.get("posture", "")
        if posture == "excessive_lean" and speed < 2.0:
            if "excessive_lean" not in self._reported[pid]:
                self._reported[pid].add("excessive_lean")
                f = self._make_finding("excessive_lean", conf * 0.7)
                findings.append(f)
                event_log.log(
                    frame_idx, EventType.POSTURE_WARNING,
                    player_id=pid,
                    description=f["observation"],
                    severity="warning",
                    confidence=f["confidence"],
                )

        # ── Knee asymmetry ──────────────────────────────────────────
        knee_diff = pose_data.get("knee_symmetry_diff")
        if knee_diff is not None and knee_diff > INJURY_RISK_ASYMMETRY:
            if "knee_asymmetry" not in self._reported[pid]:
                self._reported[pid].add("knee_asymmetry")
                f = self._make_finding("knee_asymmetry", conf * 0.65)
                findings.append(f)
                event_log.log(
                    frame_idx, EventType.BIOMECHANICS_ISSUE,
                    player_id=pid,
                    description=f["observation"],
                    severity="alert",
                    confidence=f["confidence"],
                )

        # ── Hip asymmetry ───────────────────────────────────────────
        hip_diff = pose_data.get("hip_symmetry_diff")
        if hip_diff is not None and hip_diff > INJURY_RISK_ASYMMETRY:
            if "hip_asymmetry" not in self._reported[pid]:
                self._reported[pid].add("hip_asymmetry")
                f = self._make_finding("hip_asymmetry", conf * 0.6)
                findings.append(f)
                event_log.log(
                    frame_idx, EventType.BIOMECHANICS_ISSUE,
                    player_id=pid,
                    description=f["observation"],
                    severity="warning",
                    confidence=f["confidence"],
                )

        # ── Poor arm swing ──────────────────────────────────────────
        le = pose_data.get("left_elbow_angle")
        re = pose_data.get("right_elbow_angle")
        if le is not None and re is not None and speed > 3.0:
            arm_diff = abs(le - re)
            if arm_diff > 30:
                if "poor_arm_swing" not in self._reported[pid]:
                    self._reported[pid].add("poor_arm_swing")
                    f = self._make_finding("poor_arm_swing", conf * 0.55)
                    findings.append(f)

        # ── Intensity drop / fatigue ────────────────────────────────
        fatigue = player.fatigue_estimate
        if fatigue > 60 and distance > 50:
            if "intensity_drop" not in self._reported[pid]:
                self._reported[pid].add("intensity_drop")
                f = self._make_finding("intensity_drop", 0.6)
                findings.append(f)
                event_log.log(
                    frame_idx, EventType.FATIGUE_WARNING,
                    player_id=pid,
                    description=f"Fatigue estimated at {fatigue:.0f}%",
                    severity="alert",
                    confidence=0.6,
                )

        # ── Limited scanning ────────────────────────────────────────
        head_dir = pose_data.get("head_direction", "forward")
        # We check this over time, so only flag after enough data
        if player.total_visible_frames > 100:
            head_turns = sum(
                1 for p in list(player.pose_history)
                if p and p.get("head_direction") in ("looking_left", "looking_right")
            )
            turn_rate = head_turns / max(1, len(player.pose_history))
            if turn_rate < 0.1:
                if "limited_scanning" not in self._reported[pid]:
                    self._reported[pid].add("limited_scanning")
                    f = self._make_finding("limited_scanning", 0.45)
                    findings.append(f)

        return findings

    def _make_finding(self, key: str, confidence: float) -> Dict[str, Any]:
        drill = DRILL_DATABASE.get(key, {})
        return {
            "key": key,
            "observation": drill.get("observation", key),
            "likely_technical_cause": drill.get("likely_technical_cause", ""),
            "likely_biomechanical_cause": drill.get("likely_biomechanical_cause", ""),
            "potential_impact": drill.get("potential_impact", ""),
            "severity": drill.get("severity", "low"),
            "confidence": round(confidence, 2),
            "corrective_drills": drill.get("corrective_drills", ""),
            "strength_exercises": drill.get("strength_exercises", ""),
            "mobility_exercises": drill.get("mobility_exercises", ""),
            "football_exercises": drill.get("football_exercises", ""),
            "sets_reps": drill.get("sets_reps", ""),
            "frequency": drill.get("frequency", ""),
            "progressions": drill.get("progressions", ""),
            "recovery": drill.get("recovery", ""),
            "injury_prevention": drill.get("injury_prevention", ""),
        }

    def full_assessment(self, player, events: list) -> Dict[str, Any]:
        """
        Generate comprehensive scoring and assessment for report/UI.
        """
        stats = player.get_stats_dict()
        findings = [
            self._make_finding(key, 0.6)
            for key in self._reported.get(player.player_id, set())
        ]

        # ── Component scores ────────────────────────────────────────
        # Technical (ball work + movement quality proxy)
        tech = 60
        tech += min(15, player.ball_touches * 2)
        tech += min(10, player.direction_changes // 3)
        tech = max(0, min(100, tech))

        # Physical (speed, distance, sprints, work rate)
        phys = 50
        phys += min(15, player.sprint_count * 3)
        if player.max_speed > 6:
            phys += 10
        if player.work_rate == "High":
            phys += 10
        elif player.work_rate == "Low":
            phys -= 10
        phys += min(10, int(stats["total_distance_m"] / 20))
        phys = max(0, min(100, phys))

        # Biomechanics (based on issues found)
        bio = 85
        for f in findings:
            sev = f.get("severity", "low")
            if sev == "high":
                bio -= 20
            elif sev == "moderate":
                bio -= 10
            else:
                bio -= 5
        bio = max(0, min(100, bio))

        # Tactical (work rate, scanning, off-ball movement)
        tact = 55
        if player.work_rate == "High":
            tact += 15
        tact += min(10, player.direction_changes // 5)
        if player.ball_touches > 5:
            tact += 5
        tact = max(0, min(100, tact))

        # Overall weighted
        overall = int(
            tech * SCORE_WEIGHTS["technical"]
            + phys * SCORE_WEIGHTS["physical"]
            + bio * SCORE_WEIGHTS["biomechanics"]
            + tact * SCORE_WEIGHTS["tactical"]
        )
        overall = max(0, min(100, overall))

        # Risk level
        risk = "Low"
        for f in findings:
            if f.get("severity") == "high":
                risk = "High"
                break
            elif f.get("severity") == "moderate" and risk != "High":
                risk = "Moderate"

        # Strengths
        strengths = []
        if player.sprint_count > 5:
            strengths.append("Good sprint capacity and explosive ability")
        if player.work_rate == "High":
            strengths.append("High work rate – strong engine")
        if player.direction_changes > 20:
            strengths.append("Agile movement with frequent direction changes")
        if player.ball_touches > 10:
            strengths.append("Active involvement in ball play")
        if bio >= 80:
            strengths.append("Good body mechanics and movement efficiency")
        if not strengths:
            strengths.append("Consistent movement throughout the session")

        # Weaknesses
        weaknesses = [f["observation"] for f in findings]
        if player.fatigue_estimate > 50:
            weaknesses.append(f"Fatigue indicator: {player.fatigue_estimate:.0f}% estimated drop-off")

        return {
            "overall_score": overall,
            "technical_score": tech,
            "physical_score": phys,
            "biomechanics_score": bio,
            "tactical_score": tact,
            "risk_level": risk,
            "fatigue_pct": round(player.fatigue_estimate, 1),
            "strengths": strengths,
            "weaknesses": weaknesses,
            "findings": findings,
            "stats": stats,
        }

    def generate_training_plan(self, findings: List[Dict]) -> str:
        """Generate a text training plan from findings."""
        if not findings:
            return "No specific weaknesses detected. Maintain current training programme with regular progression."

        lines = ["=" * 60]
        lines.append("   PERSONALISED TRAINING PLAN")
        lines.append("   Football AI Pro – Sports Science Recommendations")
        lines.append("=" * 60)

        for i, f in enumerate(findings, 1):
            lines.append(f"\n{'─' * 50}")
            lines.append(f"  Issue {i}: {f.get('observation', 'Unknown')}")
            lines.append(f"  Severity: {f.get('severity', 'N/A').upper()}")
            lines.append(f"  Confidence: {f.get('confidence', 0):.0%}")
            lines.append(f"{'─' * 50}")
            lines.append(f"  Likely cause (technical): {f.get('likely_technical_cause', 'N/A')}")
            lines.append(f"  Likely cause (biomechanical): {f.get('likely_biomechanical_cause', 'N/A')}")
            lines.append(f"  Potential impact: {f.get('potential_impact', 'N/A')}")
            lines.append(f"\n  Corrective drills: {f.get('corrective_drills', 'N/A')}")
            lines.append(f"  Strength work: {f.get('strength_exercises', 'N/A')}")
            lines.append(f"  Mobility work: {f.get('mobility_exercises', 'N/A')}")
            lines.append(f"  Football-specific: {f.get('football_exercises', 'N/A')}")
            lines.append(f"  Volume: {f.get('sets_reps', 'N/A')}")
            lines.append(f"  Frequency: {f.get('frequency', 'N/A')}")
            lines.append(f"  Progressions: {f.get('progressions', 'N/A')}")
            lines.append(f"  Recovery: {f.get('recovery', 'N/A')}")
            lines.append(f"  Injury prevention: {f.get('injury_prevention', 'N/A')}")

        lines.append(f"\n{'=' * 60}")
        lines.append("  Generated by Football AI Pro Sports Science Engine")
        lines.append("  Recommendations should be reviewed by a qualified coach.")
        lines.append(f"{'=' * 60}")
        return "\n".join(lines)
