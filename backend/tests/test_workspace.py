import pytest
from fastapi import HTTPException
from local_sidecar import sanitize_filename

def test_sanitize_filename():
    # Valid builder/ and recording/ python files
    assert sanitize_filename("builder/login_pom.py") == "builder/login_pom.py"
    assert sanitize_filename("builder/main.py") == "builder/main.py"
    assert sanitize_filename("recording/main.py") == "recording/main.py"

    # Root-level files are no longer valid (everything lives in a subdir)
    failed = False
    try:
        sanitize_filename("login_pom.py")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed

    # The retired inspection_code/ subdirectory (rejects)
    failed = False
    try:
        sanitize_filename("inspection_code/login_pom.py")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed

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

    # Traversal disguised inside a valid subdir (rejects)
    failed = False
    try:
        sanitize_filename("builder/../../../malicious_script.py")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed

    # Invalid extension (rejects)
    failed = False
    try:
        sanitize_filename("builder/test_script.txt")
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
        os.makedirs(os.path.join(tmp_workspace, "default", "builder"), exist_ok=True)
        os.makedirs(os.path.join(tmp_workspace, "default", "recording"), exist_ok=True)

        # Generated POM modules are resettable to their boilerplate
        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="builder/my_page.py"))
        assert res["content"] == DEFAULT_MY_PAGE_PY
        with open(os.path.join(tmp_workspace, "default", "builder", "my_page.py")) as f:
            assert f.read() == DEFAULT_MY_PAGE_PY

        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="builder/my_client.py"))
        assert res["content"] == DEFAULT_MY_CLIENT_PY

        # main.py resets to its boilerplate and returns the content
        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="builder/main.py"))
        assert res["content"] == DEFAULT_MAIN_PY

        # The recording script resets to the empty replay boilerplate
        res = await reset_workspace(FileResetPayload(sessionId="s1", filename="recording/main.py"))
        assert "No steps recorded yet" in res["content"]
    finally:
        local_sidecar.WORKSPACE_DIR = prev_workspace_dir
        shutil.rmtree(tmp_workspace, ignore_errors=True)


async def test_migrate_legacy_workspace_layout():
    import os
    import shutil
    import tempfile
    from local_sidecar import migrate_legacy_workspace_layout

    tmp_workspace = tempfile.mkdtemp(prefix="ae_test_migrate_")
    try:
        # Old flat layout with user edits
        os.makedirs(os.path.join(tmp_workspace, "inspection_code"), exist_ok=True)
        legacy = {
            "main.py": "# my edited main\nfrom playground import PlaygroundPage\n",
            "playground.py": "from playwright.sync_api import Page\nfrom inspection_code.my_page import MyPage\n\nclass PlaygroundPage(MyPage):\n    pass\n",
            "my_recording.py": "# recorded steps\n",
            "custom_module.py": "# user module\n",
            os.path.join("inspection_code", "my_page.py"): "class MyPage:\n    def click_login(self): pass\n",
            os.path.join("inspection_code", "my_client.py"): "class MyClient: pass\n",
        }
        for rel, content in legacy.items():
            with open(os.path.join(tmp_workspace, rel), "w") as f:
                f.write(content)

        migrate_legacy_workspace_layout(tmp_workspace)

        # Everything moved into builder/ + recording/, contents preserved
        with open(os.path.join(tmp_workspace, "builder", "main.py")) as f:
            assert f.read() == legacy["main.py"]
        with open(os.path.join(tmp_workspace, "builder", "my_page.py")) as f:
            assert "click_login" in f.read()
        with open(os.path.join(tmp_workspace, "builder", "my_client.py")) as f:
            assert "MyClient" in f.read()
        with open(os.path.join(tmp_workspace, "builder", "custom_module.py")) as f:
            assert f.read() == legacy["custom_module.py"]
        with open(os.path.join(tmp_workspace, "recording", "main.py")) as f:
            assert f.read() == legacy["my_recording.py"]

        # The one import line in playground.py is rewritten for the flat layout
        with open(os.path.join(tmp_workspace, "builder", "playground.py")) as f:
            content = f.read()
        assert "from my_page import MyPage" in content
        assert "inspection_code" not in content

        # Legacy dirs and root files are gone
        assert not os.path.exists(os.path.join(tmp_workspace, "inspection_code"))
        assert not os.path.exists(os.path.join(tmp_workspace, "main.py"))
        assert not os.path.exists(os.path.join(tmp_workspace, "my_recording.py"))

        # Idempotent: running again on the migrated layout changes nothing
        migrate_legacy_workspace_layout(tmp_workspace)
        with open(os.path.join(tmp_workspace, "builder", "main.py")) as f:
            assert f.read() == legacy["main.py"]
    finally:
        shutil.rmtree(tmp_workspace, ignore_errors=True)
