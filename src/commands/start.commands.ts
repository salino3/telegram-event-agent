import { CommandContext, Composer, Context } from "grammy";
import { query } from "../db.js";
import { utilitiesApp } from "../utils/utilities-app.js";

export const startComposer = new Composer();

const { escapeHtml } = utilitiesApp();

startComposer.command("start", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Anonymous";
  const lastName = ctx.from?.last_name || null;

  if (!telegramId) return;

  try {
    // 1. Upsert account details in PostgreSQL
    await query(
      `INSERT INTO accounts (telegram_id, first_name, last_name, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (telegram_id) 
       DO UPDATE SET 
         first_name = $2, 
         last_name = $3, 
         is_active = TRUE, 
         deleted_at = NULL;`,
      [String(telegramId), firstName, lastName],
    );

    const match = ctx.match;

    // 2. Handle Event Registration Deep Link
    if (typeof match === "string" && match.startsWith("reg_")) {
      const eventIdStr = match.replace("reg_", "");
      const eventId = parseInt(eventIdStr, 10);

      if (isNaN(eventId)) {
        await ctx.reply("❌ Invalid event registration link.");
        return;
      }

      // Fetch event details
      const eventRes = await query(
        `SELECT e.*, a.telegram_id as creator_telegram_id 
         FROM events e 
         JOIN accounts a ON e.creator_id = a.id 
         WHERE e.id = $1`,
        [eventId],
      );

      if (eventRes.rows.length === 0) {
        await ctx.reply("❌ Event not found or has been deleted.");
        return;
      }

      const event = eventRes.rows[0];

      // Get internal account id for participant
      const accountRes = await query(
        `SELECT id FROM accounts WHERE telegram_id = $1`,
        [String(telegramId)],
      );
      if (accountRes.rows.length === 0) {
        await ctx.reply("❌ Account not found. Please type /start first.");
        return;
      }
      const accountId = accountRes.rows[0].id;

      // Check if user has a connected Google Account (Optional)
      const googleAccRes = await query(
        `SELECT id, email FROM google_accounts 
         WHERE account_id = $1
         ORDER BY is_default DESC, created_at DESC LIMIT 1`,
        [accountId],
      );

      // If they have one, use it. Otherwise, set to null so they can still register!
      const googleAccountId =
        googleAccRes.rows.length > 0 ? googleAccRes.rows[0].id : null;
      const googleEmail =
        googleAccRes.rows.length > 0 ? googleAccRes.rows[0].email : null;

      // Register participant in DB (Works whether Google account exists or is null)
      await query(
        `INSERT INTO event_participants (event_id, account_id, google_account_id, status)
         VALUES ($1, $2, $3, 'accepted')
         ON CONFLICT (event_id, account_id) 
         DO UPDATE SET google_account_id = $3, status = 'accepted'`,
        [eventId, accountId, googleAccountId],
      );

      // Tailor the success message based on whether Google is linked
      const calendarStatus = googleEmail
        ? `📬 <b>Synced to Calendar:</b> ${googleEmail}`
        : `⚠️ <i>Saved in chatbot database only. Connect Google anytime with /connect_google to sync future events.</i>`;

      await ctx.reply(
        `✅ <b>Successfully Registered!</b>\n\n` +
          `📌 <b>Event:</b> ${escapeHtml(event.title)}\n` +
          `📅 <b>Date:</b> ${new Date(event.start_time).toLocaleString()}\n\n` +
          calendarStatus,
        { parse_mode: "HTML" },
      );
      return;
    }

    // 3. Standard Welcome Message (if no deep link payload)
    const welcomeMessage =
      `👋 <b>Welcome to Event Manager Bot, ${firstName}!</b>\n\n` +
      `Your account is active. I can help you manage your personal events and appointments easily.\n\n` +
      `📌 <b>Available Commands:</b>\n` +
      `• /new_event - Create a new event or appointment\n` +
      `• /accounts - Your listed accounts\n` +
      `• /ai - Active AI mode\n` +
      `• /upcoming_events - View all your scheduled upcoming events\n` +
      `• /connect_google - Connect your Google Calendar account\n` +
      `• /all_events - View all your events\n` +
      `• /cancel - Cancel the current active process\n\n` +
      `💡 <i>Tip: You can also tap the</i> <b>[/]</b> <i>button next to the chat bar to open the commands menu at any time.</i>`;

    await ctx.reply(welcomeMessage, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error during /start:", error);
    await ctx.reply("Failed to initialize user session. Please try again.");
  }
});
