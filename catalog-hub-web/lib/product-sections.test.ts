import assert from "node:assert/strict";
import test from "node:test";
import { separateProductSections } from "./product-sections";

test("moves labelled directions out of the old description and keeps existing INCI", () => {
  const description = `Масло увлажняет и питает кожу. Применение связано с массажем.\n\nСпособ применения\nИспользуется для массажа и удаления DeMela Molecular Peel.\n\nСостав и активные компоненты\nКлючевые компоненты: арбутин, ниацинамид.`;
  const result = separateProductSections({ description, application: "", ingredients: "Vitis Vinifera Seed Oil" });
  assert.deepEqual(result, {
    description: "Масло увлажняет и питает кожу. Применение связано с массажем.",
    application: "Используется для массажа и удаления DeMela Molecular Peel.",
    ingredients: "Vitis Vinifera Seed Oil",
    changed: true,
  });
});

test("moves the active list when composition is missing and leaves other sections intact", () => {
  const result = separateProductSections({ description: "Увлажняющее масло.\n\nСостав: масло жожоба, арбутин.\n\nПреимущества\n• удобный формат" });
  assert.equal(result.description, "Увлажняющее масло.\n\nПреимущества\n• удобный формат");
  assert.equal(result.ingredients, "масло жожоба, арбутин.");
  assert.equal(result.application, "");
});

test("keeps ordinary sentences and empty headings unchanged", () => {
  const original = "Составляет основу ухода. Применение связано с массажем.\n\nСпособ применения";
  assert.deepEqual(separateProductSections({description: original}), {
    description: original, application: "", ingredients: "", changed: false,
  });
});
