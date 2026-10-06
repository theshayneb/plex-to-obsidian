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
Image: "[[Media/Posters/Arrival (2016).jpg]]"
tags:
  - movie
---
```

- **Duration** is in minutes. For TV shows it's Plex's typical episode length.
- **Status** is `completed` once a movie has been played, or once every episode of a show has been watched; otherwise `pending`.
- **Image** is the poster, downloaded into the posters folder (the Plex image URL would expose your token).
- **tags** is `movie`, `tv_show` or `documentary`. With "Detect documentaries by genre" on, anything with the Documentary genre counts as a documentary and goes to the documentaries folder, whatever library it's in.

## Existing notes

Existing notes are never changed. An item is skipped when a note in any of the three folders (including subfolders) either has a Link to that Plex item or has a file name matching its title, with or without the year. Case, punctuation and accents are ignored when matching.

## Mobile

The plugin works on mobile as long as the device can reach the Plex server. Otherwise, run it on a desktop and let Obsidian Sync carry the notes over.
