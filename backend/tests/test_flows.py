from bson import ObjectId
from routes.flows import serialize_doc

def test_serialize_flow_doc():
    owner_id = ObjectId()
    doc_id = ObjectId()

    mock_doc = {
        "_id": doc_id,
        "ownerId": owner_id,
        "name": "Order smoke flow",
        "description": "search then verify",
        "nodes": [
            {
                "id": "n1",
                "name": "orderSearch",
                "type": "request",
                "position": {"x": 0, "y": 0},
                "config": {"requestId": "req_abc1234", "mappings": []},
            }
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
        "version": 1,
        "deleted": False,
    }

    serialized = serialize_doc(mock_doc)

    assert serialized["id"] == str(doc_id)
    assert serialized["ownerId"] == str(owner_id)
    assert serialized["nodes"][0]["config"]["requestId"] == "req_abc1234"
    assert serialized["edges"][0]["source"] == "n1"
    assert "_id" not in serialized
