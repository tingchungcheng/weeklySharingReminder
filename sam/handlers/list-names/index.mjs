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

export const handler = async () => {
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

    const names = Array.isArray(result.Item?.names)
      ? result.Item.names.filter((n) => typeof n === "string")
      : [];

    return json(200, { names });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Failed to load roster" });
  }
};
