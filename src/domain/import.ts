import type { Lead } from "./model.ts";
export interface ImportPreview {
  headers: string[];
  rows: string[][];
  errors: { line: number; message: string }[];
}
export function parseContactImport(text: string): ImportPreview {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  const delimiter = first.includes("\t")
    ? "\t"
    : first.split(";").length > first.split(",").length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  const errors: ImportPreview["errors"] = [];
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
        if (quoted) quoteLine = line;
      }
    } else if (c === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      line++;
    } else {
      cell += c;
      if (c === "\n") line++;
    }
  }
  if (quoted)
    errors.push({ line: quoteLine, message: "Aspas não foram fechadas." });
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() ?? [];
  if (!headers.length)
    errors.push({
      line: 1,
      message: "Adicione um cabeçalho e pelo menos um contato.",
    });
  return { headers, rows, errors };
}
export function mapImportedContacts(
  preview: ImportPreview,
  mapping: Partial<
    Record<"name" | "email" | "phone" | "site" | "city" | "state", number>
  >,
  listId: string,
) {
  const leads: Lead[] = [];
  const errors = [...preview.errors];
  preview.rows.forEach((row, i) => {
    const get = (key: keyof typeof mapping) => {
      const n = mapping[key];
      return n === undefined || n < 0 ? undefined : row[n]?.trim() || undefined;
    };
    const name = get("name");
    if (!name) {
      errors.push({ line: i + 2, message: "Nome obrigatório." });
      return;
    }
    leads.push({
      id: crypto.randomUUID(),
      listId,
      name,
      email: get("email"),
      phone: get("phone"),
      site: get("site"),
      city: get("city"),
      state: get("state"),
      source: "MANUAL",
      qualification: "pending",
      createdAt: new Date().toISOString(),
    });
  });
  return { leads, errors };
}
