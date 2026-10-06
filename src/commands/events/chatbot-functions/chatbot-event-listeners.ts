import { Context } from "grammy";
import { queryReadOnly } from "../../../db.js";
import { generateSqlQuery } from "../../../services/groq.js";
import { sendUpdatedEventCard } from "../events-utils.js";

// Priority Ordering: If a user is in the middle of creating an event (Wizard Form),
//  the wizard takes precedence over AI queries so they don't accidentally query Groq
//  while filling out event fields.
export async function handleAiUserPrompt(ctx: Context) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const userPrompt = ctx.message?.text;
  if (!userPrompt) return;

  try {
    await ctx.replyWithChatAction("typing");

    // 1. Fetch user's internal account ID using read-only DB
    const accountRes = await queryReadOnly(
      "SELECT id FROM accounts WHERE telegram_id = $1",
      [String(telegramId)],
    );

    if (accountRes.rows.length === 0) {
      await ctx.reply("❌ Account not found. Please run /start first.");
      return;
    }

    const internalAccountId = accountRes.rows[0].id;

    // 2. Ask Groq for the SQL SELECT query
    const sqlQuery = await generateSqlQuery(userPrompt);

    if (
      sqlQuery === "NO_QUERY" ||
      !sqlQuery.toUpperCase().startsWith("SELECT")
    ) {
      await ctx.reply(
        "🤖 I couldn't find a matching SQL query for that request. Try asking about your upcoming schedule.",
      );
      return;
    }

    // 3. Execute query on READ-ONLY DB connection
    const eventsRes = await queryReadOnly(sqlQuery, [internalAccountId]);

    if (eventsRes.rows.length === 0) {
      await ctx.reply("🔍 I couldn't find any events matching your request.");
      return;
    }

    await ctx.reply(`🤖 I found ${eventsRes.rows.length} matching event(s):`);

    // 4. Render native event cards with [ ✏️ Edit ] and [ 🗑️ Delete ] buttons
    for (const row of eventsRes.rows) {
      await sendUpdatedEventCard(ctx, row.id, String(telegramId));
    }
  } catch (error) {
    console.error("AI Prompt Handling Error:", error);
    await ctx.reply("⚠️ An error occurred while searching your schedule.");
  }
}
