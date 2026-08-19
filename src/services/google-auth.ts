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

// Permissions we will request from the user (create/modify events in their calendar)
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Generates the authorization URL linked to the user's Telegram ID.
 */
export function getAuthUrl(telegramId: number): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline", // REQUIRED to obtain the refresh_token
    prompt: "consent", // Force the delivery of the refresh_token every time
    scope: SCOPES,
    state: telegramId.toString(), // Pass the Telegram ID to find out which user is connecting
  });
}
