from bson import ObjectId
from fastapi import HTTPException
from routes.user_guides import (
    MAX_GUIDE_DEPTH,
    compute_depth,
    compute_subtree_height,
    is_descendant,
    normalize_slug,
    serialize_guide,
)

def test_serialize_guide_hierarchy_fields():
    # Legacy doc without parentId/order/slug reads as a root page.
    doc_id = ObjectId()
    legacy = serialize_guide({"_id": doc_id, "title": "Old", "blocks": []})
    assert legacy["id"] == str(doc_id)
    assert legacy["parentId"] is None
    assert legacy["slug"] is None
    assert legacy["order"] == 0
    assert legacy["blockCount"] == 0

    parent_oid = ObjectId()
    nested = serialize_guide({"_id": ObjectId(), "title": "Child", "parentId": parent_oid, "order": 3, "slug": "child-page"})
    assert nested["parentId"] == str(parent_oid)
    assert nested["slug"] == "child-page"
    assert nested["order"] == 3

def test_normalize_slug():
    assert normalize_slug(None) is None
    assert normalize_slug("") is None
    assert normalize_slug("   ") is None
    assert normalize_slug("  API-Studio-Intro  ") == "api-studio-intro"
    assert normalize_slug("guide-2") == "guide-2"
    for bad in ("has space", "under_score", "-leading", "trailing-", "dot.dot", "double--dash"):
        try:
            normalize_slug(bad)
            assert False, f"expected 400 for slug {bad!r}"
        except HTTPException as e:
            assert e.status_code == 400

def test_compute_depth_and_height():
    # a -> b -> c -> d -> e (5-deep chain)
    parent_map = {"a": None, "b": "a", "c": "b", "d": "c", "e": "d"}
    assert compute_depth("a", parent_map) == 1
    assert compute_depth("e", parent_map) == MAX_GUIDE_DEPTH

    # Orphaned parentId (parent doc missing from the map) is treated as root.
    assert compute_depth("x", {"x": "ghost"}) == 1

    # Cycle in legacy data terminates instead of looping forever.
    assert compute_depth("p", {"p": "q", "q": "p"}) == 2

    children_map = {"a": ["b"], "b": ["c"], "c": ["d"], "d": ["e"]}
    assert compute_subtree_height("e", children_map) == 1
    assert compute_subtree_height("a", children_map) == 5
    assert compute_subtree_height("c", children_map) == 3

def test_is_descendant_cycle_detection():
    parent_map = {"a": None, "b": "a", "c": "b", "z": None}
    assert is_descendant("a", "a", parent_map)      # self
    assert is_descendant("b", "a", parent_map)      # direct child
    assert is_descendant("c", "a", parent_map)      # deep descendant
    assert not is_descendant("z", "a", parent_map)  # unrelated
    assert not is_descendant("a", "b", parent_map)  # ancestor is not a descendant

def test_move_depth_rule():
    # Moving a height-2 subtree (c -> d) under a depth-4 parent must be rejected:
    # depth(parent)=4 + height(subtree)=2 > 5.
    parent_map = {"r1": None, "r2": "r1", "r3": "r2", "r4": "r3", "c": None, "d": "c"}
    children_map = {"r1": ["r2"], "r2": ["r3"], "r3": ["r4"], "c": ["d"]}
    depth = compute_depth("r4", parent_map)
    height = compute_subtree_height("c", children_map)
    assert depth == 4
    assert height == 2
    assert depth + height > MAX_GUIDE_DEPTH

    # The same subtree fits under a depth-3 parent.
    assert compute_depth("r3", parent_map) + height <= MAX_GUIDE_DEPTH
