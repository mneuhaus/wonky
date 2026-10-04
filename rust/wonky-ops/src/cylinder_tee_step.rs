//! STEP-only piecewise cubic representation of the exact radical ring. Every
//! 3D and support-chart segment carries a uniform fourth-derivative remainder
//! from wonky_validated::cubic, including endpoint/control rounding. No fitted
//! curve is ever returned to the model. Periodic seams are export topology.
use crate::{
    cylinder_step::{flag, text, Writer},
    cylinder_tee::{no, Tee},
    polyhedron::Refused,
    step::real,
};
use wonky_num::{expansion::Guard, Iv, Scalar};
use wonky_validated::{cubic, Expr};
type R<T> = Result<T, Refused>;
const CURVE_BUDGET: f64 = 2e-10; // mm, uniform Euclidean deviation in world space
struct Splines {
    world: Vec<[f64; 3]>,
    post: Vec<[f64; 2]>,
    branch: Vec<[f64; 2]>,
    n: usize,
}
fn splines(p: &Tee) -> R<Splines> {
    let (local, mut post, branch) = p.ring_expressions()?;
    let c = Expr::Constant;
    // Place the post seam opposite the hole, leaving its closed pcurve in a
    // single chart. The native ring itself is seam-independent.
    post[0] =
        post[0].clone() + Expr::Bound(wonky_validated::pi(1e-14).map_err(|_| no("export-pi"))?);
    let mut guard = Guard::new();
    let y = p.frame.y_exact(&mut guard);
    if !guard.exact() {
        return Err(no("export-frame-range"));
    }
    let cols = [p.frame.x.map(|x| vec![x]), y, p.frame.z.map(|x| vec![x])];
    let world: [Expr; 3] = std::array::from_fn(|i| {
        (0..3).fold(c(p.frame.origin[i]) * c(1000.), |sum, k| {
            sum + cols[k][i].iter().fold(c(0.), |s, &v| s + c(v)) * local[k].clone()
        })
    });
    let r = Iv::point(p.arrangement.branch.radius) * Iv::point(1000.);
    let big = Iv::point(p.arrangement.post.radius) * Iv::point(1000.);
    let defect = p
        .frame
        .orthonormality_defect()
        .map_err(|_| no("export-frame-range"))?;
    let scale = Iv::point(1.) + Iv::point(3.) * Iv::point(defect);
    for n in [32usize, 64, 128, 256, 512, 1024, 2048, 4096] {
        let mut out = Splines {
            world: vec![],
            post: vec![],
            branch: vec![],
            n,
        };
        let mut good = true;
        for j in 0..n {
            let (a, b) = (j as f64 / n as f64, (j + 1) as f64 / n as f64);
            let w = world
                .each_ref()
                .map(|e| cubic(e, a, b))
                .into_iter()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| no(&format!("export-cubic-{e}")))?;
            let pc = post
                .iter()
                .chain(branch.iter())
                .map(|e| cubic(e, a, b))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| no(&format!("export-chart-{e}")))?;
            // L1 bounds dominate Euclidean error. Cylinder chart map has
            // derivative norms R and 1; carry the affine magnifier as well.
            let world_error = w.iter().fold(Iv::point(0.), |s, x| s + Iv::point(x.error));
            let chart_error =
                |k: usize, r: Iv| (Iv::point(pc[k].error) * r + Iv::point(pc[k + 1].error)) * scale;
            if world_error.hi() > CURVE_BUDGET
                || chart_error(0, big).hi() > CURVE_BUDGET
                || chart_error(2, r).hi() > CURVE_BUDGET
            {
                good = false;
                break;
            }
            for k in if j == 0 { 0 } else { 1 }..4 {
                out.world.push(std::array::from_fn(|i| w[i].controls[k]));
                out.post.push([pc[0].controls[k], pc[1].controls[k]]);
                out.branch.push([pc[2].controls[k], pc[3].controls[k]]);
            }
        }
        if good {
            // Endpoint evaluations are independently enclosed; choosing the
            // same seam value for the closure adds at most their deviation.
            // Reusing the first control makes a genuinely closed spline.
            let last = out.world.len() - 1;
            let closure = out.world[0]
                .iter()
                .zip(out.world[last])
                .fold(Iv::point(0.), |s, (&a, b)| {
                    s + (Iv::point(a) - Iv::point(b)).abs()
                });
            if closure.hi() > CURVE_BUDGET {
                return Err(no("export-ring-closure-budget"));
            }
            out.world[last] = out.world[0];
            out.post[last] = out.post[0];
            // Branch u advances one full turn; only v is periodic.
            out.branch[last][1] = out.branch[0][1];
            return Ok(out);
        }
    }
    Err(no("export-spline-budget"))
}
fn spline<const N: usize>(w: &mut Writer, points: &[[f64; N]], n: usize, closed: bool) -> String {
    let points = points
        .iter()
        .map(|p| w.point(p))
        .collect::<Vec<_>>()
        .join(",");
    let mult = (0..=n)
        .map(|i| if i == 0 || i == n { "4" } else { "3" })
        .collect::<Vec<_>>()
        .join(",");
    let knots = (0..=n)
        .map(|i| real(i as f64 / n as f64))
        .collect::<Vec<_>>()
        .join(",");
    w.entity(format!("B_SPLINE_CURVE_WITH_KNOTS('',3,({points}),.UNSPECIFIED.,{},.F.,({mult}),({knots}),.PIECEWISE_BEZIER_KNOTS.)",flag(closed)))
}
fn chart(w: &mut Writer, curve: &str, surface: &str, ctx: &str) -> String {
    let rep = w.entity(format!("DEFINITIONAL_REPRESENTATION('',({curve}),{ctx})"));
    w.entity(format!("PCURVE('',{surface},{rep})"))
}
fn vertex(w: &mut Writer, p: &[f64; 3]) -> String {
    let p = w.point(p);
    w.entity(format!("VERTEX_POINT('',{p})"))
}
fn face(w: &mut Writer, surface: &str, loops: &[Vec<(&str, bool)>], forward: bool) -> String {
    let mut bounds = vec![];
    for (i, uses) in loops.iter().enumerate() {
        let uses = uses
            .iter()
            .map(|(e, f)| w.entity(format!("ORIENTED_EDGE('',*,*,{e},{})", flag(*f))))
            .collect::<Vec<_>>()
            .join(",");
        let lp = w.entity(format!("EDGE_LOOP('',({uses}))"));
        let kind = if i == 0 {
            "FACE_OUTER_BOUND"
        } else {
            "FACE_BOUND"
        };
        bounds.push(w.entity(format!("{kind}('',{lp},.T.)")));
    }
    w.entity(format!(
        "ADVANCED_FACE('',({}),{surface},{})",
        bounds.join(","),
        flag(forward)
    ))
}
/// Declared STEP-only budget: native source rounding plus four spline budgets
/// (3D ring, both support charts and seam closure). Never a model tolerance.
pub(crate) fn tolerance_mm(p: &Tee) -> R<f64> {
    Ok((p.tolerance_mm()? + CURVE_BUDGET * 4.).next_up())
}
pub(crate) fn append(w: &mut Writer, id: &str, p: &Tee) -> R<String> {
    let ctx2 = w.entity(
        "(GEOMETRIC_REPRESENTATION_CONTEXT(2) REPRESENTATION_CONTEXT('','cylinder parameters'))"
            .into(),
    );
    let s = p.arrangement;
    let (x, _, z) = s.axes();
    let negx = x.map(|v| -v);
    let map = |a, t| {
        p.frame
            .apply(a, if t { 1000. } else { 1. }, t)
            .map_err(|_| no("export-range"))
    };
    let spl = splines(p)?;
    let tau = (wonky_validated::pi(1e-14)
        .map_err(|_| no("export-pi"))?
        .ball()
        * Iv::point(2.))
    .m;
    let postplace = w.placement(map(s.center, true)?, map(z, false)?, map(negx, false)?);
    let branchplace = w.placement(map(s.center, true)?, map(x, false)?, map(z, false)?);
    let post = w.entity(format!(
        "CYLINDRICAL_SURFACE('',{postplace},{})",
        real(s.post.radius * 1000.)
    ));
    let branch = w.entity(format!(
        "CYLINDRICAL_SURFACE('',{branchplace},{})",
        real(s.branch.radius * 1000.)
    ));
    let mut circles = vec![];
    let mut planes = vec![];
    let mut verts = vec![];
    let points = p.export_vertices_mm()?;
    for (o, n, xx, r) in [
        (s.post.bottom, z, negx, s.post.radius),
        (s.post.top, z, negx, s.post.radius),
        (s.end(), x, z, s.branch.radius),
    ] {
        let place = w.placement(map(o, true)?, map(n, false)?, map(xx, false)?);
        circles.push(w.entity(format!("CIRCLE('',{place},{})", real(r * 1000.))));
        planes.push(w.entity(format!("PLANE('',{place})")));
        verts.push(vertex(w, &points[verts.len()]));
    }
    let mut edges = vec![];
    for i in 0..3 {
        edges.push(w.entity(format!(
            "EDGE_CURVE('',{0},{0},{1},.T.)",
            verts[i], circles[i]
        )));
    }
    let q = vertex(w, &spl.world[0]);
    let curve = spline(w, &spl.world, spl.n, true);
    let cp = spline(w, &spl.post, spl.n, true);
    let cp = chart(w, &cp, &post, &ctx2);
    let cb = spline(w, &spl.branch, spl.n, false);
    let cb = chart(w, &cb, &branch, &ctx2);
    let curve = w.entity(format!("SURFACE_CURVE('',{curve},({cp},{cb}),.CURVE_3D.)"));
    let quartic = w.entity(format!("EDGE_CURVE('',{q},{q},{curve},.T.)"));
    let mut seam = |surface: &str,
                    start: &str,
                    end: &str,
                    point: [f64; 3],
                    direction: [f64; 3],
                    height: f64|
     -> R<String> {
        let o = w.point(&point);
        let d = w.direction(&map(direction, false)?);
        let v = w.entity(format!("VECTOR('',{d},1.)"));
        let line = w.entity(format!("LINE('',{o},{v})"));
        let p0 = w.pcurve(surface, &ctx2, [0., height], [0., 1.]);
        let p1 = w.pcurve(surface, &ctx2, [tau, height], [0., 1.]);
        let curve = w.entity(format!("SEAM_CURVE('',{line},({p0},{p1}),.CURVE_3D.)"));
        Ok(w.entity(format!("EDGE_CURVE('',{start},{end},{curve},.T.)")))
    };
    let ps = seam(
        &post,
        &verts[0],
        &verts[1],
        points[0],
        z,
        (s.post.bottom[s.i] - s.center[s.i]) * 1000.,
    )?;
    let bs = seam(
        &branch,
        &q,
        &verts[2],
        spl.world[0],
        x,
        s.post.radius * 1000.,
    )?;
    let faces = [
        face(
            w,
            &post,
            &[
                vec![
                    (&edges[0], true),
                    (&ps, true),
                    (&edges[1], false),
                    (&ps, false),
                ],
                vec![(&quartic, false)],
            ],
            true,
        ),
        face(
            w,
            &branch,
            &[vec![
                (&quartic, true),
                (&bs, true),
                (&edges[2], false),
                (&bs, false),
            ]],
            true,
        ),
        face(w, &planes[0], &[vec![(&edges[0], false)]], false),
        face(w, &planes[1], &[vec![(&edges[1], true)]], true),
        face(w, &planes[2], &[vec![(&edges[2], true)]], true),
    ];
    let shell = w.entity(format!("CLOSED_SHELL('',({}))", faces.join(",")));
    Ok(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))))
}
