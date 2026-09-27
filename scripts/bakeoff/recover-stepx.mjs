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

const text = (value) => String(value).replaceAll("'", "''").replace(/[^\x20-\x7e]/g, '_');
function real(value) {
  if (!Number.isFinite(value)) throw new Error('Cannot export non-finite geometry');
  const s = String(Object.is(value, -0) ? 0 : value).replace('e', 'E');
  if (s.includes('E')) { const [mantissa, exponent] = s.split('E'); return `${mantissa.includes('.') ? mantissa : `${mantissa}.`}E${exponent}`; }
  return s.includes('.') ? s : `${s}.`;
}

export const EXTRA_SURFACES = new Set(['sphere', 'torus']);
export const needsExtendedStep = (bodies) => bodies.some((b) => b.voids?.length || b.faces.some((f) => EXTRA_SURFACES.has(f.surface.type)));

export function toStepRecovered(model, name = 'wonky-recover', toleranceMm = 0.0003) {
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
  const solids = model.bodies.map((body) => {
    const surfaces = body.faces.map((face) => {
      const s = face.surface;
      if (s.type === 'plane') return entity(`PLANE('',${placement(s.origin, s.normal, s.x)})`);
      if (s.type === 'cylinder') return entity(`CYLINDRICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)})`);
      if (s.type === 'cone') return entity(`CONICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)},${real(s.angle)})`);
      if (s.type === 'sphere') return entity(`SPHERICAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.radius)})`);
      if (s.type === 'torus') return entity(`TOROIDAL_SURFACE('',${placement(s.origin, s.axis, s.x)},${real(s.major)},${real(s.minor)})`);
      throw new Error(`recover STEP: unsupported surface '${s.type}'`);
    });
    const vertices = body.vertices.map((p) => entity(`VERTEX_POINT('',${point(p)})`));
    const edges = body.edges.map((edge) => {
      const c = edge.curve;
      let curve;
      if (c.type === 'line') curve = entity(`LINE('',${point(c.origin)},${entity(`VECTOR('',${direction(c.direction)},1.)`)})`);
      else if (c.type === 'circle') curve = entity(`CIRCLE('',${placement(c.origin, c.normal, c.x)},${real(c.radius)})`);
      else if (c.type === 'ellipse') curve = entity(`ELLIPSE('',${placement(c.origin, c.normal, c.x)},${real(c.major)},${real(c.minor)})`);
      else throw new Error(`recover STEP: unsupported curve '${c.type}'`);
      if (edge.curveRange) {
        const [first, last] = edge.curveRange;
        curve = entity(`TRIMMED_CURVE('',${curve},(PARAMETER_VALUE(${real(first)})),(PARAMETER_VALUE(${real(last)})),.T.,.PARAMETER.)`);
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
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('wonky-kernel recover prototype: analytic B-rep with sphere/torus faces (test serializer)'),'2;1');\nFILE_NAME('${text(name)}.step','',(''),(''),'wonky-kernel recover','Bend ${text(model.backend.version)}','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
