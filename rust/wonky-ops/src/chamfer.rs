//! Equal face setbacks at supporting orthogonal edges of rectilinear solids.
//! Intersections and all incidence/feasibility decisions use exact rationals of
//! the interpreter binary64 inputs. WC0 holds rounded display geometry, bound
//! by replay of Intersection rule 2 (parent construction, width, edge indices).
//! These rounded witnesses must never become inputs to geometric predicates.
use crate::{
    affine::Affine,
    orthogonal,
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::*;
use wonky_num::ball::{Iv, Scalar};

type R<T> = std::result::Result<T, Refused>;
type V = [Q; 3];
fn no(s: &str) -> Refused {
    Refused(format!("chamfer/{s}"))
}
fn q(x: f64) -> Q {
    Q::from_float(x).expect("finite WC0 input")
}
fn dot(a: &V, b: &V) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn sub(a: &V, b: &V) -> V {
    std::array::from_fn(|k| &a[k] - &b[k])
}
fn cross(a: &V, b: &V) -> V {
    std::array::from_fn(|k| &a[(k + 1) % 3] * &b[(k + 2) % 3] - &a[(k + 2) % 3] * &b[(k + 1) % 3])
}
fn f(x: &Q) -> R<f64> {
    x.to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("numeric-range"))
}
fn ball(x: &Q) -> R<Iv> {
    let m = f(x)?;
    let error = (x - q(m)).abs();
    let r = if error.is_zero() {
        0.
    } else {
        f(&error)?.next_up()
    };
    crate::rounding::finite_ball(Iv { m, r }).map_err(|_| no("observation-range"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn v(p: &V) -> R<Vector3> {
    Ok([b(f(&p[0])?)?, b(f(&p[1])?)?, b(f(&p[2])?)?])
}
fn unit() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: b(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: b(1.).unwrap(),
            closed: true,
        },
    }
}
fn axis(n: &V) -> bool {
    n.iter().filter(|x| x.abs() == q(1.)).count() == 1
        && n.iter().all(|x| x.is_zero() || x.abs() == q(1.))
}
fn metric(frame: Affine) -> R<()> {
    let x = frame.x.map(q);
    let z = frame.z.map(q);
    if !axis(&x) || !axis(&z) || !dot(&x, &z).is_zero() {
        return Err(no("non-axis-metric-unimplemented"));
    }
    Ok(())
}
#[derive(Clone, Debug)]
struct Face {
    normal: V,
    loops: Vec<Vec<V>>,
}
#[derive(Clone, Debug)]
pub(crate) struct Chamfered {
    faces: Vec<Face>,
    pub points: Vec<V>,
}
fn source_faces(a: &Audited) -> R<Vec<Face>> {
    a.body
        .faces
        .iter()
        .map(|face| {
            let SurfaceGeometry::Plane { normal, .. } =
                &a.body.surfaces[face.surface.0 as usize].geometry
            else {
                return Err(no("requires-planar-faces"));
            };
            let n = normal.map(|x| q(x.get()));
            if !face.forward || !axis(&n) {
                return Err(no("non-orthogonal-support-unimplemented"));
            }
            let loops = face
                .loops
                .iter()
                .map(|l| {
                    a.body.loops[l.0 as usize]
                        .coedges
                        .iter()
                        .map(|c| {
                            let co = &a.body.coedges[c.0 as usize];
                            let edge = &a.body.edges[co.edge.0 as usize];
                            a.body.vertices[edge.vertices[usize::from(!co.forward)].0 as usize]
                                .point
                                .map(|x| q(x.get()))
                        })
                        .collect()
                })
                .collect();
            Ok(Face { normal: n, loops })
        })
        .collect()
}
fn area_vector(lp: &[V]) -> V {
    let mut n = std::array::from_fn(|_| Q::zero());
    for (a, b) in lp.iter().zip(lp.iter().cycle().skip(1)) {
        let c = cross(a, b);
        for k in 0..3 {
            n[k] += &c[k];
        }
    }
    n
}
fn clip(faces: &mut Vec<Face>, normal: V, offset: Q) -> R<()> {
    let side = |p: &V| dot(&normal, p) - &offset;
    let mut boundary = Vec::<(V, V)>::new();
    for face in faces.iter_mut() {
        for (li, lp) in face.loops.iter_mut().enumerate() {
            let signs: Vec<_> = lp.iter().map(side).collect();
            let transitions = (0..lp.len())
                .filter(|&i| signs[i].is_positive() != signs[(i + 1) % lp.len()].is_positive())
                .count();
            if transitions > 2 {
                return Err(no("disconnected-face-clip-unimplemented"));
            }
            if !signs.iter().any(|x| x.is_positive()) {
                continue;
            }
            // Removing or touching a hole can change genus; do not bridge it.
            if li != 0 {
                return Err(no("hole-contact-unimplemented"));
            }
            let mut out = Vec::new();
            for i in 0..lp.len() {
                let j = (i + 1) % lp.len();
                let (a, c) = (&lp[i], &lp[j]);
                let (sa, sc) = (&signs[i], &signs[j]);
                if !sa.is_positive() {
                    out.push(a.clone());
                }
                if (sa.is_positive() && sc.is_negative()) || (sa.is_negative() && sc.is_positive())
                {
                    let t = sa / (sa - sc);
                    out.push(std::array::from_fn(|k| &a[k] + &t * (&c[k] - &a[k])));
                }
            }
            out.dedup();
            if out.len() > 1 && out.first() == out.last() {
                out.pop();
            }
            if out.len() < 3 || dot(&area_vector(&out), &face.normal) <= Q::zero() {
                return Err(no("face-consumed-or-overlap"));
            }
            for i in 0..out.len() {
                let j = (i + 1) % out.len();
                if side(&out[i]).is_zero() && side(&out[j]).is_zero() {
                    boundary.push((out[j].clone(), out[i].clone()));
                }
            }
            *lp = out;
        }
    }
    if boundary.len() < 3 {
        return Err(no("empty-or-overlapping-cut"));
    }
    let (start, mut end) = boundary.remove(0);
    let mut cycle = vec![start.clone()];
    while end != start {
        cycle.push(end.clone());
        let matching: Vec<_> = boundary
            .iter()
            .enumerate()
            .filter(|(_, e)| e.0 == end)
            .map(|(i, _)| i)
            .collect();
        if matching.len() != 1 {
            return Err(no("non-manifold-cut"));
        }
        end = boundary.remove(matching[0]).1;
    }
    if !boundary.is_empty() || cycle.len() < 3 || dot(&area_vector(&cycle), &normal) <= Q::zero() {
        return Err(no("multiple-cut-loops-unimplemented"));
    }
    faces.push(Face {
        normal,
        loops: vec![cycle],
    });
    Ok(())
}
fn geometry(a: &Audited, edges: &[usize], width: f64) -> R<Chamfered> {
    if !width.is_finite() || width <= 0. {
        return Err(no("invalid-width"));
    }
    if edges.is_empty() {
        return Err(no("empty-selection"));
    }
    if a.orthogonal.is_none() || a.body.shells.len() != 1 {
        return Err(no("requires-orthogonal-single-shell"));
    }
    metric(a.frame.as_affine()?)?;
    let mut faces = source_faces(a)?;
    let mut owners = vec![Vec::new(); a.body.edges.len()];
    for (i, face) in a.body.faces.iter().enumerate() {
        for l in &face.loops {
            for c in &a.body.loops[l.0 as usize].coedges {
                owners[a.body.coedges[c.0 as usize].edge.0 as usize].push(i);
            }
        }
    }
    let selected: BTreeSet<_> = edges.iter().copied().collect();
    let mut incident = BTreeMap::<u32, Vec<usize>>::new();
    let mut cuts = vec![];
    for &edge in &selected {
        let e = a.body.edges.get(edge).ok_or_else(|| no("edge-index"))?;
        if !matches!(
            a.body.curves[e.curve.0 as usize].geometry,
            CurveGeometry::Line { .. }
        ) || e.vertices.len() != 2
        {
            return Err(no("requires-line-edges"));
        }
        for v in &e.vertices {
            incident.entry(v.0).or_default().push(edge);
        }
        let [i, j] = owners[edge].as_slice() else {
            return Err(no("non-manifold-edge"));
        };
        let (a, b) = (&faces[*i], &faces[*j]);
        if !dot(&a.normal, &b.normal).is_zero() {
            return Err(no("non-orthogonal-edge-unimplemented"));
        }
        // Both adjacent planes must support the entire input, so a halfspace
        // cut cannot remove unrelated parts of a nonconvex Boolean boundary.
        let da = dot(&a.normal, &a.loops[0][0]);
        let db = dot(&b.normal, &b.loops[0][0]);
        for p in faces.iter().flat_map(|f| f.loops.iter().flatten()) {
            if dot(&a.normal, p) > da || dot(&b.normal, p) > db {
                return Err(no("non-supporting-edge-unimplemented"));
            }
        }
        let n = std::array::from_fn(|k| &a.normal[k] + &b.normal[k]);
        cuts.push((n, da + db - q(width)));
    }
    // Three meeting edge strips close with the plane through their face-side
    // intersections, not the spurious apex where only the edge halfspaces meet.
    // In inward distances to the three orthogonal supports this is x+y+z=2w;
    // its vertices are (w,w,0), (w,0,w), (0,w,w). No square roots are required.
    for (vertex, edges) in incident {
        if edges.len() < 3 {
            continue;
        }
        let corner_faces: BTreeSet<_> = edges
            .iter()
            .flat_map(|&e| owners[e].iter().copied())
            .collect();
        if edges.len() != 3 || corner_faces.len() != 3 {
            return Err(no("non-trihedral-corner-unimplemented"));
        }
        let supports: Vec<_> = corner_faces.iter().map(|&i| &faces[i]).collect();
        for i in 0..3 {
            for j in 0..i {
                if !dot(&supports[i].normal, &supports[j].normal).is_zero() {
                    return Err(no("non-orthogonal-corner-unimplemented"));
                }
            }
        }
        let p = a.body.vertices[vertex as usize].point.map(|x| q(x.get()));
        let n: V = std::array::from_fn(|k| supports.iter().map(|f| &f.normal[k]).sum());
        let d = dot(&n, &p) - q(2.) * q(width);
        cuts.push((n, d));
    }
    // Every unselected original edge must retain a positive-length interval.
    // This catches nonlocal cuts (e.g. two separated collinear rim segments),
    // face consumption and competing offsets before rounded witnesses exist.
    for (index, edge) in a.body.edges.iter().enumerate() {
        if selected.contains(&index) {
            continue;
        }
        let p = a.body.vertices[edge.vertices[0].0 as usize]
            .point
            .map(|x| q(x.get()));
        let end = a.body.vertices[edge.vertices[1].0 as usize]
            .point
            .map(|x| q(x.get()));
        let delta = sub(&end, &p);
        let (mut lo, mut hi) = (q(0.), q(1.));
        for (n, d) in &cuts {
            let start = dot(n, &p) - d;
            let slope = dot(n, &delta);
            if slope.is_zero() {
                if start.is_positive() {
                    return Err(no("face-consumed-or-overlap"));
                }
            } else {
                let t = -start / &slope;
                if slope.is_positive() {
                    hi = hi.min(t);
                } else {
                    lo = lo.max(t);
                }
            }
        }
        if lo >= hi {
            return Err(no("face-consumed-or-overlap"));
        }
    }
    for (n, d) in cuts {
        clip(&mut faces, n, d)?;
    }
    Ok(Chamfered {
        faces,
        points: vec![],
    })
}
fn assemble(
    template: &Body,
    nodes: Vec<Construction>,
    root: usize,
    spec: &mut Chamfered,
) -> R<Body> {
    let mut out = template.clone();
    out.constructions = nodes;
    out.vertices.clear();
    out.curves.clear();
    out.surfaces.clear();
    out.pcurves.clear();
    out.edges.clear();
    out.coedges.clear();
    out.loops.clear();
    out.faces.clear();
    out.shells.clear();
    out.solids.clear();
    out.facts.clear();
    out.budgets.clear();
    let provenance = Provenance::Construction {
        node: NodeId(root as u32),
    };
    let fid = FrameId(1);
    let mut vertices = BTreeMap::<V, u32>::new();
    let mut edge_ids = BTreeMap::new();
    let mut uses = BTreeMap::<u32, Vec<bool>>::new();
    for face in &spec.faces {
        let sid = SurfaceId(out.surfaces.len() as u32);
        // Retain existing charts for axis/edge faces. Trihedral corner normals
        // have no zero component; use an exact, non-unit in-plane direction.
        let x: V = if let Some(k) = face.normal.iter().position(|x| x.is_zero()) {
            std::array::from_fn(|i| q(if i == k { 1. } else { 0. }))
        } else {
            [face.normal[1].clone(), -&face.normal[0], Q::zero()]
        };
        let y = cross(&face.normal, &x);
        let xx = dot(&x, &x);
        let yy = dot(&y, &y);
        if xx.is_zero() || yy.is_zero() {
            return Err(no("degenerate-chart"));
        }
        let origin = &face.loops[0][0];
        out.surfaces.push(Surface {
            frame: fid,
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(origin)?,
                normal: v(&face.normal)?,
                x: v(&x)?,
            },
        });
        let mut loops = vec![];
        for (li, lp) in face.loops.iter().enumerate() {
            let mut ids = vec![];
            for p in lp {
                let id = if let Some(&id) = vertices.get(p) {
                    id
                } else {
                    let id = out.vertices.len() as u32;
                    vertices.insert(p.clone(), id);
                    spec.points.push(p.clone());
                    out.vertices.push(Vertex {
                        point: v(p)?,
                        frame: fid,
                        provenance: provenance.clone(),
                    });
                    id
                };
                ids.push(id);
            }
            let mut coedges = vec![];
            for i in 0..ids.len() {
                let (a, b) = (ids[i], ids[(i + 1) % ids.len()]);
                if a == b {
                    return Err(no("degenerate-edge"));
                }
                let pair = (a.min(b), a.max(b));
                let eid = *edge_ids.entry(pair).or_insert_with(|| {
                    let eid = out.edges.len() as u32;
                    out.curves.push(Curve {
                        frame: fid,
                        provenance: provenance.clone(),
                        geometry: CurveGeometry::Line {
                            a: out.vertices[pair.0 as usize].point,
                            b: out.vertices[pair.1 as usize].point,
                        },
                        domain: unit(),
                        supports: vec![],
                    });
                    out.edges.push(Edge {
                        curve: CurveId(eid),
                        domain: unit(),
                        vertices: vec![VertexId(pair.0), VertexId(pair.1)],
                    });
                    eid
                });
                let chart = |id: u32| -> R<Vector2> {
                    let d = sub(&spec.points[id as usize], origin);
                    Ok([b64(&(dot(&d, &x) / &xx))?, b64(&(dot(&d, &y) / &yy))?])
                };
                let pc = PcurveId(out.pcurves.len() as u32);
                out.pcurves.push(Pcurve {
                    curve: CurveId(eid),
                    surface: sid,
                    domain: unit(),
                    geometry: PcurveGeometry::Line {
                        a: chart(pair.0)?,
                        b: chart(pair.1)?,
                    },
                });
                out.curves[eid as usize].supports.push(Support {
                    surface: sid,
                    pcurve: pc,
                });
                coedges.push(CoedgeId(out.coedges.len() as u32));
                out.coedges.push(Coedge {
                    edge: EdgeId(eid),
                    forward: a == pair.0,
                    pcurve: pc,
                });
                uses.entry(eid).or_default().push(a == pair.0);
            }
            loops.push(LoopId(out.loops.len() as u32));
            out.loops.push(Loop {
                outer: li == 0,
                coedges,
            });
        }
        out.faces.push(wonky_contract::Face {
            surface: sid,
            forward: true,
            loops,
        });
    }
    if uses.values().any(|u| u.len() != 2 || u[0] == u[1]) {
        return Err(no("non-manifold-result"));
    }
    // Rounding must not collapse an exact edge or identify distinct vertices.
    let rounded: BTreeSet<_> = out
        .vertices
        .iter()
        .map(|p| p.point.map(|x| x.get().to_bits()))
        .collect();
    if rounded.len() != out.vertices.len() {
        return Err(no("display-resolution"));
    }
    out.shells.push(Shell {
        faces: (0..out.faces.len()).map(|i| FaceId(i as u32)).collect(),
    });
    out.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    Ok(out)
}
fn b64(x: &Q) -> R<Binary64> {
    b(f(x)?)
}
fn root(body: &Body) -> Option<usize> {
    match body.vertices.first()?.provenance {
        Provenance::Construction { node } => Some(node.0 as usize),
        _ => None,
    }
}
pub(crate) fn candidate(body: &Body) -> bool {
    root(body)
        .and_then(|i| body.constructions.get(i))
        .is_some_and(|n| n.operation == Operation::Intersection {} && n.rule_version == 2)
}
pub fn equal_offsets(a: &Audited, edges: &[usize], width: f64) -> R<Body> {
    let mut spec = geometry(a, edges, width)?;
    let mut nodes = a.body.constructions.clone();
    let parent = root(&a.body).ok_or_else(|| no("construction-parent"))?;
    let root = nodes.len();
    nodes.push(Construction {
        operation: Operation::Intersection {},
        rule_version: 2,
        parents: vec![NodeId(parent as u32)],
        parameters: std::iter::once(width)
            .chain(edges.iter().map(|e| *e as f64))
            .map(b)
            .collect::<R<_>>()?,
        frame: FrameId(1),
    });
    let mut body = assemble(&a.body, nodes, root, &mut spec)?;
    body.key.revision = body
        .key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    Ok(body)
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    let root = root(body).ok_or_else(|| no("construction-root"))?;
    let n = &body.constructions[root];
    if root + 1 != body.constructions.len()
        || n.parents.len() != 1
        || n.parameters.len() < 2
        || n.frame != FrameId(1)
    {
        return Err(no("construction-grammar"));
    }
    let parent = n.parents[0].0 as usize;
    if parent >= root {
        return Err(no("construction-order"));
    }
    let frame = Placement::from_frames(body, FrameId(1)).map_err(|_| no("frame"))?;
    let affine = frame.as_affine()?;
    metric(affine)?;
    let originals = orthogonal::construct(
        body.key.clone(),
        affine,
        body.constructions[..root].to_vec(),
        parent,
    )?;
    if originals.len() != 1 {
        return Err(no("multiple-source-components"));
    }
    let original = crate::polyhedron::audit(
        &originals[0]
            .clone()
            .check()
            .map_err(|_| no("source-wire"))?,
    )?;
    let edges = n.parameters[1..]
        .iter()
        .map(|x| {
            let x = x.get();
            if x < 0. || x.fract() != 0. || x > u32::MAX as f64 {
                Err(no("edge-index"))
            } else {
                Ok(x as usize)
            }
        })
        .collect::<R<Vec<_>>>()?;
    let mut spec = geometry(&original, &edges, n.parameters[0].get())?;
    let rebuilt = assemble(&original.body, body.constructions.clone(), root, &mut spec)?;
    if &rebuilt != body {
        return Err(no("construction-binding"));
    }
    let face_loops = body
        .loops
        .iter()
        .map(|l| {
            l.coedges
                .iter()
                .map(|c| {
                    let co = &body.coedges[c.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    if spec.volume6() <= Q::zero() {
        return Err(no("nonpositive-volume"));
    }
    Ok(Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels: [0.; 2],
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        arrangement: None,
        orthogonal: None,
        rounded: None,
        corner: None,
        chamfer: Some(spec),
        arcs: None,
    })
}
impl Chamfered {
    fn volume6(&self) -> Q {
        self.faces
            .iter()
            .flat_map(|f| &f.loops)
            .map(|lp| {
                (1..lp.len() - 1)
                    .map(|i| dot(&lp[0], &cross(&lp[i], &lp[i + 1])))
                    .sum::<Q>()
            })
            .sum()
    }
    pub(crate) fn volume(&self) -> R<Iv> {
        ball(&(self.volume6() * q(1e9) / q(6.)))
    }
    fn world(p: &V, a: &Audited) -> R<V> {
        let f = a.frame.as_affine()?;
        metric(f)?;
        let x = f.x.map(q);
        let z = f.z.map(q);
        let y = cross(&z, &x);
        Ok(std::array::from_fn(|k| {
            (q(f.origin[k]) + &p[0] * &x[k] + &p[1] * &y[k] + &p[2] * &z[k]) * q(1000.)
        }))
    }
    pub(crate) fn world_vertices(&self, a: &Audited) -> R<Vec<[f64; 3]>> {
        self.points
            .iter()
            .map(|p| {
                let w = Self::world(p, a)?;
                Ok([f(&w[0])?, f(&w[1])?, f(&w[2])?])
            })
            .collect()
    }
    pub(crate) fn areas(&self) -> R<Vec<Iv>> {
        self.faces
            .iter()
            .map(|face| {
                let mut v: V = std::array::from_fn(|_| Q::zero());
                for lp in &face.loops {
                    let n = area_vector(lp);
                    for k in 0..3 {
                        v[k] += &n[k];
                    }
                }
                let squared = dot(&v, &v) * q(2.5e11);
                if squared <= Q::zero() {
                    return Err(no("face-consumed-or-overlap"));
                }
                let s = crate::rounding::finite_ball(ball(&squared)?.sqrt())
                    .map_err(|_| no("area-range"))?;
                if s.lo() <= 0. || s.r / s.lo() > 48. * f64::EPSILON {
                    return Err(no("area-range"));
                }
                Ok(s)
            })
            .collect()
    }
    pub(crate) fn centroid(&self, a: &Audited) -> R<([f64; 3], [f64; 3])> {
        let mut c: V = std::array::from_fn(|_| Q::zero());
        for lp in self.faces.iter().flat_map(|f| &f.loops) {
            for i in 1..lp.len() - 1 {
                let d = dot(&lp[0], &cross(&lp[i], &lp[i + 1]));
                for k in 0..3 {
                    c[k] += &d * (&lp[0][k] + &lp[i][k] + &lp[i + 1][k]);
                }
            }
        }
        let volume = self.volume6() * q(4.);
        if volume <= Q::zero() {
            return Err(no("nonpositive-volume"));
        }
        for k in 0..3 {
            c[k] /= &volume;
        }
        let w = Self::world(&c, a)?;
        let balls = [ball(&w[0])?, ball(&w[1])?, ball(&w[2])?];
        Ok((balls.map(|b| b.m), balls.map(|b| b.r)))
    }
}
