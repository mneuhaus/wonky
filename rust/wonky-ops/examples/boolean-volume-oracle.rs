//! Test-only bridge. Refinement sees only operand WC0 words. Optional live
//! result observations are read after the enclosure has been fixed.
use num_traits::{ToPrimitive, Zero};
use std::io::{self, BufRead};
use wonky_contract::SurfaceGeometry;
use wonky_ops::{analytic, interference_proof, placement::Placement};
use wonky_oracle::{
    volume::{self, Membership, Operation},
    R,
};
struct Operand {
    shape: Option<interference_proof::Shape>,
    bounds: volume::Cell,
    ball: Option<(wonky_geom::frame::Frame, wonky_oracle::P3, R)>,
}
impl Operand {
    fn classify(&self, cell: &volume::Cell) -> Result<Membership, wonky_ops::polyhedron::Refused> {
        if (0..3).any(|k| cell[1][k] <= self.bounds[0][k] || cell[0][k] >= self.bounds[1][k]) {
            return Ok(Membership::Outside);
        }
        if let Some((inverse, center, radius)) = &self.ball {
            let local = interference_proof::mapped_box(cell, inverse);
            return Ok(volume::sphere_membership(&local, center, radius));
        }
        let (inside, outside) = self.shape.as_ref().unwrap().classify_box(cell)?;
        assert!(!(inside && outside), "oracle/inconsistent-classifier");
        Ok(if inside {
            Membership::Inside
        } else if outside {
            Membership::Outside
        } else {
            Membership::Boundary
        })
    }
}
// The tested result is built afresh by production Boolean, after the oracle
// enclosure is fixed. Never spend time on unrelated B-spline area/length.
fn reported_volume(words: &[u32]) -> (R, bool) {
    let checked = wonky_wire::v3::decode(words).expect("oracle/result-wire");
    let solid = analytic::audit(&checked).expect("oracle/result-audit");
    if let analytic::Solid::Planar(a) | analytic::Solid::Model(a, _) = &solid {
        if let Some(v) = a.volume_exact_mm3().expect("oracle/result-exact-volume") {
            return (v, true);
        }
        return (
            wonky_oracle::binary64(a.volume_mm3().expect("oracle/result-volume")).unwrap(),
            false,
        );
    }
    if let analytic::Solid::PrismStack(p) = &solid {
        return (
            wonky_oracle::binary64(p.volume().expect("oracle/result-volume").m).unwrap(),
            false,
        );
    }
    let json = solid.measure(None, &[]).expect("oracle/result-measure");
    let start = json.find("\"volumeMm3\":").expect("oracle/missing-volume") + 12;
    let value = json[start..]
        .split([',', '}'])
        .next()
        .unwrap()
        .parse::<f64>()
        .expect("oracle/volume-number");
    (wonky_oracle::binary64(value).unwrap(), false)
}
fn check_case(case: usize, line: &str) -> String {
    let case_start = std::time::Instant::now();
    let mut xs = line.split_whitespace();
    let mut number = || {
        xs.next()
            .expect("oracle/input-ended")
            .parse::<u32>()
            .expect("oracle/input-number")
    };
    let op = match number() {
        0 => Operation::Union,
        1 => Operation::Difference,
        2 => Operation::Intersection,
        _ => panic!("oracle/operation"),
    };
    let budget = number() as usize;
    let n = number();
    assert!(n > 0, "oracle/no-operands");
    let mut solids = Vec::new();
    let operands = (0..n)
        .map(|_| {
            let len = number();
            let words = (0..len).map(|_| number()).collect::<Vec<_>>();
            let checked = wonky_wire::v3::decode(&words).expect("oracle/operand-wire");
            let solid = analytic::audit(&checked).expect("oracle/operand-audit");
            let body = checked.body();
            let ball = if body.surfaces.len() == 1 {
                if let SurfaceGeometry::Sphere { origin, radius, .. } = &body.surfaces[0].geometry {
                    Some((
                        Placement::from_frames(body, body.surfaces[0].frame)
                            .expect("oracle/sphere-frame")
                            .exact_frame()
                            .expect("oracle/sphere-exact-frame")
                            .inverse(),
                        origin.map(|v| wonky_oracle::binary64(v.get()).unwrap()),
                        wonky_oracle::binary64(radius.get()).unwrap(),
                    ))
                } else {
                    None
                }
            } else {
                None
            };
            let (shape, bounds) = if let Some((inverse, center, radius)) = &ball {
                let f = inverse.inverse();
                let corners = (0..8)
                    .map(|mask| {
                        f.point(&std::array::from_fn(|k| {
                            if mask & (1 << k) == 0 {
                                &center[k] - radius
                            } else {
                                &center[k] + radius
                            }
                        }))
                    })
                    .collect::<Vec<_>>();
                let bounds = std::array::from_fn(|side| {
                    std::array::from_fn(|k| {
                        let xs = corners.iter().map(|p| p[k].clone());
                        if side == 0 {
                            xs.min().unwrap()
                        } else {
                            xs.max().unwrap()
                        }
                    })
                });
                (None, bounds)
            } else {
                let shape = interference_proof::operand_shape(&solid)
                    .unwrap_or_else(|e| panic!("oracle/operand-classifier case={case}: {e:?}"));
                let bounds = shape.bounds().clone();
                (Some(shape), bounds)
            };
            solids.push(solid);
            Operand {
                shape,
                ball,
                bounds,
            }
        })
        .collect::<Vec<_>>();
    let root = std::array::from_fn(|side| {
        std::array::from_fn(|k| {
            let values = operands.iter().map(|s| s.bounds[side][k].clone());
            if side == 0 {
                values.min().unwrap()
            } else {
                values.max().unwrap()
            }
        })
    });
    let mut cuts: [Vec<R>; 3] = std::array::from_fn(|_| vec![]);
    for s in &operands {
        if let Some(shape) = &s.shape {
            shape.cuts(&mut cuts);
        } else {
            for k in 0..3 {
                cuts[k].extend([s.bounds[0][k].clone(), s.bounds[1][k].clone()]);
            }
        }
    }
    for xs in &mut cuts {
        xs.sort();
        xs.dedup();
    }
    let operand_seconds = case_start.elapsed().as_secs_f64();
    let refinement_start = std::time::Instant::now();
    let enclosure = volume::enclose(root, &cuts, budget, |cell| {
        op.classify_lazy(operands.len(), |i| operands[i].classify(cell))
    })
    .expect("oracle/membership-refusal");
    let scale = R::from_integer(1_000_000_000u64.into());
    let lo = &enclosure.lower * &scale;
    let hi = &enclosure.upper * &scale;
    assert!(lo >= R::zero() && hi >= lo);
    let enclosure_only = operands
        .iter()
        .filter(|s| s.ball.is_none() && !s.shape.as_ref().unwrap().has_membership())
        .count();
    let refinement_seconds = refinement_start.elapsed().as_secs_f64();
    // Optional live frontend observation is read only AFTER refinement.
    // It cannot influence any operand predicate, cut, budget or enclosure.
    if let Some(marker) = xs.next() {
        assert_eq!(marker, "observed", "oracle/trailing-input");
        let numerator = xs
            .next()
            .unwrap()
            .parse()
            .expect("oracle/observed-numerator");
        let denominator = xs
            .next()
            .unwrap()
            .parse()
            .expect("oracle/observed-denominator");
        let actual = R::new(numerator, denominator);
        let exact: bool = xs.next().unwrap().parse().expect("oracle/observed-exact");
        assert!(xs.next().is_none(), "oracle/trailing-input");
        return format!(
            "{} {} {} {} {} {} {} {} {} {} {} {} {} {}",
            lo.numer(),
            lo.denom(),
            hi.numer(),
            hi.denom(),
            enclosure.classified,
            enclosure.boundary_cells,
            enclosure.converged,
            enclosure_only,
            actual.numer(),
            actual.denom(),
            exact,
            operand_seconds,
            refinement_seconds,
            0.
        );
    }
    let result_start = std::time::Instant::now();
    let opcode = match op {
        Operation::Union => 0,
        Operation::Difference => 1,
        Operation::Intersection => 2,
    };
    // Use the same production constructor as host::OP_BOOLEAN. Operands
    // were already decoded and audited above; do not replay those expensive
    // audits. Returned bodies still take the normal wire/geometry audit.
    let result = analytic::boolean(
        wonky_contract::BodyKey {
            id: [case as u32, 0, 0, 0],
            revision: 0,
        },
        opcode,
        &solids,
    )
    .unwrap_or_else(|e| panic!("oracle/live-boolean-refused case={case}: {e:?}"));
    let mut actual = R::zero();
    let mut exact = true;
    let mut f64_sum = 0.;
    for (index, mut body) in result.into_iter().enumerate() {
        body.key.revision = index as u32;
        let words = wonky_wire::v3::encode(&body).expect("oracle/result-wire");
        let (v, e) = reported_volume(&words);
        f64_sum += v.to_f64().expect("oracle/volume-range");
        actual += v;
        exact &= e;
    }
    if !exact {
        actual = wonky_oracle::binary64(f64_sum).expect("oracle/volume-range");
    }
    format!(
        "{} {} {} {} {} {} {} {} {} {} {} {} {} {}",
        lo.numer(),
        lo.denom(),
        hi.numer(),
        hi.denom(),
        enclosure.classified,
        enclosure.boundary_cells,
        enclosure.converged,
        enclosure_only,
        actual.numer(),
        actual.denom(),
        exact,
        operand_seconds,
        refinement_seconds,
        result_start.elapsed().as_secs_f64()
    )
}
fn main() {
    // Independent cases share no result or classifier state. Keep output in
    // input order, and cap parallelism under the lane/remote runner budget.
    let jobs = std::env::var("WONKY_ORACLE_JOBS")
        .or_else(|_| std::env::var("WONKY_LANE_JOBS"))
        .map(|s| s.parse::<usize>().expect("oracle/invalid-jobs"))
        .unwrap_or_else(|_| std::thread::available_parallelism().map_or(1, |n| n.get().min(5)));
    assert!(jobs > 0, "oracle/invalid-jobs");
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(jobs)
        .build()
        .expect("oracle/thread-pool");
    let lines: Vec<_> = io::stdin()
        .lock()
        .lines()
        .map(|line| line.expect("oracle/input-io"))
        .collect();
    // Logical batches can exercise different concurrency limits concurrently
    // in this ONE bounded pool. Each worker handles its batch serially, so a
    // batch requesting one/two workers really has at most one/two active cases.
    // Every repeated case executes fresh predicates and production Boolean.
    let batches = std::env::var("WONKY_ORACLE_BATCHES")
        .map(|spec| {
            spec.split(',')
                .map(|batch| {
                    let (count, workers) = batch.split_once(':').expect("oracle/invalid-batch");
                    let count = count.parse::<usize>().expect("oracle/invalid-batch");
                    let workers = if workers == "all" {
                        jobs
                    } else {
                        workers.parse::<usize>().expect("oracle/invalid-batch")
                    };
                    assert!(count > 0 && workers > 0, "oracle/invalid-batch");
                    (count, workers)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|_| vec![(lines.len(), jobs)]);
    assert_eq!(
        batches.iter().map(|b| b.0).sum::<usize>(),
        lines.len(),
        "oracle/batch-length"
    );
    let rows = std::sync::Mutex::new(vec![None; lines.len()]);
    pool.scope(|scope| {
        let mut start = 0;
        for (count, workers) in batches {
            let end = start + count;
            if workers >= jobs {
                // The pool itself enforces this batch's cap. Queue individual
                // cases so idle threads can steal work after a narrow batch
                // ends, rather than leaving a late-started strided worker alone.
                for case in start..end {
                    let lines = &lines;
                    let rows = &rows;
                    scope.spawn(move |_| {
                        let row = check_case(case, &lines[case]);
                        rows.lock().expect("oracle/output-lock")[case] = Some(row);
                    });
                }
            } else {
                for worker in 0..workers.min(count) {
                    let lines = &lines;
                    let rows = &rows;
                    scope.spawn(move |_| {
                        for case in (start + worker..end).step_by(workers) {
                            let row = check_case(case, &lines[case]);
                            rows.lock().expect("oracle/output-lock")[case] = Some(row);
                        }
                    });
                }
            }
            start = end;
        }
    });
    for row in rows.into_inner().expect("oracle/output-lock") {
        println!("{}", row.expect("oracle/missing-row"));
    }
}
