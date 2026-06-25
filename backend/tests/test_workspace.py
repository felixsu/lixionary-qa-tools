import pytest
from fastapi import HTTPException
from routes.workspace import sanitize_filename

def test_sanitize_filename():
    # Valid python file
    assert sanitize_filename("login_pom.py") == "login_pom.py"
    
    # Nested folder path (resolves to base filename)
    assert sanitize_filename("pages/login_pom.py") == "login_pom.py"
    
    # Traversal attempt (correctly sanitizes/basenames)
    assert sanitize_filename("../../../malicious_script.py") == "malicious_script.py"
    
    # Invalid extension (rejects)
    failed = False
    try:
        sanitize_filename("test_script.txt")
    except HTTPException as exc:
        if exc.status_code == 400:
            failed = True
    assert failed
