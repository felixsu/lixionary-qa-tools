"""Launch the sidecar in the `local` flavor: the one used when running from a
source checkout, as opposed to either installed desktop app.

Three flavors can be live at once, each with its own ports and data dir:

    prod app     8481 / 8484 / 9222   <app-data>/com.lixionary.automation-explorer
    dev app      8491 / 8494 / 9232   <app-data>/com.lixionary.automation-explorer.dev
    source tree  8501 / 8504 / 9242   <app-data>/com.lixionary.automation-explorer.local

The first two are set by the Tauri launcher (src-tauri/src/lib.rs `run()`);
this script is the source-tree equivalent, since there is no Rust host to
inject the env vars when you run the sidecar by hand.

Deliberately NOT the bare `python local_sidecar.py` path: that falls back to
~/Documents/AutomationExplorer, which the prod app's `migrate_legacy_data_dir`
renames to `AutomationExplorer.migrated` on its next launch — silently moving
the venv out from under a dev sidecar.

Stdlib-only, like bootstrap_sidecar.py: it runs before the venv exists.

    python3 backend/dev_sidecar.py      (or: npm --prefix frontend run sidecar:local)
"""
from __future__ import annotations

import os
import subprocess
import sys

IDENTIFIER = "com.lixionary.automation-explorer.local"
SIDECAR_PORT = "8504"
CDP_PORT = "9242"


def app_data_dir() -> str:
    """Mirror Tauri's `app.path().app_data_dir()` for this identifier."""
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
    elif os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.join(
            home, "AppData", "Roaming")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(
            home, ".local", "share")
    return os.path.join(base, IDENTIFIER)


def main() -> None:
    data_dir = app_data_dir()
    os.makedirs(data_dir, exist_ok=True)

    # setdefault, not assignment: an explicit override in the caller's shell
    # still wins, which is what you want when testing a port collision.
    os.environ.setdefault("SIDECAR_PORT", SIDECAR_PORT)
    os.environ.setdefault("AE_CDP_PORT", CDP_PORT)
    os.environ.setdefault("AE_DATA_DIR", data_dir)

    print(f"--- local flavor: port {os.environ['SIDECAR_PORT']}, "
          f"CDP {os.environ['AE_CDP_PORT']} ---")
    print(f"--- data dir: {os.environ['AE_DATA_DIR']} ---")

    # bootstrap_sidecar.py inherits os.environ through its own
    # subprocess.run/os.execv, so the three knobs above reach local_sidecar.py.
    bootstrap = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "bootstrap_sidecar.py")
    if os.name == "nt":
        sys.exit(subprocess.run([sys.executable, "-u", bootstrap]).returncode)
    os.execv(sys.executable, [sys.executable, "-u", bootstrap])


if __name__ == "__main__":
    main()
