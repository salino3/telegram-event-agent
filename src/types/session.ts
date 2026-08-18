import { Context, Filter } from "grammy";

export interface UserSession {
  step: "AWAITING_TITLE" | "AWAITING_PRIORITY" | "AWAITING_DATE";
  title?: string;
  priority?: "low" | "medium" | "high";
}

export type TextContext = Filter<Context, "message:text">;

// Inicialización única de la sesión en memoria
export const userSessions = new Map<number, UserSession>();
