import { describe, expect, test } from "bun:test";

import { animeIdFromUrl, episodeLines } from "./episodes";

describe("animeIdFromUrl", () => {
  test("reads the id from an anime page", () => {
    expect(animeIdFromUrl("https://anilist.co/anime/195516")).toBe(195516);
    expect(animeIdFromUrl("https://www.anilist.co/anime/21/?utm=1")).toBe(21);
  });

  test("refuses a page that is not an anime", () => {
    expect(animeIdFromUrl("https://anilist.co/manga/1")).toBeNull();
    expect(animeIdFromUrl("https://example.com/anime/1")).toBeNull();
    expect(animeIdFromUrl(null)).toBeNull();
  });
});

describe("episodeLines", () => {
  test("writes one line per episode with what is known", () => {
    const lines = episodeLines({
      episodes: 3,
      duration: 24,
      airingSchedule: {
        nodes: [
          { episode: 1, airingAt: 1767225600 },
          { episode: 2, airingAt: 1767830400 },
        ],
      },
      streamingEpisodes: [{ title: "The Apothecary Returns" }],
    });

    expect(lines).toEqual([
      "01. The Apothecary Returns · 24 min · aired 2026-01-01",
      "02. Episode 02 · 24 min · aired 2026-01-08",
      "03. Episode 03 · 24 min",
    ]);
  });

  test("answers nothing for an anime without episodes", () => {
    expect(episodeLines({ episodes: 0 })).toEqual([]);
    expect(episodeLines(null)).toEqual([]);
  });
});
