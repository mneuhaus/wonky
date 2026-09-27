// Adversarial properties adopted from the Opus final gate (W0-SKETCH, 2026-09-26). Each property targets a plausible wrong
// solver: joint crossings decided by tolerance, loops emitted in input order instead of walk
// order, rounded deltas as proof basis (E9), unverified chained dimensions, bearing quadrant loss,
// arc-loop orientation from a wrong Green term or sweep branch, tangency not tied to a line edge.
use wonky_num::{p2, Sign};
use wonky_sketch::{solve, solve_ordered_profile, Constraint, Point, Primitive, Profile, Refusal};

fn p<'a>(key: &'a str, x: f64, y: f64) -> Point<'a> {
    Point { key, xy: p2(x, y) }
}
fn line<'a>(a: Point<'a>, b: Point<'a>) -> Primitive<'a> {
    Primitive::Line { start: a, end: b }
}
fn arc<'a>(a: Point<'a>, mid: (f64, f64), b: Point<'a>) -> Primitive<'a> {
    Primitive::Arc3 {
        start: a,
        mid: p2(mid.0, mid.1),
        end: b,
    }
}
fn ends<'a>(primitive: &Primitive<'a>) -> (Point<'a>, Point<'a>) {
    match *primitive {
        Primitive::Line { start, end } | Primitive::Arc3 { start, end, .. } => (start, end),
        Primitive::Circle { .. } => unreachable!("closed walks contain no circles"),
    }
}

// Every loop must be a closed walk: each segment once, keys[k] at the start of segment k,
// and the end of segment k exactly at the start of segment k+1.
fn assert_closed_walk(primitives: &[Primitive<'_>], profile: &Profile<'_>, label: &str) {
    let mut seen = vec![false; primitives.len()];
    for boundary in &profile.loops {
        let n = boundary.segment_indices.len();
        assert_eq!(boundary.keys.len(), n, "{label}: one key per segment");
        for position in 0..n {
            let index = boundary.segment_indices[position];
            assert!(!seen[index], "{label}: segment {index} emitted twice");
            seen[index] = true;
            let (start, end) = ends(&primitives[index]);
            let (next_start, _) = ends(&primitives[boundary.segment_indices[(position + 1) % n]]);
            assert_eq!(
                profile.solved_points[boundary.keys[position]], profile.solved_points[start.key],
                "{label}: key {position} is not the start of its segment"
            );
            assert_eq!(
                profile.solved_points[end.key], profile.solved_points[next_start.key],
                "{label}: walk breaks after position {position}"
            );
        }
    }
    assert!(
        seen.iter().all(|&s| s),
        "{label}: every segment is on a loop"
    );
}

fn m3_numbers() -> Vec<f64> {
    let fs = include_str!("data/m3-hybrid-arcs.fs");
    let list = fs
        .split("const M3_HYBRID_ARCS = [")
        .nth(1)
        .expect("R20 arc list")
        .split("];\n")
        .next()
        .expect("R20 closing bracket");
    let numbers: Vec<f64> = list
        .split(|c: char| c == ',' || c == '[' || c == ']' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().expect("numeric FS arc literal"))
        .collect();
    assert_eq!(numbers.len(), 72);
    numbers
}
fn m3_arcs<'a>(numbers: &[f64], start: &'a [String], end: &'a [String]) -> Vec<Primitive<'a>> {
    (0..12)
        .map(|i| Primitive::Arc3 {
            start: p(&start[i], numbers[6 * i], numbers[6 * i + 1]),
            mid: p2(numbers[6 * i + 2], numbers[6 * i + 3]),
            end: p(&end[i], numbers[6 * i + 4], numbers[6 * i + 5]),
        })
        .collect()
}

// Frozen G3 M3: exact bitwise joints, a closed walk in construction order, reversal flips
// orientation, and a single-ULP move of any arc END (either coordinate, either direction)
// is an OpenProfile refusal (the start side is covered by gate_fable).
#[test]
fn opus_m3_end_side_ulp_gaps_refuse_and_reversal_inverts() {
    let numbers = m3_numbers();
    let starts: Vec<_> = (0..12).map(|i| format!("s{i}")).collect();
    let ends_: Vec<_> = (0..12).map(|i| format!("e{i}")).collect();
    for i in 0..12 {
        let j = (i + 1) % 12;
        assert_eq!(
            numbers[6 * i + 4].to_bits(),
            numbers[6 * j].to_bits(),
            "joint {i} x bitwise"
        );
        assert_eq!(
            numbers[6 * i + 5].to_bits(),
            numbers[6 * j + 1].to_bits(),
            "joint {i} y bitwise"
        );
    }
    let arcs = m3_arcs(&numbers, &starts, &ends_);
    let solved = solve_ordered_profile(&arcs).expect("canonical M3");
    assert_eq!(solved.loops.len(), 1);
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
    assert_closed_walk(&arcs, &solved, "M3");
    for (i, a) in arcs.iter().enumerate() {
        let (s, e) = ends(a);
        assert_eq!(solved.solved_points[s.key], s.xy, "M3 start {i} unmoved");
        assert_eq!(solved.solved_points[e.key], e.xy, "M3 end {i} unmoved");
    }
    let mut refused = 0;
    for joint in 0..12 {
        for coord in 0..2 {
            for up in [true, false] {
                let mut moved = numbers.clone();
                let idx = 6 * joint + 4 + coord;
                let bits = moved[idx].to_bits();
                moved[idx] = f64::from_bits(if up { bits + 1 } else { bits - 1 });
                assert_ne!(moved[idx], numbers[idx]);
                assert_eq!(
                    solve_ordered_profile(&m3_arcs(&moved, &starts, &ends_)).unwrap_err(),
                    Refusal::OpenProfile,
                    "end of arc {joint} coord {coord} up={up}"
                );
                refused += 1;
            }
        }
    }
    assert_eq!(refused, 48);
    let reversed: Vec<_> = arcs
        .iter()
        .rev()
        .map(|a| match *a {
            Primitive::Arc3 { start, mid, end } => Primitive::Arc3 {
                start: end,
                mid,
                end: start,
            },
            _ => unreachable!(),
        })
        .collect();
    let back = solve_ordered_profile(&reversed).expect("reversed M3");
    assert_eq!(back.loops[0].orientation, Sign::Negative);
    assert_closed_walk(&reversed, &back, "reversed M3");
}

// Sketch entities arrive unordered. The emitted loop must follow the joints, not the
// primitive indices; orientation must not depend on input order.
#[test]
fn opus_shuffled_primitives_emit_a_closed_walk() {
    let rect = |reverse: bool| -> Vec<Primitive<'static>> {
        let n = [
            p("a", -1.0, -2.0),
            p("b", 5.0, -2.0),
            p("c", 5.0, 7.0),
            p("d", -1.0, 7.0),
        ];
        (0..4)
            .map(|j| {
                if reverse {
                    line(n[(j + 1) % 4], n[j])
                } else {
                    line(n[j], n[(j + 1) % 4])
                }
            })
            .collect()
    };
    for (reverse, expected) in [(false, Sign::Positive), (true, Sign::Negative)] {
        let base = rect(reverse);
        for perm in [[2, 0, 3, 1], [3, 1, 0, 2], [1, 3, 2, 0], [0, 2, 1, 3]] {
            let shuffled: Vec<_> = perm.iter().map(|&k| base[k]).collect();
            let profile = solve(&shuffled, &[]).expect("shuffled rectangle");
            assert_eq!(profile.loops.len(), 1);
            assert_eq!(profile.loops[0].orientation, expected);
            assert_closed_walk(&shuffled, &profile, "rectangle");
        }
    }
    let (a, b, o) = (p("a", 3.0, 0.0), p("b", 0.0, -3.0), p("o", 0.0, 0.0));
    let sector = [arc(a, (-3.0, 0.0), b), line(b, o), line(o, a)];
    for perm in [[2, 0, 1], [1, 2, 0], [0, 2, 1]] {
        let shuffled: Vec<_> = perm.iter().map(|&k| sector[k]).collect();
        let profile = solve(&shuffled, &[]).expect("shuffled sector");
        assert_eq!(profile.loops[0].orientation, Sign::Positive);
        assert_closed_walk(&shuffled, &profile, "sector");
    }
    // M3 with one shared construction key per joint (coordinates are bitwise equal).
    let numbers = m3_numbers();
    let joint: Vec<_> = (0..12).map(|i| format!("j{i}")).collect();
    let starts: Vec<_> = (0..12).map(|i| joint[(i + 11) % 12].clone()).collect();
    let arcs = m3_arcs(&numbers, &starts, &joint);
    for step in [5usize, 7, 11] {
        let shuffled: Vec<_> = (0..12).map(|i| arcs[(step * i + 3) % 12]).collect();
        let profile = solve(&shuffled, &[]).expect("shuffled M3");
        assert_eq!(profile.loops.len(), 1);
        assert_eq!(profile.loops[0].orientation, Sign::Positive);
        assert_closed_walk(&shuffled, &profile, "M3 shuffled");
    }
}

// Two adjacent arcs whose supporting circles cross a second time 2t above the shared joint.
// With t > 0 both arcs pass through that crossing (a hidden self-intersection however small),
// so the exact decision must refuse; with exactly tangent circles (t = 0) the cusp closes.
#[test]
fn opus_near_tangent_arc_joint_crossing_refuses_without_tolerance() {
    let (l, j, r) = (p("l", -2.0, 0.0), p("j", 0.0, 0.0), p("r", 2.0, 0.0));
    let (x, y) = (p("x", 3.0, 5.0), p("y", -3.0, 5.0));
    for exponent in [10, 20, 30, 40, 50] {
        let t = 2f64.powi(-exponent);
        let profile = [
            arc(l, (-2.0, 2.0 * t), j),
            arc(j, (2.0, 2.0 * t), r),
            line(r, x),
            line(x, y),
            line(y, l),
        ];
        assert_eq!(
            solve(&profile, &[]).unwrap_err(),
            Refusal::UnsupportedIntersection,
            "second circle crossing 2^-{exponent} above the joint"
        );
    }
    let tangent = [
        arc(l, (-1.0, 1.0), j),
        arc(j, (1.0, 1.0), r),
        line(r, x),
        line(x, y),
        line(y, l),
    ];
    let solved = solve(&tangent, &[]).expect("exactly tangent cusp closes");
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
    assert_closed_walk(&tangent, &solved, "tangent cusp");
}

// A line leaving an arc joint tilted inward by delta re-enters the disc near the joint;
// the exact second intersection lies on the arc and the segment, so it must refuse for any
// delta > 0. Exactly tangent (delta = 0) and outward tilts close.
#[test]
fn opus_near_tangent_line_joint_crossing_refuses_without_tolerance() {
    let (l, j, y) = (p("l", -5.0, 0.0), p("j", 5.0, 0.0), p("y", -5.0, 10.0));
    for exponent in [10, 20, 30, 40, 48] {
        let delta = 2f64.powi(-exponent);
        let x = p("x", 5.0 - delta, 10.0);
        let profile = [arc(l, (0.0, 5.0), j), line(j, x), line(x, y), line(y, l)];
        assert_eq!(
            solve(&profile, &[]).unwrap_err(),
            Refusal::UnsupportedIntersection,
            "inward tilt 2^-{exponent}"
        );
        let outward = p("x", 5.0 + delta, 10.0);
        let profile = [
            arc(l, (0.0, 5.0), j),
            line(j, outward),
            line(outward, y),
            line(y, l),
        ];
        assert_eq!(
            solve(&profile, &[]).unwrap().loops[0].orientation,
            Sign::Positive,
            "outward tilt 2^-{exponent}"
        );
    }
    let x = p("x", 5.0, 10.0);
    let tangent = [arc(l, (0.0, 5.0), j), line(j, x), line(x, y), line(y, l)];
    let solved = solve(&tangent, &[]).expect("tangent line closes");
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
}

// E9: a kernel-rounded delta is never proof. b - t rounds to a perpendicular direction
// although the exact dot is 2^-50; only the exact expression may certify tangency.
#[test]
fn opus_tangency_perpendicularity_uses_exact_deltas() {
    let center = p("o", 0.0, 0.0);
    let witness = Constraint::TangentLineCircle {
        line_start: "t",
        line_end: "b",
        circle_center: "o",
        at: "t",
    };
    let below_two = f64::from_bits(2.0f64.to_bits() - 1); // 2 - 2^-52
    for (contact, exact_end, rounded_end) in [
        ((3.0, 4.0), (11.0, -2.0), (11.0, -below_two)),
        ((4.0, 3.0), (-2.0, 11.0), (-below_two, 11.0)),
    ] {
        let t = p("t", contact.0, contact.1);
        for (end, expected) in [
            (exact_end, Refusal::OpenProfile),
            (rounded_end, Refusal::Overconstrained),
        ] {
            let entities = [
                line(t, p("b", end.0, end.1)),
                Primitive::Circle {
                    center,
                    radius: 5.0,
                },
            ];
            assert_eq!(
                solve(&entities, &[witness]).unwrap_err(),
                expected,
                "contact {contact:?} end {end:?}"
            );
        }
    }
}

// E9 for dimensions: (3 - 2^-60, 4) has a rounded length of exactly 5, but the exact squared
// distance is not 25 and no representable repositioning reaches it.
#[test]
fn opus_distance_is_decided_on_exact_deltas() {
    let tiny = 2f64.powi(-60);
    let edges = [
        line(p("a", tiny, 0.0), p("b", 3.0, 4.0)),
        line(p("b", 3.0, 4.0), p("c", 0.0, 4.0)),
        line(p("c", 0.0, 4.0), p("a", tiny, 0.0)),
    ];
    assert_eq!(
        solve(
            &edges,
            &[Constraint::Distance {
                a: "a",
                b: "b",
                mm: 5.0
            }]
        )
        .unwrap_err(),
        Refusal::NumericDecision
    );
}

// A later dimension that moves the anchor of an earlier one must not leave the earlier
// dimension silently violated.
#[test]
fn opus_chained_dimension_that_moves_an_earlier_anchor_refuses() {
    let edges = [
        line(p("a", 0.0, 0.0), p("b", 1.0, 0.0)),
        line(p("b", 1.0, 0.0), p("c", 1.0, 3.0)),
        line(p("c", 1.0, 3.0), p("d", 0.0, 3.0)),
        line(p("d", 0.0, 3.0), p("a", 0.0, 0.0)),
    ];
    let first = Constraint::Distance {
        a: "a",
        b: "b",
        mm: 2.0,
    };
    let moves_anchor = Constraint::Distance {
        a: "d",
        b: "a",
        mm: 6.0,
    };
    assert_eq!(
        solve(&edges, &[first]).unwrap().solved_points["b"],
        p2(2.0, 0.0)
    );
    assert_eq!(
        solve(&edges, &[moves_anchor]).unwrap().solved_points["a"],
        p2(0.0, -3.0)
    );
    assert_eq!(
        solve(&edges, &[first, moves_anchor]).unwrap_err(),
        Refusal::Overconstrained
    );
}

// Seeds pointing into negative quadrants keep their bearing.
#[test]
fn opus_distance_keeps_negative_bearings() {
    let edges = [
        line(p("a", 0.0, 0.0), p("b", -1.0, 0.0)),
        line(p("b", -1.0, 0.0), p("c", -1.0, -3.0)),
        line(p("c", -1.0, -3.0), p("d", 0.0, -3.0)),
        line(p("d", 0.0, -3.0), p("a", 0.0, 0.0)),
    ];
    let solved = solve(
        &edges,
        &[Constraint::Distance {
            a: "a",
            b: "b",
            mm: 3.0,
        }],
    )
    .unwrap();
    assert_eq!(solved.solved_points["a"], p2(0.0, 0.0));
    assert_eq!(solved.solved_points["b"], p2(-3.0, 0.0));
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
    let triangle = [
        line(p("a", 0.0, 0.0), p("b", -3.0, -4.0)),
        line(p("b", -3.0, -4.0), p("c", 0.0, -4.0)),
        line(p("c", 0.0, -4.0), p("a", 0.0, 0.0)),
    ];
    let solved = solve(
        &triangle,
        &[Constraint::Distance {
            a: "a",
            b: "b",
            mm: 10.0,
        }],
    )
    .unwrap();
    assert_eq!(solved.solved_points["b"], p2(-6.0, -8.0));
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
}

// A rectangle whose bottom edge is a clockwise arc biting into it. Doubled area:
// 4 * 0.75 - r^2 (phi - sin phi) with r = 1.25, phi = 2 asin(0.8): about +1.60. The Green
// base term cross(start, end) - cross(u, w) matters here: its sign slip (+ cross(u, w)) adds
// 2 r^2 sin(phi) = -3.0 and flips the loop, while D shapes and semicircle pairs cannot tell.
#[test]
fn opus_arc_bite_loop_orientation_comes_from_the_exact_green_integral() {
    let (a, b) = (p("a", -1.0, 0.0), p("b", 1.0, 0.0));
    let (c, d) = (p("c", 1.0, 0.75), p("d", -1.0, 0.75));
    let bite = [arc(a, (0.0, 0.5), b), line(b, c), line(c, d), line(d, a)];
    let solved = solve(&bite, &[]).expect("rectangle with an arc bite closes");
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
    assert_closed_walk(&bite, &solved, "bite");
    let reversed = [line(a, d), line(d, c), line(c, b), arc(b, (0.0, 0.5), a)];
    assert_eq!(
        solve(&reversed, &[]).unwrap().loops[0].orientation,
        Sign::Negative
    );
    let (ma, mb) = (p("a", -1.0, 0.0), p("b", 1.0, 0.0));
    let (mc, md) = (p("c", 1.0, -0.75), p("d", -1.0, -0.75));
    let mirrored = [
        arc(ma, (0.0, -0.5), mb),
        line(mb, mc),
        line(mc, md),
        line(md, ma),
    ];
    assert_eq!(
        solve(&mirrored, &[]).unwrap().loops[0].orientation,
        Sign::Negative
    );
}

// Three-point arcs need not carry their angular midpoint. A 270-degree arc on the circle of
// radius 5 whose mid lies 216.87 degrees from its start (uv < 0 < vw) must still be the major
// sweep, counterclockwise and clockwise alike; a minor-sweep reading flips every loop.
#[test]
fn opus_major_arc_with_off_centre_mid_keeps_its_sweep() {
    let o = p("o", 0.0, 0.0);
    for (end_y, mid, expected, opposite) in [
        (-5.0, (-4.0, -3.0), Sign::Positive, Sign::Negative),
        (5.0, (-4.0, 3.0), Sign::Negative, Sign::Positive),
    ] {
        let (s, e) = (p("s", 5.0, 0.0), p("e", 0.0, end_y));
        let chord = [arc(s, mid, e), line(e, s)];
        let solved = solve(&chord, &[]).expect("major arc + chord closes");
        assert_eq!(solved.loops[0].orientation, expected, "chord, mid {mid:?}");
        let radii = [arc(s, mid, e), line(e, o), line(o, s)];
        assert_eq!(
            solve(&radii, &[]).unwrap().loops[0].orientation,
            expected,
            "radii, mid {mid:?}"
        );
        let reversed = [line(s, e), arc(e, mid, s)];
        assert_eq!(
            solve(&reversed, &[]).unwrap().loops[0].orientation,
            opposite,
            "reversed chord, mid {mid:?}"
        );
    }
}

// Tangency is incidence at a line endpoint. A circle point t whose radius is exactly
// perpendicular to a far line (x = 10) is not a contact of that line and must be refused by
// name; the same exact geometry with t on the line passes and fails later on topology.
#[test]
fn opus_tangency_contact_must_be_a_line_endpoint() {
    let circle = Primitive::Circle {
        center: p("o", 0.0, 0.0),
        radius: 5.0,
    };
    let far = [
        line(p("a", 10.0, 0.0), p("b", 10.0, 10.0)),
        line(p("t", 5.0, 0.0), p("s", 7.0, 0.0)),
        circle,
    ];
    let off_line = Constraint::TangentLineCircle {
        line_start: "a",
        line_end: "b",
        circle_center: "o",
        at: "t",
    };
    assert_eq!(
        solve(&far, &[off_line]).unwrap_err(),
        Refusal::UncertifiedTangency
    );
    let touching = [line(p("t", 5.0, 0.0), p("b", 5.0, 10.0)), circle];
    let contact = Constraint::TangentLineCircle {
        line_start: "t",
        line_end: "b",
        circle_center: "o",
        at: "t",
    };
    assert_eq!(
        solve(&touching, &[contact]).unwrap_err(),
        Refusal::OpenProfile
    );
}

// The witness line must be a Line edge of the sketch: two keys joined by an arc, or by no
// primitive at all, carry no straight line even when the exact numbers would fit.
#[test]
fn opus_tangency_needs_a_line_edge_between_the_named_keys() {
    let circle = Primitive::Circle {
        center: p("o", 0.0, 0.0),
        radius: 5.0,
    };
    let witness = Constraint::TangentLineCircle {
        line_start: "t",
        line_end: "b",
        circle_center: "o",
        at: "t",
    };
    let (t, b) = (p("t", 5.0, 0.0), p("b", 5.0, 10.0));
    let via_arc = [arc(t, (10.0, 5.0), b), circle];
    assert_eq!(
        solve(&via_arc, &[witness]).unwrap_err(),
        Refusal::UncertifiedTangency
    );
    let split = [line(t, p("u", 6.0, 1.0)), line(p("v", 6.0, 9.0), b), circle];
    assert_eq!(
        solve(&split, &[witness]).unwrap_err(),
        Refusal::UncertifiedTangency
    );
}

// Line-only sketches: rings that merely touch (a vertex on another edge, a collinear shared
// stretch, a pinched ring) are refused, not emitted as separate loops of a non-manifold face.
// Disjoint rings still close, each with its own orientation.
#[test]
fn opus_touching_line_rings_refuse_but_disjoint_rings_close() {
    let square = |k: [&'static str; 4], x0: f64, y0: f64, side: f64| -> [Primitive<'static>; 4] {
        let n = [
            p(k[0], x0, y0),
            p(k[1], x0 + side, y0),
            p(k[2], x0 + side, y0 + side),
            p(k[3], x0, y0 + side),
        ];
        [
            line(n[0], n[1]),
            line(n[1], n[2]),
            line(n[2], n[3]),
            line(n[3], n[0]),
        ]
    };
    let outer = square(["a", "b", "c", "d"], 0.0, 0.0, 4.0);
    let far = square(["e", "f", "g", "h"], 10.0, 10.0, 1.0);
    let disjoint: Vec<_> = outer.iter().chain(far.iter()).copied().collect();
    let solved = solve(&disjoint, &[]).expect("disjoint rings close");
    assert_eq!(solved.loops.len(), 2);
    assert!(solved.loops.iter().all(|l| l.orientation == Sign::Positive));
    assert_closed_walk(&disjoint, &solved, "disjoint rings");
    // Inner triangle whose vertex sits on the outer bottom edge.
    let (t0, t1, t2) = (p("t0", 2.0, 0.0), p("t1", 3.0, 2.0), p("t2", 1.0, 2.0));
    let vertex_on_edge: Vec<_> = outer
        .iter()
        .copied()
        .chain([line(t0, t1), line(t1, t2), line(t2, t0)])
        .collect();
    assert_eq!(
        solve(&vertex_on_edge, &[]).unwrap_err(),
        Refusal::UnsupportedIntersection
    );
    // A neighbour sharing a collinear stretch of the right edge.
    let neighbour = square(["e", "f", "g", "h"], 4.0, 1.0, 2.0);
    let shared_stretch: Vec<_> = outer.iter().chain(neighbour.iter()).copied().collect();
    assert_eq!(
        solve(&shared_stretch, &[]).unwrap_err(),
        Refusal::UnsupportedIntersection
    );
    // One ring pinched: its vertex d touches its own edge a-b.
    let (a, b, c, d, e) = (
        p("a", 0.0, 0.0),
        p("b", 4.0, 0.0),
        p("c", 4.0, 4.0),
        p("d", 2.0, 0.0),
        p("e", 0.0, 4.0),
    );
    let pinched = [line(a, b), line(b, c), line(c, d), line(d, e), line(e, a)];
    assert_eq!(
        solve(&pinched, &[]).unwrap_err(),
        Refusal::UnsupportedIntersection
    );
}
