//! Public-boundary properties, deterministic generators, exact rational oracle.
//! No snapshots, golden inventories, or production mutation switches.
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_brep::*;
use wonky_num::{v3, Iv, P3};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn scalar(&mut self) -> f64 {
        (self.next() % 2001) as f64 / 64. - 15.
    }
    fn size(&mut self) -> P3 {
        v3(
            (self.next() % 500 + 1) as f64 / 8.,
            (self.next() % 500 + 1) as f64 / 16.,
            (self.next() % 500 + 1) as f64 / 32.,
        )
    }
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn assert_encloses(iv: Iv, exact: &Q) {
    assert!(
        q(iv.lo()) <= *exact && *exact <= q(iv.hi()),
        "{exact} not in {iv:?}"
    );
    // Maximum relative certificate width, not an adjustable geometry epsilon.
    assert!(q(iv.hi()) - q(iv.lo()) <= exact * q(1e-9));
}
fn invalid(d: Draft, wanted: impl Fn(&Issue) -> bool) {
    match d.finish() {
        Err(Error::Invalid(issues)) => {
            assert!(issues.iter().any(wanted), "wrong rejection: {issues:?}")
        }
        other => panic!("expected named topology rejection, got {other:?}"),
    }
}
fn faces_of_edge(d: &Draft, edge: EdgeId) -> Vec<FaceId> {
    d.faces
        .iter()
        .enumerate()
        .filter_map(|(f, face)| {
            face.loops
                .iter()
                .any(|lp| {
                    d.loops[lp.0]
                        .coedges
                        .iter()
                        .any(|c| d.coedges[c.0].edge == edge)
                })
                .then_some(FaceId(f))
        })
        .collect()
}

fn incidence(b: &Brep) {
    let d = b.topology();
    for (f, face) in d.faces.iter().enumerate() {
        for lp in &face.loops {
            for c in &d.loops[lp.0].coedges {
                let e = d.coedges[c.0].edge;
                let decision = b.edge_on_face(e, FaceId(f)).unwrap();
                assert_eq!(decision.incidence, Incidence::Contained);
                assert_eq!(decision.evidence, Evidence::Construction);
                for v in d.edges[e.0].vertices {
                    assert_eq!(
                        b.vertex_on_edge(v, e).unwrap().incidence,
                        Incidence::Contained
                    );
                    assert_eq!(b.vertex_on_face(v, FaceId(f)).unwrap(), decision);
                }
            }
        }
    }
}

#[test]
fn cuboid_edge_queries_distinguish_unrelated_carriers_and_shared_boundaries() {
    let b = Brep::cuboid(v3(2., 3., 5.))
        .unwrap()
        .transformed(Rigid::around_axis(v3(3., -2., 5.), v3(1., 2., 3.), 0.1).unwrap());
    let d = b.topology();
    for e in 0..d.edges.len() {
        let edge = EdgeId(e);
        let owners = faces_of_edge(d, edge);
        assert_eq!(owners.len(), 2);
        for f in 0..d.faces.len() {
            let face = FaceId(f);
            let expected = if owners.contains(&face) {
                IncidenceDecision {
                    incidence: Incidence::Contained,
                    evidence: Evidence::Construction,
                }
            } else {
                IncidenceDecision {
                    incidence: Incidence::NotContained,
                    evidence: Evidence::ExactSourcePredicate,
                }
            };
            assert_eq!(b.edge_on_face(edge, face).unwrap(), expected);
        }
    }
}

#[test]
fn tangency_requires_both_faces_to_share_the_queried_edge() {
    let b = Brep::cuboid(v3(2., 3., 5.)).unwrap();
    let d = b.topology();
    for e in 0..d.edges.len() {
        let edge = EdgeId(e);
        let owners = faces_of_edge(d, edge);
        for a in 0..d.faces.len() {
            for c in 0..d.faces.len() {
                let (a, c) = (FaceId(a), FaceId(c));
                let expected = if a == c {
                    Err(Error::Degenerate("tangency needs two faces"))
                } else if owners.contains(&a) && owners.contains(&c) {
                    Ok(false) // Every genuine cube boundary is sharp.
                } else {
                    Err(Error::Degenerate("edge not shared by both faces"))
                };
                assert_eq!(
                    b.tangent_along(a, c, edge),
                    expected,
                    "{a:?}, {c:?}, {edge:?}"
                );
            }
        }
    }
}

#[test]
fn noncommuting_placements_preserve_point_and_vector_application_order() {
    let moved = Brep::cuboid(v3(2., 3., 5.))
        .unwrap()
        .transformed(Rigid::translation(v3(2., 0., 0.)).unwrap())
        .transformed(Rigid::around_axis(v3(0., 0., 0.), v3(0., 0., 1.), 0.7).unwrap())
        .transformed(Rigid::around_axis(v3(1., 2., 3.), v3(1., 0., 0.), -0.3).unwrap());
    // Independent closed forms for Rx * Rz * (p + offset) + final_offset.
    // Two nonparallel rotations also make VECTOR order observable; translating
    // then rotating alone cannot distinguish vector order.
    let (sz, cz) = 0.7_f64.sin_cos();
    let (sx, cx) = (-0.3_f64).sin_cos();
    let expected_vector = v3(cz, sz * cx, sz * sx);
    let expected_point = v3(1. + 2. * cz, 2. + 2. * sz * cx, 3. + 2. * sz * sx);
    let actual_vector = moved
        .placement()
        .approximate_vector(v3(1., 0., 0.))
        .unwrap();
    let actual_point = moved.approximate_vertex(VertexId(0)).unwrap();
    // Display-only rounding budget: a few dozen scalar operations at unit scale,
    // not a topology tolerance or a certificate for materialized coordinates.
    let display_roundoff = 64. * f64::EPSILON;
    assert!(
        actual_vector.sub(expected_vector).length() <= display_roundoff,
        "vector order: expected {expected_vector:?}, got {actual_vector:?}"
    );
    assert!(
        actual_point.sub(expected_point).length() <= display_roundoff,
        "point order: expected {expected_point:?}, got {actual_point:?}"
    );
}

#[test]
fn exact_incidence_and_volume_survive_three_rigid_transforms_and_copy() {
    let mut r = Rng(0xd1375ca11);
    let mut rounded_certificates = 0;
    for case in 0..192 {
        let size = if case % 2 == 0 {
            r.size()
        } else {
            // Full binary64 significands, not just exactly representable small
            // products: exercise nonzero certified rounding radii as well.
            let mut scalar = || {
                f64::from_bits(((1017 + r.next() % 13) << 52) | (r.next() & ((1_u64 << 52) - 1)))
            };
            v3(scalar(), scalar(), scalar())
        };
        let expected = q(size.x) * q(size.y) * q(size.z);
        let original = Brep::cuboid(size).unwrap();
        let before = original.volume(SolidId(0)).unwrap();
        rounded_certificates += usize::from(before.r > 0.);
        assert_encloses(before, &expected);
        let ops = [
            // w0-geom regression: x-axis edge and z=0 carrier; translation is
            // exactly (3,-2,5), axis (1,2,3), angle 0.1, not a nearby seed.
            Rigid::around_axis(v3(3., -2., 5.), v3(1., 2., 3.), 0.1).unwrap(),
            Rigid::around_axis(
                v3(r.scalar(), r.scalar(), r.scalar()),
                v3(2., -3., 1.),
                r.scalar(),
            )
            .unwrap(),
            Rigid::around_axis(
                v3(r.scalar(), r.scalar(), r.scalar()),
                v3(-4., 1., 2.),
                r.scalar(),
            )
            .unwrap(),
        ];
        let mut moved = original.clone();
        for op in ops {
            moved = moved.transformed(op);
        }
        assert_eq!(moved.placement().steps().len(), 3);
        incidence(&moved);
        // A box corner is incident on exactly three carriers, not all nearby
        // faces. This also exercises the exact-source fallback for false facts.
        let decisions: Vec<_> = (0..6)
            .map(|f| moved.vertex_on_face(VertexId(0), FaceId(f)).unwrap())
            .collect();
        assert_eq!(
            decisions
                .iter()
                .filter(|d| d.incidence == Incidence::Contained)
                .count(),
            3
        );
        assert!(decisions
            .iter()
            .filter(|d| d.incidence == Incidence::NotContained)
            .all(|d| d.evidence == Evidence::ExactSourcePredicate));
        let after = moved.volume(SolidId(0)).unwrap();
        assert_encloses(after, &expected);
        assert_eq!(
            (before.m.to_bits(), before.r.to_bits()),
            (after.m.to_bits(), after.r.to_bits())
        );
        // Not an identity copier: observable materialization really moved.
        assert_ne!(
            moved.approximate_vertex(VertexId(0)).unwrap(),
            original.approximate_vertex(VertexId(0)).unwrap()
        );
        let p = moved.approximate_vertex(VertexId(1)).unwrap();
        let o = moved.approximate_vertex(VertexId(0)).unwrap();
        assert!(((p.sub(o)).length() - size.x).abs() < 1e-11);
        incidence(&moved.clone());
        assert!(original.placement().steps().is_empty());
    }
    assert!(
        rounded_certificates > 0,
        "generator must exercise actual enclosures"
    );
}

fn triangulate(source: &Brep) -> Brep {
    let mut d = Draft::new();
    d.vertices = source.topology().vertices.clone();
    let mut faces = Vec::new();
    for face in &source.topology().faces {
        let Surface::Plane { origin, normal } = source.topology().surfaces[face.surface.0];
        let s = d.add_plane(origin, normal);
        let vertices: Vec<_> = source.topology().loops[face.loops[0].0]
            .coedges
            .iter()
            .map(|c| {
                let coedge = &source.topology().coedges[c.0];
                let e = &source.topology().edges[coedge.edge.0];
                e.vertices[if coedge.orientation == Orientation::Forward {
                    0
                } else {
                    1
                }]
            })
            .collect();
        for i in 1..vertices.len() - 1 {
            faces.push(
                d.add_polygon(
                    s,
                    Orientation::Forward,
                    &[vertices[0], vertices[i], vertices[i + 1]],
                )
                .unwrap(),
            );
        }
    }
    d.shells.push(Shell { faces });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    d.finish().unwrap()
}

#[test]
fn tangency_and_volume_are_invariant_under_face_subdivision_and_reframing() {
    let mut r = Rng(0xeaccf871);
    for _ in 0..96 {
        let size = r.size();
        let source = Brep::cuboid(size).unwrap();
        let split = triangulate(&source);
        let mut moved = split.clone();
        for _ in 0..3 {
            moved = moved.transformed(
                Rigid::around_axis(
                    v3(r.scalar(), r.scalar(), r.scalar()),
                    v3(1., 2., 3.),
                    r.scalar(),
                )
                .unwrap(),
            );
        }
        let mut tangent = 0;
        let mut sharp = 0;
        for e in 0..moved.topology().edges.len() {
            let fs: Vec<_> = moved
                .topology()
                .faces
                .iter()
                .enumerate()
                .filter(|(_, f)| {
                    f.loops.iter().any(|l| {
                        moved.topology().loops[l.0]
                            .coedges
                            .iter()
                            .any(|c| moved.topology().coedges[c.0].edge == EdgeId(e))
                    })
                })
                .map(|(i, _)| FaceId(i))
                .collect();
            let actual = moved.tangent_along(fs[0], fs[1], EdgeId(e)).unwrap();
            // Triangles generated consecutively from one original face are
            // coplanar; adjacent triangles on different box sides are sharp.
            assert_eq!(actual, fs[0].0 / 2 == fs[1].0 / 2);
            assert_eq!(
                actual,
                moved.tangent_along(fs[1], fs[0], EdgeId(e)).unwrap()
            );
            if actual {
                tangent += 1;
            } else {
                sharp += 1;
            }
        }
        assert_eq!((tangent, sharp), (6, 12));
        incidence(&moved);
        assert_encloses(
            moved.volume(SolidId(0)).unwrap(),
            &(q(size.x) * q(size.y) * q(size.z)),
        );
    }
}

#[test]
fn planted_topology_faults_are_rejected_by_their_own_checks() {
    let mut r = Rng(0x9074c911);
    for case in 0..96 {
        let b = Brep::cuboid(r.size()).unwrap();
        let mut flipped = b.to_draft();
        let index = case % flipped.coedges.len();
        let edge = flipped.coedges[index].edge;
        flipped.coedges[index].orientation = flipped.coedges[index].orientation.reversed();
        invalid(flipped, |i| *i == Issue::OrientationConflict(edge));
        let mut dangling = b.to_draft();
        let edge = dangling.add_line_edge(VertexId(0), VertexId(6)).unwrap();
        invalid(dangling, |i| *i == Issue::DanglingEdge(edge));
        let mut overused = b.to_draft();
        let face = FaceId(case % overused.faces.len());
        let lp = overused.faces[face.0].loops[0];
        let edge = overused.coedges[overused.loops[lp.0].coedges[0].0].edge;
        let added = FaceId(overused.faces.len());
        overused.faces.push(overused.faces[face.0].clone());
        overused.shells[0].faces.push(added);
        invalid(overused, |i| *i == Issue::NonManifoldEdge(edge));
        // A hole in the closed shell, with intact and unique remaining arenas.
        let mut open = Draft::new();
        open.vertices = b.topology().vertices.clone();
        for f in 0..5 {
            let face = &b.topology().faces[f];
            let Surface::Plane { origin, normal } = b.topology().surfaces[face.surface.0];
            let s = open.add_plane(origin, normal);
            let vs: Vec<_> = b.topology().loops[face.loops[0].0]
                .coedges
                .iter()
                .map(|c| {
                    let c = &b.topology().coedges[c.0];
                    b.topology().edges[c.edge.0].vertices[if c.orientation == Orientation::Forward {
                        0
                    } else {
                        1
                    }]
                })
                .collect();
            open.add_polygon(s, Orientation::Forward, &vs).unwrap();
        }
        open.shells.push(Shell {
            faces: (0..5).map(FaceId).collect(),
        });
        open.solids.push(Solid {
            shells: vec![ShellId(0)],
        });
        invalid(open, |i| matches!(i, Issue::BoundaryEdge(_)));
    }
}

#[test]
fn source_edits_cannot_reuse_stale_incidence_or_volume_facts() {
    let mut r = Rng(0xe9160012);
    for case in 0..96 {
        let b = Brep::cuboid(r.size())
            .unwrap()
            .transformed(Rigid::around_axis(v3(3., -2., 5.), v3(1., 2., 3.), 0.1).unwrap());
        let mut altered = b.to_draft();
        let edge = EdgeId(case % altered.edges.len());
        altered.edges[edge.0].range.end = 2.;
        invalid(
            altered,
            |i| matches!(i,Issue::EndpointIncidence(e,_) if *e == edge),
        );
        let mut gap = b.to_draft();
        let Surface::Plane { origin, .. } = &mut gap.surfaces[0];
        origin.z = 2_f64.powi(-40 - (case % 40) as i32);
        invalid(gap, |i| matches!(i, Issue::FaceIncidence(_, FaceId(0))));
        let mut bad_ref = b.to_draft();
        bad_ref.coedges[0].edge = EdgeId(usize::MAX);
        invalid(bad_ref, |i| *i == Issue::Reference("edge", usize::MAX));
    }
}

#[test]
fn independent_rational_boundary_volume_encloses_translated_dyadic_polyhedra() {
    let mut r = Rng(0xfa1881f09);
    for _ in 0..96 {
        let size = r.size();
        let b = triangulate(&Brep::cuboid(size).unwrap());
        let offset = v3(r.scalar(), r.scalar(), r.scalar());
        let mut d = b.to_draft();
        // Determinant-one dyadic shear: non-axis-aligned source carriers, not
        // another placement-only box test. All construction arithmetic is exact
        // in the bounded generator; the rational oracle below checks the result.
        let (h, k, l) = (
            (r.next() % 7) as f64 - 3.,
            (r.next() % 7) as f64 - 3.,
            (r.next() % 7) as f64 - 3.,
        );
        let shear = |p: P3| v3(p.x + h * p.y + k * p.z, p.y + l * p.z, p.z).add(offset);
        for v in &mut d.vertices {
            v.point = shear(v.point);
        }
        for c in &mut d.curves {
            let Curve::Line { a, b } = c;
            *a = shear(*a);
            *b = shear(*b);
            // Same trimmed edge, now parameterized by [-1,1].
            *a = a.add(*b).scale(0.5);
        }
        for e in &mut d.edges {
            e.range.start = -1.;
        }
        for s in &mut d.surfaces {
            let Surface::Plane { origin, normal } = s;
            *origin = shear(*origin);
            *normal = v3(
                normal.x,
                normal.y - h * normal.x,
                normal.z - l * normal.y + (h * l - k) * normal.x,
            );
        }
        let b = d.finish().unwrap();
        // Independent exact determinant sum about WORLD zero (production uses
        // balls about a local anchor), no use of the volume implementation.
        let mut exact = Q::zero();
        for face in &b.topology().faces {
            let ps: Vec<_> = b.topology().loops[face.loops[0].0]
                .coedges
                .iter()
                .map(|c| {
                    let c = &b.topology().coedges[c.0];
                    let v = b.topology().edges[c.edge.0].vertices[if c.orientation
                        == Orientation::Forward
                    {
                        0
                    } else {
                        1
                    }];
                    let p = b.topology().vertices[v.0].point;
                    [q(p.x), q(p.y), q(p.z)]
                })
                .collect();
            let (a, b, c) = (&ps[0], &ps[1], &ps[2]);
            exact += &a[0] * (&b[1] * &c[2] - &b[2] * &c[1])
                + &a[1] * (&b[2] * &c[0] - &b[0] * &c[2])
                + &a[2] * (&b[0] * &c[1] - &b[1] * &c[0]);
        }
        exact /= Q::from_integer(6.into());
        assert_eq!(exact, q(size.x) * q(size.y) * q(size.z));
        assert_encloses(b.volume(SolidId(0)).unwrap(), &exact);
    }
}

#[test]
fn carrier_orientation_changes_preserve_effective_boundary_orientation() {
    let mut r = Rng(0x118c77a51);
    for case in 0..96 {
        let size = r.size();
        let b = Brep::cuboid(size).unwrap();
        let mut d = b.to_draft();
        let face = case % d.faces.len();
        let Surface::Plane { normal, .. } = &mut d.surfaces[d.faces[face].surface.0];
        *normal = normal.scale(-1.);
        d.faces[face].orientation = d.faces[face].orientation.reversed();
        for lp in &d.faces[face].loops {
            d.loops[lp.0].coedges.reverse();
            for c in &d.loops[lp.0].coedges {
                d.coedges[c.0].orientation = d.coedges[c.0].orientation.reversed();
            }
        }
        let b = d.finish().unwrap();
        incidence(&b);
        assert_encloses(
            b.volume(SolidId(0)).unwrap(),
            &(q(size.x) * q(size.y) * q(size.z)),
        );
    }
}

#[test]
fn pinched_vertex_links_fail_even_when_every_edge_has_two_opposite_uses() {
    let mut r = Rng(0xefa17539);
    for _ in 0..48 {
        let original = Brep::cuboid(r.size()).unwrap();
        let mut d = original.to_draft();
        // Attach a reflected copy only at the origin. All edge valences and
        // loops are valid, so only a vertex-link audit catches the pinch.
        let mut map = vec![VertexId(0)];
        for v in &original.topology().vertices[1..] {
            map.push(d.add_vertex(v.point.scale(-1.)));
        }
        let mut faces = Vec::new();
        for face in &original.topology().faces {
            let Surface::Plane { origin, normal } = original.topology().surfaces[face.surface.0];
            let surface = d.add_plane(origin.scale(-1.), normal.scale(-1.));
            let mut vertices: Vec<_> = original.topology().loops[face.loops[0].0]
                .coedges
                .iter()
                .map(|c| {
                    let c = &original.topology().coedges[c.0];
                    let v = original.topology().edges[c.edge.0].vertices[if c.orientation
                        == Orientation::Forward
                    {
                        0
                    } else {
                        1
                    }];
                    map[v.0]
                })
                .collect();
            vertices.reverse();
            faces.push(
                d.add_polygon(surface, Orientation::Forward, &vertices)
                    .unwrap(),
            );
        }
        let shell = ShellId(d.shells.len());
        d.shells.push(Shell { faces });
        d.solids.push(Solid {
            shells: vec![shell],
        });
        match d.finish() {
            Err(Error::Invalid(issues)) => {
                assert_eq!(issues, vec![Issue::NonManifoldVertex(VertexId(0))])
            }
            other => panic!("pinched shell silently accepted or wrong refusal: {other:?}"),
        }
    }
}

// Geometric injectivity is a finish() contract, distinct from edge valence and
// connected vertex links. These public Draft fixtures cross-glue a slit between
// two coincident sheets; each sheet alone remains a valid positive control.
fn tetrahedron() -> Brep {
    let mut d = Draft::new();
    for p in [
        v3(0., 0., 0.),
        v3(1., 0., 0.),
        v3(0., 1., 0.),
        v3(0., 0., 1.),
    ] {
        d.add_vertex(p);
    }
    let mut faces = Vec::new();
    for (origin, normal, vertices) in [
        (v3(0., 0., 0.), v3(0., -1., 0.), [0, 1, 3]),
        (v3(0., 0., 0.), v3(0., 0., -1.), [0, 2, 1]),
        (v3(0., 0., 0.), v3(-1., 0., 0.), [0, 3, 2]),
        (v3(1., 0., 0.), v3(1., 1., 1.), [1, 2, 3]),
    ] {
        let s = d.add_plane(origin, normal);
        faces.push(
            d.add_polygon(s, Orientation::Forward, &vertices.map(VertexId))
                .unwrap(),
        );
    }
    d.shells.push(Shell { faces });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    d.finish().unwrap()
}

fn double_cover(first: &Brep, second: &Brep) -> Draft {
    let src = second.topology();
    let mut d = first.to_draft();
    let ends = d.edges[0].vertices;
    let mut vm = Vec::new();
    for (i, v) in src.vertices.iter().enumerate() {
        vm.push(if ends.contains(&VertexId(i)) {
            VertexId(i)
        } else {
            d.add_vertex(v.point)
        });
    }
    let curve_offset = d.curves.len();
    let edge_offset = d.edges.len();
    let coedge_offset = d.coedges.len();
    let loop_offset = d.loops.len();
    let surface_offset = d.surfaces.len();
    let face_offset = d.faces.len();
    d.curves.extend(src.curves.clone());
    d.surfaces.extend(src.surfaces.clone());
    for e in &src.edges {
        d.edges.push(Edge {
            curve: CurveId(e.curve.0 + curve_offset),
            range: e.range,
            vertices: e.vertices.map(|v| vm[v.0]),
        });
    }
    for c in &src.coedges {
        d.coedges.push(Coedge {
            edge: EdgeId(c.edge.0 + edge_offset),
            orientation: c.orientation,
        });
    }
    for l in &src.loops {
        d.loops.push(Loop {
            coedges: l
                .coedges
                .iter()
                .map(|c| CoedgeId(c.0 + coedge_offset))
                .collect(),
        });
    }
    for f in &src.faces {
        d.faces.push(Face {
            surface: SurfaceId(f.surface.0 + surface_offset),
            orientation: f.orientation,
            loops: f.loops.iter().map(|l| LoopId(l.0 + loop_offset)).collect(),
        });
    }
    d.shells[0]
        .faces
        .extend((face_offset..d.faces.len()).map(FaceId));
    let other_edge = src
        .edges
        .iter()
        .position(|e| e.vertices == ends || e.vertices == [ends[1], ends[0]])
        .unwrap();
    let opposite = src.edges[other_edge].vertices != ends;
    let seam = first
        .topology()
        .coedges
        .iter()
        .position(|c| c.edge == EdgeId(0))
        .unwrap();
    let sense = d.coedges[seam].orientation;
    let other_sense = if opposite { sense.reversed() } else { sense };
    let other_seam = src
        .coedges
        .iter()
        .position(|c| c.edge == EdgeId(other_edge) && c.orientation == other_sense)
        .unwrap()
        + coedge_offset;
    d.coedges[seam].edge = EdgeId(other_edge + edge_offset);
    d.coedges[seam].orientation = other_sense;
    d.coedges[other_seam].edge = EdgeId(0);
    d.coedges[other_seam].orientation = sense;
    d
}

// Independent rational clipping/area oracle for the reported witness, rather
// than repeating production's separating-axis predicate or trusting an error tag.
fn overlap_area(d: &Draft, a: FaceId, b: FaceId) -> Q {
    fn side(a: &[Q; 2], b: &[Q; 2], p: &[Q; 2]) -> Q {
        (&b[0] - &a[0]) * (&p[1] - &a[1]) - (&b[1] - &a[1]) * (&p[0] - &a[0])
    }
    fn area2(poly: &[[Q; 2]]) -> Q {
        (0..poly.len())
            .map(|i| {
                let (a, b) = (&poly[i], &poly[(i + 1) % poly.len()]);
                &a[0] * &b[1] - &a[1] * &b[0]
            })
            .sum()
    }
    let Surface::Plane { origin, normal } = d.surfaces[d.faces[a.0].surface.0];
    let n = [normal.x, normal.y, normal.z].map(q);
    let o = [origin.x, origin.y, origin.z].map(q);
    let axis = n.iter().position(|x| !x.is_zero()).unwrap();
    let [mut subject, clipper] = [a, b].map(|f| {
        let mut polygon: Vec<_> = d.loops[d.faces[f.0].loops[0].0]
            .coedges
            .iter()
            .map(|c| {
                let c = &d.coedges[c.0];
                let v =
                    d.edges[c.edge.0].vertices[usize::from(c.orientation == Orientation::Reversed)];
                let p = d.vertices[v.0].point;
                let p = [p.x, p.y, p.z].map(q);
                assert_eq!(
                    (0..3).map(|i| &n[i] * (&p[i] - &o[i])).sum::<Q>(),
                    Q::zero(),
                    "overlap witness is not coplanar"
                );
                [p[(axis + 1) % 3].clone(), p[(axis + 2) % 3].clone()]
            })
            .collect();
        if area2(&polygon) < Q::zero() {
            polygon.reverse();
        }
        polygon
    });
    for i in 0..clipper.len() {
        let (a, b) = (&clipper[i], &clipper[(i + 1) % clipper.len()]);
        let mut clipped = Vec::new();
        for j in 0..subject.len() {
            let (p, r) = (&subject[j], &subject[(j + 1) % subject.len()]);
            let (sp, sr) = (side(a, b, p), side(a, b, r));
            let (inside_p, inside_r) = (sp >= Q::zero(), sr >= Q::zero());
            if inside_p {
                clipped.push(p.clone());
            }
            if inside_p != inside_r {
                let t = &sp / (&sp - &sr);
                clipped.push([&p[0] + &t * (&r[0] - &p[0]), &p[1] + &t * (&r[1] - &p[1])]);
            }
        }
        subject = clipped;
    }
    area2(&subject) / q(2.)
}

fn refuses_cover(d: Draft) {
    match d.clone().finish() {
        Err(Error::Invalid(issues)) => {
            let (a, b) = issues
                .iter()
                .find_map(|i| match i {
                    Issue::OverlappingFaces(a, b) => Some((*a, *b)),
                    _ => None,
                })
                .unwrap_or_else(|| {
                    panic!("cover must fail geometric injectivity, not another guard: {issues:?}")
                });
            assert_ne!(a, b);
            assert!(
                overlap_area(&d, a, b) > Q::zero(),
                "reported face domains do not overlap"
            );
        }
        Ok(b) => panic!(
            "double cover certified with volume {:?}",
            b.volume(SolidId(0)).unwrap()
        ),
        Err(e) => panic!("wrong refusal for double cover: {e:?}"),
    }
}

#[test]
fn connected_double_cover_of_tetrahedron_is_refused() {
    let original = tetrahedron();
    assert_encloses(original.volume(SolidId(0)).unwrap(), &(q(1.) / q(6.)));
    refuses_cover(double_cover(&original, &original));
}

#[test]
fn connected_double_cover_of_cube_is_refused() {
    let original = Brep::cuboid(v3(1., 1., 1.)).unwrap();
    assert_encloses(original.volume(SolidId(0)).unwrap(), &q(1.));
    refuses_cover(double_cover(&original, &original));
}

#[test]
fn connected_double_cover_with_contained_face_domains_is_refused() {
    let original = Brep::cuboid(v3(1., 1., 1.)).unwrap();
    let split = triangulate(&original);
    // Containment: no triangle equals the quad it overlaps. Deduplicating face
    // vertex sets is not an injectivity proof.
    refuses_cover(double_cover(&original, &split));
}

#[test]
fn connected_double_cover_with_crossing_face_domains_is_refused() {
    let original = Brep::cuboid(v3(1., 1., 1.)).unwrap();
    let split = triangulate(&original);
    let mut rotated = original.to_draft();
    for lp in &mut rotated.loops {
        lp.coedges.rotate_left(1);
    }
    let other_split = triangulate(&rotated.finish().unwrap());
    // Crossing interiors: opposite diagonals on every square. No triangle has
    // a vertex strictly inside the other sheet's triangles.
    refuses_cover(double_cover(&split, &other_split));
}

// Four-triangle fans with alternating n / -2n carrier frames. Shared by the
// contact/tangency and asymmetric-separator regressions, not a test-only API.
fn fan_cubes(copies: usize, weights: impl Fn(usize) -> [f64; 4]) -> Draft {
    let cube = Brep::cuboid(v3(1., 1., 1.)).unwrap();
    let src = cube.topology();
    let mut d = Draft::new();
    for _ in 0..copies {
        let vm: Vec<_> = src.vertices.iter().map(|v| d.add_vertex(v.point)).collect();
        let mut faces = Vec::new();
        for (f, face) in src.faces.iter().enumerate() {
            let Surface::Plane { origin, normal } = src.surfaces[face.surface.0];
            let vs: Vec<_> = src.loops[face.loops[0].0]
                .coedges
                .iter()
                .map(|c| {
                    let c = &src.coedges[c.0];
                    let v = src.edges[c.edge.0].vertices
                        [usize::from(c.orientation == Orientation::Reversed)];
                    vm[v.0]
                })
                .collect();
            // Unit-cube coordinates and these weights are exactly dyadic.
            let center = vs.iter().zip(weights(f)).fold(v3(0., 0., 0.), |p, (v, w)| {
                p.add(d.vertices[v.0].point.scale(w))
            });
            let center = d.add_vertex(center);
            for i in 0..vs.len() {
                let reversed = i % 2 == 1;
                let mut triangle = [center, vs[i], vs[(i + 1) % vs.len()]];
                let orientation = if reversed {
                    triangle.reverse();
                    Orientation::Reversed
                } else {
                    Orientation::Forward
                };
                let surface = d.add_plane(origin, normal.scale(if reversed { -2. } else { 1. }));
                faces.push(d.add_polygon(surface, orientation, &triangle).unwrap());
            }
        }
        let shell = ShellId(d.shells.len());
        d.shells.push(Shell { faces });
        d.solids.push(Solid {
            shells: vec![shell],
        });
    }
    d
}

#[test]
fn coplanar_boundary_contacts_and_independent_solids_remain_valid() {
    // Shared-edge and vertex-only contacts, plus two coincident independent
    // solids: injectivity is per shell. Carrier sign/scale cannot change tangency.
    let b = fan_cubes(2, |_| [0.25; 4]).finish().unwrap();
    for solid in [SolidId(0), SolidId(1)] {
        assert_encloses(b.volume(solid).unwrap(), &q(1.));
    }
    incidence(&b);
    let (mut tangent, mut sharp) = (0, 0);
    for e in 0..b.topology().edges.len() {
        let fs = faces_of_edge(b.topology(), EdgeId(e));
        let expected = fs[0].0 / 4 == fs[1].0 / 4;
        let actual = b.tangent_along(fs[0], fs[1], EdgeId(e)).unwrap();
        assert_eq!(
            actual, expected,
            "carrier tangency at edge {e} between {fs:?}"
        );
        assert_eq!(actual, b.tangent_along(fs[1], fs[0], EdgeId(e)).unwrap());
        if actual {
            tangent += 1;
        } else {
            sharp += 1;
        }
    }
    assert_eq!((tangent, sharp), (48, 24));
}

#[test]
fn off_center_fans_need_separating_axes_from_both_polygons() {
    // Opposite triangles have a separating edge on only ONE polygon. Reverse
    // the asymmetry on odd cube faces so either one-sided loop is caught.
    let b = fan_cubes(1, |f| {
        if f % 2 == 0 {
            [0.125, 0.125, 0.375, 0.375]
        } else {
            [0.375, 0.375, 0.125, 0.125]
        }
    })
    .finish()
    .expect("valid off-center fans must not be refused as overlapping");
    assert_encloses(b.volume(SolidId(0)).unwrap(), &q(1.));
}

#[test]
fn dented_vertex_is_refused_even_when_it_ends_every_incident_edge() {
    let mut d = Brep::cuboid(v3(1., 1., 1.)).unwrap().to_draft();
    let v = VertexId(6);
    for e in 0..d.edges.len() {
        if d.edges[e].vertices[0] == v {
            d.edges[e].vertices.swap(0, 1);
            let Curve::Line { a, b } = &mut d.curves[d.edges[e].curve.0];
            std::mem::swap(a, b);
            for c in &mut d.coedges {
                if c.edge == EdgeId(e) {
                    c.orientation = c.orientation.reversed();
                }
            }
        }
    }
    // Reorienting edges alone is valid; dent both the vertex and its carrier
    // endpoint so only the two-endpoint FACE incidence check detects the fault.
    d.clone()
        .finish()
        .expect("edge direction does not change the cube");
    let moved = d.vertices[v.0].point.sub(v3(0., 0., 2_f64.powi(-30)));
    d.vertices[v.0].point = moved;
    for e in &d.edges {
        assert_ne!(e.vertices[0], v);
        if e.vertices[1] == v {
            let Curve::Line { b, .. } = &mut d.curves[e.curve.0];
            *b = moved;
        }
    }
    invalid(d, |i| matches!(i, Issue::FaceIncidence(_, FaceId(1))));
}

// A second, independent box supplies real query vertices without bypassing the
// public finish() boundary. Overlap of separate solids is explicitly permitted.
fn add_probe_box(d: &mut Draft, offset: P3) -> VertexId {
    let probe = Brep::cuboid(v3(0.125, 0.125, 0.125)).unwrap();
    let src = probe.topology();
    let vm: Vec<_> = src
        .vertices
        .iter()
        .map(|v| d.add_vertex(v.point.add(offset)))
        .collect();
    let mut faces = Vec::new();
    for face in &src.faces {
        let Surface::Plane { origin, normal } = src.surfaces[face.surface.0];
        let s = d.add_plane(origin.add(offset), normal);
        let vs: Vec<_> = src.loops[face.loops[0].0]
            .coedges
            .iter()
            .map(|c| {
                let c = &src.coedges[c.0];
                vm[src.edges[c.edge.0].vertices
                    [usize::from(c.orientation == Orientation::Reversed)]
                .0]
            })
            .collect();
        faces.push(d.add_polygon(s, Orientation::Forward, &vs).unwrap());
    }
    let shell = ShellId(d.shells.len());
    d.shells.push(Shell { faces });
    d.solids.push(Solid {
        shells: vec![shell],
    });
    vm[0]
}

#[test]
fn trimmed_line_membership_decides_interior_exterior_and_coincident_vertices_exactly() {
    let samples = [
        (v3(0., 1., 0.), true), // parameter +/-2/3 is not representable as f64
        (v3(0., 3., 0.), true),
        (v3(0., 5., 0.), true),
        (v3(0., 0., 0.), true), // same position, different vertex ID
        (v3(0., 6., 0.), true),
        (v3(0., -0.5, 0.), false), // collinear, outside the trim
        (v3(0., 6.5, 0.), false),
        (v3(2_f64.powi(-40), 1., 0.), false),
        (v3(0., 1., 2_f64.powi(-40)), false),
        (v3(2., 6., 5.), false),
    ];
    for reversed in [false, true] {
        for axis in 0..4 {
            for (sample, expected) in samples {
                let mut d = Brep::cuboid(v3(2., 6., 5.)).unwrap().to_draft();
                let probe = add_probe_box(&mut d, sample);
                let edge = &mut d.edges[0]; // cube edge at x=z=0, y in [0,6]
                d.curves[edge.curve.0] = Curve::Line {
                    a: v3(0., 3., 0.),
                    b: v3(0., if reversed { 0. } else { 6. }, 0.),
                };
                edge.range = ParameterRange {
                    start: -1.,
                    end: 1.,
                };
                if reversed {
                    edge.vertices.swap(0, 1);
                    for c in &mut d.coedges {
                        if c.edge == EdgeId(0) {
                            c.orientation = c.orientation.reversed();
                        }
                    }
                }
                // Three cyclic permutations cover every axis. A determinant-one
                // shear makes the edge diagonal, with off-line probes INSIDE its
                // bounding box: omitting collinearity must not pass this table.
                let permute = |p: P3| {
                    if axis == 3 {
                        v3(p.x + p.y, p.y + p.z, p.z + p.x + p.y)
                    } else {
                        let c = [p.x, p.y, p.z];
                        v3(c[axis], c[(axis + 1) % 3], c[(axis + 2) % 3])
                    }
                };
                for v in &mut d.vertices {
                    v.point = permute(v.point);
                }
                for curve in &mut d.curves {
                    let Curve::Line { a, b } = curve;
                    *a = permute(*a);
                    *b = permute(*b);
                }
                for surface in &mut d.surfaces {
                    let Surface::Plane { origin, normal } = surface;
                    *origin = permute(*origin);
                    *normal = if axis == 3 {
                        // Inverse transpose of the shear, exactly in this fixture.
                        v3(
                            normal.y - normal.z,
                            normal.y - normal.x,
                            normal.x - normal.y + normal.z,
                        )
                    } else {
                        permute(*normal)
                    };
                }
                let b = d
                    .finish()
                    .unwrap()
                    .transformed(Rigid::around_axis(v3(3., -2., 5.), v3(1., 2., 3.), 0.1).unwrap());
                assert_eq!(
                    b.vertex_on_edge(probe, EdgeId(0)),
                    Ok(IncidenceDecision {
                        incidence: if expected {
                            Incidence::Contained
                        } else {
                            Incidence::NotContained
                        },
                        evidence: Evidence::ExactSourcePredicate,
                    }),
                    "{sample:?}, axis {axis}, reversed {reversed}"
                );
            }
        }
    }
}

#[test]
fn nonfinite_or_degenerate_constructions_never_reach_a_proven_body() {
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::from_bits(1),
        1e-151,
        1e151,
    ] {
        assert!(matches!(
            Brep::cuboid(v3(value, 1., 2.)),
            Err(Error::Numeric(_))
        ));
        assert!(matches!(
            Rigid::around_axis(v3(0., 0., 0.), v3(1., 2., 3.), value),
            Err(Error::Numeric(_))
        ));
    }
    for value in [0., -1., -2_f64.powi(-40)] {
        assert_eq!(
            Brep::cuboid(v3(value, 1., 2.)).unwrap_err(),
            Error::Degenerate("box size")
        );
    }
    assert_eq!(
        Rigid::around_axis(v3(0., 0., 0.), v3(0., 0., 0.), 0.1).unwrap_err(),
        Error::Degenerate("rotation axis")
    );
}
