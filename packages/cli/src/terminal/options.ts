const split = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const commaList = (value: string, previous: string[] = []) => [...previous, ...split(value)];

export const splitList = (value: string) => split(value);

export const repeatable = (value: string, previous: string[] = []) => [...previous, value];
