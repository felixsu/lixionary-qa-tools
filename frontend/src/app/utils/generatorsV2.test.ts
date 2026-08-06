// Grammar tests for the Studio-side generator evaluator. The backend twin
// (_resolve_dynamic_token in services/executor.py) is asserted against the same
// cases in backend/tests/test_flow_runner_v2.py — change these together.

import { describe, expect, it } from "vitest";
import { isKnownGeneratorToken, resolveGeneratorToken } from "./generatorsV2";

// A fixed instant so date assertions are exact rather than approximate.
const NOW = new Date(Date.UTC(2026, 7, 6, 14, 30, 45)); // 2026-08-06T14:30:45Z
const at = (token: string) => resolveGeneratorToken(token, { now: NOW });

describe("$date", () => {
  it("defaults to YYYY-MM-DD in UTC", () => {
    expect(at("$date")).toBe("2026-08-06");
  });

  it("accepts a bare format string", () => {
    expect(at("$date:YYYY-MM-DD HH:mm:ss")).toBe("2026-08-06 14:30:45");
    expect(at("$date:DD/MM/YY")).toBe("06/08/26");
  });

  it("applies a signed offset, keeping the default format", () => {
    expect(at("$date:+1d")).toBe("2026-08-07");
    expect(at("$date:-7d")).toBe("2026-07-30");
  });

  it("applies an offset chain before formatting", () => {
    expect(at("$date:+1d-2h:YYYY-MM-DD HH:mm")).toBe("2026-08-07 12:30");
  });

  it("emits epoch seconds and milliseconds, offset included", () => {
    expect(at("$date:epoch")).toBe("1786026645");
    expect(at("$date:epochms")).toBe("1786026645000");
    expect(at("$date:+1d:epoch")).toBe(String(1786026645 + 86400));
  });

  it("substitutes each token exactly once, never re-reading its own output", () => {
    // A naive sequential replace could rewrite the "06" a previous token wrote.
    expect(at("$date:YYYYMMDDHHmmss")).toBe("20260806143045");
  });

  it("passes literal characters through", () => {
    expect(at("$date:[on] YYYY")).toBe("[on] 2026");
  });
});

describe("$randomInt", () => {
  it("defaults to 0-999", () => {
    const v = Number(at("$randomInt"));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(999);
  });

  it("produces the requested digit count with no leading zero", () => {
    for (let i = 0; i < 40; i += 1) expect(at("$randomInt:4")).toMatch(/^[1-9]\d{3}$/);
    for (let i = 0; i < 20; i += 1) expect(at("$randomInt:1")).toMatch(/^\d$/);
  });

  it("honours an inclusive range, including negatives", () => {
    for (let i = 0; i < 40; i += 1) {
      const v = Number(at("$randomInt:5:7"));
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(7);
    }
    expect(Number(at("$randomInt:-3:-3"))).toBe(-3);
  });

  it("rejects malformed arguments rather than guessing", () => {
    expect(at("$randomInt:abc")).toBeNull();
    expect(at("$randomInt:0")).toBeNull();
    expect(at("$randomInt:9:2")).toBeNull(); // inverted range
    expect(at("$randomInt:1:2:3")).toBeNull();
  });
});

describe("names and emails", () => {
  it("builds an email from a name pair, defaulting the domain", () => {
    expect(at("$randomEmail")).toMatch(/^[a-z]+\.[a-z]+\d{1,3}@example\.com$/);
    expect(at("$randomEmail:lixionary.test")).toMatch(/^[a-z]+\.[a-z]+\d{1,3}@lixionary\.test$/);
  });

  it("returns single and full names", () => {
    expect(at("$randomFirstName")).toMatch(/^[A-Z][a-z]+$/);
    expect(at("$randomLastName")).toMatch(/^[A-Z][a-z]+$/);
    expect(at("$randomFullName")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});

describe("location", () => {
  it("reads the picked point", () => {
    const ctx = { geoPoint: { lat: 1.29, lng: 103.85 }, now: NOW };
    expect(resolveGeneratorToken("$latitude", ctx)).toBe("1.29");
    expect(resolveGeneratorToken("$longitude", ctx)).toBe("103.85");
  });

  it("resolves to nothing when no point was ever picked", () => {
    expect(at("$latitude")).toBeNull();
    expect(resolveGeneratorToken("$longitude", { geoPoint: null })).toBeNull();
  });
});

describe("unknown tokens", () => {
  it("resolve to null so the caller can leave the text untouched", () => {
    expect(at("$nope")).toBeNull();
    expect(at("notAToken")).toBeNull();
    expect(at("")).toBeNull();
  });

  it("are case-insensitive on the generator name", () => {
    expect(at("$RANDOMfirstNAME")).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe("isKnownGeneratorToken", () => {
  it("accepts every catalog name, argument or not", () => {
    for (const t of ["$date", "$date:+1d:YYYY", "$randomInt:4", "$randomEmail", "$randomFullName", "$latitude"]) {
      expect(isKnownGeneratorToken(t), t).toBe(true);
    }
  });

  it("checks the name only, so a bad argument is a run-time failure", () => {
    // The editor must not reject this; the engine reports it when it runs.
    expect(isKnownGeneratorToken("$randomInt:abc")).toBe(true);
    expect(at("$randomInt:abc")).toBeNull();
  });

  it("rejects anything outside the catalog", () => {
    expect(isKnownGeneratorToken("$teleport")).toBe(false);
    expect(isKnownGeneratorToken("randomInt:4")).toBe(false);
    expect(isKnownGeneratorToken("")).toBe(false);
  });
});
