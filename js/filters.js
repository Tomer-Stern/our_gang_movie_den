/**
 * Search, filtering and sort. Also pure — state in, list out.
 */

/** Fold accents so "rashomon" finds "Rashômon" and "malle" finds "Malle". */
export const fold = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const haystack = (m) =>
  fold([m.title, m.director, m.genre, m.year, m.notes].filter(Boolean).join(' '));

/**
 * Unrated films always sink, whichever way the rating sorts. Treating them as
 * a zero would float 53 films Dad simply never scored to the top of "lowest
 * rated", which reads as a verdict he never gave.
 */
const byRating = (dir) => (a, b) => {
  if (a.rating == null && b.rating == null) return a.title.localeCompare(b.title);
  if (a.rating == null) return 1;
  if (b.rating == null) return -1;
  return dir * (a.rating - b.rating) || a.title.localeCompare(b.title);
};

const byYear = (dir) => (a, b) => {
  if (a.year == null && b.year == null) return a.title.localeCompare(b.title);
  if (a.year == null) return 1;
  if (b.year == null) return -1;
  return dir * (a.year - b.year) || a.title.localeCompare(b.title);
};

export const SORTS = {
  'rating-desc': { label: 'Highest rated', fn: byRating(-1) },
  'rating-asc':  { label: 'Lowest rated',  fn: byRating(1) },
  'year-desc':   { label: 'Newest first',  fn: byYear(-1) },
  'year-asc':    { label: 'Oldest first',  fn: byYear(1) },
  'title-asc':   { label: 'A to Z',        fn: (a, b) => a.title.localeCompare(b.title) },
  'log-desc':    { label: 'Order logged',  fn: (a, b) => b._i - a._i },
};

export function apply(movies, state) {
  const q = fold(state.search.trim());
  let out = movies;

  if (q) out = out.filter((m) => haystack(m).includes(q));
  if (state.ratedOnly) out = out.filter((m) => m.rating != null);
  if (state.favesOnly) out = out.filter((m) => m.rating != null && m.rating >= state.faveAt);
  if (state.decade != null) out = out.filter((m) => m.year != null && Math.floor(m.year / 10) * 10 === state.decade);
  if (state.director) out = out.filter((m) => m.director === state.director);
  if (state.genre) out = out.filter((m) => m.genres.includes(state.genre));

  const sort = SORTS[state.sort] ?? SORTS['rating-desc'];
  return [...out].sort(sort.fn);
}
