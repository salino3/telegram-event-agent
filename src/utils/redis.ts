import { createClient } from "redis";
import { NODE_ENV, REDIS_URL } from "../constants.js";
// docker run -d --name redis-local -p 6379:6379 redis:alpine
// ngrok http 3000

const redisUrl = REDIS_URL || "redis://localhost:6379";

export const redis = createClient({
  url: redisUrl, // Select DB 1 for development/staging, DB 0 for production
  database: NODE_ENV === "development" ? 1 : 0,
});

redis.on("error", (err) => console.error("Redis Client Error:", err));

// Connect to Redis on startup
(async () => {
  if (!redis.isOpen) {
    await redis.connect();
    console.log("⚡ Connected to Redis successfully!");
  }
})();
