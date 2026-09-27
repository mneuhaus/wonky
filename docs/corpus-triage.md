# Corpus-Triage: Was von Marcs Teilen baut wonky heute, und was fehlt?

Stand: 23.09.2026. Grundlage:

- der Corpus-Lauf vom 22.09.2026, beschrieben in [corpus/run.md](corpus/run.md), mit den Daten `out/corpus/summary.json` und `runs.jsonl`;
- die zehn Cluster-Analysen `docs/corpus/cluster-*.md`, mit ihren Messdaten unter `out/corpus/<cluster>/`;
- der daraus berechnete Backlog `out/corpus/backlog.json` (`node scripts/corpus/backlog.mjs`).

Der Corpus ist `~/Workspace/cad`. Er wurde nur gelesen. Alle Läufe liefen auf dem Standard-JS-Pfad, mit höchstens 3 wonky-Prozessen und `uptime` im Lauf-Log. Produktionscode, Kernel und Git-Stand sind unverändert.

Wie man den Lauf als stehenden Benchmark wiederholt und gegen diese Baseline vergleicht, steht in [corpus/README.md](corpus/README.md).

## 1. Kurzfassung

**Heute baut genau eine Datei vollständig:** `cad-project-039/belt-fixed-r29/top-clearance-r29/top-clamp-washers-r29.fs`, Familie fs365.

| | FeatureScript | build123d | gesamt |
|---|---:|---:|---:|
| Eindeutige Dateien im Lauf | 332 | 91 | 423 |
| … davon vollständig gebaut | **1** | **0** | **1** |
| Familien im Lauf | 131 | 82 | 213 |
| … mit einer vollständig gebauten Datei | **1** (fs365) | **0** | **1** |
| … mit mindestens einem gebauten Feature | 3 (fs365, fs84, fs85) | 0 | 3 |
| Run-Units (FS: Datei × exportiertes Feature) | 1.188 | 91 | 1.279 |
| … gebaut | 7 | 0 | 7 |

- fs84 und fs85 sind die `module-r4`-Studios des Distributors. Dort bauen nur die beiden Referenzzylinder `driveShaftReferenceR4` und `driveCouplingReferenceR4`, der Rest der Datei nicht.
- **Bereinigt um Nicht-Modelle** bleiben 366 Dateien in 171 Familien: FS 303 Dateien in 115 Familien, Python 63 Dateien in 56 Familien. Herausgenommen sind:
  - 28 header-lose Include-Fragmente (Cluster 9). Sie haben einen Zwilling mit Header, der ihre Features ohnehin ausführt.
  - 28 Python-Tests, -Werkzeuge und -Helfer: pytest-Module, argparse-Skripte, Bibliotheksmodule ohne `result`.
  - eine FS-Bibliotheksdatei ohne Feature.

  42 Familien bestehen nur aus solchen Dateien.
- **Der Corpus scheitert vor dem Kernel.**
  - 71 % der Units stoppen an einem Frontend-Fehler, 21 % an einer expliziten Capability-Grenze und nur 7 % im Kernel.
  - Der Median einer Unit liegt bei 0,93 s bis zum Fehler, p99 bei 1,5 s. JS-Geschwindigkeit ist für den Corpus heute nicht der erste Blocker.
  - Die Ausnahme ist der r10b-Anker: 58,7 s, dann Abbruch bei `g2` unter der Standard-Policy `strict`.
- **Python ist an der Tür blockiert.** 0 von 91 Dateien bauen.
  - 49 Dateien scheitern an Imports, weil der Runner mit `-I -S` startet und das Modellverzeichnis nie auf `sys.path` kommt.
  - 40 Dateien nutzen build123d-API außerhalb des Box/Cylinder/Pos-Shims.
  - Keine Datei bindet `result`.

**Pro Projekt**: Familien FS/Py, Dateien, Units, gebaute Units und die häufigsten ersten Blocker in Units.

| Projekt | FS-Fam. | Py-Fam. | Dateien | Units | ok | häufigste erste Blocker (Units) |
|---|---:|---:|---:|---:|---:|---|
| cad-project-039 | 53 | 0 | 122 | 180 | 1 | boolean-capability 52, fs-needs-partstudio-input 49 |
| cad-project-041 | 26 | 13 | 68 | 132 | 0 | fs-module-import 86, py-imports 9 |
| cad-project-014 | 17 | 16 | 86 | 788 | 6 | fs-headerless-include 280, fs-module-import 155 |
| cad-project-043 (fsocct) | 16 | 1 | 17 | 28 | 0 | fs-module-import 9, fs-missing-builtin 5 |
| cad-project-003 | 0 | 12 | 18 | 18 | 0 | py-api-surface 10, py-imports 8 |
| cad-project-002 | 10 | 0 | 18 | 38 | 0 | fs-module-import 18, fs-interpreter-semantics 13 |
| cad-khana | 0 | 8 | 8 | 8 | 0 | py-imports 8 (alles pytest-Module) |
| cad-project-040 | 6 | 1 | 31 | 31 | 0 | fs-interpreter-semantics 20, fs-missing-builtin 6 |
| cad-project-013 | 0 | 7 | 7 | 7 | 0 | py-api-surface 6, py-imports 1 |
| cad-project-020 | 2 | 3 | 19 | 19 | 0 | fs-interpreter-semantics 16, py-api-surface 3 |
| cad-project-017 | 0 | 5 | 5 | 5 | 0 | py-imports 5 |
| cad-project-038 | 4 | 0 | 4 | 5 | 0 | fs-headerless-include 3, fs-parser-syntax 1 |
| cad-project-032, cad-project-046, cad-project-026, cad-project-033, cad-project-047, cad-project-025, cad-project-048, cad-project-035 | 0 | 1–4 je | 17 | 17 | 0 | py-imports, py-api-surface |
| cad-project-037, cad-project-028 | 1 je | 0 | 3 | 3 | 0 | fs-parser-syntax 2, fs-needs-partstudio-input 1 |

Die Tabelle erzeugt `tmp/corpus/project-table.mjs`.

## 2. Wie korrekt sind die Teile, die bauen?

**Kurz: Die Belege sind korrekt, aber dünn.** Nur 2 der 7 gebauten Units haben eine passende Referenzgeometrie, und beide stimmen überein.

> **Verifikation (23.09.2026), siehe [§7](#7-verifikation-unabhängige-nachprüfung-23092026):** Für `top-clamp-washers-r29.fs` gibt es doch eine Onshape-Referenz (`native/washers-native.step`, gebaut aus bytegleicher Quelle), und sie stimmt überein. Es sind also 3 von 7 mit Referenz, eine davon aus Onshape. fs361 ist nur mit simuliertem F32x2 als gültiges STEP belegt. Alle gebauten Teile sind Kaufteil-Referenzen, keine Druckteile.

**Zuordnung** (`scripts/corpus/reference.mjs`):

- Kandidaten sind alle `.step`/`.stp`/`.stl` im Projekt der Unit.
- Verglichen werden die Namen von Quelldatei, Feature und Körpern, als Kleinbuchstaben und Ziffern.
- Punkte: exakter Namenstreffer 10, Enthaltensein 6 (beide Seiten mindestens 5 Zeichen).
- Zuschläge: +3, wenn die Referenz im Quellverzeichnis oder darunter liegt; +1 für anderswo unter dem Elternverzeichnis; +0,5 für STEP statt STL.
- Eine Referenz gilt ab 9 Punkten als Treffer.

**Messung** (`scripts/corpus/measure.py`, über `uv run` mit `cadquery-ocp`, nur als Orakel):

- Beide Seiten werden gleich gemessen: Volumen, optimale Bounding Box, Flächen- und Kantenzahl.
- Toleranz STEP: Volumen 0,1 %, Ausdehnung und Lage je 0,05 mm.
- Toleranz STL: 1 %, 0,2 mm und 0,2 mm.

| Unit | Referenz | ΔV relativ | ΔAusdehnung | ΔLage | Flächen/Kanten wonky = Ref |
|---|---|---:|---:|---:|---|
| `…/top-full-module-r4/module-r4.fs#driveShaftReferenceR4` | `local/driveShaftReference.step` | 0 | 0 mm | 2,3e-13 mm | 3/3 |
| `…/top-full-module-r4/module-r4.fs#driveCouplingReferenceR4` | `local/driveCouplingReference.step` | 1,7e-16 | 0 mm | 3,4e-13 mm | 4/6 |

Einschränkungen:

- **Einfache Geometrie.** Beide Treffer sind schlichte Zylinder.
- **Keine Onshape-Referenz.** Die Referenz-STEPs stammen aus FreeCAD (OpenCascade STEP 7.8), nicht aus Onshape.
- **Kopien ohne Treffer.** Zwei inhaltsgleiche Kopien in Nachbarverzeichnissen liefern dieselben Zahlen, erreichen aber nur 7,5 bzw. 6,5 Punkte und zählen nicht.
- **Die einzige vollständig gebaute Datei** `top-clamp-washers-r29.fs` (4 Körper, 219,13 mm³) hat keine Referenz im Projekt. Für sie ist keine Übereinstimmung belegt.

**Geometrie aus Prototypen, nicht aus Produktion:**

- Die Befestigungsteile, die über den Bake-off-Hybrid bauen (Abschnitt 4), liefern STEP, das OCCT `BRepCheck_Analyzer` als gültig meldet.
- Für sie gibt es im Corpus keinen Onshape-Export. Die Aussage ist deshalb „gültig“, nicht „stimmt mit Onshape überein“.

**Konsequenz:** Bevor Marc Teile aus wonky druckt, braucht jede neu bauende Familie eine Onshape-Referenz. Das ist Workflow W8 in Abschnitt 6.

## 3. Warum der Rest scheitert

Jede Unit meldet nur ihren **ersten** Blocker. Die Cluster sind deshalb eine Arbeitsliste, keine Prognose.

- „Dateien/Familien“ zählt jede Datei mit mindestens einer Unit im Cluster.
- „primär“ ist eine Partition: Jede fehlgeschlagene Datei zählt einmal, beim Cluster mit den meisten ihrer Units.

Die Repros liegen unter [`fixtures/corpus-repro/`](../fixtures/corpus-repro/README.md). Sie reproduzieren mit der Produktions-CLI:

- FS: `node bin/wonky.mjs <datei> --check [--feature F]`
- Python: `node bin/wonky-python.mjs <datei> --check --python tmp/corpus/uv-python`

| # | Cluster | Units | Dateien / Familien | primär | Ursache in einem Satz | Repro | Analyse |
|---:|---|---:|---:|---:|---|---|---|
| 1 | FS-Modulimporte | 274 | 96 / 38 | 89 / 37 | 92 Dateien importieren Part-Studio-Körper (`NS::build`), für die es keinen eingefrorenen Snapshot gibt. Der Loader bindet an den Quell-SHA und kennt nur Pfade aus demselben Dokument. 4 Dateien importieren FS-Code, wofür es keinen Mechanismus gibt. | [`fs-module-import/`](../fixtures/corpus-repro/fs-module-import/README.md) | [cluster-fs-module-import.md](corpus/cluster-fs-module-import.md) |
| 2 | opBoolean außerhalb der zugelassenen Pfade | 174 | 65 / 17 | 50 / 15 | `booleanInBend` verteilt auf fünf exakte Spezialfälle. Dazwischen fehlen: koaxiale Ringe und Kegel, allgemeine getrimmte Ebene/Zylinder-Booleans, Durchgangslöcher mit drittem Deckel oder F32-Kappen, mehr als zwei Operanden. | [`boolean-capability/`](../fixtures/corpus-repro/boolean-capability/README.md) | [cluster-boolean-capability.md](corpus/cluster-boolean-capability.md) |
| 3 | Interpreter-Semantik | 67 | 58 / 13 | 55 / 13 | Es fehlen Parameter-Defaults aus `LENGTH_BOUNDS` und `is boolean`. Die Annotation-Map wird komplett ausgewertet, dabei `Filter` mit `&&`. `AngleBoundSpec` und `Color` haben keine Typ-Tags. 4 Units sind ein echter Einheitenfehler in Marcs Quelle. | [`fs-interpreter-semantics/`](../fixtures/corpus-repro/fs-interpreter-semantics/README.md) | [cluster-fs-interpreter-semantics.md](corpus/cluster-fs-interpreter-semantics.md) |
| 4 | Feature erwartet vorhandene Part-Studio-Teile | 51 | 51 / 27 | 49 / 25 | Edit-in-place-Features prüfen zuerst „genau ein abgeleitetes Teil“. wonky startet mit leerem Kontext. 2 Dateien sind in Wahrheit `catch { }` ohne Bindung, also ein Parserfehler. | [`fs-needs-partstudio-input/`](../fixtures/corpus-repro/fs-needs-partstudio-input/README.md) | [cluster-fs-needs-partstudio-input.md](corpus/cluster-fs-needs-partstudio-input.md) |
| 5 | Python-Imports | 49 | 49 / 43 | 49 / 43 | Das Modellverzeichnis kommt nie auf `sys.path`, und `-S` blendet site-packages aus. Der Shim ist kein Paket, deshalb greift der Capability-Guard für `build123d.<sub>` nie. | [`py-imports/`](../fixtures/corpus-repro/py-imports/README.md) | [cluster-py-imports.md](corpus/cluster-py-imports.md) |
| 6 | Skizzen/Profile und Operationsgrenzen | 88 | 45 / 10 | 17 / 6 | `opLoft` kann nur zwei koaxiale Kreise (49). Kollineare Profilpunkte werden abgelehnt (15). Profile sind auf 256 Punkte begrenzt (12). Kappennormalen geneigter Extrusionen weit vom Ursprung sind in F32 zu ungenau (10). Line/Arc-Skizzen können keine Kreislöcher enthalten (2). | [`kernel-sketch-and-ops/`](../fixtures/corpus-repro/kernel-sketch-and-ops/README.md) | [cluster-kernel-sketch-and-ops.md](corpus/cluster-kernel-sketch-and-ops.md) |
| 7 | Fehlende Std-Builtins | 56 | 43 / 19 | 25 / 15 | Die Std-Bibliothek ist eine handgeschriebene JS-Tabelle. Es fehlen `opTransform` (29 Units), `makeId`, `qContainsPoint`, `makeRobustQuery`, `qEverything`, `opRevolve`, `atan2` und andere. | [`fs-missing-builtin/`](../fixtures/corpus-repro/fs-missing-builtin/), [`op-transform.fs`](../fixtures/corpus-repro/op-transform.fs) | [cluster-fs-missing-builtin.md](corpus/cluster-fs-missing-builtin.md) |
| 8 | build123d-API außerhalb des Shims | 40 | 40 / 39 | 40 / 39 | Die Namenstabelle des Shims ist geschlossen und eager: Ein unbekannter Name bricht schon die Importzeile ab. `__all__` hat 32 statt 203 Namen. Die Bridge kennt nur box, cylinder, translate und boolean. | [`py-api-surface/`](../fixtures/corpus-repro/py-api-surface/) | [cluster-py-api-surface.md](corpus/cluster-py-api-surface.md) |
| 9 | Header-lose Include-Fragmente | 293 | 28 / 17 | 28 / 17 | Das ist ein Inventarfehler: Der Klassifikator prüft den Header nur bei Dateien ohne Feature. Die Fragmente werden von Generatoren in einen Zwilling mit Header gespleißt. Die Ablehnung durch den Parser ist korrekt. | [`fs-headerless-include/`](../fixtures/corpus-repro/fs-headerless-include/README.md) | [cluster-fs-headerless-include.md](corpus/cluster-fs-headerless-include.md) |
| 10 | Planare Anordnung: InvalidTopology | 57 | 24 / 4 | 2 / 2 | Polygonprismen und ihre Starrkopien werden in F32 gebaut. Schräge Flächen verfehlen ihre Ebene um bis zu 3,6e-5 mm, die Zulassung verlangt 1e-12 × Modellgröße. | [`boolean-invalid-topology/`](../fixtures/corpus-repro/boolean-invalid-topology/README.md) | [cluster-boolean-invalid-topology.md](corpus/cluster-boolean-invalid-topology.md) |
| 11 | Parser-Syntax | 120 | 15 / 12 | 15 / 12 | Der String `"function"` wird als Keyword gelesen (79 Units), ebenso `"-"`. Außerdem fehlen `try silent { }` (36), `for (var k, v in map)` (4) und `\u`-Escapes. | [`string-function-keyword.fs`](../fixtures/corpus-repro/string-function-keyword.fs), [`try-block-statement.fs`](../fixtures/corpus-repro/try-block-statement.fs), [`for-in-key-value.fs`](../fixtures/corpus-repro/for-in-key-value.fs) | nur [run.md §3.11](corpus/run.md) |
| 12 | Sonstiges | 3 | 3 / 2 | 3 / 2 | Eine Bibliotheksdatei ohne Feature und zwei argparse-Skripte. Das sind keine Modelle. | | [run.md §3.12](corpus/run.md) |

**Was die Analysen über den ersten Blocker hinaus gemessen haben** (Details in den Cluster-Dokumenten, Abschnitt „next blockers“):

- **Kein Cluster-Fix baut allein eine Datei fertig.** Hinter jedem Frontend-Fix kommen Boolean-, Loft-, Text- oder Fillet-Lücken.
- **Der Boolean ist der gemeinsame Engpass.** Der Bake-off-Pfad (corefine + recover) wurde test-only in ganze Corpus-Units eingesetzt. Er hat 722 von 769 abgelehnten Booleans exakt zurückgewonnen (93,9 %), und 6 Units laufen damit bis zum Ende. Voraussetzung ist die F32x2-Konstruktion (Cluster 10), sonst lehnt schon die Eingangsprüfung von recover die Operanden ab.
- **`opTransform` taucht hinter fast allem wieder auf.** Statisch rufen es 166 FS-Dateien in 47 Familien auf.
- **Nicht analysierte Kernel-Features begrenzen die Obergrenze.** `opFillet`/`opChamfer` brauchen 108 Dateien in 53 Familien, Text 117 Dateien in 41 Familien, weitere Operationen (`opOffsetFace`, `opSplitPart`, `opSweep`, …) 91 Dateien in 41 Familien.

## 4. Priorisierter Fix-Backlog

### Methode

Ein Teil braucht meist mehrere Fixes. `scripts/corpus/backlog.mjs` bestimmt deshalb pro Datei die **Menge** der nötigen Fixes aus drei Quellen:

1. dem ersten Blocker jeder Unit;
2. den Folgeblockern, die die Cluster-Analysen mit Prototypen, Stubs oder Stand-in-Teilen gemessen haben (alle Quelldateien sind in `backlog.json` unter `sources` aufgeführt);
3. statisch aufgerufenen Std-Funktionen bzw. build123d-Namen, die Produktion nicht kennt. Das gilt nur, solange die Kette einer Datei offen ist.

Jede Datei bekommt eine Belegstufe:

- **gemessen**: Die Datei baut heute, oder jede Unit lief in einem Prototyp mit **echter** Geometrie bis zum Ende, zum Beispiel über den Bake-off-Hybrid oder einen emulierten exakten Fix. Das ist nicht Produktion, aber echte Geometrie.
- **geschätzt**: Jede Unit lief in irgendeinem Probe bis zum Ende, mindestens eine aber mit Stub, Platzhalter oder Stand-in-Teil. Dort ist die Geometrie falsch.
- **offen**: Mindestens eine Kette wurde nie bis zum Ende beobachtet. Die Fix-Menge ist dann eine Untergrenze. Das betrifft 354 der 366 Modelldateien.

**Greedy-Reihenfolge:** Jeder Schritt nimmt das Fix-Bündel mit den meisten neu bauenden Familien pro Aufwandstag. Ein Bündel sind die noch fehlenden Fixes einer Datei. Gezählt wird zuerst auf der Spur „geschätzt“, also gemessen plus geschätzt. Wenn dort nichts mehr dazukommt, zählt die Spur „Obergrenze“, die auch offene Ketten einschließt.

Innerhalb eines Bündels stehen die billigen Fixes zuerst. Die neuen Familien erscheinen beim letzten Fix des Bündels.

Aufwand: S = 1, M = 3, L = 8, XL = 20 Tage. Die Werte sind grob und dienen nur der Rangfolge. P18 (externe Pakete) ist nicht geplant. Dateien, die P18 brauchen, gelten als unerreichbar.

Spalten:

- **Σ Tage**: kumulierter Aufwand.
- **neu (gesch.)**: neu bauende Familien auf der Spur „geschätzt“.
- **Obergrenze**: Zuwachs → Stand, einschließlich offener Ketten.
- **Reichweite**: Modelldateien und Familien, deren Fix-Menge diesen Fix enthält.

Baseline: gemessen 1, geschätzt 1, Obergrenze 1 von 171 Modellfamilien.

| Rang | Fix | Inhalt | Aufwand | Σ Tage | neu (gesch.) | kum. gemessen | kum. geschätzt | Obergrenze | Reichweite Dateien / Familien |
|---:|---|---|---|---:|---:|---:|---:|---|---|
| 1 | K7 | Line/Arc-Skizze mit Kreislöchern | M | 3 | +1 | 1 | 2 | +1 → 2 | 2 / 2 |
| 2 | K1 | F32x2-Polygonprisma + Starrtransform, Pierce-Gate | M | 6 | +1 | 2 | 3 | +1 → 3 | 118 / 43 |
| 3 | P8 | Modul-Loader Stufe 1 (revisionsgebunden) | S | 7 | +0 | 2 | 3 | · → 3 | 109 / 44 |
| 4 | P9 | Onshape-Capture Stufe 2 (Marcs Bridge) | M | 10 | +1 | 2 | 4 | +3 → 6 | 169 / 76 |
| 5 | P12 | Part-Studio-Eingabe | M | 13 | +0 | 2 | 4 | · → 6 | 68 / 38 |
| 6 | K8 | Allgemeiner Boolean-Arm: recover in Produktion | XL | 33 | +4 | 4 | 8 | +4 → 10 | 154 / 55 |
| 7 | K13 | Text (skText, build123d Text) | XL | 53 | +1 | 4 | 9 | +3 → 13 | 117 / 41 |
| 8 | P3 | Std-Builtins: reine Werte | S | 54 | · | 4 | 9 | +4 → 17 | 103 / 43 |
| 9 | K16 | Line/Arc-Stöße (fast-tangent, kollinear) | S | 55 | · | 4 | 9 | · → 17 | 27 / 17 |
| 10 | P4a | Std-Queries I (qEverything, qNothing, makeRobustQuery, qContainsPoint) | S | 56 | · | 4 | 9 | +3 → 20 | 142 / 56 |
| 11 | K4 | Loft Phase 1b (Linien + Bögen) | M | 59 | · | 4 | 9 | +16 → 36 | 26 / 16 |
| 12 | P5 | opTransform | M | 62 | · | 4 | 9 | +8 → 44 | 151 / 46 |
| 13 | P2 | Interpreter-Semantik (Defaults, Annotation, Typ-Tags) | S | 63 | · | 4 | 9 | +2 → 46 | 56 / 14 |
| 14 | P7 | N-äres opBoolean | S | 64 | · | 4 | 9 | +2 → 48 | 24 / 12 |
| 15 | P4b | Std-Queries II (qGeometry, qNthElement, qClosestTo, …) | M | 67 | · | 4 | 9 | +5 → 53 | 119 / 45 |
| 16 | P6 | opRevolve D1 | M | 70 | · | 4 | 9 | +6 → 59 | 39 / 13 |
| 17 | P1 | Parser-Lücken | S | 71 | · | 4 | 9 | +2 → 61 | 17 / 14 |
| 18 | P19 | fCylinder/fCone | S | 72 | · | 4 | 9 | +4 → 65 | 8 / 7 |
| 19 | K17 | Spiegelungen in opPattern/opTransform | M | 75 | · | 4 | 9 | +2 → 67 | 12 / 5 |
| 20 | K3 | Loft Phase 1 (Polygone) | M | 78 | · | 4 | 9 | +3 → 70 | 50 / 11 |
| 21 | P13 | Python-Imports (Modellverzeichnis, --venv) | S | 79 | · | 4 | 9 | · → 70 | 39 / 34 |
| 22 | P14 | build123d-Shim Stufe 1 (Namenstabelle) | S | 80 | · | 4 | 9 | · → 70 | 63 / 56 |
| 23 | P15 | build123d-Shim Stufe 2 (Container, Placement, Outputs) | M | 83 | · | 4 | 9 | +1 → 71 | 63 / 56 |
| 24 | P17 | build123d-Selektoren | M | 86 | · | 4 | 9 | · → 71 | 43 / 36 |
| 25 | P16 | build123d-Shim Stufe 3 (Skizzen, extrude) | L | 94 | · | 4 | 9 | +4 → 75 | 49 / 42 |
| 26 | K12 | opFillet/opChamfer | XL | 114 | · | 4 | 9 | +17 → 92 | 108 / 53 |
| 27 | K14 | Weitere Operationen (opOffsetFace, opSplitPart, opSweep, …) | XL | 134 | · | 4 | 9 | +25 → 117 | 91 / 41 |
| 28 | K2 | Kollineare Profilpunkte | S | 135 | · | 4 | 9 | +4 → 121 | 38 / 11 |
| 29 | P10 | evVolume/evBox3d über importierte Körper | M | 138 | · | 4 | 9 | +4 → 125 | 32 / 8 |
| 30 | K9 | recover-Lücken | L | 146 | · | 4 | 9 | +7 → 132 | 47 / 10 |
| 31 | K6 | Profil-Vertexlimit > 256 | S | 147 | · | 4 | 9 | · → 132 | 19 / 3 |
| 32 | P11 | Feature-Studio-Quellimporte | M | 150 | · | 4 | 9 | +3 → 135 | 4 / 3 |
| 33 | K5 | Loft Phase 2 | XL | 170 | · | 4 | 9 | +4 → 139 | 36 / 8 |
| 34 | SRC | Quellfehler (4 Units, Marc) | XS | 170,5 | · | 4 | 9 | · → 139 | 4 / 1 |
| 35 | P18 | Externe Geometrie/Pakete (nicht geplant) | XL | 190,5 | · | 4 | 9 | · → 139 | 39 / 32 |
| 36 | K10 | Pierce v2 + koaxiale Meridian-Anordnung | M | 193,5 | · | 4 | 9 | · → 139 | Ergänzung zu K8, siehe unten |

### Die Familien auf der Spur „geschätzt“

Nach Rang 7 bauen 9 Familien, 4 davon mit echter Geometrie belegt:

| Familie | Datei | nötige Fixes | Beleg |
|---|---|---|---|
| fs365 | `cad-project-039/belt-fixed-r29/top-clearance-r29/top-clamp-washers-r29.fs` | keine | **gemessen**: baut heute in Produktion |
| fs552 | `cad-project-039/hopper-corner-inserts-r2/archive/rejected-strips/archive-strip-only.fs` | K1 | **gemessen**: exakter Kappen-Fix emuliert |
| fs273 | `cad-project-039/belt-central-r26/direct-mount/direct-mount-r26.fs` | K8 | **gemessen**: Bake-off-Hybrid, echte Geometrie, test-only, native CPU; STEP OCCT-gültig |
| fs361 | `cad-project-039/belt-return-r25/dual-hardware-r25.fs` | K8 | **gemessen**: wie fs273 |
| fs289 | `cad-project-039/belt-fixed-r29/wall-r29/archive-before-part26-clearance/hopper-rear-wall-r29.fs` | K7 | geschätzt: im Probe baut sie nur ohne ihre Löcher |
| fs558 | `cad-project-043/fsocct/cases/workspace/rear_wall.fs` | K7, K8 | geschätzt: Löcher weggelassen, Booleans gestubbt |
| fs508 | `cad-project-041/rocking-photo-tray-r6d-bereinigung/var/native/frame_r2.fs` | P8, P9 | geschätzt: Platzhalterkörper statt Snapshot |
| fs332 | `cad-project-039/belt-fixed-r29/native/return-hardware-r29.fs` und zwei r30-Revisionen | P9, P12, K8 | geschätzt: Stand-in-Teile, Hybrid-Booleans |
| fs64 | `cad-project-014/document-organization/2026-09-10-current/showroom/presentation.fs` | K13 | geschätzt: Text gestubbt, 21 Körper |

Außerdem baut `top-m5x25-reference-r30.fs` mit K8 (gemessen). Die Datei gehört aber zu fs365, das schon zählt.

### Was die Zahlen bedeuten

1. **Ehrliches Ergebnis:** Mit den heute vorliegenden Belegen bauen nach etwa 53 Arbeitstagen 9 von 171 Modellfamilien, 4 davon mit echter Geometrie belegt.
   - Der Rest ist nicht „unmöglich“, sondern **nicht beobachtet**. 166 Familien haben offene Ketten.
   - Die Obergrenze steigt auf 139 Familien, wenn alle geplanten Fixes landen. Sie ist optimistisch, weil offene Ketten nur ihre bekannten Blocker enthalten.
2. **Warum K7 auf Rang 1 steht:** Das Greedy ist mechanisch. K7 hat das beste Verhältnis, betrifft aber nur eine archivierte Rückwand und deren fsocct-Kopie. Das ist wenig Wert für Marcs aktuelle Arbeit.
3. **K8 ist der Drehpunkt.** recover in Produktion ist der einzige Fix mit mehreren gemessenen Familien und steckt in der Fix-Menge von 154 Dateien in 55 Familien. Voraussetzung ist K1, weil die Eingangsprüfung von recover heutige F32-Operanden ablehnt.
4. **Billige Frontend-Fixes erscheinen spät, weil sie allein keine Familie fertig machen.** P1, P2, P3, P4a, P7 und P13/P14 kosten je etwa einen Tag. Sie entfernen aber den ersten Blocker von rund 300 Units, und erst dahinter werden die echten Ketten sichtbar.
   - Ihr Wert ist **Information**: Sie schließen offene Ketten und machen die Schätzung belastbar. Deshalb stehen sie in Abschnitt 6 als erster Workflow, entgegen der mechanischen Reihenfolge.
5. **Der r10b-Anker ist Stufe 1 der Abnahmeleiter und zieht K1, K2, K6 und K8 unabhängig vom Familien-Greedy nach vorn.**
   - Gemessen ist die Kette von `r10bSideDrive`: `g0` kollineare Kanten (K2), `g2` Kappennormale (K1), `g4` `RangeError` in `real(null)` nach Pierce-Kopie (K1-Gate), `g5` Ritzel mit 384 Punkten (K6), `g7` allgemeiner Boolean (K8).
   - `r10bTransferEdge` braucht K1 und danach K8 (AmbiguousContact, M3-Löcher).
   - UpperCore `g2` braucht die P10-Kontaktpolitik bzw. K8. Der Abnahmelauf kam mit `tolerated-regularized` bis `g10`, und recover gewinnt den `g10`-Fuse zurück.
   - Danach ist die Kette offen.
6. **K10 (Pierce v2, koaxiale Meridian-Anordnung)** schaltet laut Modell keine Familie frei, weil K8 dieselben Fälle abdeckt. Es bleibt trotzdem sinnvoll:
   - Die Arme sind exakt, brauchen keine Tessellierung und laufen in Millisekunden auf JS.
   - K8 kostet auf JS 18 ms bis 13 s pro Boolean, und fs95-Features haben 20 bis 50 Booleans.
   - Es ist ein Kandidat, sobald K8 auf JS zu langsam ist.
7. **Python:** Keine Python-Familie erreicht die Spur „geschätzt“.
   - 39 der 63 Python-Modelldateien in 32 Familien brauchen `cad_khana`, `bd_warehouse`, `import_step` oder OCP (P18). Allein 18 davon nutzen `cad_khana`.
   - Ob Marc `cad_khana` auf Bend portiert oder diese Projekte in FS weiterführt, ist eine Produktentscheidung. Sie ist wichtiger als jeder Shim-Fix.

### Entscheidungen, die Marc treffen muss

- **P8:** Die Bindung des Manifests an den Quell-SHA lockern und stattdessen an die Revision binden (element@microversion und Body-Hashes bleiben). Das ändert eine AGENTS.md-Provenienzregel.
- **P13:** Das Modellverzeichnis standardmäßig auf `sys.path` legen. Das ändert den dokumentierten Vertrag in `docs/python-frontend.md`.
- **P15:** `export_stl`/`export_step` als benannte Outputs zulassen und `result` optional machen (CLI-Vertrag).
- **P2:** Ein Query-Parameter ohne Wert wird zu einem expliziten Fehler („UI-Auswahl, über `--param` oder Part-Studio-Eingabe liefern“).
- **Cluster 9:** Fragmente aus der Population nehmen (Klassifikator der Sprach-Inventur).
- **P18:** Wie es mit `cad_khana` weitergeht, siehe Punkt 7 oben.

## 5. Welche laufenden Arbeiten welche Punkte schon abdecken

| Fix | Bake-off (recover/corefine) | Native Binding | Viewer | Sprach-Arbeit |
|---|---|---|---|---|
| K8 allgemeiner Boolean | **ist der Fix.** 722/769 Corpus-Booleans exakt, r10b-`g10`-Fuse zurückgewonnen, 8 von 11 Boolean-Repros als exaktes, OCCT-gültiges STEP. Aber: nicht in Produktion, JS-Geschwindigkeit unbewiesen, Identitäts-Mapping und Volumen für recovered Bodies fehlen | nur Geschwindigkeit; die Hybrid-Messungen liefen nativ auf der CPU | – | – |
| K9 recover-Lücken | benannte Ablehnungen von recover: achsparallele Zylinder („space quartic“, alle fs95-Schraubennaben), tangente Stadion-Ecken, Tessellator für zweischleifige Zylinderflächen, Kegel und F32x2-Prismen | – | – | – |
| K1 F32x2-Prisma | recover lehnt heutige F32-Operanden ab (1e-9 mm); mit F32x2 baut es u. a. den `apronCrest`-Cut des Ankers exakt | **gleiche Naht**: `topology.bend` extrude/transform sind Native-Einstiege; Roadmap-Schritt 3 (extrudePolygon/transform). Ein gemeinsames Re-Baseline | – | WK-Präzisionsvertrag (`extrude_polygon`=F32) muss im selben Schritt mitgehen |
| K2, K6, K7, K3–K5 | recover deckt die Kegelflächen von Loft 1b ab; Loft Phase 2 von keinem Pfad | neue Konstruktoren brauchen neue Native-Einstiege | – | `record-fs.mjs` und `stage-fs.mjs` duplizieren opLoft-Zulassung und `validatePolygon` |
| P2 Interpreter-Semantik | – | – | – | `src/lang/wk/stage-fs.mjs` hat fast dieselbe Semantik; `semcore` muss nachziehen |
| P3/P4a Builtins | – | planares opTransform nativ, analytisches nicht | – | `src/lang/dataflow/fs-values.mjs` hat std-genaue Versionen: übernehmen statt duplizieren |
| P8–P12 Importe/Part Studio | – | keine Wirkung | – | `semcore` und `fs-trace` nutzen `frozenModules`; der WK-Stager hat schon ein symbolisches `partStudio`-Input |
| P13 Python-Imports | – | – | **Abhängigkeit**: Viewer-Watch-Set (spec D5) braucht die Liste geladener Module, die P13(d) liefert; `wonky-view` muss `--venv` durchreichen | WPy v1 plant hash-gepinnte Projektmodule, dieselbe Idee |
| P14–P16 build123d | recover baut die Boolean-Ketten dahinter (beam_frame `optimize=False`, endstop) | – | P14 verlegt Fehler von der Importzeile auf die Nutzungszeile | WPy-Prototyp hat das Vokabular und den Export-als-Output-Vertrag; dessen Knotennamen verwenden |
| Cluster 9 Fragmente | – | – | – | Klassifikator `scripts/lang/fs-analyze.mjs:135` gehört der Sprach-Inventur |
| Geschwindigkeit | – | **der eigentliche Beitrag**: r10b 58,7 s auf JS; WONKY_BACKEND=native deckt 19 Einstiege | – | – |

Kurz:

- Der **Bake-off** deckt den teuersten Punkt (K8) inhaltlich ab. Er braucht aber K1 als Voraussetzung und K9 für den Rest.
- Das **Native Binding** ändert keine Capability. Es teilt sich nur die Naht mit K1.
- Der **Viewer** blockiert keinen Cluster. Er profitiert von P13 und P14.

## 6. Vorgeschlagene nächste Workflows

Jeder Workflow endet mit einem gelabelten Benchmark-Lauf und `compare.mjs` gegen die Baseline, wie in [corpus/README.md](corpus/README.md) beschrieben. Pflicht ist jeweils: keine Regression; die 7 heute gebauten Units bleiben mit gleichem Volumen; `npm test` grün; der r10b-Anker unverändert oder besser.

### W1: Frontend-Sweep (P1, P2, P3, P4a, P7, catch-Bindung), etwa 5 Tage

- **Umfang:** `src/parser.mjs`, `src/interpreter.mjs`, `src/values.mjs`, `src/scalars.mjs`, `src/queries.mjs`, `src/library.mjs`.
  - Prototypen existieren bereits: `scripts/corpus/fs-interpreter-semantics/prototype/`, `scripts/corpus/fs-missing-builtin/harness.mjs`, `scripts/corpus/boolean-hook-loader.mjs` (N-äre Faltung).
- **Abnahme gegen den Corpus:**
  - Alle Repros in `fixtures/corpus-repro/` für Parser, Semantik und reine Builtins bauen mit dem in den READMEs angegebenen Volumen, z. B. `length-bounds-default.fs` einen 25-mm-Würfel. `units-source-error.fs` scheitert weiterhin.
  - `nary-union.fs` ergibt beide Male 15000 mm³ als ein Körper.
  - `run.mjs --label w1 --cluster fs-parser-syntax`, `--cluster fs-interpreter-semantics` und `--cluster fs-missing-builtin`: 0 Units bleiben in `fs-parser-syntax`. In `fs-interpreter-semantics` bleiben nur die 4 Einheiten-Units (SRC). `fs-missing-builtin` enthält nur noch `opTransform`, `opRevolve` und `skText`. Die 13 Aritäts-Units verlassen `boolean-capability`.
  - Die erwarteten Folgeblocker erscheinen: `qGeometry` in 24 Units (21 z-axis-Revisionen, 3 gt2), Pierce in 19, `opSplitPart` in 9. Wenn nicht, wird `backlog.mjs` nachgeführt.
- **Ergebnis:** Die geschlossenen Ketten werden neu gezählt (`backlog.mjs --label w1` auf einem vollen Lauf). Ziel ist, die Spur „geschätzt“ mit echten Daten zu füllen.

### W2: Konstruktionspräzision (K1, K2, K6, Pierce-Gate), etwa 5–6 Tage

- **Umfang:**
  - F32x2-Polygonprisma im Sketch-Frame mit einer F32x2-Starrtransformation;
  - schräge Sweeps bleiben erhalten;
  - Pierce-Gate: ranged Lines zulassen, `volumeMm3 == null` explizit ablehnen, Pierce-Methode in die Transform-Liste aufnehmen;
  - exaktes Zusammenfassen kollinearer Punkte mit Provenienz;
  - Vertexlimit anheben, nach Messung der O(n²)-Zulassung;
  - ein gemeinsames Re-Baseline mit dem Native-Slice und dem WK-Präzisionsvertrag.
- **Abnahme:**
  - Die 57 Units von `boolean-invalid-topology` zeigen keine `InvalidTopology (stage 1)` mehr.
  - `archive-strip-only.fs` baut in Produktion, und sein STEP besteht `uv run scripts/validate-step.py`. Damit ist **fs552 gemessen in Produktion**.
  - `cap-normal-far-from-origin.fs`, `through-hole-tilted-panel.fs` und `collinear-polyline-vertex.fs` bauen.
  - `test/pierce.test.mjs` bleibt grün.
  - `r10bSideDrive` kommt bis `g7` (allgemeiner Boolean). Die 10 Cap-Normal- und 15 Kollinear-Units verlassen `kernel-sketch-and-ops`.

### W3: recover in Produktion (K8, danach K9), etwa 4 Wochen, abhängig von W2

- **Umfang:** der Hybrid als letzter Arm von `booleanInBend`, mit Volumen für recovered Bodies, Face-Tag-Identität und benannten Ablehnungen, ohne Mesh-Fallback.
- **Abnahme:**
  - `direct-mount-r26.fs`, `dual-hardware-r25.fs` und `top-m5x25-reference-r30.fs` bauen über `bin/wonky.mjs` auf dem **JS-Pfad** im Zeitbudget (180 s), mit OCCT-gültigem STEP. Damit sind fs273 und fs361 in Produktion.
  - 8 der 11 Boolean-Repros bauen exakt. `ringBoss` und `bossUnion` scheitern mit recovers benanntem Grund.
  - r10b kommt mit `strict` über `g2` bzw. `g10` hinaus. Die Zeit pro Boolean auf JS wird gemessen und gegen den nativen Pfad berichtet.

### W4: Onshape-Eingaben (P8, P9, P12), etwa 7 Tage, braucht Marcs signierte Bridge

- **Umfang:**
  - revisionsgebundener Loader (Entscheidung zur SHA-Bindung vorausgesetzt);
  - Capture-Skript für alle 63 importierten Revisionen mit Metering und Budget;
  - `partStudio`-Eingabe mit Provenienz je Körper (imported-unchanged, imported-modified, created).
- **Abnahme:**
  - Die 16 r10b-Familiendateien laden mit der bestehenden r10b-Capture. `r10bRetainedContext` baut in allen 7 Dateien.
  - `frame_r2.fs` (fs508) baut mit **echten** Snapshots statt Platzhaltern.
  - `return-hardware-r29/r30` (fs332) bauen mit echter Part-Studio-Eingabe, zusammen mit W3.
  - Kein importierter Körper erscheint als wonky-gebaut.

### W5: Python-Tür (P13, P14, Teil von P15), etwa 3 Tage

- **Umfang:** `python/runner.py`, `python/build123d.py`, `src/python.mjs`, `bin/wonky-python.mjs`, `docs/python-frontend.md`. P13 und P14 landen zusammen, wegen der gemeinsamen `__path__`-Änderung.
- **Abnahme:**
  - 46 der 49 `py-imports`-Dateien kommen über den Import hinaus.
  - Alle 40 `py-api-surface`-Dateien melden einen Capability-Fehler an der **Nutzungszeile** statt an der Importzeile. Die 6 NameErrors werden Capability-Fehler.
  - `submodule-import.py` meldet eine Capability statt `ModuleNotFoundError`.
  - Geladene Module stehen mit SHA-256 in der Provenienz.
- **Erwartung:** Keine Python-Datei baut danach. Der Workflow liefert die wahren Python-Folgeblocker, damit P15/P16 und die `cad_khana`-Entscheidung auf Daten stehen.

### W6: `opTransform` + `opRevolve` (P5, P6, K17 optional), etwa 6 Tage

- **Abnahme:**
  - `op-transform-pose.fs` ergibt 1 Körper, 7 Flächen, 884.7623916933765 mm³. Die `op-revolve.fs`-Features bauen wie im Header angegeben.
  - Die 29 `opTransform`- und 2 `opRevolve`-Units verlassen `fs-missing-builtin`.
  - `qCreatedBy(originalId)` findet den bewegten Körper.
  - `compare.mjs` zeigt, wohin die 70 Hybrid-Units (fs95) nach `opTransform` wandern.

### W7: Loft Phase 1/1b und Line/Arc-Löcher (K3, K4, K7, K16), etwa 10 Tage

- **Abnahme:**
  - `loft-two-polygons.fs#prismatoid` hat das exakte Prismatoid-Volumen, `loft-tapered-slot.fs` ergibt 6646.990938 mm³, `line-arc-sketch-with-holes.fs` und `next-blocker-line-arc-joins.fs` bauen.
  - `hopper-rear-wall-r29.fs` (fs289) baut **mit** Löchern. Damit ist die Familie gemessen.
  - Twisted-, Polygon-zu-Kreis- und Mehrschnitt-Lofts scheitern mit benanntem Grund.
  - Die Loft-Vertex-Zuordnung wird vor jeder Übereinstimmungsaussage gegen `cableClamp_R6.step` geprüft.

### W8: Referenzen für die Kandidatenfamilien, etwa 1 Tag, Marc über die Bridge

- **Umfang:** STEP-Exporte aus Onshape für die Familien der Spur „geschätzt“: fs365, fs552, fs273, fs361, fs289, fs508, fs332. Sie kommen in einen **eigenen**, schreibbaren Ordner, nicht in den Corpus, mit Provenienz (Dokument, Microversion). `reference.mjs` bekommt dafür einen zusätzlichen Suchpfad.
- **Abnahme:** Jede neu bauende Familie hat eine Onshape-Referenz. `reference.mjs --label <run>` meldet `agree` innerhalb der STEP-Toleranz, sonst wird die Abweichung als Befund geführt. Erst dann zählt eine Familie für Marcs Abnahmeleiter („20–50 echte Teile“) als druckbar.

### Empfohlene Reihenfolge

1. W1 und W5 parallel, weil sie billig sind und die Ketten öffnen.
2. W2, die Voraussetzung für W3 und für den r10b-Anker.
3. W8 früh, parallel und billig.
4. W4, sobald Marc Bridge-Zeit hat.
5. W3.
6. W6 und W7.
7. Nach jedem Workflow: `node scripts/corpus/backlog.mjs --label <run>` auf einem **vollen** Label-Lauf und diese Tabelle neu schreiben. Ein Teillauf reicht nicht, weil der Backlog alle Units braucht.

## 7. Verifikation (unabhängige Nachprüfung, 23.09.2026)

Ein zweiter Agent hat den Lauf in frischen Prozessen nachgeprüft. Die Zahlen oben bleiben stehen. Korrekturen und Einschränkungen stehen nur hier und sind in §2 verlinkt.

**Wie geprüft wurde**

- Skript: `node scripts/corpus/verify/verify.mjs` (Repro-Tabelle in `scripts/corpus/verify/repros.mjs`). Produktions-CLIs, Standard-JS-Pfad, `WONKY_BACKEND` nicht gesetzt, höchstens 3 wonky-Prozesse, Zeitlimit pro Datei (Unit-Budget bzw. 300 s pro Repro).
- Lauf: 23.09.2026, 05:11 bis 05:12, HEAD `79bbfeec` plus Arbeitsbaum. `uptime` zu Beginn und Ende in `out/corpus/verify/meta.jsonl` (Load 16,6 / 18,0 / 20,5). Ergebnisse in `out/corpus/verify/results.jsonl`.
- Stichprobe: 45 Corpus-Units, geschichtet. Alle 7 Erfolge, die 3 am weitesten gekommenen Fehler (537, 537, 213 Aufrufe), 2 bis 4 Units pro Cluster mit verschiedenen Meldungsmustern (repräsentativ und nicht repräsentativ), der bekannte Fehler `cad-project-025/beam_frame.py` und der r10b-Anker. 8 davon sind Python-Units. Timeouts gab es im Lauf keine. Die längste Corpus-Unit braucht 5,9 s, der Anker 58 s.
- Alle 99 dokumentierten Repro-Aufrufe unter `fixtures/corpus-repro/`: 64 Cluster-Repros, 25 Folgeblocker, 10 Kontrollen.
- OCCT-Prüfung (`uv run scripts/validate-step.py`) der 7 frisch exportierten Erfolge und der 10 Bake-off-STEPs. Messung gegen Referenzen mit `scripts/corpus/measure.py`.

**Bestätigt**

- Alle 45 Units enden wie im Lauf: gleicher Exit-Code, gleiche Meldung mit Zeile und Spalte. Die 7 Erfolge haben gleiche Körper-, Flächen- und Kantenzahl und bitgleiches Volumen. Keine Quelldatei hat sich seit dem Lauf geändert (SHA geprüft), die Python-Spiegel sind identisch.
- Der Anker scheitert wieder bei `UpperCore/g2` mit `UnsupportedArrangement (tool 1, face 2)`, nach 58,0 s (Lauf: 58,7 s).
- Alle 99 Repro-Aufrufe liefern die dokumentierte Ausgabe. Jedes Cluster-Repro trifft ein Meldungsmuster seines Clusters. Zwei weichen nur im Text ab, bei gleicher Art: `modify-existing-part.fs` (reduzierte eigene Meldung des Modells) und `local-path/main.fs` (anderer Pfad).
- Alle 7 STEP-Exporte sind laut OCCT gültig, und das Volumen stimmt mit dem Kernel überein. Handrechnung: 4 Scheiben 10 × 5,5 × 1 mm ergeben 4 · π · 17,4375 = 219,126 mm³; Welle Ø8 × 40 ergibt 2010,62 mm³; Kupplung Ø20/Ø8 × 20 ergibt 5277,88 mm³.
- Keine Crashes: Kein Datensatz hat eine JS-`TypeError`/`RangeError` als Klasse. In allen Fehlern stimmt die Probe-Meldung mit der CLI-Meldung überein.
- Keine Corpus-Kopie von r10b ist bytegleich mit `fixtures/r10b/r10b.fs`.

**Korrekturen**

1. **`top-clamp-washers-r29.fs` hat eine Onshape-Referenz, und sie stimmt überein.** §2 sagt „keine Referenz im Projekt“ und „keine Onshape-Referenz“. Das ist falsch.
   - `belt-fixed-r29/top-clearance-r29/native/washers-native.step` ist ein Onshape-Export (`originating_system 'ONSHAPE BY PTC INC, 1.220'`, Körpernamen gleich wie bei wonky).
   - `native/washers-state.json` hat `builtHash` = `uploadedHash` = SHA-256 der Corpus-Datei (`62483d06…`). Onshape hat also genau diese Quelle gebaut.
   - Messung (`out/corpus/verify/washer-reference.json`): 4 Solids, 16 Flächen, 24 Kanten auf beiden Seiten. ΔV relativ 2,6e-16, ΔBox ≤ 1e-7 mm (Toleranzrand des Onshape-STEP).
   - Damit haben 3 der 7 Erfolge eine passende Referenz, und alle 3 stimmen. **fs365 ist gegen Onshape belegt.**
   - Ursache: `reference.mjs` vergleicht nur Namen. Die Konvention `native/<stem>-native.step` plus `<stem>-state.json` mit `builtHash` erkennt er nicht.
2. **Der Corpus enthält mehr Onshape-Referenzen, als §2 und W8 annehmen.** `node scripts/corpus/verify/onshape-built-index.mjs` findet 34 Onshape-Build-Zustände, deren `builtHash` bytegleich zu einer Corpus-Datei ist. Für 18 Units liegt daneben ein Onshape-STEP (`out/corpus/verify/onshape-built-index.json`).
   - `top-m5x25-reference-r30.fs` (fs365, über den Bake-off-Hybrid gebaut) stimmt mit `top-clearance-r30/native/m5x25-native.step` überein: 11/23 Flächen/Kanten auf beiden Seiten, ΔV relativ 8,3e-8 mit F32-Operanden und 1,1e-14 mit simuliertem F32x2 (`out/corpus/verify/m5x25-reference.json`).
   - Für fs289 (`hopper-rear-wall-r29.fs`, `belt-fixed-r29/native/wall-state.json`) und fs332 (`return-hardware-r29.fs`/`-r30.fs`, `hardware-state.json`) gibt es kein Onshape-STEP. Es gibt aber einen Onshape-Build derselben Quelle mit Part-Studio-ID und Onshape-Messungen (`*-measurements.json`: Volumen und Bounds je Körper). W8 kann dort ohne Bridge-Zeit mit Volumen und Box anfangen.
3. **fs361 ist schwächer belegt als „wie fs273“.** Über den Hybrid allein baut `dual-hardware-r25.fs` 37 Körper, aber der STEP-Export verweigert (`STEP cylindrical parameter curves unresolved: InvalidSource`, `probe-hybrid-all.jsonl`). Ein OCCT-gültiges STEP (37 Solids, 6273,66 mm³) entsteht nur mit **simuliertem** F32x2 (`hybrid-all-linearc-step`). Das steht korrekt in `cluster-boolean-capability.md`, aber nicht in der Tabelle in §4. fs361 braucht also K1 **und** K8, nicht nur K8. fs273 (`direct-mount-r26.fs`) exportiert dagegen auch ohne F32x2 ein gültiges STEP (8 Solids, 64 Flächen, 1020,37 mm³); geprüft in `out/corpus/verify/validate-hybrid.json`.
4. **Keines der gebauten Teile ist ein FDM-Druckteil.** Das ändert keine Zahl, aber die Lesart für die Abnahmeleiter („20–50 echte Teile“):
   - Die 7 Produktions-Erfolge sind Referenzkörper für Kaufteile: 4 M5-Scheiben, eine Stahlwelle Ø8 und eine Kupplung (`METAL_REFERENCE`).
   - Die über den Hybrid gebauten Units sind Schrauben, Scheiben und Muttern (`direct-mount-r26`, `mounting-r26`, `top-m5x25-reference-r30`, `upper-drive-r3#footBolt/#retentionBolt`). Einzige Ausnahme sind die 5 Idler-Distanzhülsen in `dual-hardware-r25.fs`.
   - fs289 ist eine Sperrholzplatte (`HOPPER PANEL B R29 - plywood 3.2 mm`).
5. **„Familie“ heißt nicht „Teil“.** fs365 fasst 14 Dateien zusammen: 13 verschiedene TOP-Clearance-Teile (Pfosten, Sparren, Halter L/R, Scheiben, M5-Schraube) und als Repräsentant `project-component-db8a67a0-top-plate-r1/native-helpers.fs`, eine Bibliothek ohne Feature (Cluster 12). Die Jaccard-Gruppierung verbindet Dateien desselben Generators. „1 Familie baut“ bedeutet hier: 1 von 13 Teilen, und zwar die Scheiben. Familienzahlen sind für die Leiter kein Ersatz für Teilezahlen.
6. **Einordnung „kernel“.** Die 54 `InvalidTopology`-Units (Cluster 10) kommen in Produktion als `UnsupportedFeatureError`, also als explizite Ablehnung der Zulassung der planaren Anordnung. Die Einteilung „7 % Kernel“ folgt der dokumentierten Regel in `lib.mjs`, nicht der Fehlerklasse. Nach Fehlerklasse wären es 3 % (37 Profilprüfungen). Die Cluster sind davon nicht betroffen.

**Nicht nachgeprüft:** die Bake-off-Zahlen (722/769 Booleans, 6 Units bis zum Ende), die Prototyp-Harnesses der Cluster-Analysen und der Greedy-Backlog. Sie brauchen native Builds bzw. Stubs und liegen außerhalb dieser Prüfung. Stichprobenweise bestätigt: die 10 Bake-off-STEPs in `tmp/corpus/boolean-capability/hybrid-all{,-linearc}-step/` sind laut OCCT gültig.

**Falsche Erfolge:** keine gefunden. Kein als `ok` gemeldetes Ergebnis ist unvollständig, ungültig oder weicht von einer Referenz ab.
