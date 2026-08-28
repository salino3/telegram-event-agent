import { calendar, calendar_v3 } from "@googleapis/calendar";
import { oauth2Client } from "./google-auth.js";
import { query } from "../db.js";

// Initialize calendar client without auth attached globally
const calendarClient = calendar({ version: "v3" });

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

export interface UpdateEventInput {
  telegramId: number;
  eventId: number;
  googleEventId: string;
  title?: string;
  description?: string;
  location?: string;
  colorId?: string;
  priority?: string;
  startTime?: Date;
  endTime?: Date;
}

//
interface DirectDeleteParams {
  googleEventId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

export async function createGoogleCalendarEvent(
  input: CreateEventInput,
): Promise<{
  id: string | null;
  htmlLink: string | null;
  googleAccountId: number | null;
  googleEmail: string | null;
}> {
  try {
    // 1. Fetch ga.id along with access_token, refresh_token, and email
    const dbRes = await query(
      `SELECT ga.id as google_account_id, ga.access_token, ga.refresh_token, ga.email 
       FROM google_accounts ga
       JOIN accounts a ON ga.account_id = a.id
       WHERE a.telegram_id = $1 AND ga.is_default = TRUE`,
      [String(input.telegramId)],
    );

    if (dbRes.rows.length === 0) {
      return {
        id: null,
        htmlLink: null,
        googleAccountId: null,
        googleEmail: null,
      };
    }

    const { google_account_id, access_token, refresh_token, email } =
      dbRes.rows[0];
    oauth2Client.setCredentials({ access_token, refresh_token });

    const priorityLabel = (input.priority || "medium").toUpperCase();
    const fullDescription =
      `[Priority: ${priorityLabel}]\n\n${input.description || ""}`.trim();

    const response = await calendarClient.events.insert({
      auth: oauth2Client as any,
      calendarId: email,
      requestBody: {
        summary: input.title,
        description: fullDescription,
        location: input.location,
        colorId: input.colorId,
        start: { dateTime: input.startTime.toISOString() },
        end: { dateTime: input.endTime.toISOString() },
      },
    });

    const rawLink = response.data.htmlLink || null;
    const directLink = rawLink
      ? `${rawLink}&authuser=${encodeURIComponent(email)}`
      : null;

    // 2. Return googleAccountId alongside id and htmlLink
    return {
      id: response.data.id || null,
      htmlLink: directLink,
      googleAccountId: google_account_id,
      googleEmail: email,
    };
  } catch (error) {
    console.error("Error creating Google Calendar event:", error);
    return {
      id: null,
      htmlLink: null,
      googleAccountId: null,
      googleEmail: null,
    };
  }
}

//
export async function updateGoogleCalendarEvent(
  input: UpdateEventInput,
): Promise<boolean> {
  try {
    // Fetch target Google account credentials specifically linked to this event (with fallback to default)
    const dbRes = await query(
      `SELECT ga.access_token, ga.refresh_token, ga.email 
       FROM events e
       LEFT JOIN google_accounts ga 
         ON ga.id = COALESCE(
           e.google_account_id, 
           (SELECT id FROM google_accounts WHERE account_id = e.creator_id AND is_default = TRUE LIMIT 1)
         )
       JOIN accounts a ON e.creator_id = a.id
       WHERE a.telegram_id = $1 AND e.id = $2`,
      [String(input.telegramId), input.eventId],
    );

    if (dbRes.rows.length === 0 || !dbRes.rows[0].access_token) return false;

    const { access_token, refresh_token, email } = dbRes.rows[0];
    oauth2Client.setCredentials({ access_token, refresh_token });

    // Detect system/server timezone or default to local environment
    const userTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    const requestBody: calendar_v3.Schema$Event = {};
    if (input.title) requestBody.summary = input.title;
    if (input.location !== undefined) requestBody.location = input.location;
    if (input.colorId !== undefined) requestBody.colorId = input.colorId;

    if (input.description || input.priority) {
      const priorityLabel = (input.priority || "medium").toUpperCase();
      requestBody.description =
        `[Priority: ${priorityLabel}]\n\n${input.description || ""}`.trim();
    }

    if (input.startTime) {
      requestBody.start = {
        dateTime: input.startTime.toISOString(),
        timeZone: userTimeZone,
      };
    }

    if (input.endTime) {
      requestBody.end = {
        dateTime: input.endTime.toISOString(),
        timeZone: userTimeZone,
      };
    }

    // Patch event directly on the specific email calendar that owns the event
    await calendarClient.events.patch({
      auth: oauth2Client as any,
      calendarId: email,
      eventId: input.googleEventId,
      requestBody,
    });

    return true;
  } catch (error) {
    console.error("Error updating Google Calendar event:", error);
    return false;
  }
}

//
export async function deleteGoogleCalendarEventDirect(
  params: DirectDeleteParams,
): Promise<boolean> {
  try {
    oauth2Client.setCredentials({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });

    await calendarClient.events.delete({
      auth: oauth2Client as any,
      calendarId: params.email, // Deletes explicitly from the owning Google Account calendar
      eventId: params.googleEventId,
    });

    return true;
  } catch (error) {
    console.error("Error deleting Google Calendar event:", error);
    return false;
  }
}
