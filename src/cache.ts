/**
 * The plugin's own copy of its last answer, kept in the folder the helper hands
 * it. A plugin may read and write wherever the user can, and this one keeps its
 * scratch data here so a canvas opened twice costs one request.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOURS = 6;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;
const TTL_MS = HOURS * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** The folder the helper sets aside for this plugin, or the working directory. */
function dataRoot(): string {
  return process.env.SALVAGE_PLUGIN_DATA ?? ".";
}

function cacheFile(key: string): string {
  return join(dataRoot(), "cache", `${key}.json`);
}

/** Reads `key` from disk when it is young enough, and stores what it fetched. */
export async function cached<T>(
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    const raw = JSON.parse(await readFile(cacheFile(key), "utf8")) as {
      at?: unknown;
      value?: unknown;
    };
    if (typeof raw.at === "number" && Date.now() - raw.at < TTL_MS) {
      return raw.value as T;
    }
  } catch {
    // A missing or unreadable cache is simply a miss.
  }

  const value = await read();
  await mkdir(join(dataRoot(), "cache"), { recursive: true }).catch(
    () => undefined,
  );
  await writeFile(
    cacheFile(key),
    JSON.stringify({ at: Date.now(), value }),
    "utf8",
  ).catch(() => undefined);
  return value;
}
