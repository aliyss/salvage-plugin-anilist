/**
 * The episode list of one AniList anime. The entry's own page names the id, and
 * the answer is drawn as lines by the app; nothing about it is stored.
 */

import { PluginError } from "./sdk";

const API = "https://graphql.anilist.co";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 500_000;
const MAX_EPISODES = 60;
const MAX_TITLE = 120;
const PAGE_SIZE = 50;
/** A date is read from a second count, and `toISOString` writes it as this. */
const ISO_DATE = 10;
const ANIME_PAGE =
  /^https?:\/\/(?:www\.)?anilist\.co\/anime\/(\d{1,10})(?:[/?#]|$)/i;

const QUERY = `query ($id: Int) {
  Media(id: $id) {
    episodes
    duration
    airingSchedule(perPage: ${String(PAGE_SIZE)}) { nodes { episode airingAt } }
    streamingEpisodes { title }
  }
}`;

type Episode = {
  number: number;
  title: string | null;
  date: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The anime id an AniList page names, or null for any other link. */
export function animeIdFromUrl(url: string | null | undefined): number | null {
  if (!url) {
    return null;
  }
  const match = ANIME_PAGE.exec(url.trim());
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function dateOf(airingAt: unknown): string | null {
  if (typeof airingAt !== "number" || !Number.isFinite(airingAt)) {
    return null;
  }
  const at = new Date(airingAt * 1000);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return at.toISOString().slice(0, ISO_DATE);
}

/** The titles a streamed copy carries, by the episode they belong to. */
function titlesOf(media: Record<string, unknown>): Map<number, string> {
  const titles = new Map<number, string>();
  const streamed = Array.isArray(media.streamingEpisodes)
    ? media.streamingEpisodes
    : [];
  streamed.slice(0, MAX_EPISODES).forEach((row, index) => {
    const title =
      isRecord(row) && typeof row.title === "string" ? row.title.trim() : "";
    if (title) {
      titles.set(index + 1, title.slice(0, MAX_TITLE));
    }
  });
  return titles;
}

/** When each episode aired, by the episode it belongs to. */
function datesOf(media: Record<string, unknown>): Map<number, string> {
  const dates = new Map<number, string>();
  const schedule = isRecord(media.airingSchedule)
    ? media.airingSchedule.nodes
    : null;
  if (!Array.isArray(schedule)) {
    return dates;
  }

  for (const node of schedule) {
    if (!isRecord(node) || typeof node.episode !== "number") {
      continue;
    }
    const date = dateOf(node.airingAt);
    if (date) {
      dates.set(node.episode, date);
    }
  }
  return dates;
}

/** Every episode the answer describes, in order, once each. */
function episodesOf(media: Record<string, unknown>): Episode[] {
  const titles = titlesOf(media);
  const dates = datesOf(media);
  const numbers = new Set<number>([...titles.keys(), ...dates.keys()]);
  const counted =
    typeof media.episodes === "number" ? media.episodes : numbers.size;

  for (let number = 1; number <= Math.min(MAX_EPISODES, counted); number += 1) {
    numbers.add(number);
  }

  return [...numbers]
    .filter((number) => number > 0 && number <= MAX_EPISODES)
    .sort((left, right) => left - right)
    .map((number) => ({
      number,
      title: titles.get(number) ?? null,
      date: dates.get(number) ?? null,
    }));
}

function lineOf(episode: Episode, duration: string | null): string {
  const number = String(episode.number).padStart(2, "0");
  const parts = [
    `${number}. ${episode.title ?? `Episode ${number}`}`,
    ...(duration ? [duration] : []),
    ...(episode.date ? [`aired ${episode.date}`] : []),
  ];
  return parts.join(" · ");
}

/** The lines the entry shows: one episode each, with what is known of it. */
export function episodeLines(media: unknown): string[] {
  if (!isRecord(media)) {
    return [];
  }
  const duration =
    typeof media.duration === "number" && media.duration > 0
      ? `${String(media.duration)} min`
      : null;

  return episodesOf(media).map((episode) => lineOf(episode, duration));
}

/** Reads one anime's episodes from AniList, on this computer. */
export async function fetchEpisodes(id: number): Promise<string> {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);

  if (!response) {
    throw new PluginError("refused", "AniList could not be reached.");
  }
  if (response.status === 429) {
    throw new PluginError(
      "refused",
      "AniList is rate limiting this computer. Try again in a minute.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginError("refused", `AniList answered ${response.status}.`);
  }

  const raw = await new Response(response.body).text();
  if (raw.length > MAX_BYTES) {
    throw new PluginError("refused", "AniList answered with too much data.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PluginError("refused", "AniList answered with something unreadable.");
  }

  const errors = isRecord(body) ? body.errors : null;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: unknown } | null;
    throw new PluginError(
      "refused",
      typeof first?.message === "string"
        ? first.message.slice(0, 200)
        : "AniList refused the query.",
    );
  }

  const data = isRecord(body) ? body.data : null;
  const media = isRecord(data) ? data.Media : null;
  const lines = episodeLines(media);
  if (lines.length === 0) {
    throw new PluginError(
      "no_data",
      "AniList has no episodes for that anime yet.",
    );
  }
  return lines.join("\n");
}
