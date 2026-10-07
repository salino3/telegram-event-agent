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
      await ctx.reply("🔍 I couldn't find any data matching your request.");
      return;
    }

    const firstRow = eventsRes.rows[0];

    // 4. CASE A: Check if the query returned an event list (has 'id')
    if ("id" in firstRow) {
      await ctx.reply(`🤖 I found ${eventsRes.rows.length} matching event(s):`);

      for (const row of eventsRes.rows) {
        await sendUpdatedEventCard(ctx, row.id, String(telegramId));
      }
      return;
    }

    // 5. CASE B: Handle Aggregate Queries (e.g., COUNT(*), SUM, MAX, MIN)
    // Example: SELECT COUNT(*) FROM events ... -> returns { count: '5' }
    const keys = Object.keys(firstRow);

    if (keys.length === 1) {
      const singleValue = firstRow[keys[0]];

      // If user asked for count/how many
      if (keys[0].toLowerCase().includes("count")) {
        await ctx.reply(`📊 You have **${singleValue}** matching event(s).`, {
          parse_mode: "Markdown",
        });
      } else {
        await ctx.reply(`📊 Result: **${singleValue}**`, {
          parse_mode: "Markdown",
        });
      }
      return;
    }

    // 6. CASE C: Generic row formatting fallback (multi-column non-event SELECTs)
    let summaryText = "📊 **Query Results:**\n\n";
    for (const row of eventsRes.rows) {
      summaryText +=
        Object.entries(row)
          .map(([k, v]) => `• **${k}**: ${v}`)
          .join("\n") + "\n\n";
    }
    await ctx.reply(summaryText, { parse_mode: "Markdown" });
  } catch (error: any) {
    console.error("AI Prompt Detailed Error:", {
      message: error?.message,
      stack: error?.stack,
      errorObject: error,
    });
    await ctx.reply("⚠️ An error occurred while searching your schedule.");
  }
}
