use crate::*;
use std::collections::{BTreeMap, BTreeSet};

fn connected(nodes: &BTreeSet<usize>, adjacency: &BTreeMap<usize, BTreeSet<usize>>) -> bool {
    let Some(&start) = nodes.first() else {
        return false;
    };
    let mut seen = BTreeSet::new();
    let mut todo = vec![start];
    while let Some(n) = todo.pop() {
        if seen.insert(n) {
            if let Some(neighbors) = adjacency.get(&n) {
                todo.extend(neighbors.iter().copied());
            }
        }
    }
    seen == *nodes
}

impl Draft {
    /// Full audit for the supported convex, one-shell-per-solid, line/plane
    /// domain. Unsupported holes/nonconvex faces/cavities never receive success.
    pub fn audit(&self) -> Result<()> {
        let mut issues = Vec::new();
        macro_rules! refs {
            ($kind:literal, $iter:expr, $len:expr) => {
                for id in $iter {
                    if id.0 >= $len {
                        issues.push(Issue::Reference($kind, id.0));
                    }
                }
            };
        }
        if self.solids.is_empty() {
            issues.push(Issue::Empty("solids"));
        }
        for edge in &self.edges {
            refs!("curve", [edge.curve], self.curves.len());
            refs!("vertex", edge.vertices, self.vertices.len());
        }
        for c in &self.coedges {
            refs!("edge", [c.edge], self.edges.len());
        }
        for lp in &self.loops {
            refs!("coedge", &lp.coedges, self.coedges.len());
        }
        for f in &self.faces {
            refs!("surface", [f.surface], self.surfaces.len());
            refs!("loop", &f.loops, self.loops.len());
        }
        for s in &self.shells {
            refs!("face", &s.faces, self.faces.len());
        }
        for s in &self.solids {
            refs!("shell", &s.shells, self.shells.len());
        }
        // No unchecked indexing until every external arena reference is known good.
        if !issues.is_empty() {
            return Err(Error::Invalid(issues));
        }

        for v in &self.vertices {
            numeric::point(v.point)?;
        }
        for c in &self.curves {
            let Curve::Line { a, b } = c;
            numeric::point(*a)?;
            numeric::point(*b)?;
            let mut equal = true;
            for (a, b) in numeric::xyz(*a).into_iter().zip(numeric::xyz(*b)) {
                equal &= numeric::compare(a, b)? == Sign::Zero;
            }
            if equal {
                return Err(Error::Degenerate("line carrier"));
            }
        }
        for s in &self.surfaces {
            let Surface::Plane { origin, normal } = s;
            numeric::point(*origin)?;
            if !numeric::nonzero(*normal)? {
                return Err(Error::Degenerate("plane normal"));
            }
        }
        for (i, edge) in self.edges.iter().enumerate() {
            if numeric::compare(edge.range.end, edge.range.start)? != Sign::Positive {
                return Err(Error::Degenerate("edge parameter range"));
            }
            let Curve::Line { a, b } = self.curves[edge.curve.0];
            for (v, t) in edge
                .vertices
                .into_iter()
                .zip([edge.range.start, edge.range.end])
            {
                if !numeric::on_line_at(self.vertices[v.0].point, a, b, t)? {
                    issues.push(Issue::EndpointIncidence(EdgeId(i), v));
                }
            }
        }

        let mut coedge_owner = vec![0; self.coedges.len()];
        let mut loop_owner = vec![0; self.loops.len()];
        let mut face_owner = vec![0; self.faces.len()];
        let mut shell_owner = vec![0; self.shells.len()];
        let mut curve_owner = vec![0; self.curves.len()];
        let mut surface_owner = vec![0; self.surfaces.len()];
        let mut vertex_owner = vec![0; self.vertices.len()];
        for e in &self.edges {
            curve_owner[e.curve.0] += 1;
            for v in e.vertices {
                vertex_owner[v.0] += 1;
            }
        }
        for (i, lp) in self.loops.iter().enumerate() {
            if lp.coedges.len() < 3 {
                issues.push(Issue::Empty("loop needs three coedges"));
            }
            let mut vertices = BTreeSet::new();
            for (j, c) in lp.coedges.iter().enumerate() {
                coedge_owner[c.0] += 1;
                let [start, end] = self.ends(*c);
                let next = self.ends(lp.coedges[(j + 1) % lp.coedges.len()])[0];
                if end != next {
                    issues.push(Issue::LoopGap(LoopId(i)));
                }
                if !vertices.insert(start) {
                    issues.push(Issue::RepeatedVertex(LoopId(i)));
                }
            }
        }

        let mut edge_uses: Vec<Vec<(FaceId, Orientation)>> = vec![Vec::new(); self.edges.len()];
        for (i, face) in self.faces.iter().enumerate() {
            let f = FaceId(i);
            surface_owner[face.surface.0] += 1;
            // The carrier adapter supports convex polygons only. Holes need a
            // certified arrangement/trim domain, not a guessed area subtraction.
            if face.loops.len() != 1 {
                issues.push(Issue::UnsupportedFace(f));
            }
            let Surface::Plane { normal, .. } = self.surfaces[face.surface.0];
            for lp in &face.loops {
                loop_owner[lp.0] += 1;
                let coedges = &self.loops[lp.0].coedges;
                let polygon: Vec<_> = coedges
                    .iter()
                    .map(|c| self.vertices[self.ends(*c)[0].0].point)
                    .collect();
                for (j, c) in coedges.iter().enumerate() {
                    let c = &self.coedges[c.0];
                    let sense = if face.orientation == Orientation::Forward {
                        c.orientation
                    } else {
                        c.orientation.reversed()
                    };
                    edge_uses[c.edge.0].push((f, sense));
                    if !self.edge_in_plane(c.edge, f)? {
                        issues.push(Issue::FaceIncidence(c.edge, f));
                    }
                    // Every other vertex strictly left of each directed edge:
                    // proves a simple convex polygon with positive carrier winding.
                    for k in 0..polygon.len() {
                        if k == j || k == (j + 1) % polygon.len() {
                            continue;
                        }
                        if numeric::turn(
                            polygon[j],
                            polygon[(j + 1) % polygon.len()],
                            polygon[k],
                            normal,
                        )? != Sign::Positive
                        {
                            issues.push(Issue::UnsupportedFace(f));
                            break;
                        }
                    }
                }
            }
        }
        let mut face_shell = vec![None; self.faces.len()];
        for (i, shell) in self.shells.iter().enumerate() {
            if shell.faces.is_empty() {
                issues.push(Issue::Empty("shell"));
            }
            for f in &shell.faces {
                face_owner[f.0] += 1;
                face_shell[f.0] = Some(ShellId(i));
            }
        }
        for (i, solid) in self.solids.iter().enumerate() {
            if solid.shells.len() != 1 {
                issues.push(Issue::UnsupportedCavities(SolidId(i)));
            }
            for s in &solid.shells {
                shell_owner[s.0] += 1;
            }
        }
        for (kind, counts) in [
            ("coedge", coedge_owner),
            ("loop", loop_owner),
            ("face", face_owner),
            ("shell", shell_owner),
        ] {
            for (i, count) in counts.into_iter().enumerate() {
                if count != 1 {
                    issues.push(Issue::Ownership(kind, i, count));
                }
            }
        }
        for (kind, counts) in [
            ("curve", curve_owner),
            ("surface", surface_owner),
            ("vertex", vertex_owner),
        ] {
            for (i, count) in counts.into_iter().enumerate() {
                if count == 0 {
                    issues.push(Issue::Ownership(kind, i, count));
                }
            }
        }
        for (i, uses) in edge_uses.iter().enumerate() {
            let e = EdgeId(i);
            match uses.len() {
                0 => issues.push(Issue::DanglingEdge(e)),
                1 => issues.push(Issue::BoundaryEdge(e)),
                2 => {
                    if uses[0].0 == uses[1].0 {
                        issues.push(Issue::NonManifoldEdge(e));
                    }
                    if uses[0].1 == uses[1].1 {
                        issues.push(Issue::OrientationConflict(e));
                    }
                    if face_shell[uses[0].0 .0] != face_shell[uses[1].0 .0] {
                        issues.push(Issue::BoundaryEdge(e));
                    }
                }
                _ => issues.push(Issue::NonManifoldEdge(e)),
            }
        }
        // Edge valence alone misses two shells pinched together at one vertex.
        // The link at each vertex must be one cycle of face wedges. Keep degrees
        // with multiplicity (two-face links are valid), connectivity as a graph.
        for i in 0..self.vertices.len() {
            let mut degrees = BTreeMap::<usize, usize>::new();
            let mut adjacency = BTreeMap::<usize, BTreeSet<usize>>::new();
            for (e, edge) in self.edges.iter().enumerate() {
                if !edge.vertices.contains(&VertexId(i)) {
                    continue;
                }
                if let [(a, _), (b, _)] = edge_uses[e].as_slice() {
                    *degrees.entry(a.0).or_default() += 1;
                    *degrees.entry(b.0).or_default() += 1;
                    adjacency.entry(a.0).or_default().insert(b.0);
                    adjacency.entry(b.0).or_default().insert(a.0);
                }
            }
            let nodes = degrees.keys().copied().collect();
            if degrees.values().any(|n| *n != 2) || !connected(&nodes, &adjacency) {
                issues.push(Issue::NonManifoldVertex(VertexId(i)));
            }
        }
        for (i, shell) in self.shells.iter().enumerate() {
            let nodes: BTreeSet<_> = shell.faces.iter().map(|f| f.0).collect();
            let mut adjacency = BTreeMap::<usize, BTreeSet<usize>>::new();
            for uses in &edge_uses {
                if let [(a, _), (b, _)] = uses.as_slice() {
                    if nodes.contains(&a.0) && nodes.contains(&b.0) {
                        adjacency.entry(a.0).or_default().insert(b.0);
                        adjacency.entry(b.0).or_default().insert(a.0);
                    }
                }
            }
            if !connected(&nodes, &adjacency) {
                issues.push(Issue::DisconnectedShell(ShellId(i)));
            }
        }
        if !issues.is_empty() {
            return Err(Error::Invalid(issues));
        }
        // Halfspaces put every face on the convex hull boundary, but do not
        // prove injectivity: connected, orientable double covers also pass.
        for (i, shell) in self.shells.iter().enumerate() {
            let vertices: BTreeSet<_> = shell
                .faces
                .iter()
                .flat_map(|f| &self.faces[f.0].loops)
                .flat_map(|lp| &self.loops[lp.0].coedges)
                .flat_map(|c| self.edges[self.coedges[c.0].edge.0].vertices)
                .collect();
            for f in &shell.faces {
                let face = &self.faces[f.0];
                let Surface::Plane { origin, normal } = self.surfaces[face.surface.0];
                for v in &vertices {
                    let mut side = numeric::plane_side(normal, self.vertices[v.0].point, origin)?;
                    if face.orientation == Orientation::Reversed {
                        side = side.flip();
                    }
                    if side == Sign::Positive {
                        return Err(Error::Unsupported("nonconvex or inward shell"));
                    }
                }
            }
            // Noncoplanar supporting faces can meet only on their boundaries.
            // Coplanar ones must have disjoint interiors, even with distinct IDs
            // or different tessellations. A closed, outward-oriented boundary
            // on a full-dimensional convex hull has constant positive integer
            // multiplicity; disjoint face interiors bound it by one. Together
            // with the link/closure checks and positive volume this rules out
            // multiple sheets, without a rounded interior point or ray sample.
            for (j, &a) in shell.faces.iter().enumerate() {
                for &b in &shell.faces[j + 1..] {
                    if self.coplanar_faces_overlap(a, b)? {
                        return Err(Error::Invalid(vec![Issue::OverlappingFaces(a, b)]));
                    }
                }
            }
            let vol = self.shell_volume(ShellId(i))?;
            let sign = wonky_num::decide(vol, "brep shell volume")
                .map_err(|e| Error::Numeric(e.into_refusal()))?;
            if sign != Sign::Positive {
                issues.push(Issue::InwardOrZeroShell(ShellId(i)));
            }
        }
        if issues.is_empty() {
            Ok(())
        } else {
            Err(Error::Invalid(issues))
        }
    }

    /// Called only after the faces are proved planar, strictly convex, and wound
    /// along their carrier normals. The separating-axis theorem reduces overlap
    /// of their open interiors to exact side tests at both polygons' edges.
    fn coplanar_faces_overlap(&self, a: FaceId, b: FaceId) -> Result<bool> {
        let Surface::Plane {
            origin: oa,
            normal: na,
        } = self.surfaces[self.faces[a.0].surface.0];
        let Surface::Plane {
            origin: ob,
            normal: nb,
        } = self.surfaces[self.faces[b.0].surface.0];
        if !numeric::parallel(na, nb)? || numeric::plane_side(na, ob, oa)? != Sign::Zero {
            return Ok(false);
        }
        let [pa, pb] = [a, b].map(|f| {
            self.loops[self.faces[f.0].loops[0].0]
                .coedges
                .iter()
                .map(|c| self.vertices[self.ends(*c)[0].0].point)
                .collect::<Vec<_>>()
        });
        // Face orientation selects the outward side, not polygon winding.
        // Use each polygon's own normal, including reversed carrier frames.
        for (polygon, other, normal) in [(&pa, &pb, na), (&pb, &pa, nb)] {
            for (i, &start) in polygon.iter().enumerate() {
                let end = polygon[(i + 1) % polygon.len()];
                let mut separated = true;
                for &p in other {
                    if numeric::turn(start, end, p, normal)? == Sign::Positive {
                        separated = false;
                        break;
                    }
                }
                if separated {
                    // All other vertices on/right of this edge: disjoint open
                    // interiors. Exact zero permits shared edges and vertices.
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    pub(crate) fn ends(&self, c: CoedgeId) -> [VertexId; 2] {
        let c = &self.coedges[c.0];
        let [a, b] = self.edges[c.edge.0].vertices;
        if c.orientation == Orientation::Forward {
            [a, b]
        } else {
            [b, a]
        }
    }

    pub(crate) fn edge_in_plane(&self, e: EdgeId, f: FaceId) -> Result<bool> {
        let edge = self
            .edges
            .get(e.0)
            .ok_or(Error::InvalidReference("edge", e.0))?;
        let face = self
            .faces
            .get(f.0)
            .ok_or(Error::InvalidReference("face", f.0))?;
        let Curve::Line { a, b } = self.curves[edge.curve.0];
        let Surface::Plane { origin, normal } = self.surfaces[face.surface.0];
        Ok(numeric::plane_side(normal, a, origin)? == Sign::Zero
            && numeric::plane_side(normal, b, origin)? == Sign::Zero)
    }

    pub(crate) fn shell_volume(&self, shell: ShellId) -> Result<Iv> {
        let shell = &self.shells[shell.0];
        let anchor = self.vertices
            [self.ends(self.loops[self.faces[shell.faces[0].0].loops[0].0].coedges[0])[0].0]
            .point
            .iv();
        let mut six_volume = Iv::point(0.);
        for f in &shell.faces {
            let face = &self.faces[f.0];
            let lp = &self.loops[face.loops[0].0];
            let p: Vec<_> = lp
                .coedges
                .iter()
                .map(|c| self.vertices[self.ends(*c)[0].0].point.iv().sub(anchor))
                .collect();
            for i in 1..p.len() - 1 {
                six_volume = six_volume
                    + p[0].dot(p[i].cross(p[i + 1])) * Iv::point(face.orientation.sign());
            }
        }
        let volume = six_volume / Iv::point(6.);
        numeric::check(
            &[volume.m, volume.r, volume.lo(), volume.hi()],
            "brep volume enclosure",
        )?;
        Ok(volume)
    }
}
