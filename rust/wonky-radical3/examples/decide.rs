//! Line-oriented acceptance driver. Hex words carry the *exact* binary64 inputs;
//! all arithmetic and decisions call the public N3 API. Not a production wire format.
use std::io::{self, BufRead, Write};
use wonky_num::{Decision, Undecided};
use wonky_radical3::{sum3, Dyadic, Radical3};

type V = [Dyadic; 3];
fn dot(a: &V, b: &V) -> Result<Dyadic, Undecided> {
    a[0].mul(&b[0])?
        .add(&a[1].mul(&b[1])?)?
        .add(&a[2].mul(&b[2])?)
}
fn cross(a: &V, b: &V) -> Result<V, Undecided> {
    Ok([
        a[1].mul(&b[2])?.sub(&a[2].mul(&b[1])?)?,
        a[2].mul(&b[0])?.sub(&a[0].mul(&b[2])?)?,
        a[0].mul(&b[1])?.sub(&a[1].mul(&b[0])?)?,
    ])
}
fn vector(xs: &[f64]) -> Result<V, Undecided> {
    Ok([
        Dyadic::new(xs[0])?,
        Dyadic::new(xs[1])?,
        Dyadic::new(xs[2])?,
    ])
}
fn simple(xs: &[f64]) -> Result<Radical3, Undecided> {
    sum3(xs[0], [(xs[1], xs[2]), (xs[3], xs[4]), (xs[5], xs[6])])
}

// Replay ex_tp.q from kernel/fillet/decide.bend:155 on frozen job words.
// xs: chamfer, side1, convex, size, offset, ni[3], nj[3], t[3], e[3], x[3].
fn stripe(xs: &[f64]) -> Decision {
    let ni = vector(&xs[5..8])?;
    let nj = vector(&xs[8..11])?;
    let t = vector(&xs[11..14])?;
    let e = vector(&xs[14..17])?;
    let x = vector(&xs[17..20])?;
    let delta = [x[0].sub(&e[0])?, x[1].sub(&e[1])?, x[2].sub(&e[2])?];
    let side1 = xs[1] == 1.0;
    let tau = if side1 {
        cross(&ni, &t)?
    } else {
        cross(&t, &ni)?
    };
    let p = dot(&tau, &delta)?;
    let det = if side1 {
        dot(&ni, &cross(&t, &nj)?)?
    } else {
        dot(&nj, &cross(&t, &ni)?)?
    };
    let nn = dot(&ni, &nj)?;
    let roots = [dot(&ni, &ni)?, dot(&nj, &nj)?, dot(&t, &t)?];
    let size = Dyadic::new(xs[3])?;
    let offset = Dyadic::new(xs[4])?;
    let mut c = std::array::from_fn(|_| Dyadic::default());
    if xs[0] == 1.0 {
        c[0] = p;
        c[5] = size.add(&offset)?.neg();
    } else {
        let rs = if xs[2] == 1.0 { size.neg() } else { size };
        c[0] = p.mul(&nn)?;
        c[1] = rs.mul(&det)?.neg();
        c[3] = p;
        c[6] = offset.mul(&roots[0])?.neg();
        c[5] = offset.mul(&nn)?.neg();
    }
    Radical3::new(roots, c)?.sign()
}

fn evaluate(op: &str, xs: &[f64]) -> Decision {
    match op {
        "s" => simple(xs)?.sign(),
        "c" => simple(&xs[..7])?.compare(&simple(&xs[7..])?),
        "t" => stripe(xs),
        "q" => {
            let roots = [
                Dyadic::new(xs[0])?,
                Dyadic::new(xs[1])?,
                Dyadic::new(xs[2])?,
            ];
            let mut c = std::array::from_fn(|_| Dyadic::default());
            for (out, &v) in c.iter_mut().zip(&xs[3..]) {
                *out = Dyadic::new(v)?;
            }
            Radical3::new(roots, c)?.sign()
        }
        _ => unreachable!(),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut out = io::BufWriter::new(io::stdout().lock());
    for (line_number, line) in io::stdin().lock().lines().enumerate() {
        let line = line?;
        let words: Vec<_> = line.split(' ').collect();
        let expected = match words.first().copied() {
            Some("s") => 7,
            Some("c") => 14,
            Some("t") => 20,
            Some("q") => 11,
            _ => return Err("unknown operation".into()),
        };
        if words.len() != expected + 2 || words[1] != line_number.to_string() {
            return Err("noncanonical row or sequence id".into());
        }
        let mut xs = Vec::with_capacity(expected);
        for &word in &words[2..] {
            if word.len() != 16
                || !word
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("noncanonical binary64 word".into());
            }
            xs.push(f64::from_bits(u64::from_str_radix(word, 16)?));
        }
        if words[0] == "t" && xs[..3].iter().any(|&x| x != 0.0 && x != 1.0) {
            return Err("noncanonical stripe boolean".into());
        }
        match evaluate(words[0], &xs) {
            Ok(s) => writeln!(out, "{line_number} {}", s.to_i32())?,
            Err(e) => {
                let r = e.into_refusal();
                writeln!(out, "{line_number} refuse {} {:?}", r.site, r.kind)?;
            }
        }
    }
    out.flush()?;
    Ok(())
}
