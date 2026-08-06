// Resolving a stored auth-function reference.
//
// A stored `authFunctionId` may hold EITHER id form. A local id is this
// device's own reference (written when you pick a hook in the UI); a cloud id
// is what arrives on a record another device wrote, or what survives when the
// device cache is wiped and re-pulled — that wipe assigns every entity a fresh
// local id, so a local-id reference silently orphans while the cloud id keeps
// pointing at the same function. See buildAuthFunctionCloudIdResolver in
// context/syncEngine.ts and get_by_local_or_cloud_id in backend/db/local_store.py,
// which both already accept either form.

export interface AuthFunctionRef {
  id: string;
  cloudId?: string | null;
  name?: string;
}

/** The auth function a stored reference points at, matching either id form,
 * or null when it no longer exists (the reference has been orphaned). */
export const resolveAuthFunctionRef = <T extends AuthFunctionRef>(
  authFunctions: T[],
  ref: string | null | undefined
): T | null => {
  if (!ref) return null;
  return authFunctions.find((f) => f.id === ref || (!!f.cloudId && f.cloudId === ref)) || null;
};

/** True when a reference is set but names no known auth function — the request
 * looks configured yet cannot authenticate, so it deserves surfacing. */
export const isOrphanedAuthFunctionRef = (
  authFunctions: AuthFunctionRef[],
  ref: string | null | undefined
): boolean => !!ref && resolveAuthFunctionRef(authFunctions, ref) === null;

/** The most durable id to persist for a function: its cloud id once it has
 * one, since local ids are regenerated whenever the device cache is re-pulled. */
export const durableAuthFunctionRef = (fn: AuthFunctionRef): string => fn.cloudId || fn.id;

/** An auth config rewritten to reference its hook by the most durable id
 * available, for storing in the device-local `auth_override:<requestId>` pref.
 * A reference that resolves to nothing is left as-is: it is already broken, and
 * preserving it is what lets the UI say so instead of silently blanking. */
export const durableAuthConfig = <C extends { authFunctionId?: string | null }>(
  authFunctions: AuthFunctionRef[],
  config: C
): C => {
  const linked = resolveAuthFunctionRef(authFunctions, config.authFunctionId);
  if (!linked) return config;
  const durable = durableAuthFunctionRef(linked);
  return durable === config.authFunctionId ? config : { ...config, authFunctionId: durable };
};
