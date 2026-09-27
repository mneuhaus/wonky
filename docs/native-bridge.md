# Native Bridge: Entscheidung, Architektur und erster Slice

Stand: 2026-09-22. Bend 2.0.25, Apple M5 Pro (18 logische CPUs), macOS arm64, Node v22.23.1.
Rolle dieses Dokuments: Schiedsspruch über die drei Architekturvorschläge und verbindlicher Plan.

Grundlage sind ausschließlich die Messberichte und Artefakte in `docs/native-bridge/`:
[profile.md](native-bridge/profile.md), [surface.md](native-bridge/surface.md), [binding.md](native-bridge/binding.md),
[baseline.md](native-bridge/baseline.md) und die Vorschläge [functional](native-bridge/proposal-functional.md),
[resident](native-bridge/proposal-resident.md), [batched](native-bridge/proposal-batched.md). Für dieses Dokument
wurde nichts neu gemessen. Alle Quellmessungen liefen auf der geteilten Maschine bei Load Average 11,5 bis 15,2
(beim Schreiben 11,4 bis 12,8). Absolute Millisekunden sind **indikativ**. Jede End-to-End-Zahl unten ist eine
**Projektion aus gemessenen Teilen**, keine End-to-End-Messung. Die erste echte End-to-End-Messung liefert der Slice
(Abschnitt 11).

## 1. Kurzfassung

**Das Modell ist CPython mit C-Extension.** Der Interpreter bleibt, wo er ist: FeatureScript-Parser, Interpreter und
build123d-Shim bleiben JS. Die schwere Arbeit, also der Bend-Geometriekern, läuft nativ als ARM64-Code **im selben
Node-Prozess**, als N-API-Addon (`node_api.h`, keine npm-Abhängigkeit). JS ruft ihn über eine kleine, synchrone
Schnittstelle, so wie Python `numpy`s C-Kern ruft. Das Bend-zu-JS-Target bleibt als **Referenz-Backend** hinter
derselben Schnittstelle. Es ist die Vergleichsinstanz für Differenztests und der Weg ohne C-Toolchain. Es ist
**kein Fallback**: Welches Backend läuft, wird explizit gewählt und nie still gewechselt.

Die Kernaussagen:

1. **In-Process funktioniert und ist der Mechanismus.** Die Binding-Stufe hat Bend-emittiertes C unverändert in ein
   N-API-Addon gebaut (per Skript, ohne Handedits) und echte, erfasste Produktionsaufrufe
   `planarBoolean.union/subtract` im Node-Prozess ausgeführt: **Wort für Wort identisch** mit dem JS-Target bei 1, 6
   und 18 Threads, **8,3 bis 9,7x schneller** bei 1 Thread. Ein leerer Aufruf kostet 0,5 µs. Der
   Prozess-Dienst (Pipe) ist messbar schlechter und bleibt nur als optionale Isolationsschicht.
2. **Woher der Gewinn kommt:** aus zwei Quellen, beide ohne Umbau des Frontends.
   - Der Kern läuft nativ (k ≈ 8,3 bis 9,7 bei 1 Thread, 12,8 bis 15,3 bei 6 Threads, gemessen auf 4 Aufrufen).
   - Das Bend-JS-Kernel wird gar nicht erst geladen. Das spart 0,75 bis 0,81 s pro CLI-Lauf.
   Projiziert: **6,6 bis 9,3x Ende-zu-Ende bei 1 Thread** für alle profilierten Workloads außer r10b, bis etwa 13x bei
   6 Threads. Kleine Modelle (bracket) gewinnen ~7,4x nur durch den wegfallenden JS-Kernel-Load.
3. **Entscheidung: ein Hybrid mit dem funktionalen Vorschlag als Rückgrat.** Zuerst ein **generiertes,
   feinkörniges Kompatibilitäts-Backend**, das die heutigen Kerneinstiege nativ bedient, bitgleich zu heute. Das
   liefert die ganze gemessene Geschwindigkeit mit minimalem Eingriff. Danach werden die Einstiege gruppenweise durch
   wenige grobe Operationen mit **exakten Carriern** ersetzt (behebt `nativeChainExact: false`). Residente Handles
   (resident) und Batching (batched) sind **spätere, optionale Implementierungen hinter derselben API** und kommen
   nur, wenn Messungen sie rechtfertigen.
4. **r10b läuft nativ noch nicht.** `ports/curved-intersection.bend:intersect` lässt sich mit Bend 2.0.25 nicht als C
   emittieren ("an arity over 255", im Kern selbst). Das native Backend verweigert diesen Pfad laut mit einem
   Capability-Fehler. Das ist Kernarbeit, keine Bridge-Arbeit.
5. **Was jetzt gebaut wird (Abschnitt 11):** ein Vertical Slice mit 19 generierten Einstiegen, der die sechs planaren
   Workloads (drei build123d, drei FeatureScript) Ende-zu-Ende nativ ausführt, bitgleich gegen das JS-Target,
   ohne das JS-Kernel zu laden, mit getrennten Zeit-Buckets und lauten Fehlern für alles außerhalb des Slices.
   Produktionscode ändert sich nur hinter `WONKY_BACKEND=native|diff`.

## 2. Messbefund

### 2.1 Wohin die Zeit heute geht

Aus [profile.md](native-bridge/profile.md), attribuierte Basis (GC dem verursachenden Bucket zugeschlagen):

| Workload | Wall heute (plain) | Kernel | Bend-JS-Load | Rest in JS | dominanter Aufruf |
|---|---:|---:|---:|---:|---|
| py-planar-union | 2,7 s | 70 % | 25 % | ~5 % | `planarBoolean.union` 97 % der Kernzeit |
| py-planar-pocket | 4,3 s | 80 % | 17 % | ~3 % | `planarBoolean.subtract` 96 % |
| py-frame-with-tab | 13,9 s | 94 % | 5 % | ~1 % | union + subtract 98 % |
| fs-fuse-g1 | 2,3 s | 68 % | 28 % | ~4 % | union 97,5 % |
| fs-cut-h1 | 6,2 s | 87 % | 11 % | ~2 % | subtract 97,8 % |
| fs-bracket | 0,84 s | 0,3 % | 87 % | ~13 % | keiner |
| fs-bored-spacer-print | 0,87 s | 4 % | 82 % | ~14 % | keiner |
| fs-r10b-strict | 55 s | 98 % | 1,3 % | <1 % | `curvedIntersection.intersect` 99,9 % |

- **Zwei Regime.** Boolean-lastige Läufe verbringen 68 bis 98 % im Kern. Kleine Modelle verbringen 82 bis 87 % damit,
  das Bend-JS-Kernel zu laden (Cache-Validierung 0,44 s, 4,8 MiB JS importieren 0,15 s, Compiler-Hooks 0,16 s).
- **Was in JS bleibt, ist klein:** Parser plus Interpreter höchstens 0,7 %, Host-Adaption (Encoder, `decodeSolid`,
  Identity, Validierung) höchstens 0,42 % bzw. 16 ms, Export höchstens 2,1 %. Node-Start plus `src`-Modulgraph
  ~75 bis 80 ms.
- **Die Aufrufgranularität ist unkritisch.** 5 bis 839 Kernaufrufe pro Lauf (r10b 18.604). Bei 0,5 bis 1 µs pro
  Aufruf und ~6 bis 7 ns pro Wort kostet die Grenze höchstens 1,3 ms pro Lauf (r10b 25 ms).
- **Im Kern selbst:** Bei den planaren Booleans liegen ~70 % unter `classify_cell` (Strahlklassifikation mit
  F32x2-Arithmetik). 17 bis 20 % der Kern-Selbstzeit sind JS-Runtime-Overhead (`run_loop`, `f32_bits`), den es nativ
  nicht gibt. Bei r10b sind 94 % vier Listen-Folds in `solid-classification.bend`: algorithmisch, nicht
  backend-bedingt.

### 2.2 Die Decke, wenn der Interpreter in JS bleibt

Bleibt alles außer dem Kern in JS, ist die Untergrenze der Laufzeit genau der JS-Rest: ~93 bis 160 ms pro CLI-Lauf
(r10b ~240 ms). Daraus folgt die Decke für k → ∞ bei nicht geladenem JS-Kernel (profile.md, Tabelle C):

| Workload | Decke k → ∞ | bei k = 7,5 | bei k = 25 |
|---|---:|---:|---:|
| py-planar-union | 19x | 6,9x | 12,4x |
| py-planar-pocket | 33x | 7,3x | 16,1x |
| py-frame-with-tab | 97x | 7,4x | 20,9x |
| fs-bracket | 7,8x | 7,7x | 7,8x |
| fs-cut-h1 | 63x | 7,6x | 19,7x |

- **Mit weiter geladenem JS-Kernel** bleibt jeder CLI-Lauf bei ≥ 0,75 s und kleine Modelle gewinnen 1,00 bis 1,04x.
  Deshalb ist die harte Regel: **Das native Backend lädt das JS-Kernel nie.**
- **Den Interpreter nach Bend zu portieren, bringt nichts Messbares.** Frontend plus Host-Adaption sind ≤ 1,1 % jedes
  Laufs; sie in den Kern zu schieben, hebt keine Decke um mehr als 1,7 % (profile.md, B gegen A). Marcs Richtung
  ist also auch durch die Messung gedeckt.
- **Die Lücke zu OCCT bleibt algorithmisch.** frame-with-tab braucht nativ bei 6 Threads ~1 s Kernzeit gegen 9,4 ms
  bei OCCT. Die Bridge schließt diese Lücke nicht.

## 3. Bewertung der Vorschläge

Kriterien je 0 bis 10: S = End-to-End-Speed für Marcs FDM-Teile, E = Exaktheit, F = Fehlersemantik und Robustheit,
M = inkrementelle Migration, D = Dev-Loop, P = Parallel-/GPU-Spielraum, A = Einfachheit der API.

| Vorschlag | S | E | F | M | D | P | A | Gesamt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **functional** (zustandslos, `call(op, words)`, Carrier, Compat-Schritt zuerst) | 9 | 9 | 8 | 9 | 7 | 5 | 9 | **8,2** |
| **resident** (Handles im Bend-Heap, Sessions) | 7 | 9 | 6 | 6 | 7 | 6 | 5 | **6,6** |
| **batched** (Recorder, Graph-Flush, Fork-Join, Sweeps) | 6 | 7 | 5 | 5 | 7 | 8 | 3 | **5,9** |

### 3.1 Nachrechnung

Ich habe die Arithmetik aller drei Vorschläge gegen `profile/summary.json`, `runs.json` und
`binding/kernel-t{1,6}.json` nachgerechnet. Sie stimmt im Rahmen der Rundung:

- **functional, frame-with-tab:** s = 13.851 / 15.471,1 = 0,8953; Rest in JS 0,8953 × 157,1 = 140,7 ms; N = 292,3 +
  1.249,4 = 1.541,7 ms; übrige Kernzeit 313,9 / 9,48 = 33,1 ms; + 5 + 5 ms → 1.725 ms, **8,03x**. ✓
- **functional, planar-union:** 0,859 × 164 = 140,9 ms + 168,6 + 52,0 / 9,48 + 10 = 325 ms → 8,3x (Dokument: 8,38x
  mit O = 3 ms). ✓
- **resident, frame-with-tab:** 157,1 + 14.507,8 / 8,51 + 1 + 5 + 1,27 = 1.868 ms → 8,28x. ✓
- **batched, frame-with-tab:** 157,0 + 14.508 / 8,52 + 0,97 + 1,27 = 1.862 ms → 8,31x; k = (2.703 + 10.424) /
  (292,3 + 1.249) = 8,52. ✓
- **6 Threads:** 168,6/112,7 = 1,50; 307,3/196,5 = 1,56; 292,3/177,1 = 1,65; 1.249/813,5 = 1,54. ✓

Die drei Vorschläge kommen auf verschiedenen Basen (plain-Wall W gegen Profil-T) auf 1.673 bis 1.863 ms für
frame-with-tab, also ±5 %. Das ist konsistent.

### 3.2 Abzüge für nicht gedeckte Behauptungen

- **Alle drei:** fuse-g1 und cut-h1 sind extrapoliert (kein nativer Aufruf gemessen). k für den Nicht-Boolean-Rest
  (`curved.audit` 282 ms bei frame-with-tab, Identity, Residuen) ist angenommen. Addon-Load eines großen Addons ist
  angenommen (1 bis 5 ms); gemessen ist nur die 1,2-MB-Probe (0,97 ms warm, 287 ms beim ersten Laden). Der
  6-Thread-Gewinn ist unter Last 14 bis 15 gemessen. Keiner der drei hat das als Messung ausgegeben; das ist
  korrekt. Der Slice muss genau diese Lücken schließen.
- **functional:** "Compat-Schritt bitgleich zu heute" ist plausibel (153 Dispatch-Replays wortgleich, 695 Werte
  bitgenau), aber für die build123d-Fälle nur an den zwei Boolean-Einstiegen nativ belegt. Die Clang-Zeit für das
  volle 84-Einstiege-Addon (12 MB C) ist unbekannt; die Schätzung 20 bis 60 s ist geraten. Der Slice startet deshalb
  mit 19 Einstiegen statt 84.
- **resident:** Der erste auslieferbare Schritt (S1) bringt nur 2,4 bis 5,2x, weil das JS-Kernel geladen bleibt.
  Die volle Geschwindigkeit kommt erst nach dem Session-Umbau aller Adapter (Schritt 4). Residenz bringt gemessen
  **keine** Zeit (native Kette 1.521 ms gegen Umweg über JS 1.501 bis 1.513 ms) und kostet Lebensdauer-Verwaltung,
  zwei Repräsentationen pro Körper und den Verlust aller Körper bei einem Fail-Stop. Der Vorschlag sagt das selbst
  ehrlich. Wertvoll sind die Details: Statuscode "unavailable in this build", Kontext-String für Pool-Fail-Stops,
  FP-Canary im Build, `BANGS == 0`-Assertion, `madvise` im Reset, und der Finalizer-Befund (0 von 40.000 Callbacks
  während eines synchronen Builds).
- **batched:** Die eigene Messung zeigt **null Gewinn** auf allen acht Workloads (W/S 1,000 bis 1,056, ≤ 0,18 %).
  Der einzige messbare Parallelfall (r10b `g2 ∥ g4`, W/S 1,86) liegt auf dem nicht emittierbaren Curved-Pfad. Die
  Sweep-Projektion "18 Varianten, ~60x gegen heute" ist **nicht gedeckt**: Sie überträgt p = 10,1 aus einem anderen
  Workload (Durchgangsbohrungen) auf planare Booleans, deren 18-Thread-Skalierung unbekannt ist, und ignoriert, dass
  eine Runtime pro Prozess alle Aufrufe serialisiert und die Threads schon im Boolean selbst stecken (1,5x). Wertvoll
  sind: `sync-trace.mjs` als Evidenz (1 Flush pro Build reicht bei spekulativem Recorder) und der **Record-only-Lint**,
  der drei r10b-Blocker ohne Kernlauf in < 0,3 s fand.

## 4. Entscheidung und Mechanismus

**Mechanismus: In-Process, N-API-Addon.** Belegt durch [binding.md](native-bridge/binding.md):

- Bend hat keinen Library-Modus (`bend --help`, `cli_file`: keine Option dafür). Der Wrapper braucht keinen:
  `bx_pre.h` leitet sechs Prozess-Aufrufe per Makro um (`_exit` → `siglongjmp`, `sigaction` verkettet statt
  ersetzt, `main` → `bend_cli_main`, stderr-Capture, Guard-Pages, Metal-Archivpfad). Das emittierte C bleibt
  unverändert.
- Direktaufruf `corpus_eval` auf eine gebundene FID mit `List<U32>` hinein und heraus: 0,5 µs Boden, bitgenau, Kern
  so schnell wie als eigenes Binary (169,5 gegen 168,6 ms).
- Prozess-Dienst im Vergleich: 22 bis 38 µs pro Aufruf, 26 bis 29 ms pro MB, braucht einen blockierenden Client im
  synchronen Interpreter. Er bleibt **nur** als optionale Isolationsschicht für langlebige Hosts, die Deadlines oder
  Schutz vor Pool-Worker-Fail-Stops brauchen.
- Eine reine Shared Library, die JS per `dlopen` aufruft, bräuchte eine FFI-Schicht. Node 22 bringt keine stabile
  eingebaute mit, und ein npm-FFI-Paket wäre eine neue Abhängigkeit. Das N-API-Addon **ist** diese Shared Library,
  nur mit dem Lader (`process.dlopen`), den Node schon mitbringt.

**Architektur-Entscheidung: Hybrid.**

| Idee | Herkunft | Wann |
|---|---|---|
| eine Backend-Schnittstelle `call(op, Uint32Array) → Uint32Array`, drei Implementierungen `native`, `js`, `diff` | functional | ab Slice |
| generiertes Compat-Backend mit heutiger Namespace-Form, bitgleich zu heute | functional (surface Schritt 1) | Slice, dann Schritt 1 |
| JS-Kernel wird im nativen Modus nie geladen; Exporter laden Bend nicht beim Import | alle | Slice |
| Statuscodes inkl. "unavailable in this build", `info().unavailable[]` | resident | Slice (als Capability-Fehler), API-Schritte |
| FP-Flags gepinnt (`-ffp-contract=off -fno-fast-math`) in den Source-Hash, Build-Smoke-Test mit erfassten Aufrufen | functional + resident | Slice |
| grobe Ops in `kernel/service/api.bend`, exakte Carrier (Antwortwörter unverändert weiterreichen) | functional | Schritte 2 bis 8 |
| Pro-Op-Module für das JS-Target (kalter Compile der Gesamt-Hülle dauerte 394 s) | resident | ab Schritt 2 |
| Kontext-String für Pool-Worker-Fail-Stops, `madvise` im Reset | resident | Schritt 5 (Robustheit) |
| Residente Handles hinter den Carriern (opak für den Host) | resident | nur bei Beleg: Körper ≥ ~1M Wörter oder nativer Per-Body-Zustand (prepared solids) mit gemessenem Gewinn |
| Record-only-Lint (`--record-only`) | batched | optional nach Schritt 3, braucht keinen nativen Kern |
| Batch-/Sweep-Policy, Fork-Join über Komponenten | batched | nur wenn ein nativ emittierbarer Workload W/S > 1,2 zeigt oder Sweeps real gebraucht werden |
| Metal | alle | aus; Kriterien in Abschnitt 8 |

Begründung für "zustandslos zuerst": Die Exaktheit, die Residenz verspricht, liefern Carrier genauso (die Antwort-
wörter eines Körpers gehen per `TypedArray.set` unverändert in die nächste Anfrage). Das kostet bei heutigen Größen
≤ 0,2 ms pro Op und braucht keine Lebensdauer-Regeln. Weil Carrier für den Host opak sind, kann ein Handle später
einen Carrier **innerhalb der Fassade** ersetzen, ohne dass Frontends etwas merken.

## 5. API

### 5.1 Ebene 0: das Addon (`wonky-kernel.node`)

```
init({ threads })                  -> { heapReservedBytes }     // einmal pro Prozess; zweites Mal BX_ONCE
call(op: number, req: Uint32Array) -> Uint32Array               // kcall(op, words); Antwort [status, ...payload]
info()                             -> { apiVersion, wireHash, sourceHash, bend, clang, flags, napi, threads, target, ops[], unavailable[] }
reset()                            -> undefined                  // nur nach BX_FAILSTOP (~0,1 ms)
stats()                            -> { calls, poisoned, rssKiB }
```

- Eine einzige gebundene Bend-Def: `def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>`, von einem
  generierten `main` aus erreichbar. Das ist die Form, die die Binding-Stufe auf dem echten Kern bewiesen hat;
  sie übersteht Bends Inlining und das Zerlegen nicht-rekursiver Datentypen.
- Der Treiber prüft den Op-Bereich (Bend kompiliert `match` auf U32 zu if/else und würde sonst still den letzten
  Arm ausführen). Der generierte Dispatcher endet zusätzlich in einem expliziten Arm "unknown op".
- Anfrage wird per `napi_get_typedarray_info` ohne JS-Kopie gelesen. Handles (`read/dup/drop`), IO-Brücke (`run`)
  und `gpuBuild` bleiben Probe-Werkzeug und kommen nicht ins Produktions-Addon.

### 5.2 Ebene 1: die Backend-Schnittstelle (JS, intern)

```js
interface KernelBackend {
  kind: 'native' | 'js' | 'diff';
  info: { target, apiVersion, wireHash, sourceHash, bend: '2.0.25', threads };
  call(op: number, request: Uint32Array): Uint32Array;   // synchron
}
```

- `native`: `addon.call`.
- `js`: generierter JS-Decoder → JS-Target-Def → generierter JS-Encoder. Gleiche Statuscodes.
- `diff`: beide, Vergleich Wort für Wort, bei Abweichung `BackendDivergenceError{op, wordIndex, fieldPath}` plus
  Replay-Dump.

Statuscodes (Antwortwort 0): 0 ok, 1 fehlerhafte Anfrage, 2 unbekannte Op, 3 falsche Art/Anzahl, 6 in diesem Build
nicht verfügbar. Fachliche Ablehnungen des Kerns (`Refused{code, stage, detail}`, `Unresolved`, Decline-Codes) sind
**Werte im Payload**, keine Status.

### 5.3 Ebene 2a: Compat-Namespace (Slice und Schritt 1)

`loadKernel()` liefert im nativen Modus einen generierten Proxy mit exakt der heutigen Form
(`kernel.extrude`, `kernel['geometry.frame']`, `kernel.planarBoolean.union`, `kernel.curved.audit`, ...). Jede Funktion
kodiert ihre Argumente mit den generierten JS-Encodern, ruft `call(op, words)` und dekodiert in exakt die Wertform des
JS-Targets (`{$: 'Real', hi, lo}`, `Con`/`Nil`). Adapter in `src/` bleiben unverändert. Einstiege, die nicht im Build
sind, werfen beim Aufruf einen Capability-Fehler (Abschnitt 7).

### 5.4 Ebene 2b: die schmale Fassade (Zielzustand, Schritte 2 bis 8)

`src/native/kernel-api.mjs`, Ops implementiert in `kernel/service/api.bend` (bzw. `api/ops/*.bend`), für beide
Targets aus derselben Quelle:

```js
openKernel({ backend = process.env.WONKY_BACKEND ?? 'js', threads, build }) -> Kernel
kernel.info
kernel.extrudePolygon({ points, plane: {origin, normal, x}, delta, offset, box }) -> Built
kernel.frustum({ first, second?, delta?, offset })                                -> Built | Refused
kernel.sketchLines(segments)          -> { profile, points, uses } | Refused
kernel.sketchArcs(entities)           -> { profile, view } | Refused
kernel.extrudeProfile({ profile, plane, delta, offset })                          -> Built | Refused
kernel.transform(body, { rows, offset })                                          -> Built
kernel.boolean({ a, b, operation, method: PLANAR|CONVEX|CURVED|PIERCE|COAXIAL, policy, tolerance })
                                      -> { bodies: Built[], provenance, stats, sourceBudget } | Refused
kernel.importBrep(onshapeSolid)       -> Built | Refused
kernel.identify(kind, request)        -> IdentitySet
kernel.stepPcurves(body, budget), kernel.printMesh(body, deviation), kernel.compareCoaxial(a, b, tolerance)
// Built = { view (heutige Body-JSON-Form), audit } + modulprivater exakter Carrier (WeakMap<view, Uint32Array>)
```

Bend-Seite:

```
type Body is Data:
  Polyhedral{solid: T.Solid, measures: Measures}
  Analytic{solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real,
           tolerances: List<&2, R.Real>, primitive: Primitive, measures: Measures}
type Primitive is Data:  NoPrimitive{} | Frustum{bottom, top, r0: R.Real, r1: R.Real}
type Measures  is Data:  Measures{volume: Maybe<&2, R.Real>, bounds: Maybe<&2, A.Bounds>, rule: U32}
```

`method` wählt JS weiter mit den heutigen Prädikaten (sie lesen nur diskrete Typen und exakte Nullen, verlieren also
nichts); Bend prüft die Zulassung erneut und lehnt sonst ab. Der Viewer (`display_mesh`) bleibt ausdrücklich auf dem
JS-Referenz-Backend.

### 5.5 Wire und Versionierung

- Flacher Strom little-endian U32. `F32` = Bitmuster, `Real` = genau 2 Wörter (hi, lo), **nie binary64**. `Bool` 0/1,
  ADT = Tag (bei > 1 Konstruktor) + Felder, `List`/`String` = Anzahl + Elemente, `Maybe` = Tag + Wert.
- `API_VERSION` (U32) und `WIRE_HASH` (sha256 des generierten Manifests) sind im Addon und in `wire.mjs`
  eingebacken; beim Öffnen müssen sie gleich sein.
- `SOURCE_HASH` ist der Build-Schlüssel (Abschnitt 9). `brep.json` bekommt `backend: {language, version, target,
  apiVersion, sourceHash, threads}`. Heute ist `target: 'JavaScript'` hart kodiert (`src/index.mjs:39`,
  `src/python.mjs:178`).

## 6. Exaktheit

1. **Bits über die Grenze:** F32 und F32x2 gehen als Bitmuster in beide Richtungen (gemessen: 21 Sonderwerte,
   4.096 F32x2-Wörter mit -0, Subnormalen, NaN-Payloads, ±inf; kein Flush-to-Zero).
2. **Beide Backends sind bitgleich.** Gleiche Bend-Quelle, gleiche Anfragewörter, Vergleich Wort für Wort. Gemessen
   auf 4 echten Kernaufrufen bei 1, 6 und 18 Threads und 153 Dispatch-Replays.
3. **Ketten werden exakt, aber erst mit Carriern.** Heute kollabiert `src/real.mjs:9` (`hi + lo`) F32x2 zu binary64,
   und `src/analytic.mjs:132` (`encodeAnalytic`) spaltet beim nächsten Aufruf neu. Von 9.784 Result-Reals ändern sich
   131. Das ist die Ursache von `nativeChainExact: false`. Das Compat-Backend (Slice, Schritt 1) behält diese
   Rundreise **auf beiden Backends** bei und ist deshalb bitgleich zu heute. Ab Schritt 2 gehen Körper als Carrier
   unverändert weiter; dann ändern sich Mehr-Operationen-Ergebnisse in den letzten Bits (Revisions-Hashes, evtl.
   STEP-Ziffern). Das passiert pro Op-Gruppe, auf beiden Backends gleichzeitig, mit einer von Marc freigegebenen
   Golden-Liste.
4. **Wo binary64 legitim bleibt:** Eingabe-Serialisierung (FeatureScript- und Onshape-Zahlen sind binary64; `real()`
   spaltet einmal), Views für Abfragen, JSON und Export, und Werte, die durch FeatureScript-Nutzercode laufen.
5. **FMA:** Das emittierte Muster (`f32_rewrap(f32_unbox(..)*..)`) kontrahiert laut clang-Reproduktion nicht; der
   Build pinnt trotzdem `-ffp-contract=off -fno-fast-math` und hasht die Flags in den Build-Schlüssel. Metal baut
   Bend schon mit `--fmad=false`.
6. **NaN:** Payloads sind nicht kanonisch (clang faltet `x*1.0`). Geometrie muss endlich sein; Decoder lehnen
   nicht-endliche Geometrie ab, der Diff vergleicht rohe Wörter.
7. **Lint ab Schritt 2:** Die Präzisionsstellen-Tabelle aus `surface-scan.mjs` wird zur Prüfung: Am Ende darf kein
   Produktionspfad einen View neu kodieren (`refeed`).

## 7. Fehlersemantik: nie ein stiller Rückfall

| Situation | JS sieht | Prozess |
|---|---|---|
| fachliche Ablehnung (`Refused`, `Unresolved`, Decline-Code) | wie heute: `UnsupportedFeatureError` an der FeatureScript-Quellstelle, von `try`/`try silent` nicht fangbar | läuft |
| Kern-Audit fehlgeschlagen | wie heute: `fail()` | läuft |
| Einstieg/Op nicht in diesem Build (Slice: alles außer den 19; später: Curved-Intersection) | `NativeCapabilityError extends UnsupportedFeatureError`: "kernel entry `<modul:def>` is not in the native build `<sourceHash>`; run with WONKY_BACKEND=js" | läuft, Build scheitert; **kein** Lauf auf JS |
| fehlerhafte Anfrage, unbekannte Op, Wire-/API-Mismatch | `NativeKernelError` (`BX_ARGS`, `BX_WIRE`, `BX_ABI`); ein Bridge-Bug, nie fangbar aus FeatureScript | läuft |
| Addon fehlt, veraltet, falsche Arch/N-API | `NativeKernelError BX_LOAD` bzw. `NativeKernelStaleError` mit geänderten Dateien und Build-Befehl, **vor** jeder Modellierung | Exit 1 |
| Fail-Stop auf dem aufrufenden Thread (Nat-Überlauf, Stack-Überlauf, Heap-OOM) | `NativeKernelError BX_FAILSTOP` mit Bend-Text; Runtime vergiftet bis `reset()` | läuft |
| Fail-Stop auf einem Pool-Worker (threads > 1 oder `!` im Modul) | nichts; stderr `bend: <Grund>` + Kontext | **Exit 1** (laut) |
| Divergenz im Diff-Modus | `BackendDivergenceError{op, wordIndex, fieldPath}` + Dump unter `tmp/native-bridge/divergence/` | läuft |
| Op kehrt nie zurück | nicht unterbrechbar im Prozess; Ctrl-C beendet die CLI | Isolationskind bei Bedarf |

- **Invariante:** Kein Fehlerpfad des nativen Backends ruft das JS-Backend. Das JS-Kernel wird nur geladen, wenn
  `WONKY_BACKEND` `js` (Default) oder `diff` ist. Ein Test prüft, dass ein nativer Prozess kein `data:`-Modul und
  keinen Bend-Compiler (`main.ts`) lädt.
- **Threads:** Bei 1 Thread und ohne `!` läuft alle Arbeit auf dem aufrufenden Thread; jeder Fail-Stop ist dann eine
  fangbare Exception. Der Slice und langlebige Hosts laufen mit 1 Thread. Die CLI darf später 6 Threads nutzen
  (1,5 bis 1,65x gemessen, 18 bringen nichts), dann endet ein Pool-Fail-Stop mit Exit 1 und Kontext auf stderr. Der
  saubere Fix ist eine CPU-Variante des vorhandenen kooperativen `H_ERROR_CODE`-Pfads der Runtime (Upstream-Anfrage
  oder skriptierter, versionierter Patch, nie Handedit am emittierten C).
- `--backend`/`WONKY_BACKEND` wird **nie** aus der Umgebung erraten. Ein unbekannter Wert ist ein Fehler.

## 8. Metal-Politik

- **Aus.** Kein Produktionspfad enthält einen `!`-Aufruf, der planare Boolean auch nicht. Device-Init kostet 31 bis
  35 ms pro Prozess, jeder Dispatch 0,26 bis 0,65 ms. Der Metal-Build des build123d-Workloads wurde nach 911 s
  abgebrochen; schlecht partitioniert war Metal 35x langsamer als die CPU.
- Eine Op darf Metal nur nutzen, wenn **alle vier** gelten:
  1. ihr Bend-Code hat eine bewusste `!`-Stelle über gut partitionierte unabhängige Arbeit;
  2. sie ist im Diff bitgleich gegen CPU und JS;
  3. ein End-to-End-Benchmark zeigt einen Gewinn **inklusive** Device-Init in der Prozessart, in der sie läuft;
  4. ihr Metal-Build endet innerhalb eines festen Budgets.
- Metal ist eine eigene Addon-Variante mit eigenem Cache-Schlüssel und `.gpu`-Archiv neben der `.node`, pro Prozess
  gewählt. JS routet nie einzelne Aufrufe auf die GPU. GPU-OOM wird `BX_FAILSTOP` + `reset()`, nie ein Retry auf CPU
  oder JS.
- Plausible erste Kandidaten sind Batch-Formen wie die 262k Zylinder-Vergleiche (Metal 2 bis 3 ms gegen 9 ms auf 18
  Threads), nicht einzelne Booleans.

## 9. Build und Cache

- **Ein Skript, keine Handedits:** `node scripts/native-bridge/build-native.mjs --set <name>`.
  1. Op-Liste des Sets lesen, Import-Hülle der Einstiege auflösen.
  2. `SOURCE_HASH` = sha256 über (Pfad, sha256) der Hülle, Generator- und Build-Skripte, `bx_pre.h`, `bx_addon.c`,
     vendorte Node-API-Header, `bend.lock.json`, `clang --version`, Flags, Arch, N-API-Version.
  3. Cache-Treffer → fertig. Sonst: `gen-wire` erzeugt `wire.{bend,mjs,json}` und `entry.bend`, `bend entry.bend -o
     kernel.c`, eine clang-Übersetzungseinheit (`bx_pre.h` + unverändertes C + generierte Tabellen + `bx_addon.c`).
  4. Prüfungen, die laut scheitern: FID vorhanden, Stelligkeit passt, nur List-geboxte Signaturen, `BANGS == 0`,
     keine Breitenwarnung, Smoke-Test in einem Kindprozess (Hashes aus `info()`, erfasste Aufrufe replayen
     bitgleich).
  5. Atomar umbenennen, `manifest.json` mit Zeiten, Größen und Load Average schreiben. Eine Lock-Datei erlaubt nur
     einen Compile gleichzeitig. Die letzten drei Builds bleiben.
- **Eingaben nur aus getrackten Dateien (seit dem R20-Gate, 24.09.2026):** Der Build und der Loader lesen nichts
  unter `out/` (gitignored), damit ein frischer Klon das Addon baut. Die Karte liegt unter `src/native/surface.json`
  (`surface-scan.mjs` schreibt sie dorthin), die gemessenen Einstiege je Workload unter `src/native/slice-calls.json`,
  die bitgleich replayten Produktionsaufrufe des Smoke-Tests unter `src/native/smoke-calls.json.gz` und die
  Hybrid-Jobs des `wonky-hybrid`-Smoke-Tests unter `src/native/smoke-hybrid.json.gz`. Alle vier stehen in
  `BUILD_INPUTS` (`src/native/build-key.mjs`). Nur `scripts/native-bridge/slice-inputs.mjs` liest die Messartefakte
  unter `out/` und `tmp/` und erneuert die getrackten Kopien (`--check` meldet Abweichungen). Nachweis: eine Kopie
  aus `git ls-files --cached --others --exclude-standard` ohne `out/` baut mit demselben `sourceHash`
  (`test/native-hybrid.test.mjs` prüft, dass keine Eingabe unter `out/` liegt oder ignoriert ist).
- **Ort:** Im Slice unter `tmp/native-bridge/cache/<sourceHash>/` (der einzige beschreibbare Ort dieser Stufe).
  Zielort `.tools/wonky-native/<sourceHash>/` (gitignored wie `bend-js-cache`) ist Marcs Entscheidung.
- **Stale-Check bei jedem Öffnen:** Hülle neu hashen und mit dem Manifest vergleichen, dann `info().sourceHash`,
  `wireHash`, `apiVersion`. Gemessen 1,4 bis 1,6 ms Median (Worst Case 4,4 ms), gegen 436 ms für die heutige
  JS-Cache-Validierung. **Eine veraltete Binary läuft nie.**
- **Node-API-Header werden vendort** (`src/native/include/`, mit Provenienz), statt aus
  `~/Library/Caches/node-gyp/<version>` gelesen, das nur existiert, wenn node-gyp einmal lief.
- **Build-Zeiten:** Planar-Addon 12 s (bend 4,7 s + clang 7,2 s, 3,9 MB C). Volle Oberfläche: 12 MB C in 16 s
  emittiert, clang-Zeit **ungemessen**. `--dev` kann mit `-O1` unter eigenem Schlüssel bauen (FP-Semantik hängt
  nicht von `-O` ab; der Diff beweist es).
- **Dev-Loop:** Kern-Bend editieren auf `js` (Default, keine C-Toolchain). Nativ prüfen mit `WONKY_BACKEND=native`;
  nach einer Kernänderung meldet der Loader, welche Dateien die Binary veralten lassen, und nennt den Build-Befehl.
  Beide Targets prüfen mit `WONKY_BACKEND=diff node --test test/<datei>`. Der erste Lauf jeder neuen Binary zahlt
  macOS' Erstprüfung (287 ms bei der Probe).

## 10. Migrationsschritte

Jeder Schritt ist einzeln auslieferbar; Default bleibt `js`, bis Marc umschaltet.

| Schritt | Inhalt | liefert | Gate | Bits gegen heute |
|---|---|---|---|---|
| **S (jetzt)** | Vertical Slice, Abschnitt 11: 19 Einstiege, 6 planare Workloads, `WONKY_BACKEND=native\|diff` | erste echte End-to-End-Messung | Abschnitt 11 | identisch |
| 0 | Messen: volles 84-Einstiege-Addon (clang-Zeit, Größe, Load); CLI-Flag `--backend`; `backend`-Block aus `info`; Exporter laden Bend lazy (auch auf `js`: ~110 ms weniger für `--help`) | Zahlen, Plumbing | fokussierte Tests auf `js` | identisch |
| 1 | Compat-Backend für alle 84 emittierbaren Produktionseinstiege; Curved-Intersection verweigert laut | projiziert 6,6 bis 9,3x auf allen Nicht-r10b-Workloads (inkl. bored-spacer) | Modelltests grün auf `native` und `diff`; Ende-zu-Ende-Messung mit Korrektheit; brep.json/STEP gleich außer `backend` | identisch |
| 2 | `api.bend` v1: `Body`, `op_boolean` PLANAR (union/subtract) inkl. `classificationInput`, Audit, Maße; Fassade mit Carriern; Pro-Op-Module fürs JS-Target | exakte planare Ketten (`nativeChainExact: true`) | Diff grün; Ketten-Test beweist verbatim Carrier; Golden-Liste freigegeben | letzte Bits verketteter planarer Modelle |
| 3 | `extrudePolygon`, `frustum`, `transform` mit Carriern; Maß-Übertrag per `Measures.rule` | exakte Körper ab Konstruktion | wie 2 | verkettete Transforms |
| 4 | übrige Boolean-Methoden (coaxial, pierce aus exakten Primitiven, convex); CURVED bleibt nativ verweigert | exakte Pierce/Coaxial-Ketten | wie 2 | ja |
| 5 | Sketch-Ops mit Profil-Carriern; Robustheit: Pool-Fail-Stop-Kontext, `madvise` im Reset, CLI-Default 6 Threads nach ruhiger Nachmessung | 6-Thread-Zahlen | Fail-Stop-Tests im Kindprozess | ja |
| 6 | `stepPcurves` aus Carriern, `compareCoaxial`, `printMesh` (nur mit Zustimmung des Bake-offs, `src/print-mesh.mjs` gehört ihm); STEP mit `uv run scripts/validate-step.py` | exakter Export | STEP validiert | Pcurve-Wörter |
| 7 | `importBrep` (r10b: 18.604 Aufrufe → ~1 pro Teil) | Import mit Carriern | r10b auf `js` unverändert bis zur bekannten Grenze | importierte Ketten |
| 8 | `identify`; Compat-Tabelle löschen; `loadKernel` nur noch intern im JS-Referenz-Backend; Lint "kein refeed"; optional Default auf `native` | schmaler Endzustand | Lint grün | identisch |
| später, nur mit Beleg | Residente Handles hinter den Carriern; Record-only-Lint; Batch-/Sweep-Policy; Metal-Variante | je nach Messung | eigene End-to-End-Messung | je nach Schritt |
| parallel, Kernarbeit | Curved-Pfad emittierbar machen (Arity-Refactor oder Upstream-Fix); kooperativer CPU-Fail-Stop in der Runtime | r10b nativ; 6 Threads überall sicher | | |

## 11. Der Vertical Slice, der jetzt gebaut wird

**Ziel.** Mit `WONKY_BACKEND=native` laufen sechs reale Workloads über die unveränderten CLIs `bin/wonky.mjs` und
`bin/wonky-python.mjs` Ende-zu-Ende mit nativem ARM64-Kern im Node-Prozess, **ohne dass das Bend-JS-Kernel geladen
wird**. Die Ausgaben sind bitgleich zum JS-Pfad. `WONKY_BACKEND=diff` zeigt jeden Kernaufruf wortgleich. Die Zeiten
werden nach Buckets getrennt gemessen. Alles außerhalb des Slices scheitert laut.

**Workloads.** py-planar-union, py-planar-pocket, py-frame-with-tab, fs-fuse-g1, fs-cut-h1, fs-bracket (gleiche
Befehle wie in profile.md). Negativfälle: fs-bored-spacer-print und fs-r10b-strict müssen im nativen Modus laut
scheitern, schnell und ohne JS-Kernel.

**Einstiegssatz (19, aus `out/native-bridge/profile/calls/` abgeleitet und per Skript gegen diese Dateien geprüft):**
`ports/planar-boolean.bend:union`, `:subtract`, `ports/curved.bend:audit`,
`ports/solid-intersection.bend:planar_measures`, `identity.bend:boolean_result`, `:box`, `:box_layout`, `:transform`,
`:extrusion`, `analytic.bend:curve_residual`, `:surface_residual`, `topology.bend:extrude`, `:transform`,
`geometry.bend:frame`, `:lift_points`, `:translate` (exponiert über `topology`), `face-classification.bend:linear_edge`,
`:max_budget`, `real.bend:max`.

**Aufbau.**

- `scripts/native-bridge/slice-ops.mjs`: Einstiegsliste plus `exposedAs` aus `src/native/surface.json` (bis zum
  R20-Gate `out/native-bridge/surface.json`); prüft gegen `src/native/slice-calls.json`, dass jeder Einstieg der
  Workloads abgedeckt ist.
- `scripts/native-bridge/build-native.mjs --set planar`: Build nach Abschnitt 9 (nutzt `gen-wire.mjs` und
  `binding-build.mjs` wieder), Cache `tmp/native-bridge/cache/<sourceHash>/`, Lock, Smoke-Test mit
  `src/native/smoke-calls.json.gz` (kompakte, gzip-Kopie von `out/performance/native-build123d/captured.json`).
- `scripts/native-bridge/vendor-node-api.mjs` → `src/native/include/` mit Provenienz.
- `src/native/backend.mjs` (Auswahl, `openKernel(mode)`, `exportKernels()`), `src/native/native-kernel.mjs` (Manifest,
  Stale-Check, `process.dlopen`, `init({threads: WONKY_NATIVE_THREADS ?? 1})`, Compat-Proxy, Trace),
  `src/native/diff-kernel.mjs`, `src/native/errors.mjs`.
- Der Proxy gibt für `then` und Symbole `undefined` zurück (er wird als Promise-Wert aufgelöst) und wirft für jeden
  Einstieg außerhalb des Sets `NativeCapabilityError`.
- `scripts/native-bridge/slice-guard.mjs`: `--import`-Preload, der jedes geladene Modul protokolliert (für den
  Nachweis "kein JS-Kernel").
- `scripts/native-bridge/slice-bench.mjs`, `test/native-bridge-slice.test.mjs`, Bericht `docs/native-bridge/slice.md`,
  Rohdaten `out/native-bridge/slice/`.

**Produktions-Berührungspunkte (klein, Default aus):**

1. `src/kernel.mjs` `loadKernel()`: Der heutige Rumpf wird `loadJsKernel()` (exportiert, für den Diff). `loadKernel()`
   verzweigt nur bei gesetztem `WONKY_BACKEND` auf `src/native/backend.mjs`; unbekannte Werte werfen. Ohne Variable
   identisch zu heute.
2. `src/exporters.mjs:9` (Top-Level-`await` auf die STEP-Pcurve-Module): Bei `native`/`diff` kommen die Namespaces
   aus dem Backend (Einstiege außerhalb des Slices werfen beim Aufruf). Ohne Variable identisch.
3. `src/index.mjs:39` und `src/python.mjs:178`: `backend.target` kommt vom gewählten Backend
   (`'JavaScript'` unverändert bei `js`; `'ARM64 native (in-process N-API, planar slice)'` plus `sourceHash`,
   `threads` bei `native`). Sonst würde brep.json im nativen Modus lügen.

Nichts in `bin/`, `kernel/` oder den Adaptern ändert sich.

**Akzeptanz.**

1. Build: ein Lauf erzeugt den Cache-Eintrag mit 19 Ops, `sourceHash`, `wireHash`, bend- und clang-Zeit, C- und
   `.node`-Größe, Load Average; zweiter Lauf ist ein Cache-Treffer in < 1 s; fehlende FID, Stelligkeitsfehler,
   Breitenwarnung oder `BANGS != 0` brechen ab.
2. Korrektheit: Für alle sechs Workloads Exit 0 auf `native`; `brep.json` ohne `backend`-Block, `.step` und die
   Körperzeilen auf stdout **byte-identisch** zum `js`-Lauf.
3. Diff: `WONKY_BACKEND=diff` über alle drei FS-Workloads und mindestens py-planar-union und py-frame-with-tab: jeder
   Aufruf der 19 Einstiege wortgleich; die Anzahl verglichener Aufrufe entspricht dem Count-Run des Profils.
4. Kein JS-Kernel: Der Guard zeigt im nativen Prozess kein `data:`-Modul, keinen Bend-Compiler `main.ts`, keinen
   `.bend`-Import; `loadJsKernel` wird nie aufgerufen.
5. Zeit-Buckets (`slice-bench.mjs`, frische Prozesse, `js` und `native` abwechselnd, n ≥ 3, `uptime` vor und nach
   jedem Lauf): Prozess-Wall; Kaltstart bis zum ersten Kernaufruf inkl. `dlopen`+`init` und Stale-Check; nativer
   Kern pro Einstieg (Aufruf-ms, Encode-ms, Decode-ms, Anzahl); Frontend/Host-Rest; Export. Der erste Load nach dem
   Rebuild wird separat ausgewiesen. Primär 1 Thread, 6 Threads als kurzer Zusatzlauf. Der Bericht stellt gemessene
   Faktoren neben die Projektion (7,4 bis 9,3x) und erklärt Abweichungen; Zeiten unter Last heißen "indikativ".
6. Laute Fehler, je ein Test: Einstieg außerhalb des Slices (bored-spacer; ein Zylinder-Extrude in `try silent`) →
   `UnsupportedFeatureError` mit Einstieg und Backend, nicht verschluckt, Exit 1, kein JS-Kernel geladen; r10b →
   Capability-Fehler am ersten fremden Einstieg in < 2 s; manipuliertes Manifest bzw. geänderte Hüllendatei →
   `NativeKernelStaleError` mit Dateiliste und Build-Befehl; fehlender Build → `BX_LOAD`; fehlerhafte Wörter und
   unbekannte Op → `NativeKernelError`, Runtime läuft weiter; ungültiger `WONKY_BACKEND` → Fehler; synthetischer
   Diff-Mismatch → `BackendDivergenceError` mit Op, Wortindex und Dump.
7. Default aus: Ohne Variable laufen die fokussierten bestehenden Tests unverändert (`test/planar-boolean-native`,
   `test/planar-difference-native`, `test/native-bridge-wire`, `test/native-bridge-binding`), und der
   `backend`-Block in brep.json ist identisch zu heute.
8. FP: `-ffp-contract=off -fno-fast-math` stehen im Manifest und im `sourceHash`.
9. Zusatzmessung, nicht ausgeliefert: ein einzelner Build der vollen 84-Einstiege-Oberfläche (clang-Zeit,
   `.node`-Größe, erster und warmer Load), weil diese Zahl über Schritt 1 entscheidet.

**Nicht im Slice:** `api.bend` und Carrier, Residenz/Handles, Batching und Sweeps, Metal, Threads > 1 als Default,
Curved-Pfad und r10b nativ, die Einstiege von bored-spacer (frustum, coaxial, tessellate, Pcurves), CLI-Flags in
`bin/`, Default-Wechsel, der Cache-Ort unter `.tools/`, Runtime-Patch für Pool-Fail-Stops, `madvise`.

## 12. Risiken

1. **Die Projektionen sind Projektionen.** k ist auf 4 Aufrufen aus 3 Eingaben unter Last 13 bis 15 gemessen; fuse
   und cut sind extrapoliert, k für den Nicht-Boolean-Rest angenommen. Der Slice misst das Ende-zu-Ende nach.
2. **r10b, das Abnahmeziel, gewinnt nativ nichts,** bis der Curved-Pfad unter Bends 255-Wort-Grenze passt. Auch dann
   ist sein Hotspot algorithmisch (Listen-Folds in `connectivity_pass`).
3. **Pool-Worker-Fail-Stop beendet Node** (threads > 1 oder `!`). Laut, aber der Kontext ist weg. Abhilfe: 1 Thread
   für langlebige Hosts, Isolationskind, Runtime-Fix upstream.
4. **Build- und Load-Kosten des vollen Addons sind unbekannt** (12 MB C). Dauert clang Minuten, leidet der native
   Dev-Loop; `js` als Default und der Cache fangen das ab.
5. **Bindbarkeit hängt an Bends Inlining und Unboxing.** Eine gebundene List-Def, Build-Prüfungen und ein
   Binding-Testlauf bei jedem Bend-Update halten das in Schach.
6. **Strenge Codecs.** Die generierten Encoder lehnen Nicht-F32-Werte ab, wo Bend F32 erwartet (das JS-Target ist
   laxer). Latente Host-Fehler können auf `native` laut auftauchen. Gewollt, aber möglicherweise Arbeit.
7. **Golden-Churn** ab Schritt 2, wenn Ketten exakt werden (131 von 9.784 Reals schon heute betroffen).
8. **Die Compat-Oberfläche ist breit** (84 Einstiege, 121 ADTs) und soll wieder verschwinden. Stockt die Verengung,
   bleibt sie; sie ist generiert und getestet, also ein Wartungs-, kein Korrektheitsrisiko.
9. **Host-Logik nach Bend verlagern** (Schritte 2 bis 8) sind 1 bis 2k Zeilen unter Bends Regeln. Der Diff fängt dort
   keine Fehler (beide Backends laufen dieselbe Bend-Quelle), nur Golden- und Modelltests.
10. **Kernel-Churn durch den Boolean-Bake-off** kann Einstiege ändern. Der Stale-Check macht das laut; ein neuer
    Körpertyp bedeutet `API_VERSION`-Bump.
11. **Speicher:** RSS schrumpft nicht; ein tiefer Stack-Überlauf hinterlässt ~2 GB bis `madvise` im Reset existiert.
12. **Die OCCT-Lücke bleibt:** frame-with-tab nativ ~100x über OCCTs 9,4 ms. Das ist Algorithmenarbeit, nicht
    Bridge-Arbeit.

## 13. Entscheidungen für Marc

1. Slice und Schritt 1 (Compat, volle Geschwindigkeit, bitgleich) vor der Verengung? Empfehlung: ja.
2. Cache-Ort `.tools/wonky-native/<hash>/` (gitignored) freigeben?
3. Threads: CLI-Default 6 mit lautem Exit bei Pool-Fail-Stop, oder 1 bis der Runtime-Fix da ist? Empfehlung: 1 bis
   zur ruhigen Nachmessung, dann 6 für die CLI.
4. Die einmalige Last-Bit-Änderung verketteter Modelle ab Schritt 2 akzeptieren (mit Review-Liste)?
5. Wer macht den Curved-Pfad emittierbar (Kern-Refactor oder Upstream-Anfrage an Bend)?
6. Upstream-Wünsche an Bend: Wurzelmenge außer `main`, geboxte Aufruf-Einträge, kooperativer CPU-Fehlerpfad,
   gepackter Wortpuffer.

## 14. R20-Gate: der Hybrid-Boolean im nativen Slice (Plan-Schritt 11a)

Stand: 24.09.2026. Aufgabe 12b des R20-Gates (local design note); Plan:
[hybrid-boolean-plan.md](hybrid-boolean-plan.md), Abschnitt 4 und Schritt 11. Messwerte:
[native-bridge/slice.md](native-bridge/slice.md), Abschnitt „R20-Gate“.

**Was läuft.** Mit `WONKY_BACKEND=native` bauen die R20-Kernfälle KT6 (koplanare Vereinigung, die erst der
Hybrid-Boolean auflöst) und KT2 (608er-Lagersitz: Zylinder, Pierce, sechs Hybrid-Schnitte, Druckmesh, STEP)
Ende-zu-Ende, ohne dass das Bend-JS-Kernel geladen wird. `brep.json`, `.step`, `.stl`, `print.json` und der
r20-check-Export (`--format r20-check`: STL je Teil und Manifest) sind byte-identisch zum `js`-Lauf;
`WONKY_BACKEND=diff` vergleicht jeden Addon-Aufruf Wort für Wort und jede Hybrid-Antwort Zeichen für Zeichen
(0 Divergenzen). `scripts/r20/acceptance.mjs --cases kt6,kt2` ist auf beiden Backends PASS.

**Zwei Teile, ein Build, ein Schlüssel.** `build-native.mjs --set planar` baut:

1. das Addon (`wonky-kernel.node`, `BANGS == 0`) mit **38 Einstiegen** statt 16: die planaren 16 plus die
   Einstiege, die KT6 und KT2 rufen (`sketch-lines.bend:solve`, `volume.bend:volume`, die Frustum-Familie in
   `analytic.bend`/`identity.bend`, `pierce.bend:pierce`, `prism-boolean.bend:boolean`, `precise.bend:*`,
   `tessellate.bend:*`; die beiden STEP-Pcurve-Einstiege von `step-cylinder-pcurves.bend` im Export-Scope über
   `exportKernels()`). Die Liste wird gegen die gemessenen Aufrufe in `src/native/slice-calls.json` geprüft;
   jeder andere Einstieg verweigert wie bisher mit `NativeCapabilityError`;
2. den Subprozess **`wonky-hybrid`** aus `kernel/hybrid/native.bend` (`bend -o`, dieselben gepinnten clang-Flags,
   als ausführbare Datei gelinkt). Sein Treiber und die bedienten Schlüssel stehen im `sourceHash`, seine
   Import-Hülle unter den Eingabedateien, sein sha256 im Manifest. Der Stale-Check beim Öffnen prüft ihn mit:
   Eine veränderte Binary verweigert vor jedem Laden.

**Warum ein Subprozess (11a) und nicht der N-API-Einstieg (11b).** corefine und recover setzen Geräteaufrufe
(`!`, `BANGS == 2` im emittierten C). Auf der CPU laufen sie im Thread-Pool; ein Fail-Stop auf einem Pool-Worker
würde den Node-Prozess beenden (Risiko 3 in Abschnitt 12). Im eigenen Prozess ist derselbe Fehler ein benannter
`NativeKernelError` (`BX_FAILSTOP`), Node läuft weiter. Das Addon behält `BANGS == 0`. Die Prozesskosten sind klein
gegen die Rechenzeit (gemessen in slice.md). 11b bleibt der Zielzustand, sobald die Runtime einen kooperativen
CPU-Fehlerpfad hat (Entscheidung 6 unten, Upstream-Wunsch).

**Schnittstelle.** Der Host (`src/hybrid.mjs`) ruft die Stufen des Hybrid-Einstiegs beim Namen
(`runHybrid`: `corefine/main.run`, `rjob`, `mid.go`, `map`, `finish`, `show`; `carrierClasses`:
`mesh-io.parse_job`, `recover/topo.surfs.go`, `recover/topo.cls.go`). `src/native/hybrid-process.mjs` bedient
genau diese Schlüssel im `hybrid`-Namespace des Compat-Kernels:

- `corefine/main.run(job)` startet `wonky-hybrid boolean`, das den ganzen Hybrid in einem Lauf rechnet und die
  Antwort (`exact`/`mesh`/`unresolved`) und corefines Ergebnistext schreibt; der Host bekommt den Ergebnistext;
- die Zwischenstufen reichen nur undurchsichtige, markierte Werte weiter; `show` liefert die Antwort desselben
  Laufs. Kein recover-Zustand überquert die Prozessgrenze. Eine Stufe außer der Reihe oder mit fremdem Wert
  verweigert mit Namen (`BX_ARGS`);
- `mesh-io.parse_job` startet `wonky-hybrid classes` (recovers Trägerklassen der Flächentabelle);
- `kernel.hybrid.boolean` und jeder andere Hybrid-Schlüssel verweigern als `NativeCapabilityError`.

Auf `diff` rechnet zusätzlich das JS-Target jede Stufe; der erste abweichende Buchstabe beendet den Lauf mit
`BackendDivergenceError` und einem Dump (Job, beide Texte, Zeichenindex).

**Arbeitsbudget.** Jeder `wonky-hybrid`-Prozess ist durch Wandzeit begrenzt (`WONKY_HYBRID_BUDGET_S`, Default
120 s). Wird es überschritten, wird der Prozess beendet; auf `native` bekommt der Boolean die benannte Verweigerung
`unresolved work budget exceeded …` (in `src/boolean.mjs` als `[hybrid: work budget exceeded …]`), auf `diff`
endet der Lauf (`BX_BUDGET`, es gibt nichts zu vergleichen). Abweichung vom Plan: Schritt 11 verlangt ein Budget
über Kandidatenpaare bzw. Triangulationsversuche im Kern; das Wandzeit-Budget ist die Host-Hälfte davon und
gilt nur für den nativen Weg. Ein Zählbudget im Kern (`kernel/hybrid/corefine`) ist offen und gehört der
Hybrid-Kernarbeit.

**Nicht nativ (verweigert mit Namen):** `revolve.bend:sweep` (opRevolve: KT1, KT3, KT4), `volume.bend:mesh_snap`
und `:mesh_bound` (zertifizierte Mesh-Körper), der WK-Real-Pfad (`src/lang/wk`) mit Hybrid. Sie kommen dazu,
wenn ein Workload sie misst (`slice-inputs.mjs` nach einem Count-Lauf, dann `SLICE_OPS`).

**Dateien.** `kernel/hybrid/native.bend` (Treiber), `src/native/hybrid-process.mjs` (Prozess, Budget,
Host-Namespace, Diff), `src/native/native-kernel.mjs` (Stale-Check und Namespace), `src/native/diff-kernel.mjs`,
`src/native/backend.mjs`, `src/native/build-key.mjs` (Schlüsselschema `/3`), `scripts/native-bridge/build-native.mjs`
(Build und Smoke-Test von `wonky-hybrid` gegen `src/native/smoke-hybrid.json.gz`),
`scripts/native-bridge/slice-ops.mjs` (38 Ops, `HYBRID_DRIVER`, `HYBRID_HOSTED`, Workloads `r20-kt6`, `r20-kt2`),
`scripts/native-bridge/slice-inputs.mjs`, `scripts/native-bridge/slice-bench.mjs` (Bucket `hybridMs`),
`test/native-hybrid.test.mjs`.
