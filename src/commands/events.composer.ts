import { CommandContext, Composer, Context, InlineKeyboard } from "grammy";
import { CallbackQueryContext } from "grammy/web";
import { query } from "../db.js";
import { userSessions } from "../session/store.js";
import { createGoogleCalendarEvent } from "../services/google-calendar.js";
import { utilitiesApp } from "../utils/utilities-app.js";
import { TextContextType, WizardStep } from "../types/session.js";

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

    const selectedPriority = ctx.match[1] as "low" | "medium" | "high";
    session.priority = selectedPriority;
    session.step = WizardStep.AWAITING_DATE;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `Selected Priority: ${selectedPriority.toUpperCase()}\n\nNow enter the date and time (Format: DD-MM-YYYY HH:MM):`,
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
    session.step = WizardStep.AWAITING_PRIORITY;

    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("Select priority level:", {
      reply_markup: priorityKeyboard,
    });
    return;
  }

  if (session.step === WizardStep.AWAITING_DATE) {
    const inputDate = ctx.message.text;
    const dateObj = parseCustomDate(inputDate);

    // Validate DD-MM-YYYY HH:MM format
    if (!dateObj) {
      await ctx.reply(
        "❌ Invalid date format. Please use DD-MM-YYYY HH:MM (e.g., 20-08-2026 15:00):",
      );
      return;
    }

    try {
      // 1. Fetch user 'id'
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

      // 2. Create Event in Google Calendar via API
      const googleEventId = await createGoogleCalendarEvent({
        telegramId,
        title: session.title!,
        startTime: dateObj,
      });

      const priorityValue = (session.priority || "medium").toLowerCase();

      // 3. Save event to PostgreSQL database with google_event_id
      await query(
        `INSERT INTO events (creator_id, title, priority, start_time, google_event_id)
       VALUES ($1, $2, $3, $4, $5)`,
        [
          creatorId,
          session.title,
          priorityValue,
          dateObj.toISOString(),
          googleEventId,
        ],
      );

      // 4. Send response message based on sync status
      const syncStatusMessage = googleEventId
        ? "🗓️ <b>Synced automatically with your Google Calendar!</b>"
        : "⚠️ Saved in database, but could not sync with Google Calendar. Connect your account using /connect_google.";

      const safeTitle = session.title
        ? session.title.replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : "";

      await ctx.reply(
        `✅ <b>Event Saved!</b>\n\n` +
          `📌 <b>Title:</b> ${safeTitle}\n` +
          `🚨 <b>Priority:</b> ${priorityValue.toUpperCase()}\n` +
          `📆 <b>Date:</b> ${inputDate}\n\n` +
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
