//! planar-spike-fuzz <pairs> <seed>  -> fixture text on stdout
//!
//! Freezes the planar spike's (P0, `wonky_ops::planar::boolean`) results on
//! random orthogonal operand pairs, for boolean3d strand G4's comparison of
//! the general Boolean with the spike (rust/wonky-bool/tests/spike_fuzz.rs)
//! before retirement R1 deletes the spike (plan §5, R1).
//!
//! **Operands.** Boxes and L-shaped prisms (a non-convex hexagon profile,
//! extruded along x, y or z) with integer corners in [0, 6], so coplanar
//! faces, touching faces, edges and vertices, nesting and identical
//! operands are frequent. Only axis-parallel planes occur: the spike computes
//! its vertices as binary64 interpolations, which are exact only there, so
//! its volumes can be compared exactly (every vertex it emits is checked to
//! be an integer point and the line says so).
//!
//! **Output.** One line per pair and operation (union, subtraction; the
//! spike has no intersection):
//! `<pair> <op> A <operand> B <operand> -> <result>` where an operand is
//! `V:x,y,z/... F:i,j,k,l/...` (face cycles counter-clockwise about the
//! outward normal), and the result is
//! `bodies <n> [V,E,F,H,vol6] ... integral=<bool>` (per spike body: vertex,
//! edge, face and inner-loop counts and six times its exact signed volume
//! from its binary64 vertices), or `unresolved <reason> <stage> <detail>`, or
//! `undecidable <site>`. The PRNG is xorshift64* with the given seed.
use wonky_ops::planar::model::{plane, BoolResult, Curve, DomainChoice, Edge, Face, Loop, Solid, Tolerance, Use};
use wonky_ops::planar::num::v3;
use wonky_ops::planar::{boolean, wire::Request};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> i64 {
        (self.next() % n) as i64
    }
    /// Two distinct sorted values in [0, 6].
    fn span(&mut self) -> [i64; 2] {
        loop {
            let (a, b) = (self.below(7), self.below(7));
            if a != b {
                return [a.min(b), a.max(b)];
            }
        }
    }
}

type P = [i64; 3];
/// Vertices and face cycles (counter-clockwise about the outward normal).
struct Poly {
    vertices: Vec<P>,
    faces: Vec<Vec<usize>>,
}

/// A prism over a counter-clockwise (u, v) polygon, w in [w0, w1], with the
/// axes (u, v, w) mapped to world axes by a cyclic permutation (right-handed).
fn prism(profile: &[[i64; 2]], w: [i64; 2], axis: usize) -> Poly {
    let n = profile.len();
    let world = |u: i64, v: i64, w: i64| -> P {
        let mut p = [0; 3];
        p[(axis + 1) % 3] = u;
        p[(axis + 2) % 3] = v;
        p[axis] = w;
        p
    };
    let mut vertices = vec![];
    for &level in &w {
        for q in profile {
            vertices.push(world(q[0], q[1], level));
        }
    }
    let mut faces = vec![(0..n).rev().collect::<Vec<_>>(), (n..2 * n).collect()];
    for k in 0..n {
        let j = (k + 1) % n;
        faces.push(vec![k, j, n + j, n + k]);
    }
    Poly { vertices, faces }
}

fn random_operand(rng: &mut Rng) -> Poly {
    let axis = rng.below(3) as usize;
    let [u0, u2] = rng.span();
    let [v0, v2] = rng.span();
    let w = rng.span();
    if rng.below(2) == 0 || u2 - u0 < 2 || v2 - v0 < 2 {
        return prism(&[[u0, v0], [u2, v0], [u2, v2], [u0, v2]], w, axis);
    }
    let u1 = u0 + 1 + rng.below((u2 - u0 - 1) as u64);
    let v1 = v0 + 1 + rng.below((v2 - v0 - 1) as u64);
    prism(&[[u0, v0], [u2, v0], [u2, v1], [u1, v1], [u1, v2], [u0, v2]], w, axis)
}

fn describe(p: &Poly) -> String {
    let v: Vec<String> = p.vertices.iter().map(|q| format!("{},{},{}", q[0], q[1], q[2])).collect();
    let f: Vec<String> = p.faces.iter().map(|c| c.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")).collect();
    format!("V:{} F:{}", v.join("/"), f.join("/"))
}

/// The spike's solid: one Line edge per vertex pair, one plane face per cycle.
fn solid(p: &Poly) -> Solid {
    let pt = |i: usize| v3(p.vertices[i][0] as f64, p.vertices[i][1] as f64, p.vertices[i][2] as f64);
    let mut edges: Vec<Edge> = vec![];
    let mut faces = vec![];
    for cycle in &p.faces {
        let mut uses = vec![];
        for k in 0..cycle.len() {
            let (a, b) = (cycle[k], cycle[(k + 1) % cycle.len()]);
            let found = edges.iter().position(|e| (e.start as usize, e.end as usize) == (a.min(b), a.max(b)));
            let edge = found.unwrap_or_else(|| {
                let (s, e) = (a.min(b), a.max(b));
                edges.push(Edge { start: s as u32, end: e as u32, curve: Curve::Line { origin: pt(s), direction: pt(e).sub(pt(s)) }, same_sense: true });
                edges.len() - 1
            });
            uses.push(Use { edge: edge as u32, forward: a < b });
        }
        // Newell normal: exact for small integer coordinates.
        let mut n = [0i64; 3];
        for k in 0..cycle.len() {
            let (a, b) = (p.vertices[cycle[k]], p.vertices[cycle[(k + 1) % cycle.len()]]);
            n[0] += (a[1] - b[1]) * (a[2] + b[2]);
            n[1] += (a[2] - b[2]) * (a[0] + b[0]);
            n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        }
        faces.push(Face {
            surface: plane(pt(cycle[0]), v3(n[0] as f64, n[1] as f64, n[2] as f64)),
            same_sense: true,
            loops: vec![Loop { outer: true, uses }],
        });
    }
    Solid { vertices: (0..p.vertices.len()).map(pt).collect(), edges, faces }
}

/// Six times the signed volume of a spike body from its binary64 vertices,
/// exactly (they are integers here; `integral` says whether they all were).
fn volume6(s: &Solid) -> (i128, bool) {
    let integral = s.vertices.iter().all(|v| [v.x, v.y, v.z].iter().all(|c| c.fract() == 0.0 && c.abs() < 1e9));
    let p = |i: u32| {
        let v = s.vertices[i as usize];
        [v.x as i128, v.y as i128, v.z as i128]
    };
    let mut total = 0i128;
    for f in &s.faces {
        for l in &f.loops {
            let starts: Vec<u32> = l
                .uses
                .iter()
                .map(|u| {
                    let e = &s.edges[u.edge as usize];
                    if u.forward { e.start } else { e.end }
                })
                .collect();
            let p0 = p(starts[0]);
            for k in 1..starts.len().saturating_sub(1) {
                let (a, b) = (p(starts[k]), p(starts[k + 1]));
                total += p0[0] * (a[1] * b[2] - a[2] * b[1]) - p0[1] * (a[0] * b[2] - a[2] * b[0]) + p0[2] * (a[0] * b[1] - a[1] * b[0]);
            }
        }
    }
    (total, integral)
}

fn result(r: &BoolResult) -> String {
    match r {
        BoolResult::Bodies { bodies, .. } => {
            let mut integral = true;
            let parts: Vec<String> = bodies
                .iter()
                .map(|b| {
                    let s = &b.solid;
                    let (v6, ok) = volume6(s);
                    integral &= ok;
                    let holes: usize = s.faces.iter().map(|f| f.loops.len() - 1).sum();
                    format!("[{},{},{},{},{}]", s.vertices.len(), s.edges.len(), s.faces.len(), holes, v6)
                })
                .collect();
            format!("bodies {} {} integral={integral}", bodies.len(), parts.join(" "))
        }
        BoolResult::Unresolved { reason, stage, detail, .. } => format!("unresolved {} {stage} {detail}", reason.name()),
        BoolResult::Undecidable { site, .. } => format!("undecidable {}", site.replace(' ', "_")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pairs: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1000);
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0x5eed_6b4f);
    let mut rng = Rng(seed | 1);
    println!("# wonky/planar-spike-fuzz/1");
    println!("# consumer: rust/wonky-bool/tests/spike_fuzz.rs (boolean3d strand G4: general Boolean vs the P0 spike); frozen before retirement R1 deletes the spike");
    println!("# generator: rust/wonky-replay/src/bin/planar-spike-fuzz.rs, {pairs} pairs, seed {seed}");
    println!("# how: cd rust && cargo run --profile gate --offline --locked -p wonky-replay --bin planar-spike-fuzz -- {pairs} {seed} > wonky-bool/tests/data/spike-fuzz.txt");
    println!("# spike: wonky_ops::planar::boolean::run(Variant::Same), tolerance linear 1e-7 angular 1e-10, budgets 0, domains Auto");
    println!("# line: <pair> <union|subtraction> A <operand> B <operand> -> bodies <n> [V,E,F,H,vol6]... integral=<bool> | unresolved <reason> <stage> <detail> | undecidable <site>");
    for pair in 0..pairs {
        let (a, b) = (random_operand(&mut rng), random_operand(&mut rng));
        let (sa, sb) = (solid(&a), solid(&b));
        for (name, subtraction) in [("union", false), ("subtraction", true)] {
            let req = Request {
                first: sa.clone(),
                ad: vec![DomainChoice::Auto; sa.edges.len()],
                ab: 0.0,
                second: sb.clone(),
                bd: vec![DomainChoice::Auto; sb.edges.len()],
                bb: 0.0,
                tolerance: Tolerance { linear: 1e-7, angular: 9.999999999999996e-11 },
            };
            let r = boolean::run(&req, subtraction, boolean::Variant::Same);
            println!("{pair} {name} A {} B {} -> {}", describe(&a), describe(&b), result(&r));
        }
    }
}
