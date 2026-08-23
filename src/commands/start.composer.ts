import { CommandContext, Composer, Context } from "grammy";
import { query } from "../db.js";

export const startComposer = new Composer();

startComposer.command("start", async (ctx: CommandContext<Context>) => {
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

    // Reemplazamos etiquetas de Markdown (* y _) por etiquetas HTML (<b>, <i>)
    const welcomeMessage =
      `👋 <b>Welcome to Event Manager Bot, ${firstName}!</b>\n\n` +
      `Your account is active. I can help you manage your personal events and appointments easily.\n\n` +
      `📌 <b>Available Commands:</b>\n` +
      `• /new_event - Create a new event or appointment\n` +
      `• /connect_google - Connect your Google Calendar account\n` +
      `• /upcoming_events - View all your scheduled upcoming events\n` +
      `• /all_events - View all your events\n` +
      `• /cancel - Cancel the current active process\n\n` +
      `💡 <i>Tip: You can also tap the</i> <b>[/]</b> <i>button next to the chat bar to open the commands menu at any time.</i>`;

    await ctx.reply(welcomeMessage, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error during /start:", error);
    await ctx.reply("Failed to initialize user session. Please try again.");
  }
});
