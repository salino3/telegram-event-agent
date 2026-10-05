import { CallbackQueryContext, Context } from "grammy";
import { sendUpdatedEventCard } from "../events-utils.js";
import { userSessions } from "../../../session/store.js";
import { PriorityType, WizardStep } from "../../../types/session.js";

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

/**
 * Callback Query Handler: Priority Selection
 */
export async function priorityEventTypeCQB(ctx: CallbackQueryContext<Context>) {
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
}
