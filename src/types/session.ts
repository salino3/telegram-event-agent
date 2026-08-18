export interface UserSession {
  step: "AWAITING_TITLE" | "AWAITING_PRIORITY" | "AWAITING_DATE";
  title?: string;
  priority?: "low" | "medium" | "high";
}

// Inicialización única de la sesión en memoria
export const userSessions = new Map<number, UserSession>();
