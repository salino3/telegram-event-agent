import { Context, Filter } from "grammy";

export interface UserSessionProps {
  step: "AWAITING_TITLE" | "AWAITING_PRIORITY" | "AWAITING_DATE";
  title?: string;
  priority?: "low" | "medium" | "high";
}

export type TextContextType = Filter<Context, "message:text">;
