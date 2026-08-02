// Single source of truth for the workspace scaffold filenames and the
// read-only/protected rules the sidecar enforces (see backend
// local_sidecar.py: save rejects the generated POM modules, delete rejects
// every scaffold file). Keep in sync with the backend workspace policy.
//
// Layout: builder/ holds hand-maintained scripts plus the generated POM
// modules; recording/ holds the auto-generated replay script. Scripts run
// with cwd set to their own folder, so imports are sibling-relative.

export const BUILDER_PREFIX = "builder/";
export const RECORDING_PREFIX = "recording/";
export const MAIN_FILE = `${BUILDER_PREFIX}main.py`;
export const PLAYGROUND_FILE = `${BUILDER_PREFIX}playground.py`;
export const MY_PAGE_FILE = `${BUILDER_PREFIX}my_page.py`;
export const MY_CLIENT_FILE = `${BUILDER_PREFIX}my_client.py`;
export const RECORDING_FILE = `${RECORDING_PREFIX}main.py`;

/** Files the editor must not modify (sidecar rejects writes). */
export const isReadOnlyFile = (name: string) =>
  name === MY_PAGE_FILE || name === MY_CLIENT_FILE;

/** Scaffold files that must keep existing (no delete button). */
export const isProtectedFile = (name: string) =>
  name === MAIN_FILE || name === PLAYGROUND_FILE || name === RECORDING_FILE || isReadOnlyFile(name);
