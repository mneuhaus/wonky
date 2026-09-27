//! Decoding of the native wire request words (scripts/native-bridge/gen-wire.mjs):
//! little-endian U32, Real = two F32 words (hi, lo) decoded exactly as hi + lo
//! in f64 (both are F32, their sum is exact in binary64 for normalized pairs;
//! checked), ADT = tag word when the type has more than one constructor, then
//! fields; List = count, then elements; Bool = 0/1.
//! And a plain JSON writer for the result.

use crate::model::*;
use crate::num::{v3, P3};
use std::fmt::Write;

pub struct Reader<'a> {
    words: &'a [u32],
    at: usize,
}

#[derive(Debug)]
pub struct WireError(pub String);

type R<T> = Result<T, WireError>;

impl<'a> Reader<'a> {
    pub fn new(words: &'a [u32]) -> Self {
        Reader { words, at: 0 }
    }
    fn word(&mut self) -> R<u32> {
        let w = *self.words.get(self.at).ok_or_else(|| WireError(format!("request ends at word {}", self.at)))?;
        self.at += 1;
        Ok(w)
    }
    fn boolean(&mut self) -> R<bool> {
        match self.word()? {
            0 => Ok(false),
            1 => Ok(true),
            w => Err(WireError(format!("Bool word {w} at {}", self.at - 1))),
        }
    }
    fn count(&mut self, min_words: usize) -> R<usize> {
        let n = self.word()? as usize;
        if n.saturating_mul(min_words) > self.words.len() - self.at {
            return Err(WireError(format!("list count {n} exceeds the request")));
        }
        Ok(n)
    }
    /// Real{hi, lo}: exact value hi + lo.
    pub fn real(&mut self) -> R<f64> {
        let hi = f32::from_bits(self.word()?) as f64;
        let lo = f32::from_bits(self.word()?) as f64;
        let s = hi + lo;
        // hi + lo must be exact in f64 (true for any pair of F32 values whose
        // exponents differ by < 971, i.e. every finite normalized F32x2 pair).
        if !hi.is_finite() || !lo.is_finite() || !s.is_finite()
            || (s - hi) != lo || (s as f32 as f64) != hi {
            return Err(WireError("Real hi + lo is not a canonical exact F32x2 pair".into()));
        }
        Ok(s)
    }
    fn vec3(&mut self) -> R<P3> {
        Ok(v3(self.real()?, self.real()?, self.real()?))
    }
    fn curve(&mut self) -> R<Curve> {
        match self.word()? {
            0 => Ok(Curve::Line { origin: self.vec3()?, direction: self.vec3()? }),
            1 => {
                for _ in 0..3 {
                    self.vec3()?;
                }
                self.real()?;
                Ok(Curve::Round)
            }
            2 => {
                for _ in 0..3 {
                    self.vec3()?;
                }
                self.real()?;
                self.real()?;
                Ok(Curve::Round)
            }
            t => Err(WireError(format!("Curve tag {t}"))),
        }
    }
    fn surface(&mut self) -> R<Surface> {
        let tag = self.word()?;
        let origin = self.vec3()?;
        let normal = self.vec3()?;
        let x = self.vec3()?;
        match tag {
            0 => Ok(Surface::Plane { origin, normal, x }),
            1 | 3 => {
                self.real()?;
                Ok(Surface::Other)
            }
            2 | 4 => {
                self.real()?;
                self.real()?;
                Ok(Surface::Other)
            }
            t => Err(WireError(format!("Surface tag {t}"))),
        }
    }
    pub fn solid(&mut self) -> R<Solid> {
        let nv = self.count(6)?;
        let mut vertices = Vec::with_capacity(nv);
        for _ in 0..nv {
            vertices.push(self.vec3()?);
        }
        let ne = self.count(4)?;
        let mut edges = Vec::with_capacity(ne);
        for _ in 0..ne {
            let start = self.word()?;
            let end = self.word()?;
            let curve = self.curve()?;
            let same_sense = self.boolean()?;
            edges.push(Edge { start, end, curve, same_sense });
        }
        let nf = self.count(3)?;
        let mut faces = Vec::with_capacity(nf);
        for _ in 0..nf {
            let surface = self.surface()?;
            let same_sense = self.boolean()?;
            let nl = self.count(2)?;
            let mut loops = Vec::with_capacity(nl);
            for _ in 0..nl {
                let outer = self.boolean()?;
                let nu = self.count(2)?;
                let mut uses = Vec::with_capacity(nu);
                for _ in 0..nu {
                    let edge = self.word()?;
                    let forward = self.boolean()?;
                    uses.push(Use { edge, forward });
                }
                loops.push(Loop { outer, uses });
            }
            faces.push(Face { surface, same_sense, loops });
        }
        Ok(Solid { vertices, edges, faces })
    }
    pub fn domains(&mut self) -> R<Vec<DomainChoice>> {
        let n = self.count(1)?;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(match self.word()? {
                0 => DomainChoice::Auto,
                1 => DomainChoice::Given(match self.word()? {
                    0 => Domain::Untrimmed,
                    1 => Domain::Interval { first: self.real()?, last: self.real()? },
                    t => return Err(WireError(format!("Domain tag {t}"))),
                }),
                t => return Err(WireError(format!("DomainChoice tag {t}"))),
            });
        }
        Ok(out)
    }
    pub fn done(&self) -> R<()> {
        if self.at == self.words.len() {
            Ok(())
        } else {
            Err(WireError(format!("{} trailing words", self.words.len() - self.at)))
        }
    }
}

/// The seven arguments of planar-boolean.bend union/subtract.
pub struct Request {
    pub first: Solid,
    pub ad: Vec<DomainChoice>,
    pub ab: f64,
    pub second: Solid,
    pub bd: Vec<DomainChoice>,
    pub bb: f64,
    pub tolerance: Tolerance,
}

pub fn decode_request(words: &[u32]) -> R<Request> {
    let mut r = Reader::new(words);
    let first = r.solid()?;
    let ad = r.domains()?;
    let ab = r.real()?;
    let second = r.solid()?;
    let bd = r.domains()?;
    let bb = r.real()?;
    let tolerance = Tolerance { linear: r.real()?, angular: r.real()? };
    r.done()?;
    Ok(Request { first, ad, ab, second, bd, bb, tolerance })
}

pub fn words_from_bytes(bytes: &[u8]) -> Vec<u32> {
    bytes.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

// ---------------------------------------------------------------- JSON output

fn num(out: &mut String, x: f64) {
    if x.is_finite() {
        // shortest round-trip representation
        let _ = write!(out, "{:?}", x);
    } else {
        out.push_str("null");
    }
}
fn p3(out: &mut String, p: P3) {
    out.push('[');
    num(out, p.x);
    out.push(',');
    num(out, p.y);
    out.push(',');
    num(out, p.z);
    out.push(']');
}
fn face_ref(out: &mut String, r: FaceRef) {
    let _ = write!(out, "[{},{}]", r.operand, r.index);
}
fn stats(out: &mut String, s: &Stats) {
    let _ = write!(
        out,
        "{{\"planes\":{},\"cells\":{},\"selected_cells\":{},\"shared_vertices\":{},\"boundary_faces\":{},\"internal_interfaces\":{}}}",
        s.planes, s.cells, s.selected_cells, s.shared_vertices, s.boundary_faces, s.internal_interfaces
    );
}

pub fn solid_json(out: &mut String, s: &Solid) {
    out.push_str("{\"vertices\":[");
    for (i, v) in s.vertices.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        p3(out, *v);
    }
    out.push_str("],\"edges\":[");
    for (i, e) in s.edges.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "{{\"start\":{},\"end\":{},\"sense\":{},", e.start, e.end, e.same_sense);
        match e.curve {
            Curve::Line { origin, direction } => {
                out.push_str("\"origin\":");
                p3(out, origin);
                out.push_str(",\"direction\":");
                p3(out, direction);
            }
            Curve::Round => out.push_str("\"round\":true"),
        }
        out.push('}');
    }
    out.push_str("],\"faces\":[");
    for (i, f) in s.faces.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str("{\"surface\":");
        match f.surface {
            Surface::Plane { origin, normal, x } => {
                out.push_str("{\"origin\":");
                p3(out, origin);
                out.push_str(",\"normal\":");
                p3(out, normal);
                out.push_str(",\"x\":");
                p3(out, x);
                out.push('}');
            }
            Surface::Other => out.push_str("null"),
        }
        let _ = write!(out, ",\"sense\":{},\"loops\":[", f.same_sense);
        for (j, l) in f.loops.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            let _ = write!(out, "{{\"outer\":{},\"uses\":[", l.outer);
            for (k, u) in l.uses.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                let _ = write!(out, "[{},{}]", u.edge, u.forward);
            }
            out.push_str("]}");
        }
        out.push_str("]}");
    }
    out.push_str("]}");
}

pub fn result_json(r: &BoolResult) -> String {
    let mut out = String::new();
    match r {
        BoolResult::Unresolved { reason, stage, detail, stats: s } => {
            let _ = write!(out, "{{\"status\":\"Unresolved\",\"reason\":\"{}\",\"stage\":{},\"detail\":{},\"stats\":", reason.name(), stage, detail);
            stats(&mut out, s);
            out.push('}');
        }
        BoolResult::Undecidable { site, stats: s } => {
            let _ = write!(out, "{{\"status\":\"Undecidable\",\"site\":\"{}\",\"stats\":", site);
            stats(&mut out, s);
            out.push('}');
        }
        BoolResult::Bodies { bodies, stats: s } => {
            out.push_str("{\"status\":\"Bodies\",\"stats\":");
            stats(&mut out, s);
            out.push_str(",\"bodies\":[");
            for (i, b) in bodies.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"solid\":");
                solid_json(&mut out, &b.solid);
                out.push_str(",\"domains\":[");
                for (j, d) in b.domains.iter().enumerate() {
                    if j > 0 {
                        out.push(',');
                    }
                    match d {
                        DomainChoice::Auto => out.push_str("\"auto\""),
                        DomainChoice::Given(Domain::Untrimmed) => out.push_str("\"untrimmed\""),
                        DomainChoice::Given(Domain::Interval { first, last }) => {
                            out.push('[');
                            num(&mut out, *first);
                            out.push(',');
                            num(&mut out, *last);
                            out.push(']');
                        }
                    }
                }
                out.push_str("],\"face_origins\":[");
                for (j, o) in b.face_origins.iter().enumerate() {
                    if j > 0 {
                        out.push(',');
                    }
                    out.push_str("{\"owner\":");
                    face_ref(&mut out, o.owner);
                    out.push_str(",\"contributors\":[");
                    for (k, c) in o.contributors.iter().enumerate() {
                        if k > 0 {
                            out.push(',');
                        }
                        face_ref(&mut out, *c);
                    }
                    out.push_str("]}");
                }
                out.push_str("],\"edge_origins\":[");
                for (j, o) in b.edge_origins.iter().enumerate() {
                    if j > 0 {
                        out.push(',');
                    }
                    match o {
                        EdgeOrigin::OriginalEdge { operand, index } => {
                            let _ = write!(out, "{{\"original\":[{},{}]}}", operand, index);
                        }
                        EdgeOrigin::FaceIntersection { first, second } => {
                            out.push_str("{\"intersection\":[");
                            face_ref(&mut out, *first);
                            out.push(',');
                            face_ref(&mut out, *second);
                            out.push_str("]}");
                        }
                        EdgeOrigin::FaceSubdivision { faces } => {
                            out.push_str("{\"subdivision\":[");
                            for (k, c) in faces.iter().enumerate() {
                                if k > 0 {
                                    out.push(',');
                                }
                                face_ref(&mut out, *c);
                            }
                            out.push_str("]}");
                        }
                    }
                }
                out.push_str("]}");
            }
            out.push_str("]}");
        }
    }
    out
}

#[cfg(test)]
mod canonical_real_tests {
    use super::Reader;
    #[test]
    fn swapped_and_rounded_words_are_refused() {
        let tiny = (2f32).powi(-80).to_bits();
        for words in [[tiny, 8f32.to_bits()], [8f32.to_bits(), tiny]] {
            assert!(Reader::new(&words).real().is_err(), "accepted {words:?}");
        }
        assert_eq!(Reader::new(&[8f32.to_bits(), 0]).real().unwrap(), 8.0);
    }
}
