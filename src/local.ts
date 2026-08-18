import { bot } from "./bot.js";

async function main() {
  // Tell Telegram to remove the active webhook so we can test locally
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  // Register bot commands in Telegram
  await bot.api.setMyCommands([
    { command: "start", description: "Initialize user session" },
    { command: "new_event", description: "Create a new appointment or event" },
    { command: "list_events", description: "List all scheduled events" },
    { command: "cancel", description: "Cancel current active process" },
  ]);

  console.log("Webhook eliminado. starting bot locally...");

  // Start bot with Long Polling
  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} started locally!`);
    },
  });
}

main();
