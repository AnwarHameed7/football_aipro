"""Browser-based clip playback and portable feedback for coaches."""

import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import streamlit as st

from utils.video_loader import VideoLoader


st.set_page_config(page_title="Coach Feedback | Football AI Pro", layout="centered")
st.title("Coach Feedback")

video = st.file_uploader("Upload a video clip", type=["mp4", "mov", "webm", "m4v"])
if video is None:
    st.stop()

if st.session_state.get("feedback_clip_id") != video.file_id:
    loader = VideoLoader()
    with NamedTemporaryFile(suffix=Path(video.name).suffix, delete=False) as temporary:
        temp_path = Path(temporary.name)
        temporary.write(video.getvalue())
    try:
        info = loader.open(str(temp_path))
    finally:
        loader.release()
        temp_path.unlink(missing_ok=True)
    if not info or info["frames"] < 1 or info["fps"] <= 0:
        st.error("Could not read video metadata. Try an MP4 clip.")
        st.stop()
    st.session_state.feedback_clip_id = video.file_id
    st.session_state.coach_review = {
        "version": 1, "source": video.name, "fps": info["fps"], "frame_count": info["frames"],
        "tags": [], "drawings": {}, "movement_review": None,
    }
    st.session_state.loaded_feedback_file = None

review = st.session_state.coach_review
existing = st.file_uploader("Import a review for this clip", type=["json"])
if existing and st.session_state.loaded_feedback_file != existing.file_id:
    st.session_state.loaded_feedback_file = existing.file_id
    try:
        imported = json.loads(existing.getvalue())
        for key in ("version", "source", "frame_count"):
            if imported[key] != review[key]:
                raise ValueError("The review belongs to another clip.")
        if abs(float(imported["fps"]) - review["fps"]) > .05:
            raise ValueError("The review has a different frame rate.")
        tags = imported["tags"]
        if not isinstance(tags, list) or not all(
            isinstance(tag, dict)
            and isinstance(tag.get("start"), int) and isinstance(tag.get("end"), int)
            and 0 <= tag["start"] <= tag["end"] < review["frame_count"]
            and all(isinstance(tag.get(key), str) for key in ("title", "category", "player", "feedback"))
            for tag in tags
        ):
            raise ValueError("The review contains invalid tags.")
        review = imported
        st.session_state.coach_review = review
    except (ValueError, TypeError, KeyError) as exc:
        st.error(str(exc))

st.video(video.getvalue(), format=video.type or "video/mp4")
fps = float(review["fps"])
last_second = (review["frame_count"] - 1) / fps
with st.form("add_feedback", clear_on_submit=True):
    title = st.text_input("Clip title")
    player = st.text_input("Player or team")
    start = st.number_input("From (seconds)", min_value=0.0, step=.1)
    end = st.number_input("To (seconds)", min_value=0.0, step=.1)
    feedback = st.text_area("Coaching feedback")
    if st.form_submit_button("Add feedback"):
        if not feedback.strip():
            st.error("Enter your feedback.")
        elif not 0 <= start <= end <= last_second:
            st.error(f"Choose a range within 0–{last_second:.3f} seconds.")
        else:
            review["tags"].append({
                "start": round(start * fps), "end": round(end * fps), "category": "Other",
                "title": title.strip() or "Coach feedback", "player": player.strip(),
                "feedback": feedback.strip(),
            })

for tag in sorted(review["tags"], key=lambda item: item["start"]):
    st.write(f'{tag["start"] / fps:.2f}–{tag["end"] / fps:.2f}s · {tag["title"]}')
    if tag["player"]:
        st.text(tag["player"])
    st.text(tag["feedback"])

st.download_button("Download review JSON", json.dumps(review, ensure_ascii=False, indent=2),
                   file_name=f"{Path(video.name).stem}-review.json", mime="application/json")
