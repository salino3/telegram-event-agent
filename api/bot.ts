import { Bot, Context, InlineKeyboard, webhookCallback } from "grammy";
import { db } from "../src/db.js";
import dotenv from "dotenv";
import { CommandContext } from "grammy/web";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is missing");
}

export const bot = new Bot(token);

// In-memory conversation state session interface
interface UserSession {
  step: "AWAITING_TITLE" | "AWAITING_PRIORITY" | "AWAITING_DATE";
  title?: string;
  priority?: "low" | "medium" | "high";
}

const userSessions = new Map<number, UserSession>();

/**
 * Command: /start
 * Registers or updates user account in Neon DB.
 */
bot.command("start", async (ctx: CommandContext<Context>) => {
  console.log("clog1", ctx);
  console.log("clog2", userSessions);
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Anonymous";
  const lastName = ctx.from?.last_name || null;

  if (!telegramId) return;

  try {
    await db.query(
      `INSERT INTO accounts (telegram_id, first_name, last_name, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (telegram_id) 
       DO UPDATE SET first_name = $2, last_name = $3, is_active = TRUE, deleted_at = NULL;`,
      [telegramId, firstName, lastName],
    );

    await ctx.reply(
      `Welcome, ${firstName}! 👋\nYour account is active. Use /new_event to create an appointment or /list_events to view them.`,
    );
  } catch (error) {
    console.error("Error during /start:", error);
    await ctx.reply("Failed to initialize user session. Please try again.");
  }
});

/**
 * Command: /new_event
 * Starts the appointment creation wizard.
 */
bot.command("new_event", async (ctx: CommandContext<Context>) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  userSessions.set(telegramId, { step: "AWAITING_TITLE" });
  await ctx.reply("📌 Please send the title for your new event:");
});

/**
 * Callback Query Handler: Priority Selection
 */
bot.callbackQuery(/^priority_(low|medium|high)$/, async (ctx) => {
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
    `Selected Priority: ${selectedPriority.toUpperCase()}\n\nNow enter the date and time (Format: YYYY-MM-DD HH:MM):`,
  );
});

/**
 * Command: /list_events
 * Queries Neon DB and lists active events.
 */
bot.command("list_events", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const result = await db.query(
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

    let message = "📅 *Your Upcoming Events:*\n\n";
    const priorityEmoji = { low: "🟢", medium: "🟡", high: "🔴" };

    result.rows.forEach((evt, idx) => {
      const emoji =
        priorityEmoji[evt.priority as "low" | "medium" | "high"] || "⚪";
      const formattedDate = new Date(evt.start_time).toLocaleString();
      message += `${idx + 1}. ${emoji} *${evt.title}*\n   🗓️ ${formattedDate}\n\n`;
    });

    await ctx.reply(message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error fetching events:", error);
    await ctx.reply("Failed to fetch events from database.");
  }
});

/**
 * Global Text Handler for State Machine Inputs
 */
bot.on("message:text", async (ctx) => {
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
    const dateObj = new Date(inputDate);

    if (isNaN(dateObj.getTime())) {
      await ctx.reply(
        "❌ Invalid date format. Please use YYYY-MM-DD HH:MM (e.g., 2026-08-20 15:00):",
      );
      return;
    }

    try {
      const accountRes = await db.query(
        "SELECT id FROM accounts WHERE telegram_id = $1",
        [telegramId],
      );
      if (accountRes.rows.length === 0) {
        await ctx.reply("Account not found. Please run /start first.");
        userSessions.delete(telegramId);
        return;
      }

      const creatorId = accountRes.rows[0].id;

      await db.query(
        `INSERT INTO events (creator_id, title, priority, start_time)
         VALUES ($1, $2, $3, $4)`,
        [creatorId, session.title, session.priority, dateObj.toISOString()],
      );

      await ctx.reply(
        `✅ *Event Saved!*\n\n📌 *Title:* ${session.title}\n🚨 *Priority:* ${session.priority?.toUpperCase()}\n📅 *Date:* ${dateObj.toLocaleString()}`,
        { parse_mode: "Markdown" },
      );

      userSessions.delete(telegramId);
    } catch (error) {
      console.error("Error saving event:", error);
      await ctx.reply("Failed to save event to database.");
    }
  }
});

// Vercel Serverless Export
export default async function handler(req: Request) {
  const handle = webhookCallback(bot, "std/http");
  return handle(req);
}
