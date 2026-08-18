import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing");
}

// Neon HTTP/Websocket Serverless Pool Connection
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});
