import type { NetworkLog, NetworkDetails } from "../../../context/WebExplorerContext";

/**
 * Generates a standalone Python script (requests + pydantic models inferred
 * from the captured request/response JSON) for one network-log entry.
 */
export const buildPythonFromNetworkLog = (log: NetworkLog, details: NetworkDetails | null): string => {
  const extraModels: string[] = [];

  const toClassName = (name: string) =>
    name.replace(/[^a-zA-Z0-9]/g, "_").replace(/^[0-9]/, "_$&")
        .split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

  const pyType = (v: any, nameHint: string): string => {
    if (v === null) return "Optional[Any]";
    if (typeof v === "boolean") return "bool";
    if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
    if (typeof v === "string") return "str";
    if (Array.isArray(v)) {
      if (v.length > 0 && v[0] !== null && typeof v[0] === "object" && !Array.isArray(v[0])) {
        const modelName = toClassName(nameHint) + "Item";
        extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v[0], modelName)}`);
        return `List[${modelName}]`;
      }
      return "List[Any]";
    }
    if (typeof v === "object") {
      const modelName = toClassName(nameHint);
      extraModels.push(`class ${modelName}(BaseModel):\n${modelFields(v, modelName)}`);
      return modelName;
    }
    return "Any";
  };

  const modelFields = (obj: Record<string, any>, parentName: string): string =>
    Object.entries(obj)
      .map(([k, v]) => `    ${k}: ${pyType(v, parentName + "_" + k)}`)
      .join("\n") || "    pass";

  const url = details?.request.url ?? log.url;
  const method = (details?.request.method ?? log.method).toLowerCase();
  const headers = details?.request.headers ?? log.headers ?? {};

  const postData = details?.request.postData;
  let requestBodyObj: Record<string, any> | null = null;
  if (postData) {
    try {
      const parsed = JSON.parse(postData);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) requestBodyObj = parsed;
    } catch { /* not JSON — sent as raw body below */ }
  }
  const hasRequestModel = !!requestBodyObj;

  const rawResponseBody = details?.response?.body;
  let responseBodyObj: any = null;
  if (rawResponseBody !== undefined && rawResponseBody !== null) {
    if (typeof rawResponseBody === "string") {
      try { responseBodyObj = JSON.parse(rawResponseBody); } catch { responseBodyObj = null; }
    } else {
      responseBodyObj = rawResponseBody;
    }
  }

  let responseModelName = "";
  let responseModelBlock = "";
  if (responseBodyObj !== null) {
    if (Array.isArray(responseBodyObj) && responseBodyObj.length > 0 &&
        typeof responseBodyObj[0] === "object" && responseBodyObj[0] !== null && !Array.isArray(responseBodyObj[0])) {
      responseModelName = "List[ResponseItem]";
      responseModelBlock = `class ResponseItem(BaseModel):\n${modelFields(responseBodyObj[0], "ResponseItem")}`;
    } else if (typeof responseBodyObj === "object" && !Array.isArray(responseBodyObj)) {
      responseModelName = "ResponseBody";
      responseModelBlock = `class ResponseBody(BaseModel):\n${modelFields(responseBodyObj, "ResponseBody")}`;
    }
  }

  const requestModelBlock = hasRequestModel
    ? `class RequestBody(BaseModel):\n${modelFields(requestBodyObj!, "RequestBody")}`
    : "";

  const lines: string[] = [];
  lines.push("from __future__ import annotations");
  lines.push("import requests");
  lines.push("from pydantic import BaseModel");
  lines.push("from typing import Any, Dict, List, Optional");

  for (const m of extraModels) {
    lines.push("");
    lines.push(m);
  }

  if (requestModelBlock) {
    lines.push("");
    lines.push(requestModelBlock);
  }

  if (responseModelBlock) {
    lines.push("");
    lines.push(responseModelBlock);
  }

  const returnType = responseModelName || "dict";
  lines.push("");
  lines.push("");
  lines.push(`def call_api() -> ${returnType}:`);
  lines.push(`    url = "${url}"`);

  const headerEntries = Object.entries(headers).filter(([k]) => k !== "");
  if (headerEntries.length) {
    lines.push("    headers = {");
    headerEntries.forEach(([k, v]) => {
      lines.push(`        "${k}": "${v}",`);
    });
    lines.push("    }");
  } else {
    lines.push("    headers = {}");
  }

  if (hasRequestModel) {
    // Python literal, not JSON.stringify — JS emits true/false/null which are
    // invalid Python (True/False/None), inside nested values too.
    const pyLiteral = (v: any): string => {
      if (v === null || v === undefined) return "None";
      if (typeof v === "boolean") return v ? "True" : "False";
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "number") return String(v);
      if (Array.isArray(v)) return `[${v.map(pyLiteral).join(", ")}]`;
      return `{${Object.entries(v).map(([key, val]) => `${JSON.stringify(key)}: ${pyLiteral(val)}`).join(", ")}}`;
    };
    const fieldInits = Object.entries(requestBodyObj!).map(([k, v]) => {
      return `        ${k}=${pyLiteral(v)},`;
    }).join("\n");
    lines.push("    payload = RequestBody(");
    lines.push(fieldInits);
    lines.push("    )");
  }

  const hasBody = !!postData;
  if (hasBody) {
    lines.push(`    response = requests.${method}(`);
    lines.push("        url,");
    lines.push("        headers=headers,");
    if (hasRequestModel) {
      lines.push("        json=payload.model_dump(),");
    } else {
      lines.push(`        data=${JSON.stringify(postData)},`);
    }
    lines.push("    )");
  } else {
    lines.push(`    response = requests.${method}(url, headers=headers)`);
  }

  lines.push("    response.raise_for_status()");
  if (responseModelName === "ResponseBody") {
    lines.push("    return ResponseBody(**response.json())");
  } else if (responseModelName) {
    lines.push("    return response.json()  # List[ResponseItem]");
  } else {
    lines.push("    return response.json()");
  }

  return lines.join("\n");
};
