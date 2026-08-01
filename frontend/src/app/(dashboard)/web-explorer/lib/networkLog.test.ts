import { describe, it, expect } from "vitest";
import { logBaseUrl, parseLogQueryParams, suggestRequestName } from "./networkLog";

describe("logBaseUrl", () => {
  it("strips the query string", () => {
    expect(logBaseUrl("https://api.example.com/orders?limit=10&page=2")).toBe("https://api.example.com/orders");
  });

  it("returns the url unchanged when there is no query", () => {
    expect(logBaseUrl("https://api.example.com/orders")).toBe("https://api.example.com/orders");
  });
});

describe("parseLogQueryParams", () => {
  it("parses query params into key/value rows", () => {
    expect(parseLogQueryParams("https://api.example.com/orders?limit=10&status=active")).toEqual([
      { key: "limit", value: "10" },
      { key: "status", value: "active" },
    ]);
  });

  it("returns an empty list for a url without params", () => {
    expect(parseLogQueryParams("https://api.example.com/orders")).toEqual([]);
  });

  it("returns an empty list for an unparseable url", () => {
    expect(parseLogQueryParams("not a url")).toEqual([]);
  });

  it("decodes url-encoded values", () => {
    expect(parseLogQueryParams("https://x.co/a?q=hello%20world")).toEqual([{ key: "q", value: "hello world" }]);
  });
});

describe("suggestRequestName", () => {
  it("uses the last path segment", () => {
    expect(suggestRequestName("https://api.example.com/sg/order-search/search?x=1")).toBe("search");
  });

  it("ignores a trailing slash", () => {
    expect(suggestRequestName("https://api.example.com/orders/")).toBe("orders");
  });

  it("falls back for a bare origin", () => {
    expect(suggestRequestName("https://api.example.com/")).toBe("API Request");
  });

  it("falls back for an unparseable url", () => {
    expect(suggestRequestName("not a url")).toBe("API Request");
  });
});
