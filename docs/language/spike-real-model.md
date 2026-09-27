# Spike: ein echtes Teil als WK/0-Graph, nativ in Bend ausgewertet (run_graph-Gate)

Stand: 2026-09-23, mit Regression reviewn 2 und 3. Apple M5 Pro (18 logische CPUs), macOS arm64, Node v22.23.1, Bend 2.0.25.
Auftrag: [docs/language.md](../language.md) Abschnitt 12. Englische Notizen zum Aufbau: [prototype.md](prototype.md).
Abschnitt 15 beschreibt die acht Defekte der ersten unabhängigen Prüfung, Abschnitt 16 die sechs der zweiten
(Regression review 3) und ihre Behebung.

**Messbedingungen.** Die Maschine war geteilt, in Regression review 3 stark: die 1-Minuten-Load lag bei **20 bis 120**
(Build 14; Workloads 20 bis 35 im letzten Lauf, 58 bis 124 in einem ersten; wiederholte Gate-Matrix 25 bis 40;
Edits 30; Ketten 31 bis 37; laute Fehler, Regression und erste Fehler 55 bis 81; Tests 27 bis 33), gegen 15 bis 24 in
Regression review 2. Jede Zeit in diesem Dokument ist **indikativ**. Exakt sind dagegen Hashes, F32x2-Wörter, Knotenwerte,
Op-Folgen, JSON-Texte und Fehlerspannen. Alle Tabellen sind aus den Rohdaten gerendert:
`node scripts/lang/wk-real-report.mjs` (Ausgabe `out/lang/wk/real/tables.md`, Rohdaten `out/lang/wk/real/*.json`);
Zeilen aus Regression review 2 sind als solche markiert.

## 1. Ergebnis in Kürze

**Behauptung 1 (Treue und Korrektheit): bestätigt, soweit der heutige Kern das Teil bauen kann, jetzt auf der Ebene
des ganzen Modell-JSON.**

- Der Recorder läuft im **unveränderten** Parser und Interpreter (`src/parser.mjs`, `src/interpreter.mjs`; per Test
  geprüft: keine Datei dieses Workflows schreibt oder patcht sie, eine Aufzeichnung lässt die Klasse unverändert. Seit
  06:15 ändert ein anderer Workflow das FS-Frontend im Arbeitsbaum, Abschnitt 16).
- Seine Op-Folge (project-component-a8102813, Name, Zeile, Spalte und neu der SHA-256 des Argument-Snapshots, der zu
  `identity.operation.parameters` wird) ist gleich der des echten JS-Builds: vollständig, wo der heutige Build fertig
  wird, als Präfix, wo er abbricht.
- **Verglichen wird jetzt das ganze Body-JSON** (jedes Feld, Zahlen mit `Object.is`, Schlüsselmengen) und für die
  Ausgaben das ganze exportierte Modell: Körper mit Identity, Construction und `operationHistory`, die
  `operationEvidence` des Modells und die Source-Map. Byte-gleich heißt: gleicher JSON-Text samt Schlüsselreihenfolge.
- **washers** (das eine echte Teil, das heute baut), frame-with-tab, 9 Regressionsprogramme und die Fixtures: das
  native Modell ist **byte-gleich** zum heutigen Build.
- **dual-hardware** baut heute nicht. Knotenweise gegen die heutigen Adapter: **104 von 104 Körperknoten
  byte-gleich**, dazu 10 Count-Checks und 28 Fehlerknoten gleich. Knoten 93 (`model/phaseNut1hole`), der in Regression review 2
  um 2,27·10⁻¹³ mm³ abwich und "markiert" war, ist jetzt byte-gleich.
- **Regression review 3 streicht die Toleranz.** Die Prüfer zeigten, dass die angegebene Toleranz (2,3·10⁻¹³ mm³) nicht hielt
  (bis 0,034 mm³ bei geneigten und großen Platten). PIERCE bekommt jetzt die binary64-Eingänge des heutigen Adapters
  vom Host (Abschnitt 2); 100 der 105 Prüffälle der zweiten Runde liefern das heutige Modell oder den heutigen ersten
  Fehler exakt, 2 denselben Parse-Fehler, 3 sind die spezifizierten lauten Lücken (Abschnitt 16).
- **Korrektur der ersten Fassung:** "113 bitgleich, 8 der 9 PIERCE-Ziele bitgleich, 1 Abweichung" war zu stark. Der
  Vergleich hashte nur B-rep-Felder. `construction.depthMm` wich auf 5 PIERCE-Knoten ab, `radiusMm`, `admission`,
  `subdivision` und jede `operationHistory` fehlten. Das ist behoben (Abschnitt 15).

**Behauptung 2 (Fork-Join ≥ 1,2x, kostengewichtet): auf dem Gate-Workload widerlegt.**

- washers: Gate-Quote **0,82**; in **0 von 10** wiederholten Läufen erreicht (0,55 bis 1,01; Regression review 2: 0,90, 0 von 10).
- Die Gate-Quote ist jetzt die kleinere von Median- und Mittelwert-Quote, und ein Bestehen muss in jedem der
  10 Läufe halten (Abschnitt 6).
- Unter den Teilgraphen echter Mehrteil-Modelle besteht **nur dual-hardware robust**, auch in der gestuften Form, die
  Regression review 3 braucht (2 Stufen): **2,22**, in 10 von 10 Läufen (1,63 bis 2,35). mounting-r26 (2 Stufen) und
  direct-mount-r26 bestehen in keinem der 10 Läufe (0,73 bis 1,16 bzw. 0,90 bis 1,17). Die 1,24 und 1,37 der ersten
  Fassung waren Mediane über einem Fork@4 mit schwerem Ausläufer und bleiben zurückgenommen.
- Wo das Bestehen hält, spart es etwa 2 ms pro Build.

**Entscheidung nach der Regel aus Abschnitt 11/12: kein `run_graph`.** Die Regression reviewn 2 und 3 ändern daran nichts.
Regression review 3 fügt eine Bedingung hinzu: ein Graph mit PIERCE-Knoten ist nicht ein nativer Aufruf, sondern einer je
PIERCE-Tiefe, solange der Kern die PIERCE-Eingänge nicht selbst berechnet (Abschnitt 12).

**Zwei Befunde wiegen schwerer als die Ausführungsform:**

- **Kernfähigkeiten.** Von den 4 benannten Kandidaten und der Kontrolle baut keiner auf dem heutigen JS-Pfad; von 30
  geprüften Features baut genau eines (washers). Blocker: PIERCE-Zulassung, Booleans ohne passende Methode (NONE),
  `opTransform` fehlt in der FS-Bibliothek.
- **Identity- und Evidence-Labels wachsen etwa kubisch mit der Länge einer Kette abhängiger Booleans** (Abschnitt 13).
  Eine Platte mit 20 Löchern, je ein `opBoolean`, kann der heutige Build nicht mehr exportieren (V8-Stringgrenze), bei
  30 stürzt er ab (Heap). Der WK-Pfad bildet die Labels exakt nach, solange sie passen, und bricht danach mit einem
  expliziten Capability-Fehler ab. Die Ursache liegt im Produktivcode (`kernel/identity.bend` verschachtelt
  Instance-IDs, `src/construction-history.mjs` verschachtelt Historien), nicht im Graph-Pfad.

## 2. Was gebaut wurde

| Datei | Rolle |
|---|---|
| `src/lang/wk/record-fs.mjs` | Recorder: unveränderter Interpreter, nur die kernrufenden Builtins getauscht (wie `src/lang/dataflow/fs-trace.mjs`). Emittiert `extrude_polygon` (beliebige Ebene), Kreis-Extrude und Kreis-Loft als `frustum`, `transform` (opPattern), `boolean{kind, method, components}` und `expect_count`. Methode nach den Prädikaten von `src/boolean.mjs`. Kernel-Ops in `try`. Neu: Name und Appearance so, wie der Produktions-Body sie hielt, als die Op lief (`attrs.props`) |
| `src/lang/wk/real-host.mjs` | Encoder (versiegelter Stream, Level für Level, `real()`-Vorprüfung), Prozessstart, strikter Ausgabe-Parser, Decoder zu heutigem Body-JSON inklusive planarer Provenienz und vollständiger PIERCE-Construction, Identity- und Evidence-Replay über die heutigen Einstiege (`release`, Heap-Wächter), Präzisionsvertrag, Geom- und Full-Hash |
| `src/lang/wk/real-run.mjs` | Ablauf, Materialisierung (Host-Decode-Fehler als Knotenwerte), `assembleModel`, `modelJson`, Vergleich des ganzen JSON (`deepDiff`, `compareLists`, `compareModels`), `gateRatios`, Kostengewichtung, erster Fehler inklusive Recorder-Stopp (`firstErrorOverall`), Host-Cache |
| `src/lang/wk/real-oracle.mjs` | Orakel: die heutigen Adapter knotenweise auf dem Graphen, Fehler als Werte |
| `kernel/lang/wk/real.bend` | Nativer Auswerter: strikte Stream-Dekodierung mit Siegel, die sechs Ops, planare Provenienz in der Ausgabe, exakte binary64-Vergleiche, ±Unendlich/NaN-Wörter |
| `kernel/lang/wk/main.bend` | Einstieg. Modi `fork`, `seq`, `serial`; der Session-Modus (ein Argument) ist seit Regression review 3 versiegelt und wird vor jeder Auswertung streng geprüft. Ein fehlerhafter Stream endet mit Exit 3, ein ungültiges `reps` mit Exit 2 |
| `kernel/lang/wk/now_us.c`, `now_us.js` | µs-Uhr als Foreign-Effekt |
| `kernel/lang/wk/cases/*.fs` | Fälle: `curved-intersection`, `split-count`; neu `pierce`, `planar-small`, `query-reference`, `masked-error`, `far-pattern`; Regression review 3: `round3` (12 Features aus den Reproduktionen der Prüfer) |
| `scripts/lang/wk-real-select.mjs` | Schritt 0: Auswahl mit Einstiegszählung |
| `scripts/lang/wk-real.mjs` | Messung: Phasen `workloads`, `edits`, `failures`, `partial`, `regression`, `gate` |
| `scripts/lang/wk-real-js.mjs` | heutiger Pfad als eigener Prozess, getrennte Buckets, SHA-256 jedes Argument-Snapshots |
| `scripts/lang/wk-chain.mjs` | Ketten abhängiger Booleans (Platte mit N Löchern), nativ gegen heute |
| `scripts/lang/wk-real-build.mjs` | Auswerter-Build mit Zeit, Peak-RSS und Load |
| `scripts/lang/wk-real-report.mjs` | Tabellen und `summary.json` |
| `test/lang-wk-real.test.mjs` | 24 fokussierte Tests (8 ursprüngliche, 11 aus Regression review 2, 5 aus Regression review 3) |

**Kernel-Ops in `try` (Regression review 3).** Kernel-Ops in einem `try` werden spekulativ aufgezeichnet. Ist der erste
fehlschlagende Knoten einer Auswertung ein fangbarer Fehler (Code 2) in einem `try`, **wiederholt** `evaluate` die
Aufzeichnung: der Kernaufruf mit dieser Versuchsnummer wirft genau das Fehlerobjekt des heutigen Builds (Meldung und
Ort wie heute), und der unveränderte Interpreter führt den echten Handler aus. Das Dekorations-Idiom meldet so die
heutige dekorierte Meldung am heutigen Ort, `try silent` läuft weiter, ein Ersatz-Handler baut etwas anderes.
Unveränderte Knotenwerte werden über den Geom-Hash wiederverwendet. Nicht wiederholt werden native
Residual-Fehler, deren Text nicht die heutige Meldung je Ecke ist (dann bleibt ein expliziter, verorteter Fehler).

**Was der Recorder nicht verändern darf.** Die Engine ist der `owner` jeder `evaluateQuery`-Referenz, und der
Source-Map-Snapshot der Argumente einer Op läuft über sie in `identity.operation.parameters`. Deshalb ist der
`body`-Override nicht aufzählbar, der Prototyp eines Handles hat `constructor = Object`, und die Engine hält pro
Boolean einen **Zähl-Platzhalter** in `operationEvidence`, weil der Snapshot einen gekürzten Eintrag je Element
auflistet. Die Platzhalter werden nie ausgegeben: `assembleModel` liefert die Evidence aus dem Host-Replay.

**PIERCE und Host-binary64 (Regression review 3).** Der heutige Adapter rechnet drei Eingänge in binary64 auf dem Host aus
den dekodierten Operanden: die Werkzeugachse (`Math.hypot`, Divisionen), die Reichweite des Werkzeugs entlang der
Achse und das Zielvolumen `real(a.validation.volumeMm3)` (bei einem polyedrischen Ziel ein `validateSolid`-Integral).
Regression review 2 bildete sie in F32x2 nach und markierte sie; die Prüfer zeigten Abweichungen bis 0,034 mm³. Jetzt
leitet der Auswerter keinen davon her: der Host rechnet sie mit dem heutigen Code (`pierceInputs`) auf den Operanden,
die die heutigen Decoder geliefert haben, und schickt die `real()`-Wörter mit dem Knoten. Ein PIERCE-Knoten läuft
deshalb eine **Stufe** nach seinen Operanden (`evaluateStages`); jede Stufe ist hier ein Prozess, mit der
In-Process-Bindung wäre sie ein Aufruf. Flags und Toleranz entfallen: das Ergebnis ist exakt per Konstruktion.

**Exakte binary64-Vergleiche (Regression review 3).** Wo der heutige Host `number(x)` (binary64) mit einer Konstanten oder
einer anderen Zahl vergleicht, wertet der Auswerter genau diesen Vergleich exakt aus (`v64`: binary64-Wert per
Two-Sum und `rt`; `sign_c` / `sign_v`: exaktes Vorzeichen einer F32-Expansion nach Shewchuk), statt F32x2-Paare zu
vergleichen. Die Konstanten reisen als drei F32-Wörter mit exakter Summe. Betroffen: Achsnormalen-Prüfung
(`|dot| < 1 − 1e-6`), Höhen²-Schwelle, Residual-Toleranz, planare Intervalle, Schranken und Volumenvorzeichen.

## 3. Schritt 0: Auswahl

Rohdaten: `out/lang/wk/real/selection.json` (Load 16 bis 19, erste Fassung).

| Rolle | Feature | Schranke | heutiger JS-Pfad | Ops bis Abbruch | Grund (FS-Spanne) |
|---|---|---:|---|---:|---|
| primär | dual-hardware-r25 `dualHardware25` | 21 | Capability | 17 | PIERCE-Zulassung (35:5) |
| Ersatz 1 | interface-r11 `fasteners` | 15,5 | Capability | 17 | keine Boolean-Methode passt (45:6) |
| Ersatz 2 | hopper.fs `hybridHopper` | 10,7 | Capability | 54 | PIERCE-Zulassung (50:5) |
| Ersatz 3 | r21-expanded-hopper `expandedRearHopper21` | 8,5 | Capability | 214 | PIERCE-Zulassung (50:5) |
| Kontrolle | central-drive-r27 `centralShafts26` | 2 | Capability | 0 | `opTransform` nicht implementiert (283:1) |

- Keiner der benannten Kandidaten baut; die Regel greift auf die 25 übrigen Korpus-Features zurück, deren Graph nur
  das Spike-Op-Set nutzt.
- **Es baut genau eines: `top-clamp-washers-r29.fs` `topClampWashersR29`** (vier M5-Scheiben, 4 COAXIAL-Subtraktionen,
  Schranke 4). Das ist der Gate-Workload.
- Zusätzlich knotenweise gegen das Orakel gemessen: dual-hardware, mounting-r26 und direct-mount-r26.

## 4. Treue des Recorders und erster Fehler

| Workload | Knoten | schwer / Span | Op-Count-Schranke | Methoden | Aufzeichnen | Op-Folge (Recorder / heute, gleiches Präfix) |
|---|---:|---:|---:|---|---:|---|
| washers | 12 | 4 / 1 | 4 | COAXIAL 4 | 3,8 ms | 76 / 76, 76 (vollständig) |
| dual-hardware | 142 | 42 / 2 | 21 | COAXIAL 16, PIERCE 15, NONE 11 | 16,0 ms | 544 / 17, 17 (Präfix) |
| mounting-r26 | 30 | 10 / 2 | 5 | COAXIAL 6, NONE 2, PIERCE 2 | 4,6 ms | 116 / 17, 17 (Präfix) |
| direct-mount-r26 | 36 | 12 / 2 | 6 | COAXIAL 8, NONE 4 | 2,8 ms | 128 / 17, 17 (Präfix) |
| frame-with-tab | 5 | 2 / 2 | 1 | PLANAR 2 | 0,6 ms | 5 / 5, 5 (vollständig) |

- **Ein Graph ohne Break für jeden Workload.** Die vorhergesagten Methoden prüft der Auswerter an den echten
  Operanden nach; einen Widerspruch gab es nicht.
- **Count-Spekulation.** dual-hardware hat 21 `expect_count`-Knoten; 10 halten, 11 tragen einen vorgelagerten Fehler.
- **Erster Fehler (neu, Defekt 6).** Der Teilgraph wird auch ausgewertet, wenn der Recorder anhält. Sein erster
  nativer Fehler liegt in einem sequentiellen FS-Lauf vor dem Stopp des Recorders. Über alle 30 Kandidaten aus
  Schritt 0 (`out/lang/wk/real/partial.json`): **30 von 30 melden den ersten Fehler des heutigen Builds** (Spanne und
  Meldung). Bei 14 hätte vorher der spätere Recorder-Stopp dagestanden, etwa interface-r11: Recorder hält bei 53:2
  (`opTransform`), erster Fehler 45:6 (keine Boolean-Methode), wie heute.
- **Fehler um den Kernaufruf herum (neu).** Heute weisen die Adapter manche Ergebnisse auf dem Host ab
  (`validateSolid`: Koordinatenhülle, kollabierte Kanten) und manche Eingänge vor dem Kern (`real()`: Betrag
  ≤ 1e20). Der WK-Pfad meldet jetzt denselben Fehler, an der Spanne der Op (heute ohne Spanne).

## 5. Korrektheit

### 5.1 Ausgaben gegen den heutigen Build (ganzes Modell)

| Workload | Ausgaben | Ergebnis |
|---|---:|---|
| washers | 4 | **byte-gleich**: Körper (inklusive Identity, Construction, `operationHistory`), `operationEvidence`, Source-Map |
| frame-with-tab | 1 | **byte-gleich**; Volumen 13840.000000000002 mm³ und 64 Flächen wie die direkten Kernaufrufe |
| 9 Regressionsprogramme | 1 bis 4 | byte-gleich (Abschnitt 10) |
| Fixtures `pierce` (achsparallel; geneigt entlang (0, 0,6, 0,8)), `planar-small`, `query-reference` (2 Features), Platte mit 5 Löchern | 1 bis 2 | byte-gleich (Tests) |

### 5.2 Jeder Knoten gegen die heutigen Adapter (Orakel, JS-Target)

| Workload | Körperknoten byte-gleich | Count-Checks | Fehlerknoten gleich | Abweichungen | PIERCE Achse exakt / Volumen exakt |
|---|---:|---:|---:|---|---|
| washers | 12 | 0 | 0 | – | – |
| dual-hardware | 103 von 104 | 10 | 28 | Knoten 93: `validation.volumeMm3`, Δ = −2,27·10⁻¹³ mm³ | 9 / 0 von 9 |
| mounting-r26 | 26 | 2 | 2 | – | 2 / 0 von 2 |
| direct-mount-r26 | 28 | 4 | 4 | – | – |
| frame-with-tab | 5 | 0 | 0 | – | – |

### 5.3 Die eine Abweichung und die Toleranz

- **Wo:** dual-hardware Knoten 93, `model/phaseNut1hole`, PIERCE auf einer polyedrischen Sechskantmutter.
- **Was abweicht:** nur das gespeicherte Volumen, um **2,27·10⁻¹³ mm³**. Construction (inklusive `depthMm`,
  `radiusMm`, `admission`, `subdivision`), Evidence, Identity und Geometrie sind gleich.
- **Ursache:** Der heutige Adapter übergibt `real(a.validation.volumeMm3)` an `pierce.pierced_volume`; bei einem
  polyedrischen Ziel ist das ein binary64-Integral auf dem Host. Nativ gibt es kein F64; der Auswerter nimmt das
  F32x2-Volumen aus `solid-intersection.planar_measures`. Bei den übrigen 8 (und den 2 von mounting) stimmt es
  trotzdem überein; alle 11 tragen `volumeExact = false`.
- **Toleranz:** Ein markiertes PIERCE-Ergebnis darf in `validation.volumeMm3` abweichen (bei nicht achsparallelem
  Werkzeug auch in `construction.depthMm` und Geometrie), gemessen |ΔV| ≤ 2,3·10⁻¹³ mm³. Unmarkierte Ergebnisse
  müssen byte-gleich sein.
- **Achse:** Die Abweichung von `depthMm` aus der ersten Fassung (−1,78·10⁻¹⁵ auf 5 Knoten) ist verschwunden, weil
  die Achse achsparalleler Werkzeuge jetzt exakt ist.

### 5.4 Determinismus

Die Knotenausgaben sind identisch über die Modi `fork`, `seq` und `serial`, 1, 2 und 4 Threads, je 3 Prozesse und 1
bis 50 Wiederholungen: 22 Läufe je Workload, verglichen als SHA-256 über alle `N`-Zeilen.

## 6. Speed-Gate

### 6.1 Native Auswertung

Warm = Median der Wiederholungen 2..R in einem Prozess, Median über 3 Prozesse. Werte in ms. Load 14 bis 19.

| Workload | Wdh. | seq@1 | seq@2 | seq@4 | fork@1 | fork@2 | fork@4 |
|---|---:|---:|---:|---:|---:|---:|---:|
| washers | 50 | 0,195 | 0,197 | 0,197 | 0,196 | 0,223 | 0,216 |
| dual-hardware | 20 | 4,080 | 4,609 | 4,940 | 3,983 | 2,611 | **1,616** |
| mounting-r26 | 20 | 0,899 | 1,062 | 1,106 | 0,888 | 0,714 | 0,619 |
| direct-mount-r26 | 20 | 0,532 | 0,772 | 0,834 | 0,531 | 0,482 | 0,412 |
| frame-with-tab | 1 | 1582 | 1148 | 1048 | 1567 | 1004 | 1042 |

### 6.2 Gate

**Statistik (neu, Defekt 3).** Je Konfiguration zwei Statistiken der warmen Wiederholungen: der Median über Prozesse
der Median-Werte je Prozess, und der Mittelwert über alle warmen Wiederholungen. Für jede: W_best = bester serieller
Lauf über 1, 2 und 4 Threads, T4 = fork@4. **Die Gate-Quote ist die kleinere der beiden W_best/T4.** Zusätzlich wird die
ganze Matrix zehnmal wiederholt (`--phases gate`); robust besteht nur, was in jedem Lauf ≥ 1,2 bleibt.

| Workload | W_best/T4 Median | W_best/T4 Mittel | **Gate-Quote** | wiederholte Läufe bestanden (Min bis Max) | robust | Kostenschranke | Op-Count-Schranke | serielle Arbeit |
|---|---:|---:|---:|---|---|---:|---:|---:|
| **washers (Gate)** | 0,90 | 0,92 | **0,90** | 0 von 10 (0,61 bis 0,87) | verworfen | 4,85 | 4,00 | 0,19 ms |
| dual-hardware (Teilgraph) | 2,52 | 2,51 | **2,51** | 10 von 10 (1,99 bis 2,64) | **ja** | 15,58 | 21,00 | 4,19 ms |
| mounting-r26 (Teilgraph) | 1,45 | 1,28 | **1,28** | 8 von 10 (1,01 bis 1,51) | nein | 3,47 | 5,00 | 0,86 ms |
| direct-mount-r26 (Teilgraph) | 1,29 | 1,28 | **1,28** | 7 von 10 (1,01 bis 1,43) | nein | 7,33 | 6,00 | 0,54 ms |
| frame-with-tab (Kette) | 1,01 | 1,00 | **1,00** | – | verworfen | 1,00 | 1,00 | 1615 ms |

**Lesart.**

- **Die Regel verwirft `run_graph`.** Der Gate-Workload liegt bei 0,90 und besteht in keinem Lauf. Seine 12 Knoten
  kosten zusammen 0,2 ms.
- **Nur dual-hardware besteht robust**, auch im Lauf der Prüfer bei Load 60 bis 117 (1,75 Median, 1,65 Mittel). Die
  Ersparnis ist etwa 2,5 ms pro Build.
- **mounting und direct-mount bestehen nicht robust.** Die Prüfer maßen 1,15 und 1,20 (Median) bzw. aus den Rohdaten
  der ersten Fassung 1,04 und 0,85 (Mittel); hier bestehen sie in 8 bzw. 7 von 10 Läufen, mit Minimum 1,01.
- **Kostengewichtung gegen Op-Count:** Faktor 0,7 bis 1,2, der Auslöser "Faktor > 2" aus language.md §11 greift nicht.
  Die erreichte Beschleunigung bleibt weit darunter (2,5 statt 15,6 bei 4 Threads): Bei Knoten von 10 bis 250 µs
  begrenzt die Übergabe an Pool-Worker, nicht die Graphstruktur.
- **Op-at-a-time nativ** (`WONKY_BACKEND=native`): bei allen vier Zylinderteilen laut abgelehnt (`BX_UNAVAILABLE`
  für `kernel/precise.bend:frame`); frame-with-tab 1664 ms bei 1 Thread, gegen 1042 ms fork@4 und 13,1 s heute.

### 6.3 Kosten pro Knoten (serieller Modus, 1 Thread, Median)

| Op | Knotenkosten |
|---|---:|
| `frustum` | 9 bis 11 µs |
| `extrude_polygon` | 2 bis 7 µs |
| `boolean` COAXIAL | 31 bis 53 µs |
| `boolean` PIERCE | 171 bis 237 µs |
| `boolean` NONE (sofortiger Capability-Fehler) | 1 bis 2 µs |
| `expect_count` | unter 1 µs |
| `boolean` PLANAR (frame-with-tab) | **0,81 s** |

## 7. Buckets: heutiger Pfad gegen nativen Graph-Pfad

Median über 3 Prozesse, in ms. Load 14 bis 19.

| | washers | dual-hardware | frame-with-tab |
|---|---:|---:|---:|
| **heute:** Prozess | 852 | 781 (Abbruch) | 13996 |
| Kern laden | 718 | 681 | 706 |
| Build kalt / warm | 30,7 / 13,3 | 24,8 (bis Op 17) | 13143 |
| davon Kern-Einstiege | 17,9 | 12,3 | 12912 |
| Export | 0,9 | – | 2,8 |
| **nativ:** Aufzeichnen | 3,8 | 16,0 | 0,6 |
| Encode | 0,22 | 1,72 | 0,09 |
| Auswertung fork@4, eine Wiederholung (warm) | 0,22 | 1,62 | 1042 |
| Stream-Decode in Bend | 0,04 | 0,30 | 0,03 |
| Prozessstart + Textausgabe in Bend | 5,0 | 18,6 | 6,3 |
| Parse / Body-Decode (Host) | 2,0 / 1,3 | 11,4 / 7,2 | 4,6 / 2,9 |
| Identity und Evidence kalt / memoisiert | 8,3 / 1,0 | 55,1 / 9,3 | 19,6 / 4,7 |
| Export (Modell-JSON) | 1,6 | 10,2 | 3,4 |

- **washers:** 0,2 ms nativ gegen 18 ms Kern-Einstiege auf dem JS-Target. **Der Kern ist bei diesem Teil nicht der
  Engpass.**
- **dual-hardware:** Identity- und Evidence-Replay (55 ms, jetzt mit `operationHistory`) und die Bend-Textausgabe
  (19 ms) kosten ein Vielfaches der Kernarbeit (4,2 ms). Der Replay wächst überlinear mit der Kettenlänge
  (Abschnitt 13); er ist kein fester Engpass, sondern eine Folge der heutigen Label-Darstellung.
- **frame-with-tab:** Hier zählt nur der Kern: 13,1 s heute gegen 1,04 s nativ.

## 8. Inkrementell: Host-Cache nach echten Edits

- Der Cache ordnet Geom-Hash (Op, vertragsgerundete Argumente, Eingangs-Hashes, **ohne** IDs) dem nativen Knotenwert
  zu, also den rohen Wörtern.
- Ausgewertet werden nur Knoten ohne Treffer; saubere Eingänge schmutziger Knoten reisen als `literal`-Knoten, alle
  anderen sauberen Knoten werden nicht gesendet. **Fehler werden nie gecacht** (ihre Spannen-ID kann veralten).
- Identity und Evidence werden für jeden Knoten neu berechnet; die Identity-Einstiege sind nach dem SHA-256 ihrer
  Argumente memoisiert (IDs eingeschlossen).

| Edit (Zeile:Spalte) | geändert (schwer) | neu ausgewertet / alle | Literale | Auswertung inkrementell, warm (1. Wdh.) | Auswertung kalt, warm (1. Wdh.) | Prozess inkr. / kalt | Identity-Aufrufe inkr. / kalt | gleich kalt | heutiger Build der Edit-Datei |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| dual-hardware 88:116 `27.357265589908167` → `28.7251288694` | 2 (1) | 30 / 142 | 35 | 0,58 ms (0,87) | 1,82 ms (1,89) | 27 / 69 ms | 2 / 104 | 142/142, ja | Capability (wie unediert) |
| washers 70:89 `.6` → `0.63` (Farbe) | 0 (0) | 0 / 12 | 0 | 0 | 0,23 ms (0,50) | 3 / 17 ms | 0 / 12 | 12/12, ja | ganzes Modell byte-gleich |
| washers 49:40 `0` → `0.5` (Kreismitte) | 12 (4) | 12 / 12 | 0 | 0,24 ms (0,52) | 0,23 ms (0,50) | 24 / 18 ms | 12 / 12 | 12/12, ja | ganzes Modell byte-gleich |
| frame-with-tab 14:59 `48` → `47` (Tab) | 2 (1) | 2 / 5 | 1 | 748 ms | 1055 ms | 754 / 1063 ms | 3 / 8 | 5/5, ja | ganzes Modell byte-gleich |

fork@4, n = 3 Prozesse, Load 18 bis 19. Rohdaten `out/lang/wk/real/edits.json`.

- In allen vier Edits ist jeder Knoten und jede Ausgabe identisch zu einem kalten Lauf der editierten Datei, Identity
  eingeschlossen; wo das Teil heute baut, ist das ganze Modell byte-gleich zum heutigen Build der editierten Datei.
- dual-hardware Zeile 88 ändert genau die Mutter-Extrusion und ihr Loch (1 von 42 schweren Knoten); neu ausgewertet
  werden 30, weil 28 Fehlerknoten nicht gecacht werden.

## 9. Laute Fehler

| Fall | Art | FS-Spanne | Meldung |
|---|---|---|---|
| CURVED-Methode (Box ∩ Zylinder; heute gebaut) | Capability | curved-intersection.fs:19:9 | Boolean method CURVED (native Bend curved convex-tool intersection) is not in the WK native evaluator |
| Split in zwei Körper (heute 2 Körper) | Spekulation | split-count.fs:15:9 | count speculation failed: this Boolean produced 2 bodies, the recorded program assumed 1 |
| unbekannte Op (ein `frustum` von washers umbenannt, Op-Code 99) | Capability | top-clamp-washers-r29.fs:50:2 | WK op code 99 is not in the native evaluator (nur diese Scheibe, die anderen 3 bleiben gültig) |
| absichtlich falsche Count-Spekulation (dual-hardware) | Spekulation | dual-hardware-r25.fs:42:14 | count speculation failed: the program observed 2 bodies here; the graph produced 1 |
| fehlerhafte Streams (neu): abgeschnitten, Ziffer verändert, Tiefe ± 1, Tokens übrig, nicht numerisch, zu groß, leer | Stream | – | Exit 3 vor jeder Auswertung, z. B. "the seal does not match (token count or checksum)" |
| fehlende, doppelte oder fremde Ausgabezeilen (neu) | Host | – | `MalformedNativeOutput`, nie "kein Fehler" |

In keinem Fall gibt es ein Ergebnis anstelle des Fehlers und keinen Rückfall. Abhängige Knoten tragen den Fehler mit
der ursprünglichen Spanne weiter.

## 10. Regression

- **frame-with-tab aus FS und aus build123d:** Recorder-Graph, Stager-Graph und build123d-Graph sind nach
  `canonicalize` identisch, Output-Hash `f55dec6f28652498`; der frühere native Auswerter liefert auf dem
  Recorder-Graphen den Hash **3141504600** (Volumenwörter 1180188672/739621607, 64 Flächen).
- **Die 12 Programme der WK-Check-Suite:**

| Programm | Op-Folge gleich | nativ | ganzes Modell gleich |
|---|---|---|---|
| bored-spacer, box, bracket, compare-after, compare-before, conical-spacer, tilted-plate | ja | ok | byte-gleich |
| frame-with-tab, four-pockets | ja | ok | byte-gleich |
| concave-intersection, convex-intersection | ja | Capability PLANAR_INTERSECT an der opBoolean-Spanne | – |
| line-sketch | nein (Recorder stoppt laut an `skSolve`) | – | – |

## 11. Build-Kosten des Auswerters

| Build | Schritt | Wand | Peak-RSS | Load vorher → nachher |
|---|---|---:|---:|---|
| erste Fassung | Bend → C | 25,0 s | 11,04 GB | 58 → 49 |
| | clang -O3 | 22,8 s | 1,49 GB | 49 → 43 |
| Regression review (strikte Dekodierung, Provenienz, exakte Achse) | Bend → C | 22,4 s | 11,44 GB | 17 → 23 |
| | clang -O3 | 21,8 s | 1,48 GB | 23 → 24 |
| Regression review (plus Siegel) | Bend → C | 16,1 s | 6,50 GB | 16 → 16 |
| | clang -O3 | 17,2 s | 1,48 GB | 16 → 15 |

C-Quelle 9,6 MB, Binary 3,2 MB, `bend --check-only` 1,5 s. Jede Auswerter-Änderung kostet 35 bis 60 s und bis zu
11 GB.

## 12. Folgerungen für den Plan in language.md

1. **Kein `run_graph` im Binding (Schritt 6 bleibt gesperrt).** Die Regel verwirft ihn auf dem gewählten echten Teil
   (0,90, 0 von 10 Läufen). Robust besteht nur der Teilgraph von dual-hardware, mit etwa 2,5 ms Gewinn.
   Neu bewerten, wenn ein echtes Teil nativ baut und mindestens 100 ms Kernarbeit über unabhängige Komponenten
   verteilt, etwa mehrere planare Arrangement-Booleans in getrennten Körpern.
2. **Der kritische Pfad für Marcs Zylinderteile ist Kernfähigkeit:** PIERCE-Zulassung für Ziele, die kein planares
   Prisma sind; die NONE-Fälle; `opTransform`; danach `skText` und Line/Arc-Skizzen.
3. **Identity und Evidence brauchen eine inhaltsadressierte Darstellung**, bevor lange Boolean-Ketten (Platten mit
   vielen Löchern) auf irgendeinem Pfad modelliert werden: gehashte Instance-IDs und Evidence, die ihre Eingänge über
   die Revision referenziert, statt Identity und Historie zu verschachteln. Das ist eine Produktionsänderung außerhalb
   dieses Workflows. (Die erste Fassung nannte Identity den "nächsten Engpass"; das unterschätzte ihn, Abschnitt 13.)
4. **Das Binding braucht die Frustum-, Coaxial- und Pierce-Einstiege (Bridge-Schritte 3/4).**
5. **Host-Cache (Schritt 5) funktioniert ohne Bend-Änderung.** Fehler gehören nicht in den Cache.
6. **Recorder statt Stager bestätigt**, jetzt mit Argument-Snapshots im Treue-Vergleich.
7. **Für das Binding:** sequentieller Bend-Code läuft mit 2/4 Threads langsamer als mit 1; die Textausgabe kostet ein
   Vielfaches der Auswertung. Ein Einstieg muss Wörter zurückgeben; ein versiegelter, streng geprüfter Transport ist
   billig (zwei Tokens).
8. **Residual-binary64 ist nicht nur theoretisch.** Der heutige PIERCE-Adapter liest Host-binary64-Werte; exakt
   nachgebildet ist nur der achsparallele Fall. Wer Bitgleichheit in allen Fällen will, braucht Soft-binary64 in Bend
   oder muss polyedrische Volumina und die Achse auch im heutigen Pfad im Kern berechnen.

## 13. Ketten abhängiger Booleans (neu, Defekt 8)

`scripts/lang/wk-chain.mjs`: eine Platte 300 x 300 mm mit N Löchern, je ein `opBoolean` auf die Platte (Marcs Idiom),
also N PIERCE-Knoten in einer Kette. Kind-Prozesse mit 4 GB Heap; Load 21 bis 24. Rohdaten
`out/lang/wk/real/chain.json`.

| N | native Auswertung ms | Identity MB | operationHistory MB | Modell-JSON MB | Identity-Replay ms | WK-Pfad | heutiger Build |
|---:|---:|---:|---:|---:|---:|---|---|
| 5 | 1,4 | 1,2 | 1,7 | 6,3 | 31 | ok, ganzes Modell byte-gleich (Test) | ok |
| 10 | 5,5 | 5,3 | 14,4 | 62,6 | 122 | ok | ok |
| 15 | 11,7 | 14,2 | 56,5 | 295 | 416 | ok | ok |
| 20 | 25,3 | 29,7 | 155 | > 512 (V8-Stringgrenze) | 1266 | expliziter Capability-Fehler beim Export | RangeError beim Export |
| 25 | 39,7 | 53,6 | 348 | > 512 | 3444 | expliziter Capability-Fehler beim Export | RangeError beim Export |
| 30 | 66,1 | – | – | – | – | expliziter Capability-Fehler an Knoten %52 (`model/b25`, opBoolean-Spanne): Heap über 0,6 der Grenze | **Absturz**: V8-Heap erschöpft (7,9 GB Peak-RSS) |
| 45 / 60 | 192 / 442 | – | – | – | – | derselbe explizite Fehler an `model/b25` | nicht gelaufen |

- Die Größen sind auf beiden Pfaden gleich; sie wachsen etwa mit N³ (Modell 6 → 63 → 295 MB für N = 5 → 10 → 15).
- **Ursache im Produktivcode:** Jeder Topologie-Eintrag eines Boolean-Ergebnisses trägt eine Instance-ID, die die IDs
  der Eltern verschachtelt (82 KB je Flächeneintrag bei N = 12), und `operationHistory` kopiert Identity und Historie
  der Eingänge in jede Evidence (`evidence.inputs[0].history` hält 20 von 26 MB bei N = 12).
- **Der WK-Pfad** gibt verbrauchte Zwischenkörper frei (`release`), memoisiert über SHA-256-Schlüssel und macht aus
  einer V8-Grenze (Klon- oder Stacktiefe, Stringlänge) oder einem Heap über 0,6 der Grenze einen expliziten
  Capability-Fehler an der Spanne des Booleans. Ein Heap-Überlauf lässt sich nicht abfangen; der Wächter verhindert
  ihn und kann dabei etwas früher anhalten als nötig, weil der belegte Heap auch Garbage enthält.
- **Die native Auswertung ist nicht die Grenze:** 442 ms für 60 Löcher, etwa quadratisch wachsend, weil jedes Loch in
  ein Ziel mit mehr Flächen gebohrt wird.

## 14. Grenzen

- **Nur ein echtes Teil baut heute vollständig**, und es ist klein. Die Mehrteil-Aussagen stammen aus Teilgraphen,
  deren Rest heute laut scheitert.
- **Host-binary64 in PIERCE:** nicht achsparallele Achse und Volumen polyedrischer Ziele sind F32x2-Nachbildungen
  (markiert, Toleranz in 5.3).
- **`real()` zwischen nativen Ops:** Die Vorbedingung (|x| ≤ 1e20, kein F32-Unterlauf) gilt für Host-Eingänge; Werte,
  die der Kern zwischen zwei nativen Ops berechnet, werden nicht erneut geprüft.
- **Lange Boolean-Ketten:** ab etwa 15 bis 20 abhängigen Booleans kann keiner der beiden Pfade die heutigen Labels
  darstellen (Abschnitt 13).
- CURVED, PLANAR_INTERSECT, Sketch-Profile, Loft außer Kreis-Frustum, Importe und Regionen sind nicht im Auswerter und
  scheitern laut.
- **Count- und try-Spekulation ohne Replay.** Eine Fehlspekulation ist ein Fehler, kein Neuversuch.
- **Identity** wird auf dem JS-Target berechnet (wie heute), nicht nativ.
- **Nicht gemessen:** mehr als 4 Threads, GPU.

## 15. Regression review 2: die geprüften Defekte

Unabhängige Prüfer haben acht Defekte der ersten Fassung reproduziert. Jeder ist an seiner Ursache in den eigenen
Pfaden behoben und hat einen Regressionstest in `test/lang-wk-real.test.mjs` (Tests "fix 2.x"; alle 19 Tests grün,
19,3 s bei Load 12 bis 15; der Identity-Test schlägt mit dem alten Recorder fehl, geprüft durch Zurücksetzen).
Produktivcode ist unverändert.

| # | Defekt | Ursache | Behebung |
|---|---|---|---|
| 1 | PIERCE-Körper weichen jenseits von Knoten 93 ab (`depthMm` auf 5 von 9; `radiusMm`, `admission`, `subdivision` fehlen); `compareLists` ignorierte `construction` | Vergleich nur über B-rep-Felder; Host-Decoder ohne die Construction-Felder des Adapters; Achse in F32x2 statt binary64 | Vergleich des ganzen JSON (`deepDiff`, byte-gleich getrennt); PIERCE-Construction exakt wie `src/boolean.mjs`; Achse achsparalleler Werkzeuge bitgleich (`exact_axis`), sonst markiert |
| 2, 5 | `operationHistory` fehlt auf jedem Boolean-Ergebnis und dessen Transformationen; planare Provenienz fehlt; Platzhalter-Evidence nicht offengelegt | Host-Replay nur mit Identity; Auswerter ohne Provenienz | Provenienz als Wörter (`pu`) plus Audit und Budgets (`extra`); Host baut die heutigen Objekte mit den Prüfungen von `decodePlanarBoolean`; Replay ruft `operationEvidence` / `attachOperationEvidence` in der Reihenfolge jeder Methode; `assembleModel` liefert Modell-Evidence und Source-Map; Platzhalter dokumentiert (Abschnitt 2) |
| 3 | Gate-Bestehen der Teilgraphen (1,24 / 1,37) nicht reproduzierbar | Median ohne Blick auf den Ausläufer von fork@4 | `gateRatios` (kleinere von Median- und Mittelwert-Quote), wiederholte Matrix, robust nur bei Bestehen in jedem Lauf |
| 4 | Identity weicht ab, sobald ein Argument ein `evaluateQuery`-Ergebnis ist | `engine.body` als aufzählbare eigene Eigenschaft der Engine, des `owner` jeder Referenz-Query | nicht aufzählbarer Override, Handle-Prototyp mit `constructor = Object`, SHA-256 der Argument-Snapshots im Treue-Vergleich |
| 6 | Recorder-Stopp überdeckte einen früheren Kernfehler (14 von 30 Kandidaten) | nur vollständige Graphen wurden ausgewertet | Teilgraph immer auswerten; `firstErrorOverall` stellt seine Fehler vor den Recorder-Stopp; 30 von 30 gleich |
| 7 | fehlerhafte Streams teilweise ohne Fehler dekodiert; fehlende Knotenzeilen galten als "kein Fehler" | Decoder verwarf Knoten, ignorierte Rest-Tokens, übersprang Nicht-Ziffern; `reps` still auf 1; Host prüfte die Zeilen nicht | strikter Tokenizer, Siegel (Anzahl + Prüfsumme), jede Anzahl geprüft, kein Rest, vollständiges Lesen (`File.size`), `reps` ≥ 1, Exit 3 vor der Auswertung; Host: strikter Parser, genau die gesendeten Knoten |
| 8 | lange Boolean-Ketten bringen den Host-Replay zum Absturz | geerbtes Label-Wachstum; zusätzlich hielt der Host alle Zwischenkörper und memoisierte über das volle Argument-JSON | `release`, SHA-256-Schlüssel, V8-Grenzen und Heap-Wächter als expliziter Capability-Fehler an der Boolean-Spanne, ebenso beim Export; Wachstum gemessen (Abschnitt 13) |

**Zusätzlich gefunden** (51 der 58 Bruchfälle der Prüfer durch den Vergleich des ganzen Modells, die 7 großen Ketten-
und Korpuskopien ausgelassen; übrig bleiben die spezifizierten lauten Fehler: Graph-Breaks, Count- und
try-Spekulation):

- **Fehler um den Kernaufruf** (siehe Abschnitt 4) melden jetzt den heutigen Fehler an der Spanne der Op.
- **Fehlerherkunft bei geteilter Aufrufspanne:** Ein Helfer, der innerhalb und außerhalb eines `try` aufgerufen wird,
  teilt eine Spanne; die Herkunft wird jetzt über den fehlernden Knoten bestimmt, nicht über die Spanne.
- **Name und Appearance zum Zeitpunkt der Op:** `setProperty` schreibt in den Body; Boolean-Ergebnisse und
  Pattern-Kopien übernehmen, was er gerade hält. Der Recorder zeichnet das auf, sodass auch die Schlüsselreihenfolge
  stimmt.

## 16. Regression review 3: die geprüften Defekte

Eine zweite unabhängige Prüfung fand sechs Defekte in der Fassung der Regression review 2. Jeder ist an seiner Ursache in den
eigenen Pfaden behoben und hat einen Regressionstest in `test/lang-wk-real.test.mjs` (Tests "fix 3.x"; Fixtures
`kernel/lang/wk/cases/round3.fs`, 12 Features aus den Reproduktionen der Prüfer). Produktivcode ist unverändert.

| # | Defekt (Schwere) | Ursache | Behebung |
|---|---|---|---|
| 1 | Nicht achsparalleles PIERCE in eine geneigte Platte: `volumeMm3` bis 3,5·10⁻⁵ mm³ daneben, weit außerhalb der angegebenen 2,3·10⁻¹³; die Flags nur in einer Host-WeakMap (mittel) | Eingänge, die der heutige Adapter in Host-binary64 rechnet (Achse und Reichweite über `Math.hypot` und Divisionen, Zielvolumen über `validateSolid`), wurden in F32x2 nachgebildet und mit einer Toleranz beschrieben | keine Nachbildung mehr: `pierceInputs` rechnet mit dem heutigen Code auf den von den heutigen Decodern gelieferten Operanden, der Knoten trägt die `real()`-Wörter; PIERCE läuft eine Stufe nach seinen Operanden; Flags und Toleranz entfallen |
| 3 | PIERCE in polyedrische Ziele: bis 0,034 mm³ daneben ohne Fehler (23 von 23 geneigten Platten, achsparallele große Platten 7,5·10⁻⁹) (hoch) | dieselbe: `planar_measures` in F32x2 statt der heutigen binary64-Tetraedersumme | dieselbe; Knoten 93 von dual-hardware ist jetzt byte-gleich |
| 2 | Achsprüfung von Loft/Extrude: der WK-Pfad baute einen geneigten Loft, den der heutige Pfad ablehnt (`|dot|` gleich der F32x2-Rundung von 1 − 1e-6) (hoch) | heute `Math.abs(number(dot)) < 1 - 1e-6` in binary64; der Auswerter verglich F32x2-Paare mit der F32x2-Rundung der Konstanten, die 1,1·10⁻¹⁶ darunter liegt | jeder Host-Vergleich von `number(x)` wird exakt ausgewertet (Abschnitt 2); betrifft Normalen, Höhe², Residual, planare Intervalle, Schranken, Volumenvorzeichen |
| 4 | Eingänge über dem F32-Bereich lassen den Encoder mit rohem RangeError abstürzen, ohne Ort, der ganze Graph bricht ab, `try silent` wirkt nicht (mittel) | `Math.fround` macht daraus ±Unendlich, das das Wortformat nicht ausdrücken konnte | ±Unendlich und NaN als Stream-Wörter (e = 999); der Kern rechnet damit wie das JS-Target, der heutige Decoder weist das Ergebnis mit der heutigen Meldung ab; ein solcher Knoten ist eine Stufengrenze, kein anderer nativer Op sieht seinen Körper; `try silent` über den Replay |
| 5 | Der Session-Modus (ein Argument) lief bei einer fehlerhaften Datei davon: 33 GB RSS in 30 s (hoch) | der nachsichtige Decoder des früheren Spikes nahm ein Token (die Prüfsumme des Siegels) als Level-Anzahl und schob leere Level nach | Session-Stream mit Siegel wie der reale; strikte Tokens, vollständiges Lesen, die ganze Grammatik vor dem Dekodieren geprüft, Schleifen halten beim ersten Verstoß; Exit 3. `out/lang/wk/build/wk-native` ist jetzt dasselbe strenge Binary, das alte ist gelöscht |
| 6 | Unter Marcs Dekorations-Idiom `try { op } catch (e) { throw regenError(..) }` wich der erste Fehler in Meldung und Ort ab (239 + 123 Vorkommen im Korpus) (mittel) | Kernel-Ops in `try` wurden spekulativ aufgezeichnet, der Handler lief nie | Replay (Abschnitt 2): Aufzeichnung wiederholt, der fehlschlagende Kernaufruf wirft das heutige Fehlerobjekt, der unveränderte Interpreter führt den Handler aus |

**Zusätzlich gefunden:** (a) Pattern-Kopien planarer Boolean-Ergebnisse hatten `constructionBudget` vor
`construction` (heute danach): tief gleich, nicht byte-gleich; behoben. (b) `python/runner.py` meldet das Ergebnis
seit der build123d-Arbeit von 06:26 als `outputs` statt `handle`; `stage-py.mjs` nimmt beides und scheitert laut
ohne Ergebnis. (c) Fehler, die auch der heutige Build wirft, tragen jetzt den heutigen Ort (keinen, wo heute keiner
ist); `at` behält die Spanne der Op.

**Verifikation gegen einen sich bewegenden Produktivstand.** Seit 06:15 ändert ein anderer Workflow das
FS-Frontend im Arbeitsbaum (`src/parser.mjs`, `src/interpreter.mjs`, `src/library.mjs` und weitere, dazu
`python/`); um 06:24 warf der heutige `build()` dort `this.binaryBoolean is not a function`. Die Runde wurde deshalb
gegen den Produktivstand von git HEAD `12037b8` verifiziert (Snapshot `tmp/lang/r3/head`: `src/` per
`git archive HEAD`, der Code dieses Workflows hineinkopiert, alles andere verlinkt), und die fokussierten Tests liefen
zusätzlich im Arbeitsbaum. Der Byte-Vergleich von Parser und Interpreter mit HEAD sagt über diesen Workflow nichts mehr
aus; der Test prüft jetzt, was der Recorder garantiert (keine Datei dieses Workflows schreibt oder patcht sie, eine
Aufzeichnung lässt die Klasse `Interpreter` unverändert), den HEAD-Vergleich meldet er als Diagnose.

## 17. Reproduzieren

```sh
node scripts/lang/wk-real-select.mjs                    # Schritt 0 (liest ~/Workspace/cad nur)
node scripts/lang/wk-real-build.mjs                     # Auswerter bauen (ein Compile, 35 bis 45 s, bis 11 GB)
node scripts/lang/wk-real.mjs --n 3                     # alle Phasen (~3,5 min bei Load 15 bis 18)
node scripts/lang/wk-real.mjs --n 3 --phases gate --runs 10   # Gate-Matrix zehnmal (~1 min)
node scripts/lang/wk-chain.mjs --sizes 5,10,15,20,25,30,45,60 --today 5,10,15,20,25,30   # Ketten (bis 8 GB RSS)
node scripts/lang/wk-real-report.mjs > out/lang/wk/real/tables.md
node --test test/lang-wk-real.test.mjs                  # 24 Tests, ~35 s
node --test test/lang-wk.test.mjs                       # die früheren WK-Tests (8), Session-Modus inklusive
```

Regression review 3 lief gegen den Produktivstand von git HEAD: `sh tmp/lang/r3/sync.sh` kopiert den Code dieses Workflows
nach `tmp/lang/r3/head`; dort dieselben Befehle.
