import { UserSessionProps } from "../types/session.js";

// Single session initialization in memory
export const userSessions = new Map<number, UserSessionProps>();
