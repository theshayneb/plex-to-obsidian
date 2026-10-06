# Changelog

## [0.0.3] - 2026-10-06

### Added
- Settings → Properties: choose which properties new notes get, what each is called, which Plex information fills it, and their order. Besides the original fields you can pick tagline, original title, year, duration as text (1h 52m), content rating, studio or network, directors, writers, cast, countries, Plex collections and labels, critic, audience and your own ratings, date added, date last watched, play count, number of seasons and episodes, IMDb, TMDB and TVDB IDs, or a fixed text. "Reset to defaults" brings back the original eight properties.
- Settings → Property values: the words used for watched and not-watched status, and the tag for movies, TV shows and documentaries.

### Changed
- Documentaries no longer list "Documentary" among their genres.

## [0.0.2] - 2026-10-06

### Changed
- Posters are now saved next to the notes, in an `Images` subfolder of the movies, TV shows or documentaries folder (e.g. `Media/Movies/Images`), instead of `Media/Posters`. The Posters folder setting is replaced by "Images subfolder". Posters already downloaded to `Media/Posters` aren't moved.

## [0.0.1] - 2026-10-06

### Added
- First version. The "Create notes for new Plex movies and shows" command (also the clapperboard ribbon button) reads your Plex libraries and creates a note for every movie, TV show and documentary that doesn't have one yet.
- New notes go to `Media/Movies`, `Media/TV Shows` or `Media/Documentaries`, and get the properties Genre, Summary, Date, Duration (minutes), Status (`completed` if watched, otherwise `pending`), Link (opens the item in Plex Web), Image (poster saved to `Media/Posters`) and tags (`movie`, `tv_show` or `documentary`).
- Existing notes are never changed. A note counts as existing if its Link points at the Plex item or its file name matches the title (with or without the year).
