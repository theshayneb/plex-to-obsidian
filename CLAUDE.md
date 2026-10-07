# Media Import and Sync: notes for Claude Code

A personal Obsidian plugin (id `plex-media-notes`, kept so the installed folder and settings survive; don't change it) that creates and syncs notes for Plex movies, TV shows, documentaries and music tracks, and Steam games. The owner is the only user.

## Workflow

- Push finished, checked work straight to `main`. No pull requests, no asking first.
- Every change that ships gets a new patch version (0.0.x) and a GitHub release:
  1. Bump the version in `manifest.json`, `package.json` and `package-lock.json` (the top-level `version` and `packages[""].version`), and add it to the top of `versions.json` mapped to `manifest.json`'s `minAppVersion`.
  2. Add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`. The release workflow uses it as the release notes and fails without it.
  3. Commit and push to `main`, then publish the release with `.github/workflows/release.yml`, which builds the plugin and attaches `main.js`, `manifest.json` and `styles.css`. Either push the tag `x.y.z` (no `v` prefix) pointing at that commit, or, where tag pushes are blocked (cloud sessions), run the "Release Plugin" workflow on `main` with the input `version: x.y.z`; it creates the tag itself.
  4. Tell the owner the version number. Don't give them git commands; they use the GitHub web interface.
- Never reuse a version number that was already tagged or released.

## Checks before pushing

```
npm run lint   # eslint + tsc
npm test
npm run build
```

## Things to know

- `src/config.ts` (settings shape, per-library defaults, migration from older saved settings), `src/notes.ts` (matching, file names, classification) and `src/properties.ts` (the Plex field → property catalogue, `FIELD_SOURCES`) are pure (no Obsidian imports) and unit tested; `src/sync.ts` does the vault work, `src/plex.ts` and `src/steam.ts` the HTTP calls (via `requestUrl`, which avoids CORS); `src/steam-data.ts` (pure, tested) maps Steam's responses. Steam games are items of type `game` with rating key `steam-<appid>`, in the library keyed `steam` (`STEAM_LIBRARY`); their Link is the Steam Store page and their images are linked, not downloaded. The Steam Store's appdetails is rate limited (about 200 per 5 minutes), hence `SteamClient.storeGapMs`. HowLongToBeat (`src/hltb.ts`, pure parts in `src/hltb-data.ts`) has no public API: it mimics the site's search (GET `/api/search/site/init` for a token tied to IP and user agent, then POST `/api/search/site` with `x-auth-token`), needs a `Referer` header (falls back to Node's https on desktop if Obsidian drops it), and only accepts exact-name matches. If it breaks, re-read the site's search code (`/_next/static/chunks/*.js`, look for `/api/search`). SteamGridDB (`src/steamgriddb.ts`) needs the user's key and only offers covers in the pop-up.
- "Add something new" (`src/add-modal.ts`, `src/discover.ts`, pure mapping in `src/discover-data.ts`) searches OMDb (movies/shows, key in `settings.omdbKey`), the Steam Store and HowLongToBeat (games) and Open Library (books), and makes one note through `PlexSync.addNew` (same approval and properties as a sync). Items found this way have keys `imdb-…`, `steam-…`, `hltb-…`, `ol-…`, a `webLink` used as their Link, and linked (not downloaded) covers. Plex items also match notes linked to their IMDb ID (`itemKeys`; listings use `includeGuids=1`). Books live in the library keyed `books` (`BOOKS_LIBRARY`), which no sync reads. The OMDb and Open Library code follows Media DB Mod's (theshayneb/media-db-mod), which the owner used before.
- Folder, file name, matching, properties and property values are per library (`LibrarySetting`); character replacements, images subfolder and renaming are plugin-wide (documentaries are only what is in a library set to Documentaries; there is no genre detection). Changing settings shape needs a migration in `loadSettings`. Music libraries make one note per track and start as skipped.
- Properties are user-configurable. The video defaults in `DEFAULT_PROPERTIES` (Genre, Summary, Date, Duration, Status, Link, Image, tags) are the owner's choice; don't rename them. To offer a new Plex field, add it to `FieldSource`, `FIELD_SOURCES` and `sourceValue`.
- Documentaries never list "Documentary" as a genre.
- Existing notes: the only changes allowed are renaming them to their library's file name format (`renameExistingNotes`, via `fileManager.renameFile`, in place) and adding properties marked `fill` when they're missing or empty (never overwriting), and, with `updatePlayCounts` on, overwriting `PLAY_SOURCES` properties (Play count, game playtime), both only when `planRenames` says the match is unambiguous. Matching uses the Plex rating key inside the Plex link property (plus `Link`), then file names as the library's `matchBy` allows.
- With `askBeforeChanges` on, every creation and every change to an existing note goes through `PlexSync.ask` (the approval pop-up) first, with nothing written (not even a poster or folder) before approval. New writes must be planned, shown (one `ApprovalLine` per part, which can be unticked), then applied without the unticked parts and with the pop-up's edits (`Decision.edits`, turned back into values by `parseEdit`).
- Items in `settings.ignored` ("Skip every time", keyed by rating key) are never created or changed by any sync, but still take part in matching (`planRenames`) so their notes aren't claimed by other items.
- A note whose name matches several items (`ambiguousNotes`) is resolved by asking (`OwnerChooser`, full syncs with asking on): the chosen item is tied to it in the index, the rest stop matching it. `PlexSync.explain` reports, without writing, what a sync does with an item; keep it in step with `run`.
- The background schedule (`playCountHours`) runs `PlexSync.run(…, 'playCounts')`, which must only ever touch play counts.
- Never put the Plex token in note content (Plex image URLs need it, which is why posters are downloaded, into `<media folder>/Images`).
- Styles live in `styles.css`, with classes prefixed `pmn-`; use Obsidian's CSS variables, not inline styles.
- UI text must be sentence case (Obsidian lint rule); brand words are allowed in `eslint.config.mjs`.
