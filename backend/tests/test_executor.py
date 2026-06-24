import pytest
from services.executor import interpolate_variables, extract_jwt_expiry
from datetime import datetime, timezone

def test_interpolate_variables():
    variables = {"BASE_URL": "https://api.example.com", "USER_ID": "12345"}
    
    url = "{{BASE_URL}}/users/{{USER_ID}}"
    result = interpolate_variables(url, variables)
    assert result == "https://api.example.com/users/12345"

    no_match = "{{NOT_FOUND}}/path"
    result = interpolate_variables(no_match, variables)
    assert result == "{{NOT_FOUND}}/path"

def test_extract_jwt_expiry_fallback():
    # Invalid token should fallback to 1 hour from now
    expiry = extract_jwt_expiry("invalid-token-string")
    delta = expiry - datetime.now(timezone.utc)
    assert 3500 < delta.total_seconds() < 3700
