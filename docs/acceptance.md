# Reproduzierbare r10b-Akzeptanz

## Aktuelle Rust-Policy für Skizzen (2026-09-28)

Der historische r10b-Bericht unten ist kein aktuelles Akzeptanzziel. Für Rust
bleibt `strict` der Standard: exakte Konstruktion oder benannte Ablehnung.
Optional kann die bestehende Policy kleine Trägeränderungen bei gemeinsamen
Endpunkten von Linie/3-Punkt-Bogen oder zwei 3-Punkt-Bögen zulassen:

```sh
WONKY_BACKEND=rust node bin/wonky.mjs model.fs --json \
  --curved-contacts tolerated-regularized --contact-cap-mm 1e-9
WONKY_BACKEND=rust node scripts/r20/modules.mjs --out out/r20-regularized \
  --curved-contacts tolerated-regularized --contact-cap-mm 1e-9
```

Die Änderung des gesamten getrimmten Bogens wird rational gegen die explizite
Obergrenze geprüft. Endpunkte bleiben unverändert; die resultierenden Träger
und die Topologie werden exakt geprüft. Jede Änderung steht im
`regularization.merges`-Bericht mit Operation, beteiligten Entitäten und
Abweichungsobergrenze. Geänderte Körper und STEP-Ausgaben tragen `regularized`
und `exact:false`; B-rep JSON enthält zusätzlich die replaybare Konstruktion.
STL bleibt separat als tesselliertes Mesh gekennzeichnet. Frühere Änderungen
bleiben auch bei einer späteren Ablehnung im Bericht erhalten.

Diese Policy ist keine allgemeine Skizzenreparatur, keine Endpunktverschweißung
und keine allgemeine gekrümmte Boolean-Anordnung. Für Kreis-Träger gibt es eine
vorgelagerte Koinzidenzprüfung: rekonstruierte 3-Punkt-Bögen gegen Zylinder oder
Kegelränder, bei exakt übereinstimmender radialer Basis (auch mit vertauschten
oder negierten Achsen). Ursprünge werden rational zwischen den Frames abgebildet.
Der gesamte mögliche Trägerversatz wird im Weltmaßstab rational beschränkt.

Die fehlende Boolean-Topologie wird dadurch **nicht** ersetzt. Der Aufruf lehnt
mit `regularization/coincidence/boolean-arrangement-unimplemented` ab und meldet
`regularization.coincidences`, jeweils mit `applied:false`, Entitäten,
`withinCap`, `maxResidualMm` und `boundMmExact`. Das sind geprüfte Kandidaten,
keine ausgeführten Merges; es gibt keinen Ergebnis-Körper oder gemeinsamen Rand.
Überschreitet jede geprüfte Obergrenze das Cap, lautet die Ablehnung
`regularization/coincidence/residual-bound-above-cap`. Eine konservative
Obergrenze über dem Cap beweist nicht, dass der tatsächliche Abstand darüber liegt.
Nicht unterstützte Frame-Beziehungen behalten die ursprüngliche Ablehnung.
CAD-Acid läuft weiterhin ausschließlich in der unveränderten Exaktklasse.

## Historischer r10b-Stand

Das vollständige Ziel ist weiterhin **nicht erfüllt**. Der beauftragte eigene
CAD-Kern muss die unveränderte FeatureScript-Datei wirklich auswerten und
gültige Ergebnisgeometrie liefern. Erfolgreiche Grundkörper, eingefrorene
Eingänge und das Retained-Teilfeature ersetzen dieses Ziel nicht.

```sh
npm run setup
npm test
node scripts/check-acceptance.mjs

# Ausdrückliche Policy des letzten Stands bis g10; ebenfalls noch Exit-Code 1:
node scripts/check-acceptance.mjs --out out/acceptance-current \
  --curved-contacts tolerated-regularized --contact-cap-mm 1e-7
```

Beide Akzeptanzvarianten liefern derzeit **Exit-Code 1**. Der Standardmodus
bleibt `strict`; der unten dokumentierte Fortschritt bis g10 verwendet die
ausdrücklich gewählte tolerierte Kontaktbehandlung. Es gibt keinen Modus, in dem
ein erwarteter r10b-Fähigkeitsfehler als bestandene Akzeptanz gilt. `--out
<Verzeichnis>` ändert nur den Ausgabeort; standardmäßig ist es
`out/acceptance/`. Der Runner ruft denselben `build()` wie die CLI auf. Seine
vorübergehenden Interpreter-Beobachter erfassen Aufrufe und Fehler und werden
anschließend entfernt. Sie ersetzen keine Bibliotheksfunktion, verändern
keine Modellparameter und unterdrücken auch in `try silent` keine Fehler.

Ein einzelner Lauf prüft:

1. Den festgehaltenen SHA-256-Wert, 404086 Bytes und 1417 Zeilen der Quelle;
   die Bindung des Modulmanifests an diese Quelle und die Importrevisionen;
   alle 24 eingefrorenen Dateien, also acht Teilelisten und 16 Körperdateien.
2. Echte Builds und STEP-Exporte von Box, konkavem Winkel, Kegelstumpf,
   gebohrtem Zylinder und dem originalen `r10bRetainedContext`. Erwartet werden
   1/1/1/1/5 Körper; für die vier Grundmodelle außerdem unabhängige
   Volumenreferenzen von 4000, 8832, 448π und 210π mm³.
3. Das **vollständige** `singleStepR10b` mit den Defaults der Originalquelle.
   Alle neun direkt aufgerufenen Baugruppen müssen zurückkehren; der Build
   muss validierte geschlossene Körper und einen vollständigen Export liefern.
4. Alle in diesem Lauf erfolgreich erzeugten STEP-Dateien mit dem bestehenden
   `scripts/validate-step.py`. OpenCascade liest und prüft ausschließlich diese
   Exporte. Es konstruiert oder repariert keine Produktionsgeometrie.
5. Dass sich die erfassten Implementierungs-, Beispiel- und Eingangsdateien
   während des Laufs nicht geändert haben. Ein solcher Lauf kann nicht grün
   werden; nach parallelen Änderungen wird er erneut ausgeführt.

Der Runner startet nicht nochmals die gesamte Testsuite. `npm test` ist die
separate Voraussetzung mit den Bend-Prüfungen und Integrationstests. Ein
später grüner r10b-Lauf belegt zunächst diese Default-Konfiguration und die
genannten Prüfungen. Ohne einen eingefrorenen vollständigen Referenzkörper
belegt er keine Gleichheit mit Onshapes gesamtem Ergebnis. Auch die allgemeine
Vollständigkeit eines CAD-Kerns folgt nicht aus einem einzigen Modell.

## Artefakte und beobachteter Stand

Aktueller gespeicherter Lauf nach planarer Union/Differenz und Skizzenbögen:
[`out/acceptance-difference-arcs/report.json`](../out/acceptance-difference-arcs/report.json),
22. September 2026, 09:58:58–10:03:13 UTC. Die Implementierung war während des
Laufs stabil; ihre 150 erfassten Dateien stimmen beim Dokumentationsabgleich
weiterhin mit dem Manifest überein. Implementationshash:
`15db6d73db9218721d8a1e378f60dbe80fee1179678e0633316e8d5106497a03`.

**Fünf Referenzmodelle mit strenger CurveOnSurface-STEP-Prüfung bestehen.**
Das vollständige r10b bleibt fehlgeschlagen: **44/45 beobachtete
Operationsaufrufe abgeschlossen, 0/9 Hauptstufen**. Die separate vollständige
Testsuite besteht mit **533/533 Tests**, ohne übersprungene Tests;
[Protokoll](../out/tests-difference-arcs-viewer.log). Drei danach hinzugekommene
Benchmark-Harness-Tests sind separat geprüft und nicht in 533 enthalten.

| Artefakt des aktuellen Laufs | Inhalt |
|---|---|
| [report.json](../out/acceptance-difference-arcs/report.json) | Entscheidung, Eingangs-/Implementationshashes, Referenzen, Stufen, Aufrufzahlen und erster Fehler |
| [inventory.json](../out/acceptance-difference-arcs/inventory.json) | Statische Erreichbarkeit, Fundstellen, Verzweigungen, Imports und nicht aufgerufene Funktionen |
| [step-validation.json](../out/acceptance-difference-arcs/step-validation.json) | Unabhängige STEP-Prüfung der erfolgreichen Referenzmodelle |
| [step-validation.log](../out/acceptance-difference-arcs/step-validation.log) | Vollständige Ausgabe des Validators |
| [first-failure-operands.json](../out/acceptance-difference-arcs/first-failure-operands.json) | Tatsächliche vollständige B-reps unmittelbar vor g10; kein fertiggestelltes r10b-Modell |

`buildUpperCore` bricht weiterhin ab. `buildLowerCore`, `buildCarriage`,
`buildSideDrive`, `buildFrames`, `buildTrayArms`, `buildCameraSupports`,
`buildTransferEdge` und `buildRetainedContext` werden im Hauptlauf noch nicht
erreicht. Das separat erfolgreiche Retained-Teilfeature mit fünf Körpern
zählt nicht als abgeschlossene Hauptstufe dieses Builds.

Kein vollständiges `singleStepR10b.step` oder Ergebnis-B-rep wird geschrieben.
Alte gleichnamige Ergebnisse im gewählten Ausgabeordner werden vor einem
neuen Lauf entfernt. Alle 16 Eingangskörper sind zusätzlich separat unter
`npm run check:inputs` geometrisch geprüft; eine Hashprüfung allein ist kein
Geometrienachweis. Die früheren Abnahmen unter `out/acceptance/` und
`out/acceptance-pcurves/` bleiben historische Berichte.

## Aktueller konkreter Kernelblocker

Der beobachtete Aufrufpfad im eingefrorenen Quelltext ist:

```text
singleStepR10b
  buildUpperCore                  1408:1
    join                           225:9
      combine                       28:82
        opBoolean(UNION)            25:2
        operationId: model/UpperCore/g10/op
```

Die Fehlermeldung lautet:

```text
UnsupportedFeatureError: opBoolean supports coaxial cylinder primitives, admitted planar arrangement unions/subtractions and plane/cylinder intersections with a convex tool; general trimmed-face booleans are not implemented
```

Die P10/Quader-Schnitte `g2`/`g4` sowie die planaren Vereinigungen `g7`/`g9`
sind mit der genannten Policy davor erfolgreich abgeschlossen. g10 versucht,
den planaren g9-Körper mit dem gekrümmten g2-Ergebnis zu vereinigen:

| Operand | Tatsächliche Geometrie vor der Union |
|---|---|
| A: transformiertes g9-Ergebnis | F32x2; 84 Punkte, 164 Geradenkanten, 82 Ebenenflächen; Volumen 56948,08343505894 mm³ |
| B: transformiertes g2/P10-Ergebnis | F32x2; 90 Punkte, 135 Kanten, 50 Flächen; 40 Ebenen, 10 Zylinder, 114 Linien, 20 Kreise, eine Ellipse; 63 Flächenränder; Volumen 30269,952370419458 mm³ |

Diese Operanden sind zusätzlich mit Provenienz unter
[`fixtures/boolean-stress/r10b-g10-operands.json.gz`](../fixtures/boolean-stress/r10b-g10-operands.json.gz)
eingefroren. Der getrennte g10-Staging-Aufbau
hat inzwischen einen nativen Versuchskörper zusammengesetzt. Er ist weder
vollständig unabhängig über STEP abgenommen noch in die FeatureScript-
Auswertung eingebunden und ändert diesen Akzeptanzstatus nicht.

Die Zulassung muss fehlende Volumenüberlappung und vollständige Kontaktpaare
begründen, analytische Trims korrekt teilen, alle Kantenverwendungen erhalten
und eine geschlossene Ergebnisschale liefern. Ein gerundeter Null-Bound oder
ein erfolgreicher interner Konstruktor allein genügt nicht. Der datierte
Arbeitsstand hält den exakten offenen Kontaktbefund und die nächste Abnahme fest.

## Benötigte Operationen und noch ungeprüfte Pfade

Die Zahlen in dieser Tabelle sind **statisch erreichbare Quellfundstellen**,
keine erwartete Zahl von Laufzeitoperationen. Ein einzelner Helper wird oft
hundertfach oder in Schleifen aufgerufen. Die Inventur verfolgt benannte
Funktionsaufrufe und berücksichtigt beide Zweige von Bedingungen; sie
behauptet nicht, dass jeder Zweig mit den Defaults ausgeführt wird.

| Aufruf | Erreichbare Fundstellen | Beleg und Lücke |
|---|---:|---|
| `opBoolean` | 6 | g2/g4-Schnitt und g7/g9-Union abgeschlossen; g10-Union tatsächlich gescheitert; weitere Ketten noch nicht ausgewertet |
| `skArc` | 1 | Originale zwölf M3-Profilbögen in `m3HybridSketch`, Zeile 131, einschließlich analytischer Extrusion separat ausgeführt und geprüft; im Hauptlauf noch nicht erreicht. [Skizzenbögen](sketch-arcs.md) |
| `skLineSegment` | 3 | Genau eine einfache geschlossene Gerade-Kontur wird nativ in Bend aus ungeordneten und unabhängig orientierten Segmenten montiert; Dreiecksquerschnitt wie in `m3ReliefTool`, Zeilen 151–153, separat extrudiert und als STEP unabhängig validiert. Originale SI-Endpunktidentität und Segment-IDs bleiben erhalten. Beleg: [Linienkonturen](sketch-lines.md), `examples/line-sketch.fs`, `out/sketch-lines/step-validation.json`; der folgende `opRevolve` bleibt offen |
| `opRevolve` | 1 | 360°-Revolve dieses Querschnitts, Zeile 155; `m3HybridTool` wird im UpperCore ausdrücklich mit `entryRelief=true` aufgerufen; derzeit kein implementierter Builtin |
| `opExtrude` | 6 | Polygon-, Kreis- und analytische Linien-/Bogenextrusion belegt, einschließlich originaler M3-Kontur; spätere Hauptlaufaufrufe noch nicht erreicht |
| `newSketchOnPlane`, `skSolve` | je 7 | Einfache geschlossene Polygon-, Kreis- und zugelassene Linien-/Bogenprofile belegt; allgemeiner Constraint-Solver und beliebige Mehrregionenskizzen offen |
| `skPolyline`, `skCircle` | 2 / 3 | Grundmodelle belegt; spätere konkrete r10b-Aufrufe und alle Parameterkombinationen noch nicht erreicht |
| `opLoft` | 1 | Zwei koaxiale Kreisprofile in `r10bTrayCountersink`, Zeile 618; Grundoperation separat belegt, die anschließende Differenz im Tray noch ungeprüft |
| `opPattern`, `opDeleteBodies` | 1 / 17 | Starre Kopien und Löschungen vor dem Abbruch abgeschlossen; weitere Nachweise durch Retained-Teilfeature und Transformationstests |
| `newInstantiator`, `addInstance`, `instantiate` | 11 / 16 / 11 | Ein Quellteil im Hauptlauf übernommen; fünf Retained-Körper separat ausgewertet und exportiert |
| `evBox3d`, `evVolume` | je 1 | Nur in der Fehlerdiagnose von `finish`, wenn die Ergebnismenge nicht genau einen Körper enthält; keine Pflichtoperation eines erfolgreichen `finish`; beliebige importierte Volumen/tight Bounds weiterhin offen |

Aufgerufene externe Modulkontexte sind `base`, `carrier`, `frame`, `tray`,
`adapter`, `camera` und `belt`. `floor` wird importiert, aber vom Ziel nicht
aufgerufen. Ein Importname allein belegt keine benötigte Geometrieoperation.

Beide `opFillet`-Fundstellen liegen ausschließlich in den vom Ziel nicht
aufgerufenen Helpern `roundX` und `filletXWindow`; dasselbe gilt für deren
`evLine`-Aufrufe. `frustum` und `m3HybridHole` sind weitere nicht aufgerufene
Helper mit geometrischen Aufrufen. Es gibt **keinen `opSweep`-Aufruf** in
dieser eingefrorenen Datei. Allgemeine Fillets, Sweeps und Lofts bleiben
Anforderungen an einen umfassenden CAD-Kern, sind aber nicht durch diese
r10b-Aufrufkette als nächste Auswertungsblocker belegt.

Die Reihenfolge der tatsächlich auftretenden weiteren Fehler bleibt bis zum
erfolgreichen allgemeinen Boolean unbekannt. Der Runner setzt keine Fehler
außer Kraft, um scheinbare Folgeergebnisse zu sammeln. Nach jeder echten
Kernelergänzung werden Tests und dieser vollständige Lauf erneut ausgeführt;
`report.json` bleibt die maschinenlesbare Aussage über das jeweils erreichte
Ergebnis.
