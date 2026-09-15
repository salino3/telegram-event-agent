import { Context, NextFunction } from "grammy";
import { userSessions } from "../session/store.js";

/**
 * Middleware that automatically wipes any active in-memory session
 * whenever a user triggers a top-level command (e.g., /start, /new_event).
 */
export async function clearSessionOnCommand(ctx: Context, next: NextFunction) {
  const telegramId = ctx.from?.id;
  const messageText = ctx.message?.text;

  // Check if there is a valid user ID and if the message is a command
  if (telegramId && messageText && messageText.startsWith("/")) {
    if (userSessions.has(telegramId)) {
      userSessions.delete(telegramId); //
    }
  }

  await next();
}
