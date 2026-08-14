export const THEME_PROFILE_VALUES = [
  "neutral",
  "spring",
  "summer",
  "autumn",
  "winter",
  "festive",
] as const;

export type ThemeProfile = (typeof THEME_PROFILE_VALUES)[number];

export const THEME_PROFILE_OPTIONS: ReadonlyArray<{
  value: ThemeProfile;
  label: string;
  description: string;
  accent: string;
  soft: string;
}> = [
  {
    value: "neutral",
    label: "Нейтральный",
    description: "Графитовый акцент для любого фона",
    accent: "#5e6972",
    soft: "#edf0f1",
  },
  {
    value: "spring",
    label: "Весенний",
    description: "Мягкий шалфейный акцент",
    accent: "#637c6e",
    soft: "#e4ece7",
  },
  {
    value: "summer",
    label: "Летний",
    description: "Приглушённый пыльно-розовый акцент",
    accent: "#8b6776",
    soft: "#efe6e9",
  },
  {
    value: "autumn",
    label: "Осенний",
    description: "Спокойный тёплый терракотовый акцент",
    accent: "#8a654f",
    soft: "#eee6e0",
  },
  {
    value: "winter",
    label: "Зимний",
    description: "Холодный серо-синий акцент",
    accent: "#62758a",
    soft: "#e5ebf0",
  },
  {
    value: "festive",
    label: "Праздничный",
    description: "Глубокий ягодный акцент без яркой фуксии",
    accent: "#7c4b5b",
    soft: "#eee3e7",
  },
];

export function normalizeThemeProfile(value: unknown): ThemeProfile {
  const profile = String(value || "").trim();
  return THEME_PROFILE_VALUES.includes(profile as ThemeProfile)
    ? (profile as ThemeProfile)
    : "neutral";
}
