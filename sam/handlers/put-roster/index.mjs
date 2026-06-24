import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROSTER_PK = "ROSTER";
const MAX_NAMES = 200;
const MAX_HOLIDAYS = 100;
const MAX_SWAPS = 50;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function cors204() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

function sortNamesAlpha(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const t = n.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/** ISO YYYY-MM-DD, unique, ascending. */
function normalizeHolidays(raw) {
  const seen = new Set();
  const out = [];
  for (const h of raw) {
    if (typeof h !== "string") continue;
    const t = h.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort();
}

/** One-time name swap between two sharing Wednesdays { dateA, dateB }. */
function normalizeSwaps(raw) {
  const seen = new Set();
  const out = [];
  for (const item of raw || []) {
    if (!item || typeof item !== "object") continue;
    let a = typeof item.dateA === "string" ? item.dateA.trim() : "";
    let b = typeof item.dateB === "string" ? item.dateB.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) continue;
    if (a === b) continue;
    if (a > b) [a, b] = [b, a];
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dateA: a, dateB: b });
  }
  return out.sort((x, y) => x.dateA.localeCompare(y.dateA));
}

function isAdminFromClaims(claims) {
  if (!claims || typeof claims !== "object") return false;
  const isTrueLike = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  };

  // Primary: custom admin attribute.
  if (isTrueLike(claims["custom:admin"])) return true;
  if (isTrueLike(claims.custom_admin)) return true;

  // Fallback: group-based admin.
  const groupsRaw = claims["cognito:groups"];
  if (groupsRaw) {
    const groups = Array.isArray(groupsRaw)
      ? groupsRaw
      : String(groupsRaw)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    if (groups.some((g) => g.toLowerCase() === "admin")) return true;
  }

  return false;
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") return cors204();

  if (method !== "PUT") return json(405, { error: "Method not allowed" });

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    console.error("Missing TABLE_NAME");
    return json(500, { error: "Server misconfigured" });
  }

  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!isAdminFromClaims(claims)) {
    return json(403, { error: "Admin role required" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  if (!body || !Array.isArray(body.names))
    return json(400, { error: "Body must include names: string[]" });

  const names = sortNamesAlpha(body.names);
  if (names.length === 0) return json(400, { error: "names must be non-empty" });
  if (names.length > MAX_NAMES)
    return json(400, { error: `At most ${MAX_NAMES} names` });

  const holidays = Array.isArray(body.holidays)
    ? normalizeHolidays(body.holidays)
    : [];
  if (holidays.length > MAX_HOLIDAYS)
    return json(400, { error: `At most ${MAX_HOLIDAYS} holidays` });

  let swaps;
  if (Array.isArray(body.swaps)) {
    swaps = normalizeSwaps(body.swaps);
  } else {
    const existing = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: ROSTER_PK },
      })
    );
    swaps = normalizeSwaps(
      Array.isArray(existing.Item?.swaps) ? existing.Item.swaps : []
    );
  }
  if (swaps.length > MAX_SWAPS)
    return json(400, { error: `At most ${MAX_SWAPS} swaps` });

  try {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { pk: ROSTER_PK, names, holidays, swaps },
      })
    );
    return json(200, {
      ok: true,
      count: names.length,
      holidayCount: holidays.length,
      swapCount: swaps.length,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Failed to save roster" });
  }
};
