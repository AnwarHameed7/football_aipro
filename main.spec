# -*- mode: python ; coding: utf-8 -*-
# Football AI Pro - PyInstaller Build Spec
#
# Build with:
#   pyinstaller main.spec
#
# Or build from scratch:
#   pyinstaller --onefile --noconsole --name "FootballAIPro" app/main.py

from PyInstaller.utils.hooks import collect_all

datas = [('yolo11n.pt', '.')]
binaries = []
hiddenimports = [
    'config', 'config.settings',
    'core', 'core.pipeline',
    'analysis', 'analysis.ball', 'analysis.biomechanics',
    'analysis.football_iq', 'analysis.sports_science',
    'models', 'models.player', 'models.events',
    'visualization', 'visualization.heatmap',
    'visualization.overlays', 'visualization.charts',
    'reports', 'reports.generator',
    'utils', 'utils.geometry', 'utils.video_loader',
    'ui', 'ui.styles', 'ui.dashboard',
    'app', 'app.main_window', 'app.video_widget',
    'app.dashboard_widget', 'app.analysis_worker', 'app.qss_styles',
]

# Collect ultralytics and PySide6
for pkg in ['ultralytics', 'PySide6']:
    tmp = collect_all(pkg)
    datas += tmp[0]
    binaries += tmp[1]
    hiddenimports += tmp[2]

a = Analysis(
    ['app/main.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FootballAIPro',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
