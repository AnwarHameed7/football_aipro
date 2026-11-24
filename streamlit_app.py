"""
Football AI Pro - Main Application
Entry point for the Streamlit-based football analysis platform.

Run with:
    streamlit run streamlit_app.py
"""

import streamlit as st
import cv2
import numpy as np
import tempfile
import os
import time
from typing import Optional

# ── App config (must be first Streamlit call) ──────────────────────────
st.set_page_config(
    page_title="Football AI Pro",
    page_icon="⚽",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Imports ────────────────────────────────────────────────────────────
from ui.styles import inject_styles
from ui.dashboard import (
    render_header,
    render_score_overview,
    render_player_metrics,
    render_speed_chart,
    render_acceleration_chart,
    render_distance_bar,
    render_coach_panel,
    render_strengths_weaknesses,
    render_findings_detail,
    render_timeline,
    render_biomechanics_panel,
    render_player_selector,
)
from core.pipeline import AnalysisPipeline
from analysis.football_iq import FootballAnalyzer
from reports.generator import ReportGenerator
from utils.video_loader import VideoLoader
from config.settings import (
    APP_TITLE,
    VIDEO_EXTENSIONS,
    DEFAULT_PIXELS_PER_METRE,
)

# ── Inject CSS ─────────────────────────────────────────────────────────
inject_styles()

# ── Session state initialisation ───────────────────────────────────────
defaults = {
    "pipeline": None,
    "video_path": None,
    "analysis_done": False,
    "results": None,
    "selected_player": None,
    "football_analyzer": None,
}
for k, v in defaults.items():
    if k not in st.session_state:
        st.session_state[k] = v


# ═══════════════════════════════════════════════════════════════════════
#  SIDEBAR – Input & Settings
# ═══════════════════════════════════════════════════════════════════════
with st.sidebar:
    render_header()

    st.markdown("---")
    st.markdown("### Video Input")

    input_method = st.radio(
        "Source", ["Upload Video", "Paste URL"], horizontal=True, label_visibility="collapsed"
    )

    if input_method == "Upload Video":
        uploaded = st.file_uploader(
            "Upload a football video",
            type=VIDEO_EXTENSIONS,
            help="Supported: MP4, AVI, MOV, MKV, WebM",
        )
        if uploaded is not None and st.session_state.video_path is None:
            with st.spinner("Saving video..."):
                path = VideoLoader.save_upload(uploaded)
                st.session_state.video_path = path
                st.session_state.analysis_done = False
                st.session_state.results = None
                st.rerun()
    else:
        url = st.text_input("Video URL", placeholder="https://...")
        if url and st.button("Download Video"):
            bar = st.progress(0)
            with st.spinner("Downloading..."):
                path = VideoLoader.download_url(url, progress_callback=lambda p: bar.progress(p))
            bar.empty()
            if path:
                st.session_state.video_path = path
                st.session_state.analysis_done = False
                st.session_state.results = None
                st.rerun()
            else:
                st.error("Could not download video. Check the URL and try again.")

    # Settings
    st.markdown("---")
    st.markdown("### Settings")
    px_per_m = st.slider(
        "Pixels per metre (calibration)",
        min_value=5.0, max_value=50.0,
        value=DEFAULT_PIXELS_PER_METRE,
        step=0.5,
        help="Adjust based on camera distance. Higher = more zoomed in.",
    )
    track_all = st.checkbox("Track all players", value=True)
    show_heatmap = st.checkbox("Show heatmap overlay", value=False)
    show_pose = st.checkbox("Show pose overlay", value=True)

    # Clear button
    st.markdown("---")
    if st.button("🗑️ Clear & Reset", use_container_width=True):
        for k in defaults:
            st.session_state[k] = defaults[k]
        st.rerun()


# ═══════════════════════════════════════════════════════════════════════
#  MAIN AREA
# ═══════════════════════════════════════════════════════════════════════

video_path = st.session_state.video_path

if video_path is None:
    # ── Landing state ───────────────────────────────────────────────
    st.markdown(
        '<div class="app-header">'
        '<h1>⚽ Football AI Pro</h1>'
        '<p>Upload a football video to begin AI-powered performance analysis.</p>'
        '</div>',
        unsafe_allow_html=True,
    )
    st.markdown("""
    **What this platform analyses:**

    **Technical** — Ball control, first touch, passing, dribbling, scanning behaviour

    **Physical** — Speed, distance, sprints, acceleration, work rate, fatigue

    **Biomechanical** — Joint angles, posture, running symmetry, stride mechanics

    **Tactical** — Off-ball movement, positioning, direction changes, intensity zones

    **Sports Science** — Weakness detection with corrective drills, injury risk, training plans

    Use the sidebar to upload a video or paste a URL to get started.
    """)
    st.stop()

if not os.path.exists(video_path):
    st.error("Video file not found. Please upload again.")
    st.session_state.video_path = None
    st.stop()


# ═══════════════════════════════════════════════════════════════════════
#  ANALYSIS
# ═══════════════════════════════════════════════════════════════════════

if not st.session_state.analysis_done:
    # ── Initialise pipeline ─────────────────────────────────────────
    if st.session_state.pipeline is None:
        with st.spinner("Loading AI models... (first run may download pose weights)"):
            pipe = AnalysisPipeline(px_per_m=px_per_m)
            st.session_state.pipeline = pipe
            st.session_state.football_analyzer = FootballAnalyzer()

    pipe: AnalysisPipeline = st.session_state.pipeline
    fa: FootballAnalyzer = st.session_state.football_analyzer
    pipe.track_all = track_all

    # ── Read first frame for initialisation ─────────────────────────
    loader = VideoLoader()
    info = loader.open(video_path)
    if info is None:
        st.error("Could not open video file.")
        st.stop()

    ret, first_frame = loader.read_frame()
    loader.release()
    if not ret or first_frame is None:
        st.error("Could not read the video. It may be corrupted.")
        st.stop()

    pipe.initialize(first_frame, fps=info["fps"])

    st.markdown(f"**Video:** {info['width']}×{info['height']} · {info['fps']:.1f} FPS · "
                f"{info['frames']} frames · {info['duration']:.1f}s")

    # ── Player selection (pre-scan first frame) ─────────────────────
    preview_col, info_col = st.columns([2, 1])
    with preview_col:
        preview_rgb = cv2.cvtColor(first_frame, cv2.COLOR_BGR2RGB)
        st.image(preview_rgb, caption="First frame preview", use_container_width=True)

    with info_col:
        st.markdown("### Ready to analyse")
        st.markdown(f"Duration: **{info['duration']:.1f}** seconds")
        st.markdown(f"Resolution: **{info['width']}×{info['height']}**")

    if st.button("🚀 Start Analysis", type="primary", use_container_width=True):
        # ── Main analysis loop ──────────────────────────────────────
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Output video
        out_path = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4").name
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out_writer = cv2.VideoWriter(out_path, fourcc, max(fps, 1), (max(w, 1), max(h, 1)))

        progress = st.progress(0, text="Analysing video...")
        status = st.empty()
        frame_idx = 0
        all_events = []
        t_start = time.time()

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Process through pipeline
            annotated, new_events = pipe.process_frame(
                frame, frame_idx, draw_overlays=show_pose
            )
            all_events.extend(new_events)

            # Apply heatmap if enabled
            if show_heatmap:
                annotated = pipe.apply_heatmap(annotated)

            # Update football analyser for all active players
            for player in pipe.registry.get_active_players():
                fa.update(player, frame_idx)

            out_writer.write(annotated)
            frame_idx += 1

            # Progress updates (every 10 frames)
            if frame_idx % 10 == 0:
                pct = min(frame_idx / max(total_frames, 1), 1.0)
                elapsed = time.time() - t_start
                fps_actual = frame_idx / max(elapsed, 0.001)
                remaining = (total_frames - frame_idx) / max(fps_actual, 0.1)
                progress.progress(pct, text=f"Frame {frame_idx}/{total_frames} · {fps_actual:.0f} FPS · ~{remaining:.0f}s remaining")

        cap.release()
        out_writer.release()
        progress.empty()
        status.empty()

        elapsed = time.time() - t_start

        # ── Build results ───────────────────────────────────────────
        player_data = {}
        for pid in pipe.get_all_player_ids():
            player = pipe.get_player_profile(pid)
            if player is None or player.total_visible_frames < 5:
                continue

            assessment = pipe.get_player_assessment(pid)
            football_analysis = fa.get_analysis(player)
            bio_summary = pipe.biomechanics.get_biomechanics_summary(
                player.latest_pose or {}
            )
            timeline = pipe.event_log.to_timeline_dicts(player_id=pid) if pipe.event_log else []

            player_data[pid] = {
                "profile": player,
                "assessment": assessment,
                "football": football_analysis,
                "biomechanics": bio_summary,
                "timeline": timeline,
                "stats": player.get_stats_dict(),
            }

        st.session_state.results = {
            "output_video": out_path,
            "player_data": player_data,
            "total_frames": frame_idx,
            "elapsed": elapsed,
            "all_events": all_events,
        }
        st.session_state.analysis_done = True
        st.rerun()

    st.stop()


# ═══════════════════════════════════════════════════════════════════════
#  RESULTS DASHBOARD
# ═══════════════════════════════════════════════════════════════════════

results = st.session_state.results
if results is None:
    st.warning("No results available. Please run analysis first.")
    st.stop()

player_data = results.get("player_data", {})
if not player_data:
    st.warning("No players were detected in the video.")
    if st.button("Try Again"):
        st.session_state.analysis_done = False
        st.session_state.results = None
        st.rerun()
    st.stop()

# ── Summary bar ─────────────────────────────────────────────────────
st.success(
    f"Analysis complete: {results['total_frames']} frames in {results['elapsed']:.1f}s "
    f"({results['total_frames'] / max(results['elapsed'], 0.01):.0f} FPS) · "
    f"{len(player_data)} player(s) tracked"
)

# ── Player selector ─────────────────────────────────────────────────
player_ids = sorted(player_data.keys())
player_list = [
    {"player_id": pid, "name": player_data[pid]["stats"].get("name", f"Player {pid}")}
    for pid in player_ids
]

selected_pid = render_player_selector(player_list, st.session_state.selected_player)
st.session_state.selected_player = selected_pid

if selected_pid is None:
    st.stop()

pd_entry = player_data[selected_pid]
assessment = pd_entry["assessment"]
stats = pd_entry["stats"]
player = pd_entry["profile"]
football = pd_entry["football"]
bio = pd_entry["biomechanics"]
timeline = pd_entry["timeline"]

# ── Player name / jersey editor ─────────────────────────────────────
with st.sidebar:
    st.markdown("---")
    st.markdown("### Player Details")
    new_name = st.text_input("Name", value=player.display_name, key=f"name_{selected_pid}")
    if new_name != player.display_name:
        player.display_name = new_name
        stats["name"] = new_name

    new_jersey = st.number_input(
        "Jersey #", min_value=0, max_value=99,
        value=player.jersey_number or 0,
        key=f"jersey_{selected_pid}"
    )
    if new_jersey > 0:
        player.jersey_number = new_jersey

    new_pos = st.selectbox(
        "Position",
        ["", "GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "CF", "ST"],
        index=0,
        key=f"pos_{selected_pid}",
    )
    if new_pos:
        player.position = new_pos

# ── Main layout: Video + Dashboard ──────────────────────────────────
video_col, dash_col = st.columns([3, 2])

with video_col:
    # Video player
    out_video = results.get("output_video")
    if out_video and os.path.exists(out_video):
        with open(out_video, "rb") as vf:
            st.video(vf.read())

    # Heatmap image
    pipe = st.session_state.pipeline
    if pipe:
        hm_img = pipe.heatmap.get_heatmap_image(player_id=selected_pid)
        if hm_img is not None and hm_img.max() > 0:
            hm_rgb = cv2.cvtColor(hm_img, cv2.COLOR_BGR2RGB)
            st.markdown('<div class="dash-panel"><h3>Position Heatmap</h3>', unsafe_allow_html=True)
            st.image(hm_rgb, use_container_width=True)
            st.markdown('</div>', unsafe_allow_html=True)


with dash_col:
    # Score overview
    render_score_overview(assessment)

    # Risk & Fatigue
    risk_col, fat_col = st.columns(2)
    with risk_col:
        risk = assessment.get("risk_level", "Low")
        risk_colour = {"Low": "good", "Moderate": "moderate", "High": "poor"}.get(risk, "moderate")
        st.markdown(
            f'<div class="score-card"><div class="label">Injury Risk</div>'
            f'<div class="value {risk_colour}">{risk}</div></div>',
            unsafe_allow_html=True,
        )
    with fat_col:
        fat = assessment.get("fatigue_pct", 0)
        fat_colour = "good" if fat < 30 else ("moderate" if fat < 60 else "poor")
        st.markdown(
            f'<div class="score-card"><div class="label">Fatigue</div>'
            f'<div class="value {fat_colour}">{fat:.0f}%</div></div>',
            unsafe_allow_html=True,
        )

    # AI Coach
    render_coach_panel(assessment)

    # Body mechanics
    render_biomechanics_panel(bio)


# ── Full-width sections below ───────────────────────────────────────
st.markdown("---")

# Physical metrics
render_player_metrics(stats, assessment)

# Charts
chart_col1, chart_col2 = st.columns(2)
with chart_col1:
    render_speed_chart(player.get_speed_history())
with chart_col2:
    render_acceleration_chart(list(player.accelerations))

# Strengths & Weaknesses
render_strengths_weaknesses(assessment)

# Detailed findings
render_findings_detail(assessment.get("findings", []))

# Timeline
render_timeline(timeline)

# ═══════════════════════════════════════════════════════════════════════
#  EXPORT
# ═══════════════════════════════════════════════════════════════════════
st.markdown("---")
st.markdown("### Export Reports")

exp_cols = st.columns(4)

with exp_cols[0]:
    if st.button("📊 CSV Report", use_container_width=True):
        rg = ReportGenerator()
        csv_path = rg.to_csv(assessment, stats)
        with open(csv_path, "rb") as f:
            st.download_button("Download CSV", f, "football_ai_report.csv", "text/csv")

with exp_cols[1]:
    if st.button("📋 JSON Report", use_container_width=True):
        rg = ReportGenerator()
        json_str = rg.to_json(assessment, stats)
        st.download_button("Download JSON", json_str, "football_ai_report.json", "application/json")

with exp_cols[2]:
    if st.button("📄 PDF Report", use_container_width=True):
        rg = ReportGenerator()
        pdf_path = rg.to_pdf(assessment, stats)
        if pdf_path:
            with open(pdf_path, "rb") as f:
                st.download_button("Download PDF", f, "football_ai_report.pdf", "application/pdf")
        else:
            st.error("PDF generation failed. Ensure fpdf2 is installed.")

with exp_cols[3]:
    if st.button("🏋️ Training Plan", use_container_width=True):
        from analysis.sports_science import SportsScienceEngine
        sse = SportsScienceEngine()
        plan = sse.generate_training_plan(assessment.get("findings", []))
        st.download_button("Download Plan", plan, "training_plan.txt", "text/plain")
