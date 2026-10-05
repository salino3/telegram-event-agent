import { CallbackQueryContext, Context, InlineKeyboard } from "grammy";
import { userSessions } from "../../../session/store.js";
import { proceedAfterPhoto } from "../events-utils.js";
import { WizardStep } from "../../../types/session.js";

/**
 * Callback Query: Skip Photo Upload
 */
export async function skipPhotoCBQ(ctx: CallbackQueryContext<Context>) {
  const telegramId = ctx.from.id;
  const session = userSessions.get(telegramId);
  if (!session || session.step !== WizardStep.AWAITING_PHOTO) return;

  session.photoId = undefined;
  await ctx.answerCallbackQuery();

  // Proceed to Color or Priority
  await proceedAfterPhoto(ctx, telegramId, session);
}

/**
 * Callback: Skip Color Selection
 */

export async function skipColorCBQ(ctx: CallbackQueryContext<Context>) {
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
}
