"""
List and (after confirmation) delete storage objects in the `tracks` bucket
that are not referenced by any row in the `tracks` table.

Usage:
    python cleanup_orphans.py            # dry-run: lists orphans, shows totals, exits
    python cleanup_orphans.py --delete   # lists, then prompts before deleting

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

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


def fetch_db_paths() -> set[str]:
    """All storage_path values currently referenced by the tracks table."""
    paths: set[str] = set()
    page_size = 1000
    offset = 0
    while True:
        url = f"{SUPABASE_URL}/rest/v1/tracks?select=storage_path"
        r = requests.get(
            url,
            headers={**HEADERS, "Range-Unit": "items", "Range": f"{offset}-{offset + page_size - 1}"},
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        for row in rows:
            sp = row.get("storage_path")
            if sp:
                paths.add(sp)
        if len(rows) < page_size:
            break
        offset += page_size
    return paths


def list_bucket_objects() -> list[dict]:
    """List every object in the bucket. Recurses into folders.

    Storage list API returns up to 100 entries per call. To enumerate the whole
    bucket we list root, recurse into every folder we discover.
    """
    all_objects: list[dict] = []

    def list_path(prefix: str):
        offset = 0
        page = 1000
        while True:
            url = f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}"
            payload = {"prefix": prefix, "limit": page, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}
            r = requests.post(url, headers=HEADERS, json=payload)
            r.raise_for_status()
            entries = r.json()
            if not entries:
                break
            for e in entries:
                # Folders show up as entries with id == None; recurse.
                if e.get("id") is None:
                    sub = f"{prefix}/{e['name']}" if prefix else e["name"]
                    list_path(sub)
                else:
                    name = f"{prefix}/{e['name']}" if prefix else e["name"]
                    metadata = e.get("metadata") or {}
                    size = metadata.get("size")
                    all_objects.append({"name": name, "size": int(size) if size is not None else 0})
            if len(entries) < page:
                break
            offset += page

    list_path("")
    return all_objects


def human(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def delete_paths(paths: list[str]) -> None:
    """Delete bucket objects in batches. Storage remove API takes a JSON body of paths."""
    BATCH = 100
    deleted = 0
    for i in range(0, len(paths), BATCH):
        batch = paths[i : i + BATCH]
        url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}"
        r = requests.delete(url, headers=HEADERS, json={"prefixes": batch})
        if r.status_code >= 400:
            print(f"  ! batch {i // BATCH + 1} failed: {r.status_code} {r.text}")
            continue
        deleted += len(batch)
        print(f"  deleted {deleted}/{len(paths)}…")
    print(f"Done. Deleted {deleted} objects.")


def main():
    delete_mode = "--delete" in sys.argv

    print("Fetching tracks.storage_path from DB…")
    db_paths = fetch_db_paths()
    print(f"  {len(db_paths)} paths in DB")

    print("Listing bucket objects (this can take a minute)…")
    objects = list_bucket_objects()
    print(f"  {len(objects)} objects in bucket")

    orphans = [o for o in objects if o["name"] not in db_paths]
    if not orphans:
        print("\nNo orphans. Bucket and DB are in sync.")
        return

    by_folder: dict[str, list[dict]] = defaultdict(list)
    for o in orphans:
        folder = o["name"].split("/", 1)[0] if "/" in o["name"] else "(root)"
        by_folder[folder].append(o)

    print("\nOrphan summary by folder:")
    print(f"  {'folder':<20} {'files':>8} {'size':>12}")
    print(f"  {'-' * 20} {'-' * 8} {'-' * 12}")
    total_bytes = 0
    for folder, items in sorted(by_folder.items(), key=lambda kv: -sum(x["size"] for x in kv[1])):
        size = sum(x["size"] for x in items)
        total_bytes += size
        print(f"  {folder:<20} {len(items):>8} {human(size):>12}")
    print(f"  {'-' * 20} {'-' * 8} {'-' * 12}")
    print(f"  {'TOTAL':<20} {len(orphans):>8} {human(total_bytes):>12}")

    if not delete_mode:
        print("\nDry run. Re-run with --delete to remove these objects.")
        return

    print(f"\nAbout to permanently delete {len(orphans)} bucket objects ({human(total_bytes)}).")
    answer = input("Type 'DELETE' to confirm: ").strip()
    if answer != "DELETE":
        print("Aborted.")
        return

    delete_paths([o["name"] for o in orphans])


if __name__ == "__main__":
    main()
