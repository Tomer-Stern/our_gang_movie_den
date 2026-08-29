/**
 * Loading and normalising the film log.
 *
 * The sheet is the source of truth for everything Dad types. The snapshot in
 * data/movies.json is a baked fallback and, more importantly, the only place
 * the TMDb artwork lives — the API key sits in a GitHub secret, so lookups
 * happen in the Action, never in the browser.
 */

import { SHEET_CSV_URL, SNAPSHOT_URL } from './config.js';

/**
 * A real CSV reader: handles quoted fields, embedded commas and newlines, and
 * the "" escape. Titles like "Sex, Lies, and Videotape" need this.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Blank-ish cell? Sheets hands back '' but people type '-' and 'n/a' too. */
const blank = (v) => {
  const s = (v ?? '').trim();
  return s === '' || s === '-' || s === '—' || /^n\/?a$/i.test(s);
};

const clean = (v) => (blank(v) ? null : v.trim());

/**
 * Google strips leading and trailing zeros when it decides a cell is a number,
 * so "06" comes back "6" and "4.0" comes back "4". Both are recovered here
 * rather than asked of Dad.
 */
function normaliseRow(raw) {
  const year = Number.parseInt(raw.year, 10);
  const rating = blank(raw.rating) ? null : Number.parseFloat(raw.rating);
  const page = blank(raw.source_page) ? null : String(raw.source_page).trim().padStart(2, '0');

  return {
    title: (raw.title ?? '').trim(),
    year: Number.isFinite(year) ? year : null,
    rating: Number.isFinite(rating) ? rating : null,
    director: clean(raw.director),
    genre: clean(raw.genre),
    genres: blank(raw.genre) ? [] : raw.genre.split('/').map((g) => g.trim()).filter(Boolean),
    highlighted: /^y/i.test((raw.highlighted ?? '').trim()),
    page,
    col: clean(raw.column),
    notes: clean(raw.notes),
  };
}

/** Stable identity for a film, used to join sheet rows to snapshot artwork. */
export const keyOf = (m) =>
  `${(m.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}|${m.year ?? ''}`;

export function rowsToMovies(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .map((r) => normaliseRow(Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))))
    .filter((m) => m.title !== '');
}

/** Artwork and anything else the Action worked out, keyed for joining. */
function artIndex(snapshot) {
  const index = new Map();
  for (const m of snapshot?.movies ?? []) {
    index.set(keyOf(m), {
      tmdbId: m.tmdb_id ?? null,
      poster: m.poster ?? null,
      backdrop: m.backdrop ?? null,
      runtime: m.runtime ?? null,
      overview: m.overview ?? null,
      tmdbDirector: m.tmdb_director ?? null,
      tmdbGenres: m.tmdb_genres ?? null,
    });
  }
  return index;
}

/**
 * Dad's typing always wins. TMDb only ever fills a cell he left blank — the
 * same rule the probables grid uses for announced starters over the model.
 */
function merge(movies, index) {
  return movies.map((m) => {
    const art = index.get(keyOf(m)) ?? {};
    return {
      ...m,
      ...art,
      director: m.director ?? art.tmdbDirector ?? null,
      genre: m.genre ?? art.tmdbGenres?.join('/') ?? null,
      genres: m.genres.length ? m.genres : (art.tmdbGenres ?? []),
    };
  });
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/**
 * Load the log. Live sheet first so a film Dad added a minute ago is there;
 * the snapshot supplies the artwork and stands in entirely if the sheet call
 * fails. Returns what happened so the status bar can be honest about it.
 */
export async function loadMovies() {
  const snapshot = await fetchJSON(SNAPSHOT_URL).catch(() => null);

  try {
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`sheet -> ${res.status}`);
    const text = await res.text();
    // A login redirect returns HTML with a 200; treat that as a failure.
    if (/^\s*</.test(text)) throw new Error('sheet is not shared publicly');

    const movies = rowsToMovies(parseCSV(text));
    if (!movies.length) throw new Error('sheet is empty');

    return {
      movies: merge(movies, artIndex(snapshot)),
      source: 'sheet',
      stamp: new Date().toISOString(),
      artStamp: snapshot?.generated ?? null,
    };
  } catch (err) {
    if (!snapshot) throw err;
    return {
      movies: merge((snapshot.movies ?? []).map(normaliseRow), artIndex(snapshot)),
      source: 'snapshot',
      stamp: snapshot.generated ?? null,
      artStamp: snapshot.generated ?? null,
      error: err.message,
    };
  }
}
