import { GROQ_API_KEY } from "../constants.js";

const SYSTEM_PROMPT = `
You are an intelligent calendar assistant for a Telegram bot.
You convert natural language requests from users into PostgreSQL SELECT queries to fetch their events.

CRITICAL RULES:
1. ONLY return valid SQL queries. DO NOT wrap in Markdown backticks or write explanations.
2. Only output SELECT statements. Never output INSERT, UPDATE, DELETE, or DROP.
3. IMPORTANT, the query MUST include: "WHERE creator_id = $1" to restrict access strictly to the authenticated user.
4. Available Schema:
   Table: events
   Columns: id (INT), creator_id (INT), title (TEXT), priority (TEXT: 'low','medium','high'), location (TEXT), start_time (TIMESTAMP), end_time (TIMESTAMP)

If the user request cannot be converted to a query, respond strictly with: NO_QUERY
`;

export async function generateSqlQuery(userPrompt: string): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured in .env");
  }

  // Call Groq Cloud API (OpenAI compatible endpoint)
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        // Llama 3.3 70B on Groq is fast and accurate for SQL generation
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API Error: ${response.status} - ${errText}`);
  }

  const data = (await response.json()) as any;
  return data.choices[0]?.message?.content?.trim() || "NO_QUERY";
}
