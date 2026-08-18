// pnpm exec tsx --watch src/local.ts
import { bot } from "../api/bot.js";

async function startLocal() {
  // Tell Telegram to remove the active webhook so we can test locally
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  console.log("Webhook eliminado. starting bot locally...");

  // Start bot with Long Polling
  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} started locally!`);
    },
  });
}

startLocal();
