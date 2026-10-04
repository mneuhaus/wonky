//! Exact full-turn disk revolutions. A ring torus has one closed analytic face,
//! no topological seams, and genus one. STEP chart seams are export-only.
//!
//! World-space inputs require an exact signed-permutation meridian. A shared
//! interpreter construction can instead supply the local XZ meridian and Z
//! axis in one frame. Its affine map is observation-only (E4/E9); independent
//! normalized world directions are never snapped into incidence.
use crate::affine::Affine;
use crate::polyhedron::Refused;
use std::result::Result;
use wonky_contract::*;
use wonky_num::expansion::{self as ex, Exp, Guard};
use wonky_num::{Iv, Scalar};
use wonky_sketch::circle_region::{circle_region, Disk};

type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("revolve/{s}"))
}
fn scalar(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn vec3(v: [f64; 3]) -> R<Vector3> {
    Ok([scalar(v[0])?, scalar(v[1])?, scalar(v[2])?])
}

#[derive(Clone, Debug)]
pub struct CircleRevolve {
    pub key: BodyKey,
    pub source: [u32; 4],
    pub sketch: Affine,
    pub axis_origin: [f64; 3],
    pub axis: [f64; 3],
    pub disk: Disk,
    /// Full-turn sentinel: precisely the interpreter's 360 * degree value.
    /// Adjacent binary64 angles are not rounded to a full turn.
    pub angle: f64,
}

fn signed_axis(v: [f64; 3]) -> bool {
    v.iter().filter(|&&x| x.abs() == 1.0).count() == 1
        && v.iter().all(|&x| x == 0.0 || x.abs() == 1.0)
}
fn exact_origin_contact(d: Disk) -> R<bool> {
    let mut g = Guard::new();
    let a = ex::product(d.center[0], d.center[0], &mut g);
    let b = ex::product(d.center[1], d.center[1], &mut g);
    let c = ex::product(d.radius, d.radius, &mut g);
    let e = ex::sum(&ex::sum(&a, &b, &mut g), &ex::neg(&c), &mut g);
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    Ok(ex::sign(&e) == 0)
}

/// Return a real toroidal B-rep, or a named refusal. The origin-contact test
/// precedes frame admission: (0,0) in the sketch maps to the identical axis
/// origin without any floating point arithmetic, even in a skew frame.
fn admit(input: &CircleRevolve) -> R<Disk> {
    let d =
        circle_region(input.disk.center, input.disk.radius).map_err(|_| no("invalid-circle"))?;
    let all: Vec<_> = input
        .sketch
        .origin
        .iter()
        .chain(input.sketch.x.iter())
        .chain(input.sketch.z.iter())
        .chain(input.axis_origin.iter())
        .chain(input.axis.iter())
        .copied()
        .chain([input.angle])
        .collect();
    wonky_num::check_range(&all, "circle revolve").map_err(|e| {
        e.into_refusal();
        no("numeric-range")
    })?;
    if !wonky_geom::turn::sentinel(input.angle, 360) {
        return Err(no("partial-circle-angle"));
    }
    if input.axis == [0.0; 3] {
        return Err(no("zero-axis"));
    }
    if input.axis_origin != input.sketch.origin {
        return Err(no("axis-origin-pullback"));
    }
    // A singular refusal is a geometric outcome, not a capability claim.
    // Validate the sketch chart first so a collapsed chart cannot prove contact.
    let mut g = Guard::new();
    let sy = input.sketch.y_exact(&mut g);
    if !g.exact() || sy.iter().all(|x| ex::sign(x) == 0) {
        return Err(no("degenerate-sketch-frame"));
    }
    if exact_origin_contact(d)? {
        // Contact at one profile point is not enough: an in-plane axis that
        // cuts across the disk can produce a sphere, not a horn pinch. Prove
        // either transverse plane contact or exact tangency to the ellipse
        // that is the disk's affine image before naming a singular outcome.
        let tangent: [Exp; 3] = std::array::from_fn(|k| {
            ex::sum(
                &ex::product(-d.center[1], input.sketch.x[k], &mut g),
                &ex::mul(&[d.center[0]], &sy[k], &mut g),
                &mut g,
            )
        });
        let mut plane_dot = vec![];
        let mut parallel = true;
        for k in 0..3 {
            let a = (k + 1) % 3;
            let b = (k + 2) % 3;
            let normal = ex::sum(
                &ex::mul(&[input.sketch.x[a]], &sy[b], &mut g),
                &ex::neg(&ex::mul(&[input.sketch.x[b]], &sy[a], &mut g)),
                &mut g,
            );
            plane_dot = ex::sum(
                &plane_dot,
                &ex::mul(&[input.axis[k]], &normal, &mut g),
                &mut g,
            );
            let cross = ex::sum(
                &ex::mul(&[input.axis[a]], &tangent[b], &mut g),
                &ex::neg(&ex::mul(&[input.axis[b]], &tangent[a], &mut g)),
                &mut g,
            );
            parallel &= ex::sign(&cross) == 0;
        }
        if !g.exact() {
            return Err(no("numeric-range"));
        }
        if ex::sign(&plane_dot) != 0 || parallel {
            return Err(no(
                "singular-geometry: isolated axis contact at profile origin",
            ));
        }
        return Err(no("axis-crossing-circle"));
    }
    if !signed_axis(input.sketch.x) || !signed_axis(input.sketch.z) {
        return Err(no("axis-frame-proof-unavailable"));
    }
    let y = input.sketch.columns().map_err(|_| no("numeric-range"))?[1];
    if !signed_axis(y) || !(input.axis == y || input.axis == y.map(|v| -v)) {
        return Err(no("axis-not-sketch-y"));
    }
    let major = d.center[0].abs();
    if major == d.radius {
        return Err(no("singular-geometry: circle tangent to revolve axis"));
    }
    if major < d.radius {
        return Err(no("axis-crossing-circle"));
    }
    Ok(d)
}

pub fn circle_revolve(input: &CircleRevolve) -> R<Body> {
    let d = admit(input)?;
    let major = d.center[0].abs();
    let frame = Affine {
        origin: input.sketch.origin,
        x: input.sketch.x,
        z: input.sketch.columns().map_err(|_| no("numeric-range"))?[1],
    };
    let parameters = input
        .sketch
        .origin
        .into_iter()
        .chain(input.sketch.x)
        .chain(input.sketch.z)
        .chain(input.axis_origin)
        .chain(input.axis)
        .chain(d.center)
        .chain([d.radius, input.angle])
        .map(scalar)
        .collect::<R<Vec<_>>>()?;
    let body = Body {
        key: input.key.clone(),
        frames: vec![
            Frame::Source {
                source: input.source,
            },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: vec3(frame.origin)?,
                x: vec3(frame.x)?,
                z: vec3(frame.z)?,
            },
        ],
        constructions: vec![
            Construction {
                operation: Operation::Interpreter {},
                rule_version: 1,
                parents: vec![],
                parameters,
                frame: FrameId(0),
            },
            Construction {
                operation: Operation::Revolve {},
                rule_version: 1,
                parents: vec![NodeId(0)],
                parameters: vec![],
                frame: FrameId(1),
            },
        ],
        vertices: vec![],
        curves: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        surfaces: vec![Surface {
            frame: FrameId(1),
            provenance: Provenance::Construction { node: NodeId(1) },
            geometry: SurfaceGeometry::Torus {
                origin: vec3([0.0, 0.0, d.center[1]])?,
                axis: vec3([0.0, 0.0, 1.0])?,
                x: vec3([1.0, 0.0, 0.0])?,
                major: scalar(major)?,
                minor: scalar(d.radius)?,
            },
        }],
        faces: vec![Face {
            surface: SurfaceId(0),
            forward: true,
            loops: vec![],
        }],
        shells: vec![Shell {
            faces: vec![FaceId(0)],
        }],
        solids: vec![Solid {
            shells: vec![ShellId(0)],
        }],
        facts: vec![],
        budgets: vec![],
    };
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}

/// Revolve the local XZ meridian around local Z, then observe in the supplied
/// interpreter frame. The frontend supplies this entry only with a common
/// construction-frame witness, never by testing rounded world incidence.
pub fn circle_revolve_in_frame(key: BodyKey, source: [u32; 4], frame: Affine, disk: Disk, angle: f64) -> R<Body> {
    let mut body = circle_revolve(&CircleRevolve {
        key, source, sketch: Affine { origin: [0.; 3], x: [1., 0., 0.], z: [0., -1., 0.] },
        axis_origin: [0.; 3], axis: [0., 0., 1.], disk, angle,
    })?;
    body.constructions[0].parameters.extend(frame.origin.into_iter().chain(frame.x).chain(frame.z).map(scalar).collect::<R<Vec<_>>>()?);
    body.frames[1] = Frame::Interpreter { parent: FrameId(0), origin: vec3(frame.origin)?, x: vec3(frame.x)?, z: vec3(frame.z)? };
    body.clone().check().map_err(|_| no("contract"))?;
    Ok(body)
}

/// Audited analytic body. Admission checks the emitted carrier and topology
/// independently of the builder. Measurements and STEP use that carrier, not
/// the construction receipt. Replaying a builder here would share its bugs.
pub struct Torus {
    pub(crate) frame: Affine,
    pub(crate) major: f64,
    pub(crate) minor: f64,
    pub(crate) height: f64,
}
pub fn audit(checked: &CheckedBody) -> R<Torus> {
    let b = checked.body();
    let n = b
        .constructions
        .first()
        .ok_or_else(|| no("missing-construction"))?;
    if n.parameters.len() != 19 && n.parameters.len() != 28 {
        return Err(no("construction-arity"));
    }
    let p: Vec<_> = n.parameters.iter().map(|x| x.get()).collect();
    let three = |i| [p[i], p[i + 1], p[i + 2]];
    let Some(Frame::Source { source }) = b.frames.first() else {
        return Err(no("source-frame"));
    };
    let input = CircleRevolve {
        key: b.key.clone(),
        source: *source,
        sketch: Affine {
            origin: three(0),
            x: three(3),
            z: three(6),
        },
        axis_origin: three(9),
        axis: three(12),
        disk: Disk {
            center: [p[15], p[16]],
            radius: p[17],
        },
        angle: p[18],
    };
    admit(&input)?;
    let mismatch = || no("construction-body-mismatch");
    // The authoritative request is a root node, followed by the operation.
    // No unsupported facts/budgets or disconnected geometry can hide beside it.
    if b.frames.len() != 2
        || b.constructions.len() != 2
        || n.operation != (Operation::Interpreter {})
        || n.rule_version != 1
        || n.frame != FrameId(0)
        || !n.parents.is_empty()
        || b.constructions[1]
            != (Construction {
                operation: Operation::Revolve {},
                rule_version: 1,
                parents: vec![NodeId(0)],
                parameters: vec![],
                frame: FrameId(1),
            })
        || !b.vertices.is_empty()
        || !b.curves.is_empty()
        || !b.pcurves.is_empty()
        || !b.edges.is_empty()
        || !b.coedges.is_empty()
        || !b.loops.is_empty()
        || !b.facts.is_empty()
        || !b.budgets.is_empty()
        || b.surfaces.len() != 1
        || b.faces.len() != 1
        || b.shells.len() != 1
        || b.solids.len() != 1
    {
        return Err(mismatch());
    }
    let Frame::Interpreter {
        parent,
        origin,
        x,
        z,
    } = &b.frames[1]
    else {
        return Err(mismatch());
    };
    let frame = Affine {
        origin: origin.map(Binary64::get),
        x: x.map(Binary64::get),
        z: z.map(Binary64::get),
    };
    let sy = input.sketch.columns().map_err(|_| no("numeric-range"))?[1];
    let expected_frame = if p.len() == 28 {
        // The construction operands, not their rounded world images, prove
        // the common meridian/axis frame. No second coordinate system is used.
        if input.sketch != (Affine { origin: [0.; 3], x: [1., 0., 0.], z: [0., -1., 0.] })
            || input.axis_origin != [0.; 3] || input.axis != [0., 0., 1.] {
            return Err(mismatch());
        }
        Affine { origin: three(19), x: three(22), z: three(25) }
    } else {
        Affine { origin: input.sketch.origin, x: input.sketch.x, z: sy }
    };
    if *parent != FrameId(0) || frame != expected_frame {
        return Err(mismatch());
    }
    let surface = &b.surfaces[0];
    let SurfaceGeometry::Torus {
        origin,
        axis,
        x,
        major,
        minor,
    } = &surface.geometry
    else {
        return Err(mismatch());
    };
    let (o, axis, x) = (
        origin.map(Binary64::get),
        axis.map(Binary64::get),
        x.map(Binary64::get),
    );
    let (major, minor) = (major.get(), minor.get());
    // Independent meridian identity: (rho - R)^2 + (z - h)^2 = r^2.
    // The two signs of the input radial coordinate generate the same solid.
    // Compare squared radii exactly, not by replaying the builder's abs()/sum.
    let mut g = Guard::new();
    let radial_error = ex::sum(
        &ex::product(major, major, &mut g),
        &ex::neg(&ex::product(
            input.disk.center[0],
            input.disk.center[0],
            &mut g,
        )),
        &mut g,
    );
    if !g.exact() {
        return Err(no("numeric-range"));
    }
    if surface.frame != FrameId(1)
        || surface.provenance != (Provenance::Construction { node: NodeId(1) })
        || o != [0., 0., input.disk.center[1]]
        || axis != [0., 0., 1.]
        || x != [1., 0., 0.]
        || major <= minor
        || ex::sign(&radial_error) != 0
        || minor != input.disk.radius
        || b.faces[0].surface != SurfaceId(0)
        || !b.faces[0].forward
        || !b.faces[0].loops.is_empty()
        || b.shells[0].faces != [FaceId(0)]
        || b.solids[0].shells != [ShellId(0)]
    {
        return Err(mismatch());
    }
    Ok(Torus {
        frame,
        major,
        minor,
        height: o[2],
    })
}

fn finite(v: Iv) -> R<Iv> {
    if v.is_nan() || !v.lo().is_finite() || !v.hi().is_finite() {
        Err(no("measurement-range"))
    } else {
        Ok(v)
    }
}
fn enclosed(e: &[f64]) -> Iv {
    e.iter().fold(Iv::point(0.0), |s, &x| s + Iv::point(x))
}
fn js(x: f64) -> String {
    format!("{:?}", if x == 0.0 { 0.0 } else { x })
}
fn xyz(v: [f64; 3]) -> String {
    format!("[{},{},{}]", js(v[0]), js(v[1]), js(v[2]))
}

fn cross(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> [Exp; 3] {
    std::array::from_fn(|k| {
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        ex::sum(&ex::mul(&a[i], &b[j], g), &ex::neg(&ex::mul(&a[j], &b[i], g)), g)
    })
}
fn dot(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> Exp {
    let mut e = vec![];
    for k in 0..3 { e = ex::sum(&e, &ex::mul(&a[k], &b[k], g), g); }
    e
}

impl Torus {
    fn columns_exact(&self, g: &mut Guard) -> [ [Exp; 3]; 3] {
        [self.frame.x.map(|v| vec![v]), self.frame.y_exact(g), self.frame.z.map(|v| vec![v])]
    }
    /// Gershgorin bound on |A^T A - I|, using the exact (unrounded) columns.
    /// This is an observation budget, never a topology/axis admission tolerance.
    pub fn metric_defect(&self) -> R<f64> {
        let mut g = Guard::new();
        let c = self.columns_exact(&mut g);
        let mut worst = 0.0f64;
        for i in 0..3 {
            let mut row = Iv::point(0.);
            for j in 0..3 {
                let mut e = dot(&c[i], &c[j], &mut g);
                if i == j { e = ex::sum(&e, &[-1.], &mut g); }
                let b = enclosed(&e);
                row = row + Iv::point(b.lo().abs().max(b.hi().abs()));
            }
            worst = worst.max(row.hi());
        }
        if !g.exact() || !worst.is_finite() || worst >= 0.5 { return Err(no("frame-metric-range")); }
        Ok(worst)
    }

    /// π is a proved enclosure from VA1. Every subsequent arithmetic operation
    /// is outward rounded; no floating π is presented as an exact volume/area.
    pub fn measures_mm(&self) -> R<(Iv, Iv)> {
        let pi = wonky_validated::pi(1e-14)
            .map_err(|_| no("validated-pi"))?
            .ball();
        let r = Iv::point(self.minor) * Iv::point(1000.0);
        let major = Iv::point(self.major) * Iv::point(1000.0);
        let distortion = self.metric_defect()?;
        // The area scale of any tangent plane lies between the smallest and
        // largest eigenvalues of A^T A. Volume uses the exact determinant.
        let area = finite(Iv::point(4.0) * pi * pi * major * r * Iv { m: 1., r: distortion })?;
        let det = self.frame.det_exact().map_err(|_| no("measurement-range"))?;
        let volume = finite(Iv::point(2.0) * pi * pi * major * r * r * enclosed(&det))?;
        if volume.lo() <= 0.0 || volume.r / volume.m > 1e-9 || area.r / area.m > 1e-9 {
            return Err(no("measurement-width"));
        }
        Ok((volume, area))
    }
    pub fn center_mm(&self) -> R<[f64; 3]> {
        self.frame
            .apply([0.0, 0.0, self.height], 1000.0, true)
            .map_err(|_| no("measurement-range"))
    }
    /// Support function of a torus: R*hypot(a,b) + r*hypot(a,b,c).
    /// The optional observation map is arbitrary affine DATA, never a frame
    /// used to decide topology. All arithmetic is interval-enclosed.
    pub fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let m = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let center = self
            .frame
            .apply_exact([0., 0., self.height], 1000., true)
            .map_err(|_| no("measurement-range"))?;
        let mut g = Guard::new();
        let cols = self.columns_exact(&mut g);
        if !g.exact() { return Err(no("measurement-range")); }
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let mut c = Iv::point(m[k][3]);
            let mut d = [Iv::point(0.0); 3];
            for j in 0..3 {
                c = c + Iv::point(m[k][j]) * enclosed(&center[j]);
                for a in 0..3 {
                    d[a] = d[a] + Iv::point(m[k][j]) * enclosed(&cols[a][j]);
                }
            }
            let extent = Iv::point(1000.)
                * (Iv::point(self.major) * d[0].norm3(d[1], Iv::point(0.))
                    + Iv::point(self.minor) * d[0].norm3(d[1], d[2]));
            let lower = finite(c - extent)?;
            let upper = finite(c + extent)?;
            lo[k] = lower.m;
            hi[k] = upper.m;
        }
        Ok((lo, hi))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let center = self.center_mm()?;
        let magnitude = center.into_iter().fold(0.0f64, |a, b| a.max(b.abs()));
        // STEP's analytic placements normalize the axes, unlike WC0's affine
        // frame. Bound that display projection as well as numeric/chart error.
        // The 8*d reach budget encloses Gram-Schmidt and circle placement
        // displacement for d < 1/2; it never changes the source geometry.
        let defect = self.metric_defect()?;
        let reach = Iv::point(1000.) * (Iv::point(self.height.abs()) + Iv::point(self.major) + Iv::point(self.minor));
        let v = finite(
            Iv::point(32.0 * f64::EPSILON)
                * (Iv::point(magnitude)
                    + Iv::point(1000.0) * (Iv::point(self.major) + Iv::point(self.minor)))
                + Iv::point(8.) * Iv::point(defect) * reach,
        )?;
        Ok(v.hi())
    }
    pub fn probe_mm(&self, q: [f64; 3]) -> R<(Iv, bool)> {
        if q.iter().any(|x| !x.is_finite()) {
            return Err(no("probe-range"));
        }
        let mut g = Guard::new();
        let center = self
            .frame
            .apply_exact([0., 0., self.height], 1000., true)
            .map_err(|_| no("probe-range"))?;
        let cols = self.columns_exact(&mut g);
        let adj = [cross(&cols[1], &cols[2], &mut g), cross(&cols[2], &cols[0], &mut g), cross(&cols[0], &cols[1], &mut g)];
        let det = dot(&cols[0], &adj[0], &mut g);
        let delta: [Exp; 3] = std::array::from_fn(|j| ex::sum(&[q[j]], &ex::neg(&center[j]), &mut g));
        // Homogeneous inverse: coordinates n_i / det. Clear denominators in
        // the torus quartic, so even a one-ulp boundary gap has an exact sign.
        let local: [Exp; 3] = std::array::from_fn(|i| dot(&adj[i], &delta, &mut g));
        let det2 = ex::mul(&det, &det, &mut g);
        let rr = ex::product(self.minor, 1000., &mut g);
        let major = ex::product(self.major, 1000., &mut g);
        if !g.exact() { return Err(no("probe-range")); }
        let divisor = enclosed(&det);
        let [x, y, z] = local.clone().map(|v| enclosed(&v) / divisor);
        let major_iv = enclosed(&major);
        let r_iv = enclosed(&rr);
        let radial_iv = x * x + y * y;
        let sum_iv = radial_iv + z * z + major_iv * major_iv - r_iv * r_iv;
        let filter = finite(sum_iv * sum_iv - Iv::point(4.) * major_iv * major_iv * radial_iv)?;
        // A proved interval sign avoids unnecessarily expanding a high-degree
        // quartic into unrepresentably tiny components. Ambiguous signs still
        // use the exact polynomial, or refuse if its guard loses exactness.
        let inside = if filter.hi() < 0. { true } else if filter.lo() > 0. { false } else {
        let radial = ex::sum(
            &ex::mul(&local[0], &local[0], &mut g),
            &ex::mul(&local[1], &local[1], &mut g),
            &mut g,
        );
        let sum = ex::sum(
            &ex::sum(&radial, &ex::mul(&local[2], &local[2], &mut g), &mut g),
            &ex::mul(&ex::sum(
                &ex::mul(&major, &major, &mut g),
                &ex::neg(&ex::mul(&rr, &rr, &mut g)),
                &mut g,
            ), &det2, &mut g),
            &mut g,
        );
        let f = ex::sum(
            &ex::mul(&sum, &sum, &mut g),
            &ex::neg(&ex::mul(
                &[4.],
                &ex::mul(&ex::mul(&ex::mul(&major, &major, &mut g), &radial, &mut g), &det2, &mut g),
                &mut g,
            )),
            &mut g,
        );
        if !g.exact() {
            return Err(no("probe-range"));
        }
        ex::sign(&f) <= 0
        };
        if inside {
            return Ok((Iv::point(0.), true));
        }
        let distance = finite(
            (x.norm3(y, Iv::point(0.)) - enclosed(&major)).norm3(z, Iv::point(0.)) - enclosed(&rr),
        )?;
        // World distance is enclosed by singular-value bounds on A. It is
        // not equated with local Euclidean distance in a non-rigid frame.
        Ok((finite(distance * Iv { m: 1., r: self.metric_defect()? })?, false))
    }
    /// Export chart projection (two periodic seams, one vertex), not the
    /// seam-free topology of the actual solid. Used by validate-step.py.
    pub fn seam_vertex_mm(&self) -> R<[f64; 3]> {
        let mut g = Guard::new();
        let radius = ex::sum(&[self.major], &[self.minor], &mut g);
        let mut coords = self
            .frame
            .apply_exact([0., 0., self.height], 1000., true)
            .map_err(|_| no("export-range"))?;
        for k in 0..3 {
            coords[k] = ex::sum(
                &coords[k],
                &ex::mul(
                    &radius,
                    &ex::product(self.frame.x[k], 1000., &mut g),
                    &mut g,
                ),
                &mut g,
            );
        }
        if !g.exact() {
            return Err(no("export-range"));
        }
        Ok([
            crate::rounding::round(&coords[0]).map_err(|_| no("export-range"))?,
            crate::rounding::round(&coords[1]).map_err(|_| no("export-range"))?,
            crate::rounding::round(&coords[2]).map_err(|_| no("export-range"))?,
        ])
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (v, a) = self.measures_mm()?;
        let (lo, hi) = self.bbox_mm(None)?;
        let bbox = |l, h| format!("{{\"min\":{},\"max\":{}}}", xyz(l), xyz(h));
        let mapped = if let Some(m) = map {
            let (l, h) = self.bbox_mm(Some(m))?;
            bbox(l, h)
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&q| {
                self.probe_mm(q).map(|(d, inside)| {
                    format!(
                        "{{\"distanceMm\":{},\"inside\":{inside},\"boundMm\":{}}}",
                        js(d.m),
                        js(d.r)
                    )
                })
            })
            .collect::<R<Vec<_>>>()?;
        Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"RingTorus\",\"boundToConstruction\":true,",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"volumeEnclosureMm3\":[{},{}],\"areaMm2\":{},\"areaRelBound\":{},\"areaEnclosureMm2\":[{},{}],",
            "\"faceAreasMm2\":[{}],\"facePerimetersMm\":[0.0],\"centroidMm\":{},\"bboxMm\":{},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":1,\"edges\":0,\"vertices\":0,\"loops\":0,\"ringEdges\":0,\"closedToroidalFaces\":1,\"genus\":1,\"singularPoints\":0,\"pinchPoints\":0}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{},\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],",
            "\"projection\":{{\"vertices\":[{}],\"edges\":[[0,0],[0,0]],\"faces\":[[[[0,true],[1,true],[0,false],[1,false]]]]}}}}"),
            js(v.m),js((v.r/v.m).next_up()),js(v.lo()),js(v.hi()),js(a.m),js((a.r/a.m).next_up()),js(a.lo()),js(a.hi()),js(a.m),xyz(self.center_mm()?),bbox(lo,hi),mapped,js(self.tolerance_mm()?),js(self.metric_defect()?),probes.join(","),xyz(self.seam_vertex_mm()?)))
    }
}
