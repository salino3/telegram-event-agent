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
  link?: string;
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
  link?: string;
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
    // 1. Fetch default account or fall back to the most recently created Google account
    const dbRes = await query(
      `SELECT ga.id as google_account_id, ga.access_token, ga.refresh_token, ga.email 
       FROM google_accounts ga
       JOIN accounts a ON ga.account_id = a.id
       WHERE a.telegram_id = $1
       ORDER BY ga.is_default DESC, ga.created_at DESC
       LIMIT 1`,
      [String(input.telegramId)],
    );

    if (dbRes.rows.length === 0) {
      console.warn("⚠️ No connected Google Account found in DB.");
      return {
        id: null,
        htmlLink: null,
        googleAccountId: null,
        googleEmail: null,
      };
    }

    const { google_account_id, access_token, refresh_token, email } =
      dbRes.rows[0];

    // 2. Set credentials and handle refresh token logic
    oauth2Client.setCredentials({ access_token, refresh_token });

    const priorityLabel = (input.priority || "medium").toUpperCase();
    const linkSection = input.link ? `\n🔗 Link: ${input.link}` : "";

    const fullDescription =
      `[Priority: ${priorityLabel}]${linkSection}\n\n${input.description || ""}`.trim();

    // 3. Create event using the exact account email instead of default primary
    const response = await calendarClient.events.insert({
      auth: oauth2Client as any,
      calendarId: email || "primary",
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
    // const directLink = rawLink
    //   ? `${rawLink}&authuser=${encodeURIComponent(email)}`
    //   : null;

    // 2. Return googleAccountId alongside id and htmlLink
    return {
      id: response.data.id || null,
      htmlLink: rawLink,
      googleAccountId: google_account_id,
      googleEmail: email,
    };
  } catch (error) {
    console.error("❌ Error creating Google Calendar event:", error);
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
    // Query tokens AND existing DB values for priority, description, and link
    const dbRes = await query(
      `SELECT ga.access_token, ga.refresh_token, ga.email,
              e.description as existing_desc, e.priority as existing_priority,
              (SELECT content FROM event_attachments WHERE event_id = e.id AND file_type = 'link' LIMIT 1) as existing_link
       FROM events e
       JOIN accounts a ON e.creator_id = a.id
       LEFT JOIN google_accounts ga 
         ON ga.id = COALESCE(
           e.google_account_id, 
           (SELECT id FROM google_accounts WHERE account_id = a.id AND is_default = TRUE LIMIT 1)
         )
       WHERE a.telegram_id = $1 AND e.id = $2`,
      [String(input.telegramId), input.eventId],
    );

    if (dbRes.rows.length === 0 || !dbRes.rows[0]?.access_token) {
      console.warn(
        "⚠️ No connected Google Account found for this event update.",
      );
      return false;
    }

    const {
      access_token,
      refresh_token,
      email,
      existing_desc,
      existing_priority,
      existing_link,
    } = dbRes.rows[0];

    oauth2Client.setCredentials({ access_token, refresh_token });

    // Fall back to DB values if input properties are undefined
    const finalPriority =
      input.priority !== undefined ? input.priority : existing_priority;
    const finalDescription =
      input.description !== undefined ? input.description : existing_desc;
    const finalLink = input.link !== undefined ? input.link : existing_link;

    const userTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    const requestBody: calendar_v3.Schema$Event = {};
    if (input.title) requestBody.summary = input.title;
    if (input.location !== undefined) requestBody.location = input.location;
    if (input.colorId !== undefined) requestBody.colorId = input.colorId;
    if (finalDescription || finalPriority || finalLink) {
      const priorityLabel = (finalPriority || "medium").toUpperCase();
      const linkSection = finalLink ? `\n🔗 Link: ${finalLink}` : "";
      requestBody.description =
        `[Priority: ${priorityLabel}]${linkSection}\n\n${finalDescription || ""}`.trim();
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

    await calendarClient.events.patch({
      auth: oauth2Client as any,
      calendarId: email || "primary",
      eventId: input.googleEventId,
      requestBody,
    });

    return true;
  } catch (error) {
    console.error("❌ Error updating Google Calendar event:", error);
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
