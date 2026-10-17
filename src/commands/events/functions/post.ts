import { CommandContext, Context } from "grammy";
import { userSessions } from "../../../session/store.js";
import { WizardStep } from "../../../types/session.js";

/**
 * Command: /new_event
 */
export async function newEventCQB(ctx: CommandContext<Context>) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  userSessions.delete(telegramId);
  userSessions.set(telegramId, { step: WizardStep.AWAITING_TITLE });

  await ctx.reply(
    "📝 <b>Event Creation</b>\n" +
      "💡 <i>You can send /cancel at any time to abort the process.</i>\n\n" +
      "📌 Please send the title for your new event:",
    { parse_mode: "HTML" },
  );
}
