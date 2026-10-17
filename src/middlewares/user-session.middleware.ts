import { Context, NextFunction } from "grammy";
import { aiChatSessions, userSessions } from "../session/store.js";

/**
 * Middleware that automatically wipes any active in-memory session
 * whenever a user triggers a top-level command (e.g., /start, /new_event).
 */
export async function clearSessionOnCommand(ctx: Context, next: NextFunction) {
  const telegramId = ctx.from?.id;
  const messageText = ctx.message?.text;

  // Wipe states if user issues ANY command (e.g. /start, /list_events, etc.) except /ai itself
  if (telegramId && messageText && messageText.startsWith("/")) {
    if (!messageText.startsWith("/ai")) {
      aiChatSessions.delete(telegramId);
    }
    userSessions.delete(telegramId);
  }

  await next();
}
