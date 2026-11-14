import { cached } from "./cache";
import { fetchList, type Item, type ListName, type MediaType } from "./anilist";
import { animeIdFromUrl, fetchEpisodes } from "./episodes";
import { PluginError, serve } from "./sdk";

import type { Data } from "./sdk";

const LISTS: ListName[] = ["trending", "popular", "top"];
const DEFAULT_PER_PAGE = 30;
const MIN_PER_PAGE = 5;
const MAX_PER_PAGE = 50;

function listOf(value: unknown): ListName {
  return LISTS.includes(value as ListName) ? (value as ListName) : "trending";
}

function typeOf(value: unknown): MediaType {
  return value === "MANGA" ? "MANGA" : "ANIME";
}

function perPageOf(value: unknown): number {
  const wanted = typeof value === "number" ? Math.round(value) : DEFAULT_PER_PAGE;
  return Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, wanted));
}

/**
 * The list the canvas shows. AniList needs no key, and nothing about the
 * entries is stored anywhere but in this plugin's own cache.
 */
async function catalogue(settings: Record<string, unknown>): Promise<Data> {
  const type = typeOf(settings.type);
  const list = listOf(settings.list);
  const perPage = perPageOf(settings.perPage);

  const items = await cached<Item[]>(`${type}-${list}-${perPage}`, () =>
    fetchList({ type, list, perPage }),
  );

  return { kind: "anime-catalogue", text: JSON.stringify({ items }) };
}

/**
 * The episodes of the anime this entry links to. The entry is only asked for
 * its link, so the answer belongs to that note and to nothing else.
 */
async function episodes(linkUrl: string | undefined): Promise<Data> {
  const id = animeIdFromUrl(linkUrl);
  if (!id) {
    throw new PluginError(
      "bad_subject",
      "This entry does not link to an AniList anime.",
    );
  }

  return { kind: "anime-episodes", text: await fetchEpisodes(id) };
}

export default () =>
  serve(async ({ command, params }) => {
    if (command === "catalogue") {
      return await catalogue(params.settings ?? {});
    }
    if (command === "episodes") {
      return await episodes(params.subject?.link?.url);
    }

    throw new PluginError("unsupported", `Unknown command ${command}.`);
  });
