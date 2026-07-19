import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import apsw
import sqlite_vec

USER_HOME = os.path.expanduser("~")
BASE_DIR = os.path.join(USER_HOME, "Documents", "AutomationExplorer")
DB_PATH = os.path.join(BASE_DIR, "local.db")

ENTITY_TYPES = {"collection", "environment", "auth_function", "browser_profile", "flow"}

# NOTE: Python's stdlib `sqlite3` module ships without extension-loading support
# on Python.org's official macOS builds (no `enable_load_extension` at all), which
# makes it unusable for `sqlite-vec`. We use `apsw` instead — it bundles its own
# SQLite build with extension loading enabled and publishes wheels for macOS
# (arm64 + x86_64) and Windows, matching this app's desktop release targets.


# apsw's cursor.getdescription() raises apsw.ExecutionCompleteError when a query
# returns zero rows (the statement "completes" before a description is ever
# available) — so column names are passed explicitly here rather than introspected.
def _dict_rows(cursor: apsw.Cursor, columns: List[str]) -> List[Dict[str, Any]]:
    return [dict(zip(columns, row)) for row in cursor]


def _dict_row(cursor: apsw.Cursor, columns: List[str]) -> Optional[Dict[str, Any]]:
    rows = _dict_rows(cursor, columns)
    return rows[0] if rows else None


_ENTITY_COLUMNS = [
    "entity_type", "local_id", "cloud_id", "payload", "version", "base_version",
    "deleted", "device_id", "updated_at", "created_at",
]
_SYNC_STATE_COLUMNS = [
    "local_id", "cloud_id", "version", "base_version", "deleted", "device_id", "updated_at",
]


class LocalStore:
    _conn: Optional[apsw.Connection] = None

    @classmethod
    def connect(cls):
        if cls._conn is not None:
            return
        os.makedirs(BASE_DIR, exist_ok=True)
        conn = apsw.Connection(DB_PATH)

        # Load the sqlite-vec extension so a future embeddings feature can reuse
        # this same DB file without a re-architecture. No vec0 table is created
        # yet — this is just a smoke test that the extension loads on this platform.
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)

        cls._conn = conn
        cls._init_schema()
        cls._ensure_device_id()

    @classmethod
    def _init_schema(cls):
        cls._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entities (
                entity_type   TEXT NOT NULL,
                local_id      TEXT NOT NULL,
                cloud_id      TEXT,
                payload       TEXT NOT NULL,
                version       INTEGER NOT NULL DEFAULT 1,
                base_version  INTEGER NOT NULL DEFAULT 0,
                deleted       INTEGER NOT NULL DEFAULT 0,
                device_id     TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                PRIMARY KEY (entity_type, local_id)
            );
            CREATE INDEX IF NOT EXISTS idx_entities_cloud_id ON entities(entity_type, cloud_id);

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_prefs (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )

    @classmethod
    def _ensure_device_id(cls):
        row = _dict_row(cls._conn.execute("SELECT value FROM meta WHERE key = 'device_id'"), ["value"])
        if not row:
            cls._conn.execute(
                "INSERT INTO meta (key, value) VALUES ('device_id', ?)",
                (str(uuid.uuid4()),),
            )

    @classmethod
    def device_id(cls) -> str:
        row = _dict_row(cls._conn.execute("SELECT value FROM meta WHERE key = 'device_id'"), ["value"])
        return row["value"]

    @classmethod
    def active_user_id(cls) -> Optional[str]:
        row = _dict_row(cls._conn.execute("SELECT value FROM meta WHERE key = 'active_user_id'"), ["value"])
        return row["value"] if row else None

    @classmethod
    def set_active_user(cls, user_id: str) -> bool:
        """Records which cloud user this device's local sync cache currently
        belongs to. The cache is device-wide, not per-user — if a different
        user signs in (e.g. someone with two Google accounts on the same
        machine), their local records would otherwise still carry the
        previous user's cloudIds and the sidecar has no way to tell the two
        apart. Wipes the cache on a genuine switch so the app re-pulls fresh
        from the new user's cloud data instead of leaking the old user's
        browser profiles/environments/etc. into view. Returns True if a wipe
        happened."""
        previous = cls.active_user_id()
        switched = previous is not None and previous != user_id
        if switched:
            cls._conn.execute("DELETE FROM entities")
        cls._conn.execute(
            "INSERT INTO meta (key, value) VALUES ('active_user_id', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (user_id,),
        )
        return switched

    @classmethod
    def _now(cls) -> str:
        return datetime.now(timezone.utc).isoformat()

    @classmethod
    def _row_to_dict(cls, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "localId": row["local_id"],
            "cloudId": row["cloud_id"],
            "payload": row["payload"],
            "version": row["version"],
            "baseVersion": row["base_version"],
            "dirty": row["version"] > row["base_version"],
            "deleted": bool(row["deleted"]),
            "deviceId": row["device_id"],
            "updatedAt": row["updated_at"],
            "createdAt": row["created_at"],
        }

    @classmethod
    def list(cls, entity_type: str) -> List[Dict[str, Any]]:
        rows = _dict_rows(cls._conn.execute(
            f"SELECT {', '.join(_ENTITY_COLUMNS)} FROM entities "
            "WHERE entity_type = ? AND deleted = 0 ORDER BY created_at",
            (entity_type,),
        ), _ENTITY_COLUMNS)
        return [cls._row_to_dict(r) for r in rows]

    @classmethod
    def get(cls, entity_type: str, local_id: str) -> Optional[Dict[str, Any]]:
        row = _dict_row(cls._conn.execute(
            f"SELECT {', '.join(_ENTITY_COLUMNS)} FROM entities "
            "WHERE entity_type = ? AND local_id = ?",
            (entity_type, local_id),
        ), _ENTITY_COLUMNS)
        return cls._row_to_dict(row) if row else None

    @classmethod
    def sync_state(cls, entity_type: str) -> List[Dict[str, Any]]:
        rows = _dict_rows(cls._conn.execute(
            f"SELECT {', '.join(_SYNC_STATE_COLUMNS)} "
            "FROM entities WHERE entity_type = ?",
            (entity_type,),
        ), _SYNC_STATE_COLUMNS)
        return [
            {
                "localId": r["local_id"],
                "cloudId": r["cloud_id"],
                "version": r["version"],
                "baseVersion": r["base_version"],
                "dirty": r["version"] > r["base_version"],
                "deleted": bool(r["deleted"]),
                "deviceId": r["device_id"],
                "updatedAt": r["updated_at"],
            }
            for r in rows
        ]

    @classmethod
    def create(cls, entity_type: str, payload_json: str) -> Dict[str, Any]:
        local_id = str(uuid.uuid4())
        now = cls._now()
        cls._conn.execute(
            """
            INSERT INTO entities
                (entity_type, local_id, cloud_id, payload, version, base_version,
                 deleted, device_id, updated_at, created_at)
            VALUES (?, ?, NULL, ?, 1, 0, 0, ?, ?, ?)
            """,
            (entity_type, local_id, payload_json, cls.device_id(), now, now),
        )
        return cls.get(entity_type, local_id)

    @classmethod
    def create_synced(
        cls, entity_type: str, payload_json: str, *, cloud_id: str, version: int, device_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Inserts a record pulled from the cloud — starts clean (base_version ==
        version), unlike `create()` which always starts as an unsynced local draft."""
        local_id = str(uuid.uuid4())
        now = cls._now()
        cls._conn.execute(
            """
            INSERT INTO entities
                (entity_type, local_id, cloud_id, payload, version, base_version,
                 deleted, device_id, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (entity_type, local_id, cloud_id, payload_json, version, version,
             device_id or cls.device_id(), now, now),
        )
        return cls.get(entity_type, local_id)

    @classmethod
    def update(cls, entity_type: str, local_id: str, payload_json: str) -> Optional[Dict[str, Any]]:
        existing = cls.get(entity_type, local_id)
        if not existing:
            return None
        cls._conn.execute(
            """
            UPDATE entities
            SET payload = ?, version = version + 1, device_id = ?, updated_at = ?
            WHERE entity_type = ? AND local_id = ?
            """,
            (payload_json, cls.device_id(), cls._now(), entity_type, local_id),
        )
        return cls.get(entity_type, local_id)

    @classmethod
    def delete(cls, entity_type: str, local_id: str) -> bool:
        existing = cls.get(entity_type, local_id)
        if not existing:
            return False
        if existing["cloudId"] is None:
            # Never synced — nothing for other devices to reconcile, just remove it.
            cls._conn.execute(
                "DELETE FROM entities WHERE entity_type = ? AND local_id = ?",
                (entity_type, local_id),
            )
        else:
            # Tombstone so the deletion propagates through the same version-diff sync logic.
            cls._conn.execute(
                """
                UPDATE entities
                SET deleted = 1, version = version + 1, device_id = ?, updated_at = ?
                WHERE entity_type = ? AND local_id = ?
                """,
                (cls.device_id(), cls._now(), entity_type, local_id),
            )
        return True

    @classmethod
    def mark_synced(
        cls,
        entity_type: str,
        local_id: str,
        *,
        cloud_id: Optional[str],
        new_base_version: int,
        resolved_payload_json: Optional[str] = None,
        deleted: bool = False,
    ) -> Optional[Dict[str, Any]]:
        existing = cls.get(entity_type, local_id)
        if not existing:
            return None
        if resolved_payload_json is not None:
            cls._conn.execute(
                """
                UPDATE entities
                SET cloud_id = COALESCE(?, cloud_id), base_version = ?, version = ?,
                    payload = ?, deleted = ?, updated_at = ?
                WHERE entity_type = ? AND local_id = ?
                """,
                (cloud_id, new_base_version, new_base_version, resolved_payload_json,
                 1 if deleted else 0, cls._now(), entity_type, local_id),
            )
        else:
            # Push-confirmation: local content was accepted as-is by the cloud.
            # Collapse version to base_version too (not just base_version alone) —
            # otherwise a local `version` counter left ahead of a freshly-bumped
            # `base_version` (borrowed from the cloud's own counter) would make the
            # *next* local edit's `version > base_version` dirty-check silently wrong.
            cls._conn.execute(
                """
                UPDATE entities
                SET cloud_id = COALESCE(?, cloud_id), base_version = ?, version = ?,
                    deleted = ?, updated_at = ?
                WHERE entity_type = ? AND local_id = ?
                """,
                (cloud_id, new_base_version, new_base_version, 1 if deleted else 0,
                 cls._now(), entity_type, local_id),
            )
        return cls.get(entity_type, local_id)

    # Device-local key/value prefs — for values that must survive on this
    # device (unlike browser localStorage, which isn't guaranteed to survive
    # an app update/reinstall) but must never sync to the cloud or other
    # collaborators (unlike the `entities` table). Intentionally has no
    # version/sync bookkeeping.
    @classmethod
    def get_pref(cls, key: str) -> Optional[str]:
        row = _dict_row(cls._conn.execute(
            "SELECT value FROM local_prefs WHERE key = ?", (key,),
        ), ["value"])
        return row["value"] if row else None

    @classmethod
    def set_pref(cls, key: str, value: str) -> None:
        cls._conn.execute(
            """
            INSERT INTO local_prefs (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, cls._now()),
        )

    @classmethod
    def delete_pref(cls, key: str) -> None:
        cls._conn.execute("DELETE FROM local_prefs WHERE key = ?", (key,))
