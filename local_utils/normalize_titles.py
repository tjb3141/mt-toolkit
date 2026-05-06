"""
Normalize MP3 filenames and Supabase track titles.

Dry-run by default — prints what would change.
Pass --apply to rename files and/or --apply-db to update Supabase.

    python normalize_titles.py                   # dry-run files only
    python normalize_titles.py --apply           # rename files on disk
    python normalize_titles.py --apply-db        # update Supabase titles
    python normalize_titles.py --apply --apply-db  # both
"""

import argparse
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
DOWNLOADS_DIR = SCRIPT_DIR / "downloads"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Junk patterns to strip (order matters) ───────────────────────────────────

# Trailing parenthetical/bracketed junk — applied repeatedly until stable
TRAILING_JUNK = [
    # Quality / format tags
    r"\s*[\(\[]\s*(?:Official\s+)?(?:(?:HD|HQ|4K|Animated|Lyric)\s+)?(?:Music\s+)?(?:Video|Audio|HD\s+Video|4K(?:\s+Remaster)?|Lyric\s+Video|Visualizer|Live[^)\]]*)\s*[\)\]]",
    # "Official Music Video YYYY" with trailing year
    r"\s*[\(\[]\s*(?:Official\s+)?(?:Music\s+)?(?:Video|Audio)\s+\d{4}\s*[\)\]]",
    # Remaster/reissue tags
    r"\s*[\(\[]\s*(?:\d{4}\s+)?Remaster(?:ed)?(?:\s+\d{4})?\s*[\)\]]",
    r"\s*[\(\[]\s*(?:Mono|Stereo|Single\s+Version|Album\s+Version|Radio\s+Edit|Extended\s+(?:Mix|Version)|Night\s+Version|Extra\s+HQ)\s*[\)\]]",
    # Year-only parens like (1977) at end
    r"\s*[\(\[]\s*\d{4}\s*[\)\]]",
    # Generic [anything] bracketed suffix that's ALL CAPS or a number
    r"\s*\[[A-Z0-9][^\]]{0,20}\]",
    # "on The Ed Sullivan Show" style suffixes
    r"\s+on\s+The\s+.+Show.*$",
    # Black & White Night, etc.
    r"\s*[\(\[][^)\]]*(?:Night|Version|Mix|Tour|Concert|Live)[^)\]]*[\)\]]",
]

# Separator normalization — weird Unicode dashes/symbols → " - "
SEPARATOR_RE = re.compile(r"\s*[❖–—]\s*")

# Strip trailing label/site credit after ｜ or - SiteName style
LABEL_SUFFIX_RE = re.compile(r"\s*[｜|]\s*.+$")
SITE_SUFFIX_RE = re.compile(r"\s+-\s+\w+[\s.]?(com|net|org|tv)\s*$", re.IGNORECASE)

# Strip trailing punctuation / whitespace
TRAILING_PUNCT = re.compile(r"[\s\-_,.]+$")

# Collapse multiple spaces
MULTI_SPACE = re.compile(r"  +")

# Fullwidth quotes ＂ → "
FULLWIDTH_QUOTE = re.compile(r"[＂＂]")


def normalize(raw: str) -> str:
    s = raw

    # Fullwidth quotes
    s = FULLWIDTH_QUOTE.sub('"', s)

    # Weird separators
    s = SEPARATOR_RE.sub(" - ", s)

    # Strip ｜ label credits and site suffixes
    s = LABEL_SUFFIX_RE.sub("", s)
    s = SITE_SUFFIX_RE.sub("", s)

    # Strip trailing junk repeatedly until stable
    for _ in range(5):
        prev = s
        for pattern in TRAILING_JUNK:
            s = re.sub(pattern, "", s, flags=re.IGNORECASE).strip()
        if s == prev:
            break

    # Collapse whitespace and trailing punct
    s = MULTI_SPACE.sub(" ", s)
    s = TRAILING_PUNCT.sub("", s)

    # Windows filenames cannot contain " — strip any remaining quotes
    if sys.platform == "win32":
        s = s.replace('"', '')

    return s.strip()


def process_files(apply: bool):
    mp3s = list(DOWNLOADS_DIR.rglob("*.mp3"))
    changes = []
    collisions = []

    for path in mp3s:
        stem = path.stem
        new_stem = normalize(stem)
        if new_stem == stem:
            continue
        new_path = path.with_name(new_stem + ".mp3")
        if new_path.exists() and new_path != path:
            collisions.append((path, new_path))
            continue
        changes.append((path, new_path, stem, new_stem))

    print(f"\n{'='*60}")
    print(f"FILES: {len(mp3s)} total, {len(changes)} to rename, {len(collisions)} collisions skipped")
    print(f"{'='*60}")

    for path, new_path, old, new in changes[:50]:
        print(f"  {old}")
        print(f"  → {new}\n")
    if len(changes) > 50:
        print(f"  ... and {len(changes) - 50} more")

    if collisions:
        print(f"\nSKIPPED (target already exists):")
        for path, new_path in collisions[:10]:
            print(f"  {path.name} → {new_path.name}")

    if apply:
        renamed = 0
        for path, new_path, _, _ in changes:
            try:
                if sys.platform == "win32":
                    # os.rename fails on Windows when target contains " (invalid in filenames)
                    # Use PowerShell Rename-Item with -LiteralPath to handle Unicode source paths
                    import subprocess as _sp
                    ps_cmd = (
                        f'Rename-Item -LiteralPath "{str(path)}" '
                        f'-NewName "{new_path.name}"'
                    )
                    result = _sp.run(
                        ["powershell", "-NoProfile", "-Command", ps_cmd],
                        capture_output=True, text=True
                    )
                    if result.returncode != 0:
                        raise OSError(result.stderr.strip())
                else:
                    os.rename(str(path), str(new_path))
                renamed += 1
            except Exception as e:
                print(f"  ERR renaming {path.name}: {e}")
        print(f"\n✓ Renamed {renamed} files on disk.")
    else:
        print(f"\n(dry-run — pass --apply to rename)")

    return changes


def load_env():
    env = {}
    env_path = SCRIPT_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update(os.environ)
    return env


def process_db(apply: bool):
    import json
    import urllib.request
    import urllib.error

    env = load_env()
    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("\nERR: SUPABASE_URL and SUPABASE_SERVICE_KEY required in local_utils/.env")
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    def supabase_get(path):
        req = urllib.request.Request(f"{url}/rest/v1/{path}", headers=headers)
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def supabase_patch(path, data):
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{url}/rest/v1/{path}",
            data=body,
            headers={**headers, "Prefer": "return=minimal"},
            method="PATCH",
        )
        with urllib.request.urlopen(req) as r:
            return r.status

    print("\nFetching tracks from Supabase...")
    # Paginate in case there are many tracks
    all_tracks = []
    offset = 0
    page = 1000
    while True:
        batch = supabase_get(f"tracks?select=id,title&limit={page}&offset={offset}")
        all_tracks.extend(batch)
        if len(batch) < page:
            break
        offset += page

    changes = []
    for t in all_tracks:
        new_title = normalize(t["title"])
        if new_title != t["title"]:
            changes.append((t["id"], t["title"], new_title))

    print(f"\n{'='*60}")
    print(f"DB TRACKS: {len(all_tracks)} total, {len(changes)} to update")
    print(f"{'='*60}")

    for _, old, new in changes[:50]:
        print(f"  {old}")
        print(f"  → {new}\n")
    if len(changes) > 50:
        print(f"  ... and {len(changes) - 50} more")

    if apply:
        updated = 0
        errors = 0
        for track_id, old, new in changes:
            try:
                supabase_patch(f"tracks?id=eq.{track_id}", {"title": new})
                updated += 1
            except Exception as e:
                errors += 1
                print(f"  ERR {track_id} '{old}': {e}")
        print(f"\n✓ Updated {updated} DB titles ({errors} errors).")
    else:
        print(f"\n(dry-run — pass --apply-db to update Supabase)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Rename files on disk")
    parser.add_argument("--apply-db", action="store_true", help="Update Supabase track titles")
    parser.add_argument("--db-only", action="store_true", help="Skip file processing")
    args = parser.parse_args()

    if not args.db_only:
        process_files(args.apply)

    if args.apply_db or args.db_only:
        process_db(args.apply_db)
    elif not args.db_only:
        # Still show what DB would change, as a preview
        process_db(False)


if __name__ == "__main__":
    main()
