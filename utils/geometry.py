"""
Football AI Pro - Geometry Utilities
Reusable math for angles, distances, velocities used by every analyser.
"""

import math
import numpy as np
from typing import Tuple, List, Optional


def distance_2d(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Euclidean distance between two 2-D points."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def midpoint(a: Tuple[float, float], b: Tuple[float, float]) -> Tuple[float, float]:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def angle_between_points(
    a: np.ndarray, b: np.ndarray, c: np.ndarray
) -> float:
    """
    Angle at vertex *b* formed by rays b→a and b→c.
    Returns degrees in [0, 180].
    """
    ba = a - b
    bc = c - b
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_angle)))


def angle_to_vertical(a: np.ndarray, b: np.ndarray) -> float:
    """Angle (degrees) of vector a→b relative to straight-up vertical."""
    dx = b[0] - a[0]
    dy = b[1] - a[1]  # positive = downward in image coords
    # vertical is (0, 1) in image coords (downward)
    angle = math.degrees(math.atan2(abs(dx), abs(dy)))
    return angle


def direction_angle(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Bearing in degrees [0, 360) from a to b, 0 = up."""
    dx = b[0] - a[0]
    dy = -(b[1] - a[1])  # flip y so up is positive
    return math.degrees(math.atan2(dx, dy)) % 360


def angle_difference(a1: float, a2: float) -> float:
    """Smallest angular difference between two bearings in degrees."""
    d = abs(a1 - a2) % 360
    return d if d <= 180 else 360 - d


def velocity_from_positions(
    positions: List[Tuple[float, float]],
    window: int = 3,
    fps: float = 30.0,
    px_per_m: float = 12.0,
) -> float:
    """
    Instantaneous speed (m/s) from last *window* positions, accounting
    for frame rate and pixel calibration.
    """
    if len(positions) < 2:
        return 0.0
    pts = positions[-window:]
    total_px = sum(distance_2d(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    dt = (len(pts) - 1) / fps
    if dt == 0:
        return 0.0
    return (total_px / px_per_m) / dt


def acceleration_from_speeds(
    speeds: List[float], fps: float = 30.0
) -> float:
    """Acceleration (m/s²) from last two speed samples."""
    if len(speeds) < 2:
        return 0.0
    return (speeds[-1] - speeds[-2]) * fps


def smoothed_value(values: List[float], window: int = 5) -> float:
    """Simple moving-average smoothing."""
    if not values:
        return 0.0
    w = values[-window:]
    return sum(w) / len(w)


def bbox_center(bbox: List[int]) -> Tuple[int, int]:
    """Centre of an [x1, y1, x2, y2] bounding box."""
    return ((bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2)


def bbox_area(bbox: List[int]) -> int:
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def bbox_iou(a: List[int], b: List[int]) -> float:
    """Intersection-over-union of two bounding boxes."""
    xi1 = max(a[0], b[0])
    yi1 = max(a[1], b[1])
    xi2 = min(a[2], b[2])
    yi2 = min(a[3], b[3])
    inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    a_area = bbox_area(a)
    b_area = bbox_area(b)
    union = a_area + b_area - inter
    return inter / union if union > 0 else 0.0


def point_in_bbox(px: int, py: int, bbox: List[int], margin: int = 0) -> bool:
    return (
        bbox[0] - margin <= px <= bbox[2] + margin
        and bbox[1] - margin <= py <= bbox[3] + margin
    )
