import { CallbackQueryContext, CommandContext, Context } from "grammy";
import { skipColorCBQ, skipFieldCBQ, skipPhotoCBQ } from "./functions/skips.js";
import { cancelEventProcessCBQ, deleteEventCQB } from "./functions/delete.js";
import { newEventCQB } from "./functions/post.js";
import { allEventCQB, upcomingEventsCQB } from "./functions/get.js";
import {
  colorEventPriorityCQB,
  priorityEventTypeCQB,
  selectEventCQB,
} from "./functions/put.js";

export type CallbackHandler = (
  ctx: CallbackQueryContext<Context>,
) => Promise<void>;

export type AnyHandler = (ctx: any) => Promise<void>;

export interface CallbackRoute {
  type: "command" | "callback";
  trigger: string | RegExp;
  handler: AnyHandler;
}

export const eventCallbackRoutes: CallbackRoute[] = [
  // Commands
  { type: "command", trigger: "cancel", handler: cancelEventProcessCBQ },
  { type: "command", trigger: "new_event", handler: newEventCQB },
  {
    type: "command",
    trigger: "upcoming_events",
    handler: upcomingEventsCQB,
  },
  {
    type: "command",
    trigger: "all_events",
    handler: allEventCQB,
  },
  // Callbacks
  { type: "callback", trigger: "skip_photo", handler: skipPhotoCBQ },
  { type: "callback", trigger: "skip_color", handler: skipColorCBQ },
  { type: "callback", trigger: "skip_field", handler: skipFieldCBQ },
  {
    type: "callback",
    trigger: /^select_event_(\d+)$/,
    handler: selectEventCQB,
  },
  {
    type: "callback",
    trigger: /^priority_(low|medium|high)$/,
    handler: priorityEventTypeCQB,
  },
  {
    type: "callback",
    trigger: /^color_(\d+)$/,
    handler: colorEventPriorityCQB,
  },

  {
    type: "callback",
    trigger: /^delete_event_(\d+)$/,
    handler: deleteEventCQB,
  },
];
