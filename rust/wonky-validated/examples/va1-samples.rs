//! Streaming public-API driver for the independent Python oracle. No libm
//! result is used as truth; floats travel as canonical 16-digit binary64 bits.
use std::io::{self, BufWriter, Write};
use wonky_num::Iv;
use wonky_validated::{self as v, Enclosure, Expr};

const WIDTH: f64 = 1e-12;
fn random(state: &mut u64) -> f64 {
    *state = state.wrapping_add(0x9e3779b97f4a7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    ((z ^ (z >> 31)) >> 11) as f64 / ((1u64 << 53) as f64)
}
fn signed_magnitude(state: &mut u64) -> f64 {
    let exponent = (random(state) * 996.0) as i32 - 498;
    let magnitude = (1.0 + random(state)) * 2.0_f64.powi(exponent);
    if random(state) < 0.5 {
        -magnitude
    } else {
        magnitude
    }
}
fn bounds(out: &mut impl Write, value: Enclosure) -> io::Result<()> {
    write!(
        out,
        " {:016x} {:016x}",
        value.lower().to_bits(),
        value.upper().to_bits()
    )
}
fn extra(
    out: &mut impl Write,
    name: &str,
    x: Iv,
    y: Iv,
    budget: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    let value = match name {
        "sin" => v::sin(x, budget),
        "cos" => v::cos(x, budget),
        "atan2" => v::atan2(y, x, budget),
        "acos" => v::acos(x, budget),
        "exp" => v::exp(x, budget),
        "log" => v::log(x, budget),
        _ => unreachable!(),
    }?;
    write!(
        out,
        "E {name} {:016x} {:016x} {:016x} {:016x} {:016x}",
        x.m.to_bits(),
        x.r.to_bits(),
        y.m.to_bits(),
        y.r.to_bits(),
        budget.to_bits()
    )?;
    bounds(out, value)?;
    writeln!(out)?;
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let count: usize = args.get(1).ok_or("missing count")?.parse()?;
    let start: usize = args.get(2).ok_or("missing start")?.parse()?;
    if count == 0 || count > 1_000_000 || start > 1_000_000 || start + count > 1_000_000 {
        return Err("sample range must fit 0..1000000".into());
    }
    let mut out = BufWriter::new(io::stdout().lock());
    for id in start..start + count {
        let mut state = (id as u64).wrapping_add(0x564131);
        let r = random(&mut state);
        let x = match id % 10 {
            // Mandatory adversarial sample, including adjacent floats.
            0 => f64::from_bits(
                ((1e10 + id as f64) * std::f64::consts::PI).to_bits() + (id % 3) as u64,
            ),
            1 | 2 => {
                let k = ((r - 0.5) * 4e10).round();
                let base = k * std::f64::consts::FRAC_PI_2;
                f64::from_bits(base.to_bits() + (id % 3) as u64)
            }
            3 => {
                if id == 3 {
                    1e10
                } else {
                    1e10 + r * 1e6
                }
            }
            4 => (r - 0.5) * 2.0 * 35184372088832.0,
            5 => (r - 0.5) * 2.0_f64.powi(-((id % 450) as i32)),
            6 => (r - 0.5) * 100.0,
            7 => (r - 0.5) * 1e-10,
            8 => match id {
                8 => 0.0,
                18 => -0.0,
                _ => (id / 10) as f64 * std::f64::consts::FRAC_PI_2,
            },
            _ => (r - 0.5) * 2e10,
        };
        let y = if id % 17 == 0 && x != 0.0 {
            0.0
        } else {
            signed_magnitude(&mut state)
        };
        // Three actual public calls per row. Any refusal exits nonzero instead
        // of being counted as a successful containment check.
        let s = v::sin(Iv::point(x), WIDTH)?;
        let c = v::cos(Iv::point(x), WIDTH)?;
        let a = v::atan2(Iv::point(y), Iv::point(x), WIDTH)?;
        write!(out, "S {id} {:016x} {:016x}", x.to_bits(), y.to_bits())?;
        bounds(&mut out, s)?;
        bounds(&mut out, c)?;
        bounds(&mut out, a)?;
        writeln!(out)?;
    }
    // Additional whole-ball/domain coverage, separate from the million scalar
    // inputs. Oracle examines exact input-ball endpoints, not rounded m +/- r.
    let mut state = 0x4558545241;
    for _ in 0..1000 {
        let x = Iv {
            m: (random(&mut state) - 0.5) * 2e10,
            r: 1e-5,
        };
        extra(&mut out, "sin", x, Iv::point(0.0), 1e-4)?;
        extra(&mut out, "cos", x, Iv::point(0.0), 1e-4)?;
        extra(
            &mut out,
            "atan2",
            Iv {
                m: 2.0 + random(&mut state),
                r: 0.01,
            },
            Iv {
                m: 1.0 + random(&mut state),
                r: 0.01,
            },
            0.1,
        )?;
        extra(
            &mut out,
            "acos",
            Iv {
                m: (random(&mut state) - 0.5) * 1.99,
                r: 1e-6,
            },
            Iv::point(0.0),
            1e-3,
        )?;
        let m = (random(&mut state) - 0.5) * 1380.0;
        extra(
            &mut out,
            "exp",
            Iv::point(m),
            Iv::point(0.0),
            m.exp() * 1e-12,
        )?;
        extra(
            &mut out,
            "log",
            Iv::point(signed_magnitude(&mut state).abs()),
            Iv::point(0.0),
            1e-11,
        )?;
    }
    for x in [-1.0, f64::from_bits(1.0_f64.to_bits() - 1), 1.0] {
        extra(&mut out, "acos", Iv::point(x), Iv::point(0.0), WIDTH)?;
    }
    let p = Expr::Bound(v::pi(1e-13)?);
    let sphere = p.clone() * (Expr::Constant(9.0) - Expr::Variable.square());
    let c = (Expr::Constant(2.0) * p.clone() * Expr::Variable).cos();
    let torus =
        Expr::Constant(2.0) * p.clone() * p * (Expr::Constant(5.0) + c.clone()).square() * c;
    for (name, f, a, b, budget) in [
        ("sphere", sphere, -3.0, 3.0, 1e-10),
        ("torus", torus, 0.0, 1.0, 1e-7),
    ] {
        let integral = v::integrate(&f, a, b, budget, 4096)?;
        write!(
            out,
            "Q {name} {:016x} {} {}",
            budget.to_bits(),
            integral.panels,
            integral.evaluations
        )?;
        bounds(&mut out, integral.enclosure)?;
        writeln!(out)?;
    }
    out.flush()?;
    Ok(())
}
