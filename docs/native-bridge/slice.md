# Native Bridge: der planare Vertical Slice, gemessen

Stand: 2026-09-22, Nachbesserung 2026-09-23 (sechs Befunde der Verifikation, Abschnitt "Nachbesserung"), zweite
Nachbesserung 2026-09-23 (ein Befund: der Anfrage-Decoder, Abschnitt "Zweite Nachbesserung"), R20-Gate 2026-09-24
(Abschnitt "R20-Gate"). Bend 2.0.25,
Apple M5 Pro (18 logische CPUs), macOS arm64, Node v22.23.1, Apple clang 17. Plan:
[../native-bridge.md](../native-bridge.md), Abschnitt 11. Ausführliche englische Fassung mit Dateiliste, Aufbau,
Befehlen und der Tabelle aller Befunde: [prototype.md](prototype.md).

Die Maschine war mit anderen Workflows geteilt. Der Bench nach der zweiten Nachbesserung lief bei Load Average
**17 bis 24** auf 18 Kernen (der Bench der ersten Nachbesserung bei 28 bis 58, der erste Bench bei 13 bis 15); die
Werte stehen neben jeder Tabelle. **Alle Zeiten sind indikativ.** Jede Zahl in den Tabellen stammt aus
`out/native-bridge/slice/bench.json`, `churn.json`, `full-surface-build.json` bzw. `count-guard.json` und wird von
`scripts/native-bridge/slice-tables.mjs --de` gerendert; keine ist von Hand getippt. Alle Tabellen gelten für den
Build 079288cf6050 (19 Einstiege, vor dem W2-Re-Baseline, siehe nächster Abschnitt).

## Re-Baseline W2 (2026-09-23): F32x2-Profilring und Polygonprisma statt F32-Extrusion

Die Produktion baut polyedrische Körper seit W2 ([../corpus/w2-plan.md](../corpus/w2-plan.md), Aufgabe D) in F32x2:
`src/kernel.mjs` `extrudeInBend` ruft `profileRing.simplify` und `polygonPrism.extrude`, `transformInBend` ruft
`polygonPrism.transform` ([../polygon-prism.md](../polygon-prism.md)). Der Slice folgt:

- **`SLICE_OPS`** (`scripts/native-bridge/slice-ops.mjs`): `topology.bend:extrude`, `:transform` und
  `geometry.bend:frame`, `:lift_points`, `:translate` sind ersetzt durch `profile-ring.bend:simplify`,
  `polygon-prism.bend:extrude` und `polygon-prism.bend:transform`: **17 Einstiege** statt 19.
  `slice-ops.mjs --check` ist grün: die sechs Workloads rufen genau diese 17.
- **Aufrufzahlen neu gemessen** (`profile-workloads.mjs --modes count`, alle acht Workloads, einer nach dem anderen,
  Load 26 bis 34): `out/native-bridge/profile/calls/*.json`. Beispiel py-frame-with-tab: simplify 3, extrude 3,
  transform 2; kein `topology`-/`geometry`-Einstieg mehr.
- **`out/native-bridge/surface.json` neu erzeugt** (`surface-scan.mjs`): 83 Produktionseinstiege statt 85, mit
  Host-Annotationen für die drei neuen Einstiege und zwei neuen Präzisionsstellen (`decodePrism`: jedes F32x2-Wort
  als binary64 `+ 0`; `transformInBend`: der dekodierte Körper wird mit `real()` neu zerlegt).
- **Build** `node scripts/native-bridge/build-native.mjs --set planar`: neuer `sourceHash` **aa52ee4a870e**
  (vorher 3753e3e9f675; auch `kernel/ports/planar-boolean-arrangement.bend` `plane_equal` hat sich in W2 geändert),
  bend 12,9 s + clang 18,0 s, 2,4 MB `.node`, Load 38 bis 42; der zweite Lauf ist ein Cache-Treffer (119 ms).
- **Tests**: `test/native-bridge-slice.test.mjs` 26/26: die sechs Workloads byte-identisch nativ und js,
  `WONKY_BACKEND=diff` Wort für Wort mit den neu gemessenen Aufrufzahlen, beide Negativ-Workloads scheitern laut und
  ohne JS-Kernel. Geänderte Pins: 17 Ops; der Zählwächter (j) prüft 14 Ops mit List/String (vorher 15:
  vier Listen-Ops weg, drei dazu); der Default-`backend`-Block meldet für die Klammer `"precision": "F32x2"`.
- **Nicht neu gemessen**: die Tabellen unten (Wall-Zeiten, Faktoren, Churn, Zählwächter, volle Oberfläche) stammen
  vom Build 079288cf6050 mit den alten 19 Einstiegen. Neu messen mit `slice-bench.mjs --n 3` (3 bis 5 min) auf einer
  ruhigen Maschine; das Prisma kostet im JS-Target mehr als die F32-Extrusion (Profilring mit Big-Arithmetik,
  Inzidenz-Audit), die Faktoren können sich also verschieben.

## W2-Integrate-Fix (2026-09-24): Verschiebungen werden neu extrudiert, 16 Einstiege

Eine Verschiebung eines Prismas (Rotation exakt die Identität) geht nicht mehr an `polygonPrism.transform`:
`src/kernel.mjs` `transformInBend` summiert die Deckelursprünge in binary64 und ruft `polygonPrism.extrude` erneut
([../polygon-prism.md](../polygon-prism.md), [../corpus/w2.md](../corpus/w2.md)). Folgen für den Slice:

- **Aufrufzahlen neu gemessen** (`profile-workloads.mjs --modes count`, alle acht Workloads, Load 6 bis 8,
  local development evidence): jede Kopie der Workloads ist eine Verschiebung, `polygon-prism.bend:transform`
  wird von keinem Workload mehr gerufen (py-planar-union: extrude 2 → 3).
- **`SLICE_OPS` 17 → 16**: `polygon-prism.bend:transform` ist entfernt (`build-native` verweigert einen deklarierten,
  ungenutzten Einstieg). Eine gedrehte Prismakopie auf `WONKY_BACKEND=native` wird mit Namen verweigert
  ("kernel entry kernel/polygon-prism.bend:transform … is not in the native build").
- **`surface.json`** neu erzeugt (83 Produktionseinstiege, Aufrufstelle `prismInBend`), **Build** `4f5517688109`
  (vorher `35be4334852b`), bend 34,7 s + clang 39,1 s bei Load 77 bis 114.
- **Tests**: `test/native-bridge*.test.mjs` 60/60 nach zwei Pins (16 Ops; Zählwächter 11 Typen und 13 Ops statt 13 und 14).

## R20-Gate (2026-09-24): 38 Addon-Einstiege, der Hybrid-Boolean als Subprozess, getrackte Build-Eingaben

Aufgabe 12b des R20-Gates (local design note); Architektur und Begründung:
[../native-bridge.md](../native-bridge.md), Abschnitt 14. Worklog: local development evidence.

- **Build-Eingaben getrackt.** Build und Loader lesen nichts mehr unter `out/`: Karte, gemessene Einstiege je
  Workload, Smoke-Aufrufe und Hybrid-Smoke-Jobs liegen unter `src/native/` (`surface.json`, `slice-calls.json`,
  `smoke-calls.json.gz`, `smoke-hybrid.json.gz`); nur `scripts/native-bridge/slice-inputs.mjs` liest `out/` und
  erneuert sie. Eine Kopie aus `git ls-files --cached --others --exclude-standard` ohne `out/` und ohne `tmp/`
  (`.tools` und `node_modules` verlinkt) baut ohne Cache-Treffer denselben `sourceHash` **ee69b8228612**, und dort
  laufen KT6 und KT2 mit `WONKY_BACKEND=native` byte-identisch zum JS-Lauf des Arbeitsbaums, ohne JS-Kernel.
- **`src/native/surface.json` neu erzeugt** (`surface-scan.mjs`): 94 Produktionseinstiege statt 83, mit
  Host-Annotationen für die neuen Produktionseinstiege des Gates (`revolve.bend:sweep`, `volume.bend:volume`,
  `:mesh_snap`, `:mesh_bound`, `prism-boolean.bend:boolean`, die `tessellate.bend`-Einstiege des Druckmeshes);
  0 nicht unterstützte Produktionstypen.
- **`SLICE_OPS` 16 → 38**: die planaren 16 plus die 22 Einstiege, die KT6 und KT2 neben dem Hybrid rufen
  (Count-Läufe `--format print --deviation-mm 0.01`, `src/native/slice-calls.json`). Dazu der Subprozess
  `wonky-hybrid` für `loadKernel().hybrid`. Neue Workloads `r20-kt6`, `r20-kt2` (die Fälle liegen in Marcs
  R20-Projekt, nur gelesen).
- **Build** `node scripts/native-bridge/build-native.mjs --set planar`: Addon bend 10,3 s + clang 26,9 s, 11,2 MB C;
  `wonky-hybrid` bend 31,5 s + clang 24,6 s, 8,6 MB C, 3,5 MB Binary, `BANGS == 2` (nur im Subprozess erlaubt; das
  Addon bleibt bei 0). Load 16 bis 36. Der zweite Lauf ist ein Cache-Treffer (0,3 s).
- **Tests** (Load 7 bis 100): 101/101 in `test/native-bridge-slice.test.mjs` (mit dem Diff der Pins auf 38 Ops, siehe
  Aufgabenbericht), `test/native-hybrid.test.mjs`, `native-bridge-{wire,build-guard,binding}`,
  `planar-{boolean,difference}-native`, `sketch-arcs-native`.
- **Korrektheit.** KT6 und KT2 auf `native`: `brep.json` ohne `backend`-Block, `.step`, `.stl`, `print.json` und
  die Körperzeilen in jedem Sample byte-identisch zum `js`-Lauf; `scripts/r20/acceptance.mjs --cases kt6,kt2`
  2/2 PASS auf beiden Backends, r20-check-STL und Manifest byte-identisch. `WONKY_BACKEND=diff`: 0 Divergenzen;
  KT6 772 Addon-Aufrufe (3,4 M Wörter), 1 Hybrid-Antwort und 1 Klassentabelle zeichengleich; KT2 879 Aufrufe
  (5,1 M Wörter), 6 und 6. Die Aufrufzahlen je Einstieg sind gleich dem Count-Lauf. Guard: kein `data:`-Modul,
  kein Bend-Compiler, kein `.bend`-Import, einziges Addon `wonky-kernel.node`.

**Messung** (`slice-bench.mjs --only r20-kt6,r20-kt2 --n 3 --skip negative,firstload,threads6`,
`out/native-bridge/slice/bench-r20.json`). **Load 65 bis 127 auf 18 Kernen: stark indikativ.** Wall = Median
von drei frischen Prozessen je Backend, abwechselnd. Die Phasen kommen aus je einem Trace-Lauf (nativ:
`WONKY_NATIVE_TRACE`; js: `count-kernel-calls.mjs`, das jeden Aufruf instrumentiert und deshalb langsamer ist).
„Addon-Kern“ = Kern ohne Hybrid; „Hybrid“ = die Hybrid-Stufen (js) bzw. die `wonky-hybrid`-Prozesse (nativ).

| Phase (ms) | KT6 js | KT6 nativ | KT2 js | KT2 nativ |
|---|---:|---:|---:|---:|
| Wall, Median von 3 | 10.111 | 1.478 (**6,8x**) | 17.993 | 4.211 (**4,3x**) |
| Kaltstart bis Kern bereit | 3.615 | 87 (Öffnen 21, davon Stale-Check 18) | 3.829 | 174 (Öffnen 39, Stale-Check 35) |
| Addon-Kern | 5.393 | 1.213 (nativ 1.109, Encode 27, Decode 77) | 511 | 473 (nativ 387, Encode 6, Decode 79) |
| Hybrid | 293 | 22 (2 Prozesse) | 14.136 | 2.577 (12 Prozesse) |
| Frontend und Host | 119 | 63 | 275 | 148 |
| Export (STEP, STL, Druckmesh) | 88 | 26 | 551 | 158 |
| im Prozess gesamt | 9.509 | 1.412 | 19.303 | 3.529 |

- **Der Hybrid wird nativ 5,5x schneller** (KT2: 14,1 s → 2,6 s für sechs Schnitte). Innerhalb der Prozesse:
  corefine-Mesh 949 ms, Vorbereitung 511, recover-Abschluss 703, Schreiben 137; Prozessstart und Datei-Übergabe
  zusammen rund 120 ms für 12 Prozesse. Im Diff-Lauf rechnet das JS-Target dieselben Stufen in 13,2 s.
- **KT6 gewinnt vor allem am planaren Union** (5,1 s → 0,8 s) und am wegfallenden JS-Kernel-Load (3,6 s → 0,09 s).
- **Ein Befund gegen nativ:** `identity.bend:boolean_result` ist nativ langsamer als im JS-Target (KT6: 272 ms +
  64 ms Decode gegen 51 ms; KT2: 363 + 73 gegen 37 ms). Seine Antwort hat 3,3 M bzw. 5,0 M Wörter: Das Wire
  schreibt geteilte Teilbäume des Identitätsdatensatzes aus, das JS-Target reicht das geteilte Objekt weiter. Das
  ist der größte Rest im Addon-Kern von KT2 und der Grund, warum KT2s Addon-Kern kaum gewinnt. Abhilfe (offen):
  geteilte Struktur im Wire (Hash-Consing) oder eine schmalere Antwort.
- **Nicht gemessen:** 6 Threads, erster Load nach dem Rebuild, Negativfälle (übersprungen, sie sind unverändert
  durch den Slice-Test abgedeckt). Eine Nachmessung auf ruhiger Maschine ist offen.


- **Der In-Process-Weg trägt echte Workloads.** Mit `WONKY_BACKEND=native` laufen die sechs planaren Workloads über die
  unveränderten CLIs `bin/wonky.mjs` und `bin/wonky-python.mjs`. Der Bend-Kern läuft als ARM64-C im Node-Prozess
  (reines N-API-Addon, keine npm-Abhängigkeit). Das Bend-JS-Kernel wird nie geladen: Der Guard zeigt in jedem nativen
  Testlauf kein `data:`-Modul, keinen Bend-Compiler `main.ts`, keinen `.bend`-Import.
- **Bitgleich zum JS-Pfad.** `brep.json` ohne `backend`-Block, `.step`, `.stl`, `.html` und die Körperzeilen auf stdout
  sind in jedem Sample byte-identisch (3 Runden je Workload, dazu Trace-, Diff- und 6-Thread-Läufe).
- **Diff Wort für Wort.** `WONKY_BACKEND=diff` vergleicht jeden Aufruf der 19 Einstiege zwischen Addon und JS-Target:
  2.134 Aufrufe, 0 Divergenzen (gezählt aus Dump-Verzeichnissen und Trace-Zähler, nicht aus dem Exit-Code); die
  Anzahl je Einstieg ist gleich dem Count-Lauf des Profils.
- **Gemessen Ende-zu-Ende bei 1 Thread: 8,2 bis 11,7x** bei Load 18 bis 24 (frühere Benches: 8,5 bis 11,4x bei Load
  28 bis 58, 7,6 bis 12,6x bei 13 bis 15; Projektion 7,4 bis 9,3x). bracket 73 statt 850 ms, planar-union 302 statt
  2.681 ms, frame-with-tab 1.867 statt 15.236 ms.
- **Alles außerhalb der 19 Einstiege scheitert laut:** `NativeCapabilityError` (ein `UnsupportedFeatureError`, auch in
  `try silent` nicht fangbar), Exit 1, ohne JS-Kernel. Ein Fehler des nativen Backends selbst (Bridge-Fehler,
  Divergenz nativ/JS) beendet jetzt in beiden Frontends den Lauf; Python-Nutzercode kann ihn nicht mehr fangen. Es gibt
  keinen Rückfall auf das JS-Target.
- **Ein veralteter oder bearbeiteter Build lädt nie.** Der Loader rechnet den Build-Schlüssel bei jedem Öffnen neu:
  aktuelle Eingabedateien, aktuelle `loadKernel()`-Verdrahtung aus `src/kernel.mjs`, aktuelle Toolchain (Bend-Binary,
  Bend-Bibliothek, clang) und das Routing des Manifests; dazu sha256 der Binary und Wire-Hash der Codecs, alles vor
  `dlopen` (5,6 bis 6,8 ms pro Öffnen bei dieser Last).
- **Die Zeit pro Aufruf bleibt in einem langlebigen Prozess flach.** Jeder Aufruf beginnt jetzt auf einem leeren
  Bend-Heap. Ohne das wächst `identity.boolean_result` in 40 Wiederholungen von 56 auf 112 ms (in der Verifikation bis
  ~10x nach 150 Aufrufen); mit bleibt er bei 22 ms.
- **Eine fehlerhafte Anfrage kostet Arbeit nach ihrer Länge, nicht nach dem, was sie behauptet** (zweite
  Nachbesserung). Ein Zählwort, das der Rest der Anfrage nicht tragen kann, wird abgelehnt, bevor ein Element
  dekodiert ist: 4 Byte, die 2^25 Elemente behaupten, kosteten vorher 1,4 s und hinterließen 2,1 GiB RSS, jetzt unter
  0,1 ms und nichts. Der Smoke-Test jedes Builds prüft das.
- **Die volle Oberfläche (84 Einstiege) baut in unter einer Minute:** bend 17,4 s + clang 34,2 s, 4,2 MB `.node`,
  erster Load 232 ms, warm 0,5 ms (in der zweiten Nachbesserung neu gebaut, vom Loader nie geöffnet).
- **Befund unverändert:** Die Identity-Einstiege sind nativ **langsamer** als im JS-Target. Strings sind nativ
  Cons-Listen und gehen mit einem Wort pro Code Point über die Grenze. `identity.boolean_result` kostet bei
  frame-with-tab 87 ms nativ + 23 ms Decode (2,1 Mio. Antwortwörter) gegen 13 ms im JS-Target.

## Nachbesserung 2026-09-23

| # | Befund | Ursache | Behebung | Regressionstest |
|---|---|---|---|---|
| 1 | Diff + Python: `BackendDivergenceError` kam im Nutzercode als fangbarer `RuntimeError` an, `except Exception` schluckte ihn, Exit 0. | `src/python.mjs` meldet jeden Nicht-Capability-Fehler als `GeometryError`; nur `UnsupportedFeatureError` klebt. Der Bench leitete Divergenzen aus dem Exit-Code ab. | `endsRun(error)` (`NativeKernelError` oder `BackendDivergenceError`): `python.mjs` bricht den Python-Kindprozess mit diesem Fehler ab, statt zu antworten (eine Zeile, nur auf native/diff wirksam). Divergenz klebt im Diff-Kernel und erzwingt Exit 1, falls ein Host sie fängt. Der Bench zählt Divergenzen aus Dumps und Trace-Zähler. | (e) mit Fehlerinjektion in die unveränderten CLIs (`fault-inject.mjs`): Python/diff, Python/native `BX_WIRE`, FeatureScript/diff, fangender Host: jeweils Exit 1, das `except` läuft nie. |
| 2 | Umverdrahtung eines `loadKernel()`-Namensraums lief mit dem alten Modul weiter, ohne Stale-Fehler. | Routing kam aus `surface.json` mit handgepflegter Tabelle; `src/kernel.mjs` war keine Build-Eingabe. | `src/native/kernel-wiring.mjs` parst `loadJsKernel()` streng; Build leitet jeden Slot daraus ab; die Verdrahtung ist Teil des `SOURCE_HASH`; der Loader parst bei jedem Öffnen neu und nennt die genaue Änderung. `surface-scan.mjs` nutzt denselben Parser. | (c) Umverdrahtung `planarBoolean` → `planar-boolean-next.bend`, neues Feld, unbekannte Anweisung, Parser-Fälle. |
| 3 | Der Toolchain-Teil des Schlüssels wurde nie neu geprüft; eine Base-Änderung ließ eine veraltete Binary laden. | `staleCheck` rechnete mit `manifest.toolchain`. | `currentToolchain()` bei jedem Öffnen: Bend-Binary und -Bibliothek über Datei-Identität (dev, inode, Größe, mtime, ctime), bei Änderung neu gehasht; clang über einen Fingerabdruck, bei Änderung `clang --version`. Ein Cache-Treffer frischt eine veraltete Probe auf. | (c) Base geändert, Bend-Binary ersetzt, falsches `clang` vorne im `PATH`; Build-Test: Probe-Auffrischung. |
| 4 | Routing-Felder des Manifests und `node.sha256` waren nicht abgedeckt: union/subtract vertauscht lief falsch mit Exit 0. | `computeSourceHash` deckte nur `op.spec` ab; nur die Größe der `.node` wurde geprüft. | Schlüssel-Schema 2 deckt Op-Tabelle, Namensräume, Verweigerungstabelle und Verdrahtung ab; vor `dlopen` sha256 der Binary, Quell-Hash in der Binary, Wire-Hash aus den drei Codec-Dateien, fester Dateiname; nach `dlopen` müssen `info()`-Hashes, Set, Flags und Heap-Modus passen. | (c) zehn Manipulationen, jede `BX_STALE`, kein `dlopen`. |
| 5 | `WONKY_NATIVE_SET=full` wurde befolgt: der nie validierte 84-Op-Build lief mit dem Etikett "planar slice". | `locateBuild()` las `WONKY_NATIVE_SET`. | Der Loader öffnet nur den `planar`-Build; jeder andere Wert ist `BX_BACKEND`. `wonky-compare` kann nativ keinen Bericht schreiben (`comparison.coaxial` liegt außerhalb des Slices). | (i) |
| 6 | Zeit pro Aufruf wuchs in einem Prozess bis ~10x; RSS blieb flach. | Die Freilisten des Bend-Allokators behalten jede freigegebene Zelle früherer Aufrufe; spätere Aufrufe allozieren verstreut über den ganzen berührten Heap. | `bx_heap_clear()` nach jedem Slice-Aufruf: Bump-Zeiger auf Seite 1, Freilisten und Banken leer, statisches Abbild neu; Seiten bleiben gemappt. Zulässig, weil zwischen Slice-Aufrufen nichts im Heap lebt. | (h) jeder Aufruf beginnt auf Seite 1, Wiederholungen erreichen dieselben Seiten; ein `keep`-Kind zeigt den alten Zustand; Smoke-Test prüft dasselbe; `slice-churn.mjs` misst es. |

Produktionscode: `src/python.mjs` hat außer dem `backend`-Block eine abgesicherte Zeile bekommen (Befund 1). Das ist
eine Abweichung von den drei festgelegten Berührungspunkten; auf dem Default-Pfad ändert sie nichts, weil nur native
und diff solche Fehler werfen.

## Zweite Nachbesserung 2026-09-23: Dekodieren ist durch die Anfrage begrenzt

**Befund (Verifikation, mittel).** Eine fehlerhafte Anfrage ließ den Bend-seitigen Decoder im Verhältnis zur
*behaupteten* Anzahl arbeiten und allozieren, bevor er Status 1 antwortete: `backend.call(6, Uint32Array.of(0x2000000))`
(4 Byte, 2^25 `Vec3` behauptet) brauchte 1.397 ms und ließ den Host bei 2.103 MiB RSS (vorher 55 MiB) stehen; 2^28
brauchte 14,6 s und 17,2 GB maximale RSS; 2^32 − 1 hätte rund 270 GB gebraucht. Erreichbar nur über direktes
`addon.call` oder einen Encoder-Fehler, nie ein stilles falsches Ergebnis, aber 4 Byte dürfen keine Gigabytes binden.

**Ursache.** `gen-wire.mjs` erzeugte `dec_items_<T>(U32.to_nat(n), c)` bzw. `dec_str_chars(U32.to_nat(n), c)`: Das
Zählwort wurde zum Nat-Treibstoff, die Schleife dekodierte n Elemente ohne Prüfung und baute nach dem Ende der Wörter
weiter Null-Elemente. Das Heap-Leeren pro Aufruf setzt den Allokator zurück, nicht die Seiten, also blieb der
Höchststand resident. Der JS-Decoder prüfte `n > verbleibende Wörter` schon, der Bend-Decoder nicht.

**Behebung.**

- Der Cursor trägt `left`, die noch ungelesenen Wörter (`start(words)` zählt einmal, `take` zählt herunter). Unter
  2^32 Wörtern exakt; das Addon lehnt längere Anfragen mit `BX_ARGS` ab (16 GiB), darüber könnte die Prüfung nur zu
  streng sein, nie zu locker.
- Jede List- und String-Anzahl läuft durch ein generiertes `count(p, w)`: angenommen nur bei intaktem Cursor und
  `n <= left / w`, mit `w = minWords(Element)` vom Generator (die wenigsten Wörter, die ein Wert des Elementtyps
  belegt; 1 für String). Sonst wird die Anzahl 0 und der Cursor scheitert; nach jedem Fehler ist jede weitere Anzahl 0.
  Arbeit und Heap sind damit linear in der Anfragelänge, egal was die Zählwörter behaupten.
- Der JS-Decoder wendet dieselbe Regel an (`n * w > verbleibend`), beide lehnen an derselben Grenze ab. Die Menge der
  angenommenen Anfragen ist unverändert (eine Anzahl, die die Regel bricht, kann nie gültig sein). Der Generator lehnt
  Listen mit Elementen von null Wörtern ab (es gibt keine; die Kodierbarkeits-Übersicht ist vorher und nachher
  byte-gleich).
- Jeder native Build prüft sich selbst: Der Smoke-Test schneidet eine Beispielanfrage jeder Op an jedem Zählwort ab
  (`scripts/native-bridge/wire-probe.mjs`, 214 Proben planar, 456 voll) und verlangt für eine Behauptung von 1 und
  von 2^16 Status 1 und identische Heap-Seiten. Gegen den Build vor dem Fix (b49c55bd93eb) scheitern 214 von 214.

**Nachher** (Build 079288cf6050): Die Skripte der Verifikation antworten für jede Behauptung bis 2^32 − 1 in unter
0,1 ms mit `BX_WIRE`, die RSS bleibt bei 55 MiB. Im Bend-JS-Target wird eine 2^20-Behauptung in 0,03 bis 0,28 ms
abgelehnt (vorher 259 bis 3.495 ms). Auf 1.248 aufgezeichneten Aufrufen je Lauf sind alle Antworten gleich und die
Kernzeiten unverändert im Rauschen; das Zählen der Anfrage kostet rund 4 ns pro Wort (Tabelle "Zählwächter" unten).
Regressionstests: `test/native-bridge-slice.test.mjs` (j) (214 Proben mit 1, 2^20, 2^32 − 1: identische Heap-Seiten;
122 Proben mit 2^16 Elementen auf 2^16 Wörtern: abgelehnt wie eine unmögliche Anzahl; die Reproduktion der
Verifikation ohne RSS-Wachstum), `test/native-bridge-wire.test.mjs` (gleiche Grenze in JS-Codec und Bend-JS-Target,
2^20 in unter 250 ms, Nullbreiten-Ablehnung) und der Smoke-Test jedes Builds.

## Befehle

```sh
node scripts/native-bridge/vendor-node-api.mjs                  # Node-API-Header mit Provenienz, einmal pro Node-Version
node scripts/native-bridge/build-native.mjs --set planar        # kalt ~25-45 s unter Last, Cache-Treffer 0,1-0,4 s
WONKY_BACKEND=native node bin/wonky.mjs examples/bracket.fs --out out/bracket
WONKY_BACKEND=diff   node bin/wonky.mjs fixtures/public-boolean-regressions/adapted/cut-h1.fs --format step --out out/cut
WONKY_NATIVE_TRACE=trace.json WONKY_BACKEND=native node bin/wonky.mjs ...          # Zeiten pro Einstieg
node scripts/native-bridge/slice-bench.mjs --n 3                  # schreibt out/native-bridge/slice/bench.json (~3-5 min)
node scripts/native-bridge/slice-churn.mjs                        # langlebiger Prozess, out/native-bridge/slice/churn.json
node scripts/native-bridge/build-native.mjs --set full && node scripts/native-bridge/full-surface-report.mjs
node scripts/native-bridge/count-guard-bench.mjs --before <sourceHash>   # Zählwächter, out/native-bridge/slice/count-guard.json
node --test test/native-bridge-slice.test.mjs                     # 26 Tests, 85-172 s je nach Last
node scripts/native-bridge/slice-tables.mjs --de                  # diese Tabellen
```

Umgebung: `WONKY_BACKEND=js|native|diff` (ungesetzt = `js`, alles andere ist ein Fehler), `WONKY_NATIVE_THREADS`
(Default 1), `WONKY_NATIVE_CACHE`, `WONKY_NATIVE_TRACE`, `WONKY_DIVERGENCE_DIR`. `WONKY_NATIVE_SET` wird abgelehnt,
außer mit dem Wert `planar`.

## Methode

Jedes Sample ist ein frischer CLI-Prozess unter `/usr/bin/time -l`, `js` und `native` abwechselnd, `uptime` vor und
nach jedem Lauf. Jeder native, Diff- und 6-Thread-Lauf wird byte-weise gegen einen `js`-Lauf derselben Runde
verglichen. Der Trace-Lauf misst mit `WONKY_NATIVE_TRACE` und dem Phasen-Preload (`slice-phases.mjs`, schreibt nichts
auf die Platte um). Auf der `js`-Seite liefert `count-kernel-calls.mjs` die Kernzeit pro Einstieg; dieser Lauf ist
wegen der Instrumentierung langsamer als ein normaler. Buckets: **Kaltstart** = Prozess-Zeitursprung bis
`loadKernel()` aufgelöst (Node-Start, Modulgraph, nativer Open bzw. JS-Kernel-Load); **Kern** = Summe der Einstiege
(nativ: Encode + Aufruf + Decode); **Frontend + Host** = Build-Ende minus Kern bereit minus Kern (Parser, Interpreter,
Python-Kindprozess, Host-Adaption); **Export** = Build-Ende bis Exit; **Prozess-Overhead** = externe Wall minus
In-Prozess-Zeit. Die Tabelle zum langlebigen Prozess spielt 624 aufgezeichnete Aufrufe in je einem frischen Prozess
pro Heap-Modus ab (`slice-churn.mjs`).

## Ergebnisse

### Wall-Zeit, frische Prozesse, 1 Thread

| Workload | js ms (n=3) | native ms (n=3) | Faktor Median | Projektion | Abweichung | nativ projiziert ms | 6 threads ms | Ausgaben identisch | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 2780 / 2681 / 2637 | 302 / 311 / 293 | 8,87x | 8,38x | +6 % | 323 | 233 | ja | 21,17–22,02 |
| py-planar-pocket | 3856 / 3866 / 3842 | 454 / 468 / 478 | 8,23x | 9,32x | -12 % | 458 | 343 | ja | 22,07–23,80 |
| py-frame-with-tab | 14664 / 15236 / 15741 | 1922 / 1867 / 1839 | 8,16x | 8,03x | +2 % | 1725 | 1176 | ja | 21,19–24,30 |
| fs-fuse-g1 | 2394 / 2479 / 2467 | 327 / 221 / 230 | 10,74x | 9,01x | +19 % | 254 | 170 | ja | 19,23–19,60 |
| fs-cut-h1 | 6781 / 6311 / 6391 | 716 / 716 / 726 | 8,92x | 9,23x | -3 % | 673 | 476 | ja | 19,28–20,57 |
| fs-bracket | 888 / 847 / 850 | 74 / 71 / 73 | 11,65x | 7,40x | +57 % | 114 | 75 | ja | 18,22–18,76 |

### Buckets eines Trace-Laufs (ms ab Prozess-Zeitursprung)

| Workload | Backend | Kaltstart bis Kern bereit | davon Stale-Check / dlopen / init | Kern (nativ / Encode / Decode) | Frontend + Host | Export | Prozess-Overhead | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | native | 41,6 | 5,70 / 0,64 / 0,05 | 197,1 (189,2 / 2,47 / 5,43) | 42,0 | 5,2 | 14,9 | 21,17–21,17 |
| py-planar-union | js (count) | 1010,1 | – | 2245,7 | 54,2 | 5,1 | – | 21,17–22,91 |
| py-planar-pocket | native | 38,1 | 6,04 / 0,60 / 0,06 | 363,2 (352,5 / 2,63 / 8,07) | 43,8 | 8,7 | 15,3 | 22,07–22,07 |
| py-planar-pocket | js (count) | 935,6 | – | 3054,5 | 53,0 | 7,9 | – | 22,07–21,91 |
| py-frame-with-tab | native | 36,6 | 5,64 / 0,64 / 0,06 | 1703,9 (1672,4 / 4,23 / 27,27) | 49,0 | 11,0 | 21,8 | 23,33–22,90 |
| py-frame-with-tab | js (count) | 1082,2 | – | 12945,4 | 69,8 | 8,6 | – | 22,90–20,85 |
| fs-fuse-g1 | native | 40,0 | 6,07 / 0,60 / 0,06 | 155,6 (150,1 / 1,26 / 4,28) | 9,7 | 5,5 | 15,3 | 19,23–19,23 |
| fs-fuse-g1 | js (count) | 956,3 | – | 1558,0 | 14,5 | 4,3 | – | 19,23–19,23 |
| fs-cut-h1 | native | 40,4 | 6,78 / 0,47 / 0,05 | 651,9 (642,6 / 1,74 / 7,49) | 12,0 | 5,8 | 16,9 | 19,28–19,28 |
| fs-cut-h1 | js (count) | 873,5 | – | 5930,8 | 19,6 | 5,8 | – | 19,28–19,00 |
| fs-bracket | native | 41,9 | 5,80 / 0,76 / 0,07 | 2,9 (1,6 / 0,16 / 1,11) | 4,6 | 15,4 | 15,7 | 18,22–18,22 |
| fs-bracket | js (count) | 859,8 | – | 2,3 | 4,9 | 8,7 | – | 18,22–18,22 |

### Kernzeit pro Einstieg, Trace-Läufe (ms)

| Workload | Einstieg | Aufrufe | nativ | encode | decode | JS-Target (Count-Lauf) | Wörter hin / her |
| --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | planarBoolean.union | 1 | 167,73 | 0,22 | 0,70 | 2189,55 | 892 / 2441 |
| py-planar-union | curved.audit | 1 | 2,94 | 0,19 | 0,03 | 40,95 | 2128 / 10 |
| py-planar-union | solidIntersection.planar_measures | 1 | 0,11 | 0,06 | 0,04 | 2,95 | 1809 / 15 |
| py-planar-union | identity.boolean_result | 1 | 14,16 | 0,02 | 2,96 | 5,38 | 610 / 350539 |
| py-planar-union | identity.box | 2 | 1,30 | 0,04 | 0,87 | 3,20 | 192 / 35766 |
| py-planar-union | identity.transform | 1 | 1,15 | 1,04 | 0,25 | 0,34 | 17976 / 27753 |
| py-planar-union | analytic.curve_residual | 104 | 0,65 | 0,20 | 0,04 | 1,30 | 1976 / 208 |
| py-planar-pocket | planarBoolean.subtract | 1 | 307,94 | 0,20 | 1,23 | 2930,95 | 892 / 4317 |
| py-planar-pocket | curved.audit | 1 | 14,01 | 0,36 | 0,06 | 104,71 | 3748 / 10 |
| py-planar-pocket | solidIntersection.planar_measures | 1 | 0,22 | 0,10 | 0,04 | 4,22 | 3189 / 15 |
| py-planar-pocket | identity.boolean_result | 1 | 25,25 | 0,03 | 4,91 | 6,82 | 610 / 614059 |
| py-planar-pocket | identity.box | 2 | 1,33 | 0,04 | 1,02 | 3,09 | 192 / 35766 |
| py-planar-pocket | identity.transform | 1 | 1,15 | 0,90 | 0,23 | 0,33 | 17976 / 27753 |
| py-planar-pocket | analytic.curve_residual | 184 | 1,04 | 0,37 | 0,06 | 2,35 | 3496 / 368 |
| py-planar-pocket | analytic.surface_residual | 184 | 1,19 | 0,21 | 0,06 | 0,72 | 4600 / 368 |
| py-frame-with-tab | planarBoolean.union | 1 | 1233,88 | 0,14 | 0,37 | 9800,96 | 3046 / 5937 |
| py-frame-with-tab | planarBoolean.subtract | 1 | 299,50 | 0,20 | 0,80 | 2851,45 | 892 / 3001 |
| py-frame-with-tab | curved.audit | 2 | 41,27 | 0,42 | 0,07 | 262,26 | 7796 / 20 |
| py-frame-with-tab | solidIntersection.planar_measures | 2 | 0,50 | 0,19 | 0,05 | 5,75 | 6630 / 30 |
| py-frame-with-tab | identity.boolean_result | 2 | 86,84 | 0,04 | 23,02 | 13,27 | 1847 / 2106771 |
| py-frame-with-tab | identity.box | 3 | 2,03 | 0,05 | 1,09 | 4,12 | 288 / 53649 |
| py-frame-with-tab | identity.transform | 2 | 2,48 | 1,05 | 1,11 | 0,54 | 35952 / 55506 |
| py-frame-with-tab | analytic.curve_residual | 384 | 2,54 | 1,13 | 0,11 | 3,32 | 7296 / 768 |
| py-frame-with-tab | analytic.surface_residual | 384 | 2,66 | 0,44 | 0,09 | 1,25 | 9600 / 768 |
| py-frame-with-tab | transform | 2 | 0,05 | 0,19 | 0,04 | 1,04 | 342 / 320 |
| fs-fuse-g1 | planarBoolean.union | 1 | 135,60 | 0,22 | 0,74 | 1519,75 | 892 / 1879 |
| fs-fuse-g1 | curved.audit | 1 | 1,48 | 0,18 | 0,03 | 26,71 | 1642 / 10 |
| fs-fuse-g1 | solidIntersection.planar_measures | 1 | 0,08 | 0,06 | 0,03 | 2,50 | 1395 / 15 |
| fs-fuse-g1 | identity.boolean_result | 1 | 10,05 | 0,05 | 2,00 | 3,50 | 547 / 255378 |
| fs-fuse-g1 | identity.box | 1 | 0,66 | 0,03 | 0,54 | 1,67 | 96 / 17883 |
| fs-fuse-g1 | identity.extrusion | 1 | 0,81 | 0,03 | 0,40 | 0,92 | 97 / 22679 |
| fs-fuse-g1 | analytic.curve_residual | 80 | 0,47 | 0,14 | 0,03 | 1,35 | 1520 / 160 |
| fs-cut-h1 | planarBoolean.subtract | 1 | 600,08 | 0,33 | 0,96 | 5802,78 | 1284 / 4320 |
| fs-cut-h1 | curved.audit | 1 | 14,01 | 0,21 | 0,09 | 109,41 | 3748 / 10 |
| fs-cut-h1 | solidIntersection.planar_measures | 1 | 0,23 | 0,12 | 0,05 | 3,71 | 3189 / 15 |
| fs-cut-h1 | identity.boolean_result | 1 | 23,30 | 0,05 | 4,31 | 7,09 | 547 / 577674 |
| fs-cut-h1 | identity.box | 1 | 0,61 | 0,02 | 0,35 | 1,11 | 94 / 17567 |
| fs-cut-h1 | identity.extrusion | 1 | 1,56 | 0,03 | 1,21 | 2,09 | 99 / 44337 |
| fs-cut-h1 | analytic.curve_residual | 184 | 1,16 | 0,35 | 0,06 | 2,65 | 3496 / 368 |
| fs-cut-h1 | analytic.surface_residual | 184 | 1,15 | 0,23 | 0,05 | 0,76 | 4600 / 368 |
| fs-bracket | identity.extrusion | 1 | 1,49 | 0,04 | 0,90 | 1,74 | 111 / 36882 |

### Differenzläufe (WONKY_BACKEND=diff)

| Workload | Exit | verglichene Aufrufe | verglichene Wörter | Divergenzen | = Profil-Count-Lauf | = dieser Count-Lauf | Ausgaben = js | wall ms | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 0 | 253 | 417947 | 0 | ja | ja | ja | 3335 | 22,91–23,80 |
| py-planar-pocket | 0 | 413 | 683663 | 0 | ja | ja | ja | 4171 | 21,91–21,19 |
| py-frame-with-tab | 0 | 839 | 2228042 | 0 | ja | ja | ja | 15450 | 20,85–19,57 |
| fs-fuse-g1 | 0 | 202 | 299009 | 0 | ja | ja | ja | 2619 | 19,23–20,57 |
| fs-cut-h1 | 0 | 422 | 645880 | 0 | ja | ja | ja | 6946 | 19,00–18,76 |
| fs-bracket | 0 | 5 | 37163 | 0 | ja | ja | ja | 785 | 18,22–18,22 |

### Negativfälle auf native

| Workload | Exit | wall ms | erster verweigerter Einstieg | JS-Kernel geladen | load 1m |
| --- | --- | --- | --- | --- | --- |
| fs-bored-spacer-print | 1 | 58 | `kernel/precise.bend:frame` | nein | 18,22–18,22 |
| fs-r10b-strict | 1 | 106 | `kernel/precise.bend:dot` | nein | 18,22–18,22 |

### Laden des Addons

| Fall | dlopen ms | load 1m |
| --- | --- | --- |
| erster Load nach Rebuild (Smoke-Kind des Builds) | 222,3 | 17,26 |
| zweiter Load nach Rebuild | 0,52 | 17,26 |
| frische Kopie, fs-bracket-Lauf first (wall 304 ms) | 220,98 | 18,22–18,22 |
| frische Kopie, fs-bracket-Lauf second (wall 74 ms) | 0,61 | 18,22–18,22 |

### Builds

| Set | Ops | bend s | clang s | C MB | .node MB | erstes dlopen ms | warmes dlopen ms | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| planar | 19 | 6,6 | 9,0 | 4,56 | 2,29 | 222,3 | 0,52 | 17,66–17,26 |
| full (84) | 84 | 17,4 | 34,2 | 12,07 | 4,16 | 231,5 | 0,54 / 0,51 / 0,55 | 20,79–17,47 |

### Stale-Check der Trace-Läufe (ms)

| Workload | gesamt | Eingabedateien | wiring | toolchain | Schlüssel | .node sha256 | Codecs | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 5,70 | 1,94 | 0,45 | 1,36 | 0,19 | 1,17 | 0,47 | 21,17–21,17 |
| py-planar-pocket | 6,04 | 2,35 | 0,44 | 1,43 | 0,21 | 1,15 | 0,35 | 22,07–22,07 |
| py-frame-with-tab | 5,64 | 2,03 | 0,42 | 1,37 | 0,20 | 1,12 | 0,39 | 23,33–22,90 |
| fs-fuse-g1 | 6,07 | 1,85 | 0,42 | 1,35 | 0,67 | 1,17 | 0,38 | 19,23–19,23 |
| fs-cut-h1 | 6,78 | 1,81 | 0,41 | 1,47 | 0,57 | 2,03 | 0,37 | 19,28–19,28 |
| fs-bracket | 5,80 | 1,83 | 0,40 | 1,34 | 0,54 | 1,15 | 0,42 | 18,22–18,22 |

### Ein langlebiger Prozess: Zeit pro Aufruf mit und ohne Heap-Leeren pro Aufruf

Aufgezeichnet: 624 Aufrufe (cut-h1.fs, fuse-g1.fs), 8 Durchläufe, danach 40 Wiederholungen der schwersten Anfrage je Einstieg; jede Antwort mit der Aufzeichnung verglichen (alle exakt).

| Heap | Durchlauf 1 / letzter ms | identity.boolean_result ms (1st → last quarter) | planarBoolean.subtract ms | planarBoolean.union ms | Heap-Seiten letzter Aufruf | max RSS MiB | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- |
| leeren (Produktion) | 788 / 794 | 22,2 → 22,1 (0,99x) | 607,9 → 607,8 (1,00x) | 134,1 → 134,7 (1,00x) | 353 | 125 | 16,83–16,95 |
| behalten (vor dem Fix) | 783 / 843 | 56,4 → 112,5 (1,99x) | 647,4 → 654,5 (1,01x) | 141,0 → 143,4 (1,02x) | 14017 | 126 | 16,95–17,11 |

### Zählwächter: der Build davor gegen diesen Build (frische Prozesse, abwechselnd)

Builds: b49c55bd93eb (davor) / 079288cf6050 (danach); 624 aufgezeichnete Aufrufe (cut-h1.fs, fuse-g1.fs) × 2 Durchläufe × 3 Runden je Build; Antworten auf beiden Builds gleich der Aufzeichnung: alle. Load 1m davor 16,48–18,72, danach 16,52–18,72.

| Einstieg | Aufrufe je Durchlauf | Median ms davor | Median ms danach | danach / davor |
| --- | --- | --- | --- | --- |
| planarBoolean.subtract | 1 | 645,264 | 635,469 | 0,98x |
| planarBoolean.union | 1 | 147,606 | 143,815 | 0,97x |
| identity.boolean_result | 2 | 17,388 | 17,125 | 0,98x |
| curved.audit | 2 | 7,676 | 7,749 | 1,01x |
| identity.extrusion | 2 | 1,213 | 1,201 | 0,99x |
| identity.box | 2 | 0,634 | 0,633 | 1,00x |
| solidIntersection.planar_measures | 2 | 0,143 | 0,228 | 1,59x |
| real.max | 2 | 0,016 | 0,014 | 0,88x |
| extrude | 4 | 0,015 | 0,015 | 1,00x |
| geometry.frame | 4 | 0,012 | 0,014 | 1,17x |
| geometry.lift_points | 4 | 0,008 | 0,008 | 1,00x |
| geometry.translate | 4 | 0,007 | 0,007 | 1,00x |
| identity.box_layout | 2 | 0,007 | 0,008 | 1,14x |
| faceClassifier.linear_edge | 60 | 0,007 | 0,007 | 1,00x |
| faceClassifier.max_budget | 4 | 0,007 | 0,006 | 0,86x |
| analytic.curve_residual | 264 | 0,006 | 0,006 | 1,00x |
| analytic.surface_residual | 264 | 0,006 | 0,006 | 1,00x |

| Zählwort von | min. Wörter je Element | Proben | Heap-Seiten, Anspruch 1 / 2^16, davor | Heap-Seiten, Anspruch 1 / 2^16, danach | max. ms eines 2^16-Anspruchs, davor / danach |
| --- | --- | --- | --- | --- | --- |
| `List<precise.bend:Vec3>` | 6 | 17 | 161 / 6305 | 161 / 161 | 11,19 / 0,036 |
| `List<analytic.bend:Edge>` | 16 | 16 | 161 / 18593 | 161 / 161 | 15,66 / 0,053 |
| `List<analytic.bend:Face>` | 21 | 24 | 161 / 18593 | 161 / 161 | 9,61 / 0,032 |
| `List<analytic.bend:Loop>` | 2 | 24 | 161 / 3233 | 161 / 161 | 3,58 / 0,011 |
| `List<topology.bend:Coedge>` | 2 | 25 | 161 / 3233 | 161 / 161 | 2,44 / 0,018 |
| `List<face-classification.bend:DomainChoice>` | 1 | 21 | 161 / 1697 | 161 / 161 | 3,54 / 0,020 |
| `String` | 1 | 71 | 129 / 1665 | 129 / 129 | 3,85 / 0,570 |
| `List<identity.bend:ParentIdentity>` | 4 | 5 | 129 / 4225 | 129 / 129 | 3,69 / 0,083 |
| `List<geometry.bend:Vec3>` | 3 | 5 | 97 / 4097 | 65 / 65 | 3,30 / 0,005 |
| `List<identity.bend:EntityIdentity>` | 10 | 3 | 129 / 10369 | 129 / 129 | 4,70 / 0,008 |
| `List<topology.bend:Edge>` | 2 | 1 | 97 / 3137 | 97 / 97 | 1,79 / 0,006 |
| `List<topology.bend:Face>` | 10 | 1 | 129 / 10337 | 97 / 97 | 3,54 / 0,006 |
| `List<real.bend:Real>` | 2 | 1 | 97 / 3105 | 65 / 65 | 1,84 / 0,004 |

Proben: 214 je Lauf; Heap-Seiten, die vom Anspruch abhängen: davor 214 / 214 / 214, danach 0 / 0 / 0. Eine Heap-Seite sind 128 Wörter (1 KiB).

Bench: 2026-09-23T03:05:29.889Z – 2026-09-23T03:08:28.368Z, build 079288cf6050 (Cache-Treffer), load 22,02 → 18,22.

## Abweichungen von der Projektion

Die Projektion stammt aus `out/native-bridge/proposal-functional/projection.json` (1 Thread, gemacht bei Load 11,6
bis 14,7). In diesem Lauf (Load 18 bis 24) weicht nur fs-bracket um mehr als 20 % ab, nach oben (+57 %): nativ 73 ms
gegen projizierte 114 ms (`js` 850 ms, profiliert 841 ms). Die Projektion übernahm den ganzen Nicht-Kern-Rest des
profilierten `js`-Laufs, zu dem durch die ESM-Hooks des Bend-Compilers gebremstes Modulladen gehörte; ein nativer
Prozess registriert diese Hooks nie (im ersten Bench aus demselben Grund +70 %). Alle anderen Faktoren liegen innerhalb
von 20 % (fuse-g1 +19 %, planar-pocket -12 %, planar-union +6 %, cut-h1 -3 %, frame-with-tab +2 %); die nativen
Mediane liegen -10 bis +8 % um ihre Projektion (planar-union 302 gegen 323 ms, frame-with-tab 1.867 gegen 1.725 ms).
Im Bench der ersten Nachbesserung (Load 28 bis 58) wichen planar-pocket, fuse-g1 und fs-bracket um +21 bis +22 % ab,
weil die `js`-Seite unter der Last stärker gebremst wurde.

## Einordnung

- **Die Faktoren sind über drei Benches bei sehr verschiedener Last stabil**: 8,2 bis 11,7x (Load 18 bis 24), 8,5 bis
  11,4x (28 bis 58), 7,6 bis 12,6x (13 bis 15). Die absoluten Zeiten folgen der Last (planar-union `js` 2,7 s hier,
  5,9 s bei Load 28 bis 58; nativ 0,30 s bzw. 0,64 s).
- **Die zwei Gewinnquellen der Entscheidung sind bestätigt.** Der JS-Kernel-Load entfällt: Kaltstart bis Kern bereit
  37 bis 42 ms nativ gegen 860 bis 1.082 ms `js`. Die Booleans laufen 7,9 bis 13x schneller als in den
  `js`-Count-Läufen (die jeden Aufruf instrumentieren; die `js`-Seite ist dadurch etwas überhöht).
- **Der Zählwächter kostet Ende-zu-Ende nichts Messbares:** auf 624 aufgezeichneten Aufrufen, abwechselnd auf dem Build
  davor und diesem, sind alle Antworten gleich und die Einstiege im Rauschen (subtract 645 → 635 ms, union 148 → 144 ms,
  `identity.boolean_result` 17,4 → 17,1 ms). Das Zählen der Anfrage kostet rund 4 ns pro Wort und fällt nur bei
  kleinen, schnellen Einstiegen mit langen Anfragen auf (`planar_measures`, 1,4 bis 3,2 Tsd. Wörter: 0,14 → 0,16 bis
  0,25 ms). Eine 2^16-Behauptung erreichte vorher 1.665 bis 18.593 Heap-Seiten (1,6 bis 18 MiB) und bis 15,7 ms,
  nachher genau die Seiten einer Behauptung von 1 (höchstens 161).
- **Das Heap-Leeren kostet nichts Messbares und beseitigt die Drift:** 22,2 → 22,1 ms mit, 56,4 → 112,5 ms ohne; die
  maximale RSS bleibt gleich (125 bzw. 126 MiB), weil die Seiten gemappt bleiben.
- **Identity** (siehe Kurzfassung): `identity.boolean_result` braucht nativ 10,1 bis 86,8 ms pro Lauf (plus 2,0 bis
  23,0 ms Decode), das JS-Target 3,5 bis 13,3 ms. Gepackte Strings, Identity im Host oder ein nativer Revisions-Hash
  sind Entscheidungen außerhalb dieses Slices; die Messung zeigt, dass sie zählen.
- **6 Threads** (sekundär, je ein Lauf): 1,3 bis 1,6x gegen den 1-Thread-Median bei den fünf Boolean-Workloads, 1,0x bei
  fs-bracket, Ausgaben identisch. Default bleibt 1 Thread, weil ein Fail-Stop auf einem Pool-Worker den Prozess beendet.
- **Erster Load nach Rebuild:** rund 0,2 bis 0,3 s einmalig (macOS-Erstprüfung einer neuen Binary; einmal 3,1 s bei
  Load 110), danach 0,5 bis 0,6 ms. Eine frische Kopie derselben Binary zahlt erneut.
- **Der Stale-Check** kostet 5,6 bis 6,8 ms pro Öffnen (Eingabedateien 1,8 bis 2,4 ms, Toolchain 1,3 bis 1,5 ms,
  sha256 der `.node` 1,1 bis 2,0 ms, Verdrahtung 0,4 ms).

## Laute Fehler (test/native-bridge-slice.test.mjs, 26 Tests, alle grün)

| Fall | Ergebnis |
|---|---|
| bored-spacer nativ | `NativeCapabilityError` am ersten fremden Einstieg `precise.frame` (Frustum-Aufbau), mit Build und Backend; Exit 1; nichts exportiert; kein JS-Kernel |
| Zylinder-Extrude in `try silent` | derselbe Fehler durchbricht `try silent`; auf `js` baut das Snippet beide Körper |
| r10b nativ | Exit 1 nach 0,1 bis 0,2 s bei `precise.dot`; kein JS-Kernel; `r10b.fs` unverändert |
| geänderte Eingabedatei, bearbeitetes Manifest (Toolchain, Routing, Verdrahtung, Set), `.node` oder ihr sha256, Codecs | `NativeKernelStaleError` (`BX_STALE`) mit Änderung und Build-Befehl, vor jedem `dlopen` |
| umverdrahtete oder unlesbare `loadKernel()`-Verdrahtung | `BX_STALE` mit der genauen Änderung |
| geänderte Toolchain (Bend-Bibliothek, Bend-Binary, clang) | `BX_STALE` mit dem geänderten Feld |
| Build fehlt | `NativeKernelError BX_LOAD` mit Build-Befehl, CLI Exit 1 |
| fehlerhafte Wörter / unbekannte Op / falsche Argumenttypen | `BX_WIRE` (Status 1) bzw. `BX_ARGS`; der nächste gültige Aufruf gelingt; ein nicht exakt als F32 darstellbarer Wert (0,1) ist `BX_ARGS`, nie gerundet |
| List- oder String-Anzahl, die der Rest der Anfrage nicht tragen kann (bis 2^32 − 1) | `BX_WIRE` (Status 1), bevor ein Element dekodiert ist; Heap-Seiten wie bei einer Behauptung von 1; kein RSS-Wachstum (j) |
| Divergenz oder Bridge-Fehler unter breitem Python-`except`, in FeatureScript, von einem Host gefangen | Lauf endet mit dem Fehler, das `except` läuft nie, Exit 1 |
| Heap-Zustand pro Aufruf | jeder Aufruf beginnt auf Seite 1; `keep` nachweislich nicht |
| `WONKY_NATIVE_SET=full`, `wonky-compare` nativ | `BX_BACKEND` bzw. Capability-Fehler, Exit 1, nichts geschrieben |
| ungültiger `WONKY_BACKEND` (`fast`, leer) | `BX_BACKEND`, CLI Exit 1 |
| synthetischer Diff-Mismatch | `BackendDivergenceError` mit Op, Einstieg, Wortindex, Feldpfad (`result.lo (F32)`) und Dump |
| `WONKY_BACKEND` ungesetzt | `backend`-Block byte-identisch zu vorher |

Dazu: Build-Abbrüche (fehlende FID, Stelligkeit, `BANGS`, Nicht-List-Signatur, Breitenwarnung, Smoke-Test, Lock),
Probe-Auffrischung beim Cache-Treffer, die sechs Workloads byte-identisch mit Guard, und die Diff-Zählungen pro
Einstieg. Nach der Nachbesserung unverändert grün mit ungesetztem `WONKY_BACKEND`: `native-bridge-wire`,
`planar-boolean-native`, `planar-difference-native`, `python`, `python-cli`, `native-bridge-binding` (baute die Probe
mit dem geänderten `bx_addon.c` neu) sowie `kernel`, `identity`, `source-map`, `step-pcurves`,
`step-cylinder-pcurves`, `analytic`, `boolean`. Das volle `npm test` lief nicht (geteilte Maschine). Nach der zweiten Nachbesserung grün: `native-bridge-slice` (26),
`native-bridge-wire` (11), `native-bridge-binding` (7, baute Probe und Kernel-Addon mit dem geänderten Treiber und
Generator neu), `planar-boolean-native` und `planar-difference-native` (14, `WONKY_BACKEND` ungesetzt).

## Abweichungen vom Plan und Lücken

1. Die Negativfälle scheitern an `precise.frame` bzw. `precise.dot`, nicht an `analytic.frustum` / `boolean.coaxial`:
   Das sind die ersten Einstiege außerhalb des Slices, die Frustum-Aufbau und r10b-Import erreichen.
2. `nativeChainExact` bleibt absichtlich `false`: Der Compat-Schritt behält die Host-Rundreise auf beiden Backends bei.
3. `src/python.mjs` wurde über den `backend`-Block hinaus geändert (eine Zeile, Befund 1), ohne Wirkung auf den
   Default-Pfad.
4. Pfade an `loadKernel()` vorbei (Viewer, Diagnose-Adapter, `loadSketchArcs`, `section`, Boolean-Ports) sind nicht
   umgeleitet. Keiner liegt auf dem Produktionspfad der beiden CLIs; der Guard belegt das für alle gemessenen Läufe.
5. Code anderer Workflows setzt weiter das JS-Target voraus: `src/lang/semcore/build.mjs` schreibt fest
   `target: 'JavaScript'`, `src/lang/dataflow/py-trace.mjs` hat eine eigene Kopie der Python-Fehlerabbildung ohne
   `endsRun`. Beide sind keine Produktions-CLIs und liegen außerhalb meiner Pfade. `src/comparison.mjs` kann nativ gar
   nicht laufen.
6. Der schnelle Toolchain-Pfad vertraut den im Manifest aufgezeichneten Datei-Identitäten (`ctime` ist aus dem
   Userspace nicht setzbar); nur ein absichtlich gefälschter Identitätseintrag zusammen mit einer ersetzten Toolchain
   käme am Neu-Hashen vorbei.
7. Das Heap-Leeren behält die maximal berührten Seiten gemappt; die RSS schrumpft nicht (`madvise` ist außerhalb).
   Seit der zweiten Nachbesserung folgt dieser Höchststand der Länge der tatsächlich gesendeten Anfragen.
8. Jeder String-Schlüssel des Proxys ist eine Funktion; kein Produktionscode zählt den Namensraum auf (per grep geprüft).
9. `reset()` nach einem Fail-Stop ist über den Proxy nicht erreichbar; die CLI endet mit dem Fehler.
10. Die Messung der vollen Oberfläche (84 Einstiege) wurde in der zweiten Nachbesserung mit aktuellem Treiber,
    Schlüssel-Schema und Generator neu gebaut (Smoke-Test mit 456 Zählproben).
11. `scripts/native-bridge/gen-wire.mjs` wurde in der ersten Runde geändert (schnellere String-Codecs, gleiche Wörter
    und Werte) und in der zweiten Nachbesserung (Zählregel auf beiden Seiten, `start`/`done`/`count`, `minWords`).
12. Das Zählen der Anfrage vor dem Dekodieren kostet rund 4 ns pro Wort (0,07 ms bei der längsten Slice-Anfrage mit
    17.976 Wörtern). Die Länge vom Addon mitzugeben würde das sparen, kostet aber eine zweite `kcall`-Signatur.
13. Die 2^32-Wort-Grenze des Addons ist nicht durch einen Test abgedeckt (bräuchte ein 16-GiB-`Uint32Array`).
14. Eine gültige Anfrage kann den Kernel weiter über einen Wert zu Arbeit bringen: `identity.extrusion` (`n`) und
    `identity.boolean_result` (`vertices`, `edges`, `faces`) erzeugen so viele Identitäten, wie die U32-Argumente sagen.
    Das ist Kernel-Semantik, gleich im JS-Target; eine Grenze gehört in `kernel/identity.bend` (außerhalb meiner Pfade).
15. Wie geplant nicht im Slice: `api.bend` und Carrier, Handles, Batching, Metal, Threads > 1 als Default, CLI-Flags,
    Cache-Ort unter `.tools/`, Einstiege gekrümmter Modelle, r10b nativ.
