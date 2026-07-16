// Mirrors the backend token grammar in services/executor.py:
//   {{env.NAME}}  -> environment variable
//   {{$gen:arg}}  -> inline dynamic generator token
//   {{name}}      -> request input (what this scanner collects)
const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export interface ScannableRequestFields {
  url: string;
  headers: { key: string; value: string }[];
  queryParams: { key: string; value: string }[];
  body: string;
  authType: string;
  authConfig: { token?: string; key?: string; value?: string };
}

const collectTokens = (text: string | undefined, names: string[], seen: Set<string>) => {
  if (!text) return;
  for (const match of text.matchAll(TOKEN_RE)) {
    const name = match[1].trim();
    if (!name || name.startsWith("$") || name.startsWith("env.")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
};

// Returns bare {{name}} input tokens across all interpolated request fields,
// deduped in first-seen order.
export const scanInputNames = (fields: ScannableRequestFields): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();

  collectTokens(fields.url, names, seen);
  for (const h of fields.headers) collectTokens(h.value, names, seen);
  for (const p of fields.queryParams) collectTokens(p.value, names, seen);
  collectTokens(fields.body, names, seen);

  const authType = (fields.authType || "").toUpperCase();
  if (authType === "BEARER") {
    collectTokens(fields.authConfig?.token, names, seen);
  } else if (authType === "API_KEY") {
    collectTokens(fields.authConfig?.key, names, seen);
    collectTokens(fields.authConfig?.value, names, seen);
  }

  return names;
};

const collectEnvTokens = (text: string | undefined, names: string[], seen: Set<string>) => {
  if (!text) return;
  for (const match of text.matchAll(TOKEN_RE)) {
    const raw = match[1].trim();
    if (!raw.startsWith("env.")) continue;
    const name = raw.slice(4).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
};

// Returns the environment-variable names referenced as {{env.NAME}} across
// all interpolated request fields, deduped in first-seen order.
export const scanEnvNames = (fields: ScannableRequestFields): string[] => {
  const names: string[] = [];
  const seen = new Set<string>();

  collectEnvTokens(fields.url, names, seen);
  for (const h of fields.headers) collectEnvTokens(h.value, names, seen);
  for (const p of fields.queryParams) collectEnvTokens(p.value, names, seen);
  collectEnvTokens(fields.body, names, seen);

  const authType = (fields.authType || "").toUpperCase();
  if (authType === "BEARER") {
    collectEnvTokens(fields.authConfig?.token, names, seen);
  } else if (authType === "API_KEY") {
    collectEnvTokens(fields.authConfig?.key, names, seen);
    collectEnvTokens(fields.authConfig?.value, names, seen);
  }

  return names;
};
