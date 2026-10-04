The Rust gate is available with `npm run test:rust:gate` (cargo-nextest
0.9.146). Run it through the authorized remote runner. It executes all workspace
unit/integration test binaries in the gate profile with nextest, then all
workspace doctests with Cargo. Neither command selects or excludes test names.

Before execution, Cargo's libtest inventory is compared with nextest's complete
name multiset, including duplicate names in different binaries. Cargo's ignored
inventory establishes the expected execution count. JUnit execution counts must
match; missing output, failed tests or count differences fail the gate.

`node scripts/rust/gate-tests.mjs --measure` first builds the gate binaries and
reports that build time separately, then times the original Cargo gate and
nextest plus doctests on the same host and source tree. It also checks their
actual passed/ignored counts. The reported speedup includes inventory checks
as well as nextest and doctests. Results and the ten slowest nextest tests are in
`out/rust-gate/report.json`. The warm comparison excludes initial compilation;
it does not establish a cold-build speedup. Normal gates always check the current Cargo inventory and do not reuse saved
measurement results. External evidence reuse requires the same clean Git tree,
command and options, and a completed run; the source hash alone is insufficient.
