// Interactive terminal: colors (chalk) and prompts (@inquirer/prompts). Both stand down when nobody is at the keyboard
// (--json, CI, a pipe, NO_COLOR): colors disappear and a missing value fails naming the flag to pass, it never hangs.
// Prompts write to stderr so stdout stays clean for pipes. Works the same on Linux, macOS and Windows terminals.

import { checkbox, confirm, input, password, search, select } from "@inquirer/prompts";
import chalk, { Chalk, type ChalkInstance } from "chalk";
import { isJsonMode } from "./output.js";

const plain = new Chalk({ level: 0 });
const promptContext = { output: process.stderr, clearPromptOnDone: false };

// Inquirer's key help is in English: the CLI speaks Spanish everywhere else.
const ACTIONS: Record<string, string> = {
  navigate: "moverse",
  select: "marcar",
  all: "todas",
  invert: "invertir",
  submit: "confirmar",
  toggle: "marcar",
};
const keysHelpTip = (keys: Array<[key: string, action: string]>) =>
  keys
    .map(([key, action]) => `${paint().bold(key)} ${paint().dim(ACTIONS[action] ?? action)}`)
    .join(paint().dim(" • "));
const listTheme = { style: { keysHelpTip } };

/** A person is at the keyboard: prompts are allowed. */
export function interactive(): boolean {
  return (
    Boolean(process.stdin.isTTY && process.stderr.isTTY) &&
    !isJsonMode() &&
    !process.env.CI &&
    process.env.MODAI_NO_PROMPT !== "1"
  );
}

/** Colors for this run: chalk detects NO_COLOR, FORCE_COLOR, pipes and the terminal's support; --json never has them. */
export function paint(): ChalkInstance {
  return isJsonMode() ? plain : chalk;
}

export const ok = (text: string) => `${paint().green("✔")} ${text}`;
export const warn = (text: string) => `${paint().yellow("!")} ${text}`;
export const hint = (text: string) => paint().dim(text);
export const code = (text: string) => paint().cyan(text);

/** Ctrl+C or Esc inside a prompt: the command ends quietly with exit code 130, like any cancelled terminal program. */
export function isPromptCancel(error: unknown): boolean {
  return error instanceof Error && (error.name === "ExitPromptError" || error.name === "AbortPromptError");
}

function missing(flag: string): never {
  throw new Error(`Falta ${flag}. En modo no interactivo (CI, --json o sin terminal) indícalo en el comando.`);
}

/** Text with an example shown as placeholder and an optional default (Enter accepts it). */
export async function askText(options: {
  message: string;
  flag: string;
  default?: string;
  example?: string;
  validate?: (value: string) => string | true;
}): Promise<string> {
  if (!interactive()) return options.default ?? missing(options.flag);
  const answer = await input(
    {
      message:
        options.example && options.default === undefined
          ? `${options.message} ${hint(`ej. ${options.example}`)}`
          : options.message,
      ...(options.default !== undefined ? { default: options.default } : {}),
      validate: (value: string) => {
        if (!value.trim() && options.default === undefined)
          return options.example ? `Obligatorio. Ejemplo: ${options.example}` : "Obligatorio";
        return options.validate?.(value.trim()) ?? true;
      },
    },
    promptContext,
  );
  return answer.trim();
}

export async function askSecret(message: string, flag: string): Promise<string> {
  if (!interactive()) missing(flag);
  return (
    await password({ message, mask: "•", validate: (value) => (value.trim() ? true : "Obligatorio") }, promptContext)
  ).trim();
}

/** Yes/no. Without a terminal it fails instead of assuming (destructive actions need --yes). */
export async function askConfirm(
  message: string,
  options: { default?: boolean; flag?: string } = {},
): Promise<boolean> {
  if (!interactive()) missing(options.flag ?? "--yes");
  return confirm({ message, default: options.default ?? false }, promptContext);
}

export interface Choice<T> {
  value: T;
  name?: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean | string;
}

export async function askSelect<T>(options: {
  message: string;
  flag: string;
  choices: Array<Choice<T>>;
  default?: T;
}): Promise<T> {
  if (!interactive()) return options.default ?? missing(options.flag);
  return select(
    {
      message: options.message,
      choices: options.choices,
      ...(options.default !== undefined ? { default: options.default } : {}),
      pageSize: 12,
      theme: listTheme,
    },
    promptContext,
  );
}

export async function askCheckbox<T>(options: {
  message: string;
  flag: string;
  choices: Array<Choice<T>>;
}): Promise<T[]> {
  if (!interactive()) return options.choices.filter((choice) => choice.checked).map((choice) => choice.value);
  return checkbox(
    { message: options.message, choices: options.choices, pageSize: 12, theme: listTheme, validate: () => true },
    promptContext,
  );
}

/** Type to filter a long list (packages, templates); `source` may query the server as the person types. */
export async function askSearch<T>(options: {
  message: string;
  flag: string;
  source: (term: string | undefined) => Promise<Array<Choice<T>>> | Array<Choice<T>>;
}): Promise<T> {
  if (!interactive()) missing(options.flag);
  return search(
    { message: options.message, source: async (term) => options.source(term), pageSize: 12, theme: listTheme },
    promptContext,
  );
}
