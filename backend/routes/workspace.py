import os
import asyncio
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routes.auth import get_current_user
from db.mongo import MongoDB
from config import settings

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# Track running Python scripts by user: {user_id: process}
_running_processes = {}

class FileSavePayload(BaseModel):
    content: str

class FileResetPayload(BaseModel):
    sessionId: str
    filename: str

class RunScriptPayload(BaseModel):
    filename: str
    session_id: str

def get_workspace_dir(user_id: str, session_id: str) -> str:
    path = os.path.join("/workspaces", user_id, session_id)
    os.makedirs(path, exist_ok=True)
    return path

def sanitize_filename(filename: str) -> str:
    normalized = os.path.normpath(filename)
    parts = normalized.split(os.sep)
    if len(parts) == 2 and parts[0] == "inspection_code":
        base = parts[1]
        if not base.endswith(".py") or ".." in base or "/" in base or "\\" in base:
            raise HTTPException(status_code=400, detail="Invalid filename")
        return os.path.join("inspection_code", base)
    elif len(parts) == 1:
        base = parts[0]
        if not base.endswith(".py") or ".." in base or "/" in base or "\\" in base:
            raise HTTPException(status_code=400, detail="Invalid filename")
        return base
    else:
        raise HTTPException(status_code=400, detail="Invalid directory structure")

async def validate_session_owner(session_id: str, user_id: str):
    sessions_col = MongoDB.get_collection("browser_sessions")
    session = await sessions_col.find_one({"session_id": session_id, "user_id": user_id})
    if not session:
        raise HTTPException(status_code=403, detail="Session not found or access denied")

@router.get("/files")
async def get_workspace_files(
    session_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(session_id, user_id)
    workspace_dir = get_workspace_dir(user_id, session_id)

    # Initialize inspection_code directory and templates
    inspection_code_dir = os.path.join(workspace_dir, "inspection_code")
    os.makedirs(inspection_code_dir, exist_ok=True)

    my_page_path = os.path.join(inspection_code_dir, "my_page.py")
    if not os.path.exists(my_page_path):
        try:
            with open(my_page_path, "w") as f:
                f.write("from playwright.sync_api import Page\n\nclass MyPage:\n    def __init__(self, page: Page):\n        self.page = page\n")
        except Exception as e:
            print(f"Failed to write default my_page.py: {e}")

    my_client_path = os.path.join(inspection_code_dir, "my_client.py")
    if not os.path.exists(my_client_path):
        try:
            with open(my_client_path, "w") as f:
                f.write('from __future__ import annotations\nimport httpx\nfrom pydantic import BaseModel, Field\nfrom typing import List, Optional, Any\n\n# --- Pydantic Models ---\n\nclass MyClient:\n    def __init__(self, base_url: str = "https://api-qa.ninjavan.co", token: str = None):\n        self.client = httpx.Client(base_url=base_url)\n        if token:\n            self.client.headers.update({"Authorization": f"Bearer {token}"})\n')
        except Exception as e:
            print(f"Failed to write default my_client.py: {e}")

    my_playground_path = os.path.join(workspace_dir, "playground.py")
    if not os.path.exists(my_playground_path):
        try:
            with open(my_playground_path, "w") as f:
                f.write('from inspection_code.my_page import MyPage\nfrom inspection_code.my_client import MyClient\n\nclass PlaygroundPage(MyPage):\n    pass\n\nclass PlaygroundClient(MyClient):\n    pass\n')
        except Exception as e:
            print(f"Failed to write default playground.py: {e}")

    main_py_path = os.path.join(workspace_dir, "main.py")
    if not os.path.exists(main_py_path):
        default_content = """import os
import time
from playwright.sync_api import sync_playwright
from playground import PlaygroundPage, PlaygroundClient

# Pre-made delay helper (ms: milliseconds)
def delay(ms: int):
    time.sleep(ms / 1000)

# Retrieve VNC browser remote debugging URL from environment
cdp_url = os.getenv("BROWSER_CDP_URL", "http://vnc-browser:9222")

print(f"Connecting to VNC browser at: {cdp_url}...")
try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)

        # Reuse the first active context and page
        context = browser.contexts[0]
        page = context.pages[0]

        print(f"Current page URL: {page.url}")
        print("Executing sample POM test tasks...")

        # Instantiate Playground instances
        playground_page = PlaygroundPage(page)
        playground_client = PlaygroundClient()

        # Add your test operations here!
        # e.g., playground_page.click_button()

        print("Execution completed successfully!")
except Exception as e:
    print(f"ERROR: Execution failed: {e}")
"""
        try:
            with open(main_py_path, "w") as f:
                f.write(default_content)
        except Exception as e:
            print(f"Failed to write default main.py: {e}")

    files = []
    try:
        # Scan root files
        for entry in os.scandir(workspace_dir):
            if entry.is_file() and entry.name.endswith(".py"):
                stat = entry.stat()
                files.append({
                    "name": entry.name,
                    "size": stat.st_size,
                    "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                })
        
        # Scan inspection_code files
        if os.path.exists(inspection_code_dir):
            for entry in os.scandir(inspection_code_dir):
                if entry.is_file() and entry.name.endswith(".py"):
                    stat = entry.stat()
                    files.append({
                        "name": f"inspection_code/{entry.name}",
                        "size": stat.st_size,
                        "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                    })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan workspace: {str(e)}")

    files.sort(key=lambda x: (x["name"] != "main.py", x["name"]))
    return files

@router.get("/files/{filename:path}")
async def get_workspace_file_content(
    filename: str,
    session_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(session_id, user_id)
    workspace_dir = get_workspace_dir(user_id, session_id)
    safe_name = sanitize_filename(filename)
    file_path = os.path.join(workspace_dir, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with open(file_path, "r") as f:
            content = f.read()
        return {"filename": safe_name, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

@router.post("/files/{filename:path}")
async def save_workspace_file(
    filename: str,
    payload: FileSavePayload,
    session_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(session_id, user_id)
    workspace_dir = get_workspace_dir(user_id, session_id)
    safe_name = sanitize_filename(filename)
    if safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files in inspection_code are read-only")
    file_path = os.path.join(workspace_dir, safe_name)

    try:
        with open(file_path, "w") as f:
            f.write(payload.content)
        return {"message": f"File {safe_name} saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {str(e)}")

@router.delete("/files/{filename:path}")
async def delete_workspace_file(
    filename: str,
    session_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(session_id, user_id)
    workspace_dir = get_workspace_dir(user_id, session_id)
    safe_name = sanitize_filename(filename)
    if safe_name.startswith("inspection_code/"):
        raise HTTPException(status_code=403, detail="Files in inspection_code are read-only")
    file_path = os.path.join(workspace_dir, safe_name)

    if safe_name == "main.py":
        raise HTTPException(status_code=400, detail="Cannot delete main.py")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        os.remove(file_path)
        return {"message": f"File {safe_name} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")

@router.post("/run")
async def run_workspace_script(
    payload: RunScriptPayload,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(payload.session_id, user_id)
    workspace_dir = get_workspace_dir(user_id, payload.session_id)
    safe_name = sanitize_filename(payload.filename)
    file_path = os.path.join(workspace_dir, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script not found")

    env = os.environ.copy()
    env["BROWSER_CDP_URL"] = settings.BROWSER_CDP_URL
    env["PYTHONUNBUFFERED"] = "1"

    # Configurable script timeout
    timeout_str = os.getenv("SCRIPT_EXECUTION_TIMEOUT", "60")
    try:
        timeout = float(timeout_str)
    except ValueError:
        timeout = 60.0

    async def log_streamer():
        yield f"--- Starting execution of {safe_name} (Timeout: {int(timeout)}s) ---\n"
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                "python", "-u", file_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=workspace_dir,
                env=env
            )
            _running_processes[user_id] = process

            start_time = asyncio.get_event_loop().time()
            while True:
                elapsed = asyncio.get_event_loop().time() - start_time
                remaining = timeout - elapsed
                if remaining <= 0:
                    yield f"\nERROR: Script execution timed out (maximum {int(timeout)} seconds allowed).\n"
                    try:
                        process.terminate()
                        await asyncio.sleep(0.5)
                        if process.returncode is None:
                            process.kill()
                    except Exception:
                        pass
                    break

                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=remaining)
                    if not line:
                        break
                    yield line.decode("utf-8")
                except asyncio.TimeoutError:
                    yield f"\nERROR: Script execution timed out (maximum {int(timeout)} seconds allowed).\n"
                    try:
                        process.terminate()
                        await asyncio.sleep(0.5)
                        if process.returncode is None:
                            process.kill()
                    except Exception:
                        pass
                    break

            elapsed = asyncio.get_event_loop().time() - start_time
            remaining = timeout - elapsed
            if remaining > 0:
                try:
                    await asyncio.wait_for(process.wait(), timeout=remaining)
                except asyncio.TimeoutError:
                    try:
                        process.terminate()
                        await asyncio.sleep(0.5)
                        if process.returncode is None:
                            process.kill()
                    except Exception:
                        pass
            else:
                try:
                    if process.returncode is None:
                        process.terminate()
                        await asyncio.sleep(0.5)
                        if process.returncode is None:
                            process.kill()
                except Exception:
                    pass

            yield f"\n--- Process finished with exit code {process.returncode} ---\n"
        except Exception as e:
            yield f"\nERROR: Process execution failed: {str(e)}\n"
        finally:
            if process:
                try:
                    if process.returncode is None:
                        process.terminate()
                except Exception:
                    pass
            _running_processes.pop(user_id, None)

    return StreamingResponse(log_streamer(), media_type="text/plain")

@router.post("/stop")
async def stop_workspace_script(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    process = _running_processes.get(user_id)
    if not process:
        return {"message": "No script is currently running"}
    try:
        process.terminate()
        for _ in range(5):
            if process.returncode is not None:
                break
            await asyncio.sleep(0.1)
        if process.returncode is None:
            process.kill()
        _running_processes.pop(user_id, None)
        return {"message": "Script execution stopped successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop script: {str(e)}")


def write_with_lock(lock, file_path, content):
    with lock:
        with open(file_path, "w") as f:
            f.write(content)


@router.post("/reset")
async def reset_workspace_file(
    payload: FileResetPayload,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["id"])
    await validate_session_owner(payload.sessionId, user_id)
    workspace_dir = get_workspace_dir(user_id, payload.sessionId)
    safe_name = sanitize_filename(payload.filename)
    file_path = os.path.join(workspace_dir, safe_name)

    default_content = ""
    if safe_name == "inspection_code/my_page.py":
        default_content = "from playwright.sync_api import Page\n\nclass MyPage:\n    def __init__(self, page: Page):\n        self.page = page\n"
    elif safe_name == "inspection_code/my_client.py":
        default_content = 'from __future__ import annotations\nimport httpx\nfrom pydantic import BaseModel, Field\nfrom typing import List, Optional, Any\n\n# --- Pydantic Models ---\n\nclass MyClient:\n    def __init__(self, base_url: str = "https://api-qa.ninjavan.co", token: str = None):\n        self.client = httpx.Client(base_url=base_url)\n        if token:\n            self.client.headers.update({"Authorization": f"Bearer {token}"})\n'
    elif safe_name == "playground.py":
        default_content = 'from inspection_code.my_page import MyPage\nfrom inspection_code.my_client import MyClient\n\nclass PlaygroundPage(MyPage):\n    pass\n\nclass PlaygroundClient(MyClient):\n    pass\n'
    elif safe_name == "main.py":
        default_content = """import os
import time
from playwright.sync_api import sync_playwright
from playground import PlaygroundPage, PlaygroundClient

# Pre-made delay helper (ms: milliseconds)
def delay(ms: int):
    time.sleep(ms / 1000)

# Retrieve VNC browser remote debugging URL from environment
cdp_url = os.getenv("BROWSER_CDP_URL", "http://vnc-browser:9222")

print(f"Connecting to VNC browser at: {cdp_url}...")
try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)

        # Reuse the first active context and page
        context = browser.contexts[0]
        page = context.pages[0]

        print(f"Current page URL: {page.url}")
        print("Executing sample POM test tasks...")

        # Instantiate Playground instances
        playground_page = PlaygroundPage(page)
        playground_client = PlaygroundClient()

        # Add your test operations here!
        # e.g., playground_page.click_button()

        print("Execution completed successfully!")
except Exception as e:
    print(f"ERROR: Execution failed: {e}")
"""
    else:
        raise HTTPException(status_code=400, detail="Only boilerplate files can be reset")

    from services.browser import get_session_lock
    lock = get_session_lock(payload.sessionId)
    try:
        await asyncio.to_thread(write_with_lock, lock, file_path, default_content)
        return {"content": default_content, "message": f"File {safe_name} reset to default"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset file: {str(e)}")
