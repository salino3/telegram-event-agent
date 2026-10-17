import { Context, NextFunction } from "grammy";
import { aiChatSessions, userSessions } from "../session/store.js";
import { WizardStep } from "../types/session.js";

/**
 * Validates message length dynamically based on the current wizard step or AI mode.
 */
export function limitMessageLength(defaultMax: number = 100) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const messageText = ctx.message?.text;
    const telegramId = ctx.from?.id;

    // Skip validation if there's no text message
    if (!messageText) {
      return await next();
    }

    // Determine limit based on user's wizard step
    let allowedMax = defaultMax;

    if (telegramId) {
      const session = userSessions.get(telegramId);

      //If user is in AI chat mode, allow up to 500 characters
      if (aiChatSessions.has(telegramId)) {
        allowedMax = 500;
      }

      //If user is entering or editing a description, allow 300 characters
      else if (
        session?.step === WizardStep.AWAITING_DESCRIPTION ||
        (session?.step === WizardStep.AWAITING_EDIT_VALUE &&
          session?.editingField === "description")
      ) {
        allowedMax = 300;
      }
    }

    // Validate length against the determined allowedMax
    if (messageText.length > allowedMax) {
      await ctx.reply(
        `⚠️ Your message is too long! Maximum allowed length for this step is ${allowedMax} characters (you sent ${messageText.length}).`,
      );
      return; // Block execution
    }

    await next();
  };
}
