# CAD-Tests mit FeatureScript und Bend

Der Ansatz eignet sich für eine lokale, reproduzierbare Testplattform. Eine
allgemeine CAD-Prüfbibliothek ist der heutige Kern noch nicht: Fähigkeiten und
Messbasis müssen im Bericht ausdrücklich stehen. Das vollständige
`singleStepR10b` scheitert weiterhin an allgemeinen Booleschen Operationen.

## cad-project-043 als Ausgangspunkt

Untersucht wurden `../cad/cad-project-043/pruefstand`, insbesondere `SPEC.md`,
`src/pruefstand/results.py`, `kernel.py` und `primitives/same_as.py`, sowie
`knowledge/foundations/verification.md` und der bestehende Ansichtenrenderer.
Prüfstand hat bereits Spezifikationen für Abstand, Überdeckung, Überstand,
Gleichheit, Schnittstellen, Bewegungsraum, Schraubketten, Zugänglichkeit,
Drucklage, Stabilität und Form. Diese fachlichen Verträge sind wertvoller als
eine zweite Sammlung ähnlich benannter Einzeltests.

Der vorhandene Python-`Body.solid` erwartet build123d/OCP-Objekte. Ein
Bend-Backend lässt sich deshalb nicht einfach als anderes Objekt einsetzen.
Sinnvoll ist eine explizite Backend-Schnittstelle für Messungen und
Geometrieartefakte, mit Fähigkeiten und klaren Fehlern pro Operation. Die
pytest-, Spezifikations- und Berichtsschicht kann darüber weiterverwendet
werden. OpenCascade bleibt ein unabhängiger Prüfer exportierter Artefakte.

Leere Messmengen, nicht aufgelöste Anforderungen, technische Fehler und eine
bestandene Anforderung sind verschiedene Ergebnisse. Auch abgeschnittene
Prüffenster müssen erkennbar bleiben: deren künstliche Ränder können Abstands-
und Kontaktmessungen verfälschen.

## Bereits ausführbare Messungen

`wonky-compare` misst für zwei koaxiale Zylinder mit Bend:

| Messung | Bedeutung |
|---|---|
| Hinzugefügtes / entferntes Volumen | Materialänderung in beide Richtungen |
| Symmetrische Differenz | Summe beider Änderungen; gleiche Gesamtvolumina reichen nicht |
| Gemeinsames Volumen | Volumetrische Überschneidung |
| Mindestabstand | Trennung im unterstützten Zylinderfall |
| Deckflächenkontakt | Exakt zusammenfallende Stirnflächen, mit Kontaktfläche |
| Axiale Überlappungslänge | Kein allgemeiner Eindring- oder Verschiebeabstand |

```sh
node bin/wonky-compare.mjs examples/compare-before.fs examples/compare-after.fs \
  --geometry --out out/comparison-demo
```

Der Bericht enthält Quellenhashes, Toleranz, Messbasis, Grenzen und optional
STEP/B-rep-Dateien für hinzugefügtes, entferntes und gemeinsames Material.
`status: measured` bedeutet, dass eine Messung vorliegt. Ob sie eine
Anforderung erfüllt, entscheidet erst deren separat festgelegter Grenzwert.
Nicht koaxiale oder allgemeine Körper werden explizit abgewiesen.
Vollständig eingeschlossene Hohlräume können skalar verglichen werden; deren
Differenzgeometrie ist noch nicht implementiert.

Abstand null beweist keine Durchdringung. Ein vollständig enthaltener Körper
benötigt auch dann eine Innen/Außen-Klassifikation, wenn sich keine Ränder
schneiden. Prüfstands bestehendes `same_as` verwendet Stichproben auf Netzen;
eine B-rep-Volumendifferenz ist eine zusätzliche, anders begründete Messung.
Für allgemeine Freiformflächen fehlen uns noch die nötigen Algorithmen.

## Standardisierte Bilder

`scripts/render-comparison.py` verwendet den bestehenden cad-project-043-Renderer
und dieselbe orthografische Kamera, Skalierung, Beleuchtung und Auflösung für
Vorher und Nachher. Vier Ansichten, Differenzbilder und eine Übersicht werden
zusammen mit Quellen-, Renderer- und Umgebungshashes gespeichert. Eine
gespeicherte `camera.json` kann für spätere Revisionen wiederverwendet werden;
Geometrie außerhalb des Bildraums führt zu einem Fehler.

```sh
node bin/wonky.mjs examples/bracket.fs --param 'thickness=8*millimeter' --out out/visual-before
node bin/wonky.mjs examples/bracket.fs --param 'thickness=12*millimeter' --out out/visual-after
uv run scripts/render-comparison.py out/visual-before.stl out/visual-after.stl --out out/visual-comparison
uv run scripts/render-comparison.py out/visual-before.stl out/visual-before.stl \
  --camera out/visual-comparison/camera.json --out out/visual-identical
```

Der identische Kontrolllauf hat in allen vier Ansichten **null abweichende
Pixel**, auch vor Anwendung des Schwellwerts. Beim Dickenwechsel bleibt die
Draufsicht unverändert, während Vorder-, Seiten- und Isoansicht Unterschiede
zeigen. Bilder ergänzen deshalb Geometriechecks; innere Änderungen können
unsichtbar bleiben. Dieser Versuch verwendet planare Bend-STLs.

Für analytische B-reps nutzt `scripts/render-brep-comparison.mjs` dieselbe
Tessellierung wie der Review-Viewer. Unterstützt sind auch getrimmte
Zylinderflächen mit Löchern und periodischen Übergängen, vollständige
Kegelbänder und planare Flächen mit Kreis-/Ellipsenrändern:

```sh
node scripts/render-brep-comparison.mjs before.brep.json after.brep.json \
  --out out/curved-visual-comparison --tolerance 0.02
```

Der Export verlangt Anzeigedreiecke für jede Quellfläche. Eine fehlende,
unsichere oder degenerierte Fläche bricht den gesamten Export ab. Die
`.display.stl`-Dateien sind ausdrücklich Anzeigedaten mit deklarierter
Näherungstoleranz. Das Manifest bindet B-rep, Displaynetz und einzelne
Flächen über Hashes und Zuordnungen. Sie ersetzen weder das analytische
Modell noch einen Fertigungs- oder Geometrienachweis.

Der B-rep-Renderer veröffentlicht Bilder, Netze, Kamera und eine Berichtskopie
zusammen unter `generations/<id>/`. Erst danach ersetzt er `report.json`
atomar. Vorhandene Generationen bleiben erhalten; ein Fehler beim letzten
Schritt kann eine vollständige unreferenzierte Generation hinterlassen,
beschädigt aber keine Bilder des bisherigen Berichts. `assetGeneration`
bezeichnet die Ablage, `cameraFile` die wiederverwendbare Kameradatei.
Im Ausgabeverzeichnis verbliebene ältere Bilder werden nicht überschrieben
und gehören nicht automatisch zum aktuellen Bericht.

Beim unabhängig über STEP geprüften gebohrten Zylinder ändert sich der
Innenradius von 2 auf 3 mm, bei gleichem Außenradius 5 mm und Höhe 10 mm.
Vorder- und Seitenansicht bleiben identisch; oben ändern sich 7.297 Pixel
(4,95 %), isometrisch 2.674 (1,81 %). Der identische Kontrolllauf hat in allen
vier Ansichten null abweichende Pixel, auch ohne Schwellwert. Nachweise:
`out/curved-visual-comparison/report.json`,
`out/curved-visual-identical/report.json` und
`out/viewer-qa/curved-step-validation.json`.

Der P10/Box-Diagnoseeingang exportiert 195 Flächen mit 2.980 Displaydreiecken
ohne ausgelassene Fläche; darunter alle 26 P10-Zylinderflächen. Der Bericht
`out/viewer-qa/p10-display-export.json` beschreibt die Anzeige der
Boolean-Eingänge, kein Ergebnis der noch fehlenden Operation.

## Frontends und Ausbaureihenfolge

FeatureScript bleibt der Weg für unveränderte Onshape-Quellen. Der zusätzlich
vereinbarte build123d-Algebra-Frontend ist als begrenzter realer Python-Weg
implementiert: Box, Cylinder, Pos, Boolesche Operatoren und Volumen laufen
über denselben Bend-Kern. Python selbst wertet die Python-Syntax aus.
Das echte build123d/OCP liefert dabei keine Produktionsgeometrie.
Builder-Kontexte, Selektoren und Fillets benötigen eigene, ausdrücklich
implementierte Fähigkeiten. Schon heute können Python-/pytest-Tests
FeatureScript-Dateien testen, ohne den Python-Modellierungsfrontend zu nutzen.

Als gemeinsame Basis bieten sich stabile Körperreferenzen, Einheiten,
Fähigkeitsabfragen und strukturierte Fehler an. Caches müssen Quelltext,
Parameter, eingefrorene Imports, Kernrevision, Numerik und Backend einbeziehen;
Rendercaches zusätzlich Kamera, Netztoleranz und Rendererumgebung. Gleiche
Dateinamen oder Körpernamen allein sind kein Identitätsnachweis.

Zunächst lohnen sich unabhängige Modell- und Prüfbatches auf der CPU. Die
GPU sollte große, regelmäßige numerische Aufgaben übernehmen, sobald die
gemessenen Laufzeiten das rechtfertigen. Ein serieller Featurebaum lässt sich
nicht durch mehr Threads beliebig beschleunigen. Die separaten
Hardwaremessungen stehen in `out/hardware/report.json` und werden mit
`npm run bench:hardware` reproduziert.
