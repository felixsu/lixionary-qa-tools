---
name: verify
description: Build, launch, and drive this app locally for end-to-end verification without touching the user's real desktop app or data.
---

# Verifying nv-automation-explorer locally

## CRITICAL isolation warnings (read first)

- The user's **real Tauri desktop app** often runs and serves its bundled frontend on `[::1]:8481`. A browser resolving `localhost:8481` prefers `::1` and hits **the real app** (old code, prod cloud `qa-tools-api.lixionary.com`, real local store). Always drive `http://127.0.0.1:8481` — the Next dev server binds `*:8481` (IPv4 included); the desktop app binds `::1` only.
- The user's **real local sidecar** listens on `127.0.0.1:8484` (SQLite at `~/Documents/AutomationExplorer/local.db`). Never point a test frontend at it. Run an isolated sidecar on **8485** instead (below).
- The **dev flavor** desktop app (built with `--config src-tauri/tauri.dev.conf.json`) uses frontend **8491**, sidecar **8494**, CDP 9232, and data dir `~/Documents/AutomationExplorerDev` — treat 8491/8494 as another real app's ports, don't collide with them either.
- `frontend/.env.local` sets `NEXT_PUBLIC_LOCAL_API_URL=http://localhost:8484` — override via shell env (shell env wins over .env files in Next.js).

## Launch

```bash
# Cloud backend + mongo + redis (backend code is volume-mounted, --reload)
docker-compose up -d           # backend :8480, mongo :8483, redis :8482
                               # GEMINI_API_KEY comes from root .env

# Isolated local sidecar on 8485 (image lacks apsw/sqlite-vec; install at start)
docker run --rm -d --name verify-sidecar -p 8485:8484 \
  -v "$(pwd)/backend:/app" -w /app lixionary-qa-tools-backend \
  sh -c "pip install -q apsw sqlite-vec && uvicorn local_sidecar:app --host 0.0.0.0 --port 8484"

# Frontend dev server pointed at isolated services
cd frontend && NEXT_PUBLIC_LOCAL_API_URL=http://localhost:8485 \
  NEXT_PUBLIC_VPS_API_URL=http://localhost:8480 npm run dev   # :8481
```

## Drive (Playwright)

- The web build shows a "Desktop app required" gate; stub Tauri first:
  `page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: async () => null }; })`
- Auth: `POST /api/auth/guest` on :8480, or click "Start in Guest Developer Mode" on the login page. First user in an empty DB becomes admin.
- Use `http://127.0.0.1:8481`, never `localhost:8481`.
- UI selectors: collection via `button[title="New collection"]`; add request via the dashed "+ Request" button; save button text "Save"; toast "Request saved".

## API smoke

```bash
TOKEN=$(curl -s -X POST http://localhost:8480/api/auth/guest | jq -r .token)  # note: key is "token", not "access_token"
# Collections PUT requires X-Device-Id header (sync versioning); use "force": true in the body for tests.
```

## Teardown

`docker stop verify-sidecar; docker-compose down` — restore whatever was running before.
