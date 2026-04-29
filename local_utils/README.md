# Local Utils

Python helpers for local-only support work around MT Toolkit.

## Setup

```powershell
cd local_utils
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Create `local_utils/.env` from `.env.example` for scripts that talk to Supabase.

## Helpers

- `app.py`: small local FastAPI download server for saving YouTube audio as MP3 files in `local_utils/downloads/`.
- `ingest.py`: command-line downloader/uploader that registers tracks in Supabase.
- `test_partners.py`: opens several browser clients for testing Partners mode.
- `test_silent_disco.py`: opens several browser clients for testing regular Silent Disco mode.

## Download Server

```powershell
cd local_utils
.\venv\Scripts\activate
uvicorn app:app --reload --port 8765
```

Open `http://localhost:8765`, download files, then upload them through `/admin`.
