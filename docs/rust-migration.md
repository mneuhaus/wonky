# Migrationsplan: wonky-Kern von Bend nach Rust

Stand: 2026-09-26, überarbeitet nach Marcs Entscheidungen vom selben Tag („Direkt besser“, R20 mit Blends,
maximale Parallelität) und nach der Planprüfung (Abschnitt 13, „Kritik und Entscheidung“). Vorgänger: `65688ce` (Plan für
1:1-Portierung, 37 Pakete). Gebaut ist nur G0 (`main`); P0 (Branch `rust-p0-int`, letzte Fixrunde) und zehn W0-Pakete
laufen (`tmp/rust-plan/IN-FLIGHT.md`). Aufwandszahlen sind Schätzungen, alle anderen Zahlen tragen ihre Quelle. Die
Paketliste für den maintainer steht maschinenlesbar in `tmp/rust-plan/waves.json`, erzeugt und geprüft von
`tmp/rust-plan/gen-waves.mjs` (dort ändern, nicht im JSON).

## 1. Ziel, Nicht-Ziele, Definition of Done

**Ziel.** Ein Rust-Kern ersetzt den Bend-Kern hinter derselben Host-Schnittstelle. Jede Op geht direkt auf den besseren
Algorithmus: f64-Konstruktion, jede Vorzeichen- und Topologieentscheidung exakt (Filter, dann Expansion), Unentscheidbares
als benannte Ablehnung (AGENTS.md). Frontends (FeatureScript-Interpreter, build123d), Viewer, Tests und R20-Harness bleiben JS.

**Nicht-Ziele.**
- Keine 1:1-Parität mit Bend. Bend ist nur noch billiger Gegencheck (`rust-diff`), nie Orakel. Bekannte Bend-Fehler sind
  erwartete Unterschiede (Abschnitt 7).
- Kein OCCT-, Truck- oder Fornjot-Hybrid: fremde Kerne prüfen nur exportierte Artefakte (AGENTS.md).
- Keine neue Bend-Kernfunktion. Bend-Code und Bend-Kandidaten (`tmp/*-candidate.diff`) sind nur Algorithmusquelle.
- Kein Port des Hybrid-Booleans (Netz-Corefine plus Recover). Er wird durch einen direkten B-rep-Boolean ersetzt
  (Abschnitt 4). Ein Netz-Rückfall ist nur Notfallplan (Risiko R3).
- Kein wasm, keine formalen Beweise (E7: Property-Tests gegen exakte Rationalzahlen).

**Definition of Done.**

| Meilenstein | Kriterium |
|---|---|
| **M-R20B** (Ziel) | `WONKY_BACKEND=rust`, kein `.bend` geladen (`--require-no-bend`). Alle 8 R20-Module aus dem eingefrorenen Snapshot, Live-Parameter `withBlends=true` wo vorhanden (tray, edge, return, cores, feed), Fillets und Fasen gebaut. Jedes Teil besteht Volumen (in Onshapes [min, max]), BBox, Hausdorff und Statement gegen die eingefrorenen **Blend-Referenzen** (G2, `fixtures/r20-modules-blends/`) bzw. G0 für datums, context, probe. Zusätzlich: der Lauf mit `withBlends=false` besteht weiter gegen G0; jedes Teil ist exakte B-rep oder trägt eine ausgewiesene Näherung mit Toleranz ≤ 0,01 mm; kein Teil verliert Exaktheit gegenüber dem Bend-Baseline-Label; OCCT prüft das STEP jedes exakten Teils gültig, OCCT-Volumen in der Rust-Schranke (Schranke höchstens so breit wie in VO1 festgelegt); metamorphe Suite 0 Verstöße auf den 8 Modulen; 17-Fall-Abnahme `--adversarial` ohne FAIL; EX1 rechnet die Zertifikatstichprobe ohne Abweichung nach; XD1-Unterschiedsliste geschlossen; LN1 grün; 0 NaN/Inf. Fable und Astra sagen beide LAND. |
| M-Fast | `npm run test:fast` grün auf `rust`, kein `.bend` geladen. |
| M-Retire | Bend aus dem Produktionspfad: `backend.mjs` ohne Bend-Backends, `check:bend` ersetzt durch Rust-Property-Tests (E7), die 37 `loadBend`-Tests migriert oder gelöscht, `kernel/` nur als Tag. |

## 2. Gesicherte Fakten (mit Quelle)

| Fakt | Quelle |
|---|---|
| Kern: 86.711 Zeilen Bend ohne `vendor`; hybrid/ 15.407, fillet/ 9.499, proto/ 25.325 (nicht Produktion), ports/ 7.488, Kerndateien der Wurzel 18.410. | `find kernel -name '*.bend'`, nachgezählt |
| R20 mit und ohne Blends ruft **84 verschiedene Kerneinstiege** (64 ohne Blends). Blend-only: `fillet/production:{fillet,fragments}`, `edge-plane:intersect`, 18 `face-classification:*`, `evaluate:edge_tangent`. | `/private/tmp/rust-plan-census/*-{false,true}.json`, zusammengeführt |
| Kernzeit ohne Blends (Summe aller Module): `volume.volume` 204 s, `hybrid corefine/main.run` 127 s, `volume.mesh_snap` 32 s, übriger Hybrid 38 s, planarer Boolean 8,5 s, Rest < 5 s. | dito, `ms` je Einstieg |
| Mit `withBlends=true` auf Bend JS: edge und cores bauen; tray stoppt im Fillet („overflow: the contact of edge 144 on face 47 needs width 2 …“); return stoppt im Interpreter („sqrt of a value with units is not implemented“); feed stoppt wie ohne Blends vor dem ersten Blend. | dito, `out/*-true/error.json` |
| Blend-Stellen im Snapshot: **16 statische Stellen**, 8 `opFillet` und 8 `opChamfer` in tray (2/1), edge (2/1), return (4/4), cores (0/1), feed (0/1) (die frühere Zahl 17 war ein Additionsfehler). Statische Stellen sind keine Aufrufzahl: ARM_L/ARM_R teilen den Fillet-/Fasen-Helfer, CORE_L/CORE_R dieselbe Fasenstelle; nach Default-Aufrufstruktur 19 Blend-Aufrufe, sofern alle erreicht. datums, context, probe haben kein `withBlends`. | `grep -c` in `fixtures/r20-modules/studios/*.fs`; `return.fs:1136,1232,1239`, `cores.fs:1167–1169` |
| Bends Solid-Layout transportiert nur `Line`/`Circle`/`Ellipse` und Vertex-/Kanten-/Flächenlisten: keine Parabel, Hyperbel, Spurkurve, keinen Zweig, keine Herkunft, keine Fehlerschranke. | `kernel/analytic.bend:8–38` |
| Bends Fillet-Entscheidungen brauchen Ausdrücke mit drei unabhängigen Radikanden (drei Normquadrate). | `kernel/fillet/decide.bend:155` |
| Bends Volumen-Quadratur nimmt die Differenz zweier Gauss-Stufen als Fehler: eine Schätzung, keine obere Schranke. P0s Ball-Arithmetik hat Grundrechenarten und `sqrt`, keine validierten Transzendenten. | `kernel/volume.bend:705–714`; `rust-p0-int:rust/wonky-num/src/ball.rs` |
| `onshape_sync.py` lädt nicht `build/studios`, sondern erzeugt Payloads neu über `build_fs.build()` und überschreibt Remote-Abweichungen ausdrücklich. Die 8 lokalen Studio-Builddateien sind heute bytegleich zu G0 (Prüfbefund 2026-09-26); erzeugte Payloads und Live-Zustand sind ungeprüft. | `~/Workspace/cad/cad-project-041/single-step-r20/tools/onshape_sync.py:794–803,926`, `build_fs.py:276–298` |
| Der Spike-Planar-Boolean trägt Bend-Grenzen (`Limits::Bend`: round_guard 1e-13, angular_guard 1e-12) und f64-Guards 1e-15 als Schwellen. | `rust-p0-int:rust/wonky-ops/src/planar/num.rs:74–86` |
| G0 friert nur `withBlends=false` ein (Beschreibungsstempel `live=withBlends:false`). Blend-Referenzen fehlen für 15 Teile: tray 3, edge 1, return 4, cores 5, feed 2. | `fixtures/r20-modules/studios/r20-modules-volumes.json` |
| Bend-JS-Baseline G0: 7/8 Module, 31/33 Teile bestehen; feed lehnt ab (344:5, Nahkontakt 0,0056 mm gegen Clearance 0,010001 mm). | `fixtures/r20-modules/baseline-bend-js.json`; `docs/rust-migration.md` alt |
| Spike: planarer Boolean in Rust 13,3 bis 17,8x schneller als Bend native bei gleichem Algorithmus; Propagation statt Strahl pro Zelle weitere 5,1 bis 7,1x; Ergebnis hat mehr Flächen als OCCT (64 statt 14 bei frame-with-tab), weil koplanare Flächen nicht zusammengeführt werden. | local development evidence S4, „Lücke zu OCCT“ |
| P0 (`rust-p0-int`): Crates `wonky-num`, `wonky-ops` (Spike-Planar), `wonky-replay`, `wonky-wire` (v1 und v2), `wonky-node`; Backends `rust`, `rust-diff`, `rust-mixed`. Fable-Gate fand `line_point_side` mit falschem Vorzeichen (Filter-Unterlauf) und einen Build-Key ohne Build-Umgebung; Fixrunde läuft. | local development evidence |
| Fillet-Entwurf A (`fillet-kpart`: exakte Leiter, Eckennetz, lokale Chirurgie, Überlauf als Kerbe) ist die gewählte Produktionsmethode; C-tori ist unabhängige zweite Engine. Korpus: 71 Katalogfälle, 63 Adversarial-Fälle, Onshape-Proben FP01 bis FP22, OCCT-Replays. | `docs/fillet-plan.md` §1, §2; `fixtures/fillet/` |
| Die R20-Werkzeuge können Blend-Referenzen holen: `onshape_sync.py --set <modul>.withBlends=true`, `tessellate.py --out-dir`, `onshape_volumes.py`. Sync schreibt Studios nur bei geänderter SHA. | `~/Workspace/cad/cad-project-041/single-step-r20/tools/` |
| Maschine: 64 GB, 18 Kerne; 07:39 `memory_pressure` 85 % frei, Thermik 0. Gemessene Spitzen: Bend-JS-Modullauf 0,3 bis 1,0 GB, Fast Lane `--jobs=4` 1,8 GB, Native-Lane mit Bend-native-Build 10,5 GB, Viewer-Worker context 13,7 GB (vor Fix). | `sysctl`, `memory_pressure`; Worklogs `rust-p0-fix`, `sw-land`, identity-Gate |

## 3. Architektur

### 3.1 Crates (Cargo-Workspace `rust/`)

| Crate | Inhalt | Status |
|---|---|---|
| `wonky-num` | f64, Ball-Arithmetik, Expansionen, Prädikate, `decide() -> Result<Sign, Undecided>`; neu: Konstruktionszertifikate (N1), Grad 2 mit ein und zwei Radikanden (N2), drei Radikanden (N3), validierte Transzendente und Quadraturreste mit getrennten Typen `Estimate`/`Enclosure` (VA1) | P0 |
| `wonky-alg` | exakte univariate Algebra, Sturm, Wurzelisolation (W0-ALG); algebraische Punkte, Kegelschnitt×Kegelschnitt, bivariate Ereignisse (AL2) | W0-ALG, AL2 |
| `wonky-geom` | Träger (Ebene, Zylinder, Kegel, Kugel, Torus), Kurven (Gerade, Kreis, Ellipse, Parabel, Hyperbel je mit Zweig und Parameterbereich, Spurkurve), Rahmen mit Herkunft; Trimmen und Ordnen zertifizierter Kurven (TC1) | W0-GEOM, GE1, TC1 |
| `wonky-brep` | Arena-B-rep, Audit, Herkunft, Umwandlung von und zu Bends Solid-ADT und Wire v3 | W0-BREP, BR1 |
| `wonky-ops` | `arrange` (AR1 bis AR3), `ssi` (SI1 bis SI5), `boolean`, `planar`, `sketch`, `extrude`, `revolve`, `transform`, `volume`, `tessellate`, `step`, `query`, `identity`, `leaves` | je Paket ein Modul |
| `wonky-fillet` | Leiter, Ecken, Chirurgie, Integration | BL1 bis BL5 |
| `wonky-wire`, `wonky-node`, `wonky-replay` | Codecs (v1, v2 aus P0; **v3** aus WC0), N-API-Addon, Replay | P0, WC0 |
| `wonky-oracle` | exakte Rationalzahlen, nur als Test-Abhängigkeit | W0-ORACLE |

`wonky-hybrid` entfällt. Jedes Paket besitzt ein eigenes Modulverzeichnis; gemeinsame Dateien (`Cargo.toml`, `lib.rs`-
Modullisten) führt der maintainer beim Landen zusammen.

### 3.2 Zahlenpolitik (gilt weiter, ergänzt um E4)

- Konstruktion in f64; jede Topologie-, Vorzeichen-, Inzidenz- oder Ablehnungsentscheidung über `wonky-num`. Der Lint
  LN1 verbietet rohe f64-Vergleiche in `wonky-ops`/`wonky-fillet`/`wonky-geom`/`wonky-brep`.
- `Result` statt sticky Flag; Eingaben außerhalb [1e-150, 1e150] und Subnormale: benannte Ablehnung.
- Keine F32x2-Literale; jede Schranke neu hergeleitet, als benannte Konstante mit Herkunft. **Konkrete Sperrliste** (LN1):
  `Limits::Bend` des Spikes (round_guard 1e-13, angular_guard 1e-12, 10-m-Strahlschranke), die f64-Guards 1e-15 als
  Entscheidungsschwellen, die Bänder aus `fillet/exact.bend` und `fillet/bounds.bend`, die Fillet-Rahmenverschiebung. BO1
  und BL1 bis BL3 übernehmen Algorithmen, nie diese Bänder.
- **Schätzung und Einschließung sind verschiedene Typen** (VA1): nur eine bewiesene Einschließung (`Enclosure`) darf in ein
  Zertifikat oder eine Abnahme; eine Fehlerschätzung (z. B. Differenz zweier Gauss-Stufen) nie. Transzendente nur über VA1.
- **Höchstbreite:** jede Einschließung, die eine Abnahme trägt, hat eine festgelegte Höchstbreite (Volumen: 1e-9 relativ
  geschlossen, 1e-7 relativ Quadratur und höchstens 1/10 der Breite von Onshapes [min, max]); breiter ist FAIL, nie ein
  bestandener Überlappungstest.
- **Budgets getrennt und zusammengesetzt:** Approximation (Spurkurvenröhre), Konstruktion, Integration und Export tragen
  eigene Fehlerbudgets im Wire-Schema v3 (WC0); die Summe wird ausgewiesen, keine Stufe verbraucht stillschweigend das
  Budget einer anderen.
- Deterministische Reihenfolge; rayon nur, wo 1 und N Threads byte-gleich sind (geprüft).
- **E4, Lücken unter Onshapes Auflösung:** Tangentialität, Kontakt, Koplanarität und Koaxialität gelten nur, wenn die
  **Konstruktion** sie exakt beweist: exakte Auswertung auf den **maßgeblichen** Konstruktionsparametern (E9) im selben
  Rahmen (gleiche Rahmen-ID aus Transform oder Muster). Beweis „gleich“ → Kontakt; Beweis „ungleich“ → echte Lücke, bleibt
  Lücke, auch bei 1e-7 mm; kein Beweis möglich → benannte Ablehnung. Keine Schwelle, kein Raten. Folge für E5: die
  Host-Regularisierungen (CAP_SNAP, FRAME_REGULARIZATION) sind auf dem `rust`-Pfad aus.
- **E9, welche Konstruktion maßgeblich ist (Default, Marc bestätigt oder ändert):** maßgeblich sind die binary64-Werte, die
  der FeatureScript-Interpreter an die Kern-Op übergibt, also dieselbe IEEE-Operationsfolge, die FeatureScript auch in
  Onshape rechnet. Der Kern leitet alles Weitere (Offsets, Schnitte, Transformationen) exakt aus diesen Werten und der
  Herkunftskette ab; ein im Kern gerundetes Zwischenergebnis ist nie Beweisgrundlage. Beispiel aus der Prüfung:
  `1.68 + 10.1` rechnet der Interpreter zu genau `fl(11.78)`; übergibt er diese Summe, ist Tangentialität bewiesen. Wertet
  man dagegen die Teilausdrücke exakt dyadisch aus, bleibt eine Lücke von 2^-52. Der Default wählt das Erste. Alternative
  (nicht Default): exakte Dezimal-/Rationalauswertung der FS-Literale im Interpreter; näher an der Konstruktionsabsicht,
  aber teuer und bei Trigonometrie nicht möglich.
- **Herkunft reist mit dem Körper** (WC0): ohne Herkunft kein Beweis. Bend-Körper (v1/v2) haben Herkunft „keine“; E4-
  Entscheidungen darauf sind ausdrücklich unbewiesen und lehnen benannt ab. Exakte Prädikate auf bereits gerundeten
  Konstruktionsergebnissen reparieren das nicht.
- **Zertifikatmodus** (Cargo-Feature `certify`): jede exakte Entscheidung schreibt Prädikat, Eingaben und Urteil als JSONL;
  EX1 rechnet eine Stichprobe mit Rationalzahlen nach.

### 3.3 Anbindung

- **Wire v3 (WC0) ist der Produktionspfad auf `rust`:** versioniertes Geometrie-Schema mit Kurvenzweig, Parameterbereich,
  Trägerbezug, Fehlerschranke (bewiesen/geschätzt getrennt, Budgets je Stufe) und Konstruktions-/Transform-Herkunft. Wire v2
  (`Real` = binary64, Bends Solid-Layout) bleibt für den Import von Bend-Körpern (`rust-mixed`, Replay), v1 nur für Replay
  alter Bend-Erfassungen. WC0 ist ein reiner Vertrag und kommt vor GE1, BR1, HS1 und N1, damit keine Zyklen entstehen;
  er friert den Vorschlag aus W0-BREP (`docs/rust/brep-provenance.md`) ein.
- **Inzidenz überlebt Transformationen** (Befund aus dem W0-GEOM-Verify, 07:58): eine x-Achsen-Gerade in der Ebene z=0,
  beide mit `Rigid::around_axis((3,-2,5),(1,2,3),0.1)` bewegt, liefert heute `Point` statt `Contained`. Unter E4 muss die
  Inzidenz aus der Herkunft kommen (Inzidenzfakt oder Quellrahmen plus Transform je Entität, auch über den Host-Wire). Der
  Repro ist Abnahmetest in WC0, GE1 und TR1.
- **Naht auf Host-Op-Ebene (HS1):** Auf `rust` ruft der Host je Op (Skizze, Extrusion, Revolve, Boolean, Transform,
  Volumen, Tessellierung/Export, Fillet/Fase, Abfragen) einen groben Rust-Einstieg. Der Rust-Kern bleibt zustandslos;
  Körper reisen als Wire v3 zwischen den Ops verlustfrei durch den Host (auch Hyperbelzweige, Spurkurven und Beweise). Die
  JS-Adapter lesen v3 oder eine ausdrücklich verlustbehaftete Solid-Sicht nur zur Anzeige, die nie in eine Op zurückgeht.
  Blatt-Einstiege (LF1) nur, solange der Host sie noch ruft; Einstiege ohne Aufrufer werden gelöscht, nicht portiert.
- Backends: `rust` (nur Rust, fehlende Op = `NativeCapabilityError` mit Op-Namen), `rust-diff` (Bend JS und Rust je
  Host-Op, semantischer Vergleich, XD1), `rust-mixed` (getrackte Op-Tabelle, im `brep.json` protokolliert, nie
  Fallback bei Fehler).
  Stand P0 (gelandet 2026-09-26): `rust` ist strikt (jeder nicht portierte Einstieg wirft `NativeCapabilityError`
  mit Namen, es wird kein Bend-Modul geladen, auch nicht die Modellierungsservices); `rust-diff` und `rust-mixed`
  verweigern mit Namen, bis die Host-Naht sie freischaltet: `rust-mixed` über HS1 mit Provenienz pro Build (inklusive
  direkt geladener Bend-Services, nur tatsächlich geroutete Slots), `rust-diff` über XD1. Offen aus P0 für HS1/XD1:
  Cargo-Frische per mtime (touch nach Restore), binary64-Host-Pfad pro Kernel statt `process.env`, der klebrige
  Undecided-Adapter `rust/wonky-ops/src/planar/num.rs` fällt mit dem produktiven planaren Boolean (BO1).
- Panics mit `catch_unwind` an der Grenze, Status 5 / `NativeKernelError`.

## 4. Algorithmus je Op-Familie

| Familie | Bend heute | Rust-Algorithmus | Paket |
|---|---|---|---|
| Prädikate | F32x2-Expansionen, schmales Exponentenfenster | Ball-Filter, dann Expansion; Ausdrucksklassen nach Zensus (N2): Grad 2 mit ein und zwei Radikanden (N2), drei Radikanden (N3, Fillet), allgemeine algebraische Zahlen (AL2 auf W0-ALG); Konstruktionszertifikate auf WC0-Herkunft (N1); validierte Transzendente (VA1) | P0, N1, N2, N3, AL2, VA1 |
| Kurven trimmen und ordnen | in jedem Arm eigens | Punkte auf Kegelschnitten (exakt über N2/AL2) und Spurkurvenröhren (nur bei bewiesener Disjunktheit) ordnen, Zweigwahl, Trimmen an beiden Trägern | TC1 |
| Skizze (Linien, Bögen) | Region-Solver mit 256-Entity-Grenze, lehnt D03 ab (`SelfIntersectionOrTouch`) | exakte 2D-Anordnung von Strecken und Kreisbögen, Kandidatenpaare über Gitter/BVH, Halbkanten, Löcher und Verschachtelung, keine Entity-Grenze | AR1, SK1 |
| Extrusion, Revolve | profile-ring vereinfacht über Winkeltoleranz; revolve.sweep | Prisma bzw. Rotationskörper direkt aus Regionen; kollineares Zusammenlegen nur mit Konstruktionsbeweis; Pol- und Apex-Ecken exakt | SK2, RV1 |
| Boolean | fünf Arme: planar (Strahlen pro Zelle), prism-boolean, coaxial, pierce, Hybrid (Netz-Corefine + Recover, 13 Teile nur Certified Mesh) | **ein** direkter B-rep-Boolean: BVH über Flächenboxen → Flächen-Flächen-Schnitt analytisch (Ebene×Quadrik/Torus geschlossen, Quadrik×Quadrik in Sonderlagen geschlossen, sonst zertifizierte Spurkurve in drei Stufen: vollständige Ereignisisolation SI3, zertifizierte Fortsetzung SI4, Trim-/Folgeoperations-Integration SI5) → Kurven trimmen und ordnen (TC1) → Flächen im Parametergebiet teilen (AR1/AR3 planar mit allgemeinen Kurven, AR2 gekrümmt) → Klassifikation durch **Propagation** (ein exakter Punkt-in-Körper-Test je Komponente) → Auswahl, Nähen → **Zusammenführen** von Fragmenten auf demselben Träger. BO2/BO4 lehnen Spurkurven benannt ab, bis SI5 sie einhängt; kein optionaler Pfad | BX1, SI1 bis SI5, TC1, AR1 bis AR3, BO2, BO3, BO4, BO5 |
| Planarer Boolean | Strahlen pro Zelle | Spike-Code mit Propagation und koplanarem Zusammenführen, Löchern und mehreren Schleifen, ohne die Bend-Grenzen des Spikes (LN1); bleibt danach als unabhängiges Orakel für BO4 auf planaren Eingaben | BO1 |
| Volumen | geschlossene Randintegrale in F32x2 (204 s Kernzeit), Gauss-Differenz als Fehler | dieselben geschlossenen Formen in f64 mit Ball-Einschließung (Transzendente über VA1), Quadratur nur für Kugel/Torus mit **bewiesenem** Restglied, Spurkurven entlang der SI4-Röhre mit addiertem Budget; Höchstbreite; Label geschlossen/Quadratur | VO1, VO2 |
| Tessellierung, Export | printMesh je Fläche, gespiegelte Randringe (X06: 168 falsch orientierte Kanten) | gemeinsame Kantendiskretisierung (Krümmungsschranke) + CDT je Fläche im Parametergebiet mit exaktem orient2d; wasserdicht per Konstruktion; Statement deckt Kanten- und Flächeninneres | TE1 |
| STEP | Pcurves aus Bend | STEP-Writer aus Rust-Körpern mit analytischen Flächen und Pcurves | ST1 |
| Transform, Muster | Host plus analytic/identity.transform | starre Transformation mit Rahmen-ID (trägt E4-Beweise über Kopien) | TR1 |
| Abfragen | face-classification mit F32x2-Guards, qCoincidesWithPlane verliert bei 1e10 | exakte Prädikate, binary64-Transport | QU1, QU2 |
| Identität | Bend-Schlüssel, 2 s Kernzeit in `boolean_result` | Schlüssel aus Herkunft der Fragmente; ein zusammengeführtes Gesicht trägt alle Quell-IDs | ID1 |
| Fillet, Fase | Entwurf A in Bend (F32x2, Rahmenverschiebung gegen Rundung) | Entwurf A direkt in Rust: Leiter, Eckennetz, Chirurgie mit Kerbe; Randentscheidungen über N1/N2 statt `fillet/exact.bend`; keine Rahmenverschiebung nötig | BL1 bis BL5 |

## 5. Validierung je Op-Familie

Orakel und was sie beweisen:
- **Onshape-Referenzen** (G0, G2): Endergebnis je Teil (Volumen im Intervall, BBox, Hausdorff). Beweist Geometrie, nicht Topologie.
- **OCCT** (O1, nur exportierte Artefakte): STEP-Gültigkeit (BRepCheck, CurveOnSurface), unabhängiges Volumen, Punkt-in-
  Körper, Boolean-Referenzvolumen auf exportierten Operanden.
- **Metamorph** (W0-META, ersetzt MT1): Gesetze, die jede korrekte Implementierung erfüllt (starre Bewegungen inkl. der vier
  Adversarial-Transforms, Skalierung mit 2^k bitgenau, Operandentausch, V(A∪B)+V(A∩B)=V(A)+V(B), V(A−B)=V(A)−V(A∩B)).
  Notwendig, nicht hinreichend.
- **Exakte Zertifikate** (EX1, Python; W0-ORACLE als Rust-Testorakel): jede protokollierte Entscheidung stimmt mit Rationalzahlen überein.
- **Geschlossene Formen**: Volumen und Kurven einfacher Körper (z. B. P01 = 5170,306470775328 mm³).
- **R20-Module**: das Ziel selbst.
- **Bend** (XD1): billiger Gegencheck; ein Unterschied ist ein Hinweis, das Urteil fällt einer der project-component-95f8a74b oben.

| Familie | Primär | Sekundär | Metamorph | Zertifikat | Bend-Gegencheck, erwartete Unterschiede |
|---|---|---|---|---|---|
| Prädikate, N1, N2 | Rationalzahlen (1e6 zufällig, 1e5 beinahe degeneriert) | – | Skalierung 2^k, Vorzeichenspiegelung | ja | Bend lehnt außerhalb des F32-Fensters ab |
| Skizze | geschlossene Flächen, exakte Referenzanordnung (klein) | Onshape datums | Drehung 90°, 2^k, Entity-Reihenfolge | ja | D03 und >256 Entities baut Rust, Bend lehnt ab |
| Extrusion, Revolve | geschlossene Volumina | OCCT, Onshape | starre Bewegung | ja | Rust legt nur bewiesen kollineare Kanten zusammen |
| SSI | geschlossene Kurven, Punkte auf beiden Trägern (Ball-Residuum); allgemein: **vollständige Abdeckung** des Parametergebiets (Zellliste), Komponentenzahl gegen Resultanten-/Zellzerlegung, **Hausdorff-Beweis** der Röhre (nicht Residuum), Röhren disjunkt; negative Fälle verlorene Mini-Schleife, falscher Zweig am Ereignis, Röhrenschnitt unter Budget, zweiter Boolean auf dem Ergebnis | OCCT-Kurvenpunkte, OCCT-Volumen nach SI5 | starre Bewegung | ja | BRIDGE: Hyperbel statt Netz |
| Boolean | OCCT-Boolean-Volumen auf exportierten Operanden, Onshape-Teile | BO1 auf planaren Eingaben | alle Gesetze oben | ja (Stichprobe) | weniger Flächen (Zusammenführen); r50-Stadion echte Lücke statt Kontakt; feed 344 baut; 13 Mesh-Teile werden exakt oder Spurkurve |
| Punkt-in-Körper | OCCT BRepClass3d, geschlossene Körper | – | starre Bewegung | ja | – |
| Volumen | geschlossene Formen, Onshape-Intervalle, Höchstbreite der Einschließung | OCCT | Invarianz, 8^k bei 2^k | bewiesene Einschließung (VA1) | Bend-Schranke ist nur Schätzung; kein 1e19-NaN |
| Tessellierung | Onshape-Hausdorff, Wasserdichtheit, Statement | – | starre Bewegung | – | X06 wasserdicht statt 168 falscher Kanten |
| STEP | OCCT gültig, CurveOnSurface | OCCT-Volumen = VO1 | – | – | – |
| Abfragen | exakte Prädikate, Auswahl der R20-Stellen | – | starre Bewegung | ja | qCoincidesWithPlane bei 1e10 richtig |
| Identität | Abfrageergebnisse der R20-Module (gleiche Kanten ausgewählt) | Bend-Schlüssel auf Bend-Körpern | – | – | Schlüssel zusammengeführter Flächen tragen mehrere Quellen |
| Fillet, Fase | geschlossene Formen (Katalog), Onshape FP01 bis FP22, G2; Blend→Boolean und Boolean→Blend (BB1) | OCCT-Replays, C-tori | starre Bewegung, Kantenreihenfolge | ja | tray-Überlauf (Bend lehnt ab), Fragment-Lesen entfällt |

## 6. Fillet- und Blend-Plan

Zähleinheit ist der **dynamische Aufruf** (Feature-ID plus konkreter Eingangskörper), nicht die statische Stelle: 16
statische Stellen, nach Default-Aufrufstruktur 19 Aufrufe, sofern alle erreicht werden.

1. **BL0 zuerst (jetzt, Bend JS):** jeden erreichten Aufruf der 5 Module erfassen: Fillet-Job-Text, Kantenkonfiguration
   (Trägerpaar, Konvexität, Winkel, Klasse aus `docs/fillet-plan.md` §2), Eckentypen, ob die Stützflächen exakt oder Netz
   sind, Bends Ergebnis, ob danach ein Boolean die Blendflächen nutzt. Unerreichte Aufrufe bleiben **offen** mit dem
   Blocker davor; ein offener Aufruf ist kein Umfang für BL5. Interpreter-Stopps nur in Scratch-Kopien überbrücken (als
   Stub markiert). Ausgewählte Jobs werden mit Provenienz nach `fixtures/fillet/r20-sites/` eingefroren.
2. **BL1 bis BL3:** Entwurf A in Rust gegen `fixtures/fillet` (Katalog, Adversarial, FP-Proben), unabhängig von R20-Booleans;
   Algorithmusquellen Bend-A und W0-FILLET, keine Bend-Bänder (LN1). BL3 prüft STEP über ST1/O1.
3. **BL4:** Host-Ops `opFillet`/`opChamfer` auf `rust`; früher Test über `rust-mixed` (Bend-Booleans, Rust-Fillets) an den
   Stellen, die Bend heute baut (edge, cores), gegen G2.
4. **BL0R (Zensus Teil 2):** nach IN1 und nach den Rust-Booleans (BO5) die offenen Aufrufe auf `rust-mixed` erreichen, je
   Aufruf mit konkretem Eingangskörper einfrieren und BL5 in konkrete, je eine Sitzung große Pakete zerlegen.
5. **BL5:** Platzhalter; startet nie als ein Paket, sondern als die BL0R-Teilpakete. Vermutete Kandidaten: tray-Überlauf,
   return-Übergänge (junction, seam, root) auf gekrümmten Flächen, Fillets an Kanten mit Spurkurven.
6. **BB1:** Blend→Boolean (Booleans mit Blendflächen als Operanden) und Boolean→Blend (Blends auf zusammengeführten
   Boolean-Ergebnissen) ausdrücklich; isolierte Blend-Jobs decken das nicht ab.
7. **MB1:** 5 Blend-Module rein auf `rust` gegen G2.

Bedingung aus E4: Liegt an einer Blend-Kante eine echte Lücke unter Onshapes Auflösung (tray-Bögen 1e-7 bis 8e-4 mm,
`local design note`), baut Rust die Mikrokante mit; kann der Fillet darüber nicht exakt entscheiden, lehnt er benannt ab.
Das ist Risiko R2.

## 7. G2: Blend-Referenzen aus Onshape (E3)

**Ablauf.** W0-G2 (development evidence kept locally) baut den fail-closed Runner-Haken; Befund dort: `withBlends` ist ein
Feature-Parameter, keine Part-Studio-Konfiguration. G2S (Builder, ohne Netz) baut die Sicherung; G2B führt nur der
maintainer aus (die R20-Werkzeuge sind „Lead only“, Schreibsperre). G2S ändert die R20-Werkzeuge nicht, sondern hüllt
sie in einen Wrapper in wonky.
1. Sperre: eine gemeinsame Sperrdatei für Setzen, Lesen und Restore; ohne Sperre kein Aufruf.
2. Vorbedingung auf den **tatsächlich erzeugten** Payloads: `build_fs.build()` mit den aktuellen Parametern und Quellen
   plus den `--set`-Werten erzeugen und je Studio gegen G0 prüfen (`SHA256SUMS`, `params_sha` = `dd606d1107e3daae`, bis
   auf den `withBlends`-Default). Die Prüfung alter `build/studios`-Dateien genügt nicht, denn der Sync lädt sie nicht.
3. `/_bridge/health`, `sessioninfo`, Metering-Zähler notieren, `/_bridge/limits`; Live-Drift-Prüfung (Studio-normSha gleich
   G0); bei Drift **Abbruch**, nie Überschreiben (der Sync würde überschreiben, `onshape_sync.py:794–803`).
4. Journal des Ausgangszustands (Studio-Texte, Feature-Parameter, Microversion) vor dem ersten Schreiben.
5. `onshape_sync.py --set {tray,edge,return,cores,feed}.withBlends=true`, Feature-Status je Modul prüfen.
6. `onshape_volumes.py` (Blend-Volumina aller Teile), `tessellate.py --out-dir <tmp>` (Blend-STLs); die Evidenz wird an die
   unveränderliche Geometrie-Microversion gebunden.
7. Zurücksetzen aus dem Journal, idempotent, auch nach Teilfehler oder Absturz; Nachweis über Studio-SHAs und Feature-
   Parameter gleich Ausgangszustand **und** die 33 G0-Volumina exakt. Ein Volumen-Rollback allein beweist keine identische
   Geometrie.
8. Einfrieren nach `fixtures/r20-modules-blends/` (15 Teile, Volumina, STLs, Manifest, Stempel `live=withBlends:true`,
   Microversions, Metering vorher/nachher); Bend-JS-Baseline mit `--blends`.

**Budget** (Kappen aus `onshape-bridge`: GET features ~100/Tag, FS-Eval 100, Writes 3000, Reads 3000, parts 500):

| Topf | geplant | Reserve | Abbruch, wenn Rest unter |
|---|---:|---:|---:|
| GET features | 0 | 5 (nur `--reconcile-features` nach Schreib-Timeout) | 30 |
| FS-Eval | 0 | 5 (nur `--diagnose` bei Feature-Fehler) | 30 |
| Writes (Feature-Update) | 10 (5 setzen, 5 zurück) | 10 | 600 |
| Reads (featurestudio, featurespecs, massproperties; dazu je Modul eine Drift-Prüfung vorher und eine Restore-Prüfung nachher) | ≤ 32 | 10 | 600 |
| parts | 4 | 4 | 100 |
| tessellation, elements | je ≤ 2 | 2 | 50 |

Drossel `--min-gap` 0,45 s (nach Limitnähe 2 bis 3 s). Steigt `keyCount`, sofort Stopp. Bleibt ein Modul in Onshape mit
Feature-Fehler, wird das festgehalten; für dessen Teile gibt es dann keine Blend-Referenz (Risiko R5, Rückfrage an Marc).

## 8. Erwartete Unterschiede zu Bend (geschlossene Liste)

Eintrag nur mit Repro in `fixtures/rust/bend-differences/` und Urteil eines unabhängigen Richters (XD1 lehnt Einträge ohne
Urteil ab). Kopiert Rust eine falsche Bend-Antwort, fällt das Paket.

| Fall | Bend | project-component-95f8a74b | Rust-Soll | Paket |
|---|---|---|---|---|
| r50-Stadion-Unions | behauptet Kontakt über echte Lücken 1e-10 bis 1e-8 mm | Rationalzahlen, OCCT | echte Lücke (E4) | BO2, BO4 |
| cores, Vertex bei ~1e19 | F32x2-Überlauf zu NaN | Onshape cores | f64 korrekt oder benannt; der Vertex selbst wird erklärt | MG5 |
| qCoincidesWithPlane bei 1e10 | F32x2-Transport verliert Bits | Rationalzahlen | exakt | QU1 |
| feed 344:5, KS04 | Ablehnung an Clearance 0,010001 mm (F32x2-/Netzpolitik) | Onshape RACK/PINION, OCCT | 0,0056 mm ist eine echte Lücke, exakt entschieden | MG6, BO2 |
| F32x2-Grenzen (10-m-Strahlschranke, 1e-12-Guard, 256 Entities) | Ablehnung | Rationalzahlen, geschlossene Formen | annehmen, wo exakt entscheidbar | AR1, BO4 |
| 13 Certified-Mesh-Teile (BRIDGE, T01, Eckfälle) | Netz mit Schranke | Onshape, OCCT | Hyperbel exakt; Quartik als Spurkurve mit ε; Ecken nach E4 | SI1, SI3, BO2 |
| X06-Druckmesh | 168 falsch orientierte Kanten | Onshape-Hausdorff | wasserdicht | TE1 |
| Flächenanzahl nach Boolean | koplanare Fragmente bleiben getrennt | OCCT-Flächenzahl, Volumengleichheit | zusammengeführt | BO1, BO5 |
| Fillet an koplanaren Fragmenten | liest Fragmente als eine Fläche | Katalog | Flächen sind schon zusammengeführt | BL4 |
| tray-Fillet-Überlauf | Ablehnung „overflow … edge 146 limits …“ | Onshape (G2) | Kerbe oder benannt; BL0 klärt, ob Bend hier irrt | BL0, BL5 |

## 9. Pakete und Wellen

Jedes Paket ist eine Builder-Sitzung in eigenem Worktree local development evidence und hat Umfang, positive Abnahme, gepflanztes
Negativ, No-Claim, Abhängigkeiten, Builder, Verifier, RAM-Klasse und Stundenschätzung (vollständig in
`tmp/rust-plan/waves.json`). Builder: `luna` (mechanisch), `sol` (normal), `astra` (schwerer Kern), `deepseek-or` (billig,
nur Nicht-Kern), `opus` (nur G2B, vom maintainer selbst). Verifier: Opus für Kern (Rust, Wire, Host-Dispatch,
Vergleicher), Sonnet für Nicht-Kern. Jedes Paket landet erst nach LAND von Fable und Astra; Builder committen nie.

**Abhängigkeiten** stammen aus Implementierung **und** Abnahme: braucht die Abnahme eines Pakets ein Orakel, einen Korpus
oder einen Exporter, steht dieses Paket in `dependsOn`. Verträge (WC0) sind von Implementierungen getrennt, damit keine
Zyklen entstehen. **Wellen werden berechnet** (Welle = 1 + größte Welle der Abhängigkeiten; G0/P0 = 0, laufende W0-Pakete
= 1) und sind nur Etiketten, **keine Barrieren**: ein Paket startet, sobald seine `dependsOn` gelandet sind. Der Generator
prüft zusätzlich, dass jedes Paket außer FL1, TM1, RT1 und PF1 transitive Voraussetzung von Z1 ist und dass die
verpflichtenden Eingänge (W0-BREP, W0-SKETCH, W0-OCCT, ST1, EX1, XD1, G1H, BO1, O1, W0-META, LN1, G2B, BB1, BL0R, SI5,
VA1, WC0, N3, AR3, TC1) darunter sind.

| Welle | Pakete |
|---|---|
| W0 | W0-G1, W0-ORACLE, W0-GEOM, W0-ALG, W0-FILLET, W0-META, W0-G2, W0-BREP, W0-SKETCH, W0-OCCT (10) |
| W1 | G2S, BL0, IN1, EX1, VA1, LN1, N2, N3 (8) |
| W2 | O1, WC0, AL2, G2B (4) |
| W3 | GE1, BR1, N1, HS1 (4) |
| W4 | XD1, G1H, AR1, SI1, SI2, SI3, TC1, BX1, BO1, BO3, VO1, TE1, ST1, TR1, RV1, QU1, ID1, BL1 (18) |
| W5 | LF1, AR2, SI4, AR3, SK1, SK2, QU2, BL2 (8) |
| W6 | BO2, VO2, BL3, MG1 (4) |
| W7 | BO4, BL4 (2) |
| W8 | SI5, BO5 (2) |
| W9 | MG2, MG3, MG4, MG5, MG6, BL0R, BB1, PF1 (8) |
| W10 | BL5, A1 (2) |
| W11 | MB1 (1) |
| W12 | Z1 (1) |
| W13 | FL1, TM1 (2) |
| W14 | RT1 (1) |

Summe: 75 Pakete; 71 davon bis M-R20B einschließlich Z1 und der 10 laufenden W0-Pakete (ohne FL1, TM1, RT1, PF1). W1 hängt
nur an G0/P0: G2S, BL0, IN1, EX1 jetzt; VA1, LN1, N2, N3 direkt nach P0. WC0 und O1 stehen in W2, weil sie auf W0-BREP
bzw. W0-OCCT aufbauen, statt sie zu doppeln.

### 9.1 Paketübersicht

„h“ ist die geschätzte Wandzeit je Paket (Builder-Sitzung nach RAM-Klasse S 2, M 3, L 4, XL 3, Astra +1; Verify 1; Gate 1),
bei laufenden Paketen die Reststunden.

| ID | Welle | Titel | Abh. | Builder | Verify | RAM | h |
|---|---|---|---|---|---|---|---:|
| W0-G1 | W0 (läuft) | Kernaufruf-Korpus (Bend JS) | P0 | sol | Opus | L | 3 |
| W0-ORACLE | W0 (läuft) | wonky-oracle: exakte Rational-Referenz | P0 | sol | Opus | S | 3 |
| W0-GEOM | W0 (läuft) | wonky-geom Grundtypen, geschlossene Schnitte | P0 | sol | Opus | M | 3 |
| W0-ALG | W0 (läuft) | wonky-alg: exakte univariate Algebra | P0 | astra | Opus | S | 3 |
| W0-FILLET | W0 (läuft) | Fillet-Spike Ebene/Ebene, Ebene/Zylinder | P0 | astra | Opus | M | 3 |
| W0-META | W0 (läuft) | Metamorphe Suite (ersetzt MT1) | P0 | sol | Opus | M | 3 |
| W0-G2 | W0 (läuft) | G2 Blend-Referenzen, Runner-Haken (rust-g2) | P0 | sol | Opus | S | 2 |
| W0-BREP | W0 (läuft) | B-rep-Kern mit Konstruktionsherkunft (Entwurf + Prototyp) | P0 | astra | Opus | M | 3 |
| W0-SKETCH | W0 (läuft) | wonky-sketch Profillöser (R20-Skizzen) | P0 | sol | Opus | M | 3 |
| W0-OCCT | W0 (läuft) | OCCT-Orakel-Generator (synthetischer Korpus) | P0 | sol | Opus | M | 3 |
| G2S | W1 | G2-Sicherung: erzeugte Payloads, Drift-Abbruch, Sperre, Wiederherstellung | – | sol | Sonnet | S | 4 |
| BL0 | W1 | Blend-Zensus R20 auf Bend JS (Teil 1) | – | sol | Sonnet | L | 6 |
| IN1 | W1 | Interpreter: sqrt mit Einheiten, opTransform | – | sol | Sonnet | M | 5 |
| EX1 | W1 | Exakt-project-component-95f8a74b (fractions) | – | deepseek-or | Sonnet | S | 4 |
| VA1 | W1 | Validierte Transzendentale und Quadraturreste | P0 | astra | Opus | S | 5 |
| LN1 | W1 | Band-Lint: keine Bend-Bänder im Rust-Produktionspfad | P0 | luna | Opus | S | 4 |
| N2 | W1 | Prädikate Grad 2 (ein und zwei Radikanden) plus Ausdrucksklassen-Zensus | P0 | astra | Opus | S | 5 |
| N3 | W1 | Vorzeichen mit drei unabhängigen Radikanden | P0 | astra | Opus | S | 5 |
| O1 | W2 | OCCT-Orakel | W0-OCCT | sol | Sonnet | M | 5 |
| WC0 | W2 | Geometrie-/Wire-Vertrag v3 und Konstruktionsherkunft | W0-BREP | astra | Opus | S | 5 |
| AL2 | W2 | Algebraische Punkte und Ereignisse | W0-ALG, N2 | astra | Opus | M | 6 |
| G2B | W2 | Blend-Referenzen holen und einfrieren | W0-G2, G2S | opus | Sonnet | S | 4 |
| GE1 | W3 | wonky-geom an WC0: Kurvenzweige, Bereiche, Herkunft, zertifizierte Residuen | W0-GEOM, W0-ORACLE, WC0, VA1 | sol | Opus | M | 5 |
| BR1 | W3 | wonky-brep: Arena, Audit, Herkunft, Solid-ADT | WC0, W0-BREP | sol | Opus | M | 5 |
| N1 | W3 | Konstruktionszertifikate (E4) auf WC0-Herkunft | WC0 | astra | Opus | S | 5 |
| HS1 | W3 | Host-Naht auf Op-Ebene (Wire v3) | WC0 | sol | Opus | M | 5 |
| XD1 | W4 | Semantischer Bend-Abgleich | HS1 | sol | Opus | M | 5 |
| G1H | W4 | Host-Op-Korpus | HS1, IN1, W0-G1 | sol | Sonnet | L | 6 |
| AR1 | W4 | Ebene Anordnung Strecken + Bögen | GE1, N2 | astra | Opus | M | 6 |
| SI1 | W4 | SSI Ebene x Analytisch | GE1, N1, N2 | astra | Opus | S | 5 |
| SI2 | W4 | SSI Quadrik x Quadrik, Sonderlagen | GE1, N1, N2 | astra | Opus | S | 5 |
| SI3 | W4 | SSI allgemein: vollständige Start- und Ereignisisolation | GE1, N1, AL2, VA1 | astra | Opus | M | 6 |
| TC1 | W4 | Zertifizierte Kurven trimmen und ordnen | GE1, N1, AL2 | astra | Opus | M | 6 |
| BX1 | W4 | Breitphase BVH | GE1, BR1 | luna | Opus | S | 4 |
| BO1 | W4 | Planarer Boolean produktiv (ohne Bend-Bänder) | BR1, LN1 | astra | Opus | M | 6 |
| BO3 | W4 | Punkt-in-Körper exakt | GE1, BR1, N1, N2, O1 | astra | Opus | M | 6 |
| VO1 | W4 | Volumen mit bewiesener Einschliessung | GE1, BR1, VA1 | sol | Opus | S | 4 |
| TE1 | W4 | Wasserdichte Tessellierung + r20-check-Export | GE1, BR1, N2 | astra | Opus | M | 6 |
| ST1 | W4 | STEP-Writer | GE1, BR1, O1 | sol | Opus | M | 5 |
| TR1 | W4 | Transformationen mit Rahmen-ID | GE1, BR1, N1 | luna | Opus | S | 4 |
| RV1 | W4 | Revolve | GE1, BR1, N1 | astra | Opus | M | 6 |
| QU1 | W4 | Abfragen | BR1, N1, HS1 | sol | Opus | M | 5 |
| ID1 | W4 | Identität und Herkunft | BR1, HS1 | sol | Opus | M | 5 |
| BL1 | W4 | Fillet-Leiter | GE1, BR1, N1, N2, N3, LN1, W0-FILLET | astra | Opus | M | 6 |
| LF1 | W5 | Blatt-Einstiege | HS1, XD1 | luna | Opus | S | 4 |
| AR2 | W5 | Anordnung auf gekrümmten Trägern | GE1, N1, N2, TC1 | astra | Opus | M | 6 |
| SI4 | W5 | SSI allgemein: zertifizierte Fortsetzung | SI3 | astra | Opus | M | 6 |
| AR3 | W5 | Allgemeine planare Kurvenanordnung | AR1, TC1 | astra | Opus | M | 6 |
| SK1 | W5 | Skizzenlöser | AR1, HS1, W0-SKETCH | sol | Opus | M | 5 |
| SK2 | W5 | Extrusion | GE1, BR1, ID1 | sol | Opus | M | 5 |
| QU2 | W5 | qContainsPoint und Rest | BO3, QU1 | sol | Opus | S | 4 |
| BL2 | W5 | Fillet-Ecken | BL1 | astra | Opus | M | 6 |
| BO2 | W6 | Boolean: Fragmente (exakte Kurven) | BX1, SI1, SI2, AR1, AR2, AR3, TC1, N1 | astra | Opus | L | 7 |
| VO2 | W6 | Volumen: Spurkurven, importierte Flächen | VO1, SI4 | sol | Opus | S | 4 |
| BL3 | W6 | Fillet-Chirurgie, Kerbe | BL2, AR1, AR2, ST1, O1 | astra | Opus | M | 6 |
| MG1 | W6 | datums auf rust | SK1, SK2, LF1, VO1, TE1, HS1, ID1, ST1, W0-META | sol | Opus | L | 6 |
| BO4 | W7 | Boolean: Klassifikation, Auswahl, Nähen | BO2, BO3, BO1, ST1, O1, W0-META, G1H | astra | Opus | L | 7 |
| BL4 | W7 | Fillet-Integration | BL3, QU1, ID1, HS1, G2B | sol | Opus | M | 5 |
| SI5 | W8 | SSI allgemein: Trim- und Folgeoperations-Integration | SI4, TC1, AR2, AR3, BO4 | astra | Opus | L | 7 |
| BO5 | W8 | Boolean: Zusammenführen, n-är, Herkunft | BO4, ID1 | sol | Opus | M | 5 |
| MG2 | W9 | context auf rust | MG1, BO5, RV1, TR1, SK2, W0-META | sol | Opus | L | 6 |
| MG3 | W9 | probe auf rust | MG1, BO5, VO2, RV1, QU2 | sol | Opus | L | 6 |
| MG4 | W9 | tray, edge, return ohne Blends | MG1, BO5, SI5, VO2, QU2, RV1, TR1 | astra | Opus | L | 7 |
| MG5 | W9 | cores ohne Blends | MG1, BO5, VO2, RV1 | sol | Opus | L | 6 |
| MG6 | W9 | feed ohne Blends | MG1, BO5, IN1, TR1, VO2 | astra | Opus | L | 7 |
| BL0R | W9 | Blend-Zensus Teil 2: vollständig nach IN1 und Rust-Booleans | BL0, IN1, BO5, BL4 | sol | Opus | L | 6 |
| BB1 | W9 | Blend und Boolean in Folge | BL4, BO5 | astra | Opus | L | 7 |
| PF1 | W9 | SIMD/NEON-Auswertung der Hot Loops (Marcs Wunsch) | MG1, BO5 | sol | Opus | M | 5 |
| BL5 | W10 | R20-Blend-Erweiterungen (Platzhalter, wird aus BL0R geteilt) | BL0R | astra | Opus | M | 8 |
| A1 | W10 | 17-Fall-Abnahme auf rust | MG4, BL4 | sol | Sonnet | L | 6 |
| MB1 | W11 | Blend-Module auf rust | MG4, MG5, MG6, BL5, G2B, BB1 | astra | Opus | L | 7 |
| Z1 | W12 | Voll-Gate M-R20B | MB1, A1, MG1, MG2, MG3, W0-META, O1, ST1, EX1, XD1, G1H, BO1, LN1, BB1 | sol | Opus, dann Fable + Astra | XL | 5 |
| FL1 | W13 | Übrige Fast-Lane-Einstiege | Z1 | sol | Opus | M | 5 |
| TM1 | W13 | Test-Migration und E7-Property-Tests | Z1 | deepseek-or | Sonnet | M | 5 |
| RT1 | W14 | Bend-Ruhestand | FL1, TM1 | sol | Sonnet, dann Fable + Astra | M | 5 |

### 9.2 Kritischer Pfad

Berechnet über Stunden (Build + Verify + Gate), nicht über Knotenzahl:

```
W0-BREP → WC0 → GE1 → TC1 → AR2 → BO2 → BO4 → BO5 → BL0R → BL5 → MB1 → Z1
```

70 Stunden bei unbegrenzten Ressourcen; 86 Stunden in der Listen-Simulation mit den Grenzen aus 9.3 (6 Slots, höchstens 2 L,
1 XL ohne L), Spitze 6 gleichzeitig. Gleich lang bis TC1: P0 → N2 → AL2 (AL2 und GE1 enden beide nach 13 h). Beinahe kritisch:
SI3 → SI4 → SI5 → MG4 → MB1 (5 h Puffer). Die Fillet-Kette BL1 → BL2 → BL3 → BL4 hat rund 8 h Puffer, weil
BL0R auf BO5 wartet. Die Boolean-Kette trägt das größte Algorithmusrisiko (AL2, TC1, BO2, BO4), BL0R/BL5 das größte
Umfangsrisiko. Alles Schätzungen; nach den ersten 10 gelandeten Paketen gegen gemessene Sitzungen kalibrieren (R12).
Nicht modelliert: Rücksprünge nach Gate-Befunden.

### 9.3 Parallelität

RAM-Klassen (Spitze der Werkzeugprozesse eines Pakets, ohne die Agentensitzung selbst, rund 1 GB):

| Klasse | Spitze | typisch |
|---|---|---|
| S | ≤ 2 GB | `cargo test` einer Crate, Python-project-component-95f8a74b |
| M | ≤ 6 GB | Release-Build des Workspace, Node-Tests `--jobs 2`, OCCT auf Einzelteilen |
| L | ≤ 12 GB | Modulläufe (Node-Kappe 8 GB über `NODE_OPTIONS`), `rust-diff` über ein Modul, Korpus-Erfassung |
| XL | ≤ 20 GB | OCCT-Batches, Voll-Gate (8 Module + Abnahme + metamorph) |

**Höchstens 6 gleichzeitige Pakete mit Werkzeuglast**, davon höchstens 2 der Klasse L und höchstens
1 XL (dann kein L daneben). Grenzen der Build-Maschine: 64 GB RAM mit 15 % Reserve, 18 CPU-Kerne (je
Worktree `CARGO_BUILD_JOBS=4`), kein neuer Start bei `thermalpressurelevel` ≥ 2. Jeder Lauf mit Beleg
misst `/usr/bin/time -l`; ein Paket, das seine Klasse überschreitet, wird neu eingestuft.

## 10. Die ersten Pakete (W1)

**Jetzt startbar (unabhängig von P0):** G2S, BL0, IN1, EX1. Sie berühren weder `rust/` noch den P0-Tree.
- BL0 und G2S klären die beiden größten Unbekannten (Blend-Umfang, sichere Blend-Referenzen); G2S ist Voraussetzung für
  jedes Schreiben in G2B.
- IN1 räumt Interpreter-Stopps ab, damit BL0 und G1H weiter kommen (return mit Blends, feed).
- EX1 ist der sprachfremde project-component-95f8a74b für Zertifikate; O1 folgt in W2 auf dem Werkzeug von W0-OCCT.

**Direkt nach P0:** VA1 und N2 zuerst (VA1 trägt GE1, N2 den gleich langen Pfad über AL2), dann N3 und LN1. **WC0**
startet, sobald W0-BREP landet, und liegt auf dem kritischen Pfad; der maintainer zieht es allem anderen vor. Konflikt: alle legen neue Crates oder Module an; `rust/Cargo.toml` führt der maintainer zusammen. N2
übernimmt den Fable-Befund `line_point_side`, falls P0 ihn nicht schließt.

**Laufend (W0), nicht doppelt beauftragen:** W0-G1, W0-ORACLE, W0-GEOM, W0-ALG, W0-FILLET, W0-META, W0-G2 und ab 08:10
W0-BREP, W0-SKETCH, W0-OCCT. Was die nachfolgenden Pakete noch von ihnen verlangen, steht in deren Umfang (WC0 friert den
W0-BREP-Vorschlag ein, BR1 macht den Prototyp produktiv, GE1 passt W0-GEOM an WC0 an, SK1 bindet W0-SKETCH an, O1 baut auf
W0-OCCT, G1H ergänzt W0-G1 um die Host-Op-Ebene, G2S ergänzt W0-G2 um die Sicherung).

**Nach den ersten echten Ops:** PF1 (SIMD/NEON, Marcs Wunsch) startet nach MG1 und BO5, damit es echten Code profiliert;
kein Meilenstein hängt daran.

## 11. Risiken

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| R1 | Der direkte Boolean (BO2, BO4) ist neu und liegt auf dem kritischen Pfad; die Hybrid-Härtungen (F1b, F2, Klammer-Clamp) gelten nicht mehr | kleine Pakete, OCCT-Boolean auf exportierten Operanden, BO1 als unabhängiges planares Orakel, metamorphe Gesetze, 17-Fall-Adversarial-Zeilen, Zertifikate |
| R2 | E4 lässt echte Mikrolücken (tray 1e-7 bis 8e-4 mm) als Mikrokanten stehen; Fillets darüber können benannt ablehnen, R20 mit Blends fällt dann | BL0/BL0R prüfen jede Blend-Kante auf solche Lücken; betroffene Stellen früh an Marc (Konstruktion im R20-Projekt korrigieren oder Stelle als erwartete Ablehnung) |
| R3 | SI3/SI4 können singuläre Tangentialschnitte nicht zertifizieren; Teile, die heute Certified Mesh sind, lehnen ab | Notfallpaket „Netz-Rückfall“ (Corefine + Recover-Idee in Rust, als ausgewiesene Näherung), nur wenn nach MG4 Teile daran scheitern |
| R4 | BL5 größer als eine Sitzung | BL5 ist Platzhalter; BL0R zerlegt es vor dem Start |
| R5 | Onshape baut ein Blend-Modul selbst nicht oder G2-Vorbedingung scheitert (R20-Projekt ist weitergelaufen) | G2S prüft die erzeugten Payloads und den Live-Zustand vorher; Stopp und Rückfrage statt anderer Revision |
| R6 | 17-Fall-Abnahme erwartet bei KS-Fällen den Stopp am ersten Fillet; mit Rust-Fillets bauen sie weiter | A1 ändert die Regel: bauen und Referenz treffen oder benannt stoppen; prüft vorher, ob die KS-Referenzen die Blends enthalten |
| R8 | Parallele Pakete in derselben Crate erzeugen Merge-Konflikte | ein Modulverzeichnis je Paket, Verträge zuerst (WC0), dann Traits (GE1, BR1), gemeinsame Dateien nur durch den maintainer |
| R9 | Gate-Selbstschwächung, falsche Herkunftsangaben, stille Bend-Fallbacks, Build-Key-Löcher (P0-Befunde) | jedes Paket durch Fable + Astra; `--require-no-bend` in jedem Modul-Gate; Build-Key hasht Umgebung; LN1 gegen übernommene Bänder |
| R10 | Identitätsschlüssel ändern sich durch Zusammenführen; FS-Abfragen wählen andere Kanten | ID1 prüft Auswahl an allen R20-Stellen über die ausgewählte Geometrie, nicht über Schlüsseltext |
| R11 | Zensus deckt nur, was Bend erreicht (feed, return mit Blends stoppen früh) | G1H nach IN1; BL0R nach IN1 und BO5 auf `rust-mixed`; unerreichte Aufrufe bleiben sichtbar offen |
| R12 | Aufwand unterschätzt | nach den ersten 10 gelandeten Paketen gegen gemessene Sitzungen kalibrieren und hier nachtragen |
| R13 | E9-Default passt nicht zu Marcs Konstruktionsabsicht (Dezimalliterale statt binary64) | Default bis Marc entscheidet; N1 und WC0 kapseln die Wahl an einer Stelle |
| R14 | AL2/TC1 (allgemeine algebraische Ereignisse, Kurvenordnung) sind neue Mathematik auf dem kritischen Pfad | W0-ALG läuft schon; AL2 mit engem Budget und benannter Ablehnung; sympy-Referenz in jeder Abnahme |

## 12. Entscheidungen

| Nr. | Frage | Stand |
|---|---|---|
| E1 | Blends im Ziel? | **ja** (Marc, 2026-09-26): M-R20B mit `withBlends=true` |
| E2 | Was heißt R20 bestanden? | **8 Module gegen Onshape mit Blends**; 17-Fall-Abnahme und `withBlends=false` als Regression im Voll-Gate |
| E3 | Neue Onshape-Referenzen? | **ja**, Blend-Referenzen über die Bridge, gedrosselt, Budget Abschnitt 7 |
| E4 | Unter Onshapes Auflösung? | **Konstruktion entscheidet**, sonst benannte Ablehnung (3.2) |
| E5 | Host-Regularisierungen? | folgt aus E4: auf `rust` aus; braucht ein Fall sie, benannte Ablehnung (Marc kann widersprechen) |
| E6 | Umschaltung nach M-R20B | **offen.** Empfehlung: R20-Pfad direkt auf `rust`; Fast Lane bis M-Fast auf `rust-mixed` |
| E7 | Bend-Beweise | **Property-Tests gegen exakte Rationalzahlen**, keine formalen Beweise (TM1) |
| E8 | Bessere Algorithmen | **direkt**, je Op mit unabhängiger Validierung (Abschnitte 4, 5) |
| L | Landen | automatisch bei LAND von Fable und Astra; der maintainer committet, Builder nie |
| E9 | Welche Konstruktion ist für E4 maßgeblich? | **Default, Marc bestätigt oder ändert:** die binary64-Werte, die der FS-Interpreter an die Op übergibt; alles Weitere exakt daraus (3.2). Alternative: exakte Dezimal-/Rationalauswertung der Literale |
| E10 | G2-Weg | **offen.** Plan: Feature-Parameter über `onshape_sync --set` unter G2S-Sicherung, danach Restore. W0-G2 war als „neue withBlends-Konfigurationseingabe“ beauftragt; das ist eine bleibende Strukturänderung im R20-Dokument und braucht Marcs Zustimmung |

## 13. Kritik und Entscheidung

Planprüfung vom 2026-09-26 (lokal, lesend). Jede Belegstelle wurde nachgelesen. Punkt 8 kam abgeschnitten an („Der
bestehen…“); entschieden wurde über den lesbaren Teil.

| # | Kritik | Entscheidung | Grund (eine Zeile) | Umsetzung |
|---|---|---|---|---|
| 1 | Wire-/Konstruktionsvertrag fehlt vor GE1/BR1/HS1; Bend-Solid trägt keine Hyperbel, Spurkurve, Herkunft; maßgebliche Konstruktion unentschieden | **angenommen** | `analytic.bend:8–38` bestätigt; ohne Herkunft im Wire gehen N1-Beweise an der nächsten Op verloren | WC0 (Vertrag v3, friert den W0-BREP-Vorschlag ein, Transform-Inzidenz-Repro als Test) vor GE1, BR1, HS1, N1; E9 als Default mit Rückfrage; Bend-Körper Herkunft „keine“ |
| 2 | Keine Anordnung allgemeiner Schnittkurven zwischen SSI und Boolean; N2 deckt drei Radikanden nicht | **angenommen** | AR1 kann nur Strecken/Bögen, SI1 liefert Kegelschnitte; `decide.bend:155` hat drei Radikanden | AL2 (algebraische Punkte/Ereignisse), TC1 (trimmen/ordnen), AR3 (allgemeine planare Anordnung); N2 mit Ausdrucksklassen-Zensus, N3 für drei Radikanden |
| 3 | SI3 muss Vollständigkeit und Topologie beweisen, nicht gute Samples | **angenommen** | kleine Residuen beweisen nahe tangentialer Träger weder Abstand noch Vollständigkeit (`local design note–73,154–160`) | SI3 Ereignisisolation mit vollständiger Abdeckung, SI4 Fortsetzung mit Hausdorff-Beweis, SI5 Trim-/Folgeoperations-Integration mit den vier Negativfällen |
| 4 | DAG falsch: ST1, EX1, XD1, G1, BO1 speisen Z1 nicht; weitere fehlende Kanten; `startsAfter` als Barriere; kritischer Pfad über Knotenzahl | **angenommen** | im alten JSON nachgeprüft: fünf Pakete ohne Verbraucher | Kanten aus Implementierung und Abnahme; Generator prüft Z1-Vorgänger und Zyklen; Wellen berechnet, keine Barrieren; kritischer Pfad über Stunden plus Slot-Simulation. BO2 anders gelöst als vorgeschlagen: BO2 ist auf exakte Kurven begrenzt und lehnt Spurkurven benannt ab, SI5 hängt sie ein (kein optionaler Pfad, kürzerer Pfad) |
| 5 | G2 prüft die falschen Upload-Quellen; Sync überschreibt Drift; Rollback über Volumen beweist nichts | **angenommen** | `onshape_sync.py:794–803,926` und `build_fs.py:276–298` bestätigt | G2S: erzeugte Payloads gegen G0, Drift-Abbruch, Journal, Microversion-Bindung, Restore nach Crash, gemeinsame Sperre; als Wrapper in wonky, weil die R20-Werkzeuge „Lead only“ sind |
| 6 | Blend-Zensus: 16 statt 17 Stellen, Aufrufe statt Stellen, BL5 nicht aus unvollständigem Reach | **angenommen** | `grep -c`: 8 + 8; ARM_L/ARM_R und CORE_L/CORE_R teilen Stellen | BL0 zählt dynamische Aufrufe (19 erwartet), offene bleiben offen; BL0R nach IN1 und BO5; BB1 für Blend↔Boolean; BL5 Platzhalter |
| 7 | Zahlenpolitik braucht validierte Transzendente, bewiesene Quadraturreste, Höchstbreite, getrennte Budgets | **angenommen** | Gauss-Differenz in `volume.bend:705–714` ist Schätzung; `ball.rs` hat keine Transzendenten | VA1 mit `Estimate`/`Enclosure`; Höchstbreiten in VO1; Budgets je Stufe im Wire v3 (3.2) |
| 8 | Konkrete Bend-Bänder aus dem Rust-Produktionspfad entfernen (BO1-Spike, BL1–BL3) | **angenommen** (Text abgeschnitten) | der Spike trägt `Limits::Bend` 1e-13/1e-12 (`planar/num.rs:74–86`) | LN1 mit Sperrliste; BO1 und BL1 bis BL3 hängen an LN1 und müssen es ohne Allowlist bestehen |

## Entscheidungen Marc, Nachtrag 26.09.2026 (vormittags)

- **E9 (Beweisbasis für Tangenz aus der Konstruktion):** Maßgeblich sind die f64-Werte, die der FeatureScript-Interpreter an die Operation übergibt. Beweisen diese Werte eine Tangenz exakt, gilt sie. Eine exakte Dezimalauswertung der Literale findet nicht statt.
- **E10 (Blend-Referenzen):** Das ist erledigt, auf anderem Weg als oben geplant. Marc hat entschieden, im Original-Dokument eine Part-Studio-Konfiguration `withBlends` anzulegen. Der maintainer hat sie am 26.09. zwischen 07:51 und 07:54 angelegt:
  - Wiederherstellungs-Version `onshape-id-13dd344e`;
  - Microversion danach `c501c5ae9c11a4feb10a8a50`;
  - Schreibprotokoll in `tmp/rust-g2-onshape-writes.log`;
  - Übergabe an die CAD-Seite in local development evidence.

  Die Standardkonfiguration ist Byte für Byte gleich G0 (33 STL-Hashes). Die 15 Blend-Teile sind eingefroren. G2S bleibt als Schutz gegen Drift sinnvoll, das Umschalten und Zurücksetzen per Feature-Parameter entfällt dagegen.
- **Verifier:** Ein anderes Codex-Modell als der Builder verifiziert, zum Beispiel baut Sol und Astra prüft. Vor dem Landen prüfen Fable und Astra parallel. Opus kommt nur zum Einsatz, wenn Codex-Prüfer und Builder sich widersprechen. Das ersetzt die Zeile „Opus verifiziert“ in allen Paketen.

## Validierungsregel (26.09.2026, aus dem Fillet-Spike)

Ein Vergleich der Randpunkte gegen eine Referenz, ob OCCT oder Onshape, beweist nicht, dass eine Fläche vollständig ist.

Der Fall: Ein zu früh beschnittener Kreisring bestand 9/9 Rust-Tests, 37/37 OCCT-Fälle und alle 12.006 Randstichproben. Die Randpunkte lagen weiter auf der richtigen Fläche, und das Volumen war unverändert.

Die Regel: Jede Operation, die Flächen beschneidet oder erzeugt, prüft zusätzlich die Vollständigkeit der Domäne:
- die Flächeninhalte je Fläche gegen die Referenz;
- die Gegenkanten und Endpunkte der Domäne;
- das Volumen je Teilkörper.

Ein gepflanztes Negativ, das nur die Domäne verkürzt, muss dabei scheitern.
