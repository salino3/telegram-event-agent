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

export type MultimediaFieldType = "video" | "photo" | "document";

export type EditingFieldType =
  | "title"
  | "description"
  | "location"
  | "priority"
  | "start_time"
  | MultimediaFieldType;

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
  documentId?: string;
  videoId?: string;
}

export interface EventCardRow {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  priority: string | null;
  start_time: string;
  end_time: string | null;
  email: string | null;
  photo_id: string | null;
  document_id: string | null;
  video_id: string | null;
}

export type TextContextType = Filter<Context, "message:text">;
