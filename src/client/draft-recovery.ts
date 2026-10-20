interface EditableField {
  tagName: string;
  type: string;
  name: string;
  id: string;
  value: string;
  getAttribute(name: string): string | null;
  labels?: ArrayLike<{
    children: ArrayLike<{ tagName: string; textContent: string | null }>;
  }> | null;
}

export function createDraftRecovery() {
  const ids = new WeakMap<object, number>();
  const edits = new Map<number, { label: string; value: string }>();
  let nextId = 0;
  return {
    capture(field: EditableField) {
      if (
        !["INPUT", "TEXTAREA", "SELECT"].includes(field.tagName) ||
        ["password", "file", "hidden"].includes(field.type)
      ) return;
      let id = ids.get(field);
      if (id === undefined) { id = nextId++; ids.set(field, id); }
      // Field labels wrap their controls: reading the whole label would also
      // capture textarea contents. Only the dedicated caption is a label.
      const caption = Array.from(field.labels?.[0]?.children ?? [])
        .find((child) => child.tagName === "SPAN")?.textContent?.trim();
      const label = field.getAttribute("aria-label") || field.name ||
        field.id || caption || `Campo ${id + 1}`;
      edits.set(id, { label, value: field.value });
    },
    size: () => edits.size,
    text: () => [...edits.values()].map(({ label, value }) => `${label}: ${value}`).join("\n"),
  };
}
