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

async def test_get_valid_auth_token_caching():
    from unittest.mock import AsyncMock, patch
    from bson import ObjectId
    from datetime import timedelta
    from services.executor import get_valid_auth_token

    # Mock MongoDB collection
    mock_col = AsyncMock()
    
    # 1. Test case: Cached token exists and is valid (expires in 100 seconds)
    now = datetime.now(timezone.utc)
    mock_func = {
        "_id": ObjectId(),
        "name": "Test Hook",
        "script": "return 'new-token';",
        "cachedToken": "old-token",
        "expiresAt": now + timedelta(seconds=100),
        "expires_in": 3600
    }
    
    mock_col.find_one.return_value = mock_func
    
    with patch("db.mongo.MongoDB.get_collection", return_value=mock_col):
        # Should return cached token directly
        token = await get_valid_auth_token(str(mock_func["_id"]))
        assert token == "old-token"
        assert mock_col.update_one.call_count == 0

    # 2. Test case: Token is almost expired (within 30 seconds buffer, e.g. expires in 10 seconds)
    mock_func_expired = {
        "_id": ObjectId(),
        "name": "Test Hook",
        "script": "return 'new-token';",
        "cachedToken": "old-token",
        "expiresAt": now + timedelta(seconds=10),
        "expires_in": 3600
    }
    
    mock_col.find_one.return_value = mock_func_expired
    
    with patch("db.mongo.MongoDB.get_collection", return_value=mock_col), \
         patch("services.executor.run_unsafe_auth_script", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = "new-token"
        
        token = await get_valid_auth_token(str(mock_func_expired["_id"]))
        assert token == "new-token"
        assert mock_col.update_one.call_count == 1
        mock_run.assert_called_once()
