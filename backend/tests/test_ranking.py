from services.browser import rank_locators

def test_rank_locators_anchored_xpath():
    metadata = {
        "tagName": "input",
        "text": "",
        "testId": "",
        "label": "",
        "placeholder": "",
        "role": "",
        "cssSelector": "div > input",
        "xpath": "//input",
        "anchoredXpath": "//div[text()=\"Username\"]/following-sibling::input[1]"
    }
    
    locators = rank_locators(metadata)
    strategies = [l["strategy"] for l in locators]
    
    # Anchored XPath (Priority 75) should be ranked higher than locator (CSS) (Priority 40)
    # and locator (XPath) (Priority 10), but below get_by_* if present.
    # Here, no get_by_test_id, get_by_label, etc. are active because their fields are empty.
    assert "locator (Anchored XPath)" in strategies
    assert "locator (CSS)" in strategies
    assert "locator (XPath)" in strategies
    
    anchored_idx = strategies.index("locator (Anchored XPath)")
    css_idx = strategies.index("locator (CSS)")
    xpath_idx = strategies.index("locator (XPath)")
    
    assert anchored_idx < css_idx
    assert css_idx < xpath_idx
