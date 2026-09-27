//! Exact plane arrangement for Boolean expressions of convex planar leaves.
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
type Polygon = Vec<P>;
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
    faces: Vec<Polygon>,
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
    fn inside(&self, leaves: &[Leaf], p: &P, direction: &P, positive: bool) -> bool {
        match self {
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
            Self::Op(0, es) => es.iter().any(|e| e.inside(leaves, p, direction, positive)),
            Self::Op(1, es) => {
                es[0].inside(leaves, p, direction, positive)
                    && !es[1..]
                        .iter()
                        .any(|e| e.inside(leaves, p, direction, positive))
            }
            Self::Op(2, es) => es.iter().all(|e| e.inside(leaves, p, direction, positive)),
            _ => false,
        }
    }
}
fn root(body: &Body) -> R<usize> {
    match body.vertices.first().map(|v| &v.provenance) {
        Some(Provenance::Construction { node }) => Ok(node.0 as usize),
        _ => Err(no("no-construction")),
    }
}
pub fn candidate(body: &Body) -> bool {
    root(body)
        .ok()
        .and_then(|r| body.constructions.get(r))
        .is_some_and(|n| n.operation == (Operation::Boolean {}) && n.parameters.len() == 2)
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
        let apply = |p, t| -> R<P> {
            Ok(map
                .apply_exact(p, 1., t)
                .map_err(|_| no("frame-range"))?
                .map(|e| e.into_iter().map(q).sum()))
        };
        let origin = apply([0.; 3], true)?;
        let columns = [
            apply([1., 0., 0.], false)?,
            apply([0., 1., 0.], false)?,
            apply([0., 0., 1.], false)?,
        ];
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
fn leaf(body: &Body, n: &Construction, target: &Chart) -> R<Leaf> {
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
        let plane = Plane::new(&polygon)?;
        if vertices.iter().any(|p| plane.side(p).is_positive()) {
            return Err(no("non-convex-leaf"));
        }
        // A convex leaf face must follow its hull, not a crossing star cycle.
        for k in 0..count {
            let a = &polygon[k];
            let b = &polygon[(k + 1) % count];
            if polygon
                .iter()
                .any(|p| dot(&cross(&sub(b, a), &sub(p, a)), &plane.n).is_negative())
            {
                return Err(no("non-convex-face"));
            }
        }
        faces.push(polygon);
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
    Ok(Leaf { faces, planes })
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
    if n.operation == (Operation::Sketch {}) {
        let l = leaf(body, n, target)?;
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
fn boundary(leaves: &[Leaf], expr: &Expr) -> R<Vec<Polygon>> {
    let planes: BTreeSet<_> = leaves
        .iter()
        .flat_map(|l| l.planes.iter().map(Plane::unoriented))
        .collect();
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
            let minus = expr.inside(leaves, &center, &n, false);
            let plus = expr.inside(leaves, &center, &n, true);
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
        return Err(no("empty-result"));
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
        while let Some((start, next)) = edges.first().cloned() {
            edges.remove(&(start.clone(), next.clone()));
            let mut cycle = vec![start.clone()];
            let mut current = next;
            while current != start {
                if cycle.contains(&current) {
                    return Err(no("non-manifold-result"));
                }
                cycle.push(current.clone());
                let candidates: Vec<_> = edges
                    .iter()
                    .filter(|(a, _)| a == &current)
                    .cloned()
                    .collect();
                if candidates.len() != 1 {
                    return Err(no("non-manifold-result"));
                }
                let e = &candidates[0];
                edges.remove(e);
                current = e.1.clone();
            }
            if cycle.len() < 3 {
                return Err(no("degenerate-boundary"));
            }
            if !dot(&normal(&cycle), &plane.n).is_positive() {
                return Err(no("face-hole-unsupported"));
            }
            result.push(simplify(cycle));
        }
    }
    let vertices = result.iter().flatten().cloned().collect();
    Ok(result
        .into_iter()
        .map(|p| split_edges(&p, &vertices))
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
fn build(mut body: Body, root: usize, polygons: &[Polygon]) -> R<(Body, Vec<P>)> {
    let observations = body.constructions[root].parameters[1].get() == 2.;
    let mut exact_vertices = Vec::new();
    let frame = body.constructions[root].frame;
    let provenance = Provenance::Construction {
        node: NodeId(root as u32),
    };
    let mut vertex_ids = BTreeMap::new();
    let mut edge_ids = BTreeMap::new();
    for polygon in polygons {
        let sid = SurfaceId(body.surfaces.len() as u32);
        let n = if observations {
            crate::planar_geometry::direction(&normal(polygon))?
        } else {
            direction(&normal(polygon))?
        };
        let axis = (0..3).min_by_key(|&k| usize::from(n[k] != 0.)).unwrap();
        let e = std::array::from_fn(|k| if k == axis { Q::one() } else { Q::zero() });
        let x = if observations {
            // A coordinate cross product keeps cache axes exactly perpendicular.
            cross(&e, &n.map(q)).map(|v| v.to_f64().unwrap())
        } else {
            direction(&cross(&e, &n.map(q)))?
        };
        let observe = |p: &P| {
            if observations {
                crate::planar_geometry::point(p)
            } else {
                point(p)
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
            outer: true,
            coedges,
        });
        body.faces.push(Face {
            surface: sid,
            forward: true,
            loops: vec![lp],
        });
    }
    let mut owners: BTreeMap<u32, Vec<(usize, bool)>> = BTreeMap::new();
    for (i, f) in body.faces.iter().enumerate() {
        for c in &body.loops[f.loops[0].0 as usize].coedges {
            let co = &body.coedges[c.0 as usize];
            owners.entry(co.edge.0).or_default().push((i, co.forward));
        }
    }
    if owners.values().any(|u| u.len() != 2 || u[0].1 == u[1].1) {
        return Err(no("non-manifold-result"));
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
    if reached.len() != body.faces.len() {
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
            return Err(no("non-manifold-result"));
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
            return Err(no("non-manifold-result"));
        }
    }
    body.shells.push(Shell {
        faces: (0..body.faces.len()).map(|i| FaceId(i as u32)).collect(),
    });
    body.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    body.clone()
        .check()
        .map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok((body, exact_vertices))
}
fn empty(mut body: Body) -> Body {
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
fn reconstruct(body: Body, root: usize) -> R<(Body, Vec<P>)> {
    let target = Chart::new(&body, body.constructions[root].frame)?;
    let mut leaves = Vec::new();
    let e = expression(&body, root, &target, &mut leaves, &mut 512)?;
    let polygons = boundary(&leaves, &e)?;
    build(empty(body), root, &polygons)
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
        .faces
        .iter()
        .map(|f| {
            body.loops[f.loops[0].0 as usize]
                .coedges
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
        .volume6(&a.face_loops)
        .is_positive()
    {
        return Err(no("nonpositive-volume"));
    }
    Ok(a)
}
pub fn boolean(key: BodyKey, op: u8, bodies: &[Audited]) -> R<Vec<Body>> {
    if op > 2 || bodies.len() < 2 {
        return Err(no("boolean-arguments"));
    }
    let mut out = empty(bodies[0].body.clone());
    out.key = key;
    out.frames.clear();
    out.constructions.clear();
    let mut parents = Vec::new();
    let mut result_frame = None;
    for a in bodies {
        // Rounded chamfer witnesses cannot become authoritative leaf inputs.
        if a.chamfer.is_some() {
            return Err(no("chamfer-operand-unsupported"));
        }
        if a.arcs.is_some() || a.rounded.is_some() || a.corner.is_some() {
            return Err(no("curved-operand"));
        }
        let offset = out.frames.len() as u32;
        out.frames
            .extend(a.body.frames.iter().cloned().map(|mut f| {
                match &mut f {
                    Frame::Interpreter { parent, .. } | Frame::Rigid { parent, .. } => {
                        parent.0 += offset
                    }
                    Frame::AffineImage { base, .. } => base.0 += offset,
                    _ => {}
                }
                f
            }));
        let fid = FrameId(a.body.vertices[0].frame.0 + offset);
        result_frame.get_or_insert(fid);
        if candidate(&a.body) {
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
            if a.body.faces.iter().any(|f| f.loops.len() != 1) || a.body.shells.len() != 1 {
                return Err(no("leaf-holes-unsupported"));
            }
            let mut data = vec![a.body.vertices.len() as f64, a.face_loops.len() as f64];
            data.extend(
                a.body
                    .vertices
                    .iter()
                    .flat_map(|v| v.point.map(|x| x.get())),
            );
            for face in &a.face_loops {
                data.push(face.len() as f64);
                data.extend(face.iter().map(|&v| v as f64));
            }
            let source = a
                .body
                .frames
                .iter()
                .position(|f| matches!(f, Frame::Source { .. }))
                .ok_or_else(|| no("source-frame"))?;
            let input = NodeId(out.constructions.len() as u32);
            out.constructions.push(Construction {
                operation: Operation::Interpreter {},
                rule_version: 1,
                parents: vec![],
                parameters: data.into_iter().map(scalar).collect::<R<_>>()?,
                frame: FrameId(source as u32 + offset),
            });
            let node = NodeId(out.constructions.len() as u32);
            out.constructions.push(Construction {
                operation: Operation::Sketch {},
                rule_version: 1,
                parents: vec![input],
                parameters: vec![],
                frame: fid,
            });
            parents.push(node);
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
    Ok(vec![reconstruct(out, root)?.0])
}
