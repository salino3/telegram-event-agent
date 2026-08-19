import { google } from "googleapis";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from "../constants.js";

export const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

// Permisos que solicitaremos al usuario (crear/modificar eventos en su calendario)
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Genera la URL de autorización vinculada al ID de Telegram del usuario.
 */
export function getAuthUrl(telegramId: number): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline", // REQUERIDO para obtener el refresh_token
    prompt: "consent", // Fuerza la entrega del refresh_token siempre
    scope: SCOPES,
    state: telegramId.toString(), // Pasamos el telegramId para saber qué usuario se está conectando
  });
}
