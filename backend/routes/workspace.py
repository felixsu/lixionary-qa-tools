import os
import asyncio
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routes.auth import get_current_user
from config import settings

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# Track running Python scripts by user: {user_id: process}
_running_processes = {}

class FileSavePayload(BaseModel):
    content: str

class RunScriptPayload(BaseModel):
    filename: str

def get_workspace_dir(user_id: str) -> str:
    # Ensure workspaces are kept within the app storage directory
    base_dir = "/workspaces"
    user_workspace = os.path.join(base_dir, user_id)
    os.makedirs(user_workspace, exist_ok=True)
    return user_workspace

def sanitize_filename(filename: str) -> str:
    # Restrict to flat python files to prevent directory traversal
    base = os.path.basename(filename)
    if not base.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only python (.py) files are supported")
    return base

@router.get("/files")
async def get_workspace_files(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    workspace_dir = get_workspace_dir(user_id)
    
    # Initialize main.py with template if empty
    main_py_path = os.path.join(workspace_dir, "main.py")
    if not os.path.exists(main_py_path):
        default_content = """import os
import time
from playwright.sync_api import sync_playwright

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
        
        # Example delay call:
        # delay(1500)
        
        # Add your Playwright operations here!
        # e.g., page.click("button")
        
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
        for entry in os.scandir(workspace_dir):
            if entry.is_file() and entry.name.endswith(".py"):
                stat = entry.stat()
                files.append({
                    "name": entry.name,
                    "size": stat.st_size,
                    "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan workspace: {str(e)}")

    # Sort so main.py is always first, then others alphabetically
    files.sort(key=lambda x: (x["name"] != "main.py", x["name"]))
    return files

@router.get("/files/{filename:path}")
async def get_workspace_file_content(filename: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    workspace_dir = get_workspace_dir(user_id)
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
async def save_workspace_file(filename: str, payload: FileSavePayload, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    workspace_dir = get_workspace_dir(user_id)
    safe_name = sanitize_filename(filename)
    file_path = os.path.join(workspace_dir, safe_name)
    
    try:
        with open(file_path, "w") as f:
            f.write(payload.content)
        return {"message": f"File {safe_name} saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {str(e)}")

@router.delete("/files/{filename:path}")
async def delete_workspace_file(filename: str, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    workspace_dir = get_workspace_dir(user_id)
    safe_name = sanitize_filename(filename)
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
async def run_workspace_script(payload: RunScriptPayload, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["id"])
    workspace_dir = get_workspace_dir(user_id)
    safe_name = sanitize_filename(payload.filename)
    file_path = os.path.join(workspace_dir, safe_name)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script not found")
        
    # Inject BROWSER_CDP_URL env variable so script can connect automatically
    env = os.environ.copy()
    env["BROWSER_CDP_URL"] = settings.BROWSER_CDP_URL
    
    async def log_streamer():
        yield f"--- Starting execution of {safe_name} ---\n"
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                "python", file_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=workspace_dir,
                env=env
            )
            _running_processes[user_id] = process
            
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                yield line.decode("utf-8")
                
            await process.wait()
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
        # Wait briefly to clean up
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
