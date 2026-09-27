// Fillet harness TEST INFRASTRUCTURE: STEP serializer for results with the
// stage-C2 `bspline` surface (docs/fillet/proto-rollingball.md, "Format
// extension"). A copy of scripts/bakeoff/recover-stepx.mjs (owned by another
// workflow, not edited) plus B_SPLINE_SURFACE_WITH_KNOTS; validate.mjs uses it
// only for bodies that hold a bspline face. The notes of the original follow.
//
// Boolean bake-off TEST INFRASTRUCTURE for the "recover" prototype: STEP
// serialization of recovered bodies that contain SPHERE or TORUS faces.
//
// The kernel body format and its exporter (src/exporters.mjs) have plane,
// cylinder and cone surfaces only, and this prototype may not change them. So
// that OpenCascade can still check the exact sphere/torus B-reps recovered in
// Bend, this file writes them with the same entity conventions as the
// exporter's 3D serializer (the path it takes for cones and every face family
// without Bend parameter curves): AXIS2_PLACEMENT_3D frames, LINE / CIRCLE /
// ELLIPSE edge curves, TRIMMED_CURVE for ranged arcs, one MANIFOLD_SOLID_BREP
// per body, plus SPHERICAL_SURFACE and TOROIDAL_SURFACE. No parameter curves
// are written (OpenCascade computes them from the exact 3D geometry on read).
// It serializes only: every number is the Bend output decoded losslessly.
// Bodies without sphere/torus faces keep going through src/exporters.mjs.
//
// B-spline faces (stage C2 "spline" variant) additionally get PARAMETER
// CURVES for their boundary edges. Without them OpenCascade projects every
// edge onto the B-spline itself; its projected pcurves are parametrised
// differently from the exact 3D circles (same-parameter deviations of
// 1e-5 mm on a face that is within 7e-8 mm of them) and re-trim the face
// (the 1.2e-4 mm tiny-edge face came back 0.6% too large), so the strict
// CurveOnSurface check failed on 34 of 39 spline results although their
// geometry is within the stated tolerance. The boundary edges of a skinned
// blend are iso-parameter lines of the surface (springs u = const, sections
// v = const), so each pcurve runs exactly along that isoline; its other
// coordinate is written as a function of the 3D curve's own parameter t: a
// cubic B-spline of Hermite pieces with nodes at the surface's knots (where
// the isoline point is known exactly, t from the 3D curve) and 3 inverted
// points inside every knot span, slopes dr/dt = S_r·C'(t) / |S_r|², so the
// 2D and 3D parameters agree to the surface's own deviation (a linear map is
// off by 1e-5 mm on a section arc, whose Bezier spans are not parametrised
// by angle; nodes that straddle a knot leave 1e-4 mm on a rim). A seam edge of a closed (rim) blend gets both
// pcurves (SEAM_CURVE). Circle edges on a B-spline face are written TRIMMED with
// their range normalised to start in [0, 2π), the range OpenCascade uses, so
// the 2D and 3D parameters agree. An edge that is not an isoline keeps no
// pcurve (OpenCascade projects it, as before).

import { bsplineClosest, bsplineEval } from './bspline.mjs';

const text = (value) => String(value).replaceAll("'", "''").replace(/[^\x20-\x7e]/g, '_');
function real(value) {
  if (!Number.isFinite(value)) throw new Error('Cannot export non-finite geometry');
  const s = String(Object.is(value, -0) ? 0 : value).replace('e', 'E');
  if (s.includes('E')) { const [mantissa, exponent] = s.split('E'); return `${mantissa.includes('.') ? mantissa : `${mantissa}.`}E${exponent}`; }
  return s.includes('.') ? s : `${s}.`;
}

// Distinct knot values and their multiplicities.
function knotRuns(k) {
  const values = [], mults = [];
  for (const x of k) {
    if (values.length && x === values[values.length - 1]) mults[mults.length - 1]++;
    else { values.push(x); mults.push(1); }
  }
  return { values, mults };
}

// Poles u-major: control_points_list is a list over u of lists over v.
function bsplineSurface(s, point, entity) {
  const rows = [];
  for (let i = 0; i < s.nu; i++) {
    const row = [];
    for (let j = 0; j < s.nv; j++) row.push(point(s.poles[i * s.nv + j]));
    rows.push(`(${row.join(',')})`);
  }
  const ku = knotRuns(s.knotsU), kv = knotRuns(s.knotsV);
  return entity(`B_SPLINE_SURFACE_WITH_KNOTS('',${s.du},${s.dv},(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,(${ku.mults.join(',')}),(${kv.mults.join(',')}),(${ku.values.map(real).join(',')}),(${kv.values.map(real).join(',')}),.UNSPECIFIED.)`);
}

// ---------------------------------------------------------------------------
// Parameter curves on B-spline faces

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const TAU = 2 * Math.PI;

// The frame OpenCascade builds from an AXIS2_PLACEMENT_3D: x made normal to n.
function frame(c) {
  const n = unit3(c.normal), x = unit3(sub3(c.x, n.map((v) => v * dot3(c.x, n))));
  return { n, x, y: cross3(n, x) };
}

function curveParam(c, p) {
  const d = sub3(p, c.origin);
  if (c.type === 'line') return dot3(d, unit3(c.direction));
  const { x, y } = frame(c);
  if (c.type === 'circle') return Math.atan2(dot3(d, y), dot3(d, x));
  return Math.atan2(dot3(d, y) / c.minor, dot3(d, x) / c.major);
}

function curvePoint(c, t) {
  if (c.type === 'line') { const d = unit3(c.direction); return c.origin.map((o, i) => o + t * d[i]); }
  const { x, y } = frame(c), a = c.type === 'circle' ? c.radius : c.major, b = c.type === 'circle' ? c.radius : c.minor;
  return c.origin.map((o, i) => o + a * Math.cos(t) * x[i] + b * Math.sin(t) * y[i]);
}

// Increasing parameter interval [ta, tb] of an edge's 3D curve (the kernel's
// conventions, geom.bend `interval`); periodic ranges start in [0, 2π).
export function edgeRange(edge, vertices) {
  const c = edge.curve;
  if (c.type === 'line') {
    const a = curveParam(c, vertices[edge.start]), b = curveParam(c, vertices[edge.end]);
    return [Math.min(a, b), Math.max(a, b)];
  }
  let ta, tb;
  if (edge.curveRange) [ta, tb] = edge.curveRange;
  else {
    const a = curveParam(c, vertices[edge.start]);
    let w = edge.start === edge.end ? TAU : curveParam(c, vertices[edge.end]) - a;
    if (w <= 0) w += TAU;
    [ta, tb] = edge.sameSense === false ? [a + w - TAU, a] : [a, a + w];
  }
  const k = Math.floor(ta / TAU);
  return [ta - k * TAU, tb - k * TAU];
}

function curveDeriv(c, t) {
  if (c.type === 'line') return unit3(c.direction);
  const { x, y } = frame(c), a = c.type === 'circle' ? c.radius : c.major, b = c.type === 'circle' ? c.radius : c.minor;
  return x.map((xi, i) => -a * Math.sin(t) * xi + b * Math.cos(t) * y[i]);
}

// Isoline pcurves of an edge on B-spline s: a list (two for a seam) of 2D
// cubic B-splines {poles: [[u, v]], knots, mults} in the edge's 3D curve
// parameter, or null when the edge is not an isoline.
export function isoPcurves(s, edge, vertices, seam) {
  const [ta, tb] = edgeRange(edge, vertices), c = edge.curve;
  const u0 = s.knotsU[s.du], u1 = s.knotsU[s.nu], v0 = s.knotsV[s.dv], v1 = s.knotsV[s.nv];
  const ts = [], uv = [];
  for (let i = 1; i < 10; i++) {
    const t = ta + ((tb - ta) * i) / 10, q = bsplineClosest(s, curvePoint(c, t));
    ts.push(t); uv.push([q.u, q.v]);
  }
  // Least-squares line in t for each coordinate (the first guess).
  const fit = (j) => {
    const n = ts.length, mt = ts.reduce((a, b) => a + b, 0) / n, my = uv.reduce((a, b) => a + b[j], 0) / n;
    let stt = 0, sty = 0;
    ts.forEach((t, i) => { stt += (t - mt) ** 2; sty += (t - mt) * (uv[i][j] - my); });
    const slope = sty / stt;
    const res = Math.max(...ts.map((t, i) => Math.abs(my + slope * (t - mt) - uv[i][j])));
    return { at: (t) => my + slope * (t - mt), slope, res };
  };
  const fu = fit(0), fv = fit(1), su = u1 - u0, sv = v1 - v0;
  const snap = (x, lo, hi, span, tol) => (Math.abs(x - lo) < tol * span ? lo : Math.abs(x - hi) < tol * span ? hi : x);
  // The coordinate that stays (nearly) constant, relative to its knot range:
  // a boundary isoline runs over most of one range and stays at a bound of
  // the other up to the inversion noise, which grows as 1/|S_r| (a 1e-5 mm
  // blend has |S_u| = 2e-6 mm per unit u).
  const vu = (Math.abs(fu.slope) * (tb - ta) + fu.res) / su, vv = (Math.abs(fv.slope) * (tb - ta) + fv.res) / sv;
  if (Math.min(vu, vv) > 1e-2) return null;
  const along = vu < vv ? 1 : 0; // 1: u constant, runs in v; 0: v constant, runs in u
  const fc = along === 1 ? fu : fv, fr = along === 1 ? fv : fu;
  const [clo, chi, cspan] = along === 1 ? [u0, u1, su] : [v0, v1, sv];
  const [rlo, rhi, rspan] = along === 1 ? [v0, v1, sv] : [u0, u1, su];
  if (fr.res > 0.1 * rspan) return null;
  const cvals = seam ? [clo, chi] : [snap(fc.at((ta + tb) / 2), clo, chi, cspan, 1e-2)];
  const knots = [...new Set((along === 1 ? s.knotsV : s.knotsU).filter((k) => k >= rlo && k <= rhi))];
  const ra0 = snap(fr.at(ta), rlo, rhi, rspan, 1e-3), rb0 = snap(fr.at(tb), rlo, rhi, rspan, 1e-3);
  const unwrap = (t) => (c.type === 'line' ? t : ta + ((((t - ta) % TAU) + TAU) % TAU));
  return cvals.map((cv) => {
    const at = (r) => (along === 1 ? bsplineEval(s, cv, r) : bsplineEval(s, r, cv));
    const invert = (t, r) => {
      const p = curvePoint(c, t);
      for (let it = 0; it < 50; it++) {
        const e = at(r), sr = along === 1 ? e.sv : e.su, g = dot3(sr, sr);
        if (!(g > 0)) break;
        const step = dot3(sr, sub3(e.p, p)) / g;
        r = Math.min(rhi, Math.max(rlo, r - step));
        if (Math.abs(step) < 1e-15 * rspan) break;
      }
      return r;
    };
    // Knot nodes: exact r, t of the isoline point on the 3D curve.
    const lo = Math.min(ra0, rb0), hi = Math.max(ra0, rb0);
    const kn = [{ t: ta, r: ra0 }, { t: tb, r: rb0 }];
    for (const r of knots) {
      if (!(r > lo && r < hi)) continue;
      const t = unwrap(curveParam(c, at(r).p));
      if (t > ta && t < tb) kn.push({ t, r });
    }
    kn.sort((x, y) => x.t - y.t);
    const nodes = [];
    kn.forEach((k, i) => {
      nodes.push(k);
      if (i + 1 < kn.length) for (let j = 1; j < 4; j++) {
        const t = k.t + ((kn[i + 1].t - k.t) * j) / 4;
        nodes.push({ t, r: invert(t, k.r + ((kn[i + 1].r - k.r) * j) / 4) });
      }
    });
    const full = nodes.map(({ t, r }) => {
      const e = at(r), sr = along === 1 ? e.sv : e.su, g = dot3(sr, sr);
      const dr = g > 0 ? dot3(sr, curveDeriv(c, t)) / g : 0;
      return { t, pt: along === 1 ? [cv, r] : [r, cv], d: along === 1 ? [0, dr] : [dr, 0] };
    });
    const poles = [full[0].pt];
    for (let j = 0; j + 1 < full.length; j++) {
      const p = full[j], q = full[j + 1], h = (q.t - p.t) / 3;
      poles.push([p.pt[0] + p.d[0] * h, p.pt[1] + p.d[1] * h], [q.pt[0] - q.d[0] * h, q.pt[1] - q.d[1] * h], q.pt);
    }
    return { poles, knots: full.map((n) => n.t), mults: full.map((_, j) => (j === 0 || j === full.length - 1 ? 4 : 3)) };
  });
}

export function toStepFillet(model, name = 'wonky-recover', toleranceMm = 0.0003) {
  const lines = [];
  const entity = (expression) => { lines.push(`#${lines.length + 1}=${expression};`); return `#${lines.length}`; };
  const point = (xyz) => entity(`CARTESIAN_POINT('',(${xyz.map(real).join(',')}))`);
  const direction = (xyz) => entity(`DIRECTION('',(${xyz.map(real).join(',')}))`);
  const placement = (origin, normal, x) => entity(`AXIS2_PLACEMENT_3D('',${point(origin)},${direction(normal)},${direction(x)})`);
  const app = entity("APPLICATION_CONTEXT('automotive_design')");
  entity(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const productContext = entity(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const product = entity(`PRODUCT('${text(name)}','${text(name)}','',(${productContext}))`);
  const formation = entity(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const definitionContext = entity(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  const definition = entity(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
  const shape = entity(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = entity('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))');
  const radian = entity('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))');
  const steradian = entity('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty = entity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(toleranceMm)}),${mm},'distance_accuracy_value','modeling and recorded input tolerance')`);
  const context = entity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('','3D'))`);
  const origin = placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  let context2d = null;
  const pcurve = (surface, pc) => {
    context2d ??= entity("(GEOMETRIC_REPRESENTATION_CONTEXT(2) PARAMETRIC_REPRESENTATION_CONTEXT() REPRESENTATION_CONTEXT('2D SPACE',''))");
    const poles = pc.poles.map((p) => entity(`CARTESIAN_POINT('',(${p.map(real).join(',')}))`));
    const curve = entity(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${poles.join(',')}),.UNSPECIFIED.,.F.,.F.,(${pc.mults.join(',')}),(${pc.knots.map(real).join(',')}),.UNSPECIFIED.)`);
    return entity(`PCURVE('',${surface},${entity(`DEFINITIONAL_REPRESENTATION('',(${curve}),${context2d})`)})`);
  };
  const solids = model.bodies.map((body) => {
    const surfaces = body.faces.map((face) => {
      const s = face.surface;
      if (s.type === 'plane') return entity(`PLANE('',${placement(s.origin, s.normal, s.x)})`);
      if (s.type === 'cylinder') return entity(`CYLINDRICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)})`);
      if (s.type === 'cone') return entity(`CONICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)},${real(s.angle)})`);
      if (s.type === 'sphere') return entity(`SPHERICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)})`);
      if (s.type === 'torus') return entity(`TOROIDAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.major)},${real(s.minor)})`);
      if (s.type === 'bspline') return bsplineSurface(s, point, entity);
      throw new Error(`fillet STEP: unsupported surface '${s.type}'`);
    });
    const vertices = body.vertices.map((p) => entity(`VERTEX_POINT('',${point(p)})`));
    // Isoline pcurves of the edges of B-spline faces: edge index -> {surface entity, list}.
    const iso = new Map();
    body.faces.forEach((face, fi) => {
      if (face.surface.type !== 'bspline') return;
      const uses = face.loops.flat().map((u) => u.edge);
      for (const e of new Set(uses)) {
        const seam = uses.filter((x) => x === e).length > 1;
        const pcs = isoPcurves(face.surface, body.edges[e], body.vertices, seam);
        if (pcs && !iso.has(e)) iso.set(e, { surface: surfaces[fi], pcs, seam });
      }
    });
    const edges = body.edges.map((edge, ei) => {
      const c = edge.curve, on = iso.get(ei);
      if (on && c.type !== 'line' && !edge.curveRange) edge = { ...edge, curveRange: edgeRange(edge, body.vertices) };
      let curve;
      if (c.type === 'line') curve = entity(`LINE('',${point(c.origin)},${entity(`VECTOR('',${direction(c.direction)},1.)`)})`);
      else if (c.type === 'circle') curve = entity(`CIRCLE('',${placement(c.origin, c.normal, c.x)},${real(c.radius)})`);
      else if (c.type === 'ellipse') curve = entity(`ELLIPSE('',${placement(c.origin, c.normal, c.x)},${real(c.major)},${real(c.minor)})`);
      else throw new Error(`fillet STEP: unsupported curve '${c.type}'`);
      if (edge.curveRange) {
        const [first, last] = on && c.type !== 'line' ? edgeRange(edge, body.vertices) : edge.curveRange;
        curve = entity(`TRIMMED_CURVE('',${curve},(PARAMETER_VALUE(${real(first)})),(PARAMETER_VALUE(${real(last)})),.T.,.PARAMETER.)`);
      }
      if (on) {
        const pcs = on.pcs.map((pc) => pcurve(on.surface, pc));
        curve = entity(`${on.seam ? 'SEAM_CURVE' : 'SURFACE_CURVE'}('',${curve},(${pcs.join(',')}),.CURVE_3D.)`);
      }
      return entity(`EDGE_CURVE('',${vertices[edge.start]},${vertices[edge.end]},${curve},${edge.sameSense === false ? '.F.' : '.T.'})`);
    });
    const faces = body.faces.map((face, faceIndex) => {
      const bounds = face.loops.map((uses, i) => {
        const oriented = uses.map((use) => entity(`ORIENTED_EDGE('',*,*,${edges[use.edge]},${use.forward ? '.T.' : '.F.'})`));
        const loop = entity(`EDGE_LOOP('',(${oriented.join(',')}))`);
        return entity(`${(face.outer?.[i] ?? i === 0) ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${loop},.T.)`);
      });
      return entity(`ADVANCED_FACE('',(${bounds.join(',')}),${surfaces[faceIndex]},${face.sameSense === false ? '.F.' : '.T.'})`);
    });
    const closed = (indices) => entity(`CLOSED_SHELL('',(${indices.map((i) => faces[i]).join(',')}))`);
    if (!body.voids?.length) return entity(`MANIFOLD_SOLID_BREP('${text(body.id)}',${closed(body.faces.map((_, i) => i))})`);
    // Inner void shells: faces keep the orientation of the material boundary
    // (normals into the void); the void shell is referenced reversed.
    const voids = body.voids.map((v) => entity(`ORIENTED_CLOSED_SHELL('',*,${closed(v.faces)},.F.)`));
    return entity(`BREP_WITH_VOIDS('${text(body.id)}',${closed(body.shell.faces)},(${voids.join(',')}))`);
  });
  const representation = entity(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[origin, ...solids].join(',')}),${context})`);
  entity(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('wonky-kernel fillet harness: B-rep with sphere/torus/B-spline faces (test serializer)'),'2;1');\nFILE_NAME('${text(name)}.step','',(''),(''),'wonky-kernel recover','Bend ${text(model.backend.version)}','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
