export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
