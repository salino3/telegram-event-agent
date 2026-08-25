import { Bot } from "grammy";
import { startComposer } from "./commands/start.commands.js";
import { eventsComposer } from "./commands/events.composer.js";
import { googleAuthComposer } from "./commands/google.composer.js";
import { TELEGRAM_BOT_TOKEN } from "./constants.js";

const token = TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is missing");
}

export const bot = new Bot(token);

// Register command composers
bot.use(googleAuthComposer);
bot.use(startComposer);
bot.use(eventsComposer);

// Fallback handler for unhandled messages / unrecognized input
bot.on("message", async (ctx) => {
  await ctx.reply(
    "🤖 Sorry, I didn't understand that message or command.\n\nPlease use /start or select an option from the menu.",
  );
});
