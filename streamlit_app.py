import streamlit as st
import cv2
import numpy as np
import tempfile
import os
from utils.video_processor import VideoProcessor

st.set_page_config(page_title="FootballAI Pro Web", layout="wide")

st.title("⚽ FootballAI Pro - Elite Player Analysis")
st.markdown("Professional biometric tracking and sports-science coaching.")

# Sidebar for settings
st.sidebar.header("Analysis Settings")
conf_threshold = st.sidebar.slider("Confidence Threshold", 0.1, 1.0, 0.3)
iou_threshold = st.sidebar.slider("IoU Threshold", 0.1, 1.0, 0.45)

uploaded_file = st.file_uploader("Upload Football Match Video", type=["mp4", "avi", "mov", "mkv"])

if uploaded_file is not None:
    # Save uploaded file to a temporary location
    tfile = tempfile.NamedTemporaryFile(delete=False)
    tfile.write(uploaded_file.read())
    video_path = tfile.name

    # Initialize Processor
    processor = VideoProcessor()
    # Override thresholds from sidebar
    processor.tracker.model.obs_conf = conf_threshold # Note: Accessing internals might vary by YOLO version
    
    st.info("Processing video... This may take a few minutes depending on length.")
    
    # First pass: Detect all players to let user choose
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    # Process a few frames to get initial player IDs
    frame = cap.read()[1]
    if frame is not None:
        processor.process(frame)
        available_players = list(processor.id_map.values())
    else:
        available_players = []
    
    cap.release()

    if available_players:
        selected_player = st.selectbox("Select Player to Analyze", available_players)
        processor.selected_player = selected_player
        
        if st.button("Start Professional Analysis"):
            with st.spinner("Applying Sports Science Analysis..."):
                cap = cv2.VideoCapture(video_path)
                
                # Output setup
                temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
                output_path = temp_output.name
                
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
                
                frame_count = 0
                last_feedback = ""
                
                while cap.isOpened():
                    ret, frame = cap.read()
                    if not ret:
                        break
                        
                    processed_frame, feedback = processor.process(frame)
                    out.write(processed_frame)
                    if feedback:
                        last_feedback = feedback
                    frame_count += 1
                
                cap.release()
                out.release()
                
                st.success(f"Analysis Complete! Processed {frame_count} frames.")
                
                # Show Video
                video_file = open(output_path, 'rb')
                video_bytes = video_file.read()
                st.video(video_bytes)
                
                # Show Final Coach Feedback
                st.subheader("📋 Final Coaching Summary")
                st.markdown(f"**Last Analysis Result:** {last_feedback}")
                
                # Show stats
                stats = processor.running.get_stats(selected_player)
                col1, col2, col3 = st.columns(3)
                col1.metric("Avg Speed", f"{stats['speed']:.2f}")
                col2.metric("Total Distance", f"{stats['distance']:.2f}")
                col3.metric("Max Speed", f"{processor.running.get_max_speed(selected_player):.2f}")

                # Report Download
                import pandas as pd
                iq_stats = processor.iq.stats(selected_player)
                report_df = pd.DataFrame([
                    {"PlayerID": selected_player, **stats, **iq_stats}
                ])
                csv = report_df.to_csv(index=False).encode('utf-8')
                st.download_button("Download Performance Report (CSV)", csv, "player_report.csv", "text/csv")
    else:
        st.error("No players detected in the video. Please try adjusting the Confidence Threshold.")
else:
    st.write("Waiting for video upload... 📂")
