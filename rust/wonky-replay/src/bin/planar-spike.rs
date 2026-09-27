//! planar-spike run <union|subtract> <request.bin> [--propagate]        -> result JSON on stdout
//! planar-spike bench <union|subtract> <request.bin> <n> [--propagate] [--threads N] [--f64-limits] -> timing JSON (first call + n warm calls)
use std::time::Instant;
use wonky_ops::planar::{boolean, boolean::Variant, model::BoolResult, wire};

fn main() {
    let t0 = Instant::now();
    let mut args: Vec<String> = std::env::args().collect();
    let variant = if args.iter().any(|a| a == "--propagate") { Variant::Propagate } else { Variant::Same };
    args.retain(|a| a != "--propagate");
    if args.iter().any(|a| a == "--f64-limits") {
        wonky_ops::planar::num::use_f64_limits(true);
        args.retain(|a| a != "--f64-limits");
    }
    if let Some(i) = args.iter().position(|a| a == "--threads") {
        let n: usize = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(1);
        args.drain(i..i + 2);
        if n > 1 {
            rayon::ThreadPoolBuilder::new().num_threads(n).build_global().expect("rayon pool");
            wonky_ops::planar::arrangement::THREADS.store(n, std::sync::atomic::Ordering::Relaxed);
        }
    }
    if args.len() < 4 {
        eprintln!("usage: planar-spike run|bench union|subtract <request.bin> [n]");
        std::process::exit(2);
    }
    let subtraction = match args[2].as_str() {
        "union" => false,
        "subtract" => true,
        other => {
            eprintln!("unknown operation {other}");
            std::process::exit(2);
        }
    };
    let op = |r: &wire::Request| -> BoolResult { boolean::run(r, subtraction, variant) };
    let bytes = std::fs::read(&args[3]).unwrap_or_else(|e| {
        eprintln!("cannot read {}: {e}", args[3]);
        std::process::exit(2);
    });
    let t_read = Instant::now();
    let words = wire::words_from_bytes(&bytes);
    let req = wire::decode_request(&words).unwrap_or_else(|e| {
        eprintln!("malformed request: {}", e.0);
        std::process::exit(1);
    });
    let t_decoded = Instant::now();
    match args[1].as_str() {
        "run" => {
            let r = op(&req);
            let t_done = Instant::now();
            println!("{}", wire::result_json(&r));
            let phases: Vec<String> = boolean::last_phases().iter().map(|(n, us)| format!("\"{n}\":{us:.1}")).collect();
            eprintln!(
                "{{\"processToReadUs\":{:.1},\"decodeUs\":{:.1},\"opUs\":{:.1},\"phasesUs\":{{{}}},\"undecidedTotal\":{}}}",
                (t_read - t0).as_secs_f64() * 1e6,
                (t_decoded - t_read).as_secs_f64() * 1e6,
                (t_done - t_decoded).as_secs_f64() * 1e6,
                phases.join(","),
                wonky_ops::planar::num::undecided_total()
            );
        }
        "bench" => {
            let n: usize = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);
            let f0 = Instant::now();
            let first = op(&req);
            let first_us = f0.elapsed().as_secs_f64() * 1e6;
            let mut samples = Vec::with_capacity(n);
            for _ in 0..n {
                let s = Instant::now();
                // decode is part of the kernel call, as for the Bend native entry
                let req = wire::decode_request(&words).unwrap();
                let r = op(&req);
                samples.push(s.elapsed().as_secs_f64() * 1e6);
                assert_eq!(r, first, "nondeterministic result");
            }
            let mut sorted = samples.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let median = sorted[sorted.len() / 2];
            println!(
                "{{\"firstUs\":{:.1},\"n\":{},\"medianUs\":{:.1},\"minUs\":{:.1},\"maxUs\":{:.1},\"samplesUs\":{:?}}}",
                first_us, n, median, sorted[0], sorted[sorted.len() - 1], samples.iter().map(|x| (x * 10.0).round() / 10.0).collect::<Vec<_>>()
            );
        }
        other => {
            eprintln!("unknown command {other}");
            std::process::exit(2);
        }
    }
}
