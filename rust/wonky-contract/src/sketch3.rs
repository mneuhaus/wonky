//! Sketch rule 3: the tagged entity list of a sketch construction node.
//!
//! Layout of `Construction::parameters` for `Operation::Sketch`, `rule_version 3`
//! (one parent, the interpreter node; the extrusion depth and direction stay on
//! the interpreter node as `[depth, reverse]`):
//!
//! ```text
//! [region, (tag, payload...)*]
//! ```
//!
//! `region` is the index of the selected bounded region. Each entity starts with
//! an integer tag; the payload length is fixed by the tag or by a leading count.
//! All numbers are the exact binary64 inputs of the sketch (metres).
//!
//! | tag | entity  | payload |
//! |-----|---------|---------|
//! | 1   | line    | `x0 y0 x1 y1` |
//! | 2   | arc3    | `x0 y0 xm ym x1 y1` (start, a point on the arc, end) |
//! | 3   | circle  | `cx cy r` |
//! | 4   | bezier  | `n, (x y)*n` with `2 <= n <= 8` control points, degree n - 1 |
//! | 5   | bspline | `degree n rational, knots (n + degree + 1), (x y)*n, weights (n, only if rational = 1)` |
//! | 6   | fit     | `n, (x y)*n, has_parameters, parameters (n, if 1), has_start, dx dy (if 1), has_end, dx dy (if 1), closed, end_rule` |
//!
//! Fit end_rule 1: OM1 natural free ends; given derivatives used per native
//! parameter. D1 parameters are stored explicitly as authoritative binary64
//! inputs. Rule 0 does not identify a measured convention and is refused on replay.
//!
//! This module fixes the grammar and checks structure only (tags, counts,
//! integrality, positivity of weights and radii). Geometric admission (regions,
//! curve regularity, knot order) belongs to the operation that replays the
//! sketch; the knot order of a bspline entity is checked here too because a
//! decreasing knot vector is never a curve.
use crate::{ContractError, Result};

pub const LINE: u32 = 1;
pub const ARC3: u32 = 2;
pub const CIRCLE: u32 = 3;
pub const BEZIER: u32 = 4;
pub const BSPLINE: u32 = 5;
pub const FIT: u32 = 6;
/// Highest B-spline degree (the WC0 carrier limit).
pub const MAX_DEGREE: usize = 7;

type P2 = [f64; 2];

#[derive(Clone, Debug, PartialEq)]
pub enum Derivative {
    Free,
    Given(P2),
}
#[derive(Clone, Debug, PartialEq)]
pub enum Entity {
    Line { a: P2, b: P2 },
    Arc3 { start: P2, mid: P2, end: P2 },
    Circle { center: P2, radius: f64 },
    Bezier { controls: Vec<P2> },
    BSpline { degree: usize, knots: Vec<f64>, controls: Vec<P2>, weights: Option<Vec<f64>> },
    Fit {
        points: Vec<P2>,
        parameters: Option<Vec<f64>>,
        start: Derivative,
        end: Derivative,
        closed: bool,
        end_rule: u32,
    },
}
impl Entity {
    /// Whether the entity is a spline carrier (has a `CurveGeometry::BSpline` cache).
    pub fn is_spline(&self) -> bool {
        match self {
            Entity::Bezier { .. } | Entity::BSpline { .. } | Entity::Fit { .. } => true,
            Entity::Line { .. } | Entity::Arc3 { .. } | Entity::Circle { .. } => false,
        }
    }
}

fn bad(what: &'static str) -> ContractError {
    ContractError::Invalid(what)
}
struct Cursor<'a> {
    values: &'a [f64],
    at: usize,
}
impl Cursor<'_> {
    fn number(&mut self) -> Result<f64> {
        let v = *self.values.get(self.at).ok_or(bad("sketch3 truncated entity"))?;
        self.at += 1;
        Ok(v)
    }
    fn index(&mut self, max: usize) -> Result<usize> {
        let v = self.number()?;
        if !(0. ..=max as f64).contains(&v) || v.fract() != 0. {
            return Err(bad("sketch3 count or tag"));
        }
        Ok(v as usize)
    }
    fn flag(&mut self) -> Result<bool> {
        Ok(self.index(1)? == 1)
    }
    fn point(&mut self) -> Result<P2> {
        Ok([self.number()?, self.number()?])
    }
    fn points(&mut self, n: usize) -> Result<Vec<P2>> {
        (0..n).map(|_| self.point()).collect()
    }
    fn numbers(&mut self, n: usize) -> Result<Vec<f64>> {
        (0..n).map(|_| self.number()).collect()
    }
    fn derivative(&mut self) -> Result<Derivative> {
        Ok(if self.flag()? { Derivative::Given(self.point()?) } else { Derivative::Free })
    }
    fn entity(&mut self) -> Result<Entity> {
        let tag = self.index(u32::MAX as usize)? as u32;
        Ok(match tag {
            LINE => Entity::Line { a: self.point()?, b: self.point()? },
            ARC3 => Entity::Arc3 { start: self.point()?, mid: self.point()?, end: self.point()? },
            CIRCLE => {
                let (center, radius) = (self.point()?, self.number()?);
                if radius <= 0. {
                    return Err(bad("sketch3 circle radius"));
                }
                Entity::Circle { center, radius }
            }
            BEZIER => {
                let n = self.index(MAX_DEGREE + 1)?;
                if n < 2 {
                    return Err(bad("sketch3 bezier control count"));
                }
                Entity::Bezier { controls: self.points(n)? }
            }
            BSPLINE => {
                let degree = self.index(MAX_DEGREE)?;
                let n = self.index(self.values.len())?;
                let rational = self.flag()?;
                if degree < 1 || n < degree + 1 {
                    return Err(bad("sketch3 bspline degree or control count"));
                }
                let knots = self.numbers(n + degree + 1)?;
                if knots.windows(2).any(|w| w[0] > w[1]) {
                    return Err(bad("sketch3 bspline knots decrease"));
                }
                let controls = self.points(n)?;
                let weights = if rational { Some(self.numbers(n)?) } else { None };
                if weights.iter().flatten().any(|&w| w <= 0.) {
                    return Err(bad("sketch3 bspline weight"));
                }
                Entity::BSpline { degree, knots, controls, weights }
            }
            FIT => {
                let n = self.index(self.values.len())?;
                if n < 2 {
                    return Err(bad("sketch3 fit point count"));
                }
                let points = self.points(n)?;
                let parameters = if self.flag()? { Some(self.numbers(n)?) } else { None };
                if parameters.iter().flatten().collect::<Vec<_>>().windows(2).any(|w| w[0] >= w[1]) {
                    return Err(bad("sketch3 fit parameters not increasing"));
                }
                let (start, end) = (self.derivative()?, self.derivative()?);
                let closed = self.flag()?;
                let end_rule = self.index(u32::MAX as usize)? as u32;
                Entity::Fit { points, parameters, start, end, closed, end_rule }
            }
            _ => return Err(bad("sketch3 unknown entity tag")),
        })
    }
}

/// The selected region and the entity list of a rule 3 sketch node's parameters.
pub fn parse(parameters: &[f64]) -> Result<(usize, Vec<Entity>)> {
    let mut c = Cursor { values: parameters, at: 0 };
    let region = c.index(u32::MAX as usize)?;
    let mut entities = Vec::new();
    while c.at < parameters.len() {
        entities.push(c.entity()?);
    }
    if entities.is_empty() {
        return Err(bad("sketch3 without entities"));
    }
    Ok((region, entities))
}

/// The parameters of a rule 3 sketch node: the exact inverse of [`parse`].
pub fn encode(region: usize, entities: &[Entity]) -> Vec<f64> {
    fn point(out: &mut Vec<f64>, p: &P2) {
        out.extend_from_slice(p);
    }
    fn derivative(out: &mut Vec<f64>, d: &Derivative) {
        match d {
            Derivative::Free => out.push(0.),
            Derivative::Given(p) => {
                out.push(1.);
                point(out, p);
            }
        }
    }
    let mut out = vec![region as f64];
    for e in entities {
        match e {
            Entity::Line { a, b } => {
                out.push(LINE as f64);
                point(&mut out, a);
                point(&mut out, b);
            }
            Entity::Arc3 { start, mid, end } => {
                out.push(ARC3 as f64);
                for p in [start, mid, end] {
                    point(&mut out, p);
                }
            }
            Entity::Circle { center, radius } => {
                out.push(CIRCLE as f64);
                point(&mut out, center);
                out.push(*radius);
            }
            Entity::Bezier { controls } => {
                out.extend([BEZIER as f64, controls.len() as f64]);
                controls.iter().for_each(|p| point(&mut out, p));
            }
            Entity::BSpline { degree, knots, controls, weights } => {
                out.extend([BSPLINE as f64, *degree as f64, controls.len() as f64, weights.is_some() as u8 as f64]);
                out.extend(knots);
                controls.iter().for_each(|p| point(&mut out, p));
                out.extend(weights.iter().flatten());
            }
            Entity::Fit { points, parameters, start, end, closed, end_rule } => {
                out.extend([FIT as f64, points.len() as f64]);
                points.iter().for_each(|p| point(&mut out, p));
                out.push(parameters.is_some() as u8 as f64);
                out.extend(parameters.iter().flatten());
                derivative(&mut out, start);
                derivative(&mut out, end);
                out.extend([*closed as u8 as f64, *end_rule as f64]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Vec<Entity> {
        vec![
            Entity::Bezier { controls: vec![[0., 0.], [8e-3, 6e-3], [18e-3, 6e-3], [26e-3, 0.]] },
            Entity::Line { a: [26e-3, 0.], b: [0., 0.] },
            Entity::Arc3 { start: [0., 0.], mid: [1., 1.], end: [2., 0.] },
            Entity::Circle { center: [0., 0.], radius: 1. },
            Entity::BSpline {
                degree: 2,
                knots: vec![0., 0., 0., 1., 1., 1.],
                controls: vec![[0., 0.], [1., 1.], [2., 0.]],
                weights: Some(vec![1., 2., 1.]),
            },
            Entity::Fit {
                points: vec![[0., 0.], [1., 1.], [2., 0.]],
                parameters: Some(vec![0., 0.5, 1.]),
                start: Derivative::Given([1., 1.]),
                end: Derivative::Free,
                closed: false,
                end_rule: 2,
            },
        ]
    }
    #[test]
    fn every_tag_round_trips() {
        let entities = sample();
        assert_eq!(parse(&encode(3, &entities)).unwrap(), (3, entities));
    }
    #[test]
    fn structure_is_checked() {
        let good = encode(0, &sample());
        for cut in 2..good.len() {
            // A truncated list either ends on an entity boundary (valid, shorter)
            // or is refused; it never panics and never reads past the end.
            let _ = parse(&good[..cut]);
        }
        assert!(parse(&[0.]).is_err(), "no entities");
        assert!(parse(&[0., 9., 0.]).is_err(), "unknown tag");
        assert!(parse(&[0., 1., 0., 0., 1.]).is_err(), "truncated line");
        assert!(parse(&[0., 3., 0., 0., 0.]).is_err(), "zero radius");
        assert!(parse(&[0., 4., 1., 0., 0.]).is_err(), "one-point bezier");
        assert!(parse(&[0., 4., 9., 0., 0.]).is_err(), "degree above the carrier limit");
        assert!(parse(&[-1., 1., 0., 0., 1., 1.]).is_err(), "negative region");
        assert!(parse(&[0.5, 1., 0., 0., 1., 1.]).is_err(), "fractional region");
    }
    #[test]
    fn decreasing_knots_and_bad_weights_are_refused() {
        let spline = |knots: [f64; 6], weights: [f64; 3]| {
            let mut p = vec![0., BSPLINE as f64, 2., 3., 1.];
            p.extend(knots);
            p.extend([0., 0., 1., 1., 2., 0.]);
            p.extend(weights);
            parse(&p)
        };
        assert!(spline([0., 0., 0., 1., 1., 1.], [1., 1., 1.]).is_ok());
        assert!(spline([0., 0., 0., 1., 0.5, 1.], [1., 1., 1.]).is_err());
        assert!(spline([0., 0., 0., 1., 1., 1.], [1., 0., 1.]).is_err());
    }
}
