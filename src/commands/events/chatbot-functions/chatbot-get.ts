import { CommandContext, Context } from "grammy";
import { aiChatSessions } from "../../../session/store.js";

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
