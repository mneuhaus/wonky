//! Partial revolution patches (fillets3d design §2.3/§3 rows 1-2 and 5: the
//! cylinder and torus stripes of a filleted chain, the cone stripes of a
//! chamfered one; the torus data structure of boolean3d plan G20 without SSI
//! rows).
//!
//! **Shape.** A cylinder or torus face whose one loop is a rectangle of the
//! half-angle atlas: two latitude arcs (circles ⟂ the axis, centred on it)
//! and two meridians (cylinder generators, or tube circles in a plane
//! through the axis). The azimuth chart is `t_u = σ y/(ρ + σ x)` in patch
//! `pu` (σ = ±1, [`Patch::sign`]), the meridian chart is the local height
//! on a cylinder or cone (ρ = ρ0 + kz, positive on the whole patch) and the
//! tube half-angle `t_v` in patch `pv` on a torus;
//! both angular ranges lie in `[-1, 1]` (at most a half turn per patch).
//! Every pcurve is the straight chart segment between the exact chart
//! images of its vertices; no atlas transition is needed.
//!
//! **Decisions.** Location tests are signs of polynomials in the local
//! coordinates: two azimuth half-plane crosses, two meridian crosses (on a
//! torus written with `S = |l|² + R² − a² = 2Rρ` on the own sheet, so the
//! tube direction is `(S − 2R², 2Rz)` up to the positive factor `2Ra`) and
//! the own-sheet sign `S > 0`. Ray hits isolate the carrier polynomial's
//! real roots exactly (Sturm) and evaluate the same tests at each root.
//!
//! **Measures.** Flux of the position field through the patch, from
//! `l_φ × l_θ = (ρz' cos φ, ρz' sin φ, −ρρ')`, is exact in Q + Qπ + Qπ²
//! when both angular ends lie on the quarter grid (`t ∈ {−1, 0, 1}`);
//! other sweeps refuse by name.
use super::curved::{half_angle, Patch};
use super::periodic::PiValue;
use super::{Bounds, Carrier3, Curve3, Draft, FaceId, VertexKey};
use crate::{cross, dot, frame::Frame, Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use wonky_alg::{isolate_real_roots, Limits, Polynomial, Sign};
use wonky_curve::{numeric::exact_root, radical::Radical, Carrier, ExactPoint};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Profile {
    Cylinder { radius: Q },
    Torus { major: Q, minor: Q },
    /// ρ(z) = radius + slope·z in the carrier frame.
    Cone { radius: Q, slope: Q },
}

/// A chart rectangle `[u0, u1] × [v0, v1]` on a cylinder or torus.
#[derive(Clone, Debug)]
pub struct RevPatch {
    pub frame: Frame,
    pub profile: Profile,
    pub pu: Patch,
    pub pv: Patch,
    pub u: [Q; 2],
    pub v: [Q; 2],
    pub forward: bool,
}

/// Structural candidate: a cylinder or torus face with one loop of four
/// bounded edges. Full-turn bands and pole caps are not candidates.
pub(super) fn shape(d: &Draft, fi: FaceId) -> bool {
    let f = &d.faces[fi.index()];
    matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Cylinder(_) | Carrier3::Torus(_) | Carrier3::Cone(_))
        && f.loops.len() == 1
        && d.loops[f.loops[0].index()].coedges.len() == 4
        && d.loops[f.loops[0].index()].coedges.iter().all(|c| {
            matches!(d.edges[d.coedges[c.index()].edge.index()].bounds, Bounds::Segment(_))
        })
}

/// atan(t)/π on the quarter grid, `None` elsewhere.
fn quarter(t: &Q) -> Option<Q> {
    if t.is_zero() {
        Some(Q::zero())
    } else if t.abs() == Q::one() {
        Some(if t.is_positive() { Q::new(1.into(), 4.into()) } else { Q::new((-1).into(), 4.into()) })
    } else {
        None
    }
}
/// Swept angle over π between two half-angle chart values.
fn swept(t: &[Q; 2]) -> Result<Q> {
    match (quarter(&t[0]), quarter(&t[1])) {
        (Some(a), Some(b)) => Ok(q(2) * (b - a)),
        _ => Err(Refused("boolean/ssi-row-unavailable:patch/transcendental-sweep")),
    }
}

impl Profile {
    fn of(carrier: &Carrier3) -> Result<Option<(Frame, Self)>> {
        Ok(match carrier {
            Carrier3::Cylinder(c) => Some((
                c.frame()?.clone(),
                Profile::Cylinder { radius: exact_root(&c.radius2()).expect("rational cylinder radius") },
            )),
            Carrier3::Torus(t) => Some((
                t.frame.clone(),
                Profile::Torus { major: t.rational_major()?, minor: t.minor().clone() },
            )),
            Carrier3::Cone(c) => {
                let [radius, slope] = c.meridian()?;
                Some((c.frame.clone(), Profile::Cone { radius, slope }))
            }
            _ => None,
        })
    }
    /// Chart coordinates of a rational point in the carrier's local frame,
    /// in patches `(pu, pv)`; `None` at a pole or off the own sheet. This is
    /// the chart every patch pcurve must use.
    pub fn chart(&self, pu: Patch, pv: Patch, local: &Point) -> Option<[Q; 2]> {
        chart(self, pu, pv, local)
    }
}

/// Chart coordinates of a rational local point in patches `(pu, pv)`;
/// `None` at a pole or off the own sheet.
fn chart(profile: &Profile, pu: Patch, pv: Patch, l: &Point) -> Option<[Q; 2]> {
    let su = pu.sign();
    let rho = match profile {
        Profile::Cylinder { radius } => radius.clone(),
        Profile::Cone { radius, slope } => {
            let rho = radius + slope * &l[2];
            if !rho.is_positive() {
                return None;
            }
            rho
        }
        Profile::Torus { major, minor } => {
            let s = &l[0] * &l[0] + &l[1] * &l[1] + &l[2] * &l[2] + major * major - minor * minor;
            if !s.is_positive() {
                return None;
            }
            s / (q(2) * major)
        }
    };
    let den = &rho + &su * &l[0];
    if den.is_zero() {
        return None;
    }
    let u = &su * &l[1] / den;
    let v = match profile {
        Profile::Cylinder { .. } | Profile::Cone { .. } => l[2].clone(),
        Profile::Torus { major, minor } => {
            let sv = pv.sign();
            let (c, s) = ((&rho - major) / minor, &l[2] / minor);
            let den = Q::one() + &sv * c;
            if den.is_zero() {
                return None;
            }
            sv * s / den
        }
    };
    Some([u, v])
}

/// The partial patch of face `fi`, audited (G3: pcurve identity, iso-curve
/// classes, arc senses; G5: loop orientation). `Ok(None)` when the face is
/// not a [`shape`] candidate.
pub(super) fn patch(d: &Draft, fi: FaceId) -> Result<Option<RevPatch>> {
    if !shape(d, fi) {
        return Ok(None);
    }
    let f = &d.faces[fi.index()];
    let Some((frame, profile)) = Profile::of(&d.surfaces[f.surface.index()].carrier)? else {
        return Ok(None);
    };
    let cols = frame.columns();
    let orientation = dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive();
    let inverse = frame.inverse();
    let coedges = &d.loops[f.loops[0].index()].coedges;
    // A cylinder strip outside this atlas (an irrational corner, or an
    // azimuth range beyond the quarter grid) is measured and located in its
    // own half-angle chart (`extrusion::strip_measures`), not refused here.
    let strip = matches!(profile, Profile::Cylinder { .. }) && super::extrusion::strip(d, fi);
    // Local corner points along the loop.
    let mut corners = vec![];
    for c in coedges {
        let co = &d.coedges[c.index()];
        if co.atlas.is_some() || !matches!(co.pcurve.carrier(), Carrier::Line) {
            return Err(Refused("model/g3-patch-pcurve-class"));
        }
        let Bounds::Segment(v) = d.edges[co.edge.index()].bounds else { unreachable!() };
        let v = if co.forward { v } else { [v[1], v[0]] };
        let keys = v.map(|v| d.vertices[v.index()].def.key()).into_iter().collect::<Result<Vec<_>>>()?;
        if strip && keys.iter().any(|k| k.rational().is_err()) {
            return Ok(None);
        }
        let ends = keys.iter().map(|k| k.rational().cloned()).collect::<Result<Vec<Point>>>()?;
        corners.push([inverse.point(&ends[0]), inverse.point(&ends[1])]);
    }
    let pvs: &[Patch] = match profile {
        Profile::Cylinder { .. } | Profile::Cone { .. } => &[Patch::First],
        Profile::Torus { .. } => &[Patch::First, Patch::Second],
    };
    let mut found = None;
    'patches: for pu in [Patch::First, Patch::Second] {
        'combo: for &pv in pvs {
            let mut charts = vec![];
            for (k, c) in coedges.iter().enumerate() {
                let (Some(a), Some(b)) = (chart(&profile, pu, pv, &corners[k][0]), chart(&profile, pu, pv, &corners[k][1])) else {
                    continue 'combo;
                };
                if d.coedges[c.index()].pcurve.ends() != &[ExactPoint::from_rational(a.clone()), ExactPoint::from_rational(b.clone())] {
                    continue 'combo;
                }
                charts.push([a, b]);
            }
            found = Some((pu, pv, charts));
            break 'patches;
        }
    }
    let (pu, pv, charts) = found.ok_or(Refused("model/g3-patch-chart"))?;
    // Iso-curve classes and senses.
    for (k, c) in coedges.iter().enumerate() {
        let co = &d.coedges[c.index()];
        let [a, b] = &charts[k];
        let curve = &d.curves[d.edges[co.edge.index()].curve.index()].geometry;
        match ((a[0] == b[0]), (a[1] == b[1])) {
            (false, true) => {
                // Latitude arc.
                let Curve3::Circle(circle) = curve else { return Err(Refused("model/g3-patch-latitude-class")) };
                let map = frame.relation_from(circle.frame()?).map;
                if !map.origin()[0].is_zero()
                    || !map.origin()[1].is_zero()
                    || !map.columns()[0][2].is_zero()
                    || !map.columns()[1][2].is_zero()
                {
                    return Err(Refused("model/g3-patch-latitude"));
                }
                let positive = (&map.columns()[0][0] * &map.columns()[1][1]
                    - &map.columns()[0][1] * &map.columns()[1][0])
                    .is_positive();
                if (b[0] > a[0]) != (co.forward == (positive == orientation)) {
                    return Err(Refused("model/g3-patch-latitude-sense"));
                }
            }
            (true, false) => match (&profile, curve) {
                (Profile::Cylinder { .. } | Profile::Cone { .. }, Curve3::Line { .. } | Curve3::RadicalLine { .. }) => {}
                (Profile::Torus { .. }, Curve3::Circle(circle)) => {
                    // Meridian: a tube circle in a plane through the axis.
                    let map = frame.relation_from(circle.frame()?).map;
                    let o = map.origin();
                    let n = cross(&map.columns()[0], &map.columns()[1]);
                    if !o[2].is_zero() || !n[2].is_zero() || !(&n[0] * &o[0] + &n[1] * &o[1]).is_zero() {
                        return Err(Refused("model/g3-patch-meridian"));
                    }
                    let positive = (&n[0] * &o[1] - &n[1] * &o[0]).is_positive();
                    if (b[1] > a[1]) != (co.forward == (positive == orientation)) {
                        return Err(Refused("model/g3-patch-meridian-sense"));
                    }
                }
                _ => return Err(Refused("model/g3-patch-meridian-class")),
            },
            _ => return Err(Refused("model/g3-patch-iso")),
        }
    }
    let mut us: Vec<Q> = charts.iter().map(|c| c[0][0].clone()).collect();
    let mut vs: Vec<Q> = charts.iter().map(|c| c[0][1].clone()).collect();
    us.sort();
    us.dedup();
    vs.sort();
    vs.dedup();
    if us.len() != 2 || vs.len() != 2 {
        return Err(Refused("model/g3-patch-rectangle"));
    }
    let angular = |t: &Q| t.abs() <= Q::one();
    if !us.iter().all(angular) || (matches!(profile, Profile::Torus { .. }) && !vs.iter().all(angular)) {
        if strip {
            return Ok(None);
        }
        return Err(Refused("model/g3-patch-range"));
    }
    // The patch rows measure on the quarter grid only; a strip off it is
    // measured by its chart Green rows (atan terms).
    if strip && !us.iter().all(|t| quarter(t).is_some()) {
        return Ok(None);
    }
    if let Profile::Cone { radius, slope } = &profile {
        // The patch stays on one nappe, off the apex: ρ > 0 at both heights.
        if !vs.iter().all(|z| (radius + slope * z).is_positive()) {
            return Err(Refused("blend/cone-patch-crosses-apex"));
        }
    }
    if let Profile::Torus { major, minor } = &profile {
        // The tube must stay off the axis: ρ > 0 on the whole band.
        let rho = |t: &Q| major + minor * half_angle(pv, t)[0].clone();
        let crosses_inner = pv == Patch::Second && vs[0].is_negative() && vs[1].is_positive();
        if !rho(&vs[0]).is_positive() || !rho(&vs[1]).is_positive() || (crosses_inner && major <= minor) {
            return Err(Refused("blend/spindle-band-crosses-axis"));
        }
    }
    // G5: the chart loop is counter-clockwise exactly when the face normal
    // is the carrier's outward normal in a right-handed frame.
    let area: Q = charts.iter().map(|[a, b]| &a[0] * &b[1] - &a[1] * &b[0]).sum();
    if area.is_zero() || (area.is_positive() != (f.forward == orientation)) {
        return Err(Refused("model/g5-loop-orientation"));
    }
    Ok(Some(RevPatch {
        frame,
        profile,
        pu,
        pv,
        u: [us[0].clone(), us[1].clone()],
        v: [vs[0].clone(), vs[1].clone()],
        forward: f.forward,
    }))
}

pub(super) enum Location {
    Outside,
    Inside,
    Boundary,
}
fn classify(tests: &[Ordering]) -> Location {
    if tests.contains(&Ordering::Less) {
        Location::Outside
    } else if tests.contains(&Ordering::Equal) {
        Location::Boundary
    } else {
        Location::Inside
    }
}

impl RevPatch {
    fn trig_u(&self, t: &Q) -> [Q; 2] {
        half_angle(self.pu, t)
    }
    fn trig_v(&self, t: &Q) -> [Q; 2] {
        half_angle(self.pv, t)
    }
    pub fn local_point(&self, uv: &[Q; 2]) -> Point {
        let [cu, su] = self.trig_u(&uv[0]);
        match &self.profile {
            Profile::Cylinder { radius } => [radius * cu, radius * su, uv[1].clone()],
            Profile::Cone { radius, slope } => {
                let rho = radius + slope * &uv[1];
                [&rho * cu, &rho * su, uv[1].clone()]
            }
            Profile::Torus { major, minor } => {
                let [cv, sv] = self.trig_v(&uv[1]);
                let rho = major + minor * cv;
                [&rho * cu, &rho * su, minor * sv]
            }
        }
    }
    pub fn point(&self, uv: &[Q; 2]) -> Point {
        self.frame.point(&self.local_point(uv))
    }
    /// The location tests as polynomials `Σ cᵢ·mᵢ` evaluated by `eval` on
    /// local coordinates: azimuth crosses, meridian crosses, own sheet.
    fn tests<T>(&self, x: &T, y: &T, z: &T, s: Option<&T>, lin: impl Fn(&[(&Q, &T)], &Q) -> T) -> Vec<T> {
        let [c0, s0] = self.trig_u(&self.u[0]);
        let [c1, s1] = self.trig_u(&self.u[1]);
        let zero = Q::zero();
        let mut out = vec![
            // cross(e0, (x, y)) and cross((x, y), e1).
            lin(&[(&c0, y), (&-s0.clone(), x)], &zero),
            lin(&[(&s1, x), (&-c1.clone(), y)], &zero),
        ];
        match &self.profile {
            Profile::Cylinder { .. } | Profile::Cone { .. } => {
                out.push(lin(&[(&Q::one(), z)], &-self.v[0].clone()));
                out.push(lin(&[(&-Q::one(), z)], &self.v[1]));
            }
            Profile::Torus { major, .. } => {
                let s = s.expect("torus sheet value");
                let r2 = q(2) * major * major;
                let [cv0, sv0] = self.trig_v(&self.v[0]);
                let [cv1, sv1] = self.trig_v(&self.v[1]);
                let two_r = q(2) * major;
                // V = (S − 2R², 2Rz): cross(e0, V) and cross(V, e1).
                out.push(lin(&[(&(&cv0 * &two_r), z), (&-sv0.clone(), s)], &(&sv0 * &r2)));
                out.push(lin(&[(&sv1, s), (&-(&cv1 * &two_r), z)], &-(&sv1 * &r2)));
                out.push(lin(&[(&Q::one(), s)], &zero));
            }
        }
        out
    }
    pub(super) fn locate(&self, p: &VertexKey) -> Result<Location> {
        let inverse = self.frame.inverse();
        let l: [Radical; 3] = match p {
            VertexKey::Rational(p) => inverse.point(p).map(Radical::from),
            VertexKey::Quadratic(p) => p.mapped(&inverse)?.coordinates().clone(),
            VertexKey::Real(p) => super::algebraic::mapped(p, &inverse),
        };
        wonky_curve::radical::guard(|| {
            let s = match &self.profile {
                Profile::Torus { major, minor } => {
                    Some(&l[0] * &l[0] + &l[1] * &l[1] + &l[2] * &l[2] + Radical::from(major * major - minor * minor))
                }
                Profile::Cylinder { .. } | Profile::Cone { .. } => None,
            };
            let lin = |terms: &[(&Q, &Radical)], c: &Q| {
                terms.iter().fold(Radical::from(c.clone()), |acc, (k, v)| acc + *v * *k)
            };
            let zero = Radical::default();
            let signs: Vec<Ordering> =
                self.tests(&l[0], &l[1], &l[2], s.as_ref(), lin).iter().map(|t| t.cmp(&zero)).collect();
            classify(&signs)
        })
        .map_err(|_| Refused("boolean/budget-exceeded:patch-locate"))
    }
    /// Interior chart points (rational on a rational carrier).
    pub(super) fn witnesses(&self) -> Vec<Point> {
        let mut out = vec![];
        for fu in [Q::new(1.into(), 2.into()), Q::new(1.into(), 3.into()), Q::new(2.into(), 3.into())] {
            for fv in [Q::new(1.into(), 2.into()), Q::new(1.into(), 3.into()), Q::new(2.into(), 3.into()), Q::new(1.into(), 5.into())] {
                let u = &self.u[0] + (&self.u[1] - &self.u[0]) * &fu;
                let v = &self.v[0] + (&self.v[1] - &self.v[0]) * &fv;
                out.push(self.point(&[u, v]));
            }
        }
        out
    }
    /// Ray hits `w + s·direction`, `s ≥ 0`, inside this patch: the carrier
    /// polynomial's real roots are isolated exactly and every location test
    /// is a sign at the root. A multiple root, or a root on a test, is
    /// ambiguous: `None`.
    pub(super) fn hits(&self, w: &Point, direction: &Point, w_on_carrier_counts: bool) -> Result<Option<usize>> {
        let inverse = self.frame.inverse();
        let l0 = inverse.point(w);
        let m = inverse.vector(direction);
        type P = Vec<Q>;
        let mul = |a: &[Q], b: &[Q]| {
            let mut out = vec![Q::zero(); a.len() + b.len() - 1];
            for (i, x) in a.iter().enumerate() {
                for (j, y) in b.iter().enumerate() {
                    out[i + j] += x * y;
                }
            }
            out
        };
        let add = |a: &[Q], b: &[Q]| {
            let mut out = vec![Q::zero(); a.len().max(b.len())];
            for (i, x) in a.iter().enumerate() {
                out[i] += x;
            }
            for (i, x) in b.iter().enumerate() {
                out[i] += x;
            }
            out
        };
        let lin_c = |i: usize| -> P { vec![l0[i].clone(), m[i].clone()] };
        let (x, y, z) = (lin_c(0), lin_c(1), lin_c(2));
        let rho2 = add(&mul(&x, &x), &mul(&y, &y));
        let (carrier, s) = match &self.profile {
            Profile::Cylinder { radius } => (add(&rho2, &[-(radius * radius)]), None),
            Profile::Cone { radius, slope } => {
                let rho = add(&[radius.clone()], &z.iter().map(|c| c * slope).collect::<Vec<_>>());
                (add(&rho2, &mul(&rho, &rho).iter().map(|c| -c).collect::<Vec<_>>()), None)
            }
            Profile::Torus { major, minor } => {
                let s = add(&add(&rho2, &mul(&z, &z)), &[major * major - minor * minor]);
                let f = add(&mul(&s, &s), &rho2.iter().map(|c| -(c * q(4) * major * major)).collect::<Vec<_>>());
                (f, Some(s))
            }
        };
        if carrier.iter().all(Q::is_zero) {
            return Ok(None);
        }
        let poly = |c: P| Polynomial::new(c).map_err(|_| Refused("boolean/budget-exceeded:patch-ray"));
        let err = |_| Refused("boolean/budget-exceeded:patch-ray");
        let lin = |terms: &[(&Q, &P)], c: &Q| -> P {
            terms.iter().fold(vec![c.clone()], |acc, (k, v)| add(&acc, &v.iter().map(|x| x * *k).collect::<Vec<_>>()))
        };
        let tests = self
            .tests(&x, &y, &z, s.as_ref(), lin)
            .into_iter()
            .map(|t| poly(t))
            .collect::<Result<Vec<_>>>()?;
        let limits = Limits::default();
        let roots = isolate_real_roots(&poly(carrier)?, limits).map_err(err)?;
        let identity = poly(vec![Q::zero(), Q::one()])?;
        let ord = |s: Sign| match s {
            Sign::Negative => Ordering::Less,
            Sign::Zero => Ordering::Equal,
            Sign::Positive => Ordering::Greater,
        };
        let mut hits = 0;
        for root in roots {
            let position = ord(root.sign_at(&identity, limits).map_err(err)?);
            if position == Ordering::Less {
                continue;
            }
            let signs = tests
                .iter()
                .map(|t| root.sign_at(t, limits).map(ord).map_err(err))
                .collect::<Result<Vec<_>>>()?;
            let location = classify(&signs);
            if position == Ordering::Equal {
                if w_on_carrier_counts || matches!(location, Location::Outside) {
                    continue;
                }
                return Ok(None);
            }
            match location {
                Location::Outside => {}
                Location::Boundary => return Ok(None),
                Location::Inside => {
                    if root.multiplicity() > 1 {
                        return Ok(None);
                    }
                    hits += 1;
                }
            }
        }
        Ok(Some(hits))
    }
    /// The patch's contribution to six times the signed volume.
    pub fn volume6(&self) -> Result<PiValue> {
        let cols = self.frame.columns();
        let det = dot(&cols[0], &cross(&cols[1], &cols[2])).abs();
        let c = self.frame.inverse().vector(self.frame.origin());
        let [cu0, su0] = self.trig_u(&self.u[0]);
        let [cu1, su1] = self.trig_u(&self.u[1]);
        // ∫∫ (c_x, c_y)·(cos φ, sin φ) dφ = c_x Δsin φ − c_y Δcos φ.
        let c_delta = &c[0] * (su1 - su0) - &c[1] * (cu1 - cu0);
        let usw = swept(&self.u)?;
        let mut flux = PiValue::default();
        match &self.profile {
            Profile::Cylinder { radius } => {
                let dz = &self.v[1] - &self.v[0];
                flux.pi = &usw * radius * radius * &dz;
                flux.rational = &c_delta * radius * &dz;
            }
            Profile::Cone { radius: r0, slope: k } => {
                // l_φ × l_z = ρ(cos φ, sin φ, −k); l·N = ρ·r0, so both terms
                // carry I = ∫ρ dz = r0Δz + k(z1² − z0²)/2.
                let (z0, z1) = (&self.v[0], &self.v[1]);
                // Planted F2c negative: the patch's apex on the other side.
                #[cfg(feature = "plant_cone_patch_apex_flip")]
                let k = &-k.clone();
                let i = r0 * (z1 - z0) + k * (z1 * z1 - z0 * z0) / q(2);
                flux.pi = &usw * (r0 - &c[2] * k) * &i;
                flux.rational = &c_delta * &i;
            }
            Profile::Torus { major: r, minor: a } => {
                let [cl, sl] = self.trig_v(&self.v[0]);
                let [ch, sh] = self.trig_v(&self.v[1]);
                let vsw = swept(&self.v)?;
                let ds = &sh - &sl;
                let dsc = &sh * &ch - &sl * &cl;
                let rho = |c: &Q| r + a * c;
                let drho2 = rho(&ch) * rho(&ch) - rho(&cl) * rho(&cl);
                let half = Q::new(1.into(), 2.into());
                flux.pi2 = &usw * q(3) * &half * a * a * r * &vsw;
                flux.pi = &usw * ((a * r * r + a * a * a) * &ds + &half * a * a * r * &dsc)
                    + &c_delta * a * a * &vsw * &half
                    - &c[2] * &usw * &drho2 * &half;
                flux.rational = &c_delta * (a * r * &ds + &half * a * a * &dsc);
            }
        }
        let sign = if self.forward { q(2) } else { q(-2) } * det;
        Ok(PiValue { rational: &sign * flux.rational, pi: &sign * flux.pi, pi2: sign * flux.pi2 })
    }
    /// The patch's exact first-moment fluxes `∮ x_i (x·n) dA` (model frame)
    /// and `∮ x·n dA`, the field terms of `periodic::moments`; cylinder and
    /// cone patches. With P = M(l + c), l = (ρ cos φ, ρ sin φ, z), ρ = r0 +
    /// k z and l_φ × l_z = ρ(cos φ, sin φ, −k): (l + c)·n_l = ρ(a + c_x cos φ
    /// + c_y sin φ) with a = r0 − k c_z, each φ integral is rational plus a
    /// rational multiple of π on the quarter grid, each z integral rational.
    pub fn moment_flux(&self) -> Result<([PiValue; 3], PiValue)> {
        let (r0, k) = match &self.profile {
            Profile::Cylinder { radius } => (radius.clone(), Q::zero()),
            Profile::Cone { radius, slope } => (radius.clone(), slope.clone()),
            Profile::Torus { .. } => return Err(Refused("boolean/ssi-row-unavailable:moment/torus-patch")),
        };
        let cols = self.frame.columns();
        let det = dot(&cols[0], &cross(&cols[1], &cols[2])).abs();
        let sense = if self.forward { det } else { -det };
        let c = self.frame.inverse().vector(self.frame.origin());
        let [cu0, su0] = self.trig_u(&self.u[0]);
        let [cu1, su1] = self.trig_u(&self.u[1]);
        let usw = swept(&self.u)?;
        let half = Q::new(1.into(), 2.into());
        let value = |rational: Q, pi: Q| PiValue { rational, pi, pi2: Q::zero() };
        // Σ s_k · v_k over (rational scale, PiValue) pairs.
        let sum = |terms: &[(Q, &PiValue)]| {
            terms.iter().fold(PiValue::default(), |acc, (s, v)| value(acc.rational + s * &v.rational, acc.pi + s * &v.pi))
        };
        // φ integrals of 1, cos, sin, cos², sin², sin cos.
        let sc_delta = (&su1 * &cu1 - &su0 * &cu0) * &half;
        let s1 = value(Q::zero(), usw.clone());
        let sc = value(&su1 - &su0, Q::zero());
        let ss = value(&cu0 - &cu1, Q::zero());
        let scc = value(sc_delta.clone(), &usw * &half);
        let sss = value(-sc_delta, &usw * &half);
        let scs = value((&su1 * &su1 - &su0 * &su0) * &half, Q::zero());
        // z integrals of ρ, ρ², z ρ.
        let (z0, z1) = (&self.v[0], &self.v[1]);
        let power = |n: i32| (z1.pow(n) - z0.pow(n)) / q(n.into());
        let i1 = &r0 * power(1) + &k * power(2);
        let i2 = &r0 * &r0 * power(1) + q(2) * &r0 * &k * power(2) + &k * &k * power(3);
        let iz = &r0 * power(2) + &k * power(3);
        let a = &r0 - &k * &c[2];
        let base = sum(&[(a.clone(), &s1), (c[0].clone(), &sc), (c[1].clone(), &ss)]);
        let j = [
            sum(&[(i2.clone(), &sum(&[(a.clone(), &sc), (c[0].clone(), &scc), (c[1].clone(), &scs)])), (&c[0] * &i1, &base)]),
            sum(&[(i2.clone(), &sum(&[(a.clone(), &ss), (c[0].clone(), &scs), (c[1].clone(), &sss)])), (&c[1] * &i1, &base)]),
            sum(&[(&iz + &c[2] * &i1, &base)]),
        ];
        let flux = std::array::from_fn(|i| sum(&[(&sense * &cols[0][i], &j[0]), (&sense * &cols[1][i], &j[1]), (&sense * &cols[2][i], &j[2])]));
        Ok((flux, sum(&[(&sense * &i1, &base)])))
    }
    /// Area scale |x|² of a similarity frame.
    fn area_scale(&self) -> Result<Q> {
        let [x, y, z] = self.frame.columns();
        let scale = dot(x, x);
        if dot(y, y) != scale || dot(z, z) != scale || !dot(x, y).is_zero() || !dot(x, z).is_zero() || !dot(y, z).is_zero() {
            return Err(Refused("boolean/ssi-row-unavailable:patch/non-similar-area"));
        }
        Ok(scale)
    }
    /// The area of a cone patch whose slant √(1 + k²) is irrational (a 45°
    /// chamfer cone: √2) as `value · √radicand`, exactly; `None` for every
    /// other patch (their `area` is exact in Q + Qπ + Qπ²).
    pub fn surd_area(&self) -> Result<Option<(PiValue, Q)>> {
        let Profile::Cone { radius: r0, slope: k } = &self.profile else { return Ok(None) };
        let radicand = Q::one() + k * k;
        if exact_root(&radicand).is_some() {
            return Ok(None);
        }
        let scale = self.area_scale()?;
        let (z0, z1) = (&self.v[0], &self.v[1]);
        let i = r0 * (z1 - z0) + k * (z1 * z1 - z0 * z0) / q(2);
        Ok(Some((PiValue { rational: Q::zero(), pi: swept(&self.u)? * i * scale, pi2: Q::zero() }, radicand)))
    }
    /// Area (independent of the face sense); similarity frames only.
    pub fn area(&self) -> Result<PiValue> {
        let scale = self.area_scale()?;
        let usw = swept(&self.u)?;
        Ok(match &self.profile {
            Profile::Cylinder { radius } => PiValue {
                rational: Q::zero(),
                pi: usw * radius * (&self.v[1] - &self.v[0]) * &scale,
                pi2: Q::zero(),
            },
            Profile::Cone { radius: r0, slope: k } => {
                // dA = ρ·√(1 + k²) dφ dz: exact only for a rational slant.
                let slant = exact_root(&(Q::one() + k * k))
                    .ok_or(Refused("boolean/ssi-row-unavailable:patch/irrational-cone-slant"))?;
                let (z0, z1) = (&self.v[0], &self.v[1]);
                let i = r0 * (z1 - z0) + k * (z1 * z1 - z0 * z0) / q(2);
                PiValue { rational: Q::zero(), pi: usw * slant * i * &scale, pi2: Q::zero() }
            }
            Profile::Torus { major: r, minor: a } => {
                let [_, sl] = self.trig_v(&self.v[0]);
                let [_, sh] = self.trig_v(&self.v[1]);
                PiValue {
                    rational: Q::zero(),
                    pi: &usw * a * a * (sh - sl) * &scale,
                    pi2: usw * a * r * swept(&self.v)? * &scale,
                }
            }
        })
    }
}
