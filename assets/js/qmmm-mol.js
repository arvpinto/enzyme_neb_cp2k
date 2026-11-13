/* qmmm-mol.js
   Drawing of a QM region with 3Dmol.js, shared by the interactive CI-NEB panel
   (neb-panel.js) and by the script that renders the normal-mode movies
   (tools/render_mode_movies.py), so both look the same.

   QMMol.parsePDBFrames(text)   PDB with one model per image (models ended by END/ENDMDL)
   QMMol.orient(frames, view)   rotate/centre the coordinates (view = {centre, rotation})
   QMMol.draw(viewer, mol, X, o) draw one structure; o = {keys, named, light, visible,
                                 showDistances, showNames, arrows}
*/
(function (global) {
  'use strict';

  /* Covalent radii (Angstrom) used to decide which atoms are bonded in each image,
     so bonds that form or break along the path appear and disappear. */
  var COV = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, P: 1.07, S: 1.05 };
  var BOND_FACTOR = 1.15;

  /* VMD-like colours (cyan carbons, red oxygens, white hydrogens, blue nitrogens),
     on the dark background of the pages; the light mode uses slightly deeper
     colours so the atoms keep their contrast on white. */
  var PALETTE = {
    dark: {
      bg: '#0e0f14',
      atom: { H: '#eef0f5', C: '#19dcef', N: '#3f62ff', O: '#ec2629', P: '#d9a95f', S: '#f2d14b', Ca: '#7ad67e' },
      key: '#f7dc4f', label: '#0e0f14', labelBg: '#f7dc4f', name: '#eef2f6', arrow: '#f2d14b'
    },
    light: {
      bg: '#f4f6f9',
      atom: { H: '#d5dae1', C: '#00a3b5', N: '#2443e0', O: '#d61f22', P: '#c08a3c', S: '#c9a400', Ca: '#3fa34d' },
      key: '#c99a06', label: '#ffffff', labelBg: '#8a6a05', name: '#12161c', arrow: '#c99a06'
    }
  };

  /* Ball-and-stick for every atom, as in VMD's CPK representation */
  var STYLE = { sphere: 0.25, stick: 0.15, ca: 0.3 };

  function parsePDBFrames(text) {
    var meta = [], frames = [], cur = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var rec = l.slice(0, 6);
      if (rec === 'ATOM  ' || rec === 'HETATM') {
        cur.push(parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54)));
        if (!frames.length) {
          var name = l.slice(12, 16).trim();
          var el = (l.slice(76, 78).trim() || name.charAt(0));
          /* some writers put e.g. "CA" in the element column of a carbon named C32;
             a two-letter element must also start the atom name */
          if (el.length === 2 && name.toUpperCase().indexOf(el.toUpperCase()) !== 0) el = name.charAt(0);
          el = el.charAt(0).toUpperCase() + el.slice(1).toLowerCase();
          meta.push({ name: name, resn: l.slice(17, 21).trim(), resi: l.slice(22, 27).trim(), el: el });
        }
      } else if ((rec.indexOf('END') === 0) && cur.length) {
        frames.push(new Float64Array(cur));
        cur = [];
      }
    }
    if (cur.length) frames.push(new Float64Array(cur));
    return { meta: meta, frames: frames };
  }

  function orient(frames, view) {
    if (!view) return frames;
    var c = view.centre, R = view.rotation;
    return frames.map(function (F) {
      var out = new Float64Array(F.length);
      for (var i = 0; i < F.length; i += 3) {
        var x = F[i] - c[0], y = F[i + 1] - c[1], z = F[i + 2] - c[2];
        out[i]     = R[0][0] * x + R[0][1] * y + R[0][2] * z;
        out[i + 1] = R[1][0] * x + R[1][1] * y + R[1][2] * z;
        out[i + 2] = R[2][0] * x + R[2][1] * y + R[2][2] * z;
      }
      return out;
    });
  }

  function dist(X, a, b) {
    var dx = X[3 * a] - X[3 * b], dy = X[3 * a + 1] - X[3 * b + 1], dz = X[3 * a + 2] - X[3 * b + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function pt(X, a) { return { x: X[3 * a], y: X[3 * a + 1], z: X[3 * a + 2] }; }

  function draw(viewer, mol, X, o) {
    o = o || {};
    var pal = o.light ? PALETTE.light : PALETTE.dark;
    var core = o.core || new Set();
    var named = o.named || {};
    var vis = o.visible || null;   // Set of atom indices to draw (default: all)
    var n = mol.meta.length;
    var atoms = [];
    for (var i = 0; i < n; i++) {
      var m = mol.meta[i];
      atoms.push({ elem: m.el, x: X[3 * i], y: X[3 * i + 1], z: X[3 * i + 2], index: i, serial: i + 1,
                   atom: m.name, resn: m.resn, resi: parseInt(m.resi, 10) || 0,
                   bonds: [], bondOrder: [], color: pal.atom[m.el] || '#ff7bd5', core: core.has(i),
                   vis: !vis || vis.has(i) });
    }
    for (i = 0; i < n; i++) {
      var ri = COV[atoms[i].elem];
      if (!ri || !atoms[i].vis) continue;
      for (var j = i + 1; j < n; j++) {
        var rj = COV[atoms[j].elem];
        if (!rj || !atoms[j].vis) continue;
        var lim = BOND_FACTOR * (ri + rj);
        var dx = X[3 * i] - X[3 * j];
        if (dx > lim || dx < -lim) continue;
        if (dist(X, i, j) < lim) {
          atoms[i].bonds.push(j); atoms[i].bondOrder.push(1);
          atoms[j].bonds.push(i); atoms[j].bondOrder.push(1);
        }
      }
    }

    viewer.removeAllModels();
    viewer.removeAllShapes();
    viewer.removeAllLabels();
    viewer.setBackgroundColor(pal.bg);
    var model = viewer.addModel();
    model.addAtoms(atoms);
    model.setStyle({}, {});
    model.setStyle({ predicate: function (a) { return a.vis; } },
                   { stick: { radius: STYLE.stick }, sphere: { scale: STYLE.sphere } });
    model.setStyle({ elem: 'Ca', predicate: function (a) { return a.vis; } }, { sphere: { scale: STYLE.ca } });

    /* Forming / breaking bonds: dashed line and distance whenever the two atoms are
       not drawn as bonded (o.labelBonded also labels the ones drawn as bonds) */
    (o.keys || []).forEach(function (k) {
      var d = dist(X, k.a, k.b);
      var bonded = atoms[k.a].bonds.indexOf(k.b) !== -1;
      if (!bonded) {
        viewer.addCylinder({ start: pt(X, k.a), end: pt(X, k.b), radius: 0.06, color: pal.key,
                             dashed: true, dashLength: 0.2, gapLength: 0.13, fromCap: 1, toCap: 1 });
      }
      if (o.showDistances && (!bonded || o.labelBonded)) {
        var a = pt(X, k.a), b = pt(X, k.b);
        viewer.addLabel(d.toFixed(2), {
          position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
          fontSize: o.fontSize || 11, font: 'sans-serif', fontColor: pal.label,
          backgroundColor: pal.labelBg, backgroundOpacity: bonded ? 0.6 : 0.92,
          borderThickness: 0, inFront: true, alignment: 'center'
        });
      }
    });

    if (o.showNames) {
      Object.keys(named).forEach(function (idx) {
        var i2 = parseInt(idx, 10);
        var p = pt(X, i2);
        viewer.addLabel(named[idx], {
          position: p, fontSize: (o.fontSize || 11) - 1, font: 'sans-serif', fontColor: pal.name,
          showBackground: false, inFront: true, alignment: 'bottomLeft', screenOffset: { x: 6, y: -6 }
        });
      });
    }

    /* Normal-mode displacement vectors (movies) */
    (o.arrows || []).forEach(function (ar) {
      var p = pt(X, ar.i);
      viewer.addArrow({ start: p, end: { x: p.x + ar.v[0], y: p.y + ar.v[1], z: p.z + ar.v[2] },
                        radius: 0.06, radiusRatio: 2.0, mid: 0.72, color: pal.arrow });
    });

    return model;
  }

  global.QMMol = { parsePDBFrames: parsePDBFrames, orient: orient, draw: draw, dist: dist, PALETTE: PALETTE };
})(window);
