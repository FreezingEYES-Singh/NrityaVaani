# NrityaVaani (नृत्यवाणी)

<div align="center">

[![Next.js 16](https://img.shields.io/badge/Next.js-16.3-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks--Vision-007FFF?style=for-the-badge&logo=google&logoColor=white)](https://developers.google.com/mediapipe)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Netlify Status](https://img.shields.io/badge/Frontend-Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)](https://www.netlify.com/)
[![Render Status](https://img.shields.io/badge/Backend-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://render.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**AI-Powered Indian Classical Dance, Mudra Recognition & 3D Guru Assistant**  
*On-device computer vision, real-time 3D skeletal kinematics, Goonj-powered multilingual neural voice coaching, and interactive pedagogy for Bharatanatyam.*

[Live Web App](https://nrityavaani-ai.netlify.app) • [API Service](https://nrityavaani-backend.onrender.com) • [Quickstart](#local-development-quickstart) • [Architecture](#project-architecture) • [Guru Personas](#goonj-guru-voice-personas) • [Team](#team-and-credits)

</div>

---

## Overview

**NrityaVaani** preserves, digitizes, and democratizes the heritage of Indian classical dance through modern web technologies, 3D kinematics, and neural voice synthesis. Built with a **privacy-first architecture**, all live webcam gesture recognition runs **100% on-device** directly in the browser using WebAssembly and WebGL—no video frames or camera streams ever leave your computer.

### Key Features

* **3D Natya Shala Lesson Player (`/learn`)**: Pure, unobstructed 3D stage canvas with dual-gender rigs (male Natyacharya and female dancer), customizable camera presets (*Full Body*, *Face / Abhinaya*, *Mudras*, *Feet*), and dynamic tempo synchronization.
* **Goonj 3D Guru Voice Coaching**: High-fidelity neural voice synthesis featuring 15 distinct Guru personas across 12 Indian languages (*English, Hindi, Hinglish, Sanskrit, Tamil, Telugu, Malayalam, Kannada, Bengali, Odia, Marathi, Gujarati*).
* **Live Mudra Recognition (`/live`)**: Real-time 21-point 3D hand tracking at 60 FPS identifying Asamyukta (single-hand) and Samyukta (double-hand) classical mudras on-device.
* **Targeted Practice Coach (`/practice`)**: Real-time posture scoring against target gestures with interactive feedback, hold timers, and streak tracking.
* **Interactive 3D Mudra Encyclopedia (`/library`)**: 3D reference library covering 28 classical mudras with step-by-step instructions, viniyoga (usages), and common mistake corrections.
* **3D Motion Capture Lab (`/mocap`)**: In-browser full-body motion capture, bone jitter filtering, and real-time retargeting to 3D skinned models.
* **Photograph Analysis (`/upload`)**: Single-image gesture analysis running client-side with instant accuracy feedback.
* **Private by Design (`/privacy`)**: Zero camera feed transmission. All computer vision inference executes locally via Google MediaPipe Tasks-Vision.

---

## Production Architecture and Live Deployment

NrityaVaani is deployed live in production:
* **Live Web Application (Netlify)**: [https://nrityavaani-ai.netlify.app](https://nrityavaani-ai.netlify.app)
* **Live Neural API Service (Render)**: [https://nrityavaani-backend.onrender.com](https://nrityavaani-backend.onrender.com)

```mermaid
flowchart LR
    subgraph Client["User Device (Browser)"]
        UI["Next.js 16 UI / React 19"]
        CV["MediaPipe WASM (100% Local Inference)"]
        Canvas["Three.js 3D Natya Shala"]
        Audio["GuruAudioEngine (Web Audio / Fallback)"]
    end

    subgraph Netlify["Netlify Edge (Frontend)"]
        Edge["Next.js App Router (@netlify/plugin-nextjs)"]
        Static["Edge CDN & Static Asset Delivery"]
    end

    subgraph Render["Render.com (Backend Microservice)"]
        FastAPI["FastAPI ASGI Server (Python 3.10)"]
        Goonj["Goonj-1-82M / Kokoro Neural Voice Engine"]
        Cache["Audio Stream Cache (RAM / Disk)"]
    end

    UI -->|Loads App Bundle| Edge
    UI -->|Camera Frame Input| CV
    UI -->|Renders 3D Skinned Meshes| Canvas
    Audio -->|"Speech Synthesis Request"| FastAPI
    FastAPI -->|"Stream MP3 Audio"| Audio
    FastAPI --> Cache
    FastAPI --> Goonj
```

---

## Deployment Guide: Netlify + Render

Deploying NrityaVaani to production takes less than 5 minutes on free tiers.

### Step 1: Deploy Backend to Render

1. Log into **[Render.com](https://render.com)** with your GitHub account.
2. Click **New +** → **Blueprint**.
3. Select your repository (`divycoders/NrityaVaani`).
4. Render automatically parses [`render.yaml`](render.yaml) and creates the service:
   - **Service Name**: `nrityavaani-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/`
   - **Plan**: **Free** ($0/month)
5. Click **Apply**. Render will build and deploy your backend.
6. Once deployed, copy your Render service URL (e.g., `https://nrityavaani-backend.onrender.com`).

---

### Step 2: Deploy Frontend to Netlify

1. Log into **[Netlify.com](https://www.netlify.com)** with your GitHub account.
2. Click **Add new site** → **Import an existing project** → **GitHub**.
3. Select `divycoders/NrityaVaani`.
4. Netlify automatically reads [`netlify.toml`](netlify.toml):
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `.next`
5. Under **Environment variables**, add:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NEXT_PUBLIC_BACKEND_URL` | `https://nrityavaani-backend.onrender.com` | Public backend endpoint for direct client audio requests |
   | `BACKEND_URL` | `https://nrityavaani-backend.onrender.com` | Server-side rewrite proxy destination |

> [!NOTE]
> **Safety of Backend URLs**: The URL `https://nrityavaani-backend.onrender.com` is a public HTTP endpoint, not a secret credential. It contains no API keys, private tokens, or sensitive data. Next.js variables with the `NEXT_PUBLIC_` prefix are intentionally accessible to the browser.

6. Click **Deploy NrityaVaani**. Netlify builds and deploys your Next.js frontend globally at the edge.

> [!TIP]
> **Free Tier Cold Starts**: Render's free tier spins down after inactivity. The first request after an idle period may take several seconds to warm up. If Render is waking up, the frontend automatically and seamlessly falls back to the browser-native SpeechSynthesis API.

---

## Local Development Quickstart

You can run both the frontend and backend locally for development.

### 1. Backend (Terminal 1)
```bash
# Navigate to repository root
cd NrityaVaani

# Create and activate virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# Install backend dependencies
pip install -r requirements.txt

# Start FastAPI server on port 8000
uvicorn main:app --reload --port 8000
```

Verify backend:
* Healthcheck: [http://localhost:8000/](http://localhost:8000/)
* Interactive Swagger Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
* Voice Personas: [http://localhost:8000/api/tts/personas](http://localhost:8000/api/tts/personas)

### 2. Frontend (Terminal 2)
```bash
# In a separate terminal
cd NrityaVaani/frontend

# Install dependencies
npm install

# Start Next.js development server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser (*Google Chrome* or *Microsoft Edge* recommended for hardware-accelerated WebGL & WebAssembly).

---

## Project Architecture

```
NrityaVaani/
├── backend/                       # Python FastAPI Microservice
│   ├── core/
│   │   ├── classification.py      # Mathematical heuristic gesture classifier
│   │   └── goonj_tts.py           # Goonj neural TTS synthesis & caching engine
│   ├── models/                    # Model weights storage (.gitkeep)
│   ├── main.py                    # FastAPI application routes & endpoints
│   ├── requirements.txt           # Backend Python dependencies
│   └── README.md                  # Backend developer documentation
│
├── frontend/                      # Next.js 16 + React 19 Frontend Web App
│   ├── public/                    # Static assets, 3D GLBs, dance images
│   │   ├── images/                # Classical dance photography & legends
│   │   ├── lessons/               # Pre-baked .nvclip motion and audio data
│   │   └── models/                # 3D GLB rigs (figures.glb, hand.glb, natraj.glb)
│   ├── scripts/
│   │   └── build-mudra-poses.mjs  # Kinematic solver generating mudraPoses.json
│   ├── src/
│   │   ├── app/                   # App Router pages (/live, /learn, /library, /mocap)
│   │   ├── components/            # UI components, 3D Natya Shala stages & canvas rigs
│   │   └── lib/                   # Motion classification, MediaPipe, voice engines
│   ├── next.config.ts             # API rewrites & backend proxy routing
│   ├── package.json               # Frontend dependencies & scripts
│   ├── tsconfig.json              # TypeScript configuration
│   └── README.md                  # Frontend developer documentation
│
├── netlify.toml                   # Netlify configuration (Frontend build & edge plugins)
├── render.yaml                    # Render Blueprint (Backend FastAPI web service hosting)
├── main.py                        # Root ASGI entrypoint (uvicorn main:app --reload)
├── requirements.txt               # Pinned root Python dependencies
├── .gitignore                     # Git ignore rules for node_modules, cache & models
└── README.md                      # Comprehensive project documentation
```

---

## Goonj Guru Voice Personas

NrityaVaani incorporates 15 distinct Guru voice profiles tailored to classical dance pedagogy:

| Persona | Gender | Language / Dialect | Tone & Signature | Pedagogical Domain |
| :--- | :--- | :--- | :--- | :--- |
| **Guru Priya** | Female | Indian English (`en`) | Articulate & Encouraging | Clear diction, contemporary pedagogy & anatomical precision |
| **Guru Arjun** | Male | Indian English (`en`) | Commanding & Rhythmic | Adavu footwork, energetic rhythm & driving tala |
| **Guru Ananya** | Female | Indian English (`en`) | Gentle & Melodic | Delicate mudras, abhinaya nuances & beginner guidance |
| **Guru Kabir** | Male | Indian English (`en`) | Firm & Authoritative | Strict tala, rhythm drills & stamina |
| **Guru Divya** | Female | Indian English (`en`) | Meticulous & Poised | Body alignment, knee turnout & balance |
| **Guru Dev** | Male | Indian English (`en`) | Calm & Measured | Meditative flow, breath awareness & slow practice |
| **Guru Nisha** | Female | Modern English (`en`) | Crisp & Contemporary | International learners & global clarity |
| **Guru Sameer** | Male | Indian English (`en`) | Warm & Approachable | Easing beginner tension & building immediate confidence |
| **Guru Tara** | Female | Indian English (`en`) | Joyful & Radiant | Vitality, uplifting energy & soloist presentation |
| **Guru Aman** | Male | Indian English (`en`) | Methodical & Patient | Hand-foot coordination drills & breaking complex bols |
| **Guru Meera** | Female | Classical Hindi (`hi`) | Warm & Emotive | Traditional abhinaya, mudra nuance & devotional rasa |
| **Guru Atul** | Male | Shastri Baritone (`hi`) | Deep & Resonant | Natyashastra shlokas, sacred chants & dignified recitation |
| **Guru Shivani** | Female | Vibrant Hindi (`hi`) | Bright & Inspiring | Navarasa, facial abhinaya & eye glances |
| **Guru Ravi** | Male | Dynamic Hindi (`hi`) | Bold & Motivating | Tandava drills, stamina & vigorous form |
| **Guru Parampara** | Female | Vedic Sanskrit (`sa`) | Sacred Vedic Intonation | Pure Natyashastra shlokas, invocations & mantras |

---

## Privacy and Technical Guarantees

* **Zero Cloud Video Transmission**: The user's camera stream is evaluated frame-by-frame purely in browser memory through MediaPipe WebAssembly. No video frames, photographs, or landmark coordinates are saved or transmitted to remote servers.
* **Client-First Fallback**: If the neural voice backend is offline or waking from sleep, the application gracefully and instantly falls back to the native browser SpeechSynthesis API.
* **Stateless REST Architecture**: The backend FastAPI service maintains zero user tracking, preserving privacy while serving dynamic voice and inference requests.

---

## Team and Credits

Developed with dedication by **DivyCoders**:
* **Mayank** — Team Lead
* **Divyanand Pandey** — Team Lead
* **Manthan** — Team Member
* **Pranav Jithesh** — Team Member

---

## License

This project is licensed under the [MIT License](LICENSE).
