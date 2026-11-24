"""
Football AI Pro - Desktop Application Entry Point

Run with:
    python -m app.main

Or from project root:
    python app/main.py
"""

import sys
import os

# Ensure the project root is in the path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt
from PySide6.QtGui import QFont

from app.main_window import MainWindow
from app.qss_styles import DARK_THEME


def main():
    # High-DPI support
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName("Football AI Pro")
    app.setOrganizationName("Football AI")

    # Apply stylesheet
    app.setStyleSheet(DARK_THEME)

    # Default font
    font = QFont("Segoe UI", 10)
    font.setHintingPreference(QFont.PreferFullHinting)
    app.setFont(font)

    # Main window
    window = MainWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
