# NrityaVaani - Frontend Web Application

The interactive web client for **NrityaVaani**—an AI-powered Indian classical dance mudra recognition, 3D kinematics, and multilingual Goonj Guru coaching platform.

---

## Tech Stack and Architecture

* **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React 19 Server & Client Components)
* **3D Canvas & Kinematics**: [Three.js](https://threejs.org/) with procedural GLB skeletal retargeting (`figures.glb`, `hand.glb`, `natraj.glb`)
* **Computer Vision (100% On-Device)**: [Google MediaPipe Tasks-Vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) (WebGL & WebAssembly acceleration)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & [Framer Motion](https://www.framer.com/motion/)
* **Audio Engine**: Custom `GuruAudioEngine` client with low-latency blob playback, tempo synchronization, and fallback speech synthesis
* **Hosting Target**: [Netlify](https://www.netlify.com/) via `@netlify/plugin-nextjs`

---

## Source Structure

```
frontend/
├── public/                 # Static assets, 3D GLB models, classical dance images
│   ├── images/             # Dance forms & classical legends
│   ├── lessons/            # Pre-baked .nvclip motion and audio clips
│   └── models/             # 3D GLB rigs (figures.glb, hand.glb, natraj.glb)
│
├── scripts/
│   └── build-mudra-poses.mjs # Build-time kinematic solver generating mudraPoses.json
│
├── src/
│   ├── app/                # Next.js App Router
│   │   ├── (auth)/         # Login, signup & profile authentication
│   │   ├── about/          # Project mission, cultural heritage & team
│   │   ├── learn/          # 3D Natya Shala lesson player with dual-gender rigs
│   │   ├── library/        # Interactive 3D encyclopedia for 28 classical mudras
│   │   ├── live/           # Real-time webcam 60 FPS mudra classifier
│   │   ├── mocap/          # Full-body motion capture & bone jitter filtering
│   │   ├── practice/       # Target posture scoring & streak tracking
│   │   └── upload/         # Client-side static photo gesture analysis
│   │
│   ├── components/         # Reusable UI widgets, navigation & 3D canvases
│   │   ├── 3d/             # Three.js Natya Shala scenes, rigs & camera controls
│   │   ├── learn/          # Lesson player overlays, beat counters & telemetry
│   │   └── library/        # 3D mudra inspector & reference cards
│   │
│   └── lib/                # Core client services & business logic
│       ├── constants/      # Mudra definitions, poses & dance metadata
│       ├── lesson/         # Lesson manifests, translation dictionaries
│       ├── mediapipe/      # Hand landmark tracking & kinematic classifiers
│       ├── motion/         # Skeletal smoothing, collision detection & codecs
│       └── voice/          # Goonj Audio Engine & 15 Guru Personas
│
├── next.config.ts          # Turbopack, rewrites & API backend proxies
├── package.json            # Dependencies & build scripts
└── tsconfig.json           # TypeScript configuration
```

---

## Local Development

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Start the Development Server
```bash
npm run dev
```

Visit **[http://localhost:3000](http://localhost:3000)** in your browser (Google Chrome or Microsoft Edge with WebGL enabled recommended).

### 3. Available Scripts
* `npm run dev`: Starts local development server on port 3000.
* `npm run build`: Creates an optimized production build with Turbopack.
* `npm run start`: Runs the built production server locally.
* `npm run lint`: Runs ESLint 9 checks.
* `npm run build:poses`: Recomputes 3D joint rotations and generates `mudraPoses.json`.

---

## Deploying to Netlify

The frontend is pre-configured for automated continuous deployment on **Netlify** via root [`netlify.toml`](../netlify.toml).

### Netlify Deployment Steps
1. Push your repository to GitHub.
2. In the Netlify dashboard, select **Add new site** → **Import an existing project**.
3. Select `divycoders/NrityaVaani`.
4. Netlify automatically detects the root `netlify.toml` with:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `.next`
5. Configure Environment Variables in **Site configuration** → **Environment variables**:
   - `NEXT_PUBLIC_BACKEND_URL`: `https://nrityavaani-backend.onrender.com` (Your Render backend URL)
   - `BACKEND_URL`: `https://nrityavaani-backend.onrender.com`
6. Click **Deploy Site**.
