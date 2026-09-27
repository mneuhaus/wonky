# Eine eigene CAD-Sprache für wonky? Entscheidung, Form und nächster Spike

Stand: 2026-09-22. Rolle dieses Dokuments: Schiedsspruch über die drei Sprachvorschläge und verbindlicher Plan.
Apple M5 Pro (18 logische CPUs), macOS arm64, Node v22.23.1, Bend 2.0.25.

Grundlage sind die Berichte und Artefakte in [`docs/language/`](language/):

- **Übersichten:** [prior-art.md](language/prior-art.md), [corpus.md](language/corpus.md),
  [semantic-core.md](language/semantic-core.md), [bend-feasibility.md](language/bend-feasibility.md).
- **Vorschläge:** [proposal-core-ir.md](language/proposal-core-ir.md) (WK/0),
  [proposal-dataflow.md](language/proposal-dataflow.md) (WGraph), [proposal-surface.md](language/proposal-surface.md) (WPy).
- **Brücke:** der Bridge-Entscheid [native-bridge.md](native-bridge.md) und der gemessene Slice
  [native-bridge/slice.md](native-bridge/slice.md).
- **Forschung:** `docs/research/` enthielt beim Schreiben nur Quellauszüge, kein Kapitel und keine `synthesis.md`.

Die Kernzahlen der Vorschläge habe ich gegen deren JSON-Rohdaten nachgerechnet (`out/lang/wk/`, `out/lang/dataflow/`,
`out/lang/surface/`). Neu gemessen habe ich nur zwei Staging-Läufe über den Korpus: nur Host, ohne Kern, lesend auf
`~/Workspace/cad`. Skripte: `tmp/lang/judge/scan-planar.mjs` und `probe-candidates.mjs`, Ergebnis:
`tmp/lang/judge/scan-planar.json`. Load Average dabei 21,0 bis 23,5 auf 18 Kernen. Alle Millisekunden in diesem
Dokument sind **indikativ**, weil die Maschine geteilt ist (Load 12 bis 29 in allen Quellmessungen). Hashes,
Volumenwörter und Op-Folgen sind **exakt**.

## 1. Kurzfassung

**Ja zu einem gemeinsamen Kern, nein zu einer neuen Sprache.**

- **Ja:** ein eigener, gemeinsamer Kern, in den FeatureScript und build123d übersetzt werden.
- **Nein zu einer neuen Sprache,** und nein dazu, diese Sprache in Bend zu implementieren.

Die richtige Form ist **WK/0**, ein internes, content-adressiertes Graph-IR aus Kernel-Operationen:

- stabile IDs, Quellspannen und eine kanonische Textform;
- auf dem Host aus den unveränderten Frontends aufgezeichnet;
- später optional als Ganzes in Bend ausgewertet.

**Warum.** Alle drei Prototypen kommen unabhängig auf dasselbe Ergebnis, und die Messungen tragen es:

1. **Die Geschwindigkeit kommt vom nativen Kern, nicht von einer Sprache.**
   - Das Binding liefert gemessen 7,6 bis 12,6x Ende-zu-Ende (Slice).
   - frame-with-tab über ein Graph-IR in Bend ist so schnell wie direkte Kernaufrufe: 1,49 bis 1,55 s.
   - Parser plus Interpreter machen höchstens 0,7 % der Wall-Zeit aus. Sie nach Bend zu verlegen, bringt nichts
     Messbares.
2. **Ein Kern-IR bringt, was das Binding allein nicht kann.** Diese Nutzen sind gemessen, aber begrenzt:
   - Preflight/Lint ohne Kern: jede Lücke mit Quellzeile, r10b in einem Durchgang.
   - Graph-Diff und Cache-Schlüssel: r10b-Hash 4 ms, Diff 9,7 ms.
   - Inkrementelle Rebuilds. Die realen r10b-Parameter machen nur 1,8 bis 3,5 % der Booleans schmutzig (strukturell
     gezählt). Nativ gemessen: 19 % gespart auf frame-with-tab.
   - Fork-Join über unabhängige Teile. Bei 8 Threads 6,6 bis 10x, aber nur auf einer synthetischen Datei. Der Korpus
     hat eine Op-Count-Schranke im Median von nur 2,7 bis 3,0.
3. **Eine neue Syntax verliert beim LLM.** Frontier-Modelle schreiben Python/build123d weit zuverlässiger als
   seltene CAD-Sprachen. KCL brauchte ein finanziertes Team und drei inkompatible Sprachversionen.
4. **Bend taugt als Auswerter eines kleinen Graphen erster Ordnung, nicht als Sprach-Host.**
   - Zahlen sind F32x2 statt binary64: `0.1 + 0.2 == 0.3` ist nativ wahr.
   - Es gibt keine separate Kompilierung: jede Änderung am Auswerter kostet 15 bis 27 s und 3 bis 7 GB.
   - Ein Graph-Auswerter erster Ordnung ist dagegen klein (521 Zeilen), braucht keine Fuel und liefert
     bitgleiche Ergebnisse.

**Reihenfolge:**

1. Das Binding (Compat-Schritt 1) und die Boolean/r10b-Kernarbeit bleiben kritischer Pfad.
2. WK/0 kommt jetzt nur auf dem Host: Recorder, Textform, Hashes, Preflight, Diff. Das braucht keine
   Bend-Änderung.
3. Die Op-Records von WK/0 werden identisch mit den groben Fassaden-Ops des Bindings, einmal entworfen.
4. Ein nativer `run_graph`-Einstieg kommt erst, wenn der Spike (Abschnitt 12) auf einem **echten** Mehrteil-Modell
   ≥ 1,2x gegenüber dem nativen Einzelaufruf-Pfad zeigt und der Pool-Worker-Fail-Stop behoben ist.
5. Eine Autorensprache kommt, wenn überhaupt, erst nach einer gemessenen LLM-Studie. Dann ist sie ein
   Python-Dialekt (WPy) und keine neue Syntax.

**Neuer Befund dieses Schiedsspruchs, der die Reihenfolge schärft:** Von 214 realen Korpus-Features, deren schwere
Arbeit nur aus Booleans besteht, sind nur **4** rein planar. Fast jedes echte Teil hat Zylinder (Frustum,
Coaxial/Pierce-Booleans). Weder das Binding noch ein Graph-Auswerter kann Marcs echte Teile nativ bauen, bevor
Frustum und die Coaxial/Pierce-Methoden nativ laufen (Bridge-Schritte 3 und 4). Alle nativen Parallel-Zahlen bisher
stammen von Fixtures oder synthetischen Dateien. Genau das testet der Spike.

## 2. Die Idee, wie Marc sie formuliert hat

> Eine eigene CAD-Sprache, inspiriert von FeatureScript und build123d (und anderen), nativ in Bend implementiert und
> in Bend laufend, womöglich als *die* native Kernsprache von wonky. FeatureScript, build123d und vielleicht JS wären
> dann Übersetzungsschichten, die in diese Bend-Sprache kompilieren.

In prüfbare Behauptungen zerlegt:

| # | Behauptung | Ergebnis |
|---|---|---|
| A | Eine Bend-native Sprache macht wonky schnell | **widerlegt.** Der native Kern macht wonky schnell, das Binding liefert ihn |
| B | Ein gemeinsamer Kern für FS, build123d und JS ist sinnvoll | **bestätigt**, als internes IR |
| C | FS und build123d lassen sich in diesen Kern übersetzen | **überwiegend bestätigt**. FS: 73 % aller eindeutigen Dateien, 92 % der verarbeitbaren, als ein Graph ohne Synchronisation. build123d: begrenzt durch den Shim (1 von 294 Dateien) |
| D | Der Kern soll in Bend laufen | **geteilt.** Der Kernel-Graph ja, gated. Werte, Kontrollfluss und Parsing nein |
| E | Eine eigene Sprache ist besser für LLMs | **für neue Syntax widerlegt**, für Eigenschaften (IDs, Preflight, Feedback) gestützt, für WPy ungemessen |

## 3. Was die Evidenz sagt

### 3.1 Prior Art ([prior-art.md](language/prior-art.md))

- **Jedes reife System mit mehreren Eingängen bündelt sie in eine kleine Operationsschicht.** Beispiele:
  Onshape (`op*` über einen `Context`), KCL (Modeling Commands an Zoos Engine), Manifold (lazy CSG-DAG mit
  Parallelität und Cache), Cadova (hashbare `GeometryNode`s), Fidget (Tapes), Curv (statischer SubCurv-Kern).
  Compiler machen es genauso (GHC Core, MLIR). Ein internes Kern-IR ist gut belegt.
- **Nur ein Projekt hat eine neue menschliche CAD-Sprache gebaut und am Leben gehalten: Zoos KCL.**
  - Aufwand: 53 Contributors, etwa 6,1 MB Rust in `kcl-lib`, drei Sprachversionen mit Breaking Changes (Pipelines,
    Keyword-Argumente, nur noch Floats).
  - Noch im September 2026 fixt Zoo Topologie-Tags, die durch Booleans verloren gehen.
  - Sein Cache führt nur reine Ergänzungen inkrementell aus, sonst alles neu.
  - Seine Architektur (Interpreter auf dem Client, Engine separat, Artefakt-Graph mit Quellbereichen, Mock-Execution)
    entspricht genau wonkys JS/Bend-Split.
- **Die anderen neuen Sprachen oder Kerne sind archiviert.** Curv (GitHub-Repo, heute auf Codeberg gepflegt),
  CADmium und Fornjot. Fornjot ist an Topologie und Scope gescheitert, nicht an Sprachfragen.
- **Lehre für wonky:** Kern-IR ja. Eine Oberfläche nur als weiteres Frontend und erst mit Beleg.

### 3.2 Marcs Korpus ([corpus.md](language/corpus.md))

**Umfang:**
- 457 FS-Modelldateien (329 eindeutig, 129 Familien).
- 129 build123d-Modelldateien (91 eindeutig, 82 Familien), 0 CadQuery.
- 189 Python-Dateien erzeugen FeatureScript. `Trace` in `cad-project-041/single-step-r10/src/core_geometry.py` ist
  bereits ein Mini-IR mit zwei Backends.

**Was echte Dateien vom Kern brauchen:**
- Echte geometrieabhängige Steuerung (Verzweigung oder sequentielle Schleife über Kernergebnisse) ist selten:
  - FS 1,2 % eindeutig / 2,3 % Familien;
  - build123d 9,9 % / 11 %.
- Der große Mittelteil ist ein **lazy IR**, keine Sprache: deklarative Selektionsprädikate (Bereichsfenster,
  Richtungstests, Typ), Map-Regionen, Arithmetik auf Messwerten, Best-Effort-Kombinatoren.
  - Von 273 FS-Prädikaten braucht keines allgemeinen Code.
  - In build123d sind 156 von 170 Prädikaten solche einfachen Tests.
- Das Kernel-Vokabular ist schmal: 35 Funktionen decken 80 %, 49 decken 95 % der FS-Familien.
- Marcs FS ist erster Ordnung: 0 Lambdas, Closures oder Rekursion in 329 Dateien. 89 % der Schleifen laufen über
  programmbestimmte Sammlungen.

**Folgerung:** Der Korpus verlangt ein Kern-IR, keine neue Sprache.

### 3.3 Bend-Machbarkeit ([bend-feasibility.md](language/bend-feasibility.md), [proposal-core-ir.md](language/proposal-core-ir.md) §5)

| Frage | Messung |
|---|---|
| Läuft eine dynamische Kernsprache nativ in Bend? | Ja: Closures, Listen, Maps, Fehler als Werte mit Span, `par`. Rund 2.100 Zeilen Bend |
| Ist der native Tree-Walker schneller? | Nein: 27 bis 35 ns/Knoten nativ gegen 30 bis 45 ns V8 und rund 50 ns pro Schritt im FS-Interpreter |
| Kernergebnisse durch die Sprache | bitgleich (Hash 3141504600 für frame-with-tab), Overhead unter Rauschen: 1.494 gegen 1.508 ms |
| Zahlen | F32x2, rund 48 Bit: `(+ 0.1 0.2)` ergibt 0.2999999999999998, `(= (+ 0.1 0.2) 0.3)` ist wahr. Keine F64/I64 |
| Compile-Kosten | Sprache plus Kern 17,9 s + 8,9 s, 7,07 GB. WK-Auswerter erster Ordnung 7,6 s + 8,5 s, 3 bis 5 GB. Keine separate Kompilierung, kein Library-Modus |
| FS-Tokenizer in Bend | tokengleich zu `src/parser.mjs`, 1,6x schneller als V8, aber 64 B pro Zeichen, und Parsing ist ≤ 0,7 % der Wall-Zeit |
| Fork-Join | 4 unabhängige Pockets 1.246 / 638 / 327 ms bei 1 / 2 / 4 Threads. **Nur beim Forken über vorab gebaute Daten.** Beim Forken auf berechneten Argumenten lief es bei 2, 4 und 8 Threads genau 2-fach |
| Graph-Auswerter erster Ordnung | 521 Zeilen, keine Fuel außer Baumtiefe, Memo über Graphen, bitgleich über 1/2/4/8 Threads |

**Folgerung:** In Bend gehört ein kleiner, stabiler Graph-Auswerter über Kernel-Ops. Nicht hinein gehören
FS-Arithmetik, Python-Semantik, ein Parser oder eine Standardbibliothek, die sich oft ändert.

### 3.4 Was die drei Prototypen gemessen haben

| Messung | Wert | Quelle |
|---|---|---|
| frame-with-tab, heute (JS-Pfad) | 12,9 bis 13,9 s | slice, spike, wk check |
| frame-with-tab, Binding-Slice nativ, 1 Thread | 1,79 s Ende-zu-Ende (6 Threads 1,19 s), Ausgaben byte-identisch | slice.md |
| frame-with-tab, WK-Graph nativ, 1 / 4 Threads | 1,50 bis 1,81 s / 0,98 bis 1,00 s, Hash 3141504600 | out/lang/wk/native.json |
| dasselbe aus FS und aus build123d | **identischer** kanonischer Graph, Output-Hash `f55dec6f28652498` | wk native.json |
| 8 unabhängige Pockets aus reinem FS, 1 / 2 / 4 / 8 Threads | 2,45 bis 3,50 / 1,23 / 0,62 bis 0,65 / 0,32 bis 0,35 s, identisch | wk native.json (Load 18 bis 21) |
| Sweep, 4 Varianten, hash-consed + `par`, 4 Threads | 2.261 gegen 6.318 ms naiv (2,8x), Hashes gleich | dataflow native.json |
| Tab-Edit mit Memo | 1,19 bis 1,25 s gegen 1,47 bis 1,53 s kalt (WK); 1.061 gegen 1.316 ms (dataflow) | beide |
| Opening-Edit mit Memo | kein Gewinn (1,0x) | dataflow |
| FS-Korpus, ein Graph ohne Break | 241 / 329 eindeutig (73,3 %), 78 / 129 Familien (60,5 %) | wk census.json |
| dasselbe mit Interpreter-Tracer, ohne Regionen | 123 komplett (43 % der getracten), 60 % / 51 % der Graph-Ergebnisse ohne Break | dataflow corpus.json |
| r10b gestaged | 5.412 Knoten (WK) gegen 2.037 Knoten (dataflow), 433 Booleans, Span 42 | beide |
| Korpus-Parallelität (Op-Count-Schranke) | Median 3,0 (WK) bzw. 2,69 (dataflow), p90 8 bis 12 | beide |
| build123d, WPy ohne CPython | 6 von 91 eindeutigen Dateien (6,6 %), 0 davon heute baubar | surface corpus.json |
| project-component-d98e059b.py unverändert | 274 Knoten, 34/34 Selektionen deklarativ, Op-Zahlen gleich OCCT | surface |

### 3.5 Eigene Prüfung

- **Die Zahlen stimmen.** Stichproben in allen drei JSON-Berichten decken sich mit den Texten. Ein kosmetischer Fehler:
  der WK-Census zählt `toString` über ein Plain-Object-Schlüssel und druckt ihn als verketteten String. Die Angabe
  "toString 8" im Vorschlag ist trotzdem richtig.
- **Die 8-Pocket-Beschleunigung ist ein Idealfall.** Acht gleich teure, völlig unabhängige planare Pockets. Das
  Einzel-Thread-Sample lag bei Load 21. Gegen den ruhigeren 2-Thread-Wert gerechnet sind es realistisch etwa 3,8x bei
  4 und 7x bei 8 Threads.
- **Real planar ist fast nichts.** Ich habe alle 214 Single-Graph-Korpus-Features mit reiner Boolean-Schwerarbeit neu
  gestaged (Load 21 bis 23):
  - nur 4 nutzen ausschließlich `extrude_polygon`, `boolean`, `transform` und `pattern`;
  - nur 1 davon (ein leerer Graph) liegt in der XY/+Z-Teilmenge, die der native WK-Auswerter heute kann;
  - der Rest braucht `frustum` (Zylinder) oder Sketch-Profile.
- **Beste reale Parallelkandidaten**, von beiden Frontends vollständig gestaged:
  - `belt-return-r25/dual-hardware-r25.fs` (`dualHardware25`, generiert, 175 Zeilen): 42 Booleans, 69 Zylinder,
    Span 2, 37 Komponenten, Schranke 21;
  - `machine-interface-r11/interface-r11.fs` (`fasteners`): Schranke 15,5;
  - `archive-r16/hopper.fs`: 64 Subtracts, Span 6, Schranke 10,7.

  Keiner davon wurde je mit wonky gebaut.
- **Zwei FS-Frontends, zwei Store-Modelle.** WKs Stager (auf semcore) hat Regionen und if-Conversion, aber vier
  gefundene Store-Bugs, einen Präzedenzfehler und den `try`-Bug. Außerdem bläht er r10b auf 5.412 Knoten
  (3.219 davon `difference`). Der dataflow-Tracer nutzt den unveränderten Interpreter und ist Op für Op gleich den
  echten Builds (11 Programme plus r10b-Prefix). Er kennt aber keine Regionen.

## 4. Bewertung der Vorschläge

Kriterien je 0 bis 10:

- **N** Nutzen für Marcs FDM-Arbeit (Speed, Robustheit, Introspektion, Diff)
- **L** LLM-Code-to-CAD-Qualität
- **K** Korpus-Abdeckung
- **B** Bend-Implementierungsrisiko (10 = geringes Risiko)
- **I** inkrementeller Pfad
- **F** Fit zum nativen Binding

Abzüge für nicht gedeckte Behauptungen stehen darunter.

| Vorschlag | N | L | K | B | I | F | Mittel | nach Abzug |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **core-ir** (WK/0, Regionen, Stager, nativer Auswerter) | 7 | 5 | 8 | 7 | 7 | 9 | 7,2 | **7,2** |
| **dataflow** (WGraph, Interpreter-Tracer, Hash-Cache, Sweeps) | 7 | 5 | 6 | 8 | 9 | 9 | 7,3 | **7,0** |
| **surface** (WPy, Python-Teilmenge mit build123d-Vokabular) | 5 | 6 | 3 | 8 | 5 | 7 | 5,7 | **5,5** |

**core-ir.**
- Stärken:
  - die höchste gemessene FS-Abdeckung (dynamisch, nicht statisch);
  - der einzige echte native Graph-Auswerter mit Memo und Baum-Fork;
  - die ehrlichste Selbstkritik: "Die IR macht wonky nicht schnell";
  - die klare Deckung von Op-Set und Fassade.
- Schwächen:
  - Der Stager ist eine zweite FS-Semantik mit bisher 5 Bugs und dem `try`-Handler-Bug.
  - 12 % der Graphen haben mehr als 1.000 Knoten (bis 11.118), weil die generierten Total-Boolean-Helfer
    if-konvertiert werden.
  - Regionen sind nur strukturell geprüft, nie ausgeführt.
- Kein Abzug: Die synthetische 6,6- bis 10x-Zahl ist als synthetisch gekennzeichnet.

**dataflow.**
- Stärken:
  - der Tracer ist der echte Interpreter mit getauschten Builtins, also eine Semantik;
  - die Fidelity-Suite zeigt gleiche project-component-a8102813 und Zeilen wie die echten Builds;
  - kleinere Graphen;
  - die besten Reuse-Daten (reale r10b-Parameter);
  - nativer Sweep-Beleg ohne neuen Bend-Compile.
- Abzug −0,3, weil zwei Aussagen zu weit gehen:
  - "etwa 98 % der Familien mit zwei Idiomen" ist eine Projektion; die Idiome sind nicht gebaut.
  - Der Sweep erfülle "das eigene Kriterium des Bridge-Entscheids". Das stimmt nur für einen Tab-Sweep auf einer
    Fixture; ein realer Sweep-Bedarf ist nicht belegt.
- Die Speculation-Replay-Logik fehlt.

**surface.**
- Stärken:
  - gute Designarbeit: stabile Call-Path-IDs, deklarative Prädikate aus Comprehensions, Total-Booleans, ein
    WPy-zu-FS-Emitter, der `Trace` ersetzen könnte;
  - project-component-d98e059b.py unverändert mit OCCT-gleichen Op-Zahlen.
- Schwächen:
  - 6,6 % Abdeckung heute, 41,8 % erst nach Workflow-Umbau;
  - 0 Korpus-Graphen baubar;
  - rund 3.200 Zeilen zweite Python-Implementierung mit Drift-Risiko;
  - für FS nichts.
- Abzug −0,2 für "WPy ist Python". Das stützt sich auf eine Op-Zahl-Gleichheit in einer einzigen Datei;
  differentielle Tests fehlen.

**Keiner der drei gewinnt allein.** core-ir und dataflow sind zwei Implementierungen derselben Idee und ergänzen sich
genau an ihren Schwächen. surface liefert Bausteine für später.

## 5. Empfehlung und Form

**Bauen: WK/0 als das eine interne Kern-IR von wonky. Nicht als Sprache.** Es ist ein Hybrid der drei Vorschläge:

| Baustein | Herkunft | Warum |
|---|---|---|
| Aufzeichnung durch den **unveränderten Produktions-Interpreter** mit austauschbarem Effekt-Handler (eager über die Fassade oder aufzeichnend) | dataflow | eine FS-Semantik statt zwei; die Fidelity ist gemessen |
| Knotenset und Namen (`extrude_polygon`, `frustum`, `sketch_*`, `extrude_profile`, `boolean{kind, method}`, `transform`, `pattern`, `import`, `measure`, `expect`, `or_else`) = **grobe Fassaden-Ops** des Bindings | core-ir, surface | ein Host↔Kern-Vertrag, einmal entworfen |
| Regionen **sparsam**: zuerst nur `select` und `expect` (sie decken alle 206 ersten Breaks im Korpus), dann `map`/`fold`. `when` (if-Conversion) nur mit Knotenbudget; sonst ein Graph-Break | core-ir, dataflow | Abdeckung ohne Graph-Aufblähung; Breaks kosten in-process Mikrosekunden |
| Count-Spekulation über Lineage plus `expect.count`-Knoten, mit Replay bei Fehlspekulation | dataflow | entfernt die meisten Level-2-Breaks ohne Regionen |
| Zwei Hashes pro Knoten: `geom` (ohne IDs) und `full` (mit IDs); Spannen und Stacks nie im Hash | dataflow, core-ir | Cache ist sicher, solange Identity getrennt berechnet wird |
| F32-Präzisionsvertrag pro Op mit Rundungsbericht; Regel für signierte Null in der Kanonisierung | core-ir | macht die heute implizite Rundung prüfbar |
| Stabile IDs: FS-`Id`-Pfade; Python-Call-Paths mit Zähler (`py/L4#2`) statt `python/N` | alle | Voraussetzung für Cache, Identity und Diff |
| kanonische Textform `wonky-kernel-graph/0` für Golden-Tests, Diff, Bug-Reports und LLM-**Lesen** | alle | kein Autorenformat (r10b sind 2.000 bis 5.400 Zeilen) |
| Preflight (`wonky graph --check`), Graph-Diff, Census als CI-Regression | alle | sofort nützlich, ohne Kern |
| später in Bend: `run_graph` als gebündelter Binding-Einstieg, erster Ordnung, Fork über vorab gebauten Baum, Memo | core-ir | nur mit Beleg (Abschnitt 11) |

**Nicht bauen:**

- neue Syntax oder Grammatik;
- ein FS- oder Python-Interpreter in Bend;
- ein Parser in Bend;
- eine dynamische Sprache in Bend (den Spike-Auswerter);
- Residual-Werte in F32x2, die Kontrollfluss entscheiden;
- stille Graph-Rewrites (Clone-Elimination, Reassoziation);
- ein persistenter Cache, bevor Identity content-adressiert ist;
- eine visuelle Graph-Oberfläche;
- ein mechanischer FS-zu-WPy-Übersetzer.

**Warum dieser Hybrid und nicht core-ir pur:** Der größte Unterschied liegt nicht in der Form, sondern darin, wer die
FS-Semantik trägt.

- Ein zweiter FS-Auswerter (der Stager) hat in einem Tag fünf Semantikfehler gezeigt.
- Der Interpreter-Recorder hat gemessene Op-für-Op-Treue.
- core-ir sieht selbst "ein Evaluator, zwei Handler" als Ziel (Schritt 4). Ich ziehe das an den Anfang.
- Die Idiom-Rewrites (`idioms-fs.mjs`) arbeiten auf dem AST und sind übertragbar.
- Die if-Conversion ist der teure, aufblähende Teil. Sie kommt nur, wenn `run_graph` gebaut wird. Vorher sind
  Breaks kostenlos.

## 6. Wie FeatureScript und build123d übersetzt werden

### 6.1 FeatureScript: aufzeichnen, nicht kompilieren

- FS bleibt **unverändertes Onshape-FS**. Die "Übersetzung" ist wonkys Interpreter, der mit einem aufzeichnenden
  Effekt-Handler läuft:
  - FS-Wertarithmetik bleibt binary64 auf dem Host;
  - nur Kernel-Arbeit und kernabhängige Werte werden Knoten;
  - eine Stelle, die kein Idiom abdeckt, beendet den Graphen (Graph-Break); der Host liest den Wert und läuft weiter.
- **Abdeckung, gemessen** (dynamisch über alle eindeutigen FS-Dateien des Korpus):

  | Stufe | eindeutig | Familien | Quelle |
  |---|---:|---:|---|
  | wonkys Parser lehnt ab (Fragmente, `try silent {`, `for (k, v in map)`, Map-Wert `"function"`) | 43 (13 %) | 27 | beide |
  | ein Graph, 0 Breaks, mit Regionen und if-Conversion | **241 (73,3 %)** | **78 (60,5 %)** | WK census |
  | davon mit symbolischem, vorbelegtem Part Studio | 49 | 22 | WK census |
  | Anteil an den bis zum Ende verarbeitbaren Dateien | 92,0 % | 89,7 % | WK census |
  | ohne Regionen, nur Spekulation und Check-Knoten (Interpreter-Tracer) | 60 % der Graph-Ergebnisse | 51 % | dataflow |
  | verbleibende Breaks | 21 | 9 | alle auf statischem Level 5/6 |
  | fehlende Wertfunktionen (`toString` 8, `mergeMaps` 2) | 12 | 7 | WK census |

- **Ziel des Hybrids:** Der Interpreter-Recorder mit `select`/`expect`-Idiomen und Count-Spekulation soll
  mindestens 90 % der verarbeitbaren Dateien ohne Break erreichen, ohne if-Conversion. Das ist projiziert, nicht
  gemessen: Alle 206 ersten Breaks des dataflow-Tracers sind Level-2-Checks (38) oder Level-5-Selektionen (168).
  Diese Zahl misst Schritt 2 (Abschnitt 9).
- **Unabhängig von WK zu tun:**
  - die Parserlücken (43 Dateien);
  - die fehlenden reinen Std-Funktionen (`atan2`, `toWorld`, `rotationAround`, `mirrorAcross`, `makeId`, `min`/`max`,
    ...; 28 davon hat dataflow schon implementiert) nach `src/scalars.mjs`;
  - der Semcore-`try`-Bug (Handler sieht Werte vom `try`-Eintritt; betrifft Marcs Stage-Name-Idiom).
- **r10b** zeichnet sich als ein Graph auf: 2.037 Knoten mit sparsamem Store-Modell, 433 Booleans, Span 42,
  27 Komponenten. Als Preflight listet das jede nicht unterstützte Op in einem Durchgang. Das JS-Target stoppt
  heute bei Operation 12 (strikt) bzw. 44.

### 6.2 build123d: CPython bleibt, der Shim bekommt stabile IDs und lazy Selektoren

- **Heute:** build123d läuft in CPython, der Shim schickt Requests. Das Aufzeichnen ist exakt: frame-with-tab ergibt
  denselben Graphen wie sein FS-Zwilling. Die Abdeckung ist aber die des Shims: **1 von 294** eindeutigen Dateien.
  Der Engpass ist Vokabular, nicht die Form.
- **Nächste Schritte ohne neue Sprache:**
  - stabile Call-Path-IDs im Tracer;
  - lazy `ShapeList` für `edges().filter_by(...)`, `group_by`, `sort_by`;
  - `select`-Knoten für die Prädikatformen, die WPy schon erkennt.

  Grenze: Ein Comprehension-Filter (`[e for e in s.edges() if abs(e.center().Z - h) < eps]`, 28 von 82 Familien)
  ruft in CPython `bool()` auf und erzwingt dort einen Sync. Nur ein eigener Auswerter (WPy) kann ihn deklarativ
  senken.
- **WPy** (hermetische Python-Teilmenge, build123d-Vokabular):
  - Abdeckung 6,6 % unverändert;
  - 41,8 % eindeutig (45,1 % Familien) erreichbar erst nach Trennung von Modell und Treiber-IO, WPy-v1-Features und
    einem cad_khana-Port;
  - der Rest blockiert an OCP, trimesh, Klassen oder cad_khana.

  WPy ist ein **späteres, optionales Frontend auf WK/0**, entschieden durch die LLM-Studie (Abschnitt 8).
- **Rückrichtung (WK-Graph zu FeatureScript)** ist mechanisch und auf bracket und frame-with-tab bitgleich belegt. Sie
  kann Marcs 189 handgeschriebene Python-zu-FS-Generatoren (`Trace`) ablösen. Das ist ein Werkzeug über WK/0 und
  unabhängig von WPy.

### 6.3 JavaScript

Ein JS-Frontend (Host-Objekte, die Knoten anhängen) wäre das einfachste, wird vom Korpus aber nicht gebraucht.
Zurückstellen.

## 7. Verhältnis zum nativen Binding

- **WK/0 baut auf dem Binding auf und ersetzt nichts.** Das Binding (N-API-Addon, `call(op, words)`, exakte Carrier,
  kein stiller Rückfall) liefert die gemessenen 7,6 bis 12,6x. WK/0 liefert den Speed-Anteil nicht.
- **Die Fassade ist WK/0, Op für Op.** Ab Bridge-Schritt 2 (`kernel/service/api.bend`) werden die Argument-Records
  gemeinsam entworfen: `extrudePolygon`, `frustum`, `sketchLines`, `sketchArcs`, `extrudeProfile`, `transform`,
  `boolean`, `importBrep`. Ein Graph-Break ist ein gewöhnlicher Fassadenaufruf (0,5 µs).
- **Der Cache braucht keine Bend-Änderung.** Der Host hält eine Map von `geom`-Hash zu Carrier. Identity-Labels werden
  getrennt berechnet, weil sie an der project-component-a8102813 hängen und nativ teuer sind (120 ms bei frame-with-tab).
- **Fork-Join und residente Zwischenkörper brauchen genau einen neuen Einstieg, `run_graph(words)`.** Grund: Die
  Runtime serialisiert Aufrufe, der Host kann nie zwei Kernaufrufe gleichzeitig laufen lassen. Voraussetzungen:
  1. der kooperative CPU-Fehlerpfad für Pool-Worker (heute beendet ein Fail-Stop Node);
  2. ein realer Workload mit gemessenem W/S ≥ 1,2 gegen den nativen Einzelaufruf-Pfad;
  3. native Frustum- und Coaxial/Pierce-Einstiege, weil ohne sie kein echtes Teil nativ läuft (Abschnitt 3.5).
- **Numerik:** Residual-Werte (Median 21 pro Graph, Maximum 4.228) bleiben auf dem Host in binary64. Soft-binary64 in
  Bend kommt nur, wenn ein gemessener Workload ganze Graphen mit solchen Knoten braucht. F32x2 entscheidet nie
  Kontrollfluss.

## 8. LLM-Aspekt

- **Neue Syntax schadet.**
  - CADFS brauchte 451k Programme Fine-Tuning und hatte trotzdem 9 % statt 3 % ungültige Ausgaben gegenüber
    CadQuery.
  - GPT-4 scheiterte an rohem FS; KCLs Designer nennt fehlende Trainingsdaten.
  - Marc nutzt Frontier-Modelle ohne Fine-Tuning.
- **Was LLMs messbar hilft, braucht keine Syntax:**
  - deterministische IDs: CADFS, Chamfer-Distanz 124,87 auf 97,82;
  - explizite Punkt-Parametrisierung: ungültig 24 % auf 10 %;
  - globaler Frame (Makatura);
  - entflochtene Operationen: rohes FS 56 % gegen normalisiertes 10 % ungültig;
  - Kern-Feedback: CADSmith, IoU 0,81 auf 0,96.
- **WK/0 liefert davon IDs, Preflight mit Spannen, Checks und Graph-Diffs.** Die kanonische Graph-Textform ist ein
  gutes **Leseformat** für Agenten: flach, global, eine Op pro Zeile. Die Diff-Meldung "dein Edit ändert 15 Booleans
  in TrayArms" ist genau das Kern-Feedback aus der Literatur. Als Schreibformat taugt sie nicht (keine Parameter,
  keine Schleifen).
- **LLMs schreiben weiter build123d oder normalisiertes FS.** Konkrete Werkzeuge zuerst: `wonky graph`, `--check` und
  `--diff` als MCP-Tool.
- **Ob WPy oder die Graph-Textform LLMs messbar besser macht (H6), ist ungemessen.** Die Studie aus
  proposal-surface.md §9 entscheidet:
  - 10 bis 20 Teile aus Marcs Familien;
  - vier Bedingungen: build123d auf CPython, rohes FS, WPy mit Check, WPy mit Check und Graph;
  - Metrik: validierter Erfolg und Iterationen.

  WPy wird nur gebaut, wenn Bedingung 3 oder 4 mindestens gleichauf mit Bedingung 1 liegt.

## 9. Reihenfolge und Schritte

Jeder Schritt ist einzeln auslieferbar. Der Default bleibt der heutige Pfad.

| # | Schritt | liefert | hängt ab von | Gate |
|---|---|---|---|---|
| 0 | **kritischer Pfad unverändert:** Boolean/r10b-Kernarbeit; Bridge-Schritt 1 (Compat, volle 84 Einstiege, bitgleich) | den gemessenen Speed für alle Frontends | nichts von WK | native-bridge.md |
| 1 | **Spike jetzt** (Abschnitt 12): Recorder aus dem echten Interpreter, nativer WK-Auswerter mit Frustum/Pierce/Coaxial, echte Mehrteil-Modelle gegen JS-Pfad und gegen seriellen nativen Pfad | Beleg oder Widerlegung von `run_graph` | nur eigene Pfade, ein Bend-Compile | Abschnitt 12 |
| 2 | **WK/0 host-seitig:** `src/lang/wk` konsolidieren (IR, Kanonik, zwei Hashes, Recorder als Effekt-Handler des Interpreters, `select`/`expect`-Idiome, Spekulation mit Replay), `wonky graph [--check] [--diff]`, Census und Fidelity-Suite als Regression | Preflight, Diff, Cache-Schlüssel, stabile Python-IDs | Interpreter-Hook (klein) | Fidelity grün; ≥ 90 % der verarbeitbaren FS-Dateien ohne Break oder ehrlich weniger |
| 3 | **Semantik-Fixes**, die WK aufgedeckt hat: `try`-Handler-Sicht, stale Entity-Referenzen explizit, `qCreatedBy`-Präfix, fehlende Std-Funktionen, Parserlücken; **totale Booleans im Kern** (entfernt if-Conversion der generierten Helfer) | weniger Breaks, richtige Fehlerdekoration | Kern- und Frontend-Owner | Modelltests grün |
| 4 | **ein Vertrag:** Fassaden-Op-Records = WK/0-Op-Records (mit Bridge-Schritt 2/3) | ein Host↔Kern-Interface | Bridge-Schritt 2 | Diff-Backend grün |
| 5 | **Host-Cache** `geom`-Hash → Carrier in residenten Sessions (Viewer, `--watch`), Identity getrennt | inkrementelle Rebuilds | 2, 4 | Ende-zu-Ende-Edit-Latenz gemessen, Ergebnisse gleich kalt inklusive Identity |
| 6 | **`run_graph`** als gebündelter Binding-Einstieg (Baum-Fork, Memo), JS-Target-Zwilling im Diff-Modus; danach `--sweep` mit Hash-Consing | Fork-Join für Mehrteil-Dateien und Sweeps | Spike bestanden; Pool-Fail-Stop-Fix; Bridge-Schritte 3/4 | ≥ 1,2x auf realem Workload, identische Hashes |
| 7 | native Regionen (`select`, Measures) | weniger Breaks pro Submission | Kern-Queries auf echten B-reps; Entscheidung zur Numerik | eigene Messung |
| 8 | build123d: stabile IDs, lazy Selektoren im Shim; WK→FS-Emitter statt `Trace` | mehr Python-Abdeckung, eine Quelle für wonky/Onshape/OCCT | 2 | Korpus-Zahl steigt |
| 9 | LLM-Studie, danach vielleicht WPy als Frontend auf WK/0 | datengestützte Sprachentscheidung | 2, 8 | Abschnitt 8 |
| nie | neue Syntax; FS/Python-Auswertung in Bend; Bend-Parser | | | |

## 10. Risiken

1. **Parallelität auf echten Teilen kann enttäuschen.**
   - Die Korpus-Schranken (Median 2,7 bis 3,0) zählen Ops, nicht Kosten.
   - In r10b kostete eine einzige Curved-Intersection 53 von 56 s.
   - Die einzigen nativen Parallelbelege sind synthetisch (Pockets) oder ein Fixture-Sweep.
   - Genau das misst der Spike.
2. **Native Abdeckung echter Teile.** Fast alle echten Teile brauchen Frustum und Coaxial/Pierce-Booleans oder
   Sketch-Profile (210 von 214 Kandidaten). Die sind nativ noch nicht validiert. Der Curved-Pfad ist in Bend 2.0.25 gar nicht emittierbar
   (Arity > 255). Bis dahin misst niemand etwas Nützliches auf Marcs echten Teilen.
3. **Graph-Größe durch if-Conversion:** 12 % der Graphen haben mehr als 1.000 Knoten (bis 11.118). Gegenmittel:
   totale Booleans im Kern, Knotenbudget, bewusste Breaks.
4. **Semantik-Drift**, falls doch ein zweiter FS-Auswerter entsteht. Gegenmittel: der Recorder im echten Interpreter,
   die Fidelity-Suite.
5. **Identity und Cache:** `geom`-Hashes ohne IDs, Identity-Labels mit IDs. Ohne getrennten Identity-Pass tragen
   Cache-Treffer falsche Labels. `kernel/identity.bend` hat dafür noch keine API.
6. **Numerik:** binary64-Residuen gegen F32x2 im Kern. Fenstervergleiche können an Grenzen kippen. Deshalb bleiben
   sie auf dem Host.
7. **Bend-Runtime:**
   - Pool-Worker-Fail-Stop beendet Node;
   - Fork nur über vorab gebaute Daten;
   - jede Auswerter-Änderung kostet 15 s und 3 bis 5 GB;
   - kein Library-Modus.
8. **Der Frontend-Boden:** Der r10b-Retrace dauert 1,0 s, davon 40 % in wonkys kopierendem `append`
   (`src/scalars.mjs`). Bei kleinen Edits wird er zur Grenze.
9. **build123d bleibt lange bei 1 von 294 Dateien,** solange der Shim nicht wächst. WK ändert daran nichts.
10. **Messbedingungen:** Load 12 bis 29, Absolutwerte schwankten 10 bis 40 % zwischen Läufen, Verhältnisse waren
    stabil.

## 11. Entscheidungstrigger

| Beobachtung | Folge |
|---|---|
| Spike: `dualHardware25` (oder der gewählte Ersatz) erreicht bei 4 Threads < 1,2x gegenüber dem seriellen nativen Pfad, bei identischen Ergebnissen | **kein `run_graph`.** WK/0 bleibt host-seitig (Preflight, Diff, Cache); die Bend-Seite bleibt reiner Kern |
| Spike: ≥ 2x bei 4 Threads auf einem echten Mehrteil-Modell, identische Ergebnisse | `run_graph` direkt nach dem Pool-Fail-Stop-Fix einplanen |
| kostengewichtetes W/S weicht stark von der Op-Count-Schranke ab (Faktor > 2) | Korpus-Parallelprognosen nur noch kostengewichtet; Op-Count-Schranken nicht mehr zitieren |
| Identity-Labels lassen sich nicht vom Geometrie-Cache trennen | kein Cache über Edits hinweg, bis Identity content-adressiert ist |
| Recorder mit `select`/`expect` bleibt deutlich unter 90 % der verarbeitbaren Dateien ohne Break | Breaks akzeptieren; if-Conversion nur, wenn `run_graph` gebaut wird |
| LLM-Studie: WPy oder Graph-Text ≥ build123d auf CPython | WPy v0 als Frontend auf WK/0 bauen |
| LLM-Studie: schlechter | WPy nur als Preflight-Werkzeug; build123d auf CPython mit stabilen IDs bleibt |
| Marc braucht regelmäßig Parameterstudien oder Variantenbäume | `--sweep` mit Hash-Consing vorziehen (2,8x bei 4 Threads auf Fixture gemessen) |
| Das In-Process-Binding scheitert oder wird Prozess-Dienst (22 bis 38 µs pro Aufruf) | Graph-Submission gewinnt an Wert (amortisiert IPC); `run_graph` vorziehen |
| Bend bekommt F64/I64, separate Kompilierung oder Library-Modus | Residual-Knoten nativ neu bewerten, einen FS-Interpreter in Bend weiterhin nicht |
| Nativer r10b-Lauf zeigt einen dominierenden Einzel-Op | Parallelität für r10b irrelevant; Kernalgorithmus priorisieren |

## 12. Der Spike, der jetzt gebaut wird

**Riskanteste Behauptung der Empfehlung:** Ein aus dem **unveränderten** FS-Interpreter aufgezeichneter WK/0-Graph
eines **echten** Teils von Marc läuft in einem nativen Bend-Graph-Auswerter mit dem Produktionskern:

1. mit Ergebnissen identisch zum heutigen Pfad;
2. mit einem **kostengewichteten** Fork-Join-Gewinn ≥ 1,2x gegenüber serieller nativer Ausführung derselben Ops.

Das ist die Evidenz, von der `run_graph`, also der einzige Teil der Idee, der wirklich nach Bend geht, abhängt. Bisher
gibt es sie nur auf Fixtures (frame-with-tab) und synthetischen Pockets.

**Ziel.** `run_graph` für Marcs echte Teile belegen oder widerlegen. Nebenbei prüft der Spike, dass ein Recorder im
echten Interpreter treue Graphen liefert und dass ein Host-Cache nach einem echten Edit identische Ergebnisse gibt.

**Umfang** (nur eigene Pfade: `src/lang/wk/**`, `kernel/lang/wk/**`, `scripts/lang/**`, `test/lang-wk*.test.mjs`,
`out/lang/wk/**`, `tmp/lang/**`):

1. **Recorder** `src/lang/wk/record-fs.mjs`.
   - `src/parser.mjs` und `src/interpreter.mjs` bleiben unverändert (nur lesend genutzt). Die Modellier-Builtins
     werden durch aufzeichnende ersetzt, nach `src/lang/dataflow/fs-trace.mjs`.
   - Ausgabe sind WK/0-Op-Records im core-ir-Knotenset: `extrude_polygon` auf beliebiger Ebene, Kreis-Extrude als
     `frustum`, `transform`, `pattern`, `boolean{kind, method}` (Methode nach den heutigen Host-Prädikaten) und
     `expect.count` für Count-Spekulation.
   - Die Kanonik übernimmt aus `canon.mjs` die Präzisionsregeln und die Regel für signierte Null.
2. **Nativer Auswerter:** `kernel/lang/wk/main.bend` erweitern.
   - Neue Ops: `frustum`, Extrude auf beliebiger Ebene (über `geometry.frame`/`lift_points`), `transform`,
     `boolean` mit den Methoden PLANAR, PIERCE und COAXIAL. Jede ruft genau die Kernfunktionen, die der heutige
     JS-Pfad bzw. das Compat-Backend aufruft.
   - Dazu `expect_count`, ein Seriell-Modus (gleiche Binary, Ebenen ohne Fork) und eine Zeit pro Knoten.
   - CURVED und alles andere ergibt einen Capability-Fehler mit Span.
   - Höchstens ein nativer Compile gleichzeitig.
3. **Host-Seite:** Identity-Labels werden getrennt aus (`full`-Hash, project-component-a8102813) über die heutigen Identity-Einstiege
   berechnet. Dazu kommt ein Host-Cache `geom`-Hash → Ergebnis für den Edit-Test.
4. **Messskript** `scripts/lang/wk-real.mjs`, Bericht `docs/language/spike-real-model.md`, Rohdaten
   `out/lang/wk/real/*.json`.

**Workloads** (Korpus nur lesend):

- **Schritt 0, Auswahl:** Jeder Kandidat wird einmal auf dem heutigen JS-Pfad gebaut, mit Einstiegszählung
  (`count-kernel-calls`). Genommen wird der erste Kandidat, der ohne CURVED-Methode baut. Die Auswahl wird
  protokolliert.
  1. `cad-project-039/belt-return-r25/dual-hardware-r25.fs`, Feature `dualHardware25`: 42 Booleans,
     69 Zylinder, Span 2, 37 Komponenten, Op-Count-Schranke 21.
  2. Ersatz in dieser Reihenfolge:
     - `cad-project-014/machine-interface-r11/interface-r11.fs` `fasteners` (Schranke 15,5);
     - `cad-project-039/archive-r16/hopper.fs` `hybridHopper` (64 Subtracts, Span 6, Schranke 10,7);
     - `cad-project-039/r21-expanded-hopper.fs` (Schranke 8,5).
- **Kontrolle „typisches Teil":** `cad-project-039/belt-central-r27/central-drive-r27.fs` `centralShafts26`.
  Rein planar mit allgemeinen Ebenen, 14 Booleans, Span 7, Schranke 2. Braucht voraussichtlich nur Einstiege des Planar-Slices (`geometry.frame`,
  `lift_points`, `topology.extrude`/`transform`, planare Booleans); Schritt 0 prüft das.
- **Regression:** frame-with-tab aus FS und build123d (identischer Graph, Hash 3141504600) und die 11 Programme der
  WK-Check-Suite.
- **Edit:** je Modell ein echter Literal-Edit aus `out/lang/dataflow/corpus.json`. Beispiel `dual-hardware-r25.fs`
  Zeile 88, 27,357… → 28,725…, macht 1 von 42 schweren Knoten schmutzig.

**Akzeptanz** (alle Läufe n ≥ 3, 1 / 2 / 4 Threads, `uptime` vor und nach jedem Lauf, getrennte Buckets für
Aufzeichnung, Encode, native Auswertung, Decode, Identity und Export):

1. **Treue:** Der Recorder liefert für alle Workloads einen Graphen ohne Break. Seine project-component-a8102813-Folge und Spannen sind
   gleich denen des echten JS-Builds (Fidelity-Suite). Interpreter und Parser sind byte-unverändert.
2. **Korrektheit:** Jeder Ausgabekörper hat denselben B-rep-Hash, dieselben F32x2-Volumenwörter, dieselbe
   Flächenzahl und dieselbe Geometrie-Revision wie der JS-Pfad. Identisch über 1, 2 und 4 Threads und über
   Wiederholungen. Identity-Labels sind gleich dem heutigen Body-JSON, oder jede Abweichung wird mit Ursache
   aufgelistet.
3. **Speed-Gate:**
   - Gemessen werden W (Seriell-Modus des Auswerters, dazu `WONKY_BACKEND=native` Einzelaufrufe, falls die Einstiege
     des Modells im Bridge-Build sind) und T4 (Graph mit Fork bei 4 Threads). Beide gehen gegen den heutigen
     JS-Pfad.
   - Entscheidungsregel: `dualHardware25` (oder Ersatz) W/T4 ≥ 1,2 erfüllt das Workload-Gate für `run_graph`,
     W/T4 < 1,2 verwirft es.
   - Die Kontrolle `centralShafts26` wird mit berichtet (erwartet etwa 1,0 bis 1,3).
4. **Kostengewichtung:** Aus den Knotenzeiten des Seriell-Modus wird das kostengewichtete W/S berechnet und neben die
   Op-Count-Schranke gestellt.
5. **Inkrementell:** Nach dem Edit werden nur schmutzige Knoten ausgewertet. Das Ergebnis ist identisch zum kalten
   Build der editierten Datei, Identity eingeschlossen. Die Zeit wird berichtet.
6. **Laute Fehler:** Je ein Test für CURVED-Methode, unbekannte Op und eine absichtlich falsche Count-Spekulation.
   Jeder ergibt einen Capability- bzw. Expect-Fehler mit FS-Span, ohne Rückfall.
7. **Build-Kosten:** Bend-zu-C-Zeit, clang-Zeit und Peak-RSS des Auswerters werden protokolliert.

**Nicht im Spike:**

- Änderungen an Binding, Addon oder `src/native` (`run_graph` im Addon ist Schritt 6);
- Pool-Worker-Fix;
- native Regionen (`select`, `fold`, `when`) und if-Conversion;
- WPy und jede Syntax;
- FS- oder Python-Auswertung in Bend;
- Soft-binary64;
- CURVED-Booleans und r10b nativ;
- GPU/Metal und mehr als 4 Threads;
- Produktionscode außerhalb der eigenen Pfade;
- persistenter Cache;
- build123d-Shim-Erweiterung.

## 13. Artefakte

- **Vorschläge und Prototypen:** `docs/language/proposal-*.md`, `src/lang/{wk,dataflow,surface,semcore}/`,
  `kernel/lang/{spike,wk}/`, `scripts/lang/`, `test/lang-{spike,semantic-core,wk,dataflow,surface}.test.mjs`.
- **Rohdaten:** `out/lang/wk/{census,check,native}.json`, `out/lang/dataflow/{corpus,fidelity,native}.json`,
  `out/lang/surface/{corpus,native,report}.json`, `out/lang/spike/run-2/report.json`, `out/lang/corpus.json`.
- **Schiedsspruch-Proben:** `tmp/lang/judge/scan-planar.mjs`, `tmp/lang/judge/scan-planar.json` (Planar-Anteil
  realer Features) und `tmp/lang/judge/probe-candidates.mjs` (Op-Profile der Spike-Kandidaten).

## Stand bei der Übernahme ins Repository (24.09.2026)

Die Entscheidung oben ist endgültig (ein internes Graph-IR WK/0, keine neue Sprache, kein Interpreter in Bend). Der WK/0-Prototyp (`src/lang/`, `kernel/lang/`, `scripts/lang/`) wird mit dem Stand eingecheckt, an dem seine Entwicklung stehen blieb: Die letzte Korrektur- und Prüfrunde wurde nicht abgeschlossen. Seitdem haben W2, W1-Fix und der r20-gate die Produktion verändert (F32x2-Prismen, Ebenenachse, Hybrid-Boolean). Drei Tests in `test/lang-wk-real.test.mjs`, die WK/0 gegen die heutigen Adapter vergleichen, sind deshalb als `todo` markiert. Bevor WK/0 weiterentwickelt wird, muss der Prototyp auf die aktuellen Adapter umgestellt werden. Das hat niedrige Priorität.
