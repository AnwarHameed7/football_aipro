"""
Football AI Pro - Ball Detection & Possession
Multi-method ball detection using colour filtering, contour analysis,
and temporal smoothing.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List
from collections import deque

from config.settings import (
    BALL_HSV_LOW,
    BALL_HSV_HIGH,
    BALL_MIN_AREA,
    BALL_MIN_RADIUS,
    BALL_MAX_RADIUS,
    BALL_PROXIMITY_PX,
)
from utils.geometry import point_in_bbox


class BallDetector:
    """
    Detects the football using HSV colour thresholding with morphological
    filtering and contour analysis.  Maintains a short history for
    temporal consistency.
    """

    def __init__(self):
        self.last_position: Optional[Tuple[int, int]] = None
        self.position_history: deque = deque(maxlen=30)
        self.frames_since_seen: int = 0
        self.possession_player_id: Optional[int] = None

    def detect(self, frame: np.ndarray) -> Optional[Tuple[int, int]]:
        """
        Attempt to locate the ball in the frame.
        Returns (x, y) centre or None if not found.
        """
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Primary mask – bright white regions
        mask = cv2.inRange(
            hsv,
            np.array(BALL_HSV_LOW, dtype=np.uint8),
            np.array(BALL_HSV_HIGH, dtype=np.uint8),
        )

        # Morphology to remove noise
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.erode(mask, kernel, iterations=2)
        mask = cv2.dilate(mask, kernel, iterations=3)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best_candidate = None
        best_score = 0.0

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < BALL_MIN_AREA:
                continue

            (cx, cy), radius = cv2.minEnclosingCircle(cnt)
            if radius < BALL_MIN_RADIUS or radius > BALL_MAX_RADIUS:
                continue

            # Circularity check (ball should be roughly round)
            perimeter = cv2.arcLength(cnt, True)
            if perimeter == 0:
                continue
            circularity = 4 * np.pi * area / (perimeter * perimeter)
            if circularity < 0.4:
                continue

            # Score: prefer rounder, appropriately-sized detections
            # Also prefer proximity to last known position
            score = circularity * 10 + area * 0.01
            if self.last_position is not None:
                dist = np.hypot(cx - self.last_position[0], cy - self.last_position[1])
                # Bonus for being near last position (temporal consistency)
                if dist < 100:
                    score += (100 - dist) * 0.5

            if score > best_score:
                best_score = score
                best_candidate = (int(cx), int(cy))

        if best_candidate is not None:
            self.last_position = best_candidate
            self.position_history.append(best_candidate)
            self.frames_since_seen = 0
        else:
            self.frames_since_seen += 1
            # Keep last position valid for a few frames
            if self.frames_since_seen > 10:
                self.last_position = None

        return best_candidate

    def is_near_player(self, bbox: List[int], margin: int = BALL_PROXIMITY_PX) -> bool:
        """Check if the ball is near a player bounding box."""
        if self.last_position is None:
            return False
        return point_in_bbox(
            self.last_position[0], self.last_position[1], bbox, margin=margin
        )

    def get_smoothed_position(self) -> Optional[Tuple[int, int]]:
        """Return temporally-smoothed ball position."""
        if len(self.position_history) < 2:
            return self.last_position
        recent = list(self.position_history)[-5:]
        avg_x = int(sum(p[0] for p in recent) / len(recent))
        avg_y = int(sum(p[1] for p in recent) / len(recent))
        return (avg_x, avg_y)
