import { OAuth2Client } from "google-auth-library";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from "../constants.js";

// Initialize OAuth2 Client
export const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

/**
 * Generates the Google OAuth authorization URL.
 * @param telegramId - The Telegram user ID passed in the state parameter
 * @returns The generated authorization URL
 */
export function getAuthUrl(telegramId: number): string {
  const scopes = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline", // Required to receive a refresh token
    prompt: "consent", // Forces consent screen to ensure refresh token is returned
    scope: scopes,
    state: telegramId.toString(), // Pass telegramId to recover it in the callback
  });
}
