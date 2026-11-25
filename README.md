# Football AI Pro

Professional AI-powered football performance analysis platform.
Upload a video of a player or match, and the system automatically tracks players, analyses biomechanics, detects weaknesses, and generates corrective training recommendations.

## Mobile app

The ChatGPT Sites app source, build instructions, and tests are in [mobile-sites](mobile-sites/README.md).

## Personal coaching on desktop

On Windows, install Python 3.12 and double-click **Start Football AI Pro.cmd** in the project folder. The launcher creates a local virtual environment and installs dependencies. You can also run the app from PowerShell:

```powershell
py -3.12 -m pip install -r requirements.txt
py -3.12 -m app.main
```

Ultralytics can download `yolo11n.pt` and `yolo11n-pose.pt` on first use. For offline use, put both files in the project folder before launching. The Streamlit match dashboard runs with `streamlit run streamlit_app.py`.

1. Open a football or running clip. Scrub to a frame where your full body is clear, pause, and click inside your player. Keep **Track All** unchecked for your personal review.
2. Press **Analyse**. The overlay follows accepted matches. The review starts at the selected frame, so select the earliest clear frame for maximum coverage.
3. Use the report timestamps to review the corresponding footage. Use **Export JSON** to save measurements, cues, and intervals of uncertain visibility. Enable **Track All** for the original match overview and its report formats.

The tracker compares shirt and shorts colour, bounding-box proportions, and tracker continuity against your selection. It keeps that reference in memory for the clip and requires a consistent match across three frames after a gap or track-ID change. Similar kits, long occlusions, lighting changes, and camera cuts can cause missed or incorrect matches. Choose distinctive kit for solo sessions and check the video overlay against the report. Each new video requires a new selection. No face template is collected.

The personal report groups frames into windows of up to two seconds and splits them at visibility changes. It summarizes projected trunk, knee, hip, shoulder and elbow angles when enough confident observations exist. Pose is sampled every second frame. Frames outside the screen remain gaps. Use a fixed, level side camera for running mechanics and record several comparable strides at each pace. Differences between acceleration, upright running and cuts affect how to interpret lean and joint angles. The prototype uses review cues and comparison prompts. A clinician or qualified coach can assess gait and injury risk using a broader examination.

### Research background

- World Athletics biomechanical research reports describe how sprint mechanics vary by phase. [Research Centre](https://worldathletics.org/about-iaaf/documents/research-centre)
- Schache et al., *Effect of running speed on lower limb joint kinetics*, describe how running mechanics change with speed. [Journal article](https://doi.org/10.1249/MSS.0b013e3182084929)

The cues use review heuristics with fixed thresholds in `analysis/movement_review.py`. The thresholds and identity matching have not been validated on your footage or calibrated as medical cutoffs.

## What It Analyses

| Category | Metrics |
|---|---|
| **Physical** | Speed, distance, sprints, acceleration, work rate, fatigue estimation |
| **Technical** | Ball touches, direction changes, movement quality score |
| **Biomechanical** | Joint angles (knee, hip, elbow, shoulder), posture, stride, symmetry |
| **Tactical** | Speed zones, off-ball movement, scanning frequency, agility |
| **Sports Science** | Weakness detection with corrective drills, injury risk, training plans |

## Architecture

```
football_ai_pro/
├── app/main.py             ← Desktop entry point
├── streamlit_app.py        ← Optional web entry point
├── config/settings.py      ← All tuneable constants
├── core/pipeline.py        ← Frame-by-frame analysis orchestrator
├── analysis/
│   ├── ball.py             ← Ball detection & possession
│   ├── biomechanics.py     ← Pose estimation & body mechanics
│   ├── football_iq.py      ← Tactical / football analysis
│   └── sports_science.py   ← Weakness detection & drill recommendations
├── models/
│   ├── player.py           ← Player profiles with ReID & persistent memory
│   └── events.py           ← Timestamped match events
├── visualization/
│   ├── heatmap.py          ← Per-player & global heatmaps
│   ├── overlays.py         ← Video frame overlays (bbox, trail, pose, ball)
│   └── charts.py           ← Speed, acceleration, zone charts
├── reports/generator.py    ← PDF, CSV, JSON export
├── ui/
│   ├── styles.py           ← Professional dark-theme CSS
│   └── dashboard.py        ← Streamlit component functions
└── utils/
    ├── geometry.py          ← Angles, distances, velocities
    └── video_loader.py      ← Upload / URL / file handling
```

## Key Design Decisions

- **Re-identification**: Players are matched across tracker ID changes using colour histogram similarity (Bhattacharyya distance) and body proportion matching.
- **Confidence levels**: Every biomechanical observation and sports science finding reports a confidence score. Observations (camera-detected) are distinguished from inferences (likely causes).
- **No coaching overlay on video**: All feedback goes to the sidebar dashboard, keeping the video clean.
- **Evidence-based drills**: The sports science engine contains 7 evidence-based drill programmes with corrective exercises, strength work, mobility work, football-specific drills, progressions, and recovery protocols.
- **Modular pipeline**: Each analysis module can run independently; the pipeline orchestrates them per frame.

## Exports

- **CSV** — Tabular metrics and findings
- **JSON** — Full structured report
- **PDF** — Professional report with scores, metrics, strengths/weaknesses, and detailed drill recommendations
- **Training Plan** — Formatted text plan with exercises per weakness

## Configuration

All parameters are in `config/settings.py`:
- Detection confidence and resolution
- Speed thresholds (sprint, jog, walk)
- Biomechanics tolerances
- ReID matching parameters
- Heatmap and visualisation settings
- Score component weights

## Match and technique review

Open footage in the desktop app and select **Video Review**. Run personal analysis first to use the annotated skeleton video and turn timestamped coaching cues into tags. Use the original view to inspect clean footage.

- Set an in and out frame, then create a tag with a category, player or team, and your coaching feedback. Filter the clip list for tactical themes, opponents, or specific players. Select a row to jump to the clip. Enable **Loop** to repeat the selected interval.
- Use frame stepping and (0.25×) or (0.5×) playback to review footwork. Use **Line**, **Arrow**, or **Angle** on a paused frame. Select the joint as the middle point for an angle. The overlay measures angles in the image plane. The automated review can also report projected ankle separation as a ratio to torso length, which varies with camera angle and does not measure distance traveled per stride.
- Open a reference clip next to the original. Turn synchronization off, seek each video to a comparable instant, then select **Align current frames**. Subsequent synchronized seeks use timestamps, including for clips with different frame rates.
- Save the review as JSON and reopen it with the matching video. Export a tag list as CSV, a full-resolution frame as PNG, or an annotated MP4 interval. MP4 export contains video only. Annotations appear on their selected frames.
- Run `streamlit run streamlit_app.py` and open **Coach Feedback** in a browser on a device that can reach the app. Upload a clip, add timestamped feedback, and download its review JSON. Share the JSON and original footage with the athlete. This workflow uses file exchange.

Workflow references include [Hudl live analysis and event tagging](https://www.hudl.com/blog/high-performance-workflows-live-analysis-review), [TechniqueView](https://www.techniqueview.com/), [Kinovea](https://kinovea.org/), [Onform video analysis](https://onform.com/video-analysis-for-coaches/), and [CoachNow Analyze](https://coachnow.com/analyze).
