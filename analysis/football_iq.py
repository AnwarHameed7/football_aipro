"""
Football AI Pro - Football / Tactical Analyser
Analyses movement quality, off-ball movement, work rate, positioning,
and football-specific metrics derived from tracking data.

NOTE: Many "tactical" observations are inferences from movement data
and are reported with appropriate confidence rather than certainty.
"""

import math
from typing import Dict, Any, List, Optional
from collections import deque

from config.settings import (
    SPRINT_SPEED_THRESHOLD,
    HIGH_INTENSITY_THRESHOLD,
    JOG_SPEED_THRESHOLD,
    DIRECTION_CHANGE_ANGLE,
)
from utils.geometry import distance_2d, direction_angle, angle_difference


class FootballAnalyzer:
    """
    Continuously accumulates football-specific observations per player.
    Call ``update()`` every frame, then ``get_analysis()`` at any time.
    """

    def __init__(self):
        # Per-player rolling buffers
        self._speed_zones: Dict[int, Dict[str, int]] = {}
        self._movement_patterns: Dict[int, deque] = {}
        self._scan_count: Dict[int, int] = {}

    def update(self, player, frame_idx: int):
        """Feed latest player state. Called every processed frame."""
        pid = player.player_id

        # Speed zone counting
        if pid not in self._speed_zones:
            self._speed_zones[pid] = {
                "sprint": 0, "high_intensity": 0,
                "jog": 0, "walk": 0, "stationary": 0,
            }
        s = player.current_speed
        if s >= SPRINT_SPEED_THRESHOLD:
            self._speed_zones[pid]["sprint"] += 1
        elif s >= HIGH_INTENSITY_THRESHOLD:
            self._speed_zones[pid]["high_intensity"] += 1
        elif s >= JOG_SPEED_THRESHOLD:
            self._speed_zones[pid]["jog"] += 1
        elif s >= 0.5:
            self._speed_zones[pid]["walk"] += 1
        else:
            self._speed_zones[pid]["stationary"] += 1

        # Movement pattern (recent directions for agility analysis)
        if pid not in self._movement_patterns:
            self._movement_patterns[pid] = deque(maxlen=60)
        positions = list(player.positions)
        if len(positions) >= 2:
            bearing = direction_angle(positions[-2], positions[-1])
            self._movement_patterns[pid].append(bearing)

        # Scan count from head direction (biomechanics data)
        if player.latest_pose and player.latest_pose.get("head_direction") in ("looking_left", "looking_right"):
            self._scan_count[pid] = self._scan_count.get(pid, 0) + 1

    def get_analysis(self, player) -> Dict[str, Any]:
        """
        Return the full football analysis for a player.
        Confidence levels are attached where metrics are inferred.
        """
        pid = player.player_id
        stats = player.get_stats_dict()
        zones = self._speed_zones.get(pid, {})

        total_frames = sum(zones.values()) if zones else 1
        if total_frames == 0:
            total_frames = 1

        # Speed zone percentages
        zone_pct = {k: round(v / total_frames * 100, 1) for k, v in zones.items()}

        # Agility score (direction changes per 100 frames, weighted by speed)
        agility = 0
        if player.total_visible_frames > 0:
            agility = min(100, int(
                player.direction_changes / max(1, player.total_visible_frames) * 100 * 5
            ))

        # Movement quality score
        movement_score = self._compute_movement_score(player, zones)

        # Work rate assessment
        work_rate_detail = self._assess_work_rate(player, zones)

        # Scanning frequency estimate
        scans = self._scan_count.get(pid, 0)
        scan_rate = round(scans / max(1, player.total_visible_frames) * 30 * 60, 1)  # per minute

        # Off-ball movement assessment
        off_ball = self._assess_off_ball(player)

        return {
            "speed_zones_pct": zone_pct,
            "agility_score": agility,
            "movement_quality_score": movement_score,
            "work_rate": work_rate_detail,
            "scanning_estimate": {
                "head_turns_per_min": scan_rate,
                "confidence": 0.5,  # head-turn detection from pose is approximate
                "note": "Estimated from head orientation changes",
            },
            "off_ball_movement": off_ball,
            "ball_touches": player.ball_touches,
            "direction_changes": player.direction_changes,
            "sprint_count": player.sprint_count,
            "total_distance_m": stats["total_distance_m"],
            "max_speed_ms": stats["max_speed_ms"],
            "avg_speed_ms": stats["avg_speed_ms"],
        }

    def _compute_movement_score(self, player, zones: Dict) -> int:
        """
        Composite movement quality score (0-100).
        Considers variety of movement, direction changes, and intensity distribution.
        """
        score = 50  # baseline

        # Reward diverse speed zones
        active_zones = sum(1 for v in zones.values() if v > 0)
        score += active_zones * 3

        # Reward sprints
        score += min(20, player.sprint_count * 2)

        # Reward direction changes (agility)
        score += min(15, player.direction_changes // 5)

        # Reward work rate
        if player.work_rate == "High":
            score += 10
        elif player.work_rate == "Low":
            score -= 10

        # Penalty for excessive stationary time
        total = sum(zones.values()) or 1
        stat_pct = zones.get("stationary", 0) / total * 100
        if stat_pct > 50:
            score -= 15
        elif stat_pct > 30:
            score -= 5

        return max(0, min(100, score))

    def _assess_work_rate(self, player, zones: Dict) -> Dict[str, Any]:
        """Detailed work rate assessment."""
        total = sum(zones.values()) or 1
        active_pct = (1 - zones.get("stationary", 0) / total) * 100

        if active_pct > 75:
            level = "Excellent"
        elif active_pct > 55:
            level = "Good"
        elif active_pct > 35:
            level = "Moderate"
        else:
            level = "Low"

        return {
            "level": level,
            "active_pct": round(active_pct, 1),
            "high_intensity_pct": round(
                (zones.get("sprint", 0) + zones.get("high_intensity", 0)) / total * 100, 1
            ),
        }

    def _assess_off_ball(self, player) -> Dict[str, Any]:
        """
        Estimate off-ball movement quality.
        Since we cannot always determine possession, this is a proxy
        based on movement when not touching the ball.
        """
        if player.total_visible_frames < 30:
            return {"quality": "Insufficient data", "confidence": 0.0}

        # If the player has few ball touches but lots of movement, off-ball is good
        touch_ratio = player.ball_touches / max(1, player.total_visible_frames)
        non_touch_frames = player.total_visible_frames - player.ball_touches

        if non_touch_frames < 10:
            return {"quality": "Mostly on ball", "confidence": 0.4}

        # Movement during non-touch frames (proxy: overall movement minus touch moments)
        avg_speed = player.average_speed
        if avg_speed > 3.0:
            quality = "Active – consistent movement off the ball"
        elif avg_speed > 1.5:
            quality = "Moderate – could increase off-ball movement"
        else:
            quality = "Limited – appears static when not on ball"

        return {
            "quality": quality,
            "confidence": 0.45,
            "note": "Inferred from movement patterns; accuracy depends on video coverage",
        }
