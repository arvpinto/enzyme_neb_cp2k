/* Animated figures of the portfolio cards (and of the tutorial pages, where
   data-fig-transparent leaves the background clear), in the matte + neon style of
   enzyme_neon_style.py: light grey matte molecules whose edges glow from
   light blue to neon pink across the frame, with a soft bloom.

   One WebGL2 context renders every 3D scene (spheres, tapered cylinders and
   cartoon meshes, two render targets: colour and glow, then a two-level
   bloom) and the result is copied into a 2D canvas on each card, where the
   charts and labels are drawn on top. The data of each card (structures,
   energies, charges...) comes from the tutorial repositories and is loaded
   from assets/data/cards/<slug>.json when the card comes near the screen.

   Only cards on screen are animated; with "reduce motion" each card shows a
   single still frame. Without WebGL2 the static image of the card stays. */

(function () {
  'use strict';

  var figs = Array.prototype.slice.call(document.querySelectorAll('[data-fig]'));
  if (!figs.length || !window.WebGLRenderingContext) return;

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var script = document.currentScript;
  var DATA = new URL('../data/cards/', script ? script.src : location.href).href;
  var DPR_MAX = 2;

  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }

  /* ------------------------------------------------------------ colours */

  function hex(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  function mixc(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  function css(c, a) {
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a === undefined ? 1 : a) + ')';
  }

  // the "neon" theme of enzyme_neon_style.py
  var EL = { C: hex('#D3D6DC'), N: hex('#7F98D4'), O: hex('#D9808A'), S: hex('#E0C874'),
             P: hex('#E0A26C'), H: hex('#F2F3F6'), M: hex('#9ED9B8') };
  var VDW = { H: 1.10, C: 1.70, N: 1.55, O: 1.52, P: 1.80, S: 1.80, M: 1.97 };
  var CARTOON = hex('#D7DBE2');
  var ACID = hex('#D2384A'), BASE = hex('#3D63D8');

  function tone() {
    var light = isLight();
    return light ? {
      light: true,
      neonA: hex('#1E9BE0'), neonB: hex('#E0168C'),
      bg0: '#ffffff', bg1: '#e6ebf1',
      ink: hex('#12161c'), ink2: hex('#4c5563'), ink3: hex('#8a929e'), grid: hex('#c9d0d9'),
      rim: 0.9, bloom: 0.55, ambient: 0.42, fog: 0.18
    } : {
      light: false,
      neonA: hex('#5CCBFF'), neonB: hex('#FF2FA8'),
      bg0: '#171d2a', bg1: '#040507',
      ink: hex('#eef2f6'), ink2: hex('#9ea7b4'), ink3: hex('#5d6672'), grid: hex('#262c36'),
      rim: 1.15, bloom: 1.25, ambient: 0.30, fog: 0.42
    };
  }
  function neonAt(T, f) { return mixc(T.neonA, T.neonB, Math.max(0, Math.min(1, f))); }

  /* ------------------------------------------------------------ small maths */

  var V3 = {
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; },
    len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    norm: function (a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: function (a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; },
    dist: function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); }
  };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(v) { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); }
  function ease(v) { v = clamp(v, 0, 1); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; }
  function win(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function rand(seed) { var s = seed || 1; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  // rotation matrices (row-major 3x3) applied as R * v
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function mul3(A, B) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]);
    return o;
  }
  function app3(R, v) { return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
  function axisRot(axis, a, v) {
    // Rodrigues
    var k = V3.norm(axis), c = Math.cos(a), s = Math.sin(a);
    var kv = V3.cross(k, v), kd = V3.dot(k, v);
    return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
  }

  /* ------------------------------------------------------------ renderer */

  var VS_SPHERE = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec4 iPR;',
    'layout(location=2) in vec4 iCol;',
    'layout(location=3) in float iRim;',
    'uniform mat4 uView, uProj;',
    'out vec3 vP; out vec3 vN; out vec3 vCol; out vec2 vFx;',
    'void main(){',
    '  vec4 p = uView * vec4(iPR.xyz + aPos * iPR.w, 1.0);',
    '  vP = p.xyz; vN = mat3(uView) * aPos; vCol = iCol.rgb; vFx = vec2(iCol.a, iRim);',
    '  gl_Position = uProj * p;',
    '}'].join('\n');

  var VS_CYL = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec4 iA;',      // a.xyz, radius at a
    'layout(location=2) in vec4 iB;',      // b.xyz, radius at b
    'layout(location=3) in vec4 iCol;',
    'layout(location=4) in float iRim;',
    'uniform mat4 uView, uProj;',
    'out vec3 vP; out vec3 vN; out vec3 vCol; out vec2 vFx;',
    'void main(){',
    '  vec3 d = iB.xyz - iA.xyz; float L = max(length(d), 1e-5); vec3 w = d / L;',
    '  vec3 t = abs(w.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '  vec3 u = normalize(cross(w, t)); vec3 v = cross(w, u);',
    '  vec3 radial = u * aPos.x + v * aPos.y;',
    '  float r = mix(iA.w, iB.w, aPos.z);',
    '  vec3 pos = iA.xyz + d * aPos.z + radial * r;',
    '  vec3 n = normalize(radial + w * (iA.w - iB.w) / L);',
    '  vec4 p = uView * vec4(pos, 1.0);',
    '  vP = p.xyz; vN = mat3(uView) * n; vCol = iCol.rgb; vFx = vec2(iCol.a, iRim);',
    '  gl_Position = uProj * p;',
    '}'].join('\n');

  var VS_MESH = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',
    'layout(location=1) in vec3 aNor;',
    'layout(location=2) in vec4 aCol;',
    'layout(location=3) in float aRim;',
    'uniform mat4 uView, uProj;',
    'out vec3 vP; out vec3 vN; out vec3 vCol; out vec2 vFx;',
    'void main(){',
    '  vec4 p = uView * vec4(aPos, 1.0);',
    '  vP = p.xyz; vN = mat3(uView) * aNor; vCol = aCol.rgb; vFx = vec2(aCol.a, aRim);',
    '  gl_Position = uProj * p;',
    '}'].join('\n');

  // Matte Principled-like surface, clear coat highlight, colored back
  // lights, depth cue, and the neon edge: a band of the silhouette (facing
  // ratio) coloured by the horizontal screen position, light blue to pink.
  var FS_SURF = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vP; in vec3 vN; in vec3 vCol; in vec2 vFx;',
    'uniform vec3 uNeonA, uNeonB; uniform vec2 uVP;',
    'uniform vec4 uRim;',   // edge width, falloff, strength, ambient
    'uniform vec3 uFog;',   // near, far, amount
    'layout(location=0) out vec4 oCol; layout(location=1) out vec4 oGlow;',
    'void main(){',
    '  vec3 N = normalize(vN); vec3 V = normalize(-vP);',
    '  float nv = dot(N, V); if (nv < 0.0) { N = -N; nv = -nv; }',
    '  vec3 L = normalize(vec3(-0.45, 0.62, 0.64));',
    '  float key = max(dot(N, L), 0.0);',
    '  float fill = max(dot(N, normalize(vec3(0.75, -0.25, 0.6))), 0.0);',
    '  float sx = clamp((gl_FragCoord.x / uVP.x - 0.06) / 0.88, 0.0, 1.0);',
    '  vec3 neon = mix(uNeonA, uNeonB, sx);',
    '  vec3 base = vCol;',
    '  vec3 col = base * (uRim.w + 0.70 * key + 0.16 * fill);',
    '  col += base * 0.16 * (max(dot(N, vec3(-0.9, 0.2, -0.35)), 0.0) * uNeonA + max(dot(N, vec3(0.9, 0.1, -0.35)), 0.0) * uNeonB);',
    '  vec3 H = normalize(L + V);',
    '  col += vec3(0.30 * pow(max(dot(N, H), 0.0), 64.0));',
    '  float band = clamp(((1.0 - nv) - (1.0 - uRim.x)) / uRim.x, 0.0, 1.0);',
    '  band = pow(band, uRim.y);',
    '  vec3 rim = neon * band * uRim.z * vFx.y;',
    '  float m = max(max(base.r, base.g), max(base.b, 0.001));',
    '  vec3 viv = base / m; viv = clamp(mix(vec3(dot(viv, vec3(0.333))), viv, 1.8), 0.0, 1.0);',
    '  vec3 glow = viv * vFx.x;',
    '  float fz = clamp((-vP.z - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);',
    '  col *= 1.0 - uFog.z * fz;',
    '  float edge = clamp(band * uRim.z * vFx.y, 0.0, 1.0);',
    '  col = mix(col, neon * (1.0 - 0.3 * fz), edge);',
    '  vec3 em = rim * (1.0 - 0.45 * fz) + glow;',
    '  oCol = vec4(min(col + em * 0.35 + glow * 0.65, vec3(1.0)), 1.0);',
    '  oGlow = vec4(em, 1.0);',
    '}'].join('\n');

  var VS_QUAD = [
    '#version 300 es',
    'const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));',
    'void main(){ gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }'].join('\n');

  // 9-tap gaussian along uDir, reading a texture whose used area may be
  // smaller than the texture (uTexel = 1 / texture size)
  var FS_BLUR = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform vec2 uScale; uniform vec2 uMax;',
    'out vec4 o;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy * uScale * uTexel;',
    '  float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);',
    '  vec3 s = texture(uTex, min(uv, uMax)).rgb * w[0];',
    '  for (int i = 1; i < 5; i++) {',
    '    vec2 off = uDir * uTexel * float(i) * 1.6;',
    '    s += texture(uTex, clamp(uv + off, vec2(0.0), uMax)).rgb * w[i];',
    '    s += texture(uTex, clamp(uv - off, vec2(0.0), uMax)).rgb * w[i];',
    '  }',
    '  o = vec4(s, 1.0);',
    '}'].join('\n');

  var FS_COMP = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uScene, uB1, uB2; uniform vec2 uS0, uS1, uS2; uniform vec2 uM1, uM2; uniform float uK;',
    'out vec4 o;',
    'void main(){',
    '  vec4 s = texture(uScene, gl_FragCoord.xy * uS0);',
    '  vec3 b = (texture(uB1, min(gl_FragCoord.xy * uS1, uM1)).rgb * 0.65 + texture(uB2, min(gl_FragCoord.xy * uS2, uM2)).rgb * 0.75) * uK;',
    '  float a = max(s.a, max(b.r, max(b.g, b.b)));',
    '  o = vec4(min(s.rgb + b, vec3(1.0)), min(a, 1.0));',
    '}'].join('\n');

  function icosphere(level) {
    var t = (1 + Math.sqrt(5)) / 2;
    var v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
             [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(V3.norm);
    var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
             [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (var l = 0; l < level; l++) {
      var cache = {}, nf = [];
      var mid = function (a, b) {
        var k = a < b ? a + '_' + b : b + '_' + a;
        if (cache[k] === undefined) { v.push(V3.norm(V3.scale(V3.add(v[a], v[b]), 0.5))); cache[k] = v.length - 1; }
        return cache[k];
      };
      f.forEach(function (tr) {
        var a = mid(tr[0], tr[1]), b = mid(tr[1], tr[2]), c = mid(tr[2], tr[0]);
        nf.push([tr[0], a, c], [tr[1], b, a], [tr[2], c, b], [a, b, c]);
      });
      f = nf;
    }
    return { pos: new Float32Array([].concat.apply([], v)), idx: new Uint16Array([].concat.apply([], f)) };
  }

  function cylinderMesh(seg) {
    var pos = [], idx = [];
    for (var i = 0; i <= seg; i++) {
      var a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1);
    }
    for (var j = 0; j < seg; j++) {
      var k = j * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
  }

  function Batch(stride) { this.stride = stride; this.data = new Float32Array(stride * 256); this.n = 0; }
  Batch.prototype.reset = function () { this.n = 0; };
  Batch.prototype.slot = function () {
    if ((this.n + 1) * this.stride > this.data.length) {
      var d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d;
    }
    return this.n++ * this.stride;
  };

  function Renderer() {
    var canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: false });
    if (!gl) throw new Error('no webgl2');
    this.canvas = canvas; this.gl = gl;
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
      return { p: p, u: u };
    }
    this.progSphere = program(VS_SPHERE, FS_SURF);
    this.progCyl = program(VS_CYL, FS_SURF);
    this.progMesh = program(VS_MESH, FS_SURF);
    this.progBlur = program(VS_QUAD, FS_BLUR);
    this.progComp = program(VS_QUAD, FS_COMP);
    this.quadVao = gl.createVertexArray();

    // instanced primitives
    var self = this;
    function instanced(mesh, layout) {
      var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
      var inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      var stride = layout.reduce(function (a, b) { return a + b; }, 0);
      var off = 0;
      layout.forEach(function (size, k) {
        gl.enableVertexAttribArray(k + 1); gl.vertexAttribPointer(k + 1, size, gl.FLOAT, false, stride * 4, off * 4);
        gl.vertexAttribDivisor(k + 1, 1); off += size;
      });
      gl.bindVertexArray(null);
      return { vao: vao, inst: inst, count: mesh.idx.length, stride: stride };
    }
    this.sphereHi = instanced(icosphere(3), [4, 4, 1]);
    this.sphereLo = instanced(icosphere(1), [4, 4, 1]);
    this.cyl = instanced(cylinderMesh(14), [4, 4, 4, 1]);
    this.w = 0; this.h = 0;
    void self;
  }

  Renderer.prototype.targets = function (w, h) {
    var gl = this.gl;
    if (w <= this.w && h <= this.h) return;
    this.w = Math.max(w, this.w); this.h = Math.max(h, this.h);
    w = this.w; h = this.h;
    this.canvas.width = w; this.canvas.height = h;
    var self = this;
    function tex(tw, th) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { t: t, w: tw, h: th };
    }
    function fbo(colors) {
      var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      colors.forEach(function (c, i) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.t, 0); });
      return f;
    }
    // multisampled scene target: colour + glow + depth
    this.msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    var samples = this.samples;
    [0, 1].forEach(function (i) {
      var rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, rb);
    });
    var db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db);
    if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.sceneTex = tex(w, h); this.glowTex = tex(w, h);
    this.sceneFbo = fbo([this.sceneTex]); this.glowFbo = fbo([this.glowTex]);
    var w1 = Math.ceil(w / 2), h1 = Math.ceil(h / 2), w2 = Math.ceil(w / 5), h2 = Math.ceil(h / 5);
    this.b1 = [tex(w1, h1), tex(w1, h1)]; this.b2 = [tex(w2, h2), tex(w2, h2)];
    this.b1f = this.b1.map(function (t) { return fbo([t]); });
    this.b2f = this.b2.map(function (t) { return fbo([t]); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    void self;
  };

  Renderer.prototype.mesh = function (m) {
    // m: {pos, nor, col (rgba per vertex), rim (per vertex), idx (Uint32)}
    var gl = this.gl;
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    function attr(loc, data, size) {
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    }
    var out = {
      vao: vao, count: m.idx.length,
      pos: attr(0, m.pos, 3), nor: attr(1, m.nor, 3), col: attr(2, m.col, 4), rim: attr(3, m.rim, 1)
    };
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    out.update = function (key, data) { gl.bindBuffer(gl.ARRAY_BUFFER, out[key]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); };
    return out;
  };

  function perspective(fovy, aspect, near, far, sx, sy) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -sx, -sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function viewMatrix(R, dist, target) {
    // view = translate(0,0,-dist) * R * translate(-target); R row-major 3x3
    var t = target || [0, 0, 0];
    var tx = -(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]);
    var ty = -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]);
    var tz = -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2]) - dist;
    return new Float32Array([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, tx, ty, tz, 1]);
  }

  // Draw lists filled by the scenes every frame
  function Lists() { this.spheres = new Batch(9); this.dots = new Batch(9); this.cyls = new Batch(13); this.meshes = []; }
  Lists.prototype.reset = function () { this.spheres.reset(); this.dots.reset(); this.cyls.reset(); this.meshes.length = 0; };
  Lists.prototype.sphere = function (p, r, c, glow, rim, lo) {
    var b = lo ? this.dots : this.spheres, o = b.slot(), d = b.data;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = r;
    d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2]; d[o + 7] = glow || 0; d[o + 8] = rim === undefined ? 1 : rim;
  };
  Lists.prototype.cyl = function (a, b, ra, rb, c, glow, rim) {
    var o = this.cyls.slot(), d = this.cyls.data;
    d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = ra;
    d[o + 4] = b[0]; d[o + 5] = b[1]; d[o + 6] = b[2]; d[o + 7] = rb;
    d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2]; d[o + 11] = glow || 0; d[o + 12] = rim === undefined ? 1 : rim;
  };
  Lists.prototype.mesh = function (m) { this.meshes.push(m); };

  Renderer.prototype.render = function (L, cam, w, h, T) {
    var gl = this.gl;
    this.targets(w, h);
    var aspect = w / h;
    var proj = perspective(cam.fov || 0.5, aspect, cam.near || 1, cam.far || 400, cam.shift ? cam.shift[0] : 0, cam.shift ? cam.shift[1] : 0);
    var view = viewMatrix(cam.R, cam.dist, cam.target);
    this.last = { proj: proj, view: view, w: w, h: h };

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 1]);
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, 0);

    var fogN = cam.dist - (cam.depth || 20), fogF = cam.dist + (cam.depth || 20);
    var rim = cam.rim || [0.56, 1.0, 1.1];
    function common(p) {
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uView, false, view); gl.uniformMatrix4fv(p.u.uProj, false, proj);
      gl.uniform3fv(p.u.uNeonA, T.neonA); gl.uniform3fv(p.u.uNeonB, T.neonB);
      gl.uniform2f(p.u.uVP, w, h);
      gl.uniform4f(p.u.uRim, rim[0], rim[1], rim[2] * T.rim, T.ambient + (cam.ambient || 0));
      gl.uniform3f(p.u.uFog, fogN, fogF, T.fog * (cam.fog === undefined ? 1 : cam.fog));
    }
    var self = this;
    function drawInst(prim, batch) {
      if (!batch.n) return;
      gl.bindVertexArray(prim.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, prim.inst);
      gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.n * batch.stride), gl.DYNAMIC_DRAW);
      gl.drawElementsInstanced(gl.TRIANGLES, prim.count, gl.UNSIGNED_SHORT, 0, batch.n);
    }
    if (L.spheres.n || L.dots.n) {
      common(this.progSphere);
      drawInst(this.sphereHi, L.spheres);
      drawInst(this.sphereLo, L.dots);
    }
    if (L.cyls.n) {
      common(this.progCyl);
      gl.disable(gl.CULL_FACE);
      drawInst(this.cyl, L.cyls);
      gl.enable(gl.CULL_FACE);
    }
    if (L.meshes.length) {
      common(this.progMesh);
      gl.disable(gl.CULL_FACE);
      L.meshes.forEach(function (m) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); });
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

    // resolve the two attachments
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneFbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.glowFbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // bloom: two blurred levels
    var B = this.progBlur;
    gl.useProgram(B.p);
    gl.bindVertexArray(this.quadVao);
    function pass(src, dst, dstF, vw, vh, dir, scale) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dstF);
      gl.viewport(0, 0, vw, vh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t);
      gl.uniform1i(B.u.uTex, 0);
      gl.uniform2f(B.u.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform2f(B.u.uDir, dir[0], dir[1]);
      gl.uniform2f(B.u.uScale, scale, scale);
      gl.uniform2f(B.u.uMax, (vw * scale - 0.5) / src.w, (vh * scale - 0.5) / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      void dst;
    }
    var w1 = Math.ceil(w / 2), h1 = Math.ceil(h / 2), w2 = Math.ceil(w / 5), h2 = Math.ceil(h / 5);
    pass(this.glowTex, this.b1[0], this.b1f[0], w1, h1, [1, 0], 2);
    pass(this.b1[0], this.b1[1], this.b1f[1], w1, h1, [0, 1], 1);
    pass(this.b1[1], this.b2[0], this.b2f[0], w2, h2, [1, 0], 2.5);
    pass(this.b2[0], this.b2[1], this.b2f[1], w2, h2, [0, 1], 1);

    // composite into the visible canvas (bottom-left w x h)
    var C = this.progComp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, w, h);
    gl.useProgram(C.p);
    [[this.sceneTex, 'uScene', 'uS0'], [this.b1[1], 'uB1', 'uS1'], [this.b2[1], 'uB2', 'uS2']].forEach(function (e, i) {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, e[0].t);
      gl.uniform1i(C.u[e[1]], i);
    });
    gl.uniform2f(C.u.uS0, 1 / this.sceneTex.w, 1 / this.sceneTex.h);
    gl.uniform2f(C.u.uS1, 0.5 / this.b1[1].w, 0.5 / this.b1[1].h);
    gl.uniform2f(C.u.uS2, 0.2 / this.b2[1].w, 0.2 / this.b2[1].h);
    gl.uniform2f(C.u.uM1, (w1 - 0.5) / this.b1[1].w, (h1 - 0.5) / this.b1[1].h);
    gl.uniform2f(C.u.uM2, (w2 - 0.5) / this.b2[1].w, (h2 - 0.5) / this.b2[1].h);
    gl.uniform1f(C.u.uK, T.bloom * (cam.bloom === undefined ? 1 : cam.bloom));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    void self;
  };

  // screen position (CSS px of the card canvas) of a world point
  Renderer.prototype.project = function (p, cssW, cssH) {
    var v = this.last.view, P = this.last.proj;
    var x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
    var y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
    var z = v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14];
    var cx = P[0] * x + P[8] * z, cy = P[5] * y + P[9] * z, cw = -z;
    return [(cx / cw * 0.5 + 0.5) * cssW, (1 - (cy / cw * 0.5 + 0.5)) * cssH, -z];
  };

  /* ------------------------------------------------------------ cartoon */

  var RIB = { C: [0.30, 0.30, 2.0], H: [1.30, 0.42, 2.2], E: [1.40, 0.26, 5.0] };
  var ARROW = 2.3, RING = 12;

  // Cartoon mesh (helix ribbons, strand arrows, coil tubes) from CA traces
  // and carbonyl directions: a light port of build_cartoon() in
  // enzyme_neon_style.py.
  function cartoon(segs, opt) {
    opt = opt || {};
    var nsub = opt.nsub || 6, scale = opt.scale || 1;
    var P = [], N = [], R = [], I = [], nres = 0;
    segs.forEach(function (seg) {
      var ca = seg.ca, n = ca.length, ss = seg.ss;
      var side = seg.o.map(V3.norm);
      for (var i = 1; i < n; i++) if (V3.dot(side[i], side[i - 1]) < 0) side[i] = V3.scale(side[i], -1);
      for (var pass = 0; pass < 2; pass++) {
        var sm = side.slice();
        for (i = 1; i < n - 1; i++) sm[i] = V3.norm(V3.add(V3.add(side[i - 1], V3.scale(side[i], 2)), side[i + 1]));
        side = sm;
      }
      var ctrl = ca.map(function (p) { return p.slice(); });
      for (pass = 0; pass < 2; pass++) {
        var c2 = ctrl.map(function (p) { return p.slice(); });
        for (i = 1; i < n - 1; i++) {
          var wgt = ss[i] === 'E' ? 0.25 : ss[i] === 'C' ? 0.1 : 0;
          if (wgt) c2[i] = V3.add(V3.scale(ctrl[i], 1 - 2 * wgt), V3.scale(V3.add(ctrl[i - 1], ctrl[i + 1]), wgt));
        }
        ctrl = c2;
      }
      // Catmull-Rom samples
      var ext = [V3.sub(V3.scale(ctrl[0], 2), ctrl[1])].concat(ctrl, [V3.sub(V3.scale(ctrl[n - 1], 2), ctrl[n - 2])]);
      var pos = [], tan = [], par = [];
      for (i = 0; i < n - 1; i++) {
        var p0 = ext[i], p1 = ext[i + 1], p2 = ext[i + 2], p3 = ext[i + 3];
        for (var k = 0; k < nsub; k++) {
          var f = k / nsub, f2 = f * f, f3 = f2 * f;
          var q = [], d = [];
          for (var c = 0; c < 3; c++) {
            var a0 = 2 * p1[c], b0 = p2[c] - p0[c], cc = 2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c], dd = -p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c];
            q.push(0.5 * (a0 + b0 * f + cc * f2 + dd * f3));
            d.push(0.5 * (b0 + 2 * cc * f + 3 * dd * f2));
          }
          pos.push(q); tan.push(V3.norm(d)); par.push(i + f);
        }
      }
      pos.push(ctrl[n - 1]); tan.push(V3.norm(V3.sub(ctrl[n - 1], ctrl[n - 2]))); par.push(n - 1);

      var arrowStart = {};
      for (i = 1; i < n; i++) if (ss[i] === 'E' && (i === n - 1 || ss[i + 1] !== 'E') && ss[i - 1] === 'E') arrowStart[i - 1] = true;
      function dims(i, f) {
        var j = Math.min(i + 1, n - 1);
        if (arrowStart[i]) return [ARROW + (RIB.C[0] - ARROW) * f, RIB.E[1], RIB.E[2]];
        var d0 = RIB[ss[i]], d1 = RIB[ss[j]];
        if (arrowStart[i - 1]) { d0 = RIB.C; if (ss[j] === 'E') d1 = RIB.C; }
        var s = f * f * (3 - 2 * f);
        return [d0[0] + (d1[0] - d0[0]) * s, d0[1] + (d1[1] - d0[1]) * s, d0[2] + (d1[2] - d0[2]) * s];
      }
      function ring(cen, s, nr, dm, resi) {
        var a = dm[0] * scale, b = dm[1] * scale, e = 2 / dm[2];
        var out = [];
        for (var q = 0; q < RING; q++) {
          var th = q / RING * Math.PI * 2, co = Math.cos(th), si = Math.sin(th);
          var x = a * Math.sign(co) * Math.pow(Math.abs(co), e), y = b * Math.sign(si) * Math.pow(Math.abs(si), e);
          var nx = Math.sign(co) * Math.pow(Math.abs(co), 2 - e) / a, ny = Math.sign(si) * Math.pow(Math.abs(si), 2 - e) / b;
          out.push({ p: V3.add(cen, V3.add(V3.scale(s, x), V3.scale(nr, y))), n: V3.norm(V3.add(V3.scale(s, nx), V3.scale(nr, ny))), r: resi });
        }
        return out;
      }
      var strips = [], cur = [], prevSide = null;
      for (k = 0; k < pos.length; k++) {
        i = Math.min(Math.floor(par[k] + 1e-9), n - 1);
        f = par[k] - i;
        if (i >= n - 1) { i = n - 2; f = 1; }
        var s = V3.lerp(side[i], side[i + 1], f), t = tan[k];
        s = V3.sub(s, V3.scale(t, V3.dot(s, t)));
        if (V3.len(s) < 1e-6) s = prevSide || V3.cross(t, [0, 0, 1]);
        s = V3.norm(s); prevSide = s;
        var nr = V3.cross(t, s), resi = nres + Math.min(Math.round(par[k]), n - 1);
        if (arrowStart[i] && f < 1e-9 && cur.length) {
          cur.push(ring(pos[k], s, nr, RIB.E, resi));
          strips.push(cur);
          cur = [ring(pos[k], s, nr, dims(i, 0), resi)];
          strips.push([ring(pos[k], s, nr, RIB.E, resi), cur[0]]);
          continue;
        }
        cur.push(ring(pos[k], s, nr, dims(i, f), resi));
      }
      strips.push(cur);
      strips.forEach(function (st) {
        var base = P.length / 3;
        st.forEach(function (rg) { rg.forEach(function (v) { P.push(v.p[0], v.p[1], v.p[2]); N.push(v.n[0], v.n[1], v.n[2]); R.push(v.r); }); });
        for (var m = 0; m < st.length - 1; m++) {
          var a0 = base + m * RING, a1 = a0 + RING;
          for (var q = 0; q < RING; q++) {
            var q2 = (q + 1) % RING;
            I.push(a0 + q, a0 + q2, a1 + q2, a0 + q, a1 + q2, a1 + q);
          }
        }
      });
      nres += n;
    });
    var nv = P.length / 3;
    return { pos: new Float32Array(P), nor: new Float32Array(N), res: R, nres: nres, idx: new Uint32Array(I),
             col: new Float32Array(nv * 4), rim: new Float32Array(nv), nv: nv };
  }

  // colour a cartoon by residue: fn(resIndex) -> [r,g,b,glow,rim]
  function paintCartoon(C, fn) {
    var cache = [];
    for (var r = 0; r < C.nres; r++) cache.push(fn(r));
    for (var v = 0; v < C.nv; v++) {
      var c = cache[C.res[v]];
      C.col[v * 4] = c[0]; C.col[v * 4 + 1] = c[1]; C.col[v * 4 + 2] = c[2]; C.col[v * 4 + 3] = c[3];
      C.rim[v] = c[4];
    }
  }

  /* ------------------------------------------------------------ molecules */

  function elColor(e) { return EL[e] || EL.C; }
  function bsRadius(e) { return 0.25 * (VDW[e] || 1.6) + 0.05; }

  // ball-and-stick (or licorice) with half bonds
  function drawMol(L, xyz, el, bonds, o) {
    o = o || {};
    var s = o.scale === undefined ? 1 : o.scale, br = (o.bond || 0.17) * (o.bondScale || 1);
    var lic = o.licorice;
    var cols = [];
    for (var i = 0; i < xyz.length; i++) {
      var e = el[i];
      if (o.noH && e === 'H') { cols.push(null); continue; }
      var c = o.color ? o.color(i, e) : elColor(e);
      cols.push(c);
      var r = (lic ? (e === 'H' ? 0.17 : 0.26) : bsRadius(e)) * s * (o.radius ? o.radius(i) : 1);
      if (r > 0.01) L.sphere(xyz[i], r, c, o.glow ? o.glow(i) : (o.glowAll || 0), o.rim === undefined ? 1 : o.rim, o.lo);
    }
    if (!bonds) return;
    for (var k = 0; k < bonds.length; k++) {
      var a = bonds[k][0], b = bonds[k][1];
      if (!cols[a] || !cols[b]) continue;
      var bs = o.bondK ? o.bondK(a, b) : 1;
      if (bs <= 0.02) continue;
      var rr = (lic ? (el[a] === 'H' || el[b] === 'H' ? 0.17 : 0.26) : br) * s * bs;
      var m = V3.lerp(xyz[a], xyz[b], 0.5);
      var ga = o.glow ? o.glow(a) : (o.glowAll || 0), gb = o.glow ? o.glow(b) : (o.glowAll || 0);
      L.cyl(xyz[a], m, rr, rr, cols[a], ga, o.rim === undefined ? 1 : o.rim);
      L.cyl(m, xyz[b], rr, rr, cols[b], gb, o.rim === undefined ? 1 : o.rim);
    }
  }

  function bondsByDistance(xyz, el, slack) {
    var COV = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, P: 1.07, S: 1.05 };
    var out = [];
    for (var i = 0; i < xyz.length; i++) for (var j = i + 1; j < xyz.length; j++) {
      if (el[i] === 'H' && el[j] === 'H') continue;
      if (el[i] === 'M' || el[j] === 'M') continue;
      if (V3.dist(xyz[i], xyz[j]) < (COV[el[i]] || 0.77) + (COV[el[j]] || 0.77) + (slack || 0.45)) out.push([i, j]);
    }
    return out;
  }

  function arrow3(L, a, b, r, c, glow, rim) {
    var d = V3.sub(b, a), len = V3.len(d), u = V3.scale(d, 1 / len);
    var head = Math.min(len * 0.32, r * 5.5);
    var m = V3.sub(b, V3.scale(u, head));
    L.cyl(a, m, r, r, c, glow, rim);
    L.cyl(m, b, r * 2.6, 0.001, c, glow, rim);
    L.sphere(a, r, c, glow, rim);
  }

  /* ------------------------------------------------------------ 2D helpers */

  var FONT = '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function font(ctx, size, weight) { ctx.font = (weight || 500) + ' ' + size + 'px ' + FONT; }
  function label(ctx, text, x, y, o) {
    o = o || {};
    font(ctx, o.size || 11, o.weight || 600);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillStyle = o.color;
    if (o.spacing && 'letterSpacing' in ctx) ctx.letterSpacing = o.spacing + 'px';
    ctx.fillText(text, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  // neon tube stroke of a path, coloured across [x0, x1]
  function neon(ctx, T, path, x0, x1, width, alpha, stops) {
    width = width || 1.6; alpha = alpha === undefined ? 1 : alpha;
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    (stops || [[0, T.neonA], [1, T.neonB]]).forEach(function (s) { g.addColorStop(s[0], css(s[1], 1)); });
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = g;
    var layers = T.light ? [[width * 3.2, 0.10], [width * 1.8, 0.25], [width, 1]] : [[width * 5, 0.10], [width * 2.6, 0.22], [width, 1]];
    layers.forEach(function (l) { ctx.globalAlpha = l[1] * alpha; ctx.lineWidth = l[0]; ctx.stroke(path); });
    if (!T.light) { ctx.globalAlpha = 0.75 * alpha; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = width * 0.35; ctx.stroke(path); }
    ctx.restore();
  }
  function glowDot(ctx, T, x, y, r, c, alpha) {
    alpha = alpha === undefined ? 1 : alpha;
    ctx.save();
    var g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, css(c, 0.55 * alpha)); g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css(c, 1); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (!T.light) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function curvePath(pts) {
    // smooth path through points (Catmull-Rom to Bezier)
    var p = new Path2D();
    if (!pts.length) return p;
    p.moveTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    return p;
  }
  function linePath(pts) { var p = new Path2D(); pts.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); }); return p; }
  function hair(ctx, T, x0, y0, x1, y1, a, dash) {
    ctx.save(); ctx.strokeStyle = css(T.ink3, a === undefined ? 0.6 : a); ctx.lineWidth = 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  function tag(ctx, T, text, x, y, o) {
    // small caption in the corner of a figure
    o = o || {};
    ctx.save();
    ctx.shadowColor = T.light ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 6;
    label(ctx, text, x, y, { size: o.size || 10.5, weight: 600, color: css(o.color || T.ink2, o.alpha === undefined ? 0.95 : o.alpha), align: o.align, spacing: 0.6 });
    ctx.restore();
  }

  /* ------------------------------------------------------------ scenes */

  // Every scene: { file: data file or null, period (s), still (s),
  //   init(data, ctx) -> state, frame(state, t, L, T) -> camera,
  //   overlay(state, t, ctx, w, h, T, project) }

  var SCENES = {};

  /* Graphene oxide: a rippling GO sheet, an aromatic probe lands flat on it
     (pi stacking) and wanders, its footprint lights up the sheet. */
  SCENES['go-sheets'] = {
    file: 'go-sheets', period: 12, still: 6.2,
    init: function (d) {
      var xyz = d.xyz, el = d.el;
      return { xyz: xyz, el: el, bonds: d.bonds, mol: d.mol, rnd: rand(7) };
    },
    frame: function (S, t, L, T) {
      var ph = t / 12;
      // molecule path: falls in, lands, wanders, lifts off
      var land = ease(win(t, 0.3, 3.4)), lift = ease(win(t, 10.4, 12));
      var wx = -2 + 5 * Math.sin(t * 0.42), wy = 1.5 * Math.sin(t * 0.61 + 1);
      var h = 3.45 + 16 * (1 - land) + 22 * lift;
      var cen = [wx - 9 * (1 - land) + 8 * lift, wy + 6 * (1 - land), h];
      var tumble = (1 - land) * 2.2 + lift * 1.6;
      var mol = S.mol.xyz.map(function (p) {
        var q = app3(rotZ(t * 0.35), p);
        q = app3(rotX(tumble * Math.sin(t * 1.3)), q);
        q = app3(rotY(tumble * 0.7), q);
        return [q[0] + cen[0], q[1] + cen[1], q[2] + cen[2]];
      });
      S.cen = cen; S.h = h; S.contact = land * (1 - lift);
      // sheet with thermal ripples
      var xyz = S.xyz, el = S.el, out = [];
      for (var i = 0; i < xyz.length; i++) {
        var p = xyz[i];
        var z = p[2] + 0.55 * Math.sin(0.23 * p[0] + t * 1.1) * Math.cos(0.19 * p[1] - t * 0.8) + 0.25 * Math.sin(0.5 * p[1] + p[0] * 0.1 + t * 1.7);
        out.push([p[0], p[1], z]);
      }
      S.sheet = out;
      var contact = S.contact;
      var foot = function (k) {
        if (contact < 0.01) return 0;
        var dx = out[k][0] - cen[0], dy = out[k][1] - cen[1];
        return contact * Math.exp(-(dx * dx + dy * dy) / 12);
      };
      drawMol(L, out, el, S.bonds, {
        scale: 1.25, bondScale: 1.35,
        color: function (k, e) { var f = foot(k); return f > 0.02 ? mixc(elColor(e), mixc(T.neonA, T.neonB, 0.5 + 0.5 * Math.sin(t * 1.3)), 0.7 * f) : elColor(e); },
        glow: function (k) {
          if (contact < 0.01) return 0;
          var dx = out[k][0] - cen[0], dy = out[k][1] - cen[1];
          var r2 = dx * dx + dy * dy;
          return contact * 0.32 * Math.exp(-r2 / 12) * (0.7 + 0.3 * Math.sin(t * 4 - Math.sqrt(r2)));
        },
        rim: 0.75
      });
      drawMol(L, mol, S.mol.el, S.mol.bonds, { scale: 1.5, bondScale: 1.5, glowAll: 0.04 + 0.05 * contact, rim: 2.2,
        color: function (i, e) { return e === 'C' ? [0.97, 0.97, 1] : elColor(e); } });
      void ph;
      return { R: mul3(rotX(-1.02), rotZ(0.32 + 0.05 * Math.sin(t * 0.25))), dist: 50, fov: 0.62, target: [0, 1.5, 0], depth: 26, fog: 1.1, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T, P) {
      if (S.contact < 0.05) { tag(ctx, T, 'GRAPHENE OXIDE  ·  GAFF2-AIM', 16, 24, { alpha: 0.85 }); return; }
      var a = P(S.cen), b = P([S.cen[0], S.cen[1], 0.2]);
      ctx.save(); ctx.globalAlpha = S.contact;
      ctx.setLineDash([2, 3]);
      hair(ctx, T, a[0], a[1], b[0], b[1], 0.95, [2, 3]);
      ctx.restore();
      tag(ctx, T, S.h.toFixed(1) + ' Å', a[0] + 10, (a[1] + b[1]) / 2 + 4, { color: T.ink, alpha: S.contact });
      tag(ctx, T, 'GRAPHENE OXIDE  ·  GAFF2-AIM', 16, 24, { alpha: 0.85 });
    }
  };

  /* CI-NEB: the band relaxes onto the minimum energy path, then the QM
     region of hPLA2 walks from reactant to product along the 16 images,
     while the forming bonds light up. */
  SCENES['static-qmmm'] = {
    file: 'static-qmmm', period: 11, still: 6.6,
    init: function (d) {
      var core = {};
      d.core.forEach(function (i) { core[i] = 1; });
      var keyset = {};
      d.keys.forEach(function (k) { keyset[Math.min(k[0], k[1]) + '_' + Math.max(k[0], k[1])] = 1; });
      return { d: d, core: core, keys: keyset, el: d.el, n: d.frames.length };
    },
    s: function (t) {
      // image coordinate along the band (0..n-1)
      return 15 * ease(win(t, 2.6, 8.4));
    },
    frame: function (S, t, L) {
      var d = S.d, s = this.s(t), i = Math.min(Math.floor(s), S.n - 2), f = s - i;
      var A = d.frames[i], B = d.frames[i + 1], xyz = [];
      for (var k = 0; k < A.length; k++) xyz.push(V3.lerp(A[k], B[k], f));
      S.xyz = xyz; S.sv = s;
      var el = S.el;
      var bonds = bondsByDistance(xyz, el, 0.75);
      var core = S.core, keys = S.keys;
      var pulse = 0.5 + 0.5 * Math.sin(t * 5);
      drawMol(L, xyz, el, bonds, {
        scale: 1.05,
        glow: function (a) { return core[a] ? 0.10 + 0.08 * pulse : 0; },
        bondK: function (a, b) {
          var COV = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, P: 1.07 };
          var dd = V3.dist(xyz[a], xyz[b]), ref = (COV[el[a]] || 0.77) + (COV[el[b]] || 0.77);
          return 1 - smooth((dd - ref - 0.25) / 0.5);
        },
        rim: 1.1
      });
      // reacting pairs: a glowing dashed link while the bond is not formed
      Object.keys(keys).forEach(function (kk) {
        var ab = kk.split('_').map(Number), p = xyz[ab[0]], q = xyz[ab[1]];
        var dd = V3.dist(p, q);
        if (dd < 1.2 || dd > 3.2) return;
        var m = 6;
        for (var j = 1; j < m; j++) L.sphere(V3.lerp(p, q, j / m), 0.07, [1, 1, 1], 0.8, 0, true);
      });
      // Ca2+
      for (k = 0; k < xyz.length; k++) if (el[k] === 'M') L.sphere(xyz[k], 0.95, EL.M, 0.25, 1.2);
      return { R: mul3(rotY(0.35 * Math.sin(t * 0.45)), rotX(0.08 * Math.sin(t * 0.3))), dist: 30, fov: 0.6, target: [0, 0, 0],
               shift: [-0.44, 0.02], depth: 12, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T) {
      var d = S.d, E = d.energies, n = E.length;
      var x0 = w * 0.56, x1 = w - 18, y0 = h * 0.24, y1 = h * 0.78;
      var lo = -4, hi = 16;
      function X(i) { return x0 + (x1 - x0) * i / (n - 1); }
      function Y(e) { return y1 - (y1 - y0) * (e - lo) / (hi - lo); }
      // band relaxation: images start on a straight line and settle
      var relax = ease(win(t, 0.2, 2.4)), out = 1 - smooth(win(t, 10.2, 11));
      var pts = E.map(function (e, i) {
        var guess = E[0] + (E[n - 1] - E[0]) * i / (n - 1) + 3.2 * Math.sin(i * 1.7);
        return [X(i), Y(guess + (e - guess) * relax)];
      });
      hair(ctx, T, x0, y1 + 8, x1, y1 + 8, 0.5);
      hair(ctx, T, x0, Y(0), x1, Y(0), 0.35, [2, 4]);
      ctx.save(); ctx.globalAlpha = out;
      neon(ctx, T, curvePath(pts), x0, x1, 1.6);
      pts.forEach(function (p, i) {
        var climb = i === d.climb;
        glowDot(ctx, T, p[0], p[1], climb ? 3.2 : 2.1, neonAt(T, i / (n - 1)), 0.9);
        if (climb && relax > 0.95) {
          ctx.strokeStyle = css(T.ink, 0.9); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p[0], p[1], 6.5, 0, Math.PI * 2); ctx.stroke();
        }
      });
      // travelling image
      var sv = S.sv, k = Math.min(Math.floor(sv), n - 2), f = sv - k;
      if (t > 2.4) {
        var cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, cy = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
        glowDot(ctx, T, cx, cy, 3.4, T.light ? T.ink : [1, 1, 1], 1);
      }
      // dimer TS
      var dim = smooth(win(t, 8.4, 9.0));
      if (dim > 0) {
        var tx = X(d.climb), ty = Y(d.ts);
        ctx.globalAlpha = out * dim;
        hair(ctx, T, tx, ty, tx, y1 + 8, 0.7, [2, 3]);
        label(ctx, 'TS‡ ' + d.ts.toFixed(1), tx, ty - 10, { size: 10.5, weight: 700, color: css(T.ink), align: 'center' });
      }
      ctx.restore();
      tag(ctx, T, 'R', x0, y1 + 22, { align: 'center' });
      tag(ctx, T, 'P', x1, y1 + 22, { align: 'center' });
      tag(ctx, T, t < 2.4 ? 'CI-NEB  ·  BAND RELAXING' : 'CI-NEB  ·  kcal/mol', x0, y0 - 16, { alpha: 0.85 });
    }
  };

  /* Umbrella sampling: windows fill one after the other, each histogram
     sampled under its harmonic bias, then WHAM joins them into the PMF. */
  SCENES['dynamic-qmmm'] = {
    file: null, period: 12, still: 9.4,
    init: function () {
      var nw = 15, wins = [], r = rand(11);
      for (var i = 0; i < nw; i++) {
        var c = i / (nw - 1);
        var bins = [];
        for (var b = 0; b < 24; b++) bins.push(r());
        wins.push({ c: c, w: 0.045 + 0.012 * Math.sin(i * 1.3) * Math.sin(i * 1.3), noise: bins });
      }
      return { wins: wins, r: rand(5) };
    },
    pmf: function (x) {
      // free energy profile (illustrative shape) on 0..1, kcal/mol
      return 15 * Math.exp(-Math.pow((x - 0.52) / 0.17, 2)) - 4 * smooth((x - 0.35) / 0.6) + 1.2 * Math.exp(-Math.pow((x - 0.18) / 0.08, 2)) - 1.2 * Math.exp(-Math.pow((x - 0.06) / 0.07, 2));
    },
    frame: function () { return null; },
    overlay: function (S, t, ctx, w, h, T) {
      var self = this;
      var x0 = 22, x1 = w - 22, yb = h * 0.82, yt = h * 0.18;
      var lo = -6, hi = 17;
      function X(x) { return x0 + (x1 - x0) * x; }
      function Y(e) { return yb - (yb - yt) * (e - lo) / (hi - lo); }
      var out = 1 - smooth(win(t, 11.2, 12));
      ctx.save(); ctx.globalAlpha = out;
      // faint grid
      for (var g = 0; g <= 4; g++) hair(ctx, T, x0, yt + (yb - yt) * g / 4, x1, yt + (yb - yt) * g / 4, 0.18);
      hair(ctx, T, x0, yb + 6, x1, yb + 6, 0.6);
      var nw = S.wins.length, per = 0.42, start = 0.3;
      var active = -1;
      S.wins.forEach(function (wd, i) {
        var a = win(t, start + i * per, start + i * per + 0.9);
        if (a <= 0) return;
        if (a < 1) active = i;
        var c = neonAt(T, wd.c);
        // histogram: gaussian bins around the window centre
        var nb = 18, span = wd.w * 6, hmax = (yb - yt) * (0.2 + 0.16 * wd.noise[3]) * smooth(a * 1.3);
        var hp = new Path2D(), bw = span / nb;
        hp.moveTo(X(wd.c - span / 2), yb);
        for (var b = 0; b < nb; b++) {
          var xb = wd.c - span / 2 + bw * (b + 0.5);
          var gss = Math.exp(-Math.pow((xb - wd.c) / wd.w, 2) / 2);
          var hv = hmax * gss * (0.88 + 0.24 * wd.noise[b]);
          hp.lineTo(X(xb - bw / 2), yb - hv); hp.lineTo(X(xb + bw / 2), yb - hv);
        }
        hp.lineTo(X(wd.c + span / 2), yb); hp.closePath();
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, yt - 20, x1 - x0, yb - yt + 20); ctx.clip();
        ctx.fillStyle = css(c, T.light ? 0.22 : 0.16); ctx.fill(hp);
        ctx.strokeStyle = css(c, 0.85); ctx.lineWidth = 1; ctx.stroke(hp);
        ctx.restore();
        // umbrella bias of the running window
        if (a < 1) {
          var pts = [];
          for (var q = -1; q <= 1.0001; q += 0.1) {
            var xx = wd.c + q * 0.09;
            pts.push([X(xx), Y(self.pmf(wd.c) + 2 + 140 * Math.pow(xx - wd.c, 2))]);
          }
          ctx.save(); ctx.globalAlpha = out * Math.sin(a * Math.PI);
          ctx.strokeStyle = css(c, 0.9); ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
          ctx.stroke(curvePath(pts)); ctx.restore();
          // walker sampling the window
          var jit = wd.c + wd.w * 1.2 * Math.sin(t * 13.1 + i) * Math.sin(t * 7.3);
          glowDot(ctx, T, X(jit), Y(self.pmf(jit)) - 4, 2.6, c, out);
        }
      });
      void nw;
      // WHAM: the PMF is drawn from left to right
      var wham = win(t, start + S.wins.length * per + 0.5, start + S.wins.length * per + 2.2);
      if (wham > 0) {
        var pts2 = [], N = 90, upto = Math.round(N * ease(wham));
        for (var k = 0; k <= upto; k++) { var xk = k / N; pts2.push([X(xk), Y(self.pmf(xk))]); }
        neon(ctx, T, curvePath(pts2), x0, x1, 1.8);
        if (wham >= 1) {
          var xts = 0.505, ets = self.pmf(xts), e0 = self.pmf(0.06);
          var a2 = smooth(win(t, start + S.wins.length * per + 2.2, start + S.wins.length * per + 2.8));
          ctx.globalAlpha = out * a2;
          var bx = X(0.27);
          hair(ctx, T, X(0.06), Y(e0), bx + 4, Y(e0), 0.55, [2, 3]);
          hair(ctx, T, bx - 4, Y(ets), X(xts), Y(ets), 0.55, [2, 3]);
          ctx.strokeStyle = css(T.ink, 0.9); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(bx, Y(e0)); ctx.lineTo(bx, Y(ets)); ctx.stroke();
          label(ctx, 'ΔG‡', bx - 7, (Y(e0) + Y(ets)) / 2 + 4, { size: 12, weight: 700, color: css(T.ink), align: 'right' });
        }
      }
      ctx.restore();
      tag(ctx, T, wham > 0 ? 'WHAM  ·  PMF' : 'UMBRELLA SAMPLING' + (active >= 0 ? '  ·  window ' + (active + 1) + '/' + S.wins.length : ''), 22, 26, { alpha: 0.85 });
      tag(ctx, T, 'ξ', x1, yb + 22, { align: 'right', size: 12 });
    }
  };

  /* Residue deletion scan on hPLA2: the scan travels along the sequence,
     each residue flashes as it is deleted and its bar (change of the QM/MM
     barrier) grows below. */
  SCENES['residue-deletion'] = {
    file: 'residue-deletion', period: 13, still: 10.5,
    init: function (d, R) {
      var C = cartoon(d.segs, { nsub: 5 });
      var byNum = {};
      d.res.forEach(function (r, i) { byNum[r[0]] = i; });
      var resNums = [].concat.apply([], d.segs.map(function (s) { return s.num; }));
      return { d: d, C: C, mesh: null, R: R, byNum: byNum, resNums: resNums, maxAbs: Math.max.apply(null, d.res.map(function (r) { return Math.abs(r[3]); })) };
    },
    cursor: function (t) { return 121 * win(t, 0.8, 10.2); },
    frame: function (S, t, L, T, R) {
      var d = S.d, C = S.C, cur = this.cursor(t);
      if (!S.mesh) S.mesh = R.mesh(C);
      S.cur = cur;
      var done = Math.floor(cur);
      // cartoon: neutral, the scanned residue lit
      var resNums = S.resNums, byNum = S.byNum, maxAbs = S.maxAbs;
      paintCartoon(C, function (ri) {
        var num = resNums[ri], k = byNum[num];
        var c = CARTOON, g = 0;
        if (k !== undefined && k < done) {
          var v = d.res[k][3], f = Math.min(1, Math.abs(v) / 0.5);
          if (Math.abs(v) > 0.25) { c = mixc(CARTOON, v > 0 ? ACID : BASE, 0.55 * f); }
        }
        if (k !== undefined && Math.abs(k - cur) < 1.5) { g = 0.9 * (1 - Math.abs(k - cur) / 1.5); c = mixc(c, [1, 1, 1], 0.3); }
        return [c[0], c[1], c[2], g, 1];
      });
      S.mesh.update('col', C.col);
      L.mesh(S.mesh);
      // QM region
      drawMol(L, d.qm.xyz, d.qm.el, d.qm.bonds, { scale: 1.05, glowAll: 0.06, rim: 1.2, noH: true });
      d.qm.xyz.forEach(function (p, i) { if (d.qm.el[i] === 'M') L.sphere(p, 0.95, EL.M, 0.25, 1.2); });
      // the residue being deleted
      var k = Math.min(Math.floor(cur), d.res.length - 1);
      if (t < 10.2 && t > 0.8) {
        var r = d.res[k], fr = cur - k;
        var col = r[3] > 0 ? ACID : BASE;
        L.sphere(r[2], 1.5 * (1 - fr * 0.6), col, 0.6 + 0.4 * (1 - fr), 1.5);
      }
      // residues that matter stay marked
      for (var j = 0; j < Math.min(done, d.res.length); j++) {
        var rr = d.res[j];
        if (Math.abs(rr[3]) > 0.4) L.sphere(rr[2], 0.55 + 0.6 * Math.min(1, Math.abs(rr[3]) / maxAbs), rr[3] > 0 ? ACID : BASE, 0.18, 1.2);
      }
      return { R: mul3(rotY(0.32 * Math.sin(t * 0.33)), rotX(-0.1)), dist: 78, fov: 0.6, target: [0, 0, 0], shift: [0, 0.17], depth: 22, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T) {
      var d = S.d, n = d.res.length, x0 = 16, x1 = w - 16, y0 = h - 34, sc = 22;
      var cur = S.cur, done = Math.floor(cur);
      hair(ctx, T, x0, y0, x1, y0, 0.55);
      var bw = (x1 - x0) / n;
      for (var i = 0; i < Math.min(done + 1, n); i++) {
        var v = d.res[i][3], f = i === done ? cur - done : 1;
        var hgt = -Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 0.75) * sc * smooth(f);
        var col = v > 0 ? T.neonB : T.neonA;
        ctx.fillStyle = css(col, Math.abs(v) > 0.25 ? 0.95 : 0.55);
        ctx.fillRect(x0 + i * bw + bw * 0.15, Math.min(y0, y0 + hgt), Math.max(1, bw * 0.7), Math.abs(hgt));
      }
      if (t > 0.8 && t < 10.4) {
        var k = Math.min(done, n - 1), r = d.res[k];
        var cx = x0 + (k + 0.5) * bw;
        hair(ctx, T, cx, y0 - 24, cx, y0 + 24, 0.8);
        var name = r[1].charAt(0) + r[1].slice(1).toLowerCase() + r[0];
        var txt = 'Δ ' + name + '   ' + (r[3] > 0 ? '+' : '−') + Math.abs(r[3]).toFixed(2) + ' kcal/mol';
        tag(ctx, T, txt, clamp(cx, 80, w - 80), y0 - 30, { align: 'center', color: T.ink });
      } else {
        tag(ctx, T, 'BARRIER CHANGE PER DELETED RESIDUE', x0, y0 - 30, { alpha: 0.85 });
      }
      tag(ctx, T, 'DELETION SCAN  ·  hPLA2', 16, 24, { alpha: 0.85 });
      tag(ctx, T, '▲ raises', w - 16, 24, { align: 'right', color: T.neonB, size: 9.5 });
      tag(ctx, T, '▼ lowers', w - 16, 38, { align: 'right', color: T.neonA, size: 9.5 });
    }
  };

  /* Macrodipole: hPLA2 turns with its charged groups (acidic red, basic
     blue); the dipole vector and the direction to the active site, with
     the angle between them. */
  SCENES.macrodipole = {
    file: 'macrodipole', period: 16, still: 3.0,
    init: function (d) {
      var C = cartoon(d.segs, { nsub: 5 });
      paintCartoon(C, function () { return [CARTOON[0], CARTOON[1], CARTOON[2], 0, 0.8]; });
      var mu = [0, 0, 0];
      d.charges.forEach(function (c) { mu = V3.add(mu, V3.scale(c[2], c[1])); });
      var ang = Math.acos(V3.dot(V3.norm(mu), V3.norm(d.ts))) * 180 / Math.PI;
      return { d: d, C: C, mesh: null, mu: V3.norm(mu), ang: ang, rnd: rand(3) };
    },
    frame: function (S, t, L, T, R) {
      var d = S.d;
      if (!S.mesh) S.mesh = R.mesh(S.C);
      L.mesh(S.mesh);
      var grow = ease(win(t, 0.3, 2.0));
      d.charges.forEach(function (c, i) {
        var j = [0.25 * Math.sin(t * 2.3 + i), 0.25 * Math.sin(t * 1.9 + 2 * i), 0.25 * Math.sin(t * 2.7 + 3 * i)];
        L.sphere(V3.add(c[2], j), 1.05, c[1] < 0 ? ACID : BASE, 0.22 + 0.12 * Math.sin(t * 3 + i), 1.2);
      });
      // active site (Ca2+ of the TS model)
      L.sphere(d.ts, 1.1, EL.M, 0.55 + 0.25 * Math.sin(t * 4), 1.4);
      var len = 30 * grow;
      if (len > 1) {
        var a = V3.scale(S.mu, -len * 0.55), b = V3.scale(S.mu, len);
        var travel = (t * 0.6) % 1;
        arrow3(L, a, b, 0.75, [0.86, 0.88, 0.92], 0.04, 1.6);
        L.sphere(V3.lerp(a, b, travel), 1.0, mixc(T.neonA, T.neonB, travel), 0.55, 0.6);
      }
      var tsLen = V3.len(d.ts) * grow;
      if (tsLen > 1) arrow3(L, [0, 0, 0], V3.scale(V3.norm(d.ts), tsLen), 0.32, EL.M, 0.35, 1.2);
      S.grow = grow;
      return { R: mul3(rotX(0.32), rotY(t / 16 * Math.PI * 2)), dist: 80, fov: 0.6, target: [0, 0, 0], depth: 24, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T, P) {
      if (S.grow < 0.5) return;
      var a = smooth(win(t, 1.6, 2.4));
      var tip = P(V3.scale(S.mu, 30 * S.grow));
      ctx.save(); ctx.globalAlpha = a;
      label(ctx, 'μ', tip[0] + 9, tip[1] - 6, { size: 15, weight: 700, color: css(T.ink) });
      ctx.restore();
      tag(ctx, T, 'θ(μ, TS) = ' + Math.round(S.ang) + '°', 16, h - 16, { color: T.ink, alpha: a });
      tag(ctx, T, 'Asp/Glu', w - 16, h - 32, { align: 'right', color: ACID, alpha: 0.95 });
      tag(ctx, T, 'Lys/Arg', w - 16, h - 16, { align: 'right', color: BASE, alpha: 0.95 });
    }
  };

  /* 3D clustering on PC1-PC3: the frames of the chignolin trajectory appear,
     then each cluster lights up in turn with its representative frames. */
  var CLUSTER = ['#9aa3ae', '#5CCBFF', '#FF2FA8', '#9B8CFF', '#FFB454', '#44E0B4', '#FF6F6F'].map(hex);
  SCENES['pca-clustering'] = {
    file: 'pca-clustering', period: 15, still: 5.5,
    init: function (d) {
      var r = rand(17), pts = [];
      var total = 0;
      d.clusters.forEach(function (c) { total += c.length; });
      d.clusters.forEach(function (c, k) {
        c.forEach(function (p) { pts.push({ p: V3.scale(p, 13), k: k, delay: r() }); });
      });
      var frac = d.clusters.map(function (c) { return c.length / total; });
      return { d: d, pts: pts, frac: frac };
    },
    frame: function (S, t, L) {
      var grow = win(t, 0.2, 3.2);
      var nk = S.d.clusters.length - 1;
      var phase = t < 3.6 ? -1 : Math.floor((t - 3.6) / ((15 - 3.6) / nk)) + 1;
      S.focus = Math.min(phase, nk);
      S.pts.forEach(function (q) {
        var a = smooth((grow - q.delay * 0.7) / 0.3);
        if (a <= 0) return;
        var on = S.focus === q.k;
        var c = q.k === 0 ? CLUSTER[0] : CLUSTER[q.k];
        var r = (q.k === 0 ? 0.16 : 0.26) * a * (on ? 1.2 : 1);
        var g = on ? 0.45 : (S.focus > 0 ? 0.0 : 0.12);
        if (S.focus > 0 && !on) c = mixc(c, [0.55, 0.58, 0.63], 0.55);
        L.sphere(V3.scale(q.p, 0.6 + 0.4 * a), r, c, g, on ? 0.9 : 0.5, true);
      });
      S.d.reps.forEach(function (p, k) {
        var on = S.focus === k + 1, a = smooth(win(t, 3.0, 3.6));
        if (a <= 0) return;
        L.sphere(V3.scale(p, 13), (on ? 0.75 : 0.5) * a, CLUSTER[k + 1], on ? 0.6 : 0.2, 1.4);
      });
      // axes
      var ax = 17, rr = 0.07, gc = [0.75, 0.78, 0.83];
      [[ax, 0, 0], [0, ax, 0], [0, 0, ax]].forEach(function (e) {
        L.cyl(V3.scale(e, -1), e, rr, rr, gc, 0, 0.5);
        L.cyl(e, V3.scale(e, 1.07), 0.32, 0.001, gc, 0, 0.5);
      });
      return { R: mul3(rotX(0.42), rotY(-0.7 + t / 15 * Math.PI * 2 * 0.5)), dist: 78, fov: 0.6, target: [0, 0, 0], shift: [0, 0.04], depth: 24, rim: [0.6, 1.0, 1.1], fog: 0.8 };
    },
    overlay: function (S, t, ctx, w, h, T, P) {
      var ax = 17;
      [['PC1', [ax * 1.15, 0, 0]], ['PC2', [0, ax * 1.13, 0]], ['PC3', [0, 0, ax * 1.15]]].forEach(function (a) {
        var p = P(a[1]);
        tag(ctx, T, a[0], p[0], p[1] + 4, { align: 'center', alpha: 0.8, size: 9.5 });
      });
      if (S.focus > 0) {
        var k = S.focus, c = CLUSTER[k];
        tag(ctx, T, 'CLUSTER ' + (k - 1) + '  ·  ' + Math.round(S.frac[k] * 100) + '% OF FRAMES', 16, h - 16, { color: T.light ? mixc(c, [0, 0, 0], 0.35) : c });
      } else {
        tag(ctx, T, 'DBSCAN + GMM  ·  ' + S.pts.length + ' FRAMES', 16, h - 16, { alpha: 0.85 });
      }
    }
  };

  /* Dihedral refit: the QM scan of 1,3-propanediol turns the torsion while
     the GAFF2 profile morphs into the refitted one over the QM points. */
  SCENES.dihedral = {
    file: 'dihedral', period: 12, still: 7.6,
    init: function (d) {
      var order = d.angles.map(function (a, i) { return [a, i]; }).sort(function (a, b) { return a[0] - b[0]; });
      // sense of rotation of the moving group when the dihedral increases
      var tor = d.torsion, f0 = d.frames[order[0][1]], f1 = d.frames[order[1][1]];
      var u = V3.norm(V3.sub(f0[tor[2]], f0[tor[1]]));
      var perp = function (f) { var v = V3.sub(f[tor[3]], f[tor[2]]); return V3.sub(v, V3.scale(u, V3.dot(v, u))); };
      var sense = V3.dot(V3.cross(perp(f0), perp(f1)), u) >= 0 ? 1 : -1;
      return { d: d, order: order, sense: sense };
    },
    angle: function (t) {
      if (t < 3.4) return -176.5;
      return -176.5 + 353 * ease(win(t, 3.4, 11.2));
    },
    geom: function (S, ang) {
      var o = S.order, n = o.length;
      var i = 0;
      while (i < n - 1 && o[i + 1][0] <= ang) i++;
      var j = Math.min(i + 1, n - 1), f = j === i ? 0 : clamp((ang - o[i][0]) / (o[j][0] - o[i][0]), 0, 1);
      var A = S.d.frames[o[i][1]], B = S.d.frames[o[j][1]];
      return A.map(function (p, k) { return V3.lerp(p, B[k], f); });
    },
    frame: function (S, t, L) {
      var ang = this.angle(t);
      var xyz = this.geom(S, ang), tor = S.d.torsion;
      S.ang = ang;
      var on = {}; tor.forEach(function (i) { on[i] = 1; });
      drawMol(L, xyz, S.d.el, S.d.bonds, { scale: 1.25, bondScale: 1.25, glow: function (i) { return on[i] ? 0.05 : 0; }, rim: 1.2 });
      // the rotatable bond as a glowing axis
      var a = xyz[tor[1]], b = xyz[tor[2]], u = V3.norm(V3.sub(b, a));
      L.cyl(V3.sub(a, V3.scale(u, 0.9)), V3.add(b, V3.scale(u, 0.9)), 0.06, 0.06, [1, 1, 1], 0.9, 0);
      S.axis = [a, b];
      return { R: mul3(rotX(0.25), rotY(-0.5 + 0.25 * Math.sin(t * 0.4))), dist: 17.5, fov: 0.6, target: [0, 0, 0], shift: [-0.45, 0.04], depth: 6, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T, P) {
      var d = S.d, x0 = w * 0.55, x1 = w - 18, y0 = h * 0.2, y1 = h * 0.76, emax = 6;
      function X(a) { return x0 + (x1 - x0) * (a + 180) / 360; }
      function Y(e) { return y1 - (y1 - y0) * e / emax; }
      hair(ctx, T, x0, y1 + 6, x1, y1 + 6, 0.55);
      [-180, 0, 180].forEach(function (a) { tag(ctx, T, String(a).replace('-', '−'), X(a), y1 + 20, { align: 'center', size: 9.5, alpha: 0.75 }); });
      var appear = win(t, 0.2, 1.6), morph = ease(win(t, 1.8, 3.2));
      // QM points
      d.qm.forEach(function (p, i) {
        if (i / d.qm.length > appear) return;
        ctx.fillStyle = css(T.ink, 0.85);
        ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 1.6, 0, Math.PI * 2); ctx.fill();
      });
      // GAFF2 -> refit
      var pts = d.mm.map(function (p, i) { var e = p[1] + (d.fit[i][1] - p[1]) * morph; return [X(p[0]), Y(e)]; });
      if (morph < 1) {
        ctx.save(); ctx.globalAlpha = 1 - morph; ctx.strokeStyle = css(T.ink3, 0.9); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.stroke(curvePath(d.mm.map(function (p) { return [X(p[0]), Y(p[1])]; }))); ctx.restore();
      }
      neon(ctx, T, curvePath(pts), x0, x1, 1.6, appear);
      if (t >= 3.4) {
        var a = S.ang, e = 0;
        for (var i = 0; i < d.fit.length - 1; i++) if (d.fit[i][0] <= a && d.fit[i + 1][0] >= a) {
          var f = (a - d.fit[i][0]) / (d.fit[i + 1][0] - d.fit[i][0]); e = d.fit[i][1] + (d.fit[i + 1][1] - d.fit[i][1]) * f;
        }
        hair(ctx, T, X(a), y0 - 4, X(a), y1 + 6, 0.5);
        glowDot(ctx, T, X(a), Y(e), 3.2, neonAt(T, (a + 180) / 360), 1);
        tag(ctx, T, Math.round(a).toString().replace('-', '−') + '°', X(a), y0 - 9, { align: 'center', color: T.ink });
      }
      tag(ctx, T, morph < 0.5 ? 'GAFF2 vs QM' : 'REFIT vs QM', x0, 22, { alpha: 0.85 });
      // rotation arc around the bond
      if (S.axis) {
        var A = S.axis[0], B = S.axis[1], u = V3.norm(V3.sub(B, A));
        var e1 = V3.norm(V3.cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = V3.cross(u, e1);
        var c3 = V3.lerp(A, B, 0.62), rad = 1.0, sense = S.sense, spin = t * 1.5 * sense;
        var pts = [];
        for (var q = 0; q <= 40; q++) {
          var th = spin + sense * q / 40 * Math.PI * 1.6;
          pts.push(P(V3.add(c3, V3.add(V3.scale(e1, rad * Math.cos(th)), V3.scale(e2, rad * Math.sin(th))))));
        }
        var xs = pts.map(function (p) { return p[0]; });
        neon(ctx, T, linePath(pts), Math.min.apply(null, xs), Math.max.apply(null, xs), 1.2, 0.95);
        // arrowhead along the direction of rotation
        var tip = pts[pts.length - 1], prev = pts[pts.length - 4];
        var dx = tip[0] - prev[0], dy = tip[1] - prev[1], dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl; dy /= dl;
        ctx.save();
        ctx.fillStyle = css(T.neonB, 0.95);
        ctx.beginPath();
        ctx.moveTo(tip[0] + dx * 6, tip[1] + dy * 6);
        ctx.lineTo(tip[0] - dy * 4, tip[1] + dx * 4);
        ctx.lineTo(tip[0] + dy * 4, tip[1] - dx * 4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  };

  /* CompChemKit: a phone cycling through the five modules of the app. */
  var MODULES = ['Lab notebook', 'Literature hub', 'HPC workbench', 'Structure studio', 'Paper kit'];
  SCENES.compchemkit = {
    file: null, period: 15, still: 9.4,
    init: function () {
      var mol = [], ring = [];
      for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; ring.push([Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0]); }
      mol = ring.concat([[2.9, 0, 0], [3.6, 1.2, 0], [3.6, -1.2, 0], [-2.9, 0, 0], [-3.6, 1.2, 0], [-3.6, -1.2, 0]]);
      var el = 'CCCCCCCOOCOO';
      return { mol: mol, el: el, bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6], [6, 7], [6, 8], [3, 9], [9, 10], [9, 11]] };
    },
    frame: function () { return null; },
    overlay: function (S, t, ctx, w, h, T) {
      var mod = Math.floor(t / 3) % 5, f = (t % 3) / 3;
      var ph = Math.min(h * 0.86, w * 0.42), pw = ph * 0.49;
      var cx = w / 2, cy = h * 0.53;
      // two phones behind
      [[-1, 0.86], [1, 0.86]].forEach(function (s, k) {
        ctx.save();
        ctx.translate(cx + s[0] * pw * 0.95, cy + ph * 0.04);
        ctx.rotate(s[0] * 0.13); ctx.scale(s[1], s[1]);
        phone(ctx, T, pw, ph, 0.45, (mod + (k ? 1 : 4)) % 5, 0.5, t, S);
        ctx.restore();
      });
      ctx.save(); ctx.translate(cx, cy - ph * 0.02);
      phone(ctx, T, pw, ph, 1, mod, f, t, S);
      ctx.restore();
      tag(ctx, T, MODULES[mod].toUpperCase(), 16, h - 16, { color: T.ink });
      tag(ctx, T, 'OFFLINE  ·  ANDROID', w - 16, h - 16, { align: 'right', alpha: 0.8 });
    }
  };
  function rr(ctx, x, y, w, h, r) { var p = new Path2D(); p.roundRect ? p.roundRect(x, y, w, h, r) : p.rect(x, y, w, h); return p; }
  function phone(ctx, T, pw, ph, alpha, mod, f, t, S) {
    var x = -pw / 2, y = -ph / 2;
    var body = rr(ctx, x, y, pw, ph, pw * 0.16);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = T.light ? '#f7f9fb' : '#0b0e14'; ctx.fill(body);
    neon(ctx, T, body, x, x + pw, 1.4, alpha);
    // screen
    var sx = x + pw * 0.07, sy = y + ph * 0.05, sw = pw * 0.86, sh = ph * 0.9;
    ctx.save(); ctx.clip(rr(ctx, sx, sy, sw, sh, pw * 0.11));
    ctx.fillStyle = T.light ? '#eef1f5' : '#121620'; ctx.fillRect(sx, sy, sw, sh);
    var ink = T.light ? T.ink : [0.9, 0.92, 0.95];
    label(ctx, MODULES[mod], sx + sw * 0.09, sy + sh * 0.11, { size: Math.max(7, sw * 0.085), weight: 700, color: css(ink, 0.95) });
    var line = function (yy, ww, a) { ctx.fillStyle = css(T.ink3, a || 0.6); ctx.fillRect(sx + sw * 0.09, yy, sw * 0.82 * ww, Math.max(1.5, sh * 0.012)); };
    var top = sy + sh * 0.17, rowH = sh * 0.115;
    var accent = function (k) { return neonAt(T, k / 4); };
    if (mod === 0) {
      for (var i = 0; i < 5; i++) {
        var yy = top + i * rowH, done = f * 6 > i + 0.5;
        ctx.strokeStyle = css(accent(i), 0.9); ctx.lineWidth = 1.2;
        ctx.strokeRect(sx + sw * 0.09, yy, sh * 0.04, sh * 0.04);
        if (done) { ctx.fillStyle = css(accent(i), 0.9); ctx.fillRect(sx + sw * 0.09 + 2, yy + 2, sh * 0.04 - 4, sh * 0.04 - 4); }
        ctx.fillStyle = css(T.ink3, 0.7); ctx.fillRect(sx + sw * 0.25, yy + sh * 0.012, sw * (0.5 - 0.06 * (i % 3)), Math.max(1.5, sh * 0.014));
      }
    } else if (mod === 1) {
      for (i = 0; i < 4; i++) {
        var cy0 = top + i * rowH * 1.25 - f * rowH * 0.6;
        ctx.fillStyle = T.light ? '#ffffff' : '#1a1f2b';
        ctx.fill(rr(ctx, sx + sw * 0.07, cy0, sw * 0.86, rowH * 1.05, 4));
        ctx.fillStyle = css(accent(i), 0.85); ctx.fillRect(sx + sw * 0.07, cy0, 2, rowH * 1.05);
        ctx.fillStyle = css(T.ink3, 0.7); ctx.fillRect(sx + sw * 0.13, cy0 + rowH * 0.3, sw * 0.6, Math.max(1.5, sh * 0.013));
        ctx.fillRect(sx + sw * 0.13, cy0 + rowH * 0.62, sw * 0.4, Math.max(1.5, sh * 0.013));
      }
    } else if (mod === 2) {
      for (i = 0; i < 5; i++) {
        var yj = top + i * rowH, prog = clamp(f * 1.6 - i * 0.12 + 0.2, 0, 1);
        line(yj, 0.45, 0.7);
        ctx.fillStyle = css(T.ink3, 0.25); ctx.fillRect(sx + sw * 0.09, yj + sh * 0.035, sw * 0.82, Math.max(2, sh * 0.018));
        ctx.fillStyle = css(accent(i), 0.95); ctx.fillRect(sx + sw * 0.09, yj + sh * 0.035, sw * 0.82 * prog, Math.max(2, sh * 0.018));
        glowDot(ctx, T, sx + sw * 0.86, yj + sh * 0.006, 1.6, prog >= 1 ? [0.27, 0.88, 0.7] : accent(i), 1);
      }
    } else if (mod === 3) {
      var mcx = sx + sw / 2, mcy = sy + sh * 0.47, k = sw * 0.075;
      var Rm = mul3(rotY(t * 1.1), rotX(0.5));
      var pr = S.mol.map(function (p) { return app3(Rm, p); });
      S.bonds.forEach(function (b) {
        var p = pr[b[0]], q = pr[b[1]];
        ctx.strokeStyle = css(T.ink3, 0.9); ctx.lineWidth = Math.max(1.5, k * 0.3);
        ctx.beginPath(); ctx.moveTo(mcx + p[0] * k, mcy - p[1] * k); ctx.lineTo(mcx + q[0] * k, mcy - q[1] * k); ctx.stroke();
      });
      pr.map(function (p, i) { return [p, i]; }).sort(function (a, b) { return a[0][2] - b[0][2]; }).forEach(function (e) {
        var p = e[0], c = elColor(S.el[e[1]]), r = k * (S.el[e[1]] === 'O' ? 0.48 : 0.52);
        var gx = mcx + p[0] * k, gy = mcy - p[1] * k;
        var g = ctx.createRadialGradient(gx - r * 0.35, gy - r * 0.35, r * 0.1, gx, gy, r);
        g.addColorStop(0, css(mixc(c, [1, 1, 1], 0.4))); g.addColorStop(1, css(mixc(c, [0, 0, 0], 0.35)));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = css(neonAt(T, (gx - sx) / sw), 0.95); ctx.lineWidth = 1; ctx.stroke();
      });
      line(sy + sh * 0.76, 0.6, 0.5); line(sy + sh * 0.8, 0.4, 0.5);
    } else {
      var bx = sx + sw * 0.09, by = top, bwid = sw * 0.82, bh = sh * 0.3;
      ctx.fillStyle = T.light ? '#ffffff' : '#1a1f2b'; ctx.fill(rr(ctx, bx, by, bwid, bh, 4));
      var pts = [];
      for (i = 0; i <= 20; i++) { var xx = i / 20; pts.push([bx + bwid * (0.08 + 0.84 * xx), by + bh * (0.75 - 0.5 * Math.exp(-Math.pow((xx - 0.5) / 0.18, 2)) + 0.1 * xx)]); }
      var upto = Math.max(2, Math.round(pts.length * clamp(f * 1.5, 0, 1)));
      neon(ctx, T, curvePath(pts.slice(0, upto)), bx, bx + bwid, 1.1);
      for (i = 0; i < 6; i++) line(by + bh + sh * 0.05 + i * sh * 0.045, i % 3 === 2 ? 0.55 : 0.92, 0.5);
    }
    // tab bar
    var ty = sy + sh * 0.92;
    for (i = 0; i < 5; i++) {
      var tx = sx + sw * (0.14 + i * 0.18);
      if (i === mod) glowDot(ctx, T, tx, ty, 2.2, accent(i), 1);
      else { ctx.fillStyle = css(T.ink3, 0.7); ctx.beginPath(); ctx.arc(tx, ty, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    ctx.restore();
  }

  /* Preparing a QM/MM system (amylase): a selection sphere grows from the
     substrate, the residues it reaches appear as sticks, then the QM region
     (65 atoms) lights up with its link atoms. */
  SCENES['qmmm-prep'] = {
    file: 'qmmm-prep', period: 12, still: 8.2,
    init: function (d) {
      var C = cartoon(d.segs, { nsub: 4 });
      var dim = mixc(CARTOON, [0.45, 0.48, 0.55], 0.35);
      paintCartoon(C, function () { return [dim[0], dim[1], dim[2], 0, 0.55]; });
      // link atoms: QM atoms bonded to fewer neighbours than a full valence, on protein residues (the CB of Asp/Glu)
      var links = [];
      d.qm.xyz.forEach(function (p, i) { if (d.qm.el[i] === 'C' && i < 20 && [0, 7, 14].indexOf(i) >= 0) links.push(i); });
      return { d: d, C: C, mesh: null, links: links };
    },
    radius: function (t) { return 9.5 * ease(win(t, 0.6, 4.2)); },
    frame: function (S, t, L, T, R) {
      var d = S.d;
      if (!S.mesh) S.mesh = R.mesh(S.C);
      L.mesh(S.mesh);
      var r = this.radius(t), out = 1 - smooth(win(t, 11.2, 12));
      S.r = r * out;
      var qmOn = smooth(win(t, 4.6, 5.6)) * out;
      // substrate: always there, dimmed where the QM region takes over
      drawMol(L, d.lig.xyz, d.lig.el, d.lig.bonds, { scale: 1.1, rim: 1.2 });
      // residues reached by the selection
      d.side.forEach(function (s) {
        var a = smooth((S.r - s.d) / 1.2);
        if (a <= 0) return;
        drawMol(L, s.xyz, s.el, s.bonds, { licorice: true, scale: a, rim: 1.1 });
      });
      if (qmOn > 0) {
        drawMol(L, d.qm.xyz, d.qm.el, d.qm.bonds, {
          scale: 1.3 * qmOn, rim: 1.6,
          glow: function () { return 0.05 + 0.04 * Math.sin(t * 4); },
          color: function (i, e) { return e === 'C' ? mixc(EL.C, T.neonB, 0.35) : elColor(e); }
        });
        S.links.forEach(function (i) { L.sphere(d.qm.xyz[i], 0.42 * qmOn, [1, 1, 1], 0.9, 0.5); });
      }
      S.qmOn = qmOn;
      var orbit = 0.22 * Math.sin(t * 0.35);
      return { R: mul3(rotY(orbit), rotX(0.12)), dist: 70, fov: 0.62, target: d.qmc, shift: [0, -0.07], depth: 20, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T, P) {
      var d = S.d;
      if (S.r > 0.3) {
        var c = P(d.qmc), e = P(V3.add(d.qmc, [S.r, 0, 0]));
        var rad = Math.abs(e[0] - c[0]);
        var ring = new Path2D(); ring.arc(c[0], c[1], rad, 0, Math.PI * 2);
        ctx.save(); ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -t * 12;
        neon(ctx, T, ring, c[0] - rad, c[0] + rad, 1.6, 1);
        ctx.restore();
        if (S.qmOn < 0.5) tag(ctx, T, 'r = ' + S.r.toFixed(1) + ' Å', c[0] + rad * 0.72 + 6, c[1] - rad * 0.72, { color: T.ink });
      }
      var txt = S.qmOn > 0.5 ? 'QM REGION  ·  ' + d.qm.xyz.length + ' ATOMS  ·  LINK ATOMS' : 'SELECTING THE QM REGION';
      tag(ctx, T, txt, 16, 24, { alpha: 0.9 });
    }
  };

  /* Conformer-averaged ABCG2 charges of MHET: conformers replace each
     other, atoms coloured by charge (red negative, blue positive), and the
     charge of every heavy atom converges on the right. */
  SCENES['abcg2-charges'] = {
    file: 'abcg2-charges', period: 12, still: 8.4,
    init: function (d) {
      var xyz = d.xyz, n = xyz.length;
      var adj = []; for (var i = 0; i < n; i++) adj.push([]);
      d.bonds.forEach(function (b) { adj[b[0]].push(b[1]); adj[b[1]].push(b[0]); });
      function side(a, b) {
        // atoms on the b side of bond a-b
        var seen = {}, st = [b]; seen[a] = 1; seen[b] = 1; var out = [b];
        while (st.length) { var x = st.pop(); adj[x].forEach(function (y) { if (!seen[y]) { seen[y] = 1; out.push(y); st.push(y); } }); }
        return out;
      }
      var idx = {}; d.names.forEach(function (nm, i) { idx[nm] = i; });
      var tors = [[idx.C1, idx.C2], [idx.C2, idx.O2], [idx.O1, idx.C1]];
      var sets = [[0, 0, 0], [72, -24, 110], [-80, 30, -60], [150, 12, 40]];
      var confs = sets.map(function (ang) {
        var p = xyz.map(function (q) { return q.slice(); });
        tors.forEach(function (tb, k) {
          var a = tb[0], b = tb[1], mov = side(a, b);
          if (mov.length > n / 2) { mov = side(b, a); var tmp = a; a = b; b = tmp; }
          var ax = V3.sub(p[b], p[a]), o = p[b];
          mov.forEach(function (m) { if (m !== b) p[m] = V3.add(o, axisRot(ax, ang[k] * Math.PI / 180, V3.sub(p[m], o))); });
        });
        // keep the aromatic ring fixed in place: centre on ring atoms
        return p;
      });
      var heavy = []; d.el.split('').forEach(function (e, i) { if (e !== 'H') heavy.push(i); });
      return { d: d, confs: confs, heavy: heavy };
    },
    k: function (t) { return Math.min(3, Math.floor(win(t, 0.4, 9.2) * 4)); },
    qcol: function (q) {
      var f = clamp(q / 0.75, -1, 1);
      return f < 0 ? mixc([0.93, 0.94, 0.96], ACID, -f) : mixc([0.93, 0.94, 0.96], BASE, f);
    },
    frame: function (S, t, L, T) {
      var d = S.d, k = this.k(t), tk = 0.4 + k * 2.2, f = ease(win(t, tk, tk + 0.8));
      var prev = S.confs[Math.max(0, k - 1)], curr = S.confs[k];
      var xyz = curr.map(function (p, i) { return V3.lerp(prev[i], p, k ? f : 1); });
      // the atom whose charge is read out on the chart
      var pick = S.heavy[Math.floor(t / 0.75) % S.heavy.length], pulse = 0.5 + 0.5 * Math.sin(t * 8.4);
      var mark = mixc(T.neonA, T.neonB, 0.5 + 0.5 * Math.sign(d.mean[pick]) * -1);
      drawMol(L, xyz, d.el, d.bonds, { scale: 1.15, bondScale: 1.2, rim: 1.2,
        color: function (i, e) { return i === pick ? mixc(elColor(e), mark, 0.6) : elColor(e); },
        glow: function (i) { return i === pick ? 0.10 + 0.08 * pulse : 0; },
        radius: function (i) { return i === pick ? 1.15 : 1; } });
      S.k = k; S.f = f; S.pick = pick;
      return { R: mul3(rotY(0.3 * Math.sin(t * 0.4)), rotX(0.35)), dist: 31, fov: 0.6, target: [0, 0, 0], shift: [-0.46, 0.0], depth: 8, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T) {
      var d = S.d, hv = S.heavy, n = hv.length;
      var x0 = w * 0.58, x1 = w - 18, y0 = h * 0.24, y1 = h * 0.78;
      var ym = (y0 + y1) / 2;
      function Y(q) { return ym - (y1 - y0) / 2 * q / 0.85; }
      for (var gl = 0; gl < n; gl++) { var gx = x0 + (x1 - x0) * (gl + 0.5) / n; hair(ctx, T, gx, y0, gx, y1, 0.12); }
      hair(ctx, T, x0, ym, x1, ym, 0.55);
      var k = S.k, f = S.f;
      for (var a = 0; a < n; a++) {
        var i = hv[a], x = x0 + (x1 - x0) * (a + 0.5) / n;
        var sum = 0;
        for (var j = 0; j <= k; j++) {
          var q = d.charges[j][i], vis = j < k ? 1 : f;
          if (k === 0) vis = 1;
          sum += q;
          ctx.fillStyle = css(T.ink3, 0.9 * vis);
          ctx.beginPath(); ctx.arc(x, Y(q), 1.5, 0, Math.PI * 2); ctx.fill();
        }
        var mean = sum / (k + 1);
        var c = mean < 0 ? T.neonB : T.neonA, on = i === S.pick;
        if (on) {
          ctx.fillStyle = css(c, 0.12);
          ctx.fillRect(x - (x1 - x0) / n / 2, y0, (x1 - x0) / n, y1 - y0);
        }
        ctx.fillStyle = css(c, 0.95);
        ctx.fillRect(x - 3.2, Y(mean) - 1, 6.4, 2);
        ctx.fillStyle = css(c, on ? 0.45 : 0.18);
        ctx.fillRect(x - 1.2, Math.min(ym, Y(mean)), 2.4, Math.abs(Y(mean) - ym));
        if (on) {
          var qs = (mean < 0 ? '−' : '+') + Math.abs(mean).toFixed(3);
          tag(ctx, T, d.names[i] + '  ' + qs, clamp(x, x0 + 30, x1 - 30), mean < 0 ? Y(mean) + 16 : Y(mean) - 8, { align: 'center', color: T.ink });
        }
      }
      tag(ctx, T, '+', x0 - 8, y0 + 4, { align: 'center' });
      tag(ctx, T, '−', x0 - 8, y1 + 4, { align: 'center' });
      tag(ctx, T, 'N = ' + (S.k + 1) + ' conformer' + (S.k ? 's' : ''), x0, y0 - 12, { color: T.ink });
      tag(ctx, T, 'ABCG2  ·  MHET', 16, 24, { alpha: 0.85 });
      tag(ctx, T, 'mean charge (e)', x0, y1 + 18, { alpha: 0.7, size: 9.5 });
    }
  };

  /* pKa comparison on lysozyme (4LZT): pH sweeps from 2 to 12 and back;
     every titratable group changes from protonated (blue) to deprotonated
     (red) at its consensus pKa, glowing while it titrates. */
  SCENES['pka-comparison'] = {
    file: 'pka-comparison', period: 14, still: 4.6,
    init: function (d) {
      var C = cartoon(d.segs, { nsub: 6 });
      paintCartoon(C, function () { return [CARTOON[0], CARTOON[1], CARTOON[2], 0, 0.85]; });
      return { d: d, C: C, mesh: null };
    },
    pH: function (t) { var u = (t % 14) / 14; return 2 + 10 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2)); },
    frame: function (S, t, L, T, R) {
      var d = S.d, pH = this.pH(t);
      if (!S.mesh) S.mesh = R.mesh(S.C);
      L.mesh(S.mesh);
      S.pHv = pH; S.prot = 0;
      d.sites.forEach(function (s) {
        var fp = 1 / (1 + Math.pow(10, pH - s.pka));
        if (fp > 0.5) S.prot++;
        var c = mixc(ACID, BASE, fp);
        L.sphere(s.xyz, 1.05, c, 0.12 + 1.6 * fp * (1 - fp), 1.25);
      });
      d.ss.forEach(function (b) { L.cyl(b[0], b[1], 0.42, 0.42, EL.S, 0.15, 1.1); L.sphere(b[0], 0.55, EL.S, 0.15, 1); L.sphere(b[1], 0.55, EL.S, 0.15, 1); });
      return { R: mul3(rotX(0.25), rotY(t / 14 * Math.PI * 2 * 0.5 - 0.6)), dist: 80, fov: 0.6, target: [0, 0, 0], shift: [0, 0.16], depth: 18, rim: [0.56, 1.0, 1.1] };
    },
    overlay: function (S, t, ctx, w, h, T) {
      var d = S.d, x0 = 18, x1 = w - 18, y = h - 30, pH = S.pHv;
      function X(v) { return x0 + (x1 - x0) * v / 14; }
      var g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, css(BASE, 0.9)); g.addColorStop(1, css(ACID, 0.9));
      ctx.fillStyle = css(T.ink3, 0.35); ctx.fillRect(x0, y - 1, x1 - x0, 2);
      d.sites.forEach(function (s) {
        var fp = 1 / (1 + Math.pow(10, pH - s.pka));
        ctx.fillStyle = css(mixc(ACID, BASE, fp), 0.95);
        ctx.beginPath(); ctx.arc(X(s.pka), y - 8, 2.2, 0, Math.PI * 2); ctx.fill();
        var pr = s.pred.filter(function (v) { return v !== null; });
        if (pr.length > 1) {
          ctx.fillStyle = css(T.ink3, 0.5);
          ctx.fillRect(X(Math.min.apply(null, pr)), y - 8.5, X(Math.max.apply(null, pr)) - X(Math.min.apply(null, pr)), 1);
        }
      });
      [2, 4, 6, 8, 10, 12].forEach(function (v) { tag(ctx, T, String(v), X(v), y + 14, { align: 'center', size: 9, alpha: 0.7 }); });
      var path = new Path2D(); path.moveTo(X(pH), y - 22); path.lineTo(X(pH), y + 4);
      neon(ctx, T, path, x0, x1, 1.4, 1, [[0, T.neonA], [1, T.neonB]]);
      tag(ctx, T, 'pH ' + pH.toFixed(1), clamp(X(pH), 30, w - 30), y - 28, { align: 'center', color: T.ink, size: 11 });
      tag(ctx, T, S.prot + ' / ' + d.sites.length + ' PROTONATED', 16, 24, { alpha: 0.85 });
      tag(ctx, T, '5 PREDICTORS  ·  CONSENSUS', w - 16, 24, { align: 'right', alpha: 0.85 });
    }
  };

  /* ------------------------------------------------------------ cards */

  var renderer = null;
  try { renderer = new Renderer(); } catch (e) { renderer = null; }
  var needsGL = function (sc) { return !!sc.file; };

  var T = tone();
  var active = [];
  var cache = {};

  function load(name) {
    if (!cache[name]) cache[name] = fetch(DATA + name + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    return cache[name];
  }

  function Fig(el) {
    this.el = el; this.slug = el.getAttribute('data-fig'); this.sc = SCENES[this.slug];
    this.state = null; this.ready = false; this.visible = false; this.t0 = 0; this.tPaused = 0;
    this.canvas = null; this.ctx = null; this.L = new Lists();
  }
  Fig.prototype.start = function () {
    var self = this, sc = this.sc;
    if (this.loading || !sc) return;
    if (needsGL(sc) && !renderer) return;
    this.loading = true;
    (sc.file ? load(sc.file) : Promise.resolve(null)).then(function (data) {
      self.state = sc.init(data, renderer);
      var cv = document.createElement('canvas');
      cv.className = 'card-canvas';
      cv.setAttribute('aria-hidden', 'true');
      self.el.appendChild(cv);
      self.canvas = cv; self.ctx = cv.getContext('2d');
      self.ready = true;
      self.resize();
      self.el.classList.add('is-live');
      self.draw(reduceMotion ? sc.still : self.time(performance.now()));
      schedule();
    }).catch(function () { self.loading = false; });
  };
  Fig.prototype.time = function (now) {
    if (!this.t0) this.t0 = now - (this.sc.offset || 0) * 1000;
    return (Math.max(0, now - this.t0) / 1000) % this.sc.period;
  };
  Fig.prototype.resize = function () {
    if (!this.canvas) return;
    var r = this.el.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    this.cw = Math.max(1, Math.round(r.width)); this.ch = Math.max(1, Math.round(r.height));
    this.dpr = dpr;
    var W = Math.round(this.cw * dpr), H = Math.round(this.ch * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  };
  Fig.prototype.draw = function (t) {
    var ctx = this.ctx, sc = this.sc, w = this.cw, h = this.ch, dpr = this.dpr;
    var W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // background (none for figures marked data-fig-transparent)
    if (this.el.hasAttribute('data-fig-transparent')) {
      ctx.clearRect(0, 0, W, H);
    } else {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      g.addColorStop(0, T.bg0); g.addColorStop(1, T.bg1);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    var project = null;
    if (sc.file && renderer) {
      this.L.reset();
      try {
        var cam = sc.frame(this.state, t, this.L, T, renderer);
        if (cam) {
          renderer.render(this.L, cam, W, H, T);
          ctx.drawImage(renderer.canvas, 0, renderer.h - H, W, H, 0, 0, W, H);
          project = function (p) { return renderer.project(p, w, h); };
        }
      } catch (e) {
        // WebGL context lost or out of memory: fall back to the still image
        this.el.classList.remove('is-live');
        this.visible = false; this.ready = false;
        if (this.canvas) this.canvas.remove();
        return;
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sc.overlay) sc.overlay(this.state, t, ctx, w, h, T, project);
  };

  var raf = 0, lastFrame = 0;
  function frame(now) {
    raf = 0;
    var any = false;
    // keep each frame affordable: when many cards are visible, update them in turns
    var vis = active.filter(function (f) { return f.ready && f.visible; });
    var budget = vis.length > 4 ? 2 : 1, slot = Math.round(now / 16.7) % budget;
    vis.forEach(function (f, i) {
      if (i % budget === slot) f.draw(f.time(now));
      any = true;
    });
    lastFrame = now;
    if (any && !reduceMotion && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function schedule() { if (!raf && !reduceMotion) raf = requestAnimationFrame(frame); }

  figs.forEach(function (el) { active.push(new Fig(el)); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var f = active.filter(function (a) { return a.el === e.target; })[0];
        if (!f) return;
        if (e.isIntersecting) f.start();
        f.visible = e.intersectionRatio > 0 && e.isIntersecting;
      });
      schedule();
    }, { rootMargin: '200px 0px' });
    active.forEach(function (f) { io.observe(f.el); });
  } else {
    active.forEach(function (f) { f.visible = true; f.start(); });
  }

  // hidden cards (filters) report zero size: redraw them when they come back
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function (entries) {
      entries.forEach(function (e) {
        var f = active.filter(function (a) { return a.el === e.target; })[0];
        if (f && f.ready) { f.resize(); if (reduceMotion) f.draw(f.sc.still); }
      });
    });
    active.forEach(function (f) { ro.observe(f.el); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });
  document.addEventListener('themechange', function () {
    T = tone();
    active.forEach(function (f) { if (f.ready) f.draw(reduceMotion ? f.sc.still : f.time(performance.now())); });
  });

  // stills of the figures on request (used to make the card images)
  window.cardFigures = {
    still: function (slug, t) {
      var f = active.filter(function (a) { return a.slug === slug; })[0];
      if (!f || !f.ready) return false;
      f.resize(); f.draw(t === undefined ? f.sc.still : ((t % f.sc.period) + f.sc.period) % f.sc.period);
      return true;
    },
    pause: function () { reduceMotion = true; cancelAnimationFrame(raf); raf = 0; },
    scenes: Object.keys(SCENES)
  };
})();
