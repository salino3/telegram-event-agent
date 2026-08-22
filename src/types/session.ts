import { Context, Filter } from "grammy";

export type WizardStep =
  | "AWAITING_TITLE"
  | "AWAITING_DESCRIPTION"
  | "AWAITING_LOCATION"
  | "AWAITING_PRIORITY"
  | "AWAITING_DATE"
  | "AWAITING_DURATION";

export type PriorityType = "low" | "medium" | "high";

export interface UserSessionProps {
  step: "AWAITING_TITLE" | "AWAITING_PRIORITY" | "AWAITING_DATE";
  title?: string;
  description?: string;
  location?: string;
  priority?: PriorityType;
  durationMinutes?: number;
}

export type TextContextType = Filter<Context, "message:text">;
