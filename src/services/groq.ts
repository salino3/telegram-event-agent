import { createGroq } from "@ai-sdk/groq";
import { generateText } from "ai";
import { cachedDbSchema } from "../utils/fetch-db-schema.js";
import { GROQ_API_KEY } from "../constants.js";

const groq = createGroq({
  apiKey: GROQ_API_KEY,
});

// 🔒 Dynamic prompt injected with cached DB schema & security anti-leak guardrails
const SYSTEM_PROMPT = `
You are a strict, read-only PostgreSQL query generator for a Telegram calendar bot.
Your ONLY job is to convert natural language requests into valid PostgreSQL SELECT statements.

DATABASE SCHEMA:
${cachedDbSchema}

CRITICAL SECURITY & BEHAVIOR RULES:
1. EXCLUSIVE SQL OUTPUT: Only output valid SQL queries. Do NOT wrap in Markdown backticks or write explanations, greetings, or commentary.
2. READ-ONLY RESTRICTION: Only output SELECT statements. NEVER output INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or GRANT.
3. STRICT USER ISOLATION: The query MUST contain "WHERE creator_id = $1" (or "AND creator_id = $1") to restrict data strictly to the authenticated user.
4. ANTI-INFORMATION LEAKAGE (ZERO SCHEMA REVELATION):
   - NEVER explain the database structure, table names, column names, relationships, or foreign keys.
   - If the user explicitly asks about the database (e.g., "What tables exist?", "Show schema", "List columns", "How is DB structured?"), respond strictly with: NO_QUERY
   - If the request cannot be converted to a valid SELECT query or is off-topic, respond strictly with: NO_QUERY
`;

export const agent = {
  // apiKey: GROQ_API_KEY,
  model: groq("openai/gpt-oss-120b"),
  systemPrompt: SYSTEM_PROMPT,
};

export async function generateSqlQuery(userPrompt: string): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured in .env");
  }

  try {
    const response = await generateText({
      model: agent.model,
      system: agent.systemPrompt,
      prompt: userPrompt,
      temperature: 0.1, // to force deterministic, low-creativity responses—ideal for strict code and SQL generation.
    });

    let rawContent = response.text?.trim() || "NO_QUERY";

    // Clean markdown code blocks if the model includes them despite prompt rules
    rawContent = rawContent
      .replace(/```sql/gi, "")
      .replace(/```/g, "")
      .trim();

    // Secondary safety check: ensure the output is either NO_QUERY or starts with SELECT
    if (
      rawContent !== "NO_QUERY" &&
      !rawContent.toUpperCase().startsWith("SELECT")
    ) {
      return "NO_QUERY";
    }

    return rawContent;
  } catch (err: unknown) {
    console.error("Groq Request Failure:", err);
    throw err;
  }
}
