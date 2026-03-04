# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dumu** is a full-stack AI application that extracts bass lines from audio files using neural networks and converts them to MIDI. It uses Meta AI's **Demucs** (htdemucs model) for source separation and Spotify's **Basic Pitch** for audio-to-MIDI conversion.

- **Frontend**: React 18 + Vite 4 + Tailwind CSS, deployed on Vercel
- **Backend**: FastAPI + PyTorch (CPU) + TensorFlow, deployed on Hugging Face Spaces (Docker)
- **Live URLs**:
  - Frontend: https://dumu.vercel.app
  - Backend API: https://julian4deep-bass-trap-ai.hf.space

## Development Commands

### Backend (Python 3.11+)

```bash
cd backend

# Install dependencies (requires ffmpeg system package)
pip install -r requirements.txt

# Run development server
uvicorn main:app --reload
# API available at: http://localhost:8000
# API docs at: http://localhost:8000/docs

# Test health endpoint
curl http://localhost:8000/health
```

### Frontend (Node.js 18+)

```bash
cd frontend

# Install dependencies
npm install --legacy-peer-deps

# Run development server (proxies /api to localhost:8000)
npm run dev
# UI available at: http://localhost:5173

# Build for production
npm run build

# Preview production build
npm preview

# Deploy to Surge (legacy)
npm run deploy
```

### Docker

```bash
# Build backend container
docker build -t dumu .

# Run container (Hugging Face Spaces uses port 7860)
docker run -p 7860:7860 dumu
```

## Architecture

### Backend Architecture (Python)

**Key Pattern: Background Job Processing with SSE Progress Streaming**

The backend uses a **non-blocking job queue architecture** to handle long-running AI processing:

1. **`POST /api/process`** — Accepts audio file, returns `job_id` immediately, launches background thread
2. **`GET /api/progress/{job_id}`** — SSE endpoint streaming real-time progress events
3. **`GET /api/result/{job_id}`** — Returns final MIDI + BPM after processing completes

**Critical Files:**

- **`backend/main.py`** — FastAPI app entry point, CORS config, health endpoint
- **`backend/api/routes.py`** — API endpoints, file validation, job orchestration
- **`backend/services/audio_engine.py`** — `BassExtractor` class containing the full AI pipeline
- **`backend/services/job_store.py`** — In-memory job registry with thread-safe event queues

**Thread Safety Pattern:**

The `job_store.py` uses `asyncio.Queue` for each job and captures the event loop at job creation. When the worker thread (spawned via `asyncio.to_thread()`) needs to push progress events, it uses `loop.call_soon_threadsafe()` to safely schedule the queue update from the worker thread to the main async event loop.

**Processing Pipeline:**

```
1. BPM Detection (progress 10%) — librosa.beat.beat_track()
2. Bass Isolation (progress 30-84%) — Demucs subprocess (htdemucs model, CPU, -j 1, 600s timeout)
3. MIDI Conversion (progress 85-94%) — Basic Pitch predict_and_save() with bass-tuned params (30-400 Hz, onset 0.6, frame 0.5, min note 100ms)
4. MIDI Quantization (progress 95-99%) — pretty_midi snaps all notes to 1/16-note grid at detected BPM
5. Base64 Encode — MIDI bytes returned in JSON response
6. Cleanup — temp/ directory wiped regardless of success/failure
```

**Key Design Decisions:**

- Uses `htdemucs` model (~1.5 GB) instead of larger models to prevent OOM on free-tier hosting
- Forces CPU execution with `--device cpu` and `-j 1` (single worker) for Demucs
- UUID-based temporary file paths prevent path traversal and race conditions
- File size capped at 100MB, validated before writing to disk
- Base64-encoded MIDI transfer (never served as static files)

### Frontend Architecture (React)

**Key Pattern: Finite State Machine + SSE Progress Streaming**

The frontend uses a clean FSM pattern managed by the `useExtraction` hook:

```
IDLE → PROCESSING → DONE/ERROR
```

**Critical Files:**

- **`frontend/src/App.jsx`** — Root component, pure UI state machine
- **`frontend/src/hooks/useExtraction.js`** — FSM hook managing extraction lifecycle
- **`frontend/src/hooks/useProgressStream.js`** — SSE EventSource hook for real-time progress
- **`frontend/src/api/bassApi.js`** — Centralized API client (no fetch calls in components)
- **`frontend/src/components/NeuralCanvas.jsx`** — Live neural network visualization with animated data flow

**State Flow:**

1. User selects file → `handleFile()` sets local state
2. User clicks "Extract" → `startExtraction()` calls `POST /api/process`
3. Receives `job_id` → triggers `useProgressStream()` to open SSE connection
4. SSE events update progress (0-100%) and log messages in real-time
5. When progress reaches 100% → `getResult()` fetches final MIDI + BPM
6. User downloads MIDI via `downloadResult()` (converts base64 → Blob → download)

**Important Notes:**

- No external routing library — lightweight 404 via `window.location.pathname`
- Vite dev server proxies `/api` to `localhost:8000` (see `vite.config.js`)
- Production uses `VITE_API_URL` env var pointing to HF Spaces backend
- PWA support via `vite-plugin-pwa` with auto-update service worker

### Deployment Structure

The project has **two separate deployment targets**:

1. **Frontend → Vercel**
   - Auto-deploys from GitHub on push to master
   - Env var: `VITE_API_URL=https://julian4deep-bass-trap-ai.hf.space`
   - SPA rewrites configured in `frontend/vercel.json`

2. **Backend → Hugging Face Spaces (Docker SDK)**
   - Separate git repo at `hf-space/` (copied from `backend/`)
   - Uses root `Dockerfile` (multi-stage build optimized for CPU PyTorch)
   - Pre-downloads htdemucs model at build time to avoid cold start delays
   - Container runs as non-root, exposes port 7860

**CORS Configuration:**

The backend's `ALLOWED_ORIGINS` env var is set to whitelist the Vercel domain. Locally it defaults to `*` for development.

## Common Gotchas

### Backend

1. **Demucs subprocess timeout**: Set to 600 seconds (10 minutes). If processing longer tracks, increase timeout in `backend/services/audio_engine.py`.

1b. **Audio duration validation**: Files longer than 10 minutes (600 seconds) are rejected at upload time via `soundfile.info()` check. Adjust `MAX_DURATION_SECONDS` in `audio_engine.py` if needed.

1c. **Demucs `--segment` limit**: `htdemucs` is a Transformer model with a hard maximum segment of 7.8 seconds. Never set `--segment` above `7` or Demucs will crash with `"Cannot use a Transformer model with a longer segment than it was trained for"`.

2. **Basic Pitch output naming**: The library varies MIDI filename format across versions. The code uses a glob fallback pattern (`*.mid`) if exact match fails — see `audio_engine.py`.

2b. **Basic Pitch `model_or_model_path`**: In 0.3.3 this is a required positional argument — always pass `ICASSP_2022_MODEL_PATH` imported from `basic_pitch`. Omitting it raises `TypeError` at runtime.

3. **Thread-safe event pushing**: Always use `loop.call_soon_threadsafe()` when pushing events from worker threads. Direct queue operations will fail silently.

4. **Cleanup guarantees**: The `try/finally` block in `routes.py:_run_pipeline()` ensures `engine.cleanup()` runs even if processing fails.

5. **WAV/FLAC auto-conversion**: Large lossless files are automatically converted to MP3 (192kbps) before processing to reduce memory footprint by 70-90%. See `routes.py:18-65`.

6. **Job concurrency limit**: Only 1 job processes at a time by default (configurable via `MAX_CONCURRENT_JOBS` env var). This prevents memory thrashing on free-tier hosting. See `routes.py:17-21`.

### Frontend

1. **SSE connection lifecycle**: `useProgressStream` automatically closes the EventSource when progress reaches 100% or on error. Do not manually close it.

2. **Base64 MIDI decoding**: Use `atob()` → `Uint8Array` → `Blob` pattern in `downloadResult()`. Do not use `fetch()` with `data:` URIs (breaks in some browsers).

3. **Package installation**: Always use `npm install --legacy-peer-deps` due to React 18 peer dependency conflicts with some packages.

4. **Neural network visualization**: `NeuralCanvas.jsx` switches architecture rendering based on progress percentage (Demucs at 10-84%, Basic Pitch at 85-100%). Keep this in sync with backend progress percentages.

## Key Dependencies

### Backend

- **PyTorch 2.1.2 (CPU-only)**: Installed via custom index URL in Dockerfile to avoid full CUDA build (~3GB savings)
- **NumPy <2.0**: Pinned due to TensorFlow 2.15 incompatibility
- **Demucs 4.0.1**: Uses htdemucs pretrained model (~1.5GB, downloaded at Docker build time)
- **Basic Pitch 0.3.3**: Breaking API changes between 0.2.x and 0.3.x — current code targets 0.3.x. `model_or_model_path` is required; pass `ICASSP_2022_MODEL_PATH` from `basic_pitch`. Bass-specific inference params defined as module-level constants in `audio_engine.py`: `BASS_MIN_FREQ_HZ=30`, `BASS_MAX_FREQ_HZ=400`, `BASS_ONSET_THRESHOLD=0.6`, `BASS_FRAME_THRESHOLD=0.5`, `BASS_MIN_NOTE_LENGTH_MS=100`.
- **pretty_midi 0.2.10**: Used in the `quantize_midi()` step to snap note times to a 1/16-note grid. Grid step = `60 / bpm / 4` seconds. Notes shorter than one grid step are stretched to exactly one step to avoid zero-duration notes.

### Frontend

- **Vite 4**: Dev server with HMR, proxy config for local backend
- **Tailwind CSS 3**: Custom theme with "acid" color tokens (see `tailwind.config.js`)
- **lucide-react**: SVG icon library (tree-shakeable, lighter than react-icons)
- **vite-plugin-pwa**: Service worker generation for PWA support

## Testing the Full Pipeline Locally

1. Ensure `ffmpeg` is installed system-wide:
   - macOS: `brew install ffmpeg`
   - Ubuntu: `sudo apt install ffmpeg`
   - Windows: `winget install ffmpeg`

2. Start backend:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

3. Start frontend:
   ```bash
   cd frontend
   npm install --legacy-peer-deps
   npm run dev
   ```

4. Open http://localhost:5173, upload a short audio file (~30s recommended for faster testing)

5. Watch SSE progress in browser DevTools Network tab (EventSource connection to `/api/progress/{job_id}`)

## Important Environment Variables

### Frontend (Vercel)

- `VITE_API_URL` — Backend origin (e.g., `https://julian4deep-bass-trap-ai.hf.space`)

### Backend (Hugging Face Spaces)

- `ALLOWED_ORIGINS` — Comma-separated CORS origins (defaults to `*` if not set)
- `MAX_CONCURRENT_JOBS` — Max simultaneous processing jobs (default: `1` for free tier, increase to `2` for 8GB+ RAM)
- `OMP_NUM_THREADS` — OpenMP thread pool size (default: `2`, set in Dockerfile)
- `MKL_NUM_THREADS` — Intel MKL thread pool size (default: `2`, set in Dockerfile)
- `OPENBLAS_NUM_THREADS` — OpenBLAS thread pool size (default: `2`, set in Dockerfile)

## Code Style Conventions

- **Backend**: PEP 8, type hints with `|` union syntax (Python 3.10+), explicit error messages
- **Frontend**: ESLint recommended rules, functional components only, custom hooks for stateful logic
- **Comments**: Prioritize docstrings and module-level comments over inline comments
- **Commits**: Conventional Commits format (e.g., `feat(backend):`, `fix(frontend):`, `docs:`)

## Performance Optimizations (v1.5.0+)

The backend implements aggressive memory and CPU optimizations to run reliably on free-tier hosting:

### Memory Optimizations

1. **Audio duration pre-validation** (`audio_engine.py:30-46`) — Rejects files >10min before loading into memory
2. **Chunked BPM detection** (`audio_engine.py:48-75`) — Only loads first 30s @ 22kHz (95% memory reduction)
3. **Demucs segment processing** (`audio_engine.py`) — Processes in 7s chunks with `--segment 7 --shifts 0` (60-70% memory reduction; 7s respects htdemucs Transformer hard limit of 7.8s)
4. **Aggressive garbage collection** (`main.py:7-19`) — Explicit `gc.collect()` after each heavy operation
5. **WAV/FLAC → MP3 auto-conversion** (`routes.py:18-65`) — Converts lossless files to 192kbps MP3 before processing (70-90% smaller)
6. **Job concurrency limit** (`routes.py:17-21`) — Semaphore limits to 1 concurrent job (prevents memory thrashing)

### CPU Optimizations

1. **Thread pool limiting** (`main.py:16-19`, Dockerfile) — `OMP_NUM_THREADS=2` prevents CPU oversubscription
2. **CUDA prevention** (`main.py:11-14`, Dockerfile) — `CUDA_VISIBLE_DEVICES=-1` disables GPU init overhead

### Monitoring

- Enhanced `/health` endpoint with `psutil` metrics (`main.py:44-79`)
- Reports system memory %, process RSS/VMS, CPU %, thread count
- Set up alerts when `memory.system.percent > 85%`

**See `OPTIMIZATIONS.md` and `DEPLOYMENT.md` for complete details.**
