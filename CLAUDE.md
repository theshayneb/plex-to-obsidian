# Plex Media Notes: notes for Claude Code

A personal Obsidian plugin that creates notes for Plex movies, TV shows and documentaries. The owner is the only user.

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

- `src/notes.ts` holds the pure mapping logic (no Obsidian imports) and is unit tested; `src/sync.ts` does the vault work, `src/plex.ts` the HTTP calls (via `requestUrl`, which avoids CORS).
- Frontmatter property names (Genre, Summary, Date, Duration, Status, Link, Image, tags) are the owner's choice; don't rename them.
- Existing notes are never modified. Matching uses the Plex rating key inside the Link property, then the file name.
- Never put the Plex token in note content (Plex image URLs need it, which is why posters are downloaded, into `<media folder>/Images`).
- UI text must be sentence case (Obsidian lint rule); brand words are allowed in `eslint.config.mjs`.
