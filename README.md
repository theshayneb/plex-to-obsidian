# Plex Media Notes

An Obsidian plugin that creates a note for every movie, TV show and documentary on your Plex server that doesn't already have one in your vault.

## Setup

1. Settings → Plex Media Notes: enter the server address (e.g. `http://192.168.1.10:32400`) and your Plex token.
   To find the token, open any item in Plex Web, choose **Get info → View XML**, and copy the value after `X-Plex-Token=` in the address bar.
2. Press **Load libraries** and choose, for each library, Movies, TV shows, Documentaries or Skip.
3. Run **Create notes for new Plex movies and shows** from the command palette, or click the clapperboard in the ribbon.

## What a new note looks like

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

All of this can be changed in Settings → Properties: rename properties, reorder or remove them, change which Plex information fills each one (genres, summary, tagline, release date, duration in minutes or as "1h 52m", directors, writers, cast, studio, content rating, ratings, collections, labels, dates added and last watched, play count, seasons and episodes, IMDb/TMDB/TVDB IDs, or a fixed text), and change the status words and type tags under Property values. Properties Plex has no value for are still added, empty, so you can fill them in by hand. The defaults are:

- **Duration** is in minutes. For TV shows it's Plex's typical episode length.
- **Status** is `completed` once a movie has been played, or once every episode of a show has been watched; `started` for a movie stopped part way or a show with some episodes watched; otherwise `pending`. Other statuses (such as revisit or abandoned) are yours to set by hand; the plugin never changes existing notes.
- **Image** is the poster, downloaded into an `Images` subfolder of the note's folder (e.g. `Media/Movies/Images`). The subfolder name can be changed in settings. The Plex image URL itself would expose your token.
- **Genre** leaves out "Documentary" for documentaries.
- **tags** is `movie`, `tv_show` or `documentary`. With "Detect documentaries by genre" on, anything with the Documentary genre counts as a documentary and goes to the documentaries folder, whatever library it's in.

## Existing notes

The contents of existing notes are never changed. An item is skipped when a note in any of the three folders (including subfolders) either has a Link (or whatever the Plex link property is called) to that Plex item or has a file name matching its title, with or without the year. Case, punctuation and accents are ignored when matching.

With **Fix names of existing notes** on (the default), a matched note is renamed to the file name format, e.g. `Heat` → `Heat (1995)`. Only the file name changes, the note stays in its folder, and links to it are updated if Obsidian's "Automatically update internal links" is on. A note that could belong to more than one Plex item is left alone, and so is one whose new name is already taken.

## Mobile

The plugin works on mobile as long as the device can reach the Plex server. Otherwise, run it on a desktop and let Obsidian Sync carry the notes over.
