"""
Football AI Pro - Player Data Model
Every tracked player carries a persistent profile that survives occlusion
and frame exits.  The profile accumulates physical, technical, and
biomechanical data throughout the session.
"""

from __future__ import annotations
import math
import time
import numpy as np
import cv2
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, List, Tuple, Dict, Any

from config.settings import (
    TRACK_HISTORY_LEN,
    REID_HISTOGRAM_BINS,
    DEFAULT_PIXELS_PER_METRE,
    SPRINT_SPEED_THRESHOLD,
    HIGH_INTENSITY_THRESHOLD,
    FATIGUE_SPEED_DROP_PERCENT,
)
from utils.geometry import distance_2d, velocity_from_positions, acceleration_from_speeds


@dataclass
class PlayerProfile:
    """Full persistent profile for one player across the whole video."""

    player_id: int
    display_name: str = ""
    jersey_number: Optional[int] = None
    position: str = ""  # e.g. "CM", "LW"

    # ── Appearance ──────────────────────────────────────────────────
    colour_histogram: Optional[np.ndarray] = None
    dominant_colour: Optional[Tuple[int, int, int]] = None
    body_height_px: float = 0.0  # average bbox height in pixels

    # ── Tracking state ──────────────────────────────────────────────
    is_active: bool = True
    first_seen_frame: int = 0
    last_seen_frame: int = 0
    total_visible_frames: int = 0
    last_bbox: Optional[List[int]] = None
    confidence: float = 1.0

    # ── Position / movement history  (deques for memory efficiency) ─
    positions: deque = field(default_factory=lambda: deque(maxlen=TRACK_HISTORY_LEN))
    speeds: deque = field(default_factory=lambda: deque(maxlen=TRACK_HISTORY_LEN))
    accelerations: deque = field(default_factory=lambda: deque(maxlen=TRACK_HISTORY_LEN))
    directions: deque = field(default_factory=lambda: deque(maxlen=TRACK_HISTORY_LEN))

    # ── Cumulative metrics ──────────────────────────────────────────
    total_distance_px: float = 0.0
    pixels_per_metre: float = DEFAULT_PIXELS_PER_METRE
    _segment_start: int = 0
    max_speed: float = 0.0          # m/s
    sprint_count: int = 0
    high_intensity_count: int = 0
    direction_changes: int = 0
    ball_touches: int = 0
    _in_sprint: bool = False

    # ── Biomechanics snapshots ──────────────────────────────────────
    pose_history: deque = field(default_factory=lambda: deque(maxlen=120))
    latest_pose: Optional[Dict[str, Any]] = None

    # ── Heatmap accumulator (lightweight – per-player mini heatmap) ─
    _heat_points: List[Tuple[int, int]] = field(default_factory=list)

    def __post_init__(self):
        if not self.display_name:
            self.display_name = f"Player {self.player_id}"

    # ── Appearance extraction ───────────────────────────────────────
    def update_appearance(self, frame: np.ndarray, bbox: List[int]):
        """Extract colour histogram and dominant colour from the torso region."""
        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return

        # Use middle 60% vertically (torso, avoiding head/feet)
        rh = roi.shape[0]
        t_start = int(rh * 0.2)
        t_end = int(rh * 0.8)
        torso = roi[t_start:t_end, :]
        if torso.size == 0:
            torso = roi

        hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist(
            [hsv], [0, 1], None,
            list(REID_HISTOGRAM_BINS), [0, 180, 0, 256]
        )
        cv2.normalize(hist, hist)
        self.colour_histogram = hist

        # Dominant colour (BGR mean of torso)
        mean_bgr = cv2.mean(torso)[:3]
        self.dominant_colour = (int(mean_bgr[0]), int(mean_bgr[1]), int(mean_bgr[2]))

        # Average body height
        bh = y2 - y1
        if self.body_height_px == 0:
            self.body_height_px = bh
        else:
            self.body_height_px = self.body_height_px * 0.9 + bh * 0.1

    # ── Per-frame update ────────────────────────────────────────────
    def update(
        self,
        frame_idx: int,
        bbox: List[int],
        frame: np.ndarray,
        fps: float = 30.0,
        px_per_m: float = DEFAULT_PIXELS_PER_METRE,
    ):
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        pos = (cx, cy)

        self.pixels_per_metre = px_per_m
        if self.total_visible_frames and frame_idx != self.last_seen_frame + 1:
            self._segment_start = frame_idx
            self._in_sprint = False
            self.latest_pose = None

        # A new observation after a gap begins a new movement segment.
        segment_frames = frame_idx - max(self.first_seen_frame, self._segment_start) + 1
        if self.positions and segment_frames > 1:
            d = distance_2d(self.positions[-1], pos)
            self.total_distance_px += d
        self.positions.append(pos)
        self._heat_points.append((int(cx), int(cy)))

        # Speed (m/s)
        speed = velocity_from_positions(
            list(self.positions)[-segment_frames:], window=4, fps=fps, px_per_m=px_per_m
        )
        self.speeds.append(speed)
        if speed > self.max_speed:
            self.max_speed = speed

        # Acceleration
        acc = acceleration_from_speeds(list(self.speeds)[-segment_frames:], fps=fps)
        self.accelerations.append(acc)

        # Sprint detection
        if speed >= SPRINT_SPEED_THRESHOLD:
            if not self._in_sprint:
                self.sprint_count += 1
                self._in_sprint = True
        else:
            self._in_sprint = False

        if speed >= HIGH_INTENSITY_THRESHOLD:
            self.high_intensity_count += 1

        # Direction changes
        if len(self.positions) >= 3 and segment_frames >= 3:
            p1, p2, p3 = list(self.positions)[-3:]
            d1 = (p2[0] - p1[0], p2[1] - p1[1])
            d2 = (p3[0] - p2[0], p3[1] - p2[1])
            m1 = math.hypot(*d1)
            m2 = math.hypot(*d2)
            if m1 > 1 and m2 > 1:
                cos_a = (d1[0] * d2[0] + d1[1] * d2[1]) / (m1 * m2)
                cos_a = max(-1, min(1, cos_a))
                angle = math.degrees(math.acos(cos_a))
                if angle > 45:
                    self.direction_changes += 1

        # Metadata
        self.last_seen_frame = frame_idx
        self.total_visible_frames += 1
        self.last_bbox = bbox
        self.is_active = True

        # Appearance (update every ~30 frames to save CPU)
        if self.total_visible_frames % 30 == 1 or self.colour_histogram is None:
            self.update_appearance(frame, bbox)

    # ── Derived statistics ──────────────────────────────────────────
    @property
    def current_speed(self) -> float:
        return self.speeds[-1] if self.speeds else 0.0

    @property
    def current_acceleration(self) -> float:
        return self.accelerations[-1] if self.accelerations else 0.0

    @property
    def average_speed(self) -> float:
        if not self.speeds:
            return 0.0
        return sum(self.speeds) / len(self.speeds)

    @property
    def total_distance_m(self) -> float:
        return self.total_distance_px / self.pixels_per_metre

    @property
    def work_rate(self) -> str:
        d = self.total_distance_m
        if d > 200:
            return "High"
        if d > 80:
            return "Medium"
        return "Low"

    @property
    def fatigue_estimate(self) -> float:
        """
        Estimate fatigue as percentage, based on speed drop from peak
        over the second half of visible frames.
        Returns 0-100 where 100 = fully fatigued.
        """
        if len(self.speeds) < 20:
            return 0.0
        half = len(self.speeds) // 2
        first_half = list(self.speeds)[:half]
        second_half = list(self.speeds)[half:]
        peak = max(first_half) if first_half else 1.0
        if peak < 0.5:
            return 0.0
        recent_avg = sum(second_half) / len(second_half)
        drop = max(0, (peak - recent_avg) / peak) * 100
        return min(100.0, drop * (100 / FATIGUE_SPEED_DROP_PERCENT))

    @property
    def movement_intensity(self) -> str:
        s = self.current_speed
        if s >= SPRINT_SPEED_THRESHOLD:
            return "Sprinting"
        if s >= HIGH_INTENSITY_THRESHOLD:
            return "High Intensity"
        if s >= 2.0:
            return "Jogging"
        if s >= 0.5:
            return "Walking"
        return "Stationary"

    def get_position_path(self, continuous_only: bool = False) -> List[Tuple[int, int]]:
        positions = [(int(p[0]), int(p[1])) for p in self.positions]
        if continuous_only:
            segment_frames = self.last_seen_frame - max(self.first_seen_frame, self._segment_start) + 1
            return positions[-segment_frames:]
        return positions

    def get_heat_points(self) -> List[Tuple[int, int]]:
        return self._heat_points

    def get_speed_history(self) -> List[float]:
        return list(self.speeds)

    def get_stats_dict(self) -> Dict[str, Any]:
        return {
            "player_id": self.player_id,
            "name": self.display_name,
            "jersey": self.jersey_number,
            "position": self.position,
            "total_distance_m": round(self.total_distance_m, 1),
            "max_speed_ms": round(self.max_speed, 2),
            "avg_speed_ms": round(self.average_speed, 2),
            "sprint_count": self.sprint_count,
            "high_intensity_runs": self.high_intensity_count,
            "direction_changes": self.direction_changes,
            "ball_touches": self.ball_touches,
            "work_rate": self.work_rate,
            "fatigue_pct": round(self.fatigue_estimate, 1),
            "frames_visible": self.total_visible_frames,
            "movement_intensity": self.movement_intensity,
        }


class PlayerRegistry:
    """
    Central registry mapping internal tracker IDs → persistent PlayerProfiles.

    Handles the #1 problem in sports tracking: ID switches.
    When the tracker assigns a new ID, this registry tries three strategies
    before creating a genuinely new player:

      1. SPATIAL MATCH against ACTIVE players — did a new ID appear right
         where an existing player was standing?  (strongest signal)
      2. SPATIAL + APPEARANCE match against LOST players — did the player
         temporarily disappear and come back nearby with similar colours?
      3. APPEARANCE-ONLY match against LOST players — for longer absences
         where position alone isn't reliable.
    """

    def __init__(self):
        self.profiles: Dict[int, PlayerProfile] = {}
        self._tracker_id_map: Dict[int, int] = {}     # tracker_id → player_id
        self._next_player_id: int = 1
        self._lost_profiles: Dict[int, PlayerProfile] = {}
        self._seen_this_frame: set = set()             # player_ids updated this frame

    def begin_frame(self):
        """Call at the start of every frame before processing detections."""
        self._seen_this_frame = set()

    def get_or_create(
        self,
        tracker_id: int,
        bbox: List[int],
        frame: np.ndarray,
        frame_idx: int,
    ) -> PlayerProfile:
        """
        Map a tracker ID to a persistent player, using spatial and
        appearance matching to prevent ID switches.
        """
        # ── Fast path: tracker ID already known ────────────────
        if tracker_id in self._tracker_id_map:
            pid = self._tracker_id_map[tracker_id]
            if pid in self.profiles:
                self._seen_this_frame.add(pid)
                return self.profiles[pid]
            # Stale mapping — fall through to re-match
            del self._tracker_id_map[tracker_id]

        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2

        # ── Strategy 1: Spatial match against ACTIVE players ───
        # If this new tracker ID appeared right where an existing
        # active player was, it's the same person.
        spatial_pid = self._match_spatial_active(cx, cy, frame_idx)
        if spatial_pid is not None:
            self._tracker_id_map[tracker_id] = spatial_pid
            self._seen_this_frame.add(spatial_pid)
            return self.profiles[spatial_pid]

        # ── Strategy 2: Spatial + appearance against LOST pool ─
        lost_pid = self._match_lost(bbox, frame, cx, cy)
        if lost_pid is not None:
            self._tracker_id_map[tracker_id] = lost_pid
            profile = self._lost_profiles.pop(lost_pid)
            profile.is_active = True
            self.profiles[lost_pid] = profile
            self._seen_this_frame.add(lost_pid)
            return profile

        # ── Strategy 3: Genuinely new player ───────────────────
        pid = self._next_player_id
        self._next_player_id += 1
        profile = PlayerProfile(
            player_id=pid,
            first_seen_frame=frame_idx,
            last_seen_frame=frame_idx,
        )
        profile.update_appearance(frame, bbox)
        self.profiles[pid] = profile
        self._tracker_id_map[tracker_id] = pid
        self._seen_this_frame.add(pid)
        return profile

    def _match_spatial_active(
        self, cx: float, cy: float, frame_idx: int,
    ) -> Optional[int]:
        """
        Check if this detection is very close to a recently-seen ACTIVE
        player who has NOT been updated yet this frame.
        This catches the most common case: tracker gave a new ID to
        the same person one frame later.
        """
        from config.settings import REID_SPATIAL_THRESHOLD, REID_STALE_FRAMES

        best_pid = None
        best_dist = float("inf")

        for pid, p in self.profiles.items():
            # Skip players already matched this frame
            if pid in self._seen_this_frame:
                continue
            # Skip players that haven't been seen recently
            if frame_idx - p.last_seen_frame > REID_STALE_FRAMES:
                continue
            if not p.positions:
                continue

            last_pos = p.positions[-1]
            dist = math.hypot(cx - last_pos[0], cy - last_pos[1])

            if dist < best_dist:
                best_dist = dist
                best_pid = pid

        if best_dist <= REID_SPATIAL_THRESHOLD and best_pid is not None:
            return best_pid
        return None

    def _match_lost(
        self,
        bbox: List[int],
        frame: np.ndarray,
        cx: float,
        cy: float,
    ) -> Optional[int]:
        """
        Match against lost players using spatial proximity (strong bonus)
        combined with colour histogram similarity.
        """
        if not self._lost_profiles:
            return None

        from config.settings import (
            REID_MATCH_THRESHOLD, REID_HISTOGRAM_BINS,
            REID_SPATIAL_THRESHOLD,
        )

        x1, y1, x2, y2 = bbox
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return None

        # Extract candidate histogram
        rh = roi.shape[0]
        torso = roi[int(rh * 0.2):int(rh * 0.8), :]
        if torso.size == 0:
            torso = roi
        hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
        cand_hist = cv2.calcHist(
            [hsv], [0, 1], None,
            list(REID_HISTOGRAM_BINS), [0, 180, 0, 256]
        )
        cv2.normalize(cand_hist, cand_hist)
        cand_height = y2 - y1

        best_pid = None
        best_score = 0.0

        for pid, p in self._lost_profiles.items():
            # ── Spatial proximity ──────────────────────────────
            spatial_score = 0.0
            if p.positions:
                last_pos = p.positions[-1]
                dist = math.hypot(cx - last_pos[0], cy - last_pos[1])
                if dist <= REID_SPATIAL_THRESHOLD:
                    spatial_score = 1.0 - (dist / REID_SPATIAL_THRESHOLD)
                elif dist <= REID_SPATIAL_THRESHOLD * 3:
                    spatial_score = 0.3 * (1.0 - dist / (REID_SPATIAL_THRESHOLD * 3))

            # ── Colour similarity ──────────────────────────────
            colour_sim = 0.0
            if p.colour_histogram is not None:
                bhat = cv2.compareHist(
                    cand_hist, p.colour_histogram, cv2.HISTCMP_BHATTACHARYYA
                )
                colour_sim = 1.0 - bhat

            # ── Body proportion ─────────────────────────────────
            height_ratio = 0.5
            if p.body_height_px > 0:
                height_ratio = min(cand_height, p.body_height_px) / max(
                    cand_height, p.body_height_px
                )

            # ── Combined score ──────────────────────────────────
            # Spatial is the strongest signal for recent losses
            score = spatial_score * 0.45 + colour_sim * 0.40 + height_ratio * 0.15

            if score > best_score:
                best_score = score
                best_pid = pid

        if best_score >= REID_MATCH_THRESHOLD and best_pid is not None:
            return best_pid
        return None

    def mark_lost(self, player_id: int):
        """Move player to lost pool for potential re-identification."""
        if player_id in self.profiles:
            p = self.profiles[player_id]
            p.is_active = False
            self._lost_profiles[player_id] = p

    def cleanup_lost(self, current_frame: int, timeout: int = 300):
        """Remove lost profiles that have been gone too long."""
        to_remove = [
            pid for pid, p in self._lost_profiles.items()
            if current_frame - p.last_seen_frame > timeout
        ]
        for pid in to_remove:
            del self._lost_profiles[pid]

    def mark_stale_as_lost(self, current_frame: int, stale_frames: int = 8):
        """
        Move active players that haven't been seen recently to the lost pool.
        Call at the END of each frame after all detections are processed.
        """
        to_lose = []
        for pid, p in self.profiles.items():
            if p.is_active and pid not in self._seen_this_frame:
                if current_frame - p.last_seen_frame >= stale_frames:
                    to_lose.append(pid)
        for pid in to_lose:
            self.mark_lost(pid)

    def get_active_players(self) -> List[PlayerProfile]:
        return [p for p in self.profiles.values() if p.is_active]

    def get_all_players(self) -> List[PlayerProfile]:
        return list(self.profiles.values())

    def get_player(self, player_id: int) -> Optional[PlayerProfile]:
        return self.profiles.get(player_id)

    def set_player_name(self, player_id: int, name: str):
        if player_id in self.profiles:
            self.profiles[player_id].display_name = name

    def set_player_jersey(self, player_id: int, number: int):
        if player_id in self.profiles:
            self.profiles[player_id].jersey_number = number

    def set_player_position(self, player_id: int, position: str):
        if player_id in self.profiles:
            self.profiles[player_id].position = position
