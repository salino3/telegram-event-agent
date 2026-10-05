import { CallbackQueryContext, Context } from "grammy";
import { userSessions } from "../../../session/store.js";

/**
 * Command: /cancel
 */
export async function cancelEventProcessCBQ(
  ctx: CallbackQueryContext<Context>,
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Check if user has an active session in the wizard
  if (userSessions.has(telegramId)) {
    userSessions.delete(telegramId); // 🗑️ Clear session state from memory
    await ctx.reply("❌ Event creation process cancelled.");
  } else {
    await ctx.reply("ℹ️ You have no active process to cancel.");
  }
}
