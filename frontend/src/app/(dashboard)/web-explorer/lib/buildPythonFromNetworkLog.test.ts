import { describe, it, expect } from "vitest";
import { buildPythonFromNetworkLog } from "./buildPythonFromNetworkLog";
import type { NetworkLog, NetworkDetails } from "../../../context/WebExplorerContext";

const baseLog = (over: Partial<NetworkLog> = {}): NetworkLog => ({
  id: "log_1",
  url: "https://api.example.com/orders",
  method: "GET",
  headers: { Authorization: "Bearer token123" },
  resourceType: "xhr",
  status: 200,
  statusText: "OK",
  ...over,
});

const details = (over: Partial<NetworkDetails["request"]> = {}, body: unknown = undefined): NetworkDetails => ({
  request: {
    url: "https://api.example.com/orders",
    method: "GET",
    headers: { Authorization: "Bearer token123" },
    resourceType: "xhr",
    ...over,
  },
  response:
    body === undefined
      ? null
      : {
          url: "https://api.example.com/orders",
          status: 200,
          statusText: "OK",
          headers: {},
          body,
        },
});

describe("buildPythonFromNetworkLog", () => {
  it("generates a bodyless GET from the bare log when details are missing", () => {
    const code = buildPythonFromNetworkLog(baseLog(), null);
    expect(code).toContain('url = "https://api.example.com/orders"');
    expect(code).toContain('"Authorization": "Bearer token123",');
    expect(code).toContain("response = requests.get(url, headers=headers)");
    expect(code).toContain("def call_api() -> dict:");
    expect(code).toContain("return response.json()");
    expect(code).not.toContain("class RequestBody");
  });

  it("builds a pydantic RequestBody from a JSON post body", () => {
    const d = details({
      method: "POST",
      postData: JSON.stringify({ name: "widget", count: 2, ratio: 1.5 }),
    });
    const code = buildPythonFromNetworkLog(baseLog({ method: "POST" }), d);
    expect(code).toContain("class RequestBody(BaseModel):");
    expect(code).toContain("    name: str");
    expect(code).toContain("    count: int");
    expect(code).toContain("    ratio: float");
    expect(code).toContain("payload = RequestBody(");
    expect(code).toContain('        name="widget",');
    expect(code).toContain("json=payload.model_dump(),");
    expect(code).toContain("response = requests.post(");
  });

  it("emits a nested sub-model for object-valued fields", () => {
    const d = details({
      method: "POST",
      postData: JSON.stringify({ meta: { source: "web" } }),
    });
    const code = buildPythonFromNetworkLog(baseLog({ method: "POST" }), d);
    expect(code).toContain("class RequestBodyMeta(BaseModel):");
    expect(code).toContain("    source: str");
    expect(code).toContain("    meta: RequestBodyMeta");
  });

  it("falls back to a raw data= body for non-JSON post data", () => {
    const d = details({ method: "POST", postData: "a=1&b=2" });
    const code = buildPythonFromNetworkLog(baseLog({ method: "POST" }), d);
    expect(code).not.toContain("class RequestBody");
    expect(code).toContain('data="a=1&b=2",');
  });

  it("types an object response as ResponseBody and validates it", () => {
    const d = details({}, JSON.stringify({ id: 7, label: "x" }));
    const code = buildPythonFromNetworkLog(baseLog(), d);
    expect(code).toContain("class ResponseBody(BaseModel):");
    expect(code).toContain("    id: int");
    expect(code).toContain("def call_api() -> ResponseBody:");
    expect(code).toContain("return ResponseBody(**response.json())");
  });

  it("types an object-array response as List[ResponseItem]", () => {
    const d = details({}, JSON.stringify([{ id: 1 }, { id: 2 }]));
    const code = buildPythonFromNetworkLog(baseLog(), d);
    expect(code).toContain("class ResponseItem(BaseModel):");
    expect(code).toContain("def call_api() -> List[ResponseItem]:");
    expect(code).toContain("return response.json()  # List[ResponseItem]");
  });

  it("ignores a non-JSON response body", () => {
    const d = details({}, "<html>hello</html>");
    const code = buildPythonFromNetworkLog(baseLog(), d);
    expect(code).not.toContain("class ResponseBody");
    expect(code).toContain("def call_api() -> dict:");
  });

  it("marks null fields as Optional[Any]", () => {
    const d = details({ method: "POST", postData: JSON.stringify({ note: null }) });
    const code = buildPythonFromNetworkLog(baseLog({ method: "POST" }), d);
    expect(code).toContain("    note: Optional[Any]");
  });
});
