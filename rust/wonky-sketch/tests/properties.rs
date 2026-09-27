// Local test-only SHA-256: validates the bytes actually parsed, independent of
// the provenance comment in the fixture and without a network dependency.
fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut padded = input.to_vec();
    let length = (input.len() as u64).wrapping_mul(8);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&length.to_be_bytes());
    for chunk in padded.chunks_exact(64) {
        let mut words = [0u32; 64];
        for (i, bytes) in chunk.chunks_exact(4).enumerate() {
            words[i] = u32::from_be_bytes(bytes.try_into().unwrap());
        }
        for i in 16..64 {
            let a = words[i - 15].rotate_right(7)
                ^ words[i - 15].rotate_right(18)
                ^ (words[i - 15] >> 3);
            let b = words[i - 2].rotate_right(17)
                ^ words[i - 2].rotate_right(19)
                ^ (words[i - 2] >> 10);
            words[i] = words[i - 16]
                .wrapping_add(a)
                .wrapping_add(words[i - 7])
                .wrapping_add(b);
        }
        let mut v = state;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let choose = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(choose)
                .wrapping_add(K[i])
                .wrapping_add(words[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let majority = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(majority);
            v = [
                t1.wrapping_add(t2),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t1),
                v[4],
                v[5],
                v[6],
            ];
        }
        for i in 0..8 {
            state[i] = state[i].wrapping_add(v[i]);
        }
    }
    let mut out = [0; 32];
    for (chunk, word) in out.chunks_exact_mut(4).zip(state) {
        chunk.copy_from_slice(&word.to_be_bytes());
    }
    out
}

use wonky_num::{p2, Sign};
use wonky_sketch::{solve, solve_ordered_profile, Constraint, Point, Primitive, Refusal};

fn p<'a>(key: &'a str, x: f64, y: f64) -> Point<'a> {
    Point { key, xy: p2(x, y) }
}
fn line<'a>(a: Point<'a>, b: Point<'a>) -> Primitive<'a> {
    Primitive::Line { start: a, end: b }
}

// Deterministic property sweep over translated, scaled, and cyclically rotated
// instances of the exact r20RectangleProfile construction in studios/datums.fs.
#[test]
fn rectangles_keep_orientation_and_exact_endpoints() {
    for i in 1..=512 {
        let x = (i as f64 % 29.0) - 15.0;
        let y = (i as f64 % 31.0) - 16.0;
        let w = 1.0 + (i % 17) as f64;
        let h = 1.0 + (i % 23) as f64;
        let nodes = [
            p("a", x, y),
            p("b", x + w, y),
            p("c", x + w, y + h),
            p("d", x, y + h),
        ];
        let original: Vec<_> = (0..4).map(|j| line(nodes[j], nodes[(j + 1) % 4])).collect();
        for reverse in [false, true] {
            let mut edges = original.clone();
            if reverse {
                edges = (0..4).map(|j| line(nodes[(j + 1) % 4], nodes[j])).collect();
            }
            edges.rotate_left(i % 4);
            let profile = solve(&edges, &[]).expect("constructed rectangle");
            assert_eq!(profile.loops.len(), 1);
            assert_eq!(profile.loops[0].segment_indices.len(), 4);
            assert_eq!(
                profile.loops[0].orientation,
                if reverse {
                    Sign::Negative
                } else {
                    Sign::Positive
                }
            );
            // Output retains construction coordinates without snapping or interpolation.
            for edge in &edges {
                let Primitive::Line { start, end } = edge else {
                    unreachable!()
                };
                assert!(nodes.iter().any(|n| n.key == start.key && n.xy == start.xy));
                assert!(nodes.iter().any(|n| n.key == end.key && n.xy == end.xy));
            }
        }
    }
}

#[test]
fn near_closure_is_never_welded() {
    for i in 1..=256 {
        let x = (i % 19) as f64;
        let y = (i % 13) as f64;
        let a = p("a", x, y);
        let b = p("b", x + 4.0, y);
        let c = p("c", x + 4.0, y + 3.0);
        let d = p("d", x, y + 3.0);
        // 1e-12 mm gap: exact predicate does not turn it into coincidence.
        let gap = p("gap", x + 1e-12, y);
        assert_eq!(
            solve(&[line(a, b), line(b, c), line(c, d), line(d, gap)], &[]).unwrap_err(),
            Refusal::OpenProfile
        );
        let solved = solve(
            &[line(a, b), line(b, c), line(c, d), line(d, gap)],
            &[Constraint::Coincident { a: "gap", b: "a" }],
        )
        .unwrap();
        assert_eq!(solved.solved_points["gap"], solved.solved_points["a"]);
    }
}

#[test]
fn area_sign_survives_large_translation_cancellation() {
    for exponent in 44..=51 {
        let k = (1u64 << exponent) as f64;
        let nodes = [
            p("a", k, k),
            p("b", k + 1.0, k),
            p("c", k + 1.0, k + 1.0),
            p("d", k, k + 1.0),
        ];
        for offset in 0..4 {
            let mut edges: Vec<_> = (0..4).map(|j| line(nodes[j], nodes[(j + 1) % 4])).collect();
            edges.rotate_left(offset);
            assert_eq!(
                solve(&edges, &[]).unwrap().loops[0].orientation,
                Sign::Positive
            );
        }
    }
}

#[test]
fn exact_constraints_are_not_rounded() {
    for i in 1..=200 {
        let a = p("a", i as f64, 0.0);
        let b = p("b", i as f64 + 3.0, 4.0);
        let c = p("c", i as f64 + 3.0, 0.0);
        let profile = [line(a, c), line(c, b), line(b, a)];
        assert!(solve(
            &profile,
            &[Constraint::Distance {
                a: "a",
                b: "b",
                mm: 5.0
            }]
        )
        .is_ok());
        assert_eq!(
            solve(
                &profile,
                &[Constraint::Distance {
                    a: "a",
                    b: "b",
                    mm: 5.0 + 1e-12
                }]
            )
            .unwrap_err(),
            Refusal::NumericDecision
        );
    }
}

#[test]
fn constructed_tangency_requires_exact_radius_and_perpendicularity() {
    for i in 1..=128 {
        let x = (i % 13) as f64;
        let center = p("o", x, 0.0);
        let contact = p("a", x, 2.0);
        let end = p("b", x + 3.0, 2.0);
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
        // The positive tangent is certified, but an isolated line plus a
        // circle does not enclose a region and must still refuse.
        assert_eq!(
            solve(&entities, &[constraint]).unwrap_err(),
            Refusal::OpenProfile
        );
        let displaced = [
            line(p("a", x + 1e-12, 2.0), end),
            Primitive::Circle {
                center,
                radius: 2.0,
            },
        ];
        assert_eq!(
            solve(&displaced, &[constraint]).unwrap_err(),
            Refusal::Overconstrained
        );
    }
}

#[test]
fn crossings_refuse_and_constructed_arcs_have_certified_orientation() {
    let a = p("a", 0.0, 0.0);
    let b = p("b", 2.0, 2.0);
    let c = p("c", 0.0, 2.0);
    let d = p("d", 2.0, 0.0);
    assert_eq!(
        solve(&[line(a, b), line(b, c), line(c, d), line(d, a)], &[]).unwrap_err(),
        Refusal::UnsupportedIntersection
    );
    let arc = Primitive::Arc3 {
        start: a,
        mid: p2(1.0, -1.0),
        end: d,
    };
    assert_eq!(
        solve(&[arc, line(d, c), line(c, a)], &[]).unwrap().loops[0].orientation,
        Sign::Positive
    );
}

#[test]
fn r20_circle_and_hybrid_arc_source_shapes() {
    let circle = Primitive::Circle {
        center: p("origin", 0.0, 0.0),
        radius: 1.7,
    };
    let profile = solve(&[circle], &[]).unwrap();
    assert_eq!(profile.loops[0].orientation, Sign::Positive);
    assert_eq!(profile.loops[0].segment_indices, vec![0]);
    // Exact excerpt of the frozen R20 FeatureScript source, packaged with the
    // crate so rust-only offline exports can compile the test. Provenance is
    // recorded in tests/data/m3-hybrid-arcs.fs; no hand-transcribed triples.
    assert_eq!(
        sha256(b"abc"),
        [
            0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
            0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
            0xf2, 0x00, 0x15, 0xad,
        ]
    );
    let fs = include_str!("data/m3-hybrid-arcs.fs");
    // Freeze the complete consumed fixture, not merely its mutable source-SHA comment.
    assert_eq!(
        sha256(fs.as_bytes()),
        [
            0x48, 0xfd, 0x3e, 0xe1, 0x05, 0x68, 0x7c, 0x86, 0x50, 0x30, 0x11, 0x5a, 0xce, 0xfc,
            0xda, 0x06, 0x06, 0x78, 0x6a, 0xbd, 0x09, 0x03, 0x78, 0xa1, 0xd0, 0x59, 0xbd, 0x00,
            0x52, 0xef, 0x62, 0xe8,
        ]
    );
    // SHA-256 of the exact G3 M3_HYBRID_ARCS block (including closing newline)
    // in fixtures/r20-modules/studios/context.fs, not of a mutable comment.
    let block = format!(
        "const M3_HYBRID_ARCS = [{}];\n",
        fs.split("const M3_HYBRID_ARCS = [")
            .nth(1)
            .expect("arc block")
            .split("];\n")
            .next()
            .expect("closing bracket")
    );
    assert_eq!(
        sha256(block.as_bytes()),
        [
            0x63, 0x0c, 0xd6, 0xd9, 0x0b, 0xa2, 0x87, 0x4f, 0xb2, 0x7f, 0x8e, 0x5d, 0xb7, 0x99,
            0x96, 0xba, 0x10, 0xae, 0xf9, 0x35, 0x4b, 0x41, 0x78, 0x5e, 0xf6, 0xa8, 0x0c, 0xbf,
            0x09, 0x9e, 0x88, 0xf6
        ]
    );
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
    // G3 freezes identical interpreter f64 coordinates at every joint.
    // Distinct endpoint keys alone are insufficient for solve(), whereas the
    // ordered adapter may certify incidence from exact coordinate equality.
    let keys: Vec<_> = (0..24).map(|i| format!("endpoint-{i}")).collect();
    let arcs: Vec<_> = (0..12)
        .map(|i| Primitive::Arc3 {
            start: p(&keys[2 * i], numbers[6 * i], numbers[6 * i + 1]),
            mid: p2(numbers[6 * i + 2], numbers[6 * i + 3]),
            end: p(&keys[2 * i + 1], numbers[6 * i + 4], numbers[6 * i + 5]),
        })
        .collect();
    assert_eq!(solve(&arcs, &[]).unwrap_err(), Refusal::OpenProfile);
    for i in 0..12 {
        let a = &numbers[6 * i + 4..6 * i + 6];
        let j = (i + 1) % 12;
        assert_eq!(a, &numbers[6 * j..6 * j + 2], "G3 joint {i} differs");
    }
    let solved = solve_ordered_profile(&arcs).expect("exact G3 M3 joints");
    assert_eq!(solved.loops.len(), 1);
    let boundary = &solved.loops[0];
    assert_eq!(boundary.segment_indices.len(), arcs.len());
    // Every original M3 arc must appear once, not just the right total count.
    // The ordered adapter's emitted boundary must also follow the actual joints.
    let mut used = boundary.segment_indices.clone();
    used.sort_unstable();
    assert_eq!(used, (0..arcs.len()).collect::<Vec<_>>());
    assert_eq!(boundary.keys.len(), arcs.len());
    assert_eq!(boundary.orientation, Sign::Positive);
    for (position, &index) in boundary.segment_indices.iter().enumerate() {
        let Primitive::Arc3 { start, end, .. } = arcs[index] else {
            unreachable!()
        };
        assert_eq!(solved.solved_points[start.key], start.xy, "M3 start changed for segment {index}");
        assert_eq!(solved.solved_points[end.key], end.xy, "M3 end changed for segment {index}");
        assert_eq!(
            solved.solved_points[boundary.keys[position]],
            solved.solved_points[start.key]
        );
        assert_eq!(
            solved.solved_points[end.key],
            solved.solved_points[boundary.keys[(position + 1) % arcs.len()]],
            "M3 boundary joint after segment {index}"
        );
        assert_eq!(
            solved.solved_points[keys[2 * index + 1].as_str()],
            solved.solved_points[keys[2 * ((index + 1) % arcs.len())].as_str()]
        );
    }
}

#[test]
fn construction_incidence_solves_seed_gaps_without_epsilon_weld() {
    for i in 1..=128 {
        let shift = i as f64;
        let a = p("a", shift, 0.0);
        let b = p("b", shift + 4.0, 0.0);
        let c = p("c", shift + 4.0, 3.0);
        let d = p("d", shift, 3.0);
        let gap = p("gap", shift + 1e-12, 0.0);
        let edges = [line(a, b), line(b, c), line(c, d), line(d, gap)];
        assert_eq!(solve(&edges, &[]).unwrap_err(), Refusal::OpenProfile);
        let solved = solve(&edges, &[Constraint::Coincident { a: "gap", b: "a" }]).unwrap();
        assert_eq!(solved.loops[0].orientation, Sign::Positive);
        assert_eq!(solved.solved_points["gap"], solved.solved_points["a"]);
        let far = p("gap", shift + 2.0, 0.0);
        // Explicit incidence is topological, independent of any spatial epsilon.
        assert_eq!(
            solve(
                &[line(a, b), line(b, c), line(c, d), line(d, far)],
                &[Constraint::Coincident { a: "gap", b: "a" }]
            )
            .unwrap()
            .loops[0]
                .orientation,
            Sign::Positive
        );
    }
}

#[test]
fn dimensions_reposition_axis_aligned_free_endpoints_and_refuse_conflicts() {
    for distance in 2..=96 {
        let goal = distance as f64;
        let a = p("a", 0.0, 0.0);
        let b = p("b", 1.0, 0.0);
        let c = p("c", 1.0, 3.0);
        let d = p("d", 0.0, 3.0);
        let edges = [line(a, b), line(b, c), line(c, d), line(d, a)];
        let constraints = [Constraint::Distance {
            a: "a",
            b: "b",
            mm: goal,
        }];
        let solved = solve(&edges, &constraints).unwrap();
        assert_eq!(solved.solved_points["b"].x, goal);
        assert_eq!(solved.loops[0].orientation, Sign::Positive);
        let conflicting = [
            constraints[0],
            Constraint::Distance {
                a: "a",
                b: "b",
                mm: goal + 1.0,
            },
        ];
        assert_eq!(
            solve(&edges, &conflicting).unwrap_err(),
            Refusal::Overconstrained
        );
    }
}

#[test]
fn arc_orientation_inverts_under_reflection_and_reversal() {
    for radius in 1..=48 {
        let r = radius as f64;
        let a = p("a", r, 0.0);
        let b = p("b", 0.0, r);
        let c = p("c", -r, 0.0);
        let forward = [
            Primitive::Arc3 {
                start: a,
                mid: p2(r, r),
                end: b,
            },
            line(b, c),
            line(c, a),
        ];
        // Midpoint is not on the same radius as endpoints, intentionally:
        // every arc here is an actual three-point circular construction.
        assert_eq!(
            solve(&forward, &[]).unwrap().loops[0].orientation,
            Sign::Positive
        );
        let backward = [
            Primitive::Arc3 {
                start: b,
                mid: p2(r, r),
                end: a,
            },
            line(a, c),
            line(c, b),
        ];
        assert_eq!(
            solve(&backward, &[]).unwrap().loops[0].orientation,
            Sign::Negative
        );
        let reflected = [
            Primitive::Arc3 {
                start: p("a", -r, 0.0),
                mid: p2(-r, r),
                end: b,
            },
            line(b, p("c", r, 0.0)),
            line(p("c", r, 0.0), p("a", -r, 0.0)),
        ];
        assert_eq!(
            solve(&reflected, &[]).unwrap().loops[0].orientation,
            Sign::Negative
        );
    }
}

#[test]
fn arc_crossings_refuse_and_complementary_semicircles_close() {
    for r in 1..=48 {
        let r = r as f64;
        let a = p("a", r, 0.0);
        let b = p("b", -r, 0.0);
        let ring = [
            Primitive::Arc3 {
                start: a,
                mid: p2(0.0, r),
                end: b,
            },
            Primitive::Arc3 {
                start: b,
                mid: p2(0.0, -r),
                end: a,
            },
        ];
        assert_eq!(
            solve(&ring, &[]).unwrap().loops[0].orientation,
            Sign::Positive
        );
        let reversed = [
            Primitive::Arc3 {
                start: b,
                mid: p2(0.0, r),
                end: a,
            },
            Primitive::Arc3 {
                start: a,
                mid: p2(0.0, -r),
                end: b,
            },
        ];
        assert_eq!(
            solve(&reversed, &[]).unwrap().loops[0].orientation,
            Sign::Negative
        );
        let overlapping = [
            ring[0],
            Primitive::Arc3 {
                start: b,
                mid: p2(0.0, r),
                end: a,
            },
        ];
        assert_eq!(
            solve(&overlapping, &[]).unwrap_err(),
            Refusal::UnsupportedIntersection
        );
        let c = p("c", r, 2.0 * r);
        let d = p("d", -r, 2.0 * r);
        let crossing = [
            Primitive::Arc3 {
                start: p("a", -r, 0.0),
                mid: p2(0.0, 3.0 * r),
                end: p("b", r, 0.0),
            },
            line(p("b", r, 0.0), c),
            line(c, d),
            line(d, p("a", -r, 0.0)),
        ];
        assert_eq!(
            solve(&crossing, &[]).unwrap_err(),
            Refusal::UnsupportedIntersection
        );
        // Circles centred at (0,0) and (6r,0), radius 5r, cross at
        // (3r,+/-4r). The upper point is a shared construction endpoint;
        // the lower crossing must not become a second, hidden intersection.
        let shared = p("s", 3.0 * r, 4.0 * r);
        let right = p("t", 5.0 * r, 0.0);
        let far = p("u", 11.0 * r, 0.0);
        let double_crossing = [
            Primitive::Arc3 {
                start: shared,
                mid: p2(0.0, -5.0 * r),
                end: right,
            },
            line(right, far),
            Primitive::Arc3 {
                start: far,
                mid: p2(6.0 * r, -5.0 * r),
                end: shared,
            },
        ];
        assert_eq!(
            solve(&double_crossing, &[]).unwrap_err(),
            Refusal::UnsupportedIntersection
        );
    }
}

#[test]
fn ordered_profile_refuses_real_submicron_gaps() {
    let gap = 2f64.powi(-40);
    let edges = [
        line(p("a", 0.0, 0.0), p("b", 2.0, 0.0)),
        line(p("c", 2.0 + gap, 0.0), p("d", 2.0, 2.0)),
        line(p("e", 2.0, 2.0), p("f", 0.0, 2.0)),
        line(p("g", 0.0, 2.0), p("h", 0.0, 0.0)),
    ];
    assert_eq!(
        solve_ordered_profile(&edges).unwrap_err(),
        Refusal::OpenProfile
    );
    let closed = [
        line(p("a", 0.0, 0.0), p("b", 2.0, 0.0)),
        line(p("c", 2.0, 0.0), p("d", 2.0, 2.0)),
        edges[2],
        edges[3],
    ];
    assert_eq!(
        solve_ordered_profile(&closed).unwrap().loops[0].orientation,
        Sign::Positive
    );
    // Shared construction key is an independent identity witness even if seeds differ.
    let shared_key = [
        edges[0],
        line(p("b", 2.0 + gap, 0.0), p("d", 2.0, 2.0)),
        edges[2],
        edges[3],
    ];
    assert_eq!(
        solve_ordered_profile(&shared_key).unwrap().loops[0].orientation,
        Sign::Positive
    );
}

#[test]
fn ordered_profile_rejects_every_representable_gap() {
    for n in 1..=128 {
        let gap = n as f64 * 1e-7;
        let edges = [
            line(p("a", 0.0, 0.0), p("b", 2.0, 0.0)),
            line(p("c", 2.0 + gap, 0.0), p("d", 2.0, 2.0)),
            line(p("e", 2.0, 2.0), p("f", 0.0, 2.0)),
            line(p("g", 0.0, 2.0), p("h", 0.0, 0.0)),
        ];
        let result = solve_ordered_profile(&edges);
        assert_eq!(result.unwrap_err(), Refusal::OpenProfile, "gap={gap}");
    }
}

#[test]
fn shared_construction_key_survives_rounded_transform_seeds() {
    for i in 1..=128 {
        let offset = (i % 17) as f64;
        let a = p("a", offset, 0.0);
        let b = p("b", offset + 4.0, 0.0);
        let c = p("c", offset + 4.0, 3.0);
        let d = p("d", offset, 3.0);
        // A shared construction key, not proximity, certifies this incidence.
        let rounded = p("a", offset + 1e-12, 0.0);
        let result = solve(&[line(a, b), line(b, c), line(c, d), line(d, rounded)], &[]).unwrap();
        assert_eq!(result.loops[0].orientation, Sign::Positive);
        assert_eq!(result.solved_points["a"], a.xy);
    }
}

#[test]
fn semicircle_diameter_shares_both_constructed_endpoints() {
    for radius in 1..=48 {
        let r = radius as f64;
        let a = p("a", -r, 0.0);
        let b = p("b", r, 0.0);
        let profile = [
            Primitive::Arc3 {
                start: b,
                mid: p2(0.0, r),
                end: a,
            },
            line(a, b),
        ];
        assert_eq!(
            solve(&profile, &[]).unwrap().loops[0].orientation,
            Sign::Positive
        );
        let inverse = [
            line(b, a),
            Primitive::Arc3 {
                start: a,
                mid: p2(0.0, r),
                end: b,
            },
        ];
        assert_eq!(
            solve(&inverse, &[]).unwrap().loops[0].orientation,
            Sign::Negative
        );
    }
}

#[test]
fn diagonal_seed_bearing_solves_representable_distances() {
    for multiplier in 1..=96 {
        let a = p("a", 0.0, 0.0);
        let b = p("b", 3.0, 4.0);
        let c = p("c", 0.0, 4.0);
        let edges = [line(a, b), line(b, c), line(c, a)];
        let profile = solve(
            &edges,
            &[Constraint::Distance {
                a: "a",
                b: "b",
                mm: 5.0 * multiplier as f64,
            }],
        )
        .unwrap();
        assert_eq!(
            profile.solved_points["b"],
            p2(3.0 * multiplier as f64, 4.0 * multiplier as f64)
        );
        assert_eq!(profile.loops[0].orientation, Sign::Positive);
    }
}
