#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: the volume of a result B-rep from its
// exact geometry, independent of OCCT and of any STEP import.
//
//   node scripts/fillet/divvolume.mjs <file.result|file.job> [--expected V] ...
//
// Divergence theorem: V = (1/3) Σ_faces ∫ x·n dA (n outward). Each face
// integral is reduced to integrals over its boundary edges (Stokes), which are
// evaluated with Gauss-Legendre quadrature on the exact edge curves (their
// integrands are smooth trigonometric polynomials, so the quadrature is exact
// to rounding):
//   - vector area   ∫ n dA            = ½ ∮ x × dx (any surface);
//   - plane         ∫ x·n dA          = o · ∫ n dA;
//   - cylinder      ∫ x·n dA          = r·∮ −r h dθ + c · ∫ n dA  (h, θ: axial
//                                       height and angle about the axis);
//   - sphere        ∫ x·n dA          = r·A± + c · ∫ n dA, A± from
//                                       ∮ r²(1 − cos φ) dθ or ∮ −r²(1 + cos φ) dθ
//                                       (the form smooth at the pole inside the
//                                       face; the one of the face's sign with
//                                       |A| < 4πr²);
//   - torus         ∫ x·n dA          = ∮ −G(v) dθ + c · ∫ n dA, G' = ρ(R cos v + ρ)(R + ρ cos v)
//                                       (v unwrapped along each loop);
//   - cone          ∫ x·n dA          = apex · ∫ n dA (every generator runs
//                                       through the apex and lies in the
//                                       tangent plane, so (x − apex)·n = 0).
// Loops run counter-clockwise about the outward normal (natural normal × the
// face's sameSense), as in the harness format. B-splines are not supported
// (reported, never guessed), nor cones whose apex lies beyond 1e6 mm (the
// apex form would cancel there).
// The input body of a job gives the input volume (planes only).

import fs from 'node:fs';
import { decodeJob, decodeResult } from './brepfmt.mjs';
import { add, cross, curveDerivative, curvePoint, dot, edgeInterval, normaliseBody, scale, sub, unit } from './geom.mjs';

// Gauss-Legendre nodes and weights on [-1, 1].
function gaussLegendre(n) {
  const xs = [], ws = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    xs.push(x); ws.push(2 / ((1 - x * x) * dp * dp));
  }
  return { xs, ws };
}
const GL = gaussLegendre(20);
const PANELS = 16;

// ∫ f(t) dt over [a, b] (a > b allowed) by panelled Gauss-Legendre.
function quad(f, a, b) {
  let s = 0;
  const h = (b - a) / PANELS;
  for (let p = 0; p < PANELS; p++) {
    const m = a + h * (p + 0.5);
    for (let i = 0; i < GL.xs.length; i++) s += GL.ws[i] * f(m + (h / 2) * GL.xs[i]);
  }
  return (s * h) / 2;
}

// The uses of a loop as (curve, t0, t1) in loop order.
const loopPieces = (body, loop) => loop.map((u) => {
  const e = body.edges[u.edge], { t0, t1 } = edgeInterval(e, body.vertices);
  return u.forward ? { c: e.curve, a: t0, b: t1 } : { c: e.curve, a: t1, b: t0 };
});

// Local frame of an axial surface: height, angle about the axis.
function axialFrame(s) {
  const a = unit(s.axis), x = unit(sub(s.x, scale(a, dot(s.x, a)))), y = cross(a, x);
  return { a, x, y, o: s.origin };
}

// ∮ over all loops of g(p, dp) dt.
const loopInt = (body, face, g) => face.loops.reduce((acc, loop) => acc + loopPieces(body, loop)
  .reduce((s, { c, a, b }) => s + quad((t) => g(curvePoint(c, t), curveDerivative(c, t)), a, b), 0), 0);

// The rate of the angle about the frame's axis along dp.
const dTheta = (F, p, dp) => {
  const q = sub(p, F.o), qx = dot(q, F.x), qy = dot(q, F.y);
  return (qx * dot(dp, F.y) - qy * dot(dp, F.x)) / (qx * qx + qy * qy);
};

function faceFlux(body, face) {
  const s = face.surface, sign = face.sameSense === false ? -1 : 1;
  const va = scale(loopInt3(body, face), 0.5); // ∫ n_out dA
  if (s.type === 'plane') return { flux: dot(s.origin, va), va };
  if (s.type === 'cylinder') {
    const F = axialFrame(s), r = s.radius;
    const i1 = loopInt(body, face, (p, dp) => -r * dot(sub(p, F.o), F.a) * dTheta(F, p, dp));
    return { flux: r * i1 + dot(F.o, va), va, area: sign * i1 };
  }
  if (s.type === 'sphere') {
    const F = axialFrame(s), r = s.radius, full = 4 * Math.PI * r * r;
    const cosPhi = (p) => dot(sub(p, F.o), F.a) / r;
    const aN = loopInt(body, face, (p, dp) => r * r * (1 - cosPhi(p)) * dTheta(F, p, dp));
    const aS = loopInt(body, face, (p, dp) => -r * r * (1 + cosPhi(p)) * dTheta(F, p, dp));
    const ok = (x) => Math.sign(x) === sign && Math.abs(x) < full;
    const pick = ok(aN) ? aN : ok(aS) ? aS : null;
    if (pick === null) return { error: `sphere face: no pole form gives an area of sign ${sign} (${aN}, ${aS})` };
    return { flux: r * pick + dot(F.o, va), va, area: sign * pick };
  }
  if (s.type === 'torus') {
    const F = axialFrame(s), R = s.major, rho = s.minor;
    const vOf = (p) => { const q = sub(p, F.o), h = dot(q, F.a), rad = Math.hypot(dot(q, F.x), dot(q, F.y)); return Math.atan2(h, rad - R); };
    const G = (v) => rho * (R * R * Math.sin(v) + R * rho * (v / 2 + Math.sin(2 * v) / 4) + rho * R * v + rho * rho * Math.sin(v));
    // v is unwrapped along each loop (continuous from the loop's start).
    let total = 0;
    for (const loop of face.loops) {
      let prev = null;
      for (const { c, a, b } of loopPieces(body, loop)) {
        const h = (b - a) / PANELS;
        for (let k = 0; k < PANELS; k++) {
          const lo = a + h * k;
          total += quad((t) => {
            const p = curvePoint(c, t);
            let v = vOf(p);
            if (prev !== null) v += 2 * Math.PI * Math.round((prev - v) / (2 * Math.PI));
            return -G(v) * dTheta(F, p, curveDerivative(c, t));
          }, lo, lo + h);
          const v1 = vOf(curvePoint(c, lo + h));
          prev = prev === null ? v1 : v1 + 2 * Math.PI * Math.round((prev - v1) / (2 * Math.PI));
        }
      }
    }
    return { flux: total + dot(F.o, va), va };
  }
  if (s.type === 'cone') {
    // radius at axial height h = radius + h tan(angle): the apex at h = −radius / tan(angle)
    const a = unit(s.axis), t = Math.tan(s.angle), h = -s.radius / t;
    if (!Number.isFinite(h) || Math.abs(h) > 1e6) return { error: `cone apex ${h} mm along the axis is beyond 1e6 mm` };
    return { flux: dot(add(s.origin, scale(a, h)), va), va };
  }
  return { error: `surface ${s.type} not supported` };
}

function loopInt3(body, face) {
  const v = [0, 0, 0];
  for (let k = 0; k < 3; k++) v[k] = loopInt(body, face, (p, dp) => cross(p, dp)[k]);
  return v;
}

// The body moved by -o (the volume is translation invariant; near the origin
// the x·n terms do not cancel, which matters for bodies far out).
function moved(b, o) {
  const m = (p) => sub(p, o);
  return {
    vertices: b.vertices.map(m),
    edges: b.edges.map((e) => ({ ...e, curve: { ...e.curve, origin: m(e.curve.origin) } })),
    // B-spline surfaces carry poles, no origin (reported as unsupported below)
    faces: b.faces.map((f) => ({ ...f, surface: f.surface.poles ? { ...f.surface, poles: f.surface.poles.map(m) } : { ...f.surface, origin: m(f.surface.origin) } })),
  };
}

export function divVolume(body) {
  const b0 = normaliseBody(body), b = moved(b0, b0.vertices[0]);
  let v = 0;
  const errors = [];
  b.faces.forEach((f, i) => {
    const r = faceFlux(b, f);
    if (r.error) errors.push(`face ${i}: ${r.error}`); else v += r.flux;
  });
  return errors.length ? { errors } : { volume: v / 3 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const file = args[i];
    let expected = null;
    if (args[i + 1] === '--expected') { expected = Number(args[i + 2]); i += 2; }
    const text = fs.readFileSync(file, 'utf8');
    let body;
    if (text.startsWith('wonky-fillet-job')) body = decodeJob(text).body;
    else {
      const r = decodeResult(text);
      if (r.status !== 'ok') { console.log(`${file}: ${r.status} ${r.class}`); continue; }
      body = r.body;
    }
    const r = divVolume(body);
    if (r.errors) { console.log(`${file}: ${r.errors.join('; ')}`); continue; }
    console.log(`${file}: volume ${r.volume.toPrecision(17)}${expected === null ? '' : ` expected ${expected} diff ${(r.volume - expected).toExponential(3)}`}`);
  }
}
