import os
import sys
import subprocess

from local_paths import get_base_dir

# Per-flavor base dir (AE_DATA_DIR from the Tauri launcher, prod default
# otherwise), so the dev flavor gets its own venv/workspaces/local.db.
# NOTE: the subprocess.run/os.execv below inherit os.environ, so the
# launcher-injected SIDECAR_PORT / AE_DATA_DIR / AE_CDP_PORT automatically
# flow through to local_sidecar.py — no explicit forwarding needed.
BASE_DIR = get_base_dir()
VENV_DIR = os.path.join(BASE_DIR, "venv")

def bootstrap():
    print(f"--- Bootstrapping Lixionary Automation Explorer sidecar ---")
    
    # 1. Create venv if not exists
    if not os.path.exists(VENV_DIR):
        print(f"Creating virtual environment at: {VENV_DIR}...")
        os.makedirs(BASE_DIR, exist_ok=True)
        try:
            subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
        except Exception as e:
            print(f"ERROR: Failed to create virtual environment: {e}")
            sys.exit(1)
            
    # Determine paths inside venv. Always run pip/playwright as `python -m ...`
    # rather than the venv's console scripts: a venv that has been MOVED (e.g.
    # by the app's migrate_legacy_data_dir, Documents/AutomationExplorer →
    # app-data dir) still has console-script shebangs pointing at the OLD venv
    # path, so venv/bin/pip fails with "bad interpreter" even though the venv
    # python itself still works. `-m` bypasses the shebang entirely.
    is_windows = os.name == "nt"
    python_bin = os.path.join(VENV_DIR, "Scripts", "python.exe") if is_windows else os.path.join(VENV_DIR, "bin", "python")

    # 2. Determine requirements path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    req_path = os.path.join(script_dir, "sidecar_requirements.txt")

    # 3. Install requirements
    print("Installing python sidecar requirements (this may take a few seconds on first run)...", flush=True)
    try:
        pip_env = os.environ.copy()
        pip_env["PYO3_USE_ABI3_FORWARD_COMPATIBILITY"] = "1"
        if os.path.exists(req_path):
            subprocess.run([python_bin, "-m", "pip", "install", "-r", req_path], env=pip_env, check=True)
        else:
            # Fallback inline list
            packages = ["fastapi", "uvicorn", "playwright", "httpx", "pydantic", "websockets", "quickjs", "google-genai", "anthropic", "fastembed", "jinja2", "pyjwt", "bcrypt", "python-multipart", "redis", "motor", "pymongo", "apsw", "sqlite-vec"]
            subprocess.run([python_bin, "-m", "pip", "install"] + packages, env=pip_env, check=True)
    except Exception as e:
        print(f"WARNING: Failed to install or verify requirements: {e}. Attempting to launch sidecar anyway...", flush=True)

    # 4. Install Playwright browsers inside venv
    print("Installing Playwright Chromium browser...", flush=True)
    try:
        subprocess.run([python_bin, "-m", "playwright", "install", "chromium"], check=True)
    except Exception as e:
        print(f"WARNING: Playwright browser installation finished with error: {e}", flush=True)

    # 5. Exec/spawn local_sidecar.py using the virtual environment python
    sidecar_script = os.path.join(script_dir, "local_sidecar.py")
    # flush before execv — the process image is replaced and buffered stdout
    # would otherwise be lost, which hides every message above from the log.
    print(f"Launching local_sidecar.py using venv python: {python_bin}", flush=True)
    try:
        # We use subprocess.call/run to keep the process running. Since it's a long running server,
        # it will keep stdout/stderr open. We use execv on unix or subprocess on Windows.
        if is_windows:
            subprocess.run([python_bin, "-u", sidecar_script])
        else:
            sys.stdout.flush()
            os.execv(python_bin, [python_bin, "-u", sidecar_script])
    except Exception as e:
        print(f"ERROR: Failed to launch local_sidecar: {e}")
        sys.exit(1)

if __name__ == "__main__":
    bootstrap()
