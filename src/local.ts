import "dotenv/config";
import express from "express";
import { webhookCallback } from "grammy";
import { query } from "./db.js";
import { bot } from "./bot.js";
import { oauth2Client } from "./services/google-auth.js";
import { redis } from "./utils/redis.js";
import { PORT } from "./constants.js";

// TODO: Add SQL cron job
// SELECT cron.schedule(
//   'delete_old_events',
//   '0 0 * * *', -- Runs every night at midnight
//   $$ DELETE FROM events WHERE COALESCE(end_time, start_time) < NOW() - INTERVAL '1 month' $$
// );

const app = express();
app.use(express.json());

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter.");
    }

    // 1. CSRF VALIDATION: Fetch telegramId from Redis using the state token
    const redisKey = `oauth_state:${String(state)}`;
    const telegramId = await redis.get(redisKey);

    if (!telegramId) {
      return res
        .status(403)
        .send(
          "Invalid or expired authentication session. Please try linking again from Telegram.",
        );
    }

    // 2. Consume the token immediately to prevent replay attacks
    await redis.del(redisKey);

    // 3. Retrieve Google OAuth tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // 4. Retrieve user email from Google UserInfo endpoint
    const userInfoResponse = await oauth2Client.request<{ email?: string }>({
      url: "https://www.googleapis.com/oauth2/v2/userinfo",
    });

    const userEmail = userInfoResponse.data.email;

    if (!userEmail) {
      throw new Error("Could not retrieve email from Google.");
    }

    // 5. Atomically upsert account, calculate default flag, and save google_account
    const dbRes = await query(
      `WITH target_account AS (
         INSERT INTO accounts (telegram_id, first_name)
         VALUES ($1, 'Telegram User')
         ON CONFLICT (telegram_id) DO UPDATE 
           SET telegram_id = EXCLUDED.telegram_id
         RETURNING id
       ),
       default_check AS (
         SELECT NOT EXISTS (
           SELECT 1 FROM google_accounts 
           WHERE account_id = (SELECT id FROM target_account) 
             AND is_default = TRUE
         ) AS should_be_default
       )
       INSERT INTO google_accounts (account_id, email, access_token, refresh_token, is_default)
       SELECT 
         ta.id, 
         $2, 
         $3, 
         $4, 
         dc.should_be_default
       FROM target_account ta, default_check dc
       ON CONFLICT (account_id, email) 
       DO UPDATE SET 
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, google_accounts.refresh_token),
         updated_at = CURRENT_TIMESTAMP
       RETURNING is_default;`,
      [telegramId, userEmail, tokens.access_token, tokens.refresh_token],
    );

    const isDefault = dbRes.rows[0]?.is_default ?? false;

    // 6. Notify user via Telegram
    const statusText = isDefault
      ? "🌟 Set as your default calendar."
      : "ℹ️ Linked as an additional account.";

    await bot.api.sendMessage(
      telegramId,
      `✅ <b>Account linked successfully!</b>\n\n` +
        `Email: <code>${userEmail}</code>\n` +
        `${statusText}`,
      { parse_mode: "HTML" },
    );

    res.send("<h1>Authentication successful! You can return to Telegram.</h1>");
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("Authentication failed. Please try again.");
  }
});

if (process.env.NODE_ENV !== "development") {
  // Mount Telegram Webhook endpoint (Used only in production/webhook mode)
  app.post("/api/bot", (req, res) => {
    const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (expectedSecret && incomingSecret !== expectedSecret) {
      console.warn(
        "⚠️ Unauthorized webhook request rejected: Invalid secret token.",
      );
      // Even in case of error returning '200' for avoid Telegram send again and again the message
      return res.status(200).send("Unauthorized");
    }

    return webhookCallback(bot, "express")(req, res);
  });
}

//
async function main() {
  // Start Express HTTP Server for OAuth Callbacks
  app.listen(PORT, () => {
    console.log(`🌐 OAuth HTTP Server listening on http://localhost:${PORT}`);
  });

  // Register bot commands in Telegram
  await bot.api.setMyCommands([
    { command: "start", description: "Initialize user session" },
    { command: "accounts", description: "Your list accounts" },
    {
      command: "connect_google",
      description: "Connect your Google Calendar account",
    },
    { command: "new_event", description: "Create a new appointment or event" },
    {
      command: "upcoming_events",
      description: "List all scheduled upcoming events",
    },
    { command: "all_events", description: "List all events" },
    { command: "cancel", description: "Cancel current active process" },
  ]);

  console.log("Webhook deleted. starting bot locally...");

  if (process.env.NODE_ENV === "development") {
    // Tell Telegram to remove the active webhook so we can test locally
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    // Start bot with Long Polling
    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Bot @${botInfo.username} started locally!`);
      },
    });
  }
}

main();
