// Adversarial properties adopted from the Fable final gate (W0-SKETCH, 2026-09-26): four of the five kill a
// plausible wrong solver the original 16 properties accepted (major-arc orientation, sub-2^-40
// welds at M3 joints, tangency radius and perpendicularity decided with floats).
use wonky_num::{p2, Sign};
use wonky_sketch::{solve, solve_ordered_profile, Constraint, Point, Primitive, Refusal};

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

// A closed loop whose arc sweeps more than a half turn. The signed area must
// come from the actual 270-degree sweep, not from the signed minor angle of
// the chord; a solver that forgets the major-arc branch flips the orientation.
#[test]
fn major_arc_loops_have_certified_orientation() {
    for radius in 1..=24 {
        let r = radius as f64;
        let a = p("a", r, 0.0);
        let b = p("b", 0.0, -r);
        let o = p("o", 0.0, 0.0);
        // 3/4 circle from +x via -x to -y, closed by two radii through the centre.
        let three_quarter = [arc(a, (-r, 0.0), b), line(b, o), line(o, a)];
        let solved = solve(&three_quarter, &[]).expect("3/4 arc + two radii closes");
        assert_eq!(solved.loops.len(), 1);
        assert_eq!(solved.loops[0].orientation, Sign::Positive, "r={r}");
        let reversed = [line(a, o), line(o, b), arc(b, (-r, 0.0), a)];
        assert_eq!(
            solve(&reversed, &[]).unwrap().loops[0].orientation,
            Sign::Negative,
            "reversed r={r}"
        );
        // Same 3/4 arc closed by its chord: area = 3/4 disc + triangle.
        let chord = [arc(a, (-r, 0.0), b), line(b, a)];
        assert_eq!(
            solve(&chord, &[]).unwrap().loops[0].orientation,
            Sign::Positive,
            "chord r={r}"
        );
        let chord_reversed = [line(a, b), arc(b, (-r, 0.0), a)];
        assert_eq!(
            solve(&chord_reversed, &[]).unwrap().loops[0].orientation,
            Sign::Negative,
            "chord reversed r={r}"
        );
    }
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

fn m3_arcs<'a>(numbers: &[f64], keys: &'a [String]) -> Vec<Primitive<'a>> {
    (0..12)
        .map(|i| Primitive::Arc3 {
            start: p(&keys[2 * i], numbers[6 * i], numbers[6 * i + 1]),
            mid: p2(numbers[6 * i + 2], numbers[6 * i + 3]),
            end: p(&keys[2 * i + 1], numbers[6 * i + 4], numbers[6 * i + 5]),
        })
        .collect()
}

// The canonical G3 M3 profile closes only because every joint carries the
// identical interpreter f64 pair. Moving any joint by a single ULP in either
// coordinate must be refused as OpenProfile, never welded.
#[test]
fn m3_closes_exactly_and_one_ulp_joint_gaps_refuse_by_name() {
    let numbers = m3_numbers();
    let keys: Vec<_> = (0..24).map(|i| format!("endpoint-{i}")).collect();
    let arcs = m3_arcs(&numbers, &keys);
    // Positive control: exact G3 joints close as one positively oriented loop
    // that visits every arc exactly once, in construction order.
    let solved = solve_ordered_profile(&arcs).expect("canonical M3 closes");
    assert_eq!(solved.loops.len(), 1);
    assert_eq!(solved.loops[0].orientation, Sign::Positive);
    assert_eq!(solved.loops[0].segment_indices, (0..12).collect::<Vec<_>>());
    for i in 0..12 {
        let Primitive::Arc3 { start, end, .. } = arcs[i] else {
            unreachable!()
        };
        assert_eq!(solved.solved_points[start.key], start.xy);
        assert_eq!(solved.solved_points[end.key], end.xy);
        let Primitive::Arc3 { start: next, .. } = arcs[(i + 1) % 12] else {
            unreachable!()
        };
        assert_eq!(end.xy, next.xy, "G3 joint {i} is bitwise shared");
    }
    // Every joint, every coordinate, both ULP directions: 48 open profiles.
    let mut refused = 0;
    for joint in 0..12 {
        for coord in 0..2 {
            for up in [true, false] {
                let mut moved = numbers.clone();
                let idx = 6 * joint + coord; // start of arc `joint`
                let bits = moved[idx].to_bits();
                moved[idx] = f64::from_bits(if up { bits + 1 } else { bits - 1 });
                assert_ne!(moved[idx], numbers[idx]);
                let arcs = m3_arcs(&moved, &keys);
                assert_eq!(
                    solve_ordered_profile(&arcs).unwrap_err(),
                    Refusal::OpenProfile,
                    "joint {joint} coord {coord} up={up} must stay open"
                );
                refused += 1;
            }
        }
    }
    assert_eq!(refused, 48);
}

// Tangency is decided from the construction with exact predicates. A contact
// point whose f64 hypot rounds to the radius but whose exact squared distance
// differs must be refused even when the line is exactly perpendicular.
#[test]
fn tangency_radius_is_exact_not_float() {
    let tiny = 2f64.powi(-30);
    let center = p("o", 0.0, 0.0);
    let contact = p("a", tiny, 2.0);
    // Exactly perpendicular to (tiny, 2): direction (2, -tiny); all representable.
    let end = p("b", 2.0 + tiny, 2.0 - tiny);
    assert_eq!((contact.xy.x).hypot(contact.xy.y), 2.0, "f64 hypot rounds to r");
    let entities = [
        line(contact, end),
        Primitive::Circle {
            center,
            radius: 2.0,
        },
    ];
    let constraint = Constraint::TangentLineCircle {
        line_start: "a",
        line_end: "b",
        circle_center: "o",
        at: "a",
    };
    assert_eq!(
        solve(&entities, &[constraint]).unwrap_err(),
        Refusal::Overconstrained
    );
    // Positive control: exact contact passes the tangency and then refuses
    // only because line + circle enclose nothing.
    let exact = [
        line(p("a", 0.0, 2.0), p("b", 2.0, 2.0)),
        Primitive::Circle {
            center,
            radius: 2.0,
        },
    ];
    assert_eq!(solve(&exact, &[constraint]).unwrap_err(), Refusal::OpenProfile);
}

// Perpendicularity is the second half of the tangency witness. With the contact
// exactly on the circle, a line tilted by 2^-40 (dot = 2^-39, far below any
// float tolerance) must still be refused; only an exact-zero dot is a witness.
#[test]
fn tangency_perpendicularity_is_exact_not_float() {
    let tilt = 2f64.powi(-40);
    let center = p("o", 0.0, 0.0);
    let contact = p("a", 0.0, 2.0);
    let constraint = Constraint::TangentLineCircle {
        line_start: "a",
        line_end: "b",
        circle_center: "o",
        at: "a",
    };
    for tilted in [p("b", 2.0, 2.0 + tilt), p("b", 2.0, 2.0 - tilt)] {
        let entities = [
            line(contact, tilted),
            Primitive::Circle {
                center,
                radius: 2.0,
            },
        ];
        assert_eq!(
            solve(&entities, &[constraint]).unwrap_err(),
            Refusal::Overconstrained,
            "tilt {}",
            tilted.xy.y - 2.0
        );
    }
    let exact = [
        line(contact, p("b", 2.0, 2.0)),
        Primitive::Circle {
            center,
            radius: 2.0,
        },
    ];
    assert_eq!(solve(&exact, &[constraint]).unwrap_err(), Refusal::OpenProfile);
}

// A distance dimension moves the free endpoint away from its anchor along the
// seeded bearing; the anchor stays. Direction and which point moves are part
// of the contract, not just the final distance.
#[test]
fn distance_moves_free_endpoint_forward_and_keeps_anchor() {
    for goal in 2..=40 {
        let goal = goal as f64;
        let a = p("a", 1.0, 1.0);
        let b = p("b", 2.0, 1.0);
        let c = p("c", 2.0, 4.0);
        let d = p("d", 1.0, 4.0);
        let edges = [line(a, b), line(b, c), line(c, d), line(d, a)];
        let solved = solve(
            &edges,
            &[Constraint::Distance {
                a: "a",
                b: "b",
                mm: goal,
            }],
        )
        .unwrap();
        assert_eq!(solved.solved_points["a"], p2(1.0, 1.0), "anchor unmoved");
        assert_eq!(solved.solved_points["b"], p2(1.0 + goal, 1.0), "forward");
        assert_eq!(solved.loops[0].orientation, Sign::Positive);
    }
}
