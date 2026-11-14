import { describe, expect, test } from "bun:test";

import { animeIdFromUrl, mergeEpisodes } from "./episodes";

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

describe("mergeEpisodes", () => {
  const media = {
    episodes: 3,
    airingSchedule: {
      nodes: [
        { episode: 1, airingAt: 1767225600 },
        { episode: 2, airingAt: 1767830400 },
      ],
    },
    streamingEpisodes: [
      {
        title: "Episode 2 - A Second Start",
        thumbnail: "https://img.example/2.jpg",
        url: "https://example/watch/2",
      },
      {
        title: "Episode 1 - The Apothecary Returns",
        thumbnail: "http://img.example/1.jpg",
        url: "http://example/watch/1",
      },
    ],
  };

  test("keeps the still and the description Kitsu has", () => {
    const episodes = mergeEpisodes(media, [
      {
        number: 1,
        title: "The Apothecary Returns",
        date: "2026-01-02",
        image: "https://media.kitsu.app/1.jpg",
        description: "A girl takes over her father's shop.",
      },
    ]);

    expect(episodes[0]).toEqual({
      number: 1,
      title: "The Apothecary Returns",
      date: "2026-01-02",
      image: "https://media.kitsu.app/1.jpg",
      description: "A girl takes over her father's shop.",
      // The streaming copy names an http address, which is not followed.
      url: null,
    });
  });

  test("drops the episode number a streaming title carries", () => {
    const episodes = mergeEpisodes(media, []);

    expect(episodes.map((episode) => episode.title)).toEqual([
      "The Apothecary Returns",
      "A Second Start",
      "Episode 3",
    ]);
    expect(episodes[0].image).toBeNull();
    expect(episodes[1].image).toBe("https://img.example/2.jpg");
    expect(episodes[1].url).toBe("https://example/watch/2");
    expect(episodes[0].url).toBeNull();
  });

  test("dates an episode from AniList when Kitsu has none", () => {
    const episodes = mergeEpisodes(media, [
      {
        number: 2,
        title: null,
        date: null,
        image: null,
        description: null,
      },
    ]);

    expect(episodes[1].date).toBe("2026-01-08");
    expect(episodes[2].date).toBeNull();
  });

  test("answers nothing for an anime without episodes", () => {
    expect(mergeEpisodes({ episodes: 0 }, [])).toEqual([]);
    expect(mergeEpisodes(null, [])).toEqual([]);
  });
});
