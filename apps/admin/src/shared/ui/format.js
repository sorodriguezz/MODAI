import { html } from "../lib/html.js";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const relativeFormat = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function formatDate(value, empty = "—") {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? empty : dateFormat.format(date);
}

export function relativeTime(value, empty = "Nunca") {
  if (!value) return empty;
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  return "hace un momento";
}

export function timeTag(value, empty) {
  return value
    ? html`<time datetime="${value}" title="${formatDate(value)}">${relativeTime(value, empty)}</time>`
    : html`<span class="muted">${empty ?? "Nunca"}</span>`;
}

export function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function debounce(fn, ms = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
