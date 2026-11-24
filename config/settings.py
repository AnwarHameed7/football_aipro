"""
Football AI Pro - Central Configuration
All tuneable parameters live here. No magic numbers in business logic.
"""

import os

# ── Paths ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DETECT_WEIGHTS_PATH = os.path.join(BASE_DIR, "yolo11n.pt")
YOLO_DETECT_WEIGHTS = DETECT_WEIGHTS_PATH if os.path.isfile(DETECT_WEIGHTS_PATH) else "yolo11n.pt"
YOLO_POSE_WEIGHTS = "yolo11n-pose.pt"  # downloaded on first use by ultralytics

# ── Detection ──────────────────────────────────────────────────────────
DETECT_CONF = 0.30
DETECT_IOU = 0.45
DETECT_IMGSZ = 640
DETECT_CLASSES = [0]  # COCO person class

# ── Tracker ────────────────────────────────────────────────────────────
# Use ultralytics built-in tracker configs (not a file path).
# "botsort.yaml" is more stable than "bytetrack.yaml" for sports.
# If BoTSORT fails on your ultralytics version, change to "bytetrack.yaml".
TRACKER_CONFIG = "botsort.yaml"
TRACK_HISTORY_LEN = 600          # frames of position history per player
REID_MATCH_THRESHOLD = 0.45      # appearance threshold for re-identification
REID_SPATIAL_THRESHOLD = 120     # pixels – new ID within this range of a recent player = same person
REID_HISTOGRAM_BINS = (50, 60)   # H,S bins for colour histogram
REID_LOST_TIMEOUT = 300          # frames before a lost track is retired
REID_STALE_FRAMES = 8            # frames without update before checking spatial merge
KALMAN_PROCESS_NOISE = 1e-2
KALMAN_MEASUREMENT_NOISE = 1e-1

# ── Pose ───────────────────────────────────────────────────────────────
POSE_EVERY_N_FRAMES = 2          # run pose estimation every N frames
POSE_CONF = 0.30
POSE_MIN_KEYPOINTS = 11          # minimum visible keypoints for analysis

# COCO keypoint indices
KP_NOSE = 0
KP_LEFT_EYE = 1
KP_RIGHT_EYE = 2
KP_LEFT_EAR = 3
KP_RIGHT_EAR = 4
KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW = 7
KP_RIGHT_ELBOW = 8
KP_LEFT_WRIST = 9
KP_RIGHT_WRIST = 10
KP_LEFT_HIP = 11
KP_RIGHT_HIP = 12
KP_LEFT_KNEE = 13
KP_RIGHT_KNEE = 14
KP_LEFT_ANKLE = 15
KP_RIGHT_ANKLE = 16

POSE_SKELETON = [
    (KP_LEFT_SHOULDER, KP_RIGHT_SHOULDER),
    (KP_LEFT_SHOULDER, KP_LEFT_ELBOW),
    (KP_LEFT_ELBOW, KP_LEFT_WRIST),
    (KP_RIGHT_SHOULDER, KP_RIGHT_ELBOW),
    (KP_RIGHT_ELBOW, KP_RIGHT_WRIST),
    (KP_LEFT_SHOULDER, KP_LEFT_HIP),
    (KP_RIGHT_SHOULDER, KP_RIGHT_HIP),
    (KP_LEFT_HIP, KP_RIGHT_HIP),
    (KP_LEFT_HIP, KP_LEFT_KNEE),
    (KP_LEFT_KNEE, KP_LEFT_ANKLE),
    (KP_RIGHT_HIP, KP_RIGHT_KNEE),
    (KP_RIGHT_KNEE, KP_RIGHT_ANKLE),
    (KP_NOSE, KP_LEFT_SHOULDER),
    (KP_NOSE, KP_RIGHT_SHOULDER),
]

# ── Ball Detection ─────────────────────────────────────────────────────
BALL_HSV_LOW = (0, 0, 200)
BALL_HSV_HIGH = (180, 50, 255)
BALL_MIN_AREA = 30
BALL_MIN_RADIUS = 3
BALL_MAX_RADIUS = 40
BALL_PROXIMITY_PX = 60  # pixels to count as "near" ball

# ── Analysis ───────────────────────────────────────────────────────────
# Pixel-to-metre calibration (approximate, user can override)
DEFAULT_PIXELS_PER_METRE = 12.0
SPRINT_SPEED_THRESHOLD = 5.5     # m/s (~20 km/h)
HIGH_INTENSITY_THRESHOLD = 4.0   # m/s (~14.4 km/h)
JOG_SPEED_THRESHOLD = 2.0        # m/s (~7.2 km/h)
WALKING_SPEED_THRESHOLD = 0.8    # m/s

ACCELERATION_WINDOW = 5          # frames for acceleration calculation
DIRECTION_CHANGE_ANGLE = 45      # degrees threshold

# ── Biomechanics ───────────────────────────────────────────────────────
STRIDE_SMOOTHING_WINDOW = 5
BALANCE_SYMMETRY_TOLERANCE = 15  # degrees
KNEE_FLEXION_HEALTHY_RANGE = (130, 170)
HIP_FLEXION_HEALTHY_RANGE = (140, 180)

# ── Sports Science ─────────────────────────────────────────────────────
FATIGUE_SPEED_DROP_PERCENT = 25  # % drop from peak = fatigue indicator
INJURY_RISK_ASYMMETRY = 20       # degrees asymmetry = elevated risk

# ── Heatmap ────────────────────────────────────────────────────────────
HEATMAP_RADIUS = 25
HEATMAP_ALPHA = 0.40

# ── Visualization ──────────────────────────────────────────────────────
TRAIL_LENGTH = 40
TRAIL_MAX_THICKNESS = 4
VIZ_COLORS = {
    "trail": (0, 255, 255),
    "pose": (0, 220, 100),
    "ball": (0, 0, 255),
    "bbox_selected": (0, 255, 0),
    "bbox_other": (180, 180, 180),
    "sprint": (0, 140, 255),
    "text_bg": (20, 20, 20),
    "text": (220, 220, 220),
}

# ── UI ─────────────────────────────────────────────────────────────────
APP_TITLE = "Football AI Pro"
APP_SUBTITLE = "Professional AI Football Performance Analysis"
MAX_UPLOAD_MB = 500
VIDEO_EXTENSIONS = ["mp4", "avi", "mov", "mkv", "webm"]

# ── Report ─────────────────────────────────────────────────────────────
REPORT_TITLE = "Football AI Pro – Performance Report"
SCORE_WEIGHTS = {
    "technical": 0.25,
    "physical": 0.25,
    "biomechanics": 0.25,
    "tactical": 0.25,
}
