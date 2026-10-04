//! Certified tessellation of a curve-profile prism (strand S9): the export-only
//! mesh behind the STL of `curve_profile` bodies. It never feeds back into
//! modelling.
//!
//! The mesh is sampled from the exact profile, not from WC0 caches: every piece
//! is cut into `Trimmed::subdivisions` equal parameter steps and each sample is
//! the midpoint of `Trimmed::sample_enclosure`. One cyclic sample polygon in the
//! sketch chart is shared by both caps and the sides, so every mesh vertex has
//! ONE key (profile vertex or piece sample, times level) and the mesh is
//! watertight by construction (and checked).
//!
//! Display attribution (the viewer's `OP_MESH`). Every triangle carries its WC0
//! face (caps 0 and 1, side `2 + piece`), the first `2 * pieces` mesh vertices
//! are the WC0 vertices (piece starts, lower level then upper), and every WC0
//! edge is its own sample run: piece samples per level, run from the edge's
//! first to its second vertex (a spline stored against the profile direction is
//! reversed), then the generators.
//!
//! Deviation certificate (world millimetres). With `s` the Frobenius bound of
//! the frame's linear part (mm per source unit):
//! - chord error: `subdivisions(s, budget)` keeps it at most `budget / 2`;
//! - sample rounding: the largest enclosure radius, times `s`;
//! - world rounding: the enclosed residual of each exactly placed sample.
//!
//! The map/error certificate and nonincident-chord refinement are shared with
//! stacked prisms in `mesh_boundary`; large translations never lose their budget.
//!
//! Their sum is `deviation_mm`; it must stay within the requested deviation,
//! else `export/stl/vertex-precision-budget`.
//!
//! Separation constraint (design-robustness section 6). Let `q` bound the later
//! float32 rounding of the STL writer (`2^-23` of the largest coordinate, L2)
//! and `d = deviation_mm + q`. Every two boundary chords of the sample polygon
//! that share no vertex, except branches incident at an exact tangent cusp,
//! must be at least `5 d` apart in the world, certified from the exact distance
//! of the source chords and the frame's smallest stretch. Then
//! - the exact side faces under them are at least `3 d` apart (each chord is
//!   within `deviation_mm` of its exact piece), so `d <= separation / 3`;
//! - after float32 rounding the two facets stay at least `3 d` apart, so the STL
//!   cannot touch or cross itself there.
//!
//! At a cusp the exact faces are incident and have zero limiting clearance.
//! Its chord pairs instead retain `5 q` clearance plus sample-rounding bounds;
//! thus their actual float32 output cannot touch or cross. Cusp incidence comes
//! only from exact source endpoints and same-sense outgoing rational tangents.
//!
//! When the constraint fails the chord budget is halved and the profile is
//! sampled again; a feature that stays below the resolution refuses
//! `export/stl/sub-resolution-separation` instead of emitting a mesh whose
//! parts touch. The exact `simple_polygon` check of `triangulate_loops` stays as
//! the loud backstop, never a repair.
use crate::arc_profile::ArcPrism;
use crate::mesh::{preserve_shell_orientation, triangulate_planar_cap, Mesh, MeshEdge};
use crate::polyhedron::{Audited, Refused};
use crate::mesh_boundary::{self, Metric, MAX_REFINEMENTS};
use wonky_num::Iv;

type R<T> = std::result::Result<T, Refused>;
fn no(reason: &str) -> Refused {
    Refused(format!("export/stl/{reason}"))
}

/// Points of one cap contour (the limit of `mesh::triangulate_loops`).
const MAX_SAMPLES: usize = 8192;
/// Non-incident boundary chords are at least this many deviations apart.
pub const SEPARATION: f64 = mesh_boundary::SEPARATION;
/// A mesh with the numbers that certify it (world millimetres).
#[derive(Clone, Debug)]
pub struct Certified {
    pub mesh: Mesh,
    /// Bound on the distance between the mesh and the exact surface.
    pub deviation_mm: f64,
    /// Bound on the later float32 displacement of every vertex.
    pub quantization_mm: f64,
    /// Lower bound between nonincident source facets (exact cusp joins excluded).
    pub separation_mm: f64,
    /// The chord budget of the accepted sampling (at most the requested deviation).
    pub chord_budget_mm: f64,
}

/// The cyclic sample polygon of the profile in the sketch chart.
struct Boundary {
    points: Vec<[Iv; 2]>,
    /// Index in `points` of the first sample (the profile vertex) of each piece.
    starts: Vec<usize>,
}

fn boundary(s: &ArcPrism, scale: Iv, budget: f64) -> R<Boundary> {
    let mut points = vec![];
    let mut starts = vec![];
    let push = |e: [Iv; 2], points: &mut Vec<[Iv; 2]>| -> R<()> {
        if points.len() == MAX_SAMPLES {
            return Err(no("contour-resource-limit"));
        }
        points.push(e);
        Ok(())
    };
    for seg in s.profile.segments() {
        let n = seg.subdivisions(scale, budget)?;
        if !n.is_finite() || n > MAX_SAMPLES as f64 {
            return Err(no("mesh-resource-limit"));
        }
        let n = n as usize;
        starts.push(points.len());
        push(seg.ends()[0].enclosure()?, &mut points)?;
        for k in 1..n {
            push(seg.sample_enclosure(k, n, crate::mesh_curved::sin_cos)?, &mut points)?;
        }
    }
    Ok(Boundary { points, starts })
}

/// Certified mesh of an audited curve-profile prism within `deviation_mm`.
pub fn tessellate(a: &Audited, deviation_mm: f64) -> R<Certified> {
    let s = a.arcs.as_ref().ok_or_else(|| no("curve-profile-required"))?;
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(no("invalid-deviation"));
    }
    if a.frame.reversed().map_err(|_| no("frame-orientation"))? {
        return Err(no("frame-orientation"));
    }
    let metric = Metric::new(&a.frame)?;
    let mut budget = deviation_mm;
    for _ in 0..MAX_REFINEMENTS {
        let Boundary { points: enclosed, starts } = boundary(s, metric.scale, budget)?;
        let mut vertices = Vec::with_capacity(2 * enclosed.len());
        let mut rounding = 0.0f64;
        for z in s.levels {
            for &p in &enclosed {
                let (world, error) = metric.sample(&a.frame, [p[0], p[1], Iv::point(z)])?;
                vertices.push(world);
                rounding = rounding.max(error);
            }
        }
        let points: Vec<[f64; 2]> = enclosed.iter().map(|p| p.map(|v| v.mid())).collect();
        let deviation = metric.deviation(budget, rounding, deviation_mm)?;
        let quantization = mesh_boundary::quantization(&vertices)?;
        let n = starts.len();
        let mut piece_of = vec![0; points.len()];
        for i in 0..n { piece_of[starts[i]..starts.get(i + 1).copied().unwrap_or(points.len())].fill(i); }
        let pieces = s.profile.segments();
        let cusps: Vec<_> = (0..n).filter_map(|i| {
            let j = (i + 1) % n;
            (pieces[i].ends()[1] == pieces[j].ends()[0]
                && pieces[i].tangent(false).ccw_cmp(&pieces[j].tangent(true)) == std::cmp::Ordering::Equal)
                .then_some([i, j])
        }).collect();
        let Some(separation_mm) = metric.separation_with_cusps(&points, &[(0..points.len()).collect()], deviation, quantization, rounding, &piece_of, &cusps)? else {
            budget /= 2.;
            continue;
        };
        let m = points.len();
        // The WC0 layout of `arc_profile_brep::construct`: vertices are the piece
        // starts at the lower, then the upper level; faces are the lower cap, the
        // upper cap and one side per piece; edges are the lower and the upper
        // profile pieces, then one generator per piece start.
        let body = &a.body;
        if (body.vertices.len(), body.edges.len(), body.faces.len()) != (2 * n, 3 * n, n + 2) {
            return Err(no("wc0-shape"));
        }
        let normal = a.frame.cofactor_exact([0., 0., 1.]).map_err(|_| no("cap-normal-range"))?;
        let loops = [(0..m).collect()];
        let mut triangles = Vec::with_capacity(4 * m - 4);
        let mut faces = Vec::with_capacity(triangles.capacity());
        for level in 0..2 {
            let cap = triangulate_planar_cap(&vertices[level * m..(level + 1) * m], &loops, &normal)?;
            for t in cap {
                triangles.push(if level == 0 { [t[0], t[2], t[1]] } else { t.map(|i| m + i) });
                faces.push(level as u32);
            }
        }
        for k in 0..m {
            let l = (k + 1) % m;
            let side = 2 + piece_of[k] as u32;
            triangles.push([k, l, m + l]);
            triangles.push([k, m + l, m + k]);
            faces.extend([side, side]);
        }
        // Sample (level, k) sits at `level * m + k`; the WC0 vertices come first.
        let mut renumber = vec![usize::MAX; 2 * m];
        for level in 0..2 {
            for (i, &k) in starts.iter().enumerate() {
                renumber[level * m + k] = level * n + i;
            }
        }
        let mut next = 2 * n;
        for id in renumber.iter_mut().filter(|id| **id == usize::MAX) {
            *id = next;
            next += 1;
        }
        let place = |natural: Vec<[f64; 3]>| {
            let mut placed = vec![[0.; 3]; natural.len()];
            for (old, p) in natural.into_iter().enumerate() {
                placed[renumber[old]] = p;
            }
            placed
        };
        let vertices = place(vertices);
        let triangles: Vec<[usize; 3]> = triangles.into_iter().map(|t| t.map(|i| renumber[i])).collect();
        let mut edges = Vec::with_capacity(3 * n);
        for level in 0..2 {
            for i in 0..n {
                let end = starts.get(i + 1).copied();
                let mut samples: Vec<usize> =
                    (starts[i]..end.unwrap_or(m)).chain([end.unwrap_or(0)]).map(|k| renumber[level * m + k]).collect();
                // A spline stored against the profile direction runs the other way.
                if body.edges[level * n + i].vertices[0].0 as usize != level * n + i {
                    samples.reverse();
                }
                edges.push(MeshEdge { vertices: samples, closed: false });
            }
        }
        for edge in &body.edges[2 * n..] {
            edges.push(MeshEdge { vertices: edge.vertices.iter().map(|v| v.0 as usize).collect(), closed: false });
        }
        let source = place(s.levels.iter().flat_map(|&z| points.iter().map(move |p| [p[0], p[1], z])).collect());
        let mesh = Mesh { vertices, triangles, faces, edges, brep_vertices: 2 * n };
        let source = Mesh { vertices: source, triangles: mesh.triangles.clone(), ..Default::default() };
        preserve_shell_orientation(&source, &mesh, false)?;
        crate::mesh::check_watertight(&mesh)?;
        return Ok(Certified { mesh, deviation_mm: deviation, quantization_mm: quantization, separation_mm, chord_budget_mm: budget });
    }
    Err(no("sub-resolution-separation"))
}
