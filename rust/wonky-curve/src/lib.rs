//! wonky-curve: exact 2D curve pieces with ONE operation table.
//!
//! A `Trimmed` piece is a `Carrier` (`Line`, `Circle` or `BSpline`) between two
//! `ExactPoint`s (`Rational`, exact `Quadratic`, a bounded quadratic tower, or one shared exact `Real` generator). Every question a consumer asks of a piece
//! is one of the operations below; no consumer matches on the carrier or point
//! kind to decide geometry. The two enums are closed, and every match on them
//! inside this crate is exhaustive without a `_` arm (no `if let`/`let else`
//! either), so a new kind is a list of compile errors in this crate plus one in
//! each serializer that matches `Chart`.
//!
//! Operation table (single piece, in `trimmed`):
//!
//! | operation                  | meaning                                              |
//! |----------------------------|------------------------------------------------------|
//! | `ends`, `cache`            | exact ends; binary64 serialization caches            |
//! | `chart`                    | the carrier as a serialization target (`Chart`)      |
//! | `reversed`, `trim`         | traversal reversal; sub-piece between two exact points |
//! | `mapped`                   | exact plane isometry (`PlaneMap`)                    |
//! | `canonical`, `key`         | canonical orientation and carrier-trim identity      |
//! | `contains`                 | closed membership of an exact point                  |
//! | `misses_disc`              | a closed disc (exact centre, radius) does not touch the piece |
//! | `coincident_with`          | same supporting curve                                |
//! | `winding`                  | half-open ray winding (lower inclusive, upper exclusive) |
//! | `contacts`, `admit`        | carrier-pair intersection; simple-chain admission    |
//! | `contact_report`           | contacts with how each was found (`contact::ContactKind`) |
//! | `sorted_cuts`              | order of points along the piece                      |
//! | `tangent`, `ray`           | tangent at an end; with the second derivative, for star order |
//! | `interior_point`           | exact witness strictly inside the piece              |
//! | `length`, `segment_area`   | certified length; Green term of the piece            |
//! | `green_exact`              | the exact Green term of a line or polynomial spline piece |
//! | `bounds`, `extrema`, `extent` | binary64 bounds and reach of linear forms         |
//! | `frame`                    | serialization frame (chord direction; circle centre, radius, radial, turn) |
//! | `sample`, `subdivisions`   | equal-parameter points and span count for tessellation |
//! | `sample_enclosure`         | the certified enclosure each `sample` point rounds     |
//! | `arc_through`              | arc through three binary64 source points (exact centre, certified sweep) |
//! | `is_curved`, `is_split`    | carrier is not a line; an end differs from its binary64 cache |
//! | `normal_at`                | carrier normal at an exact point (a `Direction`)     |
//! | `refitted`                 | same ends, circle exactly tangent to a given normal at one end |
//! | `centre_l1_distance`       | L1 distance of two arc centres (`None` unless both arcs) |
//! | `retraces`                 | this piece is the other traversed backwards           |
//! | `distance`                 | certified distance from an exact point to the piece (a spline minimizes over its interior feet) |
//! | `reach`, `support_fold`    | magnitude of carrier data; ordered fold of a support maximum |
//! | `inset`                    | exact inward parallel piece and end normals, or a typed `InsetRefusal` |
//! | `clears_disc`              | strict separation from a closed disc, decided in Q    |
//!
//! The line/circle operations `misses_disc`, `clears_disc`, `normal_at`,
//! `refitted`, `retraces`, `frame`, `reach` and `support_fold`
//! refuse a spline piece (`Refusal::SplineArrangement`), `inset` with
//! `InsetRefusal::Spline`, and `centre_l1_distance` is `None`. A B-rep writes
//! a spline piece from its `Chart` (the spline itself), never from `frame`.
//!
//! Cycle operations (in `cycle`): `winding`, `contains`, `area`, `area_exact`, `orientation`,
//! `moments`, `bounds`, `mapped`, `reversed`, `polygon`. Star order (in `star`):
//! `order` over `Direction`s, with `Star::Tied` when three or more rays share a
//! direction; `order_rays` over `Ray`s adds the exact signed-curvature order of
//! rays with one direction (a line/circle direction tie stays `Tied`).
//!
//! Arrangement (in `arrangement`): `arrange` cuts a set of cycles at every exact
//! contact into a half-edge graph of canonical pieces with their owners, walks
//! it into cells (holes attached to their innermost containing cell), and
//! `classify` decides each cell's membership in every cycle. The work budget
//! (`Budget`) is a parameter of the consumer. `arrange_pieces` takes sets of
//! pieces that need not be closed (a face split's section pieces), and
//! `Arrangement::witness` (in `witness`) finds an exact point strictly inside
//! a cell.
//!
//! Extension points:
//! * `ExactPoint::Quadratic` stores line/circle and circle/circle contacts in
//!   one shared Q(sqrt r) field. Radical comparison, star/cut order and Green
//!   terms are exact; only certified enclosures are serialized. Solid consumers
//!   must call `Arrangement::certify_resolution` before constructing quadratic
//!   bodies, with their declared source + STEP + reader floor (C8). `OnCurve`
//!   remains S15. `ExactPoint::rat` is the single place a
//!   variant answers "are you rational", and `intersect::Candidate::extract` is
//!   the single place an intersection root becomes a stored point.
//! * `Carrier::BSpline` (S5) is a variant of `carrier::Carrier` with its
//!   `CarrierKey` and `Chart` arms (math in `bspline`: polynomial and rational
//!   splines of degree <= 7, exact evaluation, Green moments, extremes, closest
//!   point, arc-length enclosure, regularity, certified flatten bound, affine
//!   image, degree elevation). A cusp or self-intersection refuses
//!   `curve2/self-intersecting-spline`.
//! * The spline arm of the arrangement (S6, `contact` and `winding`) stores
//!   rational vertices only: the ends of the spline pieces, divided out of the
//!   substitution before counting. Any other contact refuses
//!   `curve2/crossing-needs-algebraic-vertex` (S15 adds `OnCurve` vertices), a
//!   spline on another carrier `curve2/coincident-spline-carriers`, two
//!   splines without a certificate `curve2/spline-contact-undecided`; cuts at
//!   irrational parameters, a closed spline as one arrangement piece (equal
//!   ends) and the frame of a spline piece refuse
//!   `Refusal::SplineArrangement`. The spline prism of the arc-profile path
//!   (S9, `wonky-ops::curve_profile`) consumes spline pieces through `chart`,
//!   `distance`, the measures and `sample`. No-Claim: nothing here is
//!   reachable from FeatureScript (admission is S10).
//! * Refusals are the typed `Refusal` enum; their `name()` spellings are the
//!   frozen historical strings of the observation files.
//!
//! Only rational data enters, so the crate depends on `wonky-num`, `wonky-alg`
//! (exact real roots for the spline measures) and `num-rational` (no contract,
//! no kernel).
pub mod arrangement;
pub mod bspline;
pub mod carrier;
pub mod contact;
pub mod cycle;
mod intersect;
pub mod numeric;
pub mod point;
pub mod radical;
pub mod refusal;
mod resolution;
pub mod star;
pub mod trimmed;
mod winding;
mod witness;

pub use arrangement::{arrange, arrange_faces, arrange_pieces, arrange_pieces_exact, arrange_sketch, classify, Arrangement, Budget, Cell, Piece, UNBOUNDED};
pub use carrier::{Carrier, CarrierKey, Chart, Circle, PlaneMap};
pub use contact::{Contact, ContactKind};
pub use cycle::Cycle;
pub use numeric::{pi, P, Q};
pub use point::ExactPoint;
pub use refusal::{Refusal, R};
pub use star::{order, order_rays, order_rays_by_curvature, Direction, Ray, Star};
pub use trimmed::{ArcFrame, Extent, Extrema, Inset, InsetRefusal, PieceFrame, TrimKey, Trimmed};

pub mod param;
pub mod green;
pub use param::Param;
pub use green::Green;
pub mod real;
