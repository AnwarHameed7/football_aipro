"""Draw frame-specific coaching markup in source image coordinates."""

import math

import cv2
import numpy as np


POINT_COUNTS = {"Line": 2, "Arrow": 2, "Angle": 3}


def screen_angle(points):
    first, vertex, last = (np.asarray(point, dtype=float) for point in points)
    a, b = first - vertex, last - vertex
    if not a.any() or not b.any():
        return None
    return math.degrees(math.atan2(abs(a[0] * b[1] - a[1] * b[0]), a @ b))


def draw_marks(frame, marks):
    if not marks:
        return frame
    output = frame.copy()
    h, w = frame.shape[:2]
    colour = (91, 223, 255)
    thickness = max(2, round(min(w, h) / 320))
    for mark in marks:
        points = [(round(x * (w - 1)), round(y * (h - 1))) for x, y in mark["points"]]
        for point in points:
            cv2.circle(output, point, thickness * 2, colour, -1, cv2.LINE_AA)
        if len(points) < 2:
            continue
        if mark["tool"] == "Arrow":
            cv2.arrowedLine(output, *points, colour, thickness, cv2.LINE_AA, tipLength=.18)
            continue
        for a, b in zip(points, points[1:]):
            cv2.line(output, a, b, colour, thickness, cv2.LINE_AA)
        if len(points) == 3 and (angle := screen_angle(points)) is not None:
            x, y = points[1]
            scale = max(.5, min(w, h) / 700)
            label = f"{angle:.1f} deg"
            width = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)[0][0]
            xy = (max(0, min(x + 8, w - width)), max(18, y - 8))
            cv2.putText(output, label, xy, cv2.FONT_HERSHEY_SIMPLEX, scale,
                        (20, 20, 20), thickness + 3, cv2.LINE_AA)
            cv2.putText(output, label, xy, cv2.FONT_HERSHEY_SIMPLEX, scale,
                        colour, thickness, cv2.LINE_AA)
    return output
