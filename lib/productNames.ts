function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function casedLetters(value: string) {
  return [...value].filter(
    (letter) =>
      letter.toLocaleLowerCase("ru-RU") !==
      letter.toLocaleUpperCase("ru-RU"),
  );
}

export function isAllCapsProductName(value: unknown) {
  const name = clean(value);
  const letters = casedLetters(name);
  return Boolean(
    letters.length >= 2 &&
      letters.every(
        (letter) => letter === letter.toLocaleUpperCase("ru-RU"),
      ),
  );
}

const UPPERCASE_TERMS: Record<string, string> = {
  aha: "AHA",
  bha: "BHA",
  bb: "BB",
  cc: "CC",
  co2: "CO2",
  dna: "DNA",
  nmf: "NMF",
  ph: "pH",
  pha: "PHA",
  q10: "Q10",
  rna: "RNA",
  spf: "SPF",
  uv: "UV",
  uva: "UVA",
  uvb: "UVB",
};

function capitalizeFirstLetter(value: string) {
  const letters = [...value];
  const index = letters.findIndex(
    (letter) =>
      letter.toLocaleLowerCase("ru-RU") !==
      letter.toLocaleUpperCase("ru-RU"),
  );
  if (index < 0) return value;
  letters[index] = letters[index].toLocaleUpperCase("ru-RU");
  return letters.join("");
}

export function formatProductName(value: unknown) {
  const name = clean(value);
  if (!isAllCapsProductName(name)) return name;

  let result = name.toLocaleLowerCase("ru-RU");
  result = result.replace(/(?:[a-zа-яё]\.){2,}/giu, (term) =>
    term.toLocaleUpperCase("ru-RU"),
  );
  result = result.replace(/[a-z][a-z0-9]*/gi, (term) => {
    const normalized = term.toLowerCase();
    return (
      UPPERCASE_TERMS[normalized] ||
      `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    );
  });

  return capitalizeFirstLetter(result);
}
