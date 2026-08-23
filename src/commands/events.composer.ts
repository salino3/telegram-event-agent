import { CommandContext, Composer, Context, InlineKeyboard } from "grammy";
import { CallbackQueryContext } from "grammy/web";
import { query } from "../db.js";
import { userSessions } from "../session/store.js";
import { createGoogleCalendarEvent } from "../services/google-calendar.js";
import { utilitiesApp } from "../utils/utilities-app.js";
import { DEFAULT_EVENT_IMAGE, PRIORITY_EMOJIS } from "../constants.js";
import { PriorityType, TextContextType, WizardStep } from "../types/session.js";

export const eventsComposer = new Composer();

const { parseCustomDate, buildColorKeyboard, escapeHtml, getExampleDate } =
  utilitiesApp();

/**
 * Helper to proceed past location and determine whether to present
 * the color selection step (if connected to Google Calendar) or skip to priority.
 */
async function proceedAfterLocation(
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
 * Command: /new_event
 */
eventsComposer.command("new_event", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

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
eventsComposer.callbackQuery(/^color_(\d+)$/, async (ctx) => {
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
});

/**
 * Callback: Skip Color Selection
 */
eventsComposer.callbackQuery("skip_color", async (ctx) => {
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
});

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
           AND COALESCE(e.end_time, e.start_time + INTERVAL '3 hours') >= NOW()
         ORDER BY e.start_time ASC`,
        [telegramId],
      );

      if (result.rows.length === 0) {
        await ctx.reply("📅 You have no upcoming active events.");
        return;
      }

      let message = "📅 <b>Your Upcoming Events:</b>\n\n";
      const keyboard = new InlineKeyboard();

      result.rows.forEach((evt, idx) => {
        const priorityKey = (evt.priority as string).toLowerCase();
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
 * Directly displays the event image (or default photo) with full details
 * and inline action buttons (Edit & Delete).
 */
eventsComposer.callbackQuery(
  /^select_event_(\d+)$/,
  async (ctx: CallbackQueryContext<Context>) => {
    const eventId = ctx.match[1];

    try {
      const result = await query(
        `SELECT e.id, e.title, e.priority, e.start_time, e.end_time, e.description, e.location,
                (SELECT content FROM event_attachments ea WHERE ea.event_id = e.id AND ea.file_type = 'photo' LIMIT 1) AS photo_id
         FROM events e WHERE e.id = $1`,
        [eventId],
      );

      if (result.rows.length === 0) {
        await ctx.answerCallbackQuery({ text: "Event not found." });
        return;
      }

      const evt = result.rows[0];
      const formattedStartDate = new Date(evt.start_time).toLocaleString();
      const priorityKey = (evt.priority as string).toLowerCase();
      const emoji = PRIORITY_EMOJIS[priorityKey] || "⚪";

      const captionText =
        `📌 <b>${escapeHtml(evt.title)}</b>\n\n` +
        `🚨 <b>Priority:</b> ${emoji} ${evt.priority.toUpperCase()}\n` +
        `📅 <b>Date:</b> ${formattedStartDate}\n` +
        `📍 <b>Location:</b> ${escapeHtml(evt.location || "N/A")}\n` +
        `📝 <b>Description:</b> ${escapeHtml(evt.description || "N/A")}`;

      const actionKeyboard = new InlineKeyboard()
        .text("✏️ Edit", `edit_event_${evt.id}`)
        .text("🗑️ Delete", `delete_event_${evt.id}`);

      await ctx.answerCallbackQuery();

      const photoToUpload = evt.photo_id || DEFAULT_EVENT_IMAGE;

      await ctx.replyWithPhoto(photoToUpload, {
        caption: captionText,
        parse_mode: "HTML",
        reply_markup: actionKeyboard,
      });
    } catch (error) {
      console.error("Error fetching event details:", error);
      await ctx.answerCallbackQuery({ text: "Error fetching event details." });
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
 * Global Text Handler for State Machine Inputs
 */
async function handleTextMessage(ctx: TextContextType) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);
  if (!session) return;

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

  if (session.step === WizardStep.AWAITING_LOCATION) {
    session.location = ctx.message.text;
    await proceedAfterLocation(ctx, telegramId, session);
    return;
  }

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

  if (session.step === WizardStep.AWAITING_DURATION) {
    const durationInput = parseInt(ctx.message.text, 10);

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
        userSessions.delete(telegramId);
        return;
      }
      const creatorId = accountRes.rows[0].id;

      const { id: googleEventId, htmlLink: googleEventUrl } =
        await createGoogleCalendarEvent({
          telegramId,
          title: session.title!,
          description: session.description,
          location: session.location,
          colorId: session.colorId,
          startTime,
          endTime,
        });

      const priorityValue = (session.priority || "medium").toLowerCase();
      const priorityEmoji = PRIORITY_EMOJIS[priorityValue] || "🟡";
      const priorityFormatted = `${priorityEmoji} [${priorityValue.toUpperCase()}]`;

      await query(
        `INSERT INTO events (creator_id, title, description, location, priority, start_time, end_time, google_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          creatorId,
          session.title,
          session.description || null,
          session.location || null,
          priorityValue,
          startTime.toISOString(),
          endTime.toISOString(),
          googleEventId,
        ],
      );

      const syncStatusMessage = googleEventId
        ? "🗓️ <b>Synced automatically with your Google Calendar!</b>"
        : "⚠️ Saved in database, but could not sync with Google Calendar. Connect your account using /connect_google.";

      const calendarLinkText = googleEventUrl
        ? `\n\n🔗 <a href="${googleEventUrl}">View in Google Calendar</a>`
        : "";

      await ctx.reply(
        `✅ <b>Event Saved!</b>\n\n` +
          `📌 <b>Title:</b> ${escapeHtml(session.title)}\n` +
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

      userSessions.delete(telegramId);
    } catch (error) {
      console.error("Error saving event:", error);
      await ctx.reply("Failed to save event to database.");
    }
  }
}

eventsComposer.on("message:text", handleTextMessage);
