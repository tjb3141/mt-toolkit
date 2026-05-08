"""
Deduplicate tracks that share the same title.

For each duplicate title, picks the SMALLEST-bytes copy as the survivor (saves
the most storage when copies are different rips), rewires every reference from
the redundant track ids onto the survivor, then deletes the loser rows and
their MP3 objects.

Usage:
    python dedup_tracks.py            # dry-run: prints the plan, no writes
    python dedup_tracks.py --apply    # apply after a confirmation prompt

Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in local_utils/.env.
"""

import os
import sys
import requests
from collections import defaultdict


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
BUCKET = "tracks"

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in local_utils/.env")
    sys.exit(1)

HDR = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def human(n: int) -> str:
    f = float(n)
    for unit in ["B", "KB", "MB", "GB"]:
        if f < 1024:
            return f"{f:.1f} {unit}"
        f /= 1024
    return f"{f:.1f} TB"


def rest(method: str, path: str, **kwargs) -> requests.Response:
    url = f"{SUPABASE_URL}/rest/v1{path}"
    r = requests.request(method, url, headers=HDR, **kwargs)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> {r.status_code} {r.text}")
    return r


def fetch_all_tracks() -> list[dict]:
    """All tracks plus their bucket file size, fetched via the storage_objects view via PostgREST.

    Easier: pull tracks then resolve sizes by listing the bucket folders we care about,
    but cheapest is one SQL through PostgREST's `rpc` — except we don't have an RPC.
    So we just join in Python: pull tracks, then resolve size per storage_path with a
    single storage HEAD per loser (we only need sizes for sorting within duplicate groups).
    """
    page = 1000
    offset = 0
    tracks: list[dict] = []
    while True:
        r = rest("GET", f"/tracks?select=id,title,storage_path,duration_seconds&limit={page}&offset={offset}")
        rows = r.json()
        tracks.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return tracks


def head_size(storage_path: str) -> int | None:
    """HEAD the storage object to read content-length. Returns None if missing."""
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}"
    # storage uses the auth header but ignores apikey for service-role
    r = requests.head(url, headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"})
    if r.status_code == 200:
        cl = r.headers.get("content-length")
        return int(cl) if cl else None
    return None


def fetch_playlist_links(track_ids: list[str]) -> dict[str, list[str]]:
    """Map track_id -> list of playlist_id it's currently linked to."""
    if not track_ids:
        return {}
    out: dict[str, list[str]] = defaultdict(list)
    # PostgREST in.() filter
    in_clause = ",".join(track_ids)
    r = rest("GET", f"/playlist_tracks?select=playlist_id,track_id&track_id=in.({in_clause})")
    for row in r.json():
        out[row["track_id"]].append(row["playlist_id"])
    return out


def rewire_playlist_links(loser_id: str, survivor_id: str) -> None:
    """Move every playlist_tracks row from loser to survivor.

    If survivor is already in the same playlist, the loser's row is dropped (no
    new link needed). Otherwise we update the loser's row in place to the
    survivor — cheapest rewrite, no new id, the unique (playlist_id, track_id)
    constraint isn't violated.
    """
    # Get all (playlist_id, link_id) where this loser is linked
    loser_links = rest(
        "GET", f"/playlist_tracks?select=id,playlist_id&track_id=eq.{loser_id}"
    ).json()
    if not loser_links:
        return

    survivor_playlists = {
        row["playlist_id"]
        for row in rest(
            "GET", f"/playlist_tracks?select=playlist_id&track_id=eq.{survivor_id}"
        ).json()
    }

    for link in loser_links:
        if link["playlist_id"] in survivor_playlists:
            # Survivor already there — just drop the loser row
            rest("DELETE", f"/playlist_tracks?id=eq.{link['id']}")
        else:
            # Repoint the loser row at survivor
            rest(
                "PATCH",
                f"/playlist_tracks?id=eq.{link['id']}",
                json={"track_id": survivor_id},
            )
            survivor_playlists.add(link["playlist_id"])


def remove_round_refs(loser_id: str) -> None:
    """Delete or null any other tables that reference the loser track."""
    rest("DELETE", f"/silent_disco_rounds?track_id=eq.{loser_id}")
    rest("DELETE", f"/freeze_dance_rounds?track_id=eq.{loser_id}")
    rest("PATCH", f"/partners_pairs?track_id=eq.{loser_id}", json={"track_id": None})
    rest("DELETE", f"/imposter_rounds?town_track_id=eq.{loser_id}")
    rest("DELETE", f"/imposter_rounds?imposter_track_id=eq.{loser_id}")


def delete_track_row(track_id: str) -> None:
    rest("DELETE", f"/tracks?id=eq.{track_id}")


def delete_storage(storage_paths: list[str]) -> None:
    if not storage_paths:
        return
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}"
    r = requests.delete(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        },
        json={"prefixes": storage_paths},
    )
    if r.status_code >= 400:
        print(f"  ! storage delete failed: {r.status_code} {r.text}")


def main():
    apply_mode = "--apply" in sys.argv

    print("Loading tracks…")
    tracks = fetch_all_tracks()
    by_title: dict[str, list[dict]] = defaultdict(list)
    for t in tracks:
        by_title[t["title"]].append(t)

    dup_groups = {title: rows for title, rows in by_title.items() if len(rows) > 1}
    if not dup_groups:
        print("No duplicate titles found.")
        return

    print(f"Found {len(dup_groups)} duplicate titles. Resolving file sizes…")

    # Resolve file sizes for every track in any duplicate group
    all_dup_tracks = [t for rows in dup_groups.values() for t in rows]
    for t in all_dup_tracks:
        t["bytes"] = head_size(t["storage_path"]) or 0

    # Build the plan: smallest-bytes copy is the survivor; ties broken by id ordering.
    # Skip any group whose duration_seconds spread is >5s — those are likely
    # different rips/edits and need a human to choose.
    DURATION_TOLERANCE = 5
    plan = []   # list of (title, survivor, losers, reclaim)
    skipped = []  # list of (title, durations)
    total_reclaim = 0
    for title, rows in dup_groups.items():
        durations = [r["duration_seconds"] or 0 for r in rows]
        if max(durations) - min(durations) > DURATION_TOLERANCE:
            skipped.append((title, durations))
            continue
        rows_sorted = sorted(rows, key=lambda r: (r["bytes"], r["id"]))
        survivor = rows_sorted[0]
        losers = rows_sorted[1:]
        reclaim = sum(l["bytes"] for l in losers)
        total_reclaim += reclaim
        plan.append((title, survivor, losers, reclaim))

    plan.sort(key=lambda p: -p[3])

    print("\nPlan:")
    print(f"  {'title':<55} {'keep':>10} {'drop':>10}")
    print(f"  {'-' * 55} {'-' * 10} {'-' * 10}")
    for title, survivor, losers, reclaim in plan:
        loser_sizes = " + ".join(human(l["bytes"]) for l in losers)
        print(f"  {title[:55]:<55} {human(survivor['bytes']):>10} {loser_sizes:>10}")
    print(f"  {'-' * 55} {'-' * 10} {'-' * 10}")
    print(f"  Total reclaim: {human(total_reclaim)} across {sum(len(p[2]) for p in plan)} loser tracks")

    if skipped:
        print("\nSkipped (duration spread > 5s — different rips, resolve manually):")
        for title, durs in skipped:
            print(f"  - {title}  durations={durs}")

    if not apply_mode:
        print("\nDry run. Re-run with --apply to perform the dedup.")
        return

    print(f"\nAbout to permanently dedup {len(plan)} titles, deleting "
          f"{sum(len(p[2]) for p in plan)} tracks and ~{human(total_reclaim)}.")
    if input("Type 'DEDUP' to confirm: ").strip() != "DEDUP":
        print("Aborted.")
        return

    for i, (title, survivor, losers, _reclaim) in enumerate(plan, 1):
        print(f"[{i}/{len(plan)}] {title}")
        for loser in losers:
            rewire_playlist_links(loser["id"], survivor["id"])
            remove_round_refs(loser["id"])
            delete_track_row(loser["id"])
        delete_storage([l["storage_path"] for l in losers])

    print("\nDedup complete.")


if __name__ == "__main__":
    main()
