import { GoogleGenAI } from "@google/genai";
async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: "undefined" });
    await ai.models.generateContent({ model: "gemini-1.5-flash", contents: "hi" });
  } catch (e) {
    console.error("UNDEFINED:", e.message);
  }
  try {
    const ai2 = new GoogleGenAI({ apiKey: "" });
    await ai2.models.generateContent({ model: "gemini-1.5-flash", contents: "hi" });
  } catch (e) {
    console.error("EMPTY:", e.message);
  }
}
test();
