"""
Football AI Pro - Report Generator
Produces PDF, CSV, and JSON reports from player analysis data.
"""

import json
import os
import tempfile
from datetime import datetime
from typing import Dict, Any, Optional, List

import pandas as pd


class ReportGenerator:
    """Generates comprehensive performance reports in multiple formats."""

    def __init__(self):
        self.generated_at = datetime.now().isoformat()

    def to_json(self, assessment: Dict[str, Any], player_stats: Dict) -> str:
        """Full JSON report."""
        report = {
            "report_type": "Football AI Pro Performance Report",
            "generated_at": self.generated_at,
            "player": player_stats,
            "assessment": {
                "overall_score": assessment.get("overall_score"),
                "technical_score": assessment.get("technical_score"),
                "physical_score": assessment.get("physical_score"),
                "biomechanics_score": assessment.get("biomechanics_score"),
                "tactical_score": assessment.get("tactical_score"),
                "risk_level": assessment.get("risk_level"),
                "fatigue_pct": assessment.get("fatigue_pct"),
            },
            "strengths": assessment.get("strengths", []),
            "weaknesses": assessment.get("weaknesses", []),
            "findings": [
                {
                    "observation": f.get("observation"),
                    "severity": f.get("severity"),
                    "confidence": f.get("confidence"),
                    "corrective_drills": f.get("corrective_drills"),
                    "strength_exercises": f.get("strength_exercises"),
                    "frequency": f.get("frequency"),
                }
                for f in assessment.get("findings", [])
            ],
        }
        return json.dumps(report, indent=2, default=str)

    def to_csv(self, assessment: Dict[str, Any], player_stats: Dict) -> str:
        """CSV of key metrics. Returns path to temp file."""
        rows = []
        row = {
            "player_id": player_stats.get("player_id"),
            "name": player_stats.get("name"),
            "overall_score": assessment.get("overall_score"),
            "technical": assessment.get("technical_score"),
            "physical": assessment.get("physical_score"),
            "biomechanics": assessment.get("biomechanics_score"),
            "tactical": assessment.get("tactical_score"),
            "distance_m": player_stats.get("total_distance_m"),
            "max_speed_ms": player_stats.get("max_speed_ms"),
            "avg_speed_ms": player_stats.get("avg_speed_ms"),
            "sprint_count": player_stats.get("sprint_count"),
            "direction_changes": player_stats.get("direction_changes"),
            "ball_touches": player_stats.get("ball_touches"),
            "work_rate": player_stats.get("work_rate"),
            "fatigue_pct": assessment.get("fatigue_pct"),
            "risk_level": assessment.get("risk_level"),
        }
        rows.append(row)

        # Add finding rows
        for f in assessment.get("findings", []):
            rows.append({
                "player_id": player_stats.get("player_id"),
                "name": player_stats.get("name"),
                "finding": f.get("observation"),
                "severity": f.get("severity"),
                "confidence": f.get("confidence"),
                "corrective": f.get("corrective_drills"),
            })

        df = pd.DataFrame(rows)
        path = os.path.join(tempfile.gettempdir(), f"fai_report_{player_stats.get('player_id', 0)}.csv")
        df.to_csv(path, index=False)
        return path

    def to_pdf(self, assessment: Dict[str, Any], player_stats: Dict) -> Optional[str]:
        """
        Generate a PDF report. Returns path to temp file or None on failure.
        """
        try:
            from fpdf import FPDF
        except ImportError:
            return None

        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()

        # ── Header ─────────────────────────────────────────────────
        pdf.set_font("Helvetica", "B", 20)
        pdf.set_text_color(30, 130, 76)
        pdf.cell(0, 12, "Football AI Pro", ln=True, align="C")
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 6, "Performance Analysis Report", ln=True, align="C")
        pdf.cell(0, 5, f"Generated: {self.generated_at}", ln=True, align="C")
        pdf.ln(8)

        # ── Player Info ────────────────────────────────────────────
        pdf.set_draw_color(30, 130, 76)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(4)

        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        name = player_stats.get("name", "Unknown")
        jersey = player_stats.get("jersey")
        title = f"#{jersey} {name}" if jersey else name
        pdf.cell(0, 8, title, ln=True)
        pos = player_stats.get("position", "")
        if pos:
            pdf.set_font("Helvetica", "", 10)
            pdf.cell(0, 5, f"Position: {pos}", ln=True)
        pdf.ln(6)

        # ── Scores ─────────────────────────────────────────────────
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Performance Scores", ln=True)
        pdf.ln(2)

        scores = [
            ("Overall", assessment.get("overall_score", 0)),
            ("Technical", assessment.get("technical_score", 0)),
            ("Physical", assessment.get("physical_score", 0)),
            ("Biomechanics", assessment.get("biomechanics_score", 0)),
            ("Tactical", assessment.get("tactical_score", 0)),
        ]

        pdf.set_font("Helvetica", "", 10)
        for label, val in scores:
            pdf.cell(50, 6, f"  {label}:", ln=False)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(20, 6, f"{val}/100", ln=True)
            pdf.set_font("Helvetica", "", 10)

        pdf.ln(2)
        pdf.cell(50, 6, f"  Risk Level:", ln=False)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(30, 6, assessment.get("risk_level", "N/A"), ln=True)
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(50, 6, f"  Fatigue:", ln=False)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(30, 6, f"{assessment.get('fatigue_pct', 0):.0f}%", ln=True)
        pdf.ln(6)

        # ── Physical Stats ─────────────────────────────────────────
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, "Physical Metrics", ln=True)
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 10)

        metrics = [
            ("Total Distance", f"{player_stats.get('total_distance_m', 0):.1f} m"),
            ("Max Speed", f"{player_stats.get('max_speed_ms', 0):.2f} m/s"),
            ("Avg Speed", f"{player_stats.get('avg_speed_ms', 0):.2f} m/s"),
            ("Sprint Count", str(player_stats.get("sprint_count", 0))),
            ("Direction Changes", str(player_stats.get("direction_changes", 0))),
            ("Ball Touches", str(player_stats.get("ball_touches", 0))),
            ("Work Rate", player_stats.get("work_rate", "N/A")),
        ]
        for label, val in metrics:
            pdf.cell(55, 5, f"  {label}:", ln=False)
            pdf.cell(40, 5, val, ln=True)
        pdf.ln(6)

        # ── Strengths ──────────────────────────────────────────────
        strengths = assessment.get("strengths", [])
        if strengths:
            pdf.set_font("Helvetica", "B", 13)
            pdf.set_text_color(30, 130, 76)
            pdf.cell(0, 8, "Strengths", ln=True)
            pdf.set_text_color(30, 30, 30)
            pdf.set_font("Helvetica", "", 10)
            for s in strengths:
                pdf.cell(0, 5, f"  + {s}", ln=True)
            pdf.ln(4)

        # ── Weaknesses ─────────────────────────────────────────────
        weaknesses = assessment.get("weaknesses", [])
        if weaknesses:
            pdf.set_font("Helvetica", "B", 13)
            pdf.set_text_color(200, 60, 60)
            pdf.cell(0, 8, "Areas for Improvement", ln=True)
            pdf.set_text_color(30, 30, 30)
            pdf.set_font("Helvetica", "", 10)
            for w in weaknesses:
                pdf.cell(0, 5, f"  - {w}", ln=True)
            pdf.ln(4)

        # ── Findings & Recommendations ─────────────────────────────
        findings = assessment.get("findings", [])
        if findings:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 14)
            pdf.cell(0, 8, "Detailed Findings & Training Recommendations", ln=True)
            pdf.ln(4)

            for i, f in enumerate(findings, 1):
                pdf.set_font("Helvetica", "B", 11)
                pdf.cell(0, 7, f"Finding {i}: {f.get('observation', '')}", ln=True)
                pdf.set_font("Helvetica", "", 9)
                pdf.cell(0, 5, f"  Severity: {f.get('severity', 'N/A').upper()}  |  Confidence: {f.get('confidence', 0):.0%}", ln=True)
                pdf.cell(0, 5, f"  Technical cause: {f.get('likely_technical_cause', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Biomechanical cause: {f.get('likely_biomechanical_cause', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Impact: {f.get('potential_impact', 'N/A')}", ln=True)
                pdf.ln(2)
                pdf.set_font("Helvetica", "I", 9)
                pdf.cell(0, 5, f"  Corrective drills: {f.get('corrective_drills', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Strength work: {f.get('strength_exercises', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Mobility: {f.get('mobility_exercises', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Football-specific: {f.get('football_exercises', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Frequency: {f.get('frequency', 'N/A')}", ln=True)
                pdf.cell(0, 5, f"  Recovery: {f.get('recovery', 'N/A')}", ln=True)
                pdf.ln(6)

        # ── Footer ─────────────────────────────────────────────────
        pdf.set_font("Helvetica", "I", 8)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(0, 5, "Generated by Football AI Pro. Recommendations should be reviewed by a qualified coach.", ln=True, align="C")

        path = os.path.join(tempfile.gettempdir(), f"fai_report_{player_stats.get('player_id', 0)}.pdf")
        pdf.output(path)
        return path
