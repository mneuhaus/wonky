// Compile: typst compile wonky-kernel-factsheet.typ
// Avenir Next is bundled with macOS; Arial is the portable fallback.
#let ink = rgb("163b34")
#let muted = rgb("52665f")
#let green = rgb("dfece5")
#let rule = rgb("d2ded7")
#let paper = rgb("fbfcf8")
#set document(title: "Wonky Kernel - Technical Factsheet", author: "Wonky Kernel", description: "Current capabilities, architecture and development boundaries. 22 September 2026.")
#set page(paper: "a4", margin: (x: 18mm, top: 17mm, bottom: 15mm), fill: paper,
  footer: [#set text(size: 8pt, fill: muted)
    #line(length: 100%, stroke: 0.6pt + rule)
    #v(2mm)
    #grid(columns: (1fr, auto), [WONKY KERNEL · TECHNICAL FACTSHEET], [22 SEPTEMBER 2026])
  ],
)
#set text(font: ("Avenir Next", "Arial"), size: 10pt, fill: ink, lang: "en")
#set par(leading: 0.52em)
#set block(above: 0pt, below: 0pt)
#let label(body) = text(size: 8pt, weight: "semibold", tracking: 0.8pt, fill: muted, body)
#let item(title, body) = block(breakable: false)[
  #text(size: 11pt, weight: "bold", title)
  #v(1.5mm)
  #body
]

#grid(columns: (1fr, auto), align: horizon,
  label[PROGRAMMABLE CAD / ENGINEERING SNAPSHOT],
  box(fill: green, radius: 3pt, inset: (x: 7pt, y: 4pt))[#text(size: 8pt, weight: "bold")[IN DEVELOPMENT]],
)
#v(7mm)
#text(size: 37pt, weight: "bold", tracking: -1.3pt)[Wonky Kernel]
#v(2mm)
#text(size: 13pt, fill: muted)[A code-first CAD kernel for programmable modeling,\
automated checks and LLM-assisted workflows.]
#v(6mm)

#block(width: 100%, fill: ink, radius: 4pt, inset: 4mm)[
  #set text(fill: white, size: 9pt)
  #grid(columns: (1fr, 1.1fr, 1fr), column-gutter: 3mm,
    [#text(weight: "bold")[Bend]\ Geometry & topology],
    [#text(weight: "bold")[FeatureScript + Python]\ Modeling frontends],
    [#text(weight: "bold")[Analytic B-rep]\ Structured, exportable solids],
  )
]
#v(7mm)
#label[AVAILABLE TODAY]
#v(3mm)

#grid(columns: (1fr, 1fr), column-gutter: 9mm, row-gutter: 5mm,
  item[Modeling input][
    Original Onshape *FeatureScript syntax* with a growing library subset. Real Python execution with a limited *build123d algebra API*.
  ],
  item[Geometry & operations][
    Planar profiles, line/arc extrusions, cylinders, conical frustums, rigid transforms and frozen analytic Onshape body imports.
  ],
  item[Boolean coverage][
    Coaxial-cylinder union, intersection and difference; bounded planar union/difference; admitted plane/cylinder intersections with convex planar tools.
  ],
  item[Implementation & numerics][
    Geometry in *Bend*; JavaScript handles interpretation and I/O. F32x2 arithmetic, selected exact predicates and explicit error budgets. No OCCT production fallback.
  ],
  item[Export & validation][
    Analytic *STEP* and structured *B-rep JSON*. Native tests, independent STEP checks, geometry comparisons and standard-view image diffs.
  ],
  item[Inspection & feedback][
    Browser viewer with selection, hover, side-by-side and slider comparison, plus saved annotations. Geometry-to-code provenance, named sketch roles and operation ancestry.
  ],
)
#v(7mm)

#block(width: 100%, fill: green, radius: 4pt, inset: 4mm, breakable: false)[
  #label[VERIFIED MILESTONE]
  #v(2mm)
  #text(size: 11pt, weight: "bold")[12 original arcs → one closed analytic solid]
  #v(1.5mm)
  The original M3 profile runs through FeatureScript and exports without faceting. Real r10b unions *g7* and *g9* pass; the full model currently stops at the subsequent curved-body union (*g10*).
]
#v(5mm)

#grid(columns: (1fr, 1fr), column-gutter: 9mm,
  item[Current boundaries][
    General curved Booleans, fillets, revolve, enclosed cavity shells and full API coverage remain open. Unsupported geometry fails explicitly.
  ],
  item[Performance & next work][
    The current Bend/JS modeling path is slower than build123d/OCCT in six verified Python workloads. Broader Booleans and performance improvements are in progress.
  ],
)
#v(4mm)
#text(size: 8pt, fill: muted)[Scope: implemented, bounded operation families. Active development; not a production-complete general CAD kernel.]
