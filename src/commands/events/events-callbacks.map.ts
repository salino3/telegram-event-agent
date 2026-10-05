import { CallbackQueryContext, Context } from "grammy";
import { skipColorCBQ, skipPhotoCBQ } from "./functions/skips.js";

export type CallbackHandler = (
  ctx: CallbackQueryContext<Context>,
) => Promise<void>;

export interface CallbackRoute {
  trigger: string | RegExp;
  handler: CallbackHandler;
}

export const eventCallbackRoutes: CallbackRoute[] = [
  { trigger: "skip_photo", handler: skipPhotoCBQ },
  { trigger: "skip_color", handler: skipColorCBQ },
];
