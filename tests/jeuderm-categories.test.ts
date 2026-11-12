import assert from "node:assert/strict";
import test from "node:test";
import { suggestJeudermCategory } from "../lib/price-import/jeudermCategories";

const recognized: Array<[string, string]> = [
  ["Acno Cell Mild Cleanser", "Проблемная кожа"],
  ["AcnoCel Treatment Gel", "Проблемная кожа"],
  ["AcnoCell Multi - Acid Pad", "Проблемная кожа"],
  ["Adaptive Skin Detox Mask", "Дренаж"],
  ["Adaptive Skin Probio Emulsion", "Восстановление кожного барьера"],
  ["Ala Factor Energo Toner", "Антивозрастной уход"],
  ["BB крем Perfector spf 40 PA+++", "Защита от солнца"],
  ["Carboxy Therapy Mask", "Карбокситерапия"],
  ["Cream Forte Lift Intense", "Антивозрастной уход"],
  ["Demela Molecular Peel", "Пилинги"],
  ["Demela Molecular Oil", "Пилинги"],
  ["Hydrogel Mask", "Увлажнение"],
  ["Intesive Hyal Hydratant", "Увлажнение"],
  ["Mask Black for White", "Осветление"],
  ["Megapolis Universal Clean", "Очищение и тонизация"],
  ["My Ato Toner Mousse", "Чувствительная кожа"],
  ["PPS восстанавливающий гель", "Регенерация"],
  ["Reform Age Eye Cream", "Глаза и губы"],
  ["Reforme Age Mild Cleanser", "Очищение и тонизация"],
  ["Reforme Age Ghost Mask", "Антивозрастной уход"],
  ["Rejusome Exo Boost Lip Balm", "Уход за губами"],
  ["Rejusome Exo Boost Mist", "Увлажнение"],
  ["Rejusome Exo Boost Serum", "Регенерация"],
  ["Repair Mask Post - Procedure", "Регенерация"],
  ["Концентрат Hair Growth", "Уход за волосами и душем"],
  ["Концентрат Mela - Bright", "Осветление"],
  ["Концентрат Reju - Wrinkle", "Антивозрастной уход"],
  ["Крем для глаз Rejusome Exo Boost", "Глаза и губы"],
];

test("recognized JeuDerm products receive existing catalog categories", () => {
  for (const [name, expected] of recognized) {
    assert.equal(suggestJeudermCategory(name), expected, name);
  }
});

test("unknown products remain uncategorized rather than being guessed", () => {
  assert.equal(suggestJeudermCategory("New peptide complex alpha"), null);
  assert.equal(suggestJeudermCategory(""), null);
});
