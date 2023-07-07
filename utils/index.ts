import { Maybe } from "npm:@octokit/graphql-schema";

export function removeMaybe<T = unknown>(x: Maybe<T>[]): T[] {
  return x.filter((x) => x !== null) as T[];
}

export const log = (
  prefixOrMsg: string,
  msg?: any,
  level?: "log" | "info" | "warn" | "error"
) => {
  if (msg === undefined) {
    return console.log(prefixOrMsg);
  }

  const color = {
    log: "blue",
    info: "grey",
    warn: "yellow",
    error: "red",
  };
  const lvl = level ?? "log";
  const selectedColor = level ? color[level] : "inherit";
  console[lvl](
    `%c${prefixOrMsg}%c ${msg}`,
    `color: ${selectedColor}`,
    "color: inherit"
  );
};

export const progress = async (message: string) => {
  // Move the cursor to the beginning of the line and clear it
  await Deno.stdout.write(new TextEncoder().encode("\x1B[0G\x1B[2K"));

  // Update the current line
  await Deno.stdout.write(new TextEncoder().encode(message));
};
