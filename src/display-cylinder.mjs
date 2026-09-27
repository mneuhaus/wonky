import { array } from './kernel.mjs';
import { real, number, vector, coords } from './real.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { loadCylinderClassifier } from './cylinder-classification.mjs';

const tau = 2 * Math.PI;
const fail = message => { throw new Error(`Cylinder display: ${message}; shown as boundaries`); };
const finite = values => values.every(Number.isFinite);

// JS assembles an explicitly approximate display mesh. Frames, curve incidence,
// trims, topology, chart coordinates, heights, surface points and normals are
// evaluated/validated in Bend. No result is written back into the B-rep.
export async function loadCylinderDisplay() {
  const F = await loadFaceClassifier(), C = await loadCylinderClassifier();
  const { default: P } = await import('../kernel/curve-plane.bend');
  return (body, kernel, D) => {
    const { solid, domains } = classificationInput(body, F);
    const faces = array(solid.faces);
    return (index, displayEdges, toleranceMm) => {
      const face = body.faces[index], native = faces[index], s = face.surface, surface = native.surface;
      const origin = vector(s.origin), axis = vector(s.axis), x = vector(s.x), radius = s.radius;
      if (!finite([...s.origin, ...s.axis, ...s.x, radius]) || !(radius > 0) || !P.frame_valid(axis, x)) fail('invalid cylinder frame');
      const gapBudget = toleranceMm / 8;
      const prepared = C.prepare_loops(native.loops, solid.vertices, solid.edges, domains, origin, axis, real(radius), real(gapBudget));
      if (prepared.$ !== 'PreparedLoops') fail(`invalid trim (${prepared.reason.$})`);
      const all = C.flatten(prepared.loops), physical = C.physical_edges(all, all);
      if (physical.$ !== 'PhysicalEdges') fail(`invalid seam (${physical.reason.$})`);
      const boundary = array(physical.edges), uses = array(all);
      if (!boundary.length) fail('empty physical boundary');
      const degree = new Map();
      for (const item of boundary) for (const v of [item.edge.start, item.edge.end]) degree.set(v, (degree.get(v) ?? 0) + 1);
      if ([...degree.values()].some(n => n !== 2)) fail('nonmanifold physical boundary vertices');
      const chart = point => coords(D.cylinder_coordinates(vector(point), origin, axis, x));
      const arcs = [], generators = [], sampleAngles = [];
      let maxAmplitude = 0, projectionBound = 0, endpointGap = 0, maxVertexResidual = 0;
      const numericMm = Math.max(1e-9, ...s.origin.map(v => Math.abs(v) * 1e-10), radius * 1e-10);
      for (const item of uses.filter(use => !boundary.some(b => b.index === use.index))) {
        const a = chart(body.vertices[item.edge.start]), b = chart(body.vertices[item.edge.end]);
        const angle = Math.atan2(Math.sin(a[0] - b[0]), Math.cos(a[0] - b[0]));
        if (Math.abs(angle) * radius > numericMm) fail('periodic seam is not a resolved generator');
      }
      for (const item of boundary) {
        const edge = body.edges[item.index], points = displayEdges[item.index]?.points;
        if (!points?.length) fail('missing edge samples');
        const uv = points.map(chart);
        if (!finite(uv.flat())) fail('nonfinite chart coordinates');
        for (let i = 1; i < uv.length; i++) {
          while (uv[i][0] - uv[i - 1][0] > Math.PI) uv[i][0] -= tau;
          while (uv[i][0] - uv[i - 1][0] < -Math.PI) uv[i][0] += tau;
        }
        const entry = { edge: item.index, vertices: [edge.start, edge.end] };
        const incidence = number(C.curve_incidence(item.edge.curve, item.domain, origin, axis, real(radius)));
        endpointGap = Math.max(endpointGap, number(F.endpoint_error(item.domain, item.edge.curve, item.start, item.end, item.edge.same_sense)));
        maxVertexResidual = Math.max(maxVertexResidual, ...uv.map(p => Math.abs(p[2] - radius)));
        if (edge.curve.type === 'line') {
          if (Math.abs(uv.at(-1)[0] - uv[0][0]) * radius > numericMm) fail('line trim is not a resolved generator');
          generators.push({ ...entry, u: uv[0][0], low: Math.min(...uv.map(p => p[1])), high: Math.max(...uv.map(p => p[1])) });
          projectionBound = Math.max(projectionBound, incidence);
        } else {
          const normal = vector(edge.curve.normal);
          if (Math.abs(number(kernel.precise.dot(axis, normal))) < 1e-10) fail('round trim plane is too close to parallel with the axis');
          const coefficients = D.cylinder_trim_coefficients(origin, axis, x, real(radius), vector(edge.curve.origin), normal);
          const values = coords(coefficients), amplitude = Math.hypot(values[1], values[2]);
          if (!finite(values)) fail('nonfinite trim-height coefficients');
          const direction = Math.sign(uv.at(-1)[0] - uv[0][0]);
          if (!direction || uv.some((p, i) => i && (p[0] - uv[i - 1][0]) * direction <= 0)) fail('ambiguous angular trim');
          const low = Math.min(uv[0][0], uv.at(-1)[0]), high = Math.max(uv[0][0], uv.at(-1)[0]);
          if (high - low > tau + 1e-9) fail('trim winds around the cylinder more than once');
          const error = incidence * Math.hypot(1, amplitude / radius);
          projectionBound = Math.max(projectionBound, error);
          maxAmplitude = Math.max(maxAmplitude, amplitude);
          arcs.push({ ...entry, low, high, coefficients, values, amplitude, height: u => number(D.trim_height(coefficients, real(u))) });
        }
        sampleAngles.push(...uv.map(p => p[0]));
      }
      if (!arcs.length) fail('no transverse physical boundaries');
      // This small event-coalescing allowance only affects the display chart.
      // It prevents F32x2 roundoff at a shared vertex from creating a fake sliver.
      const angularEpsilon = numericMm / (radius + maxAmplitude + 1);
      const eventError = angularEpsilon * (radius + maxAmplitude);
      const inputBound = projectionBound + endpointGap + eventError + numericMm;
      if (!Number.isFinite(inputBound) || inputBound > toleranceMm / 4) fail('input projection uncertainty exceeds the display budget');
      const canonical = u => {
        const value = ((u % tau) + tau) % tau;
        return value < angularEpsilon || tau - value < angularEpsilon ? 0 : value;
      };
      const connectedAt = (a, b, u) => a.vertices.some(v => {
        if (!b.vertices.includes(v)) return false;
        const angle = chart(body.vertices[v])[0] - u;
        return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) * radius <= 4 * numericMm;
      });
      const events = [0, ...sampleAngles.map(canonical), tau].sort((a, b) => a - b);
      const unique = events.filter((u, i) => !i || u - events[i - 1] > angularEpsilon);
      if (unique.at(-1) !== tau) unique.push(tau);
      const spans = [];
      for (const arc of arcs) {
        const first = Math.floor(-arc.high / tau), last = Math.ceil((tau - arc.low) / tau);
        for (let k = first; k <= last; k++) {
          const low = Math.max(0, arc.low + k * tau), high = Math.min(tau, arc.high + k * tau);
          if (high - low > angularEpsilon) spans.push({ ...arc, low, high });
        }
      }
      const atAngle = (arc, u) => [u, u + tau, u - tau].some(v => v >= arc.low - angularEpsilon && v <= arc.high + angularEpsilon);
      // Generator crossings and coincident line intervals are not repaired by
      // parity. The whole face remains unshaded when its arrangement is invalid.
      for (let i = 0; i < generators.length; i++) {
        const line = generators[i], u = canonical(line.u);
        for (const arc of arcs) if (atAngle(arc, u)) {
          const h = arc.height(u);
          if (h > line.low + numericMm && h < line.high - numericMm) fail('crossing physical trims');
          if ((Math.abs(h - line.low) <= numericMm || Math.abs(h - line.high) <= numericMm) && !connectedAt(line, arc, u)) fail('unconnected touching trims');
        }
        for (const other of generators.slice(i + 1)) if (Math.abs(canonical(other.u) - u) < angularEpsilon) {
          const overlap = Math.min(line.high, other.high) - Math.max(line.low, other.low);
          if (overlap > numericMm || (Math.abs(overlap) <= numericMm && !connectedAt(line, other, u))) fail('overlapping or touching generator trims');
        }
      }
      const difference = (a, b, low, high) => {
        const values = a.values.map((v, i) => v - b.values[i]), coefficients = vector(values);
        const critical = Math.atan2(values[2], values[1]) + Math.PI;
        const candidates = [low, high];
        for (let k = -2; k <= 2; k++) if (critical + k * tau > low && critical + k * tau < high) candidates.push(critical + k * tau);
        return candidates.map(u => ({ u, value: number(D.trim_height(coefficients, real(u))) }));
      };
      for (let i = 0; i < spans.length; i++) for (const other of spans.slice(i + 1)) {
        const a = spans[i], low = Math.max(a.low, other.low), high = Math.min(a.high, other.high);
        if (a.edge !== other.edge && high >= low - angularEpsilon && high - low <= angularEpsilon &&
            Math.abs(a.height(low) - other.height(low)) <= numericMm && !connectedAt(a, other, low)) fail('unconnected touching round trims');
      }
      const maxStep = Math.min(Math.PI / 12, Math.sqrt(8 * (toleranceMm - inputBound) / (radius + maxAmplitude)));
      const columns = [0];
      for (let i = 1; i < unique.length; i++) {
        const low = unique[i - 1], high = unique[i], count = Math.max(1, Math.ceil((high - low) / maxStep));
        if (columns.length + count > 8192) fail('angular tessellation budget exceeded');
        for (let j = 1; j <= count; j++) columns.push(low + (high - low) * j / count);
      }
      const triangles = [], sign = face.sameSense === false ? -1 : 1;
      let chartAreaMm2 = 0, maxChordalErrorBoundMm = 0, maxAngularSpanRad = 0;
      const point = (u, v) => coords(D.surface_point(surface, real(u), real(v)));
      for (let i = 1; i < columns.length; i++) {
        const low = columns[i - 1], high = columns[i], middle = (low + high) / 2;
        const active = spans.filter(arc => middle > arc.low && middle < arc.high).sort((a, b) => a.height(middle) - b.height(middle));
        if (active.length % 2) fail('unbalanced physical boundary crossings');
        for (let j = 1; j < active.length; j++) {
          if (active[j].height(middle) - active[j - 1].height(middle) <= numericMm) fail('coincident or ambiguous round trims');
          for (const sample of difference(active[j], active[j - 1], low, high)) {
            if (sample.value < -numericMm || (sample.value <= numericMm &&
                (sample.u > low + angularEpsilon && sample.u < high - angularEpsilon || !connectedAt(active[j], active[j - 1], sample.u)))) fail('crossing or touching round trims');
          }
        }
        for (let j = 0; j < active.length; j += 2) {
          const lower = active[j], upper = active[j + 1];
          const a = lower.height(low), b = lower.height(high), c = upper.height(high), d = upper.height(low);
          const points = [point(low, a), point(high, b), point(high, c), point(low, d)];
          const normal = coords(D.surface_normal(surface, real(middle))).map(v => v * sign);
          const add = indices => {
            const selected = indices.map(k => points[k]);
            if (sign < 0) selected.reverse();
            triangles.push({ points: selected, normal });
          };
          if (c - b > numericMm) add([0, 1, 2]);
          if (d - a > numericMm) add([0, 2, 3]);
          chartAreaMm2 += radius * (high - low) * ((d - a) + (c - b)) / 2;
          maxAngularSpanRad = Math.max(maxAngularSpanRad, high - low);
          maxChordalErrorBoundMm = Math.max(maxChordalErrorBoundMm, inputBound +
            (radius + Math.max(lower.amplitude, upper.amplitude)) * (high - low) ** 2 / 8);
          if (triangles.length > 32768) fail('triangle budget exceeded');
        }
      }
      if (!triangles.length || !(chartAreaMm2 > 0)) fail('no bounded display region');
      return { triangles, displayTessellation: {
        method: 'periodic-cylinder-strips', approximate: true, toleranceMm,
        angularColumns: columns.length - 1, physicalBoundaryEdges: boundary.length,
        seamEdges: [...new Set(uses.filter(use => !boundary.some(b => b.index === use.index)).map(use => use.index))],
        chartAreaMm2, maxAngularSpanRad, maxChordalErrorBoundMm,
        maxBoundaryProjectionBoundMm: projectionBound, maxVertexRadialResidualMm: maxVertexResidual,
        maxEndpointGapMm: endpointGap,
        eventCoalescingBoundMm: eventError, inputGapBudgetMm: gapBudget,
      } };
    };
  };
}
