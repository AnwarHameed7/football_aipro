"""
Football AI Pro - Analysis Pipeline
Orchestrates detection → tracking → analysis → visualisation for each frame.
"""

import cv2
import numpy as np
from typing import Optional, Dict, Any, List, Tuple
from ultralytics import YOLO

from config.settings import (
    YOLO_DETECT_WEIGHTS,
    YOLO_POSE_WEIGHTS,
    DETECT_CONF,
    DETECT_IOU,
    DETECT_IMGSZ,
    DETECT_CLASSES,
    TRACKER_CONFIG,
    POSE_EVERY_N_FRAMES,
    DEFAULT_PIXELS_PER_METRE,
    REID_LOST_TIMEOUT,
)
from models.player import PlayerProfile, PlayerRegistry
from models.events import EventLog, EventType
from analysis.ball import BallDetector
from analysis.biomechanics import BiomechanicsAnalyzer
from analysis.football_iq import FootballAnalyzer
from analysis.sports_science import SportsScienceEngine
from visualization.heatmap import HeatmapGenerator
from visualization.overlays import FrameRenderer


class AnalysisPipeline:
    """
    End-to-end frame processing pipeline.

    Usage:
        pipe = AnalysisPipeline()
        pipe.initialize(first_frame, fps)
        for idx, frame in enumerate(frames):
            annotated, events = pipe.process_frame(frame, idx)
    """

    def __init__(self, px_per_m: float = DEFAULT_PIXELS_PER_METRE):
        # Models
        self.detector = YOLO(YOLO_DETECT_WEIGHTS)
        self.pose_model: Optional[YOLO] = None  # lazy-loaded

        # Registries
        self.registry = PlayerRegistry()
        self.event_log: Optional[EventLog] = None

        # Analysers
        self.ball_detector = BallDetector()
        self.biomechanics = BiomechanicsAnalyzer()
        self.football = FootballAnalyzer()
        self.sports_science = SportsScienceEngine()

        # Visualisation
        self.heatmap = HeatmapGenerator()
        self.renderer = FrameRenderer()

        # State
        self.fps = 30.0
        self.px_per_m = px_per_m
        self.frame_count = 0
        self.selected_player_id: Optional[int] = None
        self.target = None
        self.target_pose = None
        self.track_all = True  # analyse all players vs selected only
        self._tracker_name = TRACKER_CONFIG  # may fall back at runtime

    def initialize(self, first_frame: np.ndarray, fps: float = 30.0):
        """Call once before processing begins."""
        self.fps = fps if fps > 0 else 30.0
        self.event_log = EventLog(fps=self.fps)
        self.heatmap.initialize(first_frame.shape[:2])
        self.frame_count = 0

    def _ensure_pose_model(self):
        if self.pose_model is None:
            self.pose_model = YOLO(YOLO_POSE_WEIGHTS)

    def process_frame(
        self,
        frame: np.ndarray,
        frame_idx: int,
        draw_overlays: bool = True,
    ) -> Tuple[np.ndarray, List[Dict[str, Any]]]:
        """
        Process a single frame through the full pipeline.
        Returns: (annotated_frame, list_of_new_events_as_dicts)
        """
        if frame is None or frame.size == 0:
            return frame, []

        self.frame_count = frame_idx
        annotated = frame.copy() if draw_overlays else frame
        new_events: List[Dict[str, Any]] = []

        # ── 1. Detection + Tracking ─────────────────────────────────
        try:
            results = self.detector.track(
                frame,
                persist=True,
                tracker=self._tracker_name,
                conf=DETECT_CONF,
                iou=DETECT_IOU,
                classes=DETECT_CLASSES,
                imgsz=DETECT_IMGSZ,
                verbose=False,
            )
        except Exception:
            # BoTSORT may fail on some ultralytics versions — fall back
            if self._tracker_name != "bytetrack.yaml":
                self._tracker_name = "bytetrack.yaml"
                results = self.detector.track(
                    frame,
                    persist=True,
                    tracker="bytetrack.yaml",
                    conf=DETECT_CONF,
                    iou=DETECT_IOU,
                    classes=DETECT_CLASSES,
                    imgsz=DETECT_IMGSZ,
                    verbose=False,
                )
            else:
                raise
        detections = results[0] if results else None

        # ── 2. Ball detection ───────────────────────────────────────
        ball_pos = self.ball_detector.detect(frame) if self.target is None else None

        # ── 3. Process each detected player ─────────────────────────
        self.registry.begin_frame()  # reset per-frame seen tracking
        run_pose = (frame_idx % POSE_EVERY_N_FRAMES == 0)

        candidates = [
            (int(box.id[0]), [int(x) for x in box.xyxy[0]])
            for box in detections.boxes if box.id is not None
        ] if detections is not None and detections.boxes is not None else []
        self.target_pose = None
        if self.target is not None:
            index = self.target.select(frame, frame_idx, candidates)
            candidates = [candidates[index]] if index is not None else []

        for tracker_id, bbox in candidates:
            if self.target is None:
                player = self.registry.get_or_create(tracker_id, bbox, frame, frame_idx)
            else:
                player = self.registry.get_player(1)
                if player is None:
                    player = PlayerProfile(1, display_name="My player", first_seen_frame=frame_idx)
                    self.registry.profiles[1] = player
                self.selected_player_id = 1

            # Skip if we only track selected and this isn't them
            if (
                not self.track_all
                and self.selected_player_id is not None
                and player.player_id != self.selected_player_id
            ):
                if draw_overlays:
                    self.renderer.draw_bbox(annotated, bbox, player, selected=False)
                continue

            # Update player state
            player.update(
                frame_idx, bbox, frame,
                fps=self.fps, px_per_m=self.px_per_m,
            )

            # Heatmap
            cx, cy = (bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2
            self.heatmap.add_point(cx, cy, player.player_id)

            # Ball proximity
            if self.target is None and self.ball_detector.is_near_player(bbox):
                player.ball_touches += 1
                self.event_log.log(
                    frame_idx, EventType.BALL_TOUCH,
                    player_id=player.player_id,
                    description=f"{player.display_name} near ball",
                )

            # Pose + Biomechanics (every N frames)
            pose_data = None
            if run_pose:
                self._ensure_pose_model()
                pose_data = self.biomechanics.analyze_frame(
                    frame, bbox, self.pose_model
                )
                if pose_data:
                    self.target_pose = pose_data
                    player.latest_pose = pose_data
                    player.pose_history.append(pose_data)

                    # Sports science checks
                    if self.target is None:
                        findings = self.sports_science.evaluate(
                            player, pose_data, self.event_log, frame_idx
                        )
                        new_events.extend(findings)

            # Football tactical analysis
            if self.target is None:
                self.football.update(player, frame_idx)

            # Draw overlays
            if draw_overlays:
                is_selected = (
                    self.selected_player_id is not None
                    and player.player_id == self.selected_player_id
                )
                self.renderer.draw_bbox(annotated, bbox, player, selected=is_selected)
                self.renderer.draw_trail(
                    annotated, player.get_position_path(continuous_only=self.target is not None)
                )

                if pose_data and pose_data.get("keypoints") is not None:
                    self.renderer.draw_pose(annotated, pose_data["keypoints"])

        # ── 4. Mark stale players as lost, clean up old ones ────────
        self.registry.mark_stale_as_lost(frame_idx, stale_frames=8)
        self.registry.cleanup_lost(frame_idx, timeout=REID_LOST_TIMEOUT)

        # ── 5. Draw ball ────────────────────────────────────────────
        if draw_overlays and ball_pos:
            self.renderer.draw_ball(annotated, ball_pos)

        return annotated, new_events

    def apply_heatmap(self, frame: np.ndarray, player_id: Optional[int] = None) -> np.ndarray:
        """Overlay the heatmap onto a frame."""
        return self.heatmap.overlay(frame, player_id=player_id)

    def get_player_assessment(self, player_id: int) -> Dict[str, Any]:
        """Generate full assessment for a player."""
        player = self.registry.get_player(player_id)
        if player is None:
            return {}
        events = self.event_log.get_player_events(player_id) if self.event_log else []
        return self.sports_science.full_assessment(player, events)

    def get_all_player_ids(self) -> List[int]:
        return sorted(self.registry.profiles.keys())

    def get_player_profile(self, pid: int) -> Optional[Any]:
        return self.registry.get_player(pid)
