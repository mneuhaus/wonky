# Third-party notices

Wonky's own code currently has no open-source licence. The following material
retains its upstream licence; this notice does not relicense it.

- **Node.js contributors**: the Node-API headers in `src/native/include/` are MIT
  licensed. See `src/native/include/LICENSE.node` and `PROVENANCE.json`.
- **Truck contributors**: `kernel/ports/truck*.bend` and their Rust descendant
  `rust/wonky-ops/src/planar/topo.rs` adapt Apache-2.0 material. Attribution and
  source mapping are in `docs/port-truck.md`; the full Apache-2.0 text is in
  `fixtures/cadbench/upstream/LICENSE-2.0.txt`.
- **CADBench fixtures**: `fixtures/cadbench/` is Apache-2.0; see its `NOTICE.md`
  and `upstream/` licence text and source attribution.
- **Open CASCADE test cases**: `fixtures/public-boolean-regressions/` contains
  LGPL-2.1 material with the OCCT exception. See its `NOTICE.md` and `upstream/`
  for the licence and exception texts. These are independent test inputs, not
  production kernel code.
- **Twin firmware protocol**: MIT; see `twin/fixtures/firmware-license.txt`.
- **Rust dependencies**: `rust/vendor/*` contains each crate's upstream licence
  files and package metadata. Those individual notices remain authoritative.

The unlicensed Bend collections vendor tree and GPL/LGPL-derived Bend reference
ports are not distributed here. Algorithm research notes do not grant rights to
upstream implementations.
