import { createHash, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROSTER_PK = "ROSTER";
const MAX_NAMES = 200;

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
      "Access-Control-Allow-Headers": "Content-Type,X-Edit-Key",
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

function keyOk(headerVal, secret) {
  if (!secret || secret.length < 8) return false;
  if (typeof headerVal !== "string" || !headerVal) return false;
  const a = createHash("sha256").update(secret, "utf8").digest();
  const b = createHash("sha256").update(headerVal, "utf8").digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") return cors204();

  if (method !== "PUT") return json(405, { error: "Method not allowed" });

  const tableName = process.env.TABLE_NAME;
  const secret = process.env.EDIT_ROSTER_SECRET || "";
  if (!tableName) {
    console.error("Missing TABLE_NAME");
    return json(500, { error: "Server misconfigured" });
  }

  const rawHeaders = event.headers || {};
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([k, v]) => [String(k).toLowerCase(), v])
  );
  const editKey = headers["x-edit-key"] || headers["X-Edit-Key"] || "";
  if (!keyOk(editKey, secret)) {
    return json(401, { error: "Missing or invalid X-Edit-Key" });
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

  try {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { pk: ROSTER_PK, names },
      })
    );
    return json(200, { ok: true, count: names.length });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Failed to save roster" });
  }
};
