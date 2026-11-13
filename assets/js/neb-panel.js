/* neb-panel.js
   Interactive panel of Section III: the CI-NEB energy profile next to the QM
   region of the selected image (3Dmol.js). "Play" walks through the images
   one after the other, highlighting each point of the profile and showing its
   structure; clicking a point (or using the slider / arrow keys) shows that
   image and stops the playback.

   Markup: <div class="neb-panel" data-src=".../neb_panel.json" data-base=".../data/"></div>
   Needs 3Dmol-min.js and qmmm-mol.js. Follows the light/dark mode of the page. */
(function () {
  'use strict';

  var root = document.querySelector('.neb-panel');
  if (!root) return;
  if (!window.$3Dmol || !window.QMMol || !window.fetch) {
    root.setAttribute('data-state', 'error');
    return;
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  var SPEEDS = { '0.5': 1300, '1': 750, '2': 380 };
  var ZOOM = 1.4;    // after zooming on the reacting atoms, step back to show their surroundings
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs, parent, ns) {
    var e = ns ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (parent) parent.appendChild(e);
    return e;
  }

  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function fmtE(e) { return (e < 0 ? '−' : '') + Math.abs(e).toFixed(1); }

  var data, state = { p: null, i: 0, playing: false, timer: null }, cache = {}, viewer;
  var ui = {};

  /* ------------------------------------------------------------ layout */
  function build() {
    root.innerHTML = '';
    root.setAttribute('data-state', 'ready');

    var head = el('div', { 'class': 'neb-head' }, root);
    var tabs = el('div', { 'class': 'neb-tabs', role: 'group', 'aria-label': 'Reaction pathway' }, head);
    ui.tabs = data.pathways.map(function (p, k) {
      var b = el('button', { type: 'button', 'class': 'neb-tab', 'aria-pressed': 'false', text: p.label }, tabs);
      b.addEventListener('click', function () { select(k); });
      return b;
    });
    ui.status = el('p', { 'class': 'neb-status', 'aria-live': 'polite' }, head);

    var body = el('div', { 'class': 'neb-body' }, root);
    var plot = el('div', { 'class': 'neb-plot' }, body);
    ui.svg = el('svg', { 'class': 'neb-svg', viewBox: '0 0 460 330', role: 'group',
                         'aria-label': 'Energy profile of the band; select a point to show its structure' }, plot, true);
    var view = el('div', { 'class': 'neb-view' }, body);
    ui.mol = el('div', { 'class': 'neb-mol', role: 'img', 'aria-label': 'QM region of the selected image' }, view);
    ui.legend = el('p', { 'class': 'neb-legend' }, view);

    var ctl = el('div', { 'class': 'neb-controls' }, root);
    function btn(label, title, fn, cls) {
      var b = el('button', { type: 'button', 'class': 'neb-btn' + (cls ? ' ' + cls : ''), 'aria-label': title, title: title, html: label }, ctl);
      b.addEventListener('click', fn);
      return b;
    }
    btn('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2v12M13 2 5 8l8 6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>', 'First image', function () { stop(); show(0); });
    btn('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M11 2 4 8l7 6Z" fill="currentColor"/></svg>', 'Previous image', function () { stop(); show(state.i - 1); });
    ui.play = btn('', 'Play', toggle, 'neb-btn--play');
    btn('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 2l7 6-7 6Z" fill="currentColor"/></svg>', 'Next image', function () { stop(); show(state.i + 1); });
    btn('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13 2v12M3 2l8 6-8 6Z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>', 'Last image', function () { stop(); show(nImg() - 1); });
    ui.range = el('input', { type: 'range', min: '1', max: '16', step: '1', value: '1', 'class': 'neb-range', 'aria-label': 'Image' }, ctl);
    ui.range.addEventListener('input', function () { stop(); show(parseInt(ui.range.value, 10) - 1); });
    var sp = el('label', { 'class': 'neb-speed' }, ctl);
    el('span', { text: 'Speed' }, sp);
    ui.speed = el('select', { 'aria-label': 'Playback speed' }, sp);
    ['0.5', '1', '2'].forEach(function (s) { el('option', { value: s, text: s + '×' }, ui.speed); });
    ui.speed.value = '1';
    ui.speed.addEventListener('change', function () { if (state.playing) { stop(); play(); } });

    var opts = el('div', { 'class': 'neb-options' }, root);
    ui.optDist = checkbox(opts, 'Distances', false);
    ui.optNames = checkbox(opts, 'Atom names', false);
    ui.optAll = checkbox(opts, 'Whole QM region', false);
    var reset = el('button', { type: 'button', 'class': 'neb-link', text: 'Reset view' }, opts);
    reset.addEventListener('click', function () { if (viewer) { viewer.zoomTo(coreSel()); viewer.zoom(ZOOM); viewer.render(); } });

    ui.read = el('div', { 'class': 'neb-readout', 'aria-live': 'polite' }, root);
    updatePlay();

    root.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') { stop(); show(state.i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stop(); show(state.i - 1); e.preventDefault(); }
    });
  }

  function checkbox(parent, label, on) {
    var l = el('label', { 'class': 'neb-check' }, parent);
    var c = el('input', { type: 'checkbox' }, l);
    c.checked = on;
    el('span', { text: label }, l);
    c.addEventListener('change', function () { render3D(); });
    return c;
  }

  /* ------------------------------------------------------------ data */
  function nImg() { return state.p ? state.p.nimages : 1; }
  function pw() { return state.p; }
  function coreSel() {
    /* zoom on the atoms drawn around the reaction (or on the reacting atoms) */
    if (pw().focus && pw().focus.length) return { index: pw().focus };
    var ks = [];
    pw().keys.forEach(function (k) { ks.push(k.a, k.b); });
    return { index: ks };
  }

  function loadTraj(p) {
    if (cache[p.key]) return Promise.resolve(cache[p.key]);
    return fetch(root.getAttribute('data-base') + p.traj).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (t) {
      var mol = QMMol.parsePDBFrames(t);
      mol.X = QMMol.orient(mol.frames, p.view);
      mol.core = new Set(p.core);
      mol.focus = new Set(p.focus || []);
      cache[p.key] = mol;
      return mol;
    });
  }

  function select(k) {
    stop();
    var p = data.pathways[k];
    ui.tabs.forEach(function (b, j) { b.setAttribute('aria-pressed', String(j === k)); });
    state.p = p;
    ui.status.textContent = 'Loading ' + p.label.toLowerCase() + ' band…';
    loadTraj(p).then(function () {
      drawProfile();
      ui.range.max = String(p.nimages);
      ui.legend.innerHTML = 'Residues around the reacting atoms (tick "Whole QM region" for all of it); C cyan, O red, ' +
        'N blue, H white, Ca<sup>2+</sup> green; dashed yellow lines: bonds forming or breaking.';
      state.i = -1;
      show(p.highest_image - 1, true);
      ui.status.textContent = '';
    }).catch(function () {
      ui.status.textContent = 'The structures could not be loaded.';
    });
  }

  /* ------------------------------------------------------------ profile */
  var G = { w: 460, h: 330, l: 56, r: 16, t: 24, b: 50 };

  function drawProfile() {
    var p = pw(), svg = ui.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var E = p.energies, n = E.length;
    var lo = Math.min.apply(null, E.concat([0])), hi = Math.max.apply(null, E.concat([p.ts_dimer]));
    var step = (hi - lo) > 24 ? 5 : (hi - lo) > 10 ? 4 : 2;
    lo = Math.floor((lo - 0.5) / step) * step;
    hi = Math.ceil((hi + 1.0) / step) * step;
    var X = function (i) { return G.l + (G.w - G.l - G.r) * i / (n - 1); };
    var Y = function (e) { return G.t + (G.h - G.t - G.b) * (hi - e) / (hi - lo); };
    G.X = X; G.Y = Y;

    var grid = el('g', { 'class': 'neb-grid' }, svg, true);
    for (var e = lo; e <= hi + 1e-9; e += step) {
      el('line', { x1: G.l, x2: G.w - G.r, y1: Y(e), y2: Y(e), 'class': e === 0 ? 'zero' : '' }, grid, true);
      el('text', { x: G.l - 8, y: Y(e) + 4, 'class': 'tick', 'text-anchor': 'end', text: fmtE(e).replace('.0', '') }, grid, true);
    }
    for (var i = 0; i < n; i++) {
      if (n <= 20 || i % 2 === 0) el('text', { x: X(i), y: G.h - G.b + 18, 'class': 'tick', 'text-anchor': 'middle', text: String(i + 1) }, grid, true);
    }
    el('text', { x: (G.l + G.w - G.r) / 2, y: G.h - 8, 'class': 'axis', 'text-anchor': 'middle', text: 'Image' }, svg, true);
    var yl = el('text', { x: 0, y: 0, 'class': 'axis', 'text-anchor': 'middle',
                          transform: 'translate(15 ' + ((G.t + G.h - G.b) / 2) + ') rotate(-90)' }, svg, true);
    yl.textContent = 'ΔE (kcal/mol)';

    /* saddle point refined with the dimer method (Section V) */
    var ts = el('g', { 'class': 'neb-ts' }, svg, true);
    el('line', { x1: G.l, x2: G.w - G.r, y1: Y(p.ts_dimer), y2: Y(p.ts_dimer) }, ts, true);
    el('text', { x: G.w - G.r, y: Y(p.ts_dimer) - 6, 'text-anchor': 'end',
                 text: 'Dimer TS ' + fmtE(p.ts_dimer) }, ts, true);

    var pts = [];
    for (i = 0; i < n; i++) pts.push(X(i).toFixed(1) + ',' + Y(E[i]).toFixed(1));
    el('polyline', { points: pts.join(' '), 'class': 'neb-line' }, svg, true);

    ui.dots = [];
    var dots = el('g', { 'class': 'neb-dots' }, svg, true);
    E.forEach(function (en, j) {
      var g = el('g', { 'class': 'neb-pt', tabindex: '0', role: 'button',
                        'aria-label': 'Image ' + (j + 1) + ', ΔE ' + fmtE(en) + ' kcal/mol' }, dots, true);
      el('title', { text: 'Image ' + (j + 1) + ': ' + fmtE(en) + ' kcal/mol' }, g, true);
      el('circle', { cx: X(j), cy: Y(en), r: 13, 'class': 'hit' }, g, true);
      el('circle', { cx: X(j), cy: Y(en), r: 4.6, 'class': 'dot' }, g, true);
      g.addEventListener('click', function () { stop(); show(j); });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { stop(); show(j); ev.preventDefault(); }
      });
      ui.dots.push(g);
    });
    ui.cursor = el('line', { 'class': 'neb-cursor', y1: G.t, y2: G.h - G.b }, svg, true);
    svg.insertBefore(ui.cursor, dots);
  }

  /* ------------------------------------------------------------ 3D */
  function ensureViewer() {
    if (viewer) return viewer;
    viewer = $3Dmol.createViewer(ui.mol, { backgroundColor: isLight() ? QMMol.PALETTE.light.bg : QMMol.PALETTE.dark.bg,
                                           antialias: true, disableFog: false });
    if (window.ResizeObserver) new ResizeObserver(function () { viewer.resize(); viewer.render(); }).observe(ui.mol);
    return viewer;
  }

  function render3D(first) {
    var p = pw(), mol = cache[p.key];
    if (!mol) return;
    var v = ensureViewer();
    var keep = !first && v.getModel() ? v.getView() : null;
    QMMol.draw(v, mol, mol.X[state.i], {
      core: mol.core, keys: p.keys, named: p.named, light: isLight(),
      visible: ui.optAll.checked || !mol.focus.size ? null : mol.focus,
      showDistances: ui.optDist.checked, showNames: ui.optNames.checked
    });
    if (keep) v.setView(keep);
    else { v.zoomTo(coreSel()); v.zoom(ZOOM); }
    v.render();
  }

  /* ------------------------------------------------------------ state */
  function show(i, first) {
    var p = pw();
    if (!p) return;
    i = Math.max(0, Math.min(p.nimages - 1, i));
    var changed = i !== state.i;
    state.i = i;
    ui.range.value = String(i + 1);
    ui.dots.forEach(function (g, j) { g.setAttribute('aria-pressed', String(j === i)); g.classList.toggle('is-on', j === i); });
    ui.cursor.setAttribute('x1', G.X(i));
    ui.cursor.setAttribute('x2', G.X(i));
    if (changed || first) render3D(first);
    readout();
  }

  function readout() {
    var p = pw(), mol = cache[p.key], X = mol.X[state.i], i = state.i;
    var tag = i === 0 ? ' (first image)' : i === p.nimages - 1 ? ' (last image)' : i === p.highest_image - 1 ? ' (highest image)' : '';
    var h = '<p class="neb-now"><b>Image ' + (i + 1) + '</b> of ' + p.nimages + tag +
            ' <span>ΔE = ' + fmtE(p.energies[i]) + ' kcal/mol</span></p><ul class="neb-dist" role="list">';
    p.keys.forEach(function (k) {
      h += '<li title="' + k.role + '"><span class="k">' + k.html + '</span> <b>' +
           QMMol.dist(X, k.a, k.b).toFixed(2) + '</b> Å</li>';
    });
    ui.read.innerHTML = h + '</ul>';
  }

  function updatePlay() {
    var on = state.playing;
    ui.play.innerHTML = on
      ? '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2h3v12H4zM9 2h3v12H9z" fill="currentColor"/></svg><span>Pause</span>'
      : '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2l10 6-10 6Z" fill="currentColor"/></svg><span>Play</span>';
    ui.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    ui.play.setAttribute('title', on ? 'Pause' : 'Play the band from the first image');
    root.classList.toggle('is-playing', on);
  }

  function tick() {
    var p = pw(), dt = SPEEDS[ui.speed.value] || 750;
    if (state.i >= p.nimages - 1) {
      state.timer = setTimeout(function () { if (state.playing) { show(0); state.timer = setTimeout(tick, dt); } }, dt * 1.6);
      return;
    }
    show(state.i + 1);
    state.timer = setTimeout(tick, dt);
  }

  function play() {
    if (!pw()) return;
    state.playing = true;
    updatePlay();
    if (state.i >= pw().nimages - 1 || state.i === pw().highest_image - 1 && !state.started) show(0);
    state.started = true;
    state.timer = setTimeout(tick, reduceMotion ? 1500 : (SPEEDS[ui.speed.value] || 750));
  }

  function stop() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (state.playing) { state.playing = false; updatePlay(); }
  }

  function toggle() { if (state.playing) stop(); else play(); }

  document.addEventListener('themechange', function () { if (viewer && pw()) render3D(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });

  root.setAttribute('data-state', 'loading');
  fetch(root.getAttribute('data-src')).then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    build();
    select(0);
  }).catch(function () {
    root.setAttribute('data-state', 'error');
  });
})();
