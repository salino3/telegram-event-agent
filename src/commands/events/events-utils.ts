import { Context, InlineKeyboard } from "grammy";
import { query } from "../../db.js";
import { updateGoogleCalendarEvent } from "../../services/google-calendar.js";
import { utilitiesApp } from "../../utils/utilities-app.js";
import { DEFAULT_EVENT_IMAGE, PRIORITY_EMOJIS } from "../../constants.js";
import { EditingFieldType, WizardStep } from "../../types/session.js";
import { userSessions } from "../../session/store.js";

const { buildColorKeyboard, escapeHtml } = utilitiesApp();

/**
 * 1. Called after Location is provided or skipped.
 * Prompts the user to upload a photo (optional).
 */
export async function proceedAfterLocation(
  ctx: Context,
  telegramId: number, // kept for uniform helper signatures across the flow
  session: any,
) {
  session.step = WizardStep.AWAITING_PHOTO;

  const skipKeyboard = new InlineKeyboard().text("➡️ Skip", "skip_photo");

  await ctx.reply("📸 Send a <b>photo</b> for your event (or press Skip):", {
    parse_mode: "HTML",
    reply_markup: skipKeyboard,
  });
}

/**
 * 2. Called after Photo is uploaded OR skipped.
 * Checks for Google Calendar connection to prompt for Color OR Priority.
 */
export async function proceedAfterPhoto(
  ctx: Context,
  telegramId: number,
  session: any,
) {
  const googleRes = await query(
    `SELECT ga.id FROM google_accounts ga 
     JOIN accounts a ON ga.account_id = a.id 
     WHERE a.telegram_id = $1 AND ga.is_default = TRUE`,
    [String(telegramId)],
  );

  const hasGoogleAccount = googleRes.rows.length > 0;

  if (hasGoogleAccount) {
    session.step = WizardStep.AWAITING_COLOR;
    await ctx.reply(
      "🎨 Choose a <b>Google Calendar color</b> for this event:",
      {
        parse_mode: "HTML",
        reply_markup: buildColorKeyboard(),
      },
    );
  } else {
    session.step = WizardStep.AWAITING_PRIORITY;
    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("🚨 Select the <b>priority level</b>:", {
      parse_mode: "HTML",
      reply_markup: priorityKeyboard,
    });
  }
}

/**
 * Execute DB & Google Update upon completion and refresh the Event Card UI
 */
export async function saveEventUpdate(
  ctx: Context,
  telegramId: number,
  eventId: number,
  field: EditingFieldType,
  value: any,
) {
  try {
    let dbRes;

    if (field === "start_time") {
      // Fetch current start and end times to maintain the event's original duration
      const currentEvtRes = await query(
        `SELECT start_time, end_time FROM events WHERE id = $1`,
        [eventId],
      );

      let newEndTime: string | null = null;

      if (currentEvtRes.rows.length > 0) {
        const { start_time, end_time } = currentEvtRes.rows[0];
        const newStart = new Date(value);

        if (start_time && end_time) {
          const durationMs =
            new Date(end_time).getTime() - new Date(start_time).getTime();
          newEndTime = new Date(newStart.getTime() + durationMs).toISOString();
        } else {
          // Default to 1 hour duration if end_time was null
          newEndTime = new Date(
            newStart.getTime() + 60 * 60 * 1000,
          ).toISOString();
        }
      }

      // Update both start_time and end_time together
      dbRes = await query(
        `UPDATE events 
         SET start_time = $1, end_time = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3 AND creator_id = (SELECT id FROM accounts WHERE telegram_id = $4)
         RETURNING google_event_id, title, description, location, priority, start_time, end_time`,
        [value, newEndTime, eventId, telegramId],
      );
    } else {
      // Standard update for single fields (title, description, location, priority)
      dbRes = await query(
        `UPDATE events 
         SET ${field} = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND creator_id = (SELECT id FROM accounts WHERE telegram_id = $3)
         RETURNING google_event_id, title, description, location, priority, start_time, end_time`,
        [value, eventId, telegramId],
      );
    }

    const updatedEvt = dbRes.rows[0];

    if (!updatedEvt) {
      await ctx.reply("❌ Event update failed or event not found.");
      return;
    }

    // Sync to Google Calendar target account
    if (updatedEvt.google_event_id) {
      await updateGoogleCalendarEvent({
        telegramId,
        eventId, // Pass database eventId so tokens for the correct owning account are queried
        googleEventId: updatedEvt.google_event_id,
        title: updatedEvt.title,
        description: updatedEvt.description,
        location: updatedEvt.location,
        priority: updatedEvt.priority,
        startTime: new Date(updatedEvt.start_time),
        endTime: updatedEvt.end_time
          ? new Date(updatedEvt.end_time)
          : undefined,
      });
    }

    // Clean up active session
    userSessions.delete(telegramId);

    // Render Refreshed Event Card with Success Header
    const fieldLabels: Record<EditingFieldType, string> = {
      title: "Title",
      description: "Description",
      location: "Location",
      priority: "Priority",
      start_time: "Start Time",
      photo: "Photo/Image",
    };

    await sendUpdatedEventCard(
      ctx,
      eventId,
      `✅ <b>[${fieldLabels[field]}] updated successfully!</b>\n\n`,
    );
  } catch (error) {
    console.error("Error updating event:", error);
    await ctx.reply("❌ Failed to update event in database.");
  }
}

/**
 * Helper to refresh/update the full Event Card UI in place without creating a new message.
 */
export async function sendUpdatedEventCard(
  ctx: Context,
  eventId: number,
  headerPrefix: string = "",
) {
  try {
    // 1. Fetch event details AND linked Google account email
    const evtRes = await query(
      `SELECT 
         e.id, 
         e.title, 
         e.description, 
         e.location, 
         e.priority, 
         e.start_time, 
         e.end_time,
         ga.email
       FROM events e
       LEFT JOIN google_accounts ga 
         ON ga.id = COALESCE(
           e.google_account_id, 
           (SELECT id FROM google_accounts WHERE account_id = e.creator_id AND is_default = TRUE LIMIT 1)
         )
       WHERE e.id = $1`,
      [eventId],
    );

    if (evtRes.rows.length === 0) return;

    const evt = evtRes.rows[0];

    // Priority formatting
    const priorityValue = (evt.priority || "medium").toLowerCase();
    const priorityEmoji = PRIORITY_EMOJIS[priorityValue] || "🟡";
    const priorityFormatted = `${priorityEmoji} ${priorityValue.toUpperCase()}`;

    // Date formatting
    const startDate = new Date(evt.start_time);
    const formattedDate = startDate.toLocaleString();

    // 2. Format the Email badge line (grey/code style)
    const emailLine = `📧 <b>Organizer: <code>${
      evt.email ? escapeHtml(evt.email) : "No Calendar Linked"
    }</code></b>\n`;

    // 3. Assemble the caption (Email right under the Title)
    const captionText =
      `${headerPrefix}` +
      `📌 <b>${escapeHtml(evt.title)}</b>\n` +
      `${emailLine}\n` +
      `🚨 <b>Priority:</b> ${priorityFormatted}\n` +
      `📅 <b>Date:</b> ${formattedDate}\n` +
      `📍 <b>Location:</b> ${escapeHtml(evt.location || "N/A")}\n` +
      `📝 <b>Description:</b> ${escapeHtml(evt.description || "N/A")}`;

    // Keyboard (Notice: Email is NOT included here so it cannot be edited)
    const actionKeyboard = new InlineKeyboard()
      .text("✏️ Edit", `edit_event_${eventId}`)
      .text("🗑️ Delete", `delete_event_${eventId}`);

    const photoToUpload = evt.photo_id || DEFAULT_EVENT_IMAGE;

    // Check if we are inside a callback query (inline button interaction) to edit in-place
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      try {
        await ctx.editMessageMedia(
          {
            type: "photo",
            media: photoToUpload,
            caption: captionText,
            parse_mode: "HTML",
          },
          {
            reply_markup: actionKeyboard,
          },
        );
        return;
      } catch (err) {
        console.warn(
          "Could not edit message media in place, sending new photo...",
          err,
        );
      }
    }

    // Fallback: send a new photo message if editing in place isn't applicable
    await ctx.replyWithPhoto(photoToUpload, {
      caption: captionText,
      parse_mode: "HTML",
      reply_markup: actionKeyboard,
    });
  } catch (error) {
    console.error("Error sending updated event card:", error);
  }
}
