// Single source of truth for the workspace scaffold filenames and the
// read-only/protected rules the sidecar enforces (see backend
// local_sidecar.py: save/delete reject inspection_code/*, delete rejects
// main.py). Keep in sync with the backend workspace policy.

export const MAIN_FILE = "main.py";
export const PLAYGROUND_FILE = "playground.py";
export const RECORDING_FILE = "my_recording.py";
export const INSPECTION_PREFIX = "inspection_code/";
export const MY_PAGE_FILE = `${INSPECTION_PREFIX}my_page.py`;
export const MY_CLIENT_FILE = `${INSPECTION_PREFIX}my_client.py`;

/** Files the editor must not modify (sidecar rejects writes). */
export const isReadOnlyFile = (name: string) => name.startsWith(INSPECTION_PREFIX);

/** Scaffold files that must keep existing (no delete button). */
export const isProtectedFile = (name: string) =>
  name === MAIN_FILE || name === PLAYGROUND_FILE || isReadOnlyFile(name);
