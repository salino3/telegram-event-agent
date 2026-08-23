import dotenv from "dotenv";
dotenv.config();

export const {
  TELEGRAM_BOT_TOKEN,
  DATABASE_URL,
  PORT,
  // GOOGLE
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

export const PRIORITY_EMOJIS: Record<string, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🔴",
};

//
export const GOOGLE_CALENDAR_COLORS = {
  "1": { name: "Lavender", emoji: "🟣" },
  "2": { name: "Sage", emoji: "🟢" },
  "3": { name: "Grape", emoji: "🍇" },
  "4": { name: "Flamingo", emoji: "🌸" },
  "5": { name: "Banana", emoji: "🟡" },
  "6": { name: "Tangerine", emoji: "🟠" },
  "7": { name: "Peacock", emoji: "🦚" },
  "8": { name: "Graphite", emoji: "🔘" },
  "9": { name: "Blueberry", emoji: "🔵" },
  "10": { name: "Basil", emoji: "🌿" },
  "11": { name: "Tomato", emoji: "🔴" },
} as const;

export const DEFAULT_EVENT_IMAGE =
  "https://cdn-icons-png.flaticon.com/512/2693/2693507.png";
