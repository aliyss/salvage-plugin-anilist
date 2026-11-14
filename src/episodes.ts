/**
 * The episode list of one AniList anime. AniList names the episodes and its
 * schedule dates them; Kitsu, found through the same anime's MyAnimeList id,
 * carries the still and the synopsis. Both are read here, on this computer, and
 * nothing about the answer is stored.
 */

import { PluginError } from "./sdk";

const ANILIST_API = "https://graphql.anilist.co";
const KITSU_API = "https://kitsu.io/api/edge";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_EPISODES = 60;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 320;
const PAGE_SIZE = 50;
const KITSU_PAGE = 20;
const ISO_DATE = 10;
const ANIME_PAGE =
  /^https?:\/\/(?:www\.)?anilist\.co\/anime\/(\d{1,10})(?:[/?#]|$)/i;

const QUERY = `query ($id: Int) {
  Media(id: $id) {
    idMal
    episodes
    duration
    airingSchedule(perPage: ${String(PAGE_SIZE)}) { nodes { episode airingAt } }
    streamingEpisodes { title thumbnail url }
  }
}`;

export type Episode = {
  number: number;
  title: string;
  date: string | null;
  /** A still of the episode, whichever site has one. */
  image: string | null;
  /** One or two sentences about the episode, when a site has them. */
  description: string | null;
  /** Where the episode can be watched, when a site names it. */
  url: string | null;
};

/** One episode as Kitsu describes it, before it is matched with AniList's. */
export type KitsuEpisode = {
  number: number;
  title: string | null;
  date: string | null;
  image: string | null;
  description: string | null;
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

function dateOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, ISO_DATE) : null;
}

function airDateOf(airingAt: unknown): string | null {
  if (typeof airingAt !== "number" || !Number.isFinite(airingAt)) {
    return null;
  }
  const at = new Date(airingAt * 1000);
  return Number.isNaN(at.getTime())
    ? null
    : at.toISOString().slice(0, ISO_DATE);
}

/** A picture is only used when it is an https address, whatever the site. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("https://") && trimmed.length <= 2_048
    ? trimmed
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

/** The number an episode title names, such as "Episode 12 - ...". */
function numberInTitle(title: string): number | null {
  const match = /episode\s*(\d{1,4})/i.exec(title);
  return match ? Number(match[1]) : null;
}

/** The title without the "Episode 12 - " a streaming site puts in front. */
function titleWithoutNumber(title: string): string {
  return title
    .replace(/^episode\s*\d{1,4}\s*[-–:]?\s*/i, "")
    .trim()
    .slice(0, MAX_TITLE);
}

type Streamed = {
  title: string | null;
  image: string | null;
  url: string | null;
};

/** What a streaming copy carries, by the episode its title names. */
function streamedOf(media: Record<string, unknown>): Map<number, Streamed> {
  const rows = new Map<number, Streamed>();
  const streamed = Array.isArray(media.streamingEpisodes)
    ? media.streamingEpisodes
    : [];

  for (const row of streamed.slice(0, MAX_EPISODES)) {
    if (!isRecord(row) || typeof row.title !== "string") {
      continue;
    }
    const raw = row.title.trim();
    const number = numberInTitle(raw);
    if (!number || rows.has(number)) {
      continue;
    }
    const title = titleWithoutNumber(raw);
    rows.set(number, {
      title: title || null,
      image: httpsUrl(row.thumbnail),
      url: httpsUrl(row.url),
    });
  }
  return rows;
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
    const date = airDateOf(node.airingAt);
    if (date) {
      dates.set(node.episode, date);
    }
  }
  return dates;
}

/**
 * One list out of the two answers: a still and a description come from Kitsu
 * when it has them, the title and the air date from whichever site knows them.
 */
export function mergeEpisodes(
  media: unknown,
  kitsu: KitsuEpisode[],
): Episode[] {
  const source = isRecord(media) ? media : {};
  const streamed = streamedOf(source);
  const dates = datesOf(source);
  const fromKitsu = new Map<number, KitsuEpisode>();
  for (const episode of kitsu) {
    if (episode.number > 0 && episode.number <= MAX_EPISODES) {
      fromKitsu.set(episode.number, episode);
    }
  }

  const numbers = new Set<number>([
    ...streamed.keys(),
    ...dates.keys(),
    ...fromKitsu.keys(),
  ]);
  const counted =
    typeof source.episodes === "number" ? source.episodes : numbers.size;
  for (let number = 1; number <= Math.min(MAX_EPISODES, counted); number += 1) {
    numbers.add(number);
  }

  return [...numbers]
    .filter((number) => number > 0 && number <= MAX_EPISODES)
    .sort((left, right) => left - right)
    .map((number) => {
      const copy = fromKitsu.get(number);
      const stream = streamed.get(number);
      const title = copy?.title ?? stream?.title ?? `Episode ${String(number)}`;
      return {
        number,
        title: title.slice(0, MAX_TITLE),
        date: copy?.date ?? dates.get(number) ?? null,
        image: copy?.image ?? stream?.image ?? null,
        description: copy?.description ?? null,
        url: stream?.url ?? null,
      };
    });
}

/** One episode of the Kitsu answer, or null when it cannot be drawn. */
function toKitsuEpisode(row: unknown): KitsuEpisode | null {
  if (!isRecord(row) || !isRecord(row.attributes)) {
    return null;
  }
  const attributes = row.attributes;
  const number =
    typeof attributes.number === "number" ? Math.round(attributes.number) : 0;
  if (number <= 0 || number > MAX_EPISODES) {
    return null;
  }
  const thumbnail = isRecord(attributes.thumbnail)
    ? httpsUrl(attributes.thumbnail.original)
    : null;

  return {
    number,
    title: cleanText(
      attributes.canonicalTitle ??
        (isRecord(attributes.titles) ? attributes.titles.en : null),
      MAX_TITLE,
    ),
    date: dateOf(attributes.airdate),
    image: thumbnail,
    description: cleanText(
      attributes.synopsis ?? attributes.description,
      MAX_DESCRIPTION,
    ),
  };
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.api+json, application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => undefined);
    return null;
  }
  const raw = await new Response(response.body).text();
  if (raw.length > MAX_BYTES) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The Kitsu anime the same title has, found through its MAL id. */
async function kitsuAnimeId(idMal: number): Promise<number | null> {
  const body = await readJson(
    `${KITSU_API}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${String(
      idMal,
    )}&include=item&page[limit]=1`,
  );
  if (!isRecord(body)) {
    return null;
  }

  const included = Array.isArray(body.included) ? body.included : [];
  const anime = included.find((row) => isRecord(row) && row.type === "anime");
  const id = isRecord(anime) ? Number(anime.id) : Number.NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Every episode Kitsu knows for one anime, in order. */
async function kitsuEpisodes(idMal: number): Promise<KitsuEpisode[]> {
  const animeId = await kitsuAnimeId(idMal);
  if (!animeId) {
    return [];
  }

  const episodes: KitsuEpisode[] = [];
  for (let offset = 0; offset < MAX_EPISODES; offset += KITSU_PAGE) {
    const body = await readJson(
      `${KITSU_API}/anime/${String(animeId)}/episodes?sort=number&page[limit]=${String(
        KITSU_PAGE,
      )}&page[offset]=${String(offset)}`,
    );
    const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
    if (data.length === 0) {
      break;
    }
    for (const row of data) {
      const episode = toKitsuEpisode(row);
      if (episode) {
        episodes.push(episode);
      }
    }
  }
  return episodes;
}

async function fetchMedia(id: number): Promise<Record<string, unknown>> {
  const response = await fetch(ANILIST_API, {
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
    throw new PluginError(
      "refused",
      "AniList answered with something unreadable.",
    );
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
  if (!isRecord(media)) {
    throw new PluginError(
      "no_data",
      "AniList has no episodes for that anime yet.",
    );
  }
  return media;
}

/**
 * Reads one anime's episodes on this computer. The description and the still
 * come from Kitsu, which is asked only after AniList has answered; a Kitsu that
 * is down leaves the list without pictures rather than failing it.
 */
export async function fetchEpisodes(id: number): Promise<string> {
  const media = await fetchMedia(id);
  const idMal = typeof media.idMal === "number" ? media.idMal : null;
  const kitsu = idMal
    ? await kitsuEpisodes(idMal).catch(() => [] as KitsuEpisode[])
    : [];
  const episodes = mergeEpisodes(media, kitsu);

  if (episodes.length === 0) {
    throw new PluginError(
      "no_data",
      "AniList has no episodes for that anime yet.",
    );
  }
  return JSON.stringify({ episodes });
}
