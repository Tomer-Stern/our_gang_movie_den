/**
 * Derived numbers. Pure functions over the film list — no DOM in here, so
 * tests/stats.test.mjs can hold them to account.
 */

import { FAVOURITE_THRESHOLD, TOP_N } from './config.js';

export const rated = (movies) => movies.filter((m) => m.rating != null);

export function mean(movies) {
  const r = rated(movies);
  return r.length ? r.reduce((s, m) => s + m.rating, 0) / r.length : null;
}

export const decadeOf = (year) => (year == null ? null : Math.floor(year / 10) * 10);

/** Count by key, biggest first; ties broken alphabetically so order is stable. */
export function tally(movies, pick) {
  const counts = new Map();
  for (const m of movies) {
    for (const k of [pick(m)].flat()) {
      if (k == null || k === '') continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

export const byDirector = (movies) => tally(movies, (m) => m.director).slice(0, TOP_N);
export const byGenre = (movies) => tally(movies, (m) => m.genres).slice(0, TOP_N);

/** Decades ascending — a timeline reads wrong sorted by size. */
export function byDecade(movies) {
  return tally(movies, (m) => decadeOf(m.year))
    .sort((a, b) => a.key - b.key)
    .map((d) => ({ ...d, key: Number(d.key) }));
}

export function summary(movies) {
  const r = rated(movies);
  const years = movies.map((m) => m.year).filter((y) => y != null);
  return {
    total: movies.length,
    rated: r.length,
    mean: mean(movies),
    favourites: r.filter((m) => m.rating >= FAVOURITE_THRESHOLD).length,
    directors: new Set(movies.map((m) => m.director).filter(Boolean)).size,
    earliest: years.length ? Math.min(...years) : null,
    latest: years.length ? Math.max(...years) : null,
  };
}
