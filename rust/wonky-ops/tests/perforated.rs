//! Owner-boundary contracts for exact through-holes. Tests use independent
//! closed forms and exact rational input arithmetic, not a second constructor.
use num_traits::ToPrimitive;
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
                    assert!((d - r * 1000.).abs() <= bound);
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
    assert_eq!(
        perforated::subtract(
            key(),
            &shifted,
            &[tool(spec(0.012, 0.012, 0.002), frames()[1])]
        )
        .unwrap_err()
        .0,
        "cylinder/different-exact-frames"
    );
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
    assert_eq!(
        perforated::subtract(key(), &a, &[tool(spec(0.008, 0.008, 0.002), frame), other])
            .unwrap_err()
            .0,
        "perforated/cross-axis-holes"
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
    assert!(p.probe([0., 1., 4.]).is_err());
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
