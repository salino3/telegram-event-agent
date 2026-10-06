import { GROQ_API_KEY } from "../constants.js";

const SYSTEM_PROMPT = `
You are an intelligent calendar assistant for a Telegram bot.
You convert natural language requests from users into PostgreSQL SELECT queries to fetch their events.

CRITICAL RULES:
1. ONLY return valid SQL queries. DO NOT wrap in Markdown backticks or write explanations.
2. Only output SELECT statements. Never output INSERT, UPDATE, DELETE, or DROP.
3. IMPORTANT: The query MUST include: "WHERE creator_id = $1" to restrict access strictly to the authenticated user.
4. Available Schema:
   Table: events
   Columns: id (INT), creator_id (INT), title (TEXT), priority (TEXT: 'low','medium','high'), location (TEXT), start_time (TIMESTAMP), end_time (TIMESTAMP)

If the user request cannot be converted to a query, respond strictly with: NO_QUERY
`;

export async function generateSqlQuery(userPrompt: string): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured in .env");
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1, // to force deterministic, low-creativity responses—ideal for strict code and SQL generation.
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Groq Status Error (${response.status}):`, errText);
      throw new Error(`Groq API Error: ${response.status} - ${errText}`);
    }

    const data = (await response.json()) as any;
    let rawContent = data.choices[0]?.message?.content?.trim() || "NO_QUERY";

    // Clean markdown code blocks if the model includes them despite prompt rules
    rawContent = rawContent
      .replace(/```sql/gi, "")
      .replace(/```/g, "")
      .trim();

    return rawContent;
  } catch (err: any) {
    console.error("Groq Request Failure:", err);
    throw err;
  }
}
