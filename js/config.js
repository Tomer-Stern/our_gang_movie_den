/**
 * Central configuration. Everything tunable lives here.
 */

/**
 * The Google Sheet that is the source of truth. Dad edits this; the site
 * reads it. Sharing must stay on "Anyone with the link -> Viewer" or the
 * browser fetch gets a login redirect instead of CSV.
 */
export const SHEET_ID = '1qc-Eclmjr9GHwwFB2l_4T4PVOvT8ZdkeHA0pI57SdDM';

/** gviz emits real CSV and sends Access-Control-Allow-Origin, so we can read it directly. */
export const SHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

/** Baked fallback, refreshed by .github/workflows/refresh.yml. Also carries the artwork. */
export const SNAPSHOT_URL = 'data/movies.json';

/** TMDb image CDN. Public — no API key needed to *display* an image. */
export const IMG_BASE = 'https://image.tmdb.org/t/p';
export const POSTER_SIZE = 'w342';
export const BACKDROP_SIZE = 'w1280';

/** Ratings run 0-5 in the notebook. */
export const RATING_MAX = 5;

/** A rating at or above this gets called out as a favourite. */
export const FAVOURITE_THRESHOLD = 4.5;

/** How many to paint before the "show more" cut. Keeps first render fast. */
export const PAGE_SIZE = 120;

/** Bars to show in the director and genre charts. */
export const TOP_N = 12;
