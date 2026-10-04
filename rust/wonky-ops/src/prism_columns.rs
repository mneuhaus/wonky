//! Exact axial columns on an extruded profile: an ordered sequence of union and
//! difference operations with coordinate-axis cylinders parallel to the profile
//! axis. Pins standing on or sunk into a plate, bosses, buried caps, pins
//! through both caps and bores through bosses are all the same arrangement.
//!
//! Cylinders with the exact same centre form one column. Different columns are
//! strictly separated and every column lies strictly inside the profile, so
//! each radial band of a column carries an exact set of axial intervals. Those
//! sets come from binary64 comparisons of the replayed inputs only; no
//! intersection is ever rounded. Walls, rings, annuli and cap inner loops then
//! follow from the sets. A ring where material swaps sides (non-manifold), a
//! disconnected lump or an enclosed void is a named refusal. Every operand
//! keeps its own construction DAG; replay owns all caches.
use crate::{
    analytic::Solid,
    arc_profile::q,
    cylinder::{self, Cylinder, Spec},
    placement::Placement,
    polyhedron::Refused,
    prism_holes::{self, b, exact_float, Base},
};
use num_rational::BigRational as Q;
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_num::Iv;

pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("prism-columns/{s}"))
}
/// Boolean rule version of the column arrangement root node.
pub(crate) const RULE: u32 = 6;
const UNION: u8 = 0;
const DIFFERENCE: u8 = 1;
const MAX_TOOLS: usize = 64;
/// Sorted, disjoint, non-touching closed intervals of positive length.
type Set = Vec<[f64; 2]>;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Column {
    /// Exact centre in the base source frame; the axis coordinate is zero.
    pub(crate) center: [f64; 3],
    /// Distinct tool radii, ascending. Band j lies between radii[j-1] and radii[j].
    pub(crate) radii: Vec<f64>,
    pub(crate) bands: Vec<Set>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Wall {
    pub(crate) column: usize,
    pub(crate) radius: f64,
    pub(crate) lo: f64,
    pub(crate) hi: f64,
    /// Material inside the wall (outward normal points away from the axis).
    pub(crate) forward: bool,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Flat {
    pub(crate) column: usize,
    pub(crate) level: f64,
    /// Material below the face (outward normal along +axis).
    pub(crate) up: bool,
    pub(crate) outer: f64,
    pub(crate) inner: Option<f64>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CapRing {
    /// 0 = bottom cap, 1 = top cap of the base profile.
    pub(crate) side: usize,
    pub(crate) column: usize,
    pub(crate) radius: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Plan {
    pub(crate) axis: usize,
    pub(crate) levels: [f64; 2],
    pub(crate) columns: Vec<Column>,
    pub(crate) walls: Vec<Wall>,
    pub(crate) flats: Vec<Flat>,
    pub(crate) rings: Vec<CapRing>,
}
impl Plan {
    fn is_empty(&self) -> bool {
        self.walls.is_empty() && self.flats.is_empty() && self.rings.is_empty()
    }
    /// The generated parts of one column, in body order.
    pub(crate) fn parts(&self, column: usize) -> (Vec<Wall>, Vec<Flat>, Vec<CapRing>) {
        (
            self.walls.iter().filter(|w| w.column == column).copied().collect(),
            self.flats.iter().filter(|f| f.column == column).copied().collect(),
            self.rings.iter().filter(|r| r.column == column).copied().collect(),
        )
    }
}

#[derive(Clone, Debug)]
pub struct Columns {
    pub body: Body,
    pub base: Base,
    /// Replayed source tools with their operation (0 union, 1 difference).
    pub(crate) tools: Vec<(u8, Cylinder)>,
    pub(crate) plan: Plan,
    /// Base cap faces [bottom, top].
    pub(crate) caps: [usize; 2],
}

fn union(set: &[[f64; 2]], t: [f64; 2]) -> Set {
    let mut out = vec![];
    let mut cur = t;
    for &s in set {
        if s[1] < cur[0] || cur[1] < s[0] {
            out.push(s)
        } else {
            cur = [cur[0].min(s[0]), cur[1].max(s[1])]
        }
    }
    out.push(cur);
    out.sort_by(|a, b| a[0].total_cmp(&b[0]));
    out
}
fn difference(set: &[[f64; 2]], t: [f64; 2]) -> Set {
    let mut out = vec![];
    for &s in set {
        if s[1] <= t[0] || t[1] <= s[0] {
            out.push(s);
            continue;
        }
        if s[0] < t[0] {
            out.push([s[0], t[0]])
        }
        if t[1] < s[1] {
            out.push([t[1], s[1]])
        }
    }
    out
}
fn covers(set: &[[f64; 2]], lo: f64, hi: f64) -> bool {
    set.iter().any(|s| s[0] <= lo && hi <= s[1])
}
fn breaks(sets: &[&[[f64; 2]]]) -> Vec<f64> {
    let mut out = sets
        .iter()
        .flat_map(|s| s.iter().flat_map(|i| [i[0], i[1]]))
        .collect::<Vec<_>>();
    out.sort_by(f64::total_cmp);
    out.dedup();
    out
}
/// +1 material below and none above `z`, -1 the reverse, 0 no change.
fn transition(set: &[[f64; 2]], z: f64) -> i8 {
    let below = set.iter().any(|s| s[0] < z && z <= s[1]);
    let above = set.iter().any(|s| s[0] <= z && z < s[1]);
    below as i8 - above as i8
}
fn key(x: f64) -> u64 {
    (x + 0.).to_bits()
}

/// Exact layered arrangement of `tools` (already in the base source frame).
pub(crate) fn plan(base: &Base, tools: &[(u8, Spec)]) -> R<Plan> {
    let (axis, levels) = base.axis_levels()?;
    if !(levels[0] < levels[1]) {
        return Err(no("target-levels"));
    }
    let profile = base.profile().ok_or_else(|| no("target-carrier"))?;
    let (j1, j2) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut centers: Vec<[f64; 3]> = vec![];
    let mut member = vec![];
    for (op, s) in tools {
        if *op > DIFFERENCE {
            return Err(no("operation"));
        }
        if s.axis()? != axis || s.bottom[axis] >= s.top[axis] {
            return Err(no("non-axial-tool"));
        }
        let mut c = s.bottom;
        c[axis] = 0.;
        let at = match centers.iter().position(|d| d[j1] == c[j1] && d[j2] == c[j2]) {
            Some(i) => i,
            None => {
                centers.push(c);
                centers.len() - 1
            }
        };
        member.push(at);
    }
    let outer = (0..centers.len())
        .map(|c| {
            tools
                .iter()
                .zip(&member)
                .filter(|(_, m)| **m == c)
                .map(|(t, _)| t.1.radius)
                .fold(0., f64::max)
        })
        .collect::<Vec<_>>();
    let disk = |c: usize| {
        let mut top = centers[c];
        top[axis] = 1.;
        Spec { bottom: centers[c], top, radius: outer[c] }
    };
    for a in 0..centers.len() {
        for other in a + 1..centers.len() {
            if cylinder::radial_relation(disk(a), disk(other))? <= 0 {
                return Err(no("columns-contact-or-overlap"));
            }
        }
        let p = [q(centers[a][j1]), q(centers[a][j2])];
        let r = q(outer[a]);
        let r2 = &r * &r;
        if !profile.contains(&wonky_curve::ExactPoint::from_rational(p.clone()))?
            || !profile.profile.clears_disc(&p, &r2)?
        {
            // Unions that all float strictly off the profile levels never meet
            // the profile, wherever they lie in plan: a separate lump.
            let unions = tools
                .iter()
                .zip(&member)
                .filter(|((op, _), m)| **m == a && *op == UNION)
                .map(|((_, s), _)| [s.bottom[axis], s.top[axis]])
                .collect::<Vec<_>>();
            if !unions.is_empty() && unions.iter().all(|t| t[1] < levels[0] || t[0] > levels[1]) {
                return Err(no("disconnected-or-void"));
            }
            return Err(no("side-contact-or-crossing"));
        }
    }
    let base_set: Set = vec![levels];
    let mut columns = vec![];
    for (c, center) in centers.iter().enumerate() {
        let mut radii = tools
            .iter()
            .zip(&member)
            .filter(|(_, m)| **m == c)
            .map(|(t, _)| t.1.radius)
            .collect::<Vec<_>>();
        radii.sort_by(f64::total_cmp);
        radii.dedup();
        let mut bands = vec![base_set.clone(); radii.len()];
        for ((op, s), m) in tools.iter().zip(&member) {
            if *m != c {
                continue;
            }
            let t = [s.bottom[axis], s.top[axis]];
            for (j, band) in bands.iter_mut().enumerate() {
                if radii[j] <= s.radius {
                    *band = if *op == UNION { union(band, t) } else { difference(band, t) };
                }
            }
        }
        columns.push(Column { center: *center, radii, bands });
    }
    let mut walls = vec![];
    let mut flats = vec![];
    let mut rings = vec![];
    for (ci, col) in columns.iter().enumerate() {
        let n = col.radii.len();
        for j in 0..n {
            let inside = &col.bands[j];
            let outside = if j + 1 < n { &col.bands[j + 1] } else { &base_set };
            let mut last: Option<Wall> = None;
            for w in breaks(&[inside.as_slice(), outside.as_slice()]).windows(2) {
                let (lo, hi) = (w[0], w[1]);
                let (a, c) = (covers(inside, lo, hi), covers(outside, lo, hi));
                if a == c {
                    walls.extend(last.take());
                    continue;
                }
                if last.is_some_and(|p| p.hi == lo) {
                    let p = last.as_mut().ok_or_else(|| no("wall-state"))?;
                    if p.forward != a {
                        // Material swaps sides across one ring: four faces meet.
                        return Err(Refused::geometric_verdict(no("non-manifold-ring").0));
                    }
                    p.hi = hi;
                } else {
                    walls.extend(last.replace(Wall { column: ci, radius: col.radii[j], lo, hi, forward: a }));
                }
            }
            walls.extend(last);
        }
        let mut sets = col.bands.iter().map(|s| s.as_slice()).collect::<Vec<_>>();
        sets.push(&base_set);
        for z in breaks(&sets) {
            let tb = transition(&base_set, z);
            let tr = col.bands.iter().map(|s| transition(s, z)).collect::<Vec<_>>();
            let mut j = n;
            while j > 0 {
                let hi = j - 1;
                if tr[hi] == 0 {
                    j -= 1;
                    continue;
                }
                let mut lo = hi;
                while lo > 0 && tr[lo - 1] == tr[hi] {
                    lo -= 1;
                }
                let inner = if lo > 0 { Some(col.radii[lo - 1]) } else { None };
                if hi == n - 1 && tr[hi] == tb {
                    // Continues the base cap face into the column.
                    rings.extend(inner.map(|radius| CapRing { side: usize::from(tb > 0), column: ci, radius }));
                } else {
                    flats.push(Flat { column: ci, level: z, up: tr[hi] > 0, outer: col.radii[hi], inner });
                }
                j = lo;
            }
            if tb != 0 && tr[n - 1] != tb {
                rings.push(CapRing { side: usize::from(tb > 0), column: ci, radius: col.radii[n - 1] });
            }
        }
    }
    // Independent incidence check: every wall end is exactly one ring, and
    // every ring is claimed by exactly one planar face loop.
    let mut ends: BTreeMap<(usize, u64, u64), i32> = BTreeMap::new();
    for w in &walls {
        for z in [w.lo, w.hi] {
            let e = ends.entry((w.column, key(w.radius), key(z))).or_default();
            if *e != 0 {
                return Err(no("ring-incidence"));
            }
            *e = 1;
        }
    }
    for (column, radius, z) in flats
        .iter()
        .flat_map(|f| std::iter::once(f.outer).chain(f.inner).map(move |r| (f.column, r, f.level)))
        .chain(rings.iter().map(|c| (c.column, c.radius, levels[c.side])))
    {
        *ends.entry((column, key(radius), key(z))).or_default() -= 1;
    }
    if ends.values().any(|&v| v != 0) {
        return Err(no("ring-incidence"));
    }
    Ok(Plan { axis, levels, columns, walls, flats, rings })
}

fn dom() -> Domain {
    Domain {
        lower: Limit::Finite { value: Binary64::new(0.).unwrap(), closed: true },
        upper: Limit::Finite { value: Binary64::new(1.).unwrap(), closed: true },
    }
}
fn v3(p: [f64; 3]) -> R<Vector3> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn v2(p: [f64; 2]) -> R<Vector2> {
    Ok([b(p[0])?, b(p[1])?])
}
fn unit(k: usize) -> [f64; 3] {
    let mut e = [0.; 3];
    e[k] = 1.;
    e
}
fn at(c: [f64; 3], k: usize, z: f64) -> [f64; 3] {
    let mut p = c;
    p[k] = z;
    p
}
fn use_edge(body: &mut Body, edge: EdgeId, surface: SurfaceId, forward: bool, geometry: PcurveGeometry) -> CoedgeId {
    let curve = body.edges[edge.0 as usize].curve;
    let pcurve = PcurveId(body.pcurves.len() as u32);
    body.pcurves.push(Pcurve { curve, surface, domain: dom(), geometry });
    body.curves[curve.0 as usize].supports.push(Support { surface, pcurve });
    body.coedges.push(Coedge { edge, forward, pcurve });
    CoedgeId(body.coedges.len() as u32 - 1)
}
fn add_face(body: &mut Body, surface: SurfaceId, forward: bool, loops: Vec<(bool, Vec<CoedgeId>)>) {
    let mut ids = vec![];
    for (outer, coedges) in loops {
        ids.push(LoopId(body.loops.len() as u32));
        body.loops.push(Loop { outer, coedges });
    }
    body.shells[0].faces.push(FaceId(body.faces.len() as u32));
    body.faces.push(Face { surface, forward, loops: ids });
}
/// A column ring in the chart of a base cap plane (exact binary64 or refused).
fn cap_circle(body: &Body, surface: SurfaceId, center: [f64; 3], radius: f64, k: usize) -> R<PcurveGeometry> {
    let SurfaceGeometry::Plane { origin, normal, x } = &body.surfaces[surface.0 as usize].geometry else {
        return Err(no("cap-carrier"));
    };
    let get = |p: &Vector3| p.each_ref().map(|v| q(v.get()));
    let (o, n, x) = (get(origin), get(normal), get(x));
    let y = wonky_geom::cross(&n, &x);
    if wonky_geom::dot(&x, &x) != q(1.) || wonky_geom::dot(&y, &y) != q(1.) {
        return Err(no("cap-chart"));
    }
    let delta: [Q; 3] = std::array::from_fn(|j| q(center[j]) - &o[j]);
    Ok(PcurveGeometry::Circle {
        origin: [b(exact_float(&wonky_geom::dot(&delta, &x))?)?, b(exact_float(&wonky_geom::dot(&delta, &y))?)?],
        radius: b(radius)?,
        clockwise: normal[k].get() < 0.,
    })
}

/// The base body with every column sewn in: seamed walls, closed rings with
/// one seam vertex each (stored in a per-column translated chart), new planar
/// annuli/discs, and inner loops on the base caps.
pub(crate) fn assemble(key_: BodyKey, base: &Base, plan: &Plan, frames: Vec<Frame>, nodes: Vec<Construction>) -> R<Body> {
    let (k, levels) = (plan.axis, plan.levels);
    let caps = prism_holes::base_caps(base)?;
    let mut body = base.body().clone();
    body.key = key_;
    body.frames = frames;
    body.constructions = nodes;
    let prov = Provenance::Construction { node: NodeId(body.constructions.len() as u32 - 1) };
    let (z, x) = (unit(k), unit((k + 1) % 3));
    let seam = |r: f64, h: f64| {
        let mut p = [0.; 3];
        p[(k + 1) % 3] = r;
        p[k] = h;
        p
    };
    let line = |a: [f64; 2], c: [f64; 2]| -> R<PcurveGeometry> { Ok(PcurveGeometry::Line { a: v2(a)?, b: v2(c)? }) };
    for (ci, col) in plan.columns.iter().enumerate() {
        let (walls, flats, caprings) = plan.parts(ci);
        if walls.is_empty() && flats.is_empty() && caprings.is_empty() {
            continue;
        }
        let chart = FrameId(body.frames.len() as u32);
        body.frames.push(Frame::Rigid { parent: FrameId(1), translation: v3(col.center)?, axis: v3(z)?, angle: b(0.)? });
        let mut ring: BTreeMap<(u64, u64), EdgeId> = BTreeMap::new();
        for w in &walls {
            for h in [w.lo, w.hi] {
                if ring.contains_key(&(key(w.radius), key(h))) {
                    return Err(no("ring-incidence"));
                }
                let vertex = VertexId(body.vertices.len() as u32);
                body.vertices.push(Vertex { point: v3(seam(w.radius, h))?, frame: chart, provenance: Provenance::None {} });
                let curve = CurveId(body.curves.len() as u32);
                body.curves.push(Curve {
                    frame: FrameId(1),
                    provenance: prov.clone(),
                    geometry: CurveGeometry::Circle {
                        origin: v3(at(col.center, k, h))?,
                        normal: v3(z)?,
                        x: v3(x)?,
                        radius: b(w.radius)?,
                        arc: ArcKind::Full {},
                    },
                    domain: dom(),
                    supports: vec![],
                });
                ring.insert((key(w.radius), key(h)), EdgeId(body.edges.len() as u32));
                body.edges.push(Edge { curve, domain: dom(), vertices: vec![vertex; 2] });
            }
        }
        let get = |r: f64, h: f64| ring.get(&(key(r), key(h))).copied().ok_or_else(|| no("ring-incidence"));
        for w in &walls {
            let (lo, hi) = (get(w.radius, w.lo)?, get(w.radius, w.hi)?);
            let surface = SurfaceId(body.surfaces.len() as u32);
            body.surfaces.push(Surface {
                frame: FrameId(1),
                provenance: prov.clone(),
                geometry: SurfaceGeometry::Cylinder { origin: v3(col.center)?, axis: v3(z)?, x: v3(x)?, radius: b(w.radius)? },
            });
            let curve = CurveId(body.curves.len() as u32);
            body.curves.push(Curve {
                frame: chart,
                provenance: Provenance::None {},
                geometry: CurveGeometry::Line { a: v3(seam(w.radius, w.lo))?, b: v3(seam(w.radius, w.hi))? },
                domain: dom(),
                supports: vec![],
            });
            let vertices = vec![body.edges[lo.0 as usize].vertices[0], body.edges[hi.0 as usize].vertices[0]];
            let edge = EdgeId(body.edges.len() as u32);
            body.edges.push(Edge { curve, domain: dom(), vertices });
            // Same chart and coedge senses as the cylinder primitive; an
            // inward wall is the reversed loop with every sense flipped.
            let coedges = if w.forward {
                vec![
                    use_edge(&mut body, lo, surface, true, line([0., w.lo], [1., w.lo])?),
                    use_edge(&mut body, edge, surface, true, line([1., w.lo], [1., w.hi])?),
                    use_edge(&mut body, hi, surface, false, line([0., w.hi], [1., w.hi])?),
                    use_edge(&mut body, edge, surface, false, line([0., w.lo], [0., w.hi])?),
                ]
            } else {
                vec![
                    use_edge(&mut body, edge, surface, true, line([0., w.lo], [0., w.hi])?),
                    use_edge(&mut body, hi, surface, true, line([0., w.hi], [1., w.hi])?),
                    use_edge(&mut body, edge, surface, false, line([1., w.lo], [1., w.hi])?),
                    use_edge(&mut body, lo, surface, false, line([0., w.lo], [1., w.lo])?),
                ]
            };
            add_face(&mut body, surface, w.forward, vec![(true, coedges)]);
        }
        for f in &flats {
            let surface = SurfaceId(body.surfaces.len() as u32);
            body.surfaces.push(Surface {
                frame: FrameId(1),
                provenance: prov.clone(),
                geometry: SurfaceGeometry::Plane {
                    origin: v3(at(col.center, k, f.level))?,
                    normal: v3(if f.up { z } else { z.map(|c| -c) })?,
                    x: v3(x)?,
                },
            });
            let circle = |r: f64| -> R<PcurveGeometry> {
                Ok(PcurveGeometry::Circle { origin: v2([0., 0.])?, radius: b(r)?, clockwise: !f.up })
            };
            let outer = use_edge(&mut body, get(f.outer, f.level)?, surface, f.up, circle(f.outer)?);
            let mut loops = vec![(true, vec![outer])];
            if let Some(r) = f.inner {
                loops.push((false, vec![use_edge(&mut body, get(r, f.level)?, surface, !f.up, circle(r)?)]));
            }
            add_face(&mut body, surface, true, loops);
        }
        for c in &caprings {
            let face = caps[c.side];
            let surface = body.faces[face].surface;
            let level = levels[c.side];
            let geometry = cap_circle(&body, surface, at(col.center, k, level), c.radius, k)?;
            // An inner loop winds clockwise about the outward normal.
            let coedge = use_edge(&mut body, get(c.radius, level)?, surface, c.side == 0, geometry);
            body.faces[face].loops.push(LoopId(body.loops.len() as u32));
            body.loops.push(Loop { outer: false, coedges: vec![coedge] });
        }
    }
    body.clone().check().map_err(|e| no(&format!("contract:{e:?}")))?;
    // Independent local manifold check: every edge has two opposite uses.
    let mut uses = vec![vec![]; body.edges.len()];
    for c in &body.coedges {
        uses[c.edge.0 as usize].push(c.forward);
    }
    if uses.iter().any(|u| u.len() != 2 || u[0] == u[1]) {
        return Err(Refused::geometric_verdict(no("non-manifold-result").0));
    }
    if !connected(&body) {
        return Err(no("disconnected-or-void"));
    }
    Ok(body)
}
/// One face-connected shell: a floating lump or an enclosed void would form
/// a second component.
fn connected(body: &Body) -> bool {
    fn find(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    let n = body.faces.len();
    let mut parent = (0..n).collect::<Vec<_>>();
    let mut owner = vec![usize::MAX; body.edges.len()];
    for (f, face) in body.faces.iter().enumerate() {
        for l in &face.loops {
            for c in &body.loops[l.0 as usize].coedges {
                let e = body.coedges[c.0 as usize].edge.0 as usize;
                if owner[e] == usize::MAX {
                    owner[e] = f;
                } else {
                    let (a, b) = (find(&mut parent, owner[e]), find(&mut parent, f));
                    parent[a] = b;
                }
            }
        }
    }
    let root = find(&mut parent, 0);
    (0..n).all(|f| find(&mut parent, f) == root)
}

fn graft(base: &Base, tools: &[(u8, Cylinder)]) -> R<(Vec<Frame>, Vec<Construction>)> {
    let operands = tools.iter().map(|(_, c)| Base::Cylinder(c.clone())).collect::<Vec<_>>();
    let (frames, mut nodes, parents, mut parameters) = prism_holes::graft_sources(base, &operands)?;
    for (op, _) in tools {
        parameters.push(b(*op as f64)?);
    }
    nodes.push(Construction { operation: Operation::Boolean {}, rule_version: RULE, parents, parameters, frame: FrameId(1) });
    Ok((frames, nodes))
}
fn target(base: &Base) -> R<()> {
    match base {
        Base::Planar(a) if a.orthogonal.as_ref().is_none_or(|c| c.boxes.len() == 1) => {
            base.kind()?;
            Ok(())
        }
        Base::Planar(_) => Err(no("multi-cell-target")),
        Base::Cylinder(_) => Err(no("cylinder-target")),
        Base::Revolved(_) => Err(no("target-carrier")),
    }
}
fn arrange(base: &Base, tools: &[(u8, Cylinder)]) -> R<Plan> {
    target(base)?;
    if tools.is_empty() || tools.len() > MAX_TOOLS {
        return Err(no("tool-count"));
    }
    // A cutter is clipped to the material envelope of the base and the
    // preceding unions; a union tool's own extent is the geometry.
    let (k, mut envelope) = base.axis_levels()?;
    let mut specs = vec![];
    for (op, c) in tools {
        let spec = if *op == DIFFERENCE {
            prism_holes::related_clipped(c, base.frame(), k, envelope)?
        } else {
            Some(prism_holes::related(c, base.frame())?)
        };
        let Some(spec) = spec else { continue };
        if *op == UNION && spec.axis()? == k {
            envelope = [envelope[0].min(spec.bottom[k]), envelope[1].max(spec.top[k])];
        }
        specs.push((*op, spec));
    }
    plan(base, &specs)
}
/// Whether the column arrangement owns this Boolean: any operand is already a
/// column arrangement, or a union joins one planar profile with cylinders.
pub(crate) fn owns(op: u8, bodies: &[Solid]) -> bool {
    bodies.iter().any(|s| matches!(s, Solid::Columns(_)))
        || (op == UNION
            && bodies.iter().any(|s| matches!(s, Solid::Planar(_)))
            && bodies.iter().any(|s| matches!(s, Solid::Cylinder(_)))
            && bodies.iter().all(|s| matches!(s, Solid::Planar(_) | Solid::Cylinder(_))))
}
/// `target op tools`. A column arrangement operand is flattened into its
/// replayed sources, so a further union or difference is arranged once:
/// ((A op1 B) op2 C) keeps the operation order of its cylinders.
pub(crate) fn boolean(key_: BodyKey, op: u8, bodies: &[Solid]) -> R<Body> {
    if op > DIFFERENCE || bodies.len() < 2 {
        return Err(no("operation"));
    }
    let targets = bodies
        .iter()
        .enumerate()
        .filter(|(_, s)| !matches!(s, Solid::Cylinder(_)))
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    // One profile (or column arrangement) target; only cylinders are tools.
    let [ti] = targets.as_slice() else {
        return Err(no("profile-tool-unimplemented"));
    };
    if op == DIFFERENCE && *ti != 0 {
        return Err(no("profile-tool-unimplemented"));
    }
    let (base, mut tools) = match &bodies[*ti] {
        Solid::Planar(a) => (Base::Planar(a.clone()), vec![]),
        Solid::Columns(c) => (c.base.clone(), c.tools.clone()),
        _ => return Err(no("target-carrier")),
    };
    for (i, s) in bodies.iter().enumerate() {
        if let Solid::Cylinder(c) = s {
            if i != *ti {
                tools.push((op, c.clone()));
            }
        }
    }
    let plan = arrange(&base, &tools)?;
    if plan.is_empty() {
        // Every tool is buried in, or removed only from, empty space: the
        // result is the unchanged profile solid.
        return Ok(base.body().clone());
    }
    let (frames, nodes) = graft(&base, &tools)?;
    assemble(key_, &base, &plan, frames, nodes)
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions
        .last()
        .is_some_and(|n| n.operation == Operation::Boolean {} && n.rule_version == RULE)
}
pub fn audit(checked: &CheckedBody) -> R<Columns> {
    let body = checked.body();
    let root = body.constructions.last().ok_or_else(|| no("construction"))?;
    let n = root.parents.len();
    if !candidate(body) || root.frame != FrameId(1) || n < 2 || n > MAX_TOOLS + 1 || root.parameters.len() != n * 4 - 1 {
        return Err(no("construction"));
    }
    let (descriptors, ops) = root.parameters.split_at(n * 3);
    let (mut operands, frame_at) = prism_holes::ungraft(body, descriptors, &root.parents)?;
    let base = operands.remove(0);
    let tools = operands
        .into_iter()
        .zip(ops)
        .map(|(o, op)| match (o, op.get()) {
            (Base::Cylinder(c), x) if x == 0. || x == 1. => Ok((x as u8, c)),
            _ => Err(no("construction")),
        })
        .collect::<R<Vec<_>>>()?;
    let plan = arrange(&base, &tools)?;
    if plan.is_empty() {
        return Err(no("no-column"));
    }
    let expected = assemble(body.key.clone(), &base, &plan, body.frames[..frame_at].to_vec(), body.constructions.clone())?;
    if *body != expected {
        return Err(no("construction-carrier-mismatch"));
    }
    let caps = prism_holes::base_caps(&base)?;
    Ok(Columns { body: body.clone(), base, tools, plan, caps })
}

fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn finite(x: Iv) -> R<Iv> {
    cylinder::finite(x).map_err(|_| no("observation-range"))
}
impl Columns {
    fn frame(&self) -> &Placement {
        self.base.frame()
    }
    fn scale(&self) -> R<Iv> {
        let d = self.frame().orthonormality_defect().map_err(|_| no("frame-range"))?;
        if d > 1e-9 {
            return Err(no("non-near-rigid-frame"));
        }
        Ok(Iv { m: 1., r: (3. * d).next_up() })
    }
    /// Volume (mm³), area (mm²), per-face areas and perimeters in body face
    /// order, centroid (world mm). Bands are exact annuli times exact interval
    /// lengths; π is the only enclosed transcendental.
    pub(crate) fn measures(&self) -> R<(Iv, Iv, Vec<f64>, Vec<f64>, [f64; 3])> {
        let (axis, levels) = (self.plan.axis, self.plan.levels);
        let pi = crate::analytic_pi::pi();
        let scale = self.scale()?;
        let (mut volume, mut moment, mut areas, mut perimeters) =
            crate::prism_holes_observe::base_measures(&self.base, axis, levels, scale)?;
        let height = i(levels[1]) - i(levels[0]);
        let first = (i(levels[1]) * i(levels[1]) - i(levels[0]) * i(levels[0])) / i(2.);
        for col in &self.plan.columns {
            let mut inner = i(0.);
            for (j, band) in col.bands.iter().enumerate() {
                let r = i(col.radii[j]);
                let area = pi * (r * r - inner * inner);
                inner = r;
                let len = band.iter().fold(i(0.), |a, s| a + (i(s[1]) - i(s[0])));
                let zm = band.iter().fold(i(0.), |a, s| a + (i(s[1]) * i(s[1]) - i(s[0]) * i(s[0])) / i(2.));
                let dv = area * (len - height);
                volume = volume + dv;
                moment[axis] = moment[axis] + area * (zm - first);
                for kk in [(axis + 1) % 3, (axis + 2) % 3] {
                    moment[kk] = moment[kk] + dv * i(col.center[kk]);
                }
            }
        }
        let (mm, mm2) = (scale * i(1000.), scale * i(1e6));
        for c in &self.plan.rings {
            let r = i(c.radius);
            areas[self.caps[c.side]] = areas[self.caps[c.side]] - pi * r * r * mm2;
            perimeters[self.caps[c.side]] = perimeters[self.caps[c.side]] + i(2.) * pi * r * mm;
        }
        for ci in 0..self.plan.columns.len() {
            let (walls, flats, _) = self.plan.parts(ci);
            for w in walls {
                let (ring, h) = (i(2.) * pi * i(w.radius), i(w.hi) - i(w.lo));
                areas.push(ring * h * mm2);
                perimeters.push(i(2.) * (ring + h) * mm);
            }
            for f in flats {
                let (ro, ri) = (i(f.outer), i(f.inner.unwrap_or(0.)));
                areas.push(pi * (ro * ro - ri * ri) * mm2);
                perimeters.push(i(2.) * pi * (ro + ri) * mm);
            }
        }
        if areas.len() != self.body.faces.len() {
            return Err(no("observation-face-order"));
        }
        let mut center = [0.; 3];
        for kk in 0..3 {
            center[kk] = finite(moment[kk] / volume)?.m
        }
        let center = self.frame().apply(center, 1000., true).map_err(|_| no("centroid-range"))?;
        let det = cylinder::enclosed(&self.frame().det_exact().map_err(|_| no("frame-range"))?);
        volume = finite(volume * det * i(1e9))?;
        let total = finite(areas.iter().fold(i(0.), |a, &b| a + b))?;
        if volume.lo() <= 0. || volume.r / volume.m > 1e-9 || total.lo() <= 0. || total.r / total.m > 1e-9 {
            return Err(no("observation-width"));
        }
        Ok((volume, total, areas.into_iter().map(|v| v.m).collect(), perimeters.into_iter().map(|v| v.m).collect(), center))
    }
    /// Hull of the base box and every wall's cylinder segment. Inward walls
    /// lie inside the base or inside a wider forward wall of their column.
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let (mut lo, mut hi) = self.base.bbox(map)?;
        let k = self.plan.axis;
        for w in &self.plan.walls {
            let c = self.plan.columns[w.column].center;
            let spec = Spec { bottom: at(c, k, w.lo), top: at(c, k, w.hi), radius: w.radius };
            let (l, h) = cylinder::envelope_mm(self.frame(), spec, map)?;
            for j in 0..3 {
                lo[j] = lo[j].min(l[j]);
                hi[j] = hi[j].max(h[j]);
            }
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.bbox_mm(None)?;
        let mag = lo.into_iter().chain(hi).fold(0_f64, |a, b| a.max(b.abs()));
        Ok((self.base.tolerance()? + 128. * f64::EPSILON * mag).next_up())
    }
    /// Exact closed-set membership in the source frame. A point in the
    /// closure of the solid is inside with distance 0; a point outside gets
    /// the exact distance to the boundary from `outside_distance`
    /// (see `prism_columns_distance.rs`), or a named refusal if that
    /// enclosure cannot be resolved strictly positive.
    pub fn probe(&self, point: [f64; 3]) -> R<(f64, bool, f64)> {
        let p = crate::probe_exact::local_point(self.frame(), point).map_err(no)?;
        let k = self.plan.axis;
        let (j1, j2) = ((k + 1) % 3, (k + 2) % 3);
        let within = |set: &[[f64; 2]]| set.iter().any(|s| q(s[0]) <= p[k] && p[k] <= q(s[1]));
        for col in &self.plan.columns {
            let (du, dv) = (&p[j1] - q(col.center[j1]), &p[j2] - q(col.center[j2]));
            let d2 = &du * &du + &dv * &dv;
            let Some(j) = col.radii.iter().position(|r| d2 <= q(*r) * q(*r)) else {
                continue;
            };
            let on_ring = d2 == q(col.radii[j]) * q(col.radii[j]);
            let outside = if j + 1 < col.radii.len() { col.bands[j + 1].clone() } else { vec![self.plan.levels] };
            if within(&col.bands[j]) || (on_ring && within(&outside)) {
                return Ok((0., true, 0.));
            }
            return self.outside(&p);
        }
        let profile = self.base.profile().ok_or_else(|| no("target-carrier"))?;
        if profile.contains(&wonky_curve::ExactPoint::from_rational([p[j1].clone(), p[j2].clone()]))?
            && within(&[self.plan.levels])
        {
            return Ok((0., true, 0.));
        }
        self.outside(&p)
    }
    /// Distance from a point already known to be outside the closed body.
    fn outside(&self, p: &[Q; 3]) -> R<(f64, bool, f64)> {
        let d = finite(self.outside_distance(p)? * self.scale()? * i(1000.))?;
        if d.lo() <= 0. {
            return Err(no("probe-distance-unresolved"));
        }
        Ok((d.m, false, d.r))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, areas, perimeters, center) = self.measures()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let mapped = if let Some(m) = map {
            let (lo, hi) = self.bbox_mm(Some(m))?;
            format!("{{\"min\":{lo:?},\"max\":{hi:?}}}")
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, inside, b)) => format!("{{\"distanceMm\":{d:?},\"inside\":{inside},\"boundMm\":{b:?}}}"),
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let tolerance = self.tolerance_mm()?;
        crate::prism_holes_observe::report(
            &self.body,
            self.frame(),
            "AxialProfileColumns",
            (volume, area, &areas, &perimeters, center),
            (lo, hi),
            &mapped,
            tolerance,
            &probes,
            0,
        )
    }
}
