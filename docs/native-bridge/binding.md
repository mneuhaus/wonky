# Native Bridge: In-Process-Anbindung (N-API-Addon)

Stand: 2026-09-22, Bend 2.0.25, Apple M5 Pro (18 logische CPUs, 64 GB), macOS arm64 (Darwin 25.6), Node v22.23.1, Apple clang.

## Ergebnis in Kürze

**Bend-emittiertes C läuft im Node-Prozess, direkt aufgerufen, wiederholt, bitgenau.** Das Modell ist dasselbe wie bei CPython und einer C-Extension: ein reines N-API-Addon (`node_api.h`, keine npm-Abhängigkeit). Es wird vollständig per Skript aus frisch emittiertem C erzeugt, ohne eine Zeile des emittierten C zu editieren.

- **Echter Kern im Prozess:** Die erfassten Produktionsaufrufe `planarBoolean.union/subtract` der build123d-Fälle `planar-union`, `planar-pocket` und `frame-with-tab` laufen nativ im Node-Prozess. Sie sind **Wort für Wort identisch** mit dem JS-Target: alle 4 Aufrufe, bei 1, 6 und 18 Threads, auch wiederholt. Nativ mit 1 Thread: 169 / 307 / 292 / 1249 ms. Das JS-Target im selben Prozess: 1639 / 2820 / 2703 / 10424 ms. Das ist Faktor 8,3 bis 9,7 (Last ~14 auf 18 CPUs, indikativ).
- **Aufruf-Overhead:** 0,5 µs p50 für einen leeren Direktaufruf (N-API, Lock, Task-Knoten, `corpus_eval`). Der Prozess-Dienst der Baseline braucht für 64 B 38 µs. Große Daten kosten ~6 bis 7 ns pro U32-Wort und Richtung (Bends Cons-Liste). 1 MB als U32-Wörter hin und zurück kostet 3,4 ms.
- **Residenz funktioniert:** Ergebnis-Terme bleiben als Handles im Bend-Heap. Spätere Aufrufe bekommen sie ohne Serialisierung übergeben. Das ist auch auf dem echten Kern gezeigt: `subtract` hält sein Result nativ, der einzige Körper geht direkt in `union`. Das Ergebnis ist bitgenau gleich der JS-Kette.
- **Metal im Prozess funktioniert:** Die Device-Initialisierung kostet 31 bis 35 ms beim ersten `init`. Danach kostet ein GPU-Dispatch aus einem Aufruf 0,26 bis 0,65 ms.
- **Fehler:** Folgende Fehler auf dem aufrufenden Thread werden zu JS-Exceptions: Kernel-Fehlerwerte, `IO.die`, Nat-Überlauf, Stack-Überlauf, GPU-OOM. `reset()` baut die Runtime in 0,1 ms neu auf. **Ein Fail-Stop auf einem Pool-Worker-Thread beendet den Node-Prozess** (Exit 1). Das ist die eine harte Grenze.

**Empfehlung:** In-Process ist machbar und klar besser als der Prozess-Dienst. Den Prozess-Dienst braucht man höchstens als optionale Isolationsschicht, solange Fail-Stops auf Pool-Threads den Prozess beenden (siehe [Empfehlung](#empfehlung)).

Alle Zeiten liefen auf der geteilten Maschine bei Load Average 13 bis 15 (steht in jedem Report). Sie sind **indikativ**.

## 1. Anatomie

### Compiler: kein Library- oder Embedding-Modus

`bend --help` kennt nur diese Aufrufe: Ausführen, `-o <out>` (Binary, `.c` oder `.js`), `--check-only`, `--publish`, `base`, `guide`, `update` und `version`. Der Compiler ist ein mit Bun gebündeltes TypeScript-Programm. Der eingebettete Quelltext ist lesbar. Mit `strings -a -n 8 .tools/bend-2.0.25/bin/bend > tmp/native-bridge/binding/anatomy/bend-strings.txt` entsteht die Datei, auf die sich die Zeilennummern beziehen:

| Stelle | Befund |
|---|---|
| `bend-strings.txt:109748` `cli_file` | Optionen: `-h`, `--check-only`, `--checkup`, `--publish`, `-o`, `--`. Alles andere endet in `unknown option` (`:109771`). Es gibt kein `--lib`, kein `--no-main`, keine FFI. |
| `:109835` `cli_emit` | `.c` schreibt `compile_book(book)`, `.js`/`.cjs` schreibt `js_book`, sonst C plus `cli_build`. |
| `:109866` `cli_build` | `clang -std=c11 -O3 f.c -lpthread -lm`. Mit `!`-Aufrufen kommt `-DBEND_METAL=1 -x objective-c -fobjc-arc -fmodules` dazu, danach läuft `<binary> --gpu-build` (`:109892`). |
| `:107082` `compile_book` | Die Wurzelmenge ist fest `["main", ...RUNTIME_ADTS]` (`:107083`). Emittiert wird nur, was von `main` aus erreichbar ist (`:107106` `reach([seg_fid("main")])`). **Eine Library-Variante bräuchte nur eine andere Wurzelmenge.** |
| `:107123` | `#define MAIN_FID`, `#define MAIN_PURE` |

Der einzige dokumentierte Erweiterungspunkt sind **eigene Effekte** (`.tools/bend-2.0.25/guide/EFFECTS.md`). Das ist eine `def X() -> IO(R)` mit `import "./x.c"` und `import "./x.js"`. Der Compiler hängt die `.c`-Datei hinter die Runtime. Sie registriert sich per `__attribute__((constructor))` mit `io_eff(CID_X, run, need)`. Die Effekte in `bend2/effs/*.c` sind genauso gebaut. Beispiel `effs/args.c`: `io_args_run` baut eine `List<String>` aus `io_argv`.

### Emittiertes C

Die Referenz ist `tmp/native-bridge/binding/build/probe.c` (5481 Zeilen). Sie entsteht mit `node scripts/native-bridge/binding-build.mjs kernel/service/binding/probe.bend --call echo --call bits --call mix --call tree --call deep --call boom --call par`. Alles liegt in einer Datei: Runtime-Template, Tabellen, kompilierte Defs, eingefügte Effekt-Dateien und `main`.

| Thema | Stelle in `probe.c` | Befund |
|---|---|---|
| Heap | `:302` `static Corpus CORPUS`, `:4495` `corpus_map`, `:4548` `corpus_setup` | Es gibt **einen** prozessglobalen Heap. Auf der CPU reserviert er 8 GiB virtuell ab Hint 2^45 und wächst durch Verdoppeln an Ort und Stelle. Auf der GPU wird der ganze Span einmal angelegt (`recommendedMaxWorkingSetSize`, höchstens 2 GiB). |
| Allokator | `:303` `static u64 ALC[CUBE_T + 1][...]`, `:871` `heap_alloc` | Die Allokatoren sind Lane-lokal: `ALC[0]` gehört dem aufrufenden Thread, `ALC[1+w]` dem Pool-Worker `w`. Speicher wird per Referenzzählung verwaltet (`:972` `term_keep`, `:1095` `term_sink`), es gibt keine GC. |
| Terme | `:905` `term_make` | Ein 64-Bit-Wort aus Tag, 16-Bit-CID/FID und Loc. `U32` und `F32` sind rohe Wörter (F32 als Bitmuster, `:715` `f32_unbox`), `Nat` ist ein Immediate bis 2^48-1. |
| Thread-Pool | `:309`ff. `pool_*`, `:4062` `pool_work`, `:4100` `pool_open` | `pool_open` startet `pool_size` Threads **einmal** (`static bool up`). Danach warten sie auf `pool_wake`. Es gibt kein Join und kein Teardown. |
| Explizite Stacks | `:4048` `pool_stack` | Jeder Thread bekommt 2 GiB `mmap`, eine 16-KiB-Guard-Page (`mprotect PROT_NONE`) und `sigaltstack`. Dazu kommt **`sigaction(SIGSEGV/SIGBUS, err_trap)` für den ganzen Prozess**. |
| Auswertung | `:1323` `task_node`, `:4571` `corpus_eval` | Ein Aufruf ist ein Task-Knoten `[args..., cont, idx/rem]` für eine FID. `corpus_eval` arbeitet ihn solo oder über Pool bzw. GPU ab (`:4575`, `:4454` `cube_run`) und liest das Ergebnis aus der Root-Zelle (`WL_RESW` Wörter, `:479`). |
| main | `:5426` `main` | Parst `--threads`, `--gpu`, `--gpu-build`, `--help` und `--`. Der Rest landet in `io_argv`. Danach folgen `corpus_setup` und `io_loop`. |
| Eingabe aus args | `:4688` `io_argc`/`io_argv`, `effs/args.c` | `main()` hat keine Parameter. Argumente holt sich das Programm über den `IO.args`-Effekt. |
| IO-Schleife | `:5234` `io_loop`, `:5197` `io_step` | `main` wird zu einem IO-Wert ausgewertet (`MAIN_PURE 0`). `io_step` wendet die Continuation auf das letzte Ergebnis an und liest den Request-Konstruktor. Dann dispatcht es über `io_eff_rows[cid]` (`:4657`, Registrierung `:4692`, Aufruf `:4947` in `io_exec`). Ein Effekt kann `IO_PARK` liefern, dann bleibt die Aktion geparkt. `Emit` beendet die Schleife, `Halt` (`IO.die`) liefert den Exit-Code. |
| Ergebnis | `:5244` `show_val` (nur `MAIN_PURE`) | Bei einem reinen `main` wird das Ergebnis als Text nach stdout gedruckt. Sonst gibt es Ausgaben nur über Effekte (`effs/print.c`). |
| Fehler | `:660` `ERR_TEXT`, `:670` `err_fail`, `:680` `err_trap`, `:5418` `cli_fail` | Ein Fail-Stop ist `fprintf(stderr, "bend: ...")` plus `_exit(1)`, von **jedem** Thread aus. `err_trap` (SIGSEGV im Guard) meldet „memory fault (machine stack overflow?)". Auf dem Device setzt ein Fehler stattdessen `H_ERROR_CODE` (`:284`, `:686` `err_seen`), und `cube_run` meldet ihn nach dem Pass. |
| Globaler Zustand | `CORPUS`, `ALC`, `pool_*`, `io_*` (`:4721` Queues, `:4890` `io_wake_fd`), `corpus_size` (`:4493`), `chan_*`, `gpu_*`, `static bool up` | Alles ist `static` und existiert einmal pro geladenem Modul. Es gibt kein Kontextobjekt. Wiedereintritt geht nur seriell: zu jeder Zeit ist genau ein Aufrufer „Lane 0". |
| Metal | `:320` `BEND_SRC` (`#embed __FILE__`), `:4167` `gpu_path`, `:4218` `gpu_probe`, `:4237` `gpu_make`, `:4268` `gpu_load` | Das Device-Programm wird aus dem eigenen C-Quelltext kompiliert. Das Pipeline-Archiv liegt als `<Executable>.gpu` neben dem Binary (`_NSGetExecutablePath`). Fehlt es, kompiliert der erste Start neu (Meldung `gpu_note`). |

Folgerungen für eine Einbettung:

1. `main` darf nicht laufen, denn es würde `io_loop` betreten und blockieren. Es darf aber im Binary bleiben.
2. `_exit` aus einem Fail-Stop beendet Node. Auf dem aufrufenden Thread lässt er sich abfangen, auf Pool-Threads nicht (siehe [Fehler](#6-fehlersemantik)).
3. `sigaction(SIGSEGV)` ersetzt V8s Handler für den ganzen Prozess. Ohne Gegenmaßnahme stirbt Node danach an jedem WebAssembly-Bounds-Trap (gemessen, siehe unten).
4. Das GPU-Archiv wird relativ zum **Executable** gesucht, also neben `node`, nicht neben dem Addon.
5. Nur von `main` erreichbare Defs existieren im C. Bend inlined kleine Defs und zerlegt nicht-rekursive Datentypen in mehrere Slots.

## 2. Aufbau der Anbindung

Am emittierten C wird nichts editiert. Der Build (`scripts/native-bridge/binding-build.mjs`) erzeugt eine Übersetzungseinheit:

```c
// <name>_addon.c (generiert)
#include "src/native/binding/bx_pre.h"   // Makro-Umleitungen, VOR dem Bend-C
#include "<name>.c"                       // unverändert aus `bend <entry>.bend -o <name>.c`
#include "<name>_ops.h"                   // generierte Tabellen (Op-Arme, BX_CALLS)
#include "src/native/binding/bx_addon.c"  // N-API-Treiber
```

`bx_pre.h` leitet sechs Prozess-Aufrufe per Makro um:

- `_exit`: Ein Fail-Stop springt per `siglongjmp` in den JS-Aufruf zurück.
- `sigaction`: SIGSEGV/SIGBUS werden verkettet statt übernommen. Nur Faults in Runtime-Guard-Pages gehen an `err_trap`.
- `mprotect`: merkt sich die Guard-Pages.
- `fprintf`/`fwrite` auf stderr: fängt den Text für die Exception ein.
- `_NSGetExecutablePath`: Das Metal-Archiv liegt neben der `.node`.
- `main` wird zu `bend_cli_main`: bleibt kompiliert, wird aber nie aufgerufen.

Gebaut wird mit `clang -std=c11 -O3 -fPIC -I<node-gyp include> ... -bundle -undefined dynamic_lookup`. Für Metal kommen `-DBEND_METAL=1 -x objective-c -fobjc-arc -fmodules -framework Metal -framework Foundation` dazu, danach erzeugt `gpuBuild()` das Archiv.

### Zwei Aufrufwege

**(a) Direktaufruf `call(name, args, keep?)`** ist der bevorzugte Weg und entspricht Variante (a) der Aufgabe. Für jede mit `--call DEF` gebundene Def liest der Generator die Bend-Signatur und die FID aus dem emittierten C (`#define FID_<NAME>`, Stelligkeit aus `FID_ARITY_T`). Der Treiber baut den Task-Knoten `task_node(e, FID, TERM_HOLE, 0, 0)` und schreibt die Argumente hinein:

- U32 und F32 als Wort,
- `Nat` als Immediate,
- `Uint32Array` als `List<U32>` direkt im Heap,
- oder ein residentes Handle.

Dann ruft er `corpus_eval`, genau so, wie die Runtime `main` startet. Es gibt kein IO und keinen Text. Das Ergebnis ist eine Zahl, ein `Uint32Array` oder ein Handle.

**(b) IO-Brücke `run(op, words, text, keep?)`** entspricht Variante (b). Sie nutzt einen offiziellen Nutzer-Effekt (`kernel/service/binding/bridge.c`). `main` ist eine Schleife `req <- Bridge.next(); ... Bridge.reply(Reply{...})`. `init` wertet `main` einmal aus und steppt die IO-Aktion, bis sie in `Bridge.next` parkt. Jeder `run` baut den `Req`-Term direkt im Heap, setzt die geparkte Aktion fort (`io_step`) und liest den `Reply`-Term aus. Dieser Weg hält auch Zustand auf Bend-Ebene (Probe: `Store`/`Held`, Kern: `Keep`/`Chain`/`Read`). Er kostet ~0,3 µs mehr als (a).

Weitere Exporte: `init({threads, gpu, gpuMB})` (einmal pro Prozess), `read/dup/drop(handle)`, `reset()`, `stats()`, `ops()`, `calls()`, `gpuBuild()`.

**Build-Prüfungen, die laut scheitern:**

- Eine per `--call` gebundene Def ohne eigene FID (von Bend eingebettet oder zur Schleife gemacht) ergibt den Fehler `FID_<NAME> missing`.
- Weicht die Stelligkeit der FID von der Parameterzahl ab, bricht der Build ab. So wurde die Parameter-Zerlegung entdeckt (siehe unten).
- Erlaubt sind nur `U32`, `F32`, `Nat`, `List<U32|F32>` und `List<…>` (als opakes Handle). Andere Parameter- oder Ergebnistypen brechen den Build mit Begründung ab.
- Unbekannte Optionen brechen ab.

### Echter Kern

`scripts/native-bridge/binding-kernel.mjs` erzeugt alles für den Planar-Boolean:

1. `gen-wire.mjs` erzeugt exakte U32-Codecs (`Real{hi, lo}` = 2 Bitmuster-Wörter) nach `tmp/native-bridge/binding/kgen/wire.{bend,mjs,json}`, mit `dispatch(op, words)`.
2. Der Einstieg `kgen/kernel.bend` enthält:
   - `kcall(op, words)`: liefert ein Status-Wort und die Result-Wörter.
   - `keep_words([op, ...7 Operanden])`: liefert ein residentes `List<KOut>`.
   - `chain_words(held, [op, ...4 Operanden])`: speist den einzigen Körper (solid, domains, source_budget) des gehaltenen Results in die nächste Operation.
   - `enc_held(held)`: liefert die Wörter.
   - Die Brücken-Ops `Union`, `Subtract`, `Keep`, `Chain` und `Read`. Sie machen diese Defs von `main` aus erreichbar.
3. `binding-build.mjs kgen/kernel.bend --call kcall --call keep_words --call chain_words --call enc_held`.

Build-Zeiten (Last ~13):

- Probe: `bend` 0,12 bis 0,27 s plus clang 0,5 bis 2,4 s.
- Kern: `bend` 4,7 s plus clang 7,2 s, zusammen 12 s.
- Metal-Probe: clang 0,5 s plus Archiv 0,46 s.

## 3. Messungen im warmen Prozess

Befehl: `node scripts/native-bridge/binding-bench.mjs all`. Jeder Modus läuft in einem eigenen Kindprozess, weil die Runtime prozessglobal ist. Die Reports liegen unter `out/native-bridge/binding/*.json`. Gemessen wird mit `performance.now()` in Node um den kompletten JS-Aufruf. Jede Antwort wird geprüft (`bad` = 0 in allen Zeilen). Perzentile sind Nearest-Rank. Last vor dem Lauf 13,33 / 13,25 / 13,82, danach 15,07 / 13,96 / 14,01.

### Laden und Init

| Messung | Wert |
|---|---|
| `require()` der `.node`, erste Ladung einer frisch geschriebenen Datei | 287 ms. macOS prüft neue Binaries einmalig; die Baseline sah 0,2 bis 0,55 s beim ersten Start. |
| `require()` danach | 0,65 bis 0,87 ms |
| `init({threads})` CPU | 0,07 bis 0,12 ms (Heap-Reservierung, Lane-0-Stack; `main` bis zum Parken 0,01 bis 0,03 ms) |
| `init({gpu: true})` Metal | 32,9 ms (Device 30,7 ms, Setup mit Archiv 2,2 ms). In früheren Läufen 104 bis 172 ms. |
| Vergleich Prozessstart (hardware-performance.md) | nativ 2,1 ms, Metal 32 ms, JS 21 ms |

### Latenz pro Aufruf (Threads 1, ms, p50 / p95 / p99)

Echo: Die Eingabe geht als `List<U32>` in den Heap, die Def gibt die Liste zurück, das Ergebnis kommt als `Uint32Array` heraus. Sum: Die Eingabe geht nur hinein und wird zu 2 Wörtern gefaltet.

| Nutzlast | Zellen | Direktaufruf echo | Brücke echo | Brücke sum (nur hin) | Samples |
|---|---|---|---|---|---|
| leer | 0 | 0,0005 / 0,0006 / 0,0006 | 0,0008 / 0,0009 / 0,0014 | | 10000 |
| N-API-Boden (`stats()`, kein Bend) | | 0,0011 / 0,0014 / 0,0016 | | | 10000 |
| 64 B als U32 | 16 | 0,0007 / 0,0010 / 0,0014 | 0,0011 / 0,0013 / 0,0027 | 0,0010 | 5000 |
| 4 KB als U32 | 1024 | 0,0128 / 0,0146 / 0,0157 | 0,0134 / 0,0154 / 0,0169 | 0,0072 | 5000 |
| 100 KB als U32 | 25600 | 0,334 / 0,352 / 0,366 | 0,340 / 0,360 / 0,384 | 0,155 | 300 |
| 1 MB als U32 | 262144 | 3,35 / 3,43 / 3,56 | 3,40 / 3,51 / 3,72 | 1,59 | 50 |
| 64 B, ein Wort pro Byte | 64 | 0,0011 / 0,0014 / 0,0017 | 0,0014 / 0,0016 / 0,0030 | 0,0013 | 5000 |
| 4 KB, ein Wort pro Byte | 4096 | 0,053 / 0,057 / 0,060 | 0,054 / 0,059 / 0,064 | 0,028 | 5000 |
| 100 KB, ein Wort pro Byte | 102400 | 1,36 / 1,48 / 1,59 | 1,34 / 1,42 / 1,52 | 0,63 | 300 |
| 1 MB, ein Wort pro Byte | 1048576 | 13,70 / 14,09 / 14,70 | 13,77 / 14,29 / 14,41 | 6,50 | 50 |

- `stats()` ist langsamer als ein Bend-Aufruf, weil es `getrusage` ruft. Der eigentliche Boden ist der leere Direktaufruf: **0,5 µs**.
- Durchsatz: 0,92 Mio. kleine Aufrufe pro Sekunde (16 Wörter, Brücke, 1,5 s Dauerlauf).
- Marshalling kostet ~6 ns pro Wort hinein und ~7 ns heraus (eine Cons-Zelle pro Wort, dazu das RFC-Siegel). Ein gepackter Puffer-Typ im Bend-Interface wäre der nächste Hebel. Für die Kern-Nutzlasten wird er nicht gebraucht: Das Kodieren von 900 bis 3000 Wörtern kostet 0,1 bis 0,9 ms (siehe Kern).
- Mit 6 und 18 Threads ändert sich die Aufruflatenz nicht (Werte in `latency-t6/t18.json` innerhalb ±3 %).

**Vergleich mit dem Prozess-Dienst** ([baseline.md](baseline.md), Lauf 2, gleiche Größen, ein Wort pro Byte wie dort, p50):

| Nutzlast | Prozess-Dienst | In-Process | Faktor |
|---|---|---|---|
| 64 B | 0,038 ms | 0,0011 ms | 35x |
| 4 KB | 0,142 ms | 0,054 ms | 2,6x |
| 100 KB | 2,93 ms | 1,34 ms | 2,2x |
| 1 MB | 29,1 ms | 13,7 ms | 2,1x |
| 1 MB mit U32-Packung (4 Byte pro Zelle) | 29,1 ms | 3,4 ms | 8,6x |

Kleine Aufrufe gewinnen am meisten, weil Pipe und Event-Loop wegfallen. Große bleiben durch Bends Cons-Listen begrenzt, genau wie die Baseline vermutet hat.

### Threads

| Messung | 1 Thread | 6 Threads | 18 Threads |
|---|---|---|---|
| OS-Threads vor Laden / nach `init` / nach Arbeit | 7 / 7 / 8 | 7 / 7 / 13 | 7 / 7 / 25 |
| Fork-Join-Baum Tiefe 16 (65536 Blätter × 256 Mix-Runden), Direktaufruf p50 | 27,1 ms | 5,26 ms | 4,03 ms |
| Tiefe 12, Direktaufruf p50 | 1,84 ms | 0,54 ms | 0,46 ms |
| Tiefe 8, Direktaufruf p50 | 0,21 ms | 0,12 ms | 0,25 ms |

- Der Pool entsteht beim ersten parallelen Aufruf und **bleibt über alle Aufrufe bestehen**. Die Threadzahl bleibt konstant, es werden keine Threads neu erzeugt.
- Wartende Pool-Threads drehen nicht im Leerlauf. Der Kern-Lauf mit 18 Threads verbrauchte weniger CPU-Zeit als der mit 6 Threads bei gleicher Arbeit (27,9 s gegen 32,9 s).
- Ist ein `!` im Modul (`BANGS != 0`) oder `threads > 1`, läuft Fork-Join-Arbeit auf Pool-Threads. Sonst läuft sie solo auf dem aufrufenden Thread (`probe.c:4575`: `work_loop(..., !BANGS && pool_size == 1)`). Das ist für die Fehlersemantik wichtig.
- **worker_threads:** 4 Worker machten je 2000 Aufrufe (4 KB) auf einer Runtime, alle korrekt. `init` im Worker wird mit `BX_ONCE` abgelehnt: Das Addon ist pro Prozess einmal geladen, seine Statics sind geteilt. Der Mutex serialisiert die Aufrufe: 159 ms parallel gegen 114 ms sequentiell auf dem Hauptthread, p50 16 µs, p99 1,0 bis 1,2 ms (Warten auf den Lock). `IO.die` aus einem Worker kommt dort als `BX_DIE`-Exception an.

### Speicher und Stabilität

- 10000 Aufrufe mit 4 KB: RSS 42,9 → 57,3 MB. 60 Aufrufe mit 1 MB: 58 → 103 MB, ab Aufruf 40 konstant.
- Kern, 300 × `planar-union` (1 Thread, `kernel-soak.json`): Alle 300 Ergebnisse sind identisch, RSS 71,6 → 75,0 MB (~12 KB pro Aufruf). **Mit erzwungener JS-GC** (`--expose-gc`, 150 Aufrufe, `kernel-soak-gc.json`) bleibt der RSS von Aufruf 50 bis 150 konstant bei 67,1 MB. Das Wachstum ist also JS-Müll (die Ergebnis-`ArrayBuffer`), kein Bend-Heap-Leck.
- Zustand zwischen Aufrufen: Jeder Direktaufruf baut einen frischen Task, verbraucht die Argumente und nimmt das Ergebnis heraus (`term_sink` bzw. destruktives Auslesen). Es bleibt nichts hängen außer dem, was als Handle gehalten wird (`stats().handles`).
- Nach einem tiefen Stack-Überlauf steht der RSS bei 2092 MB. Der 2-GiB-Stack von Lane 0 wurde berührt, und `reset()` gibt ihn nicht zurück. Abhilfe wäre ein `madvise(MADV_DONTNEED)` im Reset; das ist noch nicht gebaut.

## 4. Residenz

Residenz funktioniert ohne Serialisierung. Ein Ergebnis-Term bleibt im Bend-Heap, JS hält nur eine kleine Handle-Nummer (`{handle}`). Ein späterer Aufruf bekommt den Term direkt in seinen Task-Knoten.

| 1 MB Liste, p50 ms (`residency.json`) | |
|---|---|
| jedes Mal verschicken (sum) | 1,63 |
| Bend-Zustand in der IO-Schleife (`Store` einmal, `Held` faltet) | 1,65 |
| C-Handle, `dup` (RFC-Teilung) und verbrauchen | 1,73 |
| C-Handle nicht-destruktiv lesen (`read`) | 1,92 |

Bei der Probe dominiert die Faltung selbst, deshalb sind die Werte fast gleich. Entscheidend ist, dass nichts kopiert wird.

Semantik der Handles:

- Ein Handle wird von dem Aufruf verbraucht, der es bekommt (Bend ist linear).
- Ein zweiter Einsatz ergibt `BX_HANDLE: stale or unknown handle`.
- `dup(h)` teilt per Referenzzählung (`term_keep`).
- Dasselbe Handle zweimal in einem Aufruf wird abgelehnt.

**Native Kette auf dem echten Kern** (`frame-with-tab`, `kernel-t1.json`):

1. `keep_words` hält das Result von `subtract` (287 ms).
2. `chain_words` speist dessen Körper in `union` (1234 ms).
3. `enc_held` liest 5937 Wörter (0,15 ms).

Das Ergebnis ist **bitgenau** gleich der JS-Target-Kette `union(body.solid, body.domains, r0.source_budget, ...)` und gleich dem erfassten Produktionsaufruf. Dieselbe Kette mit dem Zwischenergebnis über JS (dekodieren, neu kodieren) liefert dieselben Wörter und kostet 1501 bis 1513 ms gegen 1521 ms. Beide Wege sind also im Rahmen von 1 % gleich schnell, die Rundreise über JS kostet hier nur ~1 ms. Die Residenz spart beim Planar-Kern keine Zeit, weil der Kern die Zeit verbraucht. Entscheidend ist, dass die Host-Rundreise des B-reps entfällt. Sie ist die Ursache von `nativeChainExact: false`.

Einschränkung: Bend 2.0.25 zerlegt nicht-rekursive Datentypen in Parameter-Slots und Ergebnis-Wörter. Ein `KOut`-Parameter wurde zu 12 Slots, `WL_RESW` wuchs auf 51. Ein residentes Handle muss deshalb in einem `List<…>` stecken; der Build erzwingt das. Für eine saubere API bräuchte die Runtime einen „geboxten" Aufruf-Eintrag pro exportierter Def.

## 5. Metal im Prozess

`probe.metal.node` (Objective-C, ARC, Metal- und Foundation-Framework, `-DBEND_METAL=1`) lädt in Node ohne weitere Hilfen. Das Archiv `probe.metal.node.gpu` erzeugt `gpuBuild()` aus dem Addon heraus. `bx_exec_path` sorgt dafür, dass die Runtime es neben der `.node` sucht statt neben `node`.

| Baum-Tiefe | GPU per Direktaufruf `par` p50 / p99 | GPU per Brücke p50 / p99 | CPU 1 Thread p50 |
|---|---|---|---|
| 0 | 0,256 / 0,343 | 0,374 / 1,22 | 0,0016 |
| 4 | 0,286 / 0,487 | 0,272 / 0,554 | 0,096 |
| 8 | 0,577 / 2,48 | 0,423 / 1,45 | 0,209 |
| 12 | 0,496 / 1,31 | 0,598 / 1,70 | 1,91 |
| 16 | 0,650 / 1,19 | 0,639 / 0,685 | 27,3 |
| 18 | 1,97 / 2,07 | 1,48 / 1,58 | 108,3 |

- Die Device-Initialisierung kostet 31 bis 35 ms, einmal pro Prozess. Jeder GPU-Dispatch kostet fest ~0,25 bis 0,65 ms. Ab Tiefe 12 ist die GPU schneller als die CPU mit einem Thread.
- Ein `!`-Aufruf innerhalb einer direkt gerufenen Def (`par(n) = tree!(n, 1)`) geht korrekt auf die GPU (`probe.c:4584`, Pfad `io_gpu && fid_bangs`).
- GPU-OOM (`Grow` mit 10 Mio. Zellen in 512 MB Span) ergibt `BX_FAILSTOP: out of memory: run again with a bigger span`. `reset()` dauert 8 ms, danach ist die GPU wieder nutzbar. Ein zu kleiner Span beim `init` (64 MB) ergibt `init failed: the GPU span is under the rings, stacks and a page per lane`.
- **Nicht versucht:** Metal für den Planar-Kern. Er hat keinen `!`-Aufruf, Metal brächte also nichts. Außerdem wurde der Metal-Build des build123d-Workloads in `out/build123d-kernel/quick-1/report.json` nach 911 s per `SIGKILL` abgebrochen (Timeout). Ohne Archiv würde ein Metal-Kern-Addon beim ersten Start ebenfalls neu kompilieren.

## 6. Fehlersemantik

Jeder Fall lief in einem eigenen Kindprozess (`fail.json`).

| Fall | Ergebnis in Node | Prozess |
|---|---|---|
| Kernel-Fehler als Wert (Planar-Boolean `KBad`, Wire-Status) | Normale Rückgabe mit Status-Wort: 1 (fehlerhafte Wörter), 2 (unbekannte Op), 3 (vorheriges Result unaufgelöst), 4/5 (kein bzw. mehrere Körper). `ops[i].decode` wirft `RangeError: wire: op status N`. | läuft |
| `IO.die(3, "kernel said no")` | `Error` mit code `BX_DIE`, `exitCode: 3`, Meldung „Bend IO.die(3): kernel said no". Die Brücken-Schleife wird neu gestartet (`respawns`). | läuft, nächster Aufruf ok |
| Nat-Überlauf (`2e7²`) auf dem aufrufenden Thread | `BX_FAILSTOP: Bend runtime fail-stop: bend: a Nat past the largest immediate 2^48-1 (runtime poisoned; call reset())`. Jeder weitere Aufruf ergibt `BX_POISONED`. `reset()` dauert 0,1 ms, danach ist alles korrekt. | läuft |
| Stack-Überlauf (Rekursionstiefe 4·10⁹), Brücke und Direktaufruf | Nach 167 ms `BX_FAILSTOP: bend: memory fault (machine stack overflow?)`. WebAssembly-Traps funktionieren danach weiter, `reset()` dauert 0,12 ms. | läuft (RSS 2 GB, s. o.) |
| Fail-Stop auf Pool-Worker (Fork-Join mit 8 Threads, ebenso mit 1 Thread und `!` im Modul) | Keine Exception. stderr: `bend: a Nat past the largest immediate 2^48-1` und `bend-binding: fail-stop outside a JS call (pool worker or init); exiting` | **Node endet mit Exit 1**, ohne Signal |
| Unbekannte Op (Index 99) | `BX_ARGS: unknown op` | läuft |
| Unbekannte Op mit `BX_RAW_OP=1` (Prüfung aus) | Bend führt **still den letzten Arm** aus: `match` wird zu if/else, und der letzte Arm ist das else. Hier ist das `Die`, also `BX_DIE`. | läuft |
| Falsche Argumente im Direktaufruf | `BX_ARGS` (Stelligkeit, Nat außerhalb [0, 2^48), Liste kein `Uint32Array`, Def nicht gebunden) bzw. `BX_HANDLE` (verbrauchtes Handle) | läuft |
| zweites `init` (auch aus einem Worker) | `BX_ONCE` | läuft |
| WebAssembly-OOB-Trap nach `init`, mit Signal-Verkettung | `RuntimeError: memory access out of bounds`, wie ohne Addon | läuft |
| dasselbe **ohne** Verkettung (`BX_NO_CHAIN=1`, Verhalten der Stock-Runtime) | stderr: `bend: memory fault (machine stack overflow?)` | **Node endet mit Exit 1** |

**Warum der Pool-Worker-Fall tödlich ist:** `err_fail` ruft `_exit(1)` auf dem Thread, der den Fehler findet. Auf dem aufrufenden Thread springt `bx_exit` per `siglongjmp` zurück in den N-API-Aufruf. Ein Pool-Worker hat keinen Rücksprungpunkt. Würde er einfach anhalten, warteten alle anderen Threads ewig in `cube_run` auf `pool_done`.

Die Runtime hat einen kooperativen Mechanismus bereits, aber nur für das Device: Dort setzt `err_post` den `H_ERROR_CODE`, Worker prüfen `err_seen`, und `cube_run` meldet den Fehler nach dem Pass. Würde die CPU-Variante denselben Pfad nehmen (`err_seen` ohne `DEVICE &&`, `err_post` auf der CPU ohne `_exit`), wäre auch dieser Fall eine Exception. Das ist eine Änderung an der Bend-Runtime, nicht am Wrapper.

Der Kern selbst meldet fachliche Fehler als Werte (`Unresolved{reason, ...}`, `KBad{status}`). Die gemessenen Kern-Aufrufe lösten keinen Fail-Stop aus.

## 7. Exaktheit

F32 geht als U32-Bitmuster über die Grenze, in beide Richtungen ohne Umwandlung. `exact.json` prüft 21 Sonderwerte, jeweils `bits(x)`, `x+0`, `x·1`, `-x` und `x·x` gegen eine JS-Referenz:

- Keine Abweichung bei +0, -0, ±1,5, kleinster und größter Subnormale (kein Flush-to-Zero: `x+0` bleibt subnormal), kleinster Normale, größter endlicher Zahl (`x·x` → +inf), ±inf, qNaN mit Payload, 1e±30, 2⁻⁷⁵ (`x·x` → 0), π und 1/3.
- NaN-Politik: Das signalisierende NaN `7f800001` bleibt bei `x·1` und `-x` in Bend signalisierend, denn clang faltet `x·1.0` zu `x`, und `-x` ist ein Bit-Flip. JS liefert `7fc00001`. Beide sind NaN. Die Payload-Bits von NaN sind daher **nicht** kanonisch. Ein Vergleich muss NaN als Klasse behandeln, oder der Kern muss selbst kanonisieren.
- F32x2-Paare (`Real{hi, lo}` als zwei Wörter, mit eingestreuten -0, NaN-Payloads, Subnormalen und -inf): 4096 Wörter kommen unverändert zurück.
- Kern: Alle Result-Wörter aller Aufrufe sind bitgleich mit dem JS-Target (siehe nächster Abschnitt), also auch alle `lo`-Wörter der F32x2-Koordinaten.

## 8. Echter Kern: build123d-Planar-Fälle

Die Eingaben sind die erfassten Produktionsaufrufe aus `out/performance/native-build123d/captured.json`.

- Nativ: `call("kcall", [op, words])` im selben Node-Prozess.
- JS: `loadKernel().planarBoolean[op](...args)` im selben Prozess, warm.
- Korrektheit: Die nativen Wörter sind gleich `[0, ...Result.encode(jsResult)]`. Das dekodierte Ergebnis ist `deepStrictEqual` zum JS-Ergebnis, das JS-Ergebnis ist gleich dem erfassten Ergebnis, eine Wiederholung ist identisch, der Brückenweg ist identisch. Alles davon ist in jeder Zeile `true`.

| Fall / Aufruf | Wörter hin / her | Kodieren / Dekodieren JS | nativ 1 Thr p50 (n=5) | nativ 6 Thr p50 | nativ 18 Thr p50 (n=3) | JS-Target p50 (n=2) | JS / nativ 1 Thr | Flächen |
|---|---|---|---|---|---|---|---|---|
| planar-union: union | 892 / 2441 | 0,52 / 0,91 ms | 168,6 ms | 112,7 ms | 98,8 ms | 1639 ms | 9,7x | 26 |
| planar-pocket: subtract | 892 / 4317 | 0,09 / 0,36 ms | 307,3 ms | 196,5 ms | 191,8 ms | 2820 ms | 9,2x | 46 |
| frame-with-tab: subtract | 892 / 3001 | 0,10 / 0,12 ms | 292,3 ms | 177,1 ms | 177,7 ms | 2703 ms | 9,2x | 32 |
| frame-with-tab: union | 3046 / 5937 | 0,09 / 0,22 ms | 1249 ms | 813,5 ms | 798,3 ms | 10424 ms | 8,3x | 64 |

Last: 1 Thread 13,86 → 13,97; 6 Threads 13,97 → 14,91; 18 Threads 14,91 → 15,07.

- Der erste native Aufruf pro Op kostet dasselbe wie die folgenden (168,6 / 308 / 292 / 1217 ms). Es gibt keinen Warm-up-Effekt. Beim JS-Target ist der erste Aufruf 0 bis 9 % langsamer (JIT).
- Grenzkosten der Anbindung pro Kern-Aufruf: Kodieren, Aufruf-Overhead und Dekodieren zusammen unter 1,5 ms, also unter 1 % der Kernzeit.
- Plausibilitätsprüfung gegen das eigenständige native Binary (anderer Workflow, `out/build123d-kernel/quick-1/report.json`, 11:47 Uhr, Last 11,9, ältere Kernquellen): `planar-union` cpu-1 169,5 ms, `planar-pocket` 306,5 ms, `frame-with-tab` 1495,5 ms (beide Aufrufe). In-Process: 168,6 / 307,3 / 292,3 + 1249 ms. **Der Kern läuft im Node-Prozess so schnell wie als eigenes Binary.**
- Threads bringen 1,5x bis 1,7x (6 Threads), mehr als 6 bringen kaum etwas. Das eigenständige Binary zeigte in jenem Lauf keinen Thread-Gewinn für die Einzelfälle. Die Ursache (Kernänderung seitdem oder Aufbau des Workloads) ist nicht untersucht.
- Einordnung: OCCT braucht für die ganze Datei 4,9 / 3,7 / 9,4 ms ([build123d-performance.md](../build123d-performance.md)). Der Abstand liegt im Planar-Algorithmus, nicht in der Anbindung.

## 9. Was nicht ging (genaue Fehler)

| Versuch | Fehler | Folge |
|---|---|---|
| Bend-Library-Modus | `bend --help` und `cli_file` kennen keinen; eine unbekannte Option ergibt `unknown option` | Wrapper um das Standard-C mit Makro-Umleitung |
| Stock-`sigaction` im Node-Prozess | WebAssembly-Trap nach `init` ergibt `bend: memory fault (machine stack overflow?)`, Exit 1 | Signal-Verkettung in `bx_pre.h` |
| Def mit Vorwärtsreferenz im generierten Einstieg | `expected : a defined name / observed : kop` | Der Generator gibt Defs von unten nach oben aus |
| Tupel-Zerlegung eines Aufrufergebnisses | `a parameter or field scrutinee (a match cannot scrutinize a computed value: give it its own def)` | eigene Stufen-Defs (`keep_s`, `chain_s`) |
| `--call kkeep`, ohne dass `kkeep` von `main` erreichbar ist | `FID_KKEEP missing; Bend inlined the def or compiled it into a loop` | Gebundene Defs müssen von `main` erreichbar sein (Brücken-Ops `Keep`/`Chain`/`Read`) |
| `--call kkeep`, erreichbar | wieder `FID_KKEEP missing` (in `keep_s` eingebettet) | stattdessen `keep_words` binden |
| `--call chain_words` mit `KOut`-Parameter | `FID arity 14 but the Bend signature has 2 parameters` (bei `kenc`: 13) | `KOut` in `List<KOut>` verpacken; der Build lehnt Datentypen außer `List` ab |
| Aufrufergebnis mit nicht-rekursivem Typ | `WL_RESW 51`: Ergebnisse können mehrere Wörter sein, `corpus_eval` liefert nur `rv[0]` | Der Build lehnt solche Ergebnistypen ab |
| Op-Index außerhalb des Bereichs | Bend führt den letzten Arm aus, ohne Fehler | Der Treiber prüft den Bereich (`BX_ARGS`) |
| Fail-Stop auf Pool-Worker | Exit 1 (s. o.) | Runtime-Änderung nötig |
| Metal für den Kern | nicht gebaut (kein `!`; der Metal-Build des Workloads wurde anderswo nach 911 s abgebrochen) | offen |

## Empfehlung

1. **In-Process als Produktionsweg.** Der Direktaufruf (`call`) mit wire-kodierten `List<U32>`-Argumenten ist die „C-Extension"-Schnittstelle: 0,5 µs Boden, kein IO, kein Text, bitgenau. Das Addon wird per Skript aus frischem C gebaut (`binding-build.mjs`, `binding-kernel.mjs`), ohne npm-Abhängigkeit. Die JS-Target-Variante desselben Kerns bleibt als Referenz-Backend hinter derselben Wire-Schnittstelle (`wire.mjs` + `loadKernel`). Die Tests vergleichen beide Wort für Wort.
2. **Residente Körper-Handles** sind machbar und schon auf dem echten Kern gezeigt. Eine API „Solid-Handle rein, Result-Handle raus" beseitigt die Host-Rundreise des B-reps und damit die `nativeChainExact`-Frage für native Ketten.
3. **Grenzen der Runtime, die bleiben:**
   - eine Runtime pro Addon und Prozess,
   - Aufrufe laufen seriell (Mutex); Parallelität gibt es innerhalb eines Aufrufs über den Pool,
   - bindbar sind nur von `main` erreichbare und nicht eingebettete Defs,
   - Datentypen außer Listen werden zerlegt.
4. **Isolation:** Solange ein Fail-Stop auf einem Pool-Thread Node beendet, gilt:
   - Fachliche Fehler kommen als Werte (der Planar-Kern tut das).
   - Laufzeitfehler auf dem aufrufenden Thread kommen als Exception.
   - Laufzeitfehler auf Pool-Threads beenden den Prozess **laut**. Es gibt nie einen stillen Rückfall auf das JS-Target.

   Wer das nicht akzeptiert, nutzt für genau diese Fälle den Prozess-Dienst der Baseline als Isolationsschicht (2 ms Neustart). Eine Leistungsbegründung dafür gibt es nicht. Der saubere Weg ist eine CPU-Variante des vorhandenen Device-Fehlerpfads in der Runtime.
5. **Metal** funktioniert im Prozess (31 bis 35 ms Device-Init, ~0,3 bis 0,6 ms pro Dispatch). Es lohnt sich pro Aufruf erst ab einigen Millisekunden paralleler Arbeit. Für den Planar-Kern hat es derzeit keinen Zweck.

Was die Runtime für eine erstklassige Library-Einbettung bräuchte:

- (a) eine Wurzelmenge außer `main`; `compile_book` führt sie schon als Liste,
- (b) pro exportierter Def einen geboxten Aufruf-Eintrag (ein Term pro Parameter hinein, ein Term heraus),
- (c) kooperative Fehler auch auf der CPU (`H_ERROR_CODE`),
- (d) optional einen Kontext statt Statics, damit mehrere Heaps pro Prozess möglich sind,
- (e) ein `madvise` beim Zurücksetzen der Stacks.

## Befehle

```sh
node scripts/native-bridge/binding-build.mjs kernel/service/binding/probe.bend \
  --call echo --call bits --call mix --call tree --call deep --call boom --call par [--metal]
node scripts/native-bridge/binding-kernel.mjs            # Wire + Einstieg + Kern-Addon (≈12 s)
node --test test/native-bridge-binding.test.mjs          # 7 Tests; baut neu, wenn Quellen neuer sind
node scripts/native-bridge/binding-bench.mjs all         # alle Messungen, schreibt out/native-bridge/binding/
node scripts/native-bridge/binding-bench.mjs fails       # nur Fehlerfälle
node scripts/native-bridge/binding-bench.mjs kernels     # nur Kern (1/6/18 Threads)
node scripts/native-bridge/binding-bench.mjs soak 300 1  # Langlauf Kern
```

## Dateien

- `src/native/binding/bx_pre.h`, `src/native/binding/bx_addon.c`: Makro-Umleitungen und N-API-Treiber
- `kernel/service/binding/bridge.c`, `bridge.js`: der `Bridge.next`/`Bridge.reply`-Effekt (die JS-Seite wirft absichtlich)
- `kernel/service/binding/probe.bend`: Probe-Modul für alle Messungen
- `scripts/native-bridge/binding-build.mjs`: baut jede Bend-Datei zu einer `.node` (Tabellen, Prüfungen, Metal-Archiv)
- `scripts/native-bridge/binding-kernel.mjs`: generiert Wire und Einstieg für den Planar-Boolean und baut ihn
- `scripts/native-bridge/binding-bench.mjs`: Messungen; `test/native-bridge-binding.test.mjs`: Tests
- `out/native-bridge/binding/`: `latency-t{1,6,18}.json`, `memory.json`, `residency.json`, `workers.json`, `exact.json`, `metal.json`, `fail.json`, `kernel-t{1,6,18}.json`, `kernel-soak.json`, `kernel-soak-gc.json`. `prev-20260922-2020/` enthält den unterbrochenen Vorlauf (ältere Addon-Version ohne Direktaufruf).
- `tmp/native-bridge/binding/`: `build/` (Probe-C und Addons), `kgen/` (Kern-Wire, Einstieg, Addon), `anatomy/bend-strings.txt`, `scratch/`, Logs
