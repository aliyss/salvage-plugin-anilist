import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cached } from "./cache";

/** A fresh folder per test, so nothing is read from a previous run. */
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "salvage-anilist-"));
  process.env.SALVAGE_PLUGIN_DATA = root;
});

afterEach(async () => {
  delete process.env.SALVAGE_PLUGIN_DATA;
  await rm(root, { recursive: true, force: true });
});

describe("cached", () => {
  test("answers the second call from the folder it wrote", async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      return ["trending"];
    };

    expect(await cached("list", read)).toEqual(["trending"]);
    expect(await cached("list", read)).toEqual(["trending"]);
    expect(calls).toBe(1);
  });

  test("reads again once the copy is too old", async () => {
    await mkdir(join(root, "cache"), { recursive: true });
    await writeFile(
      join(root, "cache", "old.json"),
      JSON.stringify({ at: 0, value: ["old"] }),
      "utf8",
    );

    expect(await cached("old", async () => ["new"])).toEqual(["new"]);
  });

  test("keeps nothing when the read fails", async () => {
    const failing = async (): Promise<string[]> => {
      throw new Error("AniList is down");
    };

    await expect(cached("episodes-1", failing)).rejects.toThrow(
      "AniList is down",
    );
    expect(await cached("episodes-1", async () => ["answered"])).toEqual([
      "answered",
    ]);
  });

  test("a cache it cannot read is simply a miss", async () => {
    await mkdir(join(root, "cache"), { recursive: true });
    await writeFile(join(root, "cache", "broken.json"), "{not json", "utf8");

    expect(await cached("broken", async () => ["fresh"])).toEqual(["fresh"]);
  });
});
