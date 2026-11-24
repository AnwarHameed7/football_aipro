"""Export a selected interval with its frame annotations."""

import os
from pathlib import Path
import tempfile

import cv2
from PySide6.QtCore import QThread, Signal

from app.review_annotations import draw_marks


class ClipExport(QThread):
    progress = Signal(int)
    error = Signal(str)

    def __init__(self, source, destination, start, end, marks, parent=None):
        super().__init__(parent)
        self.source = source
        self.destination = Path(destination)
        self.start_frame = start
        self.end_frame = end
        self.marks = marks

    def run(self):
        try:
            self.export()
        except (ValueError, OSError, cv2.error) as exc:
            self.error.emit(str(exc))

    def export(self):
        with tempfile.NamedTemporaryFile(suffix=".mp4", dir=self.destination.parent,
                                         delete=False) as temporary:
            temp_path = Path(temporary.name)
        cap = cv2.VideoCapture(self.source)
        writer = None
        try:
            if not cap.isOpened() or not cap.set(cv2.CAP_PROP_POS_FRAMES, self.start_frame):
                raise ValueError("Could not open the source at the clip start.")
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            for index in range(self.start_frame, self.end_frame + 1):
                if self.isInterruptionRequested():
                    return
                ok, frame = cap.read()
                if not ok:
                    raise ValueError(f"The clip ended before frame {index + 1}.")
                if writer is None:
                    height, width = frame.shape[:2]
                    writer = cv2.VideoWriter(str(temp_path), cv2.VideoWriter_fourcc(*"mp4v"),
                                             fps, (width, height))
                    if not writer.isOpened():
                        raise ValueError("Could not start the MP4 encoder.")
                writer.write(draw_marks(frame, self.marks.get(index, [])))
                if index % 10 == 0:
                    self.progress.emit(index - self.start_frame + 1)
            writer.release()
            writer = None
            if not self.isInterruptionRequested():
                os.replace(temp_path, self.destination)
        finally:
            cap.release()
            if writer is not None:
                writer.release()
            temp_path.unlink(missing_ok=True)
