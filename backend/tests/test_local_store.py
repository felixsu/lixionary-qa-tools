"""Tests for LocalStore behaviour that only shows up against a real DB file:
the account-switch cache wipe and the pref bookkeeping that hangs off it.
"""

import os
import tempfile
from contextlib import contextmanager


@contextmanager
def temp_store():
    """LocalStore backed by a throwaway DB file, restored on exit."""
    import db.local_store as ls

    original_conn = ls.LocalStore._conn
    original_db_path = ls.DB_PATH
    tmpdir = tempfile.mkdtemp()
    ls.DB_PATH = os.path.join(tmpdir, "test-local.db")
    ls.LocalStore._conn = None
    try:
        ls.LocalStore.connect()
        yield ls.LocalStore
    finally:
        if ls.LocalStore._conn is not None:
            ls.LocalStore._conn.close()
        ls.LocalStore._conn = original_conn
        ls.DB_PATH = original_db_path


def test_delete_prefs_with_prefix_escapes_wildcards():
    with temp_store() as store:
        store.set_pref("auth_override:r1", "a")
        store.set_pref("auth_override:r2", "b")
        # '_' is a LIKE wildcard: unescaped, this key would be swept away too.
        store.set_pref("authXoverride:r3", "c")
        store.set_pref("llm_settings", "keep")

        assert store.delete_prefs_with_prefix("auth_override:") == 2
        assert store.get_pref("auth_override:r1") is None
        assert store.get_pref("authXoverride:r3") == "c"
        assert store.get_pref("llm_settings") == "keep"


def test_account_switch_clears_prefs_that_reference_entities():
    with temp_store() as store:
        store.set_active_user("user-a")
        store.create_synced("auth_function", '{"name": "Login"}', cloud_id="cloud-login", version=1)
        store.set_pref("auth_override:r1", '{"authType":"HOOK"}')
        store.set_pref("outputs_override:r1", '{"outputs":["token"]}')
        store.set_pref("description_override:r1", "notes")
        store.set_pref("llm_settings", '{"activeProvider":"claude"}')

        # Same user again: nothing is a switch, so nothing is touched.
        assert store.set_active_user("user-a") is False
        assert store.get_pref("auth_override:r1") is not None
        assert len(store.list("auth_function")) == 1

        # A genuine switch wipes the entity cache — and must take the prefs that
        # point into it, or they dangle at the new account's fresh local ids.
        assert store.set_active_user("user-b") is True
        assert store.list("auth_function") == []
        assert store.get_pref("auth_override:r1") is None
        assert store.get_pref("outputs_override:r1") is None
        assert store.get_pref("description_override:r1") is None
        # Device-wide settings are not per-account and must survive.
        assert store.get_pref("llm_settings") == '{"activeProvider":"claude"}'
