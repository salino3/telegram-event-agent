import { CommandContext, Context, InlineKeyboard } from "grammy";
import { query } from "../../../db.js";
import { utilitiesApp } from "../../../utils/utilities-app.js";
import { aiChatSessions } from "../../../session/store.js";
import { PRIORITY_EMOJIS } from "../../../constants.js";

const { escapeHtml } = utilitiesApp();

/**
 * Command: /all_events
 * Displays full list in chronological order (ASC) with an interactive inline keyboard.
 */
export async function allEventCQB(ctx: CommandContext<Context>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await query(
      `SELECT e.id, e.title, e.priority, e.start_time
       FROM events e
       JOIN accounts acc ON e.creator_id = acc.id
       WHERE acc.telegram_id = $1 AND acc.is_active = TRUE
       ORDER BY e.start_time::timestamptz ASC`,
      [String(telegramId)],
    );

    if (result.rows.length === 0) {
      await ctx.reply("📜 No event history found.");
      return;
    }

    let message = "📜 <b>All Events Archive:</b>\n\n";
    const keyboard = new InlineKeyboard();

    result.rows.forEach((evt, idx) => {
      const priorityKey = String(evt.priority || "medium").toLowerCase();
      const emoji = PRIORITY_EMOJIS[priorityKey] || "⚪";
      const formattedDate = new Date(evt.start_time).toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
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
}

/**
 * Command: /upcoming_events
 * Queries DB for active/imminent events using the end_time fallback logic,
 * displays a consolidated text list, and generates inline pushpin buttons.
 */
export async function upcomingEventsCQB(ctx: CommandContext<Context>) {
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
      [String(telegramId)],
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
      const formattedDate = new Date(evt.start_time).toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
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
}

/**
 * Command: /ai
 * Activates AI conversational mode.
 */
export async function aiCQB(ctx: CommandContext<Context>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  aiChatSessions.add(telegramId);
  await ctx.reply(
    "🤖 <b>AI Mode Activated!</b>\nAsk me about your schedule (e.g., <i>'Check my dentist appointment'</i>).\nSend /cancel to exit AI mode.",
    { parse_mode: "HTML" },
  );
}
