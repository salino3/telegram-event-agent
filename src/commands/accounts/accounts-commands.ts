import { Composer, InlineKeyboard } from "grammy";
import { query } from "../../db.js";

export const accountsComposer = new Composer();

/**
 * /accounts - List linked Google accounts and manage defaults
 */
accountsComposer.command("accounts", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // 1. Fetch user's connected accounts
  const res = await query(
    `SELECT ga.id, ga.email, ga.is_default 
     FROM google_accounts ga
     JOIN accounts a ON ga.account_id = a.id
     WHERE a.telegram_id = $1
     ORDER BY ga.created_at ASC`,
    [String(telegramId)],
  );

  if (res.rows.length === 0) {
    return ctx.reply(
      "❌ <b>No connected Google accounts found.</b>\n\nUse /connect_google to link your Google Calendar.",
      { parse_mode: "HTML" },
    );
  }

  // 2. Format list text
  let messageText = "📧 <b>Your Connected Google Accounts:</b>\n\n";
  const keyboard = new InlineKeyboard();

  res.rows.forEach(
    (acc: { id: number; email: string; is_default: boolean }) => {
      const statusIcon = acc.is_default ? "🌟 <b>(Default)</b>" : "⚪";
      messageText += `• <code>${acc.email}</code> ${statusIcon}\n`;

      // Add inline actions for non-default accounts or explicit management
      if (!acc.is_default) {
        keyboard
          .text(`🌟 Set ${acc.email} Default`, `set_default_acc_${acc.id}`)
          .row();
      }
      keyboard.text(`🗑️ Remove ${acc.email}`, `remove_acc_${acc.id}`).row();
    },
  );

  messageText +=
    "\n<i>Use the buttons below to switch your primary default calendar or disconnect an account.</i>";

  await ctx.reply(messageText, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

/**
 * Callback Query: Set selected account as default
 */
accountsComposer.callbackQuery(/^set_default_acc_(\d+)$/, async (ctx) => {
  const googleAccountId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from.id;

  try {
    // 1. Reset all accounts for this user to is_default = FALSE
    await query(
      `UPDATE google_accounts 
       SET is_default = FALSE 
       WHERE account_id = (SELECT id FROM accounts WHERE telegram_id = $1)`,
      [String(telegramId)],
    );

    // 2. Set chosen account to is_default = TRUE
    await query(
      `UPDATE google_accounts 
       SET is_default = TRUE 
       WHERE id = $1 AND account_id = (SELECT id FROM accounts WHERE telegram_id = $2)`,
      [googleAccountId, String(telegramId)],
    );

    await ctx.answerCallbackQuery("🌟 Default account updated successfully!");

    // 3. Edit message to confirm changes
    await ctx.editMessageText(
      "✅ <b>Default account updated!</b> Use /accounts to view your updated status.",
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error setting default account:", error);
    await ctx.answerCallbackQuery("❌ Failed to update default account.");
  }
});

/**
 * Callback Query: Disconnect/Remove Google Account
 */
accountsComposer.callbackQuery(/^remove_acc_(\d+)$/, async (ctx) => {
  const googleAccountId = parseInt(ctx.match[1], 10);
  const telegramId = ctx.from.id;

  try {
    // Delete target google_account row
    const deleteRes = await query(
      `DELETE FROM google_accounts 
       WHERE id = $1 AND account_id = (SELECT id FROM accounts WHERE telegram_id = $2)
       RETURNING is_default`,
      [googleAccountId, String(telegramId)],
    );

    if (deleteRes.rows.length === 0) {
      return ctx.answerCallbackQuery(
        "❌ Account not found or already removed.",
      );
    }

    const wasDefault = deleteRes.rows[0].is_default;

    // If the removed account was default, set the oldest remaining account as default
    if (wasDefault) {
      await query(
        `UPDATE google_accounts 
         SET is_default = TRUE 
         WHERE id = (
           SELECT id FROM google_accounts 
           WHERE account_id = (SELECT id FROM accounts WHERE telegram_id = $1)
           ORDER BY created_at ASC 
           LIMIT 1
         )`,
        [String(telegramId)],
      );
    }

    await ctx.answerCallbackQuery("🗑️ Account disconnected.");
    await ctx.editMessageText(
      "✅ <b>Google account removed!</b> Use /accounts to check remaining accounts.",
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error removing account:", error);
    await ctx.answerCallbackQuery("❌ Failed to remove account.");
  }
});
