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
import { knownItems, rememberItems } from "./items";
import { PluginError, serve } from "./sdk";

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

/**
 * The list the canvas shows. AniList needs no key, and nothing about the
 * entries is stored anywhere but in this plugin's own cache.
 */
async function catalogue(
  settings: Record<string, unknown>,
  subject: Subject | undefined,
  secrets: Record<string, string> | undefined,
): Promise<Data> {
  const type = typeOf(settings.type);
  const list = listOf(settings.list);
  const perPage = perPageOf(settings.perPage);

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
    const userName = await fetchViewer(token);
    const lists = listsOf(settings.lists);
    const items = await cached<Item[]>(
      `personal-${type}-${userName.toLowerCase()}-${lists.join("+")}-${perPage}`,
      () => fetchPersonal({ type, userName, token, lists, perPage }),
    );
    await rememberItems(items);
    return {
      kind: "anime-catalogue",
      text: JSON.stringify({ items, known: await knownFor(subject) }),
    };
  }

  const items = await cached<Item[]>(`${type}-${list}-${perPage}`, () =>
    fetchList({ type, list, perPage }),
  );
  // Every item seen is kept, so a note about one that later falls off the list
  // still has a poster and tags to draw.
  await rememberItems(items);

  // The notes on this canvas are named in the ask, and the ones whose entry has
  // left the list are answered from what this computer remembers about them.
  const known = await knownFor(subject);

  return {
    kind: "anime-catalogue",
    text: JSON.stringify({ items, known }),
  };
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
