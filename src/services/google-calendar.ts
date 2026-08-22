import { google } from "googleapis";
import { oauth2Client } from "./google-auth.js";
import { query } from "../db.js";

export interface CreateEventInput {
  telegramId: number;
  title: string;
  description?: string;
  priority?: string;
  colorId?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
}

export async function createGoogleCalendarEvent(
  input: CreateEventInput,
): Promise<{ id: string | null; htmlLink: string | null }> {
  try {
    const dbRes = await query(
      `SELECT ga.access_token, ga.refresh_token, ga.email 
       FROM google_accounts ga
       JOIN accounts a ON ga.account_id = a.id
       WHERE a.telegram_id = $1 AND ga.is_default = TRUE`,
      [String(input.telegramId)],
    );

    if (dbRes.rows.length === 0) {
      return { id: null, htmlLink: null };
    }

    const { access_token, refresh_token, email } = dbRes.rows[0];
    oauth2Client.setCredentials({ access_token, refresh_token });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const priorityLabel = (input.priority || "medium").toUpperCase();
    const fullDescription =
      `[Priority: ${priorityLabel}]\n\n${input.description || ""}`.trim();

    // Insert event in Google Calendar
    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: input.title,
        description: fullDescription,
        location: input.location,
        colorId: input.colorId,
        start: { dateTime: input.startTime.toISOString() },
        end: { dateTime: input.endTime.toISOString() },
      },
    });

    // Modify the URL by adding 'authuser' so that it opens the correct account.
    const rawLink = response.data.htmlLink || null;
    const directLink = rawLink
      ? `${rawLink}&authuser=${encodeURIComponent(email)}`
      : null;

    return {
      id: response.data.id || null,
      htmlLink: directLink,
    };
  } catch (error) {
    console.error("Error creating Google Calendar event:", error);
    return { id: null, htmlLink: null };
  }
}
