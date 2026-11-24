"""
Football AI Pro - Qt Stylesheet
Professional dark theme for the PySide6 desktop application.
"""

DARK_THEME = """
/* ── Global ────────────────────────────────────────────── */
QWidget {
    background-color: #0a1628;
    color: #ccd6f6;
    font-family: "Segoe UI", "Inter", "Helvetica Neue", sans-serif;
    font-size: 13px;
}

QMainWindow {
    background-color: #0a1628;
}

/* ── Menu Bar ──────────────────────────────────────────── */
QMenuBar {
    background-color: #0d1f3c;
    color: #ccd6f6;
    border-bottom: 1px solid #1e3a5f;
    padding: 2px;
}
QMenuBar::item:selected {
    background-color: #1e3a5f;
    border-radius: 4px;
}
QMenu {
    background-color: #112240;
    border: 1px solid #1e3a5f;
    border-radius: 6px;
    padding: 4px;
}
QMenu::item {
    padding: 6px 24px;
    border-radius: 4px;
}
QMenu::item:selected {
    background-color: #1e3a5f;
}

/* ── Buttons ───────────────────────────────────────────── */
QPushButton {
    background-color: #1e3a5f;
    color: #e6f1ff;
    border: 1px solid #2a4a7f;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 600;
    min-height: 20px;
}
QPushButton:hover {
    background-color: #2a4a7f;
    border-color: #1db954;
}
QPushButton:pressed {
    background-color: #152a4a;
}
QPushButton:disabled {
    background-color: #0d1f3c;
    color: #4a5568;
    border-color: #1e3a5f;
}
QPushButton#primaryBtn {
    background-color: #1db954;
    color: #ffffff;
    border: none;
    font-size: 14px;
    padding: 10px 24px;
}
QPushButton#primaryBtn:hover {
    background-color: #1ed760;
}
QPushButton#primaryBtn:disabled {
    background-color: #0d4020;
    color: #6b7280;
}

/* ── Labels ────────────────────────────────────────────── */
QLabel {
    color: #ccd6f6;
    background: transparent;
}
QLabel#headerLabel {
    font-size: 22px;
    font-weight: 700;
    color: #e6f1ff;
}
QLabel#subtitleLabel {
    font-size: 12px;
    color: #8892b0;
}
QLabel#sectionTitle {
    font-size: 12px;
    font-weight: 700;
    color: #8892b0;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding-bottom: 4px;
    border-bottom: 1px solid #1e3a5f;
}
QLabel#scoreValue {
    font-size: 28px;
    font-weight: 700;
}
QLabel#scoreLabel {
    font-size: 10px;
    font-weight: 600;
    color: #8892b0;
    text-transform: uppercase;
    letter-spacing: 1px;
}
QLabel#metricValue {
    font-size: 16px;
    font-weight: 700;
    color: #e6f1ff;
}
QLabel#metricLabel {
    font-size: 10px;
    color: #8892b0;
}
QLabel#goodScore { color: #1db954; }
QLabel#moderateScore { color: #f0c040; }
QLabel#poorScore { color: #e84c4c; }

/* ── Panels / Frames ──────────────────────────────────── */
QFrame#dashPanel {
    background-color: #0d1f3c;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    padding: 12px;
}
QFrame#scoreCard {
    background-color: #112240;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    padding: 8px;
    min-width: 80px;
}
QFrame#scoreCard:hover {
    border-color: #1db954;
}
QFrame#coachPanel {
    background-color: #0d1f3c;
    border: 1px solid #1e3a5f;
    border-left: 3px solid #1db954;
    border-radius: 8px;
    padding: 10px;
}
QFrame#strengthBadge {
    background-color: #0a1a0e;
    border-left: 3px solid #1db954;
    border-radius: 0px 6px 6px 0px;
    padding: 6px 10px;
}
QFrame#weaknessBadge {
    background-color: #1a0a0e;
    border-left: 3px solid #e84c4c;
    border-radius: 0px 6px 6px 0px;
    padding: 6px 10px;
}
QFrame#videoFrame {
    background-color: #000000;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
}
QFrame#timelinePanel {
    background-color: #0d1f3c;
    border-top: 1px solid #1e3a5f;
}

/* ── Scroll Areas ──────────────────────────────────────── */
QScrollArea {
    border: none;
    background: transparent;
}
QScrollBar:vertical {
    background: #0a1628;
    width: 8px;
    border-radius: 4px;
}
QScrollBar::handle:vertical {
    background: #1e3a5f;
    border-radius: 4px;
    min-height: 30px;
}
QScrollBar::handle:vertical:hover {
    background: #2a4a7f;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0px;
}

/* ── Inputs ────────────────────────────────────────────── */
QLineEdit, QSpinBox, QComboBox {
    background-color: #112240;
    color: #e6f1ff;
    border: 1px solid #1e3a5f;
    border-radius: 6px;
    padding: 6px 10px;
    selection-background-color: #1db954;
}
QLineEdit:focus, QSpinBox:focus, QComboBox:focus {
    border-color: #1db954;
}
QComboBox::drop-down {
    border: none;
    width: 24px;
}
QComboBox QAbstractItemView {
    background-color: #112240;
    border: 1px solid #1e3a5f;
    selection-background-color: #1e3a5f;
}

/* ── Progress Bar ──────────────────────────────────────── */
QProgressBar {
    background-color: #112240;
    border: 1px solid #1e3a5f;
    border-radius: 6px;
    text-align: center;
    color: #e6f1ff;
    font-size: 11px;
    height: 22px;
}
QProgressBar::chunk {
    background-color: #1db954;
    border-radius: 5px;
}

/* ── Slider ────────────────────────────────────────────── */
QSlider::groove:horizontal {
    background: #1e3a5f;
    height: 6px;
    border-radius: 3px;
}
QSlider::handle:horizontal {
    background: #1db954;
    width: 14px;
    height: 14px;
    margin: -4px 0;
    border-radius: 7px;
}

/* ── Tabs ──────────────────────────────────────────────── */
QTabWidget::pane {
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    background-color: #0a1628;
}
QTabBar::tab {
    background-color: #0d1f3c;
    color: #8892b0;
    padding: 8px 16px;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    margin-right: 2px;
}
QTabBar::tab:selected {
    background-color: #112240;
    color: #e6f1ff;
    border-bottom: 2px solid #1db954;
}

/* ── Splitter ──────────────────────────────────────────── */
QSplitter::handle {
    background-color: #1e3a5f;
    width: 2px;
}

/* ── Status Bar ────────────────────────────────────────── */
QStatusBar {
    background-color: #0d1f3c;
    color: #8892b0;
    border-top: 1px solid #1e3a5f;
    font-size: 11px;
}

/* ── Checkbox ──────────────────────────────────────────── */
QCheckBox {
    color: #ccd6f6;
    spacing: 6px;
}
QCheckBox::indicator {
    width: 16px;
    height: 16px;
    border: 1px solid #1e3a5f;
    border-radius: 4px;
    background-color: #112240;
}
QCheckBox::indicator:checked {
    background-color: #1db954;
    border-color: #1db954;
}

/* ── GroupBox ──────────────────────────────────────────── */
QGroupBox {
    font-weight: 600;
    color: #8892b0;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    margin-top: 12px;
    padding-top: 16px;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 12px;
    padding: 0 6px;
}
"""
