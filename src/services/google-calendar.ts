import { google } from "googleapis";
import { query } from "../db.js";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from "../constants.js";

interface CreateEventInput {
  telegramId: number;
  title: string;
  description?: string;
  startTime: Date;
  durationMinutes?: number;
}

/**
 * Creates an event directly in the user's primary Google Calendar using saved OAuth tokens.
 */
export async function createGoogleCalendarEvent(
  input: CreateEventInput,
): Promise<string | null> {
  try {
    // 1. Fetch user account and Google tokens from DB
    const tokenRes = await query(
      `SELECT ga.access_token, ga.refresh_token 
       FROM google_accounts ga
       JOIN accounts a ON ga.account_id = a.id
       WHERE a.telegram_id = $1 AND ga.is_default = TRUE
       LIMIT 1`,
      [input.telegramId],
    );

    if (tokenRes.rows.length === 0) {
      console.log(
        `No Google account linked for Telegram ID: ${input.telegramId}`,
      );
      return null; // User hasn't linked Google Calendar yet
    }

    const { access_token, refresh_token } = tokenRes.rows[0];

    // 2. Set OAuth credentials
    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
    );

    auth.setCredentials({
      access_token,
      refresh_token,
    });

    // 3. Initialize Calendar API client
    const calendar = google.calendar({ version: "v3", auth });

    // 4. Calculate start and end ISO strings
    const startISO = input.startTime.toISOString();
    const duration = input.durationMinutes ?? 60;
    const endISO = new Date(
      input.startTime.getTime() + duration * 60 * 1000,
    ).toISOString();

    // 5. Insert event into Google Calendar
    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: input.title,
        description: input.description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
      },
    });

    return response.data.id || null;
  } catch (error) {
    console.error("Error creating event in Google Calendar API:", error);
    return null;
  }
}
