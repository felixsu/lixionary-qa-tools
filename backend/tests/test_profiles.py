from bson import ObjectId
from routes.profiles import serialize_doc

def test_serialize_doc():
    owner_id = ObjectId()
    doc_id = ObjectId()
    auth_func_id = ObjectId()
    
    mock_doc = {
        "_id": doc_id,
        "ownerId": owner_id,
        "name": "Admin Profile",
        "cookies": '[]',
        "localStorage": '{}',
        "authFunctionId": auth_func_id,
        "authInjection": {"type": "cookie", "key": "token", "domainOrOrigin": "localhost"}
    }
    
    serialized = serialize_doc(mock_doc)

    assert serialized["id"] == str(doc_id)
    assert serialized["ownerId"] == str(owner_id)
    assert serialized["authFunctionId"] == str(auth_func_id)
    # Legacy singular authInjection docs are migrated to a one-item list on read.
    assert "authInjection" not in serialized
    assert serialized["authInjections"] == [{"type": "cookie", "key": "token", "domainOrOrigin": "localhost"}]
    assert "name" in serialized
    assert "_id" not in serialized
