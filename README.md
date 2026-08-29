# Our Gang

A wall of every film watched in the den — 893 of them to start with, written down
by hand over years and rated out of five.

Runs entirely in the browser as a static page. No server, no build step, no API key
in the source, free to host on GitHub Pages.

## Adding a film

Type a row into the [Google Sheet](https://docs.google.com/spreadsheets/d/1qc-Eclmjr9GHwwFB2l_4T4PVOvT8ZdkeHA0pI57SdDM/edit).
That is the whole workflow. No GitHub account, no editor, nothing to install.

| column | what to put |
| --- | --- |
| `title` | The film |
| `year` | Release year, as you know it |
| `rating` | 0–5. Leave blank if you have not rated it |
| `director` | Optional — filled in automatically if blank |
| `genre` | Optional — filled in automatically if blank. Slashes for several: `Drama/Romance` |
| `highlighted` | `yes`/`no`, carried over from the notebook's highlighter |
| `source_page`, `column` | Which notebook photo the line came from. Blank for new entries |
| `notes` | Anything you want to say about it |
| `tmdb_id` | Optional. Only needed to correct a wrong poster — see below |

Formatting does not matter. Google turns `06` into `6` and `4.0` into `4` the moment
it decides a cell is a number; both are put back when the site reads them.

**What you type always wins.** The automatic lookup only ever fills a cell you left
blank — it will never overwrite a director or genre you entered yourself.

## How it stays current

Two paths, so the site is both live and durable:

1. **The browser reads the sheet directly.** Google's CSV endpoint sends
   `Access-Control-Allow-Origin`, which is what makes a backend unnecessary. Add a row,
   press **Refresh**, and it is there.
2. **[`.github/workflows/refresh.yml`](.github/workflows/refresh.yml) rebuilds
   [`data/movies.json`](data/movies.json) four times a day**, looking up artwork,
   runtime and synopsis for anything new. If the live call ever fails, the page loads
   that file instead and says so in the status bar.

So a new film appears immediately as text and grows a poster within a few hours.
To not wait: **Actions → Refresh the log → Run workflow**.

The sheet must stay shared as **Anyone with the link → Viewer**. If that is switched
off the page falls back to the last snapshot and the status bar turns amber.

## The TMDb key

Posters, runtimes and synopses come from [TMDb](https://www.themoviedb.org/). The key
lives in a repository secret called `TMDB_API_KEY` and is only ever read inside the
Action — never in the JavaScript, because this repo is public. Poster URLs themselves
need no key, so the page can show them freely.

Lookups are cached: a film already resolved is not looked up again, so a normal run
costs one request per newly added film rather than nine hundred.

Matching is by title and year, falling back to title alone — the notebook's year is
sometimes a year or two off the canonical release, so the closest release within two
years wins. Where the log already names a director, the candidate whose director agrees
wins over whatever TMDb ranked first; that is what keeps a one-word title like *Dreams*
or *Passion* from picking up the wrong film. Anything unmatched keeps its typed-in
details and shows a title plate instead of a poster.

### Fixing a wrong poster

A handful of titles are ambiguous enough to defeat all of that. TMDb lists Fincher's
*Seven* as *Se7en*, so searching the log's spelling never reaches it.

To pin one by hand: find the film on [themoviedb.org](https://www.themoviedb.org/), take
the number out of its URL (`themoviedb.org/movie/807` → `807`) and put that in the
`tmdb_id` column. The search is skipped entirely for that row.

Known ones worth pinning:

| film | put in `tmdb_id` |
| --- | --- |
| Seven (1995) | `807` |

The other rows where the logged director disagrees with TMDb — *Blood Orange*,
*Vengeance!*, *Hanzo the Razor*, *The Kiss of Death* — look like the **logged** director
being wrong rather than the match, since the director column was researched after the
fact rather than copied from the notebook. Worth checking with Dad before changing.

## Running it

ES modules need HTTP, so opening `index.html` off the filesystem will not work.

```bash
python3 -m http.server 8124
```

Then open <http://localhost:8124>.

## Layout

| Path | Purpose |
| --- | --- |
| [`index.html`](index.html) | Page shell |
| [`js/config.js`](js/config.js) | Sheet id, image sizes, thresholds |
| [`js/data.js`](js/data.js) | CSV reader, normalisation, sheet/snapshot merge |
| [`js/stats.js`](js/stats.js) | Averages, tallies, decades — pure |
| [`js/filters.js`](js/filters.js) | Search, filtering, sort — pure |
| [`js/render.js`](js/render.js) | All the painting |
| [`js/app.js`](js/app.js) | Wiring |
| [`scripts/enrich.py`](scripts/enrich.py) | Sheet → `data/movies.json`, with TMDb |
| [`tests/`](tests/) | Unit tests |

## Tests

```bash
node --test tests/log.test.mjs
```

Covers the CSV reader against quoted commas and escaped quotes, Google's zero-stripping,
unrated films staying null rather than becoming a zero, genre splitting, the join key,
the tallies, accent-insensitive search, and every sort ordering — including unrated
films sinking in both directions rather than floating to the top of "lowest rated".

## Deploying

**Settings → Pages → Deploy from a branch**, branch `main`, folder `/ (root)`.
The site appears at `https://tomer-stern.github.io/our_gang_movie_den/`.

## Credits

Film data and artwork from [TMDb](https://www.themoviedb.org/). This product uses the
TMDb API but is not endorsed or certified by TMDb.
