import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

// Injected from CDK constructor
const tableName = process.env.TABLE_NAME;

// Supported routes:
//   GET    /items        -> list all items
//   POST   /items        -> create an item (id + name in the body)
//   GET    /items/{id}   -> get one item
//   PUT    /items/{id}   -> create or replace the item with that id
//   DELETE /items/{id}   -> delete one item

export const handler = async (event, context) => {
  let body;
  let statusCode = 200;
  const headers = {
    "Content-Type": "application/json",
  };

  // REST API (v1) proxy sends httpMethod + resource; HTTP API (v2) sends routeKey.
  const routeKey =
    event.routeKey ?? `${event.httpMethod} ${event.resource}`;
  const id = event.pathParameters?.id;

  try {
    switch (routeKey) {
      case "GET /items": {
        const scanResult = await dynamo.send(
          new ScanCommand({ TableName: tableName })
        );
        body = scanResult.Items;
        break;
      }

      case "POST /items": {
        const requestJSON = parseBody(event);

        if (!requestJSON.id || !requestJSON.name) {
          statusCode = 400;
          body = { message: "id and name are required" };
          break;
        }

        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: buildItem(requestJSON.id, requestJSON),
            // POST creates only: refuse to overwrite an existing id
            ConditionExpression: "attribute_not_exists(id)",
          })
        );

        statusCode = 201;
        body = { message: `Item ${requestJSON.id} created successfully` };
        break;
      }

      case "GET /items/{id}": {
        if (!id) {
          statusCode = 400;
          body = { message: "id is required in the path" };
          break;
        }

        const getResult = await dynamo.send(
          new GetCommand({
            TableName: tableName,
            Key: { id },
          })
        );

        if (!getResult.Item) {
          statusCode = 404;
          body = { message: `Item ${id} not found` };
          break;
        }
        body = getResult.Item;
        break;
      }

      case "PUT /items/{id}": {
        if (!id) {
          statusCode = 400;
          body = { message: "id is required in the path" };
          break;
        }

        const requestJSON = parseBody(event);

        if (!requestJSON.name) {
          statusCode = 400;
          body = { message: "name is required" };
          break;
        }

        // The id in the URL is the source of truth
        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: buildItem(id, requestJSON),
          })
        );

        body = { message: `Item ${id} updated successfully` };
        break;
      }

      case "DELETE /items/{id}": {
        if (!id) {
          statusCode = 400;
          body = { message: "id is required in the path" };
          break;
        }

        await dynamo.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id },
          })
        );
        body = { message: `Item ${id} deleted successfully` };
        break;
      }

      default:
        statusCode = 405;
        body = { message: `Unsupported route: "${routeKey}"` };
    }
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      statusCode = 409;
      body = { message: "An item with this id already exists. Use PUT /items/{id} to update it." };
    } else if (err instanceof SyntaxError) {
      statusCode = 400;
      body = { message: "Request body must be valid JSON" };
    } else {
      console.error(err);
      statusCode = 500;
      body = { message: err.message };
    }
  }

  return {
    statusCode,
    body: JSON.stringify(body),
    headers,
  };
};

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
}

function buildItem(id, data) {
  return {
    id: String(id),
    name: data.name,
    description: data.description || "",
    category: data.category || "",
  };
}
