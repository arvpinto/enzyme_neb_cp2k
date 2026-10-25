/* Tutorial pages: tidy the rendered Markdown, build "On this page",
   highlight the part being read and add copy buttons to code blocks. */
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

  /* ---- Parts of the page (h3): ids and the "On this page" list. */
  var toc = document.getElementById('toc');
  var parts = Array.prototype.slice.call(prose.querySelectorAll('h3'));
  var links = [];
  parts.forEach(function (h) {
    var title = h.textContent.replace(/\s+/g, ' ').trim().replace(/:$/, '');
    if (!h.id) h.id = slug(title);
    if (!toc) return;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = title;
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

  /* ---- Tables scroll sideways on small screens instead of overflowing. */
  each('table', function (t) {
    var box = document.createElement('div');
    box.className = 'table-wrap';
    t.parentNode.insertBefore(box, t);
    box.appendChild(t);
  });
})();
