"""
Bulk downloader - one worker per .txt file in track_txt/, 200 random tracks each.

    python bulk_download.py [--count N] [--workers N]
"""

import argparse
import os
import random
import re
import subprocess
import sys
import threading
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
TRACK_TXT_DIR = SCRIPT_DIR / "track_txt"
OUTPUT_DIR = SCRIPT_DIR / "downloads"
YTDLP = [sys.executable, "-m", "yt_dlp"]

print_lock = threading.Lock()

def log(msg):
    with print_lock:
        print(msg, flush=True)

def parse_tracklist(path):
    tracks = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^\d+[\.\)]\s*", "", line)
        if line:
            tracks.append(line)
    return tracks

def download_playlist(playlist_name, tracks, out_dir, count):
    out_dir.mkdir(parents=True, exist_ok=True)
    sample = random.sample(tracks, min(count, len(tracks)))
    log(f"[START] {playlist_name} — {len(sample)} tracks")
    ok = err = 0
    for i, query in enumerate(sample, 1):
        cmd = [
            *YTDLP,
            "--extract-audio", "--audio-format", "mp3", "--audio-quality", "128K",
            "--output", str(out_dir / "%(title)s.%(ext)s"),
            "--no-overwrites", "--quiet", "--no-warnings",
            f"ytsearch1:{query}",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode == 0:
                ok += 1
                log(f"  [OK {i}/{len(sample)}] {playlist_name} | {query}")
            else:
                err += 1
                log(f"  [ERR {i}/{len(sample)}] {playlist_name} | {query}")
        except subprocess.TimeoutExpired:
            err += 1
            log(f"  [TIM {i}/{len(sample)}] {playlist_name} | {query}")
        except Exception as e:
            err += 1
            log(f"  [EXC {i}/{len(sample)}] {playlist_name} | {e}")
    log(f"[DONE] {playlist_name} — {ok} ok, {err} failed")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=200, help="Tracks per playlist")
    args = parser.parse_args()

    txt_files = sorted(TRACK_TXT_DIR.glob("*.txt"))
    if not txt_files:
        print(f"No .txt files in {TRACK_TXT_DIR}")
        sys.exit(1)

    print(f"Found {len(txt_files)} playlists, downloading {args.count} random tracks each.\n")

    threads = []
    for txt in txt_files:
        folder = txt.stem.strip()
        out_dir = OUTPUT_DIR / folder
        tracks = parse_tracklist(txt)
        if not tracks:
            log(f"[SKIP] {folder} — no tracks found")
            continue
        t = threading.Thread(target=download_playlist, args=(folder, tracks, out_dir, args.count), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    total = sum(len(list((OUTPUT_DIR / txt.stem.strip()).glob("*.mp3"))) for txt in txt_files)
    print(f"\nAll done. {total} MP3s in local_utils/downloads/")

if __name__ == "__main__":
    main()
