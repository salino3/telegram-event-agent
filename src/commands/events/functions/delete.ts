import { CallbackQueryContext, Context } from "grammy";
import { userSessions } from "../../../session/store.js";
import { deleteGoogleCalendarEventDirect } from "../../../services/google-calendar.js";
import { query } from "../../../db.js";

/**
 * Command: /cancel
 */
export async function cancelEventProcessCBQ(
  ctx: CallbackQueryContext<Context>,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Check if user has an active session in the wizard
  if (userSessions.has(telegramId)) {
    userSessions.delete(telegramId); // 🗑️ Clear session state from memory
    await ctx.reply("❌ Event creation process cancelled.");
  } else {
    await ctx.reply("ℹ️ You have no active process to cancel.");
  }
}

/**
 * Callback Query: Delete Event safely across multiple devices
 */

export async function deleteEventCQB(ctx: CallbackQueryContext<Context>) {
  const eventId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from.id;

  try {
    // Single Atomic SQL Sentence: Deletes attachments & event, returning Google Sync details
    const deleteRes = await query(
      `WITH deleted_event AS (
        DELETE FROM events
        WHERE id = $1 
          AND creator_id = (SELECT id FROM accounts WHERE telegram_id = $2)
        RETURNING google_event_id, google_account_id
      )
      SELECT 
        de.google_event_id, 
        ga.access_token, 
        ga.refresh_token, 
        ga.email
      FROM deleted_event de
      LEFT JOIN google_accounts ga 
        ON de.google_account_id = ga.id`,
      [eventId, String(telegramId)],
    );

    // If no rows returned, either deleted on another device or unauthorized
    if (deleteRes.rows.length === 0) {
      await ctx.answerCallbackQuery({
        text: "Event not found or already deleted.",
      });
      return;
    }

    const { google_event_id, access_token, refresh_token, email } =
      deleteRes.rows[0];

    // Delete from Google Calendar if synced
    if (google_event_id && access_token) {
      await deleteGoogleCalendarEventDirect({
        googleEventId: google_event_id,
        accessToken: access_token,
        refreshToken: refresh_token,
        email: email,
      });
    }

    await ctx.answerCallbackQuery({ text: "🗑️ Event deleted successfully!" });
    await ctx.reply(
      "🗑️ Event has been removed from your calendar and database.",
    );
  } catch (error) {
    console.error("Error deleting event:", error);
    await ctx.answerCallbackQuery({ text: "Failed to delete event." });
  }
}
