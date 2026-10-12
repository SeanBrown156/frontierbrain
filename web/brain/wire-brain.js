// wire-brain.js — procedural, faceted wireframe brain with firing pulses.
// ES module. Requires an import map (or bundler) that resolves 'three' (tested with three@0.170.0).
//
//   const brain = createWireBrain(canvas, { mode: 'lattice', dark: true });
//   brain.click(clientX, clientY);   // shockwave / cascade / scan from the nearest mesh point
//   brain.pointer(clientX, clientY); // gentle tilt toward the pointer
//   brain.setTheme(isDark);          // swap palette + blending
//   brain.setOptions({ mode, intensity, spin, density, still, offsetX });
//   brain.stats();                   // { fps, nodes, edges, pulses }
//   brain.dispose();
//
// The canvas is transparent; put the page background behind it.

import * as THREE from 'three';

/* ------------------------------------------------------------------ presets */

export const MODES = {
  // Clean emerald lattice, gold pulses, slow spin.
  lattice: {
    edgeBase: 0.30, cloudBase: 0.11, pointBase: 0.55, pointSize: 1.0,
    rate: 2.4, hops: [6, 13], branch: 1.3, speed: 1.0, decay: 1.4, density: 0.55,
    click: { hops: 18, branch: 2.2, hot: 0, speed: 1.5, ripple: 0.06, refractory: 0.6 },
  },
  // Dense firing; click = hot shockwave that floods the whole graph.
  storm: {
    edgeBase: 0.20, cloudBase: 0.08, pointBase: 0.45, pointSize: 1.0,
    rate: 15, hops: [8, 18], branch: 1.55, speed: 1.5, decay: 1.9, density: 0.6,
    click: { hops: 90, branch: 'all', hot: 1, speed: 1.9, ripple: 0.09, refractory: 2.6 },
  },
  // Scanning plane sweeps the mesh; click = spherical scan from that point.
  scan: {
    edgeBase: 0.13, cloudBase: 0.05, pointBase: 0.32, pointSize: 0.9,
    rate: 1.2, hops: [4, 8], branch: 1.2, speed: 1.0, decay: 1.5, density: 0.6, scan: true,
    click: { hops: 10, branch: 1.6, hot: 0, speed: 1.4, ripple: 0.035, refractory: 0.6, scanFrom: true },
  },
  // Vertices only; edges appear only where a signal travels. Most legible.
  constellation: {
    edgeBase: 0.03, cloudBase: 0.018, pointBase: 0.85, pointSize: 1.7,
    rate: 5, hops: [10, 18], branch: 1.15, speed: 0.9, decay: 0.9, density: 0.45,
    click: { hops: 14, branch: 1.35, hot: 0, speed: 1.1, ripple: 0.012, refractory: 1.6 },
  },
  // Crystal that twists and shatters along its facets on click, then reforms.
  facet: {
    edgeBase: 0.27, cloudBase: 0.09, pointBase: 0.5, pointSize: 1.0,
    rate: 3, hops: [6, 12], branch: 1.3, speed: 1.1, decay: 1.4, density: 0.5,
    click: { hops: 24, branch: 2.0, hot: 0, speed: 1.6, ripple: 0.11, refractory: 1.0, twist: 1.0, shatter: 0.16 },
  },
};

const PALETTE = {
  dark: { base: 0x1fd08a, hi: 0x5ff0ae, pulse: 0x9dffd2, hot: 0xd6ffec, alpha: 1.0 },
  light: { base: 0x0b8a55, hi: 0x05663e, pulse: 0x14b877, hot: 0x0a7a49, alpha: 1.35 },
};

/* ------------------------------------------------------------------ helpers */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function icoSphere(detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position.array;
  const map = new Map(); const verts = []; const tris = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    let idx = map.get(k);
    if (idx === undefined) { idx = verts.length / 3; verts.push(x, y, z); map.set(k, idx); }
    tris.push(idx);
  }
  g.dispose();
  return { verts, tris };
}

/* ------------------------------------------------------------------ shape */

// One cerebral hemisphere. d = unit direction, h = -1 left / +1 right.
// x = anterior, y = up, z = lateral.
function hemisphere(dx, dy, dz, h) {
  const lat = dz * h; // >0 lateral surface, <0 medial wall
  let x = dx * 1.22, y = dy * 0.82, z = dz * 0.6;
  if (lat < 0) z *= 0.16; // flat medial wall -> longitudinal fissure
  y += 0.14 * Math.max(dy, 0) * (1 - Math.pow((dx + 0.15) / 1.2, 2)); // dome
  if (dx > 0.2) { const f = (dx - 0.2) / 0.8; y -= 0.07 * f * Math.max(dy, 0); z *= 1 - 0.14 * f * f; } // frontal taper
  if (y < -0.22) y = -0.22 + (y + 0.22) * 0.5; // flatter underside
  // temporal lobe: lateral, low, mid-front bulge
  const tb = Math.exp(-Math.pow((dx - 0.1) / 0.45, 2)) * smooth(0.05, -0.6, dy) * smooth(0.1, 0.6, lat);
  y -= 0.2 * tb; z += h * 0.06 * tb; x += 0.05 * tb;

  // outward direction for grooves / folds
  let nx = x, ny = y + 0.1, nz = z;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  let d = 0;
  const lateral = smooth(0.15, 0.5, lat);
  // lateral (Sylvian) sulcus: rises from front-low to back-high
  const ys = -0.15 - 0.37 * (x - 0.45);
  d -= 0.16 * Math.exp(-Math.pow((y - ys) / 0.09, 2)) * smooth(0.65, 0.4, x) * smooth(-0.55, -0.3, x) * lateral;
  // central sulcus: from crown down and forward
  const xc = 0.05 + 0.25 * (0.9 - y) / 0.9;
  d -= 0.06 * Math.exp(-Math.pow((x - xc) / 0.07, 2)) * smooth(-0.05, 0.2, y) * smooth(-0.2, 0.2, lat);
  // gyri: layered sine folds (weaker on the medial wall)
  const fold = 0.048 * Math.sin(9.1 * x + 2.3 * Math.sin(6.3 * y + 1.7 * z)) * Math.sin(8.3 * y + 2.1 * Math.sin(5.7 * z + h))
    + 0.018 * Math.sin(17.3 * x + 13.1 * y + 11.7 * z + h * 2);
  d += fold * (lat < 0 ? 0.25 : 1);
  x += nx * d; y += ny * d; z += nz * d;
  z += h * 0.05;
  return [x, y, z];
}

function cerebellum(dx, dy, dz) {
  let x = -0.76 + dx * 0.42, y = -0.6 + dy * 0.27 * (dy > 0 ? 0.8 : 1), z = dz * 0.56;
  const r = 0.028 * Math.sin(dy * 26 + dx * 4) - 0.05 * Math.exp(-Math.pow(dz / 0.12, 2)) * smooth(0, -0.6, dx);
  const nl = Math.hypot(dx, dy, dz) || 1;
  x += (dx / nl) * r; y += (dy / nl) * r; z += (dz / nl) * r;
  return [x, y, z];
}

/* ------------------------------------------------------------------ graph */

function buildGraph(density, seed = 7) {
  const rand = rng(seed);
  const P = []; const K = []; const E = new Map(); // positions, kinds, edge set
  const addEdge = (a, b) => { if (a === b) return; const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (!E.has(k)) E.set(k, a < b ? [a, b] : [b, a]); };
  const addMesh = (sphere, fn, kind) => {
    const off = P.length / 3; const n = sphere.verts.length / 3;
    for (let i = 0; i < n; i++) { const p = fn(sphere.verts[3 * i], sphere.verts[3 * i + 1], sphere.verts[3 * i + 2]); P.push(p[0], p[1], p[2]); K.push(typeof kind === 'function' ? kind(sphere.verts[3 * i], sphere.verts[3 * i + 1], sphere.verts[3 * i + 2]) : kind); }
    const t = sphere.tris;
    for (let i = 0; i < t.length; i += 3) { addEdge(off + t[i], off + t[i + 1]); addEdge(off + t[i + 1], off + t[i + 2]); addEdge(off + t[i + 2], off + t[i]); }
    return [off, n];
  };
  const hd = Math.round(4 + density * 6); // 4..10
  const hs = icoSphere(hd);
  const L = addMesh(hs, (x, y, z) => hemisphere(x, y, z, -1), (x, y, z) => (z > 0.25 ? 0.5 : 0));
  const R = addMesh(hs, (x, y, z) => hemisphere(x, y, z, 1), (x, y, z) => (z < -0.25 ? 0.5 : 0));
  const C = addMesh(icoSphere(Math.round(2 + density * 3)), cerebellum, 1);

  // brain stem: staggered rings so facets read as triangles
  const sides = 7, rings = 7, stemOff = P.length / 3;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const cx = -0.22 - 0.13 * t, cy = -0.42 - 0.8 * t, rad = 0.17 - 0.06 * t;
    for (let j = 0; j < sides; j++) {
      const a = ((j + (i % 2) * 0.5) / sides) * Math.PI * 2;
      P.push(cx + Math.cos(a) * rad * 0.8, cy, Math.sin(a) * rad); K.push(2);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = stemOff + i * sides + j;
    addEdge(a, stemOff + i * sides + ((j + 1) % sides));
    if (i < rings - 1) {
      addEdge(a, stemOff + (i + 1) * sides + j);
      addEdge(a, stemOff + (i + 1) * sides + ((j + (i % 2 ? 1 : sides - 1)) % sides));
    }
  }
  const brainCount = P.length / 3;
  const pos = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const d2 = (a, b) => { const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2]; return dx * dx + dy * dy + dz * dz; };
  const nearest = (i, from, count, filter) => {
    let best = -1, bd = Infinity;
    for (let j = from; j < from + count; j++) { if (filter && !filter(j)) continue; const dd = d2(i, j); if (dd < bd) { bd = dd; best = j; } }
    return best;
  };
  // corpus callosum: medial bridges between hemispheres
  for (let i = L[0]; i < L[0] + L[1]; i += 3) {
    const p = pos(i);
    if (p[2] > -0.09 && p[1] > -0.25 && Math.abs(p[0]) < 0.75) { const j = nearest(i, R[0], R[1]); if (j >= 0 && d2(i, j) < 0.06) addEdge(i, j); }
  }
  // cerebellum + stem attachments
  const cTop = [];
  for (let i = C[0]; i < C[0] + C[1]; i++) cTop.push(i);
  cTop.sort((a, b) => P[3 * b + 1] - P[3 * a + 1]);
  for (let k = 0; k < Math.min(10, cTop.length); k++) { const i = cTop[k]; addEdge(i, nearest(i, L[0], L[1] * 2)); }
  for (let j = 0; j < sides; j++) {
    const i = stemOff + j; addEdge(i, nearest(i, L[0], L[1] * 2));
    if (j % 2 === 0) addEdge(stemOff + (rings - 3) * sides + j, nearest(stemOff + (rings - 3) * sides + j, C[0], C[1]));
  }

  // neural network cloud around the brain
  const cloudN = Math.round(110 + density * 260), cloudOff = brainCount;
  for (let i = 0; i < cloudN; i++) {
    let x, y, z, l;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < 0.1);
    const r = 1.75 + Math.pow(rand(), 0.8) * 1.9;
    P.push((x / l) * r * 1.45, (y / l) * r * 0.95 - 0.1, (z / l) * r * 1.2); K.push(3);
  }
  for (let i = cloudOff; i < cloudOff + cloudN; i++) {
    const near = [];
    for (let j = cloudOff; j < cloudOff + cloudN; j++) if (j !== i) near.push([d2(i, j), j]);
    near.sort((a, b) => a[0] - b[0]);
    const k = rand() < 0.35 ? 3 : 2;
    for (let n = 0; n < k; n++) if (near[n][0] < 1.3) addEdge(i, near[n][1]);
    const p = pos(i); const rr = Math.hypot(p[0] / 1.45, (p[1] + 0.1) / 0.95, p[2] / 1.2);
    if (rr < 2.35 || rand() < 0.12) addEdge(i, nearest(i, 0, brainCount, (j) => K[j] !== 2 || rand() < 0.3));
  }

  const N = P.length / 3;
  const edges = [...E.values()];
  const adj = Array.from({ length: N }, () => []);
  const elen = new Float32Array(edges.length);
  edges.forEach(([a, b], e) => { adj[a].push(b, e); adj[b].push(a, e); elen[e] = Math.sqrt(d2(a, b)); });
  return { positions: new Float32Array(P), kinds: new Float32Array(K), edges, adj, elen, N, brainCount };
}

/* ------------------------------------------------------------------ shaders */

const DEFORM = /* glsl */`
uniform float uTime, uRipAmp, uTwist, uBreath, uShatter, uScanOn, uScanPlane, uLitOn, uLitY;
uniform vec4 uRip[4];
uniform vec4 uScan;
float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
vec3 deform(vec3 p, out float fx){
  fx = 0.;
  vec3 n = normalize(p - vec3(0.,-0.1,0.) + 1e-4);
  float d = 0.;
  for (int i = 0; i < 4; i++) {
    float age = uTime - uRip[i].w;
    if (age > 0. && age < 3.5) {
      float dist = distance(p, uRip[i].xyz);
      float front = age * 1.5;
      float w = exp(-pow((dist - front) * 3.5, 2.)) * (1. - age / 3.5);
      d += w * uRipAmp * (0.6 + 0.4 * sin((dist - front) * 14.));
      fx += w;
    }
  }
  d += uBreath + uShatter * (hash3(p) - 0.25);
  p += n * d;
  float a = uTwist * (p.y + 0.2);
  float c = cos(a), s = sin(a);
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
  return p;
}
float scanFx(vec3 p){
  float f = 0.;
  // boot sweep: everything the plane has passed stays lit, with a bright front on the plane itself
  if (uLitOn > 0.001) f += uLitOn * (smoothstep(uLitY - 0.05, uLitY + 0.07, p.y) * 0.5 + exp(-pow((p.y - uLitY) * 8., 2.)) * 1.3);
  if (uScanOn < 0.5) return f;
  f += exp(-pow((p.y - uScanPlane) * 9., 2.)) + 0.25 * exp(-pow((p.y - uScanPlane - 0.12) * 4., 2.));
  float age = uTime - uScan.w;
  if (age > 0. && age < 4.) { float r = age * 1.3; f += exp(-pow((distance(p, uScan.xyz) - r) * 7., 2.)) * (1. - age / 4.) * 1.5; }
  return f;
}
`;

const COMMON_FRAG = /* glsl */`
uniform vec3 uBase, uHi, uPulse, uHot;
uniform float uIntensity, uCamDist, uAlphaMul;
float depthFade(float z){ return clamp(1.15 - (z - (uCamDist - 1.4)) / 2.6, 0.22, 1.); }
`;

const LINE_VS = DEFORM + /* glsl */`
attribute vec2 aGlow; attribute float aKind;
varying vec2 vGlow; varying float vKind, vDepth, vScan, vRip;
void main(){
  float fx; vec3 p = deform(position, fx);
  vScan = scanFx(position); vRip = fx; vGlow = aGlow; vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const LINE_FS = COMMON_FRAG + /* glsl */`
uniform float uEdgeBase, uCloudBase;
varying vec2 vGlow; varying float vKind, vDepth, vScan, vRip;
void main(){
  float med = abs(vKind - 0.5) < 0.1 ? 0.3 : 1.;
  float base = (vKind > 2.5 ? uCloudBase : uEdgeBase) * depthFade(vDepth) * (0.55 + 0.45 * uIntensity) * med;
  float g = vGlow.x * mix(0.6, 1., med);
  vec3 col = mix(uBase, uHi, clamp(vScan + vRip * 0.6, 0., 1.));
  col = mix(col, uPulse, clamp(g * 1.3, 0., 1.));
  col = mix(col, uHot, clamp(vGlow.y * g * 1.5, 0., 1.));
  float a = base + (g * 0.95 + vScan * 0.75 + vRip * 0.35) * uIntensity * mix(0.55, 1., depthFade(vDepth));
  gl_FragColor = vec4(col, clamp(a * uAlphaMul, 0., 1.));
}`;

const POINT_VS = DEFORM + /* glsl */`
attribute vec2 aGlow; attribute float aKind;
uniform float uPointSize, uPixelRatio, uSizeScale, uLight;
varying vec2 vGlow; varying float vKind, vDepth, vScan;
void main(){
  float fx; vec3 p = deform(position, fx);
  vScan = scanFx(position); vGlow = aGlow; vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vDepth = -mv.z;
  float s = uPointSize * (1.0 + aGlow.x * 3.2 + vScan * 1.6 + fx * 1.2) * (aKind > 2.5 ? 1.25 : 1.);
  if (uLight > 0.5) s *= 0.6 + 0.4 / (1. + aGlow.x * 2.);
  gl_PointSize = s * uPixelRatio * uSizeScale / vDepth;
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FS = COMMON_FRAG + /* glsl */`
uniform float uPointBase;
varying vec2 vGlow; varying float vKind, vDepth, vScan;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.;
  if (r > 1.) discard;
  float core = pow(1. - r, 2.2);
  float med = abs(vKind - 0.5) < 0.1 ? 0.3 : 1.;
  float g = vGlow.x * mix(0.6, 1., med);
  vec3 col = mix(uHi, uPulse, clamp(g * 1.4, 0., 1.));
  col = mix(col, uHot, clamp(vGlow.y * g * 1.5, 0., 1.));
  float base = uPointBase * med * (vKind > 2.5 ? 0.6 : 1.) * depthFade(vDepth) * (0.55 + 0.45 * uIntensity);
  float a = (base + (g * 1.1 + vScan * 0.8) * uIntensity) * core;
  gl_FragColor = vec4(col, clamp(a * uAlphaMul, 0., 1.));
}`;

/* ------------------------------------------------------------------ main */

export function createWireBrain(canvas, options = {}) {
  const opts = Object.assign({ mode: 'lattice', dark: true, intensity: 1, spin: 1, density: null, still: false, offsetX: 0, maxPixelRatio: 1.75 }, options);
  let preset = MODES[opts.mode] || MODES.lattice;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const group = new THREE.Group();
  scene.add(group);

  const uniforms = {
    uTime: { value: 0 }, uRipAmp: { value: 0.06 }, uTwist: { value: 0 }, uBreath: { value: 0 }, uShatter: { value: 0 },
    uRip: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, -99)) },
    uScan: { value: new THREE.Vector4(0, 0, 0, -99) }, uScanOn: { value: 0 }, uScanPlane: { value: 0 }, uLitOn: { value: 0 }, uLitY: { value: 2 },
    uBase: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uPulse: { value: new THREE.Color() }, uHot: { value: new THREE.Color() },
    uIntensity: { value: 1 }, uCamDist: { value: 5 }, uAlphaMul: { value: 1 },
    uEdgeBase: { value: 0.3 }, uCloudBase: { value: 0.1 }, uPointBase: { value: 0.5 },
    uPointSize: { value: 1 }, uLight: { value: 0 }, uPixelRatio: { value: 1 }, uSizeScale: { value: 14 },
  };
  const mkMat = (vs, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const lineMat = mkMat(LINE_VS, LINE_FS);
  const pointMat = mkMat(POINT_VS, POINT_FS);
  const pulseMat = mkMat(POINT_VS, POINT_FS);

  // graph-dependent state
  let G, visited, waveId = 0, lines, points, pulses, edgeGlow, edgeHot, nodeGlow, nodeHot, lastFire, lineGlowAttr, pointGlowAttr, pulsePosAttr, pulseGlowAttr;
  const PCAP = 4000;
  const pA = new Int32Array(PCAP), pB = new Int32Array(PCAP), pE = new Int32Array(PCAP), pHops = new Int16Array(PCAP);
  const pWave = new Int32Array(PCAP), pT = new Float32Array(PCAP), pSpeed = new Float32Array(PCAP), pHot = new Float32Array(PCAP), pRefr = new Float32Array(PCAP), pBranch = new Float32Array(PCAP);
  let pCount = 0;

  function build() {
    if (lines) { group.remove(lines, points, pulses); lines.geometry.dispose(); points.geometry.dispose(); pulses.geometry.dispose(); }
    const density = opts.density ?? preset.density;
    G = buildGraph(density);
    const { positions, kinds, edges, N } = G;
    const lp = new Float32Array(edges.length * 6), lk = new Float32Array(edges.length * 2);
    edges.forEach(([a, b], e) => {
      lp.set(positions.subarray(a * 3, a * 3 + 3), e * 6); lp.set(positions.subarray(b * 3, b * 3 + 3), e * 6 + 3);
      lk[e * 2] = lk[e * 2 + 1] = (kinds[a] === 0.5 || kinds[b] === 0.5) && Math.max(kinds[a], kinds[b]) < 1 ? 0.5 : Math.max(kinds[a], kinds[b]);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lineGlowAttr = new THREE.BufferAttribute(new Float32Array(edges.length * 4), 2).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('aGlow', lineGlowAttr);
    lg.setAttribute('aKind', new THREE.BufferAttribute(lk, 1));
    lines = new THREE.LineSegments(lg, lineMat); lines.frustumCulled = false;

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointGlowAttr = new THREE.BufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aGlow', pointGlowAttr);
    pg.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    points = new THREE.Points(pg, pointMat); points.frustumCulled = false;

    const qg = new THREE.BufferGeometry();
    pulsePosAttr = new THREE.BufferAttribute(new Float32Array(PCAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    pulseGlowAttr = new THREE.BufferAttribute(new Float32Array(PCAP * 2), 2).setUsage(THREE.DynamicDrawUsage);
    qg.setAttribute('position', pulsePosAttr);
    qg.setAttribute('aGlow', pulseGlowAttr);
    qg.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(PCAP), 1));
    qg.setDrawRange(0, 0);
    pulses = new THREE.Points(qg, pulseMat); pulses.frustumCulled = false;
    group.add(lines, points, pulses);

    edgeGlow = new Float32Array(edges.length); edgeHot = new Float32Array(edges.length);
    nodeGlow = new Float32Array(N); nodeHot = new Float32Array(N); lastFire = new Float32Array(N).fill(-99); visited = new Int32Array(N);
    pCount = 0;
  }

  /* ---------------- firing */
  let now = 0;
  function spawn(a, b, e, hops, branch, hot, speed, refr, wave) {
    if (pCount >= PCAP) return;
    const i = pCount++;
    pWave[i] = wave; pA[i] = a; pB[i] = b; pE[i] = e; pHops[i] = hops; pT[i] = 0; pSpeed[i] = speed; pHot[i] = hot; pRefr[i] = refr; pBranch[i] = branch;
  }
  // wave = 0: ambient firing (refractory by time); wave > 0: a click cascade (each node fires once per wave)
  const ready = (m, refr, wave) => (wave ? visited[m] !== wave : now - lastFire[m] > refr);
  function fire(n, hops, branch, hot, speed, refr, from = -1, wave = 0) {
    nodeGlow[n] = 1; nodeHot[n] = Math.max(nodeHot[n] * 0.5, hot);
    lastFire[n] = now; if (wave) visited[n] = wave;
    if (hops <= 0) return;
    const adj = G.adj[n];
    const cand = [];
    for (let k = 0; k < adj.length; k += 2) { const m = adj[k]; if (m !== from && ready(m, refr, wave)) cand.push(m, adj[k + 1]); }
    if (!cand.length) return;
    let count;
    if (branch === Infinity) count = cand.length / 2;
    else count = Math.min(cand.length / 2, Math.floor(branch) + (Math.random() < branch % 1 ? 1 : 0));
    for (let c = 0; c < count; c++) {
      const pick = branch === Infinity ? c : Math.floor(Math.random() * (cand.length / 2 - c)) + c;
      if (branch !== Infinity) { // swap pick into slot c
        const m = cand[pick * 2], e = cand[pick * 2 + 1];
        cand[pick * 2] = cand[c * 2]; cand[pick * 2 + 1] = cand[c * 2 + 1]; cand[c * 2] = m; cand[c * 2 + 1] = e;
      }
      if (wave) visited[cand[c * 2]] = wave; // claim target so the front doesn't double back
      spawn(n, cand[c * 2], cand[c * 2 + 1], hops - 1, branch, hot * 0.985, speed, refr, wave);
    }
  }
  function ambient(dt) {
    const rate = preset.rate * (0.4 + 0.6 * opts.intensity) * (opts.ambient ?? 1);
    let expected = rate * dt;
    while (expected > 0) {
      if (Math.random() < Math.min(1, expected)) {
        const n = Math.random() < 0.85 ? Math.floor(Math.random() * G.brainCount) : G.brainCount + Math.floor(Math.random() * (G.N - G.brainCount));
        const hops = preset.hops[0] + Math.floor(Math.random() * (preset.hops[1] - preset.hops[0]));
        fire(n, hops, preset.branch, 0, preset.speed, 0.25);
      }
      expected -= 1;
    }
  }
  function stepPulses(dt) {
    const pos = G.positions;
    const pp = pulsePosAttr.array, pg = pulseGlowAttr.array;
    for (let i = 0; i < pCount; i++) {
      const e = pE[i];
      pT[i] += (dt * pSpeed[i]) / Math.max(0.03, G.elen[e]);
      if (pT[i] >= 1) {
        const b = pB[i];
        edgeGlow[e] = 1; edgeHot[e] = Math.max(edgeHot[e], pHot[i]);
        if (pWave[i]) fire(b, pHops[i], pBranch[i], pHot[i], pSpeed[i], pRefr[i], pA[i], pWave[i]);
        else if (now - lastFire[b] > pRefr[i]) fire(b, pHops[i], pBranch[i], pHot[i], pSpeed[i], pRefr[i], pA[i]);
        else nodeGlow[b] = Math.max(nodeGlow[b], 0.6);
        // swap-remove
        const l = --pCount;
        pWave[i] = pWave[l]; pA[i] = pA[l]; pB[i] = pB[l]; pE[i] = pE[l]; pHops[i] = pHops[l]; pT[i] = pT[l]; pSpeed[i] = pSpeed[l]; pHot[i] = pHot[l]; pRefr[i] = pRefr[l]; pBranch[i] = pBranch[l];
        i--; continue;
      }
      edgeGlow[e] = Math.max(edgeGlow[e], 0.25 + pT[i] * 0.75);
      edgeHot[e] = Math.max(edgeHot[e], pHot[i]);
    }
    for (let i = 0; i < pCount; i++) {
      const a = pA[i] * 3, b = pB[i] * 3, t = pT[i];
      pp[i * 3] = pos[a] + (pos[b] - pos[a]) * t; pp[i * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t; pp[i * 3 + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * t;
      pg[i * 2] = 1.15; pg[i * 2 + 1] = pHot[i];
    }
    pulses.geometry.setDrawRange(0, pCount);
    pulsePosAttr.needsUpdate = true; pulseGlowAttr.needsUpdate = true;
  }
  function decay(dt) {
    const ke = Math.exp(-dt * preset.decay), kn = Math.exp(-dt * preset.decay * 1.2), kh = Math.exp(-dt * 0.9);
    const la = lineGlowAttr.array, na = pointGlowAttr.array;
    for (let e = 0; e < edgeGlow.length; e++) {
      const g = (edgeGlow[e] *= ke), h = (edgeHot[e] *= kh);
      la[e * 4] = la[e * 4 + 2] = g; la[e * 4 + 1] = la[e * 4 + 3] = h;
    }
    for (let n = 0; n < nodeGlow.length; n++) { na[n * 2] = (nodeGlow[n] *= kn); na[n * 2 + 1] = (nodeHot[n] *= kh); }
    lineGlowAttr.needsUpdate = true; pointGlowAttr.needsUpdate = true;
  }

  /* ---------------- theme, sizing */
  function setTheme(dark) {
    opts.dark = !!dark;
    const p = dark ? PALETTE.dark : PALETTE.light;
    uniforms.uBase.value.setHex(p.base); uniforms.uHi.value.setHex(p.hi); pulseCol.setHex(p.pulse); elecCol.setHex(dark ? 0x7dffc0 : 0x0fbf7a); uniforms.uPulse.value.copy(pulseCol); uniforms.uHot.value.setHex(p.hot);
    uniforms.uAlphaMul.value = p.alpha; uniforms.uLight.value = dark ? 0 : 1;
    const bl = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [lineMat, pointMat, pulseMat]) { m.blending = bl; m.needsUpdate = true; }
    if (!running) renderOnce();
  }
  const pulseCol = new THREE.Color(), elecCol = new THREE.Color(0x7dffc0);
  let W = 1, H = 1, camDist = 5;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio);
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitH = 2.35 / (0.86 * 2 * t);           // brain ~ full viewport height
    const fitW = 2.7 / (0.95 * 2 * t * camera.aspect);
    camDist = Math.max(fitH, Math.min(fitW, fitH * 1.7));
    camera.position.set(0, 0, camDist); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    uniforms.uCamDist.value = camDist; uniforms.uPixelRatio.value = dpr;
    uniforms.uSizeScale.value = 14 * Math.max(0.6, H / 900);
    group.position.x = opts.offsetX * camDist * t * camera.aspect;
    group.position.y = 0.12;
    if (!running) renderOnce();
  }

  /* ---------------- interaction */
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  const turn = { yaw: 0, pitch: 0, ty: 0, tp: 0 };
  let litAmt = -1, litFade = 1, elecAt = -99, spinAngle = opts.angle ?? 0.35, spinBoost = 0, ripIdx = 0, twistAt = -99, twistAmp = 0, shatterAt = -99, shatterAmp = 0;
  const tmp = new THREE.Vector3();

  function toNdc(x, y) { const r = canvas.getBoundingClientRect(); return [((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1), r]; }
  function pick(x, y) {
    const [nx, ny, r] = toNdc(x, y);
    group.updateMatrixWorld(true);
    const pos = G.positions;
    let best = -1, bs = Infinity, bestCloud = -1, bc = Infinity;
    for (let i = 0; i < G.N; i++) {
      tmp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(group.matrixWorld);
      const vd = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const dpx = Math.hypot((tmp.x - nx) * r.width / 2, (tmp.y - ny) * r.height / 2);
      if (i < G.brainCount) { const s = dpx + (vd - camDist) * 70; if (s < bs) { bs = s; best = i; } }
      else if (dpx < bc) { bc = dpx; bestCloud = i; }
    }
    return { best, bestCloud, cloudPx: bc, nx, ny };
  }
  function click(x, y) {
    if (!G) return;
    const { best, bestCloud, cloudPx, nx, ny } = pick(x, y);
    const c = preset.click;
    const branch = c.branch === 'all' ? Infinity : c.branch;
    const wave = ++waveId;
    fire(best, c.hops, branch, c.hot, c.speed, c.refractory, -1, wave);
    if (bestCloud >= 0 && cloudPx < 140) fire(bestCloud, Math.round(c.hops * 0.6), branch, c.hot, c.speed, c.refractory, -1, wave);
    const p = G.positions;
    uniforms.uRip.value[ripIdx++ % 4].set(p[best * 3], p[best * 3 + 1], p[best * 3 + 2], now);
    uniforms.uRipAmp.value = c.ripple;
    if (c.scanFrom) uniforms.uScan.value.set(p[best * 3], p[best * 3 + 1], p[best * 3 + 2], now);
    if (c.twist) { twistAt = now; twistAmp = c.twist * (nx >= 0 ? 1 : -1); }
    if (c.shatter) { shatterAt = now; shatterAmp = c.shatter; }
    turn.ty = THREE.MathUtils.clamp(nx * 0.65, -0.7, 0.7);
    turn.tp = THREE.MathUtils.clamp(-ny * 0.35, -0.4, 0.4);
    spinBoost = 1.2;
    if (!running) { simulate(0.7); renderOnce(); }
  }
  // Boot: sweep(0..1) lights the brain from the top down; sweep(-1) clears it. explode() is the finale: a bright green
  // electrical flood from many points at once, with the whole mesh flexing outward and settling back.
  function sweep(v, fade = 1) { litAmt = v; litFade = fade; if (!running) renderOnce(); }
  function explode() {
    if (!G) return;
    const wave = ++waveId;
    for (let i = 0; i < 18; i++) fire(Math.floor(Math.random() * G.brainCount), 70, Infinity, 0, 2.2, 2.6, -1, wave);
    for (let i = 0; i < 4; i++) { const n = Math.floor(Math.random() * G.brainCount), p = G.positions; uniforms.uRip.value[ripIdx++ % 4].set(p[n * 3], p[n * 3 + 1], p[n * 3 + 2], now); }
    uniforms.uRipAmp.value = 0.16;
    shatterAt = now; shatterAmp = 0.2; elecAt = now; spinBoost = 2.4;
    if (!running) { simulate(0.7); renderOnce(); }
  }
  function pointer(x, y) {
    const [nx, ny] = toNdc(x, y);
    tilt.tx = THREE.MathUtils.clamp(-ny, -1.2, 1.2) * 0.14;
    tilt.ty = THREE.MathUtils.clamp(nx, -1.2, 1.2) * 0.22;
  }

  /* ---------------- loop */
  function updateUniforms() {
    uniforms.uTime.value = now;
    uniforms.uIntensity.value = opts.intensity;
    uniforms.uEdgeBase.value = preset.edgeBase; uniforms.uCloudBase.value = preset.cloudBase;
    uniforms.uPointBase.value = preset.pointBase; uniforms.uPointSize.value = preset.pointSize;
    uniforms.uBreath.value = 0.012 * Math.sin(now * 0.9);
    const ta = now - twistAt; uniforms.uTwist.value = ta < 5 ? twistAmp * Math.exp(-ta * 1.1) * Math.sin(ta * 4.2) : 0;
    const sa = now - shatterAt; uniforms.uShatter.value = sa < 4 ? shatterAmp * Math.exp(-sa * 1.6) * (sa < 0.12 ? sa / 0.12 : 1) : 0;
    uniforms.uScanOn.value = preset.scan ? 1 : 0;
    uniforms.uLitOn.value = litAmt >= 0 ? litFade : 0;
    if (litAmt >= 0) uniforms.uLitY.value = 1.45 - litAmt * 2.9;
    const ea = now - elecAt, ek = ea >= 0 && ea < 4 ? Math.exp(-ea * 0.7) : 0;
    uniforms.uPulse.value.copy(pulseCol).lerp(elecCol, ek > 0 ? Math.min(1, ek * 1.6) : 0);
    uniforms.uScanPlane.value = 1.25 - ((now * 0.42) % 1) * 2.7;
  }
  function simulate(dt) {
    now += dt;
    spinBoost *= Math.exp(-dt * 1.2);
    spinAngle += dt * (0.085 * opts.spin + spinBoost * 0.25 * Math.min(1, opts.spin + 0.3));
    turn.ty *= Math.exp(-dt * 0.45); turn.tp *= Math.exp(-dt * 0.45);
    const k = 1 - Math.exp(-dt * 2.6);
    turn.yaw += (turn.ty - turn.yaw) * k; turn.pitch += (turn.tp - turn.pitch) * k;
    const kt = 1 - Math.exp(-dt * 2);
    tilt.x += (tilt.tx - tilt.x) * kt; tilt.y += (tilt.ty - tilt.y) * kt;
    group.rotation.set(0.12 + tilt.x + turn.pitch, spinAngle + tilt.y + turn.yaw, -0.04);
    ambient(dt);
    stepPulses(dt);
    decay(dt);
  }
  function renderOnce() { if (!G) return; updateUniforms(); renderer.render(scene, camera); }

  let raf = 0, running = false, last = 0, fps = 60;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
    if (dt > 0) fps = fps * 0.92 + (1 / dt) * 0.08;
    simulate(dt);
    renderOnce();
  }
  function start() {
    if (running || opts.still || reduced || document.hidden) return;
    running = true; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function stillFrame() {
    // a composed still: a few cascades caught mid-flight
    for (let i = 0; i < 6; i++) fire(Math.floor(Math.random() * G.brainCount), 12, 1.6, 0, preset.speed, 0.3);
    for (let i = 0; i < 40; i++) simulate(1 / 40);
    renderOnce();
  }
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  build(); setTheme(opts.dark); resize();
  if (opts.still || reduced) stillFrame(); else start();

  return {
    click, pointer, setTheme, sweep, explode,
    setOptions(o = {}) {
      const rebuild = (o.density !== undefined && o.density !== opts.density) || (o.mode && o.mode !== opts.mode && o.density === undefined && opts.density == null);
      Object.assign(opts, o);
      if (o.scale !== undefined) group.scale.setScalar(o.scale);
      if (o.mode) preset = MODES[o.mode] || preset;
      if (rebuild) build();
      if (o.offsetX !== undefined) resize();
      if (o.still !== undefined) { if (o.still) { stop(); stillFrame(); } else start(); }
      if (!running) renderOnce();
    },
    stats() { return { fps: running ? Math.round(fps) : 0, nodes: G.N, edges: G.edges.length, pulses: pCount, running, reducedMotion: reduced }; },
    dispose() {
      stop(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
      for (const o of [lines, points, pulses]) o.geometry.dispose();
      lineMat.dispose(); pointMat.dispose(); pulseMat.dispose(); renderer.dispose();
    },
  };
}
