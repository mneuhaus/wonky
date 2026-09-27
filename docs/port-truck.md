# Truck-Referenzport in Bend

Die erste Implementierung in `kernel/ports/truck.bend` und
`kernel/ports/truck-topology.bend` schneidet geschlossene planare B-reps mit einem
Halbraum `dot(point-origin, normal) <= 0`. Sie verarbeitet konkave einfache
Flächen und liefert bei getrennten Ergebnissen vollständige `Components`.
Es handelt sich um eine methodische Spezialisierung identifizierter
Truck-Teilroutinen, nicht um einen vollständigen Port des Rust-CAD-Kernels oder
einen allgemeinen Solid/Solid-Boolean.

Der separate Einstieg `kernel/ports/truck-cylinder.bend::clip` ergänzt volle
Zylinderbänder mit Kreis-/Ellipsenrändern. Er besitzt denselben gemeinsamen
Vertrag, wird aber ausdrücklich separat ausgewählt: `truck.bend` behält seine
planare Referenzdomäne unverändert.

Geometrieentscheidungen, Schnittpunkte, Loop-Graphen, Zusammenbau und
Komponententrennung laufen in Bend. JavaScript serialisiert die Eingabe und
misst/exportiert ausschließlich Testergebnisse. Weder `halfspace.bend` noch ein
OCCT-/Rust-/C++-Backend wird vom Port importiert oder aufgerufen.

## Fixierte Referenz und Zuordnung

Referenz ist [ricosjp/truck, Commit
8d03d8f7900d6aaff784d02092bf5126c1425749](https://github.com/ricosjp/truck/tree/8d03d8f7900d6aaff784d02092bf5126c1425749),
`truck-shapeops` 0.4.0. Die Quellenprüfung und der Port beziehen sich auf genau
diesen Stand. URLs und SHA-256 stehen in
`out/boolean-ports/truck/upstream.json`.

| Upstream-Routine/Entscheidung | Bend-Umsetzung | Bewusste Abweichung |
| --- | --- | --- |
| [`process_one_pair_of_shells`](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/integrate/mod.rs#L75-L131): schneiden, teilen, klassifizieren, integrieren | `split_edges`, `divide_faces`, `cap_faces`, `close_shell` | Der zweite Operand ist eine analytische Halbebene; keine allgemeine zweite Solid-Schale. |
| [`create_loops_stores`](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/loops_store/mod.rs#L443-L485): Schnittkurven in Quellränder einordnen | Ein Schnittvertex je Originalkante; `Part`-Tabelle, `face_pieces`, `cut_arcs` | Ebene/Gerade besitzt eine geschlossene Lösung. Meshseed und Newton-Projektion werden dafür nicht benötigt. |
| [`construct_polylines`](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/polyline_construction/mod.rs#L6-L34): Segmentgraph zu Kurvenzügen | `Arc`, `degrees`, `take`, `walk`, `construct_rings` | Exakte topologische Vertex-IDs ersetzen Trucks toleranzquantisierten `PointIndex`; keine Koordinatenverschweißung. Ein-/Ausgangsgrad muss jeweils eins sein. |
| [`divide_one_face`](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/divide_face/mod.rs#L51-L99): Randloops zu neuen Flächen, Quellfläche erhalten | `ordered`, `pairs`, `ring_polygons`, `polygons` | Für eine transversale Gerade in einem einfachen Polygon wechseln Ein-/Austritte. Aufeinanderfolgende geordnete Paare bilden die Schnittintervalle. Negative Ringe/Löcher werden explizit abgewiesen statt angehängt. |
| [`and_or_unknown`/Integration](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/faces_classification/mod.rs#L24-L64) und abschließendes [`connected_components`](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/integrate/mod.rs#L134-L177) | `sides`, gerichtete Quell-/Cap-Ränder, `partition`, `grow`, `components` | Die Halbebenenklassifikation verwendet das Vorzeichen des analytischen Abstandes statt Rays gegen triangulierte Gegenschalen. Komponenten werden über gemeinsame Kanten verbunden. |
| Loop-Store, Face-Aufteilung und Erhalt der Quellflächen für einen geschlossenen Schnittloop | Zylinderpfad: `range`, `section_band`, `rebuild`, `final_prepared` | Die geschlossene Ebene/Zylinder-Schnittkurve stammt aus Wonky `intersections.bend`; vollständige Kreis-/Ellipsenränder ersetzen Mesh-/Newton-Leader. Der Seam- und Face-Zusammenbau ist separat in Bend implementiert. |

Die grundlegende Reihenfolge und die Segment-/Loop-Datenflüsse stammen aus
dieser Referenz. Die lineare Intervallpaarung und die immutable Bend-Datenstruktur
sind Spezialisierungen; sie sind keine zeilengetreuen Übersetzungen.

## Planare Domäne und Fehlerverhalten

- Endliche, geometrisch eingebettete planare Quell-B-reps mit geraden Kanten,
  einem einfachen äußeren Loop je Fläche und konsistenter Orientierung.
  Konkave Flächen sowie getrennte Ergebnisse sind zulässig.
- Automatische, durch Kantenendpunkte begrenzte Liniendomänen. Explizite
  `GivenDomain`-Werte werden als `UnsupportedDomain` zurückgegeben, nicht ignoriert.
- Quelltoleranz exakt null. Positive Quelltoleranz führt zu `SourceTolerance`;
  sie wird weder aufgeweitet noch auf die Konstruktionsgenauigkeit umgedeutet.
- Strikt transversale Schnitte. Jeder Schnitt durch oder zu nahe an einem
  Quellvertex führt zu `AmbiguousContact`, einschließlich koplanarer Face- und
  Edge-Kontakte. Auch exakt darstellbare Nullabstände werden nicht automatisch
  nach einer anderen Port-Policy behandelt. Dies erhält die wesentliche
  [transversale Einschränkung von Truck](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/lib.rs#L3-L9).
- Löcher, negative Cap-Ringe, gekrümmte Flächen/Kanten und ungelöste Anordnungen
  sind in diesem ersten Stand ausdrücklich nicht unterstützt. Es gibt keine
  Ausweichtriangulierung gekrümmter Flächen.

Die Eingabeprüfung kontrolliert endliche Werte, Linien-/Plane-Inzidenz,
Flächenframes, einfache orientierte Loops, gepaarte entgegengesetzte Kantenuses,
eindeutige Vertex-/Kantenidentitäten und benutzte Vertices. Eine vollständige
globale Selbstschnittprüfung aller Quellflächen ist damit nicht implementiert;
eine geometrisch eingebettete Quellgrenze bleibt Voraussetzung. Positive
orientierte Volumina, geschlossene Kantenuses und lokale Flächengültigkeit werden
für jede ausgegebene Komponente geprüft. Ein fehlgeschlagener Schritt liefert
`Unresolved`, niemals den bis dahin aufgebauten Teil einer Schale.

Die Arithmetik ist Wonky `Real` (F32x2), nicht Trucks `f64`. Die skalierte
Auflösungsprüfung verwendet die vorhandenen Bend-Arithmetik- und
Inzidenzprüfungen. Sie ist eine operative numerische Schranke, kein Beweis durch
Intervallarithmetik. Numerische Garantien des Upstreams werden nicht übertragen
oder aus der Verwendung von Bend abgeleitet.

## Separater Zylinderpfad

Die Eingabe besteht aus genau zwei Vertices, zwei geschlossenen periodischen
Kreis-/Ellipsenkanten, einer geraden Seam und drei Flächen: zwei ebene Caps und
eine nach außen orientierte Zylinderwand. Jeder Cap besitzt einen vollständigen
äußeren Rand; der Wandloop verwendet beide Ränder sowie die Seam zweimal in
entgegengesetzter Richtung. Die ganzen axialen Wertebereiche der beiden Ränder
müssen mit positiver Distanz getrennt sein. Dies ist bewusst konservativ:
parallel geneigte, disjunkte Caps mit überlappenden axialen Wertebereichen werden
als `UnsupportedArrangement` abgewiesen, obwohl ein solcher Körper gültig sein
kann. Löcher, mehrere Wände, Teilbögen und explizite `GivenDomain`-Werte gehören
nicht zur Domäne. Die Quelltoleranz muss null sein.

Für `c + u cos(t) + v sin(t)` berechnet Bend den gesamten vorzeichenbehafteten
Abstandsbereich analytisch als Mittelpunkt plus/minus
`sqrt(dot(u,n)^2 + dot(v,n)^2)`. Beide Ränder auf der behaltenen Seite liefern
den vollständigen unveränderten Körper, beide auf der entfernten Seite liefern
`Empty`. Liegt ein ganzer Rand innen und der andere außen, entsteht ein voller
Kreis- oder Ellipsenschnitt zwischen den Caps. Der erhaltene Cap und die
Zylinderfläche behalten ihre ursprünglichen Flächenbeschreibungen; die neue
Schnittkante und der gekürzte Quellseam werden zu einem geschlossenen B-rep
mit zwei Vertices, drei Kanten und drei Flächen zusammengesetzt. Auch umgekehrte
Halbräume und weitere Schnitte auf einem Kreis-/Ellipsen- oder
Ellipsen-/Ellipsenband werden innerhalb dieser Domäne unterstützt.

Schnitte durch bestehende Ränder führen zu `UnsupportedArrangement`, Kontakte
oder Ränder innerhalb der numerischen Kontaktmarge zu `AmbiguousContact`.
Es gibt keine Teilrandkonstruktion, Facettierung, Koordinatenverschweißung oder
allgemeine Zylinder/Solid-Boolean-Behauptung. Die analytische Schnittarithmetik,
Plane-/Zylinder-Inzidenz und elementare Topologieprüfungen sind gemeinsam
genutzte Wonky-Primitiven; sie sind keine neu übertragenen Truck-Routinen.
Truck liefert hier den spezialisierten Ablauf aus Schnittloop, Klassifikation,
Teilflächen und Integration.

Vor einer Ausgabe werden Frames, komplette Kurveninzidenz, Endpunkte,
Cap-Orientierungen, geschlossene Loop-Folgen und genau ein Vorwärts-/Rückwärtsuse
je Kante geprüft. Die Seam-Inzidenz gilt für das ganze Liniensegment, die
Zylinderinzidenz der Conics für ihre vollständigen trigonometrischen
Koeffizienten. Der Auflösungsmaßstab berücksichtigt Vertices, Kurvenzentren und
Radien sowie Flächenursprünge; er beruht nicht nur auf den zwei Seam-Vertices.
Das konstruierte Ergebnis durchläuft dieselben Bandprüfungen. Ein Fehler
liefert `ConstructionFailure` ohne Teilschale. Die Einschränkung auf einen
zusammenhängenden vollen Zylinderstreifen macht eine Komponententrennung in
diesem Einstieg unnötig.

## Ausgabe, Herkunft und Prüfung

Die Eingabe bleibt unverändert. `SourceFace{index}` benennt die ursprüngliche
Fläche auch dann, wenn daraus mehrere Flächen entstehen. `SourceEdge{index}`
benennt erhaltene Originalkanten oder deren Teilstücke. `CutEdge{face}` benennt
den Quellflächenindex, auf dem eine neue Schnittkante entstand; die Gegenkante
des Caps verwendet dieselbe topologische Kante. Neue Deckflächen tragen
`CutFace`. Nach Komponententrennung werden Geometrie und Herkunft gemeinsam
kompaktiert; die Herkunftsindizes beziehen sich weiterhin auf die Eingabe.

`test/port-truck.test.mjs` lädt den Port eigenständig mit `loadBend`. Die
Fokusfälle prüfen Box, analytisch bekanntes Simplex, Leermenge/unveränderten
Körper, L-Konkavität, zwei getrennte U-Arme, wiederholte Schnitte, starre
Transformation, Herkunft und die expliziten Ablehnungen. Die unabhängige lokale
Volumenmessung summiert orientierte Flächendreiecke des fertigen Ergebnisses;
sie konstruiert keine Produktionsgeometrie. STEP- und B-rep-Artefakte liegen
unter `out/boolean-ports/truck/`, zusammen mit Fokuslog und Quellhashes.
Gemeinsames Vergleichskorpus, unabhängige STEP-Validierung und Hybrid-Auswahl
gehören zur Integration durch den Lead.

Der aktuelle Fokuslauf hat **8/8 Tests bestanden**: vier für die unveränderte
planare Referenz und vier für den separaten Zylinderpfad. Dessen unabhängige
Volumenmessung integriert die affinen Cap-Höhen über die Kreisprojektion:
`pi * radius² * Differenz der Achsenabschnitte`. Die Achsenextrema der Conics
geben die exakten B-rep-Grenzen. Diese JavaScript-Testorakel messen nur bereits
in Bend konstruierte Geometrie. Die Tests prüfen darüber hinaus unveränderte
Eingaben, Source-/Cut-Herkunft, ganze periodische Kanten und den expliziten Seam.

| Zylinderartefakt unter `out/boolean-ports/truck/` | Erwartetes Volumen in mm³ | Vollständige Randkurven |
| --- | ---: | --- |
| `cylinder-axial` | `18*pi` | Kreis + Kreis |
| `cylinder-oblique` | `18*pi` | Kreis + Ellipse |
| `cylinder-upper` | `18*pi` | Kreis + Ellipse |
| `cylinder-uncut` | `36*pi` | Kreis + Kreis |
| `cylinder-chain-first` | `27*pi` | Kreis + Ellipse |
| `cylinder-chain-circle` | `9*pi` | Kreis + Kreis |
| `cylinder-chain-ellipses` | `18*pi` | Ellipse + Ellipse |
| `cylinder-chain-third` | `9*pi` | Ellipse + Ellipse |
| `cylinder-rotated` | `18*pi` | Kreis + Ellipse |

Jedes Tabellenartefakt besitzt eine `.step`- und `.brep.json`-Datei und erwartet
einen Solid mit drei Flächen. Positive Evidenz für diese Fälle erweitert die
oben genannten Grenzen nicht. Ablehnungstests decken unter anderem tangentiale
und rimschneidende Ebenen, explizite Trimintervalle, Quelltoleranzen, falsche
Seams, unvollständige Wandloops, falsche Conic-Radien und einen nur an den
Endpunkten passenden elliptischen Fremdrand ab.

## Lizenz

Truck steht unter [Apache License 2.0](https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/LICENSE).
Die Original-Lizenz liegt als `out/boolean-ports/truck/LICENSE.truck` bei.
Die oben bezeichneten Routinen werden mit deutlichen Änderungen in Bend und
einem engeren geometrischen Gültigkeitsbereich adaptiert. Alle übrigen
Projektdateien und eingefrorenen r10b-Eingaben bleiben unverändert.
