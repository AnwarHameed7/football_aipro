"""
Football AI Pro - Chart Generators
Creates OpenCV-based charts for the UI dashboard.
These are lightweight numpy images that can be displayed in Streamlit
without needing matplotlib.
"""

import cv2
import numpy as np
from typing import List, Dict, Tuple, Optional


def create_speed_graph(
    speed_history: List[float],
    width: int = 400,
    height: int = 160,
    colour: Tuple[int, int, int] = (0, 220, 100),
    bg_colour: Tuple[int, int, int] = (15, 15, 20),
    sprint_threshold: float = 5.5,
) -> np.ndarray:
    """Line graph of speed over time with sprint zones highlighted."""
    img = np.full((height, width, 3), bg_colour, dtype=np.uint8)

    if len(speed_history) < 2:
        cv2.putText(img, "Collecting data...", (10, height // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 100), 1)
        return img

    # Grid lines
    for y_frac in [0.25, 0.5, 0.75]:
        y = int(height * y_frac)
        cv2.line(img, (0, y), (width, y), (40, 40, 40), 1)

    max_speed = max(max(speed_history), sprint_threshold * 1.1, 1.0)
    data = speed_history[-width:]

    # Sprint zone highlight
    sprint_y = height - int(sprint_threshold / max_speed * (height - 20)) - 10
    if 0 < sprint_y < height:
        overlay = img.copy()
        cv2.rectangle(overlay, (0, 0), (width, sprint_y), (0, 30, 60), -1)
        img = cv2.addWeighted(overlay, 0.3, img, 0.7, 0)
        cv2.putText(img, "Sprint", (width - 50, sprint_y + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (0, 140, 255), 1)

    # Draw the line
    points = []
    for i, v in enumerate(data):
        x = int(i * width / max(len(data) - 1, 1))
        y = height - int(v / max_speed * (height - 20)) - 10
        y = max(5, min(height - 5, y))
        points.append((x, y))

    for i in range(1, len(points)):
        cv2.line(img, points[i - 1], points[i], colour, 2, cv2.LINE_AA)

    # Labels
    cv2.putText(img, f"{max_speed:.1f} m/s", (5, 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (120, 120, 120), 1)
    cv2.putText(img, "Speed", (width // 2 - 15, height - 3),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (120, 120, 120), 1)

    return img


def create_acceleration_graph(
    acc_history: List[float],
    width: int = 400,
    height: int = 120,
) -> np.ndarray:
    """Acceleration graph with positive (green) and negative (red) zones."""
    img = np.full((height, width, 3), (15, 15, 20), dtype=np.uint8)

    if len(acc_history) < 2:
        return img

    data = acc_history[-width:]
    max_abs = max(abs(max(data)), abs(min(data)), 0.1)
    mid_y = height // 2

    # Zero line
    cv2.line(img, (0, mid_y), (width, mid_y), (60, 60, 60), 1)

    for i, v in enumerate(data):
        x = int(i * width / max(len(data) - 1, 1))
        bar_h = int(abs(v) / max_abs * (height // 2 - 5))
        if v >= 0:
            cv2.line(img, (x, mid_y), (x, mid_y - bar_h), (0, 180, 80), 1)
        else:
            cv2.line(img, (x, mid_y), (x, mid_y + bar_h), (0, 60, 200), 1)

    cv2.putText(img, "Accel", (5, 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (100, 100, 100), 1)
    cv2.putText(img, "Decel", (5, height - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (100, 100, 100), 1)

    return img


def create_distance_bar(
    distance: float,
    max_distance: float = 500.0,
    width: int = 300,
    height: int = 30,
) -> np.ndarray:
    """Horizontal progress bar for distance covered."""
    img = np.full((height, width, 3), (30, 30, 35), dtype=np.uint8)
    fill = min(width - 4, int((distance / max(max_distance, 1)) * (width - 4)))
    fill = max(0, fill)

    # Gradient fill
    for x in range(2, fill + 2):
        ratio = x / max(width, 1)
        g = int(180 + 75 * ratio)
        b = int(100 * (1 - ratio))
        cv2.line(img, (x, 2), (x, height - 2), (b, g, 40), 1)

    cv2.putText(img, f"{distance:.0f}m", (fill + 8, height - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 180, 180), 1)

    return img


def create_zone_pie(
    zone_pct: Dict[str, float],
    size: int = 180,
) -> np.ndarray:
    """Simple pie chart of speed zones."""
    img = np.full((size, size, 3), (15, 15, 20), dtype=np.uint8)
    centre = (size // 2, size // 2)
    radius = size // 2 - 15

    colours = {
        "sprint": (0, 140, 255),
        "high_intensity": (0, 200, 200),
        "jog": (0, 200, 100),
        "walk": (200, 200, 100),
        "stationary": (100, 100, 100),
    }

    start_angle = 0
    for zone, pct in zone_pct.items():
        if pct <= 0:
            continue
        end_angle = start_angle + int(pct * 3.6)
        c = colours.get(zone, (150, 150, 150))
        cv2.ellipse(img, centre, (radius, radius), 0, start_angle, end_angle, c, -1)
        start_angle = end_angle

    # Centre hole for donut effect
    cv2.circle(img, centre, radius // 2, (15, 15, 20), -1)

    return img


def create_score_gauge(
    score: int,
    label: str = "Score",
    size: int = 120,
) -> np.ndarray:
    """Semi-circular gauge for a 0-100 score."""
    img = np.full((size, size, 3), (15, 15, 20), dtype=np.uint8)
    centre = (size // 2, size - 15)
    radius = size // 2 - 10

    # Background arc
    cv2.ellipse(img, centre, (radius, radius), 0, 180, 360, (40, 40, 50), 4)

    # Colour based on score
    if score >= 75:
        colour = (0, 200, 100)
    elif score >= 50:
        colour = (0, 200, 200)
    elif score >= 25:
        colour = (0, 140, 255)
    else:
        colour = (0, 60, 220)

    # Score arc
    end_angle = 180 + int(score / 100 * 180)
    cv2.ellipse(img, centre, (radius, radius), 0, 180, end_angle, colour, 6)

    # Text
    cv2.putText(img, str(score), (size // 2 - 15, size - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (220, 220, 220), 2)
    cv2.putText(img, label, (size // 2 - len(label) * 4, size - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.3, (140, 140, 140), 1)

    return img
