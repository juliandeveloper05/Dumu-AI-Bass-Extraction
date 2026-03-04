# Deployment Guide with Memory Optimization

## Docker Deployment with Memory Limits

### Recommended Settings for Free-Tier Hosting

```bash
# Build the container
docker build -t dumu-backend .

# Run with memory limit (recommended: 3GB for free tier)
docker run -d \
  --name dumu-api \
  --memory="3g" \
  --memory-swap="3g" \
  --cpus="2" \
  -p 7860:7860 \
  -e MAX_CONCURRENT_JOBS=1 \
  dumu-backend
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_JOBS` | `1` | Max simultaneous processing jobs (use 1 for free tier) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `OMP_NUM_THREADS` | `2` | OpenMP thread pool size |
| `MKL_NUM_THREADS` | `2` | Intel MKL thread pool size |
| `OPENBLAS_NUM_THREADS` | `2` | OpenBLAS thread pool size |

### Memory Limit Explanation

**Why `--memory="3g"`?**

- Base Python + FastAPI: ~200-300 MB
- PyTorch CPU: ~500 MB
- TensorFlow: ~400 MB
- Demucs inference (with `--segment 10`): ~1.5 GB peak
- Basic Pitch inference: ~300 MB
- Buffer for OS + ffmpeg: ~500 MB

**Total**: ~3 GB peak during processing

**Why `--memory-swap="3g"`?**

Setting swap equal to memory prevents the container from using disk swap, which would slow down CPU inference by 10-50x. Better to OOM and restart than thrash.

### Production Scaling (Paid Hosting)

For environments with 8GB+ RAM:

```bash
docker run -d \
  --name dumu-api \
  --memory="8g" \
  --memory-swap="8g" \
  --cpus="4" \
  -p 7860:7860 \
  -e MAX_CONCURRENT_JOBS=2 \
  -e OMP_NUM_THREADS=4 \
  dumu-backend
```

With 8GB RAM you can:
- Run 2 concurrent jobs (`MAX_CONCURRENT_JOBS=2`)
- Use 4 threads for NumPy/librosa (`OMP_NUM_THREADS=4`)
- Remove `--segment` flag from Demucs for better quality (edit `audio_engine.py:98`)

---

## Hugging Face Spaces Deployment

### Space Configuration

In your HF Space `README.md`, add:

```yaml
---
title: Dumu Bass Extraction API
emoji: 🎵
colorFrom: lime
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---
```

### Resource Limits

**Free Tier (CPU Basic):**
- 2 vCPUs
- 16 GB RAM
- 50 GB disk

**Recommended settings for HF Spaces:**

```dockerfile
# No need to set memory limits - HF Spaces handles this
# But ensure MAX_CONCURRENT_JOBS=1 for CPU Basic tier
ENV MAX_CONCURRENT_JOBS=1
```

### Testing on HF Spaces

```bash
# Check health endpoint
curl https://YOUR-USERNAME-dumu.hf.space/health

# Expected response:
{
  "status": "ok",
  "memory": {
    "system": {
      "total_mb": 16384,
      "available_mb": 12000,
      "used_mb": 4384,
      "percent": 26.8
    },
    "process": {
      "rss_mb": 450,
      "vms_mb": 1200
    }
  },
  "cpu": {
    "percent": 2.5,
    "num_threads": 12
  }
}
```

**Set up alerts** if `memory.system.percent > 85%` → potential OOM incoming.

---

## Vercel Frontend Deployment

### Environment Variables

In Vercel dashboard, add:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://YOUR-USERNAME-dumu.hf.space` |

### Build Settings

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install --legacy-peer-deps"
}
```

---

## Monitoring & Alerts

### Health Check Monitoring

Use a cron job or service like UptimeRobot to poll `/health` every 5 minutes:

```bash
#!/bin/bash
# health-check.sh

RESPONSE=$(curl -s https://YOUR-SPACE.hf.space/health)
MEM_PERCENT=$(echo $RESPONSE | jq -r '.memory.system.percent')

if (( $(echo "$MEM_PERCENT > 85" | bc -l) )); then
  echo "⚠️ High memory usage: ${MEM_PERCENT}%"
  # Send alert (email, Slack, PagerDuty, etc.)
fi
```

### Docker Stats Monitoring

For local/VPS deployments:

```bash
# Watch real-time stats
docker stats dumu-api

# Expected output during processing:
CONTAINER ID   NAME       CPU %   MEM USAGE / LIMIT   MEM %
abc123         dumu-api   95%     2.1 GiB / 3 GiB     70%
```

**Normal memory usage:**
- Idle: 200-400 MB (3-5%)
- Processing: 1.5-2.5 GB (50-80%)

**Alert thresholds:**
- Warning: >85% memory
- Critical: >95% memory

---

## Troubleshooting

### Container OOM Killed

**Symptoms:**
```
docker logs dumu-api
... [last line before crash]
```

**Solutions:**
1. Increase memory limit: `--memory="4g"`
2. Decrease `--segment` in Demucs: `--segment 5` (uses more RAM for better quality)
3. Lower `MAX_FILE_SIZE_MB` in `routes.py`

### High Memory After Processing

**Symptoms:** Memory doesn't drop after job completes.

**Solutions:**
1. Check garbage collection is enabled: `gc.set_threshold(700, 10, 10)`
2. Add manual GC call: `gc.collect()`
3. Restart container daily with cron (nuclear option)

### Slow Processing (>10 min)

**Symptoms:** Jobs timeout or take >10 minutes.

**Solutions:**
1. Check CPU throttling: `docker stats` should show ~95-100% CPU usage during Demucs
2. Verify `OMP_NUM_THREADS=2` is set (check with `echo $OMP_NUM_THREADS` inside container)
3. Check file is converted to MP3: logs should show `[Routes] Converting .wav to MP3`

---

## Testing the Optimizations

### 1. Memory Usage Test

```bash
# Start container with limited memory
docker run --memory="2g" --memory-swap="2g" -p 7860:7860 dumu-backend

# Upload 50MB WAV file
curl -X POST http://localhost:7860/api/process \
  -F "audio_file=@test.wav"

# Watch memory in another terminal
watch -n 1 'docker stats --no-stream dumu-api'

# Expected: Peak should be <2GB (if it OOMs, increase limit)
```

### 2. Concurrency Test

```bash
# Upload 2 files simultaneously
curl -X POST http://localhost:7860/api/process -F "audio_file=@test1.mp3" &
curl -X POST http://localhost:7860/api/process -F "audio_file=@test2.mp3" &

# Expected: Second job should queue until first completes (logs will show delay)
```

### 3. WAV→MP3 Conversion Test

```bash
# Upload WAV file
curl -X POST http://localhost:7860/api/process -F "audio_file=@test.wav"

# Check logs
docker logs dumu-api | grep "Converting"

# Expected output:
# [Routes] Converting .wav to MP3 for faster processing...
# [Routes] Converted to MP3: 8.2 MB
```

---

## Rollback Plan

If optimizations cause issues:

1. **Revert file size limit:**
   ```python
   # routes.py:13
   MAX_FILE_SIZE_MB = 100  # Back to original
   ```

2. **Disable WAV→MP3 conversion:**
   ```python
   # routes.py:76
   # file_path = _convert_to_mp3_if_needed(file_path)  # Comment out
   ```

3. **Remove Demucs segment flag:**
   ```python
   # audio_engine.py:98
   # "--segment", "10",  # Comment out
   ```

4. **Increase concurrency:**
   ```python
   # routes.py:20
   MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "2"))  # Back to 2
   ```
