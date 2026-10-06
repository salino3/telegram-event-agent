import {
  Composer,
  Context,
  Filter,
  InlineKeyboard,
  NextFunction,
} from "grammy";
import { query } from "../../db.js";
import { aiChatSessions, userSessions } from "../../session/store.js";
import { createGoogleCalendarEvent } from "../../services/google-calendar.js";
import { utilitiesApp } from "../../utils/utilities-app.js";
import { eventCallbackRoutes } from "./events-callbacks.map.js";
import {
  handleAttachmentUpdate,
  proceedAfterLocation,
  proceedAfterPhoto,
  saveEventUpdate,
} from "./events-utils.js";
import { TextContextType, WizardStep } from "../../types/session.js";
import { handleAiUserPrompt } from "./chatbot-functions/chatbot-event-listeners.js";
import { PRIORITY_EMOJIS } from "../../constants.js";

export const eventsComposer = new Composer();

const { parseCustomDate, escapeHtml, getExampleDate } = utilitiesApp();

// Register commands and callback queries based on route type
for (const route of eventCallbackRoutes) {
  if (route.type === "command" && typeof route.trigger === "string") {
    eventsComposer.command(route.trigger, route.handler);
  } else if (route.type === "callback") {
    eventsComposer.callbackQuery(route.trigger, route.handler);
  }
}

//* TODO: create a file for event listener functions

/**
 * Global Text Handler for State Machine Inputs (Wizard Flow)
 * NEXT means is done with this middleware 'bot.use(EXAMPLE)' go ahead
 */
async function handleTextMessage(ctx: TextContextType, next: NextFunction) {
  const telegramId = ctx.from.id;
  if (!telegramId) return next();
  const session = userSessions.get(telegramId);

  if (aiChatSessions.has(telegramId) && !session) {
    await handleAiUserPrompt(ctx);
    return;
  }

  if (!session) return next();

  // Ensure message text exists before running wizard steps
  if (!ctx.message?.text) return next();

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
      // 1. Fetch internal creator account ID using String conversion for precision safety
      const accountRes = await query(
        "SELECT id FROM accounts WHERE telegram_id = $1",
        [String(telegramId)],
      );

      if (accountRes.rows.length === 0) {
        await ctx.reply("Account not found. Please run /start first.");
        return;
      }
      const creatorId = accountRes.rows[0].id;

      // 2. Create event in Google Calendar API
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

      // 3. Persist Event to Database
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
          googleEventId || null,
          googleAccountId || null,
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
    }
  }

  // 6. STEP: AWAITING_EDIT_VALUE (Text edits for Title, Description, Location, Start Time, Link)
  if (
    session.step === WizardStep.AWAITING_EDIT_VALUE &&
    session.editingEventId &&
    session.editingField
  ) {
    const value = ctx.message.text.trim();
    const eventId = session.editingEventId;
    const field = session.editingField;

    // 1. REJECT TEXT INPUT FOR BINARY MEDIA ATTACHMENTS
    if (field === "photo" || field === "document" || field === "video") {
      await ctx.reply(`❌ Please send a valid ${field} file instead of text.`);
      return;
    }

    // 2. ROUTE 'link' TO ATTACHMENTS TABLE
    if (field === "link") {
      const urlPattern = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;
      if (!urlPattern.test(value)) {
        await ctx.reply(
          "❌ <b>Invalid URL format!</b>\n\nPlease enter a valid link starting with <code>http://</code> or <code>https://</code>.",
          { parse_mode: "HTML" },
        );
        return;
      }

      // Call handleAttachmentUpdate (which writes to event_attachments table)
      await handleAttachmentUpdate(ctx, telegramId, eventId, "link", value);
      return;
    }

    // 3. HANDLE REGULAR COLUMNS (title, description, location, start_time)
    let updatedValue: string = value;

    if (field === "start_time") {
      const parsed = parseCustomDate(value);
      if (!parsed) {
        await ctx.reply("❌ Invalid format. Please use DD-MM-YYYY HH:MM");
        return;
      }
      updatedValue = parsed.toISOString();
    }

    // Execute central update function for standard columns on the `events` table
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

    // 1. EVENT CREATION FLOW
    if (session.step === WizardStep.AWAITING_PHOTO) {
      session.photoId = photoFileId;
      await ctx.reply("📸 Photo attached!");
      await proceedAfterPhoto(ctx, telegramId, session);
      return;
    }

    // 2. EVENT EDITING FLOW
    if (
      session.step === WizardStep.AWAITING_EDIT_VALUE &&
      session.editingEventId
    ) {
      // Correct field: User is updating event photo
      if (session.editingField === "photo") {
        await handleAttachmentUpdate(
          ctx,
          telegramId,
          session.editingEventId,
          "photo",
          photoFileId,
        );
        return;
      }

      // Wrong field: User sent a compressed photo while editing a document/PDF
      if (session.editingField === "document") {
        await ctx.reply(
          "⚠️ <b>Invalid file type!</b>\n\n" +
            "You sent a photo, but a <b>document/PDF file</b> was expected for this update.",
          { parse_mode: "HTML" },
        );
        return;
      }
    }
  },
);

/**
 * Handle incoming document attachments for Event Editing & Creation
 */
eventsComposer.on(
  "message:document",
  async (ctx: Filter<Context, "message:document">) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const session = userSessions.get(telegramId);
    if (!session) return;

    const doc = ctx.message.document;
    const docFileId = doc.file_id;
    const mimeType = doc.mime_type || "";

    // 1. EVENT CREATION FLOW (User sends a document when prompted for a photo)
    if (session.step === WizardStep.AWAITING_PHOTO) {
      // If user uploaded an uncompressed image file (e.g., JPEG, PNG)
      if (mimeType.startsWith("image/")) {
        session.photoId = docFileId;
        await ctx.reply("📸 Photo attached!");
        await proceedAfterPhoto(ctx, telegramId, session);
        return;
      }

      // If user uploaded a non-image document (e.g., PDF)
      const skipKeyboard = new InlineKeyboard().text("➡️ Skip", "skip_photo");
      await ctx.reply(
        "⚠️ <b>Invalid file format!</b>\n\n" +
          "You sent a document/PDF, but a <b>photo</b> is expected for this step. " +
          "Please send an image or press <b>Skip</b>.",
        {
          parse_mode: "HTML",
          reply_markup: skipKeyboard,
        },
      );
      return;
    }

    // 2. EVENT EDITING FLOW FOR DOCUMENTS
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

/**
 * Handle incoming video attachments for Event Editing / Validation
 */
eventsComposer.on(
  "message:video",
  async (ctx: Filter<Context, "message:video">) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const session = userSessions.get(telegramId);
    if (!session) return;

    // Extract video file_id from Telegram context
    const videoFileId = ctx.message.video.file_id;

    // 1. REJECT IF SENT DURING PHOTO CREATION STEP
    if (session.step === WizardStep.AWAITING_PHOTO) {
      await ctx.reply(
        "⚠️ <b>Invalid media format!</b>\n\n" +
          "A <b>photo</b> is expected for this step, not a video. " +
          "Please send an image or press <b>Skip</b>.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // 2. EVENT EDITING FLOW FOR VIDEOS
    if (
      session.step === WizardStep.AWAITING_EDIT_VALUE &&
      session.editingField === "video" &&
      session.editingEventId
    ) {
      await handleAttachmentUpdate(
        ctx,
        telegramId,
        session.editingEventId,
        "video",
        videoFileId,
      );
    }
  },
);
