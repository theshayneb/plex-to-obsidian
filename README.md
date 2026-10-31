# Media Manager

An Obsidian plugin that keeps a note for everything you watch, play, read and listen to, and keeps those notes in step with where they come from:

- **Plex**: movies, TV shows, documentaries and music (one note per song).
- **Steam**: your games, with playtime, HowLongToBeat times and your Steam collections.
- **Books**: from Open Library and Google Books.
- **Anything else** you add yourself: movies and shows from OMDb, games from the Steam Store or HowLongToBeat, books from Open Library.

It never changes anything without your say-so (unless you switch asking off), and it never puts your Plex token in a note.

On top of the notes, it gives you:

- a **media dashboard** with Insights, Habits, Recommendations and Randomizers, and cards from it you can put in any note;
- **reactions**: a quick "how was it?" after you finish something;
- **daily notes** that fill in the episodes you watched and offer to link what you watched;
- **Plex playlists, collections and a "Revisit" mix**, made from your notes;
- a **daily check-in**, so questions come at one time of day instead of whenever.

The sections below cover what each part does, every setting, and what happens behind the scenes.

---

## Contents

1. [Setting it up](#setting-it-up)
2. [Commands](#commands)
3. [Settings, section by section](#settings-section-by-section)
4. [What a sync does](#what-a-sync-does)
5. [The approval pop-up](#the-approval-pop-up)
6. [Checking notes against sources](#checking-notes-against-sources)
7. [Ratings](#ratings)
8. [Games (Steam)](#games-steam)
9. [Books](#books)
10. [Music](#music)
11. [Adding something new](#adding-something-new)
12. [Background updates and the daily check-in](#background-updates-and-the-daily-check-in)
13. [Daily notes](#daily-notes)
14. [Reactions and Notes](#reactions-and-notes)
15. [The media dashboard](#the-media-dashboard)
16. [Dashboard cards in your notes](#dashboard-cards-in-your-notes)
17. [Plex playlists, collections and Revisit](#plex-playlists-collections-and-revisit)
18. [What it writes outside your vault](#what-it-writes-outside-your-vault)
19. [Remembered choices](#remembered-choices)
20. [When something looks wrong](#when-something-looks-wrong)
21. [Phones and tablets](#phones-and-tablets)

---

## Setting it up

1. **Plex**: Settings → Media Manager → Connections. Enter the server address (for example `http://192.168.1.10:32400`) and your Plex token, then press **Test Plex**.
   To find the token: in Plex Web, open any item, choose **Get info → View XML**, and copy the value after `X-Plex-Token=` in the address bar.
2. **Libraries**: press **Load libraries**. Each Plex library gets a section; open it and choose its **Type**: Movies, TV shows, Documentaries, Music or Skip. Music libraries start as Skip, since they make one note per song.
3. **Steam** (optional): enter a Steam Web API key (from steamcommunity.com/dev/apikey) and your Steam account (Steam ID, profile address or custom name), then press **Test Steam**. Your Steam profile's "Game details" privacy must be Public. A **Steam** library appears with the others.
4. **Other sources** (all optional): an OMDb key for adding movies and shows, a Google Books key for more book lookups a day, a Last.fm key and username for song play counts and suggestions, and a ListenBrainz username for song suggestions.
5. Run **Sync with Plex and Steam…** from the command palette, or click the clapperboard in the left ribbon.

---

## Commands

Open the command palette (Ctrl/Cmd+P) and type "Media Manager".

| Command | What it does |
|---|---|
| **Sync with Plex and Steam…** (also the clapperboard in the ribbon) | Asks which libraries, then makes notes for new items and keeps existing notes up to date (see [What a sync does](#what-a-sync-does)). |
| **Sync every library with Plex and Steam** | The same, for every library, without asking which. |
| **Check notes against sources…** | Compares chosen properties of your notes with Plex, Steam, Open Library and so on, and offers to fix differences. See [Checking notes](#checking-notes-against-sources). |
| **Check this note** | The same, for the note that's open, every property. |
| **Fix year-only dates** | Checks just the notes whose date is only a year (written YYYY-01-01). |
| **Add a movie, show, game or book…** | Searches outside Plex and Steam and makes a note. See [Adding something new](#adding-something-new). |
| **Why isn't this imported?…** | Paste a Plex or Steam link (or part of a title); it explains what a sync does with that item and why, changing nothing. |
| **Tie this note to a Plex item…** | Tells the plugin which Plex item the open note is for (paste a Plex link; for an album, pick the song). |
| **Add watched episodes to daily notes** | Adds the last week of watched episodes to your daily notes, bringing back lines you deleted. |
| **Add what you watched to daily notes…** | Shows the movies and shows waiting to go in your daily notes' Related property. |
| **Check in now (everything waiting for your yes)** | Runs the [daily check-in](#background-updates-and-the-daily-check-in) straight away. |
| **Send collections to Plex…** | Shows the Plex collections your notes ask for and what would change, then sends them. |
| **Make the "Revisit" playlist in Plex** | Makes a new Revisit mix and sends it to Plex. |
| **React to this note…** | "How was it?" for the open note. |
| **React to what you just finished…** | Lists movies and shows you finished lately, to react to. |
| **Open media dashboard** (also the sparkles in the ribbon) | Opens the dashboard. |

---

## Settings, section by section

### Connections

**Plex server**
- **Server address**, **Token**, **Test Plex**: see [Setting it up](#setting-it-up).

**Steam**
- **Steam Web API key** and **Steam account**: needed for games.
- **Include free-to-play games**: also lists free games in your library, played or not.
- **SteamGridDB API key** (optional): adds SteamGridDB covers to pick from when a game's image is offered.
- **Steam folder** (desktop only): where Steam is installed, if not in the usual place. Your Steam collections are read from Steam's own files there.
- **Test Steam**: reads your games once and adds the Steam library.

**Other sources**
- **OMDb API key**: needed to add movies and shows that aren't in Plex. Free at omdbapi.com (1,000 searches a day).
- **Google Books API key** (optional): book summaries and exact dates work without one; a key only raises the daily limit.
- **Last.fm API key** (optional): song suggestions on the dashboard.
- **Last.fm username** (optional): your Last.fm play count is offered beside Plex's for songs.
- **ListenBrainz username** (optional, no key): ListenBrainz's song suggestions on the dashboard.
- **Revisit playlist every week**: remakes the Revisit playlist in Plex weekly (see [Revisit](#revisit)).
- **Property naming collections** (default `Playlist`): the property in movie and show notes that names their Plex collections.
- **Automatic collections in Plex**: one per line, `Name: tag or theme`, such as `Comfort: comfort`. See [collections](#collections).

### Syncing

- **Ask before every change** (on by default): every new note, and every change to an existing one, goes through the [approval pop-up](#the-approval-pop-up) first. Checks always ask.
- **Start replacements ticked** (on by default): when a pop-up offers to replace a value already in a note, it starts ticked. Off, only clear-cut fixes start ticked: empty values, durations in hours, search links and genres.
- **Rename notes to the file name format**: each sync renames notes whose name doesn't follow their library's format (for example, adding the year). A note that could belong to more than one item is left alone.
- **Update play counts**: copies play counts (and games' playtime) from Plex and Steam into existing notes.
- **Update ratings from Plex**: copies a rating you changed in Plex into the note. A rating you changed in the note is never overwritten.
- **Send ratings to Plex**: when you change a rating in a note, the sync's pop-up offers to send it to Plex.
- **Move statuses forward**: moves a note's status forward as you watch or play (not watched → started → watched; games: not played → played). It never moves back, and a status of your own, such as `revisit`, is never changed.
- **Update in the background**: Off, every 2, 6 or 12 hours, or once a day, while Obsidian is open. See [Background updates](#background-updates-and-the-daily-check-in).
- **Daily check-in** (default 19:00): the one time of day background questions are asked. Leave it empty to be asked at every background update.
- **Watched episodes in daily notes**, **Under the line**, **Quote markers**, **Link in a property**, **Daily notes folder and date format**: see [Daily notes](#daily-notes).
- **Bedtime shows** and **Between**: episodes of these shows watched between these times don't count anywhere (they're someone else's bedtime viewing). See [Daily notes](#daily-notes).

### New notes

- **Images folder** (default `Images`): Plex posters are downloaded into this folder inside each library's folder. An album's songs share one cover.
- **Characters in file names**: characters that can't be in file names are dropped, unless you choose a replacement (for example `:` → `-` gives `Mission- Impossible (1996)`). Square brackets become round ones.
- **Genres to keep**: only these genres are written to notes; other names for them count too ("Science fiction" for Sci-Fi). Empty keeps every genre.

### Reactions

- **Point out what you finish**: after background updates, movies and shows you finished are pointed out, to react to. With a daily check-in time set, this happens as a pop-up at the check-in.
- **Feelings to choose from**, **Themes to choose from**, **Tags to choose from**: the words offered in the "How was it?" pop-up. Taking one out only stops it being offered; notes that have it keep it.
- **Reactions property**, **Feelings property**, **Themes property**, **Why property**: where reactions, feelings, themes and your reason for wanting something are written (defaults `Reactions`, `Feelings`, `Themes`, `Why`). Feelings and Themes are plain text list properties, not Obsidian #tags.

### Libraries

Every library (each Plex library, plus Steam and Books) has its own section:

- **Type**: Movies, TV shows, Documentaries, Music, or Skip (no notes, and its plays count nowhere, such as a yoga or exercise library).
- **Folder** where its notes go. Defaults: `Media/Movies`, `Media/TV Shows`, `Media/Documentaries`, `Media/Music`, `Media/Video Games`, `Media/Books`. Existing notes are looked for here, including subfolders.
- **File name** format. Defaults:
  - movies, shows, documentaries and games: `{{title}} ({{year}})`;
  - music: `{{artist}} - {{title}}` (also `{{album}}`, `{{albumartist}}`, `{{track}}`, `{{disc}}`);
  - books: `{{title}} by {{author}} ({{year}})`.
- **Recognise existing notes by**: how a note already in the folder is recognised as an item, so no second note is made: its link, its title, its title and year, or its file name. Case, accents and punctuation don't matter, and a note linking to a different item never matches by name.
- **Genres to leave out**: genres never written in this library, even ones you keep (music leaves out Romance).
- **Status and tag values**: the words for not watched, started and watched (defaults `pending`, `started`, `completed`), and the type tag (`movie`, `tv_show`, `documentary`, `music`, `video_game`, `book`).
- **Status from Steam collections** (Steam only): see [Games](#games-steam).
- **Properties**: rename, reorder or remove them, and choose what fills each one. The switch on each property ("fill in") also adds it to existing notes that lack it, without overwriting anything. What can fill a property:
  - **About the item**: genres, summary, tagline, title, original title, release date (first aired for shows), year, duration (in minutes, as "1h 52m", or as "3:45"), content rating, studio/network/label, directors, writers, cast (top 5 or everyone), countries, Plex collections, Plex labels, critic and audience ratings, number of seasons and episodes, IMDb/TMDB/TVDB IDs.
  - **Yours**: your rating (as 0–5 stars, or as 💣 ⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐ 🩷), watched or played status, play count, date added to Plex, date last watched.
  - **Links and images**: link (Plex, Steam Store, IMDb, Open Library or HowLongToBeat page), poster (portrait cover for games), type tag, fixed text.
  - **Music**: artist, album artist, album, track and disc number, styles, moods, a tag in the music file by name, lyrics from the text file beside it.
  - **Games**: total playtime, playtime in the last 2 weeks, developers, publishers, platforms, Metacritic score, wide image, HowLongToBeat main story time and page, your Steam collections.
  - **Books**: authors, number of pages, ISBN.

Default properties:

| Library | Properties (★ = filled in on existing notes too) |
|---|---|
| Movies, TV, documentaries | Genre, Summary★, Date, Duration (minutes; for shows, a typical episode), Status, Link★, Image, tags |
| Music | Artist, Album, Track, Genre, Date, Link★, Image, Progress (play count), tags |
| Games | Genre, Release Date, Total Playtime (hours), Status, Link★, Image, WideImage, Main Story (HowLongToBeat, minutes), tags |
| Books | Author, Genre, Year, Duration (pages), Summary, Status, Link★, Image, tags |

### Remembered choices

What the plugin has remembered from your answers in pop-ups, each listed so you can forget it. See [Remembered choices](#remembered-choices).

---

## What a sync does

A sync reads the libraries you chose from Plex (and Steam), then:

1. **Finds each item's note**: by the Plex (or Steam) link in the note first, then by name, as each library's "Recognise existing notes by" allows. Movies, shows and documentaries also look in each other's folders. Songs are also recognised under each of their artists, with or without featured artists. A note you tied to an item (see "Use an existing note" and "Tie this note to a Plex item") always counts as that item's.
2. **Makes a note** for each item with none, in its library's folder, named by its format. Its poster is downloaded into the Images folder (Plex image addresses would expose your token, so they're never used directly). Steam and other covers are linked rather than downloaded.
3. **Updates existing notes**, but only in these ways:
   - **renames** them to the library's format (with "Rename notes" on), in place, keeping links to them working if Obsidian's "Automatically update internal links" is on;
   - **fills in** properties marked "fill in" that are missing or empty, never overwriting;
   - **play counts and playtime** (with "Update play counts" on). A game's playtime only ever goes up, and a song's play count is never lowered;
   - **ratings** (see [Ratings](#ratings));
   - **statuses**, forward only (with "Move statuses forward" on);
   - **Steam collections**, kept the same as in Steam;
   - **links**: a link property pointing somewhere else (say, a search page) is offered to be replaced with the item's own link;
   - **durations** in minutes that differ from the source's are offered to be corrected.

   Nothing else in an existing note is ever changed by a sync.
4. **Books**: renamed to "Title by Author (Year)" from what each note says (no lookups), when "Rename notes" is on.
5. **Lists the notes that match nothing**: notes in the libraries' folders that no item matches, with the reason where it can tell. Each has **Open** and **Always ignore**.
6. **Asks which item a note is for** when its name matches several (say, a plain "Black Sheep" note when Plex has the 1996 and 2006 films).
7. **Adds watched episodes to daily notes** (if switched on) and then offers what you watched for their Related property.
8. **Offers collections** that would change in Plex (only if something changed; see [collections](#collections)).

Items you chose **Skip every time** for are never created or changed, but still count when matching, so their notes aren't claimed by something else.

---

## The approval pop-up

With "Ask before every change" on, every new note and every change comes as a pop-up before anything is written. Nothing is written early: not a poster, not a folder.

- **Each part is a line with a tick box**: a property to fill in, a play count, a rename, a link. Untick what you don't want; only the ticked parts happen.
- **Every value can be edited first**. Lists show as chips (× removes one, the box adds one), and boxes suggest values that property already has in your vault, as Obsidian's own properties do.
- **The whole note is shown**: properties that aren't changing are listed after the changes. Those can be edited too, and your edits are saved with the rest.
- **Where values come from**: each line says where its value comes from ("From: Plex") and where it's written ("Writes to: This note", "Plex", "Music file", "Lyrics file").
- **Several sources for one property** (a song's play count in Plex and on Last.fm) show as one row with a column per source, each with its own tick box. A source whose number isn't offered (the same as the note's, or lower) still shows for comparison.
- **The lock** beside a line means "never change this property in this note". It's never offered again, in any sync or check, and is listed under Remembered choices → Never changed.
- **Buttons**:
  - **Apply** (or **Create**) does what's ticked; **Skip** leaves this note alone this time.
  - **Apply to the rest of this group** repeats your choice for the notes left in the same group (same library, same properties changing).
  - **Apply to all the rest** (or **Create all the rest**) repeats it for every note left in this run. It never applies lines that start unticked, and it leaves out whatever you unticked.
  - **Skip every time** means never create or change a note for this item; undo it under Remembered choices.
  - **Stop** ends the run.
- **New notes** also have **Use an existing note…**: pick a note you already have for this item instead. It's tied to the item from then on and offered whatever properties it's missing.
- **Order**: changes are planned first and asked afterwards, sorted by library and then by which properties change, so similar changes come together.
- **Unticked replacements are remembered**: a value you leave unticked isn't offered again while both your note's value and the source's stay the same (listed under Kept as they were).

---

## Checking notes against sources

**Check notes against sources…** lets you pick, per library, which properties to compare (your choice is remembered; **File name** is one of them). Each note is compared with its item's full details, and every difference is offered:

- **Ticked to start with**: empty values, durations written in hours, search-page links, genres (your kept ones plus the source's) and the source's type tag. Other differences start ticked only with "Start replacements ticked" on.
- **Status**: offered ticked only if it moves forward, and never for books.
- **Your rating**: offered both ways, unticked: Plex's into the note, or the note's to Plex.
- **Image**: a Plex poster is offered only for an empty image property. An image you linked yourself (`[[…]]` or `![[…]]`) is never offered to be replaced.
- **Dates**: never made vaguer. A note's year-only date gives way to the source's full date from the same year.
- **Lengths**: a game's or book's length the source no longer has is offered as empty, unticked.

**Books** are looked up on Open Library by the note's link, or by title and author (a "Title by Author" file name counts). Google Books is used for summaries and exact dates (only when those are being checked), and for books Open Library doesn't have. A book found by searching also offers its link, so it's found directly next time; leave the link unticked and that note isn't looked up again. A book that can't be found is still renamed from what the note says.

**Check this note** checks only the open note and reads only its own library.

---

## Ratings

**Your rating scale** (in every library): 💣 ⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐ 🩷, one level per Plex star (Plex's 1–10 is the level × 2), empty for none. Notes written before this scale existed are read in their old scale until a pop-up offers them in the new one; answering either way marks them done.

**Ratings go both ways:**
- **Plex → note**: with "Update ratings from Plex" on, a rating you changed in Plex goes into the note. A rating you changed in the note is never overwritten, and a note keeps its rating when Plex has none.
- **Note → Plex**: with "Send ratings to Plex" on, a rating you changed in the note is offered in the pop-up to be sent to Plex. It's never sent unasked.

The plugin remembers the rating a note and Plex last agreed on, so it can tell which side changed.

---

## Games (Steam)

Every game in your Steam library gets a note in `Media/Video Games` (free games you've never played are listed only with "Include free-to-play games" on).

- **Playtime**: Total Playtime is in hours and only ever goes up.
- **Status**: `started` once played, otherwise `pending`; finished, abandoned and so on are yours to set.
- **Main Story**: HowLongToBeat's main story time in minutes, looked up by the game's exact name (then without a subtitle or edition). If a game has no main story time, main story plus extras is used.
- **Images**: Steam's portrait cover and landscape header are linked, not downloaded. In the pop-up you can pick a cover from Steam, HowLongToBeat and (with a key) SteamGridDB.
- **Speed**: the Steam Store allows about 200 requests every 5 minutes, so new games are read a little over one a second.

**Your Steam collections** (desktop only) can go in a property, read straight from Steam's files on your computer (hidden and dynamic collections are left out). They can also **set a game's status** ("Status from Steam collections"), one `collection: status` per line. Defaults:
- `revisit` → revisit
- `pending` → pending
- `abandoned` → abandoned
- `completed` → completed
- `Right Now` → planned (until started)

A line ending in "(until started)" only counts for a game you haven't started, so a started game is never set back to planned. With asking on, a sync asks before changing a status this way (even backwards); a refusal isn't asked again until the collection changes. Nothing is ever written back to Steam.

---

## Books

Books live in the **Books** library (`Media/Books`), which no Plex sync reads. They're added with **Add a movie, show, game or book…** and kept right with **Check notes against sources…**.

- **Where details come from**:
  - Open Library: title, authors, genres, year, pages and cover.
  - Google Books: the summary (the publisher's description, else Open Library's) and the exact day and month of the date.
- **File names**: "Title by Author (Year)". The title keeps the capitals your note's name has, and the author is your note's own spelling. "Stand by Me" by Stephen King stays "Stand by Me by Stephen King".
- **Year**: the earliest first-publication year across every edition of the same title by the same author.
- **Genre**: "Fiction" is dropped when the book has another kept genre.
- **Google Books' daily limit**:
  - Answers are kept while Obsidian runs, so the same book isn't asked twice.
  - A busy Google Books is retried after 2, 6 and 15 seconds.
  - After a "per day" refusal, it waits an hour before asking again; the message says how many requests went out since Obsidian started.

---

## Music

Music libraries make **one note per song**, named `{{artist}} - {{title}}` by default. Songs don't record their length.

- **Progress** holds the song's play count. It's never lowered.
- **Last.fm play counts** (with a Last.fm key and username): in syncs and checks, if Last.fm's count for a song differs from Plex's, both are offered side by side, and you tick which goes in the note.
  - Versions of the same recording are added together ("Karma Police" plus "Karma Police - Remastered"). Remixes, acoustic and live versions are kept apart ("Fantasy" and "Fantasy (Remix)" each have their own count).
  - **Leave Last.fm's column unticked** and it isn't offered for that song again, while Plex's count keeps updating. It's only offered again if Last.fm gains plays Plex doesn't know about.
- **Tags in the music file** (desktop only): a property can show one of the file's own tags, such as Tempo. In syncs and checks, if your note's value differs from a tag the file already has, the pop-up offers (unticked) to write your value into the file. It only ever writes that one tag, in the same file, keeping the file's size, and only if the tag hasn't changed since it was read.
- **Lyrics** (desktop only): a property can show the lyrics from the text file beside the song (same name, `.txt` or `.lrc`). Your edited lyrics can be written back to that file the same way. A lyrics file is never created.
- **Links**: a song's link is its album's page in Plex plus the track, since Plex Web has no song pages.
- **Moods**: a song's own moods are read from the song itself, as library listings leave them out.

---

## Adding something new

**Add a movie, show, game or book…** searches outside Plex and Steam:

| Kind | Searched on | Notes |
|---|---|---|
| Movies and TV shows | OMDb (needs the free key) | Linked to IMDb; when it later shows up in Plex, the sync recognises the note by its IMDb ID. |
| Games | Steam Store and HowLongToBeat (for games not on Steam) | No key needed. |
| Books | Open Library, then Google Books | No key needed. |

- **Ratings in results**: each result shows its ratings (Open Library's and Google Books' stars, Metacritic, HowLongToBeat's score). Once results show, IMDb, Rotten Tomatoes and Metacritic (for movies and shows) and Steam's player reviews are added.
- **Why do you want it?** (optional) is written to the note's Why property, and shown again when you react to it or in "Worth a few words". Typing `[[` links a note.
- **Making the note**: it's made like a synced note, through the same approval pop-up, in the library you choose.

---

## Background updates and the daily check-in

With **Update in the background** set (every 2, 6, 12 or 24 hours), the plugin looks every 10 minutes whether an update is due, while Obsidian is open.

**At each background update** (with a daily check-in time set, these ask nothing):
- with asking off: play counts, ratings, statuses and Steam collections are updated, each only when its setting is on;
- watched episodes are added to your daily notes, and what you watched is lined up for their Related property;
- once a week, your **automatic collections** are sent to Plex and the **Revisit** playlist is remade (each if set up). These two never ask.

**At the daily check-in** (default 19:00, once a day, the first time Obsidian is open after that time, and not while another pop-up is open), questions come one after another:
1. changes to approve: play counts, playtimes, ratings, statuses;
2. **Add to your daily notes?** for what you watched;
3. **Just finished**, to react to.

**Check in now** runs it straight away. Leave the time empty to be asked at every background update instead. Syncs and checks you start yourself always ask straight away.

Before each background update, settings are read again, so a newer copy from another device (through Obsidian Sync) isn't overwritten by an older one.

---

## Daily notes

With **Watched episodes in daily notes** on, each sync, background update and **Add watched episodes to daily notes** read Plex's watch history (yours only, at most a week back) and add the episodes to that day's daily note:

```
> >- ▶️ [[Gilmore Girls (2000)]]: S02E05 – The Dinner Party, S02E06 – Shoes
```

- **Where**: under the line set in **Under the line** (default `[!writing] Journaling`) and the empty quote line below it, after any earlier "▶️" lines, each starting with **Quote markers** (default `> >`).
- **One line per show**: a show already there gets its new episodes added to its line. Nothing else in the note is changed.
- **Missing daily notes**: daily notes are never created. A day whose note (or line) is missing is tried again later.
- **Finding daily notes**: from **Daily notes folder and date format**, else Obsidian's Daily notes settings.
- **Getting deleted lines back**: the command looks at the whole last week, so it brings back lines you deleted; a sync doesn't.

**Related** (the property in **Link in a property**, default `Related`): every movie and show you watched that day is offered as a link for that day's daily note. It's **never added without asking**:
- the "Add to your daily notes?" pop-up comes after a sync, at the daily check-in, or with **Add what you watched to daily notes…**;
- untick anything that's wrong, and it isn't offered again;
- **Not now** keeps them for later;
- clicking beside the pop-up doesn't close it.

Your books and games count on the dashboard by the days your daily notes' Related links them.

**What isn't counted** (not in daily notes, the dashboard, or "Just finished"):
- **Bedtime shows**: episodes of the listed shows (default Dilbert, Mission Hill, Futurama) watched between the set times (default 22:00–07:00). Watched at other times, they count as usual.
- Anything from a library set to **Skip**, such as Yoga & Exercise.
- Items you chose **Skip every time**, and notes you chose **Always ignore**.

---

## Reactions and Notes

**Reactions are of the moment; Notes are your lasting take.**

**React to this note…** and **React to what you just finished…** open "How was it?":
- **rating**: in your star scale;
- **feelings and themes** to tap (plus a box for a theme of your own);
- **your own tags**;
- **a few words**: optional; how it felt this time.

What it writes:
- one dated line added to the note's **Reactions** property, such as `2026-10-16 · 🩷 · moved, happy · cried at the ending`;
- the feelings and themes added to **Feelings** and **Themes**, and the tags to `tags` (nothing is ever removed);
- the note's rating set.

**Just finished** lists the movies and shows you finished in the last two weeks that have a note (a show once every episode is watched). Pick one to react, or **Not now** to come back later. In the "How was it?" pop-up, **Don't ask about this** stops one coming back. A rewatch is asked about again.

**Notes** (your note's `Notes` property) is yours alone. The plugin only checks whether it's empty: things you rated 🩷 or 💣 with empty Notes show in "Worth a few words" on the dashboard, and **Write about it** opens the note with the cursor in its Notes property.

---

## The media dashboard

**Open media dashboard** (the sparkles in the ribbon) has four tabs.

### Insights

A month or a year (‹ › to move), in columns: Reactions, Movies, TV shows, Books, Games, Songs.
- **Reactions**:
  - **Favorites**: your 🩷 reactions;
  - **How it felt**: your feelings;
  - **Just finished**.
- **Each kind** gets:
  - a **count** and lists;
  - **Worth a few words**: 🩷 or 💣 things with empty Notes, with **Write about it**, **Next** and **Ignore**;
  - **Back again**: rewatches, rereads and replays, each with a **Not a rewatch** button for anything Plex wrongly counted twice.
- **What counts**:
  - movies count once per sitting, even across midnight;
  - books and games count by the days your daily notes link them. A reaction doesn't count as a day read or played, since you often write it from memory;
  - shows, books and games count as "back again" only after more than 90 days away, so something played every weekend never counts.
- **Songs**: most played, by each song's own artist.

### Habits

A column per kind:
- this week against last week;
- a bar chart of this week and the two before;
- this year by month;
- hours of movies and TV this week;
- how many notes have each status.

Just the numbers, never a judgement.

### Recommendations

What you haven't watched, read or played yet that's most like what you rated ⭐⭐⭐⭐ or 🩷, per kind. It uses your notes plus Plex and Steam items you don't have notes for, which get **Make a note**.
- **How it ranks**: shared people (director, author, artist, studio) count most, then genres.
- **No more than three by the same person** while there's anything else.
- **What's left out**: anything whose status is started, completed or abandoned (or your library's watched or started word). Things marked `revisit` are suggested even if you rated them.
- **Not interested** removes one for good (undo under Remembered choices).
- **The count cards** show 🩷 and ⭐⭐⭐⭐ apart.

**Songs** suggests ten songs you don't have:
- **From Last.fm**: songs like 50 drawn from your whole library, with loved and much-played songs drawn more often. Songs like several of yours come first. The line under each says "Like" and two of your songs it's like.
- **From ListenBrainz**: its recommendations for you, from listeners with taste like yours.
- **A song's name opens it on Spotify** (to listen, or add to your "To listen" playlist there). That takes it off the list, as does **Not interested**.

**Revisit** sits under Songs. See [Revisit](#revisit).

### Randomizers

Pick a kind (Movies, TV shows, Documentaries, Books, Games):
- narrow it by **Genre**, **Status**, **Tag** and **Length** (minutes, a show's episodes, a book's pages, a game's hours);
- **Pick one for me** picks at random, never the same twice in a row.

Your choices are remembered for each kind.

---

## Dashboard cards in your notes

Cards with a `</>` button on the dashboard can be put in any note: press it to copy, then paste into the note. The code looks like this:

````
```media-manager
card: randomizer
kind: book
```
````

- **card**: `randomizer`, `worth-a-few-words`, `this-month` or `habits`.
- **kind**: `movie`, `tv`, `documentary`, `book`, `game` or `song`.

The card stays up to date as your notes change. Embedded randomizers have no heading and share the dashboard's choices.

---

## Plex playlists, collections and Revisit

### Music playlists from a Base

In a Base (Obsidian 1.10 or later), add a view of type **Plex playlist**. It lists the Base's songs in order, with **Send to Plex**:
- you're shown what goes in, and what's left out and why, before anything is sent;
- a playlist of the same name is emptied and refilled; a smart playlist is never touched;
- the playlist's name is the view's name, unless you set **Playlist name in Plex** in the view's options.

### Collections

- **By hand**: put collection names in a movie or show note's **Playlist** property (for example `Heists`).
- **Automatic**: in the settings, one rule per line, `Name: tag or theme`, for example `Comfort: comfort`, `Holiday: holiday` or `Found family: found family`. Each collection holds every movie or show note with that tag (or that in its Themes).

**Send collections to Plex…** shows each collection, what goes in (+) and comes out (−), and notes left out and why. Untick any you don't want, then **Send to Plex**.
- Each collection ends up holding exactly the notes that name it (or have its tag). Watch the − lines: movies in a Plex collection that no note names are taken out.
- A collection belongs to one library.
- Smart collections are never touched.
- A collection no note names any more is left as it is in Plex.
- **After a sync**, the same pop-up opens by itself, but only if a collection would change. A change you turn down isn't offered after syncs again until it's different.
- **Weekly**: automatic collections are sent unasked with the background update.

### Revisit

A Plex playlist called **Revisit**: up to 50 songs you haven't played in six months that sound like 30 of your ⭐⭐⭐⭐ and 🩷 songs, at most three by any artist. It uses Plex's sonic analysis, which needs Plex Pass and sonic analysis switched on for your music library.
- **On the dashboard**: **Show what it would hold**, **Mix again**, then **Make it in Plex** sends exactly those songs.
- **Weekly**: remade by itself, unless switched off.

---

## What it writes outside your vault

Only these, and only as described:

- **Plex**:
  - ratings, when you approve sending them;
  - music playlists, after you confirm;
  - collections, after you confirm, or weekly for automatic ones;
  - the Revisit playlist.
- **Music files** (desktop only): one existing tag at a time, or the existing lyrics file, after you tick it in a pop-up.

Nothing is ever written to Steam, Last.fm, ListenBrainz, Open Library or Google Books. Your Plex token never goes in a note.

---

## Remembered choices

Settings → Remembered choices lists everything the plugin remembers from your answers, grouped by kind of media, each with a way to forget it:

- **Notes you chose for items**: from "Use an existing note" and "Tie this note to a Plex item".
- **Skipped every time**: items that are never created or changed.
- **Notes that match nothing, ignored**: from "Always ignore" in the unmatched list.
- **Kept as they were**: values and links you left unticked.
- **Never changed**: properties you locked in a note.
- **Not interested**: recommendations you turned down.

Renaming or moving a note in Obsidian keeps its remembered choices with it.

---

## When something looks wrong

- **Something isn't imported**: run **Why isn't this imported?…** with its Plex or Steam link. It explains what a sync does with it, changing nothing.
- **A note matches nothing**: the sync's list says why where it can. **Tie this note to a Plex item…** fixes a note the plugin can't recognise by name.
- **Wrong item**: if a note's name fits several items, the sync asks which one it's for.
- **A pop-up keeps offering a change you don't want**: leave it unticked (it's remembered while nothing changes), or use the lock to never change that property in that note.
- **Google Books is "out for the day"**: the limit resets daily; a free key raises it.
- **Settings from another device don't show** (Android especially): fully close and reopen Obsidian.

---

## Phones and tablets

Everything works on a phone or tablet that can reach your Plex server, except what needs your computer's own files: Steam collections, music file tags and lyrics. Where those can't be read, the properties are left as they are. Otherwise, run syncs on your computer and let Obsidian Sync carry the notes over.
