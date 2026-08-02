import { describe, it, expect } from "vitest";
import {
  MAIN_FILE,
  PLAYGROUND_FILE,
  RECORDING_FILE,
  BUILDER_PREFIX,
  RECORDING_PREFIX,
  MY_PAGE_FILE,
  MY_CLIENT_FILE,
  isReadOnlyFile,
  isProtectedFile,
} from "./workspaceFiles";

describe("workspaceFiles policy", () => {
  it("derives the scaffold paths from the folder prefixes", () => {
    expect(MAIN_FILE).toBe("builder/main.py");
    expect(PLAYGROUND_FILE).toBe("builder/playground.py");
    expect(MY_PAGE_FILE).toBe("builder/my_page.py");
    expect(MY_CLIENT_FILE).toBe("builder/my_client.py");
    expect(RECORDING_FILE).toBe("recording/main.py");
    expect(MY_PAGE_FILE.startsWith(BUILDER_PREFIX)).toBe(true);
    expect(RECORDING_FILE.startsWith(RECORDING_PREFIX)).toBe(true);
  });

  it("marks only the generated POM modules as read-only", () => {
    expect(isReadOnlyFile(MY_PAGE_FILE)).toBe(true);
    expect(isReadOnlyFile(MY_CLIENT_FILE)).toBe(true);
    expect(isReadOnlyFile(MAIN_FILE)).toBe(false);
    expect(isReadOnlyFile(PLAYGROUND_FILE)).toBe(false);
    expect(isReadOnlyFile(RECORDING_FILE)).toBe(false);
    expect(isReadOnlyFile(`${BUILDER_PREFIX}custom_module.py`)).toBe(false);
    // Read-only means the full path, not the basename
    expect(isReadOnlyFile("my_page.py")).toBe(false);
  });

  it("protects the scaffold files from deletion, but not user modules", () => {
    expect(isProtectedFile(MAIN_FILE)).toBe(true);
    expect(isProtectedFile(PLAYGROUND_FILE)).toBe(true);
    expect(isProtectedFile(MY_PAGE_FILE)).toBe(true);
    expect(isProtectedFile(MY_CLIENT_FILE)).toBe(true);
    expect(isProtectedFile(RECORDING_FILE)).toBe(true);
    expect(isProtectedFile(`${BUILDER_PREFIX}custom_module.py`)).toBe(false);
  });
});
