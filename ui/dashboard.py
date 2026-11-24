"""
Football AI Pro - Dashboard UI Components
Streamlit component functions for the professional dashboard layout.
All coaching feedback goes into the sidebar/panels, never above players.
"""

import streamlit as st
import numpy as np
from typing import Dict, Any, List, Optional

from visualization.charts import (
    create_speed_graph,
    create_acceleration_graph,
    create_distance_bar,
    create_zone_pie,
    create_score_gauge,
)


def render_header():
    """Render the app header."""
    st.markdown(
        '<div class="app-header">'
        '<h1>Football AI Pro</h1>'
        '<p>Professional AI Football Performance Analysis</p>'
        '</div>',
        unsafe_allow_html=True,
    )


def render_score_overview(assessment: Dict[str, Any]):
    """Render the score cards row."""
    scores = [
        ("Overall", assessment.get("overall_score", 0)),
        ("Technical", assessment.get("technical_score", 0)),
        ("Physical", assessment.get("physical_score", 0)),
        ("Biomechanics", assessment.get("biomechanics_score", 0)),
        ("Tactical", assessment.get("tactical_score", 0)),
    ]

    cols = st.columns(len(scores))
    for col, (label, value) in zip(cols, scores):
        cls = "good" if value >= 70 else ("moderate" if value >= 40 else "poor")
        with col:
            st.markdown(
                f'<div class="score-card">'
                f'<div class="label">{label}</div>'
                f'<div class="value {cls}">{value}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )


def render_player_metrics(player_stats: Dict[str, Any], assessment: Dict[str, Any]):
    """Render the physical metrics panel."""
    st.markdown('<div class="dash-panel"><h3>Physical Metrics</h3>', unsafe_allow_html=True)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Distance", f"{player_stats.get('total_distance_m', 0):.1f}m")
    c2.metric("Max Speed", f"{player_stats.get('max_speed_ms', 0):.1f} m/s")
    c3.metric("Sprints", str(player_stats.get("sprint_count", 0)))
    c4.metric("Dir. Changes", str(player_stats.get("direction_changes", 0)))

    c5, c6, c7, c8 = st.columns(4)
    c5.metric("Avg Speed", f"{player_stats.get('avg_speed_ms', 0):.1f} m/s")
    c6.metric("Ball Touches", str(player_stats.get("ball_touches", 0)))
    c7.metric("Work Rate", player_stats.get("work_rate", "N/A"))
    c8.metric("Fatigue", f"{assessment.get('fatigue_pct', 0):.0f}%")

    st.markdown('</div>', unsafe_allow_html=True)


def render_speed_chart(speed_history: List[float]):
    """Render the speed over time graph."""
    if len(speed_history) < 5:
        return
    st.markdown('<div class="dash-panel"><h3>Speed Profile</h3>', unsafe_allow_html=True)
    chart = create_speed_graph(speed_history, width=500, height=160)
    st.image(chart, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)


def render_acceleration_chart(acc_history: List[float]):
    """Render acceleration/deceleration graph."""
    if len(acc_history) < 5:
        return
    st.markdown('<div class="dash-panel"><h3>Acceleration / Deceleration</h3>', unsafe_allow_html=True)
    chart = create_acceleration_graph(acc_history, width=500, height=120)
    st.image(chart, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)


def render_distance_bar(distance: float, max_dist: float = 500.0):
    """Render the distance progress bar."""
    chart = create_distance_bar(distance, max_dist)
    st.image(chart, use_container_width=True)


def render_coach_panel(assessment: Dict[str, Any]):
    """Render the AI Coach panel with observations."""
    st.markdown('<div class="dash-panel"><h3>AI Coach</h3>', unsafe_allow_html=True)

    findings = assessment.get("findings", [])
    if findings:
        latest = findings[-1]
        st.info(f"**{latest.get('observation', '')}**\n\n"
                f"Drill: {latest.get('corrective_drills', 'N/A')}")
    else:
        st.success("Good mechanics observed. Maintain current technique.")

    st.markdown('</div>', unsafe_allow_html=True)


def render_strengths_weaknesses(assessment: Dict[str, Any]):
    """Render strengths and weaknesses lists."""
    col1, col2 = st.columns(2)

    with col1:
        st.markdown('<div class="dash-panel"><h3>Strengths</h3>', unsafe_allow_html=True)
        for s in assessment.get("strengths", []):
            st.markdown(f'<div class="strength-badge">{s}</div>', unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)

    with col2:
        st.markdown('<div class="dash-panel"><h3>Areas to Improve</h3>', unsafe_allow_html=True)
        for w in assessment.get("weaknesses", []):
            st.markdown(f'<div class="weakness-badge">{w}</div>', unsafe_allow_html=True)
        if not assessment.get("weaknesses"):
            st.markdown('<div class="strength-badge">No significant issues detected</div>',
                        unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)


def render_findings_detail(findings: List[Dict]):
    """Render detailed finding cards with drill recommendations."""
    if not findings:
        return

    st.markdown('<div class="dash-panel"><h3>Detailed Findings & Drills</h3>', unsafe_allow_html=True)

    for f in findings:
        sev = f.get("severity", "low")
        sev_cls = f"severity-{sev}"

        st.markdown(
            f'<div class="finding-card">'
            f'<div class="title">{f.get("observation", "")}</div>'
            f'<div class="detail">'
            f'<span class="{sev_cls}">Severity: {sev.upper()}</span> &middot; '
            f'Confidence: {f.get("confidence", 0):.0%}<br>'
            f'<b>Cause:</b> {f.get("likely_technical_cause", "N/A")}<br>'
            f'<b>Drills:</b> {f.get("corrective_drills", "N/A")}<br>'
            f'<b>Strength:</b> {f.get("strength_exercises", "N/A")}<br>'
            f'<b>Frequency:</b> {f.get("frequency", "N/A")}'
            f'</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown('</div>', unsafe_allow_html=True)


def render_timeline(events: List[Dict]):
    """Render the event timeline panel."""
    if not events:
        return

    st.markdown('<div class="dash-panel"><h3>Timeline</h3>', unsafe_allow_html=True)

    for evt in events[-20:]:  # show last 20
        sev = evt.get("severity", "info")
        st.markdown(
            f'<div class="timeline-event {sev}">'
            f'<span class="time">{evt.get("time", "")}</span>'
            f'{evt.get("description", "")}'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown('</div>', unsafe_allow_html=True)


def render_biomechanics_panel(bio_summary: Dict[str, Any]):
    """Render biomechanics observations."""
    st.markdown('<div class="dash-panel"><h3>Body Mechanics</h3>', unsafe_allow_html=True)

    # Joint angles
    angles = bio_summary.get("joint_angles", {})
    if angles:
        for name, val in angles.items():
            st.markdown(
                f'<div class="metric-row">'
                f'<span class="metric-label">{name}</span>'
                f'<span class="metric-value">{val:.0f}°</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

    # Observations
    obs = bio_summary.get("observations", [])
    for o in obs:
        icon = "⚠️" if o.get("type") == "warning" else "ℹ️"
        conf = o.get("confidence", 0)
        st.markdown(
            f'<div class="metric-row">'
            f'<span class="metric-label">{icon} {o.get("text", "")}</span>'
            f'<span class="metric-value">{conf:.0%}</span>'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown('</div>', unsafe_allow_html=True)


def render_player_selector(players: List[Dict], current_id: Optional[int] = None) -> Optional[int]:
    """Render player selection with mini cards. Returns selected player ID."""
    if not players:
        return None

    options = {p["player_id"]: p for p in players}
    labels = [f"Player {p['player_id']} – {p.get('name', '')}" for p in players]
    ids = [p["player_id"] for p in players]

    default_idx = ids.index(current_id) if current_id in ids else 0
    selected = st.selectbox(
        "Select Player",
        ids,
        index=default_idx,
        format_func=lambda x: f"Player {x} – {options[x].get('name', '')}",
    )
    return selected
