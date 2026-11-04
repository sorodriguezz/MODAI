import { execFile } from "node:child_process";
import { arch, cpus, freemem, machine, platform, totalmem } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);
const GiB = 1024 ** 3;
export interface Hardware {
  platform: string;
  architecture: string;
  processArchitecture: string;
  cpu: string;
  threads: number;
  ramGiB: number;
  availableRamGiB: number;
  gpus: Array<{ name: string; memoryGiB?: number; freeGiB?: number }>;
  appleSilicon: boolean;
  notes: string[];
}

async function run(command: string, args: string[]): Promise<string> {
  try {
    return (await exec(command, args, { timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
  } catch {
    return "";
  }
}

async function detectMac(h: Hardware): Promise<void> {
  const [arm, chip, displays] = await Promise.all([
    run("sysctl", ["-n", "hw.optional.arm64"]),
    run("sysctl", ["-n", "machdep.cpu.brand_string"]),
    run("system_profiler", ["SPDisplaysDataType", "-json"]),
  ]);
  h.appleSilicon = arm === "1" || h.processArchitecture === "arm64";
  if (chip) h.cpu = chip;
  if (h.appleSilicon) h.architecture = "arm64";
  try {
    const data = JSON.parse(displays) as { SPDisplaysDataType?: Array<{ sppci_model?: string }> };
    h.gpus = (data.SPDisplaysDataType ?? []).map((g) => ({ name: g.sppci_model ?? "GPU Apple" }));
  } catch {
    h.notes.push("No se pudo consultar la GPU; se mantiene una estimación conservadora.");
  }
  h.notes.push(
    h.appleSilicon
      ? "Apple Silicon usa memoria unificada; la RAM y la VRAM no se suman. Ollama decide la aceleración efectiva."
      : "Ollama en Mac Intel usa CPU; no se presupone aceleración por una GPU AMD instalada.",
  );
  if (h.appleSilicon && h.processArchitecture !== "arm64")
    h.notes.push("Node está bajo emulación. Instala Node ARM64 y un runtime nativo para este equipo.");
}

async function detectWindows(h: Hardware): Promise<void> {
  h.architecture = process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE ?? h.architecture;
  const output = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress",
  ]);
  try {
    const names: unknown = JSON.parse(output);
    h.gpus = (Array.isArray(names) ? names : [names])
      .filter((v): v is string => typeof v === "string")
      .map((name) => ({ name }));
  } catch {
    h.gpus = [];
  }
  if (/arm/i.test(h.architecture))
    h.notes.push(
      "Windows ARM: comprueba que tu runtime y sus drivers soporten este equipo. No se supone CUDA/ROCm por detectar ARM o una GPU Qualcomm.",
    );
}

async function detectLinux(h: Hardware): Promise<void> {
  const pci = await run("lspci", ["-mm"]);
  h.gpus = pci
    .split("\n")
    .filter((line) => /VGA|3D controller|Display controller/i.test(line))
    .map((name) => ({ name }));
}

async function detectNvidia(h: Hardware): Promise<void> {
  const nvidia = await run("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ]);
  for (const line of nvidia.split("\n").filter(Boolean)) {
    const [name, total, free] = line.split(",").map((v) => v.trim());
    if (Number(total) > 0 && Number.isFinite(Number(free))) {
      h.gpus = h.gpus.filter((g) => !g.name.toLowerCase().includes(name.toLowerCase()));
      h.gpus.push({ name, memoryGiB: Number(total) / 1024, freeGiB: Number(free) / 1024 });
    }
  }
}

const PLATFORM_DETECTORS: Record<string, (h: Hardware) => Promise<void>> = {
  darwin: detectMac,
  win32: detectWindows,
  linux: detectLinux,
};

export async function detectHardware(): Promise<Hardware> {
  const h: Hardware = {
    platform: platform(),
    architecture: machine(),
    processArchitecture: arch(),
    cpu: cpus()[0]?.model ?? "Desconocida",
    threads: cpus().length || 1,
    ramGiB: totalmem() / GiB,
    availableRamGiB: freemem() / GiB,
    gpus: [],
    appleSilicon: false,
    notes: [],
  };
  await PLATFORM_DETECTORS[h.platform]?.(h);
  if (h.platform !== "darwin") await detectNvidia(h);
  if (h.gpus.some((g) => /AMD|Radeon|Intel|Qualcomm/i.test(g.name)))
    h.notes.push(
      "La detección de GPU no prueba compatibilidad: ROCm/Vulkan y drivers los decide el runtime. Se conserva CPU como alternativa.",
    );
  return h;
}

function chatModelFor(accelerated: boolean, ramBudget: number, appleSilicon: boolean, gpuFree: number): string {
  if (accelerated && ramBudget >= 12 && (appleSilicon || gpuFree >= 12)) return "qwen3.5:9b";
  if (accelerated && ramBudget >= 7 && (appleSilicon || gpuFree >= 6)) return "qwen3.5:4b";
  if (ramBudget >= 5) return "qwen3.5:2b";
  return "qwen3.5:0.8b";
}

function embeddingModelFor(
  preference: "balanced" | "quality",
  accelerated: boolean,
  ramBudget: number,
  appleSilicon: boolean,
  gpuFree: number,
): string {
  if (preference === "quality" && accelerated && ramBudget >= 8 && (appleSilicon || gpuFree >= 8))
    return "qwen3-embedding:4b";
  return accelerated && ramBudget >= 3 ? "qwen3-embedding:0.6b" : "embeddinggemma-2:270m";
}

function backendFor(appleSilicon: boolean, gpuFree: number): string {
  if (appleSilicon) return "Apple Silicon / Metal (a confirmar con el runtime)";
  return gpuFree ? "NVIDIA candidata; comprobar offload real" : "CPU; otra aceleración solo si el runtime la confirma";
}

export function recommendModels(h: Hardware, preference: "balanced" | "quality" = "balanced") {
  const ramBudget = Math.max(0, Math.min(h.ramGiB * 0.5, h.availableRamGiB - 1.5));
  const gpuFree = Math.max(0, ...h.gpus.map((g) => g.freeGiB ?? 0));
  const accelerated = h.appleSilicon || gpuFree >= 3;
  return {
    embeddingModel: embeddingModelFor(preference, accelerated, ramBudget, h.appleSilicon, gpuFree),
    chatModel: chatModelFor(accelerated, ramBudget, h.appleSilicon, gpuFree),
    preference,
    memoryBudgetGiB: Math.round(ramBudget * 10) / 10,
    canEmbed: ramBudget >= 1.5,
    batchSize: accelerated && ramBudget >= 4 ? 4 : 1,
    estimatedBackend: backendFor(h.appleSilicon, gpuFree),
    explanation:
      "Heurística conservadora para texto multilingüe y código; no es un benchmark de calidad ni garantiza que un modelo quepa. Reduce el modelo si compartes memoria con otros procesos.",
    alternatives: ["embeddinggemma-2:270m", "embeddinggemma:300m", "qwen3-embedding:0.6b", "qwen3-embedding:4b"],
  };
}
