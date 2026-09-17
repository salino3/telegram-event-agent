import { createClient } from "redis";
// docker run -d --name redis-local -p 6379:6379 redis:alpine

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = createClient({ url: redisUrl });

redis.on("error", (err) => console.error("Redis Client Error:", err));

// Connect to Redis on startup
(async () => {
  if (!redis.isOpen) {
    await redis.connect();
  }
})();
