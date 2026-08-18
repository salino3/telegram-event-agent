import { CommandContext, Composer, Context } from "grammy";
import { query } from "../db.js";

export const startComposer = new Composer();

startComposer.command("start", async (ctx: CommandContext<Context>) => {
  console.log("clog1", ctx);
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Anonymous";
  const lastName = ctx.from?.last_name || null;

  if (!telegramId) return;

  try {
    await query(
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
