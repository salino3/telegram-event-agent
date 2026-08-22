import { CommandContext, Composer, Context, InlineKeyboard } from "grammy";
import { CallbackQueryContext } from "grammy/web";
import { query } from "../db.js";
import { userSessions } from "../session/store.js";
import { createGoogleCalendarEvent } from "../services/google-calendar.js";
import { utilitiesApp } from "../utils/utilities-app.js";
import { PriorityType, TextContextType, WizardStep } from "../types/session.js";

export const eventsComposer = new Composer();

const { parseCustomDate } = utilitiesApp();

/**
 * Command: /new_event
 * Starts the appointment creation wizasrd.
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
 * Aborts the current event creation wizard.
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
      session.step = WizardStep.AWAITING_PRIORITY;

      const priorityKeyboard = new InlineKeyboard()
        .text("🟢 Low", "priority_low")
        .text("🟡 Medium", "priority_medium")
        .text("🔴 High", "priority_high");

      await ctx.reply("🚨 Select the <b>priority level</b>:", {
        parse_mode: "HTML",
        reply_markup: priorityKeyboard,
      });
      return;
    }
  },
);

/**
 * Command: /list_events
 * Queries Neon DB and lists active events.
 */
eventsComposer.command("list_events", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await query(
      `SELECT e.id, e.title, e.priority, e.start_time 
       FROM events e
       JOIN accounts acc ON e.creator_id = acc.id
       WHERE acc.telegram_id = $1 AND acc.is_active = TRUE
       ORDER BY e.start_time ASC`,
      [telegramId],
    );

    if (result.rows.length === 0) {
      await ctx.reply("📅 You have no scheduled events.");
      return;
    }

    let message = "📅 <b>Your Upcoming Events:</b>\n\n";
    const priorityEmoji = { low: "🟢", medium: "🟡", high: "🔴" };

    result.rows.forEach((evt, idx) => {
      const emoji =
        priorityEmoji[evt.priority as "low" | "medium" | "high"] || "⚪";
      const formattedDate = new Date(evt.start_time).toLocaleString();

      message += `${idx + 1}. ${emoji} <b>${evt.title}</b>\n   🗓️ ${formattedDate}\n\n`;
    });

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error fetching events:", error);
    await ctx.reply("Failed to fetch events from database.");
  }
});

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
    session.step = WizardStep.AWAITING_PRIORITY;

    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("🚨 Select the <b>priority level</b>:", {
      parse_mode: "HTML",
      reply_markup: priorityKeyboard,
    });
    return;
  }

  if (session.step === WizardStep.AWAITING_DATE) {
    const inputDate = ctx.message.text;
    const dateObj = parseCustomDate(inputDate);

    if (!dateObj) {
      await ctx.reply(
        "❌ Invalid date format. Please use DD-MM-YYYY HH:MM (e.g., 20-08-2026 15:00):",
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

      const googleEventId = await createGoogleCalendarEvent({
        telegramId,
        title: session.title!,
        description: session.description,
        location: session.location,
        startTime,
        endTime,
      });

      const priorityValue = (session.priority || "medium").toLowerCase();

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

      const safeTitle = session.title
        ? session.title.replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : "";

      await ctx.reply(
        `✅ <b>Event Saved!</b>\n\n` +
          `📌 <b>Title:</b> ${safeTitle}\n` +
          `📄 <b>Description:</b> ${session.description || "N/A"}\n` +
          `📍 <b>Location:</b> ${session.location || "N/A"}\n` +
          `🚨 <b>Priority:</b> ${priorityValue.toUpperCase()}\n` +
          `📆 <b>Start Time:</b> ${startTime.toLocaleString()}\n` +
          `⏳ <b>Duration:</b> ${durationInput} min\n\n` +
          `${syncStatusMessage}`,
        { parse_mode: "HTML" },
      );

      userSessions.delete(telegramId);
    } catch (error) {
      console.error("Error saving event:", error);
      await ctx.reply("Failed to save event to database.");
    }
  }
}

eventsComposer.on("message:text", handleTextMessage);
