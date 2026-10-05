import { CallbackQueryContext, Context } from "grammy";
import { sendUpdatedEventCard } from "../events-utils.js";

/**
 * Callback Query: Direct Pushpin Selection (select_event_X)
 * Delegates rendering directly to sendUpdatedEventCard
 */
export async function selectEventCQB(ctx: CallbackQueryContext<Context>) {
  const eventId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from?.id;

  if (!telegramId) return;

  try {
    await ctx.answerCallbackQuery();
    // Render event card with all details and dynamic document button
    await sendUpdatedEventCard(ctx, eventId, String(telegramId));
  } catch (error) {
    console.error("Error displaying selected event card:", error);
    await ctx.reply("❌ Error fetching event details.");
  }
}
