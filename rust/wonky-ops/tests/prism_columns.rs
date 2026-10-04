//! Axial columns on an extruded profile (pins, bosses, buried caps, bores
//! through bosses) and mixed coaxial sequences. Observables come from closed
//! forms derived here, the STL from an independent divergence-theorem volume
//! and edge pairing; replay corruption and out-of-scope arrangements refuse
//! by name.
use std::f64::consts::PI;
use wonky_contract::{Binary64, Body, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile,
    cylinder::{self, Spec},
    orthogonal, polyhedron,
};

fn key() -> BodyKey {
    BodyKey { id: [51, 3, 8, 1], revision: 0 }
}
fn planar(body: Body) -> Solid {
    Solid::Planar(polyhedron::audit(&body.check().unwrap()).unwrap())
}
fn cyl(bottom: [f64; 3], top: [f64; 3], radius: f64) -> Solid {
    let body = cylinder::create(key(), Spec { bottom, top, radius }).unwrap();
    Solid::Cylinder(cylinder::audit(&body.check().unwrap()).unwrap())
}
/// A pin built like a FeatureScript cylinder from bottom to top: sketched on
/// `plane(bottom, direction)` and extruded by the binary64 height top - bottom,
/// so its levels in the plate frame are exact translations of its own.
fn placed_pin(base: [f64; 3], length: f64, radius: f64) -> Solid {
    let height = (base[2] + length) - base[2];
    let local = cylinder::create(key(), Spec { bottom: [0.; 3], top: [0., 0., height], radius }).unwrap();
    let local = cylinder::audit(&local.check().unwrap()).unwrap();
    let frame = Affine { origin: base, x: [1., 0., 0.], z: [0., 0., 1.] };
    let body = cylinder::transform(&local, frame).unwrap();
    Solid::Cylinder(cylinder::audit(&body.check().unwrap()).unwrap())
}
/// Square line profile of half-width 21 mm and thickness 3 mm (a NEMA17-size plate).
fn line_plate() -> Solid {
    let h = 0.021;
    let lines = [[-h, -h, h, -h], [h, -h, h, h], [h, h, -h, h], [-h, h, -h, -h]];
    planar(arc_profile::build(key(), Affine::IDENTITY, &lines, &[], 0.003, false).unwrap())
}
fn one(bodies: Vec<Body>) -> Body {
    assert_eq!(bodies.len(), 1);
    bodies.into_iter().next().unwrap()
}
fn audit(body: &Body) -> Solid {
    analytic::audit(&body.clone().check().unwrap()).unwrap()
}
fn field(json: &str, name: &str) -> f64 {
    json.split(&format!("\"{name}\":")).nth(1).unwrap().split([',', '}']).next().unwrap().parse().unwrap()
}
/// The `i`-th object in the top-level `"probes":[...]` array, as its own
/// `{...}` string so `field` and `.contains` can target that probe alone.
fn probe(json: &str, i: usize) -> String {
    let list = json.split("\"probes\":[").nth(1).unwrap();
    let list = &list[..list.find(']').unwrap()];
    format!("{{{}}}", list.split("},{").nth(i).unwrap().trim_matches(['{', '}']))
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs() * 1e-10, "{a} != {b}");
}
/// Every edge has two opposite uses in the WC0 body.
fn assert_manifold(body: &Body) {
    for e in 0..body.edges.len() {
        let uses = body.coedges.iter().filter(|c| c.edge.0 as usize == e).collect::<Vec<_>>();
        assert_eq!(uses.len(), 2);
        assert_ne!(uses[0].forward, uses[1].forward);
    }
}
/// Independent STL observation: watertight oriented triangle mesh whose
/// divergence-theorem volume lies within deviation x area of the exact volume.
fn assert_mesh(body: &Body, volume: f64, area: f64) {
    let deviation = 0.01;
    let checked = wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap();
    let mesh = wonky_ops::mesh::tessellate(&checked, deviation).unwrap();
    let mut directed = std::collections::BTreeMap::new();
    let mut signed = 0.;
    for t in &mesh.triangles {
        for i in 0..3 {
            *directed.entry((t[i], t[(i + 1) % 3])).or_insert(0) += 1;
        }
        let [a, b, c] = t.map(|i| mesh.vertices[i]);
        signed += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    for (&(a, b), &n) in &directed {
        assert_eq!(n, 1, "edge {a}-{b} used twice in one direction");
        assert_eq!(directed.get(&(b, a)), Some(&1), "open mesh edge {a}-{b}");
    }
    let mesh_volume = signed / 6.;
    assert!((mesh_volume - volume).abs() <= 2. * deviation * area, "mesh volume {mesh_volume} vs {volume}");
}

#[test]
fn plate_with_four_pins_matches_closed_forms_in_any_union_order() {
    let pins = [[-0.0155, 0.0105], [0., 0.0105], [0.0155, 0.0105], [0., -0.0105]]
        .map(|[x, y]| placed_pin([x, y, 0.002], 0.007, 0.002));
    // r20Union style: one pin at a time onto the running result.
    let mut running = line_plate();
    for pin in &pins {
        running = audit(&one(analytic::boolean(key(), 0, &[running, pin.clone()]).unwrap()));
    }
    let mut all = vec![line_plate()];
    all.extend(pins.iter().cloned());
    let once = one(analytic::boolean(key(), 0, &all).unwrap());
    let Solid::Columns(sequential) = &running else { panic!("not a column arrangement") };
    assert_eq!(sequential.body, once);
    // A cylinder listed first is still a tool of the one profile target.
    let first = one(analytic::boolean(key(), 0, &[pins[0].clone(), line_plate()]).unwrap());
    assert!(matches!(audit(&first), Solid::Columns(_)));

    let body = &sequential.body;
    assert_eq!(body.faces.len(), 6 + 4 * 2);
    assert_manifold(body);
    // Plate 42 x 42 x 3 mm; each pin adds r=2 over the 6 mm above the top face.
    let volume = 42. * 42. * 3. + 4. * PI * 4. * 6.;
    let area = 2. * 42. * 42. + 4. * 42. * 3. + 4. * (2. * PI * 2. * 6.);
    let probes = [[0., 10.5, 8.], [15.5, 10.5, 2.5], [10., -10., 1.5], [10., 10., 5.]];
    let json = running.measure(None, &probes).unwrap();
    close(field(&json, "volumeMm3"), volume);
    close(field(&json, "areaMm2"), area);
    assert!(json.contains("\"genus\":0"));
    assert!(json.contains("\"certificate\":\"AxialProfileColumns\""));
    // Centroid: x cancels; y and z from the four pin moments.
    let center = json.split("\"centroidMm\":[").nth(1).unwrap().split(']').next().unwrap();
    let c = center.split(',').map(|v| v.trim().parse::<f64>().unwrap()).collect::<Vec<_>>();
    let pin = 4. * PI * 6.;
    assert!(c[0].abs() < 1e-9);
    close(c[1], pin * (10.5 + 10.5 + 10.5 - 10.5) / volume);
    close(c[2], (42. * 42. * 3. * 1.5 + 4. * pin * 6.) / volume);
    assert_eq!(json.matches("\"inside\":true").count(), 3);
    // Probe 3 [10,10,5] sits directly above the top face clear of every pin
    // (nearest pin wall is 3.52 mm away): the closer boundary is the flat
    // cap itself, exactly 2 mm below.
    assert!(probe(&json, 3).contains("\"inside\":false"));
    close(field(&probe(&json, 3), "distanceMm"), 2.0);
    let step = analytic::step(&[("pins".into(), running.clone())], "pins").unwrap();
    assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 4);
    assert!(step.contains("MANIFOLD_SOLID_BREP"));
    assert_mesh(body, volume, area);

    // Planted negative: a pin wall one ulp wider no longer replays.
    let mut corrupt = body.clone();
    let wall = corrupt
        .surfaces
        .iter_mut()
        .rev()
        .find(|s| matches!(s.geometry, SurfaceGeometry::Cylinder { .. }))
        .unwrap();
    if let SurfaceGeometry::Cylinder { radius, .. } = &mut wall.geometry {
        *radius = Binary64::new(radius.get().next_up()).unwrap();
    }
    assert_eq!(
        analytic::audit(&corrupt.check().unwrap()).unwrap_err().0,
        "prism-columns/construction-carrier-mismatch"
    );
}

#[test]
fn boss_with_a_through_bore_is_one_genus_one_body() {
    let plate = planar(orthogonal::cuboid(key(), [0., 0., 0.], [0.04, 0.03, 0.004]).unwrap());
    // Boss standing exactly on the top face (face contact merges).
    let boss = cyl([0.02, 0.015, 0.004], [0.02, 0.015, 0.01], 0.005);
    let bossed = audit(&one(analytic::boolean(key(), 0, &[plate, boss]).unwrap()));
    let bore = cyl([0.02, 0.015, -0.001], [0.02, 0.015, 0.011], 0.002);
    let body = one(analytic::boolean(key(), 1, &[bossed, bore]).unwrap());
    assert_eq!(body.faces.len(), 6 + 3);
    assert_manifold(&body);
    let solid = audit(&body);
    let volume = 40. * 30. * 4. - PI * 4. * 4. + PI * (25. - 4.) * 6.;
    let area = 2. * (40. * 30. + 40. * 4. + 30. * 4.) - 25. * PI - 4. * PI + 60. * PI + 21. * PI + 40. * PI;
    let json = solid.measure(None, &[[20., 15., 7.], [23.5, 15., 9.]]).unwrap();
    close(field(&json, "volumeMm3"), volume);
    close(field(&json, "areaMm2"), area);
    assert!(json.contains("\"genus\":1"));
    // Probe 0 [20,15,7] sits on the bore axis (r=0 inside the 2 mm bore):
    // the nearest boundary is the bore wall, exactly 2 mm away.
    assert!(probe(&json, 0).contains("\"inside\":false"));
    close(field(&probe(&json, 0), "distanceMm"), 2.0);
    // Probe 1 [23.5,15,9] sits in the boss shell between the bore and the
    // outer wall (3.5 mm off axis, 2 mm < 3.5 mm < 5 mm): inside.
    assert!(json.contains("\"inside\":true"));
    let max = json.split("\"bboxMm\":{").nth(1).unwrap().split("\"max\":[").nth(1).unwrap();
    let max = max.split(']').next().unwrap().split(',').map(|v| v.trim().parse::<f64>().unwrap()).collect::<Vec<_>>();
    for (got, want) in max.into_iter().zip([40., 30., 10.]) {
        assert!((got - want).abs() < 1e-9, "bbox max {got} != {want}");
    }
    assert_mesh(&body, volume, area);
    assert!(analytic::step(&[("boss".into(), solid)], "boss").unwrap().contains("FACE_BOUND("));
}

/// Plate 60 x 40 x 4 mm with a pin (r 2) sunk 2 mm and standing to 12 mm, a
/// boss (r 6) to 10 mm, a through hole (r 3) and, if `bore`, a bore (r 2.5)
/// down the boss that stops 1 mm above the plate bottom. Every piece of the
/// columns boundary occurs: profile side, top cap with two rings, bottom cap
/// with one, forward and inward walls, a floor disc and a boss-top annulus.
fn pin_boss_and_hole(bore: bool) -> Solid {
    let plate = planar(orthogonal::cuboid(key(), [0., 0., 0.], [0.06, 0.04, 0.004]).unwrap());
    let pin = cyl([0.01, 0.02, 0.002], [0.01, 0.02, 0.012], 0.002);
    let boss = cyl([0.03, 0.02, 0.004], [0.03, 0.02, 0.01], 0.006);
    let united = audit(&one(analytic::boolean(key(), 0, &[plate, pin, boss]).unwrap()));
    let mut cut = vec![united, cyl([0.048, 0.02, -0.001], [0.048, 0.02, 0.005], 0.003)];
    if bore {
        cut.push(cyl([0.03, 0.02, 0.001], [0.03, 0.02, 0.011], 0.0025));
    }
    audit(&one(analytic::boolean(key(), 1, &cut).unwrap()))
}

#[test]
fn outside_probes_match_closed_forms_on_every_boundary_piece() {
    let (s2, s3, s725) = (2f64.sqrt(), 3f64.sqrt(), 7.25f64.sqrt());
    // (probe mm, nearest boundary, exact distance mm); columns at (10,20),
    // (30,20) and (48,20).
    let cases = [
        ([12., 22., 9.], "pin wall", 2. * s2 - 2.),
        ([12.5, 21., 13.], "pin top rim", ((s725 - 2.).powi(2) + 1.).sqrt()),
        ([12.5, 20., 4.3], "top cap beside the pin foot", 0.3),
        ([31., 21., 3.], "bore wall from the void in the plate", 2.5 - s2),
        ([32.1, 20., 1.3], "bore floor next to the wall-floor seam", 0.3),
        ([31., 21., 11.], "bore mouth rim of the boss-top annulus", ((2.5 - s2).powi(2) + 1.).sqrt()),
        ([34., 20., 13.], "boss-top annulus", 3.),
        ([49., 20., 6.], "top cap ring over the hole", 2. * s2),
        ([48., 21.5, -2.], "bottom cap ring under the hole", 2.5),
        ([30., 20., -1.5], "bottom cap under the boss, whose ring is on top", 1.5),
        ([63., 25., 2.5], "profile side wall", 3.),
        ([-1., -1., 5.], "profile corner above the top cap", s3),
    ];
    let json = pin_boss_and_hole(true).measure(None, &cases.map(|c| c.0)).unwrap();
    for (i, (p, piece, want)) in cases.iter().enumerate() {
        let got = probe(&json, i);
        assert!(got.contains("\"inside\":false"), "{piece} {p:?}: {got}");
        let (d, bound) = (field(&got, "distanceMm"), field(&got, "boundMm"));
        assert!((0. ..1e-9).contains(&bound), "{piece}: bound {bound}");
        assert!((d - want).abs() <= bound + 1e-12 * want.max(1.), "{piece} {p:?}: {d} != {want}");
    }
    // Material under the bore floor and in the pin stays inside.
    let json = pin_boss_and_hole(true).measure(None, &[[31., 20., 0.5], [10., 21., 11.]]).unwrap();
    assert_eq!(json.matches("\"inside\":true,\"boundMm\":0.0").count(), 2);

    // Planted negative: the same body without its bore is a wrong body. Its
    // mouth probe sees the flat boss top 1 mm below and its void probe lands
    // in material, so neither passes for the bored closed forms above.
    let wrong = pin_boss_and_hole(false).measure(None, &[cases[5].0, cases[3].0]).unwrap();
    assert!(probe(&wrong, 0).contains("\"inside\":false"));
    close(field(&probe(&wrong, 0), "distanceMm"), 1.);
    assert!(probe(&wrong, 1).contains("\"inside\":true"));
}

#[test]
fn clearance_holes_drilled_from_the_top_face_by_a_nominal_depth() {
    // Like a canonical M3 clearance cutter: sketched on the top face with the
    // normal pointing into the plate, extruded 11.3 mm. 0.003 - 0.0113 is no
    // binary64, so the far end is clipped to the bottom face by an exact
    // comparison, never rounded.
    let pinned = audit(&one(analytic::boolean(key(), 0, &[line_plate(), placed_pin([0., 0.0105, 0.002], 0.007, 0.002)]).unwrap()));
    let drill = |x: f64, y: f64| {
        let local = cylinder::create(key(), Spec { bottom: [0.; 3], top: [0., 0., 0.0113], radius: 0.0017 }).unwrap();
        let local = cylinder::audit(&local.check().unwrap()).unwrap();
        let frame = Affine { origin: [x, y, 0.003], x: [1., 0., 0.], z: [0., 0., -1.] };
        Solid::Cylinder(cylinder::audit(&cylinder::transform(&local, frame).unwrap().check().unwrap()).unwrap())
    };
    let mut bodies = vec![pinned];
    bodies.extend([[-0.0155, -0.0155], [0.0155, -0.0155], [0.0155, 0.0155], [-0.0155, 0.0155]].map(|[x, y]| drill(x, y)));
    let body = one(analytic::boolean(key(), 1, &bodies).unwrap());
    assert_eq!(body.faces.len(), 6 + 2 + 4);
    assert_manifold(&body);
    let json = audit(&body).measure(None, &[]).unwrap();
    let volume = 42. * 42. * 3. + PI * 4. * 6. - 4. * PI * 1.7 * 1.7 * 3.;
    close(field(&json, "volumeMm3"), volume);
    assert!(json.contains("\"genus\":4"));
}

#[test]
fn pin_through_both_caps_buried_and_flush_pins() {
    let plate = || planar(orthogonal::cuboid(key(), [0., 0., 0.], [0.02, 0.02, 0.004]).unwrap());
    let through = cyl([0.01, 0.01, -0.002], [0.01, 0.01, 0.006], 0.002);
    let body = one(analytic::boolean(key(), 0, &[plate(), through]).unwrap());
    assert_eq!(body.faces.len(), 6 + 4);
    let json = audit(&body).measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), 20. * 20. * 4. + PI * 4. * 4.);
    assert!(json.contains("\"genus\":0"));
    // Buried and flush pins leave the profile solid unchanged.
    for (lo, hi) in [(0.001, 0.003), (0.001, 0.004), (0., 0.004)] {
        let pin = cyl([0.01, 0.01, lo], [0.01, 0.01, hi], 0.002);
        let out = one(analytic::boolean(key(), 0, &[plate(), pin]).unwrap());
        assert_eq!(out.faces.len(), 6);
        assert!(matches!(audit(&out), Solid::Planar(_)));
    }
}

#[test]
fn out_of_scope_columns_refuse_by_name() {
    let plate = || planar(orthogonal::cuboid(key(), [0., 0., 0.], [0.02, 0.02, 0.004]).unwrap());
    let refusal = |bodies: &[Solid], op: u8| analytic::boolean(key(), op, bodies).unwrap_err().0;
    let pin = |x: f64, y: f64, lo: f64, hi: f64| cyl([x, y, lo], [x, y, hi], 0.002);
    // A column crossing the side is an exact arrangement, not an owner limit.
    // Its 2 mm overlap in height contains the disc except for the circular
    // segment left of x=0 (r=2, centre x=1), integrated independently here.
    let crossed = one(analytic::boolean(key(), 0, &[plate(), pin(0.001, 0.01, 0.002, 0.008)]).unwrap());
    let crossed_volume = 1600. + 16. * PI + 8. * 0.5_f64.acos() - 2. * 3_f64.sqrt();
    let json = audit(&crossed).measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), crossed_volume);
    assert!(json.contains("\"genus\":0"));
    assert_manifold(&crossed);
    assert_mesh(&crossed, crossed_volume, field(&json, "areaMm2"));
    assert!(analytic::step(&[("crossed".into(), audit(&crossed))], "crossed").unwrap().contains("CYLINDRICAL_SURFACE"));
    // Tangent to the side face is contact, not clearance.
    assert_eq!(refusal(&[plate(), pin(0.002, 0.01, 0.002, 0.008)], 0), "prism-stack/tangent-branch-order");
    // The shared arrangement removes the overlapping boss lens once.
    let joined = one(analytic::boolean(key(), 0, &[plate(), pin(0.008, 0.01, 0.002, 0.008), pin(0.011, 0.01, 0.002, 0.008)]).unwrap());
    let lens = 8. * 0.75_f64.acos() - 1.5 * 7_f64.sqrt();
    let volume = 1600. + 4. * (8. * PI - lens);
    let json = audit(&joined).measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), volume);
    assert!(json.contains("\"genus\":0"));
    assert_manifold(&joined);
    assert_mesh(&joined, volume, field(&json, "areaMm2"));
    assert!(analytic::step(&[("joined-bosses".into(), audit(&joined))], "joined-bosses").unwrap().contains("CYLINDRICAL_SURFACE"));
    assert_eq!(refusal(&[plate(), pin(0.01, 0.01, 0.005, 0.008)], 0), "prism-stack/multiple-result-bodies");
    // Floating off the plate and across its outline in plan: still a lump.
    assert_eq!(refusal(&[plate(), pin(0.001, 0.01, 0.005, 0.008)], 0), "prism-stack/multiple-result-bodies");
    let sideways = cyl([0.004, 0.01, 0.006], [0.016, 0.01, 0.006], 0.001);
    assert_eq!(refusal(&[plate(), sideways], 0), "prism-stack/multiple-result-bodies");
    // A pin standing exactly on a same-radius through hole meets the plate
    // along one circle only: material swaps sides across that ring.
    let pinned = audit(&one(analytic::boolean(key(), 0, &[plate(), pin(0.01, 0.01, 0.004, 0.008)]).unwrap()));
    assert_eq!(
        refusal(&[pinned.clone(), pin(0.01, 0.01, -0.001, 0.004)], 1),
        "prism-columns/non-manifold-ring"
    );
    // The shared stack retains the exact source sum 0.002 + 0.007 instead
    // of rounding it onto a binary64 carrier. Only 5 mm extends past the plate.
    let local = cylinder::create(key(), Spec { bottom: [0.; 3], top: [0., 0., 0.007], radius: 0.002 }).unwrap();
    let local = cylinder::audit(&local.check().unwrap()).unwrap();
    let moved = cylinder::transform(&local, Affine { origin: [0.01, 0.01, 0.002], x: [1., 0., 0.], z: [0., 0., 1.] }).unwrap();
    let inexact = Solid::Cylinder(cylinder::audit(&moved.check().unwrap()).unwrap());
    let exact_sum = one(analytic::boolean(key(), 0, &[plate(), inexact]).unwrap());
    assert_manifold(&exact_sum);
    let exact_sum = audit(&exact_sum);
    let json = exact_sum.measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), 1600. + 20. * PI);
    assert_eq!(field(&json, "genus"), 0.);
    assert!(analytic::step(&[("source-sum".into(), exact_sum)], "source-sum").is_ok());
    let block = planar(orthogonal::cuboid(key(), [0.001, 0.001, 0.003], [0.005, 0.005, 0.009]).unwrap());
    assert_eq!(refusal(&[pinned, block], 1), "prism-columns/profile-tool-unimplemented");
}

#[test]
fn stepped_shaft_union_then_bores_and_a_named_cross_hole_refusal() {
    let shaft = one(
        analytic::boolean(
            key(),
            0,
            &[cyl([0., 0., 0.], [0., 0., 0.01], 0.005), cyl([0., 0., 0.01], [0., 0., 0.02], 0.003)],
        )
        .unwrap(),
    );
    let shaft = audit(&shaft);
    assert!(matches!(shaft, Solid::Coaxial(_)));
    let bored = audit(&one(
        analytic::boolean(key(), 1, &[shaft.clone(), cyl([0., 0., -0.001], [0., 0., 0.021], 0.001)]).unwrap(),
    ));
    let json = bored.measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), PI * (25. * 10. + 9. * 10.) - PI * 20.);
    assert!(json.contains("\"genus\":1"));
    // A further counterbore keeps the operation order: ((A u B) - C) - D, not
    // A - (B u C u D).
    let counter = one(
        analytic::boolean(key(), 1, &[bored.clone(), cyl([0., 0., 0.015], [0., 0., 0.021], 0.002)]).unwrap(),
    );
    let json = audit(&counter).measure(None, &[]).unwrap();
    close(field(&json, "volumeMm3"), PI * (25. * 10. + 9. * 10.) - PI * 20. - PI * 3. * 5.);
    let cross = cyl([-0.006, 0., 0.005], [0.006, 0., 0.005], 0.001);
    assert_eq!(
        analytic::boolean(key(), 1, &[shaft, cross]).unwrap_err().0,
        "coaxial/cross-axis-tool-unimplemented"
    );
    // Planted negative: an operation code flipped in the root no longer replays.
    let mut corrupt = counter.clone();
    let root = corrupt.constructions.last_mut().unwrap();
    root.parameters[1] = Binary64::new(0.).unwrap();
    assert!(analytic::audit(&corrupt.check().unwrap()).is_err());
}
