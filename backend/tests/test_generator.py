from services.generator import generate_pom_class

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
