# Changelog

## [0.0.21] - 2026-10-07

### Added
- HowLongToBeat: game notes can get Main Story, Main + Extras and Completionist times (hours), plus "all styles" and a link to the game's HowLongToBeat page as other sources. They're looked up by the game's name (an exact match only, preferring the same release year, so a note never gets another game's times) and shown in the approval pop-up like any value. The first three are in the game defaults; a Steam library still on the 0.0.19 defaults gets them added.
- Cover picker: in the approval pop-up, a game's Image shows covers to pick from: Steam's portrait cover, HowLongToBeat's cover, and, with a SteamGridDB API key (optional, new setting in the Steam section), up to 8 SteamGridDB portrait covers. Click one to use it; the link can still be edited by hand. A game with no Steam portrait gets HowLongToBeat's cover.

### Changed
- Checked against the live Steam API and store: the Steam code now has been run on real data, not just test data.

## [0.0.20] - 2026-10-07

### Fixed
- A note whose name matches more than one item (say a plain `Black Sheep` note, with both the 1996 and 2006 films in Plex) was silently left alone, and neither item got a note. Now a pop-up asks which item the note is for. The chosen item is treated as the note's (so you're offered the rename to `Black Sheep (2006)`, its Link and so on, as usual), and the other items get their own notes. "None of these" gives every item a new note; "Skip" leaves things as they were for this sync.

### Added
- Command "Explain why an item is or isn't imported": paste a Plex or Steam link, or type part of a title, and see what a sync does with that item and why: no note yet (and where it would go), a note linked to it, a note matched by name (and which other items match it too), "Skip every time", its library set to Skip or not loaded, an episode or album link, or not in Steam's list. Nothing is changed.

## [0.0.19] - 2026-10-06

### Added
- Steam: set a Steam Web API key and your Steam account in the new Steam section (and press Check) to get a **Steam** library, type Video games, folder `Media/Video Games`. Every game you own, plus free-to-play games you've played (switchable), gets a note with Genre, Release Date, Total Playtime (hours), Status (`started` once played, otherwise `pending`), Link (Steam Store page), Image (portrait cover, linked), WideImage (landscape header, linked) and tags (`video_game`). Also available: playtime in the last 2 weeks, last played, developers, publishers, platforms, Metacritic score and description. Everything else works as for Plex: matching existing notes, renaming, fill-ins, the approval pop-up (cover links can be edited there), Skip every time, and play counts, where "Keep play counts up to date" and the background schedule also update Total Playtime.
- Plex and Steam each work on their own: the sync uses whichever is set up.

### Changed
- The plugin is now called **Media Import and Sync**, and its command "Import and sync media". (Its folder in `.obsidian/plugins` stays `plex-media-notes`, so your settings are kept.)

## [0.0.18] - 2026-10-06

### Added
- "Skip every time" in the approval pop-up: the Plex item is added to an ignore list, and every later sync (including background play count updates) passes over it completely: no new note, rename, fill-in or play count. Ignored items still count when matching, so their notes are never taken for another item.
- Settings → All libraries → Skipped every time: lists the ignored items with their library and date, each with "Un-ignore", plus "Un-ignore all". An un-ignored item is asked about again on the next sync.

## [0.0.17] - 2026-10-06

### Fixed
- Approval pop-up: property names no longer get squeezed into a column one letter wide. When the pop-up is narrow (a phone or a small window), each property is shown as a block instead: tick box and name, then "Now" and "New" underneath at full width.

## [0.0.16] - 2026-10-06

### Added
- Edit before saving: in the approval pop-up every new value can be edited. Lists such as Genre show each item as a chip with × to remove it and a box to add more (Enter or comma); text and numbers are edit boxes; the file name can be edited too, for renames and new notes (characters that can't be in file names are replaced as set in settings). Clearing a value that would be filled in leaves it out. Edits apply to that note only; "all the rest" still only repeats the unticked lines. The downloaded image can be unticked but not edited.

## [0.0.15] - 2026-10-06

### Changed
- The approval pop-up is much bigger (up to 1000 px wide and most of the window's height, scrolling when needed) and shows a table: for an existing note each line has what's in the note **now** next to what it will be, with *Empty* in italics when there's nothing; new notes list each property and its value. Unticked lines are crossed out. Long values such as summaries are shown in full.
- Releases now include a `styles.css`; install it next to `main.js` and `manifest.json`.

## [0.0.14] - 2026-10-06

### Added
- The approval pop-up has a tick box on every line: the rename, each property to fill in, each play count update, and each property of a new note. Untick what you don't want; Apply does only what's ticked (if nothing is, the note is skipped). In a new note an unticked property is added empty (and an unticked image isn't downloaded). "Apply to all the rest" / "Create all the rest" keep the same lines unticked for the rest of the sync.

## [0.0.13] - 2026-10-06

### Added
- Ask before every change (on by default): before creating a note, or changing an existing one in any way (renaming, filling in properties, updating a play count), a pop-up shows the note and exactly what will happen: the new name, each property and value to add, each play count's old and new value, or for a new note its file name and every property. Choose Apply (or Create), Skip, Apply to all the rest (or Create all the rest, which covers only that kind: changes or new notes), or Stop. Closing the pop-up skips the note. Nothing is written, and no poster downloaded, until you approve. Background play count updates ask too.

## [0.0.12] - 2026-10-06

### Added
- Property names in Settings → each library → Properties now suggest the properties already used in your vault as you type, most used first. Pick one, or keep typing a new name.

## [0.0.11] - 2026-10-06

### Added
- Keep play counts up to date (off by default): every sync also updates properties set to "Play count" in existing notes, in all libraries. It's the only property whose existing value is ever replaced.
- Update play counts automatically (Off by default, shown once the above is on): every hour, 6 hours, 12 hours or once a day, play counts are updated in the background while Obsidian is open. Only play counts: no notes are created, renamed or filled in. The schedule survives restarts, and if Plex can't be reached it quietly tries again an hour later.

### Changed
- "Play count" for a TV show falls back to the number of episodes watched when Plex has no total.

## [0.0.10] - 2026-10-06

### Added
- Music: set a music library's Type to "Music" to get one note per track. File names can use `{{artist}}`, `{{title}}`, `{{album}}`, `{{albumartist}}`, `{{track}}`, `{{disc}}` and `{{year}}` (default `{{artist}} - {{title}}`), and the default properties are Artist, Album, Track, Genre, Date, Duration (`4:24`), Link, Image (the album cover, saved once per album) and tags (`music`). New property sources: artist, album artist, album, track number, disc number, styles, moods, and duration as a clock. Genres, styles, moods, label and dates come from the track's album. Music libraries start as Skip.
- Every library now has its own folder, file name, properties and property values, in its own section of the settings. Your current folders, file name, properties and values are copied into each existing library. Character replacements, the images subfolder, renaming and documentary detection stay plugin-wide.
- Match existing notes by (per library): Plex link, title, title and year, or file name; Plex link or file name; or Plex link only.
- Fill in existing notes: each property has a switch to add it to existing notes that match a Plex item when it's missing or empty there. On by default for Link and Summary. Values already in a note are never replaced, and nothing else changes.

### Changed
- Documentary-genre items from other libraries now use your Documentaries library's settings (folder, file name, properties).
- A note whose Link points at another Plex item no longer matches by name (e.g. a `Dune` note linked to the 1984 film no longer stops a note for the 2021 one).
- A note named like `Airbag 2` (numbered because the name was taken) counts as correctly named and isn't renamed.
- Big libraries are read from Plex in pages of 500.
- The command is now "Create notes for new Plex items".

## [0.0.9] - 2026-10-06

### Changed
- "Your rating" is now in stars, 0–5, as shown in Plex, instead of Plex's internal 0–10. Half stars round up (2½ → 3).

### Added
- Property source "Your rating (⭐ emoji, 🩷 for 5 stars)": 1 star → ⭐, 3 stars → ⭐⭐⭐, 5 stars → 🩷. Half stars round up.

## [0.0.8] - 2026-10-06

### Added
- Settings → Characters in file names: choose what `:`, `?`, `/`, `"`, `*` and `#` (and, together, `\ < > | ^ [ ]`) become in file names, instead of always dropping them. For example `:` → `-` turns `Mission: Impossible` into `Mission- Impossible (1996)`. Empty still drops the character. A preview shows the result as you type. This applies to new notes and, with "Fix names of existing notes" on, renames existing ones to match.

## [0.0.7] - 2026-10-06

### Added
- Existing notes that match a Plex item are renamed to the file name format (by default `Title (Year)`), so a note called `Heat` becomes `Heat (1995)` and characters that can't be in file names are dropped. Only the file name changes; the note's contents and properties are untouched, and links to it are updated according to Obsidian's "Automatically update internal links" setting. The note stays in its folder. A note that could belong to more than one Plex item (say `Dune`, with both the 1984 and 2021 films in Plex) is left alone, as is a rename whose new name is already taken. Turn it off with Settings → Fix names of existing notes.

## [0.0.6] - 2026-10-06

### Fixed
- Settings no longer jump back to the top when you press a button (add, remove, move or reset a property, or load libraries). Changing a property's Plex source no longer redraws the page at all, except when switching to or from "Fixed text".

## [0.0.5] - 2026-10-06

### Changed
- New notes get every property in Settings → Properties, even when Plex has no value for it. Those are left empty (an empty list for list properties such as Genre or Cast) so you can fill them in by hand.

## [0.0.4] - 2026-10-06

### Added
- A third watch status, `started`, for a movie stopped part way through or a show with some but not all episodes watched. Its word can be changed in Settings → Property values, like `completed` and `pending`.

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
