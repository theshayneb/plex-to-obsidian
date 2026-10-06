# Changelog

## [0.0.1] - 2026-10-06

### Added
- First version. The "Create notes for new Plex movies and shows" command (also the clapperboard ribbon button) reads your Plex libraries and creates a note for every movie, TV show and documentary that doesn't have one yet.
- New notes go to `Media/Movies`, `Media/TV Shows` or `Media/Documentaries`, and get the properties Genre, Summary, Date, Duration (minutes), Status (`completed` if watched, otherwise `pending`), Link (opens the item in Plex Web), Image (poster saved to `Media/Posters`) and tags (`movie`, `tv_show` or `documentary`).
- Existing notes are never changed. A note counts as existing if its Link points at the Plex item or its file name matches the title (with or without the year).
