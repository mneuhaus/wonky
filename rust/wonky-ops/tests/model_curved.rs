//! G8 dark adapters on frozen live FeatureScript outputs, with source hashes
//! in data/acid-curved-wc0.txt. No family build is substituted by a mock.
use std::collections::{BTreeMap, BTreeSet};
use wonky_geom::model::Canonical;
use wonky_ops::analytic::{self, Solid};

fn cells() -> Vec<(String, String, usize, Vec<u32>)> {
    include_str!("data/acid-curved-wc0.txt")
        .lines()
        .filter(|s| !s.starts_with('#'))
        .map(|s| {
            let f: Vec<_> = s.split_whitespace().collect();
            assert_eq!(f.len(), 6);
            let words = f[5]
                .as_bytes()
                .chunks(8)
                .map(|c| u32::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
                .collect();
            (f[0].into(), f[1].into(), f[2].parse().unwrap(), words)
        })
        .collect()
}
#[test]
fn live_acid_adapters_pass_g1_g8_with_seams_quotiented_and_variant_identity() {
    let mut forms: BTreeMap<(String, usize), Vec<(String, Canonical)>> = BTreeMap::new();
    let mut families = BTreeSet::new();
    for (zone, variant, index, words) in cells() {
        let body = wonky_wire::v3::decode(&words).unwrap();
        let solid = analytic::audit(&body).unwrap();
        families.insert(match &solid {
            Solid::Cylinder(_) => "P7",
            Solid::Perforated(_) => "P6",
            Solid::PrismHoles(_) => "P5",
            Solid::Coaxial(_) => "P8",
            Solid::Revolved(_) => "P11",
            Solid::Planar(_) => "P1",
            _ => panic!("unexpected family {zone} {variant}"),
        });
        let model = solid
            .model()
            .unwrap_or_else(|e| panic!("{zone} {variant} body {index}: {e:?}"));
        let form = model.canonical();
        let expected = match zone.as_str() {
            "AC18" | "AC60" => (8, 20, 10),
            "AC21" | "AC22" | "AC44" => (0, 2, 3),
            "AC23" => (8, 12, 6),
            "AC47" => (8, 14, 7),
            _ => panic!("unexpected zone"),
        };
        assert_eq!(
            (form.vertices.len(), form.edges.len(), form.faces.len()),
            expected,
            "{zone} {variant} body {index}"
        );
        assert_eq!(form.shells.len(), 1, "{zone} {variant}");
        assert!(model
            .volume6_pi()
            .unwrap()
            .iter()
            .all(|v| v.sign().unwrap() == std::cmp::Ordering::Greater));
        if zone == "AC21" {
            // Planted negative: keep the transport seam as a real B-rep edge.
            // The frozen live WC0 contains it; the exact Model must quotient it.
            assert_eq!(
                (
                    body.body().vertices.len(),
                    body.body().edges.len(),
                    body.body().faces.len()
                ),
                (2, 3, 3)
            );
            assert_ne!(
                (form.vertices.len(), form.edges.len(), form.faces.len()),
                (2, 3, 3)
            );
        }
        forms
            .entry((zone, index))
            .or_default()
            .push((variant, form));
    }
    assert_eq!(
        forms
            .keys()
            .map(|(z, _)| z.as_str())
            .collect::<BTreeSet<_>>(),
        ["AC18", "AC21", "AC22", "AC23", "AC44", "AC47", "AC60"]
            .into_iter()
            .collect()
    );
    assert_eq!(forms.len(), 9); // AC22 and AC44 each return two bodies.
    for ((zone, index), variants) in forms {
        assert_eq!(
            variants.iter().map(|(v, _)| v.as_str()).collect::<Vec<_>>(),
            ["V0", "V1", "V2", "V3"]
        );
        for (variant, form) in &variants[1..] {
            assert_eq!(*form, variants[0].1, "{zone} body {index}: {variant} vs V0");
        }
    }
    // The row zones currently select P6, not P5. Add a real P5 construction
    // as separate source coverage; it is not a live Acid capture.
    p5_off_axis_blind_bore();
    families.insert("P5");
    assert!(families.contains("P7"));
    assert!(families.contains("P5"));
    assert!(families.contains("P6"));
}

#[test]
fn p8_coaxial_and_p11_cone_profiles_use_shared_ring_audits() {
    use wonky_contract::BodyKey;
    use wonky_ops::{
        affine::Affine,
        coaxial,
        cylinder::{self, Spec},
        revolve_full,
    };
    let key = || BodyKey {
        id: [8, 1, 0, 0],
        revision: 0,
    };
    let cylinder = |radius, lo, hi| {
        let b = cylinder::create(
            key(),
            Spec {
                bottom: [0., 0., lo],
                top: [0., 0., hi],
                radius,
            },
        )
        .unwrap();
        cylinder::audit(&b.check().unwrap()).unwrap()
    };
    let base = cylinder(4. / 1024., 0., 8. / 1024.);
    let tool = cylinder(1. / 1024., -2. / 1024., 10. / 1024.);
    let b = coaxial::boolean(key(), 1, &base, &[tool])
        .unwrap()
        .check()
        .unwrap();
    let s = analytic::audit(&b).unwrap();
    assert!(matches!(s, Solid::Coaxial(_)));
    let m = s.model().unwrap();
    assert_eq!(
        (
            m.draft().vertices.len(),
            m.draft().edges.len(),
            m.draft().faces.len()
        ),
        (0, 4, 4)
    );
    for points in [
        vec![[0., 0.], [6., 0.], [0., 8.]],
        vec![[0., 0.], [2., 0.], [4., 8.], [0., 8.]],
    ] {
        let lines: Vec<_> = (0..points.len())
            .map(|i| {
                let (a, b) = (points[i], points[(i + 1) % points.len()]);
                [a[0] / 1024., a[1] / 1024., b[0] / 1024., b[1] / 1024.]
            })
            .collect();
        for mode in 0..3 {
            let body = revolve_full::build(
                key(),
                [0; 4],
                Affine::IDENTITY,
                mode,
                &lines,
                std::f64::consts::TAU,
            )
            .unwrap()
            .check()
            .unwrap();
            let s = analytic::audit(&body).unwrap();
            assert!(matches!(s, Solid::Revolved(_)));
            let m = s.model().unwrap();
            let volume = m.volume6_pi().unwrap();
            assert_eq!(
                volume[0].rational,
                num_rational::BigRational::from_integer(0.into())
            );
            assert_eq!(
                volume[0].pi,
                num_rational::BigRational::new(
                    (if points.len() == 3 { 576_i64 } else { 448_i64 }).into(),
                    (1024_i64.pow(3)).into()
                )
            );
        }
    }
}

fn p5_off_axis_blind_bore() {
    use wonky_contract::BodyKey;
    use wonky_ops::cylinder::{self, Spec};
    let key = || BodyKey {
        id: [8, 5, 0, 0],
        revision: 0,
    };
    let cyl = |x, r, lo, hi| {
        let body = cylinder::create(
            key(),
            Spec {
                bottom: [x, 0., lo],
                top: [x, 0., hi],
                radius: r,
            },
        )
        .unwrap()
        .check()
        .unwrap();
        analytic::audit(&body).unwrap()
    };
    let inputs = [
        cyl(0., 5. / 1024., 0., 4. / 1024.),
        cyl(2. / 1024., 1. / 1024., 2. / 1024., 5. / 1024.),
    ];
    let mut bodies = analytic::boolean(key(), 1, &inputs).unwrap();
    assert_eq!(bodies.len(), 1);
    let body = bodies.pop().unwrap().check().unwrap();
    let solid = analytic::audit(&body).unwrap();
    assert!(matches!(solid, Solid::PrismHoles(_)));
    let model = solid.model().unwrap();
    assert_eq!(
        (
            model.draft().vertices.len(),
            model.draft().edges.len(),
            model.draft().faces.len()
        ),
        (0, 4, 5)
    );
    let volume = model.volume6_pi().unwrap();
    assert_eq!(
        volume[0].rational,
        num_rational::BigRational::from_integer(0.into())
    );
    assert_eq!(
        volume[0].pi,
        num_rational::BigRational::new(588.into(), 1024_i64.pow(3).into())
    );
}
