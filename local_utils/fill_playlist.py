"""
Download N tracks from a txt file that aren't already in the output folder.
Matches by stripping punctuation/case from both the track query and existing filenames.

    python fill_playlist.py "track_txt/90s Top Hits.txt" --count 200
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
YTDLP = [sys.executable, "-m", "yt_dlp"]


def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def parse_tracklist(path: Path) -> list[str]:
    tracks = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^\d+[\.\)]\s*", "", line)
        if line:
            tracks.append(line)
    return tracks


def already_downloaded(out_dir: Path) -> set[str]:
    return {normalize(f.stem) for f in out_dir.glob("*.mp3")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("txt", help="Path to track list .txt file")
    parser.add_argument("--count", type=int, default=200)
    args = parser.parse_args()

    txt_path = Path(args.txt)
    if not txt_path.is_absolute():
        txt_path = SCRIPT_DIR / txt_path

    folder = txt_path.stem.strip()
    out_dir = SCRIPT_DIR / "downloads" / folder
    out_dir.mkdir(parents=True, exist_ok=True)

    all_tracks = parse_tracklist(txt_path)
    existing = already_downloaded(out_dir)

    # filter out tracks whose normalized query matches any existing filename
    remaining = [t for t in all_tracks if not any(
        normalize(t) in norm or norm in normalize(t)
        for norm in existing
    )]

    import random
    sample = random.sample(remaining, min(args.count, len(remaining)))

    print(f"Playlist : {folder}")
    print(f"Total    : {len(all_tracks)} tracks in txt")
    print(f"Existing : {len(existing)} MP3s already downloaded")
    print(f"Remaining: {len(remaining)} not yet downloaded")
    print(f"Queued   : {len(sample)} to download now\n")

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
                print(f"[OK  {i}/{len(sample)}] {query}", flush=True)
            else:
                err += 1
                print(f"[ERR {i}/{len(sample)}] {query}", flush=True)
        except subprocess.TimeoutExpired:
            err += 1
            print(f"[TIM {i}/{len(sample)}] {query}", flush=True)
        except Exception as e:
            err += 1
            print(f"[EXC {i}/{len(sample)}] {query} | {e}", flush=True)

    print(f"\nDone. {ok} ok, {err} failed. Files in downloads/{folder}/")


if __name__ == "__main__":
    main()
