//! Booleans of line/arc/polynomial-profile prisms with a common extrusion axis.
//!
//! Operands are arc and polynomial spline extrusions, straight polygon prisms,
//! single boxes and earlier stacks. Their construction frames must map every
//! extrusion axis onto the first operand's axis. Polynomial carriers admit
//! exact rational affine relations (R0-R3); circles require an isometry.
//! Then every plane x cylinder contact is exact in the cylinder's own chart
//! (Rule P): side planes meet cylinders along generators, caps cut them in
//! circles at exact levels. The Boolean uses the shared exact 2D carrier
//! arrangement in the common chart, times a stack of exact levels. Crossing
//! points are exact rational or quadratic vertices; unsupported algebraic
//! contacts refuse by name,
//! coincident boundaries are merged exactly, and material is decided per
//! arrangement cell and slab from exact winding numbers.
//!
//! The result keeps every operand's construction DAG (Boolean rule 5); audit
//! replays those sources and rebuilds the boundary. WC0 coordinates are
//! observation caches of the exact arrangement, never inputs.
use crate::{
    analytic::Solid,
    arc_profile::{self, q},
    placement::Placement,
    polyhedron::Refused,
};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use std::cmp::Ordering;
use std::collections::BTreeSet;
use wonky_contract::*;
use wonky_curve as wc;
use wc::numeric::{dot, sub};
use wc::P;

pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("prism-stack/{s}"))
}
pub(crate) const RULE: u32 = 5;
const MAX_OPERANDS: usize = 64;
const MAX_SEGMENTS: usize = 2048;
const MAX_PIECES: usize = 16384;
pub(crate) use wc::UNBOUNDED;

/// One prism: an exact CCW profile in its own construction chart, extruded
/// along local axis `axes[2]` between two binary64 levels.
#[derive(Clone, Debug)]
pub(crate) struct Leaf {
    pub frame: Placement,
    /// Local axes playing the roles of profile x, profile y and extrusion.
    pub axes: [usize; 3],
    pub profile: wc::Cycle,
    pub levels: [f64; 2],
    /// Full-turn revolve tool: (radius, axial height) meridian polygon about
    /// the local axis `axes[2]` through the local origin; `profile` is empty.
    pub meridian: Option<Vec<[f64; 2]>>,
}
/// Boolean expression over leaves: 0 union, 1 difference, 2 intersection.
#[derive(Clone, Debug)]
pub(crate) enum Expr {
    Leaf(usize),
    Op(u8, Vec<Expr>),
}
impl Expr {
    pub(crate) fn eval(&self, m: &dyn Fn(usize) -> bool) -> bool {
        match self {
            Expr::Leaf(i) => m(*i),
            Expr::Op(0, xs) => xs.iter().any(|x| x.eval(m)),
            Expr::Op(1, xs) => xs[0].eval(m) && !xs[1..].iter().any(|x| x.eval(m)),
            Expr::Op(_, xs) => xs.iter().all(|x| x.eval(m)),
        }
    }
    fn shifted(&self, by: usize) -> Expr {
        match self {
            Expr::Leaf(i) => Expr::Leaf(i + by),
            Expr::Op(op, xs) => Expr::Op(*op, xs.iter().map(|x| x.shifted(by)).collect()),
        }
    }
}

// ------------------------------------------------------------ chart mapping

/// A leaf in the common chart: exact CCW segments and exact levels.
pub(crate) struct Mapped {
    pub profile: wc::Cycle,
    pub levels: [Q; 2],
    /// A revolve tool coaxial with the chart axis (no segments).
    pub disc: Option<Disc>,
}
/// A disc-type solid of revolution in the chart: centre and its radius as a
/// piecewise linear function of the level, `(z0, z1, r0, r1)` with z0 < z1,
/// contiguous and sorted. Radial steps are jumps between pieces.
#[derive(Clone, Debug)]
pub(crate) struct Disc {
    pub c: P,
    pub pieces: Vec<[Q; 4]>,
    pub rmax: Q,
}
/// Source meridian (radius, height) of a disc-type revolve: one axis edge,
/// heights monotone along the rest, radial segments as steps. Returned as
/// (h0, h1, r0, r1) pieces with h0 < h1.
fn disc_meridian(points: &[[f64; 2]]) -> R<Vec<[f64; 4]>> {
    let n = points.len();
    let axis = (0..n)
        .filter(|&i| points[i][0] == 0. && points[(i + 1) % n][0] == 0.)
        .collect::<Vec<_>>();
    let [i] = axis.as_slice() else {
        return Err(no("tool-meridian-not-disc"));
    };
    let chain = (1..=n).map(|k| points[(i + k) % n]).collect::<Vec<_>>();
    let dir = chain[n - 1][1] - chain[0][1];
    if dir == 0. || chain[1..n - 1].iter().any(|p| p[0] <= 0.) {
        return Err(no("tool-meridian-not-disc"));
    }
    let mut pieces = vec![];
    for w in chain.windows(2) {
        let dh = w[1][1] - w[0][1];
        if dh * dir < 0. {
            return Err(no("tool-meridian-not-disc"));
        }
        if dh != 0. {
            pieces.push(if dh > 0. {
                [w[0][1], w[1][1], w[0][0], w[1][0]]
            } else {
                [w[1][1], w[0][1], w[1][0], w[0][0]]
            });
        }
    }
    pieces.sort_by(|a, b| a[0].total_cmp(&b[0]));
    if pieces.is_empty() || pieces.windows(2).any(|w| w[0][1] != w[1][0]) {
        return Err(no("tool-meridian-not-disc"));
    }
    Ok(pieces)
}
fn map_leaf(leaf: &Leaf, chart: &wonky_geom::frame::Frame) -> R<Mapped> {
    let source = crate::construction_geom::frame(&leaf.frame)?;
    let relation = chart.relation_from(&source);
    if relation.require_isometry().is_err() && (leaf.meridian.is_some()
        || leaf.profile.pieces().iter().any(|p| matches!(p.chart(), wc::Chart::Circle(_)))) {
        return Err(no("non-isometric-frame-relation"));
    }
    let o = relation.map.origin();
    let c = relation.map.columns();
    let [ax, ay, az] = leaf.axes.map(|k| &c[k]);
    if !ax[2].is_zero() || !ay[2].is_zero() || !az[0].is_zero() || !az[1].is_zero() {
        return Err(no("non-parallel-extrusion-axes"));
    }
    if let Some(points) = &leaf.meridian {
        // The local origin lies on the revolve axis; the isometry keeps radii.
        let mut pieces = disc_meridian(points)?
            .iter()
            .map(|p| {
                let (z0, z1) = (&o[2] + &az[2] * q(p[0]), &o[2] + &az[2] * q(p[1]));
                if z0 < z1 {
                    [z0, z1, q(p[2]), q(p[3])]
                } else {
                    [z1, z0, q(p[3]), q(p[2])]
                }
            })
            .collect::<Vec<_>>();
        pieces.sort_by(|a, b| a[0].cmp(&b[0]));
        let rmax = pieces.iter().flat_map(|p| [p[2].clone(), p[3].clone()]).max().unwrap();
        let levels = [pieces[0][0].clone(), pieces[pieces.len() - 1][1].clone()];
        return Ok(Mapped {
            profile: wc::Cycle::new(vec![]),
            levels,
            disc: Some(Disc { c: [o[0].clone(), o[1].clone()], pieces, rmax }),
        });
    }
    // Lines and polynomial splines map exactly under R0-R3; circles above
    // retain the historical isometry gate (affine circle images wait for S14).
    let map = wc::PlaneMap::affine(
        [o[0].clone(), o[1].clone()],
        [ax[0].clone(), ax[1].clone()],
        [ay[0].clone(), ay[1].clone()],
    )
    .ok_or_else(|| no("non-isometric-frame-relation"))?;
    let profile = leaf.profile.mapped(&map)?;
    let z = |v: f64| &o[2] + &az[2] * q(v);
    let mut levels = [z(leaf.levels[0]), z(leaf.levels[1])];
    if levels[0] > levels[1] {
        levels.swap(0, 1);
    }
    if levels[0] == levels[1] {
        return Err(no("zero-height-leaf"));
    }
    Ok(Mapped { profile, levels, disc: None })
}

// ------------------------------------------------------------ arrangement

pub(crate) fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// The arrangement itself lives in `wonky_curve`; the prism stack only fixes
/// its work budget.
const BUDGET: wc::Budget = wc::Budget {
    segments: MAX_SEGMENTS,
    pieces: MAX_PIECES,
};
fn arranged(leaves: &[Mapped]) -> R<wc::Arrangement> {
    let profiles = leaves.iter().map(|l| &l.profile).collect::<Vec<_>>();
    let mut arr = wc::arrange(&profiles, BUDGET)?;
    wc::classify(&mut arr, &profiles)?;
    Ok(arr)
}

// ------------------------------------------------------------ stack

/// Exact result description: arrangement, sorted levels, material per
/// (cell, slab).
#[derive(Clone, Debug)]
pub(crate) struct Stack {
    pub arr: wc::Arrangement,
    pub levels: Vec<Q>,
    /// Material of the tool-free expression per (cell, slab).
    pub material: Vec<Vec<bool>>,
    /// Revolve tools subtracted from that material.
    pub tools: Vec<Tool>,
}
/// Planar face of a tool: an annulus between two rings of one level (a
/// counterbore step) or a disc (a blind end). `up`: outward normal +axis.
#[derive(Clone, Debug)]
pub(crate) struct Plate {
    pub outer: usize,
    pub inner: Option<usize>,
    pub up: bool,
}
/// A coaxial revolve tool strictly inside one base cell. It only acts in the
/// slabs where that cell is material (A - T = A - (T n A)); its boundary is
/// rings (level, radius), lateral bands between consecutive rings (cylinder
/// or cone), plates, and rings sewn as inner loops into base caps.
#[derive(Clone, Debug)]
pub(crate) struct Tool {
    pub leaf: usize,
    pub cell: usize,
    pub c: P,
    pub rmax: Q,
    pub rings: Vec<[Q; 2]>,
    pub bands: Vec<[usize; 2]>,
    pub plates: Vec<Plate>,
    /// (ring, base level) inner loops of the base cap of `cell`.
    pub loops: Vec<(usize, usize)>,
    /// Effective runs (lo, hi) and the meridian pieces for probes.
    pub runs: Vec<[Q; 2]>,
    pub pieces: Vec<[Q; 4]>,
}
impl Tool {
    /// Radius at level z just above (`up`) or below it; z within a piece.
    fn radius(&self, z: &Q, up: bool) -> R<Q> {
        let p = self
            .pieces
            .iter()
            .find(|p| if up { &p[0] <= z && z < &p[1] } else { &p[0] < z && z <= &p[1] })
            .ok_or_else(|| no("tool-level"))?;
        Ok(&p[2] + (&p[3] - &p[2]) * (z - &p[0]) / (&p[1] - &p[0]))
    }
    /// Tool membership of a chart point strictly off its boundary: Some(true)
    /// inside the removed region, None on its boundary.
    pub(crate) fn contains(&self, xy: &P, z: &Q) -> Option<bool> {
        let v = sub(xy, &self.c);
        let d2 = dot(&v, &v);
        if d2 > &self.rmax * &self.rmax {
            return Some(false);
        }
        for run in &self.runs {
            if z < &run[0] || z > &run[1] {
                continue;
            }
            if z == &run[0] || z == &run[1] || self.pieces.iter().any(|p| &p[0] == z) {
                return None;
            }
            let r = self.radius(z, true).ok()?;
            return match d2.cmp(&(&r * &r)) {
                Ordering::Less => Some(true),
                Ordering::Equal => None,
                Ordering::Greater => Some(false),
            };
        }
        Some(false)
    }
}
/// Revolve leaves may only be subtracted, directly, in difference chains:
/// then the result is the tool-free expression minus their union.
fn subtracted_only(e: &Expr, tool: &dyn Fn(usize) -> bool) -> bool {
    fn free(e: &Expr, tool: &dyn Fn(usize) -> bool) -> bool {
        match e {
            Expr::Leaf(i) => !tool(*i),
            Expr::Op(_, xs) => xs.iter().all(|x| free(x, tool)),
        }
    }
    match e {
        Expr::Leaf(i) => !tool(*i),
        Expr::Op(1, xs) => {
            subtracted_only(&xs[0], tool)
                && xs[1..].iter().all(|x| matches!(x, Expr::Leaf(i) if tool(*i)) || free(x, tool))
        }
        Expr::Op(_, xs) => xs.iter().all(|x| free(x, tool)),
    }
}
/// A binary64 serialization cache of an exact chart point (never a decision).
pub(crate) fn cache(p: &P) -> R<[f64; 2]> {
    Ok(wc::ExactPoint::from_rational(p.clone()).cache()?)
}
fn place_tool(arr: &wc::Arrangement, levels: &[Q], material: &[Vec<bool>], leaf: usize, disc: &Disc) -> R<Tool> {
    if disc.pieces.iter().any(|p| p[2].is_negative() || p[3].is_negative()) {
        return Err(no("tool-meridian-not-disc"));
    }
    for p in &arr.pieces {
        if !p.seg.misses_disc(&disc.c, &disc.rmax)? {
            return Err(no("tool-crosses-boundary"));
        }
    }
    let centre = wc::ExactPoint::from_rational(disc.c.clone());
    let mut cell = None;
    for k in 0..arr.cells.len() {
        let mut winding = 0;
        for c in &arr.cells[k].cycles {
            winding += arr.cycle_profile(c).winding(&centre)?;
        }
        if winding != 0 {
            cell = Some(k);
            break;
        }
    }
    let cell = cell.ok_or_else(|| no("tool-misses-target"))?;
    let (lo, hi) = (&disc.pieces[0][0], &disc.pieces[disc.pieces.len() - 1][1]);
    // Effective runs: the tool within slabs where its cell is material.
    let mut runs: Vec<[Q; 2]> = vec![];
    for j in 0..levels.len() - 1 {
        if !material[cell][j] {
            continue;
        }
        let a = if &levels[j] > lo { levels[j].clone() } else { lo.clone() };
        let b = if &levels[j + 1] < hi { levels[j + 1].clone() } else { hi.clone() };
        if a >= b {
            continue;
        }
        match runs.last_mut() {
            Some(last) if last[1] == a => last[1] = b,
            _ => runs.push([a, b]),
        }
    }
    if runs.is_empty() {
        return Err(no("tool-removes-nothing"));
    }
    let mut tool = Tool {
        leaf,
        cell,
        c: disc.c.clone(),
        rmax: disc.rmax.clone(),
        rings: vec![],
        bands: vec![],
        plates: vec![],
        loops: vec![],
        runs: runs.clone(),
        pieces: disc.pieces.clone(),
    };
    let ring = |t: &mut Tool, z: &Q, up: bool| -> R<usize> {
        let r = t.radius(z, up)?;
        if !r.is_positive() {
            return Err(no("tool-apex"));
        }
        let key = [z.clone(), r];
        Ok(match t.rings.iter().position(|x| *x == key) {
            Some(i) => i,
            None => {
                t.rings.push(key);
                t.rings.len() - 1
            }
        })
    };
    let level = |z: &Q| levels.iter().position(|l| l == z);
    for [a, b] in &runs {
        let mut breaks = vec![a.clone()];
        breaks.extend(disc.pieces.iter().map(|p| p[0].clone()).filter(|z| z > a && z < b));
        breaks.push(b.clone());
        // Run ends: a base cap of the cell (inner loop) or a blind plate.
        let bottom_ring = ring(&mut tool, a, true)?;
        let top_ring = ring(&mut tool, b, false)?;
        let cap = |z: &Q| level(z).filter(|&j| {
            let below = j > 0 && material[cell][j - 1];
            let above = j < material[cell].len() && material[cell][j];
            below != above
        });
        match cap(a) {
            Some(j) => tool.loops.push((bottom_ring, j)),
            None => tool.plates.push(Plate { outer: bottom_ring, inner: None, up: true }),
        }
        match cap(b) {
            Some(j) => tool.loops.push((top_ring, j)),
            None => tool.plates.push(Plate { outer: top_ring, inner: None, up: false }),
        }
        let mut last = bottom_ring;
        for w in breaks.windows(2) {
            let below = ring(&mut tool, &w[1], false)?;
            tool.bands.push([last, below]);
            if w[1] == *b {
                break;
            }
            let above = ring(&mut tool, &w[1], true)?;
            if above != below {
                let (rb, ra) = (tool.rings[below][1].clone(), tool.rings[above][1].clone());
                tool.plates.push(if rb < ra {
                    Plate { outer: above, inner: Some(below), up: true }
                } else {
                    Plate { outer: below, inner: Some(above), up: false }
                });
            }
            last = above;
        }
    }
    if tool.loops.is_empty() {
        return Err(no("enclosed-tool-void"));
    }
    Ok(tool)
}
impl Stack {
    pub(crate) fn slabs(&self) -> usize {
        self.levels.len() - 1
    }
    pub(crate) fn at(&self, cell: usize, slab: isize) -> bool {
        cell != UNBOUNDED
            && slab >= 0
            && (slab as usize) < self.slabs()
            && self.material[cell][slab as usize]
    }
    pub(crate) fn new(leaves: &[Mapped], expr: &Expr) -> R<Self> {
        let is_tool = |i: usize| leaves[i].disc.is_some();
        if !subtracted_only(expr, &is_tool) {
            return Err(no("revolve-leaf-outside-difference"));
        }
        let arr = arranged(leaves)?;
        let levels = leaves
            .iter()
            .filter(|l| l.disc.is_none())
            .flat_map(|l| l.levels.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let material = arr
            .cells
            .iter()
            .map(|cell| {
                (0..levels.len() - 1)
                    .map(|j| {
                        expr.eval(&|i| {
                            cell.inside[i]
                                && leaves[i].levels[0] <= levels[j]
                                && levels[j + 1] <= leaves[i].levels[1]
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        if material.iter().all(|m| m.iter().all(|x| !x)) {
            return Err(Refused::geometric_verdict(no("empty-result").0));
        }
        let mut tools = vec![];
        for (i, leaf) in leaves.iter().enumerate() {
            if let Some(disc) = &leaf.disc {
                tools.push(place_tool(&arr, &levels, &material, i, disc)?);
            }
        }
        // Pairwise disjoint tools act independently (no shared rings/plates).
        for (i, a) in tools.iter().enumerate() {
            for b in &tools[i + 1..] {
                let (la, lb) = (&leaves[a.leaf].levels, &leaves[b.leaf].levels);
                let overlap = la[0] <= lb[1] && lb[0] <= la[1];
                let d = sub(&a.c, &b.c);
                let reach = &a.rmax + &b.rmax;
                if overlap && dot(&d, &d) <= &reach * &reach {
                    return Err(no("tool-overlap"));
                }
            }
        }
        let stack = Self {
            arr,
            levels,
            material,
            tools,
        };
        stack.connected()?;
        Ok(stack)
    }
    /// Material (cell, slab) prisms connected through shared side or cap area.
    fn connected(&self) -> R<()> {
        let m = self.slabs();
        let id = |k: usize, j: usize| k * m + j;
        let mut parent = (0..self.arr.cells.len() * m).collect::<Vec<_>>();
        fn join(parent: &mut [usize], a: usize, b: usize) {
            let (a, b) = (find(parent, a), find(parent, b));
            parent[a] = b;
        }
        for k in 0..self.arr.cells.len() {
            for j in 0..m {
                if j + 1 < m && self.material[k][j] && self.material[k][j + 1] {
                    join(&mut parent, id(k, j), id(k, j + 1));
                }
            }
        }
        for e in 0..self.arr.pieces.len() {
            let (l, r) = (self.arr.face[2 * e], self.arr.face[2 * e + 1]);
            if l == UNBOUNDED || r == UNBOUNDED {
                continue;
            }
            for j in 0..m {
                if self.material[l][j] && self.material[r][j] {
                    join(&mut parent, id(l, j), id(r, j));
                }
            }
        }
        let mut roots = BTreeSet::new();
        for k in 0..self.arr.cells.len() {
            for j in 0..m {
                if self.material[k][j] {
                    roots.insert(find(&mut parent, id(k, j)));
                }
            }
        }
        if roots.len() != 1 {
            return Err(no("multiple-result-bodies"));
        }
        Ok(())
    }
}

// ------------------------------------------------------------ operands

/// Source kinds recorded in the Boolean node, one triple per operand.
const ARC_PROFILE: u32 = 0;
const POLYGON: u32 = 1;
const BOX: u32 = 2;
const CYLINDER: u32 = 3;
const STACK: u32 = 5;
const REVOLVE: u32 = 6;
const CURVE_PROFILE: u32 = 7;
const HOLES: u32 = 8;
const PLANAR: u32 = 9;
/// A blended line/arc extrusion (`profile_blend`, rule 8: fillets or
/// chamfers of its generators): the rounded boxes of the tea box (D5).
const PROFILE_BLEND: u32 = 10;
const PLACED: u32 = 32;

#[derive(Clone, Debug)]
pub struct PrismStack {
    pub body: Body,
    pub frame: Placement,
    pub(crate) leaves: Vec<Leaf>,
    pub(crate) expr: Expr,
    pub(crate) stack: Stack,
    pub(crate) brep: crate::prism_stack_brep::Brep,
    pub(crate) blend: Vec<crate::stack_blend::Band>,
}
impl PrismStack {
    /// Query geometry from the audited arrangement, never the serialized WC0
    /// coordinates. A merged edge is a union of exact trims on one carrier.
    pub(crate) fn query_edges(&self, index: usize) -> R<Vec<crate::curve_query::Candidate<'_>>> {
        if !self.blend.is_empty() { return Err(no("blended-edge-metric-unimplemented")); }
        use crate::curve_query::{Candidate, SourceEdge};
        use crate::prism_stack_brep::EdgeGeom;
        let candidate = |source| Candidate::sourced(&self.body, &self.frame, index, source);
        let source = match self.brep.edges.get(index).ok_or_else(|| no("edge-index"))? {
            EdgeGeom::Horizontal { level, pieces } => return Ok(pieces.iter().map(|&i| {
                candidate(SourceEdge::Horizontal(self.stack.arr.pieces[i].seg.clone(), self.stack.levels[*level].clone()))
            }).collect()),
            EdgeGeom::Vertical { vertex, span } => {
                let p = self.stack.arr.points[*vertex].rat()?;
                SourceEdge::Line(span.map(|i| [p[0].clone(), p[1].clone(), self.stack.levels[i].clone()]))
            }
            EdgeGeom::Ring { tool, ring, half } => {
                let t = &self.stack.tools[*tool];
                let [z, r] = &t.rings[*ring];
                let x = if *half == 0 { r.clone() } else { -r };
                let a = wc::ExactPoint::from_rational([&t.c[0] + &x, t.c[1].clone()]);
                let b = wc::ExactPoint::from_rational([&t.c[0] - &x, t.c[1].clone()]);
                let ring = wc::Trimmed::ring(t.c.clone(), r * r, a.clone(), true)?;
                SourceEdge::Horizontal(ring.trim(a, b)?, z.clone())
            }
            EdgeGeom::Seam { tool, band, angle } => {
                let t = &self.stack.tools[*tool];
                let sign = q(if *angle == 0 { 1. } else { -1. });
                SourceEdge::Line(t.bands[*band].map(|i| {
                    let [z, r] = &t.rings[i];
                    [&t.c[0] + &sign * r, t.c[1].clone(), z.clone()]
                }))
            }
        };
        Ok(vec![candidate(source)])
    }
    /// The exact end points of bounded edge `index` in the source chart and
    /// whether its carrier is a circle: the ends of the chain of its exact
    /// trims (each point that closes no other piece), never its WC0 cache.
    pub(crate) fn edge_ends(&self, index: usize) -> R<([[Q; 3]; 2], bool)> {
        use crate::curve_query::SourceEdge;
        let mut ends: Vec<([Q; 3], usize)> = vec![];
        let mut circle = None;
        for c in self.query_edges(index)? {
            let (points, round) = match c.source.ok_or_else(|| no("edge-index"))? {
                SourceEdge::Horizontal(seg, level) => {
                    let round = matches!(seg.chart(), wc::Chart::Circle(_));
                    let at = |p: &wc::ExactPoint| -> R<[Q; 3]> {
                        let xy = p.rat()?;
                        Ok([xy[0].clone(), xy[1].clone(), level.clone()])
                    };
                    ([at(&seg.ends()[0])?, at(&seg.ends()[1])?], round)
                }
                SourceEdge::Line(points) => (points, false),
            };
            if *circle.get_or_insert(round) != round {
                return Err(no("edge-carrier-class"));
            }
            for p in points {
                match ends.iter_mut().find(|(e, _)| *e == p) {
                    Some((_, n)) => *n += 1,
                    None => ends.push((p, 1)),
                }
            }
        }
        let open: Vec<_> = ends.into_iter().filter(|(_, n)| *n == 1).map(|(p, _)| p).collect();
        match <[[Q; 3]; 2]>::try_from(open) {
            Ok(ends) => Ok((ends, circle.unwrap_or(false))),
            Err(_) => Err(no("edge-requires-bounded-chain")),
        }
    }
}
#[derive(Clone)]
struct Operand {
    kind: u32,
    body: Body,
    frame: Placement,
    leaves: Vec<Leaf>,
    expr: Expr,
}
fn placement(body: &Body) -> R<Placement> {
    Placement::from_frames(body, FrameId(1)).map_err(|_| no("source-frame"))
}
fn lines_profile(points: &[[f64; 2]]) -> R<wc::Cycle> {
    Ok(wc::Cycle::polygon(points)?)
}

/// A full circle (centre and radius in binary64 chart units) as a one-piece
/// counter-clockwise cycle. Its seam is the exact point at +x from the centre,
/// which is where a cylinder's own seam edge runs.
pub(crate) fn ring_profile(centre: [f64; 2], radius: f64) -> R<wc::Cycle> {
    let c = [q(centre[0]), q(centre[1])];
    let r = q(radius);
    let seam = wc::ExactPoint::from_rational([&c[0] + &r, c[1].clone()]);
    Ok(wc::Cycle::new(vec![wc::Trimmed::ring(c, &r * &r, seam, true)?]))
}
/// A polygon prism is the straight extrude grammar with its exact cap.
fn is_polygon(a: &crate::polyhedron::Audited) -> bool {
    a.body.constructions.len() == 5
        && a.body.frames.len() == 2
        && !a.cap.is_empty()
        && a.arrangement.is_none()
        && a.rounded.is_none()
        && a.chamfer.is_none()
        && a.corner.is_none()
        && a.orthogonal.is_none()
        && a.axis == 2
}
fn operand(s: &Solid) -> R<Operand> {
    let body = match s {
        Solid::Planar(a) => Some(&a.body),
        Solid::PrismStack(a) => Some(&a.body),
        Solid::PrismHoles(a) => Some(&a.body),
        Solid::Placed(a) => Some(&a.body),
        _ => None,
    };
    if let Some((inner, post)) = body.and_then(crate::pattern::unplace) {
        let solid = crate::analytic::audit(&inner.check().map_err(|_| no("placement-contract"))?)?;
        return placed_operand(operand(&solid)?, body.unwrap().clone(), &post);
    }
    let leaf = |kind, body: &Body, frame: Placement, axes, profile, levels| Operand {
        kind,
        body: body.clone(),
        frame: frame.clone(),
        leaves: vec![Leaf {
            frame,
            axes,
            profile,
            levels,
            meridian: None,
        }],
        expr: Expr::Leaf(0),
    };
    match s {
        Solid::Model(_, _) => Err(no("model-operand-not-routed")),
        Solid::PrismStack(p) if !p.blend.is_empty() => Err(no("blended-boolean-unimplemented")),
        Solid::PrismStack(p) => Ok(Operand {
            kind: STACK,
            body: p.body.clone(),
            frame: p.frame.clone(),
            leaves: p.leaves.clone(),
            expr: p.expr.clone(),
        }),
        Solid::PrismHoles(p) => {
            let sources = p.sources().iter().map(operand).collect::<R<Vec<_>>>()?;
            grouped(HOLES, p.body.clone(), 1, sources)
        }
        Solid::Planar(a) if crate::curve_profile::candidate(&a.body) => {
            let source = crate::curve_profile::Source::parse(&a.body.frames, &a.body.constructions)?;
            Ok(leaf(CURVE_PROFILE, &a.body, placement(&a.body)?, [0, 1, 2],
                crate::curve_profile::profile(&source.entities)?.cycle().clone(), a.levels))
        }
        Solid::Planar(a) if crate::profile_blend::candidate(&a.body) => {
            // The audit replayed the blend into its extrusion: the profile
            // lives in the source placement's xy, the levels along its z.
            let prism = a.arcs.as_ref().ok_or_else(|| no("source-layout"))?;
            Ok(leaf(PROFILE_BLEND, &a.body, a.frame.clone(), [0, 1, 2], prism.profile.cycle().clone(), prism.levels))
        }
        Solid::Planar(a)
            if arc_profile::candidate(&a.body)
                && a.body.constructions.len() == 3
                && a.body.frames.len() == 2 =>
        {
            let source = arc_profile::Source::parse(&a.body.frames, &a.body.constructions)?;
            Ok(leaf(ARC_PROFILE, &a.body, placement(&a.body)?, [0, 1, 2], source.profile()?.cycle().clone(), source.levels()))
        }
        Solid::Planar(a) if a.orthogonal.is_some() && a.body.frames.len() == 2 => {
            // A box is a prism along each local axis. Record all three; the
            // chart keeps exactly the alternative parallel to its axis (op 3).
            let frame = placement(&a.body)?;
            let mut leaves = vec![];
            let mut boxes = vec![];
            for [lo, hi] in &a.orthogonal.as_ref().unwrap().boxes {
                let start = leaves.len();
                for k in 0..3 {
                    let (i, j) = ((k + 1) % 3, (k + 2) % 3);
                    leaves.push(Leaf {
                        frame: frame.clone(), axes: [i, j, k],
                        profile: lines_profile(&[[lo[i], lo[j]], [hi[i], lo[j]], [hi[i], hi[j]], [lo[i], hi[j]]])?,
                        levels: [lo[k], hi[k]], meridian: None,
                    });
                }
                boxes.push(Expr::Op(3, (start..start + 3).map(Expr::Leaf).collect()));
            }
            Ok(Operand { kind: BOX, body: a.body.clone(), frame, leaves, expr: Expr::Op(0, boxes) })
        }
        Solid::Planar(a) if crate::planar_boolean::candidate(&a.body) => {
            let mut leaves = vec![];
            let expr = planar_expression(&a.body, a.body.constructions.len() - 1, &mut leaves, &mut 512)?;
            let frame = leaves.first().ok_or_else(|| no("source-layout"))?.frame.clone();
            Ok(Operand { kind: PLANAR, body: a.body.clone(), frame, leaves, expr })
        }
        Solid::Planar(a) if is_polygon(a) => {
            let points = a.cap.iter().map(|p| [p.x, p.y]).collect::<Vec<_>>();
            Ok(leaf(POLYGON, &a.body, placement(&a.body)?, [0, 1, 2], lines_profile(&points)?, a.levels))
        }
        Solid::Cylinder(c) => {
            // A cylinder is the prism of one full circle: a ring leaf, with its
            // seam at the cylinder's own seam. The frame is the one its spec
            // coordinates live in (a pattern image keeps its exact chain).
            let k = c.spec.axis()?;
            let (i, j) = ((k + 1) % 3, (k + 2) % 3);
            let profile = ring_profile([c.spec.bottom[i], c.spec.bottom[j]], c.spec.radius)?;
            Ok(leaf(CYLINDER, &c.body, c.frame.clone(), [i, j, k], profile, [c.spec.bottom[k], c.spec.top[k]]))
        }
        Solid::Revolved(a) if a.body.constructions.len() == 2 && a.body.frames.len() == 2 => {
            // A plain full-turn revolve: a coaxial tool once its axis maps
            // onto the chart axis (local axis `mode` is the revolve axis).
            let axes = match a.mode {
                0 => [1, 2, 0],
                1 => [2, 0, 1],
                _ => [0, 1, 2],
            };
            let heights = a.points.iter().map(|p| p[1]);
            let levels = [heights.clone().fold(f64::INFINITY, f64::min), heights.fold(f64::NEG_INFINITY, f64::max)];
            Ok(Operand {
                kind: REVOLVE,
                body: a.body.clone(),
                frame: placement(&a.body)?,
                leaves: vec![Leaf {
                    frame: placement(&a.body)?,
                    axes,
                    profile: wc::Cycle::new(vec![]),
                    levels,
                    meridian: Some(a.points.clone()),
                }],
                expr: Expr::Leaf(0),
            })
        }
        Solid::Planar(a) if a.arcs.as_ref().is_some_and(|p| p.rim.is_some()) => Err(no("rim-operand-unsupported")),
        Solid::Planar(_)
        | Solid::Columns(_)
        | Solid::Revolved(_)
        | Solid::Placed(_)
        | Solid::Conical(_)
        | Solid::Coaxial(_)
        | Solid::Bicylinder(_)
        | Solid::CylinderTee(_)
        | Solid::Spherical(_)
        | Solid::Axial(_)
        | Solid::Lens(_)
        | Solid::Perforated(_)
        | Solid::PerforatedChamfer(_) => Err(no("operand-carrier")),
    }
}

/// Flatten the already-audited planar owner's construction recipe, never its
/// rational boundary's binary64 display cache. Convex source leaves are prisms
/// iff their two cap cycles have the same projected vertex set. Alternative
/// axes stay symbolic until the shared chart fixes an extrusion direction.
fn planar_expression(body: &Body, at: usize, leaves: &mut Vec<Leaf>, fuel: &mut usize) -> R<Expr> {
    if *fuel == 0 { return Err(no("replay-budget")); }
    *fuel -= 1;
    let node = body.constructions.get(at).ok_or_else(|| no("source-layout"))?;
    if node.rule_version != 1 || node.parents.iter().any(|p| p.0 as usize >= at) {
        return Err(no("source-layout"));
    }
    if node.operation == (Operation::Boolean {}) {
        if node.parameters.len() != 2 || ![1., 2.].contains(&node.parameters[1].get()) || node.parents.len() < 2 {
            return Err(no("source-grammar"));
        }
        let op = index(node.parameters[0].get())?;
        if op > 2 { return Err(no("boolean-arguments")); }
        return Ok(Expr::Op(op as u8, node.parents.iter()
            .map(|p| planar_expression(body, p.0 as usize, leaves, fuel)).collect::<R<_>>()?));
    }
    if node.operation != (Operation::Sketch {}) || node.parents.len() != 1 || !node.parameters.is_empty() {
        return Err(no("source-grammar"));
    }
    let input = body.constructions.get(node.parents[0].0 as usize).ok_or_else(|| no("source-layout"))?;
    if input.operation != (Operation::Interpreter {}) { return Err(no("source-grammar")); }
    let data = &input.parameters;
    if data.len() < 2 { return Err(no("source-layout")); }
    let (nv, nf) = (index(data[0].get())?, index(data[1].get())?);
    if !(4..=256).contains(&nv) || !(4..=64).contains(&nf) || data.len() < 2 + 3 * nv {
        return Err(no("source-layout"));
    }
    let points = data[2..2 + 3 * nv].chunks_exact(3).map(|p| [p[0].get(), p[1].get(), p[2].get()]).collect::<Vec<_>>();
    let mut faces = vec![];
    let mut cursor = 2 + 3 * nv;
    for _ in 0..nf {
        let n = index(data.get(cursor).ok_or_else(|| no("source-layout"))?.get())?;
        cursor += 1;
        let face = data.get(cursor..cursor + n).ok_or_else(|| no("source-layout"))?
            .iter().map(|v| index(v.get())).collect::<R<Vec<_>>>()?;
        if face.iter().any(|&v| v >= nv) { return Err(no("source-layout")); }
        faces.push(face); cursor += n;
    }
    if cursor != data.len() { return Err(no("source-layout")); }
    let frame = Placement::from_frames(body, node.frame).map_err(|_| no("source-frame"))?;
    let mut alternatives = vec![];
    for k in 0..3 {
        let levels = points.iter().map(|p| p[k]).fold([f64::INFINITY, f64::NEG_INFINITY],
            |[lo, hi], v| [lo.min(v), hi.max(v)]);
        if levels[0] == levels[1] || points.iter().any(|p| !levels.contains(&p[k])) { continue; }
        let caps = levels.map(|z| faces.iter().filter(|f| f.iter().all(|&v| points[v][k] == z)).collect::<Vec<_>>());
        let ([lo], [hi]) = (caps[0].as_slice(), caps[1].as_slice()) else { continue };
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        let projected = |face: &[usize]| face.iter().map(|&v| [q(points[v][i]), q(points[v][j])]).collect::<BTreeSet<_>>();
        if lo.len() * 2 != nv || projected(lo) != projected(hi) { continue; }
        // The outward lower cap runs clockwise in the right-handed chart.
        let profile = lo.iter().rev().map(|&v| [points[v][i], points[v][j]]).collect::<Vec<_>>();
        alternatives.push(Expr::Leaf(leaves.len()));
        leaves.push(Leaf { frame: frame.clone(), axes: [i, j, k], profile: lines_profile(&profile)?, levels, meridian: None });
    }
    if alternatives.is_empty() { return Err(no("non-prismatic-source-leaf")); }
    Ok(Expr::Op(3, alternatives))
}

/// Keep the original carrier recipe but evaluate its Boolean source expression
/// in the shared stack. Only audited source data, never output vertices, enter it.
fn grouped(kind: u32, body: Body, op: u8, sources: Vec<Operand>) -> R<Operand> {
    let frame = sources.first().ok_or_else(|| no("source-layout"))?.frame.clone();
    let mut leaves = vec![];
    let mut children = vec![];
    for source in sources {
        children.push(source.expr.shifted(leaves.len()));
        leaves.extend(source.leaves);
    }
    Ok(Operand { kind, body, frame, leaves, expr: Expr::Op(op, children) })
}
/// The source grammar of an audited operand: its kind and the body whose
/// frames and constructions alone rebuild it (`source_solid`). The general
/// Boolean's rule-6 leaves use this grammar; no geometry cache is carried.
pub(crate) fn source_kind(s: &Solid) -> R<(u32, Body)> {
    let o = operand(s)?;
    if o.kind % PLACED == STACK || o.body.faces.is_empty() {
        return Err(no("source-kind"));
    }
    Ok((o.kind, o.body))
}
/// The rule-5 expression of a stack as the source leaves of `source_kind`:
/// the general Boolean rebuilds the same solid as an exact Model (F2c, a
/// blend the stack's binary64 family cannot state). Generator, blended and
/// nested stacks refuse.
pub(crate) fn source_operands(s: &PrismStack) -> R<(u8, Vec<(u32, Body)>)> {
    let generator = s.body.constructions.last().is_some_and(crate::stack_generator::candidate_node);
    if !s.blend.is_empty() || generator {
        return Err(no("source-kind"));
    }
    let (op, operands) = parse(s.body.key.clone(), &s.body.frames, &s.body.constructions, 0)?;
    let sources = operands
        .into_iter()
        .map(|o| if o.kind % PLACED == STACK || o.body.faces.is_empty() { Err(no("source-kind")) } else { Ok((o.kind, o.body)) })
        .collect::<R<Vec<_>>>()?;
    Ok((op, sources))
}
/// Rebuild and audit the operand of `source_kind` from its frames and
/// constructions alone.
pub(crate) fn source_solid(key: BodyKey, kind: u32, frames: Vec<Frame>, nodes: Vec<Construction>) -> R<Solid> {
    if kind % PLACED == STACK {
        return Err(no("source-kind"));
    }
    let o = rebuild(key, kind, frames, nodes, 0)?;
    crate::analytic::audit(&o.body.check().map_err(|_| no("source-contract"))?)
}
fn placed_operand(mut source: Operand, body: Body, post: &crate::placement::Post) -> R<Operand> {
    source.kind = source.kind.checked_add(PLACED).ok_or_else(|| no("replay-budget"))?;
    source.frame = source.frame.then(post).map_err(|_| no("frame-range"))?;
    for leaf in &mut source.leaves {
        leaf.frame = leaf.frame.then(post).map_err(|_| no("frame-range"))?;
    }
    source.body = body;
    Ok(source)
}
/// A complete Boolean can be evaluated from audited source expressions.
/// Variable-radius meridians currently enter only as subtracted tools. No
/// refusal text is interpreted: the arrangement must prove its own result.
pub(crate) fn admits_boolean(op: u8, bodies: &[Solid]) -> bool {
    op <= 2 && admits(bodies)
        && (op == 1 || !bodies.iter().any(|s| matches!(s, Solid::Revolved(_))))
        && !matches!(bodies.first(), Some(Solid::Revolved(_)))
}

// ------------------------------------------------------------ construction

fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn index(x: f64) -> R<usize> {
    if !(0. ..=1_000_000.).contains(&x) || x.fract() != 0. {
        return Err(no("source-index"));
    }
    Ok(x as usize)
}
fn move_frame(f: &mut Frame, offset: u32, adding: bool) -> R<()> {
    let parent = match f {
        Frame::Source { .. } => return Ok(()),
        Frame::Interpreter { parent, .. }
        | Frame::Rigid { parent, .. }
        | Frame::AffineImage { base: parent, .. }
        | Frame::InterpreterImage { base: parent, .. }
        | Frame::RationalImage { base: parent, .. } => parent,
    };
    parent.0 = if adding {
        parent.0 + offset
    } else {
        parent.0.checked_sub(offset).ok_or_else(|| no("source-layout"))?
    };
    Ok(())
}
fn graft(op: u8, operands: &[Operand]) -> R<(Vec<Frame>, Vec<Construction>)> {
    let mut frames = vec![];
    let mut nodes = vec![];
    let mut parents = vec![];
    let mut parameters = vec![b(op as f64)?];
    for o in operands {
        let fo = frames.len() as u32;
        let noff = nodes.len() as u32;
        parameters.extend([
            b(o.kind as f64)?,
            b(o.body.frames.len() as f64)?,
            b(o.body.constructions.len() as f64)?,
        ]);
        for mut f in o.body.frames.clone() {
            move_frame(&mut f, fo, true)?;
            frames.push(f);
        }
        for mut n in o.body.constructions.clone() {
            n.frame.0 += fo;
            for p in &mut n.parents {
                p.0 += noff;
            }
            nodes.push(n);
        }
        parents.push(NodeId(nodes.len() as u32 - 1));
    }
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: RULE,
        parents,
        parameters,
        frame: FrameId(1),
    });
    Ok((frames, nodes))
}
/// Source DAG, chart frame and the flattened, axis-pruned leaves of a
/// Boolean over operands, before any arrangement is computed.
struct Flat {
    frames: Vec<Frame>,
    nodes: Vec<Construction>,
    frame: Placement,
    leaves: Vec<Leaf>,
    expr: Expr,
    mapped: Vec<Mapped>,
}
fn compute(key: BodyKey, op: u8, operands: Vec<Operand>) -> R<PrismStack> {
    let Flat { frames, nodes, frame, leaves, expr, mapped } = flatten(op, operands)?;
    let stack = Stack::new(&mapped, &expr)?;
    // S13 is admission-last: reject features that cannot survive the STEP
    // source + PCurve + reader allowances before constructing a body. Existing
    // rational/spline sources keep their own admission contracts.
    if stack.arr.points.iter().any(|p| p.rat().is_err()) {
        certify_export_resolution(&frame, &stack)?;
    }
    let root = NodeId(nodes.len() as u32 - 1);
    let (body, brep) = crate::prism_stack_brep::build(key, frames, nodes, root, &stack)?;
    Ok(PrismStack {
        body,
        frame,
        leaves,
        expr,
        stack,
        brep,
        blend: vec![],
    })
}
/// A conservative upper bound of the existing observation/export allowance,
/// including world translation and placement rounding. Units here are metres;
/// validate-step.py's PCurve and OCCT Confusion budgets are 1e-8 and 1e-7 mm.
pub(crate) fn export_resolution_floor<'a>(
    frame: &Placement,
    points: impl Iterator<Item = &'a wc::ExactPoint>,
    pieces: impl Iterator<Item = &'a wc::Trimmed>,
    levels: &[Q],
) -> R<f64> {
    use wonky_num::Scalar;
    let mut magnitude = 0f64;
    let mut cache = 0f64;
    for p in points {
        for v in p.enclosure()? { magnitude = magnitude.max(v.abs().hi()); cache = cache.max(v.r); }
    }
    for p in pieces {
        let e = p.extent()?;
        magnitude = magnitude.max(e.magnitude);
        cache = cache.max(e.rounding);
    }
    for z in levels {
        let v = wc::numeric::enclose(z)?;
        magnitude = magnitude.max(v.abs().hi());
        cache = cache.max(v.r);
    }
    let origin = frame.apply_exact([0.; 3], 1., true).map_err(|_| no("frame-range"))?;
    let origin = origin.iter().map(|v| v.iter().map(|x| x.abs()).sum::<f64>()).fold(0f64, f64::max);
    let cols = frame.enclosed_columns();
    let scale = (0..3).map(|k| cols.iter().map(|v| v[k].abs().hi()).sum::<f64>()).fold(0f64, f64::max);
    magnitude = origin + scale * magnitude;
    cache = scale * cache + 128. * f64::EPSILON * magnitude;
    let defect = frame.orthonormality_defect().map_err(|_| no("frame-range"))?;
    // Gershgorin gives Gram's least eigenvalue >= 1 - 3*defect.
    // For near-rigid charts, 1 - 3*defect is also a lower stretch bound.
    // Convert the world export floor back into conservative chart units.
    if defect > 1e-9 { return Err(no("non-near-rigid-frame")); }
    let stretch = (1. - 3. * defect).next_down();
    let allowance = (128. * f64::EPSILON + 16. * defect) * magnitude + 8. * cache;
    let floor = (2. * (allowance + 1.1e-10) / stretch).next_up();
    if !floor.is_finite() { return Err(wc::Refusal::NumericRange.into()); }
    Ok(floor)
}
fn certify_export_resolution(frame: &Placement, stack: &Stack) -> R<()> {
    let mut coordinates = stack.levels.clone();
    for tool in &stack.tools {
        for ring in &tool.rings {
            coordinates.push(ring[0].clone());
            for k in 0..2 {
                coordinates.push(&tool.c[k] + &ring[1]);
                coordinates.push(&tool.c[k] - &ring[1]);
            }
        }
    }
    let floor = export_resolution_floor(frame, stack.arr.points.iter(), stack.arr.pieces.iter().map(|p| &p.seg), &coordinates)?;
    stack.arr.certify_resolution(floor)?;
    // Include effective tool rings in the axial certificate: a blind end
    // need not coincide with an extrusion level.
    let mut levels = stack.levels.clone();
    for tool in &stack.tools {
        levels.extend(tool.rings.iter().map(|r| r[0].clone()));
        for ring in &tool.rings {
            if wc::numeric::enclose(&ring[1])?.lo() <= floor {
                return Err(wc::Refusal::SubResolutionFeature.into());
            }
        }
        for (i, a) in tool.rings.iter().enumerate() {
            for b in &tool.rings[i+1..] {
                if a[0] == b[0] && wc::numeric::enclose(&(&a[1] - &b[1]).abs())?.lo() <= floor {
                    return Err(wc::Refusal::SubResolutionFeature.into());
                }
            }
        }
        for piece in &stack.arr.pieces {
            if !piece.seg.misses_disc(&tool.c, &(&tool.rmax + q(floor)))? {
                return Err(wc::Refusal::SubResolutionFeature.into());
            }
        }
    }
    for (i, a) in stack.tools.iter().enumerate() {
        for b in &stack.tools[i+1..] {
            if a.runs.iter().any(|x| b.runs.iter().any(|y| x[0] < y[1] && y[0] < x[1])) {
                let d = sub(&a.c, &b.c);
                let bound = &a.rmax + &b.rmax + q(floor);
                if dot(&d, &d) <= &bound * &bound {
                    return Err(wc::Refusal::SubResolutionFeature.into());
                }
            }
        }
    }
    levels.sort();
    levels.dedup();
    for band in levels.windows(2) {
        if wc::numeric::enclose(&(&band[1] - &band[0]))?.lo() <= floor {
            return Err(wc::Refusal::SubResolutionFeature.into());
        }
    }
    for (j, band) in stack.levels.windows(2).enumerate() {
        if stack.material.iter().any(|slabs| slabs[j])
            && wc::numeric::enclose(&(&band[1] - &band[0]))?.lo() <= floor {
            return Err(wc::Refusal::SubResolutionFeature.into());
        }
    }
    Ok(())
}
fn flatten(op: u8, operands: Vec<Operand>) -> R<Flat> {
    if op > 2 || operands.len() < 2 || operands.len() > MAX_OPERANDS {
        return Err(no("boolean-arguments"));
    }
    let (mut frames, mut nodes) = graft(op, &operands)?;
    // Boxes and planar recipes may offer several prism axes. A fixed-axis
    // operand selects the chart independently of operand order (box + Y cylinder).
    let chart_operand = operands.iter().position(|o| ![BOX, PLANAR].contains(&(o.kind % PLACED))).unwrap_or(0);
    let chosen = &operands[chart_operand];
    let offset = operands[..chart_operand].iter().map(|o| o.body.frames.len()).sum::<usize>();
    let source_id = (1..chosen.body.frames.len()).find(|&i|
        Placement::from_frames(&chosen.body, FrameId(i as u32)).is_ok_and(|f| f == chosen.frame))
        .ok_or_else(|| no("chart-frame"))?;
    let axes = if chosen.kind % PLACED == BOX || chosen.kind % PLACED == STACK {
        [0, 1, 2]
    } else {
        chosen.leaves.first().ok_or_else(|| no("source-layout"))?.axes
    };
    let chart_id = chart_frame(&mut frames, FrameId((offset + source_id) as u32), axes)?;
    nodes.last_mut().unwrap().frame = chart_id;
    let mut chart_body = chosen.body.clone();
    chart_body.frames = frames.clone();
    let frame = Placement::from_frames(&chart_body, chart_id).map_err(|_| no("chart-frame"))?;
    let chart = crate::construction_geom::frame(&frame)?;
    let mut leaves = vec![];
    let mut children = vec![];
    for o in &operands {
        children.push(o.expr.shifted(leaves.len()));
        leaves.extend(o.leaves.iter().cloned());
    }
    let expr = Expr::Op(op, children);
    // Box alternatives (op 3) keep exactly the one parallel to the chart axis.
    let results = leaves.iter().map(|l| map_leaf(l, &chart)).collect::<Vec<_>>();
    let mut kept = vec![None; leaves.len()];
    let mut count = 0;
    for (i, r) in results.iter().enumerate() {
        if r.is_ok() {
            kept[i] = Some(count);
            count += 1;
        }
    }
    let mut mapped = vec![];
    let expr = prune(&expr, &results, &kept)?;
    let leaves = leaves
        .into_iter()
        .zip(results)
        .filter_map(|(l, r)| r.ok().map(|m| {
            mapped.push(m);
            l
        }))
        .collect::<Vec<_>>();
    Ok(Flat { frames, nodes, frame, leaves, expr, mapped })
}
/// Precompose a cyclic axis permutation without multiplying or rounding any
/// interpreter coefficients: replay the original post chain after the exact
/// permutation of its source frame. Every appended frame is replay-derived.
fn chart_frame(frames: &mut Vec<Frame>, mut source: FrameId, axes: [usize; 3]) -> R<FrameId> {
    if axes == [0, 1, 2] { return Ok(source); }
    let mut posts = vec![];
    loop {
        match frames.get(source.0 as usize).ok_or_else(|| no("chart-frame"))? {
            Frame::Source { .. } => break,
            Frame::Interpreter { parent, origin, x, z } => {
                posts.push(crate::placement::Post::Interpreter(crate::affine::Affine {
                    origin: origin.map(|v| v.get()), x: x.map(|v| v.get()), z: z.map(|v| v.get()),
                })); source = *parent;
            }
            Frame::InterpreterImage { base, origin, x, z } => {
                posts.push(crate::placement::Post::Interpreter(crate::affine::Affine {
                    origin: origin.map(|v| v.get()), x: x.map(|v| v.get()), z: z.map(|v| v.get()),
                })); source = *base;
            }
            Frame::AffineImage { base, translation, rows } => {
                posts.push(crate::placement::Post::Rows { translation: translation.map(|v| v.get()), rows: rows.map(|r| r.map(|v| v.get())) });
                source = *base;
            }
            Frame::RationalImage { base, rows, denominator } => {
                posts.push(crate::placement::Post::Rational {
                    rows: rows.map(|r| r.map(|v| v.get())), denominator: denominator.get(),
                });
                source = *base;
            }
            Frame::Rigid { .. } => return Err(no("chart-frame")),
        }
    }
    let rows = std::array::from_fn(|i| std::array::from_fn(|j| if axes[j] == i { 1. } else { 0. }));
    let mut id = FrameId(frames.len() as u32);
    frames.push(crate::placement::Post::Rows { translation: [0.; 3], rows }.frame(source)?);
    for post in posts.into_iter().rev() {
        let next = FrameId(frames.len() as u32);
        frames.push(post.frame(id)?); id = next;
    }
    Ok(id)
}
/// Op 3 lists a prism's axis alternatives: exactly one must map.
fn prune(e: &Expr, results: &[R<Mapped>], kept: &[Option<usize>]) -> R<Expr> {
    Ok(match e {
        Expr::Leaf(i) => match &results[*i] {
            Ok(_) => Expr::Leaf(kept[*i].unwrap()),
            Err(e) => return Err(e.clone()),
        },
        Expr::Op(3, xs) => {
            let alive = xs
                .iter()
                .filter_map(|x| match x {
                    Expr::Leaf(i) => kept[*i].map(Expr::Leaf),
                    _ => None,
                })
                .collect::<Vec<_>>();
            match <[Expr; 1]>::try_from(alive) {
                Ok([one]) => one,
                Err(_) => return Err(no("non-parallel-extrusion-axes")),
            }
        }
        Expr::Op(op, xs) => Expr::Op(*op, xs.iter().map(|x| prune(x, results, kept)).collect::<R<_>>()?),
    })
}
fn classify_solid(s: &Solid) -> bool {
    operand(s).is_ok()
}
/// Admission: every operand has an audited prism source expression.
/// Unrelated carriers retain their existing owner or named refusal.
pub(crate) fn admits(bodies: &[Solid]) -> bool {
    // Includes straight prism sources; operand replay excludes rule-6 Models.
    bodies.len() >= 2 && bodies.iter().all(classify_solid)
}
/// Admission of revolve tools: a difference whose target is a supported
/// prism or stack and whose tools are prisms or plain full-turn revolves.
pub(crate) fn admits_tools(op: u8, bodies: &[Solid]) -> bool {
    op == 1
        && bodies.len() >= 2
        && !matches!(bodies[0], Solid::Revolved(_))
        && bodies.iter().all(classify_solid)
        && bodies[1..].iter().any(|s| matches!(s, Solid::Revolved(_)))
}
pub fn boolean(key: BodyKey, op: u8, bodies: &[Solid]) -> R<Vec<Body>> {
    let operands = bodies.iter().map(operand).collect::<R<Vec<_>>>()?;
    Ok(vec![compute(key, op, operands)?.body])
}

// ------------------------------------------------------------ placement

impl PrismStack {
    /// The stack moved rigidly by `frame`: the same Boolean of the same
    /// operands, each moved by the same exact isometry (never a resampled or
    /// re-fitted surface).
    pub fn transform(&self, frame: crate::affine::Affine) -> R<Body> {
        if !self.blend.is_empty() { return Err(no("blended-placement-unimplemented")); }
        moved(&self.body.key, &self.body.frames, &self.body.constructions, frame, 0)
    }
}
fn moved(key: &BodyKey, frames: &[Frame], nodes: &[Construction], frame: crate::affine::Affine, depth: usize) -> R<Body> {
    if nodes.last().is_some_and(crate::stack_generator::candidate_node) {
        let n = nodes.last().unwrap();
        if depth > 16 { return Err(no("replay-budget")); }
        let parent = moved(key, frames, &nodes[..nodes.len()-1], frame, depth + 1)?;
        let checked = parent.check().map_err(|_| no("placement-contract"))?;
        let parent = audit(&checked)?;
        let edges = n.parameters[1..].iter().map(|x| index(x.get())).collect::<R<Vec<_>>>()?;
        return Ok(crate::stack_generator::construct(parent, &edges, n.parameters[0].get(), n.operation == Operation::Intersection {})?.body);
    }
    let (op, operands) = parse(key.clone(), frames, nodes, depth)?;
    let audited = |body: Body| crate::analytic::audit(&body.check().map_err(|_| no("placement-contract"))?);
    let post = crate::placement::Post::Interpreter(frame);
    let operands = operands.into_iter().map(|o| {
        if o.kind == STACK {
            // A flattened nested stack has no B-rep: compose its source recipe.
            operand(&audited(moved(key, &o.body.frames, &o.body.constructions, frame, depth + 1)?)?)
        } else if o.kind >= PLACED {
            // Already wrapped source operands retain their symbolic post chain.
            let body = crate::pattern::place_body(&o.body, key.clone(), &post)?;
            placed_operand(o, body, &post)
        } else {
            // Existing placement owners preserve auxiliary charts (cylinder
            // seam frames and rational planar caches). A missing standalone
            // placement capability is not a limit of the shared source recipe.
            match audited(o.body.clone())?.transform(frame) {
                Ok(body) => operand(&audited(body)?),
                Err(e) if e.0.ends_with("/placement-unimplemented") => {
                    let body = crate::pattern::place_body(&o.body, key.clone(), &post)?;
                    placed_operand(o, body, &post)
                }
                Err(e) => Err(e),
            }
        }
    }).collect::<R<Vec<_>>>()?;
    Ok(compute(key.clone(), op, operands)?.body)
}

// ------------------------------------------------------------ replay

pub(crate) fn candidate(body: &Body) -> bool {
    if crate::stack_blend::candidate(body) || crate::stack_generator::candidate(body) { return true; }
    body.constructions
        .last()
        .is_some_and(|n| n.operation == (Operation::Boolean {}) && n.rule_version == RULE)
}
// Source operands recur in every audit of every later stack that contains
// them (a part with seven holes replays its shell sources eight times).
// Rebuilding is a pure function of (kind, frames, nodes); memoize it.
thread_local! {
    static REBUILT: std::cell::RefCell<Vec<(u32, Vec<Frame>, Vec<Construction>, Operand)>> = const { std::cell::RefCell::new(Vec::new()) };
}
const REBUILD_MEMO: usize = 64;
fn rebuild(key: BodyKey, kind: u32, frames: Vec<Frame>, nodes: Vec<Construction>, depth: usize) -> R<Operand> {
    if depth > 16 { return Err(no("replay-budget")); }
    let hit = REBUILT.with(|m| {
        m.borrow()
            .iter()
            .find(|(k, f, n, _)| *k == kind && *f == frames && *n == nodes)
            .map(|e| e.3.clone())
    });
    if let Some(mut o) = hit {
        o.body.key = key;
        return Ok(o);
    }
    let o = rebuild_uncached(key, kind, frames.clone(), nodes.clone(), depth)?;
    REBUILT.with(|m| {
        let mut m = m.borrow_mut();
        if m.len() == REBUILD_MEMO {
            m.remove(0);
        }
        m.push((kind, frames, nodes, o.clone()));
    });
    Ok(o)
}
fn empty_source(key: BodyKey, frames: Vec<Frame>, constructions: Vec<Construction>) -> Body {
    Body { key, frames, constructions, vertices: vec![], curves: vec![], surfaces: vec![], pcurves: vec![],
        edges: vec![], coedges: vec![], loops: vec![], faces: vec![], shells: vec![], solids: vec![], facts: vec![], budgets: vec![] }
}
fn rebuild_uncached(key: BodyKey, kind: u32, frames: Vec<Frame>, nodes: Vec<Construction>, depth: usize) -> R<Operand> {
    if depth > 16 { return Err(no("replay-budget")); }
    if kind >= PLACED {
        let fid = FrameId(frames.len().checked_sub(1).ok_or_else(|| no("source-layout"))? as u32);
        let post = match frames.last() {
            Some(Frame::InterpreterImage { origin, x, z, .. }) => crate::placement::Post::Interpreter(crate::affine::Affine {
                origin: origin.map(|v| v.get()), x: x.map(|v| v.get()), z: z.map(|v| v.get()),
            }),
            Some(Frame::AffineImage { translation, rows, .. }) => crate::placement::Post::Rows {
                translation: translation.map(|v| v.get()), rows: rows.map(|r| r.map(|v| v.get())),
            },
            _ => return Err(no("source-frame")),
        };
        let at = nodes.iter().position(|n| n.operation == (Operation::AffineTransform {}) && n.frame == fid)
            .ok_or_else(|| no("source-layout"))?;
        let inner = rebuild(key.clone(), kind - PLACED, frames[..frames.len() - 1].to_vec(), nodes[..at].to_vec(), depth + 1)?;
        let body = crate::pattern::place_body(&inner.body, key, &post)?;
        if body.frames != frames || body.constructions != nodes { return Err(no("source-grammar-mismatch")); }
        return placed_operand(inner, body, &post);
    }
    let body = match kind {
        ARC_PROFILE => {
            if nodes.len() != 3 || frames.len() != 2 {
                return Err(no("source-grammar"));
            }
            arc_profile::Source::parse(&frames, &nodes)?.build(key.clone())?
        }
        CURVE_PROFILE => crate::curve_profile::Source::parse(&frames, &nodes)?.build(key.clone())?,
        PROFILE_BLEND => crate::profile_blend::rebuild(&empty_source(key.clone(), frames.clone(), nodes.clone()))?,
        POLYGON => {
            if nodes.len() != 5 || frames.len() != 2 || nodes[2].parameters.len() != 2 {
                return Err(no("source-grammar"));
            }
            let p = nodes[1].parameters.iter().map(|v| v.get()).collect::<Vec<_>>();
            if p.len() % 4 != 0 {
                return Err(no("polygon-source"));
            }
            let lines = p.chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect::<Vec<_>>();
            let segs = lines
                .iter()
                .map(|c| [wonky_num::p2(c[0], c[1]), wonky_num::p2(c[2], c[3])])
                .collect::<Vec<_>>();
            let regions = wonky_sketch::region::lines_region(&segs).map_err(|_| no("polygon-source"))?;
            // Every extruded component retains the whole source sketch, but
            // its Sketch node records exactly the region selected for it.
            // Replay that selection instead of requiring a one-region sketch.
            let selected = &nodes[3].parameters;
            let region = regions.loops.iter().find(|region| {
                selected.len() == 2 * region.points.len()
                    && region.points.iter().zip(selected.chunks_exact(2))
                        .all(|(p, xy)| p.x == xy[0].get() && p.y == xy[1].get())
            }).ok_or_else(|| no("polygon-regions"))?;
            let (Some(Frame::Source { source }), Some(Frame::Interpreter { origin, x, z, .. })) = (frames.first(), frames.get(1)) else {
                return Err(no("source-frame"));
            };
            crate::extrude::blind_prism(&crate::extrude::Prism {
                key: key.clone(),
                source: *source,
                frame: crate::affine::Affine {
                    origin: origin.map(|v| v.get()),
                    x: x.map(|v| v.get()),
                    z: z.map(|v| v.get()),
                },
                segments: &lines,
                region,
                depth: nodes[2].parameters[0].get(),
                reverse: nodes[2].parameters[1].get() == -1.,
            })
            .map_err(|_| no("polygon-source"))?
        }
        BOX => {
            let Some(Frame::Interpreter { origin, x, z, .. }) = frames.get(1) else {
                return Err(no("source-frame"));
            };
            let frame = crate::affine::Affine {
                origin: origin.map(|v| v.get()),
                x: x.map(|v| v.get()),
                z: z.map(|v| v.get()),
            };
            let mut bodies = crate::orthogonal::construct(key.clone(), frame, nodes.clone(), nodes.len() - 1)?;
            if bodies.len() != 1 {
                return Err(no("box-components"));
            }
            bodies.pop().unwrap()
        }
        CYLINDER => crate::cylinder::source_body(key.clone(), &frames, &nodes)?,
        REVOLVE => {
            let (Some(Frame::Source { source }), [interp, _]) = (frames.first(), nodes.as_slice()) else {
                return Err(no("source-grammar"));
            };
            let p = interp.parameters.iter().map(|v| v.get()).collect::<Vec<_>>();
            if p.len() < 16 || p.len() % 2 != 0 || ![0., 1., 2.].contains(&p[0]) {
                return Err(no("revolve-source"));
            }
            let points = p[10..].chunks_exact(2).map(|c| [c[0], c[1]]).collect::<Vec<_>>();
            let segments = (0..points.len())
                .map(|i| {
                    let (a, b) = (points[i], points[(i + 1) % points.len()]);
                    [a[0], a[1], b[0], b[1]]
                })
                .collect::<Vec<_>>();
            let frame = crate::affine::Affine { origin: [p[1], p[2], p[3]], x: [p[4], p[5], p[6]], z: [p[7], p[8], p[9]] };
            crate::revolve_full::build(key.clone(), *source, frame, p[0] as usize, &segments, std::f64::consts::TAU)
                .map_err(|_| no("revolve-source"))?
        }
        PLANAR => {
            let root = nodes.len().checked_sub(1).ok_or_else(|| no("source-layout"))?;
            crate::planar_boolean::reconstruct(empty_source(key.clone(), frames.clone(), nodes.clone()), root)?.0
        }
        HOLES => {
            let mut source = empty_source(key.clone(), frames.clone(), nodes.clone());
            let root = source.constructions.last().ok_or_else(|| no("source-layout"))?;
            let (bases, _) = crate::prism_holes::ungraft(&source, &root.parameters[1..], &root.parents)?;
            let solids = bases.iter().map(|b| match b {
                crate::prism_holes::Base::Planar(a) => Solid::Planar(a.clone()),
                crate::prism_holes::Base::Cylinder(a) => Solid::Cylinder(a.clone()),
                crate::prism_holes::Base::Revolved(a) => Solid::Revolved(a.rev.clone()),
            }).collect::<Vec<_>>();
            source = if solids[1..].iter().any(|s| matches!(s, Solid::Planar(_))) {
                crate::prism_holes::subtract_pocket(key, &solids)?
            } else { crate::prism_holes::subtract_tools(key, &solids)? };
            source
            }
        STACK if nodes.last().is_some_and(crate::stack_generator::candidate_node) => {
            let (_, stack) = replay(key, &frames, &nodes, depth + 1)?;
            return operand(&Solid::PrismStack(stack));
        }
        STACK => {
            // A nested stack contributes its sources' leaves and expression;
            // only the outermost Boolean is arranged and compared (one exact
            // computation per audit instead of one per nesting level).
            let (op, operands) = parse(key.clone(), &frames, &nodes, depth + 1)?;
            let flat = flatten(op, operands)?;
            if flat.frames != frames || flat.nodes != nodes {
                return Err(no("source-grammar-mismatch"));
            }
            let body = Body {
                key,
                frames: flat.frames,
                constructions: flat.nodes,
                vertices: vec![],
                curves: vec![],
                surfaces: vec![],
                pcurves: vec![],
                edges: vec![],
                coedges: vec![],
                loops: vec![],
                faces: vec![],
                shells: vec![],
                solids: vec![],
                facts: vec![],
                budgets: vec![],
            };
            return Ok(Operand { kind: STACK, body, frame: flat.frame, leaves: flat.leaves, expr: flat.expr });
        }
        _ => return Err(no("source-kind")),
    };
    if body.frames != frames || body.constructions != nodes {
        return Err(no("source-grammar-mismatch"));
    }
    let checked = body.clone().check().map_err(|_| no("source-contract"))?;
    let o = operand(&crate::analytic::audit(&checked)?)?;
    if o.kind != kind {
        return Err(no("source-kind-mismatch"));
    }
    Ok(o)
}
pub(crate) fn replay_source(key: BodyKey,frames:&[Frame],nodes:&[Construction])->R<PrismStack>{Ok(replay(key,frames,nodes,0)?.1)}
fn replay(key: BodyKey, frames: &[Frame], nodes: &[Construction], depth: usize) -> R<(Body, PrismStack)> {
    if nodes.last().is_some_and(crate::stack_generator::candidate_node) {
        let n = nodes.last().unwrap();
        if nodes.len() < 3 || n.parents != [NodeId(nodes.len() as u32 - 2)] || n.frame != FrameId(1) || n.parameters.len() < 2 {
            return Err(no("generator-source-layout"));
        }
        if depth > 16 { return Err(no("replay-budget")); }
        let (_, parent) = replay(key, frames, &nodes[..nodes.len()-1], depth + 1)?;
        let edges = n.parameters[1..].iter().map(|x| index(x.get())).collect::<R<Vec<_>>>()?;
        let result = crate::stack_generator::construct(parent, &edges, n.parameters[0].get(), n.operation == Operation::Intersection {})?;
        return Ok((result.body.clone(), result));
    }
    let (op, operands) = parse(key.clone(), frames, nodes, depth)?;
    let stack = compute(key, op, operands)?;
    Ok((stack.body.clone(), stack))
}
fn parse(key: BodyKey, frames: &[Frame], nodes: &[Construction], depth: usize) -> R<(u8, Vec<Operand>)> {
    if depth > 16 {
        return Err(no("replay-budget"));
    }
    let root = nodes.last().ok_or_else(|| no("source-layout"))?;
    if !candidate_node(root) || root.parameters.len() != 1 + 3 * root.parents.len() {
        return Err(no("source-layout"));
    }
    let op = index(root.parameters[0].get())?;
    if op > 2 {
        return Err(no("boolean-arguments"));
    }
    let (mut nf, mut nn) = (0, 0);
    let mut operands = vec![];
    for (i, desc) in root.parameters[1..].chunks_exact(3).enumerate() {
        let (kind, fc, nc) = (index(desc[0].get())?, index(desc[1].get())?, index(desc[2].get())?);
        if fc < 2 || nc < 2 || nf + fc > frames.len() || nn + nc >= nodes.len() || root.parents[i].0 as usize != nn + nc - 1 {
            return Err(no("source-layout"));
        }
        let mut fs = frames[nf..nf + fc].to_vec();
        for f in &mut fs {
            move_frame(f, nf as u32, false)?;
        }
        let mut ns = nodes[nn..nn + nc].to_vec();
        for n in &mut ns {
            n.frame.0 = n.frame.0.checked_sub(nf as u32).ok_or_else(|| no("source-layout"))?;
            for p in &mut n.parents {
                p.0 = p.0.checked_sub(nn as u32).ok_or_else(|| no("source-layout"))?;
            }
        }
        operands.push(rebuild(key.clone(), kind as u32, fs, ns, depth)?);
        nf += fc;
        nn += nc;
    }
    if nf > frames.len() || nn + 1 != nodes.len() || root.frame.0 as usize >= frames.len() {
        return Err(no("source-layout"));
    }
    Ok((op as u8, operands))
}
fn candidate_node(n: &Construction) -> bool {
    n.operation == (Operation::Boolean {})
        && n.rule_version == RULE
        && (2..=MAX_OPERANDS).contains(&n.parents.len())
}
pub(crate) fn audit(checked: &CheckedBody) -> R<PrismStack> {
    let body = checked.body();
    if crate::stack_blend::candidate(body) { return crate::stack_blend::audit(checked); }
    let (expected, mut stack) = replay(body.key.clone(), &body.frames, &body.constructions, 0)?;
    if expected != *body {
        return Err(no("construction-mismatch"));
    }
    stack.body = body.clone();
    Ok(stack)
}

#[cfg(test)]
mod chart_replay_tests {
    use super::*;

    #[test]
    fn straight_sources_admit_but_rule6_models_keep_their_owner() {
        let key = BodyKey { id: [6, 7, 8, 9], revision: 0 };
        let body = crate::orthogonal::cuboid(key.clone(), [0.; 3], [1.; 3]).unwrap();
        let checked = body.check().unwrap();
        let source = crate::polyhedron::audit(&checked).unwrap();
        let planar = crate::analytic::audit(&checked).unwrap();
        assert!(admits(&[planar.clone(), planar.clone()]));
        assert!(!admits(&[planar.clone()]));

        let mut cache = crate::model_boolean::ReplayCache::default();
        let body = crate::model_boolean::boolean(
            key, 0, &[source.clone(), source], &mut cache,
        ).unwrap();
        let model = crate::analytic::audit(&body.check().unwrap()).unwrap();
        assert!(matches!(model, Solid::Model(_, _)));
        assert!(!admits(&[planar, model.clone()]));
        assert!(!admits_boolean(0, &[model.clone(), model]));
    }


    #[test]
    fn rational_post_chain_survives_every_cyclic_chart_permutation_exactly() {
        let mut body = crate::orthogonal::cuboid(
            BodyKey { id: [7, 8, 9, 10], revision: 0 }, [0.; 3], [1.; 3],
        ).unwrap();
        let mut source = FrameId(1);
        for rows in [
            [[5., 0., 0.], [0., 3., -4.], [0., 4., 3.]],
            [[3., -4., 0.], [4., 3., 0.], [0., 0., 5.]],
        ] {
            let id = FrameId(body.frames.len() as u32);
            body.frames.push(crate::placement::Post::Rational { rows, denominator: 5. }.frame(source).unwrap());
            source = id;
        }
        let original = Placement::from_frames(&body, source).unwrap().exact_frame().unwrap();
        let point = [Q::new(1.into(), 7.into()), Q::new((-2).into(), 11.into()), Q::new(5.into(), 13.into())];
        for axes in [[0, 1, 2], [1, 2, 0], [2, 0, 1]] {
            let chart = chart_frame(&mut body.frames, source, axes).unwrap();
            let replayed = Placement::from_frames(&body, chart).unwrap().exact_frame().unwrap();
            let mut permuted = std::array::from_fn(|_| Q::zero());
            for j in 0..3 { permuted[axes[j]] = point[j].clone(); }
            assert_eq!(replayed.point(&point), original.point(&permuted), "axes {axes:?}");
            assert!(body.frames.iter().filter(|f| matches!(f, Frame::RationalImage { .. })).count() >= 2);
        }
    }
}
