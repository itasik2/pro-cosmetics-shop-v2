// lib/ai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY не задан в переменных окружения");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
