import { Context, Filter } from "grammy";

export enum WizardStep {
  AWAITING_TITLE = "AWAITING_TITLE",
  AWAITING_DESCRIPTION = "AWAITING_DESCRIPTION",
  AWAITING_LOCATION = "AWAITING_LOCATION",
  AWAITING_COLOR = "AWAITING_COLOR",
  AWAITING_PRIORITY = "AWAITING_PRIORITY",
  AWAITING_DATE = "AWAITING_DATE",
  AWAITING_DURATION = "AWAITING_DURATION",
}

export type PriorityType = "low" | "medium" | "high";

export interface UserSessionProps {
  step: WizardStep;
  title?: string;
  description?: string;
  location?: string;
  colorId?: string;
  priority?: PriorityType;
  startDate?: Date;
  durationMinutes?: number;
}

export type TextContextType = Filter<Context, "message:text">;
