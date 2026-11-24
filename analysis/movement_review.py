"""Summarize observable 2D mechanics and preserve gaps in coverage."""
from collections import Counter
from statistics import median


MEASURES = {
    "trunk_lean_deg": "Trunk angle from image vertical",
    "left_knee_angle": "Left knee angle",
    "right_knee_angle": "Right knee angle",
    "left_hip_angle": "Left hip angle",
    "right_hip_angle": "Right hip angle",
    "left_elbow_angle": "Left elbow angle",
    "right_elbow_angle": "Right elbow angle",
    "left_shoulder_angle": "Left upper arm angle relative to torso",
    "right_shoulder_angle": "Right upper arm angle relative to torso",
}

STRIDE_METRIC = "ankle_separation_torso_ratio"

SOURCES = {
    "World Athletics Sprinting Biomechanics Study": "https://worldathletics.org/about-iaaf/documents/research-centre",
    "Schache et al., running and sprinting mechanics": "https://doi.org/10.1249/MSS.0b013e3182084929",
}


class MovementReview:
    def __init__(self, fps):
        self.fps = fps
        self.spans = []
        self.active = None

    def record(self, frame_index, status, pose):
        bucket = int(frame_index / self.fps / 2)
        if self.active is None or (bucket, status) != self.active[:2]:
            self._finish()
            self.active = (bucket, status, frame_index, [])
        sample = {}
        if pose and pose["confidence"] >= .55:
            sample = {key: float(pose[key]) for key in (*MEASURES, STRIDE_METRIC) if pose.get(key) is not None}
        self.active[3].append(sample)

    def _finish(self):
        if self.active is None:
            return
        _, status, start, frames = self.active
        measures = {}
        for key, label in MEASURES.items():
            values = [pose[key] for pose in frames if pose.get(key) is not None]
            if len(values) >= 3:
                measures[key] = {
                    "label": label, "samples": len(values), "min_deg": round(min(values), 1),
                    "max_deg": round(max(values), 1), "median_deg": round(median(values), 1),
                }

        stride = [pose[STRIDE_METRIC] for pose in frames if STRIDE_METRIC in pose]
        if len(stride) >= 3:
            measures[STRIDE_METRIC] = {
                "label": "Projected ankle separation relative to torso length",
                "samples": len(stride), "min_ratio": round(min(stride), 2),
                "max_ratio": round(max(stride), 2), "median_ratio": round(median(stride), 2),
            }

        cues = []
        if status == "visible":
            trunk = measures.get("trunk_lean_deg")
            if trunk and trunk["median_deg"] >= 25:
                cues.append("Review the sustained trunk angle in this segment. Forward lean can fit acceleration. If this was upright running, compare with a side-view repetition at the same pace and try staying tall through the hips.")
            for joint in ("knee", "elbow"):
                left_key, right_key = f"left_{joint}_angle", f"right_{joint}_angle"
                pairs = [(pose[left_key], pose[right_key]) for pose in frames
                         if left_key in pose and right_key in pose]
                if len(pairs) < 6:
                    continue
                left, right = zip(*pairs)
                left_range = max(left) - min(left)
                right_range = max(right) - min(right)
                if abs(left_range - right_range) >= 25:
                    cues.append(
                        f"The sampled {joint} angle ranged farther on one side. "
                        "Compare several complete strides at the same pace, filmed from each side, "
                        "to check if the difference repeats."
                    )
            if not measures:
                cues.append("Too few clear pose samples for a mechanics cue.")
        self.spans.append({
            "start_s": round(start / self.fps, 3),
            "end_s": round((start + len(frames)) / self.fps, 3),
            "status": status, "frames": len(frames),
            "pose_samples": sum(bool(pose) for pose in frames),
            "measurements": measures, "review_cues": cues,
        })
        self.active = None

    def report(self):
        self._finish()
        return {"fps": self.fps, "spans": self.spans, "references": SOURCES}


def format_review(report):
    spans = report["spans"]
    total = sum(span["frames"] for span in spans)
    counts = Counter()
    for span in spans:
        counts[span["status"]] += span["frames"]
    visible = counts["visible"]
    samples = sum(span["pose_samples"] for span in spans)
    lines = [
        f"Coverage: {visible}/{total} frames matched · {samples} usable pose samples",
        "Angles and ankle separation are 2D projections. Compare repetitions filmed from the same angle and at similar speed.",
        "Review cues are for coaching. Clinical assessment and injury risk require additional evidence.",
        "",
    ]
    for span in spans:
        lines.append(f'{span["start_s"]:.2f}–{span["end_s"]:.2f}s  {span["status"].capitalize()}')
        for metric in span["measurements"].values():
            unit = "°" if "min_deg" in metric else "× torso"
            suffix = "deg" if "min_deg" in metric else "ratio"
            low, high, middle = (metric[f"{key}_{suffix}"] for key in ("min", "max", "median"))
            lines.append(f'  {metric["label"]}: {low:g}–{high:g}{unit} (median {middle:g}{unit})')
        lines.extend(f"  {cue}" for cue in span["review_cues"])
        lines.append("")
    return "\n".join(lines)
