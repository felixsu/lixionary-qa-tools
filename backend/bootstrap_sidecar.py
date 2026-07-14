import os
import sys
import subprocess

USER_HOME = os.path.expanduser("~")
BASE_DIR = os.path.join(USER_HOME, "Documents", "AutomationExplorer")
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
            
    # Determine paths inside venv
    is_windows = os.name == "nt"
    pip_bin = os.path.join(VENV_DIR, "Scripts", "pip.exe") if is_windows else os.path.join(VENV_DIR, "bin", "pip")
    python_bin = os.path.join(VENV_DIR, "Scripts", "python.exe") if is_windows else os.path.join(VENV_DIR, "bin", "python")
    playwright_bin = os.path.join(VENV_DIR, "Scripts", "playwright.exe") if is_windows else os.path.join(VENV_DIR, "bin", "playwright")

    # 2. Determine requirements path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    req_path = os.path.join(script_dir, "sidecar_requirements.txt")
    
    # 3. Install requirements
    print("Installing python sidecar requirements (this may take a few seconds on first run)...")
    try:
        pip_env = os.environ.copy()
        pip_env["PYO3_USE_ABI3_FORWARD_COMPATIBILITY"] = "1"
        if os.path.exists(req_path):
            subprocess.run([pip_bin, "install", "-r", req_path], env=pip_env, check=True)
        else:
            # Fallback inline list
            packages = ["fastapi", "uvicorn", "playwright", "httpx", "pydantic", "websockets", "quickjs", "google-genai", "jinja2", "pyjwt", "bcrypt", "python-multipart", "redis", "motor", "pymongo"]
            subprocess.run([pip_bin, "install"] + packages, env=pip_env, check=True)
    except Exception as e:
        print(f"WARNING: Failed to install or verify requirements: {e}. Attempting to launch sidecar anyway...")

    # 4. Install Playwright browsers inside venv
    print("Installing Playwright Chromium browser...")
    try:
        subprocess.run([playwright_bin, "install", "chromium"], check=True)
    except Exception as e:
        print(f"WARNING: Playwright browser installation finished with error: {e}")

    # 5. Exec/spawn local_sidecar.py using the virtual environment python
    sidecar_script = os.path.join(script_dir, "local_sidecar.py")
    print(f"Launching local_sidecar.py using venv python: {python_bin}")
    try:
        # We use subprocess.call/run to keep the process running. Since it's a long running server, 
        # it will keep stdout/stderr open. We use execv on unix or subprocess on Windows.
        if is_windows:
            subprocess.run([python_bin, "-u", sidecar_script])
        else:
            os.execv(python_bin, [python_bin, "-u", sidecar_script])
    except Exception as e:
        print(f"ERROR: Failed to launch local_sidecar: {e}")
        sys.exit(1)

if __name__ == "__main__":
    bootstrap()
