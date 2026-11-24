"""
Football AI Pro - UI Styles
Professional dark-theme CSS for the Streamlit dashboard.
"""

MAIN_CSS = """
<style>
/* ── Global ─────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.stApp {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ── Header ─────────────────────────────────────────────── */
.app-header {
    background: linear-gradient(135deg, #0a1628 0%, #112240 100%);
    padding: 1.2rem 1.5rem;
    border-radius: 10px;
    border-left: 4px solid #1db954;
    margin-bottom: 1rem;
}
.app-header h1 {
    color: #e6f1ff;
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
}
.app-header p {
    color: #8892b0;
    font-size: 0.85rem;
    margin: 0.2rem 0 0 0;
}

/* ── Score cards ────────────────────────────────────────── */
.score-card {
    background: #112240;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    text-align: center;
    border: 1px solid #1e3a5f;
    transition: border-color 0.2s;
}
.score-card:hover {
    border-color: #1db954;
}
.score-card .label {
    color: #8892b0;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.3rem;
}
.score-card .value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #e6f1ff;
}
.score-card .value.good { color: #1db954; }
.score-card .value.moderate { color: #f0c040; }
.score-card .value.poor { color: #e84c4c; }

/* ── Dashboard panel ────────────────────────────────────── */
.dash-panel {
    background: #0a1628;
    border-radius: 8px;
    padding: 1rem;
    border: 1px solid #1e3a5f;
    margin-bottom: 0.75rem;
}
.dash-panel h3 {
    color: #ccd6f6;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 0.7rem 0;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid #1e3a5f;
}

/* ── Weakness / Strength badges ─────────────────────────── */
.weakness-badge {
    background: #1a0a0e;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid #e84c4c;
    border-radius: 0 6px 6px 0;
    margin: 0.3rem 0;
    font-size: 0.82rem;
    color: #f5c6c6;
}
.strength-badge {
    background: #0a1a0e;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid #1db954;
    border-radius: 0 6px 6px 0;
    margin: 0.3rem 0;
    font-size: 0.82rem;
    color: #b4f0c9;
}

/* ── AI Coach panel ─────────────────────────────────────── */
.coach-panel {
    background: #0d1f3c;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    border: 1px solid #1e3a5f;
    border-left: 3px solid #1db954;
    max-height: 200px;
    overflow-y: auto;
}
.coach-panel .observation {
    color: #a8b2d1;
    font-size: 0.8rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid #152a4a;
}
.coach-panel .observation:last-child {
    border-bottom: none;
}

/* ── Timeline ───────────────────────────────────────────── */
.timeline-event {
    background: #0d1f3c;
    border-radius: 6px;
    padding: 0.4rem 0.7rem;
    margin: 0.2rem 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: #a8b2d1;
}
.timeline-event .time {
    color: #64ffda;
    font-weight: 600;
    min-width: 40px;
}
.timeline-event.warning {
    border-left: 2px solid #f0c040;
}
.timeline-event.alert {
    border-left: 2px solid #e84c4c;
}
.timeline-event.info {
    border-left: 2px solid #1db954;
}

/* ── Metric row ─────────────────────────────────────────── */
.metric-row {
    display: flex;
    justify-content: space-between;
    padding: 0.25rem 0;
    border-bottom: 1px solid #152a4a;
    font-size: 0.8rem;
}
.metric-row .metric-label { color: #8892b0; }
.metric-row .metric-value { color: #ccd6f6; font-weight: 600; }

/* ── Finding card ───────────────────────────────────────── */
.finding-card {
    background: #112240;
    border-radius: 8px;
    padding: 0.8rem 1rem;
    border: 1px solid #1e3a5f;
    margin: 0.5rem 0;
}
.finding-card .title {
    color: #ccd6f6;
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 0.3rem;
}
.finding-card .detail {
    color: #8892b0;
    font-size: 0.78rem;
    line-height: 1.5;
}
.finding-card .severity-high { color: #e84c4c; }
.finding-card .severity-moderate { color: #f0c040; }
.finding-card .severity-low { color: #64ffda; }

/* ── Player selector ────────────────────────────────────── */
.player-card-mini {
    background: #112240;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    border: 1px solid #1e3a5f;
    margin: 0.3rem 0;
    cursor: pointer;
}
.player-card-mini:hover {
    border-color: #1db954;
}
.player-card-mini .player-name {
    color: #e6f1ff;
    font-weight: 600;
    font-size: 0.85rem;
}
.player-card-mini .player-stat {
    color: #8892b0;
    font-size: 0.72rem;
}

/* ── Export section ──────────────────────────────────────── */
.export-section {
    background: #0a1628;
    border-radius: 8px;
    padding: 0.8rem;
    border: 1px solid #1e3a5f;
}

/* ── Streamlit overrides for dark theme ─────────────────── */
.stProgress > div > div { background-color: #1db954; }
.stMetric label { color: #8892b0 !important; }
.stMetric [data-testid="stMetricValue"] { color: #e6f1ff !important; }

</style>
"""


def inject_styles():
    """Call at top of Streamlit app to inject all CSS."""
    import streamlit as st
    st.markdown(MAIN_CSS, unsafe_allow_html=True)
