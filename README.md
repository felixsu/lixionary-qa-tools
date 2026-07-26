# Lixionary QA Tools

A desktop toolkit for QA automation engineers: explore APIs, drive an embedded
Chromium browser, and generate Playwright page objects and Python API clients
from real traffic — instead of hand-crafting them from DevTools.

Ships as a **Tauri desktop app** (macOS, Windows, Linux) with auto-update. The
same codebase runs as a plain web app for development.

## Features

| Area | What it does |
| --- | --- |
| **API Explorer** | Postman-style request collections with environments, auth functions, and scripted tests. Results feed the Studio CSV report. |
| **API Studio** | Runs saved flows end to end and reports pass/fail per step. |
| **Web Explorer** | Live embedded Chromium — click, type, navigate. Records network traffic and inspects the DOM, then generates Playwright POMs (locator-ranked: `get_by_test_id` > `get_by_label` > `get_by_role` > CSS > XPath) and Pydantic-backed HTTP clients. |
| **Browser Profiles** | Pre-inject cookies and localStorage before a session starts. Optionally imports live state from Chrome via the bundled helper extension. |
| **Auth Functions** | Reusable token-fetch scripts shared across collections and environments. |
| **User Guides / Admin** | In-app documentation and user/role management. |

## Architecture

```
frontend/          Next.js 16 (App Router) + React 19 + Tauri v2 shell
frontend/src-tauri/  Rust host: window, updater, sidecar launcher
backend/           FastAPI
  main.py            Cloud API — MongoDB + Redis, shared team data
  local_sidecar.py   Local API — SQLite, Playwright, runs on the user's machine
  bootstrap_sidecar.py  Creates the sidecar venv and installs Playwright on first run
chrome-extension/  Unpacked helper for reading Chrome cookies/localStorage
docs/              PRD and feature guides
```

Two backends, deliberately:

- **Cloud API** (`main.py`) holds collections, environments, and users — anything
  the team shares. Deployed at `qa-tools-api.lixionary.com`.
- **Local sidecar** (`local_sidecar.py`) does everything that must touch the
  user's machine: driving Playwright, running scripts, and caching to SQLite. The
  desktop app spawns it automatically; `bootstrap_sidecar.py` provisions its venv
  on first launch.

Sidecar state lives **outside** the repo, in `~/Documents/AutomationExplorer`
(venv, `local.db`, workspaces) — so it survives moving or re-cloning the checkout.

## Ports and flavors

Shared by everything:

| Port | Service |
| --- | --- |
| 8480 | Cloud backend (docker-compose) |
| 8482 | Redis |
| 8483 | MongoDB |

Everything else is **per flavor**, so all three can run at once:

| Flavor | Frontend | Sidecar | CDP | Data dir (under the OS app-data dir) |
| --- | --- | --- | --- | --- |
| prod app | 8481 | 8484 | 9222 | `com.lixionary.automation-explorer` |
| dev app | 8491 | 8494 | 9232 | `com.lixionary.automation-explorer.dev` |
| source tree | 8501 | 8504 | 9242 | `com.lixionary.automation-explorer.local` |

The split is driven entirely by three env vars — `SIDECAR_PORT`, `AE_CDP_PORT`,
and `AE_DATA_DIR` (see `backend/local_sidecar.py` and `backend/local_paths.py`).
For the two desktop flavors the Tauri host injects them (`src-tauri/src/lib.rs`,
`run()`); for the source tree `backend/dev_sidecar.py` does the same job.

> Don't run the sidecar as bare `python backend/local_sidecar.py`. With no
> `AE_DATA_DIR` it falls back to `~/Documents/AutomationExplorer` — the legacy
> pre-app-data location, which no installed flavor reads. The prod app treats it
> purely as a migration source: on launch it renames it to
> `AutomationExplorer.migrated` (or, if such a trail already exists, ignores it
> from then on). Either way you end up on a venv and SQLite store nothing else
> shares. Use `dev_sidecar.py`.

## Setup

Requires Node 20+, Python 3.11+, Docker, and — for desktop builds — the Rust
toolchain.

```bash
cp .env.example .env          # fill in GEMINI_API_KEY, JWT_SECRET, OAuth + IAM creds
docker compose up -d          # backend :8480, mongo :8483, redis :8482
npm --prefix frontend install
```

## Running

Day-to-day development uses the **source-tree flavor**, which stays clear of
both installed desktop apps. Two terminals:

```bash
npm --prefix frontend run sidecar:local  # :8504 — bootstraps its own venv on first run
npm --prefix frontend run dev:local      # http://localhost:8501
```

Other entry points:

```bash
npm --prefix frontend run dev            # prod-flavor ports — collides with the installed app
npm --prefix frontend run tauri dev      # desktop app, prod flavor
npm --prefix frontend run tauri:dev      # desktop app, dev flavor
```

Some features are desktop-only — the web build shows a "Desktop app required"
gate where it needs the Tauri bridge.

Drive the dev server at `127.0.0.1`, not `localhost`. The packaged app binds
`[::1]` on its frontend port and a browser prefers `::1`, so `localhost` can
silently reach the installed app instead of your dev server.

### Chrome helper extension

Optional; only needed to import cookies/localStorage from your live Chrome
session. Load `chrome-extension/` unpacked via `chrome://extensions` with
Developer mode on. See [chrome-extension/README.md](chrome-extension/README.md).

## Tests

```bash
# Backend — plain runner, no pytest dependency (it stubs the module). Needs the
# sidecar venv, so start sidecar:local once first to create it.
cd backend && "$HOME/Library/Application Support/com.lixionary.automation-explorer.local/venv/bin/python" tests/run_tests.py

npm --prefix frontend run lint
npx --prefix frontend tsc --noEmit
```

## Releases

Every push to `main` ships a release. `.github/workflows/release.yml` bumps the
patch version in `frontend/src-tauri/tauri.conf.json`, tags it, builds installers
for all platforms via `tauri-action`, and un-drafts the release so auto-update
picks it up. Version numbers are owned by CI — don't bump them by hand.

macOS builds are ad-hoc signed, so first launch needs right-click → Open.

## Docs

- [Lixionary Web Explorer PRD](docs/Lixionary%20Web%20Explorer%20PRD.md)
- [Lixionary API PRD](docs/Lixionary%20API%20PRD.md)
- [API Explorer User Flow and Dependencies](docs/API%20Explorer%20User%20Flow%20and%20Dependencies.md)
- [API Studio Guide](docs/API%20Studio%20Guide.md)
