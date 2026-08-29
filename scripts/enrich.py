#!/usr/bin/env python3
"""
Build data/movies.json from the Google Sheet, filling in artwork from TMDb.

Runs in GitHub Actions, where TMDB_API_KEY is a repository secret. It never
runs in the browser: the repo is public, so a key in the JavaScript would be
a key in everyone's hands.

Two rules matter here:

  * What Dad types wins. TMDb only fills a cell he left blank.
  * Lookups are cached. A film already resolved is not looked up again, so a
    normal run costs one request per newly added film, not nine hundred.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SHEET_ID = "1qc-Eclmjr9GHwwFB2l_4T4PVOvT8ZdkeHA0pI57SdDM"
SHEET_CSV = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv"
TMDB = "https://api.themoviedb.org/3"

COLUMNS = ["title", "year", "rating", "director", "genre",
           "highlighted", "source_page", "column", "notes"]

# TMDb allows far more than this; staying well under keeps us a good citizen.
SLEEP = 0.06
# The notebook's year is sometimes a year or two off the canonical release.
YEAR_SLACK = 2


def get(url: str, tries: int = 3) -> bytes:
    """GET with a couple of retries. TMDb 429s if you sprint at it."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "our-gang-movie-den"})
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < tries - 1:
                time.sleep(1 + attempt)
                continue
            raise
    raise RuntimeError("unreachable")


def load_sheet() -> list[dict]:
    raw = get(SHEET_CSV).decode("utf-8")
    if raw.lstrip().startswith("<"):
        sys.exit("The sheet is not publicly readable — check Share > Anyone with the link.")
    rows = list(csv.DictReader(io.StringIO(raw)))
    out = []
    for r in rows:
        title = (r.get("title") or "").strip()
        if not title:
            continue
        rec = {c: (r.get(c) or "").strip() for c in COLUMNS}
        rec["title"] = title
        # Google eats leading zeros on what it reads as a number.
        if rec["source_page"]:
            rec["source_page"] = rec["source_page"].zfill(2)
        out.append(rec)
    return out


def key_of(rec: dict) -> str:
    slug = "".join(ch for ch in rec["title"].lower() if ch.isalnum())
    return f"{slug}|{rec.get('year', '')}"


def api(path: str, key: str, **params) -> dict:
    params["api_key"] = key
    url = f"{TMDB}{path}?{urllib.parse.urlencode(params)}"
    return json.loads(get(url))


def search(title: str, year: str, key: str) -> dict | None:
    """Search by title and year, then by title alone if the year misses."""
    if year:
        hits = api("/search/movie", key, query=title, year=year).get("results") or []
        if hits:
            return hits[0]
        time.sleep(SLEEP)

    hits = api("/search/movie", key, query=title).get("results") or []
    if not hits:
        return None
    if not year:
        return hits[0]

    # The notebook's year can drift from the canonical release. Take the
    # closest match inside the slack window rather than whatever ranked first.
    try:
        want = int(year)
    except ValueError:
        return hits[0]

    def distance(h):
        date = h.get("release_date") or ""
        try:
            return abs(int(date[:4]) - want)
        except ValueError:
            return 999

    best = min(hits, key=distance)
    return best if distance(best) <= YEAR_SLACK else None


def details(tmdb_id: int, key: str) -> dict:
    d = api(f"/movie/{tmdb_id}", key, append_to_response="credits")
    directors = [c["name"] for c in d.get("credits", {}).get("crew", [])
                 if c.get("job") == "Director"]
    return {
        "tmdb_id": d.get("id"),
        "poster": d.get("poster_path"),
        "backdrop": d.get("backdrop_path"),
        "runtime": d.get("runtime") or None,
        "overview": (d.get("overview") or "").strip() or None,
        "tmdb_director": " & ".join(directors) or None,
        "tmdb_genres": [g["name"] for g in d.get("genres", [])] or None,
    }


ART_FIELDS = ("tmdb_id", "poster", "backdrop", "runtime",
              "overview", "tmdb_director", "tmdb_genres")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/movies.json")
    ap.add_argument("--limit", type=int, default=0,
                    help="only look up this many new films (for testing)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-look-up everything, ignoring the cache")
    args = ap.parse_args()

    key = os.environ.get("TMDB_API_KEY", "").strip()

    movies = load_sheet()
    print(f"sheet: {len(movies)} films", flush=True)

    cache: dict[str, dict] = {}
    if not args.refresh and os.path.exists(args.out):
        try:
            prev = json.load(open(args.out))
            cache = {key_of(m): m for m in prev.get("movies", [])}
            print(f"cache: {len(cache)} previously resolved", flush=True)
        except (json.JSONDecodeError, OSError):
            pass

    if not key:
        print("No TMDB_API_KEY — writing the log without new artwork.", flush=True)

    looked_up = found = failed = 0
    for m in movies:
        cached = cache.get(key_of(m))
        if cached and cached.get("tmdb_id"):
            for f in ART_FIELDS:
                m[f] = cached.get(f)
            continue
        if not key or (args.limit and looked_up >= args.limit):
            for f in ART_FIELDS:
                m[f] = None
            continue

        looked_up += 1
        try:
            hit = search(m["title"], m["year"], key)
            time.sleep(SLEEP)
            if hit:
                m.update(details(hit["id"], key))
                found += 1
                time.sleep(SLEEP)
            else:
                for f in ART_FIELDS:
                    m[f] = None
                failed += 1
                print(f"  no match: {m['title']} ({m['year']})", flush=True)
        except Exception as e:                                  # noqa: BLE001
            for f in ART_FIELDS:
                m[f] = None
            failed += 1
            print(f"  lookup failed: {m['title']} ({m['year']}): {e}", flush=True)

    with_art = sum(1 for m in movies if m.get("poster"))
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(movies),
        "with_art": with_art,
        "movies": movies,
    }

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
        f.write("\n")

    print(f"looked up {looked_up} | matched {found} | missed {failed}", flush=True)
    print(f"wrote {args.out}: {len(movies)} films, {with_art} with artwork", flush=True)


if __name__ == "__main__":
    main()
