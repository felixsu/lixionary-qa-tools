import { describe, it, expect } from "vitest";
import {
  MAIN_FILE,
  PLAYGROUND_FILE,
  RECORDING_FILE,
  INSPECTION_PREFIX,
  MY_PAGE_FILE,
  MY_CLIENT_FILE,
  isReadOnlyFile,
  isProtectedFile,
} from "./workspaceFiles";

describe("workspaceFiles policy", () => {
  it("derives the scaffold paths from the inspection prefix", () => {
    expect(MY_PAGE_FILE).toBe("inspection_code/my_page.py");
    expect(MY_CLIENT_FILE).toBe("inspection_code/my_client.py");
    expect(MY_PAGE_FILE.startsWith(INSPECTION_PREFIX)).toBe(true);
  });

  it("marks only inspection_code/ files as read-only", () => {
    expect(isReadOnlyFile(MY_PAGE_FILE)).toBe(true);
    expect(isReadOnlyFile(MY_CLIENT_FILE)).toBe(true);
    expect(isReadOnlyFile(`${INSPECTION_PREFIX}anything.py`)).toBe(true);
    expect(isReadOnlyFile(MAIN_FILE)).toBe(false);
    expect(isReadOnlyFile(PLAYGROUND_FILE)).toBe(false);
    expect(isReadOnlyFile(RECORDING_FILE)).toBe(false);
    expect(isReadOnlyFile("custom_module.py")).toBe(false);
    // Read-only means the directory prefix, not the basename
    expect(isReadOnlyFile("my_page.py")).toBe(false);
  });

  it("protects the scaffold files from deletion, but not user modules", () => {
    expect(isProtectedFile(MAIN_FILE)).toBe(true);
    expect(isProtectedFile(PLAYGROUND_FILE)).toBe(true);
    expect(isProtectedFile(MY_PAGE_FILE)).toBe(true);
    expect(isProtectedFile(MY_CLIENT_FILE)).toBe(true);
    expect(isProtectedFile(RECORDING_FILE)).toBe(false);
    expect(isProtectedFile("custom_module.py")).toBe(false);
  });
});
