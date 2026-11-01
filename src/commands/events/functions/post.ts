import { CallbackQueryContext, CommandContext, Context } from "grammy";
import { query } from "../../../db.js";
import { userSessions } from "../../../session/store.js";
import { WizardStep } from "../../../types/session.js";
import { createGoogleCalendarEvent } from "../../../services/google-calendar.js";
import { utilitiesApp } from "../../../utils/utilities-app.js";
import { sendUpdatedEventCard } from "../events-utils.js";

const { escapeHtml } = utilitiesApp();

/**
 * Command: /new_event
 */
export async function newEventCQB(ctx: CommandContext<Context>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  userSessions.delete(telegramId);
  userSessions.set(telegramId, { step: WizardStep.AWAITING_TITLE });

  await ctx.reply(
    "📝 <b>Event Creation</b>\n" +
      "💡 <i>You can send /cancel at any time to abort the process.</i>\n\n" +
      "📌 Please send the title for your new event:",
    { parse_mode: "HTML" },
  );
}

/**
 * Command: /sync_event_$
 * Callback Query: Sync Event to Google Calendar
 */
export async function syncEventCBQ(ctx: CallbackQueryContext<Context>) {
  try {
    const match = ctx.match as RegExpMatchArray;
    const eventId = parseInt(match[1], 10);
    const telegramId = ctx.from?.id;

    if (!telegramId) {
      await ctx.answerCallbackQuery({
        text: "❌ User not found.",
        show_alert: true,
      });
      return;
    }

    // 1. Check if the user has a connected default Google account
    const accountRes = await query(
      `SELECT ga.id as google_account_id, ga.access_token, ga.refresh_token, ga.email 
       FROM google_accounts ga
       JOIN accounts a ON ga.account_id = a.id
       WHERE a.telegram_id = $1 AND ga.is_default = TRUE
       LIMIT 1`,
      [String(telegramId)],
    );

    if (accountRes.rows.length === 0 || !accountRes.rows[0]?.access_token) {
      await ctx.answerCallbackQuery({
        text: "⚠️ No Google account linked! Please run /connect_google first.",
        show_alert: true,
      });
      return;
    }

    const googleAccount = accountRes.rows[0];

    // 2. Fetch the event details from your database
    const eventRes = await query(
      `SELECT e.title, e.description, e.location, e.priority, e.start_time, e.end_time, e.google_event_id, ea.content as link
   FROM events e
   LEFT JOIN event_attachments ea ON e.id = ea.event_id AND ea.file_type = 'link'
   WHERE e.id = $1`,
      [eventId],
    );

    if (eventRes.rows.length === 0) {
      await ctx.answerCallbackQuery({
        text: "❌ Event not found.",
        show_alert: true,
      });
      return;
    }

    const event = eventRes.rows[0];

    if (event.google_event_id) {
      await ctx.answerCallbackQuery({
        text: "✅ Event is already synced with Google Calendar!",
        show_alert: true,
      });
      return;
    }

    // Determine start and end times properly
    const startTime = new Date(event.start_time);
    const endTime = event.end_time
      ? new Date(event.end_time)
      : new Date(startTime.getTime() + 60 * 60 * 1000); // Default to 1 hour duration if not set

    // 3. Create the event in Google Calendar using your service helper
    const syncResult = await createGoogleCalendarEvent({
      telegramId,
      title: event.title,
      description: event.description,
      location: event.location,
      priority: event.priority,
      link: event.link,
      startTime: startTime,
      endTime: endTime,
    });

    // STRICT CHECK: Ensure Google successfully returned an event ID
    if (!syncResult || !syncResult.id) {
      await ctx.answerCallbackQuery({
        text: "❌ Google Calendar sync failed. Check server console for token errors.",
        show_alert: true,
      });
      return;
    }

    // 4. Update the event in PostgreSQL with the new google_event_id and google_account_id
    await query(
      `UPDATE events 
       SET google_event_id = $1, google_account_id = $2 
       WHERE id = $3`,
      [syncResult.id, googleAccount.google_account_id, eventId],
    );

    // 5. Acknowledge button click successfully
    await ctx.answerCallbackQuery({
      text: "✅ Event successfully synchronized to Google Calendar!",
    });

    // 6. Refresh the UI card in place to display the synced status and user email
    await sendUpdatedEventCard(
      ctx,
      eventId,
      String(telegramId),
      "🔄 <b>Event Synchronized!</b>\n\n",
    );
  } catch (error: unknown) {
    console.error("❌ Error creating Google Calendar event:", error);

    const err = error as {
      response?: { data?: { error?: string } };
      message?: string;
    };
    if (
      err?.response?.data?.error === "invalid_grant" ||
      err?.message?.includes("invalid_grant")
    ) {
      console.warn(
        "⚠️ Google refresh token is invalid or expired. User needs to reconnect.",
      );
    }
  }
}
