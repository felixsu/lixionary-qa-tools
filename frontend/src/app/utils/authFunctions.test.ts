import { describe, it, expect } from "vitest";
import {
  durableAuthConfig,
  durableAuthFunctionRef,
  isOrphanedAuthFunctionRef,
  resolveAuthFunctionRef,
} from "./authFunctions";

const LOGIN = { id: "local-login", cloudId: "cloud-login", name: "Login" };
const DRAFT = { id: "local-draft", cloudId: null, name: "Never synced" };
const NO_FIELD = { id: "local-bare", name: "No cloudId field" };
const FUNCS = [LOGIN, DRAFT, NO_FIELD];

describe("resolveAuthFunctionRef", () => {
  it("matches a local id", () => {
    expect(resolveAuthFunctionRef(FUNCS, "local-login")).toBe(LOGIN);
  });

  it("matches a cloud id — the form that survives a cache re-pull", () => {
    expect(resolveAuthFunctionRef(FUNCS, "cloud-login")).toBe(LOGIN);
  });

  it("matches a never-synced function, whose cloudId is null", () => {
    expect(resolveAuthFunctionRef(FUNCS, "local-draft")).toBe(DRAFT);
  });

  it("tolerates a function with no cloudId field at all", () => {
    expect(resolveAuthFunctionRef(FUNCS, "local-bare")).toBe(NO_FIELD);
  });

  it("returns null for an id that no longer exists", () => {
    expect(resolveAuthFunctionRef(FUNCS, "0c5a284e-gone")).toBeNull();
  });

  it("returns null for an unset reference rather than guessing", () => {
    expect(resolveAuthFunctionRef(FUNCS, "")).toBeNull();
    expect(resolveAuthFunctionRef(FUNCS, null)).toBeNull();
    expect(resolveAuthFunctionRef(FUNCS, undefined)).toBeNull();
  });

  it("never matches a null cloudId against a null-ish reference", () => {
    expect(resolveAuthFunctionRef([DRAFT], null)).toBeNull();
  });
});

describe("isOrphanedAuthFunctionRef", () => {
  it("is true only when a reference is set but names nothing", () => {
    expect(isOrphanedAuthFunctionRef(FUNCS, "0c5a284e-gone")).toBe(true);
    expect(isOrphanedAuthFunctionRef(FUNCS, "cloud-login")).toBe(false);
    expect(isOrphanedAuthFunctionRef(FUNCS, null)).toBe(false);
    expect(isOrphanedAuthFunctionRef([], "anything")).toBe(true);
  });
});

describe("durableAuthFunctionRef", () => {
  it("prefers the cloud id, falling back to the local id", () => {
    expect(durableAuthFunctionRef(LOGIN)).toBe("cloud-login");
    expect(durableAuthFunctionRef(DRAFT)).toBe("local-draft");
    expect(durableAuthFunctionRef(NO_FIELD)).toBe("local-bare");
  });
});

describe("durableAuthConfig", () => {
  it("rewrites a local reference to the cloud id", () => {
    const out = durableAuthConfig(FUNCS, { authFunctionId: "local-login", tokenField: "access_token" });
    expect(out).toEqual({ authFunctionId: "cloud-login", tokenField: "access_token" });
  });

  it("leaves an already-durable reference untouched (same object)", () => {
    const config = { authFunctionId: "cloud-login" };
    expect(durableAuthConfig(FUNCS, config)).toBe(config);
  });

  it("keeps the local id when the function has never synced", () => {
    expect(durableAuthConfig(FUNCS, { authFunctionId: "local-draft" }).authFunctionId).toBe("local-draft");
  });

  it("preserves a broken reference so the UI can report it", () => {
    const config = { authFunctionId: "0c5a284e-gone" };
    expect(durableAuthConfig(FUNCS, config)).toBe(config);
  });

  it("leaves an unset reference alone", () => {
    const config = { authFunctionId: null };
    expect(durableAuthConfig(FUNCS, config)).toBe(config);
  });
});
