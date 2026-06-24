from bson import ObjectId
from routes.profiles import serialize_doc

def test_serialize_doc():
    owner_id = ObjectId()
    doc_id = ObjectId()
    
    mock_doc = {
        "_id": doc_id,
        "ownerId": owner_id,
        "name": "Admin Profile",
        "cookies": '[]',
        "localStorage": '{}'
    }
    
    serialized = serialize_doc(mock_doc)
    
    assert serialized["id"] == str(doc_id)
    assert serialized["ownerId"] == str(owner_id)
    assert "name" in serialized
    assert "_id" not in serialized
