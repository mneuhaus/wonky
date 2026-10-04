import { cross, normalized, sub, triangulate, validateSolid } from './brep.mjs';
import { validateAnalytic } from './analytic.mjs';
import { unsupported } from './errors.mjs';
import { rustModel, rustModelKernel, rustStep, rustStl } from './native/rust-host.mjs';
import { isMeshBody, refuseMeshBody } from './hybrid-mesh.mjs';
import { fullBandPCurve, sphereFaceFrame, sphereNeedsPCurve, sphereCirclePCurve, cylinderLinesOnly } from './step-pcurves.mjs';
import { cylinderPCurves } from './step-cylinder-pcurves.mjs';
import { exportKernels } from './native/backend.mjs';

// Share the kernel selector's Rust default. These namespaces defer to the
// opened Rust kernel or refuse missing entries; importing an exporter (also
// for CLI help) must never implicitly initialize the retired Bend backend.
const [stepPCurves, stepCylinderPCurves] = await exportKernels();

const text = value => String(value).replaceAll("'", "''").replace(/[^\x20-\x7e]/g, '_');
function real(value) {
  if (!Number.isFinite(value)) throw new Error('Cannot export non-finite geometry');
  const s = String(Object.is(value, -0) ? 0 : value).replace('e', 'E');
  if (s.includes('E')) { const [mantissa, exponent] = s.split('E'); return `${mantissa.includes('.') ? mantissa : `${mantissa}.`}E${exponent}`; }
  return s.includes('.') ? s : `${s}.`;
}

export function toStep(model, name = 'wonky-model') {
  // Strict rust: Rust WC0 bodies are written by the Rust planar STEP writer
  // (rust/wonky-ops/src/step.rs), never by this legacy Solid serializer.
  if (rustModel(model)) return rustStep(rustModelKernel(model), model.bodies, name);
  const lines = [];
  const entity = expression => { lines.push(`#${lines.length + 1}=${expression};`); return `#${lines.length}`; };
  const point = xyz => entity(`CARTESIAN_POINT('',(${xyz.map(real).join(',')}))`);
  const direction = xyz => entity(`DIRECTION('',(${xyz.map(real).join(',')}))`);
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
  // STEP carries exact B-reps; a certified mesh has no exact edges to write.
  const mesh = model.bodies.find(isMeshBody);
  if (mesh) refuseMeshBody(mesh, 'STEP export (an exact B-rep)');
  const validations = model.bodies.map(body => body.geometry === 'analytic' ? validateAnalytic(body) : validateSolid(body));
  const eps = Math.max(...validations.map(v => v.toleranceMm));
  const uncertainty = entity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(eps)}),${mm},'distance_accuracy_value','modeling and recorded input tolerance')`);
  const context = entity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('','3D'))`);
  let parameterContext, sphereContext;
  const parameterCurve = (pcurve, surface, sphere = false) => {
    const context2d = sphere
      ? (sphereContext ??= entity("(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','2D sphere parameters'))"))
      : (parameterContext ??= entity("(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','2D cylinder parameters'))"));
    const poles = pcurve.points.map(point);
    const label = sphere ? `Bend UV approximation, sampled <= ${real(pcurve.totalBoundMm)} mm` : `Bend UV approximation <= ${real(pcurve.totalBoundMm)} mm`;
    const spline = entity(`B_SPLINE_CURVE_WITH_KNOTS('${label}',${pcurve.degree},(${poles.join(',')}),.UNSPECIFIED.,.F.,.F.,(${pcurve.multiplicities.join(',')}),(${pcurve.knots.map(real).join(',')}),.UNSPECIFIED.)`);
    const representation = entity(`DEFINITIONAL_REPRESENTATION('',(${spline}),${context2d})`);
    return entity(`PCURVE('',${surface},${representation})`);
  };
  const origin = placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const solids = model.bodies.map(body => {
    // Sphere faces: a frame whose latitudes and meridians carry the boundary
    // circles where one exists (Bend, kernel/step-pcurves.bend), and a Bend
    // parameter curve for every other circle; readers otherwise build their
    // own (OpenCascade: 1.7e-5 mm off on KS06, against 1e-7 mm tolerances).
    // The frame keeps its poles off the interior of every boundary arc (a
    // reader splits an edge at a pole: A's sheared-box corner spheres).
    const sphereFrames = new Map();
    body.faces.forEach((face, faceIndex) => {
      if (face.surface.type !== 'sphere') return;
      const arcs = face.loops.flat().map(use => body.edges[use.edge])
        .filter(edge => typeof edge.curve === 'object' && edge.curve.type === 'circle')
        .map(edge => ({ curve: edge.curve, range: edge.curveRange }));
      const frame = sphereFaceFrame(stepPCurves, face.surface, arcs);
      if (!frame.kept) sphereFrames.set(faceIndex, frame);
    });
    const surfaces = body.faces.map((face, faceIndex) => {
      const frame = sphereFrames.get(faceIndex);
      const s = frame ? { ...face.surface, origin: frame.origin, axis: frame.axis, x: frame.x } : face.surface;
      const axis = placement(s.origin, s.normal ?? s.axis, s.x);
      if (s.type === 'plane') return entity(`PLANE('',${axis})`);
      if (s.type === 'cylinder') return entity(`CYLINDRICAL_SURFACE('',${axis},${real(s.radius)})`);
      if (s.type === 'cone') return entity(`CONICAL_SURFACE('',${axis},${real(s.radius)},${real(s.angle)})`);
      if (s.type === 'sphere') return entity(`SPHERICAL_SURFACE('',${axis},${real(s.radius)})`);
      // kernel/analytic.bend Torus is the sheet on the tube centre's side of
      // the axis. A spindle torus (minor > major) is ISO 10303-42's
      // degenerate_toroidal_surface (WR1: major < minor); select_outer .T.
      // picks that same (apple) sheet.
      if (s.type === 'torus') return entity(s.minor > s.major
        ? `DEGENERATE_TOROIDAL_SURFACE('',${axis},${real(s.major)},${real(s.minor)},.T.)`
        : `TOROIDAL_SURFACE('',${axis},${real(s.major)},${real(s.minor)})`);
      unsupported(`STEP export does not support surface '${s.type}'`);
    });
    const cylinders = body.faces.flatMap((face, i) => face.surface.type === 'cylinder' ? [i] : []);
    const fullBand = body.geometry === 'analytic' && body.vertices.length === 2 &&
      body.edges.length === 3 && body.faces.length === 3 && cylinders.length === 1 &&
      body.edges.every(edge => !edge.curveRange);
    // Structural admission only. Bend audits the complete body, chooses every
    // periodic chart and identifies ordinary/seam associations atomically.
    // Unsupported surface/loop families retain the existing 3D serializer;
    // an error within this admitted family is fatal, with no implicit fitting.
    const cylinderCharts = !fullBand && body.geometry === 'analytic' && cylinders.length > 0 &&
      body.faces.every(face => ['plane', 'cylinder'].includes(face.surface.type)) &&
      cylinders.every(index => body.faces[index].loops.length === 1);
    const edgePCurves = new Map();
    // An unresolved plan is fatal unless every cylinder boundary is a
    // parameter line (a generator or a coaxial circle, decided in Bend): a
    // reader builds those parameter curves exactly, so none is written (the
    // planner's F32x2 guard exceeds its 1e-8 mm budget far from the origin).
    const plan = cylinderCharts ? cylinderPCurves(stepCylinderPCurves, body) : null;
    if (plan && plan.status !== 'Resolved' && !cylinderLinesOnly(stepPCurves, body)) {
      const location = ['faceIndex', 'loopIndex', 'useIndex', 'edgeIndex']
        .filter(key => plan[key] !== undefined).map(key => `${key} ${plan[key]}`).join(', ');
      unsupported(`STEP cylindrical parameter curves unresolved: ${plan.reason}${location ? ` (${location})` : ''}`);
    }
    if (plan?.status === 'Resolved') {
      const charts = new Map(plan.charts.map(chart => [chart.faceIndex,
        chart.pcurves.map(pcurve => parameterCurve(pcurve, surfaces[chart.faceIndex]))]));
      for (const edge of plan.edges) {
        const associated = edge.associations.map(ref => {
          const value = charts.get(ref.faceIndex)?.[ref.pcurveIndex];
          if (!value) throw new Error('Incomplete native STEP parameter-curve association');
          return value;
        });
        if (!['Ordinary', 'Seam'].includes(edge.kind)) throw new Error('Unknown native STEP curve association kind');
        edgePCurves.set(edge.edgeIndex, { kind: edge.kind === 'Seam' ? 'SEAM_CURVE' : 'SURFACE_CURVE', associated });
      }
    }
    // A parameter curve shares the 3D curve's parameter, so both are written
    // over the circle range shifted into [0, 2 pi) (readers normalize a
    // circle's trims there and drop a curve whose range then differs).
    const spherePCurves = new Map(), sphereRanges = new Map();
    const turn = 2 * Math.PI;
    for (const [faceIndex, frame] of sphereFrames) {
      for (const use of body.faces[faceIndex].loops.flat()) {
        const edge = body.edges[use.edge], c = edge.curve;
        if (typeof c !== 'object' || c.type !== 'circle' || !sphereNeedsPCurve(stepPCurves, frame, c)) continue;
        const [a, b] = edge.curveRange ?? [0, turn], shift = turn * Math.floor(a / turn);
        const [first, last] = sphereRanges.get(use.edge) ?? [a - shift, b - shift];
        const pcurve = sphereCirclePCurve(stepPCurves, frame, c, first, last);
        // Unresolved (a circle near a pole of the frame): the reader builds
        // its own, as before.
        if (pcurve.status !== 'Resolved') continue;
        if (!spherePCurves.has(use.edge)) spherePCurves.set(use.edge, []);
        if (edge.curveRange) sphereRanges.set(use.edge, [first, last]);
        spherePCurves.get(use.edge).push(parameterCurve(pcurve, surfaces[faceIndex], true));
      }
    }
    const positions = body.vertices.map(point);
    const vertices = positions.map(p => entity(`VERTEX_POINT('',${p})`));
    const edges = body.edges.map((edge, edgeIndex) => {
      let curve;
      if (typeof edge.curve === 'object') {
        const c = edge.curve;
        if (c.type === 'line') curve = entity(`LINE('',${point(c.origin)},${entity(`VECTOR('',${direction(c.direction)},1.)`)})`);
        else if (c.type === 'circle') curve = entity(`CIRCLE('',${placement(c.origin, c.normal, c.x)},${real(c.radius)})`);
        else if (c.type === 'ellipse') curve = entity(`ELLIPSE('',${placement(c.origin, c.normal, c.x)},${real(c.major)},${real(c.minor)})`);
        else unsupported(`STEP export does not support curve '${c.type}'`);
      } else {
        const dir = direction(normalized(sub(body.vertices[edge.end], body.vertices[edge.start])));
        curve = entity(`LINE('',${positions[edge.start]},${entity(`VECTOR('',${dir},1.)`)})`);
      }
      // AP214 ADVANCED_FACE.WR3 forbids a bare TRIMMED_CURVE as edge_geometry.
      // Without real PCurve associations, LINE/CONIC plus the EDGE_CURVE's
      // endpoint vertices and same_sense carry the oriented finite interval.
      // Keep explicit parameter ranges only inside a SURFACE_CURVE/SEAM_CURVE.
      if (edge.curveRange && (edgePCurves.has(edgeIndex) || spherePCurves.has(edgeIndex))) {
        const [first, last] = sphereRanges.get(edgeIndex) ?? edge.curveRange;
        curve = entity(`TRIMMED_CURVE('',${curve},(PARAMETER_VALUE(${real(first)})),(PARAMETER_VALUE(${real(last)})),.T.,.PARAMETER.)`);
      }
      if (fullBand && ['circle', 'ellipse'].includes(edge.curve.type)) {
        const faceIndex = cylinders[0];
        const pcurve = fullBandPCurve(stepPCurves, body, edgeIndex, faceIndex);
        if (pcurve.status !== 'Resolved') unsupported(`STEP cylindrical parameter curve unresolved: ${pcurve.reason}`);
        const associated = parameterCurve(pcurve, surfaces[faceIndex]);
        curve = entity(`SURFACE_CURVE('',${curve},(${associated}),.CURVE_3D.)`);
      } else if (edgePCurves.has(edgeIndex)) {
        const { kind, associated } = edgePCurves.get(edgeIndex);
        curve = entity(`${kind}('',${curve},(${associated.join(',')}),.CURVE_3D.)`);
      } else if (spherePCurves.has(edgeIndex)) {
        curve = entity(`SURFACE_CURVE('',${curve},(${spherePCurves.get(edgeIndex).join(',')}),.CURVE_3D.)`);
      }
      return entity(`EDGE_CURVE('',${vertices[edge.start]},${vertices[edge.end]},${curve},${edge.sameSense === false ? '.F.' : '.T.'})`);
    });
    const faces = body.faces.map((face, faceIndex) => {
      const bounds = face.loops.map((uses, i) => {
        const oriented = uses.map(use => entity(`ORIENTED_EDGE('',*,*,${edges[use.edge]},${use.forward ? '.T.' : '.F.'})`));
        const loop = entity(`EDGE_LOOP('',(${oriented.join(',')}))`);
        return entity(`${(face.outer?.[i] ?? i === 0) ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${loop},.T.)`);
      });
      return entity(`ADVANCED_FACE('',(${bounds.join(',')}),${surfaces[faceIndex]},${face.sameSense === false ? '.F.' : '.T.'})`);
    });
    const shell = entity(`CLOSED_SHELL('',(${faces.join(',')}))`);
    return entity(`MANIFOLD_SOLID_BREP('${text(body.id)}',${shell})`);
  });
  const representation = entity(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[origin, ...solids].join(',')}),${context})`);
  entity(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('wonky-kernel analytic B-rep'),'2;1');\nFILE_NAME('${text(name)}.step','',(''),(''),'wonky-kernel','Bend ${text(model.backend.version)}','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

export function toStl(model, { deviationMm = 0.02 } = {}) {
  if (rustModel(model)) return rustStl(rustModelKernel(model), model.bodies, deviationMm);
  const lines = [];
  for (const body of model.bodies) {
    if (body.geometry === 'analytic') unsupported('STL tessellation of curved B-reps is not implemented; use --format print for a watertight mesh, or STEP');
    // This STL is the B-rep's own exact facets; a certified mesh is written
    // with its deviation by --format print and r20-check instead.
    if (isMeshBody(body)) refuseMeshBody(body, 'Exact STL (use --format print or r20-check, which write its certified mesh with its deviation)');
    validateSolid(body);
    const name = body.id.replace(/[^A-Za-z0-9_-]/g, '_');
    lines.push(`solid ${name}`);
    for (const triangle of triangulate(body)) {
      const [a, b, c] = triangle.vertices.map(i => body.vertices[i]);
      const normal = normalized(cross(sub(b, a), sub(c, a)));
      lines.push(`  facet normal ${normal.join(' ')}`, '    outer loop',
        ...[a, b, c].map(p => `      vertex ${p.join(' ')}`), '    endloop', '  endfacet');
    }
    lines.push(`endsolid ${name}`);
  }
  return lines.join('\n') + '\n';
}
