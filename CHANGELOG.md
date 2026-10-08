# Changelog

## [0.0.51] - 2026-10-08

### Changed
- **Check existing notes against sources** now compares every property set up in a library, and fills in any that a note is missing or has empty (offered ticked), including covers: a Plex poster is downloaded into Images when approved, and WideImage and game covers are linked. All properties start ticked in its list (your earlier choice is reset once).
  - Status: compared too; a change only starts ticked when it moves forward (pending → started → completed). Not compared for books.
  - Ratings: where your note's rating differs from Plex's, both ways are offered, unticked: use Plex's in the note, or send yours to Plex ("Your rating in Plex"). Tick the one you want.
  - tags: the source's tag is added to the note's tags; your own tags stay.
  - Play counts, playtime, last played, Steam collections and fixed text are compared like any other value.

## [0.0.50] - 2026-10-08

### Added
- A way to check every connection in Setup, like Steam's: **Check Plex** (connects with the server address and token, and says how many libraries it found), and **Test** buttons for the SteamGridDB API key and the Google Books API key (Google Books can be tested with no key, too). OMDb already had one.

## [0.0.49] - 2026-10-08

### Changed
- "Check existing notes against sources": an image property (Image, WideImage) that already holds a link to an image in your vault (starting with `[[`) is an image you set yourself, so its replacement is offered unticked, whatever "Tick differences to start with" says. Tick it if you do want the source's.

## [0.0.48] - 2026-10-08

### Changed
- Book summaries now come from **Google Books** (the publisher's description), found by ISBN or by title and author; Open Library's description is only used when Google Books has none. This applies to "Add something new" and to "Check existing notes against sources", which offers the Google Books summary where a note's differs (ticked, with "Tick differences to start with" on). Everything else about books still comes from Open Library. A Google Books API key is optional (Setup → Adding things not in Plex or Steam); without one there's a daily limit.
- Books: "Fiction" is left out of a book's genres when it has any other genre from your **Genres to keep** (it stays when it's the only one).

## [0.0.47] - 2026-10-08

### Added
- **Games: your Steam collections (desktop only)**, a new property source: the names of your own Steam collections a game is in (Favorites included; Hidden and dynamic, filter-built collections aren't). Add a property with this source to the Steam library (say "Collections"). Steam only keeps your collections in its own files on your computer, so they're read in the desktop app only, from Steam's folder (the usual place, or the new **Steam folder** setting under Setup → Steam). Every sync on the desktop keeps the property in step with your collections; on your phone it's left alone. **Check Steam** now also says how many collections it found. Collections are only read, never changed in Steam.

## [0.0.46] - 2026-10-08

### Added
- **Romance** is added to **Genres to keep**, for everything except music.
- **Genres to leave out** (each library's settings): genres never written for that library, even when they're in Genres to keep. Your music libraries leave out Romance.

## [0.0.45] - 2026-10-08

### Added
- **Send ratings to Plex** (Settings → All libraries, off to start): when you rate something in a note (a "Your rating" property, stars or emoji) and Plex has no rating, or still has the one the two last agreed on, a sync offers a "Your rating in Plex" line in the approval pop-up; applying it sets that rating in Plex. Only with "Ask before every change" on, so nothing is sent without you seeing it. Untick it to keep Plex's as it is (not offered again while your note's rating stays the same).
- Music: a track's own moods (Plex's "Mood") are read when a music library has a property set to "Music: moods". The library listing leaves them out, so each track is fetched when its note is made or filled in; a track without moods of its own gets its album's.

### Changed
- Ratings: the plugin now remembers the rating each note and Plex last agreed on, so a rating you change in a note is no longer replaced with Plex's old one by "Keep ratings up to date". A rating changed in Plex still comes into the note.

## [0.0.44] - 2026-10-08

### Changed
- Music: track lengths are no longer recorded. Duration is gone from the music defaults, and removed once from your music libraries' properties (add it back in a library's settings if you ever want it). Existing notes aren't changed.
- Books: the page count goes in **Duration**, like other media's length. The Books library's "Pages" property is renamed to Duration once (rename it back in its settings if you prefer). Existing notes aren't changed; "Check existing notes against sources" can fill Duration in.

## [0.0.43] - 2026-10-08

### Changed
- In the "Change this note?" pop-up, every offered replacement of a value already in a note (links, durations, and anything "Check existing notes against sources" finds) now starts ticked, so applying uses the source's value; untick the ones to keep. This is the new **Tick differences to start with** setting (Settings → All libraries, on). Turn it off to go back to ticking only clear-cut fixes (empty values, durations written in hours, search links, genres).

## [0.0.42] - 2026-10-08

### Added
- Every sync now points out notes that match nothing: a note in a library's folder with nothing for it in that source (a note in Movies that isn't in your Plex movies, a note in Video Games that isn't in your Steam library). After the sync, a pop-up lists them, each with **Open** and **Always ignore** (for notes that are fine as they are, like something added with "Add something new" that isn't in Plex or Steam yet, or an index note). The sync's summary counts them too. Ignored notes are listed under Settings → Skipped every time, with **Stop ignoring**, and stay ignored if you rename or move them. "Check existing notes against sources" uses the same list.

## [0.0.41] - 2026-10-08

### Changed
- **Check existing notes against sources** (command) replaces "Check genres of existing notes". It now compares every property you choose, not just Genre:
  - First, a window lists the properties your libraries use (Genre, Summary, Date, Duration, Link, Author, Pages, Main Story…), each with the source that fills it and the libraries that have it. Tick the ones to compare; your choice is remembered. Covers start unticked; status, play counts, playtime and ratings aren't offered, since syncs keep those up to date.
  - Each note matched to a Plex item or Steam game, and each book note (via Open Library, looked up by title and author when it has no Open Library link), is compared with its source, and you're asked about each difference in the usual pop-up, with yours and the source's side by side. Empty values, durations written in hours, search links and genres are offered ticked; any other difference starts unticked, so your value stays unless you tick it. A value you keep isn't offered again.
  - At the end, a report says what changed and lists the notes in your libraries' folders that matched nothing; click one to open it.

## [0.0.40] - 2026-10-08

### Added
- **Keep status up to date** (Settings → All libraries, off to start): every sync also moves "Watched or played status" properties forward in existing notes, as Plex and Steam change: pending → started → completed for movies and shows, and pending → started once you've played a game (with the values set under each library's property values). A status never moves back, and one of your own, such as revisit or abandoned, is never changed. An empty status is filled in. With asking on, it's shown in the approval pop-up first, like everything else. The background schedule (**Update automatically**) does this too when it's on.

## [0.0.39] - 2026-10-08

### Added
- **Check genres of existing notes** now covers book notes too (every note in the Books library's folder), comparing their genres with Open Library's subjects (kept ones only).
  - A note with an Open Library link is checked against that book.
  - A note without one is looked up on Open Library by its title and Author (a name like "Dune by Frank Herbert" is searched as "Dune", by Frank Herbert). The pop-up says which book was found (title, author, year) so you can check it's the same book, and also offers its Open Library link. Wrong book? Press Skip. If you untick the link, that note isn't looked up again.

## [0.0.38] - 2026-10-08

### Added
- **Check genres of existing notes** (command): goes through every note matched to a Plex item or Steam game, compares its Genre with the source's, and shows the "Change this note?" pop-up where they differ. The genres offered are the note's own that are in **Genres to keep**, plus the source's that are (Steam's store tags included). So unwanted genres drop out and missing ones are added. Remove any with ×, or untick to keep the note's as they are, and it won't be asked about again. It always asks, even with "Ask before every change" off, and changes nothing but genres. It's slow, because each item's full details are fetched (Steam's spaced out, about one game every second and a half), so it's a command rather than part of every sync.

## [0.0.37] - 2026-10-08

### Added
- Game genres now include the Steam store's player tags (the "Mystery", "Comedy", "Detective"… shown on a game's store page) that are in your **Genres to keep**. Steam's official genres are few (DinoCop's are only Adventure, Casual and Indie), so this is how Mystery and Comedy get in. Tags not on your list are left out; with the list empty, tags aren't used at all.

## [0.0.36] - 2026-10-08

### Added
- Fixing durations in existing notes: when a note's Duration (a property set to "Duration in minutes") differs from Plex's, syncs show the "Change this note?" pop-up with both. Only when "Ask before every change" is on.
  - The same length written as hours (2.3 for 138 minutes) or as text ("2h 18m") is offered ticked, so "Apply to all the rest" fixes them all at once.
  - Any other difference is offered unticked. Keep your value and it isn't offered again, unless it changes.

## [0.0.35] - 2026-10-08

### Fixed
- The "Change this note?" pop-up listed an empty playtime or play count property (such as Progress) twice when it was both marked to be filled in and kept up to date. It's now offered once.

## [0.0.34] - 2026-10-08

### Added
- **Genres to keep** (Settings → All libraries): only these genres are written to notes, in every library, whether a note is new or being filled in. If an item has three genres and one is on the list, only that one is written. Other names count too: "Science fiction" becomes Sci-Fi, "Action & Adventure" becomes Action and Adventure, "Music" becomes Musical. Starts with your list: Action, Adventure, Biography, Collecting, Comedy, Crime, Documentary, Dystopian, Fantasy, Fiction, Fitness, History, Horror, Memoir, Musical, Mystery, Puzzle, Rhythm, Sci-Fi, Science, Self-Help, Simulation, Strategy, Thriller, Trivia, Western. Empty the box to keep every genre.

### Fixed
- With "Include free-to-play games" on, Steam is now also asked for free games you added to your library but haven't played, and for newer games Steam hasn't finished reviewing. Before, only free games you had played were listed.

## [0.0.33] - 2026-10-08

### Added
- Fixing links in existing notes: when a note's Link doesn't point to its item (for example a Steam search link like `store.steampowered.com/search/?term=…`, rather than the game's store page), syncs show the "Change this note?" pop-up with the note's link and the right one. Only when "Ask before every change" is on: a link that's already there is never replaced without asking.
  - Search links (Steam's, Google's and the like) are offered ticked, so they're replaced unless you untick them; "Apply to all the rest" fixes them all at once.
  - Any other link is offered unticked, so it's kept unless you tick it. Keep it and you won't be asked about it again, unless the link changes.
  - You can edit the new link before applying.

## [0.0.32] - 2026-10-08

### Added
- **Use an existing note…** in the pop-up for a new note: for an item you already have a note for under a different name. Search your notes and pick it; the item is then tied to that note for good. Syncs never offer to create it again and never rename the note (it keeps your name for it, and stays tied if you rename or move it yourself). Next, a pop-up offers to fill in every property the note is missing or has empty; nothing already there is changed. Play counts and ratings are kept up to date there as usual, when switched on. Works in "Add something new" too.
- **Merged with existing notes** (Settings, at the bottom): the items tied this way, each with an Unmerge button.

## [0.0.31] - 2026-10-08

### Added
- **Keep ratings up to date** (Settings → All libraries, off to start): every sync also updates properties set to "Your rating" (stars or emoji) in existing notes when you've changed the rating in Plex. A note keeps its rating if the item has none in Plex. Like play counts, the change is shown in the approval pop-up first when asking is on.
- The background schedule (now **Update automatically**) updates ratings too when that's on, and play counts only when "Keep play counts up to date" is on.

## [0.0.30] - 2026-10-07

### Changed
- The **All libraries** section of the settings is now collapsible, and closed until you open it, like Setup.

## [0.0.29] - 2026-10-07

### Removed
- Documentary detection by genre. Documentaries are now only the items in libraries set to Documentaries (such as Documentaries and Documentary Series). A movie or show in another library gets its note from that library's settings, even with the Documentary genre. Documentaries still never list "Documentary" as a genre.

## [0.0.28] - 2026-10-07

### Changed
- Settings page rearranged:
  - **Setup** (collapsed until you open it) comes first, with the Plex server, Steam and OMDb keys and accounts.
  - **All libraries** comes second. The "Replace …" choices are indented under "Characters in file names".
  - **Libraries** comes third, with the libraries indented under it.
  - **Skipped every time** is its own collapsible section at the bottom.
- The "Detect documentaries by genre" setting is gone from the page. Syncs keep working as before: movies and shows with the documentary genre still use your documentaries library's settings.

## [0.0.27] - 2026-10-07

### Fixed
- Book genres from Open Library no longer start with "genre:" (e.g. "genre:Fiction" is now "Fiction"). Open Library's other tags, such as New York Times list codes ("nyt:…"), are left out, as are repeated genres.

## [0.0.26] - 2026-10-07

### Added
- Book file names can use `{{author}}` (all the book's authors, separated by commas), e.g. `{{title}} by {{author}}`. A trailing "by" is dropped when a book has no author.

## [0.0.25] - 2026-10-07

### Fixed
- OMDb key: spaces and invisible characters picked up when copying are now removed (these made OMDb answer 401), and pasting the link from OMDb's email works too. The key is shown in plain text so you can check it.

### Added
- A **Test** button next to the OMDb API key, which tries the key and says whether it works.
- When OMDb refuses a search, the message now gives OMDb's own reason (for example "Invalid API key!" or "Request limit reached!").

## [0.0.24] - 2026-10-07

### Added
- **Add something new** (command): make a note for something that isn't in Plex or Steam yet. Choose Movie, TV show, Video game or Book and the library to add it to, search, and pick a result; the approval pop-up shows the note (editable, with cover choices for games) before it's made, and the note opens. If a note for it already exists, that note opens instead.
  - Movies and TV shows come from OMDb (needs a free OMDb API key: Settings → Adding things not in Plex or Steam), with genres, plot, release date, runtime (minutes), rating, directors, writers, cast, countries, the poster (linked) and the IMDb page as Link.
  - Games come from the Steam Store (any Steam game, with the same details as your own games) and HowLongToBeat (games on other platforms, with platforms, year, Main Story and cover). No key needed.
  - Books come from Open Library: authors, first published year, pages, a few subjects as Genre, description, ISBN, cover (linked) and the Open Library page as Link. No key needed. They go in a new **Books** library (`Media/Books`) with its own settings; book property sources: authors, number of pages, ISBN.
- When a movie or show added from IMDb later appears in Plex, the sync recognises its note through the IMDb ID (even under another title) instead of making a second one. Plex is now asked for each item's IMDb ID when reading a library.

## [0.0.23] - 2026-10-07

### Changed
- HowLongToBeat's Main Story is now in whole minutes (e.g. Portal 2: 515), like Plex durations, instead of hours. Notes that already have it keep their hours value.

## [0.0.22] - 2026-10-07

### Changed
- HowLongToBeat: only the Main Story time is used. Main + Extras, Completionist and "all styles" are gone from the property sources and the game defaults, and properties using them are removed from your library settings. (Notes that already have them keep them.)

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
