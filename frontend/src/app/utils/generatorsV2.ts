// Dynamic-token generators for the API Studio V2 engine.
//
// Twin of _resolve_dynamic_token and friends in backend/services/executor.py —
// the same arrangement as jsonPathV2.ts ↔ eval_json_path. The backend owns the
// catalog; this file exists because the TS engine evaluates a Generator block
// in the browser, before any request is dispatched. Keep the grammar identical:
//
//   $date[:<offsets>][:<format>]  offsets chain signed d/h/m/s ("+1d-2h");
//                                 format uses YYYY YY MM DD HH mm ss, or the
//                                 literals "epoch" / "epochms"
//   $randomInt[:<digits>]         1 digit → 0-9; N digits → no leading zero
//   $randomInt:<lo>:<hi>          inclusive range
//   $randomEmail[:<domain>]       defaults to example.com
//   $randomFirstName / $randomLastName / $randomFullName
//   $latitude / $longitude        from the device-wide "geo_point" pref
//
// An unrecognised or malformed token resolves to null, and the caller leaves it
// untouched — same contract as the backend, where {{$nope}} survives verbatim.

const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin",
];

// Order matters: YYYY must be replaced before YY, and mm (minutes) must not
// collide with MM (month) — the backend list is in this same order.
const DATE_FORMAT_TOKENS: [string, (d: Date) => string][] = [
  ["YYYY", (d) => String(d.getUTCFullYear()).padStart(4, "0")],
  ["YY", (d) => String(d.getUTCFullYear() % 100).padStart(2, "0")],
  ["MM", (d) => String(d.getUTCMonth() + 1).padStart(2, "0")],
  ["DD", (d) => String(d.getUTCDate()).padStart(2, "0")],
  ["HH", (d) => String(d.getUTCHours()).padStart(2, "0")],
  ["mm", (d) => String(d.getUTCMinutes()).padStart(2, "0")],
  ["ss", (d) => String(d.getUTCSeconds()).padStart(2, "0")],
];

const OFFSET_UNIT_MS: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
const OFFSET_CHAIN_RE = /^((?:[+-]\d+[dhms])+)(?::([\s\S]*))?$/;
const OFFSET_SEGMENT_RE = /([+-]\d+)([dhms])/g;

const randomInt = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (list: string[]): string => list[randomInt(0, list.length - 1)];

/** A point the user chose with the map picker, or null when they never did. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

const formatDate = (arg: string | null, now: Date): string => {
  let fmt = "YYYY-MM-DD";
  let offsetMs = 0;

  if (arg) {
    if (arg[0] === "+" || arg[0] === "-") {
      const m = OFFSET_CHAIN_RE.exec(arg);
      if (m) {
        const [, chain, restFmt] = m;
        for (const [, num, unit] of chain.matchAll(OFFSET_SEGMENT_RE)) {
          offsetMs += Number(num) * OFFSET_UNIT_MS[unit];
        }
        if (restFmt !== undefined) fmt = restFmt;
      } else {
        fmt = arg;
      }
    } else {
      fmt = arg;
    }
  }

  const dt = new Date(now.getTime() + offsetMs);

  const key = fmt.trim().toLowerCase();
  if (key === "epoch") return String(Math.floor(dt.getTime() / 1000));
  if (key === "epochms") return String(dt.getTime());

  // Replace left to right in one pass so an already-substituted digit can never
  // be re-matched by a later token (e.g. a year's "20" as a minute pattern).
  let out = "";
  let i = 0;
  outer: while (i < fmt.length) {
    for (const [token, render] of DATE_FORMAT_TOKENS) {
      if (fmt.startsWith(token, i)) {
        out += render(dt);
        i += token.length;
        continue outer;
      }
    }
    out += fmt[i];
    i += 1;
  }
  return out;
};

const generateRandomInt = (arg: string | null): string | null => {
  if (arg === null) return String(randomInt(0, 999));
  if (arg.includes(":")) {
    const parts = arg.split(":");
    if (parts.length !== 2) return null;
    const [rawLo, rawHi] = parts;
    const isInt = (s: string) => /^-?\d+$/.test(s.trim());
    if (!isInt(rawLo) || !isInt(rawHi)) return null;
    const lo = Number(rawLo);
    const hi = Number(rawHi);
    if (lo > hi) return null;
    return String(randomInt(lo, hi));
  }
  if (!/^\d+$/.test(arg) || Number(arg) < 1) return null;
  const length = Number(arg);
  if (length === 1) return String(randomInt(0, 9));
  let out = String(randomInt(1, 9));
  for (let i = 1; i < length; i += 1) out += String(randomInt(0, 9));
  return out;
};

const randomEmail = (domain: string | null): string =>
  `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${randomInt(1, 999)}@${domain || "example.com"}`;

/** Resolves a `$`-prefixed token body (no braces) to its generated value, or
 * null when the token is unrecognised or malformed — the caller then leaves the
 * original text alone, exactly as the backend does. */
export const resolveGeneratorToken = (
  tokenBody: string,
  ctx: { geoPoint?: GeoPoint | null; now?: Date } = {}
): string | null => {
  if (!tokenBody.startsWith("$")) return null;
  const body = tokenBody.slice(1);
  const sep = body.indexOf(":");
  const name = (sep === -1 ? body : body.slice(0, sep)).toLowerCase();
  const arg = sep === -1 ? null : body.slice(sep + 1);
  const now = ctx.now ?? new Date();

  switch (name) {
    case "date":
      return formatDate(arg, now);
    case "randomint":
      return generateRandomInt(arg);
    case "randomemail":
      return randomEmail(arg);
    case "randomfirstname":
      return pick(FIRST_NAMES);
    case "randomlastname":
      return pick(LAST_NAMES);
    case "randomfullname":
      return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case "latitude":
      return typeof ctx.geoPoint?.lat === "number" ? String(ctx.geoPoint.lat) : null;
    case "longitude":
      return typeof ctx.geoPoint?.lng === "number" ? String(ctx.geoPoint.lng) : null;
    default:
      return null;
  }
};

/** The generator names this build understands, lower-cased — the key set of
 * _DYNAMIC_TOKEN_HANDLERS in backend/services/executor.py. */
export const GENERATOR_NAMES = [
  "date", "randomint", "randomemail", "randomfirstname", "randomlastname",
  "randomfullname", "latitude", "longitude",
] as const;

/** True when the editor recognises the generator a block names. Deliberately a
 * NAME check, not a trial resolution: a malformed argument ("$randomInt:abc")
 * or a location token with no point picked yet must fail at run time in both
 * engines rather than be rejected at edit time by one of them. */
export const isKnownGeneratorToken = (tokenBody: string): boolean => {
  if (!tokenBody.startsWith("$")) return false;
  const body = tokenBody.slice(1);
  const sep = body.indexOf(":");
  const name = (sep === -1 ? body : body.slice(0, sep)).toLowerCase();
  return (GENERATOR_NAMES as readonly string[]).includes(name);
};
