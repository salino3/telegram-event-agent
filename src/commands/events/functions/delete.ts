import { CallbackQueryContext, CommandContext, Context } from "grammy";
import { aiChatSessions, userSessions } from "../../../session/store.js";
import { deleteGoogleCalendarEventDirect } from "../../../services/google-calendar.js";
import { query } from "../../../db.js";

/**
 * Command: /cancel
 */
export async function cancelEventProcessCBQ(ctx: CommandContext<Context>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let cancelledAnything = false;

  // Check & exit AI Chat session
  if (aiChatSessions.has(telegramId)) {
    aiChatSessions.delete(telegramId);
    cancelledAnything = true;
  }

  // Check & clear active event creation wizard session
  if (userSessions.has(telegramId)) {
    userSessions.delete(telegramId); // 🗑️ Clear session state from memory
    cancelledAnything = true;
  }

  // Respond based on whether anything was active
  if (cancelledAnything) {
    await ctx.reply("❌ Active process/AI session cancelled.");
  } else {
    await ctx.reply("ℹ️ You have no active process to cancel.");
  }
}

/**
 * Callback Query: Safe Event Deletion or Leaving Logic (Atomic Single Query)
 */
export async function deleteEventCQB(ctx: CallbackQueryContext<Context>) {
  const eventId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from?.id;

  if (!telegramId || isNaN(eventId)) {
    await ctx.answerCallbackQuery({ text: "Invalid request." }).catch(() => {});
    return;
  }

  try {
    // 1. Acknowledge callback query immediately to stop the Telegram loading spinner
    await ctx.answerCallbackQuery({ text: "Processing..." }).catch(() => {});

    // 2. Single Atomic SQL Sentence:
    // - Identifies user account & role
    // - Counts other admins
    // - Deletes globally or leaves event depending on role
    const res = await query(
      `WITH user_info AS (
         SELECT a.id AS account_id, ep.role AS participant_role, e.creator_id, e.google_event_id, e.google_account_id
         FROM events e
         JOIN accounts a ON a.telegram_id = $2
         LEFT JOIN event_participants ep ON ep.event_id = e.id AND ep.account_id = a.id
         WHERE e.id = $1
       ),
       other_admins AS (
         SELECT COUNT(*) AS count 
         FROM event_participants 
         WHERE event_id = $1 AND role = 'admin' AND account_id <> (SELECT account_id FROM user_info)
       ),
       action_decision AS (
         SELECT 
           ui.account_id,
           ui.participant_role,
           ui.creator_id,
           oa.count AS other_admins_count,
           (ui.creator_id = ui.account_id OR ui.participant_role = 'admin') AS is_admin
         FROM user_info ui, other_admins oa
       ),
       delete_action AS (
         -- Case A: Global Deletion (User is admin/creator AND 0 other admins remain)
         DELETE FROM events e
         USING action_decision ad
         WHERE e.id = $1 
           AND ad.is_admin = TRUE 
           AND ad.other_admins_count = 0
         RETURNING e.google_event_id, e.google_account_id, 'global_deleted' AS action_type
       ),
       leave_action AS (
         -- Case B: Leave/Remove from list only (User is regular participant OR other admins still exist)
         DELETE FROM event_participants ep
         USING action_decision ad
         WHERE ep.event_id = $1 
           AND ep.account_id = ad.account_id 
           AND (ad.is_admin = FALSE OR ad.other_admins_count > 0)
         RETURNING null::text AS google_event_id, null::int AS google_account_id, 'left_event' AS action_type
       ),
       combined_action AS (
         SELECT * FROM delete_action
         UNION ALL
         SELECT * FROM leave_action
       )
       SELECT 
         ca.action_type,
         ca.google_event_id,
         ga.access_token,
         ga.refresh_token,
         ga.email
       FROM combined_action ca
       LEFT JOIN google_accounts ga ON ca.google_account_id = ga.id`,
      [eventId, String(telegramId)],
    );

    if (res.rows.length === 0) {
      await ctx.reply("❌ Event not found or unauthorized.");
      return;
    }

    const { action_type, google_event_id, access_token, refresh_token, email } =
      res.rows[0];

    if (action_type === "global_deleted") {
      // Delete from Google Calendar if synced globally
      if (google_event_id && access_token) {
        try {
          await deleteGoogleCalendarEventDirect({
            googleEventId: google_event_id,
            accessToken: access_token,
            refreshToken: refresh_token,
            email: email,
          });
        } catch (calErr) {
          console.error("Google Calendar deletion error:", calErr);
        }
      }

      // Clean up the card message and reply
      try {
        await ctx.deleteMessage();
      } catch (e) {}

      await ctx.reply(
        "🗑️ Event has been completely deleted from the database and Google Calendar because no other administrators remained.",
      );
    } else {
      try {
        await ctx.deleteMessage();
      } catch (e) {}

      await ctx.reply(
        "🚪 You have successfully left the event and removed it from your list.",
      );
    }
  } catch (error) {
    console.error("Error deleting/leaving event:", error);
    await ctx.reply(
      "❌ An error occurred while trying to process your request.",
    );
  }
}

/**
 * Callback Query: Participant delete Event safely across multiple devices
 */
export async function participantLeaveEvent(
  ctx: CallbackQueryContext<Context>,
) {
  const eventId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from?.id;

  if (!telegramId || isNaN(eventId)) {
    await ctx.answerCallbackQuery({ text: "Invalid request." });
    return;
  }

  try {
    // Single Atomic SQL Query: Finds user account and deletes them from event_participants in one go
    const deleteRes = await query(
      `WITH user_account AS (
         SELECT id FROM accounts WHERE telegram_id = $2
       ),
       removed_participant AS (
         DELETE FROM event_participants ep
         USING user_account ua
         WHERE ep.event_id = $1 AND ep.account_id = ua.id
         RETURNING ep.event_id
       )
       SELECT rp.event_id FROM removed_participant rp`,
      [eventId, String(telegramId)],
    );

    // If no rows were returned, the user wasn't registered as a participant for this event
    if (deleteRes.rows.length === 0) {
      await ctx.answerCallbackQuery({
        text: "⚠️ You are not registered as a participant for this event.",
      });
      return;
    }

    // 2. Acknowledge button click
    await ctx.answerCallbackQuery({ text: "🚪 You have left the event." });

    // 3. Clean up the chat: Delete the event card message so it doesn't stay interactive
    try {
      await ctx.deleteMessage();
    } catch (delErr) {
      // Ignore if message couldn't be deleted (e.g., too old)
    }

    // 4. Send clear confirmation text
    await ctx.reply(
      "🚪 You have successfully left the event and removed it from your list.",
    );
  } catch (error) {
    console.error("Error leaving event:", error);
    await ctx.answerCallbackQuery({ text: "Failed to leave event." });
    await ctx.reply("❌ An error occurred while trying to leave the event.");
  }
}
