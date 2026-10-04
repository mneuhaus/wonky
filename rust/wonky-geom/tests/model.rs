//! The checked Model (boolean3d strand G1): one positive and at least one
//! planted negative per audit check G1-G8, the structural checks, and the
//! canonical exact form. Expected values are closed forms of the fixtures.
use wonky_curve::Trimmed;
use wonky_geom::frame::Frame;
use wonky_geom::model::*;
use wonky_geom::Q;

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn unit(k: usize, sign: i64) -> [Q; 3] {
    std::array::from_fn(|i| if i == k { q(sign) } else { q(0) })
}
fn f(x: &Q) -> f64 {
    num_traits::ToPrimitive::to_f64(x).unwrap()
}

/// The six faces of the axis box [lo, hi], outward, vertices as interpreter inputs.
fn box_faces(lo: [f64; 3], hi: [f64; 3], outward: bool) -> Vec<PolyFace> {
    let mut faces = vec![];
    for k in 0..3 {
        for max in [false, true] {
            let (u, w) = ((k + 1) % 3, (k + 2) % 3);
            let corner = |a: f64, b: f64| {
                let mut p = [0.; 3];
                p[k] = if max { hi[k] } else { lo[k] };
                p[u] = a;
                p[w] = b;
                VertexDef::Input(p)
            };
            let mut cycle = vec![corner(lo[u], lo[w]), corner(hi[u], lo[w]), corner(hi[u], hi[w]), corner(lo[u], hi[w])];
            // Counter-clockwise about +e_k; reversed for the min side.
            let positive = max == outward;
            if !positive {
                cycle.reverse();
            }
            let mut o = [q(0), q(0), q(0)];
            o[k] = Q::from_float(if max { hi[k] } else { lo[k] }).unwrap();
            faces.push(PolyFace {
                carrier: Plane3 { o, x: unit(u, 1), n: unit(k, if positive { 1 } else { -1 }) },
                forward: true,
                loops: vec![cycle],
                provenance: Provenance { node: 1, slot: (2 * k + usize::from(max)) as u32 },
            });
        }
    }
    faces
}
fn draft(faces: Vec<PolyFace>) -> Draft {
    polyhedron(Frame::identity(), Label::Exact, 2, faces).unwrap()
}
fn refusal(d: Draft) -> &'static str {
    d.check().unwrap_err().0
}
fn unit_box() -> Draft {
    draft(box_faces([0.; 3], [2., 3., 5.], true))
}
/// Recompute every pcurve from the vertex keys (keeps G3 consistent after an edit).
fn recharted(mut d: Draft) -> Draft {
    for face in d.faces.clone() {
        let plane = match &d.surfaces[face.surface.index()].carrier {
            Carrier3::Plane(p) => p.clone(),

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    };
        for l in &face.loops {
            for c in d.loops[l.index()].coedges.clone() {
                let co = &d.coedges[c.index()];
                let Bounds::Segment([a, b]) = d.edges[co.edge.index()].bounds else { panic!("segment") };
                let (s, t) = if co.forward { (a, b) } else { (b, a) };
                let chart = |v: VertexId| {
                    let p = (d.vertices[v.index()].def.key().unwrap()).rational().unwrap().clone();
                    wonky_curve::ExactPoint::from_rational(plane.chart(&p).unwrap())
                };
                let piece = Trimmed::new([chart(s), chart(t)], wonky_curve::Carrier::Line).unwrap();
                d.coedges[c.index()].pcurve = piece;
            }
        }
    }
    d
}

#[test]
fn a_box_passes_every_check_with_its_exact_volume() {
    let m = unit_box().check().unwrap();
    assert_eq!(m.volume6().unwrap(), vec![q(6 * 30)]);
    let c = m.canonical();
    assert_eq!((c.vertices.len(), c.edges.len(), c.faces.len(), c.shells.len()), (8, 12, 6, 1));
}

/// The box [lo, hi] minus the through-hole prism [hole_lo, hole_hi] along z
/// (same z range): faces 4 and 5 (bottom, top) carry the hole cycle as their
/// second loop, followed by the hole's four side walls.
fn holed_plate(lo: [f64; 3], hi: [f64; 3], hole_lo: [f64; 3], hole_hi: [f64; 3]) -> Vec<PolyFace> {
    let mut faces = box_faces(lo, hi, true);
    let hole = box_faces(hole_lo, hole_hi, false);
    for z_face in [4, 5] {
        let inner = hole[z_face].loops[0].clone();
        faces[z_face].loops.push(inner);
    }
    faces.extend(hole.into_iter().take(4));
    faces
}

#[test]
fn a_through_hole_gives_genus_one_and_holed_faces() {
    // A 6x6x2 plate minus the 2x2 prism [2,4]^2: top and bottom have a hole loop.
    let faces = holed_plate([0., 0., 0.], [6., 6., 2.], [2., 2., 0.], [4., 4., 2.]);
    let m = draft(faces).check().unwrap();
    assert_eq!(m.volume6().unwrap(), vec![q(6 * (72 - 8))]);
    let c = m.canonical();
    assert_eq!((c.vertices.len(), c.edges.len(), c.faces.len()), (16, 24, 10));
    assert_eq!(c.faces.iter().filter(|f| f.loops.len() == 2).count(), 2);
}

#[test]
fn a_void_shell_is_audited_by_ray_parity_and_counts_in_the_volume() {
    let mut faces = box_faces([0.; 3], [4.; 3], true);
    faces.extend(box_faces([1.; 3], [2.; 3], false));
    let m = draft(faces).check().unwrap();
    assert_eq!(m.volume6().unwrap(), vec![q(6 * (64 - 1))]);
    assert_eq!(m.canonical().shells.len(), 2);
}

#[test]
fn rational_vertices_and_input_vertices_share_one_identity() {
    // Tetrahedron with a non-dyadic apex (1/3, 1/3, 1).
    let v = |p: [i64; 3]| VertexDef::Input(p.map(|x| x as f64));
    let apex = VertexDef::Rational([Q::new(1.into(), 3.into()), Q::new(1.into(), 3.into()), q(1)]);
    let tri = |a: VertexDef, b: VertexDef, c: VertexDef| {
        let keys = [&a, &b, &c].map(|v| match v.key().unwrap() {
            VertexKey::Rational(p) => p,

        VertexKey::Quadratic(_) | VertexKey::Real(_) => panic!("expected rational test vertex"),
    });
        let e1: [Q; 3] = std::array::from_fn(|k| &keys[1][k] - &keys[0][k]);
        let e2: [Q; 3] = std::array::from_fn(|k| &keys[2][k] - &keys[0][k]);
        let n = wonky_geom::cross(&e1, &e2);
        PolyFace {
            carrier: Plane3 { o: keys[0].clone(), x: e1, n },
            forward: true,
            loops: vec![vec![a, b, c]],
            provenance: Provenance { node: 1, slot: 0 },
        }
    };
    let faces = vec![
        tri(v([0, 0, 0]), v([0, 1, 0]), v([1, 0, 0])),
        tri(v([0, 0, 0]), v([1, 0, 0]), apex.clone()),
        tri(v([1, 0, 0]), v([0, 1, 0]), apex.clone()),
        tri(v([0, 1, 0]), v([0, 0, 0]), apex.clone()),
    ];
    let m = draft(faces.clone()).check().unwrap();
    // 6V = det of the three edge vectors from the origin = 1.
    assert_eq!(m.volume6().unwrap(), vec![q(1)]);
    // The same tetrahedron with the base as rational vertices is the same canonical form.
    let as_rational = |f: &PolyFace| PolyFace {
        loops: f.loops.iter().map(|l| l.iter().map(|v| match v.key().unwrap() {
            VertexKey::Rational(p) => VertexDef::Rational(p),

        VertexKey::Quadratic(_) | VertexKey::Real(_) => panic!("expected rational test vertex"),
    }).collect()).collect(),
        ..f.clone()
    };
    let other = draft(faces.iter().map(as_rational).collect()).check().unwrap();
    assert_eq!(m.canonical(), other.canonical());
}

#[test]
fn canonical_form_ignores_arena_order_loop_start_and_chart_axes() {
    let a = unit_box().check().unwrap().canonical();
    let mut faces = box_faces([0.; 3], [2., 3., 5.], true);
    faces.reverse();
    for f in &mut faces {
        f.loops[0].rotate_left(1);
        // Another chart axis in the same plane: x -> x + (n x x).
        let y = wonky_geom::cross(&f.carrier.n, &f.carrier.x);
        f.carrier.x = std::array::from_fn(|k| &f.carrier.x[k] + &y[k]);
        f.provenance.slot += 10;
    }
    let b = draft(faces).check().unwrap().canonical();
    assert_eq!(a, b);
    // Moving one face plane changes it.
    let c = draft(box_faces([0.; 3], [2., 3., 6.], true)).check().unwrap().canonical();
    assert_ne!(a, c);
    assert!(format!("{a}").contains("plane (0, 0, 1) . p = 5 out+"), "{a}");
}

#[test]
fn world_cache_is_the_correctly_rounded_placed_point() {
    let third = Q::new(1.into(), 3.into());
    let placement = Frame::new([third.clone(), q(0), q(0)], [unit(0, 1), unit(1, 1), unit(2, 1)]).unwrap();
    let mut d = unit_box();
    d.placement = placement;
    let m = d.check().unwrap();
    let origin = (0..m.draft().vertices.len())
        .map(|i| VertexId(i as u32))
        .find(|&v| m.key(v) == &VertexKey::Rational([q(0), q(0), q(0)]))
        .unwrap();
    assert_eq!(m.world_cache(origin).unwrap(), [1. / 3., 0., 0.]);
    // Placement is not part of the canonical form.
    assert_eq!(m.canonical(), unit_box().check().unwrap().canonical());
}

// ------------------------------------------------------------ planted negatives

#[test]
fn structure_rejects_dangling_empty_shared_orphaned_and_duplicate_entities() {
    let mut d = unit_box();
    d.coedges[0].edge = EdgeId(d.edges.len() as u32);
    assert_eq!(refusal(d), "model/structure-reference");
    let mut d = unit_box();
    d.solids.clear();
    assert_eq!(refusal(d), "model/structure-empty");
    let mut d = unit_box();
    d.loops[0].coedges.clear();
    assert_eq!(refusal(d), "model/structure-empty");
    let mut d = unit_box();
    let c = d.loops[0].coedges[0];
    d.loops[1].coedges.push(c);
    assert_eq!(refusal(d), "model/structure-shared-child");
    let mut d = unit_box();
    d.vertices.push(Vertex { def: VertexDef::Input([9.; 3]), provenance: Provenance { node: 2, slot: 99 } });
    assert_eq!(refusal(d), "model/structure-orphan");
    let mut d = unit_box();
    let copy = d.vertices[0].def.clone();
    d.vertices[1].def = copy;
    assert_eq!(refusal(d), "model/structure-duplicate-vertex");
}

#[test]
fn g1_rejects_a_plane_axis_not_perpendicular_to_its_normal() {
    let mut d = unit_box();
    match &mut d.surfaces[0].carrier {
        Carrier3::Plane(p) => p.x = std::array::from_fn(|k| &p.x[k] + &p.n[k]),

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    }
    assert_eq!(refusal(d), "model/g1-plane-degenerate");
    let mut d = unit_box();
    match &mut d.curves[0].geometry {
        Curve3::Line { d: dir, .. } => *dir = [q(0), q(0), q(0)],

        Curve3::RadicalLine {..} | Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => panic!("expected rational line test curve"),
    }
    assert_eq!(refusal(d), "model/g1-line-degenerate");
}

#[test]
fn g2_rejects_a_plane_coefficient_one_ulp_off_its_carrier() {
    // The +z face at z = 5: move its origin to the next binary64 above 5.
    let mut d = unit_box();
    let top = d
        .surfaces
        .iter()
        .position(|s| match &s.carrier {
            Carrier3::Plane(p) => p.n == unit(2, 1),

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    })
        .unwrap();
    match &mut d.surfaces[top].carrier {
        Carrier3::Plane(p) => {
            assert_eq!(f(&p.o[2]), 5.);
            p.o[2] = Q::from_float(5f64.next_up()).unwrap();
        }

        Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => panic!("expected rational planar test carrier"),
    }
    assert_eq!(refusal(d), "model/g2-curve-off-carrier");
}

#[test]
fn g3_rejects_a_pcurve_that_runs_against_its_coedge() {
    let mut d = unit_box();
    d.coedges[3].pcurve = d.coedges[3].pcurve.reversed();
    assert_eq!(refusal(d), "model/g3-pcurve-ends");
}

#[test]
fn g4_rejects_a_vertex_off_its_edge_line_and_a_ring_on_a_line() {
    // Vertex 0 moves by 2^-60 along x; pcurves follow it (G3 holds), the lines do not.
    let mut d = unit_box();
    let mut p = (d.vertices[0].def.key().unwrap()).rational().unwrap().clone();
    p[0] += Q::from_float(2f64.powi(-60)).unwrap();
    d.vertices[0].def = VertexDef::Rational(p);
    assert_eq!(refusal(recharted(d)), "model/g4-vertex-off-curve");

    let plane = Plane3 { o: [q(0), q(0), q(0)], x: unit(0, 1), n: unit(2, 1) };
    let origin = wonky_curve::ExactPoint::from_rational([q(0), q(0)]);
    let at = |slot| Provenance { node: 2, slot };
    let ring = Draft {
        placement: Frame::identity(),
        label: Label::Exact,
        surfaces: vec![Surface { carrier: Carrier3::Plane(plane), provenance: at(0) }],
        curves: vec![Curve { geometry: Curve3::Line { p: [q(0), q(0), q(0)], d: unit(0, 1) }, provenance: at(0) }],
        vertices: vec![],
        edges: vec![Edge { curve: CurveId(0), bounds: Bounds::Ring, provenance: at(0) }],
        coedges: vec![Coedge {
            edge: EdgeId(0),
            forward: true,
            pcurve: Trimmed::new([origin.clone(), origin], wonky_curve::Carrier::Line).unwrap(),
            atlas: None,
            provenance: at(0),
        }],
        loops: vec![Loop { coedges: vec![CoedgeId(0)], provenance: at(0) }],
        faces: vec![Face { surface: SurfaceId(0), forward: true, loops: vec![LoopId(0)], provenance: at(0) }],
        shells: vec![Shell { faces: vec![FaceId(0)], provenance: at(0) }],
        solids: vec![Solid { shells: vec![ShellId(0)], provenance: at(0) }],
    };
    assert_eq!(refusal(ring), "model/g4-ring-on-open-curve");
}

/// The prism between z = 0 and z = 1 over a planar region given as cap
/// pieces (counter-clockwise about +z) and directed boundary walls (material
/// on the left). Integer coordinates.
fn prism_faces(caps: &[Vec<[i64; 2]>], walls: &[([i64; 2], [i64; 2])]) -> Vec<PolyFace> {
    let at = |p: [i64; 2], z: i64| VertexDef::Input([p[0] as f64, p[1] as f64, z as f64]);
    let slot = |s: usize| Provenance { node: 1, slot: s as u32 };
    let mut faces = vec![];
    for cap in caps {
        let mut bottom: Vec<_> = cap.iter().map(|&p| at(p, 0)).collect();
        bottom.reverse();
        let top = cap.iter().map(|&p| at(p, 1)).collect();
        for (z, n, cycle) in [(0, -1, bottom), (1, 1, top)] {
            let carrier = Plane3 { o: [q(0), q(0), q(z)], x: unit(0, 1), n: unit(2, n) };
            faces.push(PolyFace { carrier, forward: true, loops: vec![cycle], provenance: slot(faces.len()) });
        }
    }
    for &(p, r) in walls {
        let carrier = Plane3 { o: [q(p[0]), q(p[1]), q(0)], x: unit(2, 1), n: [q(r[1] - p[1]), q(p[0] - r[0]), q(0)] };
        let cycle = vec![at(p, 0), at(r, 0), at(r, 1), at(p, 1)];
        faces.push(PolyFace { carrier, forward: true, loops: vec![cycle], provenance: slot(faces.len()) });
    }
    faces
}

/// [0,3]^2 minus the hole [1,2]^2 and the corner notch [2,3]^2, times [0,1]:
/// the hole touches the notch along the vertical line x = y = 2. The caps are
/// cut along (0,0)-(1,1) so that each cap face is a disk.
fn pinched_prism() -> Vec<PolyFace> {
    let caps = [vec![[0, 0], [3, 0], [3, 2], [2, 2], [2, 1], [1, 1]], vec![[0, 0], [1, 1], [1, 2], [2, 2], [2, 3], [0, 3]]];
    let outer = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 3], [0, 3]];
    let hole = [[1, 1], [1, 2], [2, 2], [2, 1]];
    let mut walls = vec![];
    for cycle in [&outer[..], &hole[..]] {
        for k in 0..cycle.len() {
            walls.push((cycle[k], cycle[(k + 1) % cycle.len()]));
        }
    }
    prism_faces(&caps, &walls)
}

/// The pinched prism with its line x = y = 2 split into two coincident edges:
/// the walls of `faces` get a second edge between the same two vertices.
fn split_pinch(faces: [usize; 2]) -> Draft {
    let mut d = draft(pinched_prism());
    let pinch = |v: VertexId| match d.vertices[v.index()].def.key().unwrap() {
        VertexKey::Rational(p) => p[0] == q(2) && p[1] == q(2),

        VertexKey::Quadratic(_) | VertexKey::Real(_) => panic!("expected rational test vertex"),
    };
    let e = (0..d.edges.len())
        .find(|&e| match d.edges[e].bounds {
            Bounds::Segment([a, b]) => pinch(a) && pinch(b),
            Bounds::Ring => false,
        })
        .unwrap();
    let copy = EdgeId(d.edges.len() as u32);
    d.curves.push(d.curves[d.edges[e].curve.index()].clone());
    d.edges.push(Edge { curve: CurveId(d.curves.len() as u32 - 1), ..d.edges[e].clone() });
    for f in faces {
        for c in d.loops[d.faces[f].loops[0].index()].coedges.clone() {
            if d.coedges[c.index()].edge.index() == e {
                d.coedges[c.index()].edge = copy;
            }
        }
    }
    d
}

#[test]
fn g7_rejects_two_coincident_edges_that_hide_a_non_manifold_edge() {
    // Unplanted: the builder shares edges by vertex pair, so the pinch line is
    // one edge with four uses, which G7 refuses.
    assert_eq!(refusal(draft(pinched_prism())), "model/g7-edge-use");
    // Split in two (outer walls 6 and 7 keep the first edge, hole walls 11 and
    // 12 get the copy), every edge has two opposite uses and every vertex link
    // is one cycle, but the two edges are one point set. Their canonical keys
    // would tie, so the canonical form would depend on which of them comes
    // first in the arena; the audit refuses the draft instead.
    for walls in [[11, 12], [6, 7]] {
        assert_eq!(refusal(split_pinch(walls)), "model/g7-edge-coincident");
    }
}

#[test]
fn g5_rejects_a_flipped_coedge_and_a_flipped_face() {
    // A flipped coedge: sense and pcurve reversed together, so G3 still holds.
    let mut d = unit_box();
    d.coedges[5].forward = !d.coedges[5].forward;
    d.coedges[5].pcurve = d.coedges[5].pcurve.reversed();
    assert_eq!(refusal(d), "model/g5-loop-open");
    // A face whose sense no longer matches its loop orientation.
    let mut d = unit_box();
    d.faces[2].forward = false;
    assert_eq!(refusal(d), "model/g5-loop-orientation");
}

#[test]
fn g6_rejects_a_hole_outside_its_face_across_its_boundary_or_along_it() {
    for (square, code) in [([7., 8.], "model/g6-hole-outside"), ([1., 2.5], "model/g6-crossing")] {
        let mut faces = box_faces([0.; 3], [2., 3., 5.], true);
        // A clockwise square in the +z face (z = 5), with its own vertices.
        let c = |x: f64, y: f64| VertexDef::Input([x, y, 5.]);
        let (a, b) = (square[0], square[1]);
        let top = faces.iter().position(|f| f.carrier.n == unit(2, 1)).unwrap();
        faces[top].loops.push(vec![c(a, a), c(a, b), c(b, b), c(b, a)]);
        assert_eq!(refusal(draft(faces)), code);
    }
    // A hole with one side on the outer boundary (x = 0, y from 1 to 2): the
    // two pieces overlap along one line instead of meeting at points.
    let mut faces = box_faces([0.; 3], [2., 3., 5.], true);
    let c = |x: f64, y: f64| VertexDef::Input([x, y, 5.]);
    let top = faces.iter().position(|f| f.carrier.n == unit(2, 1)).unwrap();
    faces[top].loops.push(vec![c(0., 1.), c(0., 2.), c(1., 2.), c(1., 1.)]);
    assert_eq!(refusal(draft(faces)), "model/g6-overlap");
}

#[test]
fn g6_rejects_a_hole_nested_in_another_hole_of_the_same_face() {
    // A 10x10x2 plate with a 6x6 through-hole, and inside that hole a free
    // 4x4 tube with a 2x2 through-hole (no contact between the two).
    let mut faces = holed_plate([0., 0., 0.], [10., 10., 2.], [2., 2., 0.], [8., 8., 2.]);
    faces.extend(holed_plate([3., 3., 0.], [7., 7., 2.], [4., 4., 0.], [6., 6., 2.]));
    let tube_top = 10 + 5;
    // Unplanted: two genus-one shells, 6V = 6 * ((200 - 72) + (32 - 8)).
    let m = draft(faces.clone()).check().unwrap();
    assert_eq!(m.volume6().unwrap(), vec![q(6 * 152)]);
    assert_eq!(m.canonical().shells.len(), 2);
    // The tube top's hole moves into the plate top (same plane z = 2, still
    // clockwise, so G5 holds): it lies inside the plate's own hole.
    let nested = faces[tube_top].loops.pop().unwrap();
    faces[5].loops.push(nested);
    assert_eq!(refusal(draft(faces)), "model/g6-hole-nested");
}

#[test]
fn g7_rejects_a_shell_cut_across_an_edge_and_a_shell_of_two_components() {
    // One box whose faces are split over two shells: edges join faces of both.
    let mut d = unit_box();
    let rest = d.shells[0].faces.split_off(3);
    d.shells.push(Shell { faces: rest, provenance: Provenance { node: 2, slot: 1 } });
    d.solids[0].shells.push(ShellId(1));
    assert_eq!(refusal(d), "model/g7-shell-split");
    // Two disjoint boxes listed as one shell.
    let mut faces = box_faces([0.; 3], [1.; 3], true);
    faces.extend(box_faces([2.; 3], [3.; 3], true));
    let mut d = draft(faces);
    assert_eq!(d.shells.len(), 2);
    let second = d.shells.pop().unwrap().faces;
    d.shells[0].faces.extend(second);
    d.solids[0].shells = vec![ShellId(0)];
    assert_eq!(refusal(d), "model/g7-shell-disconnected");
}

#[test]
fn g7_rejects_a_missing_edge_use_and_a_pinched_vertex() {
    // An open box: the edges of the missing face have one use each.
    let mut faces = box_faces([0.; 3], [2., 3., 5.], true);
    faces.pop();
    assert_eq!(refusal(draft(faces)), "model/g7-edge-use");
    // Two boxes touching at one corner: two shells, one pinched vertex.
    let mut faces = box_faces([0.; 3], [1.; 3], true);
    faces.extend(box_faces([1.; 3], [2.; 3], true));
    assert_eq!(refusal(draft(faces)), "model/g7-vertex-link");
}

#[test]
fn g8_rejects_an_inside_out_solid_and_an_outward_facing_void() {
    // Every face reversed (carrier normal and loops): consistent but negative.
    let inside_out = box_faces([0.; 3], [2., 3., 5.], false);
    assert_eq!(refusal(draft(inside_out)), "model/g8-volume");
    // A void oriented like an outer shell: the total signed volume stays
    // positive (64 + 1), but the ray from a void face along its normal leaves
    // through the outer shell once (odd).
    let mut faces = box_faces([0.; 3], [4.; 3], true);
    faces.extend(box_faces([1.; 3], [2.; 3], true));
    assert_eq!(refusal(draft(faces)), "model/g8-inward-face");
}
