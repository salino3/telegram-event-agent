import { Pool, QueryResult } from "@neondatabase/serverless";
import { DATABASE_URL } from "./constants.js";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing");
}

// Neon HTTP/Websocket Serverless Pool Connection
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  return db.query(text, params);
}
