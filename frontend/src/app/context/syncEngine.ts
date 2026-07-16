// Local-first sync engine: reconciles the sidecar's local SQLite store against
// the cloud backend for each config resource type. Read frontend/../../.claude/
// plans/unified-soaring-bentley.md for the full design (diff table, conflict
// algorithm, phasing).

export type EntityType = "environment" | "auth_function" | "browser_profile" | "collection" | "flow";

export type ApiCallFn = (path: string, options?: RequestInit) => Promise<any>;

// Fixed push order matters once collections/browser_profiles start referencing
// auth_function ids (Phase 2's FK remap) — auth functions must sync first.
// Flows sync after collections: they reference requests that live inside
// collection payloads. No id remap is needed for flows (request ids are
// stable strings embedded verbatim in the collection blob, identical on
// every device and in the cloud; flows store no collection/auth-function ids).
const SYNC_ORDER: EntityType[] = ["auth_function", "environment", "browser_profile", "collection", "flow"];

const CLOUD_PATH: Record<EntityType, string> = {
  environment: "/api/environments",
  auth_function: "/api/auth-functions",
  browser_profile: "/api/profiles",
  collection: "/api/collections",
  flow: "/api/flows",
};

interface LocalSyncRow {
  localId: string;
  cloudId: string | null;
  version: number;
  baseVersion: number;
  dirty: boolean;
  deleted: boolean;
  deviceId: string;
  updatedAt: string;
}

interface CloudSyncRow {
  id: string;
  version: number;
  updatedAt: string | null;
  lastModifiedDevice: string | null;
  deleted: boolean;
}

export interface SyncConflict {
  entityType: EntityType;
  localId: string;
  cloudId: string;
  local: { updatedAt: string; deviceId: string; version: number; payload: Record<string, any> };
  cloud: { updatedAt: string | null; deviceId: string | null; version: number; deleted: boolean; payload: Record<string, any> };
}

const LOCAL_META_KEYS = ["localId", "cloudId", "version", "baseVersion", "dirty"];
function stripLocalMeta(record: Record<string, any>): Record<string, any> {
  const out = { ...record };
  for (const k of LOCAL_META_KEYS) delete out[k];
  return out;
}

const CLOUD_META_KEYS = ["id", "ownerId", "createdAt", "updatedAt", "version", "lastModifiedDevice", "deleted"];
function stripCloudMeta(doc: Record<string, any>): Record<string, any> {
  const out = { ...doc };
  for (const k of CLOUD_META_KEYS) delete out[k];
  return out;
}

// environments/profiles reject a create with a plain-string 400 when the name
// is already taken by that owner — the only 400 either route raises on create.
function isNameCollision(e: any): boolean {
  return e?.status === 400 && typeof e?.detail === "string" && /already exists/i.test(e.detail);
}

/** Transforms a record's payload just before it's sent to the cloud (e.g.
 * resolving a foreign key that's stored locally as a local id into the real
 * cloud id the cloud side requires). Returns `null` to defer this record's
 * push to a later pass — e.g. the auth function it references hasn't synced
 * yet, so there's no cloud id to resolve to. The transform is applied only to
 * the outgoing wire payload; what's stored in the local store is untouched,
 * since a local id is this app's permanent reference for a record (it never
 * changes once assigned, even after the record syncs) — rewriting it locally
 * would break every future lookup keyed on that id. */
export type OutgoingPayloadResolver = (payload: Record<string, any>) => Record<string, any> | null;

/** Reconciles one entity type between the sidecar's local store and the cloud.
 * Returns any conflicts found (dirty locally AND moved on cloud since last sync) —
 * callers decide how to surface them. Never throws: sidecar/cloud unreachability
 * is treated as "offline," the pass is silently skipped and retried next time. */
export async function runSync(
  entityType: EntityType,
  apiCall: ApiCallFn,
  deviceId: string,
  resolveOutgoing?: OutgoingPayloadResolver
): Promise<SyncConflict[]> {
  const localPath = `/api/local-store/${entityType}`;
  const cloudPath = CLOUD_PATH[entityType];
  const conflicts: SyncConflict[] = [];
  const deviceHeaders = { "X-Device-Id": deviceId };

  let localState: LocalSyncRow[];
  let localFull: Record<string, any>[];
  let cloudState: CloudSyncRow[];
  let cloudFull: Record<string, any>[];
  try {
    [localState, localFull, cloudState, cloudFull] = await Promise.all([
      apiCall(`${localPath}/sync-state`),
      apiCall(localPath),
      apiCall(`${cloudPath}/sync-state`),
      apiCall(cloudPath),
    ]);
  } catch {
    return conflicts;
  }

  const localFullById = new Map(localFull.map((r) => [r.localId, r]));
  const cloudById = new Map(cloudState.map((c) => [c.id, c]));
  const cloudFullById = new Map(cloudFull.map((d) => [d.id, d]));

  // Pass 1: walk local rows — push never-synced creates, push dirty updates/deletes,
  // collect 409s as conflicts instead of surfacing them as generic errors.
  for (const local of localState) {
    if (!local.cloudId) {
      if (local.deleted) continue; // never-synced + deleted is hard-deleted locally, shouldn't appear here
      const payload = localFullById.get(local.localId);
      if (!payload) continue;
      const outgoing = resolveOutgoing ? resolveOutgoing(stripLocalMeta(payload)) : stripLocalMeta(payload);
      if (!outgoing) continue; // a referenced record hasn't synced yet — defer to next pass
      try {
        const created = await apiCall(cloudPath, {
          method: "POST",
          headers: deviceHeaders,
          body: JSON.stringify(outgoing),
        });
        await apiCall(`${localPath}/mark-synced`, {
          method: "POST",
          body: JSON.stringify({
            entries: [{ localId: local.localId, cloudId: created.id, newBaseVersion: created.version, deleted: false }],
          }),
        });
      } catch (e: any) {
        // Two never-synced devices independently created a same-named record —
        // the cloud's create-time uniqueness check (environment/profile) rejects
        // this with a 400. Without this, the push would fail silently forever on
        // every pass. Surface it as a conflict against the existing cloud record
        // instead — both resolveConflictKeepLocal (force-updates that record)
        // and resolveConflictKeepCloud (adopts it locally) already handle this
        // correctly with no further changes, since neither cares whether the
        // conflict came from a version mismatch or a name collision.
        if (isNameCollision(e)) {
          const existing = cloudFull.find((d) => d.name === outgoing.name);
          if (existing) {
            conflicts.push({
              entityType,
              localId: local.localId,
              cloudId: existing.id,
              local: { updatedAt: local.updatedAt, deviceId: local.deviceId, version: local.version, payload: stripLocalMeta(payload) },
              cloud: {
                updatedAt: existing.updatedAt ?? null,
                deviceId: existing.lastModifiedDevice ?? null,
                version: existing.version ?? 0,
                deleted: !!existing.deleted,
                payload: stripCloudMeta(existing),
              },
            });
            continue;
          }
        }
        console.warn(`[sync] failed to push new ${entityType}`, local.localId, e);
      }
      continue;
    }

    if (!local.dirty) continue; // handled in pass 2 (pulls) if the cloud has moved on

    const cloud = cloudById.get(local.cloudId);
    if (!cloud) continue; // cloud doesn't know this id — defer to next pass rather than guess

    if (local.deleted) {
      try {
        const result = await apiCall(`${cloudPath}/${local.cloudId}`, {
          method: "DELETE",
          headers: deviceHeaders,
        });
        await apiCall(`${localPath}/mark-synced`, {
          method: "POST",
          body: JSON.stringify({
            entries: [{ localId: local.localId, cloudId: local.cloudId, newBaseVersion: result.version, deleted: true }],
          }),
        });
      } catch (e) {
        console.warn(`[sync] failed to push delete for ${entityType}`, local.localId, e);
      }
      continue;
    }

    const payload = localFullById.get(local.localId);
    if (!payload) continue;
    const outgoing = resolveOutgoing ? resolveOutgoing(stripLocalMeta(payload)) : stripLocalMeta(payload);
    if (!outgoing) continue; // a referenced record hasn't synced yet — defer to next pass
    try {
      const updated = await apiCall(`${cloudPath}/${local.cloudId}`, {
        method: "PUT",
        headers: deviceHeaders,
        body: JSON.stringify({ ...outgoing, expected_version: local.baseVersion, force: false }),
      });
      await apiCall(`${localPath}/mark-synced`, {
        method: "POST",
        body: JSON.stringify({
          entries: [{ localId: local.localId, cloudId: local.cloudId, newBaseVersion: updated.version, deleted: false }],
        }),
      });
    } catch (e: any) {
      if (e?.status === 409 && e?.detail?.current) {
        conflicts.push({
          entityType,
          localId: local.localId,
          cloudId: local.cloudId,
          local: { updatedAt: local.updatedAt, deviceId: local.deviceId, version: local.version, payload: stripLocalMeta(payload) },
          cloud: {
            updatedAt: e.detail.current.updatedAt ?? null,
            deviceId: e.detail.current.lastModifiedDevice ?? null,
            version: e.detail.current.version ?? 0,
            deleted: !!e.detail.current.deleted,
            payload: stripCloudMeta(e.detail.current),
          },
        });
      } else {
        console.warn(`[sync] failed to push update for ${entityType}`, local.localId, e);
      }
    }
  }

  // Pass 2: walk cloud rows — pull anything this device has never seen, or that
  // moved past a clean (non-dirty) local row's last-known base version.
  const localByCloudId = new Map(localState.filter((l) => l.cloudId).map((l) => [l.cloudId as string, l]));
  const newRecordsToPull: { cloudId: string; version: number; payload: Record<string, any> }[] = [];
  const pullMarkSynced: { localId: string; cloudId: string; newBaseVersion: number; deleted: boolean; resolvedPayload?: Record<string, any> }[] = [];

  for (const cloud of cloudState) {
    const local = localByCloudId.get(cloud.id);

    if (!local) {
      if (cloud.deleted) continue; // never seen it, and it's already gone — nothing to do
      const doc = cloudFullById.get(cloud.id);
      if (!doc) continue;
      newRecordsToPull.push({ cloudId: cloud.id, version: cloud.version, payload: stripCloudMeta(doc) });
      continue;
    }

    if (local.dirty) continue; // handled in pass 1 (push or conflict)
    if (cloud.version <= local.baseVersion) continue; // already in sync

    if (cloud.deleted) {
      pullMarkSynced.push({ localId: local.localId, cloudId: cloud.id, newBaseVersion: cloud.version, deleted: true });
    } else {
      const doc = cloudFullById.get(cloud.id);
      if (!doc) continue;
      pullMarkSynced.push({
        localId: local.localId, cloudId: cloud.id, newBaseVersion: cloud.version, deleted: false,
        resolvedPayload: stripCloudMeta(doc),
      });
    }
  }

  if (newRecordsToPull.length) {
    try {
      await apiCall(`${localPath}/pull`, { method: "POST", body: JSON.stringify({ entries: newRecordsToPull }) });
    } catch (e) {
      console.warn(`[sync] failed to pull new ${entityType} records`, e);
    }
  }
  if (pullMarkSynced.length) {
    try {
      await apiCall(`${localPath}/mark-synced`, { method: "POST", body: JSON.stringify({ entries: pullMarkSynced }) });
    } catch (e) {
      console.warn(`[sync] failed to mark-synced pulled ${entityType} records`, e);
    }
  }

  return conflicts;
}

/** User picked "keep local" on a conflict: force-pushes the local content over
 * whatever's on the cloud. If the cloud side is a tombstone (the record was
 * deleted elsewhere), there's nothing to force-update — instead recreate it as
 * a brand-new cloud record (POST, whose Create schema may only accept a subset
 * of fields, e.g. a collection's `requests`/`children`) then immediately PUT
 * the full local payload over it with force so no content is dropped. */
export async function resolveConflictKeepLocal(
  conflict: SyncConflict,
  apiCall: ApiCallFn,
  deviceId: string
): Promise<void> {
  const cloudPath = CLOUD_PATH[conflict.entityType];
  const localPath = `/api/local-store/${conflict.entityType}`;
  const deviceHeaders = { "X-Device-Id": deviceId };

  let targetCloudId = conflict.cloudId;
  if (conflict.cloud.deleted) {
    const created = await apiCall(cloudPath, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify(conflict.local.payload),
    });
    targetCloudId = created.id;
  }

  const updated = await apiCall(`${cloudPath}/${targetCloudId}`, {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ ...conflict.local.payload, force: true }),
  });
  await apiCall(`${localPath}/mark-synced`, {
    method: "POST",
    body: JSON.stringify({
      entries: [{ localId: conflict.localId, cloudId: updated.id, newBaseVersion: updated.version, deleted: false }],
    }),
  });
}

/** User picked "keep cloud" on a conflict: pure local overwrite from the cloud
 * content already captured in the conflict record — no cloud call needed. */
export async function resolveConflictKeepCloud(
  conflict: SyncConflict,
  apiCall: ApiCallFn
): Promise<void> {
  const localPath = `/api/local-store/${conflict.entityType}`;
  await apiCall(`${localPath}/mark-synced`, {
    method: "POST",
    body: JSON.stringify({
      entries: [{
        localId: conflict.localId,
        cloudId: conflict.cloudId,
        newBaseVersion: conflict.cloud.version,
        deleted: conflict.cloud.deleted,
        ...(conflict.cloud.deleted ? {} : { resolvedPayload: conflict.cloud.payload }),
      }],
    }),
  });
}

/** A local id is this app's permanent reference for a record (an `AuthFunction`'s
 * `.id` never changes, even after it syncs and gets a `cloudId`), so any
 * `authFunctionId` field elsewhere may hold either form depending on how it
 * got there: a local id if set via this device's own UI, or a cloud id if
 * pulled down from a record another device/user wrote. Resolver checks both. */
function buildAuthFunctionCloudIdResolver(authFunctionRecords: Record<string, any>[]) {
  return (id: string | null | undefined): string | null => {
    if (!id) return null;
    const match = authFunctionRecords.find((r) => r.localId === id || r.cloudId === id);
    return match?.cloudId || null;
  };
}

/** browser_profile's outgoing-payload resolver: rewrites a top-level
 * `authFunctionId` to its cloud id, or defers the push if unresolved. */
function resolveBrowserProfileOutgoing(
  resolveAuthFunctionId: (id: string | null | undefined) => string | null
): OutgoingPayloadResolver {
  return (payload) => {
    if (!payload.authFunctionId) return payload;
    const cloudId = resolveAuthFunctionId(payload.authFunctionId);
    return cloudId ? { ...payload, authFunctionId: cloudId } : null;
  };
}

/** collection's outgoing-payload resolver: walks `requests[]` recursively
 * through `children[]` (mirroring the cloud's own `process_collection_tree`/
 * `serialize_collection_node` shape) rewriting each request's
 * `authConfig.authFunctionId` to its cloud id. Defers the whole collection's
 * push if any reference in the tree is unresolved — a partial push would
 * either fail cloud-side ObjectId parsing or silently drop the reference. */
function resolveCollectionOutgoing(
  resolveAuthFunctionId: (id: string | null | undefined) => string | null
): OutgoingPayloadResolver {
  let unresolved = false;
  const walk = (node: Record<string, any>): Record<string, any> => {
    const requests = (node.requests || []).map((req: any) => {
      const authFunctionId = req.authConfig?.authFunctionId;
      if (!authFunctionId) return req;
      const cloudId = resolveAuthFunctionId(authFunctionId);
      if (!cloudId) {
        unresolved = true;
        return req;
      }
      return { ...req, authConfig: { ...req.authConfig, authFunctionId: cloudId } };
    });
    const children = (node.children || []).map(walk);
    return { ...node, requests, children };
  };
  return (payload) => {
    unresolved = false;
    const resolved = walk(payload);
    return unresolved ? null : resolved;
  };
}

/** Runs runSync for each requested entity type in the fixed FK-safe order.
 * Before browser_profile/collection sync, fetches the current auth_function
 * local store to resolve authFunctionId references in their outgoing push
 * payloads (see OutgoingPayloadResolver) — auth functions always sync first
 * so this resolver has the freshest possible cloud ids available. */
export async function runAllSync(
  apiCall: ApiCallFn,
  deviceId: string,
  entityTypes: EntityType[] = SYNC_ORDER
): Promise<SyncConflict[]> {
  const orderedTypes = SYNC_ORDER.filter((t) => entityTypes.includes(t));
  const allConflicts: SyncConflict[] = [];

  for (const type of orderedTypes) {
    let resolveOutgoing: OutgoingPayloadResolver | undefined;
    if (type === "browser_profile" || type === "collection") {
      const authFunctionRecords = await apiCall("/api/local-store/auth_function").catch(() => []);
      const resolveAuthFunctionId = buildAuthFunctionCloudIdResolver(authFunctionRecords);
      resolveOutgoing = type === "browser_profile"
        ? resolveBrowserProfileOutgoing(resolveAuthFunctionId)
        : resolveCollectionOutgoing(resolveAuthFunctionId);
    }

    allConflicts.push(...(await runSync(type, apiCall, deviceId, resolveOutgoing)));
  }
  return allConflicts;
}
