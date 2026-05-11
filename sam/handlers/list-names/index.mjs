import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROSTER_PK = "ROSTER";

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
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

/** Same ordering as put-roster: trim, unique (case-insensitive), English alpha sort. */
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

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === "OPTIONS") return cors204();

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    console.error("Missing env TABLE_NAME");
    return json(500, { error: "Server misconfigured" });
  }

  try {
    const result = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: ROSTER_PK },
      })
    );

    const raw = Array.isArray(result.Item?.names)
      ? result.Item.names.filter((n) => typeof n === "string")
      : [];
    const names = sortNamesAlpha(raw);

    return json(200, { names });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Failed to load roster" });
  }
};
