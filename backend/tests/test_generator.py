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

