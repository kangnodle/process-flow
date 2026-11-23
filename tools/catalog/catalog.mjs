function invalid(message) {
  throw new Error(`Invalid task form catalog: ${message}`);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function localized(value, location) {
  if (
    !object(value) ||
    Object.keys(value).length !== 2 ||
    !["ko", "en"].every(
      (locale) => typeof value[locale] === "string" && value[locale].trim(),
    )
  ) {
    invalid(`${location} requires nonempty ko and en text`);
  }
  return { ko: value.ko, en: value.en };
}

function validateField(field, location) {
  if (!object(field) || typeof field.id !== "string" || !field.id.trim())
    invalid(`${location} requires an id`);
  if (
    Object.keys(field).some(
      (key) => !["id", "label", "hint", "allowNotApplicable"].includes(key),
    )
  )
    invalid(`${location} has an unknown field`);
  if (
    field.allowNotApplicable !== undefined &&
    typeof field.allowNotApplicable !== "boolean"
  )
    invalid(`${location} allowNotApplicable must be boolean`);
  return {
    id: field.id,
    label: localized(field.label, `${location}.label`),
    hint: localized(field.hint, `${location}.hint`),
    ...(field.allowNotApplicable === undefined
      ? {}
      : { allowNotApplicable: field.allowNotApplicable }),
  };
}

function normalizeCatalog(catalog) {
  if (!object(catalog) || Object.keys(catalog).length === 0)
    invalid("expected a nonempty task object");
  return Object.fromEntries(
    Object.keys(catalog).map((task) => {
      if (
        !task.trim() ||
        !Array.isArray(catalog[task]) ||
        catalog[task].length === 0
      )
        invalid(`${task} requires fields`);
      const fields = catalog[task].map((field, index) =>
        validateField(field, `${task}[${index}]`),
      );
      if (new Set(fields.map(({ id }) => id)).size !== fields.length)
        invalid(`${task} has duplicate field ids`);
      return [task, fields];
    }),
  );
}

function rustString(value) {
  return `"${[...value]
    .map((character) => {
      if (character === '"') return '\\"';
      if (character === "\\") return "\\\\";
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      const code = character.codePointAt(0);
      return code < 32 || code === 127
        ? `\\u{${code.toString(16)}}`
        : character;
    })
    .join("")}"`;
}

export function generateCatalog(input) {
  const catalog = normalizeCatalog(input);
  const entries = Object.entries(catalog).map(([task, fields]) => {
    const values = fields.map(
      ({ id, allowNotApplicable = false }) =>
        `TaskField { id: ${rustString(id)}, allow_not_applicable: ${allowNotApplicable} }`,
    );
    const compact = `    (${rustString(task)}, &[${values.join(", ")}]),`;
    if (compact.length <= 120) return compact;
    return [
      `    (`,
      `        ${rustString(task)},`,
      "        &[",
      ...values.map((value) => `            ${value},`),
      "        ],",
      "    ),",
    ].join("\n");
  });
  return {
    frontend: `${JSON.stringify(catalog, null, 2)}\n`,
    rust: [
      "use super::TaskField;",
      "",
      "pub(super) const TASK_FORMS: &[(&str, &[TaskField])] = &[",
      ...entries,
      "];",
      "",
    ].join("\n"),
  };
}
