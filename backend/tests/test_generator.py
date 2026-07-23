from services.generator import generate_pom_class, build_pom_method_code

def test_generate_pom_class_strategies():
    elements = [
        {
            "element_id": "el_1",
            "method_name": "click_button",
            "strategy": "locator (CSS)",
            "selector": ".my-btn",
            "action": "click"
        },
        {
            "element_id": "el_2",
            "method_name": "fill_input",
            "strategy": "locator (Anchored XPath)",
            "selector": "//div[text()=\"User\"]/following-sibling::input",
            "action": "fill"
        }
    ]
    
    pom_code = generate_pom_class(
        class_name="LoginPage",
        url="https://example.com",
        parent_locator="",
        elements=elements
    )
    
    print("Generated POM Code:\n", pom_code)
    # Check that it uses valid Python method calls
    assert "self.page.locator(\".my-btn\").click()" in pom_code
    assert "self.page.locator(\"//div[text()=\\\"User\\\"]/following-sibling::input\").fill(value)" in pom_code

def test_build_pom_method_code_with_url():
    method_code = build_pom_method_code(
        method_name="click_login",
        action="click",
        strategy="locator",
        selector="#login-btn",
        frame_locators=[],
        page_url="https://example.com/login"
    )
    assert "# Recorded from: https://example.com/login" in method_code
    assert "def click_login(self) -> None:" in method_code


async def test_record_interaction():
    import os
    import shutil
    import tempfile
    from services.browser import BrowserSessionManager
    session_id = "test_record_sess"
    tmp_base = tempfile.mkdtemp(prefix="ae_test_")
    prev_data_dir = os.environ.get("AE_DATA_DIR")
    os.environ["AE_DATA_DIR"] = tmp_base
    BrowserSessionManager._sessions[session_id] = {
        "recording_enabled": True,
        "recorded_steps": [],
        "callback": None
    }
    
    action_data = {
        "action": "click",
        "element": {
            "tagName": "button",
            "testId": "submit-btn",
            "cssSelector": "button.submit"
        }
    }
    
    try:
        await BrowserSessionManager.record_interaction(session_id, action_data)

        session = BrowserSessionManager._sessions[session_id]
        assert len(session["recorded_steps"]) == 1
        assert "page.get_by_test_id(\"submit-btn\").click()" in session["recorded_steps"][0]

        # my_recording.py must land in the flavor-aware workspace (AE_DATA_DIR),
        # not the legacy ~/Documents location
        my_recording_path = os.path.join(tmp_base, "workspaces", "default", "my_recording.py")
        assert os.path.exists(my_recording_path)
        with open(my_recording_path) as f:
            assert "page.get_by_test_id(\"submit-btn\").click()" in f.read()
    finally:
        del BrowserSessionManager._sessions[session_id]
        if prev_data_dir is None:
            os.environ.pop("AE_DATA_DIR", None)
        else:
            os.environ["AE_DATA_DIR"] = prev_data_dir
        shutil.rmtree(tmp_base, ignore_errors=True)


