"""
Football AI Pro - Dashboard Widget
Right sidebar panel that displays scores, metrics, coach feedback,
strengths, weaknesses, and biomechanics observations.
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QFrame,
    QScrollArea, QSizePolicy, QGridLayout, QComboBox,
    QLineEdit, QSpinBox, QPushButton, QTabWidget,
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QPixmap, QImage
from typing import Dict, Any, List, Optional
import cv2
import numpy as np

from PySide6.QtWidgets import QPlainTextEdit
from analysis.movement_review import format_review

from visualization.charts import (
    create_speed_graph, create_acceleration_graph,
    create_distance_bar, create_zone_pie, create_score_gauge,
)


def _cv_to_pixmap(img: np.ndarray, max_width: int = 400) -> QPixmap:
    """Convert OpenCV BGR image to QPixmap."""
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w, ch = rgb.shape
    qimg = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888)
    pix = QPixmap.fromImage(qimg)
    if pix.width() > max_width:
        pix = pix.scaledToWidth(max_width, Qt.SmoothTransformation)
    return pix


def _make_score_card(label: str, value: int) -> QFrame:
    """Create a small score card widget."""
    frame = QFrame()
    frame.setObjectName("scoreCard")
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(6, 6, 6, 6)
    layout.setSpacing(2)
    layout.setAlignment(Qt.AlignCenter)

    val_label = QLabel(str(value))
    val_label.setAlignment(Qt.AlignCenter)
    val_label.setObjectName("scoreValue")
    if value >= 70:
        val_label.setObjectName("goodScore")
        val_label.setStyleSheet("font-size: 22px; font-weight: 700; color: #1db954;")
    elif value >= 40:
        val_label.setObjectName("moderateScore")
        val_label.setStyleSheet("font-size: 22px; font-weight: 700; color: #f0c040;")
    else:
        val_label.setObjectName("poorScore")
        val_label.setStyleSheet("font-size: 22px; font-weight: 700; color: #e84c4c;")

    name_label = QLabel(label)
    name_label.setAlignment(Qt.AlignCenter)
    name_label.setObjectName("scoreLabel")

    layout.addWidget(val_label)
    layout.addWidget(name_label)
    return frame


def _make_badge(text: str, kind: str = "strength") -> QFrame:
    """Create a strength or weakness badge."""
    frame = QFrame()
    frame.setObjectName("strengthBadge" if kind == "strength" else "weaknessBadge")
    layout = QVBoxLayout(frame)
    layout.setContentsMargins(8, 4, 8, 4)
    lbl = QLabel(text)
    lbl.setWordWrap(True)
    lbl.setStyleSheet(
        f"color: {'#b4f0c9' if kind == 'strength' else '#f5c6c6'}; "
        f"font-size: 12px; background: transparent;"
    )
    layout.addWidget(lbl)
    return frame


class DashboardWidget(QWidget):
    """
    Complete dashboard sidebar.
    Call ``update_data()`` to refresh with new analysis results.
    """

    player_changed = Signal(int)  # emitted when user selects a different player

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Expanding)
        self.setMinimumWidth(320)
        self.setMaximumWidth(480)

        self._player_data: Dict[int, Dict] = {}
        self._current_pid: Optional[int] = None

        self._build_ui()

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        # Scroll area for the whole dashboard
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        container = QWidget()
        self.layout_main = QVBoxLayout(container)
        self.layout_main.setContentsMargins(8, 8, 8, 8)
        self.layout_main.setSpacing(8)

        # ── Player selector ────────────────────────────────────
        sel_frame = QFrame()
        sel_frame.setObjectName("dashPanel")
        sel_layout = QVBoxLayout(sel_frame)

        lbl = QLabel("SELECT PLAYER")
        lbl.setObjectName("sectionTitle")
        sel_layout.addWidget(lbl)

        self.combo_player = QComboBox()
        self.combo_player.currentIndexChanged.connect(self._on_player_changed)
        sel_layout.addWidget(self.combo_player)

        # Player info editors
        info_grid = QGridLayout()
        info_grid.setSpacing(4)
        info_grid.addWidget(QLabel("Name:"), 0, 0)
        self.edit_name = QLineEdit()
        self.edit_name.setPlaceholderText("Player name")
        self.edit_name.editingFinished.connect(self._on_name_changed)
        info_grid.addWidget(self.edit_name, 0, 1)

        info_grid.addWidget(QLabel("Jersey:"), 1, 0)
        self.edit_jersey = QSpinBox()
        self.edit_jersey.setRange(0, 99)
        info_grid.addWidget(self.edit_jersey, 1, 1)

        info_grid.addWidget(QLabel("Position:"), 2, 0)
        self.combo_pos = QComboBox()
        self.combo_pos.addItems([
            "", "GK", "CB", "LB", "RB", "CDM", "CM", "CAM",
            "LM", "RM", "LW", "RW", "CF", "ST",
        ])
        info_grid.addWidget(self.combo_pos, 2, 1)

        sel_layout.addLayout(info_grid)
        self.layout_main.addWidget(sel_frame)

        # ── Score cards ────────────────────────────────────────
        self.scores_layout = QHBoxLayout()
        self.scores_layout.setSpacing(4)
        self.score_frame = QWidget()
        self.score_frame.setLayout(self.scores_layout)
        self.layout_main.addWidget(self.score_frame)

        # ── Risk / Fatigue row ─────────────────────────────────
        self.risk_fat_layout = QHBoxLayout()
        self.risk_fat_layout.setSpacing(4)
        self.risk_fat_frame = QWidget()
        self.risk_fat_frame.setLayout(self.risk_fat_layout)
        self.layout_main.addWidget(self.risk_fat_frame)

        # ── Coach panel ────────────────────────────────────────
        self.coach_frame = QFrame()
        self.coach_frame.setObjectName("coachPanel")
        self.coach_layout = QVBoxLayout(self.coach_frame)
        coach_title = QLabel("AI COACH")
        coach_title.setObjectName("sectionTitle")
        self.coach_layout.addWidget(coach_title)
        self.coach_text = QLabel("Run analysis to see coaching feedback.")
        self.coach_text.setWordWrap(True)
        self.coach_text.setStyleSheet("color: #a8b2d1; font-size: 12px; background: transparent;")
        self.coach_layout.addWidget(self.coach_text)
        self.layout_main.addWidget(self.coach_frame)

        # ── Tabs for details ───────────────────────────────────
        self.tabs = QTabWidget()

        # Metrics tab
        self.tab_metrics = QWidget()
        self.metrics_layout = QVBoxLayout(self.tab_metrics)
        self.metrics_layout.setContentsMargins(4, 4, 4, 4)
        self.tabs.addTab(self.tab_metrics, "Metrics")

        # Charts tab
        self.tab_charts = QWidget()
        self.charts_layout = QVBoxLayout(self.tab_charts)
        self.charts_layout.setContentsMargins(4, 4, 4, 4)
        self.tabs.addTab(self.tab_charts, "Charts")

        # Findings tab
        self.tab_findings = QWidget()
        self.findings_layout = QVBoxLayout(self.tab_findings)
        self.findings_layout.setContentsMargins(4, 4, 4, 4)
        self.tabs.addTab(self.tab_findings, "Findings")

        # Biomechanics tab
        self.tab_bio = QWidget()
        self.bio_layout = QVBoxLayout(self.tab_bio)
        self.bio_layout.setContentsMargins(4, 4, 4, 4)
        self.tabs.addTab(self.tab_bio, "Mechanics")

        self.layout_main.addWidget(self.tabs)
        self.movement_review = QPlainTextEdit()
        self.movement_review.setReadOnly(True)
        self.movement_review.setMinimumHeight(350)
        self.movement_review.hide()
        self.layout_main.addWidget(self.movement_review)

        # ── Strengths / Weaknesses ─────────────────────────────
        self.sw_frame = QFrame()
        self.sw_frame.setObjectName("dashPanel")
        self.sw_layout = QVBoxLayout(self.sw_frame)
        self.layout_main.addWidget(self.sw_frame)

        self.layout_main.addStretch()

        scroll.setWidget(container)
        outer.addWidget(scroll)

    # ── Public API ──────────────────────────────────────────────

    def update_data(self, player_data: Dict[int, Dict]):
        """Load full results and populate the dashboard."""
        self._player_data = player_data

        # Update player combo
        self.combo_player.blockSignals(True)
        self.combo_player.clear()
        for pid in sorted(player_data.keys()):
            name = player_data[pid].get("stats", {}).get("name", f"Player {pid}")
            self.combo_player.addItem(f"#{pid}  {name}", pid)
        self.combo_player.blockSignals(False)

        if player_data:
            self.combo_player.setCurrentIndex(0)
            self._refresh_current()

    def set_status(self, text: str):
        """Update the coach text during analysis."""
        self.coach_text.setText(text)

    # ── Internal ────────────────────────────────────────────────

    def _on_player_changed(self, index: int):
        pid = self.combo_player.currentData()
        if pid is not None:
            self._current_pid = pid
            self._refresh_current()
            self.player_changed.emit(pid)

    def _on_name_changed(self):
        if self._current_pid and self._current_pid in self._player_data:
            profile = self._player_data[self._current_pid].get("profile")
            if profile:
                profile.display_name = self.edit_name.text()

    def _refresh_current(self):
        """Rebuild all UI elements for the currently selected player."""
        pid = self.combo_player.currentData()
        if pid is None or pid not in self._player_data:
            return

        self._current_pid = pid
        entry = self._player_data[pid]
        review = entry.get("movement_review")
        self.movement_review.setVisible(review is not None)
        for widget in (self.tabs, self.sw_frame, self.coach_frame, self.score_frame, self.risk_fat_frame):
            widget.setVisible(review is None)
        if review is not None:
            self.edit_name.setText(entry["stats"].get("name", ""))
            self.edit_jersey.setValue(0)
            self.movement_review.setPlainText(format_review(review))
            return
        assessment = entry.get("assessment", {})
        stats = entry.get("stats", {})
        player = entry.get("profile")
        bio = entry.get("biomechanics", {})
        findings = assessment.get("findings", [])

        # Player info
        self.edit_name.setText(stats.get("name", ""))
        self.edit_jersey.setValue(stats.get("jersey") or 0)

        # ── Score cards ────────────────────────────────────────
        self._clear_layout(self.scores_layout)
        for label, key in [
            ("Overall", "overall_score"), ("Technical", "technical_score"),
            ("Physical", "physical_score"), ("Bio", "biomechanics_score"),
            ("Tactical", "tactical_score"),
        ]:
            card = _make_score_card(label, assessment.get(key, 0))
            self.scores_layout.addWidget(card)

        # ── Risk / Fatigue ─────────────────────────────────────
        self._clear_layout(self.risk_fat_layout)
        risk = assessment.get("risk_level", "Low")
        risk_card = _make_score_card("Risk", {"Low": 20, "Moderate": 60, "High": 90}.get(risk, 50))
        self.risk_fat_layout.addWidget(risk_card)

        fat_val = int(assessment.get("fatigue_pct", 0))
        fat_card = _make_score_card("Fatigue", fat_val)
        self.risk_fat_layout.addWidget(fat_card)

        # ── Coach ──────────────────────────────────────────────
        if findings:
            latest = findings[-1]
            self.coach_text.setText(
                f"⚠️ {latest.get('observation', '')}\n\n"
                f"🏋️ {latest.get('corrective_drills', 'N/A')}"
            )
        else:
            self.coach_text.setText("✅ Good mechanics observed. Maintain current technique.")

        # ── Metrics tab ────────────────────────────────────────
        self._clear_layout(self.metrics_layout)
        metrics = [
            ("Distance", f"{stats.get('total_distance_m', 0):.1f} m"),
            ("Max Speed", f"{stats.get('max_speed_ms', 0):.2f} m/s"),
            ("Avg Speed", f"{stats.get('avg_speed_ms', 0):.2f} m/s"),
            ("Sprints", str(stats.get("sprint_count", 0))),
            ("HI Runs", str(stats.get("high_intensity_runs", 0))),
            ("Dir Changes", str(stats.get("direction_changes", 0))),
            ("Ball Touches", str(stats.get("ball_touches", 0))),
            ("Work Rate", stats.get("work_rate", "N/A")),
            ("Fatigue", f"{assessment.get('fatigue_pct', 0):.0f}%"),
            ("Intensity", stats.get("movement_intensity", "N/A")),
        ]
        grid = QGridLayout()
        grid.setSpacing(4)
        for i, (label, value) in enumerate(metrics):
            row, col = divmod(i, 2)
            lbl = QLabel(label)
            lbl.setObjectName("metricLabel")
            val = QLabel(value)
            val.setObjectName("metricValue")
            val.setAlignment(Qt.AlignRight)
            grid.addWidget(lbl, row, col * 2)
            grid.addWidget(val, row, col * 2 + 1)
        self.metrics_layout.addLayout(grid)
        self.metrics_layout.addStretch()

        # ── Charts tab ─────────────────────────────────────────
        self._clear_layout(self.charts_layout)
        if player:
            speed_hist = player.get_speed_history()
            if len(speed_hist) > 5:
                speed_img = create_speed_graph(speed_hist, width=380, height=140)
                lbl = QLabel()
                lbl.setPixmap(_cv_to_pixmap(speed_img, 380))
                self.charts_layout.addWidget(QLabel("Speed Profile"))
                self.charts_layout.addWidget(lbl)

            acc_hist = list(player.accelerations)
            if len(acc_hist) > 5:
                acc_img = create_acceleration_graph(acc_hist, width=380, height=100)
                lbl = QLabel()
                lbl.setPixmap(_cv_to_pixmap(acc_img, 380))
                self.charts_layout.addWidget(QLabel("Acceleration"))
                self.charts_layout.addWidget(lbl)

            dist_img = create_distance_bar(stats.get("total_distance_m", 0), 500)
            lbl = QLabel()
            lbl.setPixmap(_cv_to_pixmap(dist_img, 380))
            self.charts_layout.addWidget(QLabel("Distance"))
            self.charts_layout.addWidget(lbl)

        self.charts_layout.addStretch()

        # ── Findings tab ───────────────────────────────────────
        self._clear_layout(self.findings_layout)
        if findings:
            for f in findings:
                card = QFrame()
                card.setObjectName("dashPanel")
                cl = QVBoxLayout(card)
                cl.setSpacing(2)

                title = QLabel(f.get("observation", ""))
                title.setWordWrap(True)
                title.setStyleSheet("font-weight: 600; font-size: 12px; color: #ccd6f6; background: transparent;")
                cl.addWidget(title)

                sev = f.get("severity", "low")
                sev_colour = {"high": "#e84c4c", "moderate": "#f0c040", "low": "#64ffda"}.get(sev, "#ccc")
                detail = QLabel(
                    f"<span style='color:{sev_colour};'>{sev.upper()}</span> · "
                    f"Confidence: {f.get('confidence', 0):.0%}<br>"
                    f"<b>Drills:</b> {f.get('corrective_drills', 'N/A')}<br>"
                    f"<b>Strength:</b> {f.get('strength_exercises', 'N/A')}<br>"
                    f"<b>Frequency:</b> {f.get('frequency', 'N/A')}"
                )
                detail.setWordWrap(True)
                detail.setStyleSheet("font-size: 11px; color: #8892b0; background: transparent;")
                cl.addWidget(detail)
                self.findings_layout.addWidget(card)
        else:
            self.findings_layout.addWidget(QLabel("No findings — good mechanics observed."))
        self.findings_layout.addStretch()

        # ── Biomechanics tab ───────────────────────────────────
        self._clear_layout(self.bio_layout)
        angles = bio.get("joint_angles", {})
        if angles:
            for name, val in angles.items():
                row = QHBoxLayout()
                lbl = QLabel(name)
                lbl.setStyleSheet("color: #8892b0; font-size: 11px; background: transparent;")
                vlbl = QLabel(f"{val:.0f}°")
                vlbl.setStyleSheet("color: #e6f1ff; font-weight: 600; font-size: 11px; background: transparent;")
                vlbl.setAlignment(Qt.AlignRight)
                row.addWidget(lbl)
                row.addWidget(vlbl)
                self.bio_layout.addLayout(row)

        obs = bio.get("observations", [])
        for o in obs:
            icon = "⚠️" if o.get("type") == "warning" else "ℹ️"
            olbl = QLabel(f"{icon} {o.get('text', '')}  ({o.get('confidence', 0):.0%})")
            olbl.setWordWrap(True)
            olbl.setStyleSheet("font-size: 11px; color: #a8b2d1; background: transparent; padding: 2px;")
            self.bio_layout.addWidget(olbl)

        self.bio_layout.addStretch()

        # ── Strengths / Weaknesses ─────────────────────────────
        self._clear_layout(self.sw_layout)
        sw_title = QLabel("STRENGTHS & AREAS TO IMPROVE")
        sw_title.setObjectName("sectionTitle")
        self.sw_layout.addWidget(sw_title)

        for s in assessment.get("strengths", []):
            self.sw_layout.addWidget(_make_badge(s, "strength"))
        for w in assessment.get("weaknesses", []):
            self.sw_layout.addWidget(_make_badge(w, "weakness"))

    def _clear_layout(self, layout):
        """Remove all widgets from a layout."""
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
            elif item.layout():
                self._clear_layout(item.layout())
