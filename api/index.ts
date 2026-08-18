import { webhookCallback } from "grammy";
import { bot } from "../src/bot.js";

// Vercel Serverless Export
export default webhookCallback(bot, "std/http");
