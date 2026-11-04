import { askSecret } from "../terminal/prompts.js";

export async function readAccessToken(fromStdin = false): Promise<string> {
  let token: string;
  if (fromStdin) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (Buffer.byteLength(value) > 4096) throw new Error("El token supera 4 KiB");
    }
    token = value.trim();
  } else {
    if (!process.stdin.isTTY)
      throw new Error("Falta una API key. Usa MODAI_API_TOKEN o modai server connect <url> --token-stdin.");
    token = await askSecret("API key de MODAI (no se muestra)", "--token-stdin o MODAI_API_TOKEN");
  }
  if (!token || token.length > 4096 || /\s/.test(token)) throw new Error("API key vacía o inválida");
  return token;
}
