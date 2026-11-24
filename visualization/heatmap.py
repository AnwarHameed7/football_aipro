"""
Football AI Pro - Heatmap Generator
Generates per-player and global positional heatmaps for overlay and export.
"""

import cv2
import numpy as np
from typing import Optional, Dict, Tuple

from config.settings import HEATMAP_RADIUS, HEATMAP_ALPHA


class HeatmapGenerator:
    """Accumulates position data and renders heatmap overlays."""

    def __init__(self):
        self._global: Optional[np.ndarray] = None
        self._per_player: Dict[int, np.ndarray] = {}
        self._shape: Optional[Tuple[int, int]] = None

    def initialize(self, frame_shape: Tuple[int, int]):
        """Call once with (height, width) before adding points."""
        h, w = frame_shape[:2]
        self._shape = (h, w)
        self._global = np.zeros((h, w), dtype=np.float32)

    def add_point(self, x: int, y: int, player_id: Optional[int] = None):
        """Accumulate a position into the heatmap."""
        if self._global is None or self._shape is None:
            return

        h, w = self._shape
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(self._global, (x, y), HEATMAP_RADIUS, 1, -1)

            if player_id is not None:
                if player_id not in self._per_player:
                    self._per_player[player_id] = np.zeros((h, w), dtype=np.float32)
                cv2.circle(self._per_player[player_id], (x, y), HEATMAP_RADIUS, 1, -1)

    def overlay(
        self,
        frame: np.ndarray,
        player_id: Optional[int] = None,
        alpha: float = HEATMAP_ALPHA,
    ) -> np.ndarray:
        """
        Return frame with heatmap overlaid.
        If player_id is given, use that player's heatmap; otherwise global.
        """
        if player_id is not None and player_id in self._per_player:
            heat_data = self._per_player[player_id]
        elif self._global is not None:
            heat_data = self._global
        else:
            return frame

        if heat_data.max() == 0:
            return frame

        normalised = cv2.normalize(heat_data, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        colour_map = cv2.applyColorMap(normalised, cv2.COLORMAP_JET)

        # Mask out zero regions so they don't tint the whole frame blue
        mask = (normalised > 5).astype(np.uint8)
        mask_3ch = cv2.merge([mask, mask, mask])

        blended = frame.copy()
        blended = np.where(
            mask_3ch > 0,
            cv2.addWeighted(frame, 1 - alpha, colour_map, alpha, 0),
            frame,
        )
        return blended

    def get_heatmap_image(
        self,
        player_id: Optional[int] = None,
        width: int = 400,
        height: int = 300,
    ) -> np.ndarray:
        """Return a standalone heatmap image (for charts / export)."""
        if player_id is not None and player_id in self._per_player:
            data = self._per_player[player_id]
        elif self._global is not None:
            data = self._global
        else:
            return np.zeros((height, width, 3), dtype=np.uint8)

        if data.max() == 0:
            return np.zeros((height, width, 3), dtype=np.uint8)

        normalised = cv2.normalize(data, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        colour_map = cv2.applyColorMap(normalised, cv2.COLORMAP_JET)
        resized = cv2.resize(colour_map, (width, height))
        return resized
