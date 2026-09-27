# Native Bridge: Host-Kernel-Oberfläche und schmale Extension-API

Stand: 2026-09-22, Bend 2.0.25, Apple M5 Pro (18 logische CPUs), Node v22.23.1.
Rolle dieser Stufe: die heutige Grenze zwischen JS-Frontend und Bend-Kern vollständig kartieren, daraus eine
schmale "Extension-Module"-API ableiten und zeigen, dass Wire-Codecs und Dispatcher aus den Bend-Deklarationen
generiert werden können.

Alle Zahlen stammen aus Skripten in `scripts/native-bridge/` und liegen maschinenlesbar in
`src/native/surface.json` (die Karte; bis zum R20-Gate `out/native-bridge/surface.json`, seitdem getrackt, weil der
native Build sie liest), `out/native-bridge/wire-closure.json` (Replay echter Werte),
`out/native-bridge/wire-survey.json` (Codierbarkeit des ganzen Kerns) und `out/native-bridge/wire-native-emit.json`
(native C-Emission). Die Maschine war geteilt, Load Average 12 bis 24 auf 18 Kernen (in jedem Report vermerkt).
Zeiten sind **indikativ**. Hier läuft **kein** nativer Kern; alle Geometrie-Werte kommen vom JS-Target, das die
Referenz bleibt.

```sh
node scripts/native-bridge/gen-wire.mjs --survey out/native-bridge/wire-survey.json   # Codierbarkeit, ~1 s
node scripts/native-bridge/wire-closure.mjs --dispatch-ms 6000                         # ~20 s mit Cache, kalt ~7 min
node scripts/native-bridge/wire-native-emit.mjs                                        # nur `bend -o .c`, ~35 s
node scripts/native-bridge/surface-scan.mjs                                            # schreibt surface.json, <1 s
node --test test/native-bridge-wire.test.mjs                                           # 9 Tests
```

`surface-scan.mjs` liest die Quellen bei jedem Lauf neu. Seine drei handgepflegten Tabellen (welcher JS-Empfänger
welches Bend-Modul meint, was der Host mit jedem Ergebnis tut, wo Low-Words verloren gehen) werden gegen die Quellen
geprüft: ein Aufruf ohne auflösbares `def`, ein Produktionseintrag ohne Annotation, eine veraltete Annotation, ein
Präzisionsmuster, das nicht genau einmal vorkommt, oder ein Eintrag, den keine vorgeschlagene API-Operation abdeckt,
lässt den Scan scheitern.

## Kurzfassung

- **Die heutige Oberfläche ist breit und feinkörnig:** 85 Produktions-Einstiegspunkte in 23 Bend-Modulen, erreicht
  von 108 Aufrufstellen in 16 JS-Dateien (dazu 23 Einstiege, die nur Diagnose-Adapter und Tests nutzen). Ein Lauf
  macht 5 bis 18.604 Host-zu-Kern-Aufrufe; 1 bis 7 davon sind die eigentlichen Operationen, die 95,7 bis 99,9 % der
  Kernzeit tragen (Boolean-Läufe; Tabelle unten).
- **Alles ist synchron.** Der FeatureScript-Interpreter ist durchgehend synchron (kein `async` in `interpreter.mjs`,
  `library.mjs`, `queries.mjs`, `modules.mjs`), jede Builtin-Funktion ruft den Kern inline und wirft
  Capability-Fehler an der Quellstelle, damit FeatureScript-`try` sie sieht. Ein nativer Kern muss deshalb als
  synchroner Aufruf erreichbar sein. Das spricht zusätzlich für In-Process (vgl. `docs/native-bridge/binding.md`).
- **`nativeChainExact: false` ist ein Host-Befund, kein Native-Befund.** `src/real.mjs:9` (`number = hi + lo`)
  kollabiert F32x2 in binary64; `src/analytic.mjs:132` (`encodeAnalytic`) spaltet das beim nächsten Kernaufruf
  wieder mit `real()`. Von 9.784 Reals in echten Produktionsergebnissen ändern sich 131 durch diese Rundreise
  (planar union/subtract, solid-intersection, pierce, Import, tessellate). Handles beseitigen das an der Wurzel.
- **Vorschlag:** 16 grobe Operationen mit Handles (`extrude_polygon`, `frustum`, `sketch_lines`, `sketch_arcs`,
  `extrude_profile`, `transform`, `boolean`, `import_brep`, `measure`, `view`, `identity`, `step_pcurves`,
  `print_mesh`, `display_mesh`, `compare_coaxial`, `release`). Jeder der 85 Einstiege ist einer davon zugeordnet
  oder entfällt (4 Adapter-Helfer); das prüft der Scan.
- **Codecs und Dispatcher sind generierbar.** Der Generator deckt 335 von 336 Kern-Typen und 2.148 von 2.191
  `def`-Signaturen ab (Rest: `Nat`, `Cmp`, ein rekursiver Diagnose-Typ). Für **alle 85** Produktions-Einstiege
  (121 ADTs) erzeugt er 10.514 Zeilen Bend und 3.465 Zeilen JS. Das JS-Target kompiliert das; 695 echte
  Argument- und Ergebniswerte aus 153 Aufrufen laufen bitgenau durch Bend- und JS-Codecs, 153 Dispatch-Replays
  (inklusive planar union 1,4 s und subtract 5,1 s) sind wortgleich mit dem Direktaufruf.
- **Native Emission:** Der generierte Dispatcher für 84 der 85 Einstiege emittiert mit `bend -o .c` (12 MB C, 16 s).
  **`ports/curved-intersection.bend:intersect` emittiert nicht, und zwar schon ohne generierten Code:** der Kern
  selbst (über `ports/curved.bend:clip` -> `section.bend:section`) trifft Bends offenes Limit "an arity over 255"
  (breiter Wert über einen Nicht-Tail-Call gehalten). Der r10b-Pfad braucht dafür eine Kern- oder Compileränderung,
  unabhängig von der Bridge.

## 1. Wie JS heute Bend erreicht

| Weg | Module | Eigenschaften |
|---|---|---|
| `loadKernel()` (`src/kernel.mjs:7`) | 18 Module eager: `topology` (Wurzel, gespreizt), `analytic`, `real`, `precise`, `boolean`, `comparison`, `identity`, `face-classification`, `halfspace`, `sketch-lines`, `sketch-arcs`, `ports/solid-intersection`, `ports/curved`, `ports/curved-intersection`, `ports/planar-boolean`, `revolve`, `tessellate`, `pierce` | persistenter JS-Compile-Cache (`docs/bend-loading.md`); `revolve` wird geladen, aber in Produktion nie aufgerufen |
| `loadBend(...)` direkt | `step-pcurves`, `step-cylinder-pcurves` (Top-Level-`await` in `src/exporters.mjs:9`), `sketch-arcs` (zweiter Ladeweg über `loadSketchArcs`), Diagnose: `section`, `ports/{occt,solvespace,truck,truck-cylinder,hybrid}` | gecacht |
| roher Import über `registerBendImports()` | Viewer: `display`, `curve-plane`, `cylinder-classification`; Diagnose: `intersections`, `ray`, `junction`, `edge-plane`, `face-plane`, `curve-band`, `solid-classification` | **ungecacht** (Hook des Compilers) |

Importierte Defs erscheinen im Namespace unter ihrem Importpfad: `kernel['geometry.frame']` ist
`kernel/geometry.bend:frame`, durchgereicht von `topology.bend`. Werte im JS-Target: ADTs als `{$: Ctor, ...felder}`,
Listen als `Con`/`Nil`, `U32`/`F32` als JS-Zahl, `Bool` als JS-Boolean, `String` als JS-String (Code Points; ein
Astral-Zeichen zählt einmal), `Nat` als `BigInt`, `Real` als `{$: 'Real', hi, lo}` mit zwei F32-Zahlen.

## 2. Die Oberfläche

`surface.json.entries` führt pro Einstieg: Modul, Zeile und Signatur des `def`, Parameter- und Ergebnistyp mit ADT-
Hülle und Skalaren, alle Aufrufstellen (Datei:Zeile, umgebende Funktion, FeatureScript-Builtin oder Python-Request,
Tier), gemessene Aufrufe aus `out/native-bridge/profile/calls/` (8 Läufe der Profil-Stufe), Wire-Größen aus dem
Replay und die Host-Annotation (Rolle, Dekodierung, Verzweigung, Nachbearbeitung, Ziel-Operation).

Produktion = die Datei ist von `bin/*.mjs` bzw. `src/index.mjs` erreichbar **und** die umgebende exportierte Funktion
wird von einem erreichbaren Modul importiert (oder in ihrer eigenen Datei aufgerufen). So fallen z. B. `classifyPlanarFace`, `intersectSurfaces`, `clipConvexSolid` und `revolveInBend` aus der
Produktion (nur Tests und Skripte rufen sie).

Die 85 Produktions-Einstiege nach der Operation, in der sie aufgehen würden (Aufrufe: Summe der 8 Profil-Läufe,
Wire: größte gemessene Anfrage/Antwort in U32-Wörtern):

| Ziel-Op | Einstiege (Aufrufstellen) | Ergebnis | Aufrufe | Wire |
|---|---|---|---|---|
| `extrude_polygon` | `geometry.frame`, `lift_points`, `translate`, `topology.extrude` (`src/kernel.mjs:47-50`) | F32-Solid | je 13 | 22 / 227 |
| `frustum` | `analytic.frustum`, `frustum_bounds`, `frustum_volume_between`, `precise.frame/lift/add/sub/dot/normalize` (`src/analytic.mjs:181-201`) | F32x2 | 2 frustum, 709 dot, 707 normalize | 22 / 164 |
| `sketch_lines` | `sketch-lines.solve` (`src/library.mjs:197`, skSolve) | Punkte F32x2 + Uses | – | 100 / 222 |
| `sketch_arcs`, `extrude_profile` | `sketch-arcs.solve` (`src/sketch-arcs.mjs:42`), `sketch-arcs.extrude` (`:72`), `precise.add` (`:71`) | Profil / F32x2-Solid | – | 255 / 541 |
| `transform` | `topology.transform` (`src/kernel.mjs:78`), `analytic.transform`, `point_transform`, `boolean.rim_bounds`, `halfspace.bounds` (`src/analytic.mjs:142-160`) | Solid, Bounds | 5 + 3 | 3.510 / 3.486 |
| `boolean` | `boolean.coaxial` (`src/boolean.mjs:140`), `planar-boolean.union/subtract` (`:45`), `halfspace.intersect` (`:65`), `solid-intersection.intersect` (`:67`), `curved-intersection.intersect` (`:83`), `pierce.pierce/bore_depth/pierced_volume` (`:120-126`), `real.max` (`:49,71`), `curved.audit` (`src/planar-boolean.mjs:31`, `src/curved-intersection.mjs:13`), `solid-intersection.planar_measures` (`src/planar-boolean.mjs:61`, `src/solid-intersection.mjs:46`) | Result-ADTs | union 3 (13,1 s), subtract 3 (10,9 s), curved 1 (53,3 s) | union 892 / 2.440, subtract 1.284 / 4.319 |
| `import_brep` | 13 `analytic.*`-Konstruktoren und Prüfungen, `precise.distance/dot/normalize` (`src/analytic.mjs:18-100`) | Surface/Curve/Solid | r10b: 163 plane, 962 distance, … | Solid 3.342 / 3.486 |
| `measure` | `analytic.curve_residual`, `surface_residual`, `cylinder_line_residual` (`src/analytic.mjs:64,94,231,247,259`) | F32 bzw. Real | 7.244 + 9.296 + 164 | 27 / 1 |
| `identity` | 11 `identity.*` (`src/identity.mjs:67-156`) | Strings | 1.019 from_source, … | bis 142.741 / 190.974 |
| `step_pcurves` | `step-pcurves.for_edge_domains` (`src/step-pcurves.mjs:51`), `step-cylinder-pcurves.for_cylinders_domains` (`src/step-cylinder-pcurves.mjs:59`) | Knoten/Pole | 1 | 302 / 399 |
| `print_mesh` | `tessellate.chord_count/within/sagitta/ring` (`src/print-mesh.mjs:71-83`) | Ringpunkte | je 4 | 21 / 217 |
| `display_mesh` | 14 Viewer-Einstiege in `display`, `analytic`, `precise`, `cylinder-classification`, `curve-plane`, `face-classification` | Punkte | Viewer | klein, sehr viele |
| `compare_coaxial` | `comparison.coaxial` (`src/comparison.mjs:10`) | Vergleich | – | 30 / 22 |
| entfällt | `face-classification.linear_edge/max_budget` und ihre Duplikate in `step-cylinder-pcurves` (`src/face-classification.mjs:102,134`) | Adapter | 114 + 10 | – |

Kernaufrufe heute gegen Aufrufe der vorgeschlagenen API, aus den Profil-Läufen (`calls` = alle Host-zu-Kern-Aufrufe,
`API` = Aufrufe der Einstiege, die zu einer groben Operation werden, ohne Identity):

| Lauf | Aufrufe | API | Kernzeit ms | davon in API-Einstiegen |
|---|---:|---:|---:|---:|
| fs-bracket | 5 | 1 | 2 | 15 % |
| fs-bored-spacer-print | 96 | 5 | 30 | 58 % |
| fs-fuse-g1 | 202 | 3 | 1.451 | 97,5 % |
| fs-cut-h1 | 422 | 3 | 5.389 | 97,8 % |
| py-planar-union | 253 | 4 | 1.863 | 97,3 % |
| py-planar-pocket | 413 | 4 | 3.042 | 95,7 % |
| py-frame-with-tab | 839 | 7 | 12.921 | 97,6 % |
| fs-r10b-strict (Exit 1, bekannte Grenze) | 18.604 | 7 | 53.353 | 99,9 % |

Der Rest der Kernzeit bei kleinen Modellen sind Identity-Strings und Residuen-Prüfungen, die in den Operationen
aufgehen.

## 3. Synchronität und Verzweigungen

Jeder Produktionsaufruf ist synchron (`surface.json`: `synchronous: true`), und der Interpreter braucht das
Ergebnis sofort:

- **Verzweigung auf `result.$`:** `skSolve` (Solved?), `opBoolean` (Bodies/Unresolved/Bored/Swept, Decline-Codes
  -> `unsupported()` mit Quellstelle), `importOnshapeBody` (`periodic_vertex` Some/None), Viewer (`prepare_loops`).
- **Schwellen im Host:** Residuen gegen Vertex-Toleranzen, `precise.dot` gegen 1e-16 bzw. 1e-10, Höhe und
  Koaxialität im Frustum, 0,01 mm Eingangsabweichung beim Import. Diese Zulassungen wandern in die Operationen.
- **Nachfolgende Abfragen lesen die dekodierte Sicht, nicht den Kern:** `evaluateQuery`, `qOwnedByBody`
  (Kanten-/Flächenanzahl), `evVolume` (`validation.volumeMm3`), `evBox3d` (`boundsMm` bzw. Vertices), `evLine`
  (Kurvenursprung und -richtung), `getProperty`. Daraus folgt: jede körpererzeugende Operation muss die Sicht
  (Zählungen, Maße, Geometrie) synchron mitliefern.
- **Python-Shim:** jede Anfrage (`box`, `cylinder`, `translate`, `boolean`, `volume`) wird im Handler synchron
  beantwortet; dieselben Adapter wie FeatureScript.

## 4. Präzision: wo die Low-Words verloren gehen

`surface.json.precisionSites` führt 27 Stellen mit aktueller Zeile, Richtung und Wirkung. Die entscheidenden:

| Stelle | Richtung | Wirkung |
|---|---|---|
| `src/real.mjs:9` `number = value => value.hi + value.lo` | decode | binary64-Kollaps; exakt nur, wenn `lo` höchstens 5 Binaden unter dem letzten Bit von `hi` liegt (Spanne <= 53 Bit) |
| `src/real.mjs:7` `lo: Math.fround(value - hi)` | encode | Neuaufteilung; stellt verlorene Bits nicht wieder her; lehnt > 1e20 und F32-Unterlauf ab |
| `src/analytic.mjs:114,119` `decodeGeometry`, `decodeAnalytic` | decode | jede Kurve, Fläche und jeder Vertex des gespeicherten Körpers |
| `src/analytic.mjs:132` `encodeAnalytic` | refeed | **Ursache von `nativeChainExact: false`**: das dekodierte Ergebnis der ersten Boolean wird Eingabe der zweiten |
| `src/face-classification.mjs:18,98,134` | refeed | `curveRange`, Vertices, Toleranzen neu aufgeteilt (`classificationInput`) |
| `src/boolean.mjs:115,126,140` | refeed | Pierce-Achse (in binary64 normiert), Zielvolumen, Frustum-Primitive |
| `src/analytic.mjs:146,159` | refeed | Maße nach `transform` aus dekodierten Primitiven/Vertices |
| `src/step-pcurves.mjs:47`, `src/step-cylinder-pcurves.mjs:56` | refeed | STEP-Export kodiert den dekodierten Körper neu |
| `src/analytic.mjs:231` | refeed | `validateAnalytic` prüft die verlustbehaftete Kopie, nicht das Kernergebnis |
| `src/construction-history.mjs:5` | decode | **der einzige absichtlich exakte Pfad**: das Konstruktionsbudget behält die nativen Real-Wörter |
| `src/kernel.mjs:32` `Math.fround` | encode | F32-Polyederpfad; gewollt und als Präzision `F32` gemeldet |

Das Beispiel aus `out/performance/native-build123d/capture-chain-roundtrip-finding.log` ist genau dieser Mechanismus:
`hi = -1, lo = 2.2438708385304134e-31` wird zu `-1` (Abstand weit über 29 Bit), und
`8 + 1.1368683094535245e-14` rundet in binary64 auf `8 + 6·2^-49 = 8 + 1.0658141036401503e-14`. Der Test
`the binary64 collapse in src/real.mjs is what loses the low word` hält das fest.

Quantifiziert im Replay (`wire-closure.json.replay`): 152 der 695 geprüften Werte tragen Low-Words ungleich null;
von 9.784 Reals in echten Ergebnissen ändern sich 131 durch `real(number(x))`, verteilt auf
`planar-boolean.union/subtract`, `solid-intersection.intersect`, `pierce.pierce`, `analytic.assemble/with_seams`,
`tessellate.ring` und `display.cylinder_trim_coefficients`. Jede davon ist ein Kettenbruch, sobald der Wert zurück
in den Kern fließt.

Wichtig für die Migration: Solange der Host dekodiert und neu kodiert, liefern JS-Target und nativer Kern dieselben
Bits (beide bekommen dieselbe verlustbehaftete Eingabe). Erst Handles machen die Kette exakt, und dann ändern sich
Ergebnisse mehrstufiger Modelle in den letzten Bits gegenüber heute. Tests, die exakte Ausgaben vergleichen, müssen
das bewusst mitgehen; das JS-Referenz-Backend muss dieselben Handles verwenden, damit der Differenztest gültig bleibt.

## 5. Host-Nachbearbeitung heute

- **Validierung:** `validateSolid` (reines JS, F32-Pfad) und `validateAnalytic` (JS-Topologie plus Kern-Residuen pro
  Vertex: 16.704 Aufrufe in den 8 Profil-Läufen, davon 14.780 in r10b und 768 in frame-with-tab).
- **Identity:** nach jeder Operation, Strings; die Revision ist `sha256` über das JSON des **dekodierten** Körpers
  (`src/identity.mjs:21`). Größter gemessener Aufruf: `identity.transform` mit 142.741 Wörtern hin und 190.974
  zurück (ein Wort pro Code Point). Mit dem in `binding.md` gemessenen Kopieraufwand (~6-7 ns pro Wort und Richtung)
  wären das ~1 ms pro Richtung, gegenüber ~16 µs für die komplette Sicht einer planar union.
- **Konstruktionshistorie und Evidenz:** JSON im Host; enthält rohe Bend-Werte (`sourceBudget`, `stats`, `steps`).
  Die generierten JS-Decoder erzeugen genau diese Form (`{$: 'Real', hi, lo}`), daher bleibt das kompatibel.
- **Boolean-Auswahl:** `booleanInBend` liest Primitive, Flächen- und Kurventypen, `curveRange` und das Budget des
  dekodierten Körpers, um zwischen coaxial, planar, halfspace/solid-intersection, curved und pierce zu wählen.
- **Export:** `toStep`/`toStl`/`toHtml` schreiben Text aus der dekodierten Sicht; `brep.mjs triangulate` trianguliert
  planare Flächen im Host (heute Host-Geometrie; für den exakten STL-Pfad zu klären).

## 6. Vorschlag: die schmale Extension-API

Modell wie CPython plus C-Extension: der Interpreter bleibt JS, der Kern läuft nativ hinter wenigen groben,
synchronen Aufrufen. In-Process ist nach `binding.md` machbar und klar besser (0,5 µs pro Aufruf, Residenz von
Handles auf dem echten Kern gezeigt).

**Handles statt Körpern.** Körper und Sketch-Profile bleiben als Bend-Werte resident (native Seite: Bend-Heap; JS-
Referenz: JS-Objekte). Der Host hält U32-Handles plus eine dekodierte **Sicht** für Abfragen und Export und kodiert
diese Sicht **nie** zurück. Ein resident `Body` bündelt, was heute an JS-Körpern klebt und später wieder gelesen
wird:

```
type Body is Data:
  Polyhedral{solid: T.Solid}                                     # F32-Pfad (topology.bend), wie heute
  Analytic{solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real,
           tolerances: List<&2, R.Real>, primitive: Primitive, measures: Measures}
type Primitive is Data:
  NoPrimitive{}
  Frustum{bottom: G.Vec3, top: G.Vec3, r0: R.Real, r1: R.Real}    # für coaxial, pierce, compare
type Measures is Data:
  Measures{volume: Maybe<&2, R.Real>, bounds: Maybe<&2, A.Bounds>}
```

**Operationen** (Details, Signaturen, Herkunft und Datenmengen in `surface.json.proposedApi`):

| Op | erreicht von | nimmt in sich auf |
|---|---|---|
| `extrude_polygon(points, plane, delta, offset, box) -> Built` | opExtrude (Rechteck/Polylinie/Linien-Sketch), fCuboid, Python `box` | `extrudeInBend`, `box_layout` |
| `frustum(first, second?, delta?, offset) -> Built` | opExtrude (Kreis), opLoft, Python `cylinder` | `circularFrustumInBend` samt Zulassung (Höhe 1e-10, Koaxialität 1 - 1e-6), Maße |
| `sketch_lines(segments) -> Solved{profile, points, uses}` | skSolve | `sketchLines.solve` |
| `sketch_arcs(entities) -> Solved{profile, view}` | skSolve (Bögen) | `solveSketchArcs` |
| `extrude_profile(profile, plane, delta, offset) -> Built` | opExtrude (Linie/Bogen) | `extrudeSketchArcs` plus Prüfungen |
| `transform(body, rotation, offset) -> Built` | opPattern, Python `translate` | `transformInBend`, `transformAnalytic` samt Maß-Übertrag |
| `boolean(a, b, op, policy, tolerance) -> Booleaned \| Refused` | opBoolean, Python `boolean`, wonky-compare | Zweigauswahl, `classificationInput`, alle Decode-Prüfungen, Audits, Maße, Pierce-Tiefe/-Volumen |
| `import_brep(source) -> Built` | eingefrorene Module | `importOnshapeBody` (r10b: 18.604 Aufrufe -> 1 pro Teil) |
| `measure(body)` / `view(body)` | Abfragen, brep.json, Export | `decodeAnalytic` und Residuen; wird von jeder Op inline mitgeliefert |
| `identity(...)` | nach jeder Op | `kernel.identity.*` (offene Frage, s. u.) |
| `step_pcurves(body, budget)` | toStep | `fullBandPCurve`, `cylinderPCurves` ohne Neukodierung |
| `print_mesh(body, deviation)` | `--format print` | `tessellate.*` pro Kreis (Datei gehört dem Bake-off) |
| `display_mesh(body, tolerance)` | wonky-view | 14 Viewer-Einstiege; darf auf der JS-Referenz bleiben |
| `compare_coaxial(a, b, tolerance)` | wonky-compare | `comparison.coaxial` |
| `release(handles)` | Ende von `build()`/`buildPython()` | explizite Lebensdauer |

**Was die Grenze kreuzt:** Anfragen schrumpfen auf Handles plus wenige Wörter (planar union heute 892 Wörter
neu kodierter Operanden, danach etwa 10). Antworten bleiben die Sicht (planar union 2.440 Wörter, ~16 µs bei
6-7 ns/Wort). Eingaben bleiben so gerundet wie heute: F32 für den Polyederpfad, `real()` auf die mm-Werte der
FeatureScript- und Onshape-Eingaben. Das ist Eingabe-Serialisierung, keine Rundreise.

**Fehlermodell** (AGENTS.md: laut scheitern, nie still zurückfallen): Status 0 ok; `Refused{code, stage, detail}` ->
`UnsupportedFeatureError` an der FeatureScript-Quellstelle (die Meldungstabellen wie `PIERCE_DECLINES` bleiben im
Host); ungültiges Ergebnis (Audit) -> `fail()`; fehlerhafte Anfrage (Status 1) oder unbekannte Op (Status 2) ->
`NativeKernelError` als Bridge-Fehler; nativer Absturz -> Fehler, **kein** zweiter Lauf auf dem JS-Target.

**Bleibt in JS:** Parser, Interpreter, Werte und Einheiten, Record-/Lineage-Verwaltung, Abfragen über Sichten,
Evidenz-JSON, Quellkarten, STEP/STL/HTML-Writer, Python-Brücke, die FeatureScript-Eingaberegeln (`validatePolygon`,
Orientierung per `signedArea`, `plane()`-Normierung).

**Migration in zwei Schritten:**

1. *Gleiche feine Oberfläche, nativer Dispatcher.* Die generierten JS-Decoder liefern exakt die Wertform des
   JS-Targets, daher kann `kernel.planarBoolean.union(...)` ohne Adapteränderung nativ laufen. Ergebnisse bleiben
   bitgleich mit heute (inklusive derselben Host-Rundreise). Das eignet sich als erster Differenztest.
2. *Grobe Handle-API.* `kernel/service/api.bend` implementiert die Operationen oben einmal in Bend; dieselbe Quelle
   wird für ARM64 (Addon) und für das JS-Target (Referenz) übersetzt. Die Codecs für ihre Signaturen erzeugt
   `gen-wire.mjs`.

**Offene Fragen an Marc:**

- Identity: auf der JS-Referenz lassen (billig, aber zwei Runtimes pro Build), in die Operationen falten (dann
  Revision nativ als Hash über die Wire-Wörter; ändert die Revisionsstrings in brep.json) oder Strings gepackt
  übertragen (4 Byte pro Wort, 4x weniger)?
- Soll der Polyeder-F32-Pfad bleiben oder `extrude_polygon` gleich analytische F32x2-Körper liefern (ändert
  gemeldete Präzision und Ergebnisse)?
- `curved-intersection` (r10b) braucht vor jeder nativen Nutzung eine Umgehung des Bend-Arity-Limits im Kern.

## 7. Wire-Format und die ADTs, die es exakt brauchen

Ein flacher Strom little-endian U32, ohne Padding. `U32` 1 Wort; `F32` 1 Wort Bitmuster (`F32.bits`; -0, Subnormale,
NaN-Payload bleiben); `Bool` 0/1 (sonst Decode-Fehler); `String` Anzahl Code Points, dann ein Wort pro `Char`
(<= 0x10FFFF); `Real` genau 2 Wörter `bits(hi), bits(lo)`, **nie** binary64; ADT: Tag-Wort bei mehr als einem
Konstruktor, dann Felder in Deklarationsreihenfolge; `List` Anzahl + Elemente; `Maybe` Tag (0 None, 1 Some) + Wert.
Anfrage: Op-Nummer wählt das `def`, Argumente in Parameterreihenfolge. Antwort: Status (0 ok, 1 fehlerhafte
Anfrage, 2 unbekannte Op), bei 0 das Ergebnis. Abgelehnt (Generator scheitert laut): `Nat`, `Cmp`, `Char` außerhalb
von `String`, Closures, Arrays, Generics, rekursive Typen. Keiner davon liegt auf der Produktionsoberfläche.

Die Produktionsoberfläche braucht **121 ADTs** (vollständig mit Konstruktoren, Feldern, Quellzeile, fester
Wortzahl und Nutzern in `surface.json.wireAdts`). Fest dimensionierte Kerntypen: `Real` 2 Wörter, `precise.Vec3`
6, `geometry.Vec3` 3, `precise.Rotation` 18, `precise.Frame` 24, `analytic.Bounds` 12, `intersections.Tolerance` 4,
`curved-validate.Audit` 9, `planar-boolean-types.Stats` 6, `solid-intersection.PlanarMeasures` 14,
`comparison.CylinderComparison` 22. Nach Modul:

- Geometrie: `real.Real`; `precise` Vec3, Rotation, Frame; `geometry` Vec3, Rotation, Frame; `topology` Coedge,
  Edge, Face, Solid; `analytic` Curve, Surface, Edge, Loop, Face, Solid, Bounds, CurveRange; `intersections.Tolerance`;
  `face-classification.DomainChoice` (+ PreparedEdge, PreparedLoop, LoopPreparation, Reason); `curve-plane.Domain`.
- Boolean-Ergebnisse: `ports/planar-boolean-types` Result, Body, FaceRef, FaceOrigin, EdgeOrigin, Stats;
  `ports/solid-intersection` Bodies, Body, FaceRef, EdgeRef, PlanarMeasures; `ports/curved-intersection`
  IntersectionResult, Method, Policy, Step; `ports/curved-contact-state` Ledger, Policy und Records;
  `ports/curved-validate.Audit`; `ports/types.Reason`; `boolean` BooleanResult, Body; `halfspace` ClipResult,
  VertexMap, Reason; `pierce.Pierced`; `robust-predicates` Decision, Method, Sign.
- Sketch: `sketch-lines` Segment, Point, SourcePoint, Use, SolveResult, Reason; `sketch-arcs` Entity, Fit, Use,
  SolveResult, ExtrusionResult, Reason; darin `junction` (17 Typen) und `curve-band` (9 Typen) als Nachweis-Felder.
- Export und Rest: `step-pcurves` PCurveResult, UV, Reason; `step-cylinder-pcurves` CylinderResult, FaceChart,
  PCurve, PCurveRef, EdgeAssociations, AssociationKind; `step-cylinder-pcurves-geometry` Spline, Reason;
  `comparison.CylinderComparison`; `identity` EntityIdentity, ParentIdentity, IdentitySet; Viewer:
  `cylinder-classification.PhysicalEdges`, `face-bounds.Bounds`, `edge-plane`/`curve-plane`-Gründe,
  `boundary.Reason`.

Für die schmale API reduziert sich das auf die Geometrie-Gruppe, die Ergebnis-/Grund-ADTs der Operationen und
wenige neue Service-Typen (`Body`, `Primitive`, `Measures`, eine `ImportBody`-Eingabe).

## 8. Generierbarkeit: Ja, mit einer dokumentierten Grenze

`scripts/native-bridge/gen-wire.mjs` liest `type ... is Data:`-Deklarationen und `def`-Signaturen aus `kernel/**/*.bend`
(inklusive mehrzeiliger Signaturen, Modul-Aliasse, `List<&2, T>`, `Maybe<&2, T>`) und erzeugt:

- **Bend** (`wire.bend`): `enc_*`/`dec_*` pro Typ, `encode_*`/`decode_*` pro Wurzel (Decoder liefert `Maybe`, `None`
  bei Unterlauf, ungültigem Tag, `Bool` außer 0/1, `Char` > 0x10FFFF oder Restwörtern) und
  `dispatch(op: U32, words: List<&2, U32>) -> List<&2, U32>`. Genau diese Signatur akzeptiert der Direktaufruf-Pfad von
  `scripts/native-bridge/binding-build.mjs`. Weil Bend nur Parameter und musterverbundene Variablen destrukturiert und
  keine Vorwärtsreferenzen kennt, ist jeder Decoder eine Kette kleiner Defs über (Wert, Cursor)-Paare, callee-first;
  Listen und Strings dekodieren mit `Nat`-Fuel aus dem Längenwort (strukturelle Rekursion).
- **JS** (`wire.mjs`): Codecs pro Typ, die exakt die Wertform des JS-Targets erzeugen und prüfen (`Object.is` auf
  F32, keine stille Rundung: `0.1` als F32 wird abgelehnt), Op-Encoder und -Decoder.
- **Manifest** (`wire.json`): Konstruktor-Tags, Felder, feste Wortzahl, geschätzte native Breite, Warnungen.

Nachweise:

| Prüfung | Ergebnis |
|---|---|
| Codierbarkeit des ganzen Kerns (`wire-survey.json`) | 335/336 Typen, 2.148/2.191 Defs; verweigert: 37 Defs mit `Nat`, 3 mit `Cmp` (robust-predicates intern), 3 mit dem rekursiven `solvespace-bsp.Bsp` (Diagnose-Port) |
| Unit-Test (`test/native-bridge-wire.test.mjs`, 9 Tests) | Real, DomainChoice, Solid, ParentIdentity, IdentitySet; Dispatch von `real.max`, `analytic.frustum`, `identity.frustum`; fehlerhafte Frames scheitern auf beiden Seiten; die ganze Produktionsoberfläche generiert ohne Breitenwarnung |
| Volle Produktions-Hülle (`wire-closure.json`) | 85 Ops, 121 ADTs, 10.514 Zeilen Bend, 3.465 Zeilen JS, Generierung 12 ms; JS-Target-Compile kalt **394 s** (ein Kern, Last ~13; der Compiler übersetzt die ganze Kern-Importhülle mit), gecacht 0,16 s |
| Replay echter Werte | 19 FeatureScript-Modelle und Snippets, STEP-Export aller, Druckmesh, Vergleich, Review-Szene, vier eingefrorene r10b-Importe (Kreis, Kegel, Ellipse, 'other'): 83/85 Einstiege belegt (`identity.unattributed` und `step-cylinder-pcurves.linear_edge` werden in Produktion nicht erreicht), 153 Aufrufe, **695 Werte bitgenau** in Bend- und JS-Codecs (Bend-Encoder == JS-Encoder Wort für Wort; beide Decoder geben den Originalwert mit -0 und allen Low-Words zurück), **153 Dispatch-Replays wortgleich** zum Direktaufruf |
| Native C-Emission (`wire-native-emit.json`) | 84 Ops ohne curved-intersection: ok, 12 MB C in 16 s. curved-intersection allein über den Generator: "an arity over 255". **Derselbe Fehler ohne generierten Code**, direkt für `ports/curved-intersection.bend:intersect` und `section.bend:section` |

**Die Grenze.** Bends C-Backend legt ADTs flach in Wörter und lehnt einen Wert über 255 Wörter ab, der über einen
Nicht-Tail-Call gehalten wird (laut 2.0.25-CHANGELOG noch offen). Das trifft den Kern selbst (Abschnitt oben) und
kann auch generierten Code treffen: der Encoder für `section.bend:PairResolution` hält beim Kodieren des ersten
Feldes das zweite (~344 Wörter geschätzt) und scheitert. Der Generator schätzt deshalb pro Typ die flache Breite
und warnt bei gehaltenen Feldern über 255 Wörtern (`nativeWidthWarnings`). Die Schätzung trennt die bekannten Fälle:
`PairResolution` 344 (abgelehnt), die ganze Produktions-Hülle höchstens 124 (emittiert). Sie ist eine Schätzung,
nicht Bends Layout.

**Nicht gemessen hier:** clang-Übersetzung und Ausführung des generierten Dispatchers (Aufgabe der Binding-Stufe),
native Codec-Kosten, Metal. Keine Aussage über native Geschwindigkeit.

## 9. Dateien

- `scripts/native-bridge/surface-scan.mjs`: Karte, Annotationen, Präzisionsstellen, API-Vorschlag, Abdeckungsprüfung.
- `scripts/native-bridge/gen-wire.mjs`: Generator (`--type`, `--op`, `--out`, `--survey`).
- `scripts/native-bridge/wire-closure.mjs`: volle Hülle generieren, im JS-Target kompilieren, echte Werte replayen.
- `scripts/native-bridge/wire-native-emit.mjs`: native C-Emission der Hülle und der Kern-Gegenproben.
- `test/native-bridge-wire.test.mjs`: Round-Trip-, Dispatch-, Fehler- und Abdeckungstests.
- Generierter Code liegt nur unter `tmp/native-bridge/surface/` und wird nie von Hand editiert.
