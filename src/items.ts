/**
 * The metadata of everything this computer has ever seen in a catalogue. A
 * trending list changes daily, and a note written about an item that fell off
 * it would lose its poster and its tags; remembering the item keeps the card
 * whole. Nothing here is a reading history: it is what a card needs to draw
 * itself again.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Item } from "./anilist";

/** Enough for years of lists, and small enough to read in a moment. */
const MAX_ITEMS = 500;
const FILE = "items.json";

function itemsFile(): string {
  return join(process.env.SALVAGE_PLUGIN_DATA ?? ".", FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItem(value: unknown): value is Item {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.genres)
  );
}

async function readAll(): Promise<Record<string, Item>> {
  try {
    const raw = JSON.parse(await readFile(itemsFile(), "utf8")) as unknown;
    if (!isRecord(raw)) {
      return {};
    }
    const kept: Record<string, Item> = {};
    for (const [id, item] of Object.entries(raw)) {
      if (isItem(item)) {
        kept[id] = item;
      }
    }
    return kept;
  } catch {
    return {};
  }
}

async function writeAll(items: Record<string, Item>): Promise<void> {
  await mkdir(join(itemsFile(), ".."), { recursive: true }).catch(
    () => undefined,
  );
  await writeFile(itemsFile(), JSON.stringify(items), "utf8").catch(
    () => undefined,
  );
}

/**
 * Keeps the items a catalogue answered. Re-seeing one refreshes it and moves
 * it to the end, so the oldest cards are the ones that fall off.
 */
export async function rememberItems(items: Item[]): Promise<void> {
  const known = await readAll();
  for (const item of items) {
    delete known[item.id];
    // The list an item sits in is the account's own history, so it is drawn from
    // the answer and never written to this computer's cache.
    const { status, ...recalled } = item;
    known[item.id] = recalled;
  }
  const ids = Object.keys(known);
  const kept: Record<string, Item> = {};
  for (const id of ids.slice(Math.max(0, ids.length - MAX_ITEMS))) {
    kept[id] = known[id];
  }
  await writeAll(kept);
}

/** The metadata this computer still holds for these ids. */
export async function knownItems(ids: string[]): Promise<Item[]> {
  const known = await readAll();
  return ids.flatMap((id) => {
    const item = known[id];
    return item ? [item] : [];
  });
}
