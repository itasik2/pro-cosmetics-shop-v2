import assert from "node:assert/strict";
import test from "node:test";
import {
  removeEditorialBoilerplate,
  removeRepeatedIngredientList,
  sanitizeShortDescription,
} from "./openaiResponses";

test("buyer copy keeps product benefits and drops internal caveats", () => {
  const description = `JeuDerm Mela-Bright — концентрат для ухода за кожей, представленный во флаконе объёмом 20 мл. Название средства указывает на осветляющее направление ухода, однако подтверждённые свойства и целевые задачи кожи в переданных данных не указаны.

Формула содержит пептиды и ниацинамид. Роли отдельных компонентов источником не уточнены.

Средство помогает сделать тон визуально ровнее и поддерживает увлажнение кожи. Полный перечень ингредиентов приведён в отдельном поле карточки.`;
  const result = removeEditorialBoilerplate(description);
  assert.match(result, /Формула содержит пептиды и ниацинамид/u);
  assert.match(result, /помогает сделать тон визуально ровнее/u);
  assert.doesNotMatch(result, /не указаны|не уточнены|название средства указывает|полный перечень/u);
  assert.doesNotMatch(sanitizeShortDescription("Концентрат для ухода. Роли отдельных компонентов источником не уточнены."), /не уточнены/u);
});

test("full INCI list stays in its own field", () => {
  const inci = "Water, Glycerin, Propanediol, Nonapeptide-1, Glutathione, Niacinamide, Tranexamic Acid, Copper Tripeptide-1, Glycine, Alanine, Glutamic Acid, Serine, Arginine, Acetyl Hexapeptide-8, Beta-Glucan";
  const description = `Осветляющий концентрат для неровного тона кожи.\n\nСостав и активные компоненты\n${inci}`;
  assert.equal(removeRepeatedIngredientList(description, inci), "Осветляющий концентрат для неровного тона кожи.");
  assert.equal(removeRepeatedIngredientList(description, ""), description);
});
