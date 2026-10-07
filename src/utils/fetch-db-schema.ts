import { queryReadOnly } from "../db.js";

async function fetchDbSchema(): Promise<string> {
  try {
    const columnsRes = await queryReadOnly(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      ORDER BY table_name, ordinal_position;
    `);

    const fkRes = await queryReadOnly(`
      SELECT
        kcu.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
    `);

    const schemaMap: Record<string, string[]> = {};
    for (const row of columnsRes.rows) {
      if (!schemaMap[row.table_name]) {
        schemaMap[row.table_name] = [];
      }
      schemaMap[row.table_name].push(`${row.column_name} (${row.data_type})`);
    }

    const tablesText = Object.entries(schemaMap)
      .map(([table, cols]) => `Table ${table}: ${cols.join(", ")}`)
      .join("\n");

    const fkText = fkRes.rows
      .map(
        (fk) =>
          `- ${fk.source_table}.${fk.source_column} -> ${fk.target_table}.${fk.target_column}`,
      )
      .join("\n");

    return `TABLES:\n${tablesText}\n\nRELATIONSHIPS:\n${fkText}`;
  } catch (error) {
    console.error("❌ Failed to fetch DB schema:", error);
    return "";
  }
}

// ⚡ Top-level await executes ONCE when Node.js imports this file
export const cachedDbSchema = await fetchDbSchema();
