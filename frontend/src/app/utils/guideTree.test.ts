import { describe, expect, it } from "vitest";
import type { UserGuideSummary } from "../context/AppContext";
import { getAncestorIds, isVisibleUnderExpansion, filterGuidesByQuery } from "./guideTree";

function guide(id: string, overrides: Partial<UserGuideSummary> = {}): UserGuideSummary {
  return { id, title: id, description: "", blockCount: 0, ...overrides };
}

function byId(guides: UserGuideSummary[]) {
  return new Map(guides.map((g) => [g.id, g]));
}

describe("getAncestorIds", () => {
  const chain = byId([
    guide("root"),
    guide("mid", { parentId: "root" }),
    guide("leaf", { parentId: "mid" }),
  ]);

  it("returns the full chain nearest-parent first", () => {
    expect(getAncestorIds("leaf", chain)).toEqual(["mid", "root"]);
  });

  it("returns [] for roots, unknown ids, and null", () => {
    expect(getAncestorIds("root", chain)).toEqual([]);
    expect(getAncestorIds("missing", chain)).toEqual([]);
    expect(getAncestorIds(null, chain)).toEqual([]);
  });

  it("stops at a parent missing from the list", () => {
    const orphaned = byId([guide("a", { parentId: "gone" }), guide("b", { parentId: "a" })]);
    expect(getAncestorIds("b", orphaned)).toEqual(["a"]);
  });

  it("terminates on cyclic legacy data", () => {
    const cyclic = byId([
      guide("x", { parentId: "y" }),
      guide("y", { parentId: "x" }),
      guide("child", { parentId: "x" }),
    ]);
    expect(getAncestorIds("child", cyclic)).toEqual(["x", "y"]);
  });
});

describe("isVisibleUnderExpansion", () => {
  const guides = [
    guide("root"),
    guide("mid", { parentId: "root" }),
    guide("leaf", { parentId: "mid" }),
  ];
  const map = byId(guides);

  it("always shows roots", () => {
    expect(isVisibleUnderExpansion(guides[0], map, new Set())).toBe(true);
  });

  it("hides descendants until every ancestor is expanded", () => {
    expect(isVisibleUnderExpansion(guides[1], map, new Set())).toBe(false);
    expect(isVisibleUnderExpansion(guides[2], map, new Set(["root"]))).toBe(false);
    expect(isVisibleUnderExpansion(guides[2], map, new Set(["root", "mid"]))).toBe(true);
  });

  it("treats a missing parent as a root", () => {
    const orphan = guide("o", { parentId: "gone" });
    expect(isVisibleUnderExpansion(orphan, byId([orphan]), new Set())).toBe(true);
  });

  it("terminates on cyclic legacy data", () => {
    const cyclic = [guide("x", { parentId: "y" }), guide("y", { parentId: "x" })];
    expect(isVisibleUnderExpansion(cyclic[0], byId(cyclic), new Set(["x", "y"]))).toBe(true);
  });
});

describe("filterGuidesByQuery", () => {
  const guides = [
    guide("a", { title: "Getting Started", description: "First steps in the app" }),
    guide("b", { title: "API Explorer", description: "Send requests" }),
    guide("c", { title: "Environments", description: "Manage API hosts" }),
  ];

  it("matches titles case-insensitively", () => {
    expect(filterGuidesByQuery(guides, "getting").map((g) => g.id)).toEqual(["a"]);
    expect(filterGuidesByQuery(guides, "API EX").map((g) => g.id)).toEqual(["b"]);
  });

  it("matches descriptions too", () => {
    expect(filterGuidesByQuery(guides, "hosts").map((g) => g.id)).toEqual(["c"]);
    expect(filterGuidesByQuery(guides, "api").map((g) => g.id)).toEqual(["b", "c"]);
  });

  it("returns everything for empty or whitespace queries", () => {
    expect(filterGuidesByQuery(guides, "")).toEqual(guides);
    expect(filterGuidesByQuery(guides, "   ")).toEqual(guides);
  });

  it("returns [] when nothing matches", () => {
    expect(filterGuidesByQuery(guides, "zzz")).toEqual([]);
  });
});
