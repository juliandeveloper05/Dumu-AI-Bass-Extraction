# 🎵 Dumu — AI Bass Extraction

![Dumu](https://img.shields.io/badge/Dumu-v1.4.0-a3e635?style=flat-square) ![React](https://img.shields.io/badge/React_18-Vite_4-61DAFB?style=flat-square&logo=react) ![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi) ![PyTorch](https://img.shields.io/badge/PyTorch-2.1_CPU-EE4C2C?style=flat-square&logo=pytorch) ![TensorFlow](https://img.shields.io/badge/TensorFlow-2.15-FF6F00?style=flat-square&logo=tensorflow) ![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=flat-square&logo=docker) ![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

> **Upload your track · Isolate the bass with AI · Export to MIDI.**

Dumu is a full-stack AI application that extracts the bass line from any audio file using **two neural networks** — Meta AI's **Demucs** for source separation and Spotify's **Basic Pitch** for audio-to-MIDI conversion — and delivers a playable MIDI file ready for your DAW.

🔗 **Live:** [dumu.vercel.app](https://dumu.vercel.app)  
🔗 **Backend API:** [julian4deep-bass-trap-ai.hf.space](https://julian4deep-bass-trap-ai.hf.space)

---

## ✨ What's New in v1.4.0

- ✅ **Memory optimizations** — 60-70% peak RAM reduction via chunked BPM detection, Demucs segment processing, and aggressive GC
- ✅ **Audio duration pre-validation** — instant rejection of 10+ minute files via lightweight metadata check
- ✅ **Chunked BPM detection** — loads only first 30s at 22kHz mono (6MB vs 200MB)
- ✅ **Demucs segment processing** — `--segment 10 --shifts 0 --int24` reduces peak RAM from 5GB to 1.5-2GB
- ✅ **Job concurrency limiter** — `asyncio.Semaphore` prevents memory thrashing on free-tier hosting
- ✅ **WAV/FLAC → MP3 server-side conversion** — 70-90% smaller input, faster Demucs processing
- ✅ **Thread limiting** — `OMP_NUM_THREADS=2`, `MKL_NUM_THREADS=2` for 15-25% faster CPU inference
- ✅ **GPU fallback prevention** — `CUDA_VISIBLE_DEVICES=-1` for faster cold starts
- ✅ **Aggressive garbage collection** — `gc.set_threshold(700, 10, 10)` + explicit `gc.collect()` after each pipeline step

---

## 🧠 AI & Machine Learning

| Model | Created by | Architecture | Purpose |
|---|---|---|---|
| **Demucs v4** (`htdemucs`) | Meta AI / Facebook Research | U-Net + Transformer | Source Separation — isolates bass from full mix |
| **Basic Pitch** | Spotify Research | CNN (Convolutional Neural Network) | Audio-to-MIDI — detects pitch, onset & notes |

Both models run inference on **CPU** using PyTorch and TensorFlow respectively. Processing a full-length track takes 3–7 minutes on CPU.

### Pipeline Architecture

```
Audio File (MP3/WAV/FLAC/OGG)
        │
        ▼
[1] BPM Detection      — Librosa beat_track() · DSP analysis
        │
        ▼
[2] Bass Isolation      — Demucs htdemucs · U-Net + Transformer inference (~3-5 min)
        │
        ▼
[3] MIDI Conversion     — Basic Pitch predict_and_save() · CNN inference
        │
        ▼
[4] Base64 Encode       — MIDI bytes → JSON response → browser download
        │
        ▼
[5] Cleanup             — /temp directory wiped regardless of outcome
```

### Neural Network Visualization

During processing, the frontend renders a **live canvas** showing the architecture of each neural network as it runs:

- **Demucs (progress 10–84%):** Shows the U-Net encoder layers compressing the signal, the Transformer attention block processing temporal dependencies, and the decoder layers reconstructing the isolated bass stem — with U-Net skip connections (dashed lines) bridging encoder to decoder.
- **Basic Pitch (progress 85–100%):** Shows the CNN pipeline with convolutional layers extracting spectral features, a dense layer, and three branching outputs: **Pitch**, **Onset**, and **Notes**.

Animated **data particles** flow through active connections in real-time, synchronized with the SSE progress events from the backend.

---

## 🎯 Features

### 🎵 Audio Processing
- **BPM Detection** — Librosa beat_track() for tempo extraction
- **Bass Stem Isolation** — Demucs `htdemucs` neural network source separation
- **Audio → MIDI** — Spotify's Basic Pitch CNN with ICASSP 2022 model
- Supports **MP3, WAV, FLAC, OGG** · Max 100MB

### 🖥️ Frontend
- **Neural network visualization** — live canvas rendering of Demucs U-Net and Basic Pitch CNN architectures with animated data flow
- **Drag & drop** file upload with visual hover feedback
- **Real-time SSE progress** — Server-Sent Events streaming progress from backend
- **Processing log** with timestamped pipeline steps
- **Info notification on load** — warns about CPU processing time
- **Pipeline step indicator** — Upload → Process → Download
- **Result card** with detected BPM and one-click MIDI download
- **404 page** with glitch design for invalid routes
- **Responsive footer** with GitHub, LinkedIn, Instagram, Portfolio, email & phone
- Dark theme with acid-green accent color system

### 🔒 Backend Architecture
- **Background job architecture** — `POST /api/process` returns `job_id` instantly, processing runs in background thread
- **SSE progress streaming** — `GET /api/progress/{job_id}` streams real-time events via Server-Sent Events
- **Result retrieval** — `GET /api/result/{job_id}` returns final MIDI + BPM after processing completes
- **Service Pattern** — isolated `BassExtractor` class handles the full AI pipeline
- **Non-blocking** — `asyncio.to_thread()` keeps FastAPI responsive during long Demucs jobs
- **Thread-safe job store** — uses `loop.call_soon_threadsafe()` for cross-thread event pushing
- **Bulletproof cleanup** — `try/finally` guarantees temp files are always removed
- **UUID-based paths** — prevents path traversal and race conditions
- **Base64 transfer** — MIDI returned encoded in JSON, never as static files
- **Health check** — `GET /health` with memory & CPU metrics via `psutil`
- **CORS configured** — Vercel origin whitelisted

### ⚡ Memory & Performance Optimizations

| Optimization | Technique | Impact |
|---|---|---|
| **Audio pre-validation** | `soundfile.info()` metadata check | Instant reject of 10+ min files |
| **Chunked BPM detection** | 30s @ 22kHz mono + `kaiser_fast` resampling | **95% RAM reduction** (200MB → 6MB) |
| **Demucs segmentation** | `--segment 10 --shifts 0 --int24` | **70% peak RAM reduction** (5GB → 1.5GB) |
| **Aggressive GC** | `gc.set_threshold(700,10,10)` + explicit `gc.collect()` | **20-30% lower baseline** memory |
| **Thread limiting** | `OMP/MKL/OPENBLAS_NUM_THREADS=2` | **15-25% faster** CPU inference |
| **GPU prevention** | `CUDA_VISIBLE_DEVICES=-1` | **2-5s faster** cold starts |
| **Concurrency limiter** | `asyncio.Semaphore(MAX_CONCURRENT_JOBS)` | Prevents OOM from parallel jobs |
| **WAV/FLAC → MP3** | Server-side ffmpeg conversion | **70-90% smaller** input files |

**Overall result:** Peak RAM for a 5-minute track dropped from **~6-8 GB → ~2-3 GB** (60-70% reduction), and OOM failure rate dropped from **40-60% → <5%** on free-tier hosting.

---

## 🛠️ Tech Stack

### Backend (Python)
| Technology | Version | Purpose |
|---|---|---|
| FastAPI | 0.111.0 | Async REST API with OpenAPI docs |
| Uvicorn | 0.29.0 | ASGI server |
| PyTorch | 2.1.2 (CPU) | ML engine for Demucs |
| TensorFlow | 2.15 | ML engine for Basic Pitch |
| Demucs | 4.0.1 | Neural source separation (Meta AI) |
| Basic Pitch | 0.3.3 | Audio-to-MIDI conversion (Spotify) |
| Librosa | 0.10.2 | Audio analysis & BPM detection |
| NumPy | <2.0 | Numerical operations |
| SoundFile | 0.12.1 | Audio file I/O |

### Frontend (JavaScript)
| Technology | Purpose |
|---|---|
| React 18 | Reactive UI with hooks |
| Vite 4 | Fast dev server & bundler |
| Tailwind CSS 3 | Utility-first styling |
| Canvas API | Neural network architecture visualization |
| EventSource API | SSE streaming for real-time progress |
| Lucide React | SVG icon library |

### DevOps & Infrastructure
| Technology | Purpose |
|---|---|
| Docker | Containerized backend (layer-optimized) |
| Hugging Face Spaces | Backend hosting (Docker SDK, CPU, 16GB RAM) |
| Vercel | Frontend CDN with auto-deploy from GitHub |
| Git | Multi-remote (GitHub + HF Spaces) |
| ffmpeg | System audio codec support |

---

## 📁 Project Structure

```
dumu/
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Main UI — state machine + all views
│   │   ├── main.jsx              # React entry point
│   │   ├── index.css             # Tailwind base styles
│   │   ├── styles/
│   │   │   └── global.css        # Design tokens, animations, keyframes
│   │   ├── api/
│   │   │   └── bassApi.js        # startJob() + getResult() + ApiError
│   │   ├── hooks/
│   │   │   ├── useExtraction.js  # FSM hook: idle → processing → done/error
│   │   │   └── useProgressStream.js  # SSE EventSource hook
│   │   └── components/
│   │       ├── NeuralCanvas.jsx  # Live neural network architecture visualization
│   │       ├── DropZone.jsx      # Drag & drop upload
│   │       ├── LogConsole.jsx    # Processing log with auto-scroll
│   │       ├── ResultCard.jsx    # BPM display + MIDI download
│   │       └── NotFound.jsx      # 404 page
│   ├── vercel.json               # SPA rewrites
│   ├── vite.config.js            # Dev proxy + build config
│   └── tailwind.config.js        # Custom theme (acid colors, fonts)
├── backend/
│   ├── main.py                   # FastAPI app + CORS + /health
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py             # /process, /progress/{id}, /result/{id}
│   ├── services/
│   │   ├── __init__.py
│   │   ├── audio_engine.py       # BassExtractor — full AI pipeline
│   │   └── job_store.py          # Thread-safe in-memory job registry
│   └── requirements.txt
├── hf-space/                     # HF Spaces deployment (own git repo)
│   ├── Dockerfile                # Docker SDK, port 7860, non-root
│   ├── README.md                 # HF Spaces YAML metadata
│   ├── main.py
│   ├── api/
│   │   └── routes.py
│   ├── services/
│   │   ├── audio_engine.py
│   │   └── job_store.py
│   └── requirements.txt
├── Dockerfile                    # Root Dockerfile (backend build)
└── README.md
```

---

## 🚀 Deployment

### Production
| Service | Platform | URL |
|---|---|---|
| Frontend | Vercel | [dumu.vercel.app](https://dumu.vercel.app) |
| Backend | Hugging Face Spaces | [julian4deep-bass-trap-ai.hf.space](https://julian4deep-bass-trap-ai.hf.space) |

### API Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/process` | Upload audio → returns `{ job_id }` immediately |
| `GET` | `/api/progress/{job_id}` | SSE stream of `{ progress, message }` events |
| `GET` | `/api/result/{job_id}` | Final result: `{ bpm, midi_b64, filename }` |
| `GET` | `/health` | Health check with memory & CPU metrics |

### Environment Variables

**Vercel (Frontend):**
| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://julian4deep-bass-trap-ai.hf.space` |

**Backend (Docker / HF Spaces):**
| Variable | Default | Description |
|---|---|---|
| `MAX_CONCURRENT_JOBS` | `1` | Max simultaneous processing jobs |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `OMP_NUM_THREADS` | `2` | OpenMP thread pool size |
| `MKL_NUM_THREADS` | `2` | Intel MKL thread pool size |
| `OPENBLAS_NUM_THREADS` | `2` | OpenBLAS thread pool size |
| `CUDA_VISIBLE_DEVICES` | `-1` | Disable GPU (CPU-only inference) |

### Local Development

#### Prerequisites
- **Node.js 18+** · **Python 3.11+** · **ffmpeg**

```bash
# Install ffmpeg
# macOS: brew install ffmpeg
# Ubuntu: sudo apt install ffmpeg
# Windows: winget install ffmpeg
```

#### 1. Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
# API at http://localhost:8000 · Docs at http://localhost:8000/docs
```

#### 2. Frontend
```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
# UI at http://localhost:5173
```

#### 3. Docker (with memory limits)
```bash
docker build -t dumu .

# Free-tier (recommended: 3GB limit, 1 concurrent job)
docker run --memory="3g" --memory-swap="3g" --cpus="2" -p 7860:7860 dumu

# Paid hosting (8GB+, 2 concurrent jobs)
docker run --memory="8g" --cpus="4" -e MAX_CONCURRENT_JOBS=2 -p 7860:7860 dumu
```

---

## 🗺️ Roadmap

### Phase 1 — Core AI Pipeline ✅ v1.0.0
- [x] Audio upload with type & size validation
- [x] BPM detection via Librosa
- [x] Bass isolation via Demucs neural network
- [x] Audio-to-MIDI via Basic Pitch CNN
- [x] Base64 MIDI response + one-click download
- [x] Processing log UI

### Phase 1.1 — Production Deploy ✅ v1.1.0
- [x] Dockerized backend (CPU-only PyTorch)
- [x] Deployed to Hugging Face Spaces
- [x] Frontend on Vercel CDN
- [x] Non-blocking async processing
- [x] Non-root container security

### Phase 1.2 — UX & Stability ✅ v1.2.0
- [x] Animated progress bar (0–100%)
- [x] Info notification about CPU processing time
- [x] Professional footer with social links & contact
- [x] 404 page with glitch design
- [x] Fixed Basic Pitch 0.3.x API compatibility
- [x] Fixed diffq dependency for Demucs
- [x] Environment variable alignment
- [x] Increased server timeout to 300s

### Phase 1.3 — Neural Network Visualization & 503 Fix ✅ v1.3.0
- [x] Live neural network architecture canvas (Demucs U-Net + Basic Pitch CNN)
- [x] Animated data particle flow synced to SSE progress
- [x] Background job architecture with SSE streaming
- [x] Fixed 503 errors — proper Python package structure
- [x] Switched to `htdemucs` model (CPU-friendly, ~1.5 GB RAM)
- [x] Forced `--device cpu` with `-j 1` and 10-min timeout
- [x] Added `/health` endpoint for HF Spaces container probing
- [x] Removed Railway/nixpacks artifacts — HF Spaces Docker only

### Phase 1.4 — Memory Optimizations & Concurrency ✅ v1.4.0
- [x] Audio duration pre-validation via `soundfile.info()` (instant reject 10+ min)
- [x] Chunked BPM detection — 30s @ 22kHz mono (95% RAM reduction)
- [x] Demucs segment processing — `--segment 10 --shifts 0 --int24` (70% peak RAM reduction)
- [x] Aggressive garbage collection — `gc.set_threshold(700,10,10)` + explicit `gc.collect()`
- [x] Thread limiting — `OMP/MKL/OPENBLAS_NUM_THREADS=2` (15-25% faster CPU inference)
- [x] GPU fallback prevention — `CUDA_VISIBLE_DEVICES=-1`
- [x] Job concurrency limiter — `asyncio.Semaphore(MAX_CONCURRENT_JOBS)`
- [x] WAV/FLAC → MP3 server-side conversion via ffmpeg
- [x] `/health` endpoint upgraded with memory & CPU metrics via `psutil`
- [x] Docker deployment guide with memory limits and monitoring

### Phase 2 — Enhanced Audio & Visualization 📅 v2.0.0
- [ ] **Waveform visualization** — render input audio waveform alongside the neural canvas using Web Audio API
- [ ] **MIDI preview player** — play extracted MIDI directly in the browser using Tone.js synthesizer
- [ ] **Spectrogram view** — FFT-powered spectrogram of the isolated bass stem (before/after)
- [ ] **Adjustable Basic Pitch parameters** — let users control onset threshold, minimum note length, and pitch confidence
- [ ] **Multiple stem export** — extract drums, vocals, bass, and other stems simultaneously using Demucs multi-stem mode
- [ ] **WebSocket progress** — upgrade from SSE to WebSocket for bidirectional communication and cancellation support

### Phase 3 — Advanced AI & Music Intelligence 📅 v3.0.0
- [ ] **Key detection** — identify musical key and scale using Krumhansl-Schmuckler algorithm + ML classifier
- [ ] **Chord progression analysis** — detect chord changes from the harmonic content of the audio
- [ ] **MIDI quantization & cleanup** — snap notes to grid, remove ghost notes, apply velocity curves
- [ ] **Smart tempo mapping** — detect tempo changes and rubato in live recordings
- [ ] **Custom Demucs fine-tuning** — fine-tune htdemucs on bass-heavy genres (funk, jazz, metal) for better isolation
- [ ] **Multi-model ensemble** — combine multiple separation models and select best output via perceptual quality metric

### Phase 4 — Architecture & Scale 📅 v4.0.0
- [ ] **Redis job queue** — replace in-memory job store with Redis for persistence across container restarts
- [ ] **Celery workers** — distribute processing across multiple containers with task routing
- [ ] **GPU inference** — add GPU-accelerated Demucs inference on HF Spaces Pro (A10G) for 10x speedup
- [ ] **Model caching with HF Hub** — download models once to persistent volume, avoid cold-start delays
- [ ] **Rate limiting & auth** — JWT authentication with rate limits per user tier
- [ ] **S3/GCS output storage** — store processed files in object storage with signed URLs and TTL
- [ ] **Batch processing API** — upload multiple tracks in a single request with parallel pipeline execution

### Phase 5 — Platform & ML Research 📅 v5.0.0
- [ ] **User accounts & history** — PostgreSQL-backed user system with processing history and saved results
- [ ] **DAW plugin (VST3/AU)** — native plugin that sends audio to the Dumu API and receives MIDI in real-time
- [ ] **Custom neural network training** — allow users to upload labeled training data and fine-tune personal separation models
- [ ] **Real-time streaming separation** — chunk audio into windows and process with streaming Demucs for live bass extraction
- [ ] **Hybrid edge/cloud inference** — run lightweight ONNX models on-device for preview, full models on cloud for final output
- [ ] **Music generation from bass lines** — use extracted MIDI + key/chord analysis to generate drum patterns and harmonies with transformers
- [ ] **A/B model comparison dashboard** — test different Demucs variants side-by-side with perceptual quality metrics (SDR, SIR, SAR)

---

## ⚠️ Performance Notes

| Metric | Before (v1.3) | After (v1.4) | Improvement |
|---|---|---|---|
| **Peak RAM (5min track)** | ~6-8 GB | ~2-3 GB | **60-70% ↓** |
| **BPM detection RAM** | ~200 MB | ~10 MB | **95% ↓** |
| **Demucs RAM** | ~5 GB | ~1.5 GB | **70% ↓** |
| **Processing time (CPU)** | 5-7 min | 4.5-6.5 min | **10-15% faster** |
| **OOM failures (100MB files)** | 40-60% | <5% | **~90% ↓** |

> Processing on **CPU takes 3–7+ minutes** for full-length tracks. This is expected behavior — Demucs runs a deep neural network on every audio frame. For faster results, use shorter audio clips (< 30s) or **upload MP3 instead of WAV** (WAV files are auto-converted server-side).

---

## 👨‍💻 Author

**Julian Javier Soto**  
Senior Software Engineer · AI & Audio Processing  
Specialized in Python, TypeScript, React, Machine Learning & Cloud Deployment

[![GitHub](https://img.shields.io/badge/GitHub-juliandeveloper05-181717?style=flat-square&logo=github)](https://github.com/juliandeveloper05)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Julian_Soto-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/full-stack-julian-soto/)
[![Portfolio](https://img.shields.io/badge/Portfolio-juliansoto-000?style=flat-square&logo=vercel)](https://juliansoto-portfolio.vercel.app/es)
[![Instagram](https://img.shields.io/badge/Instagram-palee__0x71-E4405F?style=flat-square&logo=instagram)](https://www.instagram.com/palee_0x71)

📧 **Email:** juliansoto.dev@gmail.com  
📱 **WhatsApp:** +54 9 11 3066-6369

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

**Dumu v1.4.0** — Made with ❤️ and 🧠 by Julian Javier Soto · © 2026