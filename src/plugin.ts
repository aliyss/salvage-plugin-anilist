import { createHash } from "node:crypto";

import { cached } from "./cache";
import {
  fetchByIds,
  fetchList,
  fetchPersonal,
  fetchViewer,
  LIST_STATUSES,
  type Item,
  type ListName,
  type MediaType,
} from "./anilist";
import { animeIdFromUrl, episodePage, fetchEpisodes } from "./episodes";
import { keepCovers } from "./covers";
import { knownItems, rememberItems } from "./items";
import { PluginError, serve } from "./sdk";
import { keptStill } from "./still";

import type { Data, Paging, Subject } from "./sdk";

const LISTS: ListName[] = ["trending", "popular", "top"];
const PERSONAL = "personal";
type CanvasList = ListName | typeof PERSONAL;
const DEFAULT_PER_PAGE = 30;
const MIN_PER_PAGE = 5;
const MAX_PER_PAGE = 50;
/** A card's metadata is asked for in one batch, never a request per card. */
const MAX_BACKFILL = 40;

function listOf(value: unknown): CanvasList {
  if (value === PERSONAL) {
    return PERSONAL;
  }
  return LISTS.includes(value as ListName) ? (value as ListName) : "trending";
}

/**
 * The account lists a canvas shows. The canvas saves them as one string of the
 * statuses ticked in its settings; nothing ticked means all of them.
 */
function listsOf(value: unknown): string[] {
  const picked = (typeof value === "string" ? value.split(",") : [])
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is string =>
      (LIST_STATUSES as readonly string[]).includes(entry),
    );
  return picked.length > 0 ? picked : [...LIST_STATUSES];
}

function typeOf(value: unknown): MediaType {
  return value === "MANGA" ? "MANGA" : "ANIME";
}

function perPageOf(value: unknown): number {
  const wanted =
    typeof value === "number" ? Math.round(value) : DEFAULT_PER_PAGE;
  return Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, wanted));
}

/** The page a canvas asked for: where it starts, and how much it holds. */
function pageOf(
  paging: Paging | undefined,
  perPage: number,
): {
  offset: number;
  limit: number;
  page: number;
} {
  const limit = Math.min(
    MAX_PER_PAGE,
    Math.max(MIN_PER_PAGE, Math.round(paging?.limit ?? perPage)),
  );
  const offset = Math.max(0, Math.round(paging?.offset ?? 0));
  // AniList pages its public lists itself, so an offset becomes a page number.
  return { offset, limit, page: Math.floor(offset / limit) + 1 };
}

/** An item with the cover filed here for it, which is what a card draws. */
type CardItem = Item & { cover: string | null };

/**
 * The pictures of one page. A card never asks AniList for its cover: the plugin
 * files the copy on this computer first, and the app draws what the helper
 * serves back. A cover still missing when the page is answered leaves the card
 * as the block of colour it already paints, and is filed on a later visit.
 */
async function withCovers(items: Item[]): Promise<CardItem[]> {
  const covers = await keepCovers(items.map((item) => item.poster));
  return items.map((item, index) => ({
    ...item,
    cover: covers[index] ?? null,
  }));
}

/** The covers already held for the items a note of this canvas still points at. */
async function withHeldCovers(items: Item[]): Promise<CardItem[]> {
  const covers = await Promise.all(
    items.map((item) => keptStill(item.poster)),
  );
  return items.map((item, index) => ({ ...item, cover: covers[index] }));
}

/** The answer a canvas reads: a page of items, the notes it knows, and whether more follow. */
function catalogueAnswer(input: {
  items: CardItem[];
  known: CardItem[];
  hasMore: boolean;
}): Data {
  return {
    kind: "anime-catalogue",
    text: JSON.stringify({
      items: input.items,
      known: input.known,
      hasMore: input.hasMore,
    }),
  };
}

/**
 * The list the canvas shows. AniList needs no key, and nothing about the
 * entries is stored anywhere but in this plugin's own cache. A canvas asks for
 * one page at a time, so zooming out fetches the rest instead of the first
 * screenful being the whole canvas.
 */
async function catalogue(
  settings: Record<string, unknown>,
  subject: Subject | undefined,
  secrets: Record<string, string> | undefined,
  paging: Paging | undefined,
): Promise<Data> {
  const type = typeOf(settings.type);
  const list = listOf(settings.list);
  const perPage = perPageOf(settings.perPage);
  const sort = subject?.data?.sort ?? "date";
  const { offset, limit, page } = pageOf(paging, perPage);
  const known = await knownFor(subject);

  if (list === PERSONAL) {
    // The account is the one the token belongs to, so its name is asked for
    // rather than typed anywhere.
    const token = secrets?.token ?? "";
    if (!token) {
      throw new PluginError(
        "bad_subject",
        "Sign in to AniList in this plugin's settings first.",
      );
    }
    const userName = await viewerName(token);
    const lists = listsOf(settings.lists);
    // The whole set is read once and kept as the account last changed it, so a
    // later page is a slice of an answer this computer already has rather than
    // another round trip. The sort is not part of the key: it only reorders the
    // answer, and a key per view asked AniList for the whole library again
    // through AniList's rate limit every time the canvas changed view.
    const all = await cached<Item[]>(
      `personal-${type}-${userName.toLowerCase()}-${lists.join("+")}`,
      () => fetchPersonal({ type, userName, token, lists, sort: "date" }),
    );
    await rememberItems(all);
    // A view sorted by colour is one comparison over the answer already held.
    const ordered =
      sort === "color"
        ? [...all].sort((left, right) =>
            (left.color ?? "~").localeCompare(right.color ?? "~"),
          )
        : all;
    const items = ordered.slice(offset, offset + limit);
    return catalogueAnswer({
      items: await withCovers(items),
      known: await withHeldCovers(known),
      hasMore: offset + items.length < ordered.length,
    });
  }

  const items = await cached<Item[]>(`${type}-${list}-${limit}-${page}`, () =>
    fetchList({ type, list, perPage: limit, page }),
  );
  // Every item seen is kept, so a note about one that later falls off the list
  // still has a poster and tags to draw.
  await rememberItems(items);

  // The notes on this canvas are named in the ask, and the ones whose entry has
  // left the list are answered from what this computer remembers about them.
  return catalogueAnswer({
    items: await withCovers(items),
    known: await withHeldCovers(known),
    hasMore: items.length === limit,
  });
}

/**
 * The account a token belongs to. A Personal canvas asked AniList for this on
 * every page it loaded, which is one request per page for an answer that only
 * changes when the token does; it is kept beside the catalogue for the same
 * hours. The key is a digest of the token, so the token itself is never written.
 */
async function viewerName(token: string): Promise<string> {
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 12);
  return await cached(`viewer-${digest}`, () => fetchViewer(token));
}

/**
 * Whose token this computer holds. The app asks this before it offers the
 * account's own lists, and stops offering them when AniList refuses the token.
 */
async function whoami(
  secrets: Record<string, string> | undefined,
): Promise<Data> {
  const token = secrets?.token ?? "";
  if (!token) {
    throw new PluginError(
      "bad_subject",
      "No AniList token is saved on this computer yet.",
    );
  }
  return { kind: "auth", text: await fetchViewer(token) };
}

/**
 * The episodes of the anime this entry links to. The entry is only asked for
 * its link, so the answer belongs to that note and to nothing else.
 */
async function episodes(
  linkUrl: string | undefined,
  paging: Paging | undefined,
): Promise<Data> {
  const id = animeIdFromUrl(linkUrl);
  if (!id) {
    throw new PluginError(
      "bad_subject",
      "This entry does not link to an AniList anime.",
    );
  }

  return {
    kind: "anime-episodes",
    text: episodePage(await fetchEpisodes(id), paging),
  };
}

/**
 * The metadata of the items a canvas already has notes about. What this
 * computer kept answers first; only ids it has never seen are read from AniList.
 */
async function knownFor(subject: Subject | undefined): Promise<Item[]> {
  const ids = [...new Set((subject?.data?.ids ?? "").split(","))]
    .map((id) => id.trim())
    .filter((id) => /^\d{1,10}$/.test(id))
    .slice(0, MAX_BACKFILL);

  const known = await knownItems(ids);
  const missing = ids.filter((id) => !known.some((item) => item.id === id));
  const fetched =
    missing.length > 0
      ? await fetchByIds(missing).catch(() => [] as Item[])
      : [];
  if (fetched.length > 0) {
    await rememberItems(fetched);
  }

  return [...known, ...fetched];
}

export default () =>
  serve(async ({ command, params }) => {
    if (command === "catalogue") {
      return await catalogue(
        params.settings ?? {},
        params.subject,
        params.secrets,
        params.paging,
      );
    }
    if (command === "whoami") {
      return await whoami(params.secrets);
    }
    if (command === "episodes") {
      return await episodes(params.subject?.link?.url, params.paging);
    }

    throw new PluginError("unsupported", `Unknown command ${command}.`);
  });
