"""
Football AI Pro - Frame Overlay Renderer
Draws bounding boxes, trails, pose skeletons, ball markers, and
informational labels onto video frames.

Design principle: overlays are subtle and professional – no coaching
text above players, all feedback goes to the dashboard.
"""

import cv2
import numpy as np
from typing import List, Tuple, Optional

from config.settings import (
    POSE_SKELETON,
    VIZ_COLORS,
    TRAIL_LENGTH,
    TRAIL_MAX_THICKNESS,
)


class FrameRenderer:
    """Draws all visual overlays onto annotated frames."""

    def draw_bbox(
        self,
        frame: np.ndarray,
        bbox: List[int],
        player=None,
        selected: bool = False,
    ) -> np.ndarray:
        """Draw a bounding box with player ID label."""
        x1, y1, x2, y2 = bbox
        colour = VIZ_COLORS["bbox_selected"] if selected else VIZ_COLORS["bbox_other"]
        thickness = 2 if selected else 1

        cv2.rectangle(frame, (x1, y1), (x2, y2), colour, thickness)

        if player is not None:
            label = player.display_name
            if player.jersey_number is not None:
                label = f"#{player.jersey_number} {label}"

            # Background for label
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), colour, -1)
            cv2.putText(
                frame, label, (x1 + 2, y1 - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA,
            )

            # Speed indicator for selected player
            if selected and hasattr(player, "current_speed"):
                spd = f"{player.current_speed:.1f} m/s"
                cv2.putText(
                    frame, spd, (x1, y2 + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, colour, 1, cv2.LINE_AA,
                )
        return frame

    def draw_trail(
        self,
        frame: np.ndarray,
        points: List[Tuple[int, int]],
        colour: Tuple[int, int, int] = VIZ_COLORS["trail"],
        max_length: int = TRAIL_LENGTH,
    ) -> np.ndarray:
        """Draw a fading movement trail."""
        pts = points[-max_length:]
        if len(pts) < 2:
            return frame

        for i in range(1, len(pts)):
            alpha = i / len(pts)
            t = max(1, int(TRAIL_MAX_THICKNESS * alpha))
            c = tuple(int(ch * alpha) for ch in colour)
            cv2.line(frame, pts[i - 1], pts[i], c, t, cv2.LINE_AA)
        return frame

    def draw_pose(
        self,
        frame: np.ndarray,
        keypoints: np.ndarray,
        colour: Tuple[int, int, int] = VIZ_COLORS["pose"],
    ) -> np.ndarray:
        """Draw pose skeleton on frame."""
        if keypoints is None:
            return frame

        # Draw joints
        for pt in keypoints:
            x, y = int(pt[0]), int(pt[1])
            if x > 0 and y > 0:
                cv2.circle(frame, (x, y), 3, colour, -1, cv2.LINE_AA)

        # Draw bones
        for a_idx, b_idx in POSE_SKELETON:
            if a_idx < len(keypoints) and b_idx < len(keypoints):
                ax, ay = int(keypoints[a_idx][0]), int(keypoints[a_idx][1])
                bx, by = int(keypoints[b_idx][0]), int(keypoints[b_idx][1])
                if ax > 0 and ay > 0 and bx > 0 and by > 0:
                    cv2.line(frame, (ax, ay), (bx, by), colour, 2, cv2.LINE_AA)
        return frame

    def draw_ball(
        self,
        frame: np.ndarray,
        position: Tuple[int, int],
        colour: Tuple[int, int, int] = VIZ_COLORS["ball"],
    ) -> np.ndarray:
        """Draw ball marker."""
        cx, cy = position
        cv2.circle(frame, (cx, cy), 8, colour, -1, cv2.LINE_AA)
        cv2.circle(frame, (cx, cy), 12, colour, 2, cv2.LINE_AA)
        return frame

    def draw_bottom_bar(
        self,
        frame: np.ndarray,
        text: str,
        bar_height: int = 40,
    ) -> np.ndarray:
        """Draw a subtitle-style info bar at the bottom."""
        h, w = frame.shape[:2]
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, h - bar_height), (w, h), VIZ_COLORS["text_bg"], -1)
        frame = cv2.addWeighted(overlay, 0.7, frame, 0.3, 0)
        cv2.putText(
            frame, text[:120], (10, h - 12),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, VIZ_COLORS["text"], 1, cv2.LINE_AA,
        )
        return frame
