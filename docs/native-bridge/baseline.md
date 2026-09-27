# Native Bridge: Out-of-Process-Baseline

Stand: 2026-09-22 (Messläufe 21:05 bis 21:08), Bend 2.0.25, Apple M5 Pro (18 logische CPUs, 64 GB), macOS arm64, Node v22.23.1. Build-Quellhash `f0bb2d46a3effc69b599753a13baf59c1ea15df25022fe02fd0ffe5fc22d4477`.

## Zweck und Einordnung

Diese Baseline ist der **Vergleichspunkt** für die In-Process-Anbindung (N-API-Addon bzw. Shared Library) und ein möglicher **Isolations-Layer** für Absturzfälle. Sie ist **nicht** das bevorzugte Design. Ein Out-of-Process-Dienst ist laut Vorgabe nur zulässig, wenn In-Process nachweislich nicht machbar oder klar schlechter ist.

Unverändert gilt: FeatureScript-Interpreter und build123d-Shim bleiben in JS. Geometrie rechnet der Bend-Kern. Kein Fehlerpfad fällt still auf das JS-Target zurück; jeder endet in einem `NativeKernelError` oder einem Exit-Code.

## Ergebnis in Kürze

- **Machbar mit Base-Primitiven**, über Pipes, ohne TCP und ohne npm-Abhängigkeiten. Alle Fehlerfälle (Kill, Hänger, kaputte Frames, EOF) kommen in Node als explizite Fehler an, nie als Hänger.
- **Fixkosten pro Aufruf: 22 bis 29 µs** (p50, 64 B, direkt bzw. async). Die In-Process-Anbindung liegt laut Binding-Workflow bei 1,1 bis 1,4 µs für dieselbe Nachricht, also rund 20-mal darunter.
- **Das Aufrufmuster entscheidet.** r10b ruft den Kern 18.604-mal auf; 17.098 dieser Aufrufe kosten im JS-Target zusammen nur 26 ms. Out-of-Process kostet allein der Transport des ganzen Musters 490 bis 572 ms (gemessen, blockierend, direkt). Auf die 17.098 kleinen Aufrufe entfallen davon rechnerisch rund 460 ms, rund 18-mal mehr als heute im JS-Target.
- **Große Nutzlasten** kosten rund 26 ms pro MB (echo), weil Bend Datei-IO als eine Listenzelle pro Byte liefert. Das In-Process-Binding braucht mit derselben Byte-Darstellung 13,8 ms und mit U32-Wörtern 3,4 ms; U32-Wörter stehen der Pipe-Variante mit Base-IO nicht zur Verfügung.
- **Der Interpreter ist synchron** (`src/interpreter.mjs` und `src/library.mjs` enthalten kein `await`). Out-of-Process braucht deshalb einen blockierenden Client. Der beste gemessene (direkte, blockierende FIFOs mit Watchdog) ist bei kleinen Nachrichten sogar etwas schneller als der asynchrone Client; eine Worker-Brücke kostet rund 25 µs pro Aufruf zusätzlich.
- **Bewertung:** Für die Hauptanbindung ist Out-of-Process nach diesen Zahlen klar schlechter als In-Process. Sinnvoll bleibt es höchstens als optionale Absturz-Isolation für einzelne, lange Kernoperationen, bei denen 30 µs und ein paar MB Transport keine Rolle spielen.

## Aufbau

Ein langlebiger nativer Bend-Prozess (CPU-Target, ARM64) liest gerahmte Anfragen von stdin (`File.open("/dev/stdin")` + `File.read_bytes`) und schreibt gerahmte Antworten nach stdout (`File.write_bytes`). TCP war nicht nötig.

- Bend erlaubt kein `match` in Lambdas und keine gegenseitige Rekursion. Die Schleife ist deshalb **eine** Funktion `serve(fuel, +st, step)` über einem expliziten `Step`-Typ; jedes IO-Ergebnis kommt als Feld eines `Step` zurück. `serve` zählt einen `Nat`-Fuel herunter (4294967295 · 65535 Schritte); ist er erschöpft, endet der Prozess mit Exit 70 statt zu hängen. Der Zustand (Zähler, ein residenter Blob) wandert als `Stats` durch die Schleife.
- Datei-IO liefert und nimmt `List<U32>` mit **einer Listenzelle pro Byte** (siehe `bend2/effs/file_read.c`, `file_read_bytes_pack`). Bend 2.0.25 hat für Datei-IO keinen gepackten Byte- oder Wort-Typ.
- Der Dienst liest einen Frame vollständig, bevor er antwortet, und bearbeitet Anfragen strikt nacheinander.

### Protokoll (alle Wörter U32 little-endian)

| Richtung | Aufbau |
|---|---|
| Anfrage | `"WKB1"` (0x31424b57), op, id, len, payload[len] |
| Antwort | `"WKR1"` (0x31524b57), status, id, len, payload[len] |
| READY | einmal beim Start: status 0, id 0, payload = Protokollversion 1 |

| op | Bedeutung |
|---|---|
| 0 ping | Zähler: requests, bytesIn, bytesOut, Länge des residenten Blobs |
| 1 echo | Nutzlast unverändert zurück |
| 2 words | Nutzlast in U32-Wörter dekodieren und wieder kodieren (Länge Vielfaches von 4) |
| 3 store / 4 load | Nutzlast im Prozess halten / zurückgeben |
| 5 kernel | Produktionskern (`scripts/hardware-workload.bend`): payload = kind, depth, count, seed; Antwort JSON `{"hash","hiBits","loBits","errors"}` |
| 6 replay | payload = Antwortlänge R, dann U32-Wörter; Antwort = R Bytes: die U32-Summe (mod 2³²) aller Wörter nach R, dann Nullbytes. Steht für einen Kernaufruf gegebener Anfrage- und Antwortgröße, ohne Kernarbeit |

| status | Bedeutung | Prozess danach |
|---|---|---|
| 0 | ok | läuft weiter |
| 1 | unbekannte op | läuft weiter |
| 2 | ungültige Nutzlast | läuft weiter |
| 3 / 4 / 5 | falsche Magic / Nutzlast > 64 MiB / Header zu kurz | Exit 65 / 67 / 66 |

Weitere Exit-Codes: 0 bei EOF zwischen zwei Frames, 66 bei EOF innerhalb eines Frames, 74 bei Lese-/Schreibfehler, 70 bei erschöpftem Fuel. Nach Status 3 bis 5 lässt sich der Strom nicht resynchronisieren, der Prozess endet nach der Antwort.

### Drei Node-Clients

| Client | Datei | Aufrufart | Timeout / Hänger |
|---|---|---|---|
| `ProcessKernel` | `scripts/native-bridge/baseline-client.mjs` | async (`child_process.spawn`, Event-Loop) | Timer pro Anfrage, danach SIGKILL |
| `SyncProcessKernel` (Worker-Brücke) | `scripts/native-bridge/baseline-sync.mjs` | blockierend: ein Worker-Thread besitzt den `ProcessKernel`, der aufrufende Thread wartet per `Atomics.wait` auf einem SharedArrayBuffer | Timeout des Workers plus Backstop im aufrufenden Thread |
| `DirectProcessKernel` | `scripts/native-bridge/baseline-direct.mjs` | blockierend ohne Thread-Wechsel: `fs.writeSync`/`fs.readSync` auf zwei FIFOs | Watchdog-Thread tötet den Prozess nach Ablauf der Frist (Abfrage alle 20 ms), der blockierte Read endet dann mit EOF |

Warum blockierend: Der Interpreter ruft `k.<fn>(...)` synchron auf und erwartet das Ergebnis sofort. Ein asynchroner Client hieße, Interpreter und Library durchgehend auf async umzubauen.

Node hat kein `pipe(2)`. `DirectProcessKernel` legt deshalb zwei FIFOs an und öffnet sie in einer Reihenfolge, in der kein `open()` blockiert (erst ein O_RDWR-Hilfsdeskriptor, dann die beiden Enden, dann Hilfsdeskriptor schließen). Das Kind bekommt Lese- bzw. Schreibende als stdin/stdout, der Elternprozess behält nur die Gegenenden (O_CLOEXEC). Stirbt das Kind, liefert der blockierte Read sofort EOF bzw. der Write EPIPE.

Alle Clients ordnen Antworten über die id zu, lehnen bei Status ungleich 0 mit `NativeKernelError` (Feld `status`) ab und markieren sich nach Prozessende, Timeout oder Protokollverletzung als tot; spätere Anfragen scheitern sofort.

### Transport-Boden

`kernel/service/baseline/frame-echo.c` (reines C, `clang -O2`) spricht dieselbe Rahmung ohne Bend: Header lesen, Nutzlast lesen, beides zurückschreiben. Er läuft über dieselbe Art Pipe (async: Node-stdio-Pipe, direkt: dieselben FIFOs); der Messcode dafür zählt bzw. liest nur Bytes, ohne Frame-Parsing. Die Differenz zum Bend-Dienst ist damit im Wesentlichen der Bend-Anteil (Einlesen in Listen, Verarbeitung, Ausgabe) plus das Frame-Parsing im Client. `/bin/cat` taugt für den direkten Client nicht: Ein streamender Echo-Prozess verklemmt sich bei Frames über der Pipe-Puffergröße, weil der Client erst den ganzen Frame schreibt und dann liest (im ersten Versuch beobachtet).

## Befehle

```sh
node scripts/native-bridge/build-baseline.mjs          # baut service (Bend nativ), reference.cjs (JS-Target), frame-echo (C); nacheinander
node --test test/native-bridge-baseline.test.mjs       # 10 Tests: Protokoll, Kernel-Korrektheit, replay, beide blockierenden Clients, Fehlerfälle
node scripts/native-bridge/bench-baseline.mjs --label run1   # voller Lauf (unter 1 min), schreibt report-run1.json
node scripts/native-bridge/bench-baseline.mjs --quick  # kurzer Lauf, schreibt report-quick.json
```

Der Quellhash umfasst genau die transitive Import-Hülle von `service.bend` und `reference.bend` (10 Dateien: Kernmodule, Workload, beide Einstiegspunkte), `frame-echo.c` und `bend.lock.json`. Test und Benchmark bauen neu, wenn er sich ändert. Letzter Build: Dienst 1916 ms, Referenz 219 ms, frame-echo 58 ms Wandzeit (Last 13,7). Protokoll: `out/native-bridge/baseline/build.json`.

## Messmethode

- Zeit in Node mit `performance.now()` vom Kodieren der Anfrage bis zur vollständig geparsten und **byteweise verglichenen** Antwort. Warm-up verworfen, Perzentile Nearest-Rank. Eine Anfrage in Flight, `--threads 1`, sofern nicht anders angegeben.
- Samples je Client: 2000 (64 B, 4 KB), 300 (100 KB), 100 (1 MB).
- Speicher: RSS des Dienstes per `ps`.
- **Die Maschine ist geteilt.** Load Average (1 min) vor und nach den Läufen: Lauf 1 13,14 → 12,64, Lauf 2 12,55 → 13,74 (18 logische CPUs; parallel liefen andere Agenten). Die Zahlen sind **indikativ**, keine Messung auf ruhiger Maschine. Die Last steht in den Reports vor und nach jedem Block.

## Ergebnisse

Zwei volle Läufe gegen denselben Build: `report-run1.json`, `report-run2.json`. Tabellen zeigen Lauf 2; Lauf 1 weicht bei p50 um höchstens 4 % ab, p95/p99 schwanken stärker (direkt 1 MB p99: 40,0 gegen 48,8 ms). Alle Antworten aller Läufe waren byteweise korrekt (0 Abweichungen).

### Round-Trip echo (ms, p50 / p95 / p99)

| Größe | async | Worker-Brücke | direkt blockierend | Boden async (C-Echo) | Boden direkt (C-Echo) |
|---|---|---|---|---|---|
| 64 B | 0,029 / 0,064 / 0,164 | 0,052 / 0,119 / 0,215 | 0,022 / 0,039 / 0,063 | 0,009 | 0,007 |
| 4 KB | 0,115 / 0,191 / 0,298 | 0,141 / 0,265 / 0,385 | 0,113 / 0,153 / 0,209 | 0,009 | 0,008 |
| 100 KB | 2,590 / 2,849 / 2,957 | 2,659 / 2,894 / 3,065 | 3,850 / 5,452 / 5,995 | 0,037 | 0,110 |
| 1 MB | 26,13 / 27,32 / 28,31 | 26,58 / 28,53 / 30,52 | 36,06 / 45,31 / 48,81 | 0,275 | 1,022 |

Lauf 1, direkt: 100 KB 3,71 / 4,36 / 4,64, 1 MB 34,75 / 38,72 / 39,97.

- Schon bei 64 B ist der Bend-Anteil größer als die Pipe: Boden 7 bis 9 µs, Dienst 22 bis 29 µs. Bei 4 KB liegt der Dienst bei rund 113 µs, der Boden weiter bei 8 bis 9 µs.
- Ab 100 KB wächst der Bend-Anteil linear mit der Größe: rund 26 ms pro MB gegen 0,3 ms Pipe. Durchsatz des Dienstes rund 40 MB/s.
- FIFOs sind für große Frames langsamer als Nodes stdio-Pipes (Boden 1 MB: 1,0 ms gegen 0,28 ms), deshalb ist der direkte Client ab 100 KB 30 bis 50 % langsamer als der asynchrone.
- Die Worker-Brücke kostet gegenüber dem asynchronen Client rund 25 µs pro kleiner Nachricht (Thread-Wechsel hin und zurück), im Replay 25 bis 58 µs pro Aufruf.

Aufteilung nach Richtung (async, p50 / p99 ms): store (Node nach Bend) 100 KB 2,23 / 2,62, 1 MB 23,19 / 32,09; load (Bend nach Node) 100 KB 1,42 / 1,71, 1 MB 15,19 / 16,41. Beide Richtungen sind teuer. Ein Teil davon ist Implementierung: Der Dienst sammelt Lese-Chunks und verbindet sie mit `List.concat` (ein weiterer Durchlauf über alle Bytezellen); nicht einzeln gemessen.

Mehr Bend-Threads schaden kleinen Anfragen nicht (async, 1000 Samples, p50): `--threads 6` 0,027 ms (64 B) / 0,112 ms (4 KB), `--threads 18` 0,023 / 0,112 ms.

Pipelining (64 B, 32 in Flight, 10.000 Anfragen): 35.662 (Lauf 1) bzw. 42.584 (Lauf 2) Anfragen pro Sekunde. Der synchrone Interpreter kann das nicht nutzen.

### Vergleichswerte der In-Process-Anbindung

Nicht hier gemessen, sondern aus `out/native-bridge/binding/latency-t1.json` des Binding-Workflows (erfasst 2026-09-22 20:59, Last 13,3, `--threads 1`, echo p50 ms). Dort gibt es zwei Darstellungen: `byte` (eine Listenzelle pro Byte wie hier) und `u32` (eine Zelle pro Wort).

| Größe | In-Process byte | In-Process u32 | Out-of-Process direkt | Out-of-Process async |
|---|---|---|---|---|
| 64 B | 0,0014 | 0,0011 | 0,022 | 0,029 |
| 4 KB | 0,054 | 0,013 | 0,113 | 0,115 |
| 100 KB | 1,34 | 0,34 | 3,85 | 2,59 |
| 1 MB | 13,77 | 3,40 | 36,06 | 26,13 |

Das ist ein Gegenüberstellen zweier getrennter Messungen unter ähnlicher Last, keine gemeinsame Messung. Bei 64 B liegt Out-of-Process rund 15- bis 25-mal höher, ab 100 KB rund 2- bis 3-mal (gleiche Byte-Darstellung) bzw. 8- bis 11-mal (gegen u32). Die U32-Darstellung kann die Pipe-Variante mit Base-IO nicht nutzen: `File.read_bytes` liefert Bytes; Wörter daraus zu bauen (op 2) kostet zusätzlich.

### Replay aufgezeichneter Kern-Aufrufmuster

Eingabe: `out/native-bridge/profile/calls/*.json` aus `scripts/native-bridge/count-kernel-calls.mjs` (Profil-Workflow). Dort stehen pro Kernfunktion Aufrufzahl und Summengröße der Argument- und Ergebnisgraphen eines echten JS-Target-Laufs. Jeder Aufruf wird zu einer op-6-Anfrage mit der mittleren Größe seiner Funktion: Anfrage 4 + 4 · ⌈Argumentwörter / Aufrufe⌉ Bytes, Antwort max(4, 4 · ⌈Ergebniswörter / Aufrufe⌉) Bytes. Wörter ≈ Zahlen + Objektknoten + BigInts. Das überschätzt das generierte U32-Format (`gen-wire.mjs` zählt eine Länge pro Liste, nicht ein Wort pro Listenzelle): Für den Planar-Union-Aufruf ergibt die Schätzung 1195 Wörter hinein und 2811 heraus, das Binding kodiert real 892 und 2441 (`kernel-t1.json`). Der Dienst dekodiert jedes Anfragewort und summiert; der Client prüft Summe und Länge. Keine Kernarbeit: gemessen wird der Transport des Musters, sequenziell wie beim synchronen Host. Der SHA-256 jeder Profildatei steht im Report.

| Workload | Aufrufe | MB hin / zurück | async ms | Worker-Brücke ms | direkt ms | direkt µs/Aufruf | JS-Kernzeit laut Profil ms |
|---|---|---|---|---|---|---|---|
| r10b (strict) | 18.604 | 3,63 / 1,11 | 549 | 1028 | 572 | 30,8 | 53.353 |
| frame-with-tab | 839 | 0,23 / 0,07 | 33,5 | 59,6 | 26,6 | 31,7 | 12.921 |
| cut-h1 | 422 | 0,12 / 0,04 | 12,6 | 26,3 | 12,2 | 28,8 | 5.389 |
| planar-pocket | 413 | 0,11 / 0,04 | 13,3 | 23,5 | 12,1 | 29,2 | 3.042 |
| planar-union | 253 | 0,07 / 0,02 | 9,2 | 16,6 | 8,3 | 32,9 | 1.863 |
| fuse-g1 | 202 | 0,06 / 0,02 | 6,1 | 12,4 | 6,5 | 32,0 | 1.451 |
| bored-spacer-print | 96 | 0,02 / 0,01 | 3,6 | 9,1 | 2,6 | 26,6 | 30,5 |
| bracket | 5 | < 0,01 | 0,23 | 0,37 | 0,16 | 31,8 | 2,3 |

Lauf 1, direkt: r10b 490 ms, frame-with-tab 23,6 ms, planar-union 7,0 ms (25 bis 35 µs pro Aufruf über alle Workloads).

Einordnung:

- Die JS-Kernzeit enthält die Rechenarbeit und stammt aus einem anderen, instrumentierten Lauf; die Spalte ist kein Geschwindigkeitsvergleich. Das r10b-Profil endete mit Exit 1 (strikter Lauf) und bildet das Aufrufmuster bis dahin ab.
- In den großen Workloads dominiert ein einzelner schwerer Aufruf die JS-Zeit (r10b: `curved-intersection:intersect` 53,3 s bei geschätzt rund 30.000 Wörtern hinein und 8.600 heraus; frame-with-tab: `planar-boolean:union` 9,9 s). Für solche Aufrufe ist der Transport (wenige ms) vernachlässigbar.
- Das Problem sind die vielen kleinen Aufrufe: In r10b entfallen 17.098 Aufrufe auf sieben Funktionen (`curve_residual` 6284-mal, `surface_residual` 8336-mal, `normalize`, `distance`, `dot`, `axis_x`, `circle`), die im JS-Target zusammen 26 ms brauchen, also rund 1,5 µs pro Aufruf. Out-of-Process kosten sie rechnerisch (Aufrufzahl mal gemessene mittlere Replay-Kosten von rund 27 µs) etwa 460 ms Transport.
- 10 bis 63 % der Argumentknoten (je Workload) wurden vorher vom Kern erzeugt. Ein Dienst mit residenten Ergebnissen und Handles müsste sie nicht erneut übertragen; nicht umgesetzt, nicht gemessen.

### Kernel-Op (Produktionskern, async)

| Fall | Threads | Samples | p50 ms | p99 ms |
|---|---|---|---|---|
| 1 Boolean (depth 0, count 1, seed 37) | 1 | 500 | 0,039 | 0,111 |
| 1 Vergleich (depth 0, count 1, seed 37) | 1 | 500 | 0,025 | 0,077 |
| echo 16 B (gleiche Anfragegröße, keine Kernarbeit) | 1 | 500 | 0,019 | 0,145 |
| 1024 Booleans (depth 8, count 4, seed 37) | 1 | 20 | 13,55 | 14,23 |
| 1024 Booleans (depth 8, count 4, seed 37) | 6 | 20 | 2,78 | 2,99 |

Lauf 1: 0,041 / 0,027 / 0,021 / 13,48 / 2,69 ms (p50).

**Korrektheit:** Jede Kernel-Antwort muss (1) in hash, hiBits, loBits und errors **exakt** dem JS-Target-Build desselben Produktionskerns entsprechen (`kernel/service/baseline/reference.bend` → `out/native-bridge/baseline/reference.cjs`) und (2) im aus hiBits + loBits (F32x2) rekonstruierten Volumen dem unabhängig in double gerechneten Volumen (Formel wie `expectedVolume` in `scripts/benchmark-hardware.mjs`) auf **1e-11 relativ** entsprechen. Alle Fälle bestanden, identisch mit dem JS-Target; relativer Volumenfehler 1,75e-15, 1,82e-15, 1,94e-15. Wiederholte Antworten waren identisch. Der Wechsel auf 6 Threads ist eine End-to-End-Messung eines einzigen Batch-Profils unter Last 13, keine allgemeine Speedup-Aussage.

### Start

| Messung | Lauf 2 | Lauf 1 |
|---|---|---|
| spawn bis READY, p50 / p99 (n=20) | 2,03 / 4,51 ms | 2,09 / 2,71 ms |
| spawn bis sauberes Ende (stdin EOF), p50 | 5,24 ms | 5,50 ms |
| Start Worker-Brücke (inkl. Worker-Thread), p50 (n=10) | 19,6 ms | 20,2 ms |
| Start direkter Client (inkl. mkfifo und Watchdog-Thread), p50 (n=10) | 5,5 ms | 5,2 ms |
| erster Start einer frisch kopierten Dienst-Binärdatei | 107 / 108 / 381 ms | 104 / 110 / 341 ms |
| erster Start einer frisch kopierten **reinen C**-Binärdatei (frame-echo) | 97 / 98 / 101 ms | 113 / 162 / 231 ms |
| zweiter Start derselben Kopie | 2,0 bis 4,7 ms | 2,1 bis 2,6 ms |

Die 0,1 bis 0,4 s beim ersten Start einer neuen Datei zahlt auch ein C-Programm ohne Bend-Runtime. Das ist also ein Effekt von macOS beim ersten Ausführen einer neuen Datei, nicht von Bend. Für ausgelieferte Builds fällt er einmal pro neuer Binärdatei an.

### Speicher und Leerlauf

- RSS im Leerlauf: 1760 KiB (alle 20 Starts identisch).
- Nach den 1-MB-echo-Blöcken rund 32 MB, Spitze mit residentem 1-MiB-Blob 54,5 bis 55,4 MB. Durch denselben Prozess gehen je Lauf rund 295 MB in jede Richtung; der RSS plateauiert auf dem größten Arbeitssatz, kein Wachstum pro Anfrage.
- Nach dem Replay aller acht Muster (20.834 Anfragen, 4,2 MB hin): 6,5 bis 6,7 MB RSS.
- CPU im Leerlauf: 0 s über 2 s bei `--threads 1` und `--threads 18` (`ps`-Auflösung 10 ms). Der wartende Prozess blockiert im Lesen.

### Fehlerverhalten

| Szenario | async | Worker-Brücke | direkt blockierend |
|---|---|---|---|
| SIGKILL während einer 1-MB-Anfrage, Erkennung ab Kill | 1,19 / 1,20 ms | 3,04 / 3,83 ms | 4,86 / 1,32 ms |
| Meldung | `native kernel process exited (code=null, signal=SIGKILL)` | gleich | `... closed its output (exited or was killed)` bzw. `... request pipe failed: EPIPE` |
| nächste Anfrage danach | sofort abgelehnt (0,009 ms) | sofort abgelehnt | sofort abgelehnt |
| SIGSTOP (hängender Prozess), Frist 250 ms | abgelehnt nach 250,5 / 252,0 ms, `timeout: true`, Prozess per SIGKILL beendet | 253,0 / 251,4 ms, `timeout: true` | 265,2 / 273,3 ms (Watchdog, 20-ms-Raster), `timeout: true`, SIGKILL |

Werte als Lauf 2 / Lauf 1. Der Kill kommt aus einem eigenen Thread, der die Kill-Zeit stempelt, während der aufrufende Thread in 1-MB-Anfragen blockiert.

Protokollfehler (async-Client, der rohe Bytes schreiben kann):

| Szenario | Ergebnis |
|---|---|
| falsche Magic | Antwort Status 3, Exit 65 nach 0,5 ms, stderr `bad request magic ...` |
| Nutzlast > 64 MiB angekündigt | Antwort Status 4, Exit 67 nach 0,5 ms |
| EOF im Header / in der Nutzlast | Exit 66, `stdin closed inside a frame header` / `... the payload of request 1` |
| unbekannte op | Status 1, abgelehnt nach 0,08 ms, Prozess antwortet weiter |
| ungültige Nutzlast (words, kernel, replay) | Status 2, Prozess antwortet weiter (Test) |
| Schreiben in die tote Pipe | kein unbehandelter EPIPE, Client als tot markiert (Test) |

In keinem Fall hängt Node. Nichts fällt still auf das JS-Target zurück. Neustart nach Absturz: ein normaler Start (2 ms), der Zustand im Prozess (residente Daten) geht verloren.

## Schlussfolgerungen

1. Die Prozess-Variante funktioniert mit Base-Primitiven von Bend 2.0.25 über Pipes. Alle Fehlerfälle landen als explizite Fehler in Node, auch bei blockierenden Clients (Watchdog bzw. Backstop-Timeout).
2. Der synchrone Interpreter braucht einen blockierenden Client. Der direkte FIFO-Client mit Watchdog ist bei kleinen Nachrichten der schnellste (22 µs p50 bei 64 B); die Worker-Brücke kostet rund 25 µs mehr pro Aufruf.
3. Die Fixkosten von 22 bis 29 µs pro Aufruf liegen rund 20-mal über In-Process (1,1 bis 1,4 µs laut Binding-Workflow). Beim heutigen Aufrufmuster (r10b: 18.604 Aufrufe) kostet allein der Transport rund 0,5 s; davon entfallen rechnerisch rund 460 ms auf 17.098 kleine Aufrufe, die im JS-Target zusammen 26 ms brauchen.
4. Große Nutzlasten kosten rund 26 ms pro MB (async), weil Bend-Datei-IO eine Listenzelle pro Byte baut; die Pipe selbst kostet 0,3 ms pro MB. In-Process braucht dieselbe Byte-Darstellung 13,8 ms und U32-Wörter 3,4 ms; letztere sind über Base-IO nicht erreichbar.
5. Als Isolations-Layer taugt die Variante technisch: Absturz in 1 bis 5 ms erkannt, Hänger über Frist, Neustart 2 ms, Leerlauf ohne CPU und mit 1,7 MB RSS.
6. Nach diesen Messungen ist In-Process für die Hauptanbindung klar vorzuziehen. Out-of-Process lohnt nur für grobe, lange Einzeloperationen als optionale Absturz-Isolation, oder nach einem Umbau auf gröbere Kern-Ops mit residenten Handles.

## Offene Fragen

- Echte Kernaufrufe (Planar-Boolean, Curved-Intersection) mit den generierten U32-Codecs durch den Dienst sind nicht gemessen; das Replay bildet nur deren Transport nach, mit geschätzten (eher zu großen) Größen.
- Resident gehaltene Ergebnisse mit Handles (10 bis 63 % der Argumentknoten stammen aus früheren Kernergebnissen) würden den Transport senken; nicht umgesetzt.
- Der Dienst verbindet Lese-Chunks mit einem zusätzlichen Listendurchlauf; wie viel der 26 ms/MB darauf entfällt, ist nicht gemessen.
- Ein eigener Effekt, der Wörter statt Bytes liest, wäre über den Foreign-Import-Mechanismus von Base denkbar (so sind `File.read_bytes` & Co. angebunden). Das wäre eine Erweiterung der Runtime, nicht geprüft.
- Direkter Client: stderr des Dienstes liest weiterhin die Event-Loop. Schriebe der Dienst während einer einzelnen Anfrage mehr als einen Pipe-Puffer nach stderr, stünde er bis zum Watchdog. Der Dienst schreibt nur eine Zeile bei fatalen Fehlern.
- Werte auf ruhiger Maschine fehlen (alle Läufe bei Load 12,5 bis 13,7).
- Metal/GPU wurde für den Dienst nicht betrachtet (`--gpu off`).
- Grenzen des Prototyps: 64 MiB pro Nachricht, U32-Zähler im ping (Überlauf nach 4 GiB), strikt sequenzielle Bearbeitung.

## Dateien

- `kernel/service/baseline/service.bend`: der Dienst
- `kernel/service/baseline/reference.bend`: JS-Target-Referenz für op 5
- `kernel/service/baseline/frame-echo.c`: Transport-Boden ohne Bend
- `scripts/native-bridge/build-baseline.mjs`: Build (nacheinander, Import-Hüllen-Hash, Last)
- `scripts/native-bridge/baseline-client.mjs`: async-Client `ProcessKernel`
- `scripts/native-bridge/baseline-sync.mjs`: Worker-Brücke `SyncProcessKernel`
- `scripts/native-bridge/baseline-direct.mjs`: direkter blockierender Client `DirectProcessKernel`, `openBlockingPipes()`
- `scripts/native-bridge/baseline-reference.mjs`: Referenzprüfung (JS-Target, unabhängiges Volumen)
- `scripts/native-bridge/bench-baseline.mjs`: Benchmark
- `test/native-bridge-baseline.test.mjs`: Tests
- `out/native-bridge/baseline/`: `service`, `reference.cjs`, `frame-echo`, `build.json`, `report-run1.json`, `report-run2.json`, `report-quick.json`
- `tmp/native-bridge/baseline/`: Konsolenprotokolle der Läufe
