/**
 * Reads one list from AniList's public GraphQL API. No key is involved: the
 * call is made here, on the user's own computer, and nothing about the answer is
 * sent to Salvage. The canvas draws what this returns and forgets it.
 */

import { PluginError } from "./sdk";

const API = "https://graphql.anilist.co";
const SITE = "https://anilist.co";
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_ITEMS = 50;
const MAX_TITLE = 200;
const MAX_OVERVIEW = 600;
const MAX_GENRES = 4;
const MAX_GENRE = 40;
/** A cover colour is `#RRGGBB`, and nothing longer can be one. */
const MAX_COLOR = 7;
/** AniList scores out of a hundred; a card shows one decimal out of ten. */
const SCORE_PER_UNIT = 10;
const RATING_STEP = 10;
const MAX_RATING = 10;

export type MediaType = "ANIME" | "MANGA";
export type ListName = "trending" | "popular" | "top";

export type Item = {
  id: string;
  title: string;
  year: number | null;
  poster: string | null;
  /** The leading colour of the cover, as AniList reports it. */
  color: string | null;
  rating: number | null;
  genres: string[];
  overview: string | null;
  url: string | null;
};

/** The AniList sort each list name means. */
const SORTS: Record<ListName, string> = {
  trending: "TRENDING_DESC",
  popular: "POPULARITY_DESC",
  top: "SCORE_DESC",
};

const QUERY = `query ($type: MediaType, $sort: [MediaSort], $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(type: $type, sort: $sort) {
      id
      type
      title { romaji english native }
      coverImage { extraLarge large color }
      averageScore
      startDate { year }
      genres
      description
    }
  }
}`;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A synopsis arrives as HTML; a card wants the words between the tags. */
function plainText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.slice(0, max) : null;
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function titleOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return (
    shortText(value.english, MAX_TITLE) ??
    shortText(value.romaji, MAX_TITLE) ??
    shortText(value.native, MAX_TITLE)
  );
}

function posterOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const url =
    shortText(value.extraLarge, 2_048) ?? shortText(value.large, 2_048);
  return url?.startsWith("https://") ? url : null;
}

function colorOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const color = shortText(value.color, MAX_COLOR);
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null;
}

function yearOf(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const year = value.year;
  return typeof year === "number" &&
    Number.isInteger(year) &&
    year >= 1800 &&
    year <= 2100
    ? year
    : null;
}

function genresOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((genre) => {
      const name = shortText(genre, MAX_GENRE);
      return name ? [name] : [];
    })
    .slice(0, MAX_GENRES);
}

function ratingOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const rating = Math.round((value / SCORE_PER_UNIT) * RATING_STEP) / RATING_STEP;
  return rating <= MAX_RATING ? rating : null;
}

/** One row of an AniList page, or null when it cannot be drawn as a card. */
export function toItem(row: unknown, type: MediaType): Item | null {
  if (!isRecord(row)) {
    return null;
  }
  const id = typeof row.id === "number" ? String(row.id) : "";
  const title = titleOf(row.title);
  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    year: yearOf(row.startDate),
    poster: posterOf(row.coverImage),
    color: colorOf(row.coverImage),
    rating: ratingOf(row.averageScore),
    genres: genresOf(row.genres),
    overview: plainText(row.description, MAX_OVERVIEW),
    url: `${SITE}/${type === "MANGA" ? "manga" : "anime"}/${id}`,
  };
}

/** The same fields, for the items whose list no longer carries them. */
const BY_IDS = `query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids) {
      id
      type
      title { romaji english native }
      coverImage { extraLarge large color }
      averageScore
      startDate { year }
      genres
      description
    }
  }
}`;

/**
 * Reads the items whose ids it is given, whatever list they came from. A card
 * whose item fell off a catalogue still needs its poster and its tags, and this
 * is what asks for them when this computer has not kept them.
 */
export async function fetchByIds(ids: string[]): Promise<Item[]> {
  if (ids.length === 0) {
    return [];
  }

  const response = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      query: BY_IDS,
      variables: { ids: ids.slice(0, MAX_ITEMS).map(Number) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  // A card that cannot be filled keeps the note it already shows.
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => undefined);
    return [];
  }

  const raw = await new Response(response.body).text();
  if (raw.length > MAX_BYTES) {
    return [];
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [];
  }

  const data = isRecord(body) ? body.data : null;
  const page = isRecord(data) ? data.Page : null;
  const media = isRecord(page) ? page.media : null;
  if (!Array.isArray(media)) {
    return [];
  }

  return media.flatMap((row) => {
    const type = isRecord(row) && row.type === "MANGA" ? "MANGA" : "ANIME";
    const item = toItem(row, type);
    return item ? [item] : [];
  });
}

/** The entries of one AniList list, ready for the canvas. */
export async function fetchList(input: {
  type: MediaType;
  list: ListName;
  perPage: number;
}): Promise<Item[]> {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        type: input.type,
        sort: [SORTS[input.list]],
        perPage: Math.min(MAX_ITEMS, Math.max(1, Math.round(input.perPage))),
      },
    }),
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
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginError("bad_subject", "AniList refused that list.");
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
  const page = isRecord(data) ? data.Page : null;
  const media = isRecord(page) ? page.media : null;
  if (!Array.isArray(media)) {
    throw new PluginError("refused", "AniList answered without a list.");
  }

  const items = media
    .slice(0, MAX_ITEMS)
    .flatMap((row) => {
      const item = toItem(row, input.type);
      return item ? [item] : [];
    });

  if (items.length === 0) {
    throw new PluginError("no_data", "AniList returned nothing for that list.");
  }
  return items;
}
