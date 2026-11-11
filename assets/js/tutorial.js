/* Behaviour of these pages:
   0. light and dark mode (same choice as on the home page),
   1. tidy the rendered Markdown, build "On this page", highlight the part
      being read, add copy buttons to code blocks and links to embedded plots.
   Each part is independent and the pages work without any of them. */

/* ------------------------------------------------------------------
   0. Light and dark mode.
   The page starts dark unless light mode was chosen before in this
   browser, here or on the home page (an inline script in <head> applies
   that choice before the page is drawn). Images with a data-light-src
   (and data-light-srcset) attribute are switched to their light version, and a "themechange"
   event is sent for anything else that wants to follow the mode.
------------------------------------------------------------------ */
(function () {
  'use strict';

  var root = document.documentElement;
  var button = document.getElementById('theme-toggle');
  var meta = document.querySelector('meta[name="theme-color"]');

  function isLight() { return root.getAttribute('data-theme') === 'light'; }

  function swapImages(light) {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-light-src]'), function (im) {
      if (!im.dataset.darkSrc) {
        im.dataset.darkSrc = im.getAttribute('src');
        im.dataset.darkSrcset = im.getAttribute('srcset') || '';
      }
      var srcset = light ? (im.dataset.lightSrcset || '') : im.dataset.darkSrcset;
      if (srcset) im.setAttribute('srcset', srcset); else im.removeAttribute('srcset');
      im.setAttribute('src', light ? im.dataset.lightSrc : im.dataset.darkSrc);
      im.classList.toggle('is-light', light);
    });
  }

  function apply(light, announce) {
    if (light) root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    swapImages(light);
    if (meta) meta.setAttribute('content', light ? '#ffffff' : '#000000');
    if (button) {
      button.setAttribute('aria-pressed', String(light));
      button.setAttribute('title', light ? 'Switch to dark mode' : 'Switch to light mode');
    }
    if (announce) document.dispatchEvent(new CustomEvent('themechange', { detail: { light: light } }));
  }

  if (isLight()) apply(true, false);

  if (button) {
    button.addEventListener('click', function () {
      var light = !isLight();
      try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
      apply(light, true);
    });
  }

  /* The mode was changed in another tab (this page or the home page): follow it. */
  window.addEventListener('storage', function (e) {
    if (e.key === 'theme') apply(e.newValue === 'light', true);
  });
})();

/* ------------------------------------------------------------------
   1. Page text.
------------------------------------------------------------------ */
(function () {
  'use strict';

  var prose = document.querySelector('.prose');
  if (!prose) return;
  var each = function (sel, fn) { Array.prototype.forEach.call(prose.querySelectorAll(sel), fn); };

  /* ---- The Markdown uses <br> lines as spacers (for GitHub), and list items
     written as "- <p>...</p>" leave empty paragraphs around their text; here
     they only add gaps, so paragraphs with no text and no images are removed. */
  each('p', function (p) {
    if (p.textContent.trim() === '' &&
        Array.prototype.every.call(p.children, function (c) { return c.tagName === 'BR'; })) {
      p.parentNode.removeChild(p);
    }
  });

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /* ---- "I - Setup of ..." becomes a title with a separate numeral. */
  each('h2', function (h) {
    var text = h.textContent.replace(/\s+/g, ' ').trim();
    var m = text.match(/^([IVXLC]+)\s*[-–—]\s*(.+)$/);
    if (!m) return;
    h.textContent = '';
    var n = document.createElement('span');
    n.className = 'n';
    n.textContent = m[1];
    h.appendChild(n);
    h.appendChild(document.createTextNode(m[2]));
  });

  /* ---- Parts of the page: ids and the "On this page" list. A page of a
     multi-page site has one h2 (its title), so its parts are the h3s;
     a single page has several h2s (I, II, ...), which are listed. */
  var toc = document.getElementById('toc');
  var level = prose.querySelectorAll('h2').length > 1 ? 'h2' : 'h3';
  var parts = Array.prototype.slice.call(prose.querySelectorAll(level));
  var links = [];
  parts.forEach(function (h) {
    var numEl = h.querySelector('.n');
    var num = numEl ? numEl.textContent : '';
    var title = h.textContent.replace(/\s+/g, ' ').trim();
    if (num && title.indexOf(num) === 0) title = title.slice(num.length).trim();
    title = title.replace(/:$/, '');
    if (!h.id) h.id = slug(title);
    if (!toc) return;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    if (num) {
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = num;
      a.appendChild(n);
    }
    a.appendChild(document.createTextNode(title));
    li.appendChild(a);
    toc.appendChild(li);
    links.push(a);
  });
  if (toc && links.length > 1) toc.parentNode.hidden = false;

  if (links.length > 1 && 'IntersectionObserver' in window) {
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) current = e.target.id; });
      links.forEach(function (a) {
        a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + current));
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    parts.forEach(function (h) { io.observe(h); });
  }

  /* ---- Code blocks: a copy button on each. */
  each('pre', function (pre) {
    var box = document.createElement('div');
    box.className = 'code';
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);
    if (!navigator.clipboard) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy this block');
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(pre.innerText.replace(/\n$/, '')).then(function () {
        btn.textContent = 'Copied';
        btn.setAttribute('data-done', '');
        setTimeout(function () { btn.textContent = 'Copy'; btn.removeAttribute('data-done'); }, 1600);
      });
    });
    box.appendChild(btn);
  });

  /* ---- Embedded plots: a link to open them full size in a new tab. */
  each('iframe', function (f) {
    var src = f.getAttribute('src');
    if (!src) return;
    var p = document.createElement('p');
    p.className = 'embed-link';
    var a = document.createElement('a');
    a.href = src;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open the interactive plot in a new tab';
    p.appendChild(a);
    var box = f.parentNode === prose ? f : f.parentNode;
    box.parentNode.insertBefore(p, box.nextSibling);
  });

  /* ---- Tables scroll sideways on small screens instead of overflowing. */
  each('table', function (t) {
    var box = document.createElement('div');
    box.className = 'table-wrap';
    t.parentNode.insertBefore(box, t);
    box.appendChild(t);
  });
})();
