"""
Football AI Pro - Analysis Worker
QThread that runs the full analysis pipeline in the background,
emitting signals for real-time UI updates.
"""

from pathlib import Path

import cv2
import time
import tempfile
import numpy as np
from PySide6.QtCore import QThread, Signal
from typing import Optional, Dict, Any

from core.pipeline import AnalysisPipeline
from analysis.football_iq import FootballAnalyzer
from analysis.movement_review import MovementReview
from models.target import TargetTrack


class AnalysisWorker(QThread):
    """
    Runs video analysis on a background thread.

    Signals:
        progress(int, int, float)  — (current_frame, total_frames, fps)
        frame_ready(ndarray)       — annotated frame for display
        event_fired(dict)          — new analysis event
        finished(dict)             — complete results payload
        error(str)                 — error message
    """

    progress = Signal(int, int, float)
    frame_ready = Signal(np.ndarray)
    event_fired = Signal(dict)
    finished_signal = Signal(dict)
    error = Signal(str)

    def __init__(
        self,
        video_path: str,
        px_per_m: float = 12.0,
        track_all: bool = True,
        show_heatmap: bool = False,
        show_pose: bool = True,
        selected_player_id: Optional[int] = None,
        parent=None,
        target_anchor=None,
    ):
        super().__init__(parent)
        self.video_path = video_path
        self.px_per_m = px_per_m
        self.track_all = track_all
        self.show_heatmap = show_heatmap
        self.show_pose = show_pose
        self.selected_player_id = selected_player_id
        self.target_anchor = target_anchor
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def run(self):
        try:
            self._do_analysis()
        except Exception as e:
            self.error.emit(str(e))

    def _do_analysis(self):
        cap = cv2.VideoCapture(self.video_path)
        writer = None
        out_path = None
        completed = False
        try:
            if not cap.isOpened():
                raise ValueError("Could not open video file.")
            writer, out_path = self._open_output(cap)
            results = self._process_video(cap, writer)
            if results is not None:
                results["output_video"] = str(out_path)
                completed = True
        finally:
            cap.release()
            if writer is not None:
                writer.release()
            if not completed and out_path is not None:
                out_path.unlink(missing_ok=True)

        if completed:
            self.finished_signal.emit(results)

    def _open_output(self, cap):
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if w <= 0 or h <= 0:
            raise ValueError("Invalid video file. Could not read dimensions.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
            out_path = Path(tmp.name)
        writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        if not writer.isOpened():
            writer.release()
            out_path.unlink(missing_ok=True)
            raise ValueError("Could not write the annotated video.")
        return writer, out_path

    def _process_video(self, cap, out_writer):
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        # Build pipeline
        pipe = AnalysisPipeline(px_per_m=self.px_per_m)
        football = FootballAnalyzer()
        review = MovementReview(fps) if self.target_anchor is not None else None
        if review is not None:
            pipe.target = TargetTrack(*self.target_anchor)

        # Read first frame for init
        ret, first_frame = cap.read()
        if not ret or first_frame is None:
            raise ValueError("Could not read first frame.")

        pipe.initialize(first_frame, fps=fps)
        pipe.track_all = self.track_all
        pipe.selected_player_id = self.selected_player_id
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        frame_idx = 0
        all_events = []
        t_start = time.time()

        while not self._cancelled:
            ret, frame = cap.read()
            if not ret:
                break

            # Process
            annotated, new_events = pipe.process_frame(
                frame, frame_idx, draw_overlays=self.show_pose
            )

            if review is not None:
                review.record(frame_idx, pipe.target.status, pipe.target_pose)

            if self.show_heatmap:
                annotated = pipe.apply_heatmap(annotated)

            # Update football analyser
            if review is None:
                for player in pipe.registry.get_active_players():
                    football.update(player, frame_idx)

            all_events.extend(new_events)

            # Emit events
            for evt in new_events:
                self.event_fired.emit(evt)

            out_writer.write(annotated)

            # Send frame to UI (every 2nd frame to avoid overloading the GUI thread)
            if frame_idx % 2 == 0:
                self.frame_ready.emit(annotated)

            frame_idx += 1

            # Progress signal every 5 frames
            if frame_idx % 5 == 0:
                elapsed = time.time() - t_start
                actual_fps = frame_idx / max(elapsed, 0.001)
                self.progress.emit(frame_idx, total, actual_fps)

        if self._cancelled:
            return

        elapsed = time.time() - t_start

        # Build results for each player
        player_data = {}
        for pid in pipe.get_all_player_ids():
            player = pipe.get_player_profile(pid)
            if player is None or (review is None and player.total_visible_frames < 5):
                continue

            assessment = pipe.get_player_assessment(pid) if review is None else {}
            football_analysis = football.get_analysis(player)
            bio_summary = pipe.biomechanics.get_biomechanics_summary(
                player.latest_pose or {}
            )
            timeline = (
                pipe.event_log.to_timeline_dicts(player_id=pid)
                if pipe.event_log
                else []
            )

            player_data[pid] = {
                "profile": player,
                "movement_review": review.report() if review is not None else None,
                "assessment": assessment,
                "football": football_analysis,
                "biomechanics": bio_summary,
                "timeline": timeline,
                "stats": player.get_stats_dict(),
            }

        return {
            "player_data": player_data,
            "total_frames": frame_idx,
            "elapsed": elapsed,
            "all_events": all_events,
            "pipeline": pipe,
            "football_analyzer": football,
        }
