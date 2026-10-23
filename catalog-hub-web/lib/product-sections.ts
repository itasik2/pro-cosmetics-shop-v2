type CopyFields = { description: string; application?: string | null; ingredients?: string | null };

type Section = "application" | "ingredients";
const sectionHeading = /^(способ применения|применение|состав(?: и активные компоненты)?|inci)(?:\s*[:：]\s*(.*))?\s*$/iu;
const otherHeading = /^(?:для каких задач|для какой кожи|преимущества|характеристики|описание)\s*[:：]?$/iu;

/** Move only explicitly labelled sections; leave existing separate fields intact. */
export function separateProductSections(fields: CopyFields) {
  const original = fields.description || "";
  const lines = original.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  const found: Record<Section, string[]> = { application: [], ingredients: [] };
  let active: Section | null = null;
  let sectionLines: string[] = [];
  let heading = "";
  let moved = 0;

  function flush() {
    if (active) {
      const content = sectionLines.join("\n").trim();
      if (content) { found[active].push(content); moved++; }
      else kept.push(heading, ...sectionLines);
    }
    active = null;
    sectionLines = [];
    heading = "";
  }

  for (const line of lines) {
    const match = line.trim().match(sectionHeading);
    if (match) {
      flush();
      active = /^(?:способ применения|применение)$/iu.test(match[1]) ? "application" : "ingredients";
      heading = line;
      if (match[2]) sectionLines.push(match[2]);
    } else if (active && otherHeading.test(line.trim())) {
      flush();
      kept.push(line);
    } else if (active) {
      sectionLines.push(line);
    } else {
      kept.push(line);
    }
  }
  flush();

  if (!moved) return {
    description: original,
    application: fields.application || "",
    ingredients: fields.ingredients || "",
    changed: false,
  };

  const description = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const application = fields.application?.trim() || found.application.join("\n\n").trim();
  const ingredients = fields.ingredients?.trim() || found.ingredients.join("\n\n").trim();
  return {
    description, application, ingredients,
    changed: description !== original.trim() || application !== (fields.application || "").trim() ||
      ingredients !== (fields.ingredients || "").trim(),
  };
}
