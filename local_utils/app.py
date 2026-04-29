"""
Local download server — YouTube → MP3 in a local folder.
Upload to the right genre via /admin on the web app.

    cd local_utils
    .\\venv\\Scripts\\activate
    uvicorn app:app --reload --port 8765

Then open http://localhost:8765
"""

import asyncio
import os
import queue
import subprocess
import threading
from typing import AsyncGenerator

from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, StreamingResponse

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(OUTPUT_DIR, exist_ok=True)

COOKIES_FILE = os.environ.get("YOUTUBE_COOKIES_FILE", "")

app = FastAPI()

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MT Toolkit - Local Download</title>
<style>
  body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 16px; background:#111; color:#eee; }
  h1 { font-size: 1.4rem; margin-bottom: 8px; }
  p { color:#aaa; font-size:.85rem; margin-bottom:24px; }
  label { display:block; margin-bottom:4px; font-size:.85rem; color:#aaa; }
  input { width:100%; box-sizing:border-box; background:#222; border:1px solid #444; color:#eee;
          padding:8px; border-radius:4px; margin-bottom:16px; font-size:.95rem; }
  button { background:#6366f1; color:#fff; border:none; padding:10px 24px;
           border-radius:4px; cursor:pointer; font-size:1rem; }
  button:disabled { background:#444; cursor:default; }
  #log { margin-top:24px; background:#000; border:1px solid #333; border-radius:4px;
         padding:12px; font-family:monospace; font-size:.82rem; white-space:pre-wrap;
         min-height:60px; max-height:500px; overflow-y:auto; }
</style>
</head>
<body>
<h1>MT Toolkit - Local Download</h1>
<p>Downloads MP3s to <code>local_utils/downloads/</code>. Then upload them to the right genre via /admin.</p>
<form id="f">
  <label>YouTube URL or playlist</label>
  <input name="url" placeholder="https://youtube.com/playlist?list=..." required>
  <button type="submit" id="btn">Download</button>
</form>
<div id="log"></div>
<script>
const log = document.getElementById('log');
const btn = document.getElementById('btn');
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = 'Downloading...';
  log.textContent = '';
  const fd = new FormData(e.target);
  const res = await fetch('/download', { method: 'POST', body: fd });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    log.textContent += dec.decode(value);
    log.scrollTop = log.scrollHeight;
  }
  btn.disabled = false;
  btn.textContent = 'Download';
});
</script>
</body>
</html>"""


_SENTINEL = object()


def _run_yt_dlp(cmd: list[str], q: queue.Queue) -> None:
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
        for line in proc.stdout:
            q.put(line)
        proc.wait()
        q.put(f"\nyt-dlp exited with code {proc.returncode}.\n".encode())
    except Exception as e:
        q.put(f"ERROR: {e}\n".encode())
    finally:
        q.put(_SENTINEL)


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML


@app.post("/download")
async def download(url: str = Form(...)):
    async def stream() -> AsyncGenerator[bytes, None]:
        cmd = [
            "yt-dlp",
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "128K",
            "--output", os.path.join(OUTPUT_DIR, "%(title)s.%(ext)s"),
            "--no-overwrites",
            "--progress",
        ]
        if COOKIES_FILE and os.path.exists(COOKIES_FILE):
            cmd += ["--cookies", COOKIES_FILE]
        cmd.append(url)

        q: queue.Queue = queue.Queue()
        threading.Thread(target=_run_yt_dlp, args=(cmd, q), daemon=True).start()

        loop = asyncio.get_event_loop()
        while True:
            chunk = await loop.run_in_executor(None, q.get)
            if chunk is _SENTINEL:
                break
            yield chunk

        yield b"\nDone. Files are in local_utils/downloads/ - upload them via /admin.\n"

    return StreamingResponse(stream(), media_type="text/plain")
