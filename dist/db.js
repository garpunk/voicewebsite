// db.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
// Set your AWS region
const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({ region: REGION });
// This "DocumentClient" makes it easier to work with JSON objects
const db = DynamoDBDocumentClient.from(client);
export default db;
//# sourceMappingURL=db.js.map