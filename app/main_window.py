"""
Football AI Pro - Main Window
Central application window with:
  Left:   Video player
  Right:  Dashboard sidebar
  Bottom: Status / progress
"""

import json
import os
import cv2
import numpy as np
from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QPushButton, QFileDialog, QStatusBar, QProgressBar,
    QLabel, QSplitter, QMessageBox, QCheckBox, QFrame,
    QSlider, QGroupBox, QGridLayout, QApplication,
)
from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QAction, QIcon

from app.video_widget import VideoWidget
from app.review_window import ReviewWindow
from app.dashboard_widget import DashboardWidget
from app.analysis_worker import AnalysisWorker
from reports.generator import ReportGenerator
from analysis.sports_science import SportsScienceEngine
from config.settings import DEFAULT_PIXELS_PER_METRE, VIDEO_EXTENSIONS


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Football AI Pro")
        self.setMinimumSize(1200, 700)
        self.resize(1440, 860)

        self._video_path = None
        self._worker = None
        self._results = None

        self._build_menu()
        self._build_ui()
        self._build_statusbar()

    # ── Menu ────────────────────────────────────────────────────

    def _build_menu(self):
        menu = self.menuBar()

        # File
        file_menu = menu.addMenu("File")

        open_act = QAction("Open Video…", self)
        open_act.setShortcut("Ctrl+O")
        open_act.triggered.connect(self._open_video)
        file_menu.addAction(open_act)

        file_menu.addSeparator()

        csv_act = QAction("Export CSV…", self)
        csv_act.triggered.connect(lambda: self._export("csv"))
        file_menu.addAction(csv_act)

        json_act = QAction("Export JSON…", self)
        json_act.triggered.connect(lambda: self._export("json"))
        file_menu.addAction(json_act)

        pdf_act = QAction("Export PDF…", self)
        pdf_act.triggered.connect(lambda: self._export("pdf"))
        file_menu.addAction(pdf_act)

        plan_act = QAction("Export Training Plan…", self)
        plan_act.triggered.connect(lambda: self._export("plan"))
        file_menu.addAction(plan_act)

        guide_act = QAction("Export Exercise Guide (all muscles)…", self)
        guide_act.triggered.connect(lambda: self._export("exercise_guide"))
        file_menu.addAction(guide_act)

        file_menu.addSeparator()

        quit_act = QAction("Quit", self)
        quit_act.setShortcut("Ctrl+Q")
        quit_act.triggered.connect(self.close)
        file_menu.addAction(quit_act)

    # ── UI ──────────────────────────────────────────────────────

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(8, 8, 8, 8)
        root.setSpacing(8)

        # Top toolbar
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        self.btn_open = QPushButton("📂 Open Video")
        self.btn_open.clicked.connect(self._open_video)
        toolbar.addWidget(self.btn_open)

        self.btn_analyze = QPushButton("🚀 Analyse")
        self.btn_analyze.setObjectName("primaryBtn")
        self.btn_analyze.setEnabled(False)
        self.btn_analyze.clicked.connect(self._start_analysis)
        toolbar.addWidget(self.btn_analyze)

        self.btn_review = QPushButton("Video Review")
        self.btn_review.setEnabled(False)
        self.btn_review.clicked.connect(self._open_review)
        toolbar.addWidget(self.btn_review)

        self.btn_stop = QPushButton("⏹ Stop")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self._stop_analysis)
        toolbar.addWidget(self.btn_stop)

        toolbar.addStretch()

        # Settings controls inline
        settings_group = QFrame()
        settings_group.setObjectName("dashPanel")
        sg_layout = QHBoxLayout(settings_group)
        sg_layout.setContentsMargins(8, 4, 8, 4)
        sg_layout.setSpacing(12)

        sg_layout.addWidget(QLabel("px/m:"))
        self.slider_pxm = QSlider(Qt.Horizontal)
        self.slider_pxm.setRange(5, 50)
        self.slider_pxm.setValue(int(DEFAULT_PIXELS_PER_METRE))
        self.slider_pxm.setFixedWidth(80)
        self.lbl_pxm = QLabel(str(int(DEFAULT_PIXELS_PER_METRE)))
        self.slider_pxm.valueChanged.connect(lambda v: self.lbl_pxm.setText(str(v)))
        sg_layout.addWidget(self.slider_pxm)
        sg_layout.addWidget(self.lbl_pxm)

        self.chk_all = QCheckBox("Track All")
        self.chk_all.setToolTip("Enable match overview. For personal coaching, leave unchecked and click yourself in the video.")
        sg_layout.addWidget(self.chk_all)

        self.chk_heatmap = QCheckBox("Heatmap")
        sg_layout.addWidget(self.chk_heatmap)

        self.chk_pose = QCheckBox("Pose")
        self.chk_pose.setChecked(True)
        sg_layout.addWidget(self.chk_pose)

        toolbar.addWidget(settings_group)
        root.addLayout(toolbar)

        # Main splitter: video | dashboard
        splitter = QSplitter(Qt.Horizontal)

        # Left: video
        self.video_widget = VideoWidget()
        self.video_widget.player_clicked.connect(self._select_player)
        self._target_anchor = None
        self.video_widget.show_placeholder("Open a video to begin analysis")
        splitter.addWidget(self.video_widget)

        # Right: dashboard
        self.dashboard = DashboardWidget()
        splitter.addWidget(self.dashboard)

        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        root.addWidget(splitter, stretch=1)

        # Bottom progress
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setVisible(False)
        root.addWidget(self.progress_bar)

    def _build_statusbar(self):
        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.status.showMessage("Ready — open a video to start.")

    # ── Video loading ───────────────────────────────────────────

    def _open_video(self):
        exts = " ".join(f"*.{e}" for e in VIDEO_EXTENSIONS)
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Football Video", "",
            f"Video Files ({exts});;All Files (*)",
        )
        if not path:
            return

        if not self.video_widget.load_video(path):
            QMessageBox.warning(self, "Video unavailable", "Could not read the selected video.")
            return
        self._target_anchor = None
        self._video_path = path
        self.btn_review.setEnabled(True)
        self.btn_analyze.setEnabled(True)
        self.status.showMessage(f"Loaded {os.path.basename(path)}. Pause on a clear frame and click yourself for coaching.")

        # Reset results
        self._results = None

    def _open_review(self):
        if not self._video_path:
            return
        self.video_widget.stop()
        results = self._results or {}
        players = results.get("player_data", {})
        selected = players.get(self.dashboard.combo_player.currentData(), {})
        window = ReviewWindow(self._video_path, results.get("output_video"),
                              selected.get("movement_review"), self)
        window.exec()
        window.deleteLater()

    # ── Analysis ────────────────────────────────────────────────

    def _select_player(self, frame_index, x, y):
        if not self.btn_analyze.isEnabled() or self._results:
            return
        self._target_anchor = (frame_index, (x, y))
        self.chk_all.setChecked(False)
        self.status.showMessage(f"Player selected at frame {frame_index + 1}. Press Analyse.")

    def _start_analysis(self):
        if not self._video_path:
            return

        if not self.chk_all.isChecked() and self._target_anchor is None:
            self.status.showMessage("Pause on a clear frame and click inside your player, or enable Track All.")
            return

        self.video_widget.stop()
        self._results = None
        self.btn_analyze.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_open.setEnabled(False)
        self.btn_review.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.status.showMessage("Analysing…")
        self.dashboard.set_status("Analysis in progress…")

        self._worker = AnalysisWorker(
            video_path=self._video_path,
            px_per_m=float(self.slider_pxm.value()),
            target_anchor=None if self.chk_all.isChecked() else self._target_anchor,
            show_heatmap=self.chk_heatmap.isChecked(),
            show_pose=self.chk_pose.isChecked(),
        )

        self._worker.progress.connect(self._on_progress)
        self._worker.frame_ready.connect(self._on_frame)
        self._worker.event_fired.connect(self._on_event)
        self._worker.finished_signal.connect(self._on_finished)
        self._worker.error.connect(self._on_error)
        self._worker.start()

    def _stop_analysis(self):
        if self._worker and self._worker.isRunning():
            self._worker.cancel()
            self._worker.wait(5000)
        self._reset_ui_after_analysis()
        self.status.showMessage("Analysis cancelled.")

    # ── Worker signals ──────────────────────────────────────────

    def _on_progress(self, current: int, total: int, fps: float):
        pct = int(current / max(total, 1) * 100)
        self.progress_bar.setValue(pct)
        remaining = (total - current) / max(fps, 0.1)
        self.status.showMessage(
            f"Frame {current}/{total} · {fps:.0f} FPS · ~{remaining:.0f}s remaining"
        )

    def _on_frame(self, frame: np.ndarray):
        self.video_widget.show_frame(frame)

    def _on_event(self, event: dict):
        desc = event.get("description", event.get("observation", ""))
        if desc:
            self.dashboard.set_status(f"⚡ {desc}")

    def _on_finished(self, results: dict):
        self._results = results
        self._reset_ui_after_analysis()

        player_data = results.get("player_data", {})
        elapsed = results.get("elapsed", 0)
        total_frames = results.get("total_frames", 0)

        if not player_data:
            self.status.showMessage("No players detected in the video.")
            QMessageBox.information(self, "Analysis Complete", "No players were detected.")
            return

        fps_actual = total_frames / max(elapsed, 0.01)
        self.status.showMessage(
            f"Done — {total_frames} frames in {elapsed:.1f}s ({fps_actual:.0f} FPS) · "
            f"{len(player_data)} player(s)"
        )

        # Load output video for playback
        out_video = results.get("output_video")
        if out_video and os.path.exists(out_video):
            self.video_widget.load_video(out_video)

        # Update dashboard
        self.dashboard.update_data(player_data)

    def _on_error(self, msg: str):
        self._reset_ui_after_analysis()
        self.status.showMessage(f"Error: {msg}")
        QMessageBox.critical(self, "Analysis Error", msg)

    def _reset_ui_after_analysis(self):
        self.btn_analyze.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.btn_open.setEnabled(True)
        self.btn_review.setEnabled(bool(self._video_path))
        self.progress_bar.setVisible(False)

    # ── Exports ─────────────────────────────────────────────────

    def _export(self, fmt: str):
        if not self._results or not self._results.get("player_data"):
            QMessageBox.warning(self, "No Data", "Run analysis first before exporting.")
            return

        # Use currently selected player from dashboard
        pid = self.dashboard._current_pid
        if pid is None:
            pid = list(self._results["player_data"].keys())[0]

        entry = self._results["player_data"].get(pid)
        if not entry:
            return

        review = entry.get("movement_review")
        if review is not None and fmt != "exercise_guide":
            if fmt != "json":
                self.status.showMessage("Use Export JSON to save the personal movement review.")
                return
            path, _ = QFileDialog.getSaveFileName(
                self, "Save Movement Review", "movement_review.json", "JSON (*.json)"
            )
            if path:
                with open(path, "w", encoding="utf-8") as file:
                    json.dump(review, file, indent=2)
                self.status.showMessage(f"Movement review saved: {path}")
            return

        assessment = entry.get("assessment", {})
        stats = entry.get("stats", {})

        if fmt == "csv":
            path, _ = QFileDialog.getSaveFileName(self, "Save CSV", "report.csv", "CSV (*.csv)")
            if path:
                rg = ReportGenerator()
                csv_path = rg.to_csv(assessment, stats)
                import shutil
                shutil.copy(csv_path, path)
                self.status.showMessage(f"CSV saved: {path}")

        elif fmt == "json":
            path, _ = QFileDialog.getSaveFileName(self, "Save JSON", "report.json", "JSON (*.json)")
            if path:
                rg = ReportGenerator()
                json_str = rg.to_json(assessment, stats)
                with open(path, "w") as f:
                    f.write(json_str)
                self.status.showMessage(f"JSON saved: {path}")

        elif fmt == "pdf":
            path, _ = QFileDialog.getSaveFileName(self, "Save PDF", "report.pdf", "PDF (*.pdf)")
            if path:
                rg = ReportGenerator()
                pdf_path = rg.to_pdf(assessment, stats)
                if pdf_path:
                    import shutil
                    shutil.copy(pdf_path, path)
                    self.status.showMessage(f"PDF saved: {path}")
                else:
                    QMessageBox.warning(self, "Error", "PDF generation failed. Is fpdf2 installed?")

        elif fmt == "plan":
            path, _ = QFileDialog.getSaveFileName(self, "Save Plan", "training_plan.txt", "Text (*.txt)")
            if path:
                sse = SportsScienceEngine()
                plan = sse.generate_training_plan(assessment.get("findings", []))
                with open(path, "w") as f:
                    f.write(plan)
                self.status.showMessage(f"Training plan saved: {path}")

        elif fmt == "exercise_guide":
            path, _ = QFileDialog.getSaveFileName(
                self, "Save Exercise Guide", "exercise_guide.txt", "Text (*.txt)"
            )
            if path:
                from analysis.exercise_database import generate_full_exercise_guide
                guide = generate_full_exercise_guide()
                with open(path, "w") as f:
                    f.write(guide)
                self.status.showMessage(f"Exercise guide saved: {path}")

    # ── Window events ───────────────────────────────────────────

    def closeEvent(self, event):
        if self._worker and self._worker.isRunning():
            self._worker.cancel()
            self._worker.wait(3000)
        self.video_widget.release()
        event.accept()
