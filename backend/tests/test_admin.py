from bson import ObjectId
from datetime import datetime, timezone
from routes.admin import serialize_user, serialize_collection

def test_serialize_user():
    doc_id = ObjectId()
    now = datetime.now(timezone.utc)
    
    mock_user = {
        "_id": doc_id,
        "email": "test@lixionary.com",
        "name": "Test User",
        "createdAt": now,
        "updatedAt": now
    }
    
    serialized = serialize_user(mock_user)
    
    assert serialized["id"] == str(doc_id)
    assert "_id" not in serialized
    assert serialized["role"] == "member"  # defaulted
    assert serialized["disabled"] is False  # defaulted
    assert serialized["createdAt"] == now.isoformat()
    assert serialized["updatedAt"] == now.isoformat()

def test_serialize_collection():
    doc_id = ObjectId()
    owner_id = ObjectId()
    collab_id1 = ObjectId()
    collab_id2 = ObjectId()
    
    mock_col = {
        "_id": doc_id,
        "name": "Test Collection",
        "ownerId": owner_id,
        "collaboratorIds": [collab_id1, collab_id2],
        "requests": [
            {
                "id": "req-1",
                "name": "Get Info",
                "method": "GET",
                "url": "https://api.test.com/info",
                "authConfig": {
                    "authFunctionId": ObjectId()
                }
            }
        ]
    }
    
    serialized = serialize_collection(mock_col)
    
    assert serialized["id"] == str(doc_id)
    assert "_id" not in serialized
    assert serialized["ownerId"] == str(owner_id)
    assert serialized["collaboratorIds"] == [str(collab_id1), str(collab_id2)]
    assert isinstance(serialized["requests"][0]["authConfig"]["authFunctionId"], str)
