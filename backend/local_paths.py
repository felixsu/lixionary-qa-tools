import os

# Stdlib-only: bootstrap_sidecar.py imports this before the venv exists.


def get_base_dir() -> str:
    # AE_DATA_DIR is injected by the Tauri launcher, pointing at the OS
    # app-data dir (e.g. ~/Library/Application Support/<bundle-id> on macOS,
    # namespaced per flavor by the bundle identifier). Bare
    # `python local_sidecar.py` (no Tauri) keeps the legacy Documents path
    # for backend-only dev work.
    return os.environ.get("AE_DATA_DIR") or os.path.join(
        os.path.expanduser("~"), "Documents", "AutomationExplorer")
