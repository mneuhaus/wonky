//! Owner-boundary contracts for exact through-holes. Tests use independent
//! closed forms and exact rational input arithmetic, not a second constructor.
use num_traits::{Signed, ToPrimitive};
use wonky_contract::{
    Binary64, Body, BodyKey, CurveGeometry, Frame, FrameId, PcurveGeometry, SurfaceGeometry,
};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    cylinder_chart, orthogonal,
    perforated::{self, Perforated},
    polyhedron,
};
use wonky_oracle::binary64;
fn key() -> BodyKey {
    BodyKey {
        id: [8, 9, 10, 11],
        revision: 0,
    }
}
fn frames() -> [Affine; 3] {
    [
        Affine::IDENTITY,
        Affine {
            origin: [65.53625, -32.7685, 16.384125],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [-0.031, 0.012, 0.007],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ]
}
fn base(lo: [f64; 3], hi: [f64; 3], frame: Affine) -> polyhedron::Audited {
    let a =
        polyhedron::audit(&orthogonal::cuboid(key(), lo, hi).unwrap().check().unwrap()).unwrap();
    polyhedron::audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap()
}
fn tool(s: Spec, frame: Affine) -> cylinder::Cylinder {
    let c = cylinder::audit(&cylinder::create(key(), s).unwrap().check().unwrap()).unwrap();
    cylinder::audit(&cylinder::transform(&c, frame).unwrap().check().unwrap()).unwrap()
}
fn spec(x: f64, y: f64, r: f64) -> Spec {
    Spec {
        bottom: [x, y, -0.002],
        top: [x, y, 0.010],
        radius: r,
    }
}
fn cut(a: &polyhedron::Audited, ts: &[cylinder::Cylinder]) -> Perforated {
    let bodies = std::iter::once(Solid::Planar(a.clone()))
        .chain(ts.iter().cloned().map(Solid::Cylinder))
        .collect::<Vec<_>>();
    let mut out = analytic::boolean(key(), 1, &bodies).unwrap();
    assert_eq!(out.len(), 1);
    let checked = out.pop().unwrap().check().unwrap();
    match analytic::audit(&checked).unwrap() {
        Solid::Perforated(p) => p,
        _ => panic!("lost holes"),
    }
}
fn swap_axis(mut p: [f64; 3], k: usize) -> [f64; 3] {
    p.swap(2, k);
    p
}
#[test]
fn hole_membership_survives_cancellation_at_a_near_zero_probe() {
    let frame = Affine::IDENTITY;
    let a = base([-2., -2., -0.5], [2., 2., 0.5], frame);
    let s = Spec {
        bottom: [0.5991455593756325, 0.7332014929247759, -1.],
        top: [0.5991455593756325, 0.7332014929247759, 1.],
        radius: 0.9468684335992302,
    };
    let p = cut(&a, &[tool(s, frame)]);
    let point = [2.1225061195245464e-14, -5.929888477867709e-14, 0.];
    // Independent rational arithmetic on the supplied bits, including mm -> m:
    // this point lies strictly in the void although rounded hypot says outside.
    let x = binary64(point[0]).unwrap() / binary64(1000.).unwrap() - binary64(s.bottom[0]).unwrap();
    let y = binary64(point[1]).unwrap() / binary64(1000.).unwrap() - binary64(s.bottom[1]).unwrap();
    let radius = binary64(s.radius).unwrap();
    let squared = &x * &x + &y * &y;
    assert!(squared < &radius * &radius);
    let (distance, inside, bound) = p.probe(point).unwrap();
    assert!(!inside, "hole point incorrectly certified as material");
    assert!(distance >= 0. && bound >= 0. && bound < 1e-8);
    // Bound the exact positive gap without subtracting two rounded lengths.
    let lo = binary64((distance - bound).max(0.)).unwrap() / binary64(1000.).unwrap();
    let hi = binary64(distance + bound).unwrap() / binary64(1000.).unwrap();
    assert!((&radius - lo).pow(2) >= squared);
    assert!((&radius - hi).pow(2) <= squared);
}

#[test]
fn closed_hole_and_box_boundaries_are_exact_after_distant_axis_permutation() {
    let frame = Affine { origin: [64., -32., 16.], x: [0., 0., 1.], z: [0., -1., 0.] };
    let a = base([-2., -2., -0.5], [2., 2., 0.5], frame);
    let p = cut(&a, &[tool(Spec { bottom: [0.5, -0.5, -1.], top: [0.5, -0.5, 1.], radius: 0.5 }, frame)]);
    // Dyadic source geometry: these world boundaries are exactly representable.
    // Move the actual world query one ulp to either side, without remapping it.
    for (boundary, axis, negative_inside, positive_inside) in [
        ([64500., -32000., 17000.], 2, false, true), // cylindrical wall
        ([65000., -32500., 15000.], 1, false, true), // top cap
        ([65000., -32000., 14000.], 2, false, true), // outer side
    ] {
        assert_eq!(p.probe(boundary).unwrap(), (0., true, 0.));
        for (coordinate, expected) in [(boundary[axis].next_down(), negative_inside), (boundary[axis].next_up(), positive_inside)] {
            let mut point = boundary;
            point[axis] = coordinate;
            let (d, inside, bound) = p.probe(point).unwrap();
            assert_eq!(inside, expected, "{point:?}");
            assert!(d >= 0. && bound >= 0. && d + bound < 1e-6);
        }
    }
}

#[test]
fn through_holes_keep_all_loops_volume_area_and_axis_probes_in_every_frame() {
    for (size, height, r, centers, volume, area) in [
        (
            0.032,
            0.004,
            0.002,
            vec![
                [0.008, 0.008],
                [0.024, 0.008],
                [0.008, 0.024],
                [0.024, 0.024],
            ],
            3894.938070170253,
            2660.5309649148735,
        ),
        (
            0.064,
            0.008,
            0.00390625 * 0.001,
            vec![[0.032, 0.032]],
            32767.999616504803,
            10240.19625366705,
        ),
    ] {
        for k in 0..3 {
            for frame in frames() {
                let a = base([0.; 3], swap_axis([size, size, height], k), frame);
                let tools = centers
                    .iter()
                    .map(|&[x, y]| {
                        let s = spec(x, y, r);
                        tool(
                            Spec {
                                bottom: swap_axis(s.bottom, k),
                                top: swap_axis(s.top, k),
                                radius: r,
                            },
                            frame,
                        )
                    })
                    .collect::<Vec<_>>();
                let p = cut(&a, &tools);
                let n = centers.len();
                assert_eq!(p.body.faces.len(), 6 + n);
                assert_eq!(p.body.edges.len(), 12 + 3 * n);
                assert_eq!(p.body.vertices.len(), 8 + 2 * n);
                assert_eq!(p.body.loops.iter().filter(|l| !l.outer).count(), 2 * n);
                assert_eq!(p.body.faces.iter().filter(|f| !f.forward).count(), n);
                let (v, s, areas, perimeters) = p.measures_mm().unwrap();
                for (iv, want) in [(v, volume), (s, area)] {
                    assert!(iv.lo() <= want && want <= iv.hi(), "{iv:?} excludes {want}");
                    assert!(iv.r / iv.m < 1e-12);
                }
                assert_eq!(areas.len(), 6 + n);
                assert_eq!(perimeters.len(), 6 + n);
                assert!((areas.iter().sum::<f64>() - area).abs() < 1e-8);
                // Independent face-boundary lengths: the seam is used twice on
                // each cylindrical wall and every cap has n circular holes.
                let tau = 6.283185307179586;
                let ring = tau * r * 1000.;
                let mut expected = vec![2. * (size + height) * 1000.; 4];
                expected.extend([4. * size * 1000. + n as f64 * ring; 2]);
                expected.extend(vec![2. * (ring + height * 1000.); n]);
                expected.sort_by(f64::total_cmp);
                let mut actual = perimeters;
                actual.sort_by(f64::total_cmp);
                for (a, b) in actual.into_iter().zip(expected) {
                    assert!((a - b).abs() < 1e-9, "perimeter {a} != {b}");
                }
                // The representation's plane pcurves must map back onto their
                // actual 3D circles, not merely replay the same builder mistake.
                for face in &p.body.faces {
                    let surface = &p.body.surfaces[face.surface.0 as usize].geometry;
                    for lp in &face.loops {
                        let lp = &p.body.loops[lp.0 as usize];
                        for u in &lp.coedges {
                            let co = &p.body.coedges[u.0 as usize];
                            let pc = &p.body.pcurves[co.pcurve.0 as usize];
                            let curve = &p.body.curves
                                [p.body.edges[co.edge.0 as usize].curve.0 as usize]
                                .geometry;
                            if let SurfaceGeometry::Plane {
                                origin: o,
                                normal: n,
                                x,
                            } = surface
                            {
                                if let CurveGeometry::Circle {
                                    origin: c,
                                    normal: cn,
                                    radius: cr,
                                    ..
                                } = curve
                                {
                                    let PcurveGeometry::Circle {
                                        origin,
                                        radius,
                                        clockwise,
                                    } = pc.geometry
                                    else {
                                        panic!("circle needs planar circle pcurve")
                                    };
                                    let o = o.each_ref().map(|x| x.get());
                                    let n = n.each_ref().map(|x| x.get());
                                    let x = x.each_ref().map(|x| x.get());
                                    let y = [
                                        n[1] * x[2] - n[2] * x[1],
                                        n[2] * x[0] - n[0] * x[2],
                                        n[0] * x[1] - n[1] * x[0],
                                    ];
                                    for j in 0..3 {
                                        assert_eq!(
                                            o[j] + x[j] * origin[0].get() + y[j] * origin[1].get(),
                                            c[j].get()
                                        );
                                    }
                                    assert_eq!(radius.get(), cr.get());
                                    let orientation =
                                        (0..3).map(|j| n[j] * cn[j].get()).sum::<f64>();
                                    assert_eq!(clockwise, orientation < 0.);
                                    let winding = orientation * if co.forward { 1. } else { -1. };
                                    assert_eq!(winding > 0., lp.outer);
                                }
                            } else {
                                assert!(matches!(pc.geometry, PcurveGeometry::Line { .. }));
                            }
                        }
                    }
                }
                let center = frame
                    .apply(
                        swap_axis([size / 2., size / 2., height / 2.], k),
                        1000.,
                        true,
                    )
                    .unwrap();
                for (actual, expected) in p.centroid_mm().unwrap().into_iter().zip(center) {
                    assert!((actual - expected).abs() < 1e-9);
                }
                for &[x, y] in &centers {
                    let q = frame
                        .apply(swap_axis([x, y, height / 2.], k), 1000., true)
                        .unwrap();
                    let (d, inside, bound) = p.probe(q).unwrap();
                    assert!(!inside);
                    // q is the rounded world point, not the exact transformed
                    // circle center. Bound that input displacement independently
                    // in rationals; distance-to-solid is 1-Lipschitz. It must not
                    // be smuggled into the probe's (now tighter) error enclosure.
                    let exact = |v| binary64(v).unwrap();
                    let x_axis = frame.x.map(exact);
                    let z_axis = frame.z.map(exact);
                    let y_axis = [(1, 2), (2, 0), (0, 1)]
                        .map(|(i, j)| &z_axis[i] * &x_axis[j] - &z_axis[j] * &x_axis[i]);
                    let local = swap_axis([x, y, height / 2.], k).map(exact);
                    let input_displacement: num_rational::BigRational = (0..3).map(|j| {
                        let ideal = (exact(frame.origin[j]) + &x_axis[j] * &local[0]
                            + &y_axis[j] * &local[1] + &z_axis[j] * &local[2]) * exact(1000.);
                        (exact(q[j]) - ideal).abs()
                    }).sum();
                    let input_bound = input_displacement.to_f64().unwrap().next_up();
                    assert!((d - r * 1000.).abs() <= bound + input_bound,
                        "distance {d}, bound {bound}, input displacement {input_bound}, frame {frame:?}");
                    assert!(bound < 1e-7);
                }
                // Independent oriented incidence: every edge is used twice with
                // opposite directions, including the periodic seam self-use.
                for i in 0..p.body.edges.len() {
                    let uses = p
                        .body
                        .coedges
                        .iter()
                        .filter(|u| u.edge.0 as usize == i)
                        .collect::<Vec<_>>();
                    assert_eq!(uses.len(), 2);
                    assert_ne!(uses[0].forward, uses[1].forward);
                }
                let wire = wonky_wire::v3::encode(&p.body).unwrap();
                assert!(matches!(
                    analytic::audit(&wonky_wire::v3::decode(&wire).unwrap()).unwrap(),
                    Solid::Perforated(_)
                ));
            }
        }
    }
}
#[test]
fn exact_slabs_and_hole_contacts_refuse_nonmanifold_or_partial_arrangements() {
    let frame = Affine::IDENTITY;
    let a = base([0.; 3], [0.032, 0.032, 0.008], frame);
    for x in [0.002f64.next_down(), 0.002, 0.002f64.next_up()] {
        let c = tool(spec(x, 0.012, 0.002), frame);
        let result = perforated::subtract(key(), &a, &[c]);
        if x > 0.002 {
            assert!(result.is_ok());
        } else {
            assert_eq!(result.unwrap_err().0, "perforated/side-contact-or-crossing");
        }
    }
    // Nonzero lower slab and both upper radial slabs exercise signs hidden
    // by an origin-aligned plate. One ulp decides contact, not an epsilon.
    let shifted = base([0.004, 0.004, 0.], [0.032, 0.032, 0.008], frame);
    for xy in [
        [0.005, 0.012],
        [0.012, 0.005],
        [0.031, 0.012],
        [0.012, 0.031],
    ] {
        assert_eq!(
            perforated::subtract(key(), &shifted, &[tool(spec(xy[0], xy[1], 0.002), frame)])
                .unwrap_err()
                .0,
            "perforated/side-contact-or-crossing"
        );
    }
    // The related distant frame now has an exact separation proof (no hole).
    let unchanged = perforated::subtract(
        key(), &shifted, &[tool(spec(0.012, 0.012, 0.002), frames()[1])]
    ).unwrap();
    let unchanged = polyhedron::audit(&unchanged.check().unwrap()).unwrap();
    assert_eq!(unchanged.body.faces.len(), shifted.body.faces.len());
    assert_eq!(unchanged.volume_mm3().unwrap(), shifted.volume_mm3().unwrap());
    let first = tool(spec(0.008, 0.012, 0.004), frame);
    for x in [0.016f64.next_down(), 0.016, 0.016f64.next_up()] {
        let c = tool(spec(x, 0.012, 0.004), frame);
        let result = perforated::subtract(key(), &a, &[first.clone(), c]);
        if x > 0.016 {
            assert!(result.is_ok());
        } else {
            assert_eq!(result.unwrap_err().0, "perforated/holes-contact-or-overlap");
        }
    }
    for (lo, hi) in [(0.001, 0.010), (-0.002, 0.007)] {
        let mut s = spec(0.012, 0.012, 0.002);
        s.bottom[2] = lo;
        s.top[2] = hi;
        assert_eq!(
            perforated::subtract(key(), &a, &[tool(s, frame)])
                .unwrap_err()
                .0,
            "perforated/blind-or-partial-hole"
        );
    }
    let mut s = spec(0.012, 0.012, 0.002);
    s.bottom[2] = 0.;
    s.top[2] = 0.008;
    assert_eq!(cut(&a, &[tool(s, frame)]).holes.len(), 1);
    let outside = tool(spec(-0.010, -0.010, 0.002), frame);
    let p = cut(&a, &[first, outside]);
    assert_eq!(p.holes.len(), 1);
    let other = tool(
        Spec {
            bottom: [-0.002, 0.020, 0.004],
            top: [0.034, 0.020, 0.004],
            radius: 0.001,
        },
        frame,
    );
    let cross = cut(&a, &[tool(spec(0.008, 0.008, 0.002), frame), other.clone()]);
    assert_eq!(cross.holes.len(), 2);
    assert_eq!(cross.body.faces.len(), 8);
    let crossing = tool(
        Spec {
            bottom: [-0.002, 0.008, 0.004],
            top: [0.034, 0.008, 0.004],
            radius: 0.001,
        },
        frame,
    );
    assert_eq!(
        perforated::subtract(key(), &a, &[tool(spec(0.008, 0.008, 0.002), frame), crossing])
            .unwrap_err().0,
        "perforated/cross-axis-intersection-unresolved"
    );
}
#[test]
fn seam_chart_rounding_is_not_authoritative_and_corruptions_never_certify() {
    let frame = Affine::IDENTITY;
    let s = spec(0.032, 0.032, 0.00390625 * 0.001);
    let c = tool(s, frame);
    let world = cylinder_chart::vertices_mm(&c.body, &c.frame).unwrap();
    for change in [0, 1] {
        let mut corrupt = c.body.clone();
        if let Frame::Rigid { parent, angle, .. } = &mut corrupt.frames[2] {
            if change == 0 {
                *parent = FrameId(0);
            } else {
                *angle = Binary64::new(1.).unwrap();
            }
        }
        assert!(cylinder_chart::vertices_mm(&corrupt, &c.frame).is_err());
    }
    let checked = c.body.clone().check().unwrap();
    assert!(checked
        .contained(wonky_contract::CurveId(2), wonky_contract::SurfaceId(2))
        .is_err());

    let exact =
        (binary64(s.bottom[0]).unwrap() + binary64(s.radius).unwrap()) * binary64(1000.).unwrap();
    assert_eq!(world[0][0], exact.to_f64().unwrap());
    // This fixture really exercises the previous seam nonrepresentability.
    assert_ne!(
        binary64(s.bottom[0] + s.radius).unwrap(),
        binary64(s.bottom[0]).unwrap() + binary64(s.radius).unwrap()
    );
    let a = base([0.; 3], [0.064, 0.064, 0.008], frame);
    let p = cut(&a, &[c]);
    let mut corruptions: Vec<Body> = Vec::new();
    let mut b = p.body.clone();
    b.faces.last_mut().unwrap().forward = true;
    corruptions.push(b);
    let mut b = p.body.clone();
    b.vertices.last_mut().unwrap().point[0] = Binary64::new(0.).unwrap();
    corruptions.push(b);
    let mut b = p.body.clone();
    if let Frame::Rigid { translation, .. } = b.frames.last_mut().unwrap() {
        translation[0] = Binary64::new(0.031).unwrap();
    }
    corruptions.push(b);
    let mut b = p.body.clone();
    if let CurveGeometry::Circle { radius, .. } = &mut b.curves[12].geometry {
        *radius = Binary64::new(0.001).unwrap();
    }
    corruptions.push(b);
    for b in corruptions {
        assert!(analytic::audit(&b.check().unwrap()).is_err());
    }
    let q = [32., 32., 4.];
    assert!(!p.probe(q).unwrap().1);
    let (d, inside, bound) = p.probe([1., 1., 4.]).unwrap();
    assert!(inside);
    assert_eq!(d, 0.);
    assert!(bound < 1e-9);
    let (d, inside, bound) = p.probe([32., 32., 10.]).unwrap();
    assert!(!inside);
    assert!((d - (2_f64.hypot(s.radius * 1000.))).abs() <= bound);
    assert_eq!(p.probe([0., 1., 4.]).unwrap(), (0., true, 0.));
}

#[test]
fn malformed_placement_and_construction_cannot_pass_hole_audit() {
    let f = Affine::IDENTITY;
    let a = base([0.; 3], [0.064, 0.064, 0.008], f);
    let p = cut(&a, &[tool(spec(0.032, 0.032, 0.002), f)]);
    let mut body = p.body.clone();
    if let Frame::Interpreter { x, .. } = &mut body.frames[1] {
        x[0] = Binary64::new(2.).unwrap();
    }
    assert_eq!(
        perforated::audit(&body.check().unwrap()).unwrap_err().0,
        "perforated/non-rigid-frame"
    );
    for count in [1, 66] {
        let mut body = p.body.clone();
        let root = body.constructions.last_mut().unwrap();
        root.parents.resize(count, root.parents[1]);
        assert_eq!(
            perforated::audit(&body.check().unwrap()).unwrap_err().0,
            "perforated/construction"
        );
    }
}

#[test]
fn nonsquare_plate_and_nonorthonormal_binary64_frame_measure_actual_affine_geometry() {
    let frame = Affine {
        origin: [0.; 3],
        x: [1. + 2e-13, 0., 0.],
        z: [0., 0., 1.],
    };
    let a = base([0.; 3], [0.064, 0.032, 0.008], frame);
    let p = cut(&a, &[tool(spec(0.032, 0.016, 0.002), frame)]);
    let (v, _, areas, perimeters) = p.measures_mm().unwrap();
    for (face, actual) in p.body.faces.iter().zip(areas) {
        let expected = match &p.body.surfaces[face.surface.0 as usize].geometry {
            SurfaceGeometry::Plane { normal, .. } if normal[0].get() != 0. => 32. * 8.,
            SurfaceGeometry::Plane { normal, .. } if normal[1].get() != 0. => 64. * 8.,
            SurfaceGeometry::Plane { .. } => 64. * 32. - 4. * 3.141592653589793,
            SurfaceGeometry::Cylinder { .. } => 32. * 3.141592653589793,
            _ => panic!("unexpected carrier"),
        };
        assert!((actual - expected).abs() < 1e-8, "face area {actual} != {expected}");
    }
    // Det[x,z cross x,z] = x0^2. Independent rational arithmetic on the
    // interpreter bits proves this is not a unit-determinant transform.
    let scale = binary64(frame.x[0]).unwrap();
    let det = (&scale * &scale).to_f64().unwrap();
    let expected = (64. * 32. * 8. - 3.141592653589793 * 4. * 8.) * det;
    assert!(
        v.lo() <= expected && expected <= v.hi(),
        "{v:?} excludes {expected}"
    );
    let total = perimeters.iter().sum::<f64>();
    let expected = 2. * 2. * (64. + 8.)
        + 2. * 2. * (32. + 8.)
        + 2. * (2. * (64. + 32.) + 4. * 3.141592653589793)
        + 2. * (4. * 3.141592653589793 + 8.);
    assert!((total - expected).abs() < 1e-9);
    // Far probe in the most stretched direction must retain a nonnegative
    // bound covering the affine metric, not subtract its scale uncertainty.
    let (d, inside, bound) = p.probe([1000., 16., 4.]).unwrap();
    let expected = 1000. - 64. * frame.x[0];
    assert!(!inside);
    assert!(bound >= 0.);
    assert!((d - expected).abs() <= bound);
}

#[test]
fn exact_cross_frame_through_endpoints_are_clipped_and_sources_replayed() {
    // 0.042 - 0.001 has no binary64 representation. It is beyond the
    // stock cap; retaining its exact source DAG and clipping at that cap
    // removes precisely the same material as a source-frame through bore.
    let a = base([0.; 3], [0.04, 0.024, 0.02], Affine::IDENTITY);
    let z = tool(Spec { bottom: [0.01, 0.006, 0.], top: [0.01, 0.006, 0.022], radius: 0.002 },
        Affine { origin: [0., 0., -0.001], ..Affine::IDENTITY });
    let x = tool(Spec { bottom: [0.018, 0.014, 0.], top: [0.018, 0.014, 0.042], radius: 0.002 },
        Affine { origin: [-0.001, 0., 0.], x: [0., 1., 0.], z: [1., 0., 0.] });
    let exact_end = binary64(0.042).unwrap() - binary64(0.001).unwrap();
    assert_ne!(exact_end, binary64(0.042 - 0.001).unwrap());
    let original_x_parameters = x.body.constructions.last().unwrap().parameters.clone();
    let p = cut(&a, &[z, x]);
    let x_root = p.body.constructions.last().unwrap().parents[2].0 as usize;
    assert_eq!(p.body.constructions[x_root].parameters, original_x_parameters);
    assert_eq!(p.holes[1].bottom, [0., 0.018, 0.014]);
    assert_eq!(p.holes[1].top, [0.04, 0.018, 0.014]);
    assert_eq!(p.body.faces.len(), 8);
    assert_eq!(p.body.constructions.last().unwrap().rule_version, 2);
    let (v, _, _, _) = p.measures_mm().unwrap();
    let expected = 40. * 24. * 20. - std::f64::consts::PI * 4. * 60.;
    assert!(v.lo() <= expected && expected <= v.hi());
    assert_eq!(p.transform(Affine::IDENTITY).unwrap_err().0,
        "perforated/grafted-placement-unimplemented");
    // A forged operand layout must not authenticate the cached boundary.
    let mut layout = p.body.clone();
    layout.constructions.last_mut().unwrap().parameters[1] = Binary64::new(1.).unwrap();
    assert_eq!(perforated::audit(&layout.check().unwrap()).unwrap_err().0,
        "prism-holes/source-layout");
    // Planted carrier corruption must fail the source-DAG audit.
    let mut corrupt = p.body.clone();
    if let SurfaceGeometry::Cylinder { radius, .. } = &mut corrupt.surfaces.last_mut().unwrap().geometry {
        *radius = Binary64::new(0.0021).unwrap();
    } else { panic!("missing cylinder wall"); }
    assert_eq!(perforated::audit(&corrupt.check().unwrap()).unwrap_err().0,
        "perforated/construction-carrier-mismatch");
}

#[test]
fn cross_frame_clipping_does_not_round_radial_coordinates_or_hide_partial_cuts() {
    let a = base([0.; 3], [0.04, 0.024, 0.02], Affine::IDENTITY);
    let make = |origin, depth| tool(Spec { bottom: [0.018, 0.014, 0.],
        top: [0.018, 0.014, depth], radius: 0.002 },
        Affine { origin, x: [0., 1., 0.], z: [1., 0., 0.] });
    // The nonrepresentable radial sum is retained material geometry, unlike
    // the discarded axial end. It must refuse rather than silently round.
    let radial = make([-0.001, 0.001, 0.], 0.042);
    assert_eq!(perforated::subtract(key(), &a, &[radial]).unwrap_err().0,
        "prism-holes/non-binary64-related-coordinate");
    let partial = make([-0.001, 0., 0.], 0.02);
    assert_eq!(perforated::subtract(key(), &a, &[partial]).unwrap_err().0,
        "perforated/blind-or-partial-hole");
    // Even a one-ulp shortfall is partial, with no tolerance-based clipping.
    let short = make([0.; 3], 0.04_f64.next_down());
    assert_eq!(perforated::subtract(key(), &a, &[short]).unwrap_err().0,
        "perforated/blind-or-partial-hole");
    // Planted source operand change: a through tool becomes partial. The
    // same exact comparison must reject it before a full-through wall exists.
    let mut source = make([-0.001, 0., 0.], 0.042);
    source.spec.top[2] = 0.04;
    assert_eq!(perforated::subtract(key(), &a, &[source]).unwrap_err().0,
        "perforated/blind-or-partial-hole");
}

#[test]
fn through_span_clipping_uses_the_related_axis_and_orders_reversed_cutters() {
    let a = base([0.; 3], [0.04, 0.024, 0.02], Affine::IDENTITY);
    for (s, frame, axis) in [
        (Spec { bottom: [0.014, 0.012, 0.], top: [0.014, 0.012, 0.026], radius: 0.002 },
         Affine { origin: [0., -0.001, 0.], x: [0., 0., 1.], z: [0., 1., 0.] }, 1),
        (Spec { bottom: [0.018, -0.014, 0.], top: [0.018, -0.014, 0.042], radius: 0.002 },
         Affine { origin: [0.041, 0., 0.], x: [0., 1., 0.], z: [-1., 0., 0.] }, 0),
    ] {
        let p = cut(&a, &[tool(s, frame)]);
        assert_eq!(p.holes[0].axis().unwrap(), axis);
        assert_eq!(p.holes[0].bottom[axis], 0.);
        assert_eq!(p.holes[0].top[axis], [0.04, 0.024, 0.02][axis]);
        assert_eq!(p.body.faces.len(), 7);
    }
}
