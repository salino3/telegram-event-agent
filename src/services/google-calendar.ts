import { google } from "googleapis";

// Configuration client OAuth2 or Service Account
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

// Make sure to set the appropriate credentials/tokens before calling the API
auth.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth });

interface CreateEventParams {
  title: string;
  startTime: Date;
  email: string;
}

export async function createGoogleCalendarEvent({
  title,
  startTime,
  email,
}: CreateEventParams) {
  // Calculate the end time (by default 1 hour later)
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

  const event = {
    summary: title,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: "UTC", // Or the time zone you use
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: "UTC",
    },
    attendees: [{ email }],
  };

  const response = await calendar.events.insert({
    calendarId: "primary", // Or the corresponding calendar ID
    requestBody: event,
  });

  return response.data; // Returns the event object with its 'id'
}
