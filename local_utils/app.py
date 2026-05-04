"""
Local download server - launches bulk_download.py and streams its log.

    cd local_utils
    .\\venv\\Scripts\\activate
    uvicorn app:app --reload --port 8765

Then open http://localhost:8765
"""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, StreamingResponse

SCRIPT_DIR = Path(__file__).parent
LOG_FILE = SCRIPT_DIR / "download.log"
BULK_SCRIPT = SCRIPT_DIR / "bulk_download.py"

app = FastAPI()

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MT Toolkit - Downloader</title>
<style>
  body { font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 0 16px;
         background: #111; color: #eee; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  p { color: #aaa; font-size: .85rem; margin-bottom: 20px; }
  .row { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
  label { color: #aaa; font-size: .85rem; }
  input[type=number] { width: 80px; background: #222; border: 1px solid #444; color: #eee;
    padding: 7px; border-radius: 4px; font-size: .95rem; }
  button { background: #6366f1; color: #fff; border: none; padding: 10px 24px;
    border-radius: 4px; cursor: pointer; font-size: 1rem; }
  button:disabled { background: #444; cursor: default; }
  #stop { background: #7f1d1d; }
  #stop:hover { background: #991b1b; }
  .log { background: #000; border: 1px solid #333; border-radius: 4px; padding: 12px;
    font-family: monospace; font-size: .8rem; white-space: pre-wrap;
    height: 520px; overflow-y: auto; }
  .status { font-size: .8rem; color: #666; margin-bottom: 8px; }
</style>
</head>
<body>
<h1>MT Toolkit - Bulk Downloader</h1>
<p>Downloads <em>N</em> random tracks from each .txt file in <code>track_txt/</code> into <code>downloads/</code>.</p>

<div class="row">
  <label>Tracks per playlist:</label>
  <input type="number" id="count" value="200" min="1" max="1000">
  <button id="start" onclick="startRun()">Start Download</button>
  <button id="stop" onclick="stopRun()" disabled>Stop</button>
</div>
<div class="status" id="status">Idle.</div>
<div class="log" id="log"></div>

<script>
let running = false;

async function startRun() {
  const count = document.getElementById('count').value;
  document.getElementById('start').disabled = true;
  document.getElementById('stop').disabled = false;
  document.getElementById('log').textContent = '';
  document.getElementById('status').textContent = 'Running...';
  running = true;

  const res = await fetch('/run?count=' + count, { method: 'POST' });
  if (!res.ok) {
    document.getElementById('log').textContent = 'Error: ' + await res.text();
    reset(); return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const log = document.getElementById('log');
  while (running) {
    const { done, value } = await reader.read();
    if (done) break;
    log.textContent += dec.decode(value);
    log.scrollTop = log.scrollHeight;
  }
  reset();
}

async function stopRun() {
  running = false;
  await fetch('/stop', { method: 'POST' });
  document.getElementById('status').textContent = 'Stopped.';
  reset();
}

function reset() {
  running = false;
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;
  if (document.getElementById('status').textContent === 'Running...')
    document.getElementById('status').textContent = 'Done.';
}
</script>
</body>
</html>"""

_proc: subprocess.Popen | None = None


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML


@app.post("/run")
async def run(count: int = 200):
    global _proc
    if _proc and _proc.poll() is None:
        return HTMLResponse("Already running.", status_code=409)

    LOG_FILE.unlink(missing_ok=True)
    log_fh = open(LOG_FILE, "wb")
    _proc = subprocess.Popen(
        [sys.executable, "-u", str(BULK_SCRIPT), "--count", str(count)],
        stdout=log_fh,
        stderr=log_fh,
        env={**os.environ, "PYTHONUTF8": "1"},
    )

    def stream():
        with open(LOG_FILE, "rb") as f:
            while _proc.poll() is None:
                chunk = f.read(4096)
                if chunk:
                    yield chunk
                else:
                    import time; time.sleep(0.25)
            # flush remainder
            yield f.read()

    return StreamingResponse(stream(), media_type="text/plain")


@app.post("/stop")
async def stop():
    global _proc
    if _proc and _proc.poll() is None:
        _proc.terminate()
    return {"ok": True}
