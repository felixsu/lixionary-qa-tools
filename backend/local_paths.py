import os

# Stdlib-only: bootstrap_sidecar.py imports this before the venv exists.


def get_base_dir() -> str:
    # AE_DATA_DIR is injected by the Tauri launcher (the dev flavor passes
    # ~/Documents/AutomationExplorerDev so dev and prod never share state).
    # Bare `python local_sidecar.py` keeps today's prod path.
    return os.environ.get("AE_DATA_DIR") or os.path.join(
        os.path.expanduser("~"), "Documents", "AutomationExplorer")
