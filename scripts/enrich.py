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
import re
import unicodedata
from datetime import datetime, timezone

SHEET_ID = "1qc-Eclmjr9GHwwFB2l_4T4PVOvT8ZdkeHA0pI57SdDM"
SHEET_CSV = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv"
TMDB = "https://api.themoviedb.org/3"

COLUMNS = ["title", "year", "rating", "director", "genre",
           "highlighted", "source_page", "column", "notes"]

# Optional. Put a TMDb id in the sheet to pin a film whose title is ambiguous;
# the search is skipped entirely for that row.
PIN_COLUMN = "tmdb_id"

# TMDb allows far more than this; staying well under keeps us a good citizen.
SLEEP = 0.06
# The notebook's year is sometimes a year or two off the canonical release.
YEAR_SLACK = 2
# How many search results to check a director against before giving up. Only
# films whose first candidates disagree with the logged director pay this cost.
CANDIDATES = 12


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
        rec["pin"] = (r.get(PIN_COLUMN) or "").strip()
        rec["title"] = title
        # Google eats leading zeros on what it reads as a number.
        if rec["source_page"]:
            rec["source_page"] = rec["source_page"].zfill(2)
        out.append(rec)
    return out


def key_of(rec: dict) -> str:
    slug = "".join(ch for ch in rec["title"].lower() if ch.isalnum())
    return f"{slug}|{rec.get('year', '')}"


def surnames(credit: str) -> set[str]:
    """
    The family names in a credit string, accent-folded.

    Comparing every token instead would call "David Hand" a match for
    "David Fincher" on the strength of the first name alone — which is how a
    Snow White short nearly ended up standing in for Se7en. Splitting on the
    separators and taking the last word of each name keeps "Powell &
    Pressburger" matching "Michael Powell & Emeric Pressburger" while letting
    the Davids apart.
    """
    s = unicodedata.normalize("NFD", credit or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    out = set()
    for part in re.split(r"[&,]|\band\b", s):
        words = [w for w in re.split(r"[^a-z]+", part) if len(w) > 2]
        if words:
            out.add(words[-1])
    return out


def api(path: str, key: str, **params) -> dict:
    params["api_key"] = key
    url = f"{TMDB}{path}?{urllib.parse.urlencode(params)}"
    return json.loads(get(url))


def candidates(title: str, year: str, key: str) -> list[dict]:
    """Plausible matches, best first: closest release year, then most popular."""
    hits = []
    if year:
        hits = api("/search/movie", key, query=title, year=year).get("results") or []
        time.sleep(SLEEP)
    if not hits:
        hits = api("/search/movie", key, query=title).get("results") or []
        time.sleep(SLEEP)
    if not hits:
        return []

    try:
        want = int(year)
    except ValueError:
        return hits[:CANDIDATES]

    def distance(h):
        try:
            return abs(int((h.get("release_date") or "")[:4]) - want)
        except ValueError:
            return 999

    near = [h for h in hits if distance(h) <= YEAR_SLACK]
    pool = near or hits
    pool.sort(key=lambda h: (distance(h), -(h.get("popularity") or 0)))
    return pool[:CANDIDATES]


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


def resolve(m: dict, key: str) -> dict | None:
    """
    Pick the right film. A one-word title like "Seven", "Dreams" or "Passion"
    matches several, and TMDb's own ranking is not always the one meant — so
    where the log already names a director, the candidate whose director agrees
    wins over whatever ranked first.
    """
    if m.get("pin"):
        return details(int(m["pin"]), key)

    pool = candidates(m["title"], m["year"], key)
    if not pool:
        return None

    want = surnames(m.get("director", ""))
    if want:
        # A title search alone can miss the film entirely — TMDb lists Fincher's
        # "Seven" as "Se7en" — so fold in the year-free results too.
        seen = {c["id"] for c in pool}
        pool += [c for c in candidates(m["title"], "", key) if c["id"] not in seen]

    first = None
    for c in pool:
        got = details(c["id"], key)
        time.sleep(SLEEP)
        if first is None:
            first = got
        if not want:
            return got
        if want & surnames(got.get("tmdb_director") or ""):
            return got
    return first


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
            got = resolve(m, key)
            if got:
                m.update(got)
                found += 1
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
