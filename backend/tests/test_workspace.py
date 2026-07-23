import pytest
from fastapi import HTTPException
from local_sidecar import sanitize_filename

def test_sanitize_filename():
    # Valid flat python file
    assert sanitize_filename("login_pom.py") == "login_pom.py"
    
    # Valid inspection_code subdirectory path
    assert sanitize_filename("inspection_code/login_pom.py") == "inspection_code/login_pom.py"
    
    # Non-supported subdirectories (rejects)
    failed = False
    try:
        sanitize_filename("pages/login_pom.py")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed
    
    # Traversal attempt (rejects)
    failed = False
    try:
        sanitize_filename("../../../malicious_script.py")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed
    
    # Invalid extension (rejects)
    failed = False
    try:
        sanitize_filename("test_script.txt")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed


async def test_reset_workspace_file():
    import os
    import shutil
    import tempfile
    import local_sidecar
    from local_sidecar import reset_workspace, FileResetPayload, DEFAULT_MY_PAGE_PY, DEFAULT_MY_CLIENT_PY, DEFAULT_MAIN_PY

    tmp_workspace = tempfile.mkdtemp(prefix="ae_test_ws_")
    prev_workspace_dir = local_sidecar.WORKSPACE_DIR
    local_sidecar.WORKSPACE_DIR = tmp_workspace
    try:
        os.makedirs(os.path.join(tmp_workspace, "default", "inspection_code"), exist_ok=True)

        # Scaffold files inside inspection_code/ are resettable to their boilerplate
        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="inspection_code/my_page.py"))
        assert res["content"] == DEFAULT_MY_PAGE_PY
        with open(os.path.join(tmp_workspace, "default", "inspection_code", "my_page.py")) as f:
            assert f.read() == DEFAULT_MY_PAGE_PY

        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="inspection_code/my_client.py"))
        assert res["content"] == DEFAULT_MY_CLIENT_PY

        # Other inspection_code/ files stay read-only
        failed = False
        try:
            await reset_workspace(FileResetPayload(sessionId="s1", filename="inspection_code/other_pom.py"))
        except HTTPException as exc:
            if exc.status_code == 403:
                failed = True
        assert failed

        # main.py resets to its boilerplate and returns the content
        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="main.py"))
        assert res["content"] == DEFAULT_MAIN_PY
    finally:
        local_sidecar.WORKSPACE_DIR = prev_workspace_dir
        shutil.rmtree(tmp_workspace, ignore_errors=True)

