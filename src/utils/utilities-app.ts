import { InlineKeyboard } from "grammy";
import { GOOGLE_CALENDAR_COLORS } from "../constants.js";

export const utilitiesApp = () => {
  //
  const checkRequiredFields = <T extends Record<string, any>>(data: T) =>
    Object.entries(data).reduce<string[]>((acc, [key, value]) => {
      if (
        value === null ||
        value === undefined ||
        (typeof value === "string" && !value.trim())
      ) {
        const formattedKey =
          key === "confirmPassword" ? "confirm password" : key;
        acc.push(formattedKey);
      }
      return acc;
    }, []);

  /**
   * Convert a string "DD-MM-YYYY HH:MM" at a valid object Date.
   */
  function parseCustomDate(dateStr: string): Date | null {
    const regex = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/;
    const match = dateStr.trim().match(regex);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);

    // 1. Validate basic calendar and clock ranges
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hours < 0 || hours > 23) return null;
    if (minutes < 0 || minutes > 59) return null;

    // 2. Create the Date object (months in JS range from 0 to 11)
    const dateObj = new Date(year, month - 1, day, hours, minutes);

    // 3. Check that JS has not exceeded the number of days (e.g., February 31st or April 31st)
    if (
      dateObj.getFullYear() !== year ||
      dateObj.getMonth() !== month - 1 ||
      dateObj.getDate() !== day
    ) {
      return null;
    }

    return isNaN(dateObj.getTime()) ? null : dateObj;
  }

  //
  function buildColorKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    let count = 0;

    for (const [id, color] of Object.entries(GOOGLE_CALENDAR_COLORS)) {
      keyboard.text(`${color.emoji} ${color.name}`, `color_${id}`);
      count++;
      if (count % 3 === 0) keyboard.row(); // 3 buttons per row
    }

    keyboard.row().text("➡️ Skip", "skip_color");
    return keyboard;
  }

  // Helper to safely escape HTML in Telegram
  function escapeHtml(text?: string): string {
    if (!text) return "N/A";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  //
  function getExampleDate(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const day = String(tomorrow.getDate()).padStart(2, "0");
    const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const year = tomorrow.getFullYear();
    // const hours = String(tomorrow.getHours()).padStart(2, "0");
    // const minutes = "00";

    return `${day}-${month}-${year}`;
  }

  return {
    parseCustomDate,
    checkRequiredFields,
    buildColorKeyboard,
    escapeHtml,
    getExampleDate,
  };
};
