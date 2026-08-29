/**
 * Painting. Everything that touches the DOM lives here.
 */

import { IMG_BASE, POSTER_SIZE, BACKDROP_SIZE, FAVOURITE_THRESHOLD, RATING_MAX } from './config.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const posterURL = (p) => (p ? `${IMG_BASE}/${POSTER_SIZE}${p}` : null);
export const backdropURL = (p) => (p ? `${IMG_BASE}/${BACKDROP_SIZE}${p}` : null);

/** 3.5 not 3.50, 4 not 4.0 — the way it reads in the notebook. */
export const fmtRating = (r) => (r == null ? '—' : String(Number(r.toFixed(2))));

const runtimeText = (min) => {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

/* ---------- stat strip ---------- */

export function renderStats(el, s) {
  const span = s.earliest && s.latest ? `${s.earliest}–${s.latest}` : '—';
  el.innerHTML = [
    ['films logged', s.total, false],
    ['average rating', s.mean == null ? '—' : s.mean.toFixed(2), true],
    [`rated ${FAVOURITE_THRESHOLD}+`, s.favourites, false],
    ['directors', s.directors, false],
    ['years covered', span, false],
  ]
    .map(([k, n, gold]) =>
      `<div class="stat"><span class="n${gold ? ' gold' : ''}">${esc(n)}</span><span class="k">${esc(k)}</span></div>`)
    .join('');
}

/* ---------- the wall ---------- */

function filmCard(m, i) {
  const url = posterURL(m.poster);
  const fav = m.rating != null && m.rating >= FAVOURITE_THRESHOLD;
  const cls = m.rating == null ? 'score none' : fav ? 'score fav' : 'score';
  const bits = [m.year, m.director].filter(Boolean).join(' · ');

  const art = url
    ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<div class="plate"><span>${esc(m.title)}</span><small>${esc(m.year ?? '')}</small></div>`;

  return `<button class="film" type="button" data-i="${i}">
    <div class="poster">${art}<span class="${cls}">${fmtRating(m.rating)}</span></div>
    <p class="name">${esc(m.title)}</p>
    <p class="meta">${esc(bits || '—')}</p>
  </button>`;
}

export function renderWall(el, movies, shown) {
  if (!movies.length) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <strong>Nothing matches</strong>Try a different search, or clear the filters.</div>`;
    return;
  }
  el.innerHTML = movies.slice(0, shown).map(filmCard).join('');
  // Fade posters in as they land, so the wall fills rather than flickers.
  for (const img of el.querySelectorAll('img')) {
    if (img.complete) img.classList.add('on');
    else img.addEventListener('load', () => img.classList.add('on'), { once: true });
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  }
}

/* ---------- bar charts ---------- */

export function renderBars(el, rows, { active, format = (r) => r.count } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  el.innerHTML = rows
    .map((r) => `<div class="bar${String(r.key) === String(active) ? ' on' : ''}" data-key="${esc(r.key)}" role="button" tabindex="0">
        <span class="lab" title="${esc(r.key)}">${esc(r.key)}</span>
        <span class="track"><span class="fill" style="width:${(r.count / max) * 100}%"></span></span>
        <span class="val">${esc(format(r))}</span>
      </div>`)
    .join('');
}

/* ---------- scatter ---------- */

export function renderScatter(svg, movies, meanValue) {
  const W = 1120, H = 400;
  const pad = { t: 16, r: 16, b: 32, l: 34 };
  const pts = movies.filter((m) => m.rating != null && m.year != null);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!pts.length) { svg.innerHTML = ''; return; }

  const years = pts.map((m) => m.year);
  const y0 = Math.min(...years), y1 = Math.max(...years);
  const x = (yr) => pad.l + ((yr - y0) / Math.max(1, y1 - y0)) * (W - pad.l - pad.r);
  const y = (r) => H - pad.b - (r / RATING_MAX) * (H - pad.t - pad.b);

  const parts = [];
  for (let r = 1; r <= RATING_MAX; r++) {
    parts.push(`<line class="grid-line" x1="${pad.l}" y1="${y(r)}" x2="${W - pad.r}" y2="${y(r)}"/>`);
    parts.push(`<text class="axis" x="${pad.l - 8}" y="${y(r) + 3.5}" text-anchor="end">${r}</text>`);
  }
  const step = (y1 - y0) > 60 ? 20 : 10;
  for (let yr = Math.ceil(y0 / step) * step; yr <= y1; yr += step) {
    parts.push(`<text class="axis" x="${x(yr)}" y="${H - pad.b + 18}" text-anchor="middle">${yr}</text>`);
  }
  if (meanValue != null) {
    parts.push(`<line class="mean" x1="${pad.l}" y1="${y(meanValue)}" x2="${W - pad.r}" y2="${y(meanValue)}"/>`);
  }

  for (const m of pts) {
    const fav = m.rating >= FAVOURITE_THRESHOLD;
    parts.push(`<circle class="pt" cx="${x(m.year).toFixed(1)}" cy="${y(m.rating).toFixed(1)}" r="${fav ? 4 : 3}"
      fill="${fav ? 'var(--gold)' : 'var(--ink-2)'}" fill-opacity="${fav ? 0.95 : 0.42}"
      data-title="${esc(m.title)}" data-year="${esc(m.year)}"
      data-rating="${fmtRating(m.rating)}" data-director="${esc(m.director ?? '')}"/>`);
  }
  svg.innerHTML = parts.join('');
}

/* ---------- ledger ---------- */

export function renderTable(tbody, movies, limit) {
  tbody.innerHTML = movies
    .slice(0, limit)
    .map((m) => {
      const fav = m.rating != null && m.rating >= FAVOURITE_THRESHOLD;
      return `<tr>
        <td class="t">${esc(m.title)}</td>
        <td class="r">${esc(m.year ?? '—')}</td>
        <td class="r">${fav ? `<span class="fav">${fmtRating(m.rating)}</span>` : fmtRating(m.rating)}</td>
        <td${m.director ? '' : ' class="dim"'}>${esc(m.director ?? '—')}</td>
        <td${m.genre ? '' : ' class="dim"'}>${esc(m.genre ?? '—')}</td>
      </tr>`;
    })
    .join('');
}

/* ---------- detail ---------- */

export function renderSheet(el, m) {
  const back = backdropURL(m.backdrop) ?? posterURL(m.poster);
  const meta = [m.year, m.director, runtimeText(m.runtime), m.genre].filter(Boolean).join('  ·  ');

  el.querySelector('.sheet-inner').innerHTML = `
    <button class="sheet-close" type="button" aria-label="Close">&times;</button>
    ${back ? `<div class="sheet-art"><img src="${esc(back)}" alt=""></div>` : ''}
    <div class="sheet-body"${back ? '' : ' style="margin-top:0"'}>
      <h3>${esc(m.title)}</h3>
      <p class="sheet-meta">${esc(meta || '—')}</p>
      ${m.rating != null ? `<div class="sheet-rating">${fmtRating(m.rating)} <span style="font-size:13px;opacity:0.6">/ ${RATING_MAX}</span></div>` : ''}
      ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ''}
      ${m.notes ? `<p class="sheet-note">${esc(m.notes)}</p>` : ''}
      ${m.page ? `<p style="font-size:11.5px;color:var(--ink-3);margin:18px 0 0">Notebook page ${esc(m.page)}, column ${esc(m.col ?? '')}</p>` : ''}
    </div>`;
}
