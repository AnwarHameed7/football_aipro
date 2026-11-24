"""
Football AI Pro - Exercise Database
Evidence-based exercise recommendations ranked by EMG activation (%MVIC)
for every muscle group relevant to football athletes.

Sources: EMG research from sports science literature, physiotherapy
databases, and strength & conditioning research.

Each muscle group lists exercises by peak EMG activation alongside
football-specific application and injury prevention notes.
"""

from typing import Dict, List, Any


# ═══════════════════════════════════════════════════════════════════════
#  DATA STRUCTURE
# ═══════════════════════════════════════════════════════════════════════
# Each entry:
#   "exercise": name
#   "emg_pct": approximate %MVIC from research (0-120+)
#   "type": "activation" | "strength" | "both"
#   "equipment": what's needed
#   "sets_reps": recommended prescription
#   "football_benefit": why it matters for football
#   "notes": coaching cues or cautions

EXERCISE_DATABASE: Dict[str, Dict[str, Any]] = {

    # ═══════════════════════════════════════════════════════════════
    #  HAMSTRINGS
    #  (Biceps Femoris long head, Semitendinosus, Semimembranosus)
    # ═══════════════════════════════════════════════════════════════
    "hamstrings": {
        "display_name": "Hamstrings",
        "sub_muscles": ["Biceps Femoris (BFlh)", "Semitendinosus (ST)", "Semimembranosus (SM)"],
        "football_role": "Sprint acceleration, deceleration, knee stability, kicking power",
        "injury_risk": "Most common football muscle injury — hamstring strains during sprinting",
        "top_activation": [
            {
                "exercise": "Unilateral Glute Bridge @ 30°",
                "emg_pct": 120,
                "type": "activation",
                "equipment": "None / bench",
                "sets_reps": "3 × 12 each leg",
                "football_benefit": "Highest overall hamstring activation; trains hip extension in sprint-specific range",
                "notes": "Knee at ~30° flexion; squeeze glute at top; 2s hold",
            },
            {
                "exercise": "Hamstring Sliders",
                "emg_pct": 82,
                "type": "both",
                "equipment": "Sliders / towel on smooth floor",
                "sets_reps": "3 × 8 each leg",
                "football_benefit": "Eccentric hamstring loading mirrors deceleration demands",
                "notes": "Control the slide out; don't let hips drop",
            },
            {
                "exercise": "Nordic Hamstring Curl",
                "emg_pct": 65,
                "type": "strength",
                "equipment": "Partner / anchor",
                "sets_reps": "3 × 5-6 (build to 8)",
                "football_benefit": "Gold standard for hamstring injury prevention; eccentric strength",
                "notes": "Lower as slowly as possible; catch at bottom; progress over 6-8 weeks",
            },
        ],
        "top_strength": [
            {
                "exercise": "Romanian Deadlift",
                "emg_pct": 38,
                "type": "strength",
                "equipment": "Barbell / dumbbells",
                "sets_reps": "3 × 8-10",
                "football_benefit": "Hip-hinge strength for sprinting and jumping; posterior chain development",
                "notes": "Slight knee bend; hinge at hips; feel stretch in hamstrings",
            },
            {
                "exercise": "Prone Leg Curl",
                "emg_pct": 70,
                "type": "strength",
                "equipment": "Machine",
                "sets_reps": "3 × 10-12",
                "football_benefit": "Isolated knee flexion strength; balances quad dominance",
                "notes": "Control eccentric; don't hyperextend lumbar",
            },
            {
                "exercise": "Single-Leg Deadlift",
                "emg_pct": 55,
                "type": "strength",
                "equipment": "Dumbbell / kettlebell",
                "sets_reps": "3 × 8 each leg",
                "football_benefit": "Unilateral strength + balance; mimics single-leg stance in football",
                "notes": "Keep hips square; reach dumbbell toward ground",
            },
        ],
        "injury_prevention_protocol": "Nordic curls 2×/week + hip-dominant RDL pattern 2×/week. Eccentric focus reduces hamstring strain risk by up to 51% (meta-analysis evidence).",
    },

    # ═══════════════════════════════════════════════════════════════
    #  QUADRICEPS
    #  (Rectus Femoris, Vastus Lateralis, Vastus Medialis, Vastus Intermedius)
    # ═══════════════════════════════════════════════════════════════
    "quadriceps": {
        "display_name": "Quadriceps",
        "sub_muscles": ["Rectus Femoris", "Vastus Lateralis (VL)", "Vastus Medialis (VMO)", "Vastus Intermedius"],
        "football_role": "Kicking, jumping, sprinting, decelerating, change of direction",
        "injury_risk": "Quad strains from kicking; ACL risk with VMO weakness",
        "top_activation": [
            {
                "exercise": "Barbell Back Squat (full depth)",
                "emg_pct": 100,
                "type": "both",
                "equipment": "Barbell / rack",
                "sets_reps": "4 × 6-8",
                "football_benefit": "Foundation of lower-body power for sprinting, jumping, and tackling",
                "notes": "Full depth (below parallel) for VMO activation; brace core throughout",
            },
            {
                "exercise": "Bulgarian Split Squat",
                "emg_pct": 90,
                "type": "both",
                "equipment": "Bench + dumbbells",
                "sets_reps": "3 × 8-10 each leg",
                "football_benefit": "Unilateral quad strength; addresses left-right imbalances common in dominant-leg kickers",
                "notes": "Front shin stays vertical; torso upright; full range of motion",
            },
            {
                "exercise": "Leg Extension (terminal range)",
                "emg_pct": 88,
                "type": "activation",
                "equipment": "Machine",
                "sets_reps": "3 × 12-15",
                "football_benefit": "Isolates VMO for knee stability; rehab-friendly for post-injury return",
                "notes": "Pause at top; control eccentric; last 30° for VMO emphasis",
            },
        ],
        "top_strength": [
            {
                "exercise": "Front Squat",
                "emg_pct": 95,
                "type": "strength",
                "equipment": "Barbell",
                "sets_reps": "4 × 6-8",
                "football_benefit": "Greater quad emphasis than back squat; upright torso trains sport-specific posture",
                "notes": "Elbows high; core braced; go to depth",
            },
            {
                "exercise": "Step-Up (high box)",
                "emg_pct": 80,
                "type": "strength",
                "equipment": "Box (40-50cm) + dumbbells",
                "sets_reps": "3 × 10 each leg",
                "football_benefit": "Single-leg power; mimics pushing off during acceleration",
                "notes": "Drive through front heel; don't push off back foot",
            },
            {
                "exercise": "Wall Sit Isometric",
                "emg_pct": 70,
                "type": "activation",
                "equipment": "Wall",
                "sets_reps": "3 × 30-45s",
                "football_benefit": "Quad endurance for sustained low positions; defensive stance",
                "notes": "Knees at 90°; back flat against wall",
            },
        ],
        "injury_prevention_protocol": "Eccentric single-leg squats for VMO. Quad:hamstring ratio should approach 1:0.6-0.8. Monitor with single-leg hop test.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  GLUTES
    #  (Gluteus Maximus, Medius, Minimus)
    # ═══════════════════════════════════════════════════════════════
    "glutes": {
        "display_name": "Glutes",
        "sub_muscles": ["Gluteus Maximus", "Gluteus Medius", "Gluteus Minimus"],
        "football_role": "Hip extension (sprinting), lateral movement, pelvic stability, change of direction",
        "injury_risk": "Glute inhibition leads to compensatory hamstring/lower back overload",
        "top_activation": [
            {
                "exercise": "Barbell Hip Thrust",
                "emg_pct": 120,
                "type": "both",
                "equipment": "Bench + barbell / heavy dumbbell",
                "sets_reps": "4 × 8-10",
                "football_benefit": "Highest glute max activation; directly transfers to sprint acceleration",
                "notes": "Chin tucked; squeeze at top for 2s; don't hyperextend lumbar",
            },
            {
                "exercise": "Side-Lying Hip Abduction",
                "emg_pct": 81,
                "type": "activation",
                "equipment": "None / ankle weight",
                "sets_reps": "3 × 15 each side",
                "football_benefit": "Targets glute medius for lateral stability; reduces knee valgus risk",
                "notes": "Slight hip extension; don't rotate pelvis; control speed",
            },
            {
                "exercise": "Single-Leg Glute Bridge",
                "emg_pct": 78,
                "type": "activation",
                "equipment": "None",
                "sets_reps": "3 × 12 each leg",
                "football_benefit": "Unilateral glute activation; corrects asymmetry from dominant-side kicking",
                "notes": "Hips level throughout; 2s hold at top",
            },
        ],
        "top_strength": [
            {
                "exercise": "Trap Bar Deadlift",
                "emg_pct": 95,
                "type": "strength",
                "equipment": "Trap bar",
                "sets_reps": "4 × 5-6",
                "football_benefit": "Full posterior chain power; safer spinal position than conventional deadlift",
                "notes": "Drive through floor; lock hips at top",
            },
            {
                "exercise": "Cable Pull-Through",
                "emg_pct": 72,
                "type": "strength",
                "equipment": "Cable machine",
                "sets_reps": "3 × 12",
                "football_benefit": "Hip hinge pattern with constant tension; teaches glute squeeze",
                "notes": "Hinge at hips; squeeze glutes to stand; don't hyperextend",
            },
            {
                "exercise": "Lateral Band Walk",
                "emg_pct": 65,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "3 × 15 each direction",
                "football_benefit": "Glute med endurance for sustained lateral movement and defending",
                "notes": "Stay low in quarter-squat; knees out over toes",
            },
        ],
        "injury_prevention_protocol": "Activate glutes before every session: clamshells + bridges. Weak glutes are the #1 driver of knee, hamstring, and lower back injuries in football.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  HIP FLEXORS
    #  (Iliopsoas, Rectus Femoris)
    # ═══════════════════════════════════════════════════════════════
    "hip_flexors": {
        "display_name": "Hip Flexors",
        "sub_muscles": ["Iliopsoas", "Rectus Femoris (dual role)"],
        "football_role": "Knee drive during sprinting, kicking leg recovery, high-speed running",
        "injury_risk": "Tightness from prolonged sitting; strains during shooting",
        "top_activation": [
            {
                "exercise": "Hanging Knee Raise",
                "emg_pct": 95,
                "type": "both",
                "equipment": "Pull-up bar",
                "sets_reps": "3 × 12",
                "football_benefit": "Hip flexor strength through full range; core integration",
                "notes": "Control the movement; don't swing; bring knees above 90°",
            },
            {
                "exercise": "Standing Hip Flexion (banded)",
                "emg_pct": 85,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "3 × 15 each leg",
                "football_benefit": "Sprint-specific hip flexor activation; mimics knee drive",
                "notes": "Stand tall; drive knee up against band resistance; control return",
            },
            {
                "exercise": "Mountain Climbers (slow, controlled)",
                "emg_pct": 75,
                "type": "activation",
                "equipment": "None",
                "sets_reps": "3 × 20 each leg",
                "football_benefit": "Dynamic hip flexor activation with core stability demand",
                "notes": "Hold plank position; drive knee to chest deliberately",
            },
        ],
        "top_strength": [
            {
                "exercise": "Weighted Hip Flexor March",
                "emg_pct": 80,
                "type": "strength",
                "equipment": "Ankle weights / cable",
                "sets_reps": "3 × 10 each leg",
                "football_benefit": "Direct hip flexor strengthening for sprint knee drive",
                "notes": "Pause at top; don't lean back; maintain neutral spine",
            },
            {
                "exercise": "Psoas March (supine)",
                "emg_pct": 70,
                "type": "activation",
                "equipment": "None",
                "sets_reps": "3 × 12 each leg",
                "football_benefit": "Isolates iliopsoas without rectus femoris compensation",
                "notes": "Keep lower back pressed into floor; lift one knee at a time",
            },
            {
                "exercise": "Sled Push (high knees)",
                "emg_pct": 90,
                "type": "strength",
                "equipment": "Sled",
                "sets_reps": "4 × 20m",
                "football_benefit": "Sprint-specific hip flexor loading under resistance",
                "notes": "Exaggerate knee drive; lean into sled; powerful arm action",
            },
        ],
        "injury_prevention_protocol": "Stretch hip flexors daily (kneeling lunge stretch 3×30s). Strengthen with banded marches 3×/week. Critical for players who sit during school/work.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  CALVES
    #  (Gastrocnemius, Soleus)
    # ═══════════════════════════════════════════════════════════════
    "calves": {
        "display_name": "Calves",
        "sub_muscles": ["Gastrocnemius (medial & lateral heads)", "Soleus"],
        "football_role": "Ankle push-off during sprinting, jumping, change of direction; ankle stability",
        "injury_risk": "Calf strains during acceleration; Achilles tendon overload",
        "top_activation": [
            {
                "exercise": "Standing Calf Raise (single-leg)",
                "emg_pct": 100,
                "type": "both",
                "equipment": "Step / calf raise machine",
                "sets_reps": "3 × 15 each leg",
                "football_benefit": "Peak gastrocnemius activation; builds push-off power for sprinting",
                "notes": "Full range: drop heel below step, rise to full height; 2s hold at top",
            },
            {
                "exercise": "Seated Calf Raise",
                "emg_pct": 90,
                "type": "both",
                "equipment": "Machine / barbell on knees",
                "sets_reps": "3 × 15-20",
                "football_benefit": "Targets soleus specifically; endurance for sustained running",
                "notes": "Knees bent removes gastrocnemius; isolates soleus",
            },
            {
                "exercise": "Jump Rope (single-leg)",
                "emg_pct": 80,
                "type": "activation",
                "equipment": "Rope",
                "sets_reps": "3 × 30s each leg",
                "football_benefit": "Reactive calf strength; ankle stiffness for agility",
                "notes": "Stay on balls of feet; minimal ground contact time",
            },
        ],
        "top_strength": [
            {
                "exercise": "Eccentric Heel Drop (straight knee)",
                "emg_pct": 85,
                "type": "strength",
                "equipment": "Step",
                "sets_reps": "3 × 15 each leg",
                "football_benefit": "Achilles tendon health; proven rehab and prevention for tendinopathy",
                "notes": "Slow 3-second lower; use other leg to push back up",
            },
            {
                "exercise": "Box Jump Landing",
                "emg_pct": 75,
                "type": "strength",
                "equipment": "Box",
                "sets_reps": "3 × 8",
                "football_benefit": "Eccentric calf and ankle control during landing",
                "notes": "Focus on soft, controlled landing; hold position for 2s",
            },
            {
                "exercise": "Farmer's Walk (toes)",
                "emg_pct": 70,
                "type": "strength",
                "equipment": "Heavy dumbbells",
                "sets_reps": "3 × 30m",
                "football_benefit": "Calf endurance under load; grip strength bonus",
                "notes": "Walk on balls of feet with heavy weights; maintain posture",
            },
        ],
        "injury_prevention_protocol": "Eccentric heel drops 3×/week (Alfredson protocol for Achilles health). Single-leg calf raises as warm-up indicator: <25 reps = calf endurance deficit.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  ADDUCTORS (GROIN)
    #  (Adductor Magnus, Longus, Brevis, Gracilis, Pectineus)
    # ═══════════════════════════════════════════════════════════════
    "adductors": {
        "display_name": "Adductors (Groin)",
        "sub_muscles": ["Adductor Magnus", "Adductor Longus", "Adductor Brevis", "Gracilis"],
        "football_role": "Kicking (plant leg stability + kicking leg power), lateral movement, change of direction",
        "injury_risk": "Groin strains are 2nd most common in football; adductor longus most affected",
        "top_activation": [
            {
                "exercise": "Copenhagen Adductor Plank",
                "emg_pct": 115,
                "type": "both",
                "equipment": "Bench",
                "sets_reps": "3 × 10-15s each side (build to 25s)",
                "football_benefit": "Highest adductor activation; proven to reduce groin injuries by 41%",
                "notes": "Top leg on bench, bottom leg unsupported; maintain straight body line",
            },
            {
                "exercise": "Side-Lying Adduction (weighted)",
                "emg_pct": 80,
                "type": "activation",
                "equipment": "Ankle weight",
                "sets_reps": "3 × 15 each side",
                "football_benefit": "Isolated adductor activation; good for rehab progression",
                "notes": "Bottom leg lifts; top leg rests on bench or stacked; control speed",
            },
            {
                "exercise": "Sumo Squat",
                "emg_pct": 75,
                "type": "both",
                "equipment": "Dumbbell / kettlebell",
                "sets_reps": "3 × 10-12",
                "football_benefit": "Adductor strength in a compound movement; inner thigh power for kicking",
                "notes": "Wide stance; toes out 45°; drive knees out over toes",
            },
        ],
        "top_strength": [
            {
                "exercise": "Cable Adduction",
                "emg_pct": 85,
                "type": "strength",
                "equipment": "Cable machine",
                "sets_reps": "3 × 12 each leg",
                "football_benefit": "Constant tension through full range; sport-specific standing position",
                "notes": "Stand on one leg; pull other leg across body against cable",
            },
            {
                "exercise": "Slider Lateral Lunge",
                "emg_pct": 72,
                "type": "strength",
                "equipment": "Slider / towel",
                "sets_reps": "3 × 8 each leg",
                "football_benefit": "Eccentric adductor loading during lateral movement — exactly what injures groins",
                "notes": "Slide one leg out laterally; control the return; stay low",
            },
            {
                "exercise": "Ball Squeeze (isometric)",
                "emg_pct": 65,
                "type": "activation",
                "equipment": "Football / medicine ball",
                "sets_reps": "3 × 10 (5s holds)",
                "football_benefit": "Quick adductor activation for warm-up; easy to program anywhere",
                "notes": "Squeeze ball between knees in supine or seated position",
            },
        ],
        "injury_prevention_protocol": "Copenhagen plank 3×/week is the single most effective groin injury prevention exercise. Adductor squeeze test (pain-free) should be monitored weekly.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  CORE
    #  (Rectus Abdominis, Obliques, Transverse Abdominis, Erector Spinae)
    # ═══════════════════════════════════════════════════════════════
    "core": {
        "display_name": "Core",
        "sub_muscles": ["Rectus Abdominis", "Internal/External Obliques", "Transverse Abdominis", "Erector Spinae", "Multifidus"],
        "football_role": "Force transfer between legs and upper body, balance, shielding, heading, trunk stability during sprinting",
        "injury_risk": "Lower back pain from weak deep core; sports hernia risk",
        "top_activation": [
            {
                "exercise": "Dead Bug",
                "emg_pct": 90,
                "type": "activation",
                "equipment": "None",
                "sets_reps": "3 × 10 each side",
                "football_benefit": "Deep core (TrA) activation with limb movement — mirrors running demands",
                "notes": "Press lower back into floor throughout; opposite arm + leg extend; slow and controlled",
            },
            {
                "exercise": "Pallof Press",
                "emg_pct": 88,
                "type": "both",
                "equipment": "Cable / resistance band",
                "sets_reps": "3 × 10 each side",
                "football_benefit": "Anti-rotation strength; critical for shielding, body contact, and change of direction",
                "notes": "Press arms out against rotational pull; hold 2s; don't let hips rotate",
            },
            {
                "exercise": "Ab Wheel Rollout",
                "emg_pct": 95,
                "type": "both",
                "equipment": "Ab wheel",
                "sets_reps": "3 × 8-10",
                "football_benefit": "Anti-extension strength; strongest rectus abdominis activation",
                "notes": "Start from knees; maintain neutral spine; don't let hips sag",
            },
        ],
        "top_strength": [
            {
                "exercise": "Plank (with perturbation)",
                "emg_pct": 75,
                "type": "strength",
                "equipment": "None + partner",
                "sets_reps": "3 × 30-45s",
                "football_benefit": "Isometric core stability under unpredictable loads — like being pushed in a match",
                "notes": "Partner provides random pushes to shoulders/hips while in plank",
            },
            {
                "exercise": "Landmine Rotation",
                "emg_pct": 85,
                "type": "strength",
                "equipment": "Barbell + landmine attachment",
                "sets_reps": "3 × 10 each side",
                "football_benefit": "Rotational power for kicking, throwing, and turning",
                "notes": "Pivot through hips; arms guide the bar; power comes from core rotation",
            },
            {
                "exercise": "Suitcase Carry",
                "emg_pct": 78,
                "type": "strength",
                "equipment": "Heavy dumbbell / kettlebell",
                "sets_reps": "3 × 30m each side",
                "football_benefit": "Anti-lateral flexion; trains the core to resist being pulled sideways during contact",
                "notes": "Walk tall; don't lean toward the weight; brace obliques",
            },
        ],
        "injury_prevention_protocol": "Daily dead bugs + weekly rotational and anti-rotation work. Avoid excessive sit-ups/crunches which load the spine without functional transfer.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  HIP ABDUCTORS / ROTATORS
    #  (Glute Med/Min, TFL, Piriformis, Deep rotators)
    # ═══════════════════════════════════════════════════════════════
    "hip_abductors": {
        "display_name": "Hip Abductors & Rotators",
        "sub_muscles": ["Gluteus Medius", "Gluteus Minimus", "TFL", "Piriformis", "Deep external rotators"],
        "football_role": "Pelvic stability during single-leg stance (every step), lateral cutting, defending",
        "injury_risk": "Weakness leads to knee valgus → ACL injury risk; IT band syndrome",
        "top_activation": [
            {
                "exercise": "Clamshell (banded)",
                "emg_pct": 77,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "3 × 15 each side",
                "football_benefit": "Isolates glute med without TFL compensation; essential warm-up exercise",
                "notes": "Keep feet together; rotate from hip; don't roll pelvis back",
            },
            {
                "exercise": "Side Plank with Hip Abduction",
                "emg_pct": 103,
                "type": "both",
                "equipment": "None",
                "sets_reps": "3 × 10 each side",
                "football_benefit": "Highest glute med activation; combines core + hip stability",
                "notes": "Lift top leg while holding side plank; control descent",
            },
            {
                "exercise": "Monster Walk (banded)",
                "emg_pct": 72,
                "type": "activation",
                "equipment": "Resistance band (around ankles)",
                "sets_reps": "3 × 20 steps each direction",
                "football_benefit": "Dynamic hip abductor activation in athletic stance; great warm-up",
                "notes": "Stay in quarter-squat; walk forward/diagonal; keep tension on band",
            },
        ],
        "top_strength": [
            {
                "exercise": "Single-Leg Romanian Deadlift",
                "emg_pct": 85,
                "type": "strength",
                "equipment": "Dumbbell",
                "sets_reps": "3 × 8 each leg",
                "football_benefit": "Hip stability under load; trains balance on one leg like during a match",
                "notes": "Keep hips level; reach dumbbell toward ground; don't rotate",
            },
            {
                "exercise": "Lateral Step-Up",
                "emg_pct": 74,
                "type": "strength",
                "equipment": "Box (30-40cm)",
                "sets_reps": "3 × 10 each leg",
                "football_benefit": "Lateral push-off strength for change of direction",
                "notes": "Step up from the side; drive through top leg; control descent",
            },
            {
                "exercise": "Cable Hip Rotation (standing)",
                "emg_pct": 68,
                "type": "strength",
                "equipment": "Cable machine",
                "sets_reps": "3 × 12 each leg each direction",
                "football_benefit": "Internal and external hip rotation strength for kicking and pivoting",
                "notes": "Stand on one leg; rotate other leg against cable; control throughout",
            },
        ],
        "injury_prevention_protocol": "Clamshells + side plank abduction before every session. Single-leg balance tests monthly. Weak hip abductors are the strongest predictor of ACL injury.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  ANKLE STABILISERS
    #  (Peroneals, Tibialis Posterior, Tibialis Anterior)
    # ═══════════════════════════════════════════════════════════════
    "ankle_stabilisers": {
        "display_name": "Ankle Stabilisers",
        "sub_muscles": ["Peroneus Longus/Brevis", "Tibialis Posterior", "Tibialis Anterior"],
        "football_role": "Ankle stability on uneven ground, balance during tackles, proprioception",
        "injury_risk": "Ankle sprains are the most frequent injury in football overall",
        "top_activation": [
            {
                "exercise": "Single-Leg Balance (unstable surface)",
                "emg_pct": 85,
                "type": "activation",
                "equipment": "Balance pad / BOSU ball",
                "sets_reps": "3 × 30s each leg",
                "football_benefit": "Proprioceptive training reduces ankle sprain recurrence by up to 50%",
                "notes": "Eyes open first, progress to eyes closed; add ball catches for sport-specificity",
            },
            {
                "exercise": "Banded Ankle Eversion",
                "emg_pct": 78,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "3 × 15 each foot",
                "football_benefit": "Targets peroneals — primary lateral ankle stabilisers",
                "notes": "Anchor band medially; push foot outward against resistance",
            },
            {
                "exercise": "Tibialis Anterior Raise",
                "emg_pct": 90,
                "type": "both",
                "equipment": "Wall / weight plate",
                "sets_reps": "3 × 20",
                "football_benefit": "Dorsiflexion strength; prevents shin splints; protects during tackles",
                "notes": "Lean back against wall; lift toes off ground; hold at top",
            },
        ],
        "top_strength": [
            {
                "exercise": "Heel Walk",
                "emg_pct": 75,
                "type": "strength",
                "equipment": "None",
                "sets_reps": "3 × 20m",
                "football_benefit": "Tibialis anterior endurance; quick warm-up exercise",
                "notes": "Walk on heels only; keep toes off ground; maintain posture",
            },
            {
                "exercise": "Resisted Ankle Circles",
                "emg_pct": 60,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "2 × 10 each direction each foot",
                "football_benefit": "Full-range ankle mobility with strengthening; great for rehab",
                "notes": "Slow, controlled circles against band tension",
            },
            {
                "exercise": "Star Excursion Balance (Y-Balance)",
                "emg_pct": 80,
                "type": "strength",
                "equipment": "None / tape",
                "sets_reps": "3 × 6 reaches each direction each leg",
                "football_benefit": "Dynamic balance + ankle stability; also a screening tool for injury risk",
                "notes": "Stand on one leg; reach other leg in 3 directions; maintain balance",
            },
        ],
        "injury_prevention_protocol": "Balance training 3×/week reduces ankle sprain risk by 35-50%. Include in warm-up: single-leg balance progressions + banded eversion.",
    },

    # ═══════════════════════════════════════════════════════════════
    #  SHOULDER / UPPER BODY
    #  (Deltoids, Rotator Cuff, Upper Traps, Serratus Anterior)
    # ═══════════════════════════════════════════════════════════════
    "shoulders_upper": {
        "display_name": "Shoulders & Upper Body",
        "sub_muscles": ["Deltoids", "Rotator Cuff (SITS)", "Upper Trapezius", "Serratus Anterior", "Pectorals"],
        "football_role": "Arm swing during sprinting, throw-ins, heading, body contact, shielding",
        "injury_risk": "Shoulder dislocations from falls; rotator cuff issues from throw-ins",
        "top_activation": [
            {
                "exercise": "Push-Up Plus",
                "emg_pct": 95,
                "type": "activation",
                "equipment": "None",
                "sets_reps": "3 × 12",
                "football_benefit": "Serratus anterior activation for shoulder stability during contact and falls",
                "notes": "At top of push-up, push further (protract scapulae); round upper back slightly",
            },
            {
                "exercise": "Banded External Rotation",
                "emg_pct": 80,
                "type": "activation",
                "equipment": "Resistance band",
                "sets_reps": "3 × 15 each arm",
                "football_benefit": "Rotator cuff strengthening for throw-ins and fall protection",
                "notes": "Elbow at side; rotate forearm outward; control eccentric",
            },
            {
                "exercise": "Overhead Press",
                "emg_pct": 85,
                "type": "both",
                "equipment": "Dumbbells / barbell",
                "sets_reps": "3 × 8-10",
                "football_benefit": "Deltoid strength for heading power, body contact, and arm swing efficiency",
                "notes": "Brace core; press overhead; don't arch lower back excessively",
            },
        ],
        "top_strength": [
            {
                "exercise": "Inverted Row",
                "emg_pct": 82,
                "type": "strength",
                "equipment": "Bar / TRX",
                "sets_reps": "3 × 10-12",
                "football_benefit": "Upper back strength for posture during running; anti-rounding",
                "notes": "Body straight; pull chest to bar; squeeze shoulder blades",
            },
            {
                "exercise": "Medicine Ball Throw (rotational)",
                "emg_pct": 90,
                "type": "strength",
                "equipment": "Medicine ball + wall",
                "sets_reps": "3 × 8 each side",
                "football_benefit": "Throw-in power; rotational upper body strength for shielding",
                "notes": "Pivot through hips; release explosively; catch and repeat",
            },
            {
                "exercise": "Face Pull",
                "emg_pct": 75,
                "type": "strength",
                "equipment": "Cable / band",
                "sets_reps": "3 × 15",
                "football_benefit": "Posterior deltoid and external rotator strength; counters forward shoulder posture",
                "notes": "Pull to face height; externally rotate at end; squeeze shoulder blades",
            },
        ],
        "injury_prevention_protocol": "Rotator cuff work 2-3×/week (banded external rotation + prone I/Y/T). Essential for goalkeepers and outfield players with throw-in duties.",
    },
}


# ═══════════════════════════════════════════════════════════════════════
#  LOOKUP HELPERS
# ═══════════════════════════════════════════════════════════════════════

def get_all_muscle_groups() -> List[str]:
    """Return list of all muscle group keys."""
    return list(EXERCISE_DATABASE.keys())


def get_muscle_data(muscle_key: str) -> Dict[str, Any]:
    """Return full data for a muscle group."""
    return EXERCISE_DATABASE.get(muscle_key, {})


def get_top3_activation(muscle_key: str) -> List[Dict]:
    """Return top 3 activation exercises for a muscle group."""
    data = EXERCISE_DATABASE.get(muscle_key, {})
    return data.get("top_activation", [])[:3]


def get_top3_strength(muscle_key: str) -> List[Dict]:
    """Return top 3 strength exercises for a muscle group."""
    data = EXERCISE_DATABASE.get(muscle_key, {})
    return data.get("top_strength", [])[:3]


def get_injury_prevention(muscle_key: str) -> str:
    """Return injury prevention protocol for a muscle group."""
    data = EXERCISE_DATABASE.get(muscle_key, {})
    return data.get("injury_prevention_protocol", "")


def generate_full_exercise_guide() -> str:
    """Generate a complete text guide of all exercises for all muscle groups."""
    lines = [
        "=" * 65,
        "   FOOTBALL AI PRO — COMPLETE EXERCISE GUIDE",
        "   EMG-Based Top Exercises for Football Athletes",
        "=" * 65,
    ]

    for key, data in EXERCISE_DATABASE.items():
        lines.append(f"\n{'━' * 65}")
        lines.append(f"  {data['display_name'].upper()}")
        lines.append(f"  Muscles: {', '.join(data['sub_muscles'])}")
        lines.append(f"  Football role: {data['football_role']}")
        lines.append(f"  Injury risk: {data['injury_risk']}")
        lines.append(f"{'━' * 65}")

        lines.append("\n  ▸ TOP 3 ACTIVATION EXERCISES (by EMG %MVIC):")
        for i, ex in enumerate(data.get("top_activation", [])[:3], 1):
            lines.append(f"\n    {i}. {ex['exercise']}  —  ~{ex['emg_pct']}% MVIC")
            lines.append(f"       Rx: {ex['sets_reps']}  |  Equipment: {ex['equipment']}")
            lines.append(f"       Why: {ex['football_benefit']}")
            lines.append(f"       Cue: {ex['notes']}")

        lines.append("\n  ▸ TOP 3 STRENGTHENING EXERCISES:")
        for i, ex in enumerate(data.get("top_strength", [])[:3], 1):
            lines.append(f"\n    {i}. {ex['exercise']}  —  ~{ex['emg_pct']}% MVIC")
            lines.append(f"       Rx: {ex['sets_reps']}  |  Equipment: {ex['equipment']}")
            lines.append(f"       Why: {ex['football_benefit']}")
            lines.append(f"       Cue: {ex['notes']}")

        protocol = data.get("injury_prevention_protocol", "")
        if protocol:
            lines.append(f"\n  ▸ INJURY PREVENTION: {protocol}")

    lines.append(f"\n{'=' * 65}")
    lines.append("  Generated by Football AI Pro")
    lines.append("  Consult a qualified S&C coach for individualised programming.")
    lines.append(f"{'=' * 65}")

    return "\n".join(lines)
