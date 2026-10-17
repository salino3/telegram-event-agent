import { Pool, QueryResult } from "@neondatabase/serverless";
import { DATABASE_URL, DATABASE_URL_READONLY } from "./constants.js";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing");
}

if (!DATABASE_URL_READONLY) {
  throw new Error("DATABASE_URL_READONLY environment variable is missing");
}

// Neon Primary (Read/Write) Pool
export const db = new Pool({
  connectionString: DATABASE_URL,
});

/**
 * Standard Query (Read / Write)
 */
export function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  return db.query(text, params);
}

// -----------------

// Neon Read-Only Replica Pool (falls back to primary db if not defined)
export const dbReadOnly = new Pool({ connectionString: DATABASE_URL_READONLY });

/**
 * Read-Only Query (Routes SELECT queries to read replica)
 */
export function queryReadOnly(
  text: string,
  params?: any[],
): Promise<QueryResult<any>> {
  return dbReadOnly.query(text, params);
}
