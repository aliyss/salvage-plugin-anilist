import { describe, expect, test } from "bun:test";

import { toItem } from "./anilist";

const row = {
  id: 195516,
  type: "ANIME",
  title: { romaji: "Kusuriya no Hitorigoto 3rd Season", english: "The Apothecary Diaries Season 3" },
  coverImage: {
    large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx195516.jpg",
    extraLarge:
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx195516.jpg",
  },
  averageScore: 85,
  startDate: { year: 2026 },
  genres: ["Drama", "Mystery"],
  description: "In the aftermath &amp; aftermath.<br><br>One day, Maomao senses an anomaly.",
};

describe("an AniList row", () => {
  test("becomes a card with the preferred title, cover and score", () => {
    expect(toItem(row, "ANIME")).toEqual({
      id: "195516",
      title: "The Apothecary Diaries Season 3",
      year: 2026,
      poster:
        "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx195516.jpg",
      rating: 8.5,
      genres: ["Drama", "Mystery"],
      overview:
        "In the aftermath & aftermath. One day, Maomao senses an anomaly.",
      url: "https://anilist.co/anime/195516",
    });
  });

  test("falls back to the romaji title when there is no English one", () => {
    const item = toItem(
      { ...row, title: { romaji: "Re:Zero", english: null } },
      "ANIME",
    );
    expect(item?.title).toBe("Re:Zero");
  });

  test("points a manga at its own page and drops a blank score", () => {
    const item = toItem({ ...row, averageScore: null }, "MANGA");
    expect(item?.url).toBe("https://anilist.co/manga/195516");
    expect(item?.rating).toBeNull();
  });
});
