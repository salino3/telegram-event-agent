import { Context, Filter } from "grammy";

export enum WizardStep {
  AWAITING_TITLE = "AWAITING_TITLE",
  AWAITING_DESCRIPTION = "AWAITING_DESCRIPTION",
  AWAITING_LOCATION = "AWAITING_LOCATION",
  AWAITING_PHOTO = "AWAITING_PHOTO",
  AWAITING_COLOR = "AWAITING_COLOR",
  AWAITING_PRIORITY = "AWAITING_PRIORITY",
  AWAITING_DATE = "AWAITING_DATE",
  AWAITING_DURATION = "AWAITING_DURATION",
  // Specific Field Editing Steps
  AWAITING_EDIT_SELECTION = "AWAITING_EDIT_SELECTION",
  AWAITING_EDIT_VALUE = "AWAITING_EDIT_VALUE",
}

export type PriorityType = "low" | "medium" | "high";

export type EditingFieldType =
  | "title"
  | "description"
  | "location"
  | "priority"
  | "start_time";

export interface UserSessionProps {
  step: WizardStep;
  editingEventId?: number;
  editingField?: EditingFieldType;
  title?: string;
  description?: string;
  location?: string;
  colorId?: string;
  priority?: PriorityType;
  startDate?: Date;
  durationMinutes?: number;
  photoId?: string;
}

export type TextContextType = Filter<Context, "message:text">;
