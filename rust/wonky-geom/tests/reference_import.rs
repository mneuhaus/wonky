use num_traits::Signed;
use wonky_geom::import::{reference::ReferenceDraft, source_digest, Limits, Source};
const SI: &[u8] = include_bytes!("../../../fixtures/step-import/tetra-si.step");

fn chart_polygon(points: &[[i64; 2]]) -> Vec<wonky_geom::import::reference::HomogeneousSpan> {
    use wonky_alg::Polynomial;
    use wonky_geom::{import::reference::HomogeneousSpan, Q};
    let q = |n: i64| Q::from_integer(n.into());
    points
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let b = points[(i + 1) % points.len()];
            HomogeneousSpan {
                a: q(0),
                b: q(1),
                coordinates: vec![
                    Polynomial::from_integers(&[a[0], b[0] - a[0]]),
                    Polynomial::from_integers(&[a[1], b[1] - a[1]]),
                    Polynomial::from_integers(&[1]),
                ],
                chart_error_mm: q(0),
            }
        })
        .collect()
}

#[test]
fn exact_rational_circle_trims_preserve_long_arc_direction_and_full_ring() {
    use wonky_geom::{
        import::reference::{Axis, Curve},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let b = &mut d.bodies[0];
    let id = *b.edges.keys().next().unwrap();
    let edge = b.edges.get_mut(&id).unwrap();
    b.vertices.insert(edge.vertices[0], [q(1), q(0), q(0)]);
    b.vertices.insert(edge.vertices[1], [q(0), q(1), q(0)]);
    edge.curve = Curve::Circle {
        axis: Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        },
        radius: q(1),
        dimension: 3,
    };
    edge.same_sense = true;
    let precision = q(1) / q(1000);
    let short = b.edge_extents(id, &precision).unwrap();
    assert!(short.coordinates[0].minimum.lower_mm >= q(0));
    assert!(short.coordinates[1].minimum.lower_mm >= q(0));
    b.edges.get_mut(&id).unwrap().same_sense = false;
    let long = b.edge_extents(id, &precision).unwrap();
    for extent in &long.coordinates[..2] {
        assert!(extent.minimum.lower_mm <= q(-1));
        assert!(extent.minimum.upper_mm >= q(-1));
        assert!(extent.maximum.lower_mm <= q(1));
        assert!(extent.maximum.upper_mm >= q(1));
    }
    let edge = b.edges.get_mut(&id).unwrap();
    edge.vertices[1] = edge.vertices[0];
    let ring = b.edge_polyline(id, &(q(1) / q(100))).unwrap();
    assert!(ring.closed);
    assert_eq!(
        ring.samples.first().unwrap().source_point_mm,
        ring.samples.last().unwrap().source_point_mm
    );
    assert!(ring
        .samples
        .iter()
        .any(|p| p.source_point_mm[0] < -q(9) / q(10)));
    assert!(ring
        .samples
        .iter()
        .any(|p| p.source_point_mm[1] < -q(9) / q(10)));
}

#[test]
fn complete_chart_sphere_extrema_include_interior_and_exclude_holes() {
    use wonky_geom::{
        import::reference::{Axis, Carrier, FaceChartDomain},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let b = &mut d.bodies[0];
    let id = b.faces[0].id;
    let surface = b.faces[0].surface;
    b.surfaces.insert(
        surface,
        Carrier::Sphere(
            Axis {
                origin: [q(0), q(0), q(0)],
                axis: [q(0), q(0), q(1)],
                reference: [q(1), q(0), q(0)],
            },
            q(10),
        ),
    );
    let outer = chart_polygon(&[[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    let domain = FaceChartDomain::new(vec![outer.clone()]).unwrap();
    let precision = q(1) / q(100);
    let extents = b.face_chart_extents(id, &domain, &precision).unwrap();
    let x = &extents.coordinates[0];
    assert!(x.maximum.lower_mm <= q(10) && x.maximum.upper_mm >= q(10));
    assert!(x.maximum.lower_mm > q(999) / q(100));
    // A central hole removes the stationary maximum. This rejects the
    // compact full-carrier box and boundary-only/control-polygon shortcuts.
    let mut hole = chart_polygon(&[[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    for span in &mut hole {
        for p in &mut span.coordinates[..2] {
            *p = p.scale(&(q(1) / q(2))).unwrap();
        }
    }
    let holed = FaceChartDomain::new(vec![outer, hole]).unwrap();
    let extents = b.face_chart_extents(id, &holed, &precision).unwrap();
    assert!(extents.coordinates[0].maximum.upper_mm < q(9));
    for extent in extents.coordinates {
        assert!(&extent.minimum.upper_mm - &extent.minimum.lower_mm <= precision);
        assert!(&extent.maximum.upper_mm - &extent.maximum.lower_mm <= precision);
    }
}

#[test]
fn complete_chart_torus_extrema_are_tight_not_compact_carrier_boxes() {
    use wonky_geom::{
        import::reference::{Axis, Carrier, FaceChartDomain},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let b = &mut d.bodies[0];
    let id = b.faces[0].id;
    b.surfaces.insert(
        b.faces[0].surface,
        Carrier::Torus(
            Axis {
                origin: [q(0), q(0), q(0)],
                axis: [q(0), q(0), q(1)],
                reference: [q(1), q(0), q(0)],
            },
            q(10),
            q(2),
        ),
    );
    let domain =
        FaceChartDomain::new(vec![chart_polygon(&[[-1, -1], [1, -1], [1, 1], [-1, 1]])]).unwrap();
    let precision = q(1) / q(100);
    let extents = b.face_chart_extents(id, &domain, &precision).unwrap();
    assert!(extents.coordinates[0].maximum.lower_mm > q(1199) / q(100));
    assert!(extents.coordinates[0].maximum.upper_mm >= q(12));
    assert!(extents.coordinates[0].minimum.lower_mm > q(5));
    assert!(extents.coordinates[2].maximum.upper_mm < q(17) / q(10));
    assert!(extents.coordinates[2].minimum.lower_mm > -q(17) / q(10));
    for extent in extents.coordinates {
        assert!(&extent.minimum.upper_mm - &extent.minimum.lower_mm <= precision);
        assert!(&extent.maximum.upper_mm - &extent.maximum.lower_mm <= precision);
    }
}

#[test]
fn finite_chart_domains_refuse_disconnection_crossings_and_external_holes() {
    use wonky_geom::import::reference::FaceChartDomain;
    let outer = chart_polygon(&[[0, 0], [4, 0], [4, 4], [0, 4]]);
    let mut broken = outer.clone();
    broken.pop();
    assert_eq!(
        FaceChartDomain::new(vec![broken]).unwrap_err().name,
        "import/trim-domain-disconnected"
    );
    assert!(FaceChartDomain::new(vec![chart_polygon(&[[0, 0], [4, 4], [0, 4], [4, 0]])]).is_err());
    let outside = chart_polygon(&[[5, 5], [6, 5], [6, 6], [5, 6]]);
    assert_eq!(
        FaceChartDomain::new(vec![outer.clone(), outside])
            .unwrap_err()
            .name,
        "import/trim-domain-hole-outside"
    );
    let nested = vec![
        outer,
        chart_polygon(&[[1, 1], [3, 1], [3, 3], [1, 3]]),
        chart_polygon(&[[1, 1], [2, 1], [2, 2], [1, 2]]),
    ];
    assert!(FaceChartDomain::new(nested).is_err());
}

#[test]
fn planar_source_faces_bind_their_actual_trim_domains_and_placements() {
    use wonky_geom::{import::reference::Axis, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let b = &mut d.bodies[0];
    let precision = q(1) / q(1000);
    let before = b
        .faces
        .iter()
        .map(|f| b.planar_face_extents(f.id, &precision).unwrap())
        .collect::<Vec<_>>();
    let side = q(15875) / q(8);
    for f in &before {
        for extent in &f.coordinates {
            assert_eq!(extent.minimum.lower_mm, q(0));
            assert_eq!(extent.minimum.upper_mm, q(0));
            assert!(extent.maximum.upper_mm == q(0) || extent.maximum.upper_mm == side);
            assert_eq!(extent.maximum.lower_mm, extent.maximum.upper_mm);
        }
    }
    let from = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let to = Axis {
        origin: [q(10), q(20), q(30)],
        axis: [q(0), q(0), q(1)],
        reference: [q(0), q(1), q(0)],
    };
    b.placements.push((from, to));
    for old in before {
        let placed = b.planar_face_extents(old.source_face, &precision).unwrap();
        for i in 0..3 {
            let (source, offset, neg) = match i {
                0 => (1, q(10), true),
                1 => (0, q(20), false),
                _ => (2, q(30), false),
            };
            let expected = if neg {
                &offset - &old.coordinates[source].maximum.upper_mm
            } else {
                &offset + &old.coordinates[source].minimum.lower_mm
            };
            assert!((&placed.coordinates[i].minimum.lower_mm - expected).abs() <= precision);
            assert!(
                &placed.coordinates[i].minimum.upper_mm - &placed.coordinates[i].minimum.lower_mm
                    <= precision
            );
            assert!(
                &placed.coordinates[i].maximum.upper_mm - &placed.coordinates[i].maximum.lower_mm
                    <= precision
            );
        }
    }
}
fn decode(bytes: &[u8]) -> ReferenceDraft {
    ReferenceDraft::step(
        bytes,
        Source {
            digest: source_digest(bytes),
            revision: None,
            instance_path: vec![],
        },
        Limits::default(),
    )
    .unwrap()
}
fn tetra_with_declared_zero_uncertainty() -> ReferenceDraft {
    // The owned tetra has exact rational observations, but I0's source does
    // not assert uncertainty. Add an explicit assertion to this synthetic
    // source rather than inventing a tolerance in the production validator.
    let text = std::str::from_utf8(SI).unwrap()
        .replace("GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#85))",
            "GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#1000)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#85))")
        .replace("ENDSEC;\nEND-ISO-10303-21;",
            "#1000=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.),#85,'exact owned observations','not manufacturing accuracy');\nENDSEC;\nEND-ISO-10303-21;");
    decode(text.as_bytes())
}
#[test]
fn reference_topology_preserves_every_face_and_source_vertex() {
    let d = decode(SI);
    d.check_topology().unwrap();
    assert_eq!(d.bodies.len(), 1);
    assert_eq!(d.bodies[0].faces.len(), 4);
    assert_eq!(d.bodies[0].edges.len(), 6);
    assert_eq!(d.bodies[0].vertices.len(), 4);
}
#[test]
fn reference_vertices_check_every_curve_and_incident_surface() {
    use wonky_geom::{import::reference::Carrier, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    assert_eq!(d.check_vertices().unwrap().len(), 12);
    let body = &mut d.bodies[0];
    let surface = body.faces[0].surface;
    let Carrier::Plane(axis) = body.surfaces.get_mut(&surface).unwrap() else {
        panic!()
    };
    for i in 0..3 {
        axis.origin[i] += &axis.axis[i] * q(10);
    }
    assert_eq!(
        d.check_vertices().unwrap_err().name,
        "import/vertex-surface-mismatch"
    );
}
#[test]
fn vertex_checks_never_invent_missing_source_uncertainty() {
    assert_eq!(
        decode(SI).check_vertices().unwrap_err().name,
        "import/source-tolerance-missing"
    );
}
#[test]
fn displaced_source_vertex_does_not_pass_edge_incidence() {
    use wonky_geom::{import::reference::Curve, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let body = &mut d.bodies[0];
    let edge = body.edges.values().next().unwrap();
    let vertex = edge.vertices[0];
    let Curve::Line { direction, .. } = &edge.curve else {
        panic!()
    };
    let mut delta = [-direction[1].clone(), direction[0].clone(), q(0)];
    if delta == [q(0), q(0), q(0)] {
        delta = [q(1), q(0), q(0)];
    }
    let p = body.vertices.get_mut(&vertex).unwrap();
    for i in 0..3 {
        p[i] += &delta[i];
    }
    assert_eq!(
        d.check_vertices().unwrap_err().name,
        "import/vertex-curve-mismatch"
    );
}
#[test]
fn spline_vertex_endpoints_obey_edge_same_sense() {
    use wonky_geom::{import::reference::Curve, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let body = &mut d.bodies[0];
    let edge = body.edges.values_mut().next().unwrap();
    edge.curve = Curve::Spline {
        degree: 1,
        points: edge
            .vertices
            .iter()
            .rev()
            .map(|v| body.vertices[v].to_vec())
            .collect(),
        weights: vec![q(1), q(1)],
        knots: vec![q(0), q(0), q(1), q(1)],
    };
    edge.same_sense = false;
    d.check_vertices().unwrap();
    d.bodies[0].edges.values_mut().next().unwrap().same_sense = true;
    assert_eq!(
        d.check_vertices().unwrap_err().name,
        "import/vertex-curve-mismatch"
    );
}
#[test]
fn reversed_coedge_is_not_a_valid_reference() {
    let s = std::str::from_utf8(SI).unwrap();
    let start = s.find("ORIENTED_EDGE").unwrap();
    let end = start + s[start..].find(';').unwrap();
    let old = &s[start..end];
    let new = old.replace(".T.", ".F.");
    assert_ne!(old, new);
    let s = s.replacen(old, &new, 1);
    let d = decode(s.as_bytes());
    assert_eq!(
        d.check_topology().unwrap_err().name,
        "import/coedge-disconnected"
    );
}
#[test]
fn cubic_between_samples_refuses_by_whole_domain_certificate() {
    use wonky_geom::{
        import::reference::{Axis, Carrier, Curve},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let axis = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let spline = |height| Curve::Spline {
        degree: 3,
        points: vec![
            vec![q(0), q(0), q(0)],
            vec![q(1), q(0), q(height)],
            vec![q(2), q(0), q(-height)],
            vec![q(3), q(0), q(0)],
        ],
        weights: vec![q(1); 4],
        knots: vec![q(0), q(0), q(0), q(0), q(1), q(1), q(1), q(1)],
    };
    let plane = Carrier::Plane(axis);
    plane
        .certify_spans(&spline(0).homogeneous_spans().unwrap(), &q(0))
        .unwrap();
    // z=0 at t=0, 1/2 and 1, but the interior leaves the plane.
    assert_eq!(
        plane
            .certify_spans(
                &spline(1).homogeneous_spans().unwrap(),
                &(q(1) / q(1_000_000))
            )
            .unwrap_err()
            .name,
        "import/curve-off-surface"
    );
}
#[test]
fn producer_wrapped_header_string_is_preserved() {
    use wonky_geom::import::part21::Document;
    let s = std::str::from_utf8(SI).unwrap().replace(
        "Planar tetrahedron exact import test",
        "Planar tetrahedron\n exact import test",
    );
    Document::parse(s.as_bytes(), Limits::default()).unwrap();
}
#[test]
fn g8_circle_charts_certify_torus_and_sphere_incidence() {
    use wonky_geom::{
        import::reference::{Axis, Carrier, Curve},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let axis = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let circle = |r| Curve::Circle {
        axis: axis.clone(),
        radius: q(r),
        dimension: 3,
    };
    let sphere = Carrier::Sphere(axis.clone(), q(4));
    sphere
        .certify_spans(&circle(4).homogeneous_spans().unwrap(), &q(0))
        .unwrap();
    let torus = Carrier::Torus(axis.clone(), q(5), q(1));
    torus
        .certify_spans(&circle(4).homogeneous_spans().unwrap(), &q(0))
        .unwrap();
    torus
        .certify_spans(&circle(6).homogeneous_spans().unwrap(), &q(0))
        .unwrap();
    assert_eq!(
        torus
            .certify_spans(&circle(5).homogeneous_spans().unwrap(), &(q(1) / q(100)))
            .unwrap_err()
            .name,
        "import/curve-off-surface"
    );
}
const ANALYTICAL: &[u8] = include_bytes!("../../../fixtures/step-reference/analytical.step");

#[test]
fn face_support_bounds_include_sphere_and_torus_interior_extrema() {
    use wonky_geom::import::reference::Carrier;
    use wonky_geom::Q;
    let q = |n: i64| Q::from_integer(n.into());
    let d = decode(ANALYTICAL);
    for body in &d.bodies {
        for face in &body.faces {
            let bounds = body.face_support_bounds(face.id).unwrap();
            assert_eq!(bounds.source_face, face.id);
            let radius = match &body.surfaces[&face.surface] {
                Carrier::Sphere(_, r) => Some(r.clone()),
                Carrier::Torus(_, r, minor) => Some(r + minor),
                _ => None,
            };
            if let Some(radius) = radius {
                assert!(!bounds.requires_bounded_trim);
                let axis = body.surfaces[&face.surface].axis();
                // Full-carrier conservative enclosure deliberately includes
                // poles and radial maxima absent from the ring vertices.
                for i in 0..3 {
                    let center = &axis.origin[i] + if i == 2 { q(18) } else { q(0) };
                    assert!(bounds.coordinates[i].lower_mm <= &center - &radius);
                    assert!(bounds.coordinates[i].upper_mm >= &center + &radius);
                }
            }
        }
        let bounds = body.body_support_bounds().unwrap().coordinates;
        for vertex in body.placed_vertex_bounds().unwrap().values() {
            for i in 0..3 {
                assert!(bounds[i].lower_mm <= vertex[i].lower_mm);
                assert!(bounds[i].upper_mm >= vertex[i].upper_mm);
            }
        }
    }
}

#[test]
fn face_bounds_refuse_off_surface_edges_and_missing_uncertainty() {
    use wonky_geom::Q;
    let mut d = tetra_with_declared_zero_uncertainty();
    let body = &mut d.bodies[0];
    let face_id = body.faces[0].id;
    let surface_id = body.faces[0].surface;
    if let wonky_geom::import::reference::Carrier::Plane(axis) =
        body.surfaces.get_mut(&surface_id).unwrap()
    {
        for i in 0..3 {
            axis.origin[i] += &axis.axis[i] * Q::from_integer(10.into());
        }
    } else {
        panic!()
    }
    assert_eq!(
        body.face_support_bounds(face_id).unwrap_err().name,
        "import/curve-off-surface"
    );
    let d = decode(SI);
    assert_eq!(
        d.bodies[0]
            .face_support_bounds(d.bodies[0].faces[0].id)
            .unwrap_err()
            .name,
        "import/source-tolerance-missing"
    );
}

#[test]
fn face_bounds_cover_curved_interiors_after_nonaxial_placement() {
    use wonky_geom::{import::reference::Axis, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = decode(ANALYTICAL);
    for body in &mut d.bodies {
        body.placements = vec![(
            Axis {
                origin: [q(0), q(0), q(0)],
                axis: [q(0), q(0), q(1)],
                reference: [q(1), q(0), q(0)],
            },
            Axis {
                origin: [q(10), q(-4), q(8)],
                axis: [q(1), q(2), q(3)],
                reference: [q(2), q(-1), q(0)],
            },
        )];
        for face in &body.faces {
            let bounds = body.face_support_bounds(face.id).unwrap();
            // These are witnesses only; the whole-domain enclosure is proved
            // by the production carrier-support and boundary-hull arguments.
            let axis = body.surfaces[&face.surface].axis();
            for (eid, _) in face.loops.iter().flat_map(|lp| &lp.uses) {
                for p in body.edges[eid].vertices.iter().map(|v| &body.vertices[v]) {
                    let point = body.placed_point_bounds(p).unwrap();
                    for i in 0..3 {
                        assert!(bounds.coordinates[i].lower_mm <= point[i].lower_mm);
                        assert!(bounds.coordinates[i].upper_mm >= point[i].upper_mm);
                    }
                }
            }
            assert!(axis.enclosed_frame().is_ok());
        }
    }
}

#[test]
fn cone_face_bounds_include_singular_apex_even_without_a_boundary_vertex_there() {
    use wonky_geom::{import::reference::Carrier, Q};
    let mut d = decode(ANALYTICAL);
    let body = d.bodies.iter_mut().find(|b| b.name == "cone").unwrap();
    let index = body
        .faces
        .iter()
        .position(|f| matches!(body.surfaces[&f.surface], Carrier::Cone(..)))
        .unwrap();
    let face = &mut body.faces[index];
    face.loops.truncate(1);
    let id = face.id;
    let bounds = body.face_support_bounds(id).unwrap();
    assert!(bounds.requires_bounded_trim);
    let Carrier::Cone(axis, radius, _) = &body.surfaces[&body.faces[index].surface] else {
        panic!()
    };
    // The fixture semi-angle is the binary64 observation of pi/4, radius 1;
    // the apex lies just below z=-1, and is translated by +18 mm.
    let near_apex_z = &axis.origin[2] + Q::from_integer(18.into()) - radius;
    assert!(bounds.coordinates[2].lower_mm < near_apex_z);
    assert!(body.vertices.values().all(|p| p[2] > -radius));
}
#[test]
fn omitted_reference_direction_uses_step_perpendicular_default() {
    use wonky_geom::{import::reference::Carrier, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let text = std::str::from_utf8(ANALYTICAL)
        .unwrap()
        .replace(
            "#2=DIRECTION('',(0.,0.,1.));",
            "#2=DIRECTION('',(1.,0.,0.));",
        )
        .replace(
            "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
            "#4=AXIS2_PLACEMENT_3D('',#1,#2,$);",
        );
    assert_ne!(text.as_bytes(), ANALYTICAL);
    let d = decode(text.as_bytes());
    let Carrier::Cylinder(axis, _) = &d.bodies[0].surfaces[&5] else {
        panic!()
    };
    assert_eq!(axis.axis, [q(1), q(0), q(0)]);
    assert_eq!(axis.reference, [q(0), q(1), q(0)]);
    assert!(axis.enclosed_frame().unwrap().0.is_isometry());
    let explicit = text.replace(
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,$);",
        "#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);",
    );
    assert_eq!(
        ReferenceDraft::step(
            explicit.as_bytes(),
            Source {
                digest: source_digest(explicit.as_bytes()),
                revision: None,
                instance_path: vec![],
            },
            Limits::default()
        )
        .unwrap_err()
        .name,
        "import/placement-degenerate"
    );
}
#[test]
fn nested_source_placements_are_applied_to_every_vertex() {
    use wonky_geom::Q;
    let d = decode(ANALYTICAL);
    for body in &d.bodies {
        let bounds = body.placed_vertex_bounds().unwrap();
        assert_eq!(bounds.len(), body.vertices.len());
        for (id, p) in &body.vertices {
            for i in 0..3 {
                let expected = &p[i] + Q::from_integer(if i == 2 { 18 } else { 0 }.into());
                assert_eq!(bounds[id][i].lower_mm, expected);
                assert_eq!(bounds[id][i].upper_mm, expected);
            }
        }
    }
}
#[test]
fn nested_placement_origins_use_each_representation_unit_once() {
    use wonky_geom::Q;
    let additions = "#400=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#267);\n#401=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n#402=(CONVERSION_BASED_UNIT('inch',#400) LENGTH_UNIT() NAMED_UNIT(#401));\n#403=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#402)) REPRESENTATION_CONTEXT('',''));\n";
    let text = std::str::from_utf8(ANALYTICAL)
        .unwrap()
        .replace(
            "#275=SHAPE_REPRESENTATION('root',(#274),#269);",
            "#275=SHAPE_REPRESENTATION('root',(#274),#403);",
        )
        .replace(
            "ENDSEC;\nEND-ISO-10303-21;",
            &(additions.to_owned() + "ENDSEC;\nEND-ISO-10303-21;"),
        );
    let d = decode(text.as_bytes());
    // First translation 7 mm, then 11 inches = 279.4 mm. Source
    // vertices stay in their child representation's millimetre units.
    for body in &d.bodies {
        let placed = body.placed_vertex_bounds().unwrap();
        assert_eq!(body.unit_to_mm, Q::from_integer(1.into()));
        for (id, p) in &body.vertices {
            let expected = &p[2] + Q::new(1432.into(), 5.into());
            assert_eq!(placed[id][2].lower_mm, expected);
            assert_eq!(placed[id][2].upper_mm, expected);
            assert_eq!(placed[id][0].lower_mm, p[0]);
            assert_eq!(placed[id][1].lower_mm, p[1]);
        }
    }
}
#[test]
fn rigid_placement_uses_source_inverse_and_nested_target_rotation() {
    use wonky_geom::{import::reference::Axis, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let identity = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let source = Axis {
        origin: [q(10), q(20), q(30)],
        reference: [q(0), q(1), q(0)],
        ..identity.clone()
    };
    let target = Axis {
        origin: [q(1), q(2), q(3)],
        ..identity.clone()
    };
    let outer = Axis {
        origin: [q(-1), q(-2), q(-3)],
        reference: [q(-1), q(0), q(0)],
        ..identity.clone()
    };
    let mut body = decode(SI).bodies.remove(0);
    body.placements = vec![(source, target), (identity, outer)];
    // (10,22,30) is source-local (2,0,0). Inner -> (3,2,3),
    // outer half-turn plus translation -> (-4,-4,0).
    let bounds = body.placed_point_bounds(&[q(10), q(22), q(30)]).unwrap();
    for (bound, expected) in bounds.iter().zip([-4, -4, 0]) {
        assert_eq!(bound.lower_mm, q(expected));
        assert_eq!(bound.upper_mm, q(expected));
    }
}
#[test]
fn irrational_placement_axis_has_certified_nonzero_width() {
    use wonky_geom::{import::reference::Axis, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let source = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let target = Axis {
        axis: [q(1), q(1), q(0)],
        reference: [q(0), q(0), q(1)],
        ..source.clone()
    };
    let mut body = decode(SI).bodies.remove(0);
    body.placements = vec![(source, target)];
    let bounds = body.placed_point_bounds(&[q(0), q(0), q(1)]).unwrap();
    for bound in &bounds[..2] {
        // 1/sqrt(2), checked without using rounded floating-point roots.
        assert!(bound.lower_mm > q(0));
        assert!(&bound.lower_mm * &bound.lower_mm < q(1) / q(2));
        assert!(&bound.upper_mm * &bound.upper_mm > q(1) / q(2));
        assert!(&bound.upper_mm - &bound.lower_mm < q(1) / q(1_000_000_000));
    }
    assert_eq!(bounds[2].lower_mm, q(0));
    assert_eq!(bounds[2].upper_mm, q(0));
}
#[test]
fn degenerate_placement_cannot_publish_point_bounds() {
    use wonky_geom::{import::reference::Axis, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let axis = Axis {
        origin: [q(0), q(0), q(0)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    let mut body = decode(SI).bodies.remove(0);
    body.placements = vec![(
        Axis {
            axis: [q(0), q(0), q(0)],
            ..axis.clone()
        },
        axis,
    )];
    assert_eq!(
        body.placed_point_bounds(&[q(1), q(2), q(3)])
            .unwrap_err()
            .name,
        "import/placement-degenerate"
    );
}
#[test]
fn branching_assembly_is_bounded_even_when_the_source_graph_is_small() {
    let mut additions = String::new();
    let mut child = 275;
    // Two occurrences per level: only 36 new entities, but 4096 paths.
    for i in 0..12 {
        let parent = 1000 + i * 10;
        additions.push_str(&format!(
            "#{parent}=SHAPE_REPRESENTATION('branch',(#274),#269);\n"
        ));
        for rid in [parent + 1, parent + 2] {
            additions.push_str(&format!(
                "#{rid}=(REPRESENTATION_RELATIONSHIP('','',#{child},#{parent}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#299) SHAPE_REPRESENTATION_RELATIONSHIP());\n"
            ));
        }
        child = parent;
    }
    let bytes = std::str::from_utf8(ANALYTICAL)
        .unwrap()
        .replace(
            "ENDSEC;\nEND-ISO-10303-21;",
            &(additions + "ENDSEC;\nEND-ISO-10303-21;"),
        )
        .into_bytes();
    let result = ReferenceDraft::step(
        &bytes,
        Source {
            digest: source_digest(&bytes),
            revision: None,
            instance_path: vec![],
        },
        Limits {
            values: 20_000,
            ..Limits::default()
        },
    );
    assert_eq!(result.unwrap_err().name, "import/placement-expansion-limit");
}
#[test]
fn instance_expansion_budget_includes_source_label_storage() {
    let text = std::str::from_utf8(ANALYTICAL).unwrap().replace(
        "MANIFOLD_SOLID_BREP('cylinder',#77)",
        &format!("MANIFOLD_SOLID_BREP('{}',#77)", "x".repeat(15_000)),
    );
    let result = ReferenceDraft::step(
        text.as_bytes(),
        Source {
            digest: source_digest(text.as_bytes()),
            revision: None,
            instance_path: vec![],
        },
        Limits {
            values: 10_000,
            ..Limits::default()
        },
    );
    assert_eq!(result.unwrap_err().name, "import/placement-expansion-limit");
}
#[test]
fn all_analytic_carriers_pcurves_and_nested_instances_are_retained() {
    use wonky_geom::{import::reference::Carrier, Q};
    let d = decode(ANALYTICAL);
    d.check_topology().unwrap();
    assert_eq!(d.bodies.len(), 4);
    assert_eq!(d.bodies.iter().map(|b| b.faces.len()).sum::<usize>(), 10);
    assert!(d.bodies.iter().all(|b| b.placements.len() == 2));
    assert!(d.bodies.iter().all(|b|matches!(&b.uncertainty,wonky_geom::import::Uncertainty::Declared{mm} if mm>&Q::from_integer(0.into()))));
    let mut kinds = [false; 5];
    for b in &d.bodies {
        for s in b.surfaces.values() {
            kinds[match s {
                Carrier::Plane(_) => 0,
                Carrier::Cylinder(_, _) => 1,
                Carrier::Cone(_, _, _) => 2,
                Carrier::Sphere(_, _) => 3,
                Carrier::Torus(_, _, _) => 4,
                Carrier::Spline(..) => unreachable!("this test enumerates analytic carriers"),
            }] = true;
        }
    }
    assert_eq!(kinds, [true; 5]);
    assert!(d
        .bodies
        .iter()
        .flat_map(|b| b.edges.values())
        .all(|e| e.pcurves.len() == 2));
}
#[test]
fn dropping_a_torus_face_reports_source_face_unaccounted() {
    let s = std::str::from_utf8(ANALYTICAL).unwrap();
    let line = s
        .lines()
        .find(|l| l.contains("ADVANCED_FACE('torus band'"))
        .unwrap();
    let id = line.split('=').next().unwrap();
    let shell = s
        .lines()
        .find(|l| l.contains("CLOSED_SHELL") && l.contains(&format!("({id},")))
        .unwrap();
    let modified = s.replacen(shell, &shell.replace(&format!("{id},"), ""), 1);
    let error = ReferenceDraft::step(
        modified.as_bytes(),
        Source {
            digest: source_digest(modified.as_bytes()),
            revision: None,
            instance_path: vec![],
        },
        Limits::default(),
    )
    .unwrap_err();
    assert_eq!(error.name, "import/source-face-unaccounted");
}
#[test]
fn every_analytic_fixture_edge_has_a_whole_domain_surface_certificate() {
    let d = decode(ANALYTICAL);
    assert_eq!(d.check_boundary_surfaces().unwrap().len(), 14);
}
#[test]
fn reference_si_and_inch_conversion_is_exact_and_not_display_rounding() {
    let si = decode(SI);
    let inch = decode(include_bytes!(
        "../../../fixtures/step-import/tetra-inch.step"
    ));
    assert_eq!(si.bodies[0].vertices, inch.bodies[0].vertices);
    assert_ne!(si.bodies[0].unit_to_mm, inch.bodies[0].unit_to_mm);
}
const RATIONAL_PCURVES: &[u8] =
    include_bytes!("../../../fixtures/step-reference/rational-pcurves.step");
#[test]
fn rational_planar_pcurve_correspondence_is_certified_over_every_span() {
    let d = decode(RATIONAL_PCURVES);
    d.check_topology().unwrap();
    assert_eq!(d.check_pcurves().unwrap().len(), 2);
    assert_eq!(d.check_boundary_surfaces().unwrap().len(), 12);
}
#[test]
fn pcurve_component_checks_require_real_source_ids() {
    let d = decode(RATIONAL_PCURVES);
    let b = &d.bodies[0];
    let edge = b.edges.values().find(|e| !e.pcurves.is_empty()).unwrap();
    assert_eq!(
        b.check_pcurve(u32::MAX, edge.pcurves[0].id)
            .unwrap_err()
            .name,
        "import/edge-unaccounted"
    );
    assert_eq!(
        b.check_pcurve(edge.id, u32::MAX).unwrap_err().name,
        "import/pcurve-unaccounted"
    );
    for edge in b.edges.values() {
        for pc in &edge.pcurves {
            assert!(
                b.check_pcurve(edge.id, pc.id).unwrap().upper_mm
                    >= wonky_geom::Q::from_integer(0.into())
            );
        }
    }
}
#[test]
fn high_degree_coaxial_circle_pcurve_uses_exact_cylindrical_identity() {
    use wonky_geom::{
        import::{
            reference::{Carrier, Curve},
            Validation,
        },
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = decode(ANALYTICAL);
    let body = &mut d.bodies[0];
    let (edge_id, pc_id, height) = body
        .edges
        .values()
        .find_map(|edge| {
            let Curve::Circle { axis, .. } = &edge.curve else {
                return None;
            };
            edge.pcurves
                .iter()
                .find(|pc| pc.surface == 5)
                .map(|pc| (edge.id, pc.id, axis.origin[2].clone()))
        })
        .unwrap();
    assert!(matches!(body.surfaces[&5], Carrier::Cylinder(_, _)));
    let pc = body
        .edges
        .get_mut(&edge_id)
        .unwrap()
        .pcurves
        .iter_mut()
        .find(|pc| pc.id == pc_id)
        .unwrap();
    pc.curve = Curve::Spline {
        degree: 7,
        points: (0..8).map(|i| vec![q(i) / q(28), height.clone()]).collect(),
        weights: (0..8).map(|i| q(1 + i % 2)).collect(),
        knots: [vec![q(0); 8], vec![q(1); 8]].concat(),
    };
    let proof = body.check_pcurve(edge_id, pc_id).unwrap();
    assert_eq!(
        proof.method,
        "exact-rational/cylindrical-coordinate-circle-identity"
    );
    let Curve::Spline { points, .. } = &mut body
        .edges
        .get_mut(&edge_id)
        .unwrap()
        .pcurves
        .iter_mut()
        .find(|pc| pc.id == pc_id)
        .unwrap()
        .curve
    else {
        panic!()
    };
    for point in points {
        point[1] += q(1) / q(100);
    }
    assert_eq!(
        body.check_pcurve(edge_id, pc_id).unwrap_err().name,
        "import/pcurve-lift-mismatch"
    );
    assert_eq!(d.state.validation, Validation::Decoded);
}
#[test]
fn rational_pcurve_interior_mismatch_is_named() {
    let s = std::str::from_utf8(RATIONAL_PCURVES).unwrap();
    assert!(s.contains("#1011=CARTESIAN_POINT('',(992.1875,0.));"));
    let s = s.replace(
        "#1011=CARTESIAN_POINT('',(992.1875,0.));",
        "#1011=CARTESIAN_POINT('',(992.1875,1.));",
    );
    assert_eq!(
        decode(s.as_bytes()).check_pcurves().unwrap_err().name,
        "import/pcurve-lift-mismatch"
    );
}
#[test]
fn fixture_bytes_are_bound_to_owned_provenance() {
    let provenance = include_str!("../../../fixtures/step-reference/provenance.json");
    for bytes in [ANALYTICAL, RATIONAL_PCURVES] {
        let hash = source_digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert!(
            provenance.contains(&hash),
            "fixture hash must match frozen provenance: {hash}"
        );
    }
    assert!(provenance.contains("CC0-1.0"));
}
#[test]
fn partial_reference_certificates_never_promote_an_exact_or_admitted_body() {
    use wonky_geom::import::Validation;
    let d = decode(ANALYTICAL);
    d.check_boundary_surfaces().unwrap();
    assert_eq!(d.state.validation, Validation::Decoded);
    let proofs = d.check_pcurves().unwrap();
    let expected = d
        .bodies
        .iter()
        .flat_map(|b| b.edges.values())
        .flat_map(|e| e.pcurves.iter())
        .map(|p| p.id)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        proofs
            .iter()
            .map(|(id, _)| *id)
            .collect::<std::collections::BTreeSet<_>>(),
        expected
    );
    assert_eq!(proofs.len(), expected.len());
    assert_eq!(proofs.len(), 14);
    assert!(proofs.iter().all(|(_, proof)| proof.lower_mm
        >= wonky_geom::Q::from_integer(0.into())
        && proof.upper_mm
            == match &d.bodies[0].uncertainty {
                wonky_geom::import::Uncertainty::Declared { mm } => mm.clone(),
                wonky_geom::import::Uncertainty::Unknown =>
                    panic!("owned fixture declares uncertainty"),
            }));
    assert_eq!(d.state.validation, Validation::Decoded);
}
#[test]
fn unsupported_second_solid_never_publishes_the_other_bodies() {
    let s = std::str::from_utf8(ANALYTICAL)
        .unwrap()
        .replace("CONICAL_SURFACE(", "OFFSET_SURFACE(");
    let result = ReferenceDraft::step(
        s.as_bytes(),
        Source {
            digest: source_digest(s.as_bytes()),
            revision: None,
            instance_path: vec![],
        },
        Limits::default(),
    );
    assert_eq!(
        result.unwrap_err().name,
        "import/entity-unsupported:OFFSET_SURFACE"
    );
}
#[test]
fn item_defined_placement_cycles_are_named() {
    let s = std::str::from_utf8(ANALYTICAL).unwrap();
    let relationship = s
        .split("REPRESENTATION_RELATIONSHIP('','',")
        .nth(1)
        .unwrap()
        .split(')')
        .next()
        .unwrap();
    let child = relationship.split(',').next().unwrap();
    let s = s.replacen(
        &format!("REPRESENTATION_RELATIONSHIP('','',{relationship})"),
        &format!("REPRESENTATION_RELATIONSHIP('','',{child},{child})"),
        1,
    );
    assert_eq!(
        ReferenceDraft::step(
            s.as_bytes(),
            Source {
                digest: source_digest(s.as_bytes()),
                revision: None,
                instance_path: vec![]
            },
            Limits::default()
        )
        .unwrap_err()
        .name,
        "import/placement-cycle"
    );
}
#[test]
fn owned_cone_pcurve_uses_step_slant_parameter() {
    use num_traits::ToPrimitive;
    use wonky_geom::import::reference::{Carrier, Curve};
    let d = decode(ANALYTICAL);
    let body = d.bodies.iter().find(|b| b.name == "cone").unwrap();
    for e in body.edges.values() {
        let Curve::Circle {
            axis: circle,
            radius,
            ..
        } = &e.curve
        else {
            panic!("cone ring fixture")
        };
        for pc in &e.pcurves {
            let Carrier::Cone(axis, r, angle) = &body.surfaces[&pc.surface] else {
                continue;
            };
            let Curve::Line { origin, .. } = &pc.curve else {
                panic!("cone angular pcurve")
            };
            let slant = origin[1].to_f64().unwrap();
            let angle = angle.to_f64().unwrap();
            assert!(
                (slant * angle.cos() + axis.origin[2].to_f64().unwrap()
                    - circle.origin[2].to_f64().unwrap())
                .abs()
                    < 1e-6
            );
            assert!(
                (r.to_f64().unwrap() + slant * angle.sin() - radius.to_f64().unwrap()).abs() < 1e-6
            );
        }
    }
}

#[test]
fn nominal_carrier_queries_keep_source_status_and_apply_placements() {
    use wonky_geom::import::{reference::Carrier, Validation};
    use wonky_geom::Q;
    let d = decode(ANALYTICAL);
    let zero = Q::from_integer(0.into());
    let budget = Q::new(1.into(), 1_000_000.into());
    for body in &d.bodies {
        for (&id, carrier) in &body.surfaces {
            let axis = carrier.axis();
            let frame = axis.rational_frame().unwrap();
            let x = match carrier {
                Carrier::Plane(_) => zero.clone(),
                Carrier::Cylinder(_, r) | Carrier::Cone(_, r, _) | Carrier::Sphere(_, r) => {
                    r.clone()
                }
                Carrier::Torus(_, major, minor) => major + minor,
                Carrier::Spline(..) => unreachable!("this test enumerates analytic carriers"),
            };
            let nominal = frame.point(&[x, zero.clone(), zero.clone()]);
            let expected = body.placed_point_bounds(&nominal).unwrap();
            let actual = body
                .carrier_point_bounds(id, [zero.clone(), zero.clone()], &budget)
                .unwrap();
            for i in 0..3 {
                assert!(actual[i].lower_mm <= expected[i].lower_mm);
                assert!(actual[i].upper_mm >= expected[i].upper_mm);
                assert!(&actual[i].upper_mm - &actual[i].lower_mm < budget);
            }
        }
        assert_eq!(
            body.carrier_point_bounds(u32::MAX, [zero.clone(), zero.clone()], &budget)
                .unwrap_err()
                .name,
            "import/surface-unaccounted"
        );
    }
    assert_eq!(d.state.validation, Validation::Decoded);
}

#[test]
fn carrier_query_precision_is_checked_after_irrational_world_placement() {
    use wonky_geom::import::reference::{Axis, Carrier};
    use wonky_geom::Q;
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = decode(ANALYTICAL);
    let b = &mut d.bodies[0];
    let id = *b.surfaces.keys().next().unwrap();
    b.surfaces.insert(
        id,
        Carrier::Plane(Axis {
            origin: [q(0), q(0), q(10).pow(30)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        }),
    );
    b.placements = vec![(
        Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        },
        Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(1), q(1), q(0)],
            reference: [q(0), q(0), q(1)],
        },
    )];
    assert_eq!(
        b.carrier_point_bounds(id, [q(0), q(0)], &(q(1) / q(1_000_000)))
            .unwrap_err()
            .name,
        "import/carrier-point-proof-budget"
    );
}

#[test]
fn every_owned_source_edge_has_an_explicitly_bounded_display_polyline() {
    use wonky_geom::Q;
    let d = decode(ANALYTICAL);
    let deviation = Q::new(1.into(), 50.into());
    for body in &d.bodies {
        for edge in body.edges.values() {
            let polyline = body.edge_polyline(edge.id, &deviation).unwrap();
            assert_eq!(polyline.source_edge, edge.id);
            assert_eq!(polyline.deviation_mm, deviation);
            assert_eq!(polyline.closed, edge.vertices[0] == edge.vertices[1]);
            assert_eq!(
                polyline.samples.first().unwrap().parameter,
                Q::from_integer(0.into())
            );
            assert_eq!(
                polyline.samples.last().unwrap().parameter,
                Q::from_integer(1.into())
            );
            assert_eq!(
                polyline.samples.first().unwrap().source_point_mm,
                body.vertices[&edge.vertices[0]]
            );
            assert_eq!(
                polyline.samples.last().unwrap().source_point_mm,
                body.vertices[&edge.vertices[1]]
            );
            assert!(polyline
                .samples
                .windows(2)
                .all(|p| p[0].parameter < p[1].parameter));
            assert!(polyline
                .samples
                .iter()
                .all(|s| s.world.iter().all(|v| v.lower_mm <= v.upper_mm)));
            let precision = Q::new(1.into(), 100_000.into());
            let extents = body.edge_extents(edge.id, &precision).unwrap();
            for e in &extents.coordinates {
                assert!(e.minimum.lower_mm <= e.minimum.upper_mm);
                assert!(e.maximum.lower_mm <= e.maximum.upper_mm);
                assert!(&e.minimum.upper_mm - &e.minimum.lower_mm <= precision);
                assert!(&e.maximum.upper_mm - &e.maximum.lower_mm <= precision);
            }
        }
    }
    assert_eq!(d.state.validation, wonky_geom::import::Validation::Decoded);
}

#[test]
fn source_display_sampling_refuses_a_discontinuous_spline_and_an_unstated_budget() {
    use wonky_geom::{import::reference::Curve, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = decode(ANALYTICAL);
    let b = &mut d.bodies[0];
    let id = *b.edges.keys().next().unwrap();
    assert_eq!(
        b.edge_polyline(id, &q(0)).unwrap_err().name,
        "import/display-budget-below-source-uncertainty"
    );
    b.edges.get_mut(&id).unwrap().curve = Curve::Spline {
        degree: 1,
        points: vec![
            vec![q(0), q(0), q(0)],
            vec![q(1), q(0), q(0)],
            vec![q(3), q(0), q(0)],
            vec![q(4), q(0), q(0)],
        ],
        weights: vec![q(1); 4],
        knots: vec![q(0), q(0), q(1), q(1), q(2), q(2)],
    };
    assert_eq!(
        b.edge_polyline(id, &(q(1) / q(50))).unwrap_err().name,
        "import/display-curve-discontinuous"
    );
    b.edges.get_mut(&id).unwrap().curve = Curve::Spline {
        degree: 1,
        points: vec![vec![q(0), q(0)], vec![q(1), q(0)]],
        weights: vec![q(1); 2],
        knots: vec![q(0), q(0), q(1), q(1)],
    };
    assert_eq!(
        b.edge_polyline(id, &(q(1) / q(50))).unwrap_err().name,
        "import/dimension-unsupported"
    );
}

#[test]
fn whole_edge_extents_find_rational_interior_extrema_after_semantic_placement() {
    use wonky_geom::{
        import::reference::{Axis, Curve},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = decode(ANALYTICAL);
    let b = &mut d.bodies[0];
    let id = *b.edges.keys().next().unwrap();
    let edge = b.edges.get_mut(&id).unwrap();
    edge.vertices[1] = 1_000_000;
    edge.same_sense = true;
    b.vertices.insert(edge.vertices[0], [q(0), q(0), q(0)]);
    b.vertices.insert(edge.vertices[1], [q(2), q(0), q(0)]);
    edge.curve = Curve::Spline {
        degree: 2,
        points: vec![
            vec![q(0), q(0), q(0)],
            vec![q(1), q(2), q(0)],
            vec![q(2), q(0), q(0)],
        ],
        weights: vec![q(1), q(2), q(1)],
        knots: vec![q(0), q(0), q(0), q(1), q(1), q(1)],
    };
    let axis = |origin, reference| Axis {
        origin,
        axis: [q(0), q(0), q(1)],
        reference,
    };
    b.placements = vec![(
        axis([q(0), q(0), q(0)], [q(1), q(0), q(0)]),
        axis([q(5), q(7), q(9)], [q(0), q(1), q(0)]),
    )];
    let precision = q(1) / q(1_000_000);
    let extents = b.edge_extents(id, &precision).unwrap();
    // Rational weights put the interior maximum at 4/3, rather than
    // the endpoints' zero or the unweighted quadratic's maximum one.
    for (i, (lo, hi)) in [(q(11) / q(3), q(5)), (q(7), q(9)), (q(9), q(9))]
        .into_iter()
        .enumerate()
    {
        let e = &extents.coordinates[i];
        assert!(e.minimum.lower_mm <= lo && lo <= e.minimum.upper_mm);
        assert!(e.maximum.lower_mm <= hi && hi <= e.maximum.upper_mm);
        assert!(&e.minimum.upper_mm - &e.minimum.lower_mm <= precision);
        assert!(&e.maximum.upper_mm - &e.maximum.lower_mm <= precision);
    }
    assert_eq!(
        b.edge_extents(id, &q(0)).unwrap_err().name,
        "import/enclosure-budget-required"
    );
    let start = b.edges[&id].vertices[0];
    b.vertices.insert(start, [q(10), q(0), q(0)]);
    assert_eq!(
        b.edge_extents(id, &precision).unwrap_err().name,
        "import/extents-source-endpoint-mismatch"
    );
    b.edges.get_mut(&id).unwrap().curve = Curve::Line {
        origin: vec![q(0); 3],
        direction: vec![q(0); 3],
    };
    assert_eq!(
        b.edge_extents(id, &precision).unwrap_err().name,
        "import/curve-direction-invalid"
    );
    assert_eq!(d.state.validation, wonky_geom::import::Validation::Decoded);
}

#[test]
fn cone_angle_domain_uses_exact_pi_enclosure_not_binary64_pi() {
    let source = std::str::from_utf8(ANALYTICAL).unwrap();
    let line = source
        .lines()
        .find(|line| line.contains("CONICAL_SURFACE("))
        .unwrap();
    let angle_start = line.rfind(',').unwrap() + 1;
    let angle_end = line.rfind(')').unwrap();
    for (angle, valid) in [
        ("1.5707963267948966", true),
        ("1.5707963267948968", false),
        ("0.", false),
        ("-0.1", false),
    ] {
        let replacement = format!("{}{}{}", &line[..angle_start], angle, &line[angle_end..]);
        let bytes = source.replacen(line, &replacement, 1).into_bytes();
        let result = ReferenceDraft::step(
            &bytes,
            Source {
                digest: source_digest(&bytes),
                revision: None,
                instance_path: vec![],
            },
            Limits::default(),
        );
        if valid {
            assert!(result.is_ok(), "angle {angle}: {result:?}");
        } else {
            assert_eq!(
                result.unwrap_err().name,
                "import/cone-angle-invalid",
                "angle {angle}"
            );
        }
    }
}

fn cylindrical_band(seam: bool) -> wonky_geom::import::reference::Body {
    use wonky_geom::{
        import::reference::{Axis, Carrier, Curve, Edge, Face, Loop},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut b = tetra_with_declared_zero_uncertainty().bodies.remove(0);
    b.vertices.clear();
    b.edges.clear();
    b.surfaces.clear();
    b.faces.clear();
    let axis = |z| Axis {
        origin: [q(0), q(0), q(z)],
        axis: [q(0), q(0), q(1)],
        reference: [q(1), q(0), q(0)],
    };
    b.surfaces.insert(90, Carrier::Cylinder(axis(0), q(5)));
    for (id, vertex, height) in [(100, 10, -2), (101, 11, 3)] {
        b.vertices.insert(vertex, [q(5), q(0), q(height)]);
        b.edges.insert(
            id,
            Edge {
                id,
                vertices: [vertex, vertex],
                same_sense: true,
                curve: Curve::Circle {
                    axis: axis(height),
                    radius: q(5),
                    dimension: 3,
                },
                pcurves: vec![],
            },
        );
    }
    let loops = if seam {
        b.edges.insert(
            102,
            Edge {
                id: 102,
                vertices: [10, 11],
                same_sense: true,
                curve: Curve::Line {
                    origin: vec![q(5), q(0), q(-2)],
                    direction: vec![q(0), q(0), q(1)],
                },
                pcurves: vec![],
            },
        );
        vec![Loop {
            id: 91,
            outer: true,
            uses: vec![(100, true), (102, true), (101, false), (102, false)],
        }]
    } else {
        vec![
            Loop {
                id: 91,
                outer: false,
                uses: vec![(100, true)],
            },
            Loop {
                id: 92,
                outer: false,
                uses: vec![(101, false)],
            },
        ]
    };
    b.faces.push(Face {
        id: 99,
        name: "periodic band".into(),
        surface: 90,
        same_sense: true,
        loops,
    });
    b
}

#[test]
fn source_bound_cylinder_band_measures_interior_with_and_without_chart_cut() {
    use wonky_geom::Q;
    let q = |n: i64| Q::from_integer(n.into());
    for seam in [false, true] {
        let b = cylindrical_band(seam);
        let f = b.face_extents(99, &(q(1) / q(1000))).unwrap();
        for i in 0..3 {
            let (lo, hi) = if i == 2 { (q(-2), q(3)) } else { (q(-5), q(5)) };
            assert!(f.coordinates[i].minimum.lower_mm <= lo);
            assert!(f.coordinates[i].minimum.upper_mm >= lo);
            assert!(f.coordinates[i].maximum.lower_mm <= hi);
            assert!(f.coordinates[i].maximum.upper_mm >= hi);
            assert!(
                f.coordinates[i].minimum.upper_mm.clone() - &f.coordinates[i].minimum.lower_mm
                    <= q(1) / q(1000)
            );
            assert!(
                f.coordinates[i].maximum.upper_mm.clone() - &f.coordinates[i].maximum.lower_mm
                    <= q(1) / q(1000)
            );
        }
    }
}

#[test]
fn source_bound_cylinder_band_respects_semantic_placement_and_circle_axis_sense() {
    use wonky_geom::{
        import::reference::{Axis, Curve},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut b = cylindrical_band(true);
    // Reversing both the circle's normal and curve sense leaves the same trim.
    if let Curve::Circle { axis, .. } = &mut b.edges.get_mut(&101).unwrap().curve {
        axis.axis = [q(0), q(0), q(-7)];
    }
    b.edges.get_mut(&101).unwrap().same_sense = false;
    b.placements.push((
        Axis {
            origin: [q(0), q(0), q(0)],
            axis: [q(0), q(0), q(1)],
            reference: [q(1), q(0), q(0)],
        },
        Axis {
            origin: [q(10), q(20), q(30)],
            axis: [q(0), q(1), q(0)],
            reference: [q(1), q(0), q(0)],
        },
    ));
    let p = q(1) / q(1000);
    let f = b.face_extents(99, &p).unwrap();
    for (i, (lo, hi)) in [(q(5), q(15)), (q(18), q(23)), (q(25), q(35))]
        .into_iter()
        .enumerate()
    {
        assert!(f.coordinates[i].minimum.lower_mm <= lo && f.coordinates[i].minimum.upper_mm >= lo);
        assert!(f.coordinates[i].maximum.lower_mm <= hi && f.coordinates[i].maximum.upper_mm >= hi);
    }
}

#[test]
fn source_bound_cylinder_band_rejects_unbounded_complement_and_missing_period() {
    use wonky_geom::Q;
    let p = Q::new(1.into(), 1000.into());
    let mut b = cylindrical_band(false);
    for lp in &mut b.faces[0].loops {
        lp.uses[0].1 = !lp.uses[0].1;
    }
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-band-unbounded-orientation"
    );
    let mut b = cylindrical_band(false);
    b.edges.get_mut(&100).unwrap().vertices[1] = 11;
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/coedge-disconnected"
    );
}

#[test]
fn source_bound_cylinder_band_rejects_wrong_carrier_and_cut_geometry() {
    use wonky_geom::{import::reference::Curve, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let p = q(1) / q(1000);
    let mut b = cylindrical_band(true);
    if let Curve::Circle { radius, .. } = &mut b.edges.get_mut(&100).unwrap().curve {
        *radius = q(6);
    }
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-band-carrier-mismatch"
    );
    let mut b = cylindrical_band(true);
    if let Curve::Line { direction, .. } = &mut b.edges.get_mut(&102).unwrap().curve {
        direction[0] = q(1);
    }
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-band-cut-nonaxial"
    );
    let mut b = cylindrical_band(true);
    if let Curve::Line { origin, .. } = &mut b.edges.get_mut(&102).unwrap().curve {
        origin[0] = q(6);
    }
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/vertex-off-curve"
    );
}

fn circular_planar_domain() -> wonky_geom::import::reference::Body {
    use wonky_geom::{
        import::{
            reference::{Carrier, Curve},
            Uncertainty,
        },
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let mut b = cylindrical_band(false);
    let Carrier::Cylinder(mut axis, _) = b.surfaces.remove(&90).unwrap() else {
        unreachable!()
    };
    axis.reference = [q(1), q(1), q(0)];
    b.surfaces.insert(90, Carrier::Plane(axis));
    for (id, vertex, x, r) in [(100, 10, 0, 5), (101, 11, 1, 2)] {
        let Curve::Circle { axis, radius, .. } = &mut b.edges.get_mut(&id).unwrap().curve else {
            unreachable!()
        };
        axis.origin = [q(x), q(0), q(0)];
        axis.axis = [q(0), q(0), q(7)];
        axis.reference = [q(1), q(1), q(0)];
        *radius = q(r);
        b.vertices.insert(vertex, [q(x + r), q(0), q(0)]);
    }
    b.uncertainty = Uncertainty::Declared {
        mm: q(1) / q(1000000),
    };
    b
}

#[test]
fn source_bound_circle_domain_has_exact_nesting_despite_algebraic_frames() {
    use wonky_geom::Q;
    let q = |n: i64| Q::from_integer(n.into());
    let p = q(1) / q(10000);
    let b = circular_planar_domain();
    assert_eq!(
        b.planar_face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-inexact-chart"
    );
    let f = b.face_extents(99, &p).unwrap();
    for i in 0..2 {
        assert!(f.coordinates[i].minimum.lower_mm <= q(-5));
        assert!(f.coordinates[i].minimum.upper_mm >= q(-5));
        assert!(f.coordinates[i].maximum.lower_mm <= q(5));
        assert!(f.coordinates[i].maximum.upper_mm >= q(5));
        assert!(&f.coordinates[i].minimum.upper_mm - &f.coordinates[i].minimum.lower_mm <= p);
        assert!(&f.coordinates[i].maximum.upper_mm - &f.coordinates[i].maximum.lower_mm <= p);
    }
    assert!(f.coordinates[2].minimum.lower_mm.abs() <= p);
    assert!(f.coordinates[2].maximum.upper_mm.abs() <= p);
}

#[test]
fn source_bound_circle_domain_refuses_external_tangent_and_nested_holes() {
    use wonky_geom::{
        import::reference::{Curve, Loop},
        Q,
    };
    let q = |n: i64| Q::from_integer(n.into());
    let p = q(1) / q(10000);
    let mut b = circular_planar_domain();
    if let Curve::Circle { axis, .. } = &mut b.edges.get_mut(&101).unwrap().curve {
        axis.origin[0] = q(3);
    }
    b.vertices.insert(11, [q(5), q(0), q(0)]);
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-no-unique-outer-circle"
    );
    let mut b = circular_planar_domain();
    let mut hole = b.edges[&101].clone();
    hole.id = 103;
    hole.vertices = [12, 12];
    if let Curve::Circle { radius, .. } = &mut hole.curve {
        *radius = q(1);
    }
    b.vertices.insert(12, [q(2), q(0), q(0)]);
    b.edges.insert(103, hole);
    b.faces[0].loops.push(Loop {
        id: 93,
        outer: false,
        uses: vec![(103, false)],
    });
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-circle-holes-not-disjoint"
    );
}

#[test]
fn source_bound_circle_domain_refuses_reversed_outer_and_wrong_plane() {
    use wonky_geom::{import::reference::Curve, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let p = q(1) / q(10000);
    let mut b = circular_planar_domain();
    b.faces[0].loops[0].uses[0].1 = false;
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-circle-unbounded-orientation"
    );
    let mut b = circular_planar_domain();
    if let Curve::Circle { axis, .. } = &mut b.edges.get_mut(&101).unwrap().curve {
        axis.origin[2] = q(1);
    }
    assert_eq!(
        b.face_extents(99, &p).unwrap_err().name,
        "import/trim-domain-circle-plane-mismatch"
    );
}

#[test]
fn admitted_reference_is_a_distinct_kind_with_complete_bounds_and_no_modelling_path() {
    use wonky_geom::{import::reference::ModellingOperation as Op, Q};
    let q = |n: i64| Q::from_integer(n.into());
    let d = tetra_with_declared_zero_uncertainty();
    let digest = d.state.source_digest;
    let admitted = d.admit_reference(&(q(1)/q(10000))).unwrap();
    assert_eq!(admitted.len(), 1);
    let b = &admitted[0];
    assert!(!b.exact());
    assert_eq!(b.provenance().source_digest, digest);
    assert_eq!(b.face_bounds.len(), b.source().faces.len());
    for i in 0..3 {
        assert_eq!(b.bounds[i].lower_mm, q(0));
        assert_eq!(b.bounds[i].upper_mm, q(15875)/q(8));
    }
    for op in [Op::Boolean,Op::Fillet,Op::Chamfer,Op::Pattern,Op::Transform,Op::TransformAndBoolean] {
        assert_eq!(b.modelling_model(op).unwrap_err().name,format!("import/reference-body/{}",op.name()));
    }
}

#[test]
fn reference_admission_never_skips_an_unbounded_face_or_a_broken_coedge() {
    use wonky_geom::Q;
    let precision = Q::new(1.into(),10000.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    d.bodies[0].faces[0].loops.clear();
    assert_eq!(d.admit_reference(&precision).unwrap_err().name,"import/face-unbounded");
    let mut d = tetra_with_declared_zero_uncertainty();
    d.bodies[0].faces[0].loops[0].uses[0].1 ^= true;
    assert_eq!(d.admit_reference(&precision).unwrap_err().name,"import/coedge-disconnected");
    assert_eq!(decode(SI).admit_reference(&precision).unwrap_err().name,"import/source-tolerance-missing");
}

#[test]
fn spline_surface_trim_enclosure_uses_active_positive_weight_control_net() {
    use wonky_geom::{Q,import::reference::SplineSurface};
    let q = |n: i64| Q::from_integer(n.into());
    let mut s = SplineSurface {
        degrees:[1,1], knots:[vec![q(0),q(0),q(1),q(2),q(2)],vec![q(0),q(0),q(1),q(1)]],
        points: vec![vec![[q(0),q(0),q(0)],[q(0),q(1),q(0)]],vec![[q(1),q(0),q(0)],[q(1),q(1),q(1)]],vec![[q(100),q(0),q(0)],[q(100),q(1),q(0)]]],
        weights: vec![vec![q(1),q(1)],vec![q(2),q(1)],vec![q(1),q(1)]],
    };
    let bound = s.trimmed_hull(&[[q(0),q(0)],[q(1)/q(2),q(1)]]).unwrap();
    assert_eq!(bound[0].upper_mm,q(1),"untrimmed carrier's far control point must not enter the trimmed patch hull");
    assert_eq!(bound[2].upper_mm,q(1));
    s.weights[0][0]=q(0);
    assert_eq!(s.trimmed_hull(&[[q(0),q(0)],[q(1),q(1)]]).unwrap_err().name,"import/surface-spline-control-net-invalid");
}

fn torus_patch(uv: [[f64; 2]; 4]) -> ReferenceDraft {
    use wonky_geom::{Q,binary64,import::reference::{Axis,Carrier,Curve,Pcurve,Edge,Loop,Face}};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = tetra_with_declared_zero_uncertainty();
    let b = &mut d.bodies[0];
    b.uncertainty = wonky_geom::import::Uncertainty::Declared {mm:q(1)/q(1000000)};
    b.vertices.clear(); b.edges.clear(); b.surfaces.clear(); b.faces.clear();
    let axis = Axis {origin:[q(0),q(0),q(0)],axis:[q(0),q(0),q(1)],reference:[q(1),q(0),q(0)]};
    b.surfaces.insert(500,Carrier::Torus(axis,q(3),q(1)));
    let points = uv.map(|p:[f64;2]| [binary64((3.+p[1].cos())*p[0].cos()).unwrap(),binary64((3.+p[1].cos())*p[0].sin()).unwrap(),binary64(p[1].sin()).unwrap()]);
    for i in 0..4 { b.vertices.insert(i as u32,points[i].clone()); }
    for i in 0..4 {
        let j=(i+1)%4;
        b.edges.insert(i as u32,Edge {id:i as u32,vertices:[i as u32,j as u32],same_sense:true,
            curve: if i == 0 || i == 2 {
                let v = uv[i][1];
                Curve::Circle {axis:Axis {origin:[q(0),q(0),binary64(v.sin()).unwrap()],axis:[q(0),q(0),if i == 0 {q(1)} else {q(-1)}],reference:[q(1),q(0),q(0)]},radius:binary64(3.+v.cos()).unwrap(),dimension:3}
            } else {
                let u=uv[i][0]; let sign=if i == 1 {1.} else {-1.};
                Curve::Circle {axis:Axis {origin:[binary64(3.*u.cos()).unwrap(),binary64(3.*u.sin()).unwrap(),q(0)],axis:[binary64(sign*u.sin()).unwrap(),binary64(-sign*u.cos()).unwrap(),q(0)],reference:[binary64(u.cos()).unwrap(),binary64(u.sin()).unwrap(),q(0)]},radius:q(1),dimension:3}
            },
            pcurves:vec![Pcurve {id:100+i as u32,surface:500,curve:Curve::Spline {degree:1,points:vec![uv[i].map(|v|binary64(v).unwrap()).to_vec(),uv[j].map(|v|binary64(v).unwrap()).to_vec()],weights:vec![q(1),q(1)],knots:vec![q(0),q(0),q(1),q(1)]}}]});
    }
    b.faces.push(Face {id:600,name:"small torus chart patch".into(),surface:500,same_sense:true,loops:vec![Loop {id:601,outer:true,uses:(0..4).map(|i|(i,true)).collect()}]});
    d
}

#[test]
fn torus_trim_enclosure_excludes_unoccupied_carrier_extrema() {
    use wonky_geom::{Q,binary64,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut d = torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let b = &mut d.bodies[0];
    let bounds=b.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    assert!(bounds.coordinates[0].lower_mm > q(39)/q(10));
    assert!(bounds.coordinates[1].lower_mm > -q(1)/q(100));
    assert!(bounds.coordinates[2].upper_mm < q(11)/q(100));
    assert!(bounds.slack_mm.iter().all(|v|v < &(q(1)/q(100))),"full torus carrier planted replacement must fail the patch slack bound");
    // One pcurve chooses a different periodic lift. Taking raw coordinates'
    // hull would accidentally enclose the entire carrier and fail this bound.
    if let Curve::Spline { points, .. } = &mut b.edges.get_mut(&1).unwrap().pcurves[0].curve {
        for p in points { p[0] += binary64(10. * std::f64::consts::TAU).unwrap(); }
    } else { unreachable!("owned pcurve is a spline"); }
    let shifted=b.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    assert!(shifted.coordinates[0].lower_mm > q(39)/q(10));
    assert!(shifted.slack_mm.iter().all(|v|v < &(q(1)/q(100))));
}

#[test]
fn rational_spline_surface_decodes_and_admits_without_fitting_or_triangulation() {
    use wonky_geom::{Q,import::reference::Carrier};
    let bytes=include_bytes!("../../../fixtures/step-reference/spline-trim.step");
    let draft=decode(bytes);
    assert!(matches!(draft.bodies[0].surfaces[&43],Carrier::Spline(..)));
    let body=draft.admit_reference(&Q::new(1.into(),10000.into())).unwrap().remove(0);
    assert_eq!(body.face_bounds.len(),4);
    assert!(!body.exact());
    let bad=String::from_utf8(bytes.to_vec()).unwrap().replace("RATIONAL_B_SPLINE_SURFACE(((1.,1.),(1.,1.)))","RATIONAL_B_SPLINE_SURFACE(((0.,1.),(1.,1.)))");
    assert_eq!(ReferenceDraft::step(bad.as_bytes(),Source {digest:source_digest(bad.as_bytes()),revision:None,instance_path:vec![]},Limits::default()).unwrap_err().name,"import/surface-spline-control-net-invalid");
    for (from,to,code) in [
        ("B_SPLINE_SURFACE(1,1,", "B_SPLINE_SURFACE(1.5,1,", "import/surface-spline-degree-invalid"),
        ("B_SPLINE_SURFACE(1,1,", "B_SPLINE_SURFACE(65535,1,", "import/surface-spline-degree-unsupported"),
        ("B_SPLINE_SURFACE_WITH_KNOTS((2,2)", "B_SPLINE_SURFACE_WITH_KNOTS((1.5,2)", "import/surface-spline-knots-invalid"),
    ] {
        let corrupt=String::from_utf8(bytes.to_vec()).unwrap().replace(from,to);
        assert_eq!(ReferenceDraft::step(corrupt.as_bytes(),Source {digest:source_digest(corrupt.as_bytes()),revision:None,instance_path:vec![]},Limits::default()).unwrap_err().name,code);
    }
}

#[test]
fn every_owned_analytic_face_gets_a_trimmed_enclosure_including_sphere_poles() {
    use wonky_geom::{Q,import::reference::Carrier};
    let precision=Q::new(1.into(),10000.into());
    let bodies=decode(ANALYTICAL).admit_reference(&precision).unwrap();
    assert_eq!(bodies.len(),4);
    assert_eq!(bodies.iter().map(|b|b.face_bounds.len()).sum::<usize>(),10);
    let sphere=bodies.iter().find(|b|b.source().surfaces.values().any(|s|matches!(s,Carrier::Sphere(..)))).unwrap();
    // The frozen source applies +7 mm then +11 mm along Z.
    assert!(sphere.bounds[2].lower_mm <= Q::from_integer(16.into()));
    assert!(sphere.bounds[2].upper_mm >= Q::from_integer(20.into()));
    assert!(bodies.iter().all(|b|!b.exact()));
}

#[test]
fn split_latitude_sphere_cap_refuses_without_a_polar_winding_proof() {
    use wonky_geom::{Q, import::reference::Carrier};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft = decode(ANALYTICAL);
    let body = draft.bodies.iter_mut().find(|b|
        b.surfaces.values().any(|s| matches!(s, Carrier::Sphere(..)))).unwrap();
    // Split the equator into two source circular arcs at its antipodal vertex.
    body.vertices.insert(9000, [-q(2), q(0), q(0)]);
    let mut second = body.edges[&184].clone();
    second.id = 9001;
    second.vertices = [9000, 163];
    body.edges.get_mut(&184).unwrap().vertices = [163, 9000];
    body.edges.insert(9001, second);
    for face in &mut body.faces {
        let forward = face.loops[0].uses[0].1;
        face.loops[0].uses = if forward {
            vec![(184, true), (9001, true)]
        } else {
            vec![(9001, false), (184, false)]
        };
    }
    draft.check_topology().unwrap();
    let body = draft.bodies.iter().find(|b| b.edges.contains_key(&9001)).unwrap();
    assert_eq!(body.trimmed_face_enclosure(188, &(q(1)/q(10000)))
        .unwrap_err().name, "import/sphere-polar-trim-undecidable");
}

#[test]
fn reference_admission_refuses_inconsistent_analytic_pcurve_before_certifying_bounds() {
    use wonky_geom::Q;
    let source = std::str::from_utf8(ANALYTICAL).unwrap();
    let from = "#235=CARTESIAN_POINT('',(0.,3.141592653589793));";
    assert!(source.contains(from));
    let corrupt = source.replace(from, "#235=CARTESIAN_POINT('',(0.,0.));");
    let error = decode(corrupt.as_bytes()).admit_reference(&Q::new(1.into(),10000.into())).unwrap_err();
    assert_eq!(error.name, "import/pcurve-trim-endpoint-mismatch");
}

#[test]
fn reference_admission_refuses_inconsistent_spline_surface_pcurve() {
    use wonky_geom::{Q, import::reference::Curve};
    let mut draft = decode(include_bytes!("../../../fixtures/step-reference/spline-trim.step"));
    let edge = draft.bodies[0].edges.values_mut().find(|e| e.pcurves.iter().any(|p| p.surface == 43)).unwrap();
    let pc = edge.pcurves.iter_mut().find(|p| p.surface == 43).unwrap();
    let Curve::Spline {points, ..} = &mut pc.curve else { panic!("owned spline chart"); };
    for p in points { p[0] += Q::from_integer(2.into()); }
    let error = draft.admit_reference(&Q::new(1.into(),10000.into())).unwrap_err();
    assert_eq!(error.name, "import/surface-spline-trim-outside-domain");
}

#[test]
fn displaced_torus_chart_cannot_exclude_retained_interior_extremum() {
    use wonky_geom::{Q, import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft = torus_patch([[-0.1,-0.1],[0.1,-0.1],[0.1,0.1],[-0.1,0.1]]);
    let body = &mut draft.bodies[0];
    let valid = body.trimmed_face_enclosure(600, &(q(1)/q(10000))).unwrap();
    assert!(valid.coordinates[0].upper_mm >= q(4));
    for edge in body.edges.values_mut() {
        let Curve::Spline {points, ..} = &mut edge.pcurves[0].curve else { unreachable!(); };
        for p in points {p[0] += q(1); p[1] += q(1);}
    }
    assert_eq!(body.trimmed_face_enclosure(600, &(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-trim-endpoint-mismatch");
}

#[test]
fn reference_admission_checks_spline_pcurve_interior_even_when_endpoints_agree() {
    use wonky_geom::{Q, import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft = decode(include_bytes!("../../../fixtures/step-reference/spline-trim.step"));
    let pc = draft.bodies[0].edges.values_mut().flat_map(|e| &mut e.pcurves).find(|p| p.surface == 43).unwrap();
    let Curve::Spline {degree, points, weights, knots} = &mut pc.curve else { unreachable!(); };
    let mut mid = points[0].iter().zip(&points[1]).map(|(a,b)| (a+b)/q(2)).collect::<Vec<_>>();
    // Move toward the chart interior, retaining both endpoint observations.
    for i in 0..2 { if points[0][i] == points[1][i] { mid[i] += q(1)/q(10); } }
    points.insert(1,mid); *degree=2; *weights=vec![q(1);3];
    *knots=vec![q(0),q(0),q(0),q(1),q(1),q(1)];
    assert_eq!(draft.admit_reference(&(q(1)/q(10000))).unwrap_err().name,"import/pcurve-lift-mismatch");
}

#[test]
fn reference_admission_refuses_a_closed_ring_collapsed_to_one_valid_carrier_point() {
    use wonky_geom::{Q, import::reference::{Curve,Carrier}};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft = decode(ANALYTICAL);
    let body = draft.bodies.iter_mut().find(|b| b.surfaces.values().any(|s|matches!(s,Carrier::Torus(..)))).unwrap();
    let pc = body.edges.get_mut(&250).unwrap().pcurves.iter_mut().find(|p| p.surface == 199).unwrap();
    let Curve::Line {origin, ..} = &pc.curve else { unreachable!(); };
    pc.curve = Curve::Spline {degree:1, points:vec![origin.clone(),origin.clone()],weights:vec![q(1),q(1)],knots:vec![q(0),q(0),q(1),q(1)]};
    // This observation lies on the source circle and reaches both vertices.
    // Those checks alone are insufficient to certify a retained full ring.
    assert!(body.check_pcurve(250,241).is_ok());
    assert_eq!(draft.admit_reference(&(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-circular-trim-coverage-unproved");
}

#[test]
fn circular_pcurve_with_correct_endpoints_cannot_choose_the_complementary_arc() {
    use wonky_geom::{Q,binary64,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft = torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let Curve::Spline {points, ..} = &mut body.edges.get_mut(&0).unwrap().pcurves[0].curve else { unreachable!(); };
    points[1][0] -= binary64(std::f64::consts::TAU).unwrap();
    assert!(body.check_pcurve(0,100).is_ok(),"whole-circle membership and endpoint agreement alone pass");
    assert_eq!(body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-circular-trim-mismatch");
}

#[test]
fn reversed_circular_edge_keeps_source_spline_pcurve_parameter_direction() {
    use wonky_geom::Q;
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft=torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let before=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    let edge=body.edges.get_mut(&0).unwrap();
    edge.vertices.swap(0,1); edge.same_sense=false;
    body.faces[0].loops[0].uses[0].1=false;
    let after=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    for i in 0..3 {
        assert_eq!(before.coordinates[i].lower_mm,after.coordinates[i].lower_mm);
        assert_eq!(before.coordinates[i].upper_mm,after.coordinates[i].upper_mm);
    }
}

#[test]
fn discontinuous_pcurve_endpoints_cannot_fake_long_circular_arc_coverage() {
    use wonky_geom::{Q,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft=torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let edge=body.edges.get_mut(&0).unwrap();
    edge.same_sense=false;
    let Curve::Spline {degree,points,weights,knots}=&mut edge.pcurves[0].curve else {unreachable!();};
    *degree=1;
    *points=vec![points[1].clone(),points[1].clone(),points[0].clone(),points[0].clone()];
    *weights=vec![q(1);4];
    *knots=vec![q(0),q(0),q(1)/q(2),q(1)/q(2),q(1),q(1)];
    assert!(body.check_pcurve(0,100).is_ok(),"both constant pieces lie on the infinite source circle");
    assert_eq!(body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-chart-discontinuous");
}

#[test]
fn broader_constant_height_spline_pcurve_is_trimmed_by_the_retained_circle() {
    use wonky_geom::{Q,binary64,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft=torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let before=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    let Curve::Spline {points,..}=&mut body.edges.get_mut(&0).unwrap().pcurves[0].curve else {unreachable!();};
    points[1][0]=binary64(0.5).unwrap();
    let after=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    assert!(after.coordinates[0].lower_mm>q(39)/q(10));
    assert!(after.coordinates[1].upper_mm<q(1)/q(2),"a broader pcurve is not a broader retained patch");
    for i in 0..3 {
        assert!((&before.coordinates[i].lower_mm-&after.coordinates[i].lower_mm).abs()<q(1)/q(100000));
        assert!((&before.coordinates[i].upper_mm-&after.coordinates[i].upper_mm).abs()<q(1)/q(100000));
    }
}

#[test]
fn constant_height_spline_cannot_supply_a_missing_retained_circle_interval() {
    use wonky_geom::{Q,binary64,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft=torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let Curve::Spline {points,..}=&mut body.edges.get_mut(&0).unwrap().pcurves[0].curve else {unreachable!();};
    points[1][0]=binary64(0.05).unwrap();
    assert!(body.check_pcurve(0,100).is_ok(),"infinite circle membership is insufficient");
    assert_eq!(body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-trim-endpoint-mismatch");
}

#[test]
fn broader_constant_longitude_chart_spline_is_trimmed_by_retained_circle() {
    use wonky_geom::{Q,binary64,import::reference::Curve};
    let q = |n: i64| Q::from_integer(n.into());
    let mut draft=torus_patch([[0.,0.],[0.1,0.],[0.1,0.1],[0.,0.1]]);
    let body=&mut draft.bodies[0];
    let before=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    let Curve::Spline {points,..}=&mut body.edges.get_mut(&1).unwrap().pcurves[0].curve else {unreachable!();};
    points[1][1]=binary64(0.5).unwrap();
    let after=body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap();
    for i in 0..3 {
        assert!((&before.coordinates[i].lower_mm-&after.coordinates[i].lower_mm).abs()<q(1)/q(100000));
        assert!((&before.coordinates[i].upper_mm-&after.coordinates[i].upper_mm).abs()<q(1)/q(100000));
    }
    let Curve::Spline {points,..}=&mut body.edges.get_mut(&1).unwrap().pcurves[0].curve else {unreachable!();};
    points[1][1]=binary64(0.05).unwrap();
    assert_eq!(body.trimmed_face_enclosure(600,&(q(1)/q(10000))).unwrap_err().name,
        "import/pcurve-trim-endpoint-mismatch");
}
