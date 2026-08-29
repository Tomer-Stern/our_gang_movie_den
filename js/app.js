/**
 * Wiring: load -> derive -> paint, plus every control on the page.
 */

import { PAGE_SIZE, FAVOURITE_THRESHOLD } from './config.js';
import { loadMovies } from './data.js';
import { summary, byDecade, byDirector, byGenre, mean } from './stats.js';
import { apply, SORTS } from './filters.js';
import * as ui from './render.js';

const $ = (s) => document.querySelector(s);

const state = {
  all: [],
  view: [],
  search: '',
  sort: 'rating-desc',
  ratedOnly: false,
  favesOnly: false,
  faveAt: FAVOURITE_THRESHOLD,
  decade: null,
  director: null,
  genre: null,
  shown: PAGE_SIZE,
};

/* ---------- status ---------- */

const when = (iso) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function setStatus(text, warn = false) {
  $('#status').className = `statusbar${warn ? ' warn' : ''}`;
  $('#status-text').textContent = text;
}

/* ---------- painting ---------- */

function paint() {
  state.view = apply(state.all, state);

  ui.renderWall($('#wall'), state.view, state.shown);
  ui.renderTable($('#tbody'), state.view, 400);

  const n = state.view.length;
  $('#count').textContent =
    n === state.all.length ? `${n} films` : `${n} of ${state.all.length} films`;

  const more = $('#more');
  more.hidden = n <= state.shown;
  more.querySelector('button').textContent = `Show more (${n - state.shown} to go)`;

  $('#ledger-note').textContent = n > 400 ? `First 400 of ${n} — narrow the search to see the rest.` : '';

  renderChips();
  paintCharts();
}

function paintCharts() {
  // A chart honours every filter except its own dimension. Otherwise picking a
  // director collapses the director chart to the one bar you just clicked, and
  // there is no way to see what else is there.
  const except = (field) => apply(state.all, { ...state, [field]: null });

  ui.renderScatter($('#scatter'), state.view, mean(state.view));
  ui.renderBars($('#decadeChart .bars'),
    byDecade(except('decade')).map((d) => ({ ...d, key: `${d.key}s` })),
    { active: state.decade == null ? null : `${state.decade}s` });
  ui.renderBars($('#directorChart .bars'), byDirector(except('director')), { active: state.director });
  ui.renderBars($('#genreChart .bars'), byGenre(except('genre')), { active: state.genre });
}

function renderChips() {
  const chips = [];
  if (state.decade != null) chips.push(['decade', `${state.decade}s`]);
  if (state.director) chips.push(['director', state.director]);
  if (state.genre) chips.push(['genre', state.genre]);
  if (state.favesOnly) chips.push(['favesOnly', `rated ${FAVOURITE_THRESHOLD}+`]);

  $('#chips').innerHTML = chips
    .map(([k, label]) =>
      `<span class="chip">${label}<button type="button" data-clear="${k}" aria-label="Remove filter">&times;</button></span>`)
    .join('');
}

function reset() { state.shown = PAGE_SIZE; }

/* ---------- controls ---------- */

function wire() {
  const search = $('#search');
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = search.value; reset(); paint(); }, 120);
  });

  const sort = $('#sort');
  sort.innerHTML = Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  sort.value = state.sort;
  sort.addEventListener('change', () => { state.sort = sort.value; reset(); paint(); });

  $('#ratedOnly').addEventListener('change', (e) => { state.ratedOnly = e.target.checked; reset(); paint(); });
  $('#favesOnly').addEventListener('change', (e) => { state.favesOnly = e.target.checked; reset(); paint(); });

  $('#more button').addEventListener('click', () => { state.shown += PAGE_SIZE; paint(); });

  $('#chips').addEventListener('click', (e) => {
    const k = e.target.closest('[data-clear]')?.dataset.clear;
    if (!k) return;
    if (k === 'favesOnly') { state.favesOnly = false; $('#favesOnly').checked = false; }
    else state[k] = null;
    reset(); paint();
  });

  // Charts are filters. Clicking the active bar clears it.
  const barHandler = (field, parse = (v) => v) => (e) => {
    const bar = e.target.closest('.bar');
    if (!bar) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const value = parse(bar.dataset.key);
    state[field] = String(state[field]) === String(value) ? null : value;
    reset(); paint();
  };
  for (const [id, field, parse] of [
    ['#decadeChart', 'decade', (v) => Number.parseInt(v, 10)],
    ['#directorChart', 'director'],
    ['#genreChart', 'genre'],
  ]) {
    const el = $(id);
    el.addEventListener('click', barHandler(field, parse));
    el.addEventListener('keydown', barHandler(field, parse));
  }

  // Surprise me — pick from what is on screen, not the whole log.
  $('#lucky').addEventListener('click', () => {
    const pool = state.view.length ? state.view : state.all;
    if (pool.length) openSheet(pool[Math.floor(Math.random() * pool.length)]);
  });

  $('#wall').addEventListener('click', (e) => {
    const card = e.target.closest('.film');
    if (card) openSheet(state.view[Number(card.dataset.i)]);
  });

  $('#refresh').addEventListener('click', load);

  wireSheet();
  wireScatterTip();
  wireSortableTable();
}

/* ---------- detail ---------- */

function openSheet(m) {
  if (!m) return;
  const el = $('#sheet');
  ui.renderSheet(el, m);
  el.classList.add('on');
  el.querySelector('.sheet-close').focus();
}

function closeSheet() { $('#sheet').classList.remove('on'); }

function wireSheet() {
  const el = $('#sheet');
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.sheet-close')) closeSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

/* ---------- scatter tooltip ---------- */

function wireScatterTip() {
  const svg = $('#scatter');
  const tip = $('#tip');

  svg.addEventListener('pointerover', (e) => {
    const pt = e.target.closest('.pt');
    if (!pt) return;
    const d = pt.dataset;
    tip.innerHTML = `<b>${d.title}</b><span>${[d.year, d.director].filter(Boolean).join(' · ')} — rated ${d.rating}</span>`;
    tip.classList.add('on');
  });
  svg.addEventListener('pointermove', (e) => {
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 280)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  svg.addEventListener('pointerout', () => tip.classList.remove('on'));
}

/* ---------- ledger sorting ---------- */

function wireSortableTable() {
  const map = { title: 'title-asc', year: 'year-desc', rating: 'rating-desc' };
  $('#ledger thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    const pair = { 'title-asc': 'title-asc', 'year-desc': 'year-asc', 'year-asc': 'year-desc',
                   'rating-desc': 'rating-asc', 'rating-asc': 'rating-desc' };
    state.sort = state.sort.startsWith(key) ? pair[state.sort] : map[key];
    $('#sort').value = SORTS[state.sort] ? state.sort : '';
    paint();
  });
}

/* ---------- load ---------- */

async function load() {
  setStatus('Reading the log…');
  try {
    const res = await loadMovies();
    state.all = res.movies.map((m, i) => ({ ...m, _i: i }));
    reset();

    ui.renderStats($('#stats'), summary(state.all));
    paint();

    const art = state.all.filter((m) => m.poster).length;
    const artNote = art
      ? `${art} with artwork`
      : 'artwork arrives with the next scheduled refresh';

    if (res.source === 'sheet') {
      setStatus(`${state.all.length} films, straight from the sheet · ${artNote} · read ${when(res.stamp)}`);
    } else {
      setStatus(`Could not reach the sheet (${res.error}). Showing the saved copy from ${when(res.stamp)}.`, true);
    }
  } catch (err) {
    setStatus(`Could not load the log: ${err.message}`, true);
    $('#wall').innerHTML = `<div class="empty" style="grid-column:1/-1">
      <strong>The log did not load</strong>${err.message}</div>`;
  }
}

wire();
load();
