import { Context, NextFunction } from "grammy";

/**
 * Creates a middleware that validates the character length of incoming text messages.
 *
 * @param maxLength - Maximum allowed characters in the message text (defaults to 100).
 */
export function limitMessageLength(maxLength: number = 100) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    // Extract message text if present
    const messageText = ctx.message?.text;

    // If there's text and it exceeds the maximum allowed length
    if (messageText && messageText.length > maxLength) {
      await ctx.reply(
        `⚠️ Your message is too long! Maximum allowed length is ${maxLength} characters (you sent ${messageText.length}).`,
      );
      // Stop the middleware chain execution
      return;
    }

    // Continue to the command or next middleware
    await next();
  };
}
