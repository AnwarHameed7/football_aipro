"""Desktop workspace for technique comparison, event tagging and coach feedback."""

import csv
import json
import os
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDialog, QDoubleSpinBox, QFileDialog,
    QFormLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPlainTextEdit,
    QProgressDialog, QPushButton, QSplitter, QTableWidget, QTableWidgetItem,
    QVBoxLayout, QWidget,
)

from analysis.movement_review import format_review
from app.review_annotations import POINT_COUNTS, draw_marks
from app.review_export import ClipExport
from app.video_widget import VideoWidget


VIDEO_FILES = "Video (*.mp4 *.avi *.mov *.mkv *.m4v *.webm);;All files (*)"
CATEGORIES = (
    "Running form", "Acceleration", "Deceleration", "Change of direction",
    "First touch", "Pass", "Shot", "Defensive action", "Pressing",
    "Transition", "Set piece", "Opponent pattern", "Other",
)


class ReviewWindow(QDialog):
    def __init__(self, source, analyzed=None, review=None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Football AI Pro | Video Review")
        self.resize(1400, 860)
        self.source = source
        self.analyzed = analyzed
        self.review = review
        self.reference_path = None
        self.marks = {}
        self.pending = []
        self.pending_frame = None
        self.tags = []
        self.start_frame = self.end_frame = 0
        self.export_worker = None
        self.build_ui()
        self.primary.load_video(source)
        self.update_range()

    def add_button(self, layout, title, callback):
        button = QPushButton(title)
        button.clicked.connect(callback)
        layout.addWidget(button)
        return button

    def build_ui(self):
        root = QVBoxLayout(self)
        top = QHBoxLayout()
        root.addLayout(top)
        self.view = QComboBox()
        self.view.addItem("Original footage", self.source)
        if self.analyzed:
            self.view.addItem("Analyzed footage", self.analyzed)
        self.view.currentIndexChanged.connect(self.change_view)
        top.addWidget(self.view)
        self.add_button(top, "Open comparison clip", self.open_reference)
        self.sync = QCheckBox("Sync comparison")
        self.sync.setChecked(True)
        self.sync.toggled.connect(self.set_sync)
        top.addWidget(self.sync)
        self.offset = QDoubleSpinBox()
        self.offset.setRange(-3600, 3600)
        self.offset.setDecimals(3)
        self.offset.setSingleStep(.1)
        self.offset.setSuffix(" s offset")
        self.offset.valueChanged.connect(self.sync_reference)
        top.addWidget(self.offset)
        self.add_button(top, "Align current frames", self.align_reference)
        top.addStretch()
        self.add_button(top, "Open review", self.load_review)
        self.add_button(top, "Save review", self.save_review)

        split = QSplitter(Qt.Orientation.Vertical)
        root.addWidget(split, stretch=1)
        videos = QSplitter(Qt.Orientation.Horizontal)
        split.addWidget(videos)
        self.primary = VideoWidget()
        self.reference = VideoWidget()
        self.reference.hide()
        videos.addWidget(self.primary)
        videos.addWidget(self.reference)
        self.primary.overlay = self.render_frame
        self.primary.player_clicked.connect(self.place_mark)
        self.primary.frame_changed.connect(self.frame_changed)

        bottom = QWidget()
        layout = QVBoxLayout(bottom)
        split.addWidget(bottom)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 2)

        tools = QHBoxLayout()
        layout.addLayout(tools)
        self.tool = QComboBox()
        self.tool.addItems(["Pointer", *POINT_COUNTS])
        self.tool.currentTextChanged.connect(self.cancel_mark)
        tools.addWidget(self.tool)
        self.add_button(tools, "Undo drawing", self.undo_mark)
        self.add_button(tools, "Save frame image", self.save_image)
        self.add_button(tools, "Set in", self.set_in)
        self.add_button(tools, "Set out", self.set_out)
        self.range_label = QLabel()
        tools.addWidget(self.range_label)
        self.loop = QCheckBox("Loop")
        self.loop.toggled.connect(self.update_range)
        tools.addWidget(self.loop)
        self.add_button(tools, "Export clip", self.export_clip)
        tools.addStretch()

        editor = QHBoxLayout()
        layout.addLayout(editor)
        fields = QFormLayout()
        editor.addLayout(fields, stretch=1)
        self.title = QLineEdit()
        self.category = QComboBox()
        self.category.addItems(CATEGORIES)
        self.player = QLineEdit()
        self.notes = QPlainTextEdit()
        self.notes.setPlaceholderText("Observation, coaching cue or next action")
        self.notes.setMaximumHeight(100)
        fields.addRow("Clip title", self.title)
        fields.addRow("Category", self.category)
        fields.addRow("Player or team", self.player)
        fields.addRow("Feedback", self.notes)
        buttons = QHBoxLayout()
        fields.addRow(buttons)
        self.add_button(buttons, "Add tag", self.add_tag)
        self.add_button(buttons, "Update tag", self.update_tag)

        playlist = QVBoxLayout()
        editor.addLayout(playlist, stretch=2)
        self.filter = QLineEdit()
        self.filter.setPlaceholderText("Filter by category, player, title or feedback")
        self.filter.textChanged.connect(self.refresh_tags)
        playlist.addWidget(self.filter)
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["In–Out", "Category", "Player / team", "Title"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.itemSelectionChanged.connect(self.select_tag)
        playlist.addWidget(self.table)
        actions = QHBoxLayout()
        playlist.addLayout(actions)
        self.add_button(actions, "Delete tag", self.delete_tag)
        self.add_button(actions, "Export tags CSV", self.export_tags)
        self.analysis_button = self.add_button(actions, "View analysis", self.show_analysis)
        self.analysis_button.setEnabled(bool(self.review))
        self.flag_button = self.add_button(actions, "Tag coaching cues", self.tag_analysis)
        self.flag_button.setEnabled(bool(self.review))
        actions.addStretch()

        self.status = QLabel("Draw on a paused frame, or set clip boundaries and add a tag.")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

    def status_message(self, text):
        self.status.setText(text)

    def change_view(self):
        frame = self.primary.frame_index
        if self.primary.load_video(self.view.currentData()):
            self.primary.seek(frame)
            self.update_range()
        else:
            self.status_message("The selected video could not be opened.")

    def open_reference(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open comparison clip", "", VIDEO_FILES)
        if path:
            if not self.reference.load_video(path):
                self.status_message("Could not open the comparison clip.")
                return
            self.reference_path = path
            self.reference.show()
            self.set_sync()

    def set_sync(self):
        if self.sync.isChecked():
            self.reference.stop()
        self.reference.setEnabled(not self.sync.isChecked())
        self.sync_reference()

    def align_reference(self):
        if self.reference_path:
            offset = (self.reference.frame_index / self.reference.fps -
                      self.primary.frame_index / self.primary.fps)
            self.offset.setValue(offset)
            self.sync.setChecked(True)

    def sync_reference(self, *_args):
        if self.reference_path and self.sync.isChecked():
            seconds = self.primary.frame_index / self.primary.fps + self.offset.value()
            self.reference.seek(round(seconds * self.reference.fps))

    def frame_changed(self, _index):
        self.pending.clear()
        self.sync_reference()

    def render_frame(self, frame, index):
        marks = self.marks.get(index, [])
        if self.pending and self.pending_frame == index:
            marks = marks + [{"tool": "Line", "points": self.pending}]
        return draw_marks(frame, marks)

    def place_mark(self, frame, x, y):
        tool = self.tool.currentText()
        if tool not in POINT_COUNTS:
            return
        self.pending_frame = frame
        w, h = self.primary.frame_size
        self.pending.append([x / max(1, w - 1), y / max(1, h - 1)])
        remaining = POINT_COUNTS[tool] - len(self.pending)
        if remaining:
            self.status_message(f"{tool} · {remaining} more point(s). Choose the joint second for an angle.")
        else:
            self.marks.setdefault(frame, []).append({"tool": tool, "points": self.pending})
            self.pending = []
            self.status_message(f"{tool} added at frame {frame + 1}.")
        self.primary.refresh_frame()

    def cancel_mark(self):
        self.pending.clear()
        self.primary.refresh_frame()

    def undo_mark(self):
        if self.pending:
            self.cancel_mark()
        elif marks := self.marks.get(self.primary.frame_index):
            marks.pop()
            self.primary.refresh_frame()

    def set_in(self):
        self.start_frame = self.primary.frame_index
        self.end_frame = max(self.start_frame, self.end_frame)
        self.update_range()

    def set_out(self):
        self.end_frame = self.primary.frame_index
        self.start_frame = min(self.start_frame, self.end_frame)
        self.update_range()

    def update_range(self):
        self.range_label.setText(
            f"{self.start_frame / self.primary.fps:.3f}–{self.end_frame / self.primary.fps:.3f}s"
        )
        self.primary.loop_range = (self.start_frame, self.end_frame) if self.loop.isChecked() else None

    def tag_from_editor(self):
        return {
            "start": self.start_frame, "end": self.end_frame,
            "category": self.category.currentText(), "player": self.player.text().strip(),
            "title": self.title.text().strip() or self.category.currentText(),
            "feedback": self.notes.toPlainText().strip(),
        }

    def add_tag(self):
        self.tags.append(self.tag_from_editor())
        self.refresh_tags(len(self.tags) - 1)

    def tag_index(self):
        cell = self.table.item(self.table.currentRow(), 0)
        if cell is not None:
            return cell.data(Qt.ItemDataRole.UserRole)
        return None

    def update_tag(self):
        if (index := self.tag_index()) is not None:
            self.tags[index] = self.tag_from_editor()
            self.refresh_tags(index)

    def delete_tag(self):
        if (index := self.tag_index()) is not None:
            del self.tags[index]
            self.refresh_tags()

    def refresh_tags(self, active=None):
        self.table.blockSignals(True)
        self.table.setRowCount(0)
        query = self.filter.text().casefold().strip()
        for index, tag in sorted(enumerate(self.tags), key=lambda item: item[1]["start"]):
            if query and not any(query in tag[key].casefold()
                                 for key in ("category", "player", "title", "feedback")):
                continue
            row = self.table.rowCount()
            self.table.insertRow(row)
            fps = self.primary.fps
            for column, value in enumerate((
                f'{tag["start"] / fps:.2f}–{tag["end"] / fps:.2f}s',
                tag["category"], tag["player"], tag["title"],
            )):
                cell = QTableWidgetItem(value)
                cell.setData(Qt.ItemDataRole.UserRole, index)
                self.table.setItem(row, column, cell)
            if active == index:
                self.table.selectRow(row)
        self.table.blockSignals(False)

    def select_tag(self):
        if (index := self.tag_index()) is None:
            return
        tag = self.tags[index]
        self.start_frame, self.end_frame = tag["start"], tag["end"]
        self.title.setText(tag["title"])
        self.category.setCurrentText(tag["category"])
        self.player.setText(tag["player"])
        self.notes.setPlainText(tag["feedback"])
        self.primary.stop()
        self.primary.seek(self.start_frame)
        self.update_range()

    def tag_analysis(self):
        if not self.review:
            return
        added = 0
        for span in self.review["spans"]:
            if span["status"] != "visible" or not span["measurements"] or not span["review_cues"]:
                continue
            start = max(0, round(span["start_s"] * self.primary.fps))
            end = min(self.primary.frame_count - 1, round(span["end_s"] * self.primary.fps) - 1)
            if end < start:
                continue
            tag = {
                "start": start, "end": end, "category": "Running form",
                "player": "", "title": "Automated coaching cue",
                "feedback": " ".join(span["review_cues"]),
            }
            if tag not in self.tags:
                self.tags.append(tag)
                added += 1
        self.refresh_tags()
        self.status_message(f"Added {added} coaching cue tag(s).")

    def show_analysis(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("Automated movement review")
        dialog.resize(740, 600)
        layout = QVBoxLayout(dialog)
        text = QPlainTextEdit(format_review(self.review))
        text.setReadOnly(True)
        layout.addWidget(text)
        dialog.exec()

    def save_review(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save review", "review.json", "Review (*.json)")
        if not path:
            return
        data = {
            "version": 1, "source": Path(self.source).name, "fps": self.primary.fps,
            "frame_count": self.primary.frame_count,
            "tags": self.tags, "drawings": self.marks,
            "movement_review": self.review,
        }
        try:
            Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            self.status_message(str(exc))
            return
        self.status_message("Review saved. Share it with the source clip or export selected clips separately.")

    def load_review(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open review for this footage", "", "Review (*.json)")
        if not path:
            return
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            if (data["version"] != 1 or data["source"] != Path(self.source).name
                    or data["frame_count"] != self.primary.frame_count
                    or abs(float(data["fps"]) - self.primary.fps) > .05):
                raise ValueError("Open the matching source footage before importing this review.")
            tags = self.validate_tags(data["tags"])
            marks = self.validate_marks(data["drawings"])
            review = data.get("movement_review")
            if review is not None:
                format_review(review)
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
            self.status_message(f"Could not load review. {exc}")
            return
        self.tags, self.marks = tags, marks
        self.review = review
        self.analysis_button.setEnabled(bool(review))
        self.flag_button.setEnabled(bool(review))
        self.pending.clear()
        self.refresh_tags()
        self.primary.refresh_frame()
        self.status_message("Review loaded.")

    def validate_tags(self, tags):
        if not isinstance(tags, list):
            raise ValueError("Invalid clip tags.")
        for tag in tags:
            if not (isinstance(tag["start"], int) and isinstance(tag["end"], int)
                    and 0 <= tag["start"] <= tag["end"] < self.primary.frame_count
                    and all(isinstance(tag[key], str) for key in ("title", "player", "category", "feedback"))
                    and tag["category"] in CATEGORIES):
                raise ValueError("Invalid clip tag.")
        return tags

    def validate_marks(self, drawings):
        result = {}
        for frame, marks in drawings.items():
            index = int(frame)
            if not 0 <= index < self.primary.frame_count:
                raise ValueError("Invalid drawing timestamp.")
            for mark in marks:
                points = mark["points"]
                if len(points) != POINT_COUNTS[mark["tool"]] or not all(
                    len(point) == 2 and all(0 <= value <= 1 for value in point) for point in points
                ):
                    raise ValueError("Invalid drawing coordinates.")
            result[index] = marks
        return result

    def export_tags(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export tagged clips", "tags.csv", "CSV (*.csv)")
        if path:
            try:
                with open(path, "w", encoding="utf-8-sig", newline="") as output:
                    columns = ["start_s", "end_s", "category", "player", "title", "feedback"]
                    writer = csv.DictWriter(output, fieldnames=columns)
                    writer.writeheader()
                    for tag in sorted(self.tags, key=lambda item: item["start"]):
                        row = {key: tag[key] for key in columns[2:]}
                        for key, value in row.items():
                            if value.lstrip().startswith(("=", "+", "-", "@")):
                                row[key] = "'" + value
                        row.update(start_s=tag["start"] / self.primary.fps,
                                   end_s=tag["end"] / self.primary.fps)
                        writer.writerow(row)
            except OSError as exc:
                self.status_message(str(exc))
                return
            self.status_message("Tag list exported.")

    def save_image(self):
        pixmap = self.primary.full_frame_pixmap()
        if not pixmap or pixmap.isNull():
            return
        path, _ = QFileDialog.getSaveFileName(self, "Save annotated frame", "frame.png", "PNG (*.png)")
        if path and not pixmap.save(path, "PNG"):
            self.status_message("Could not save frame.")

    def export_clip(self):
        if self.export_worker and self.export_worker.isRunning():
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Export annotated MP4 (video only)", "tagged-clip.mp4", "MP4 (*.mp4)"
        )
        if not path:
            return
        if os.path.realpath(path) in {os.path.realpath(source) for source in
                                     (self.source, self.analyzed, self.reference_path) if source}:
            self.status_message("Choose a different filename from your source videos.")
            return
        worker = ClipExport(self.view.currentData(), path, self.start_frame, self.end_frame,
                            {index: list(marks) for index, marks in self.marks.items()}, self)
        self.export_worker = worker
        progress = QProgressDialog("Exporting annotated video", "Cancel", 0,
                                   self.end_frame - self.start_frame + 1, self)
        self.export_progress = progress
        progress.setWindowModality(Qt.WindowModality.WindowModal)
        progress.canceled.connect(worker.requestInterruption)
        worker.progress.connect(progress.setValue)
        worker.error.connect(self.export_error)
        worker.finished.connect(self.export_finished)
        self.status_message("Exporting video…")
        progress.show()
        worker.start()

    def export_error(self, error):
        self.status_message(f"Export failed. {error}")

    def export_finished(self):
        self.export_progress.reset()
        if self.status.text() == "Exporting video…":
            cancelled = self.export_worker.isInterruptionRequested()
            self.status_message("Export cancelled." if cancelled else "Annotated MP4 exported.")
        self.export_progress.deleteLater()
        self.export_worker.deleteLater()
        self.export_worker = None

    def done(self, result):
        if self.export_worker and self.export_worker.isRunning():
            self.status_message("Cancel or finish the clip export before closing.")
            return
        self.primary.release()
        self.reference.release()
        super().done(result)
