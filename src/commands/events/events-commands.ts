import {
  CommandContext,
  Composer,
  Context,
  Filter,
  InlineKeyboard,
} from "grammy";
import { CallbackQueryContext } from "grammy/web";
import { query } from "../../db.js";
import { userSessions } from "../../session/store.js";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEventDirect,
} from "../../services/google-calendar.js";
import { utilitiesApp } from "../../utils/utilities-app.js";
import {
  handleAttachmentUpdate,
  proceedAfterLocation,
  proceedAfterPhoto,
  saveEventUpdate,
  sendUpdatedEventCard,
} from "./events-utils.js";
import { DEFAULT_EVENT_IMAGE, PRIORITY_EMOJIS } from "../../constants.js";
import {
  EditingFieldType,
  PriorityType,
  TextContextType,
  WizardStep,
} from "../../types/session.js";

export const eventsComposer = new Composer();

const { parseCustomDate, escapeHtml, getExampleDate } = utilitiesApp();

/**
 * Command: /new_event
 */
eventsComposer.command("new_event", async (ctx: CommandContext<Context>) => {
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
});

/**
 * Command: /cancel
 */
eventsComposer.command("cancel", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Check if user has an active session in the wizard
  if (userSessions.has(telegramId)) {
    userSessions.delete(telegramId); // 🗑️ Clear session state from memory
    await ctx.reply("❌ Event creation process cancelled.");
  } else {
    await ctx.reply("ℹ️ You have no active process to cancel.");
  }
});

/**
 * Callback: Color Selection
 */
eventsComposer.callbackQuery(
  /^color_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);
    if (!session || session.step !== WizardStep.AWAITING_COLOR) return;

    session.colorId = ctx.match[1];
    session.step = WizardStep.AWAITING_PRIORITY;

    await ctx.answerCallbackQuery();
    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("🚨 Select the <b>priority level</b>:", {
      parse_mode: "HTML",
      reply_markup: priorityKeyboard,
    });
  },
);

/**
 * Callback: Skip Color Selection
 */
eventsComposer.callbackQuery(
  "skip_color",
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);
    if (!session || session.step !== WizardStep.AWAITING_COLOR) return;

    session.colorId = undefined;
    session.step = WizardStep.AWAITING_PRIORITY;

    await ctx.answerCallbackQuery();
    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("🚨 Select the <b>priority level</b>:", {
      parse_mode: "HTML",
      reply_markup: priorityKeyboard,
    });
  },
);

/**
 * Callback Query Handler: Skip Optional Fields
 */
eventsComposer.callbackQuery(
  "skip_field",
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);

    if (!session) {
      await ctx.answerCallbackQuery({
        text: "Session expired. Type /new_event again.",
      });
      return;
    }

    await ctx.answerCallbackQuery();

    if (session.step === WizardStep.AWAITING_DESCRIPTION) {
      session.description = undefined;
      session.step = WizardStep.AWAITING_LOCATION;

      const skipKeyboard = new InlineKeyboard().text("➡️ Skip", "skip_field");
      await ctx.reply(
        "📍 Send the <b>location</b> for the event (or press Skip):",
        {
          parse_mode: "HTML",
          reply_markup: skipKeyboard,
        },
      );
      return;
    }

    if (session.step === WizardStep.AWAITING_LOCATION) {
      session.location = undefined;
      await proceedAfterLocation(ctx, telegramId, session);
      return;
    }
  },
);

/**
 * Command: /upcoming_events
 * Queries DB for active/imminent events using the end_time fallback logic,
 * displays a consolidated text list, and generates inline pushpin buttons.
 */
eventsComposer.command(
  "upcoming_events",
  async (ctx: CommandContext<Context>) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const result = await query(
        `SELECT e.id, e.title, e.priority, e.start_time 
         FROM events e
         JOIN accounts acc ON e.creator_id = acc.id
         WHERE acc.telegram_id = $1 
           AND acc.is_active = TRUE
           AND COALESCE(e.end_time::timestamptz, e.start_time::timestamptz + INTERVAL '3 hours') >= NOW()
         ORDER BY e.start_time::timestamptz ASC`,
        [telegramId],
      );

      if (result.rows.length === 0) {
        await ctx.reply("📅 You have no upcoming active events.");
        return;
      }

      let message = "📅 <b>Your Upcoming Events:</b>\n\n";
      const keyboard = new InlineKeyboard();

      result.rows.forEach((evt, idx) => {
        const priorityKey = String(evt.priority || "medium").toLowerCase();
        const emoji = PRIORITY_EMOJIS[priorityKey] || "⚪";
        const formattedDate = new Date(evt.start_time).toLocaleString();
        const num = idx + 1;

        message += `${num}. ${emoji} <b>${escapeHtml(evt.title)}</b>\n   🗓️ ${formattedDate}\n\n`;

        // Add interactive pushpin button
        keyboard.text(`📌 #${num}`, `select_event_${evt.id}`);
        if (num % 4 === 0) keyboard.row();
      });

      await ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error fetching upcoming events:", error);
      await ctx.reply("Failed to fetch upcoming events from database.");
    }
  },
);

/**
 * Command: /all_events
 * Displays full list with an interactive inline keyboard to delete any event.
 */
eventsComposer.command("all_events", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await query(
      `SELECT e.id, e.title, e.priority, e.start_time
       FROM events e
       JOIN accounts acc ON e.creator_id = acc.id
       WHERE acc.telegram_id = $1 AND acc.is_active = TRUE
       ORDER BY e.start_time DESC`,
      [telegramId],
    );

    if (result.rows.length === 0) {
      await ctx.reply("📜 No event history found.");
      return;
    }

    let message = "📜 <b>All Events Archive:</b>\n\n";
    const keyboard = new InlineKeyboard();

    result.rows.forEach((evt, idx) => {
      const priorityKey = (evt.priority as string).toLowerCase();
      const emoji = PRIORITY_EMOJIS[priorityKey] || "⚪";
      const formattedDate = new Date(evt.start_time).toLocaleString();
      const itemNum = idx + 1;

      message += `${itemNum}. ${emoji} <b>${escapeHtml(evt.title)}</b>\n   🗓️ ${formattedDate}\n\n`;

      // Add delete button for this item to the keyboard grid
      keyboard.text(`🗑️ ${itemNum}`, `delete_event_${evt.id}`);

      // Break into a new row every 4 buttons so it fits cleanly on mobile screens
      if (itemNum % 4 === 0) {
        keyboard.row();
      }
    });

    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error fetching all events:", error);
    await ctx.reply("Failed to fetch event history from database.");
  }
});

/**
 * Callback Query: Direct Pushpin Selection (select_event_X)
 * Delegates rendering directly to sendUpdatedEventCard
 */
eventsComposer.callbackQuery(
  /^select_event_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const eventId = parseInt(ctx.match[1], 10);

    try {
      await ctx.answerCallbackQuery();
      // Render event card with all details and dynamic document button
      await sendUpdatedEventCard(ctx, eventId);
    } catch (error) {
      console.error("Error displaying selected event card:", error);
      await ctx.reply("❌ Error fetching event details.");
    }
  },
);

/**
 * Callback Query: Delete Event safely across multiple devices
 */
eventsComposer.callbackQuery(
  /^delete_event_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const eventId = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id;

    try {
      // Single Atomic SQL Sentence: Deletes attachments & event, returning Google Sync details
      const deleteRes = await query(
        `WITH deleted_attachments AS (
           DELETE FROM event_attachments
           WHERE event_id = $1
         ),
         deleted_event AS (
           DELETE FROM events
           WHERE id = $1 AND creator_id = (SELECT id FROM accounts WHERE telegram_id = $2)
           RETURNING google_event_id, google_account_id
         )
         SELECT 
           de.google_event_id, 
           ga.access_token, 
           ga.refresh_token, 
           ga.email
         FROM deleted_event de
         JOIN google_accounts ga ON de.google_account_id = ga.id`,
        [eventId, String(telegramId)],
      );

      // If no rows were returned, another device already deleted this event (Race condition prevented!)
      if (deleteRes.rows.length === 0) {
        await ctx.answerCallbackQuery({
          text: "Event not found or already deleted.",
        });
        return;
      }

      // Extract credentials returned directly by the single DB query
      const { google_event_id, access_token, refresh_token, email } =
        deleteRes.rows[0];

      // Delete from Google Calendar if synced (using the specific returned account tokens)
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
  },
);

/**
 * Callback Query Handler: Priority Selection
 */
eventsComposer.callbackQuery(
  /^priority_(low|medium|high)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);

    if (!session || session.step !== WizardStep.AWAITING_PRIORITY) {
      await ctx.answerCallbackQuery({
        text: "Session expired. Type /new_event again.",
      });
      return;
    }

    const selectedPriority = ctx.match[1] as PriorityType;
    session.priority = selectedPriority;
    session.step = WizardStep.AWAITING_DATE;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `Selected Priority: <b>${selectedPriority.toUpperCase()}</b>\n\n` +
        "📆 Enter the <b>start date and time</b> (Format: DD-MM-YYYY HH:MM):",
      { parse_mode: "HTML" },
    );
  },
);

/**
 * Callback Query: Main "Edit" button on event card
 */
eventsComposer.callbackQuery(
  /^edit_event_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const eventId = ctx.match[1];
    const telegramId = ctx.from.id;

    // Ensure user session exists when opening the edit menu
    if (!userSessions.has(telegramId)) {
      userSessions.set(telegramId, { step: WizardStep.AWAITING_EDIT_VALUE });
    }

    await ctx.answerCallbackQuery();

    const editMenuKeyboard = new InlineKeyboard()
      .text("📌 Title", `edit_field_title_${eventId}`)
      .text("📄 Description", `edit_field_description_${eventId}`)
      .row()
      .text("📍 Location", `edit_field_location_${eventId}`)
      .text("🚨 Priority", `edit_field_priority_${eventId}`)
      .row()
      .text("📆 Start Time", `edit_field_start_time_${eventId}`)
      .text("🖼️ Image/Media", `edit_field_photo_${eventId}`)
      .text("📎 Document", `edit_field_document_${eventId}`);

    await ctx.reply("✏️ **Which field would you like to edit?**", {
      reply_markup: editMenuKeyboard,
      parse_mode: "Markdown",
    });
  },
);

/**
 * Callback Query: Trigger Edit Wizard (Select Field to Modify)
 */
eventsComposer.callbackQuery(
  /^edit_field_(title|description|location|priority|start_time|photo|document)_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const field = ctx.match[1] as EditingFieldType;
    const eventId = parseInt(ctx.match[2], 10);
    const telegramId = ctx.from.id;

    // Get existing session OR create a new one for editing
    let session = userSessions.get(telegramId);
    if (!session) {
      session = { step: WizardStep.AWAITING_EDIT_VALUE };
      userSessions.set(telegramId, session);
    }

    // Store targeted field & event ID in user session state
    session.editingEventId = eventId;
    session.editingField = field;
    session.step = WizardStep.AWAITING_EDIT_VALUE;

    await ctx.answerCallbackQuery();

    // If editing priority, display the button keyboard directly
    if (field === "priority") {
      const priorityKeyboard = new InlineKeyboard()
        .text("🟢 Low", "update_priority_low")
        .text("🟡 Medium", "update_priority_medium")
        .text("🔴 High", "update_priority_high");

      await ctx.reply("🚨 Select the new priority level:", {
        reply_markup: priorityKeyboard,
      });
      return;
    }

    // Prompt the user for input based on the chosen field
    const prompts: Record<EditingFieldType, string> = {
      title: "📌 Enter the new <b>title</b>:",
      description: "📄 Enter the new <b>description</b>:",
      location: "📍 Enter the new <b>location</b>:",
      priority: "",
      start_time:
        "📆 Enter the new start date and time (Format: <b>DD-MM-YYYY HH:MM</b>):",
      photo: "📸 Send a new <b>photo/image</b> to update this event:",
      document: "📎 Send a <b>document/PDF</b> to attach to this event:",
    };

    await ctx.reply(prompts[field], { parse_mode: "HTML" });
  },
);

/**
 * Callback Query: Process Priority Selection during Editing
 */
eventsComposer.callbackQuery(
  /^update_priority_(low|medium|high)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);

    if (
      !session ||
      session.step !== WizardStep.AWAITING_EDIT_VALUE ||
      session.editingField !== "priority" ||
      !session.editingEventId
    ) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Session expired or invalid. Please click Edit on the event card again.",
        show_alert: true,
      });
      return;
    }

    const newPriority = ctx.match[1] as PriorityType;
    const eventId = session.editingEventId;

    await ctx.answerCallbackQuery({
      text: `Priority updated to ${newPriority.toUpperCase()}`,
    });

    // Save and sync priority update
    await saveEventUpdate(ctx, telegramId, eventId, "priority", newPriority);
  },
);

/**
 * Callback Query: Skip Photo Upload
 */
eventsComposer.callbackQuery(
  "skip_photo",
  async (ctx: CallbackQueryContext<Context>) => {
    const telegramId = ctx.from.id;
    const session = userSessions.get(telegramId);
    if (!session || session.step !== WizardStep.AWAITING_PHOTO) return;

    session.photoId = undefined;
    await ctx.answerCallbackQuery();

    // Proceed to Color or Priority
    await proceedAfterPhoto(ctx, telegramId, session);
  },
);

/**
 * Callback Query: Download Document attached to an event
 */
eventsComposer.callbackQuery(
  /^download_doc_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const eventId = parseInt(ctx.match[1], 10);

    try {
      await ctx.answerCallbackQuery();

      // Retrieve the document file_id from event_attachments
      const res = await query(
        `SELECT content 
         FROM event_attachments 
         WHERE event_id = $1 AND file_type = 'document' 
         LIMIT 1`,
        [eventId],
      );

      if (res.rows.length === 0 || !res.rows[0].content) {
        await ctx.reply("❌ No document attached to this event.");
        return;
      }

      const docFileId = res.rows[0].content;

      // Send document to user
      await ctx.replyWithDocument(docFileId, {
        caption: "📄 Here is your attached document:",
      });
    } catch (error) {
      console.error("Error sending attached document:", error);
      await ctx.reply("❌ Failed to retrieve document.");
    }
  },
);

/**
 * Global Text Handler for State Machine Inputs (Wizard Flow)
 */
async function handleTextMessage(ctx: TextContextType) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);
  if (!session) return;

  // 1. STEP: TITLE
  if (session.step === WizardStep.AWAITING_TITLE) {
    session.title = ctx.message.text;
    session.step = WizardStep.AWAITING_DESCRIPTION;

    const skipKeyboard = new InlineKeyboard().text("➡️ Skip", "skip_field");
    await ctx.reply(
      "📄 Send a <b>description</b> for your event (or press Skip):",
      {
        parse_mode: "HTML",
        reply_markup: skipKeyboard,
      },
    );
    return;
  }

  // 2. STEP: DESCRIPTION
  if (session.step === WizardStep.AWAITING_DESCRIPTION) {
    session.description = ctx.message.text;
    session.step = WizardStep.AWAITING_LOCATION;

    const skipKeyboard = new InlineKeyboard().text("➡️ Skip", "skip_field");
    await ctx.reply(
      "📍 Send the <b>location</b> for your event (or press Skip):",
      {
        parse_mode: "HTML",
        reply_markup: skipKeyboard,
      },
    );
    return;
  }

  // 3. STEP: LOCATION
  if (session.step === WizardStep.AWAITING_LOCATION) {
    session.location = ctx.message.text;
    await proceedAfterLocation(ctx, telegramId, session);
    return;
  }

  // 4. STEP: DATE & TIME
  if (session.step === WizardStep.AWAITING_DATE) {
    const inputDate = ctx.message.text;
    const dateObj = parseCustomDate(inputDate);

    if (!dateObj) {
      await ctx.reply(
        `❌ Invalid date format.\n\n` +
          `You typed: <code>${escapeHtml(inputDate)}</code>\n\n` +
          `Please re-send using the format <b>DD-MM-YYYY HH:MM</b> (e.g., ${getExampleDate()} 15:00):`,
        { parse_mode: "HTML" },
      );
      return;
    }

    session.startDate = dateObj;
    session.step = WizardStep.AWAITING_DURATION;

    await ctx.reply("⏳ Enter the <b>duration in minutes</b> (e.g., 60):", {
      parse_mode: "HTML",
    });
    return;
  }

  // 5. STEP: DURATION & SAVE EVENT CREATION
  if (session.step === WizardStep.AWAITING_DURATION) {
    const rawInput = ctx.message?.text?.trim();
    const durationInput = rawInput ? parseInt(rawInput, 10) : NaN;

    if (isNaN(durationInput) || durationInput <= 0) {
      await ctx.reply(
        "❌ Please enter a valid number of minutes (e.g., 30, 60, 90).",
      );
      return;
    }

    session.durationMinutes = durationInput;

    const startTime = session.startDate!;
    const endTime = new Date(startTime.getTime() + durationInput * 60 * 1000);

    try {
      const accountRes = await query(
        "SELECT id FROM accounts WHERE telegram_id = $1",
        [telegramId],
      );
      if (accountRes.rows.length === 0) {
        await ctx.reply("Account not found. Please run /start first.");
        return;
      }
      const creatorId = accountRes.rows[0].id;

      // Create event in Google Calendar API using default account
      const {
        id: googleEventId,
        htmlLink: googleEventUrl,
        googleAccountId,
        googleEmail,
      } = await createGoogleCalendarEvent({
        telegramId,
        title: session.title!,
        description: session.description,
        location: session.location,
        colorId: session.colorId,
        priority: session.priority,
        startTime,
        endTime,
      });

      const priorityValue = (session.priority || "medium").toLowerCase();
      const priorityEmoji = PRIORITY_EMOJIS[priorityValue] || "🟡";
      const priorityFormatted = `${priorityEmoji} [${priorityValue.toUpperCase()}]`;

      // Persist to Database
      const eventInsertRes = await query(
        `INSERT INTO events (creator_id, title, description, location,
         priority, start_time, end_time, google_event_id, google_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           RETURNING id`,
        [
          creatorId,
          session.title,
          session.description || null,
          session.location || null,
          priorityValue,
          startTime.toISOString(),
          endTime.toISOString(),
          googleEventId,
          googleAccountId,
        ],
      );

      const createdEventId = eventInsertRes.rows[0].id;

      if (session.photoId && createdEventId) {
        await query(
          `INSERT INTO event_attachments (event_id, uploaded_by, file_type, content)
           VALUES ($1, $2, 'photo', $3)`,
          [createdEventId, creatorId, session.photoId],
        );
      }

      const syncStatusMessage = googleEventId
        ? "🗓️ <b>Synced automatically with your Google Calendar!</b>"
        : "⚠️ Saved in database, but could not sync with Google Calendar. Connect your account using /connect_google.";

      const calendarLinkText = googleEventUrl
        ? `\n\n🔗 <a href="${googleEventUrl}">View in Google Calendar</a>`
        : "";

      const emailLine = `📬 <b>Saved To: <code>${
        googleEmail ? escapeHtml(googleEmail) : "No Calendar Linked"
      }</code></b>\n`;

      await ctx.reply(
        `✅ <b>Event Saved!</b>\n\n` +
          `📌 <b>Title:</b> ${escapeHtml(session.title)}\n` +
          `${emailLine}` +
          `📄 <b>Description:</b> ${escapeHtml(session.description)}\n` +
          `📍 <b>Location:</b> ${escapeHtml(session.location)}\n` +
          `🎨 <b>Color ID:</b> ${session.colorId || "Default"}\n` +
          `🚨 <b>Priority:</b> ${priorityFormatted}\n` +
          `📆 <b>Start Time:</b> ${startTime.toLocaleString()}\n` +
          `⏳ <b>Duration:</b> ${durationInput} min\n\n` +
          `${syncStatusMessage}${calendarLinkText}`,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        },
      );
    } catch (error) {
      console.error("Error saving event:", error);
      await ctx.reply("Failed to save event to database.");
    } finally {
      userSessions.delete(telegramId);
      return;
    }
  }

  // 6. STEP: AWAITING_EDIT_VALUE (Text edits for Title, Description, Location, Start Time)
  if (
    session.step === WizardStep.AWAITING_EDIT_VALUE &&
    session.editingEventId &&
    session.editingField
  ) {
    // If the user sends text while editing 'photo' or 'document', reply with an error:
    if (
      session.editingField === "photo" ||
      session.editingField === "document"
    ) {
      await ctx.reply(
        `❌ Please send a valid ${session.editingField} file (or photo).`,
      );
      return;
    }

    const value = ctx.message.text;
    const eventId = session.editingEventId;
    const field = session.editingField;

    let updatedValue: any = value;

    if (field === "start_time") {
      const parsed = parseCustomDate(value);
      if (!parsed) {
        await ctx.reply("❌ Invalid format. Please use DD-MM-YYYY HH:MM");
        return;
      }
      updatedValue = parsed.toISOString();
    }

    // Execute central update function
    await saveEventUpdate(ctx, telegramId, eventId, field, updatedValue);
  }
}

eventsComposer.on("message:text", handleTextMessage);

/**
 * Handle incoming photos for both Event Creation and Event Editing
 */
eventsComposer.on(
  "message:photo",
  async (ctx: Filter<Context, "message:photo">) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const session = userSessions.get(telegramId);
    if (!session) return;

    // Extract highest resolution photo file_id
    const photos = ctx.message.photo;
    const photoFileId = photos[photos.length - 1].file_id;

    // 1. EVENT CREATION WIZARD FLOW
    if (session.step === WizardStep.AWAITING_PHOTO) {
      session.photoId = photoFileId;
      await ctx.reply("📸 Photo attached!");
      await proceedAfterPhoto(ctx, telegramId, session);
      return;
    }

    // 2. EVENT EDITING FLOW
    if (
      session.step === WizardStep.AWAITING_EDIT_VALUE &&
      session.editingField === "photo" &&
      session.editingEventId
    ) {
      await handleAttachmentUpdate(
        ctx,
        telegramId,
        session.editingEventId,
        "photo",
        photoFileId,
      );
    }
  },
);

/**
 * Handle incoming document attachments for Event Editing
 */
eventsComposer.on(
  "message:document",
  async (ctx: Filter<Context, "message:document">) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const session = userSessions.get(telegramId);
    if (!session) return;

    // Extract document file_id
    const docFileId = ctx.message.document.file_id;

    // EVENT EDITING FLOW FOR DOCUMENTS
    if (
      session.step === WizardStep.AWAITING_EDIT_VALUE &&
      session.editingField === "document" &&
      session.editingEventId
    ) {
      await handleAttachmentUpdate(
        ctx,
        telegramId,
        session.editingEventId,
        "document",
        docFileId,
      );
    }
  },
);
