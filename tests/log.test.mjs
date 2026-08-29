import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCSV, rowsToMovies, keyOf } from '../js/data.js';
import { summary, byDecade, byDirector, byGenre, mean } from '../js/stats.js';
import { apply, fold, SORTS } from '../js/filters.js';

const HEADER = 'title,year,rating,director,genre,highlighted,source_page,column,notes';

const load = (body) => rowsToMovies(parseCSV(`${HEADER}\n${body}`));

const state = (over = {}) => ({
  search: '', sort: 'rating-desc', ratedOnly: false, favesOnly: false,
  faveAt: 4.5, decade: null, director: null, genre: null, ...over,
});

/* ---------- CSV ---------- */

test('quoted fields keep their commas', () => {
  const [m] = load('"Sex, Lies, and Videotape",1989,4,Steven Soderbergh,Drama,yes,3,L,');
  assert.equal(m.title, 'Sex, Lies, and Videotape');
  assert.equal(m.director, 'Steven Soderbergh');
});

test('escaped double quotes survive', () => {
  const [m] = load('"The ""Burbs",1989,3,Joe Dante,Comedy,yes,4,R,');
  assert.equal(m.title, 'The "Burbs');
});

test('Google stripping zeros is undone', () => {
  // Sheets turns "06" into 6 and "4.0" into 4 the moment it reads them as numbers.
  const [m] = load('Blackmail,1929,4,Alfred Hitchcock,Thriller,yes,5,R,');
  assert.equal(m.page, '05');
  assert.equal(m.rating, 4);
});

test('an unrated film is null, not zero', () => {
  const [a, b, c] = load(
    'The Thin Man,1934,,W.S. Van Dyke,Comedy,no,1,L,\n' +
    'Meet John Doe,1941,-,Frank Capra,Drama,no,1,L,\n' +
    'Ride Lonesome,1959,n/a,Budd Boetticher,Western,no,1,L,');
  for (const m of [a, b, c]) assert.equal(m.rating, null);
});

test('a slashed genre becomes a list', () => {
  const [m] = load('Paycheck,2003,3,John Woo,Action/Sci-Fi,no,1,L,');
  assert.deepEqual(m.genres, ['Action', 'Sci-Fi']);
});

test('blank rows and blank titles are dropped', () => {
  assert.equal(load('\n,1999,4,,,,,,\nM,1931,4.5,Fritz Lang,Crime,yes,9,L,').length, 1);
});

test('the join key ignores punctuation and case', () => {
  assert.equal(keyOf({ title: "The Children's Hour", year: 1961 }),
               keyOf({ title: 'the childrens hour', year: 1961 }));
});

/* ---------- stats ---------- */

const SAMPLE = load([
  'Ordet,1955,4.9,Carl Theodor Dreyer,Drama,yes,2,L,',
  'Vampyr,1932,4.2,Carl Theodor Dreyer,Horror,yes,2,L,',
  'Blackmail,1929,4,Alfred Hitchcock,Thriller,yes,5,R,',
  'Vertigo,1958,4.6,Alfred Hitchcock,Thriller/Mystery,yes,5,R,',
  'Unseen,1975,,Somebody Else,Drama,no,7,L,',
].join('\n'));

test('unrated films are excluded from the average', () => {
  assert.equal(mean(SAMPLE).toFixed(3), ((4.9 + 4.2 + 4 + 4.6) / 4).toFixed(3));
});

test('summary counts what it says it counts', () => {
  const s = summary(SAMPLE);
  assert.equal(s.total, 5);
  assert.equal(s.rated, 4);
  assert.equal(s.favourites, 2);       // 4.9 and 4.6
  assert.equal(s.directors, 3);
  assert.deepEqual([s.earliest, s.latest], [1929, 1975]);
});

test('decades run oldest to newest, not biggest first', () => {
  assert.deepEqual(byDecade(SAMPLE).map((d) => d.key), [1920, 1930, 1950, 1970]);
});

test('a film counts once per genre it carries', () => {
  const g = Object.fromEntries(byGenre(SAMPLE).map((r) => [r.key, r.count]));
  assert.equal(g.Thriller, 2);
  assert.equal(g.Mystery, 1);
  assert.equal(g.Drama, 2);
});

test('directors are ranked by count, ties alphabetical', () => {
  assert.deepEqual(byDirector(SAMPLE).slice(0, 2).map((r) => r.key),
                   ['Alfred Hitchcock', 'Carl Theodor Dreyer']);
});

/* ---------- filters ---------- */

test('search ignores accents in both directions', () => {
  assert.equal(fold('Rashômon'), 'rashomon');
  const m = load('Rashomon,1950,4.5,Akira Kurosawa,Drama,yes,3,L,');
  assert.equal(apply(m, state({ search: 'kurosawa' })).length, 1);
});

test('search reaches director, genre, year and notes', () => {
  for (const q of ['dreyer', 'horror', '1932', 'vampyr']) {
    assert.equal(apply(SAMPLE, state({ search: q })).length >= 1, true, q);
  }
});

test('unrated films sink in both directions, never read as a zero', () => {
  assert.equal(apply(SAMPLE, state({ sort: 'rating-desc' })).at(-1).title, 'Unseen');
  assert.equal(apply(SAMPLE, state({ sort: 'rating-asc' })).at(-1).title, 'Unseen');
  assert.equal(apply(SAMPLE, state({ sort: 'rating-asc' }))[0].title, 'Blackmail');
  assert.equal(apply(SAMPLE, state({ sort: 'rating-desc' }))[0].title, 'Ordet');
});

test('favourites uses the threshold, rated-only keeps the rest', () => {
  assert.equal(apply(SAMPLE, state({ favesOnly: true })).length, 2);
  assert.equal(apply(SAMPLE, state({ ratedOnly: true })).length, 4);
});

test('decade, director and genre filters combine', () => {
  assert.equal(apply(SAMPLE, state({ decade: 1950 })).length, 2);
  assert.equal(apply(SAMPLE, state({ director: 'Alfred Hitchcock' })).length, 2);
  assert.equal(apply(SAMPLE, state({ genre: 'Thriller', decade: 1950 })).length, 1);
});

test('filtering never mutates the source list', () => {
  const before = SAMPLE.map((m) => m.title);
  apply(SAMPLE, state({ sort: 'title-asc' }));
  assert.deepEqual(SAMPLE.map((m) => m.title), before);
});

test('every sort is a total order with no crashes on nulls', () => {
  const withNulls = load('No Year,,3,,,,,,\nOther,,,,,,,,');
  for (const k of Object.keys(SORTS)) {
    const out = apply([...SAMPLE, ...withNulls].map((m, i) => ({ ...m, _i: i })), state({ sort: k }));
    assert.equal(out.length, 7, k);
  }
});
