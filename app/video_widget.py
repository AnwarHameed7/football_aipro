"""
Football AI Pro - Video Display Widget
Renders OpenCV frames into a Qt widget for real-time video playback.
"""

import math

import cv2
import numpy as np
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QSlider, QComboBox,
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
        self._frame = None
        self.overlay = None
        self.loop_range = None
        self._speed = 1.0

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
        for step, label in ((-1, "−1 frame"), (1, "+1 frame")):
            button = QPushButton(label)
            button.clicked.connect(lambda checked=False, delta=step: self.step(delta))
            controls.addWidget(button)
        speed = QComboBox()
        for rate in (.25, .5, 1, 1.5, 2):
            speed.addItem(f"{rate:g}×", rate)
        speed.setCurrentIndex(2)
        speed.currentIndexChanged.connect(lambda: self.set_speed(speed.currentData()))
        controls.addWidget(speed)

        self.slider = QSlider(Qt.Horizontal)
        self.slider.setMinimum(0)
        self.slider.setMaximum(100)
        self.slider.setValue(0)
        self.slider.setEnabled(False)
        self.slider.valueChanged.connect(self.seek)
        controls.addWidget(self.slider, stretch=1)

        self.time_label = QLabel("00:00 / 00:00")
        self.time_label.setObjectName("metricLabel")
        self.time_label.setMinimumWidth(145)
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
        self._frame = frame
        self.refresh_frame()

    def full_frame_pixmap(self):
        if self._frame is None:
            return
        frame = self.overlay(self._frame, self._current_frame) if self.overlay else self._frame
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        self._source_size = (w, h)
        return QPixmap.fromImage(QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888))

    def refresh_frame(self):
        pixmap = self.full_frame_pixmap()
        if pixmap is None:
            return
        self.display.setPixmap(pixmap.scaled(
            self.display.contentsRect().size(), Qt.KeepAspectRatio, Qt.SmoothTransformation
        ))

    @property
    def frame_index(self):
        return self._current_frame

    @property
    def fps(self):
        return self._fps

    @property
    def frame_count(self):
        return self._total_frames

    @property
    def frame_size(self):
        return self._source_size

    def load_video(self, path: str):
        cap = cv2.VideoCapture(path)
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            return False
        self.release()
        self._cap = cap
        fps = cap.get(cv2.CAP_PROP_FPS)
        self._fps = fps if math.isfinite(fps) and fps > 0 else 30.0
        self._total_frames = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        self.loop_range = None
        self.slider.setEnabled(True)
        self.btn_play.setEnabled(True)
        self.slider.blockSignals(True)
        self.slider.setMaximum(self._total_frames - 1)
        self.slider.blockSignals(False)
        self._display_position(frame, 0)
        return True

    def show_placeholder(self, text: str = "Load a video to begin"):
        """Show placeholder text."""
        self._frame = None
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
        if self.loop_range:
            first, last = self.loop_range
            if not first <= self.frame_index < last:
                self.seek(first)
        elif self.frame_index == self.frame_count - 1:
            self.seek(0)
        self._playing = True
        self.btn_play.setText("⏸")
        self._timer.start(max(1, round(1000 / (self._fps * self._speed))))

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

    def set_speed(self, speed):
        self._speed = speed
        if self._playing:
            self._timer.start(max(1, round(1000 / (self._fps * self._speed))))

    def step(self, delta):
        self.stop()
        self.seek(self._current_frame + delta)

    def _tick(self):
        if self._cap is None:
            self.stop()
            return
        if self.loop_range and self.frame_index >= self.loop_range[1]:
            self.seek(self.loop_range[0])
            return
        if self.frame_index >= self.frame_count - 1:
            self.stop()
            return
        ret, frame = self._cap.read()
        if not ret:
            self.stop()
            return
        self._display_position(frame, self._current_frame + 1)

    def seek(self, position):
        if self._cap is None:
            return False
        position = max(0, min(self._total_frames - 1, position))
        if position == self._current_frame and self._frame is not None:
            return True
        if int(self._cap.get(cv2.CAP_PROP_POS_FRAMES)) != position:
            if not self._cap.set(cv2.CAP_PROP_POS_FRAMES, position):
                return False
        ret, frame = self._cap.read()
        if ret:
            self._display_position(frame, position)
        else:
            self.slider.blockSignals(True)
            self.slider.setValue(self._current_frame)
            self.slider.blockSignals(False)
        return bool(ret)

    def _display_position(self, frame, position):
        self._current_frame = position
        self.show_frame(frame)
        self.slider.blockSignals(True)
        self.slider.setValue(position)
        self.slider.blockSignals(False)
        self._update_time_label()
        self.frame_changed.emit(position)

    def _update_time_label(self):
        seconds = self._current_frame / self._fps
        self.time_label.setText(f"{seconds:07.3f}s · {self._current_frame + 1}/{self._total_frames}")

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.refresh_frame()
