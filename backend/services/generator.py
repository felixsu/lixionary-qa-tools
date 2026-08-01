import re
from typing import List, Optional

def build_pom_method_code(method_name: str, action: str, strategy: str, selector: str, frame_locators: List[str], page_url: Optional[str] = None) -> str:
    """
    Builds a single POM method body (indented for insertion into the MyPage class).
    """
    if strategy.startswith("locator"):
        strategy = "locator"

    strategy_args = ""
    if strategy == "get_by_role":
        match = re.match(r'([^\[]+)\[name="([^"]+)"\]', selector)
        if match:
            role_type = match.group(1)
            role_name = match.group(2).replace('"', '\\"')
            strategy_args = f'"{role_type}", name="{role_name}"'
        else:
            escaped_selector = selector.replace('"', '\\"')
            strategy_args = f'"{escaped_selector}"'
    else:
        escaped_selector = selector.replace('"', '\\"')
        strategy_args = f'"{escaped_selector}"'

    frame_chain = ""
    if frame_locators:
        for fl in frame_locators:
            frame_chain += f".frame_locator('{fl}')"

    docstring = f"Perform {action} on {strategy}: {selector}"
    if frame_locators:
        docstring += f" (inside iframe: {' -> '.join(frame_locators)})"

    sig_args = "self"
    if action in ("fill", "type"):
        sig_args += ", value: str"

    return_type = "str" if action == "getText" else "None"
    # type maps to Playwright's press_sequentially (real key-by-key input,
    # unlike fill()); getText maps to inner_text() and returns its result.
    playwright_call = {"type": "press_sequentially", "getText": "inner_text"}.get(action, action)

    comment = ""
    if page_url:
        comment = f"    # Recorded from: {page_url}\n"

    method_body = comment + f"    def {method_name}({sig_args}) -> {return_type}:\n"
    method_body += f'        """{docstring}"""\n'
    if action == "getText":
        method_body += f'        return self.page{frame_chain}.{strategy}({strategy_args}).{playwright_call}()\n'
    else:
        call_args = 'value' if action in ('fill', 'type') else ''
        method_body += f'        self.page{frame_chain}.{strategy}({strategy_args}).{playwright_call}({call_args})\n'
    return method_body
