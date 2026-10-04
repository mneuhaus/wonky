//! The planar extrusion slice (CAD-Acid AC01 on strict rust): sketch region,
//! exact BLIND prism as a WC0 v3 body, exact audit, measurements, STEP, host op.
//! Every expected value comes from an exact rational oracle (wonky-oracle) on
//! the literal binary64 inputs, or from the zone's closed form; the interpreter
//! frames are the ones the FeatureScript twin produced (tests/data, with the
//! twin's sha256), never hand-typed.
use num_rational::BigRational as R;
use num_traits::{Signed, ToPrimitive, Zero};
use std::result::Result;
use wonky_contract::*;
use wonky_num::{p2, P2};
use wonky_ops::affine::Affine;
use wonky_ops::extrude::{blind_prism, Prism, Refusal};
use wonky_ops::host::{host_op, MAGIC, OP_MEASURE, OP_PRISM, OP_REGION, OP_STEP, STATUS_MALFORMED, STATUS_OK, STATUS_REFUSED, VERSION};
use wonky_ops::polyhedron::{audit, Audited, Probe};
use wonky_ops::step;
use wonky_oracle::binary64 as exact;
use wonky_sketch::region::{lines_region, RegionLoop};
use wonky_sketch::Refusal as SketchRefusal;

// ------------------------------------------------------------------ helpers

fn nearest(r: &R) -> f64 {
    let mut f = r.to_f64().unwrap();
    loop {
        let d = (r - exact(f).unwrap()).abs();
        let up = (r - exact(f.next_up()).unwrap()).abs();
        let down = (r - exact(f.next_down()).unwrap()).abs();
        if up < d {
            f = f.next_up();
        } else if down < d {
            f = f.next_down();
        } else {
            return f;
        }
    }
}

struct Variant {
    name: &'static str,
    frame: Affine,
    segments: Vec<[f64; 4]>,
    depth: f64,
}

fn hexes(block: &str) -> Vec<f64> {
    block
        .split('"')
        .filter(|s| s.len() == 16 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|s| f64::from_bits(u64::from_str_radix(s, 16).unwrap()))
        .collect()
}

/// AC01's interpreter values per variant (tests/data/ac01-interpreter-frames.json).
fn ac01() -> Vec<Variant> {
    let text = include_str!("data/ac01-interpreter-frames.json");
    let mut out = Vec::new();
    for name in ["V0", "V1", "V2", "V3"] {
        let start = text.find(&format!("\"{name}\": {{")).unwrap();
        let end = text[start + 1..].find("\"V").map(|e| start + 1 + e).unwrap_or(text.len());
        let v = hexes(&text[start..end]);
        assert_eq!(v.len(), 9 + 24 + 2, "{name}: origin, x, z, 6 segments, extrude");
        out.push(Variant {
            name,
            frame: Affine {
                origin: [v[0], v[1], v[2]],
                x: [v[3], v[4], v[5]],
                z: [v[6], v[7], v[8]],
            },
            segments: v[9..33].chunks(4).map(|c| [c[0], c[1], c[2], c[3]]).collect(),
            depth: v[33],
        });
        assert_eq!(v[34], 1.0, "{name}: extruded along the sketch normal");
    }
    out
}

fn region(segments: &[[f64; 4]]) -> Vec<RegionLoop> {
    let s: Vec<_> = segments.iter().map(|s| [p2(s[0], s[1]), p2(s[2], s[3])]).collect();
    lines_region(&s).unwrap().loops
}

fn key() -> BodyKey {
    BodyKey { id: [1, 2, 3, 4], revision: 0 }
}

fn build(frame: Affine, segments: &[[f64; 4]], depth: f64, reverse: bool) -> Result<Audited, String> {
    let loops = region(segments);
    assert_eq!(loops.len(), 1);
    let body = blind_prism(&Prism {
        key: key(),
        source: [0; 4],
        frame,
        segments,
        region: &loops[0],
        depth,
        reverse,
    })
    .map_err(|e| format!("{e:?}"))?;
    let words = wonky_wire::v3::encode(&body).map_err(|e| format!("{e:?}"))?;
    let checked = wonky_wire::v3::decode(&words).map_err(|e| format!("{e:?}"))?;
    assert_eq!(wonky_wire::v3::encode(checked.body()).unwrap(), words, "canonical v3 round trip");
    audit(&checked).map_err(|e| e.0)
}

fn oracle_area(points: &[P2]) -> R {
    let mut twice = R::zero();
    for (k, a) in points.iter().enumerate() {
        let b = points[(k + 1) % points.len()];
        twice += exact(a.x).unwrap() * exact(b.y).unwrap() - exact(b.x).unwrap() * exact(a.y).unwrap();
    }
    twice / R::from_integer(2.into())
}

fn exp_value(e: &[f64]) -> R {
    e.iter().fold(R::zero(), |s, &x| s + exact(x).unwrap())
}

/// Exact 1000 * (origin + u x + v (z cross x) + w z) per coordinate.
fn oracle_image(f: &Affine, p: [f64; 3]) -> [R; 3] {
    let e = |x: f64| exact(x).unwrap();
    let (x, z) = (f.x.map(e), f.z.map(e));
    let y = [&z[1] * &x[2] - &z[2] * &x[1], &z[2] * &x[0] - &z[0] * &x[2], &z[0] * &x[1] - &z[1] * &x[0]];
    let s = R::from_integer(1000.into());
    [0, 1, 2].map(|k| (e(f.origin[k]) + e(p[0]) * &x[k] + e(p[1]) * &y[k] + e(p[2]) * &z[k]) * &s)
}

fn oracle_det(f: &Affine) -> R {
    let e = |x: f64| exact(x).unwrap();
    let (x, z) = (f.x.map(e), f.z.map(e));
    let dot = |a: &[R; 3], b: &[R; 3]| &a[0] * &b[0] + &a[1] * &b[1] + &a[2] * &b[2];
    dot(&x, &x) * dot(&z, &z) - dot(&x, &z) * dot(&x, &z)
}

/// The zone frame of zones.json (as scripts/acid/measure.py computes it).
fn zone_map(name: &str, p: [f64; 3]) -> [f64; 3] {
    match name {
        "V0" => p,
        "V1" => [p[0] + 65536.25, p[1] - 32768.5, p[2] + 16384.125],
        "V2" => [-p[1], -p[2], p[0]],
        _ => {
            let l = 14f64.sqrt();
            let a = [1.0 / l, 2.0 / l, 3.0 / l];
            let (c, s) = (0.1f64.cos(), 0.1f64.sin());
            let cross = [[0.0, -a[2], a[1]], [a[2], 0.0, -a[0]], [-a[1], a[0], 0.0]];
            let r: Vec<Vec<f64>> = (0..3)
                .map(|i| {
                    (0..3)
                        .map(|j| c * ((i == j) as u8 as f64) + (1.0 - c) * a[i] * a[j] + s * cross[i][j])
                        .collect()
                })
                .collect();
            let pivot = [3.0, -2.0, 5.0];
            let t: Vec<f64> = (0..3).map(|i| pivot[i] - (0..3).map(|j| r[i][j] * pivot[j]).sum::<f64>()).collect();
            [0, 1, 2].map(|i| (0..3).map(|j| r[i][j] * p[j]).sum::<f64>() + t[i])
        }
    }
}

// ------------------------------------------------------------------ AC01

/// AC01 closed form (zones.json): bbox per variant.
fn ac01_bbox(name: &str) -> ([f64; 3], [f64; 3]) {
    match name {
        "V0" => ([0.0, 0.0, 0.0], [16.0, 12.0, 8.0]),
        "V1" => ([65536.25, -32768.5, 16384.125], [65552.25, -32756.5, 16392.125]),
        "V2" => ([-12.0, -8.0, 0.0], [0.0, 0.0, 16.0]),
        _ => (
            [-1.368887394165612, -0.3230339977069725, -0.6132382243838287],
            [15.944332127383715, 12.153502806675444, 8.555042778584868],
        ),
    }
}

#[test]
fn ac01_in_the_four_interpreter_frames() {
    let mut source_volumes = Vec::new();
    for v in ac01() {
        let a = build(v.frame, &v.segments, v.depth, false).unwrap_or_else(|e| panic!("{}: {e}", v.name));
        assert!(a.bound_to_construction, "{}", v.name);
        assert_eq!(a.axis, 2);
        // E9: the prism's levels and cap are the interpreter's values bit for bit.
        assert_eq!(a.levels.map(f64::to_bits), [0f64.to_bits(), v.depth.to_bits()], "{}", v.name);
        assert_eq!(v.depth.to_bits(), (8.0f64 * 0.001).to_bits(), "{}: 8 * millimeter", v.name);
        let t = a.topology();
        assert_eq!((t.faces, t.edges, t.vertices, t.loops, t.genus, t.shells), (8, 18, 12, 8, 0, 1), "{}", v.name);
        // Exact source volume = exact shoelace area of the region times depth.
        let area = oracle_area(&a.cap);
        let v6 = a.volume6_source().unwrap();
        assert_eq!(exp_value(&v6), area.clone() * exact(v.depth).unwrap() * R::from_integer(6.into()), "{}", v.name);
        source_volumes.push(v6);
        // World volume: det(frame) * source volume, rounded twice (<= 2^-52 relative).
        let world = oracle_det(&v.frame) * area * exact(v.depth).unwrap() * R::from_integer(1_000_000_000.into());
        let got = a.volume_mm3().unwrap();
        assert!(((exact(got).unwrap() - &world) / &world).abs() <= exact(f64::EPSILON).unwrap(), "{}", v.name);
        assert!((got - 768.0).abs() <= 768.0 * 1e-9, "{}: {got}", v.name);
        let area_mm2: f64 = a.face_areas_mm2().unwrap().iter().sum();
        assert!((area_mm2 - 640.0).abs() <= 640.0 * 1e-9, "{}: {area_mm2}", v.name);
        // Every exported vertex is the correctly rounded exact image.
        let points: Vec<[f64; 3]> = a.body.vertices.iter().map(|x| [x.point[0].get(), x.point[1].get(), x.point[2].get()]).collect();
        for (q, w) in points.iter().zip(a.world_vertices_mm().unwrap()) {
            let image = oracle_image(&v.frame, *q);
            assert_eq!(w, [0, 1, 2].map(|k| nearest(&image[k])), "{}: vertex {q:?}", v.name);
        }
        let (lo, hi) = a.bbox_mm(None).unwrap();
        let (clo, chi) = ac01_bbox(v.name);
        for k in 0..3 {
            assert!(
                (lo[k] - clo[k]).abs() <= 1e-9 && (hi[k] - chi[k]).abs() <= 1e-9,
                "{}: bbox {lo:?} {hi:?}",
                v.name
            );
        }
        for (point, expected) in [([10.0, 10.0, 4.0], 6.0), ([20.0, 2.0, 4.0], 4.0)] {
            match a.distance_mm(zone_map(v.name, point)) {
                Probe::Measured { distance_mm, inside, bound_mm } => {
                    assert!(
                        !inside && (distance_mm - expected).abs() <= 1e-9 && bound_mm < 1e-9,
                        "{}: {distance_mm} {bound_mm}",
                        v.name
                    );
                    assert!(
                        (distance_mm - expected).abs() <= bound_mm.max(4.0 * f64::EPSILON * expected),
                        "{}: stated bound",
                        v.name
                    );
                }
                Probe::Refused(r) => panic!("{}: {r}", v.name),
            }
        }
        match a.distance_mm(zone_map(v.name, [2.0, 2.0, 4.0])) {
            Probe::Measured { distance_mm, inside, .. } => assert!(inside && distance_mm == 0.0, "{}", v.name),
            Probe::Refused(r) => panic!("{r}"),
        }
    }
    // Metamorphic: the same source construction in every variant.
    assert!(source_volumes.windows(2).all(|w| w[0] == w[1]));
}

#[test]
fn v1_export_rounding_stays_inside_the_exact_band() {
    // ulp(65536 mm) = 2^-36 mm: every V1 coordinate is within half of it of its
    // exact image, far inside the 1e-9 mm exact band (decision D4).
    let v = &ac01()[1];
    let a = build(v.frame, &v.segments, v.depth, false).unwrap();
    let tolerance = a.export_tolerance_mm().unwrap();
    assert!(tolerance <= 2.0 * 2f64.powi(-36) && tolerance > 0.0, "{tolerance}");
    let (lo, hi) = a.bbox_mm(None).unwrap();
    let (clo, chi) = ac01_bbox("V1");
    for k in 0..3 {
        assert!(
            (lo[k] - clo[k]).abs() <= 2f64.powi(-36) && (hi[k] - chi[k]).abs() <= 2f64.powi(-36),
            "{lo:?} {hi:?}"
        );
    }
    // No +-10,000 mm envelope on this path: a frame 10 km away builds and exports.
    let far = Affine {
        origin: [1.0e4, -2.5e3, 7.0e3],
        ..v.frame
    };
    let a = build(far, &v.segments, v.depth, false).unwrap();
    let text = step::write(&[("far".into(), &a)], "far").unwrap();
    assert!(text.contains("10000000.") || text.contains("1.0E7"), "coordinates in mm at 1e7");
}

#[test]
fn reverse_direction_and_step_structure() {
    let v = &ac01()[3];
    let a = build(v.frame, &v.segments, v.depth, true).unwrap();
    assert_eq!(a.levels, [-v.depth, 0.0]);
    assert!(a.volume_mm3().unwrap() > 0.0);
    let text = step::write(&[("ac01".into(), &a)], "ac01").unwrap();
    for (entity, count) in [
        ("ADVANCED_FACE(", 8),
        ("EDGE_CURVE(", 18),
        ("VERTEX_POINT(", 12),
        ("CLOSED_SHELL(", 1),
        ("MANIFOLD_SOLID_BREP(", 1),
    ] {
        assert_eq!(text.matches(entity).count(), count, "{entity}");
    }
    assert_eq!(step::real(16.0), "16.0");
    assert_eq!(step::real(-0.0), "0.0");
    assert_eq!(step::real(1e-7), "1.E-7");
    assert_eq!(step::real(65536.25), "65536.25");
    assert_eq!(step::real(1.5e300), "1.5E300");
}

// ------------------------------------------------------------------ generality

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// An x-monotone simple polygon (generally concave): distinct increasing xs,
/// the lower chain strictly below the upper chain. Simple by construction.
fn monotone(rng: &mut Rng, scale: impl Fn(i64) -> f64) -> Vec<[f64; 2]> {
    let n = 3 + rng.below(9) as usize;
    let mut xs: Vec<i64> = Vec::new();
    while xs.len() < n + 1 {
        let x = rng.below(200) as i64 - 100;
        if !xs.contains(&x) {
            xs.push(x);
        }
    }
    xs.sort();
    let mut lower = vec![[scale(xs[0]), scale(0)]];
    for &x in &xs[1..n] {
        lower.push([scale(x), scale(-1 - rng.below(50) as i64)]);
    }
    lower.push([scale(xs[n]), scale(0)]);
    for &x in xs[1..n].iter().rev() {
        lower.push([scale(x), scale(1 + rng.below(50) as i64)]);
    }
    lower
}

/// An orthogonal skyline (generally concave, axis-parallel edges only): columns
/// [i, i+1] of heights h_i >= 1 with neighbours different. Simple by construction.
fn skyline(rng: &mut Rng, scale: impl Fn(i64) -> f64) -> Vec<[f64; 2]> {
    let m = 1 + rng.below(8) as i64;
    let mut h: Vec<i64> = Vec::new();
    while (h.len() as i64) < m {
        let v = 1 + rng.below(20) as i64;
        if h.last() != Some(&v) {
            h.push(v);
        }
    }
    let mut p = vec![[scale(0), scale(0)], [scale(m), scale(0)]];
    for i in (0..m).rev() {
        p.push([scale(i + 1), scale(h[i as usize])]);
        p.push([scale(i), scale(h[i as usize])]);
    }
    p
}

fn segments_of(points: &[[f64; 2]], rng: &mut Rng) -> Vec<[f64; 4]> {
    let mut s: Vec<[f64; 4]> = (0..points.len())
        .map(|k| {
            let (a, b) = (points[k], points[(k + 1) % points.len()]);
            if rng.below(2) == 0 {
                [a[0], a[1], b[0], b[1]]
            } else {
                [b[0], b[1], a[0], a[1]]
            }
        })
        .collect();
    for i in (1..s.len()).rev() {
        s.swap(i, rng.below(i as u64 + 1) as usize);
    }
    s
}

#[test]
fn property_random_simple_polygons_and_depths() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let v3 = &ac01()[3];
    let (mut built, mut refused) = (0, 0);
    for case in 0..400 {
        let kind = case % 4;
        let points = match kind {
            0 => monotone(&mut rng, |k| k as f64),
            1 => monotone(&mut rng, |k| k as f64 / 64.0),
            2 => skyline(&mut rng, |k| k as f64 * 0.001),
            _ => monotone(&mut rng, |k| k as f64 * 0.001),
        };
        let depth = match rng.below(3) {
            0 => (1 + rng.below(40)) as f64,
            1 => (1 + rng.below(40)) as f64 / 128.0,
            _ => (1 + rng.below(40)) as f64 * 0.001,
        };
        let frame = if case % 2 == 0 { Affine::IDENTITY } else { v3.frame };
        let segments = segments_of(&points, &mut rng);
        let loops = region(&segments);
        assert_eq!(loops.len(), 1, "case {case}");
        let n = points.len();
        assert_eq!(loops[0].points.len(), n);
        // The region is the input polygon, counterclockwise, from exact incidence only.
        let area = oracle_area(&loops[0].points);
        assert!(area > R::zero());
        let input: Vec<P2> = points.iter().map(|q| p2(q[0], q[1])).collect();
        assert_eq!(area.clone().abs(), oracle_area(&input).abs(), "case {case}");
        match build(frame, &segments, depth, rng.below(2) == 0) {
            Ok(a) => {
                built += 1;
                let t = a.topology();
                assert_eq!((t.faces, t.edges, t.vertices, t.genus), (n + 2, 3 * n, 2 * n, 0), "case {case}");
                assert!(a.bound_to_construction);
                let v6 = exp_value(&a.volume6_source().unwrap());
                assert_eq!(v6, area * exact(depth).unwrap() * R::from_integer(6.into()), "case {case}");
            }
            Err(e) => {
                // Only sloped edges between inexact mm-scaled values may refuse, by name.
                assert!(kind == 3 && e.contains("LateralNormalNotExact"), "case {case}: {e}");
                refused += 1;
            }
        }
    }
    eprintln!("property: {built} built, {refused} refused by name (LateralNormalNotExact)");
    assert!(built >= 300 && refused < 100, "built {built}, refused {refused}");
}

#[test]
fn open_touching_crossing_and_nested_sketches_refuse_by_name() {
    let sq = |x0: f64, y0: f64, s: f64| {
        vec![
            [x0, y0, x0 + s, y0],
            [x0 + s, y0, x0 + s, y0 + s],
            [x0 + s, y0 + s, x0, y0 + s],
            [x0, y0 + s, x0, y0],
        ]
    };
    let segs = |s: &[[f64; 4]]| s.iter().map(|s| [p2(s[0], s[1]), p2(s[2], s[3])]).collect::<Vec<_>>();
    // Open polyline: no region, one open wire (the consumer decides).
    let open = lines_region(&segs(&sq(0.0, 0.0, 1.0)[..3])).unwrap();
    assert!(open.loops.is_empty() && open.open_wires == 1);
    // AC45: a 2^-30 mm gap in the interpreter's metre values stays open; bit-equal closes.
    let gap = 0.000000000931322574615478515625f64 * 0.001;
    let mut ac45 = vec![
        [0.0, 0.0, 0.016, 0.0],
        [0.016, 0.0, 0.016, 0.008],
        [0.016, 0.008, 0.0, 0.008],
        [0.0, 0.008, 0.0, gap],
    ];
    assert!(gap > 0.0 && lines_region(&segs(&ac45)).unwrap().loops.is_empty());
    ac45[3][3] = 0.0;
    assert_eq!(lines_region(&segs(&ac45)).unwrap().loops.len(), 1);
    // Self-touching at a vertex (figure eight): branching.
    let eight = [
        [0.0, 0.0, 8.0, 0.0],
        [8.0, 0.0, 8.0, 8.0],
        [8.0, 8.0, 16.0, 8.0],
        [16.0, 8.0, 16.0, 16.0],
        [16.0, 16.0, 8.0, 16.0],
        [8.0, 16.0, 8.0, 8.0],
        [8.0, 8.0, 0.0, 8.0],
        [0.0, 8.0, 0.0, 0.0],
    ];
    assert_eq!(lines_region(&segs(&eight)).unwrap_err(), SketchRefusal::Branching);
    // Self-touching without a shared vertex (a vertex on another edge) and a crossing.
    let t_junction = [
        [0.0, 0.0, 4.0, 0.0],
        [4.0, 0.0, 4.0, 4.0],
        [4.0, 4.0, 2.0, 0.0],
        [2.0, 0.0, 0.0, 4.0],
        [0.0, 4.0, 0.0, 0.0],
    ];
    assert_eq!(lines_region(&segs(&t_junction)).unwrap_err(), SketchRefusal::UnsupportedIntersection);
    let bowtie = [[0.0, 0.0, 2.0, 2.0], [2.0, 2.0, 2.0, 0.0], [2.0, 0.0, 0.0, 2.0], [0.0, 2.0, 0.0, 0.0]];
    assert_eq!(lines_region(&segs(&bowtie)).unwrap_err(), SketchRefusal::UnsupportedIntersection);
    let overlap = [[0.0, 0.0, 2.0, 0.0], [1.0, 0.0, 3.0, 0.0], [3.0, 0.0, 0.0, 1.0], [0.0, 1.0, 0.0, 0.0]];
    assert_eq!(lines_region(&segs(&overlap)).unwrap_err(), SketchRefusal::UnsupportedIntersection);
    let fold = [[0.0, 0.0, 2.0, 0.0], [2.0, 0.0, 1.0, 0.0], [1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 0.0, 0.0]];
    assert!(lines_region(&segs(&fold)).is_err());
    assert_eq!(lines_region(&segs(&[[1.0, 1.0, 1.0, 1.0]])).unwrap_err(), SketchRefusal::Degenerate);
    let mut nested = sq(0.0, 0.0, 10.0);
    nested.extend(sq(2.0, 2.0, 1.0));
    assert_eq!(lines_region(&segs(&nested)).unwrap_err(), SketchRefusal::Nested);
    let mut apart = sq(0.0, 0.0, 1.0);
    apart.extend(sq(5.0, 0.0, 2.0));
    let two = lines_region(&segs(&apart)).unwrap();
    assert_eq!(two.loops.len(), 2);
    // A sloped edge between inexact mm-scaled values has no exact carrier: named refusal.
    let tri = [[0.001, 0.001, 0.011, 0.013], [0.011, 0.013, 0.001, 0.013], [0.001, 0.013, 0.001, 0.001]];
    let loops = region(&tri);
    let r = blind_prism(&Prism {
        key: key(),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &tri,
        region: &loops[0],
        depth: 0.004,
        reverse: false,
    });
    assert!(matches!(r, Err(Refusal::LateralNormalNotExact { .. })), "{r:?}");
    let r = blind_prism(&Prism {
        key: key(),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &tri,
        region: &loops[0],
        depth: 0.0,
        reverse: false,
    });
    assert_eq!(r.unwrap_err(), Refusal::Depth);
}

// ------------------------------------------------------------------ audit negatives

fn ac01_body(variant: usize) -> Body {
    let v = &ac01()[variant];
    let loops = region(&v.segments);
    blind_prism(&Prism {
        key: key(),
        source: [0; 4],
        frame: v.frame,
        segments: &v.segments,
        region: &loops[0],
        depth: v.depth,
        reverse: false,
    })
    .unwrap()
}

fn audit_body(body: Body) -> Result<Audited, String> {
    let checked = body.check().map_err(|e| format!("contract {e:?}"))?;
    audit(&checked).map_err(|e| e.0)
}

#[test]
fn audit_refuses_planted_defects() {
    assert!(audit_body(ac01_body(3)).is_ok());
    // One lateral face reversed (loop order and coedge senses flipped).
    let mut b = ac01_body(3);
    let lp = b.faces[2].loops[0].0 as usize;
    b.loops[lp].coedges.reverse();
    for c in b.loops[lp].coedges.clone() {
        b.coedges[c.0 as usize].forward = !b.coedges[c.0 as usize].forward;
    }
    assert!(audit_body(b).is_err());
    // A top vertex one ulp above the depth (with its edges' curves following).
    let mut b = ac01_body(1);
    let top = b.vertices.len() - 1;
    let z = b.vertices[top].point[2].get().next_up();
    b.vertices[top].point[2] = Binary64::new(z).unwrap();
    for c in &mut b.curves {
        if let CurveGeometry::Line { a, b: e } = &mut c.geometry {
            for p in [a, e] {
                if p[2].get() == z.next_down() && p[0] == b_point(&b.vertices[top]).0 && p[1] == b_point(&b.vertices[top]).1 {
                    p[2] = Binary64::new(z).unwrap();
                }
            }
        }
    }
    assert!(audit_body(b).is_err());
    // Everything consistently inside out: an inward shell.
    let mut b = ac01_body(0);
    for f in &mut b.faces {
        f.forward = false;
    }
    for lp in b.loops.clone().iter().enumerate() {
        b.loops[lp.0].coedges.reverse();
    }
    for c in &mut b.coedges {
        c.forward = !c.forward;
    }
    assert_eq!(audit_body(b).unwrap_err(), "audit/inward-or-empty-shell");
    // Extrude parameters not matching the geometry (E9 binding).
    let mut b = ac01_body(0);
    let depth = b.constructions[4].parameters[1].get().next_up();
    b.constructions[4].parameters[1] = Binary64::new(depth).unwrap();
    assert_eq!(audit_body(b).unwrap_err(), "audit/vertex-not-construction-value");
    // A missing side face: open shell.
    let mut b = ac01_body(0);
    b.shells[0].faces.pop();
    assert!(audit_body(b).is_err());
}

fn b_point(v: &Vertex) -> (Binary64, Binary64) {
    (v.point[0], v.point[1])
}

// ------------------------------------------------------------------ Frame::Interpreter contract

#[test]
fn interpreter_frame_contract() {
    let body = ac01_body(3);
    let words = wonky_wire::v3::encode(&body).unwrap();
    let back = wonky_wire::v3::decode(&words).unwrap();
    // Lossless: the skew frame's (not exactly orthonormal) bits survive as given.
    assert_eq!(back.body().frames, body.frames);
    let Frame::Interpreter { x, z, .. } = &back.body().frames[1] else { panic!() };
    let v3 = &ac01()[3];
    assert_eq!([x[0].bits(), x[1].bits(), x[2].bits()], v3.frame.x.map(f64::to_bits));
    assert_eq!([z[0].bits(), z[1].bits(), z[2].bits()], v3.frame.z.map(f64::to_bits));
    let json = wonky_wire::v3::to_json(back.body()).unwrap();
    assert!(json.contains("\"kind\":\"Interpreter\",\"parent\":0"));
    // Parent must be a Source frame.
    let mut b = body.clone();
    b.frames.push(Frame::Interpreter {
        parent: FrameId(1),
        origin: [Binary64::new(0.0).unwrap(); 3],
        x: [Binary64::new(1.0).unwrap(), Binary64::new(0.0).unwrap(), Binary64::new(0.0).unwrap()],
        z: [Binary64::new(0.0).unwrap(), Binary64::new(0.0).unwrap(), Binary64::new(1.0).unwrap()],
    });
    assert_eq!(b.check().unwrap_err(), ContractError::Invalid("interpreter frame parent is not a source frame"));
    // Parallel axes refuse; a forward reference refuses.
    let mut b = body.clone();
    if let Frame::Interpreter { z, x, .. } = &mut b.frames[1] {
        *z = *x;
    }
    assert_eq!(b.check().unwrap_err(), ContractError::Invalid("interpreter frame axes parallel"));
    let mut b = body.clone();
    if let Frame::Interpreter { parent, .. } = &mut b.frames[1] {
        *parent = FrameId(1);
    }
    assert!(b.check().is_err());
    // Source rules (Interpreter, LineThrough) cannot live in an Interpreter frame.
    let mut b = body.clone();
    b.constructions[0].frame = FrameId(1);
    assert_eq!(b.check().unwrap_err(), ContractError::Invalid("interpreter not in source frame"));
    let mut b = body.clone();
    b.constructions.push(Construction {
        operation: Operation::LineThrough {},
        rule_version: 1,
        parents: vec![NodeId(0)],
        parameters: vec![],
        frame: FrameId(1),
    });
    assert_eq!(b.check().unwrap_err(), ContractError::Invalid("source rule input"));
    // A fact across frames is unproved (a curve in the Interpreter frame vs a
    // surface moved to the Source frame).
    let mut b = body.clone();
    b.facts.push(Fact::CurveOnSurface {
        claim: ContainedClaim {
            body: key(),
            curve: CurveId(0),
            surface: SurfaceId(0),
            rule: 1,
        },
    });
    assert!(b.check().is_err());
}

// ------------------------------------------------------------------ host op codec

fn request(op: u32) -> Vec<u32> {
    vec![MAGIC, VERSION, op]
}
fn push_f64(w: &mut Vec<u32>, x: f64) {
    w.push(x.to_bits() as u32);
    w.push((x.to_bits() >> 32) as u32);
}
fn text(reply: &[u32]) -> String {
    reply[1..].iter().map(|&c| char::from_u32(c).unwrap()).collect()
}

#[test]
fn host_op_requests() {
    let v = &ac01()[3];
    let mut r = request(OP_REGION);
    r.push(v.segments.len() as u32);
    for s in &v.segments {
        for &x in s {
            push_f64(&mut r, x);
        }
    }
    let reply = host_op(&r);
    assert_eq!(reply[0], STATUS_OK);
    assert!(text(&reply).starts_with("{\"loops\":[{\"uses\":[[0,true]"), "{}", text(&reply));
    let mut p = request(OP_PRISM);
    p.extend([1, 2, 3, 4, 0, 0, 0, 0, 0]);
    for x in v.frame.origin.iter().chain(&v.frame.x).chain(&v.frame.z) {
        push_f64(&mut p, *x);
    }
    push_f64(&mut p, v.depth);
    p.extend([0, 0, v.segments.len() as u32]);
    for s in &v.segments {
        for &x in s {
            push_f64(&mut p, x);
        }
    }
    let reply = host_op(&p);
    assert_eq!(reply[0], STATUS_OK);
    let words = reply[1..].to_vec();
    let mut m = request(OP_MEASURE);
    m.push(words.len() as u32);
    m.extend(&words);
    m.push(0);
    m.push(1);
    for x in zone_map("V3", [20.0, 2.0, 4.0]) {
        push_f64(&mut m, x);
    }
    let reply = host_op(&m);
    assert_eq!(reply[0], STATUS_OK, "{}", text(&reply));
    let json = text(&reply);
    assert!(
        json.contains("\"basis\":\"native-f64-construction\"") && json.contains("\"faces\":8,\"edges\":18,\"vertices\":12"),
        "{json}"
    );
    let mut s = request(OP_STEP);
    s.push(1);
    s.push('x' as u32);
    s.push(1);
    s.push(1);
    s.push('b' as u32);
    s.push(words.len() as u32);
    s.extend(&words);
    let reply = host_op(&s);
    assert_eq!(reply[0], STATUS_OK);
    assert!(text(&reply).starts_with("ISO-10303-21;"));
    // Malformed: magic, truncation, trailing words, non-finite, unknown op, region index.
    assert_eq!(host_op(&[0, VERSION, OP_REGION])[0], STATUS_MALFORMED);
    assert_eq!(host_op(&[MAGIC, VERSION + 1, OP_REGION])[0], STATUS_MALFORMED);
    assert_eq!(host_op(&r[..r.len() - 1])[0], STATUS_MALFORMED);
    let mut t = r.clone();
    t.push(0);
    assert_eq!(host_op(&t)[0], STATUS_MALFORMED);
    let mut nan = request(OP_REGION);
    nan.push(1);
    for x in [f64::NAN, 0.0, 1.0, 0.0] {
        push_f64(&mut nan, x);
    }
    assert_eq!(host_op(&nan)[0], STATUS_MALFORMED);
    assert_eq!(host_op(&request(99))[0], STATUS_MALFORMED);
    let mut bad = p.clone();
    bad[3 + 9 + 18 + 2 + 1] = 5;
    assert_eq!(host_op(&bad)[0], STATUS_MALFORMED);
    // A geometric capability gap is a named refusal, not a fault.
    let mut cross = request(OP_REGION);
    cross.push(4);
    for x in [0.0, 0.0, 2.0, 2.0, 2.0, 2.0, 2.0, 0.0, 2.0, 0.0, 0.0, 2.0, 0.0, 2.0, 0.0, 0.0] {
        push_f64(&mut cross, x);
    }
    let reply = host_op(&cross);
    assert_eq!(reply[0], STATUS_REFUSED);
    assert!(text(&reply).starts_with("sketch/intersection"));
    // Garbage body words refuse as malformed, never panic.
    let mut g = request(OP_MEASURE);
    g.extend([2, 1, 2, 0, 0]);
    assert_eq!(host_op(&g)[0], STATUS_MALFORMED);
}

#[test]
fn host_prism_replays_nonrepresentable_side_carriers() {
    // Two disjoint regions: only the selected triangle may be extruded. Its
    // sloped side has a non-binary64 coordinate difference, not a gap or fit.
    let segments = [
        [0.04, 0.04, 0.05, 0.04], [0.05, 0.04, 0.05, 0.05],
        [0.05, 0.05, 0.04, 0.05], [0.04, 0.05, 0.04, 0.04],
        [0.001, 0.001, 0.011, 0.013], [0.011, 0.013, 0.001, 0.013],
        [0.001, 0.013, 0.001, 0.001],
    ];
    let loops = region(&segments);
    let index = loops.iter().position(|r| r.points.len() == 3).unwrap();
    let source = [4, 3, 2, 1];
    let mut req = request(OP_PRISM);
    req.extend([1, 2, 3, 4, 7]);
    req.extend(source);
    for x in [0., 0., 0., 1., 0., 0., 0., 0., 1.] { push_f64(&mut req, x); }
    push_f64(&mut req, 0.004);
    req.extend([1, index as u32, segments.len() as u32]);
    for x in segments.iter().flatten() { push_f64(&mut req, *x); }
    let reply = host_op(&req);
    assert_eq!(reply[0], STATUS_OK, "{}", text(&reply));
    let checked = wonky_wire::v3::decode(&reply[1..]).unwrap();
    let a = audit(&checked).unwrap();
    assert_eq!(a.body.key.revision, 7);
    assert!(matches!(a.body.frames[0], Frame::Source { source: s } if s == source));
    assert_eq!((a.topology().faces, a.topology().edges, a.topology().vertices), (5, 9, 6));
    let expected = oracle_area(&loops[index].points) * exact(0.004).unwrap() * R::from_integer(1_000_000_000.into());
    let measured = exact(a.volume_mm3().unwrap()).unwrap();
    assert!((&measured - &expected).abs() <= expected * exact(2. * f64::EPSILON).unwrap());
    assert!(matches!(a.distance_mm([2., 12., -2.]), Probe::Measured { inside: true, .. }));
    assert!(matches!(a.distance_mm([10., 2., -2.]), Probe::Measured { inside: false, .. }));
    let exported = step::write(&[("triangle".into(), &a)], "triangle").unwrap();
    assert_eq!(exported.matches("ADVANCED_FACE(").count(), 5);
    assert!(!exported.contains("CYLINDRICAL_SURFACE("));
    // The exact source line, not a rounded cached side normal, decides plane
    // coincidence. A forged cache also fails reconstruction after wire decode.
    let side = a.body.surfaces.iter().enumerate().skip(2).find_map(|(k, s)| {
        if let SurfaceGeometry::Plane { origin, normal, .. } = &s.geometry {
            (normal[0].get() != 0. && normal[1].get() != 0.)
                .then_some((k, origin.map(|x| x.get()), normal.map(|x| x.get())))
        } else { None }
    }).unwrap();
    let selected = [wonky_ops::query::Entity { kind: wonky_ops::query::FACE, index: side.0 as u32 }];
    let coincidence = wonky_ops::query::coincides(&wonky_ops::analytic::Solid::Planar(a.clone()), &selected, side.1, side.2);
    assert_eq!(coincidence.unwrap_err().0, "planar-boolean/query-near-parallel-unproved");
    let mut corrupt = a.body;
    if let SurfaceGeometry::Plane { origin, .. } = &mut corrupt.surfaces[side.0].geometry {
        origin[0] = Binary64::new(origin[0].get().next_up()).unwrap();
    }
    assert!(audit(&corrupt.check().unwrap()).is_err());
}

// ------------------------------------------------------------------ frame numerics

fn oracle_inverse(f: &Affine, q: [f64; 3]) -> [R; 3] {
    let e = |x: f64| exact(x).unwrap();
    let (x, z) = (f.x.map(e), f.z.map(e));
    let y = [&z[1] * &x[2] - &z[2] * &x[1], &z[2] * &x[0] - &z[0] * &x[2], &z[0] * &x[1] - &z[1] * &x[0]];
    let d: [R; 3] = [0, 1, 2].map(|k| e(q[k]) - e(f.origin[k]));
    let det3 = |a: &[R; 3], b: &[R; 3], c: &[R; 3]| {
        &a[0] * (&b[1] * &c[2] - &b[2] * &c[1]) - &a[1] * (&b[0] * &c[2] - &b[2] * &c[0]) + &a[2] * (&b[0] * &c[1] - &b[1] * &c[0])
    };
    // Columns x, y, z; Cramer's rule on [x y z] s = d (det3 takes rows = columns here).
    let m = det3(&x, &y, &z);
    [det3(&d, &y, &z) / &m, det3(&x, &d, &z) / &m, det3(&x, &y, &d) / &m]
}

#[test]
fn frame_inverse_and_defect_bounds() {
    let v3 = ac01()[3].frame;
    // The skew frame's axes are not exactly orthonormal in binary64; the stated
    // defect is small but covers it; an exactly orthonormal frame has only the pad.
    let d3 = v3.orthonormality_defect().unwrap();
    assert!(d3 > 4.0 * f64::EPSILON && d3 < 1e-14, "{d3}");
    assert_eq!(Affine::IDENTITY.orthonormality_defect().unwrap(), 4.0 * f64::EPSILON);
    let scaled = Affine {
        origin: [0.0; 3],
        x: [2.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0],
    };
    assert_eq!(scaled.orthonormality_defect().unwrap(), 3.0 + 4.0 * f64::EPSILON);
    // Inverse: the stated bound covers the exact solution (oracle), for the skew
    // frame and for a scaled one (det 4) where the division by det matters.
    let mut rng = Rng(7);
    for f in [
        v3,
        scaled,
        Affine {
            origin: [0.25, -0.5, 1.0],
            x: [0.0, 2.0, 0.0],
            z: [4.0, 0.0, 0.0],
        },
    ] {
        for _ in 0..50 {
            let q = [0, 1, 2].map(|_| (rng.below(20001) as f64 - 10000.0) * 1e-6);
            let (s, bound) = f.inverse_approx(q).unwrap();
            let exact_s = oracle_inverse(&f, q);
            for k in 0..3 {
                let err = (exact(s[k]).unwrap() - &exact_s[k]).abs();
                assert!(err <= exact(bound).unwrap(), "{f:?} {q:?} {k}: {} > {bound}", err.to_f64().unwrap());
            }
            assert!(bound > 0.0 && bound < 1e-12);
        }
    }
    // Degenerate or tiny frames are refused, not inverted: det <= 1/2.
    assert!(Affine {
        origin: [0.0; 3],
        x: [0.5, 0.5, 0.0],
        z: [0.0, 0.0, 1.0]
    }
    .inverse_approx([0.0; 3])
    .is_err());
    assert!(Affine {
        origin: [0.0; 3],
        x: [0.5, 0.0, 0.0],
        z: [0.0, 0.0, 0.5]
    }
    .inverse_approx([0.0; 3])
    .is_err());
    assert!(scaled.inverse_approx([f64::MAX, 0.0, 0.0]).is_err(), "non-finite solution");
    // A probe in a frame far from orthonormal refuses by name.
    let v = &ac01()[0];
    let a = build(scaled, &v.segments, v.depth, false).unwrap();
    assert_eq!(a.distance_mm([20.0, 2.0, 4.0]), Probe::Refused("observe/frame-not-near-orthonormal".into()));
}

// ------------------------------------------------------------------ measurements

#[test]
fn ac01_measurements_against_closed_forms() {
    for (index, shift) in [(0usize, [0.0, 0.0, 0.0]), (1, [65536.25, -32768.5, 16384.125])] {
        let v = &ac01()[index];
        let a = build(v.frame, &v.segments, v.depth, false).unwrap();
        // Centroid of the L: (6, 4, 4) in the zone frame.
        let c = a.centroid_mm().unwrap();
        for k in 0..3 {
            assert!((c[k] - ([6.0, 4.0, 4.0][k] + shift[k])).abs() <= 1e-9, "{}: centroid {c:?}", v.name);
        }
        // Faces: bottom, top, then the sides over the edges of the CCW region.
        let areas = a.face_areas_mm2().unwrap();
        let perimeters = a.face_perimeters_mm().unwrap();
        assert_eq!(areas.len(), 8);
        let lengths: Vec<f64> = (0..6)
            .map(|k| {
                let (p, q) = (a.cap[k], a.cap[(k + 1) % 6]);
                ((q.x - p.x).abs() + (q.y - p.y).abs()) * 1000.0
            })
            .collect();
        for (k, (area, perimeter)) in areas.iter().zip(&perimeters).enumerate() {
            let (ea, ep) = if k < 2 {
                (96.0, 56.0)
            } else {
                (lengths[k - 2] * 8.0, 2.0 * (lengths[k - 2] + 8.0))
            };
            assert!(
                (area - ea).abs() <= 1e-9 * ea && (perimeter - ep).abs() <= 1e-9 * ep,
                "{}: face {k}: {area} {perimeter}",
                v.name
            );
        }
        let (lo, hi) = a
            .bbox_mm(Some([[1.0, 0.0, 0.0, -shift[0]], [0.0, 1.0, 0.0, -shift[1]], [0.0, 0.0, 1.0, -shift[2]]]))
            .unwrap();
        for k in 0..3 {
            assert!(
                lo[k].abs() <= 1e-9 && (hi[k] - [16.0, 12.0, 8.0][k]).abs() <= 1e-9,
                "{}: mapped {lo:?} {hi:?}",
                v.name
            );
        }
        // Probes above the top cap, beyond an edge and a cap, on a face.
        let at = |p: [f64; 3]| a.distance_mm([p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]]);
        for (p, d) in [
            ([2.0, 2.0, 12.0], 4.0),
            ([2.0, 2.0, -3.0], 3.0),
            ([20.0, 2.0, 12.0], 32f64.sqrt()),
            ([10.0, 10.0, 11.0], 3f64.hypot(6.0).hypot(0.0).min(45f64.sqrt())),
        ] {
            match at(p) {
                Probe::Measured { distance_mm, inside, .. } => assert!(!inside && (distance_mm - d).abs() <= 1e-9, "{}: {p:?} {distance_mm} vs {d}", v.name),
                Probe::Refused(r) => panic!("{r}"),
            }
        }
        for p in [[16.0, 2.0, 4.0], [2.0, 2.0, 8.0], [4.0, 8.0, 0.0]] {
            assert_eq!(at(p), Probe::Refused("observe/probe-within-mapping-budget".into()), "{}: {p:?}", v.name);
        }
        match at([1.0, 11.0, 7.5]) {
            Probe::Measured { distance_mm, inside, .. } => assert!(inside && distance_mm == 0.0),
            Probe::Refused(r) => panic!("{r}"),
        }
    }
    let v = &ac01()[0];
    let a = build(v.frame, &v.segments, v.depth, false).unwrap();
    assert_eq!(a.export_tolerance_mm().unwrap(), 2.0 * (16f64.next_up() - 16.0));
}

fn refusal(edit: impl Fn(&mut Body)) -> String {
    let mut b = ac01_body(3);
    edit(&mut b);
    match b.check() {
        Err(e) => format!("contract {e:?}"),
        Ok(checked) => match audit(&checked) {
            Ok(_) => "accepted".into(),
            Err(e) => e.0,
        },
    }
}

#[test]
fn audit_refuses_each_structural_defect_by_name() {
    let b0 = ac01_body(3);
    let side_loop = b0.faces[2].loops[0].0 as usize;
    let cases: Vec<(&str, Box<dyn Fn(&mut Body)>)> = vec![
        (
            "audit/one-solid-one-shell-required",
            Box::new(|b: &mut Body| b.solids.push(Solid { shells: vec![ShellId(0)] })),
        ),
        (
            "audit/one-solid-one-shell-required",
            Box::new(|b: &mut Body| {
                b.shells.push(b.shells[0].clone());
            }),
        ),
        (
            "audit/one-solid-one-shell-required",
            Box::new(|b: &mut Body| b.solids[0].shells.push(ShellId(0))),
        ),
        // Only entities outside the topology can sit in another frame (the
        // contract ties edge vertices, curves and supports to one frame).
        (
            "audit/mixed-frames",
            Box::new(|b: &mut Body| {
                let mut v = b.vertices[3].clone();
                v.frame = FrameId(0);
                v.provenance = Provenance::None {};
                b.vertices.push(v);
            }),
        ),
        (
            "audit/mixed-frames",
            Box::new(|b: &mut Body| {
                let mut c = b.curves[0].clone();
                c.frame = FrameId(0);
                c.provenance = Provenance::None {};
                c.supports.clear();
                b.curves.push(c);
            }),
        ),
        (
            "audit/mixed-frames",
            Box::new(|b: &mut Body| {
                let mut x = b.surfaces[0].clone();
                x.frame = FrameId(0);
                x.provenance = Provenance::None {};
                b.surfaces.push(x);
            }),
        ),
        (
            "audit/face-repeated",
            Box::new(|b: &mut Body| {
                let f = b.shells[0].faces[0];
                b.shells[0].faces.push(f);
            }),
        ),
        ("audit/face-loops", Box::new(|b: &mut Body| b.loops[0].outer = false)),
        (
            "audit/face-loops",
            Box::new(|b: &mut Body| {
                let l = b.faces[0].loops[0];
                b.faces[0].loops.push(l);
            }),
        ),
        ("audit/loop-too-short", Box::new(move |b: &mut Body| b.loops[side_loop].coedges.truncate(2))),
        ("audit/loop-gap", Box::new(move |b: &mut Body| b.loops[side_loop].coedges.swap(0, 1))),
        (
            "audit/edge-domain",
            Box::new(|b: &mut Body| {
                b.edges[0].domain.upper = Limit::Finite {
                    value: Binary64::new(0.5).unwrap(),
                    closed: true,
                }
            }),
        ),
        (
            "audit/edge-curve-binding",
            Box::new(|b: &mut Body| {
                if let CurveGeometry::Line { a, .. } = &mut b.curves[0].geometry {
                    a[2] = Binary64::new(1.0).unwrap();
                }
            }),
        ),
        (
            "audit/edge-curve-binding",
            Box::new(|b: &mut Body| {
                if let CurveGeometry::Line { b: e, .. } = &mut b.curves[0].geometry {
                    e[0] = Binary64::new(1.0).unwrap();
                }
            }),
        ),
        (
            "audit/vertex-off-carrier",
            Box::new(|b: &mut Body| {
                if let SurfaceGeometry::Plane { origin, .. } = &mut b.surfaces[1].geometry {
                    origin[2] = Binary64::new(origin[2].get().next_up()).unwrap();
                }
            }),
        ),
        ("audit/loop-orientation", Box::new(|b: &mut Body| b.faces[1].forward = false)),
        ("audit/loop-gap", Box::new(|b: &mut Body| b.coedges[0].forward = !b.coedges[0].forward)),
        (
            "audit/edge-usage",
            Box::new(|b: &mut Body| {
                let e = b.edges[0].clone();
                b.edges.push(e);
            }),
        ),
        (
            "audit/dangling-vertex",
            Box::new(|b: &mut Body| {
                let v = b.vertices[0].clone();
                b.vertices.push(v);
            }),
        ),
        (
            "audit/embedding-uncertified",
            Box::new(|b: &mut Body| {
                // Move the whole top ring up by one level on one vertex only: not two levels.
                let n = b.vertices.len() / 2;
                let z = Binary64::new(b.vertices[n].point[2].get() * 2.0).unwrap();
                b.vertices[n].point[2] = z;
                for c in &mut b.curves {
                    if let CurveGeometry::Line { a, b: e } = &mut c.geometry {
                        for p in [a, e] {
                            if p[0] == b.vertices[n].point[0] && p[1] == b.vertices[n].point[1] && p[2].get() == z.get() / 2.0 {
                                p[2] = z;
                            }
                        }
                    }
                }
                for s in &mut b.surfaces {
                    if let SurfaceGeometry::Plane { origin, .. } = &mut s.geometry {
                        if origin[2].get() == z.get() / 2.0 && origin[0].get() == 0.0 {
                            origin[2] = z;
                        }
                    }
                }
            }),
        ),
    ];
    for (expected, edit) in &cases {
        let got = refusal(edit);
        assert!(
            got == *expected || (got.starts_with("audit/") && expected == &"audit/embedding-uncertified"),
            "{expected}: got {got}"
        );
        assert_ne!(got, "accepted", "{expected}");
    }
    // A frame kind the audit does not place (Rigid) and a curved carrier refuse.
    let mut b = ac01_body(0);
    b.frames[1] = Frame::Rigid {
        parent: FrameId(0),
        translation: [Binary64::new(0.0).unwrap(); 3],
        axis: [Binary64::new(0.0).unwrap(), Binary64::new(0.0).unwrap(), Binary64::new(1.0).unwrap()],
        angle: Binary64::new(0.0).unwrap(),
    };
    assert_eq!(audit_body(b).unwrap_err(), "audit/rigid-frame-unsupported");
    // A body without Sketch/Extrude lineage audits but is not construction-bound.
    let mut b = ac01_body(0);
    for v in &mut b.vertices {
        v.provenance = Provenance::None {};
    }
    assert!(!audit_body(b).unwrap().bound_to_construction);
    // Lineage whose Sketch node is missing refuses.
    let mut b = ac01_body(0);
    b.constructions[4].parents = vec![NodeId(2), NodeId(3)];
    assert_eq!(audit_body(b).unwrap_err(), "audit/construction-lineage");
    let mut b = ac01_body(0);
    b.constructions[3].parameters.pop();
    assert_eq!(audit_body(b).unwrap_err(), "audit/construction-parameters");
    let mut b = ac01_body(0);
    b.vertices[5].provenance = Provenance::Construction { node: NodeId(3) };
    assert_eq!(audit_body(b).unwrap_err(), "audit/construction-lineage");
    let mut b = ac01_body(0);
    let x = b.constructions[3].parameters[2].get();
    b.constructions[3].parameters[2] = Binary64::new(x.next_up()).unwrap();
    assert_eq!(audit_body(b).unwrap_err(), "audit/vertex-not-construction-value");
}

/// Every coedge's pcurve, mapped through its carrier's chart (origin + s x^ +
/// t y^, y^ = n^ x x^), lands on the edge's 3D endpoints (exactly up to the
/// f64 chart evaluation; a Samples pcurve within its stated error).
fn check_pcurves(b: &Body) {
    let get = |v: &Vector3| [v[0].get(), v[1].get(), v[2].get()];
    let unit = |d: [f64; 3]| {
        let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        d.map(|x| x / l)
    };
    for c in &b.coedges {
        let pc = &b.pcurves[c.pcurve.0 as usize];
        let e = &b.edges[c.edge.0 as usize];
        assert_eq!(pc.curve, e.curve);
        let SurfaceGeometry::Plane { origin, normal, x } = &b.surfaces[pc.surface.0 as usize].geometry else {
            panic!()
        };
        let (o, n, xh) = (get(origin), unit(get(normal)), unit(get(x)));
        let yh = [n[1] * xh[2] - n[2] * xh[1], n[2] * xh[0] - n[0] * xh[2], n[0] * xh[1] - n[1] * xh[0]];
        let (ends, error) = match &pc.geometry {
            PcurveGeometry::Line { a, b } => ([[a[0].get(), a[1].get()], [b[0].get(), b[1].get()]], 0.0),
            PcurveGeometry::Samples {
                points,
                error: Bound::Estimated { estimate },
                ..
            } => (
                [[points[0][0].get(), points[0][1].get()], [points[1][0].get(), points[1][1].get()]],
                estimate.magnitude.get(),
            ),
            other => panic!("{other:?}"),
        };
        let chart_scale = ends.iter().flatten().fold(0.0f64, |m, x| m.max(x.abs()));
        assert!(
            error <= 2.0 * f64::EPSILON * chart_scale,
            "a chart rounding budget, not a geometric approximation: {error}"
        );
        for (k, st) in ends.iter().enumerate() {
            let q = get(&b.vertices[e.vertices[k].0 as usize].point);
            let mapped = [0, 1, 2].map(|i| o[i] + st[0] * xh[i] + st[1] * yh[i]);
            for i in 0..3 {
                assert!(
                    (mapped[i] - q[i]).abs() <= 4.0 * f64::EPSILON * (q[i].abs() + st[0].abs() + st[1].abs()) + 2.0 * error,
                    "pcurve {:?} end {k}: {mapped:?} vs {q:?}",
                    c.pcurve
                );
            }
        }
    }
}

#[test]
fn pcurves_follow_their_charts() {
    for v in ac01() {
        for reverse in [false, true] {
            let loops = region(&v.segments);
            check_pcurves(
                &blind_prism(&Prism {
                    key: key(),
                    source: [0; 4],
                    frame: v.frame,
                    segments: &v.segments,
                    region: &loops[0],
                    depth: v.depth,
                    reverse,
                })
                .unwrap(),
            );
        }
    }
    // Sloped edges with exact differences: Samples pcurves with a stated error.
    let tri = [[1.0, 2.0, 4.0, 2.0], [4.0, 2.0, 2.0, 9.0], [2.0, 9.0, 1.0, 2.0]];
    let loops = region(&tri);
    let body = blind_prism(&Prism {
        key: key(),
        source: [0; 4],
        frame: Affine::IDENTITY,
        segments: &tri,
        region: &loops[0],
        depth: 0.5,
        reverse: true,
    })
    .unwrap();
    assert!(body.pcurves.iter().any(|p| matches!(p.geometry, PcurveGeometry::Samples { .. })));
    check_pcurves(&body);
}

#[test]
fn triangle_prisms_support_all_source_axes_and_shifted_slopes() {
    // A scalene triangular prism is not an axis prism in its other two axes.
    // Strip lineage when rotating the source: it is now a general WC0 input,
    // not the original sketch extrusion, and the audit must certify it itself.
    let points = [[1., 2.], [7., 2.], [3., 10.]];
    let segments = segments_of(&points, &mut Rng(19));
    let original = build(Affine::IDENTITY, &segments, 0.5, false).unwrap();
    assert!((original.volume_mm3().unwrap() - 12e9).abs() < 1e-4);
    for shift in 0..3 {
        let permute = |v: &mut Vector3| {
            *v = [v[shift], v[(shift + 1) % 3], v[(shift + 2) % 3]];
        };
        let mut b = original.body.clone();
        for v in &mut b.vertices {
            permute(&mut v.point);
            v.provenance = Provenance::None {};
        }
        for c in &mut b.curves {
            if let CurveGeometry::Line { a, b } = &mut c.geometry {
                permute(a);
                permute(b);
            }
        }
        for s in &mut b.surfaces {
            if let SurfaceGeometry::Plane { origin, normal, x } = &mut s.geometry {
                permute(origin);
                permute(normal);
                permute(x);
            }
        }
        let mut sheared = b.clone();
        sheared.frames[1] = Frame::Interpreter {
            parent: FrameId(0),
            origin: [Binary64::new(0.).unwrap(); 3],
            x: [1., 0.25, 0.125].map(|x| Binary64::new(x).unwrap()),
            z: [0.25, 0.125, 1.].map(|x| Binary64::new(x).unwrap()),
        };
        check_world_areas(&audit_body(sheared).unwrap());
        let a = audit_body(b).unwrap();
        assert_eq!(a.axis, (2 + 3 - shift) % 3);
        check_step(&a, "permuted triangular prism");
        assert_eq!(a.topology().faces, 5);
        assert_eq!(a.topology().genus, 0);
        assert!((a.volume_mm3().unwrap() - 12e9).abs() < 1e-4);
        // Outside the oblique edge (7,2)->(3,10): nearest point is its interior.
        // (9,8) projects to (5,6), distance sqrt(20) metres.
        let q = [9000., 8000., 250.];
        let q = [q[shift], q[(shift + 1) % 3], q[(shift + 2) % 3]];
        match a.distance_mm(q) {
            Probe::Measured { distance_mm, inside, bound_mm } => {
                assert!(!inside && (distance_mm - 20f64.sqrt() * 1000.).abs() <= bound_mm);
                assert!(bound_mm > 0. && bound_mm < 1e-8);
            }
            r => panic!("{r:?}"),
        }
    }
    // A non-axis-aligned face vector has two nonzero components. Its area is
    // preserved by this rotation, unlike a componentwise sign-flip mutant.
    let f = Affine {
        origin: [0.; 3],
        x: [0.6, 0.8, 0.],
        z: [0., 0., 1.],
    };
    let rotated = build(f, &segments, 0.5, false).unwrap();
    let expected = [24e6, 24e6, 3e6, 20f64.sqrt() * 1e6, 17f64.sqrt() * 1e6];
    let mut got = rotated.face_areas_mm2().unwrap();
    let mut expected = expected.to_vec();
    got.sort_by(f64::total_cmp);
    expected.sort_by(f64::total_cmp);
    for (a, b) in got.iter().zip(expected) {
        assert!((a - b).abs() <= b * 1e-14, "{got:?}");
    }
}

#[test]
fn construction_binding_rejects_extra_region_vertices_and_reordered_levels() {
    for edit in [0, 1] {
        let mut b = ac01_body(0);
        if edit == 0 {
            b.constructions[3]
                .parameters
                .extend([Binary64::new(0.125).unwrap(), Binary64::new(0.25).unwrap()]);
        } else {
            b.constructions[4].parameters.swap(0, 1);
        }
        assert_eq!(audit_body(b).unwrap_err(), "audit/construction-levels");
    }
}

#[test]
fn host_measurements_are_json_and_flags_and_short_payloads_are_checked() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let v = &ac01()[0];
    let mut p = request(OP_PRISM);
    p.extend([1, 2, 3, 4, 0, 0, 0, 0, 0]);
    for x in v.frame.origin.iter().chain(&v.frame.x).chain(&v.frame.z) {
        push_f64(&mut p, *x);
    }
    push_f64(&mut p, v.depth);
    p.extend([1, 0, v.segments.len() as u32]);
    for s in &v.segments {
        for &x in s {
            push_f64(&mut p, x);
        }
    }
    let reply = host_op(&p);
    assert_eq!(reply[0], STATUS_OK, "{}", text(&reply));
    let words = &reply[1..];
    let mut m = request(OP_MEASURE);
    m.push(words.len() as u32);
    m.extend(words);
    m.push(1);
    for x in [1., 0., 0., -1., 0., 1., 0., 2., 0., 0., 1., 3.] {
        push_f64(&mut m, x);
    }
    m.push(2);
    for x in [2., 2., -4., 20., 2., -4.] {
        push_f64(&mut m, x);
    }
    let reply = host_op(&m);
    assert_eq!(reply[0], STATUS_OK, "{}", text(&reply));
    // Parse at the real JSON consumer boundary rather than searching for field
    // names: malformed numbers and arrays must not survive valid topology text.
    let mut child = Command::new("node")
        .args([
            "-e",
            r#"
const assert=require('node:assert/strict'); let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{
const m=JSON.parse(s); assert.equal(m.volumeMm3,768);
const encloses=(actual,expected,bound,maximum)=>{
  assert.ok(Number.isFinite(bound)&&bound>=0&&bound<maximum);
  assert.ok(Math.abs(actual-expected)<=bound,`${actual} does not enclose ${expected} within ${bound}`);
};
encloses(m.areaMm2,640,640*m.areaRelBound,640*2e-14);
assert.deepEqual(m.mappedBboxMm,{min:[-1,2,-5],max:[15,14,3]});
[6,4,-4].forEach((value,i)=>encloses(m.centroidMm[i],value,m.centroidBoundMm[i],1e-10));
assert.deepEqual(m.probes.map(p=>p.inside),[true,false]);
[0,4].forEach((value,i)=>encloses(m.probes[i].distanceMm,value,m.probes[i].boundMm,1e-10));
assert.equal(m.projection.vertices.length,12);assert.equal(m.faceAreasMm2.length,8);
});"#,
        ])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(text(&reply).as_bytes()).unwrap();
    assert!(child.wait().unwrap().success());
    // A body word count that only fits if the consumed prefix is added instead
    // of subtracted must refuse before slicing, never panic.
    assert_eq!(host_op(&[MAGIC, VERSION, OP_MEASURE, 4, 1, 2])[0], STATUS_MALFORMED);
    let mut bad = p.clone();
    bad[3 + 9 + 18 + 2] = 2;
    assert_eq!(host_op(&bad)[0], STATUS_MALFORMED);
    for (s, category) in [
        (vec![[0., 0., 0., 0.]], "sketch/degenerate"),
        (vec![[0., 0., 1., 0.], [1., 0., 2., 1.], [1., 0., 2., -1.]], "sketch/branching"),
        (vec![[0., 0., 1e200, 0.]], "sketch/numeric-range"),
        (
            vec![
                [0., 0., 8., 0.],
                [8., 0., 0., 8.],
                [0., 8., 0., 0.],
                [1., 1., 2., 1.],
                [2., 1., 1., 2.],
                [1., 2., 1., 1.],
            ],
            "sketch/nested-loops",
        ),
    ] {
        let mut r = request(OP_REGION);
        r.push(s.len() as u32);
        for a in s {
            for x in a {
                push_f64(&mut r, x);
            }
        }
        let reply = host_op(&r);
        assert_eq!(reply[0], STATUS_REFUSED);
        assert!(text(&reply).starts_with(category), "{}", text(&reply));
    }
}

// Small independent STEP reader: checks the external AP214 graph's geometric
// semantics (not writer-local ids or ordering, which may freely change).
fn step_fields(s: &str) -> Vec<String> {
    let (mut depth, mut quoted, mut start) = (0i32, false, 0);
    let mut fields = Vec::new();
    for (i, c) in s.char_indices() {
        match c {
            '\'' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth -= 1,
            ',' if !quoted && depth == 0 => {
                fields.push(s[start..i].to_owned());
                start = i + 1;
            }
            _ => {}
        }
    }
    fields.push(s[start..].to_owned());
    fields
}
fn step_data(s: &str) -> std::collections::BTreeMap<String, (String, Vec<String>)> {
    s.lines()
        .filter(|l| l.starts_with('#'))
        .map(|l| {
            let (id, e) = l.trim_end_matches(';').split_once('=').unwrap();
            let (kind, args) = e.split_once('(').unwrap();
            (id.to_owned(), (kind.to_owned(), step_fields(args.strip_suffix(')').unwrap())))
        })
        .collect()
}
fn step_vec(data: &std::collections::BTreeMap<String, (String, Vec<String>)>, id: &str, kind: &str) -> [f64; 3] {
    let (k, fields) = data.get(id).unwrap_or_else(|| panic!("missing STEP reference {id}"));
    assert_eq!(k, kind);
    let values: Vec<f64> = fields[1]
        .trim_start_matches('(')
        .trim_end_matches(')')
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    values.try_into().unwrap()
}
fn check_step(a: &Audited, label: &str) {
    let text = step::write(&[("part'1".into(), &a)], "part'1\n").unwrap();
    assert!(text.contains("MANIFOLD_SOLID_BREP('part''1',"));
    assert!(text.contains("FILE_NAME('part''1_.step'"));
    let d = step_data(&text);
    let norm = |q: [f64; 3]| q[0].hypot(q[1]).hypot(q[2]);
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let cross = |a: [f64; 3], b: [f64; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let vertex = |id: &str| {
        let (k, f) = &d[id];
        assert_eq!(k, "VERTEX_POINT");
        step_vec(&d, &f[1], "CARTESIAN_POINT")
    };
    for (_, (kind, f)) in &d {
        if kind == "DIRECTION" {
            let q: Vec<f64> = f[1].trim_matches(['(', ')']).split(',').map(|s| s.parse().unwrap()).collect();
            assert!((norm(q.try_into().unwrap()) - 1.).abs() < 1e-14);
        }
        if kind == "EDGE_CURVE" {
            let (p, q) = (vertex(&f[1]), vertex(&f[2]));
            let (k, line) = &d[&f[3]];
            assert_eq!(k, "LINE");
            assert_eq!(step_vec(&d, &line[1], "CARTESIAN_POINT"), p);
            let (k, vector) = &d[&line[2]];
            assert_eq!(k, "VECTOR");
            let dir = step_vec(&d, &vector[1], "DIRECTION");
            let edge = sub(q, p);
            assert!(norm(cross(dir, edge)) <= 1e-10 * norm(edge), "{}: line {p:?}->{q:?} dir {dir:?}", label);
            assert!(dot(dir, edge) > 0.);
        }
        if kind == "ADVANCED_FACE" {
            let bound = f[1].trim_matches(['(', ')']);
            let (_, bf) = &d[bound];
            let (_, lp) = &d[&bf[1]];
            let mut points = Vec::new();
            for oe in lp[1].trim_matches(['(', ')']).split(',') {
                let (_, of) = &d[oe];
                let (_, edge) = &d[&of[3]];
                points.push(vertex(&edge[if of[4] == ".T." { 1 } else { 2 }]));
            }
            let (_, plane) = &d[&f[2]];
            let (_, placement) = &d[&plane[1]];
            let o = step_vec(&d, &placement[1], "CARTESIAN_POINT");
            let n = step_vec(&d, &placement[2], "DIRECTION");
            let x = step_vec(&d, &placement[3], "DIRECTION");
            assert!(dot(n, x).abs() < 1e-14);
            for q in &points {
                assert!(dot(sub(*q, o), n).abs() < 1e-9, "{}: plane", label);
            }
            let a = sub(points[1], points[0]);
            let b = sub(points[2], points[1]);
            let signed = dot(cross(a, b), n);
            assert!(if f[3] == ".T." { signed > 0. } else { signed < 0. }, "{}: outward carrier", label);
        }
    }
}

#[test]
fn step_carriers_and_lines_agree_with_exported_vertices() {
    for v in ac01() {
        let a = build(v.frame, &v.segments, v.depth, false).unwrap();
        check_step(&a, v.name);
    }
    // Large translation can collapse distinct source vertices in f64 export.
    // Never emit a zero DIRECTION in this case; refuse with a named reason.
    let v = &ac01()[0];
    let far = Affine {
        origin: [1e16; 3],
        ..Affine::IDENTITY
    };
    let a = build(far, &v.segments, v.depth, false).unwrap();
    assert_eq!(step::write(&[("tiny".into(), &a)], "tiny").unwrap_err().0, "export/zero-direction");
}

#[test]
fn nonorthogonal_frame_areas_match_world_triangles() {
    let points = [[1., 2.], [7., 2.], [3., 10.]];
    let s = segments_of(&points, &mut Rng(31));
    let f = Affine {
        origin: [0.25, -0.5, 1.],
        x: [1., 0.25, 0.125],
        z: [0.25, 0.125, 1.],
    };
    let a = build(f, &s, 0.5, false).unwrap();
    check_world_areas(&a);
    check_step(&a, "sheared triangular prism");
}

#[test]
fn probe_refuses_near_either_cap_and_bounds_mapping_error() {
    let v = &ac01()[0];
    for reverse in [false, true] {
        let a = build(v.frame, &v.segments, v.depth, reverse).unwrap();
        let lo = if reverse { -8. } else { 0. };
        let hi = if reverse { 0. } else { 8. };
        for h in [lo + 1e-14, hi - 1e-14] {
            assert_eq!(a.distance_mm([2., 2., h]), Probe::Refused("observe/probe-within-mapping-budget".into()));
        }
    }
    let v = &ac01()[3];
    let a = build(v.frame, &v.segments, v.depth, false).unwrap();
    for q in [zone_map("V3", [20., 2., 4.]), zone_map("V3", [10., 10., 4.])] {
        let (_, mapping) = a.frame.inverse_approx(q.map(|x| x / 1000.)).unwrap();
        let defect = a.frame.orthonormality_defect().unwrap();
        match a.distance_mm(q) {
            Probe::Measured { distance_mm, bound_mm, .. } => {
                // Independent lower bounds for two contributors promised by
                // the measurement: mapping plus frame distortion, and mapping
                // plus nonzero distance-evaluation error. No exact recipe pinned.
                assert!(bound_mm >= mapping * 1000. + distance_mm * defect);
                assert!(bound_mm > mapping * 1000.);
            }
            r => panic!("{r:?}"),
        }
    }
}

fn check_world_areas(a: &Audited) {
    let w = a.world_vertices_mm().unwrap();
    let areas = a.face_areas_mm2().unwrap();
    for (face, got) in a.face_loops.iter().zip(areas) {
        let origin = w[face[0]];
        let mut expected = 0.;
        for i in 1..face.len() - 1 {
            let b = [0, 1, 2].map(|k| w[face[i]][k] - origin[k]);
            let c = [0, 1, 2].map(|k| w[face[i + 1]][k] - origin[k]);
            expected += 0.5 * (b[1] * c[2] - b[2] * c[1]).hypot(b[2] * c[0] - b[0] * c[2]).hypot(b[0] * c[1] - b[1] * c[0]);
        }
        assert!((got - expected).abs() <= expected * 1e-14, "{got} vs {expected}");
    }
}

#[test]
fn embedding_refuses_an_oblique_source_prism() {
    let s = [[0., 0., 6., 0.], [6., 0., 2., 8.], [2., 8., 0., 0.]];
    let mut b = build(Affine::IDENTITY, &s, 0.5, false).unwrap().body;
    let shear = |v: &mut Vector3| {
        v[2] = Binary64::new(v[2].get() + v[0].get()).unwrap();
    };
    for v in &mut b.vertices {
        shear(&mut v.point);
        v.provenance = Provenance::None {};
    }
    for c in &mut b.curves {
        if let CurveGeometry::Line { a, b } = &mut c.geometry {
            shear(a);
            shear(b);
        }
    }
    for s in &mut b.surfaces {
        if let SurfaceGeometry::Plane { origin, normal, x } = &mut s.geometry {
            shear(origin);
            shear(x);
            normal[0] = Binary64::new(normal[0].get() - normal[2].get()).unwrap();
        }
    }
    assert_eq!(audit_body(b).unwrap_err(), "audit/embedding-uncertified");
}

#[test]
fn embedding_refuses_a_prism_with_a_sloping_top_cap() {
    let s = [[0., 0., 6., 0.], [6., 0., 2., 8.], [2., 8., 0., 0.]];
    let mut b = build(Affine::IDENTITY, &s, 0.5, false).unwrap().body;
    let raise = |v: &mut Vector3| {
        if v[2].get() != 0. {
            v[2] = Binary64::new(0.5 + v[0].get()).unwrap();
        }
    };
    for v in &mut b.vertices {
        raise(&mut v.point);
        v.provenance = Provenance::None {};
    }
    for c in &mut b.curves {
        if let CurveGeometry::Line { a, b } = &mut c.geometry {
            raise(a);
            raise(b);
        }
    }
    if let SurfaceGeometry::Plane { normal, x, .. } = &mut b.surfaces[1].geometry {
        *normal = [-1., 0., 1.].map(|x| Binary64::new(x).unwrap());
        *x = [1., 0., 1.].map(|x| Binary64::new(x).unwrap());
    }
    assert_eq!(audit_body(b).unwrap_err(), "audit/embedding-uncertified");
}

#[test]
fn audit_accepts_geometrically_equal_signed_zero_cap_coordinates() {
    for top in [false, true] {
        let mut b = ac01_body(0);
        let n = b.vertices.len() / 2;
        for (i, v) in b.vertices.iter_mut().enumerate() {
            v.provenance = Provenance::None {};
            if (i >= n) == top {
                for k in 0..2 {
                    if v.point[k].get() == 0. {
                        v.point[k] = Binary64::new(-0.).unwrap();
                    }
                }
            }
        }
        let a = audit_body(b).unwrap();
        assert_eq!(a.volume_mm3().unwrap(), 768.);
    }
}

#[test]
fn reflected_source_prism_has_ccw_cap_and_unchanged_distance() {
    let mut b = ac01_body(0);
    let reflect = |p: &mut Vector3| {
        p[2] = Binary64::new(-p[2].get()).unwrap();
    };
    for v in &mut b.vertices {
        reflect(&mut v.point);
        v.provenance = Provenance::None {};
    }
    for c in &mut b.curves {
        if let CurveGeometry::Line { a, b } = &mut c.geometry {
            reflect(a);
            reflect(b);
        }
    }
    for s in &mut b.surfaces {
        if let SurfaceGeometry::Plane { origin, normal, x } = &mut s.geometry {
            reflect(origin);
            reflect(normal);
            reflect(x);
        }
    }
    for l in &mut b.loops {
        l.coedges.reverse();
    }
    for c in &mut b.coedges {
        c.forward = !c.forward;
    }
    let a = audit_body(b).unwrap();
    assert_eq!(a.volume_mm3().unwrap(), 768.);
    // CCW is part of the audit certificate's public contract, not the winding
    // implementation: downstream consumers may triangulate that oriented cap.
    assert!(oracle_area(&a.cap) > R::zero());
}

#[test]
fn triangulated_side_refuses_instead_of_panicking_in_prism_certificate() {
    let mut b = ac01_body(0);
    let face = 2usize;
    let surface = b.faces[face].surface;
    let lp = b.faces[face].loops[0].0 as usize;
    let cs = b.loops[lp].coedges.clone();
    let start = |c: CoedgeId| {
        let co = &b.coedges[c.0 as usize];
        b.edges[co.edge.0 as usize].vertices[if co.forward { 0 } else { 1 }]
    };
    let (a, z) = (start(cs[0]), start(cs[2]));
    let curve = CurveId(b.curves.len() as u32);
    let edge = EdgeId(b.edges.len() as u32);
    let pc = PcurveId(b.pcurves.len() as u32);
    let domain = b.edges[0].domain.clone();
    let endpoints = [b.vertices[a.0 as usize].point, b.vertices[z.0 as usize].point];
    b.curves.push(Curve {
        frame: FrameId(1),
        provenance: Provenance::None {},
        geometry: CurveGeometry::Line {
            a: endpoints[0],
            b: endpoints[1],
        },
        domain: domain.clone(),
        supports: vec![Support { surface, pcurve: pc }],
    });
    b.edges.push(Edge {
        curve,
        domain: domain.clone(),
        vertices: vec![a, z],
    });
    let mut pcurve = b.pcurves[b.coedges[cs[0].0 as usize].pcurve.0 as usize].clone();
    pcurve.curve = curve;
    pcurve.surface = surface;
    if let PcurveGeometry::Line { b: end, .. } = &mut pcurve.geometry {
        end[1] = Binary64::new(0.008).unwrap();
    }
    b.pcurves.push(pcurve);
    let reverse = CoedgeId(b.coedges.len() as u32);
    b.coedges.push(Coedge {
        edge,
        forward: false,
        pcurve: pc,
    });
    let forward = CoedgeId(b.coedges.len() as u32);
    b.coedges.push(Coedge {
        edge,
        forward: true,
        pcurve: pc,
    });
    b.loops[lp].coedges = vec![cs[0], cs[1], reverse];
    let other = LoopId(b.loops.len() as u32);
    b.loops.push(Loop {
        outer: true,
        coedges: vec![forward, cs[2], cs[3]],
    });
    let face = FaceId(b.faces.len() as u32);
    b.faces.push(Face {
        surface,
        forward: true,
        loops: vec![other],
    });
    b.shells[0].faces.push(face);
    assert_eq!(audit_body(b).unwrap_err(), "audit/embedding-uncertified");
}

#[test]
fn probe_exactly_at_mapping_budget_refuses() {
    let s = [[-2., -2., 2., -2.], [2., -2., 2., 2.], [2., 2., -2., 2.], [-2., 2., -2., -2.]];
    let a = build(Affine::IDENTITY, &s, 0.5, false).unwrap();
    // q=(1,1/2,1/2-2^-45): magnitude and reach are exactly 1.
    // The published 32 eps * (magnitude + reach) is 2^-46, and the
    // distance to the top is exactly twice that bound, not strictly outside.
    let h = 0.5 - 2f64.powi(-45);
    assert_eq!(h * 1000. / 1000., h);
    assert_eq!(
        a.distance_mm([1000., 500., h * 1000.]),
        Probe::Refused("observe/probe-within-mapping-budget".into())
    );
}
