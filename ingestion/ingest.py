"""
Silent Disco ingestion script.

Usage:
    python ingest.py <genre_name> <youtube_url> [<youtube_url> ...]

Example:
    python ingest.py "Hip Hop" https://youtu.be/abc123 https://youtu.be/def456

Requires:
    - ffmpeg on PATH
    - SUPABASE_URL and SUPABASE_SERVICE_KEY in environment (or .env file)
    - venv activated: .\\venv\\Scripts\\activate
"""

import os
import sys
import uuid
import tempfile
import subprocess
import requests

# ---------------------------------------------------------------------------
# Config — read from environment or a local .env file in this folder
# ---------------------------------------------------------------------------

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())

load_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
STORAGE_BUCKET = "tracks"

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
    print("Create ingestion/.env with those two values.")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
}

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def get_or_create_genre(name: str) -> str:
    """Return genre id, creating the row if it doesn't exist."""
    url = f"{SUPABASE_URL}/rest/v1/genres"
    r = requests.get(url, headers=HEADERS, params={"name": f"eq.{name}", "select": "id"})
    r.raise_for_status()
    rows = r.json()
    if rows:
        return rows[0]["id"]

    r = requests.post(
        url,
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"name": name, "display_order": 0},
    )
    r.raise_for_status()
    return r.json()[0]["id"]


def upload_track(local_path: str, storage_path: str) -> None:
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    with open(local_path, "rb") as f:
        r = requests.post(url, headers={**HEADERS, "Content-Type": "audio/mpeg"}, data=f)
    r.raise_for_status()


def insert_track(genre_id: str, title: str, storage_path: str, duration: int) -> None:
    url = f"{SUPABASE_URL}/rest/v1/tracks"
    r = requests.post(
        url,
        headers={**HEADERS, "Content-Type": "application/json"},
        json={
            "genre_id": genre_id,
            "title": title,
            "storage_path": storage_path,
            "duration_seconds": duration,
        },
    )
    r.raise_for_status()

# ---------------------------------------------------------------------------
# Download + convert
# ---------------------------------------------------------------------------

def expand_url(url: str) -> list[str]:
    """Return a list of video URLs — expands playlists, passes through single videos."""
    result = subprocess.run(
        ["yt-dlp", "--flat-playlist", "--print", "webpage_url", url],
        capture_output=True, text=True,
    )
    urls = [line for line in result.stdout.strip().splitlines() if line.startswith("http")]
    return urls if urls else [url]


def download_audio(url: str, out_dir: str) -> tuple[str, str, int]:
    """Download audio, convert to mp3, return (filepath, title, duration_seconds)."""
    out_template = os.path.join(out_dir, "%(title)s.%(ext)s")
    cmd = [
        "yt-dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "128K",
        "--output", out_template,
        "--print", "after_move:filepath",
        "--no-playlist",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  yt-dlp error:\n{result.stderr}")
        raise RuntimeError(f"yt-dlp failed for {url}")

    filepath = result.stdout.strip().splitlines()[-1]
    title = os.path.splitext(os.path.basename(filepath))[0]

    # Get duration via ffprobe
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", filepath],
        capture_output=True, text=True,
    )
    duration = int(float(probe.stdout.strip())) if probe.stdout.strip() else 0

    return filepath, title, duration

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    genre_name = sys.argv[1]
    urls = sys.argv[2:]

    print(f"Genre: {genre_name}")
    genre_id = get_or_create_genre(genre_name)
    print(f"Genre id: {genre_id}")

    expanded = []
    for url in urls:
        expanded.extend(expand_url(url))
    print(f"Total tracks to process: {len(expanded)}")

    with tempfile.TemporaryDirectory() as tmp:
        for url in expanded:
            print(f"\nProcessing: {url}")
            try:
                filepath, title, duration = download_audio(url, tmp)
                print(f"  Downloaded: {title} ({duration}s)")

                storage_path = f"{genre_name.lower().replace(' ', '_')}/{uuid.uuid4()}.mp3"
                print(f"  Uploading to: {storage_path}")
                upload_track(filepath, storage_path)

                insert_track(genre_id, title, storage_path, duration)
                print(f"  Done.")
            except Exception as e:
                print(f"  Failed: {e}")

    print("\nIngestion complete.")


if __name__ == "__main__":
    main()
