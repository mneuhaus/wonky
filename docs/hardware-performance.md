# Bend auf dem Apple M5 Pro

Gemessen am 21. September 2026 auf diesem MacBook: **18 CPU-Kerne** (macOS
meldet 6 „Super“ und 12 „Performance“), **64 GiB RAM**, Netzbetrieb, Apple
clang 17, Node 22.23.1, Bend **2.0.25**. Vor und nach dem Lauf meldete macOS
keine thermische oder Performancewarnung; dies ist keine Temperaturmessung.

Dokumentationsabgleich am **22. September 2026**: Diese Messwerte bleiben der
historische Nachweis für die beschriebenen Aufgabenpakete. Für die neueren
[sechs build123d-Vergleichsmodelle](build123d-performance.md) gibt es noch keine
abgeschlossene native CPU-/Metal-Messung; die Modellierungs-CLI verwendet JS.
Vor Wiederholung dieses älteren Hardware-Runners ist dessen nicht rekursive
Dateihash-Erfassung zu korrigieren: `kernel/ports/` wird inzwischen als Datei
gelesen. Das ist ein Quellreview-Befund, kein hier neu ausgeführter Fehlerlauf.

## Beobachtete Rechenzeiten

Dieselben Produktionsfunktionen aus `kernel/boolean.bend` und
`kernel/comparison.bend` laufen unverändert in drei Compilerzielen. Alle
Ausgabefelder einschließlich der B-rep-Punkte, Kurven, Flächen und Topologie
gehen in die Prüfsumme ein. Der Test verwirft die Geometrie nicht einfach und
misst auch keine bloße Formel anstelle des Booleschen Aufbaus.

Warme Mediane aus jeweils sieben gemessenen Paketen nach drei Aufwärmpaketen:

| Arbeitspaket | JavaScript | ARM64, 1 Thread | ARM64, 6 Threads | ARM64, 12 Threads | ARM64, 18 Threads | Metal |
|---|---:|---:|---:|---:|---:|---:|
| 262.144 Zylindervergleiche, 16.384 Teilpakete | 2.152 ms | 85 ms | 17 ms | 11 ms | 9 ms | **2–3 ms** |
| 16.384 echte Durchgangsloch-Booleans, 4.096 Teilpakete | 1.580 ms | 212 ms | 41 ms | 28 ms | 21 ms | **17 ms** |

Die erste GPU-Zeit wird bewusst als Spanne angegeben: Bends `IO.now` löst
nur ganze Millisekunden auf, die sieben Ergebnisse waren 2–3 ms. Daraus ist
kein präziser Faktor von beispielsweise „1076×“ abzuleiten. Der native
18-Thread-Pfad ist in diesen beiden Arbeitspaketen etwa **239× bzw. 75×**
schneller als das JavaScript-Compilerziel. Gegenüber nativ einem Thread sind
es etwa **9,4× bzw. 10,1×**. Der native Einzelthread gewinnt hier bereits
**25× bzw. 7,5×** gegenüber JavaScript.

Das sind **Durchsatzmessungen vieler unabhängiger, einfacher Operationen**,
keine Gesamtbeschleunigung eines großen CAD-Modells und kein r10b-Benchmark.
Der FeatureScript-Interpreter, hostseitige B-rep-Validierung, Datentransport
eines nativen Backends und STEP-Export sind nicht in diesen Rechenzeiten.
Die produktive Modellierungs-CLI verwendet weiterhin JavaScript.

## Die Aufteilung ist entscheidend

Bei gleicher Gesamtarbeit änderte allein die Anzahl unabhängiger Teilpakete
die Metal-Zeit stark:

| Gleiche Arbeit | Wenige Teilpakete | Mittlere Aufteilung | Feinere Aufteilung |
|---|---:|---:|---:|
| 262.144 Vergleiche | 256 × 1.024: **48 ms** | 4.096 × 64: **6 ms** | 16.384 × 16: **2–3 ms** |
| 16.384 Booleans | 64 × 256: **777 ms** | 1.024 × 16: **51 ms** | 4.096 × 4: **17 ms** |

Beim schlecht aufgeteilten Boolean-Fall ist Metal etwa **35× langsamer** als
die native 18-Thread-CPU. Ein pauschaler GPU-Schalter wäre deshalb falsch.
Auch diese Tabelle beschreibt nur die untersuchten Aufgaben; allgemeine
getrimmte Körper haben andere Speicherzugriffe und Verzweigungen.

Eine konkrete Optimierung betrifft bereits unseren Bend-Aufgabenaufbau:
Die rekursive Berechnung der Teilpaketgröße wurde aus den Verzweigungsknoten
vor den gesamten Aufgabenbaum gezogen. Die ursprüngliche Fassung nutzte
effektiv etwa zwei CPU-Kerne, obwohl 18 Threads angefordert waren. Für
50 unveränderte Vergleichspakete ergab `/usr/bin/time -l`:

| | Vorher | Nachher |
|---|---:|---:|
| Verstrichene Zeit | 2,15 s | 0,59 s |
| CPU-Nutzerzeit | 4,25 s | 4,42 s |
| Warmer Median pro Paket | 43 ms | 11 ms |

Prüfsummen und beide F32-Wörter aller 50 Volumenergebnisse waren bitgleich.
Anschließend wurde die gesamte 36-Fälle-Messreihe wiederholt. Der Kern selbst
und seine Geometriealgorithmen wurden für diese Optimierung nicht verändert.

## Startkosten und Korrektheitsprüfung

Sieben neue Prozesse ohne Kernoperationen, Median:

- Vorkompiliertes JavaScript-Benchmarkprogramm: **21,3 ms**.
- Native CPU: **2,1 ms**.
- Metal inklusive Laufzeit-/Geräteinitialisierung: **32,2 ms**.

OS- und Shadercaches können dabei bereits warm sein. Das ist nicht der
Kaltstart der FeatureScript-CLI mit dynamischem Bend-Loader. Die einmalige
Übersetzung dauerte in diesem Lauf 0,19 s für JavaScript, **1,47 s für ARM64**
und **18,97 s für Metal** einschließlich Geräteprogramm. Kleine Einzelaufrufe
rechtfertigen damit noch keinen separaten GPU-Prozess; langlebige Prozesse
und gebündelte Aufträge sind eine naheliegende Architektur.

**36/36 Konfigurationen bestanden** den Ergebnisvergleich. Jeder Messlauf
vergleicht sämtliche Paketprüfsummen und die F32x2-Volumensummen mit dem
JavaScript-Ziel. Eine zusätzlich unabhängig formulierte Double-Volumenformel
ergab maximal etwa **3,4 × 10⁻¹⁴** relative Abweichung. Die Prüfsumme ist ein
Regressionssignal, kein Kollisionsfreiheits- oder Geometriebeweis.

Jeder Metal-Lauf meldete zehn tatsächliche Aufrufe des Metal-Kommandopfads
für zehn Pakete. Dafür fügt der Benchmark einen hostseitigen Zähler in die
generierte C-Datei ein; der Zähler schreibt erst am Prozessende. Compiler,
Kernelquellen und Gerätearithmetik bleiben unverändert. So wird ein stiller
CPU-Fallback nicht als GPU-Messung gewertet.

## Konsequenz für größere Modelle

Die Hardware bietet belegtes Potenzial für viele unabhängige Körper,
Parameterreihen, Flächenpaare und Prüfungen. Allgemeine Booleans können
beispielsweise die Vorauswahl und unabhängige Flächenschnitte parallelisieren;
Topologieaufbau und eine abhängige Featurefolge bleiben teilweise seriell.
Bei einem Anteil von 50 % serieller Arbeit bringt selbst unendlich schnelle
Geometrie höchstens Faktor zwei für den Gesamtprozess.

Als nächste Backend-Schritte sind ein langlebiger nativer CPU-Dienst,
gebündelte Übergaben und gezielte Metal-Aufgaben plausibel. Welche davon in
der gesamten Modellpipeline gewinnen, muss einschließlich Übergabe,
Validierung und Export gemessen werden. Die Hardware behebt keine fehlenden
Geometriefähigkeiten: vollständiges `singleStepR10b` ist weiterhin offen.

## Reproduzieren und Nachweise

```sh
npm run bench:hardware                   # übersetzen und vollständige Messreihe
node scripts/benchmark-hardware.mjs --quick
node scripts/benchmark-hardware.mjs --no-build  # nur bei identischen Quellen
npm run bench                           # separate heutige FS-/JS-Modellpipeline
```

- [Vollständige Messwerte](../out/hardware/report.json), inklusive Quellhash,
  Einzelmessungen, Umgebung, Startzeiten und Korrektheit.
- [Lauf vor der Aufgabenoptimierung](../out/hardware/report-before-scheduling.json).
- [Vorherige Bend-Aufgabenverteilung](../out/hardware/workload-before-scheduling.bend).
- [CPU-Profilzeit vorher](../out/hardware/profile-cpu18-before-time.log) und
  [nachher](../out/hardware/profile-cpu18-after-time.log).
- Messquellen: `scripts/hardware-workload.bend` und
  `scripts/benchmark-hardware.mjs`; Compilerreferenz: `bend.lock.json`.

Die Messreihe wurde ohne gleichzeitig laufende Projekt-Tests ausgeführt.
Andere Anwendungen und die macOS-Threadverteilung wurden nicht kontrolliert.
Die Zahlen stammen von genau dieser Hardware und sind keine allgemeine
Geschwindigkeitsgarantie für Bend oder künftige Modelltypen.
