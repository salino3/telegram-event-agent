import { OAuth2Client } from "google-auth-library";
import { redis } from "../utils/redis.js";
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

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

/**
 * Generates the Google OAuth authorization URL.
 * @param telegramId - The Telegram user ID passed in the state parameter
 * @returns The generated authorization URL
 */
export async function getAuthUrl(telegramId: number): Promise<string> {
  // 1. Generate a random CSRF state token
  const stateToken = crypto.randomUUID();

  // 2. Store stateToken -> telegramId in Redis with a 10-minute expiration (600s)
  await redis.setEx(`oauth_state:${stateToken}`, 600, telegramId.toString());

  return oauth2Client.generateAuthUrl({
    access_type: "offline", // Required to receive a refresh token
    prompt: "consent", // Forces consent screen to ensure refresh token is returned
    scope: SCOPES,
    state: stateToken, // Passing the random UUID state token
    // state: telegramId.toString(), // Pass telegramId to recover it in the callback
  });
}
