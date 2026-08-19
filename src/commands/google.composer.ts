import { CommandContext, Composer, Context, InlineKeyboard } from "grammy";
import { getAuthUrl } from "../services/google-auth.js";

export const googleAuthComposer = new Composer();

googleAuthComposer.command(
  "connect_google",
  async (ctx: CommandContext<Context>) => {
    const telegramId = ctx.from?.id;
    console.log("clog3", ctx.from?.id);

    if (!telegramId) {
      return ctx.reply("❌ Your Telegram user could not be identified.");
    }

    // Generate the custom auth URL with the user's Telegram ID as state
    const authUrl = getAuthUrl(telegramId);
    console.log("clog2", authUrl);
    const keyboard = new InlineKeyboard().url(
      "🔗 Connect Google Calendar",
      authUrl,
    );
    console.log("clog4", keyboard);
    await ctx.reply(
      "<b>Google Calendar Integration</b>\n\n" +
        "To sync and manage events directly in your calendar, authorization is required.\n\n" +
        "Click the button below to authorize with your Google account:",
      {
        parse_mode: "HTML",
        reply_markup: keyboard,
      },
    );
  },
);
