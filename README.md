# Media Import and Sync

An Obsidian plugin that creates (and keeps in sync) a note for every movie, TV show, documentary and music track on your Plex server, and every game in your Steam library, that doesn't already have one in your vault.

## Setup

1. Settings → Plex Media Notes: enter the server address (e.g. `http://192.168.1.10:32400`) and your Plex token.
   To find the token, open any item in Plex Web, choose **Get info → View XML**, and copy the value after `X-Plex-Token=` in the address bar.
2. Press **Load libraries**. Each Plex library gets its own section: open it and choose its **Type** (Movies, TV shows, Documentaries, Music or Skip). Music libraries start as Skip, since they make one note per track.
3. For games, fill in the **Steam** section: a Steam Web API key (from steamcommunity.com/dev/apikey) and your Steam account (Steam ID, profile address or custom profile name), and press **Check**. Your profile's "Game details" privacy setting must be Public. A **Steam** library appears with the others.
4. Run **Import and sync media** from the command palette, or click the clapperboard in the ribbon.

## Per library

Each library has its own:

- **Folder** where its notes go (defaults `Media/Movies`, `Media/TV Shows`, `Media/Documentaries`, `Media/Music`).
- **File name**: `{{title}} ({{year}})` by default; music can also use `{{artist}}`, `{{album}}`, `{{albumartist}}`, `{{track}}` and `{{disc}}` and defaults to `{{artist}} - {{title}}`.
- **Match existing notes by**: Plex link, title, title and year, or file name (the default for video); Plex link or file name (the default for music, where titles like "Intro" are too common); or Plex link only.
- **Properties**: rename (the name box suggests properties already in your vault), reorder or remove them, and choose which Plex information fills each one (genres, summary, tagline, release date, duration in minutes, as "1h 52m" or as "3:45", directors, writers, cast, studio or label, content rating, ratings (yours as 0–5 stars or as ⭐ emoji), collections, labels, dates added and last watched, play count, seasons and episodes, IMDb/TMDB/TVDB IDs, music artist, album, track and disc numbers, styles and moods, or a fixed text). Properties Plex has no value for are still added, empty, so you can fill them in by hand. The switch on each property fills it in on existing notes (see below).
- **Property values**: the status words (not for music) and the type tag.

The default video note:

```yaml
---
Genre:
  - Science Fiction
  - Drama
Summary: A linguist works with the military to communicate with alien lifeforms…
Date: 2016-11-11
Duration: 116
Status: completed
Link: https://app.plex.tv/desktop/#!/server/…/details?key=%2Flibrary%2Fmetadata%2F1234
Image: "[[Media/Movies/Images/Arrival (2016).jpg]]"
tags:
  - movie
---
```

- **Duration** is in minutes. For TV shows it's Plex's typical episode length.
- **Status** is `completed` once a movie has been played, or once every episode of a show has been watched; `started` for a movie stopped part way or a show with some episodes watched; otherwise `pending`.
- **Image** is the poster, downloaded into an `Images` subfolder of the library's folder. The Plex image URL itself would expose your token.
- **Genre** leaves out "Documentary" for documentaries.
- A movie or show with the Documentary genre gets its note from your Documentaries library's settings, whatever library it's in.

The default music (track) note has Artist, Album, Track, Genre (from the album), Date (the album's release date), Duration (`4:24`), Link, Image (the album cover, shared by its tracks) and tags (`music`).

## Games (Steam)

Every game in your Steam library (plus free-to-play games you've played, unless switched off) gets a note in `Media/Video Games`, by default with Genre, Release Date, Total Playtime (hours), Status (`started` once played, otherwise `pending`; finished, abandoned and so on are yours to set), Link (the Steam Store page), Image (the portrait cover, linked), WideImage (the landscape header, linked) and tags (`video_game`). Other sources include playtime in the last two weeks, last played, developers, publishers, platforms, Metacritic score and description. With **Keep play counts up to date** on, Total Playtime is kept up to date too, also by the background schedule.

Game notes also get the **Main Story** time (in minutes) from HowLongToBeat (looked up by the game's exact name; no key needed). In the approval pop-up, a game's Image comes with covers to pick from: Steam's, HowLongToBeat's and, with an optional SteamGridDB API key (Steam section of the settings), SteamGridDB's.

Store details come from the Steam Store, which allows about 200 requests every 5 minutes, so new games are read a little over one a second.

## Adding things not in Plex or Steam

Run **Add something new** from the command palette. Choose what it is (movie, TV show, video game, book) and which library it goes in, search, and pick a result. The note is made like a synced one (you're asked first, with everything editable) in that library's folder, with its properties.

- **Movies and TV shows**: from OMDb, which needs a free API key (omdbapi.com; enter it under Settings → Adding things not in Plex or Steam). The Link is the IMDb page; when the movie later shows up in Plex, the sync recognises the note by its IMDb ID.
- **Video games**: from the Steam Store (any Steam game) and HowLongToBeat (games on other platforms). No key needed.
- **Books**: from Open Library, into the **Books** library (`Media/Books`). No key needed.

## File names

Characters that can't be in file names are dropped, unless you choose a replacement for them under **Characters in file names** (for all libraries); e.g. `:` → `-` gives `Mission- Impossible (1996)`.

## Asking first

With **Ask before every change** on (the default), nothing is created or changed without a pop-up first: for an existing note it lists the new name, each property to fill in and each play count update; for a new note its file name and all its properties. Choose **Apply**/**Create**, **Skip**, **Apply to all the rest**/**Create all the rest** (only for that kind, changes or new notes, in this sync), or **Stop**. Every new value can be edited first (lists as chips: × removes an item, the box adds one; text and numbers as edit boxes; the file name too). Each line has a tick box: untick what you don't want and only the ticked parts happen (an unticked property in a new note is added empty). "All the rest" keeps the same lines unticked for the rest of the sync. Closing the pop-up skips that note. **Skip every time** puts the item on an ignore list that every sync (background play count updates too) passes over; Settings → Skipped every time lists them, with **Un-ignore** buttons. Background play count updates ask too.

## Existing notes

An item is skipped when a note in its library's folder (including subfolders) matches it, as set by **Match existing notes by**. Movies, shows and documentaries also look in each other's folders. A note whose Link points at a different Plex item never matches by name.

When a note matches exactly one Plex item (and no other item could be it):

- With **Fix names of existing notes** on (the default), it's renamed to its library's file name format, e.g. `Heat` → `Heat (1995)`. Only the file name changes, the note stays in its folder, and links to it are updated if Obsidian's "Automatically update internal links" is on.
- Properties with their fill-in switch on (Link and Summary by default) are added when missing or empty in the note. Values already there are never replaced, and nothing else in the note changes.

## Play counts

With **Keep play counts up to date** on (it's off by default), every sync also updates properties set to "Play count" in existing notes, in all libraries; it's the only value in an existing note the plugin ever replaces. **Update play counts automatically** then does just that in the background, every hour, 6 hours, 12 hours or day, while Obsidian is open.

## When something isn't imported

Run **Explain why an item is or isn't imported** from the command palette and paste the item's Plex link (or a Steam Store link, or part of the title). It says what a sync does with that item and why, without changing anything.

If a note's name matches more than one item (e.g. a plain `Black Sheep` note when Plex has both the 1996 and 2006 films), the sync asks which item the note is for; the others then get their own notes.

## Mobile

The plugin works on mobile as long as the device can reach the Plex server. Otherwise, run it on a desktop and let Obsidian Sync carry the notes over.
