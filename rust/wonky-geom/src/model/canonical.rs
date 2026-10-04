//! The canonical exact form of a Model: the same value for every arena order
//! and every construction path that yields the same exact B-rep in the model
//! frame (the retirement and shadow comparisons compare it with `==`).
//!
//! * vertices: their exact keys, sorted;
//! * edges: (curve key, exact end points as vertex positions), sorted; a
//!   segment's canonical direction runs from the smaller to the larger end;
//! * faces: (carrier key, orientation, loops), sorted; a loop is the cyclic
//!   list of (edge position, sense) in traversal order, rotated to its least
//!   rotation; the outer loop first, then the holes sorted;
//! * shells and solids: sorted position lists.
//!
//! No two entities of a checked Model tie: vertex keys are distinct
//! (structure), no two edges share a point set (G7), and faces then differ
//! in their loops (each edge has two opposite uses, G7), so the result never
//! depends on arena order.
//!
//! Every order here is an order of exact values (`Ord` of `Q`, never of a
//! binary64 cache), and the placement map is not part of the form: V0-V3 of
//! a CAD-Acid zone differ only in placement. The planted negative
//! `plant_canonical_cache_order` sorts vertices by their world caches instead.
use super::{Bounds, Carrier3, Curve3, Draft, Label, VertexKey};
use crate::{dot, Point, Q};
use num_traits::{Signed, Zero};
use std::fmt;

/// A curve as a point set: a line's direction is scaled so that its first
/// nonzero component is 1, and its point is the one whose coordinate on that
/// axis is 0.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum CurveKey {
    Line {
        point: Point,
        direction: Point,
    },
    RadicalLine {
        point: super::RPoint,
        direction: super::RPoint,
    },
    /// A translated circle on a non-isometric chart: its plane and restricted implicit in Q(sqrt d).
    RadicalImplicitCircle { plane:[wonky_curve::radical::Radical;4], quadratic:[wonky_curve::radical::Radical;10] },
    Circle {
        plane: [Q; 4],
        quadratic: [Q; 10],
    },
    /// A circle about a radical centre: normalized normal, exact centre and
    /// Euclidean squared radius in Q(√d). A radical-centre `Circle3` and a
    /// `RadicalCircle3` latitude share this key, so equal point sets compare
    /// equal.
    RadicalCircle {
        normal: Point,
        centre: super::RPoint,
        r2: wonky_curve::radical::Radical,
    },
}
/// A carrier as a point set: a plane's normal is scaled so that its first
/// nonzero component is 1; `offset` is `normal . p` for its points.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum CarrierKey {
    Plane {
        normal: Point,
        offset: Q,
    },
    RadicalPlane {
        normal: super::RPoint,
        offset: wonky_curve::radical::Radical,
    },
    Quadric([Q; 10]),
    /// A quadric with coefficients in Q(√d) (a cone with a quadratic
    /// meridian), scaled so that the first nonzero coefficient is 1.
    RadicalQuadric([wonky_curve::radical::Radical; 10]),
    Rotated {
        base: Box<CarrierKey>,
        axis: crate::rotation::Line3,
        turn: (u64, Option<crate::AngleWitness>),
    },
    /// The torus quartic in model coordinates (exponent triple, coefficient),
    /// scaled so that the first coefficient is 1.
    Quartic(Vec<([u8; 3], Q)>),
    /// A torus quartic with a coefficient in Q(√d) (a quadratic major whose
    /// square is irrational), scaled the same way.
    RadicalQuartic(Vec<([u8; 3], wonky_curve::radical::Radical)>),
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EdgeEnds {
    /// Positions in `Canonical::vertices`, ascending.
    Segment([usize; 2]),
    /// Circle trim from the smaller vertex to the larger in the canonical
    /// circle plane's positive sense. Complementary arcs keep distinct keys.
    Arc {
        vertices: [usize; 2],
        positive: bool,
    },
    Ring,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CanonicalEdge {
    pub curve: CurveKey,
    pub ends: EdgeEnds,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CanonicalFace {
    pub carrier: CarrierKey,
    /// The outward normal points along the key's normal (not against it).
    pub outward: bool,
    /// (edge position, traversed in the edge's canonical direction) per use.
    pub loops: Vec<Vec<(usize, bool)>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canonical {
    pub label: Label,
    pub vertices: Vec<VertexKey>,
    pub edges: Vec<CanonicalEdge>,
    pub faces: Vec<CanonicalFace>,
    pub shells: Vec<Vec<usize>>,
    pub solids: Vec<Vec<usize>>,
}

/// `v / v[k]` for the first nonzero `v[k]`, and whether `v[k]` was negative.
fn scaled(v: &Point) -> (Point, bool) {
    let pivot = v
        .iter()
        .find(|x| !x.is_zero())
        .expect("G1: nonzero direction")
        .clone();
    (v.clone().map(|x| x / &pivot), pivot.is_negative())
}

/// The curve key, and whether the key's direction opposes the curve's own.
pub(super) fn curve_key(c: &Curve3) -> (CurveKey, bool) {
    match c {
        Curve3::RadicalLine { p, d } => {
            let pivot = d.iter().find(|x| !x.is_zero()).expect("G1");
            let direction = d.clone().map(|x| x / pivot);
            let k = direction.iter().position(|x| !x.is_zero()).expect("G1");
            let point = std::array::from_fn(|i| &p[i] - &p[k] * &direction[i]);
            let key = match (
                super::algebraic::rational(&point),
                super::algebraic::rational(&direction),
            ) {
                (Some(point), Some(direction)) => CurveKey::Line { point, direction },
                _ => CurveKey::RadicalLine { point, direction },
            };
            (key, pivot.is_negative())
        }
        Curve3::TranslatedCircle(c) => {
            let (plane,quadratic,flipped)=c.canonical_data();
            let rational=plane.iter().chain(quadratic.iter()).map(|v|v.rational()).collect::<Option<Vec<_>>>();
            let [x,y,_]=c.base.columns();
            let key=if let Some(v)=rational {CurveKey::Circle {plane:std::array::from_fn(|i|v[i].clone()),quadratic:std::array::from_fn(|i|v[4+i].clone())}}
            // An isometric chart is a Euclidean circle: share the radical-centre
            // circle key so both representations of one point set coincide.
            else if crate::dot(x,y).is_zero() && crate::dot(x,x)==crate::dot(y,y) {
                let normal=plane[..3].iter().map(|v|v.rational().expect("rational circle normal")).collect::<Vec<_>>();
                CurveKey::RadicalCircle{normal:std::array::from_fn(|i|normal[i].clone()),centre:c.center(),r2:wonky_curve::radical::Radical::from(c.base.radius2()*crate::dot(x,x))}
            } else {CurveKey::RadicalImplicitCircle{plane,quadratic}};
            (key,flipped)
        }
        Curve3::Circle(c) => c.canonical_key(),
        Curve3::RadicalCircle(c) => {
            let (normal, centre, r2, flipped) = c.canonical_data().expect("G1: admitted radical circle");
            (CurveKey::RadicalCircle { normal, centre, r2 }, flipped)
        }
        Curve3::Line { p, d } => {
            let (direction, flipped) = scaled(d);
            let k = direction
                .iter()
                .position(|x| !x.is_zero())
                .expect("scaled direction");
            let point = std::array::from_fn(|i| &p[i] - &p[k] * &direction[i]);
            (CurveKey::Line { point, direction }, flipped)
        }
    }
}

fn least_rotation(cycle: Vec<(usize, bool)>) -> Vec<(usize, bool)> {
    (0..cycle.len())
        .map(|r| {
            cycle[r..]
                .iter()
                .chain(&cycle[..r])
                .copied()
                .collect::<Vec<_>>()
        })
        .min()
        .unwrap_or_default()
}

/// Positions of the vertices: sorted by exact key.
#[cfg(not(feature = "plant_canonical_cache_order"))]
fn vertex_order(_: &Draft, keys: &[VertexKey]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|&a, &b| keys[a].cmp(&keys[b]));
    order
}
/// PLANTED NEGATIVE: sorted by the binary64 world cache (wrong on purpose).
#[cfg(feature = "plant_canonical_cache_order")]
fn vertex_order(d: &Draft, keys: &[VertexKey]) -> Vec<usize> {
    let cache: Vec<[f64; 3]> = keys
        .iter()
        .map(|k| {
            let world = match k {
                VertexKey::Rational(p) => d.placement.point(p),
                VertexKey::Quadratic(_) | VertexKey::Real(_) => {
                    panic!("quadratic cache-order plant requires a curved model")
                }
            };
            world.map(|x| super::nearest(&x).expect("plant: finite cache"))
        })
        .collect();
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|&a, &b| {
        (0..3)
            .map(|k| cache[a][k].total_cmp(&cache[b][k]))
            .find(|o| o.is_ne())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    order
}

/// `keys` are the model's vertex keys in arena order.
fn carrier_key(carrier: &Carrier3, forward: bool) -> (CarrierKey, bool) {
    match carrier {
        Carrier3::Rotated(_) => {
            let p=carrier.exact_plane().expect("G1 admitted exact rotated plane");
            carrier_key(&p.carrier(),forward)
        }
        Carrier3::Cone(c) if !c.is_rational() => {
            let coefficients = c.model_quadric().expect("G1: admitted quadratic cone");
            let pivot = coefficients
                .iter()
                .find(|x| !x.is_zero())
                .expect("nonzero quadric")
                .clone();
            let negative = pivot.is_negative();
            let scaled = wonky_curve::radical::guard(|| coefficients.map(|x| &x / &pivot))
                .expect("bounded quadric scaling");
            (CarrierKey::RadicalQuadric(scaled), forward != negative)
        }
        Carrier3::TranslatedCylinder(c) => {
            let raw=super::translated::coefficients(&Carrier3::Cylinder(c.base.clone()).implicit().expect("prototype"),&c.offset);
            let pivot=raw.iter().find(|x|!x.is_zero()).expect("quadric").clone();let coefficients=raw.map(|x|x/&pivot);
            let rational=coefficients.iter().map(|v|v.rational()).collect::<Option<Vec<_>>>();
            let key=if let Some(v)=rational {CarrierKey::Quadric(std::array::from_fn(|i|v[i].clone()))}else{CarrierKey::RadicalQuadric(coefficients)};
            (key,forward!=pivot.is_negative())
        }
        Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) => {
            let coefficients = carrier
                .implicit()
                .expect("curved rational implicit")
                .coefficients();
            let pivot = coefficients
                .iter()
                .find(|x| !x.is_zero())
                .expect("nonzero quadric")
                .clone();
            (
                CarrierKey::Quadric(coefficients.map(|x| x / &pivot)),
                forward != pivot.is_negative(),
            )
        }
        Carrier3::Torus(t) => {
            let quartic = t.model_quartic();
            let pivot = quartic.values().next().expect("nonzero quartic").clone();
            let scaled: Vec<_> = quartic.into_iter().map(|(e, c)| (e, c / &pivot)).collect();
            let key = match scaled.iter().map(|(e, c)| Some((*e, c.rational()?))).collect::<Option<Vec<_>>>() {
                Some(rational) => CarrierKey::Quartic(rational),
                None => CarrierKey::RadicalQuartic(scaled),
            };
            (key, forward != pivot.is_negative())
        }
        Carrier3::RadicalPlane(p) => {
            let pivot = p.n.iter().find(|x| !x.is_zero()).expect("G1");
            let normal = p.n.clone().map(|x| x / pivot);
            let offset = super::algebraic::dot(&normal, &p.o);
            let key = match (super::algebraic::rational(&normal), offset.rational()) {
                (Some(normal), Some(offset)) => CarrierKey::Plane { normal, offset },
                _ => CarrierKey::RadicalPlane { normal, offset },
            };
            (key, forward != pivot.is_negative())
        }
        Carrier3::Plane(p) => {
            let (normal, negative) = scaled(&p.n);
            let offset = dot(&normal, &p.o);
            (CarrierKey::Plane { normal, offset }, forward != negative)
        }
    }
}

pub(super) fn of(d: &Draft, keys: &[VertexKey]) -> Canonical {
    let order = vertex_order(d, keys);
    let mut vpos = vec![0; keys.len()];
    for (pos, &v) in order.iter().enumerate() {
        vpos[v] = pos;
    }
    let vertices = order.iter().map(|&v| keys[v].clone()).collect();

    let mut flipped = vec![false; d.edges.len()];
    let mut edges: Vec<(CanonicalEdge, usize)> = d
        .edges
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let (curve, flip) = curve_key(&d.curves[e.curve.index()].geometry);
            flipped[i] = flip;
            let ends = match e.bounds {
                Bounds::Segment([a, b]) => {
                    let (a, b) = (vpos[a.index()], vpos[b.index()]);
                    match &d.curves[e.curve.index()].geometry {
                        Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => EdgeEnds::Arc {
                            vertices: [a.min(b), a.max(b)],
                            positive: if a < b { !flip } else { flip },
                        },
                        Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                            EdgeEnds::Segment([a.min(b), a.max(b)])
                        }
                    }
                }
                Bounds::Ring => EdgeEnds::Ring,
            };
            (CanonicalEdge { curve, ends }, i)
        })
        .collect();
    edges.sort();
    let mut epos = vec![0; d.edges.len()];
    for (pos, (_, e)) in edges.iter().enumerate() {
        epos[*e] = pos;
    }

    let canonical_loop = |l: usize| -> Vec<(usize, bool)> {
        let cycle = d.loops[l]
            .coedges
            .iter()
            .map(|c| {
                let co = &d.coedges[c.index()];
                let e = co.edge.index();
                let sense = match d.edges[e].bounds {
                    Bounds::Segment([a, b]) => {
                        let (start, end) = if co.forward { (a, b) } else { (b, a) };
                        vpos[start.index()] < vpos[end.index()]
                    }
                    Bounds::Ring => co.forward != flipped[e],
                };
                (epos[e], sense)
            })
            .collect();
        least_rotation(cycle)
    };
    let mut faces: Vec<(CanonicalFace, usize)> = d
        .faces
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let (carrier, outward) = carrier_key(&d.surfaces[f.surface.index()].carrier, f.forward);
            let mut loops: Vec<_> = f.loops.iter().map(|l| canonical_loop(l.index())).collect();
            loops[1..].sort();
            (
                CanonicalFace {
                    carrier,
                    outward,
                    loops,
                },
                i,
            )
        })
        .collect();
    faces.sort();
    let mut fpos = vec![0; d.faces.len()];
    for (pos, (_, f)) in faces.iter().enumerate() {
        fpos[*f] = pos;
    }
    let mut shells: Vec<(Vec<usize>, usize)> = d
        .shells
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let mut fs: Vec<usize> = s.faces.iter().map(|f| fpos[f.index()]).collect();
            fs.sort_unstable();
            (fs, i)
        })
        .collect();
    shells.sort();
    let mut spos = vec![0; d.shells.len()];
    for (pos, (_, s)) in shells.iter().enumerate() {
        spos[*s] = pos;
    }
    let mut solids: Vec<Vec<usize>> = d
        .solids
        .iter()
        .map(|s| {
            let mut ss: Vec<usize> = s.shells.iter().map(|s| spos[s.index()]).collect();
            ss.sort_unstable();
            ss
        })
        .collect();
    solids.sort();
    Canonical {
        label: d.label,
        vertices,
        edges: edges.into_iter().map(|(e, _)| e).collect(),
        faces: faces.into_iter().map(|(f, _)| f).collect(),
        shells: shells.into_iter().map(|(s, _)| s).collect(),
        solids,
    }
}

fn point(f: &mut fmt::Formatter<'_>, p: &Point) -> fmt::Result {
    write!(f, "({}, {}, {})", p[0], p[1], p[2])
}

/// One line per entity, rationals as `n/d`; for diffs in test output.
impl fmt::Display for Canonical {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "label {:?}", self.label)?;
        for (i, v) in self.vertices.iter().enumerate() {
            write!(f, "v{i} ")?;
            match v {
                VertexKey::Rational(p) => point(f, p)?,
                VertexKey::Quadratic(p) => write!(f, "quadratic {:?}", p.coordinates())?,
                VertexKey::Real(p) => write!(f, "real {:?}", p)?,
            }
            writeln!(f)?;
        }
        for (i, e) in self.edges.iter().enumerate() {
            write!(f, "e{i} ")?;
            match &e.curve {
                CurveKey::RadicalLine { point, direction } => {
                    write!(f, "radical-line {:?} + t {:?}", point, direction)?
                }
                CurveKey::RadicalImplicitCircle {plane,quadratic} => write!(f,"radical-implicit-circle {:?} {:?}",plane,quadratic)?,
                CurveKey::Circle { plane, quadratic } => {
                    write!(f, "circle {:?} {:?}", plane, quadratic)?
                }
                CurveKey::RadicalCircle { normal, centre, r2 } => {
                    write!(f, "radical-circle {:?} {:?} {:?}", normal, centre, r2)?
                }
                CurveKey::Line {
                    point: p,
                    direction,
                } => {
                    write!(f, "line ")?;
                    point(f, p)?;
                    write!(f, " + t ")?;
                    point(f, direction)?;
                }
            }
            match e.ends {
                EdgeEnds::Segment([a, b]) => writeln!(f, " v{a}-v{b}")?,
                EdgeEnds::Arc {
                    vertices: [a, b],
                    positive,
                } => writeln!(f, " arc v{a}-v{b} positive={positive}")?,
                EdgeEnds::Ring => writeln!(f, " ring")?,
            }
        }
        for (i, face) in self.faces.iter().enumerate() {
            write!(f, "f{i} ")?;
            match &face.carrier {
                CarrierKey::Rotated { base, axis, turn } => {
                    write!(f, "rotated {:?} {:?} {:?}", base, axis, turn)?
                }
                CarrierKey::RadicalPlane { normal, offset } => {
                    write!(f, "radical-plane {:?} . p = {:?}", normal, offset)?
                }
                CarrierKey::Quadric(q) => write!(f, "quadric {:?}", q)?,
                CarrierKey::RadicalQuadric(q) => write!(f, "radical quadric {:?}", q)?,
                CarrierKey::Quartic(q) => write!(f, "quartic {:?}", q)?,
                CarrierKey::RadicalQuartic(q) => write!(f, "radical quartic {:?}", q)?,
                CarrierKey::Plane { normal, offset } => {
                    write!(f, "plane ")?;
                    point(f, normal)?;
                    write!(f, " . p = {offset}")?;
                }
            }
            write!(f, " {}", if face.outward { "out+" } else { "out-" })?;
            for l in &face.loops {
                write!(f, " [")?;
                for (k, (e, sense)) in l.iter().enumerate() {
                    write!(
                        f,
                        "{}{}e{e}",
                        if k == 0 { "" } else { " " },
                        if *sense { "+" } else { "-" }
                    )?;
                }
                write!(f, "]")?;
            }
            writeln!(f)?;
        }
        for (i, s) in self.shells.iter().enumerate() {
            writeln!(f, "s{i} faces {s:?}")?;
        }
        for (i, s) in self.solids.iter().enumerate() {
            writeln!(f, "solid{i} shells {s:?}")?;
        }
        Ok(())
    }
}
