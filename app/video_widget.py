"""
Football AI Pro - Video Display Widget
Renders OpenCV frames into a Qt widget for real-time video playback.
"""

import cv2
import numpy as np
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QSlider, QFrame,
)
from PySide6.QtCore import QEvent, Qt, QTimer, Signal
from PySide6.QtGui import QImage, QPixmap


class VideoWidget(QWidget):
    """
    Displays video frames from OpenCV.
    Supports live analysis feed and post-analysis playback.
    """

    player_clicked = Signal(int, int, int)
    frame_changed = Signal(int)  # emits current frame index during playback

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cap = None
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._fps = 30.0
        self._total_frames = 0
        self._current_frame = 0
        self._playing = False
        self._source_size = (0, 0)

        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)

        # Video display
        self.display = QLabel()
        self.display.setAlignment(Qt.AlignCenter)
        self.display.setMinimumSize(480, 270)
        self.display.setObjectName("videoFrame")
        self.display.setStyleSheet("background: #000; border-radius: 8px;")
        self.display.setScaledContents(False)
        self.display.installEventFilter(self)
        layout.addWidget(self.display, stretch=1)

        # Controls bar
        controls = QHBoxLayout()
        controls.setContentsMargins(4, 0, 4, 0)
        controls.setSpacing(8)

        self.btn_play = QPushButton("▶")
        self.btn_play.setFixedSize(36, 28)
        self.btn_play.clicked.connect(self.toggle_play)
        self.btn_play.setEnabled(False)
        controls.addWidget(self.btn_play)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setMinimum(0)
        self.slider.setMaximum(100)
        self.slider.setValue(0)
        self.slider.setEnabled(False)
        self.slider.sliderMoved.connect(self._seek)
        controls.addWidget(self.slider, stretch=1)

        self.time_label = QLabel("00:00 / 00:00")
        self.time_label.setObjectName("metricLabel")
        self.time_label.setFixedWidth(100)
        controls.addWidget(self.time_label)

        layout.addLayout(controls)

    def eventFilter(self, obj, event):
        if obj is self.display and event.type() == QEvent.Type.MouseButtonPress:
            if event.button() == Qt.MouseButton.LeftButton:
                pix = self.display.pixmap()
                if pix and not pix.isNull():
                    rect = self.display.contentsRect()
                    x = event.position().x() - rect.x() - (rect.width() - pix.width()) / 2
                    y = event.position().y() - rect.y() - (rect.height() - pix.height()) / 2
                    if 0 <= x < pix.width() and 0 <= y < pix.height():
                        self.stop()
                        w, h = self._source_size
                        self.player_clicked.emit(self._current_frame, int(x * w / pix.width()),
                                                 int(y * h / pix.height()))
        return super().eventFilter(obj, event)

    # ── Public API ──────────────────────────────────────────────

    def show_frame(self, frame: np.ndarray):
        """Display a single OpenCV BGR frame."""
        if frame is None or frame.size == 0:
            return
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        self._source_size = (w, h)
        bytes_per_line = ch * w
        qimg = QImage(rgb.data, w, h, bytes_per_line, QImage.Format_RGB888)
        pixmap = QPixmap.fromImage(qimg)

        # Scale to fit the label while keeping aspect ratio
        scaled = pixmap.scaled(
            self.display.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
        )
        self.display.setPixmap(scaled)

    def load_video(self, path: str):
        """Load a video file for playback."""
        self.stop()
        if self._cap:
            self._cap.release()

        self._cap = cv2.VideoCapture(path)
        if not self._cap.isOpened():
            return

        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        self._total_frames = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self._current_frame = 0

        self.slider.setMaximum(max(self._total_frames - 1, 1))
        self.slider.setValue(0)
        self.slider.setEnabled(True)
        self.btn_play.setEnabled(True)

        # Show first frame
        ret, frame = self._cap.read()
        if ret:
            self.show_frame(frame)
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        self._update_time_label()

    def show_placeholder(self, text: str = "Load a video to begin"):
        """Show placeholder text."""
        self.display.clear()
        self.display.setText(text)
        self.display.setStyleSheet(
            "background: #000; color: #4a5568; font-size: 16px; border-radius: 8px;"
        )

    def toggle_play(self):
        if self._playing:
            self.stop()
        else:
            self.play()

    def play(self):
        if self._cap is None or not self._cap.isOpened():
            return
        self._playing = True
        self.btn_play.setText("⏸")
        interval = max(1, int(1000 / self._fps))
        self._timer.start(interval)

    def stop(self):
        self._playing = False
        self._timer.stop()
        self.btn_play.setText("▶")

    def release(self):
        self.stop()
        if self._cap:
            self._cap.release()
            self._cap = None

    # ── Internal ────────────────────────────────────────────────

    def _tick(self):
        if self._cap is None:
            self.stop()
            return
        ret, frame = self._cap.read()
        if not ret:
            self.stop()
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            self._current_frame = 0
            return

        self._current_frame = max(0, int(self._cap.get(cv2.CAP_PROP_POS_FRAMES)) - 1)
        self.show_frame(frame)
        self.slider.blockSignals(True)
        self.slider.setValue(self._current_frame)
        self.slider.blockSignals(False)
        self._update_time_label()
        self.frame_changed.emit(self._current_frame)

    def _seek(self, position: int):
        if self._cap is None:
            return
        self._cap.set(cv2.CAP_PROP_POS_FRAMES, position)
        ret, frame = self._cap.read()
        if ret:
            self.show_frame(frame)
            self._current_frame = position
            self._update_time_label()

    def _update_time_label(self):
        if self._fps <= 0:
            self.time_label.setText("--:-- / --:--")
            return
        cur_sec = self._current_frame / self._fps
        total_sec = self._total_frames / self._fps
        cur_m, cur_s = int(cur_sec // 60), int(cur_sec % 60)
        tot_m, tot_s = int(total_sec // 60), int(total_sec % 60)
        self.time_label.setText(f"{cur_m:02d}:{cur_s:02d} / {tot_m:02d}:{tot_s:02d}")

    def resizeEvent(self, event):
        """Re-scale current frame on resize."""
        super().resizeEvent(event)
        pix = self.display.pixmap()
        if pix and not pix.isNull():
            # Trigger a re-render of the current frame when resized
            pass
