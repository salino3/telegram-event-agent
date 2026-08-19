import express from "express";
import { google } from "googleapis";
import { query } from "./db.js";
import { bot } from "./bot.js";
import { oauth2Client } from "./services/google-auth.js";
import { PORT } from "./constants.js";

const app = express();

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Missing required parameters (code or state).");
  }

  const telegramId = parseInt(state as string, 10);

  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    // Fetch user profile email
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    if (!userEmail) {
      throw new Error("Could not retrieve email from Google.");
    }

    // Find account ID by Telegram ID
    const accountRes = await query(
      "SELECT id FROM accounts WHERE telegram_id = $1",
      [telegramId],
    );

    if (accountRes.rows.length === 0) {
      return res.status(404).send("Telegram user not found.");
    }

    const accountId = accountRes.rows[0].id;

    // Save or update Google credentials in DB
    await query(
      `INSERT INTO google_accounts (account_id, email, access_token, refresh_token, is_default)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (account_id, email) 
       DO UPDATE SET 
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, google_accounts.refresh_token),
         updated_at = CURRENT_TIMESTAMP`,
      [accountId, userEmail, tokens.access_token, tokens.refresh_token],
    );

    // Notify user via Telegram
    await bot.api.sendMessage(
      telegramId,
      `✅ <b>Account linked successfully!</b>\n\n` +
        `Email: <code>${userEmail}</code>\n\n` +
        `Your events will now be automatically synced with your Google Calendar.`,
      { parse_mode: "HTML" },
    );

    res.send(
      "<h1>Authentication completed! You can close this window and return to Telegram.</h1>",
    );
  } catch (error) {
    console.error("Error during Google OAuth callback:", error);
    res.status(500).send("Authentication with Google failed.");
  }
});

//
async function main() {
  // Start Express HTTP Server for OAuth Callbacks
  app.listen(PORT, () => {
    console.log(`🌐 OAuth HTTP Server listening on http://localhost:${PORT}`);
  });

  // Tell Telegram to remove the active webhook so we can test locally
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  // Register bot commands in Telegram
  await bot.api.setMyCommands([
    { command: "start", description: "Initialize user session" },
    {
      command: "connect_google",
      description: "Connect your Google Calendar account",
    },
    { command: "new_event", description: "Create a new appointment or event" },
    { command: "list_events", description: "List all scheduled events" },
    { command: "cancel", description: "Cancel current active process" },
  ]);

  console.log("Webhook deleted. starting bot locally...");

  // Start bot with Long Polling
  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Bot @${botInfo.username} started locally!`);
    },
  });
}

main();
