from typing import Any, Dict, List, Optional

import apsw
import sqlite_vec

_ROW_COLUMNS = [
    "id", "request_id", "collection_local_id", "name", "url",
    "description", "description_hash", "embedding_status", "updated_at",
]


def _dict_rows(cursor: apsw.Cursor, columns: List[str]) -> List[Dict[str, Any]]:
    return [dict(zip(columns, row)) for row in cursor]


def get_rows_for_collection(conn: apsw.Connection, collection_local_id: str) -> Dict[str, Dict[str, Any]]:
    rows = _dict_rows(conn.execute(
        f"SELECT {', '.join(_ROW_COLUMNS)} FROM request_index WHERE collection_local_id = ?",
        (collection_local_id,),
    ), _ROW_COLUMNS)
    return {r["request_id"]: r for r in rows}


def upsert_row(
    conn: apsw.Connection,
    *,
    request_id: str,
    collection_local_id: str,
    name: str,
    url: str,
    description: str,
    description_hash: Optional[str],
    embedding_status: str,
    updated_at: str,
) -> int:
    conn.execute(
        """
        INSERT INTO request_index
            (request_id, collection_local_id, name, url, description, description_hash, embedding_status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
            collection_local_id = excluded.collection_local_id,
            name = excluded.name,
            url = excluded.url,
            description = excluded.description,
            description_hash = excluded.description_hash,
            embedding_status = excluded.embedding_status,
            updated_at = excluded.updated_at
        """,
        (request_id, collection_local_id, name, url, description, description_hash, embedding_status, updated_at),
    )
    row = _dict_rows(conn.execute(
        "SELECT id FROM request_index WHERE request_id = ?", (request_id,),
    ), ["id"])
    return row[0]["id"]


def set_embedding_status(conn: apsw.Connection, surrogate_id: int, status: str) -> None:
    conn.execute("UPDATE request_index SET embedding_status = ? WHERE id = ?", (status, surrogate_id))


def delete_rows(conn: apsw.Connection, request_ids: List[str]) -> List[int]:
    if not request_ids:
        return []
    placeholders = ", ".join("?" for _ in request_ids)
    ids = [r["id"] for r in _dict_rows(conn.execute(
        f"SELECT id FROM request_index WHERE request_id IN ({placeholders})", request_ids,
    ), ["id"])]
    conn.execute(f"DELETE FROM request_index WHERE request_id IN ({placeholders})", request_ids)
    if ids:
        id_placeholders = ", ".join("?" for _ in ids)
        conn.execute(f"DELETE FROM request_vec WHERE rowid IN ({id_placeholders})", ids)
    return ids


def delete_rows_for_collection(conn: apsw.Connection, collection_local_id: str) -> None:
    ids = [r["id"] for r in _dict_rows(conn.execute(
        "SELECT id FROM request_index WHERE collection_local_id = ?", (collection_local_id,),
    ), ["id"])]
    conn.execute("DELETE FROM request_index WHERE collection_local_id = ?", (collection_local_id,))
    if ids:
        id_placeholders = ", ".join("?" for _ in ids)
        conn.execute(f"DELETE FROM request_vec WHERE rowid IN ({id_placeholders})", ids)


def write_embedding(conn: apsw.Connection, surrogate_id: int, vector: List[float]) -> None:
    conn.execute("DELETE FROM request_vec WHERE rowid = ?", (surrogate_id,))
    conn.execute(
        "INSERT INTO request_vec(rowid, embedding) VALUES (?, ?)",
        (surrogate_id, sqlite_vec.serialize_float32(vector)),
    )
    set_embedding_status(conn, surrogate_id, "ready")


def all_rows(conn: apsw.Connection) -> List[Dict[str, Any]]:
    return _dict_rows(conn.execute(f"SELECT {', '.join(_ROW_COLUMNS)} FROM request_index"), _ROW_COLUMNS)


def search_vector(conn: apsw.Connection, query_vector: List[float], k: int) -> List[Dict[str, Any]]:
    rows = _dict_rows(conn.execute(
        "SELECT rowid, distance FROM request_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance",
        (sqlite_vec.serialize_float32(query_vector), k),
    ), ["rowid", "distance"])
    if not rows:
        return []
    id_placeholders = ", ".join("?" for _ in rows)
    ids = [r["rowid"] for r in rows]
    distance_by_id = {r["rowid"]: r["distance"] for r in rows}
    request_rows = _dict_rows(conn.execute(
        f"SELECT {', '.join(_ROW_COLUMNS)} FROM request_index WHERE id IN ({id_placeholders})", ids,
    ), _ROW_COLUMNS)
    for row in request_rows:
        row["distance"] = distance_by_id[row["id"]]
    return request_rows


def list_pending_request_ids(conn: apsw.Connection, limit: int = 500) -> List[str]:
    rows = _dict_rows(conn.execute(
        "SELECT request_id FROM request_index WHERE embedding_status = 'pending' LIMIT ?", (limit,),
    ), ["request_id"])
    return [r["request_id"] for r in rows]
