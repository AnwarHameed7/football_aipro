"""
Football AI Pro - Match Events
Timestamped events logged during analysis for the timeline and reports.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class EventType(Enum):
    BALL_TOUCH = "ball_touch"
    SPRINT = "sprint"
    HIGH_INTENSITY_RUN = "high_intensity"
    DIRECTION_CHANGE = "direction_change"
    BIOMECHANICS_ISSUE = "biomechanics_issue"
    POSTURE_WARNING = "posture_warning"
    FATIGUE_WARNING = "fatigue_warning"
    PLAYER_ENTERED = "player_entered"
    PLAYER_LOST = "player_lost"
    PLAYER_REIDENTIFIED = "player_reidentified"
    OBSERVATION = "observation"


@dataclass
class MatchEvent:
    frame_idx: int
    timestamp_sec: float
    event_type: EventType
    player_id: Optional[int] = None
    description: str = ""
    severity: str = "info"  # info, warning, alert
    confidence: float = 1.0
    data: Dict[str, Any] = field(default_factory=dict)


class EventLog:
    """Accumulates events across the whole analysis session."""

    def __init__(self, fps: float = 30.0):
        self.events: List[MatchEvent] = []
        self.fps = fps

    def log(
        self,
        frame_idx: int,
        event_type: EventType,
        player_id: Optional[int] = None,
        description: str = "",
        severity: str = "info",
        confidence: float = 1.0,
        data: Optional[Dict] = None,
    ):
        ts = frame_idx / self.fps if self.fps > 0 else 0
        self.events.append(
            MatchEvent(
                frame_idx=frame_idx,
                timestamp_sec=ts,
                event_type=event_type,
                player_id=player_id,
                description=description,
                severity=severity,
                confidence=confidence,
                data=data or {},
            )
        )

    def get_player_events(self, player_id: int) -> List[MatchEvent]:
        return [e for e in self.events if e.player_id == player_id]

    def get_recent(self, n: int = 10) -> List[MatchEvent]:
        return self.events[-n:]

    def get_by_type(self, event_type: EventType) -> List[MatchEvent]:
        return [e for e in self.events if e.event_type == event_type]

    def get_warnings(self) -> List[MatchEvent]:
        return [e for e in self.events if e.severity in ("warning", "alert")]

    def to_timeline_dicts(self, player_id: Optional[int] = None) -> List[Dict]:
        evts = self.get_player_events(player_id) if player_id else self.events
        result = []
        for e in evts:
            mins = int(e.timestamp_sec // 60)
            secs = int(e.timestamp_sec % 60)
            result.append({
                "time": f"{mins:02d}:{secs:02d}",
                "type": e.event_type.value,
                "description": e.description,
                "severity": e.severity,
                "confidence": e.confidence,
                "player_id": e.player_id,
            })
        return result
