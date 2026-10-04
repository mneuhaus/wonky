//! Exact plane arrangement for Boolean expressions of admitted planar leaves.
//!
//! All clipping, sidedness, coplanarity and contact decisions use rationals of
//! the operand's binary64 coordinates and its exact frame composition (E9).
//! Boolean construction kind 2 stores checked binary64 observation caches in
//! WC0; its authority is the rational boundary reconstructed from the exact
//! operand frames and source vertices. No predicate or subsequent operation
//! may reseed geometry from those caches. Kind 1 retains its dyadic-only rule.
use crate::{
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use num_bigint::BigInt;
use num_rational::BigRational as Q;
use num_traits::{One, Signed, ToPrimitive, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_num::ball::Iv;

type R<T> = std::result::Result<T, Refused>;
type P = [Q; 3];
pub(crate) type Polygon = Vec<P>;
const MAX_PLANES: usize = 64;
const MAX_TILES: usize = 4096;
fn no(s: &str) -> Refused {
    Refused(format!("planar-boolean/{s}"))
}
fn q(x: f64) -> Q {
    Q::from_float(x).expect("finite contract coordinate")
}
fn sub(a: &P, b: &P) -> P {
    std::array::from_fn(|k| &a[k] - &b[k])
}
fn dot(a: &P, b: &P) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn cross(a: &P, b: &P) -> P {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn zero(a: &P) -> bool {
    a.iter().all(Q::is_zero)
}
fn normal(p: &[P]) -> P {
    let mut n = std::array::from_fn(|_| Q::zero());
    for k in 1..p.len() - 1 {
        let c = cross(&sub(&p[k], &p[0]), &sub(&p[k + 1], &p[0]));
        for j in 0..3 {
            n[j] += &c[j];
        }
    }
    n
}
fn scalar(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("coordinate-range"))
}
fn vector(x: [f64; 3]) -> R<Vector3> {
    Ok([scalar(x[0])?, scalar(x[1])?, scalar(x[2])?])
}
fn representable(x: &Q) -> R<f64> {
    let f = x
        .to_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| no("coordinate-range"))?;
    if q(f) != *x {
        return Err(no(
            "non-dyadic-boundary: exact rational vertex storage required",
        ));
    }
    Ok(if f == 0. { 0. } else { f })
}
fn point(p: &P) -> R<[f64; 3]> {
    Ok([
        representable(&p[0])?,
        representable(&p[1])?,
        representable(&p[2])?,
    ])
}
fn gcd(mut a: BigInt, mut b: BigInt) -> BigInt {
    while !b.is_zero() {
        let r = &a % &b;
        a = b;
        b = r;
    }
    a.abs()
}
// A rational direction is projective: remove a common denominator/gcd, then
// use a power-of-two scale. Only equality against the rational proves storage.
fn direction(p: &P) -> R<[f64; 3]> {
    let denominator: BigInt = p.iter().map(|v| v.denom()).product();
    let integers: [BigInt; 3] =
        std::array::from_fn(|k| p[k].numer() * (&denominator / p[k].denom()));
    let g = integers
        .iter()
        .fold(BigInt::zero(), |a, b| gcd(a, b.clone()));
    if g.is_zero() {
        return Err(no("zero-normal"));
    }
    let reduced = integers.map(|v| v / &g);
    let bits = reduced.iter().map(|v| v.bits()).max().unwrap();
    let scale = BigInt::one() << bits.saturating_sub(1) as usize;
    point(&reduced.map(|v| Q::new(v, scale.clone())))
        .map_err(|_| no("carrier-not-representable: exact rational plane storage required"))
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Plane {
    n: P,
    d: Q,
}
impl Plane {
    fn new(p: &[P]) -> R<Self> {
        let n = normal(p);
        let scale = n
            .iter()
            .find(|v| !v.is_zero())
            .ok_or_else(|| no("degenerate-face"))?
            .abs();
        let n = n.map(|v| v / &scale);
        let d = dot(&n, &p[0]);
        if p.iter().any(|v| dot(&n, v) != d) {
            return Err(no("nonplanar-leaf"));
        }
        Ok(Self { n, d })
    }
    fn side(&self, p: &P) -> Q {
        dot(&self.n, p) - &self.d
    }
    fn unoriented(&self) -> Self {
        if self.n.iter().find(|v| !v.is_zero()).unwrap().is_negative() {
            Self {
                n: self.n.clone().map(|v| -v),
                d: -&self.d,
            }
        } else {
            self.clone()
        }
    }
}
#[derive(Clone)]
struct Leaf {
    /// The Sketch node whose data define this leaf.
    node: usize,
    faces: Vec<Polygon>,
    // Original exact boundary cycles, before convex membership partitioning.
    model_faces: Vec<Polygon>,
    convex: bool,
    planes: Vec<Plane>,
}
#[derive(Clone)]
enum Expr {
    Leaf(usize),
    Op(u8, Vec<Expr>),
}
impl Expr {
    // Membership immediately on either side of a tile. No floating sample or
    // finite epsilon: the sign is lexicographic (plane(p), dot(n,direction)).
    fn inside(&self, leaves: &[Leaf], p: &P, direction: &P, positive: bool) -> R<bool> {
        Ok(match self {
            Self::Leaf(i) if !leaves[*i].convex => crate::planar_region::inside(&leaves[*i].faces, p, &direction.clone().map(|v| if positive { v } else { -v }))?,
            Self::Leaf(i) => leaves[*i].planes.iter().all(|f| {
                let side = f.side(p);
                if !side.is_zero() {
                    side.is_negative()
                } else {
                    let s = dot(&f.n, direction);
                    if positive {
                        s <= Q::zero()
                    } else {
                        s >= Q::zero()
                    }
                }
            }),
            Self::Op(0, es) => es.iter().map(|e| e.inside(leaves, p, direction, positive)).collect::<R<Vec<_>>>()?.into_iter().any(|v| v),
            Self::Op(1, es) => {
                es[0].inside(leaves, p, direction, positive)?
                    && !es[1..].iter().map(|e| e.inside(leaves, p, direction, positive)).collect::<R<Vec<_>>>()?.into_iter().any(|v| v)
            }
            Self::Op(2, es) => es.iter().map(|e| e.inside(leaves, p, direction, positive)).collect::<R<Vec<_>>>()?.into_iter().all(|v| v),
            Self::Op(_, _) => return Err(no("boolean-operation")),
        })
    }
}
fn root(body: &Body) -> R<usize> {
    match body.vertices.first().map(|v| &v.provenance) {
        Some(Provenance::Construction { node }) => Ok(node.0 as usize),
        _ => Err(no("no-construction")),
    }
}
pub fn candidate(body: &Body) -> bool {
    let Ok(mut i) = root(body) else {return false;};
    for _ in 0..256 {
        let Some(n)=body.constructions.get(i) else {return false;};
        if n.operation == (Operation::AffineTransform {}) && n.parents.len()==1 { i=n.parents[0].0 as usize; continue; }
        return n.replayed_planar_boundary();
    }
    false
}

struct Chart {
    origin: P,
    columns: [P; 3],
    dual: [P; 3],
    determinant: Q,
}
impl Chart {
    fn new(body: &Body, frame: FrameId) -> R<Self> {
        let map = Placement::from_frames(body, frame).map_err(|_| no("frame-range"))?;
        let exact = map.exact_frame()?;
        let origin = exact.origin().clone();
        let columns = exact.columns().clone();
        let dual = [
            cross(&columns[1], &columns[2]),
            cross(&columns[2], &columns[0]),
            cross(&columns[0], &columns[1]),
        ];
        let determinant = dot(&columns[0], &dual[0]);
        if determinant.is_zero() {
            return Err(no("singular-frame"));
        }
        Ok(Self {
            origin,
            columns,
            dual,
            determinant,
        })
    }
    fn map_to(&self, p: &P, target: &Self) -> P {
        let world: P = std::array::from_fn(|k| {
            &self.origin[k] + (0..3).map(|j| &self.columns[j][k] * &p[j]).sum::<Q>()
        });
        let delta = sub(&world, &target.origin);
        std::array::from_fn(|k| dot(&target.dual[k], &delta) / &target.determinant)
    }
}
fn integer(x: f64) -> R<usize> {
    if x < 0. || x > 65536. || x.fract() != 0. {
        Err(no("construction-index"))
    } else {
        Ok(x as usize)
    }
}
fn leaf(body: &Body, node: usize, n: &Construction, target: &Chart) -> R<Leaf> {
    if n.parents.len() != 1 || !n.parameters.is_empty() {
        return Err(no("leaf-arity"));
    }
    let input = body
        .constructions
        .get(n.parents[0].0 as usize)
        .ok_or_else(|| no("construction-reference"))?;
    if input.operation != (Operation::Interpreter {}) {
        return Err(no("leaf-source"));
    }
    let data: Vec<_> = input.parameters.iter().map(|v| v.get()).collect();
    let mut at = 0;
    let mut next = || {
        let x = data.get(at).copied().ok_or_else(|| no("leaf-data"));
        at += 1;
        x
    };
    let nv = integer(next()?)?;
    let nf = integer(next()?)?;
    if !(4..=256).contains(&nv) || !(4..=MAX_PLANES).contains(&nf) {
        return Err(no("leaf-budget"));
    }
    let chart = Chart::new(body, n.frame)?;
    let mut vertices = Vec::new();
    for _ in 0..nv {
        vertices.push(chart.map_to(&[q(next()?), q(next()?), q(next()?)], target));
    }
    if vertices.iter().collect::<BTreeSet<_>>().len() != nv {
        return Err(no("duplicate-leaf-vertex"));
    }
    let mut faces = Vec::new();
    let mut model_faces=Vec::new();
    let mut planes = Vec::new();
    let mut edges: BTreeMap<(usize, usize), Vec<bool>> = BTreeMap::new();
    let mut used = BTreeSet::new();
    for _ in 0..nf {
        let count = integer(next()?)?;
        if count < 3 || count > nv {
            return Err(no("leaf-face-size"));
        }
        let mut ids = Vec::new();
        for _ in 0..count {
            let i = integer(next()?)?;
            if i >= nv {
                return Err(no("leaf-vertex"));
            }
            ids.push(i);
            used.insert(i);
        }
        if ids.iter().collect::<BTreeSet<_>>().len() != count {
            return Err(no("leaf-repeated-vertex"));
        }
        if chart.determinant.is_negative() != target.determinant.is_negative() {
            ids.reverse();
        }
        for k in 0..count {
            let (a, b) = (ids[k], ids[(k + 1) % count]);
            edges.entry((a.min(b), a.max(b))).or_default().push(a < b);
        }
        let polygon: Polygon = ids.into_iter().map(|i| vertices[i].clone()).collect();
        model_faces.push(polygon.clone());
        let plane = Plane::new(&polygon)?;
        crate::planar_region::simple(&polygon)?;
        // Exact convex partition of the plane region, not a mesh carrier.
        if (0..polygon.len()).all(|i| dot(&cross(&sub(&polygon[(i+1)%polygon.len()], &polygon[i]), &sub(&polygon[(i+2)%polygon.len()], &polygon[(i+1)%polygon.len()])), &plane.n) >= Q::zero()) { faces.push(polygon); } else { faces.extend(crate::planar_region::triangles(&polygon)?); }
        planes.push(plane);
    }
    if at != data.len()
        || used.len() != nv
        || edges.values().any(|v| v.len() != 2 || v[0] == v[1])
        || nv + nf != edges.len() + 2
    {
        return Err(no("leaf-topology"));
    }
    if planes
        .iter()
        .any(|p| !vertices.iter().any(|v| p.side(v).is_negative()))
    {
        return Err(no("zero-volume-leaf"));
    }
    let convex = planes.iter().all(|f| vertices.iter().all(|p| !f.side(p).is_positive()));
    Ok(Leaf { node, faces, model_faces, planes, convex })
}
// Coordinate leaves and their source-frame offsets share the rational plane
// arrangement. Geometry is reconstructed from input nodes, never WC0 caches.
fn coordinate_bounds(body: &Body, index: usize) -> R<[[Q; 3]; 2]> {
    let n = body
        .constructions
        .get(index)
        .ok_or_else(|| no("construction-reference"))?;
    if n.operation == (Operation::Extrude {})
        && n.rule_version == 1
        && n.parents.len() == 2
        && n.parameters.len() == 2
        && n.parents.iter().all(|p| (p.0 as usize) < index)
    {
        let sketch = &body.constructions[n.parents[0].0 as usize];
        let depth = &body.constructions[n.parents[1].0 as usize];
        if sketch.operation != (Operation::Sketch {})
            || sketch.rule_version != 1
            || sketch.frame != n.frame
            || sketch.parents.len() != 2
            || sketch.parameters.len() != 8
            || sketch.parents.iter().any(|p| p.0 >= n.parents[0].0)
            || depth.operation != (Operation::Interpreter {})
            || depth.rule_version != 1
            || !depth.parents.is_empty()
            || depth.parameters.len() != 2
        {
            return Err(no("sketch-coordinate-leaf"));
        }
        let plane = &body.constructions[sketch.parents[0].0 as usize];
        let lines = &body.constructions[sketch.parents[1].0 as usize];
        let input = |c: &Construction| {
            c.operation == (Operation::Interpreter {})
                && c.rule_version == 1
                && c.parents.is_empty()
        };
        let Frame::Interpreter { origin, x, z, .. } = &body.frames[n.frame.0 as usize] else {
            return Err(no("sketch-coordinate-frame"));
        };
        if !input(plane)
            || !input(lines)
            || plane.parameters.len() != 9
            || lines.parameters.len() % 4 != 0
            || !plane.parameters.iter().eq(origin.iter().chain(x).chain(z))
        {
            return Err(no("sketch-coordinate-input"));
        }
        let direction = depth.parameters[1].get();
        let length = depth.parameters[0].get();
        if length <= 0.
            || ![1., -1.].contains(&direction)
            || n.parameters[0].get() != if direction == 1. { 0. } else { -length }
            || n.parameters[1].get() != if direction == 1. { length } else { 0. }
        {
            return Err(no("sketch-coordinate-depth"));
        }
        let segments = lines
            .parameters
            .chunks_exact(4)
            .map(|p| {
                [
                    wonky_num::p2(p[0].get(), p[1].get()),
                    wonky_num::p2(p[2].get(), p[3].get()),
                ]
            })
            .collect::<Vec<_>>();
        let regions = wonky_sketch::region::lines_region(&segments)
            .map_err(|_| no("sketch-coordinate-regions"))?;
        if !regions.loops.iter().any(|r| {
            r.points
                .iter()
                .flat_map(|p| [p.x, p.y])
                .eq(sketch.parameters.iter().map(|p| p.get()))
        }) {
            return Err(no("sketch-coordinate-region"));
        }
        let points = sketch
            .parameters
            .chunks_exact(2)
            .map(|p| [p[0].get(), p[1].get()])
            .collect::<Vec<_>>();
        return Ok(crate::planar_shell::rectangle_bounds(
            &points,
            [n.parameters[0].get(), n.parameters[1].get()],
        )?
        .map(|p| p.map(q)));
    }
    if n.operation != (Operation::Extrude {})
        || n.rule_version != 1
        || n.parents.len() != 1
        || !n.parameters.is_empty()
        || n.parents[0].0 as usize >= index
    {
        return Err(no("coordinate-leaf"));
    }
    let input = &body.constructions[n.parents[0].0 as usize];
    if input.operation != (Operation::Interpreter {})
        || input.rule_version != 1
        || !input.parents.is_empty()
        || input.parameters.len() != 6
    {
        return Err(no("coordinate-input"));
    }
    let bounds =
        std::array::from_fn(|end| std::array::from_fn(|k| q(input.parameters[end * 3 + k].get())));
    if !(0..3).all(|k| bounds[0][k] < bounds[1][k]) {
        return Err(no("empty-coordinate-leaf"));
    }
    Ok(bounds)
}
fn coordinate_leaf(
    body: &Body,
    node: usize,
    frame: FrameId,
    bounds: &[[Q; 3]; 2],
    target: &Chart,
) -> R<Leaf> {
    let chart = Chart::new(body, frame)?;
    let mut faces = vec![];
    for axis in 0..3 {
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        for end in 0..2 {
            let mut face: Polygon = [(0, 0), (1, 0), (1, 1), (0, 1)]
                .into_iter()
                .map(|(i, j)| {
                    let mut p = bounds[0].clone();
                    p[axis] = bounds[end][axis].clone();
                    p[u] = bounds[i][u].clone();
                    p[v] = bounds[j][v].clone();
                    chart.map_to(&p, target)
                })
                .collect();
            if (end == 0) != (chart.determinant.is_negative() != target.determinant.is_negative()) {
                face.reverse();
            }
            faces.push(face);
        }
    }
    let planes = faces.iter().map(|p| Plane::new(p)).collect::<R<_>>()?;
    Ok(Leaf {
        node,
        model_faces: faces.clone(),
        faces,
        planes,
        convex: true,
    })
}
/// Shell construction kind 2 authenticates rational caches through the same
/// replay and export path as kind-2 planar Boolean results.
pub(crate) fn shell(a: &Audited, thickness: f64, side: usize) -> R<Body> {
    let mut body = empty(a.body.clone());
    body.key.revision = body
        .key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    let root = body.constructions.len();
    body.constructions.push(Construction {
        operation: Operation::Shell {},
        rule_version: 1,
        parents: vec![NodeId(crate::orthogonal::root(&a.body)? as u32)],
        parameters: vec![scalar(thickness)?, scalar(side as f64)?, scalar(2.)?],
        frame: a.body.vertices[0].frame,
    });
    Ok(reconstruct(body, root)?.0)
}

fn expression(
    body: &Body,
    index: usize,
    target: &Chart,
    leaves: &mut Vec<Leaf>,
    fuel: &mut usize,
) -> R<Expr> {
    if *fuel == 0 {
        return Err(no("construction-budget"));
    }
    *fuel -= 1;
    let n = body
        .constructions
        .get(index)
        .ok_or_else(|| no("construction-reference"))?;
    if n.rule_version != 1 || n.parents.iter().any(|p| p.0 as usize >= index) {
        return Err(no("construction-order"));
    }
    if n.operation == (Operation::AffineTransform {}) && n.parents.len()==1 && n.parameters.is_empty() {
        let parent=&body.constructions[n.parents[0].0 as usize];
        let old=Placement::from_frames(body,parent.frame).map_err(|_|no("frame-range"))?.exact_frame()?;
        let new=Placement::from_frames(body,n.frame).map_err(|_|no("frame-range"))?.exact_frame()?;
        let inverse=new.inverse();
        let pull=|p:&P,t:bool| { if t {old.point(&inverse.point(p))} else {old.vector(&inverse.vector(p))} };
        let origin=pull(&target.origin,true);let columns=target.columns.each_ref().map(|c|pull(c,false));
        let dual=[cross(&columns[1],&columns[2]),cross(&columns[2],&columns[0]),cross(&columns[0],&columns[1])];
        let determinant=dot(&columns[0],&dual[0]);
        return expression(body,n.parents[0].0 as usize,&Chart{origin,columns,dual,determinant},leaves,fuel);
    }
    if n.operation == (Operation::Extrude {}) {
        let bounds = coordinate_bounds(body, index)?;
        let leaf = coordinate_leaf(body, index, n.frame, &bounds, target)?;
        let i = leaves.len();
        leaves.push(leaf);
        return Ok(Expr::Leaf(i));
    }
    if n.operation == (Operation::Shell {}) {
        if n.parents.len() != 1 || n.parameters.len() != 3 || n.parameters[2].get() != 2. {
            return Err(no("shell-grammar"));
        }
        crate::source_frame::SourceMetric::new(
            &Placement::from_frames(body, n.frame).map_err(|_| no("frame-range"))?,
        )?;
        let source = n.parents[0].0 as usize;
        let bounds = coordinate_bounds(body, source)?;
        let side = integer(n.parameters[1].get())?;
        let inner = crate::planar_shell::exact_cavity(&bounds, n.parameters[0].get(), side)?;
        let frame = body.constructions[source].frame;
        if frame != n.frame {
            return Err(no("shell-frame"));
        }
        let i = leaves.len();
        leaves.push(coordinate_leaf(body, source, frame, &bounds, target)?);
        leaves.push(coordinate_leaf(body, index, frame, &inner, target)?);
        return Ok(Expr::Op(1, vec![Expr::Leaf(i), Expr::Leaf(i + 1)]));
    }
    if n.operation == (Operation::Sketch {}) {
        let l = leaf(body, index, n, target)?;
        let i = leaves.len();
        leaves.push(l);
        return Ok(Expr::Leaf(i));
    }
    if n.operation != (Operation::Boolean {})
        || n.parameters.len() != 2
        || ![1., 2.].contains(&n.parameters[1].get())
        || n.parents.len() < 2
    {
        return Err(no("construction-grammar"));
    }
    let op = integer(n.parameters[0].get())?;
    if op > 2 {
        return Err(no("boolean-operation"));
    }
    let es = n
        .parents
        .iter()
        .map(|p| expression(body, p.0 as usize, target, leaves, fuel))
        .collect::<R<_>>()?;
    Ok(Expr::Op(op as u8, es))
}
fn clipped(p: &[P], plane: &Plane, positive: bool) -> Polygon {
    let mut out = Vec::new();
    for k in 0..p.len() {
        let (a, b) = (&p[k], &p[(k + 1) % p.len()]);
        let sa = plane.side(a);
        let sb = plane.side(b);
        if if positive {
            sa >= Q::zero()
        } else {
            sa <= Q::zero()
        } {
            out.push(a.clone());
        }
        if (sa.is_positive() && sb.is_negative()) || (sa.is_negative() && sb.is_positive()) {
            let t = &sa / (&sa - &sb);
            out.push(std::array::from_fn(|j| &a[j] + (&b[j] - &a[j]) * &t));
        }
    }
    out.dedup();
    if out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    out
}
fn split(p: Polygon, plane: &Plane) -> Vec<Polygon> {
    let signs: Vec<_> = p.iter().map(|v| plane.side(v)).collect();
    if signs.iter().any(Q::is_positive) && signs.iter().any(Q::is_negative) {
        vec![clipped(&p, plane, false), clipped(&p, plane, true)]
    } else {
        vec![p]
    }
}
fn between(p: &P, a: &P, b: &P) -> bool {
    zero(&cross(&sub(p, a), &sub(b, a))) && dot(&sub(p, a), &sub(p, b)) <= Q::zero()
}
fn split_edges(p: &[P], vertices: &BTreeSet<P>) -> Polygon {
    let mut out = Vec::new();
    for k in 0..p.len() {
        let (a, b) = (&p[k], &p[(k + 1) % p.len()]);
        let axis = (0..3).find(|&j| a[j] != b[j]).unwrap();
        let mut points: Vec<_> = vertices
            .iter()
            .filter(|v| *v != b && between(v, a, b))
            .cloned()
            .collect();
        points.sort_by(|u, v| {
            if a[axis] < b[axis] {
                u[axis].cmp(&v[axis])
            } else {
                v[axis].cmp(&u[axis])
            }
        });
        out.extend(points);
    }
    out
}
fn simplify(mut p: Polygon) -> Polygon {
    loop {
        let index = (0..p.len()).find(|&k| {
            between(
                &p[k],
                &p[(k + p.len() - 1) % p.len()],
                &p[(k + 1) % p.len()],
            )
        });
        match index {
            Some(i) if p.len() > 3 => {
                p.remove(i);
            }
            _ => return p,
        }
    }
}
// A face is one outer cycle followed by its clockwise inner cycles. Keep the
// signed loops: flattening each cycle into its own face would fill every hole.
type FaceBoundary = Vec<Polygon>;

fn contains(cycle: &[P], p: &P, axis: usize) -> R<bool> {
    let (x, y) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut winding = 0;
    for k in 0..cycle.len() {
        let (a, b) = (&cycle[k], &cycle[(k + 1) % cycle.len()]);
        if between(p, a, b) {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
        let side = (&b[x] - &a[x]) * (&p[y] - &a[y]) - (&b[y] - &a[y]) * (&p[x] - &a[x]);
        if a[y] <= p[y] && b[y] > p[y] && side.is_positive() {
            winding += 1;
        } else if a[y] > p[y] && b[y] <= p[y] && side.is_negative() {
            winding -= 1;
        }
    }
    Ok(winding != 0)
}

fn group_cycles(cycles: Vec<Polygon>, plane: &Plane) -> R<Vec<FaceBoundary>> {
    let axis = (0..3).find(|&k| !plane.n[k].is_zero()).unwrap();
    let areas: Vec<_> = cycles.iter().map(|c| dot(&normal(c), &plane.n)).collect();
    if areas.iter().any(Q::is_zero) {
        return Err(no("degenerate-boundary"));
    }
    // Arrangement tile boundaries are disjoint simple cycles. Their immediate
    // containing cycle is the smallest containing area, decided rationally.
    // This also handles an island inside a hole without attaching that hole to
    // the island or to an unrelated coplanar outer face.
    let mut parents = Vec::new();
    for (i, cycle) in cycles.iter().enumerate() {
        let mut enclosing = Vec::new();
        for (j, other) in cycles.iter().enumerate() {
            if i != j && contains(other, &cycle[0], axis)? {
                enclosing.push(j);
            }
        }
        let parent = enclosing.into_iter().min_by_key(|&j| areas[j].abs());
        if let Some(j) = parent {
            if areas[j].abs() <= areas[i].abs() || areas[j].is_positive() == areas[i].is_positive()
            {
                return Err(no("invalid-cycle-nesting"));
            }
        } else if areas[i].is_negative() {
            return Err(no("uncontained-hole"));
        }
        parents.push(parent);
    }
    Ok(cycles
        .iter()
        .enumerate()
        .filter(|(i, _)| areas[*i].is_positive())
        .map(|(i, outer)| {
            let mut face = vec![outer.clone()];
            face.extend(
                cycles
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| parents[*j] == Some(i))
                    .map(|(_, c)| c.clone()),
            );
            face
        })
        .collect())
}

fn boundary(leaves: &[Leaf], expr: &Expr) -> R<Vec<FaceBoundary>> {
    let mut planes: BTreeSet<_> = leaves
        .iter()
        .flat_map(|l| l.planes.iter().map(Plane::unoriented))
        .collect();
    // A concave cap's exact partition introduces diagonals which are not solid
    // support planes. Split every coplanar operand by those same edge carriers,
    // so overlapping partitions produce identical tiles before deduplication.
    // Without this common refinement, two valid caps can duplicate an edge.
    for face in leaves.iter().filter(|l| !l.convex).flat_map(|l| &l.faces) {
        let n = normal(face);
        for i in 0..face.len() {
            let a = &face[i];
            let b = &face[(i + 1) % face.len()];
            let c = std::array::from_fn(|k| &a[k] + &n[k]);
            // Plane::new canonicalizes the exact projective coefficients.
            let separator = Plane::new(&[a.clone(), b.clone(), c])?;
            planes.insert(separator.unoriented());
        }
    }
    if planes.len() > MAX_PLANES {
        return Err(no("plane-budget"));
    }
    let mut unique = BTreeMap::new();
    let mut work = 0;
    for face in leaves.iter().flat_map(|l| &l.faces) {
        let mut tiles = vec![face.clone()];
        for plane in &planes {
            tiles = tiles.into_iter().flat_map(|p| split(p, plane)).collect();
            if tiles.len() > MAX_TILES {
                return Err(no("tile-budget"));
            }
        }
        work += tiles.len();
        if work > MAX_TILES {
            return Err(no("tile-budget"));
        }
        for mut tile in tiles {
            let n = normal(&tile);
            if zero(&n) {
                continue;
            }
            let count = Q::from_integer(tile.len().into());
            let center = std::array::from_fn(|k| tile.iter().map(|v| &v[k]).sum::<Q>() / &count);
            let minus = expr.inside(leaves, &center, &n, false)?;
            let plus = expr.inside(leaves, &center, &n, true)?;
            if minus == plus {
                continue;
            }
            if plus {
                tile.reverse();
            }
            let mut key = tile.clone();
            key.sort();
            unique.entry(key).or_insert(tile);
        }
    }
    if unique.is_empty() {
        return Err(Refused::geometric_verdict(no("empty-result").0));
    }
    let vertices: BTreeSet<_> = unique.values().flatten().cloned().collect();
    let mut groups: BTreeMap<Plane, Vec<Polygon>> = BTreeMap::new();
    for tile in unique.into_values() {
        groups
            .entry(Plane::new(&tile)?)
            .or_default()
            .push(split_edges(&tile, &vertices));
    }
    let mut result = Vec::new();
    for (plane, tiles) in groups {
        let mut edges = BTreeSet::new();
        for p in tiles {
            for k in 0..p.len() {
                let (a, b) = (p[k].clone(), p[(k + 1) % p.len()].clone());
                if !edges.remove(&(b.clone(), a.clone())) && !edges.insert((a, b)) {
                    return Err(no("overlapping-boundary"));
                }
            }
        }
        let mut cycles = Vec::new();
        while let Some((start, next)) = edges.first().cloned() {
            edges.remove(&(start.clone(), next.clone()));
            let mut cycle = vec![start.clone()];
            let mut current = next;
            while current != start {
                if cycle.contains(&current) {
                    return Err(Refused::geometric_verdict(no("non-manifold-result").0));
                }
                cycle.push(current.clone());
                let candidates: Vec<_> = edges
                    .iter()
                    .filter(|(a, _)| a == &current)
                    .cloned()
                    .collect();
                if candidates.len() != 1 {
                    return Err(Refused::geometric_verdict(no("non-manifold-result").0));
                }
                let e = &candidates[0];
                edges.remove(e);
                current = e.1.clone();
            }
            if cycle.len() < 3 {
                return Err(no("degenerate-boundary"));
            }
            cycles.push(simplify(cycle));
        }
        result.extend(group_cycles(cycles, &plane)?);
    }
    let vertices = result.iter().flatten().flatten().cloned().collect();
    Ok(result
        .into_iter()
        .map(|face| {
            face.into_iter()
                .map(|p| split_edges(&p, &vertices))
                .collect()
        })
        .collect())
}
fn unit() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: Binary64::new(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: Binary64::new(1.).unwrap(),
            closed: true,
        },
    }
}
// Pcurve coordinates use unit carrier axes. Interval arithmetic encloses the
// normalization; chart observations cannot influence a topology decision.
fn chart(p: [f64; 3], o: [f64; 3], x: [f64; 3], n: [f64; 3]) -> R<([Binary64; 2], f64)> {
    let x = x.map(Iv::point);
    let n = n.map(Iv::point);
    let length = |v: [Iv; 3]| crate::rounding::norm_ball(v).map_err(|_| no("chart-range"));
    let lx = length(x)?;
    let ln = length(n)?;
    let x = x.map(|v| v / lx);
    let n = n.map(|v| v / ln);
    let y = [
        x[2] * n[1] - x[1] * n[2],
        x[0] * n[2] - x[2] * n[0],
        x[1] * n[0] - x[0] * n[1],
    ];
    let d: [Iv; 3] = std::array::from_fn(|k| Iv::point(p[k]) - Iv::point(o[k]));
    let dot = |v: [Iv; 3]| d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    let u = crate::rounding::finite_ball(dot(x)).map_err(|_| no("chart-range"))?;
    let v = crate::rounding::finite_ball(dot(y)).map_err(|_| no("chart-range"))?;
    let error = if u.r == 0. && v.r == 0. {
        0.
    } else {
        (u.r + v.r).next_up()
    };
    Ok(([scalar(u.m)?, scalar(v.m)?], error))
}
pub(crate) fn build(body: Body, root: usize, faces: &[FaceBoundary]) -> R<(Body, Vec<P>)> {
    build_with_topology(body, root, faces, None)
}
/// A checked Model supplies exact shell nesting; the legacy writer retains
/// its original single-shell admission when no such topology is supplied.
pub(crate) fn build_with_topology(body: Body, root: usize, faces: &[FaceBoundary], topology: Option<(Vec<Shell>, Vec<Solid>)>) -> R<(Body, Vec<P>)> {
    let faces=faces.iter().map(|f|f.iter().map(|l|l.iter().map(wonky_geom::model::algebraic::lift).collect()).collect()).collect::<Vec<_>>();
    let (body,points)=build_radical_with_topology(body,root,&faces,topology)?;
    let points=points.iter().map(|p|wonky_geom::model::algebraic::rational(p).ok_or_else(||no("radical/rational-consumer"))).collect::<R<_>>()?;
    Ok((body,points))
}
pub(crate) fn build_radical_with_topology(mut body: Body, root: usize, faces: &[Vec<Vec<wonky_geom::model::RPoint>>], topology: Option<(Vec<Shell>, Vec<Solid>)>) -> R<(Body, Vec<wonky_geom::model::RPoint>)> {
    use wonky_geom::model::algebraic::{self as exact, RPoint};
    let rat=|p:&RPoint|exact::rational(p).ok_or_else(||no("radical/rational-consumer"));
    let rnormal=|lp:&Vec<RPoint>| { let mut n=std::array::from_fn(|_|wonky_curve::radical::Radical::default()); for k in 1..lp.len()-1 { let c=exact::cross(&exact::sub(&lp[k],&lp[0]),&exact::sub(&lp[k+1],&lp[0])); for j in 0..3 {n[j]=&n[j]+&c[j];} } n };
    let rdirection=|p:&RPoint| { let scale=p.iter().map(|x|x.abs()).max().unwrap(); if scale.is_zero() {return Err(no("zero-direction"));} exact::observe(&p.clone().map(|x|x/&scale)).map_err(|e|no(e.0)) };

    let construction = &body.constructions[root];
    let observations = construction.operation == (Operation::AffineTransform {})
        || construction.replayed_planar_boundary();
    let mut exact_vertices = Vec::new();
    let frame = body.constructions[root].frame;
    let provenance = Provenance::Construction {
        node: NodeId(root as u32),
    };
    let mut vertex_ids = BTreeMap::new();
    let mut edge_ids = BTreeMap::new();
    for face in faces {
        let polygon = &face[0];
        let sid = SurfaceId(body.surfaces.len() as u32);
        let n = if observations {
            rdirection(&rnormal(polygon))?
        } else {
            direction(&rat(&rnormal(polygon))?)?
        };
        let axis = (0..3).min_by_key(|&k| usize::from(n[k] != 0.)).unwrap();
        let e = std::array::from_fn(|k| if k == axis { Q::one() } else { Q::zero() });
        let x = if observations {
            // A coordinate cross product keeps cache axes exactly perpendicular.
            cross(&e, &n.map(q)).map(|v| v.to_f64().unwrap())
        } else {
            direction(&cross(&e, &n.map(q)))?
        };
        let observe = |p: &RPoint| {
            if observations {
                exact::observe(p).map_err(|e|no(e.0))
            } else {
                point(&rat(p)?)
            }
        };
        let o = observe(&polygon[0])?;
        body.surfaces.push(Surface {
            frame,
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: vector(o)?,
                normal: vector(n)?,
                x: vector(x)?,
            },
        });
        let mut loops = Vec::new();
        for (loop_index, polygon) in face.iter().enumerate() {
            let mut ids = Vec::new();
            for p in polygon {
                let id = if let Some(i) = vertex_ids.get(p) {
                    *i
                } else {
                    let id = body.vertices.len() as u32;
                    body.vertices.push(Vertex {
                        point: vector(observe(p)?)?,
                        frame,
                        provenance: provenance.clone(),
                    });
                    exact_vertices.push(p.clone());
                    vertex_ids.insert(p.clone(), id);
                    id
                };
                ids.push(id);
            }
            let mut coedges = Vec::new();
            for k in 0..ids.len() {
                let (a, b) = (ids[k], ids[(k + 1) % ids.len()]);
                let pair = (a.min(b), a.max(b));
                let edge = if let Some(i) = edge_ids.get(&pair) {
                    *i
                } else {
                    let i = body.edges.len() as u32;
                    body.curves.push(Curve {
                        frame,
                        provenance: provenance.clone(),
                        geometry: if observations {
                            CurveGeometry::ConstructionLine { edge: EdgeId(i) }
                        } else {
                            CurveGeometry::Line {
                                a: body.vertices[pair.0 as usize].point,
                                b: body.vertices[pair.1 as usize].point,
                            }
                        },
                        domain: unit(),
                        supports: vec![],
                    });
                    body.edges.push(Edge {
                        curve: CurveId(i),
                        domain: unit(),
                        vertices: vec![VertexId(pair.0), VertexId(pair.1)],
                    });
                    edge_ids.insert(pair, i);
                    i
                };
                let ca = chart(
                    body.vertices[pair.0 as usize].point.map(|v| v.get()),
                    o,
                    x,
                    n,
                )?;
                let cb = chart(
                    body.vertices[pair.1 as usize].point.map(|v| v.get()),
                    o,
                    x,
                    n,
                )?;
                let pc = PcurveId(body.pcurves.len() as u32);
                body.pcurves.push(Pcurve {
                    curve: CurveId(edge),
                    surface: sid,
                    domain: unit(),
                    geometry: PcurveGeometry::Samples {
                        parameters: vec![scalar(0.)?, scalar(1.)?],
                        points: vec![ca.0, cb.0],
                        error: Bound::Estimated {
                            estimate: Estimate {
                                magnitude: scalar(ca.1.max(cb.1))?,
                            },
                        },
                    },
                });
                body.curves[edge as usize].supports.push(Support {
                    surface: sid,
                    pcurve: pc,
                });
                coedges.push(CoedgeId(body.coedges.len() as u32));
                body.coedges.push(Coedge {
                    edge: EdgeId(edge),
                    forward: a == pair.0,
                    pcurve: pc,
                });
            }
            let lp = LoopId(body.loops.len() as u32);
            body.loops.push(Loop {
                outer: loop_index == 0,
                coedges,
            });
            loops.push(lp);
        }
        body.faces.push(Face {
            surface: sid,
            forward: true,
            loops,
        });
    }
    let mut owners: BTreeMap<u32, Vec<(usize, bool)>> = BTreeMap::new();
    for (i, f) in body.faces.iter().enumerate() {
        for c in f
            .loops
            .iter()
            .flat_map(|l| &body.loops[l.0 as usize].coedges)
        {
            let co = &body.coedges[c.0 as usize];
            owners.entry(co.edge.0).or_default().push((i, co.forward));
        }
    }
    if owners.values().any(|u| u.len() != 2 || u[0].1 == u[1].1) {
        return Err(Refused::geometric_verdict(no("non-manifold-result").0));
    }
    let mut reached = BTreeSet::from([0]);
    let mut todo = vec![0];
    while let Some(i) = todo.pop() {
        for uses in owners.values().filter(|u| u.iter().any(|x| x.0 == i)) {
            for (j, _) in uses {
                if reached.insert(*j) {
                    todo.push(*j);
                }
            }
        }
    }
    if topology.is_none() && reached.len() != body.faces.len() {
        return Err(no("multiple-shells-unsupported"));
    }
    // A closed edge link alone misses vertex pinches. Every vertex's incident
    // faces must form exactly one cyclic link, in addition to opposite edge use.
    for v in 0..body.vertices.len() as u32 {
        let mut links: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (e, uses) in &owners {
            if body.edges[*e as usize].vertices.contains(&VertexId(v)) {
                let (a, b) = (uses[0].0, uses[1].0);
                links.entry(a).or_default().push(b);
                links.entry(b).or_default().push(a);
            }
        }
        if links.is_empty() || links.values().any(|v| v.len() != 2) {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
        let first = *links.keys().next().unwrap();
        let mut seen = BTreeSet::from([first]);
        let mut todo = vec![first];
        while let Some(i) = todo.pop() {
            for &j in &links[&i] {
                if seen.insert(j) {
                    todo.push(j);
                }
            }
        }
        if seen.len() != links.len() {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
    }
    if let Some((shells, solids)) = topology {
        body.shells = shells;
        body.solids = solids;
    } else {
        body.shells.push(Shell {
            faces: (0..body.faces.len()).map(|i| FaceId(i as u32)).collect(),
        });
        body.solids.push(Solid { shells: vec![ShellId(0)] });
    }
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok((body, exact_vertices))
}
pub(crate) fn empty(mut body: Body) -> Body {
    body.vertices.clear();
    body.curves.clear();
    body.surfaces.clear();
    body.pcurves.clear();
    body.edges.clear();
    body.coedges.clear();
    body.loops.clear();
    body.faces.clear();
    body.shells.clear();
    body.solids.clear();
    body.facts.clear();
    body.budgets.clear();
    body
}
pub(crate) fn reconstruct(body: Body, root: usize) -> R<(Body, Vec<P>)> {
    let target = Chart::new(&body, body.constructions[root].frame)?;
    let mut leaves = Vec::new();
    let e = expression(&body, root, &target, &mut leaves, &mut 512)?;
    let polygons = boundary(&leaves, &e)?;
    build(empty(body), root, &polygons)
}
/// The exact Model of an audited body of this family (boolean3d strand G1;
/// dark: no host path calls it), from the replayed plane arrangement: the
/// rational boundary polygons in the result frame, never the WC0 caches. A
/// face carrier is the plane of its outer cycle (outward, as the arrangement
/// orients it), with the provenance of the lowest leaf face on that plane.
pub(crate) fn model(body: &Body, placement: wonky_geom::frame::Frame) -> R<wonky_geom::model::Model> {
    if let Some((mut inner, _)) = crate::pattern::unplace(body) {
        while let Some((next, _)) = crate::pattern::unplace(&inner) { inner = next; }
        return model(&inner, placement);
    }
    model_at(body, root(body)?, placement)
}
pub(crate) fn model_at(body: &Body, root: usize, placement: wonky_geom::frame::Frame) -> R<wonky_geom::model::Model> {
    use wonky_geom::model::{polyhedron, Label, Plane3, PolyFace, Provenance, VertexDef};
    let target = Chart::new(body, body.constructions[root].frame)?;
    let mut leaves = Vec::new();
    let e = expression(body, root, &target, &mut leaves, &mut 512)?;
    let mut faces = vec![];
    // A leaf already carries audited boundary topology. Preserve its tangent
    // subdivisions; arrangement tiling is needed only for Boolean expressions.
    let boundary_faces=match &e {Expr::Leaf(i)=>leaves[*i].model_faces.iter().cloned().map(|lp|vec![lp]).collect(),Expr::Op(_,_)=>boundary(&leaves,&e)?};
    for face in boundary_faces {
        let plane = Plane::new(&face[0])?;
        let key = plane.unoriented();
        let (node, slot) = leaves
            .iter()
            .flat_map(|l| l.planes.iter().enumerate().map(move |(i, p)| (l.node, i, p)))
            .filter(|(_, _, p)| p.unoriented() == key)
            .map(|(node, i, _)| (node, i))
            .min()
            .ok_or_else(|| no("model-carrier-provenance"))?;
        // Chart axis e_k x n, with e_k the first coordinate axis perpendicular to n (else e_0).
        let k = (0..3).find(|&k| plane.n[k].is_zero()).unwrap_or(0);
        let axis: P = std::array::from_fn(|i| if i == k { Q::one() } else { Q::zero() });
        faces.push(PolyFace {
            carrier: Plane3 { o: face[0][0].clone(), x: cross(&axis, &plane.n), n: plane.n.clone() },
            forward: true,
            loops: face.iter().map(|c| c.iter().cloned().map(VertexDef::Rational).collect()).collect(),
            provenance: Provenance { node: node as u32, slot: slot as u32 },
        });
    }
    polyhedron(placement, Label::Exact, root as u32, faces)
        .and_then(wonky_geom::model::Draft::check)
        .map_err(|e| Refused(e.0.into()))
}
pub fn audit(body: &Body) -> R<Audited> {
    let root = root(body)?;
    let (rebuilt, vertices) = reconstruct(body.clone(), root)?;
    if rebuilt != *body {
        return Err(no("boundary-not-construction"));
    }
    let frame =
        Placement::from_frames(body, body.vertices[0].frame).map_err(|_| no("frame-range"))?;
    let face_loops = body
        .loops
        .iter()
        .map(|lp| {
            lp.coedges
                .iter()
                .map(|c| {
                    let co = &body.coedges[c.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    let arrangement = crate::planar_geometry::Arrangement::new(vertices, &frame)?;
    let a = Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels: [0.; 2],
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        orthogonal: None,
        rounded: None,
        corner: None,
        arrangement: Some(arrangement),
        chamfer: None,
        arcs: None,
    };
    if !a
        .arrangement
        .as_ref()
        .unwrap()
        .volume6(&a.face_loops)?
        .is_positive()
    {
        return Err(no("nonpositive-volume"));
    }
    Ok(a)
}
/// Compose a placement onto every authoritative source chart and replay the
/// original Boolean recipe. Display vertices never seed the moved geometry.
pub(crate) fn transform(a: &Audited, frame: crate::affine::Affine) -> R<Body> {
    let mut body = empty(a.body.clone());
    body.key.revision = body.key.revision.checked_add(1).ok_or_else(|| no("revision-range"))?;
    let post = crate::placement::Post::Interpreter(frame);
    let mut moved = BTreeMap::new();
    for node in &mut body.constructions {
        if matches!(node.operation, Operation::Sketch {} | Operation::Boolean {}) {
            let base = node.frame;
            node.frame = if let Some(&id) = moved.get(&base.0) { id } else {
                let id = FrameId(body.frames.len() as u32);
                body.frames.push(post.frame(base)?); moved.insert(base.0, id); id
            };
        }
    }
    let root = body.constructions.len() - 1;
    Ok(reconstruct(body, root)?.0)
}

pub fn boolean(key: BodyKey, op: u8, bodies: &[Audited]) -> R<Vec<Body>> {
    if op > 2 || bodies.len() < 2 {
        return Err(no("boolean-arguments"));
    }
    let (out, root) = source_dag(key, op, bodies)?;
    Ok(vec![reconstruct(out, root)?.0])
}
pub(crate) fn source_dag(key: BodyKey, op: u8, bodies: &[Audited]) -> R<(Body, usize)> {
    source_dag_leaves(key, op, &bodies.iter().map(DagLeaf::Planar).collect::<Vec<_>>())
}
/// One operand of a general Boolean DAG: a planar leaf (replayed by the
/// plane arrangement), or any other audited operand by its source grammar
/// (`prism_stack::source_kind`): its own frames and constructions under one
/// rule-7 node, which Model replay rebuilds and audits from that DAG alone.
pub(crate) enum DagLeaf<'a> {
    Planar(&'a Audited),
    Source { kind: u32, body: &'a Body },
}
/// Append a body's frames with their parent and base references moved by
/// `offset`.
fn append_frames(out: &mut Body, frames: &[Frame]) -> u32 {
    let offset = out.frames.len() as u32;
    out.frames.extend(frames.iter().cloned().map(|mut f| {
        match &mut f {
            Frame::Interpreter { parent, .. } | Frame::Rigid { parent, .. } => parent.0 += offset,
            Frame::AffineImage { base, .. } | Frame::InterpreterImage { base, .. } | Frame::RationalImage { base, .. } => base.0 += offset,
            Frame::Source { .. } => {}
        }
        f
    }));
    offset
}
pub(crate) fn source_dag_leaves(key: BodyKey, op: u8, leaves: &[DagLeaf]) -> R<(Body, usize)> {
    let template = match leaves.first().ok_or_else(|| no("boolean-arguments"))? {
        DagLeaf::Planar(a) => &a.body,
        DagLeaf::Source { body, .. } => body,
    };
    let mut out = empty(template.clone());
    out.key = key;
    out.frames.clear();
    out.constructions.clear();
    let mut parents = Vec::new();
    let mut result_frame = None;
    for leaf in leaves {
        let a = match leaf {
            DagLeaf::Planar(a) => *a,
            DagLeaf::Source { kind, body } => {
                let offset = append_frames(&mut out, &body.frames);
                // The operand's construction root frame (its vertex caches may
                // live in a binary64 rigid chart without an exact placement).
                let fid = FrameId(body.constructions.last().ok_or_else(|| no("source-frame"))?.frame.0 + offset);
                result_frame.get_or_insert(fid);
                let node_offset = out.constructions.len() as u32;
                out.constructions.extend(body.constructions.iter().cloned().map(|mut n| {
                    n.frame.0 += offset;
                    for p in &mut n.parents {
                        p.0 += node_offset;
                    }
                    n
                }));
                let last = NodeId(out.constructions.len().checked_sub(1).ok_or_else(|| no("source-layout"))? as u32);
                parents.push(NodeId(out.constructions.len() as u32));
                out.constructions.push(Construction {
                    operation: Operation::Boolean {},
                    rule_version: 7,
                    parents: vec![last],
                    // Frame start relative to this node's own frame: copying
                    // the DAG into a later Boolean shifts both together.
                    parameters: [*kind as f64, (fid.0 - offset) as f64, body.frames.len() as f64, body.constructions.len() as f64]
                        .into_iter().map(scalar).collect::<R<_>>()?,
                    frame: fid,
                });
                continue;
            }
        };
        // Rounded chamfer witnesses cannot become authoritative leaf inputs.
        if a.chamfer.is_some() {
            return Err(no("chamfer-operand-unsupported"));
        }
        if a.arcs.is_some() || a.rounded.is_some() || a.corner.is_some() {
            return Err(no("curved-operand"));
        }
        let offset = append_frames(&mut out, &a.body.frames);
        let fid = FrameId(a.body.vertices[0].frame.0 + offset);
        result_frame.get_or_insert(fid);
        if candidate(&a.body) || crate::model_boolean::candidate(&a.body) {
            let node_offset = out.constructions.len() as u32;
            parents.push(NodeId(root(&a.body)? as u32 + node_offset));
            out.constructions
                .extend(a.body.constructions.iter().cloned().map(|mut n| {
                    n.frame.0 += offset;
                    for p in &mut n.parents {
                        p.0 += node_offset;
                    }
                    n
                }));
        } else {
            let source = a.body.frames.iter().position(|f| matches!(f, Frame::Source { .. })).ok_or_else(|| no("source-frame"))?;
            let mut partitions = Vec::new();
            if let Some(cells) = &a.orthogonal {
                // Coalesce adjacent cells without changing their exact union.
                let mut boxes = cells.boxes.clone();
                loop {
                    let pair = (0..boxes.len()).find_map(|i| (0..i).find_map(|j| (0..3).find_map(|k| {
                        ((0..3).filter(|&v| v != k).all(|v| boxes[i][0][v] == boxes[j][0][v] && boxes[i][1][v] == boxes[j][1][v])
                            && (boxes[i][0][k] == boxes[j][1][k] || boxes[j][0][k] == boxes[i][1][k])).then_some((i,j,k))
                    })));
                    let Some((i,j,k)) = pair else { break; };
                    boxes[j][0][k] = boxes[j][0][k].min(boxes[i][0][k]);
                    boxes[j][1][k] = boxes[j][1][k].max(boxes[i][1][k]);
                    boxes.remove(i);
                }
                for [lo,hi] in boxes {
                    let vertices: Vec<_> = (0..8).map(|i| std::array::from_fn::<_,3,_>(|k| if i & (1<<k) == 0 {lo[k]} else {hi[k]})).collect();
                    let cycles = [[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
                    let mut data = vec![8.,6.];
                    data.extend(vertices.into_iter().flatten());
                    for c in cycles { data.push(4.); data.extend(c.map(|v| v as f64)); }
                    partitions.push(data);
                }
            } else {
                if a.body.faces.iter().any(|f| f.loops.len() != 1) || a.body.shells.len() != 1 { return Err(no("leaf-holes-unsupported")); }
                let mut data = vec![a.body.vertices.len() as f64, a.face_loops.len() as f64];
                data.extend(a.body.vertices.iter().flat_map(|v| v.point.map(|x| x.get())));
                for face in &a.face_loops { data.push(face.len() as f64); data.extend(face.iter().map(|&v| v as f64)); }
                partitions.push(data);
            }
            let mut nodes = Vec::new();
            for data in partitions {
                let input = NodeId(out.constructions.len() as u32);
                out.constructions.push(Construction { operation: Operation::Interpreter {}, rule_version: 1, parents: vec![], parameters: data.into_iter().map(scalar).collect::<R<_>>()?, frame: FrameId(source as u32 + offset) });
                let node = NodeId(out.constructions.len() as u32);
                out.constructions.push(Construction { operation: Operation::Sketch {}, rule_version: 1, parents: vec![input], parameters: vec![], frame: fid });
                nodes.push(node);
            }
            if nodes.len() == 1 { parents.push(nodes[0]); } else {
                let node = NodeId(out.constructions.len() as u32);
                out.constructions.push(Construction { operation: Operation::Boolean {}, rule_version: 1, parents: nodes, parameters: vec![scalar(0.)?,scalar(2.)?], frame: fid });
                parents.push(node);
            }
        }
    }
    let root = out.constructions.len();
    out.constructions.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents,
        parameters: vec![scalar(op as f64)?, scalar(2.)?],
        frame: result_frame.unwrap(),
    });
    Ok((out, root))
}

#[cfg(test)]
mod expression_tests {
    use super::*;
    #[test]
    fn unknown_boolean_expression_refuses_instead_of_certifying_outside() {
        let zero = [q(0.), q(0.), q(0.)];
        for kind in [3, 255] {
            let error = Expr::Op(kind, vec![]).inside(&[], &zero, &zero, true).unwrap_err();
            assert_eq!(error.0, "planar-boolean/boolean-operation");
        }
    }
}

/// Exact admission for the concave leaves motion enabled in the family path.
/// Reuse the source replay's half-space decision, never wire observations.
pub(crate) fn requires_general(a: &Audited) -> R<bool> {
    // This complete family already carries rectilinear concavity and holes.
    if a.orthogonal.is_some() { return Ok(false); }
    if a.arcs.is_some() || a.rounded.is_some() || a.corner.is_some() || a.chamfer.is_some() {
        return Ok(false);
    }
    if a.body.shells.len() > 1 || a.body.faces.iter().any(|f| f.loops.len() > 1) {
        return Ok(true);
    }
    let (body, root) = source_dag(a.body.key.clone(), 0, &[a.clone()])?;
    let target = Chart::new(&body, body.constructions[root].frame)?;
    let mut leaves = Vec::new();
    // source_dag wraps this one operand; it is not an n-ary Boolean.
    expression(&body, body.constructions[root].parents[0].0 as usize, &target, &mut leaves, &mut 512)?;
    Ok(leaves.iter().any(|l| !l.convex))
}
