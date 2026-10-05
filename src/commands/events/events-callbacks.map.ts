import { CallbackQueryContext, CommandContext, Context } from "grammy";
import { skipColorCBQ, skipFieldCBQ, skipPhotoCBQ } from "./functions/skips.js";
import { cancelEventProcessCBQ, deleteEventCQB } from "./functions/delete.js";

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
  { trigger: "skip_field", handler: skipFieldCBQ },
  { trigger: "cancel", handler: cancelEventProcessCBQ },
  { trigger: /^delete_event_(\d+)$/, handler: deleteEventCQB },
];
