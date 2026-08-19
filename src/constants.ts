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
