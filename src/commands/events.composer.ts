import { CommandContext, Composer, Context, InlineKeyboard } from "grammy";
import { CallbackQueryContext } from "grammy/web";
import { query } from "../db.js";
import { userSessions } from "../session/store.js";
import { utilitiesApp } from "../utils/utilities-app.js";
import { TextContextType } from "../types/session.js";

export const eventsComposer = new Composer();

const { parseCustomDate } = utilitiesApp();

/**
 * Command: /new_event
 * Starts the appointment creation wizasrd.
 */
eventsComposer.command("new_event", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  userSessions.set(telegramId, { step: "AWAITING_TITLE" });

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

    if (!session || session.step !== "AWAITING_PRIORITY") {
      await ctx.answerCallbackQuery({
        text: "Session expired. Type /new_event again.",
      });
      return;
    }

    const selectedPriority = ctx.match[1] as "low" | "medium" | "high";
    session.priority = selectedPriority;
    session.step = "AWAITING_DATE";

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

  if (session.step === "AWAITING_TITLE") {
    session.title = ctx.message.text;
    session.step = "AWAITING_PRIORITY";

    const priorityKeyboard = new InlineKeyboard()
      .text("🟢 Low", "priority_low")
      .text("🟡 Medium", "priority_medium")
      .text("🔴 High", "priority_high");

    await ctx.reply("Select priority level:", {
      reply_markup: priorityKeyboard,
    });
    return;
  }

  if (session.step === "AWAITING_DATE") {
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
      // 1. Fetch user 'id' and 'email'
      const accountRes = await query(
        "SELECT id, email FROM accounts WHERE telegram_id = $1",
        [telegramId],
      );

      if (accountRes.rows.length === 0) {
        await ctx.reply("Account not found. Please run /start first.");
        userSessions.delete(telegramId);
        return;
      }

      const creatorId = accountRes.rows[0].id;
      const userEmail = accountRes.rows[0].email;

      let googleEventId: string | null = null;
      let syncStatusMessage = "";

      // 2. Try to sync with Google Calendar (only if user email exists)
      if (userEmail) {
        try {
          const googleResponse = await createGoogleCalendarEvent({
            title: session.title!,
            startTime: dateObj,
            email: userEmail,
          });

          if (googleResponse?.id) {
            googleEventId = googleResponse.id;
            syncStatusMessage =
              "📅 <b>Google Calendar:</b> Synced successfully! ✅";
          } else {
            syncStatusMessage = "📅 <b>Google Calendar:</b> Sync failed ⚠️";
          }
        } catch (gError) {
          console.error("Error syncing with Google Calendar:", gError);
          syncStatusMessage = "📅 <b>Google Calendar:</b> Sync error ⚠️";
        }
      } else {
        syncStatusMessage =
          "📅 <b>Google Calendar:</b> Not synced (No email registered) ⚠️";
      }

      // 3. Save event to PostgreSQL database
      await query(
        `INSERT INTO events (creator_id, title, priority, start_time, google_event_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          creatorId,
          session.title,
          session.priority,
          dateObj.toISOString(),
          googleEventId,
        ],
      );

      // 4. Send response message with event details and sync status
      await ctx.reply(
        `✅ <b>Event Saved!</b>\n\n` +
          `📌 <b>Title:</b> ${session.title}\n` +
          `🚨 <b>Priority:</b> ${session.priority?.toUpperCase()}\n` +
          `📆 <b>Date:</b> ${inputDate}\n` +
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
