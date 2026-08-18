import { Bot } from "grammy";
import { startComposer } from "./commands/start.composer.js";
import { eventsComposer } from "./commands/events.composer.js";
import { TELEGRAM_BOT_TOKEN } from "./constants.js";

const token = TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is missing");
}

export const bot = new Bot(token);

bot.use(startComposer);
bot.use(eventsComposer);
