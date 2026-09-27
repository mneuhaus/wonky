# OpenSCAD in wonky: Frontend und Testkorpus

Stand: 24. September 2026, am selben Tag nach einem adversarialen Review
überarbeitet. Ergebnis des Workflows `openscad-scope`. Das ist ein Entwurf:
implementiert ist noch nichts. Grundlage ist deine Idee vom Vormittag:
OpenSCAD als weiteres Frontend, vor allem um beliebige OpenSCAD-Beispiele
aus dem Netz in OpenSCAD als Referenzbaseline zu rechnen und wonky dagegen
zu prüfen.

| Dokument | Inhalt |
|---|---|
| [openscad/design.md](openscad/design.md) | Architektur, beide Modi, Abdeckung je Konstrukt, Orakel und Triage, Nutzen je Paket, Pakete, Entscheidungen, Umgang mit jedem Review-Befund (§15) (englisch) |
| [openscad/semantics.md](openscad/semantics.md) | Sprache und Geometrie von OpenSCAD, Regel für Regel, mit Messungen (englisch) |
| [openscad/oracle.md](openscad/oracle.md) | Referenzbaselines: Formate, Genauigkeit, Toleranzen, Speicherung (englisch) |
| [openscad/corpus.md](openscad/corpus.md) | 806 Dateien, 60 Orakelläufe, Lizenzen (englisch) |
| [openscad/prior-art.md](openscad/prior-art.md) | andere Interpreter, Testkorpora, Manifold (englisch) |
| [openscad/review.md](openscad/review.md) | das Review: 1 Blocker, 8 große, 12 kleine Befunde (englisch) |

Labels: **GEMESSEN** (auf diesem Rechner gelaufen), **GELESEN** (im Code
oder einer Quelle), **VORSCHLAG** (Entwurf).

## 0. Was das Review geändert hat

- **Blocker behoben:** OpenSCAD rechnet `.csg`, `.echo` und `.ast` mit
  `$preview = true`, STL dagegen mit false. Der `.csg`-Baum war also bei
  Dateien, die `$preview` lesen, nicht der Baum der Referenz (GEMESSEN:
  `cable_clip` 8.490,97 statt 3.433,17 mm³). Jetzt läuft jeder solche
  Export mit `--render`, und wonky rechnet immer mit `$preview = false`.
  Alle 60 Korpusbäume sind neu erzeugt, 56 davon unverändert (GEMESSEN).
- **Toleranzen korrigiert:** CGAL hat einen float32-Notpfad (eigener
  Status, breiteres δ); die Anzahl ebener Flächen ist nur noch beratend;
  die Volumenschranke im intent-Modus nutzt je Blatt die symmetrische
  Differenz, weil ein facettiertes `rotate_extrude` nicht innen liegt
  (GEMESSEN: 2,1-fache Überschreitung der alten Schranke).
- **OCCT-Orakel:** vergleicht nur noch gleiche Zahlen (wonkys Baum mit 17
  Stellen oder beide Seiten auf dem 6-stelligen `.csg`).
- **`.csg`-Matrizen sind nicht starr** (6 Stellen, Fehler bis 1,1e-6), also
  auf der csg-Spur immer affin.
- **Zahlen ehrlicher, Pakete kleiner**, Einzelheiten unten.

## 1. Kurzfassung

1. **Ein Frontend, zwei Verträge** (VORSCHLAG). wonky liest `.scad`
   unverändert mit eigenem Parser und Interpreter in JS, neben FeatureScript
   und Python. OpenSCAD selbst läuft nur als Testorakel.
   - **faceted:** baut genau die Polyeder, die OpenSCAD baut. Alle Flächen
     sind eben, direkt vergleichbar mit OpenSCADs Netz. Standard für Tests.
   - **intent:** echte Zylinder, Kegel, Kugeln, Tori. Vorgeschlagener
     Standard für deine eigenen Modelle und STEP. Absichtliche Vielecke
     (kleines `$fn`) bleiben Vielecke, nach einer festen, protokollierten
     Regel.
2. **Drei Testspuren, die billigste zuerst.**
   - **csg-Spur:** OpenSCADs eigener ausgewerteter Baum (`.csg`, mit
     `--render`) geht direkt in wonky. Testet die Geometrie ohne den
     Interpreter, ab Paket S1b.
   - **Sprachspur:** wonkys ausgewerteter Baum gegen OpenSCADs `.csg` und
     `echo`. Ganz ohne Geometrie. Obergrenze: die 633 verschiedenen
     Modelldateien des Korpus (GEMESSEN); wie viele es wirklich werden,
     zeigt erst S3b/S4.
   - **Geometriespur:** die ganze `.scad` durch wonky, gegen OpenSCADs Netz
     (faceted) und gegen OCCTs exakte CSG von wonkys eigenem vollgenauem
     Baum (intent). Braucht den Interpreter (S3b) und für Dateien mit
     Bibliotheken S4.
3. **Erste echte Differentialtests mit S1a und S1b**, nur mit heutigen
   Kernel-Operationen: etwa 12 eigene Testfälle plus eine **benannte Liste
   frei lizenzierter Korpusdateien** auf der csg-Spur, alle mit sauberen
   Referenzen (GEMESSEN): `example003` (CC0), `Shapes3d-001`,
   `Shapes3d-029` und `Mutators-039` (BSD-2) in beiden Modi, dazu
   `example002` und `example019` (CC0) im intent-Modus. `Mutators-039`
   vereinigt 1.000 Würfel und belastet damit lange Boolean-Ketten, die
   wonky noch nie gelaufen ist (bisher höchstens 6 Schritte, GELESEN
   `docs/research/synthesis.md`). Von den 21 sauberen Census-Referenzen
   ist in S1 nur eine erreichbar (ein einzelner Würfel). Die frühere
   Angabe „2 von 21“ zählte `torus-customizer` mit; der braucht affine
   Matrizen und eine Kette aus 359 Hybrid-Booleans und ist jetzt ein
   Bericht in S12.
4. **Die Kernel-Lücken, nach Nutzen geordnet:** Polyeder aus indizierten
   Flächen (S5), affine Transformationen und facettierte Grundkörper
   (S6a bis S6c), 2D-Subsystem (S8a bis S8c), exakte konvexe Hülle und
   Minkowski (S9a, S9b), Import von Netzen und Höhenkarten (S10a, S10b).
   Danach deckt faceted **18 der 21 sauberen Referenzen** ab (VORSCHLAG aus
   GEMESSENEN Bäumen). Die 25 übrigen Läufe mit Netz (8 sauber, aber mit
   unzulässigem Netz, 7 mit Warnungen, 10 in Quarantäne wegen fehlender
   Dateien oder unbekannter Module) werden getrennt berichtet und
   entscheiden nie über Bestehen.
5. **Alles Nichtunterstützte verweigert mit Namen**, in beiden Modi.
   `text()` und `projection()` bleiben vorerst verweigert.

## 2. Was schon gemessen ist

- **Installiertes OpenSCAD:** 2022.05.16 ist ein Entwicklungsstand (git
  6aae79634), keine Release, CGAL, kein Manifold (GEMESSEN).
- **OpenSCAD als faceted-Orakel ist exakt**, bis auf ein Einrasten aller
  Eckpunkte auf ein 2^-20-mm-Raster (plus Zusammenlegen mit belegten
  Nachbarzellen), den float32-Notpfad bei nicht ebenen Flächen und das
  Exportformat. Binäres STL mit den exakten `.nef3`-Ecken ist die
  Referenz; ASCII-STL, OFF und AMF haben nur 6 Stellen (GEMESSEN).
- **Exit-Code 0 heißt nichts:** fehlgeschlagene Exporte, nicht-mannigfaltige
  Ergebnisse, der float32-Notpfad und `cylinder(r = undef)` (wird still zum
  Fünfeck mit r = 1) enden alle mit 0 (GEMESSEN). Der Status kommt deshalb
  aus Log und Dateien.
- **`--render` ist Pflicht** für `.csg` und `.echo`; `-D '$preview=false'`
  hilft nicht, weil Zuweisungen oben in der Datei den Wert schon gelesen
  haben (GEMESSEN).
- **Korpus:** 806 Dateien, davon 395 aus `~/Workspace/cad` (archivierte
  Downloads, nicht deine Entwürfe; auch die 3 Dateien in
  `cad-project-039` sind Kopien der heruntergeladenen
  `lock_openlock.scad`) und 411 öffentliche aus 10 Repositories. 60
  Orakelläufe: 46 mit Netz, **21 saubere Referenzen** (GEMESSEN).
- **OpenSCAD reproduziert sein eigenes `.csg`:** bei allen gemessenen
  Render-Bäumen bis auf die 6-Stellen-Rundung (höchstens 1,25e-4 mm).
  Die csg-Spur vergleicht deshalb gegen den Render des `.csg` selbst
  (GEMESSEN).
- **Sprachspur ist billig:** `.csg`- und `.echo`-Export der 60 Fälle mit
  `--render` 18,7 s, STL-Render 516 s; 269 frei lizenzierte Dateien 78 s
  (GEMESSEN).
- **Die lokalen Dateien** brauchen vor allem `hull` (268 Aufrufe in 61
  Dateien), `import` (122 in 33) und `scale`; `$fn = 200` steht 337-mal
  darin (GEMESSEN). Es sind heruntergeladene Fremdmodelle.

## 3. Wie es gebaut wird

```
.scad → Parser → Interpreter ($preview = false) → OpenSCAD-Knotenbaum (wie .csg) → Absenkung faceted | intent → Bend
```

- Der **Knotenbaum** ist OpenSCADs eigene Zwischenform. Er entsteht
  vollständig, bevor der Kernel läuft, denn OpenSCAD kann Geometrie nicht
  abfragen. Deshalb kann wonky jede Verweigerung einer Datei mit Zeile
  melden, bevor es rechnet. Das passt genau zu WK/0 (Preflight, Hash,
  Diff).
- **Grenze zu Bend** (VORSCHLAG, Entscheidung 1): das Frontend rechnet nur
  die Koordinaten, die die Sprache per Formel festlegt (Eckpunkte von
  Kreisen, Kugelringen usw. mit OpenSCADs Grad-Trigonometrie), und rein
  kombinatorische Flächenlisten. Jede geometrische Entscheidung (welche
  Diagonale, Kollinearität, Ebenheit, Box für `resize`) und jeder Körper
  entsteht in Bend. semantics.md und design.md sagen jetzt dasselbe.
- **Booleans:** facettierte Zylinder sprengen die ebene Anordnung (höchstens
  32 Ebenen, GELESEN). Achsparallele Prismen nimmt der exakte Prismen-Arm,
  alles andere der Hybrid. Auf ebenen Eingaben meshet der Hybrid exakt,
  OpenSCAD-Modelle sind also saubere Tests für corefine und recover.
- **Matrizen:** auf der Geometriespur rechnet wonky Drehungen selbst in
  binary64 (starr). Auf der csg-Spur sind sie 6-stellig und nicht
  orthonormal genug für wonkys Prismen-Arm (Budget 1e-11); dort gelten
  sie als affin und werden auf die Eckpunkte heruntergereicht (S6a).
- **strict** (Standard): jede geometrierelevante Warnung ist ein Fehler.
  **compat** (für den Korpus): OpenSCADs Nachsicht wird nachgebildet, das
  Ergebnis heißt dann `degraded`, nie einfach grün.

## 4. Wie geprüft wird

- **Referenz:** das angeheftete OpenSCAD auf Kopien, mit `--render`,
  Timeout, höchstens 3 Prozessen, Cache nach Hash von Quelle,
  Abhängigkeiten, Parametern und Orakel. `npm test` startet nie OpenSCAD,
  es prüft gegen eingecheckte Zahlen eigener Fälle.
- **Status** zusätzlich zu `ok`, `warned` usw.: `float32-fallback`,
  `inverted` (negatives Volumen bei falsch gewundenem Polyeder) und
  `exit0-error`. Fehlende Dateien oder unbekannte Module heißen
  Quarantäne.
- **faceted:** Volumen, Fläche, Box, Hausdorff, Schalen und Geschlecht
  innerhalb Einrasten plus Formatfehler. Die Anzahl ebener Flächen ist nur
  beratend, weil das Einrasten gedrehte Flächen in Dreiecke zerlegt
  (GEMESSEN: 18 statt 12).
- **intent:** exakt gegen OCCT (1e-7 relativ), und zwar nur mit gleichen
  Zahlen auf beiden Seiten. Gegen OpenSCAD innerhalb einer Schranke aus der
  symmetrischen Differenz je Blatt, die das Frontend aus `$fn/$fa/$fs`
  kennt.
- **Triage** in fester Reihenfolge: Sprache, Facettierung, Boolean (mit
  manifold3d als zweitem Orakel auf denselben Blättern), Export, Orakel.
  Fälle, die nur das Einrasten oder der float32-Notpfad entscheidet,
  heißen `ambiguous` und zählen getrennt.

## 5. Was es bringt

Die 21 sauberen Referenzen, kumuliert nach Paket (VORSCHLAG aus GEMESSENEN
Render-Bäumen, `tmp/openscad/revise/coverage2.json`; jeder Boolean
unterwegs muss gelingen):

| nach | csg faceted | csg intent | Geometrie faceted | Geometrie intent |
|---|---|---|---|---|
| S1b | 1 | 1 | 0 | 0 |
| S3b | 1 | 1 | 1 | 1 |
| S4 | 1 | 1 | 2 | 2 |
| S6a | 6 | 3 | 6 | 4 |
| S6c | 7 | 3 | 7 | 4 |
| S7a | 7 | 7 | 7 | 7 |
| S8a bis S8c | 10 | 7 | 10 | 7 |
| S9a | 14 | 7 | 14 | 7 |
| S9b | 15 | 7 | 15 | 7 |
| S10a/b | 18 | 10 | 18 | 10 |

- Die übrigen 25 Läufe mit Netz stehen getrennt daneben (8 sauber mit
  unzulässigem Netz, 7 mit Warnungen, 10 in Quarantäne).
- **Die lokalen Ordner** (16 Läufe mit Netz, alles Downloads): 1 saubere
  Referenz (OpenForge `bases-wall-primary`, nach S9a), 2 saubere mit
  unzulässigem Netz, 4 mit Warnungen, 9 in Quarantäne. Sie sind
  Triage-Material, keine Tore.
- **Frei lizenzierte Bäume** (einchecken erlaubt): 124 der 269 BSD-, CC0-,
  MIT- und Apache-Dateien liefern einen fehlerfreien 3D-Baum. Davon
  erreicht faceted auf der csg-Spur 4 nach S1b, 36 nach S6a, 108 nach S9a
  und 111 nach S10 (GEMESSENE Bäume, VORSCHLAG für die Pakete). Das ist der
  größte Vorrat an einsetzbaren Korpustests.
- **Sprachspur:** 53 von 60 Stichproben liefern ein fehlerfreies `.csg`.
  Weil die Stichprobe gezielt geschichtet ist, wird nicht hochgerechnet;
  die Obergrenze sind 633 verschiedene Modelldateien.

## 6. Was es kostet

Jedes Paket ist ein kleiner Lauf mit Worklog (S = kurz, M = mittel; kein L
mehr):

| Paket | Inhalt | braucht | Größe |
|---|---|---|---|
| S1a | Parser, Literal-Interpreter, `.csg` lesen und schreiben | nichts | M |
| S1b | Würfel, Zylinder, Extrusion, exakte Achsmatrizen, Booleans in beiden Modi, Referenz- und Vergleichswerkzeug, eigene Fälle, benannte Liste | S1a | M |
| S2 | Orakel komplett: Cache, Status, exakte Ecken, zweites Orakel, nächtlicher Lauf | S1b | M |
| S3a | Werte, Gültigkeitsbereiche, Funktionen | S1a | M |
| S3b | Module, `children()`, Kontrollfluss, Diagnosen, `echo` | S3a | M |
| S4 | include/use, Bibliotheken, eingebaute Funktionen, Parameter | S3b | M |
| S5 | Bend: Polyeder aus indizierten Flächen | nichts | M |
| S6a | facettierte Kugel, Kegel, Polyeder; affine Transformationen | S1b, S5 | M |
| S6b | facettiertes `rotate_extrude` | S6a | S |
| S6c | `linear_extrude` mit Skalierung und Twist | S6a | M |
| S7a | intent-Blätter, Vieleck-Regel | S6a | M |
| S7b | OCCT-Orakel mit vollgenauem Baum | S7a, S2 | M |
| S8a | 2D-Booleans | S1b, S5 | M |
| S8b | `offset` | S8a | M |
| S8c | 2D-Hülle und 2D-Minkowski | S8a | S |
| S9a | exakte 3D-Hülle | S6a | M |
| S9b | facettiertes Minkowski | S9a | S |
| S9c bis S9e | je ein intent-Muster pro Lauf | S9a, S7a | S |
| S10a | Netz-Import (STL, OFF, 3MF) | S4, S5 | M |
| S10b | DXF/SVG-Import und `surface()` | S10a, S8a | M |
| S11 | Viewer, khana, ThingiCSG, OpenSCAD-Testsuite | S2, S6a | M |
| S12 | ganze Teilbäume als ein Hybrid-Job (lange Ketten, `torus-customizer`) | S2 | M |

- S1a und S5 können parallel laufen. Kernel-Arbeit steckt in S5, S8a bis
  S8c und S9a/S9b, jeweils in neuen Bend-Dateien. Jede neue Datei braucht
  aber eine Zeile in `src/kernel.mjs`, die die r20-gate- und Fillet-Arbeit
  gerade ändert; solche Einzeiler werden vorher abgestimmt
  (Entscheidung 12).
- Abnahmetests nutzen nur eigene oder frei lizenzierte Fälle. GPL-, LGPL-
  und CC-BY-SA-Dateien laufen aus `tmp/` als Bericht daneben.
- Orakelzeit: CGAL im Median 0,5 s je Datei, p90 23 s, ein Timeout bei
  120 s (GEMESSEN). `fast-csg` ist 11-mal schneller, taugt aber nur als
  Ausweichspur.

## 7. Was es mit khana und dem Viewer macht

- OpenSCAD-Körper sind normale wonky-Körper: khana-Checks laufen über die
  Prüfdatei daneben. Druckchecks gehören auf **intent**, denn facettierte
  Bohrungen sind Prismen.
- Die Urteile nutzen khanas Vokabular: `pass` nur mit Schranke, `fail` nur
  mit Zeuge (Hausdorff-Punkt, abweichender Baumknoten).
- `wonky view teil.scad` baut beim Speichern neu. Neu: die OpenSCAD-Referenz
  als Geist über dem Modell, Zeuge als Marke, Triage-Klasse als Chip,
  Umschalter faceted/intent.
- Gute Boolean-Fehlfälle werden verkleinert zu Adversarial-Fixtures des
  Hybrids.

## 8. Deine Entscheidungen

Jeweils mit meiner Empfehlung.

1. Das Frontend rechnet nur die per Formel festgelegten Eckpunkte und die
   Flächenlisten; jede geometrische Entscheidung und jeder Körper entsteht
   in Bend. Empfohlen. Alternative: je Grundkörper ein Bend-Konstruktor aus
   `(r, n)`.
2. faceted für Korpustests, intent für deine Modelle. Empfohlen. Hinweis:
   im Korpus ist noch kein eigener Entwurf von dir, der Vorschlag beruht
   auf deinem Wunsch, nicht auf Messung.
3. Im intent-Modus bleibt ein Blatt mit aufgelöstem `$fn ≤ 8` ein Vieleck,
   einstellbar und je Blatt protokolliert; das verhält sich auf csg- und
   Geometriespur gleich. Empfohlen (die heruntergeladene OpenLOCK-Bibliothek
   nutzt `$fn = 8` 52-mal).
4. Zuerst den Dialekt des installierten 2022.05. Empfohlen: zusätzlich eine
   aktuelle Nightly **daneben** installieren (Manifold, exaktes ASCII-STL),
   CGAL 2022.05 bleibt die faceted-Referenz.
5. Nur eigene und permissive Dateien (dazu CC-BY mit Nennung) einchecken;
   GPL, LGPL und CC-BY-SA nur als Zahlen und Hashes. Empfohlen.
6. strict als Standard, `--compat` für den Korpus. Empfohlen.
7. Feste Rekursionstiefe von 10.000 statt OpenSCADs stapelabhängiger Grenze.
   Empfohlen.
8. `text()` vorerst verweigern (0 Aufrufe in den lokalen Dateien).
   Empfohlen.
9. `ambiguous`-Fälle getrennt berichten, nicht in der Quote. Empfohlen.
10. Reihenfolge: S1a, S1b, parallel S5, dann S2, S3a, S3b, S4, S6a.
    Empfohlen.
11. **Neu: Reinraum für die Facettierungsregeln.** faceted muss GPL-Regeln
    von OpenSCAD bitgenau nachbauen. Ein Lauf schreibt die Regeln als
    Verhaltensbeschreibung aus Proben und Text, ein anderer implementiert,
    ohne den OpenSCAD-Quelltext zu lesen. Empfohlen für S6a bis S6c und
    S8b. wonky hat selbst noch keine Lizenz.
12. **Neu: kleine Änderungen an geteilten Dateien** (je Bend-Modul eine
    Zeile in `src/kernel.mjs`, eine Option für `extrudeInBend`, optional ein
    STL-Pfad für ebene Körper in `src/exporters.mjs`) vorher mit r20-gate
    und Fillet abstimmen. Empfohlen.

## 9. Risiken

- Der Hybrid unter vielen koplanaren Flächen: falsche `ok` oder viele
  Verweigerungen. Gegenmittel: manifold3d auf denselben Blättern, Triage,
  verkleinerte Fixtures.
- Lange Ketten in F32x2 sind ungemessen. S1b enthält deshalb
  `Mutators-039` (1.000 Würfel), S12 die 359er-Kette.
- Das Orakel irrt an bekannten Stellen (Einrasten schließt 5e-7-mm-Spalte,
  Kantenberührung wird nicht-mannigfaltig, float32-Notpfad). Dafür gibt es
  eigene Status, `ambiguous` und eine Schiedsdatei.
- Ein falscher Referenzbaum (ohne `--render`) fällt nicht von selbst auf.
  Gegenmittel: `--render` und `$preview` im Cache-Schlüssel, eigene
  Testfälle dafür (S2).
- Die Sprache ist breit (BOSL2 nutzt fast alles). Die Sprachspur misst den
  Stand, bevor Geometrie davon abhängt.
- Wie viel die intent-Muster für `hull` abdecken, ist offen. faceted-Hülle
  kommt zuerst, dann ein Muster pro Lauf, nach Nutzen im Korpus.
- Lizenzen: 293 von 806 Dateien ohne geklärte Lizenz, davon 284 lokale
  Kopien.
