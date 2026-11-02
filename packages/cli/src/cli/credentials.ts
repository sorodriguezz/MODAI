import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export async function readAccessToken(fromStdin = false): Promise<string> {
  let token: string;
  if (fromStdin) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (Buffer.byteLength(value) > 4096)
        throw new Error("El token supera 4 KiB");
    }
    token = value.trim();
  } else {
    if (!process.stdin.isTTY)
      throw new Error(
        "Falta una API key. Usa MODAI_API_TOKEN o modai connect <url> --token-stdin.",
      );
    process.stderr.write("API key de MODAI (entrada oculta): ");
    const hidden = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const reader = createInterface({
      input: process.stdin,
      output: hidden,
      terminal: true,
      historySize: 0,
    });
    try {
      token = await new Promise<string>((resolve, reject) => {
        reader.once("SIGINT", () => reject(new Error("Conexión cancelada")));
        reader.once("close", () =>
          reject(new Error("Entrada de token cancelada")),
        );
        reader.question("", resolve);
      });
    } finally {
      reader.close();
      process.stderr.write("\n");
    }
    token = token.trim();
  }
  if (!token || token.length > 4096 || /\s/.test(token))
    throw new Error("API key vacía o inválida");
  return token;
}
