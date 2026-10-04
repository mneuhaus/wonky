//! boolean3d strand G4: FeatureScript semantics of lower-dimensional
//! contacts (AC12's convention: the regularized result is not a manifold
//! solid, `boolean/non-manifold-result`), and the operations on the same
//! contacts whose result is manifold (the untouched target, or empty).
//!
//! Each contact is one of the kinds sewing alone cannot see or sees
//! differently: a vertex touching a vertex (the vertex link has two cycles),
//! an apex touching a face inside (a P5 touch point inside a kept face), an
//! edge lying in a face (a P5 slit inside a kept face), a cavity's apex
//! touching the outer face from inside, and an edge shared by four faces.
use wonky_bool::{fold, Op};
use wonky_geom::frame::Frame;
use wonky_geom::model::{polyhedron, Label, Model, Plane3, PolyFace, Provenance, VertexDef};
use wonky_geom::{cross, dot, point, sub, Point, Q};

/// A convex polyhedron from integer vertices and its face cycles (any
/// orientation: each face is turned to face away from the vertex centroid).
fn convex(vertices: &[[f64; 3]], faces: &[&[usize]], node: u32) -> Model {
    let p: Vec<Point> = vertices.iter().map(|v| point(*v).unwrap()).collect();
    let n = Q::from_integer((p.len() as i64).into());
    let centroid: Point = std::array::from_fn(|k| p.iter().map(|q| q[k].clone()).sum::<Q>() / &n);
    let polys = faces
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let mut cycle: Vec<usize> = f.to_vec();
            let x = sub(&p[cycle[1]], &p[cycle[0]]);
            let mut normal = cross(&x, &sub(&p[cycle[2]], &p[cycle[0]]));
            if dot(&normal, &sub(&p[cycle[0]], &centroid)) < Q::from_integer(0.into()) {
                cycle.reverse();
                normal = normal.map(|c| -c);
            }
            let x = sub(&p[cycle[1]], &p[cycle[0]]);
            PolyFace {
                carrier: Plane3 { o: p[cycle[0]].clone(), x, n: normal },
                forward: true,
                loops: vec![cycle.iter().map(|&v| VertexDef::Rational(p[v].clone())).collect()],
                provenance: Provenance { node, slot: i as u32 },
            }
        })
        .collect();
    polyhedron(Frame::identity(), Label::Exact, node, polys).unwrap().check().unwrap_or_else(|e| panic!("{}", e.0))
}

fn cube(lo: [f64; 3], hi: [f64; 3], node: u32) -> Model {
    let v: Vec<[f64; 3]> = (0..8).map(|i| [0, 1, 2].map(|k| if i >> k & 1 == 1 { hi[k] } else { lo[k] })).collect();
    convex(&v, &[&[0, 2, 3, 1], &[4, 5, 7, 6], &[0, 1, 5, 4], &[2, 6, 7, 3], &[0, 4, 6, 2], &[1, 3, 7, 5]], node)
}

/// A square pyramid: base square `[c-2, c+2]^2` at height `base`, apex at `(c, c, apex)`.
fn pyramid(c: f64, base: f64, apex: f64, node: u32) -> Model {
    let v = [[c - 2., c - 2., base], [c + 2., c - 2., base], [c + 2., c + 2., base], [c - 2., c + 2., base], [c, c, apex]];
    convex(&v, &[&[0, 1, 2, 3], &[0, 1, 4], &[1, 2, 4], &[2, 3, 4], &[3, 0, 4]], node)
}

/// A triangular prism along x in [2, 6] whose lower edge is the segment
/// y = 4, z = `edge_z`, and whose upper face lies at z = `top`.
fn wedge(edge_z: f64, top: f64, node: u32) -> Model {
    let v = [[2., 4., edge_z], [6., 4., edge_z], [2., 2., top], [6., 2., top], [2., 6., top], [6., 6., top]];
    convex(&v, &[&[0, 2, 4], &[1, 3, 5], &[0, 1, 3, 2], &[0, 1, 5, 4], &[2, 3, 5, 4]], node)
}

fn code(r: Result<wonky_bool::Output, wonky_geom::Refused>) -> String {
    match r {
        Ok(o) => format!("{} solid(s)", o.assembly.solids.len()),
        Err(e) => e.0.to_string(),
    }
}

const NON_MANIFOLD: &str = "boolean/non-manifold-result";
const EMPTY: &str = "boolean/empty-result";

#[test]
fn point_and_line_contacts_refuse_the_non_manifold_union() {
    let a = cube([0., 0., 0.], [8., 8., 8.], 1);
    // A corner touching a corner (AC12's A and C).
    let corner = cube([8., -8., 8.], [16., 0., 16.], 2);
    // An apex touching the top face inside, from outside.
    let apex = pyramid(4., 12., 8., 3);
    // An edge lying in the top face, from outside.
    let ridge = wedge(8., 10., 4);
    // An edge shared by four faces (AC12's A and B).
    let edge = cube([8., 8., 0.], [16., 16., 8.], 5);
    for (name, b) in [("corner", &corner), ("apex", &apex), ("ridge", &ridge), ("edge", &edge)] {
        assert_eq!(code(fold(Op::Union, &[&a, b], 0)), NON_MANIFOLD, "{name}: A u B");
        assert_eq!(code(fold(Op::Union, &[b, &a], 0)), NON_MANIFOLD, "{name}: B u A");
        // The same contact from outside: A - B is A, A n B is empty.
        let minus = fold(Op::Subtraction, &[&a, b], 0).unwrap_or_else(|e| panic!("{name}: {}", e.0));
        assert_eq!(minus.model.canonical(), a.canonical(), "{name}: A - B");
        assert_eq!(code(fold(Op::Intersection, &[&a, b], 0)), EMPTY, "{name}: A n B");
    }
}

#[test]
fn a_cavity_touching_the_outer_face_is_non_manifold() {
    let a = cube([0., 0., 0.], [8., 8., 8.], 1);
    // Apex up, touching A's top face from inside; ridge up, lying in it.
    let apex = pyramid(4., 4., 8., 3);
    let ridge = wedge(8., 6., 4);
    for (name, b) in [("apex", &apex), ("ridge", &ridge)] {
        assert_eq!(code(fold(Op::Subtraction, &[&a, b], 0)), NON_MANIFOLD, "{name}: A - B");
        // From inside, the union is A and the intersection is B.
        assert_eq!(fold(Op::Union, &[&a, b], 0).unwrap().model.canonical(), a.canonical(), "{name}: A u B");
        assert_eq!(fold(Op::Intersection, &[&a, b], 0).unwrap().model.canonical(), b.canonical(), "{name}: A n B");
    }
    // Strictly inside: a void shell of A's solid.
    let inside = pyramid(4., 4., 7., 3);
    let out = fold(Op::Subtraction, &[&a, &inside], 0).unwrap();
    assert_eq!(out.assembly.solids, vec![vec![0, 1]]);
    let v6: Q = out.model.volume6().unwrap().into_iter().sum();
    let expected = a.volume6().unwrap()[0].clone() - inside.volume6().unwrap()[0].clone();
    assert_eq!(v6, expected);
}

#[test]
fn a_void_belongs_to_the_innermost_solid_around_it() {
    // A box with a cavity, a second box inside that cavity, and a cavity in
    // the second box: two solids; the inner void is the inner solid's.
    let v6 = |m: &Model| m.volume6().unwrap().into_iter().sum::<Q>();
    let outer = cube([0., 0., 0.], [12., 12., 12.], 1);
    let cavity = cube([2., 2., 2.], [10., 10., 10.], 2);
    let inner = cube([4., 4., 4.], [8., 8., 8.], 3);
    let hole = cube([5., 5., 5.], [7., 7., 7.], 4);
    let shell = fold(Op::Subtraction, &[&outer, &cavity], 0).unwrap().model;
    let nested = fold(Op::Union, &[&shell, &inner], 0).unwrap().model;
    let out = fold(Op::Subtraction, &[&nested, &hole], 0).unwrap();
    let solids = out.solids().unwrap();
    assert_eq!(solids.len(), 2);
    let mut by_volume: Vec<(Q, usize)> = solids.iter().map(|s| (v6(s), s.draft().shells.len())).collect();
    by_volume.sort();
    assert_eq!(by_volume[0], (v6(&inner) - v6(&hole), 2), "the inner solid carries the inner void");
    assert_eq!(by_volume[1], (v6(&outer) - v6(&cavity), 2), "the outer solid carries its cavity");
}

#[test]
fn a_ridge_across_a_face_that_stays_whole_is_a_non_manifold_union() {
    // The wedge's lower edge runs across A's whole top face (x from -1 to 9):
    // the top face is kept on both sides of it, and the wedge's two faces
    // use the same segment. Re-joining the top face must not hide them.
    let a = cube([0., 0., 0.], [8., 8., 8.], 1);
    let v = [[-1., 4., 8.], [9., 4., 8.], [-1., 2., 10.], [9., 2., 10.], [-1., 6., 10.], [9., 6., 10.]];
    let ridge = convex(&v, &[&[0, 2, 4], &[1, 3, 5], &[0, 1, 3, 2], &[0, 1, 5, 4], &[2, 3, 5, 4]], 2);
    assert_eq!(code(fold(Op::Union, &[&a, &ridge], 0)), NON_MANIFOLD);
    // A - ridge is exactly A: the two contact subdivisions disappear.
    unchanged_after_contact(&fold(Op::Subtraction, &[&a, &ridge], 0).unwrap().model, &a);
    assert_eq!(code(fold(Op::Intersection, &[&a, &ridge], 0)), EMPTY);
}

#[test]
fn an_oblique_face_through_an_edge_is_classified_by_the_whole_wedge() {
    // A's face on y + z = 8 contains B's edge y = z = 4: the section pieces
    // with B's faces y = 4 and z = 4 lie on that edge, where no single face
    // of B decides the side; A touches B along the edge only.
    let b = cube([0., 0., 0.], [4., 4., 4.], 1);
    let v = [[-2., 4., 4.], [6., 4., 4.], [-2., 8., 0.], [6., 8., 0.], [-2., 8., 4.], [6., 8., 4.]];
    let a = convex(&v, &[&[0, 2, 4], &[1, 3, 5], &[0, 1, 3, 2], &[0, 1, 5, 4], &[2, 3, 5, 4]], 2);
    assert_eq!(code(fold(Op::Union, &[&a, &b], 0)), NON_MANIFOLD);
    unchanged_after_contact(&fold(Op::Subtraction, &[&a, &b], 0).unwrap().model, &a);
    assert_eq!(code(fold(Op::Intersection, &[&a, &b], 0)), EMPTY);
}

/// Contact subdivisions must not change any part of the exact B-rep.
fn unchanged_after_contact(m: &Model, a: &Model) {
    let (cm, ca) = (m.canonical(), a.canonical());
    let carriers = |c: &wonky_geom::model::Canonical| c.faces.iter().map(|f| (f.carrier.clone(), f.outward)).collect::<Vec<_>>();
    assert_eq!(carriers(&cm), carriers(&ca));
    assert_eq!(cm, ca);
    assert!(ca.vertices.iter().all(|v| cm.vertices.contains(v)));
    assert_eq!(m.volume6().unwrap(), a.volume6().unwrap());
}

#[test]
fn coplanar_halves_of_an_unmerged_operand_still_classify_on() {
    // X = AC11's union without the merge stage: its side planes carry two
    // coplanar faces each, meeting along x = 8. Y touches the y = 0 plane
    // across that seam from outside; its contact face lies ON X there.
    let raw = fold(Op::Union, &[&cube([0., 0., 0.], [8., 8., 8.], 1), &cube([8., 0., 0.], [16., 8., 8.], 2)], 0).unwrap();
    let faces = raw.assembly.faces.iter().enumerate().map(|(i, f)| PolyFace {
        carrier: f.carrier.clone(), forward: f.forward,
        loops: f.loops.iter().map(|lp| lp.iter().map(|p| VertexDef::Rational(raw.split.intersection.paves.points[p.index()].clone())).collect()).collect(),
        provenance: Provenance { node: 4, slot: i as u32 },
    }).collect();
    let x = polyhedron(Frame::identity(), Label::Exact, 4, faces).unwrap().check().unwrap();
    assert_eq!(x.draft().faces.len(), 10, "classification still exercises unmerged coplanar halves");
    let y = cube([4., -4., 2.], [12., 0., 6.], 3);
    let v6 = |m: &Model| m.volume6().unwrap().into_iter().sum::<Q>();
    let out = fold(Op::Union, &[&x, &y], 0).unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(out.assembly.solids.len(), 1);
    assert_eq!(v6(&out.model), v6(&x) + v6(&y));
    assert!(out.fragments.iter().any(|f| f.side == wonky_bool::Side::B && f.class == wonky_bool::Class::OnOpposite));
}

#[test]
fn coplanar_merge_preserves_holes_and_concave_boundaries_in_either_order() {
    // Two through-bored halves meet across a plane. The merged top and bottom
    // faces each have a hole whose boundary crosses the old seam.
    let left = cube([0., 0., 0.], [4., 8., 4.], 1);
    let right = cube([4., 0., 0.], [8., 8., 4.], 2);
    let tool = cube([2., 2., -1.], [6., 6., 5.], 3);
    let l = fold(Op::Subtraction, &[&left, &tool], 4).unwrap().model;
    let r = fold(Op::Subtraction, &[&right, &tool], 5).unwrap().model;
    let reference = fold(Op::Subtraction, &[&cube([0., 0., 0.], [8., 8., 4.], 6), &tool], 7).unwrap().model;
    for operands in [[&l, &r], [&r, &l]] {
        let out = fold(Op::Union, &operands, 8).unwrap().model;
        assert_eq!(out.canonical(), reference.canonical());
        assert_eq!(out.draft().faces.iter().filter(|f| f.loops.len() == 2).count(), 2);
        assert_eq!(out.volume6().unwrap(), reference.volume6().unwrap());
    }
    // General oblique carrier charts: the same test under an exact shear.
    let shear = Frame::new(point([10., -3., 1.]).unwrap(), [point([1., 1., 0.]).unwrap(), point([0., 1., 0.]).unwrap(), point([0., 0., 2.]).unwrap()]).unwrap();
    let placed = |m: &Model| { let mut d = m.clone().into_draft(); d.placement = shear.clone(); d.check().unwrap() };
    let (l, r, reference) = (placed(&l), placed(&r), placed(&reference));
    let out = fold(Op::Union, &[&l, &r], 9).unwrap().model;
    assert_eq!(out.canonical(), reference.canonical());
    assert_eq!(out.draft().placement, shear);
}
