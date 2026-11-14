# AniList for Salvage

A [Salvage](https://github.com/aliyss/salvage-web) plugin that adds an **Anime**
canvas to your account. The anime and manga, their covers and their details are
fetched by the **Salvage Helper** on your own computer from AniList; the only
thing Salvage stores is the note you write about one of them.

Nothing about a title is ever sent to the server: no cover, no synopsis, no
genre, no score. A card is built again on every visit, and if the plugin cannot
be reached you still see your notes.

## What it adds

- A canvas, which works like any other: a URL, an entry in the canvas switcher,
  and a page of its own. You name it and choose its route in the plugin's
  settings.
- One card per entry in the list you picked (trending, most popular, or top
  rated), for anime or for manga.
- A note for any card. Notes are ordinary Salvage notes — Markdown, tags,
  mentions, Trash — stored on the canvas the plugin added. Tags you write are
  shown beside the genres AniList reports.

The canvas disappears from your account when the plugin is not connected. It is
hidden rather than deleted, so reinstalling the plugin brings it back with every
note still on it.

## Requirements

- Salvage with the desktop helper paired
- Nothing else: AniList's GraphQL API is public, so there is no key to add.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Anime or manga | Anime | Which media type the canvas shows |
| Which list | Trending now | The AniList sort the canvas shows |
| How many entries | 30 | Between 5 and 50 |

| Canvas name | Anime | The name the canvas starts with |
| Canvas route | anime | Its URL segment, under your own space |

## Development

```sh
bun install
bun run typecheck
bun test
bun run build     # writes dist/plugin.js
```

The plugin talks to the helper over stdin/stdout with the small SDK in
`src/sdk.ts`; `SALVAGE_PLUGIN_DATA` is a folder it may use for its own cache. It
asks AniList at most once every six hours per list.

## Data

This plugin uses the AniList GraphQL API. It is not affiliated with AniList.
