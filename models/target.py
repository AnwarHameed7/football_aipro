"""Clip-local identification from a manually selected player."""
import cv2
import numpy as np


def kit_signature(frame, box):
    """Two HSV histograms sampled below the head, inside the player's box."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1, x2 = max(0, int(x1 + .22 * bw)), min(w, int(x1 + .78 * bw))
    regions = []
    for top, bottom in ((.25, .46), (.55, .72)):
        patch = frame[max(0, int(y1 + top * bh)):min(h, int(y1 + bottom * bh)), x1:x2]
        if min(patch.shape[:2]) < 4:
            return None
        hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
        # Low saturation collapses hue into a single bin for neutral kit.
        hsv[:, :, 0][hsv[:, :, 1] < 40] = 0
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [12, 4, 4], [0, 180, 0, 256, 0, 256])
        regions.append(cv2.normalize(hist, None, norm_type=cv2.NORM_L1))
    return regions, bw / bh


class TargetTrack:
    def __init__(self, frame_index, point):
        self.anchor_frame = frame_index
        self.point = point
        self.signature = None
        self.last_id = None
        self.last_frame = -1
        self.pending_id = None
        self.pending_frames = 0
        self.status = "before selection"

    def select(self, frame, frame_index, candidates):
        """Return a candidate index only when the target match is usable."""
        if frame_index < self.anchor_frame:
            return None

        if self.signature is None:
            x, y = self.point
            hits = [
                i for i, (_, (x1, y1, x2, y2)) in enumerate(candidates)
                if x1 <= x <= x2 and y1 <= y <= y2
            ]
            if frame_index != self.anchor_frame or len(hits) != 1:
                raise ValueError("Player selection was unclear. Pause on a clear frame and click inside only your player.")
            index = hits[0]
            self.signature = kit_signature(frame, candidates[index][1])
            if self.signature is None:
                raise ValueError("Player is too small or clipped. Select a clearer frame.")
            return self._accept(index, candidates, frame_index)

        scores = []
        for index, (track_id, box) in enumerate(candidates):
            signature = kit_signature(frame, box)
            if signature is None:
                continue
            histograms, shape = signature
            reference, ref_shape = self.signature
            kit_distance = sum(
                cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA)
                for a, b in zip(histograms, reference)
            ) / 2
            shape_distance = min(abs(shape - ref_shape), .5)
            scores.append((kit_distance + .15 * shape_distance, index, track_id))

        scores.sort()
        if not scores or scores[0][0] > .56:
            self._reset_pending("not visible or appearance uncertain")
            return None

        score, index, track_id = scores[0]
        margin = scores[1][0] - score if len(scores) > 1 else 1.0
        continuous = frame_index == self.last_frame + 1 and track_id == self.last_id
        if continuous and margin >= .04:
            return self._accept(index, candidates, frame_index)
        if score > .43 or margin < .10:
            self._reset_pending("identity uncertain")
            return None

        if track_id != self.pending_id:
            self.pending_id = track_id
            self.pending_frames = 0
        self.pending_frames += 1
        if self.pending_frames >= 3:
            return self._accept(index, candidates, frame_index)
        self.status = "confirming re-entry"
        return None

    def _reset_pending(self, status):
        self.pending_id = None
        self.pending_frames = 0
        self.status = status

    def _accept(self, index, candidates, frame_index):
        self.last_id = candidates[index][0]
        self.last_frame = frame_index
        self._reset_pending("visible")
        return index
