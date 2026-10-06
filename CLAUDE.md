# Plex Media Notes: notes for Claude Code

A personal Obsidian plugin that creates notes for Plex movies, TV shows, documentaries and music tracks. The owner is the only user.

## Workflow

- Push finished, checked work straight to `main`. No pull requests, no asking first.
- Every change that ships gets a new patch version (0.0.x) and a GitHub release:
  1. Bump the version in `manifest.json`, `package.json` and `package-lock.json` (the top-level `version` and `packages[""].version`), and add it to the top of `versions.json` mapped to `manifest.json`'s `minAppVersion`.
  2. Add a `## [x.y.z] - YYYY-MM-DD` entry at the top of `CHANGELOG.md`. The release workflow uses it as the release notes and fails without it.
  3. Commit and push to `main`, then publish the release with `.github/workflows/release.yml`, which builds the plugin and attaches `main.js` and `manifest.json`. Either push the tag `x.y.z` (no `v` prefix) pointing at that commit, or, where tag pushes are blocked (cloud sessions), run the "Release Plugin" workflow on `main` with the input `version: x.y.z`; it creates the tag itself.
  4. Tell the owner the version number. Don't give them git commands; they use the GitHub web interface.
- Never reuse a version number that was already tagged or released.

## Checks before pushing

```
npm run lint   # eslint + tsc
npm test
npm run build
```

## Things to know

- `src/config.ts` (settings shape, per-library defaults, migration from older saved settings), `src/notes.ts` (matching, file names, classification) and `src/properties.ts` (the Plex field → property catalogue, `FIELD_SOURCES`) are pure (no Obsidian imports) and unit tested; `src/sync.ts` does the vault work, `src/plex.ts` the HTTP calls (via `requestUrl`, which avoids CORS).
- Folder, file name, matching, properties and property values are per library (`LibrarySetting`); character replacements, images subfolder, renaming and documentary detection are plugin-wide. Changing settings shape needs a migration in `loadSettings`. Music libraries make one note per track and start as skipped.
- Properties are user-configurable. The video defaults in `DEFAULT_PROPERTIES` (Genre, Summary, Date, Duration, Status, Link, Image, tags) are the owner's choice; don't rename them. To offer a new Plex field, add it to `FieldSource`, `FIELD_SOURCES` and `sourceValue`.
- Documentaries never list "Documentary" as a genre.
- Existing notes: the only changes allowed are renaming them to their library's file name format (`renameExistingNotes`, via `fileManager.renameFile`, in place) and adding properties marked `fill` when they're missing or empty (never overwriting), and, with `updatePlayCounts` on, overwriting `viewCount` ("Play count") properties, both only when `planRenames` says the match is unambiguous. Matching uses the Plex rating key inside the Plex link property (plus `Link`), then file names as the library's `matchBy` allows.
- With `askBeforeChanges` on, every creation and every change to an existing note goes through `PlexSync.ask` (the approval pop-up) first, with nothing written (not even a poster or folder) before approval. New writes must be planned, shown, then applied.
- The background schedule (`playCountHours`) runs `PlexSync.run(…, 'playCounts')`, which must only ever touch play counts.
- Never put the Plex token in note content (Plex image URLs need it, which is why posters are downloaded, into `<media folder>/Images`).
- UI text must be sentence case (Obsidian lint rule); brand words are allowed in `eslint.config.mjs`.
