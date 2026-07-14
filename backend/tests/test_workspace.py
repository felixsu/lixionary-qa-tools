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

