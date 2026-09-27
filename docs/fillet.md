# Fillets und Fasen in wonky: Landschaft, Nutzung, Bake-off-Auswahl

## Stand nach Regression review 2 (25. September 2026)

verify-2 hat drei Fehler gefunden. Alle drei sind behoben. Belege stehen in
fillet-plan.md, Abschnitt „Regression review 2 (measured)“.

- **Koplanare Fragmente:** wonkys Booleans lassen eine ebene Fläche oft in
  Stücke zerfallen. Eine Box minus Tasche hat 46 Flächen, in Onshape sind es
  11. Eine Kante zwischen zwei solchen Stücken galt als Onshapes
  FILLET_FAIL_SMOOTH. In `try silent` fiel die Fase dann ohne Fehler weg.
  Jetzt gilt:
  - Die Kante wird mit Notiz ignoriert.
  - Eine Fläche steht für das ganze Stück-Gebiet, auch in `qAdjacent`.
  - Deine ksFaceEdges-Fase auf dem Taschenrand baut exakt, auch in
    `try silent`. roundX baut ebenfalls.
- **Riser-Kappen:** R4.2 an einem per Union gebauten Stufenblock wurde
  verweigert. Jetzt baut er wie das Stück aus einer Extrusion (P3).
- **Hohlkehle an einer Innenecke (fillet-setback):** Die R2-Kehle zwischen
  Rücken und Platte in R20 `edge.fs:807` endet dort, wo die breitere Platte
  um den schmaleren Rücken herumläuft. Das wurde als „reflex face corner;
  setback patch needed“ verweigert. Jetzt baut sie als konkaves Gegenstück
  der Riser-Kappe, als Fillet und als Fase:
  - Onshape-Probe (RS-F, RS-C): Volumen, Flächentypen und Anzahl der
    Flächen, Kanten und Ecken stimmen überein.
  - R20 `edge.fs` kommt an 807 vorbei und hält jetzt an 818, der eigenen
    Prüfung für die Fuß-Nähte (der Entwurf hat dort keine Naht).
- **Ellipse als Hindernis:** Diese beiden Fälle wurden verweigert und bauen
  jetzt exakt:
  - der Bohrungsrand unter einer schrägen Deckfläche (P1);
  - die Bodenfase nach R4.2 unter einer Schräge (P4).

  Der STEP-Export dieser zwei besteht die strenge Prüfung noch nicht. Der
  Writer schreibt Parameterkurven für Zylinder nur in Körpern aus Ebenen und
  Zylindern, und diese Körper haben einen Kegel. Die Geometrie stimmt: Die
  Volumina entsprechen der geschlossenen Form. Das ist als Follow-up notiert.
- **Gemessen auf js, cpu1 und cpuN:**
  - Alle Suiten laufen bytegleich auf allen drei Targets (71 + 38 + 32
    Fälle), mit 0 falschen Antworten.
  - Alle alten Fälle haben denselben Text wie nach Regression review 1.
  - 5 neue Regressionsfälle: 3 bestehen, 2 scheitern nur am STEP-Writer.
  - Sweeps: 0 Fehler.
  - Onshape-Probes, KS und r10b sind unverändert.
  - Metal ist kein Produktionsziel für Fillets und lief nicht neu.
- **Tests:** `npm test` 1674 von 1680, 1 Fehler (derselbe lastabhängige
  STEP-Test wie in Regression review 1, allein grün). Schnelle Lane 145/145.
- **Offen:**
  - eine abgeschnittene Ecke mit c ≤ d < 1,71·c wird verweigert;
  - eine Bohrspitzen-Fase mit d = ρ wird verweigert;
  - gekrümmte Fragmente (ein geteilter Zylinder) werden mit Namen
    verweigert, nicht zusammengeführt.

## Stand nach Regression review 1 (25. September 2026)

verify-1 hat zwei Fehler gefunden. Beide sind behoben. Belege stehen in
fillet-plan.md, Abschnitt „Regression review 1 (measured)“; das Worklog ist
local development evidence.

- **Metal:** Auf zwei P2-Taschen schrieb Metal einen anderen (gültigen) Text,
  ohne Fehler. Ursache: Der Taschenboden liegt bei z ≈ 1e-16, dabei entstehen
  subnormale F32-Werte, und Metal setzt die auf null. Der Fillet hat jetzt
  keine GPU-Stufe mehr und läuft in jedem Build auf der CPU. Das behebt auch
  den Stacküberlauf von vorher. Der Metal-Build dauert 38 s statt 33 min.
  Metal rechnet Fillets damit nicht mehr auf der GPU; Produktion lief ohnehin
  auf der CPU.
- **qCreatedBy:** `qCreatedBy(fillet-id, FACE)` gab alle Flächen des Körpers
  zurück, jetzt nur die neuen Blend- und Eckflächen (EDGE: deren Kanten).
  Nach einer späteren Operation am selben Körper verweigert die Abfrage mit
  Namen, statt zu raten.
- **Gemessen:** Alle Suiten auf allen vier Targets bytegleich (71 + 33 + 32
  Fälle), 0 falsche Antworten. Alle 53 `ok`-Katalogfälle bauen, FP03 jetzt
  auch. 13 der 15 Onshape-Probes bauen mit Onshapes Flächenzahl. KS wie
  vorher: KS02 und KS03 bauen, KS07 wird noch verweigert.
- **Tests:** `npm test` 1587 von 1593, 1 Fehler (ein lastabhängiger
  STEP-Test, allein grün). Schnelle Lane 141/141. r10b unverändert.
- **Offen aus verify-1:** Exakt-Anspruch bei 1e7 mm (außerhalb ±1e4 mm)
  hält den Tight-Check nicht; Harness-Fehler bei verketteten Eingaben;
  `barend-r` knapp über der Grenze verweigert, statt zu bauen.

## Stand nach der Integration (25. September 2026)

Die Schritte 0 bis 5 aus fillet-plan.md §8 liefen zusammen in einem Baum:
HEAD plus die Fillet-Dateien, ohne die laufenden Änderungen von
hybrid-robust. Jede Suite lief auf allen vier Targets. Details und Belege
stehen in fillet-plan.md, Abschnitt „Integration of steps 0-5 (measured)“;
das Worklog ist local development evidence.

- **Was geht:**
  - Der Produktions-Fillet (`kernel/fillet`) baut alle 53 `ok`-Katalogfälle
    exakt, auf allen vier Targets bytegleich.
  - Die 4 `must-refuse`-Fälle verweigert er mit Namen.
  - In keiner Suite gibt es eine falsche Antwort.
  - Tight-Check, Divergenzvolumen (≤ 4,3e-15 × V) und strenges STEP sind
    63/63.
  - Wo A und C-tori beide bauen, stimmen die Volumen überein (39/39, 4/4,
    21/21).
- **Onshape:** Von den 15 Probes, die Onshape baut, baut A 12 mit Onshapes
  Flächenzahl. FP12 verweigert A wie Onshape. FP06, FP11 und FP14 sind nur
  Verweigerungen (offen).
- **Dein Hausstil:**
  - KS02 und KS03 bauen exakt und treffen Onshape (2,3e-15 und 1,6e-14).
  - KS07 wird verweigert (`overflow` über die 0,614-mm-Stufe).
  - KS05 und KS09 verweigern mit Namen.
  - KS01 und KS04 bleiben vor dem Blend außerhalb des Fillets hängen.
  - KS01, KS04 und KS09 kommen direkt nach v1 dran.
- **Neu gefunden, offen:**
  - Auf Metal stürzt der Produktions-Fillet mit einem Stacküberlauf ab. Das
    passiert dort, wo die exakte Arithmetik eine Ebene/Ebene-Breite
    entscheidet: 2 von 134 Suite-Fällen und 38 von 368 Sweep-Punkten. Ein
    falsches Ergebnis entsteht dabei nicht.
  - JS, cpu1 und cpuN sind überall gleich.
  - Produktion läuft ohnehin auf der CPU (`--gpu off`). Zu entscheiden ist:
    die exakte Stufe aus dem GPU-Programm nehmen, oder Metal offiziell nicht
    als Fillet-Target führen.
  - Der Metal-Build dauert 33 Minuten.
- **Harness:** `run.mjs` hat einen abgestürzten Target bisher übergangen.
  Jetzt zählt das als Abweichung (strenger, nicht lockerer).
- **Tests:**
  - `npm test` im Baum: 1587 von 1597 bestanden, 5 Fehler, keiner davon im
    Fillet. Sie gehören zu tray-view-fix (2), dxf-admission (1) und
    hybrid-robust (1), dazu kommt 1 lastabhängiger Test, der schon auf HEAD
    so ist.
  - Die schnelle Test-Lane mit HEAD plus nur den Fillet-Dateien: 141/141.
  - r10b ist unverändert.

## Stand nach Teil 2 (24. September 2026, Judge)

Der ausführliche Plan steht auf Englisch in [fillet-plan.md](fillet-plan.md).
Gemessen heißt: im Judge-Lauf vom 24.09. gemessen, Berichte unter
`out/fillet/judge/`. Alle Prototypen liefen unverändert auf 71 Katalogfällen
(inklusive FP15), auf beiden Adversarial-Dateien (31 und 32 Fälle, jeder
Prototyp auf beiden) und auf allen 16 Onshape-Probes. Jeder Lauf ging über
alle vier Targets, einer nach dem anderen.

- **Entscheidung: A (`fillet-kpart`) wird der Produktions-Fillet** (MEASURED
  als Grundlage).
  - Er baut alle 53 `ok`-Fälle exakt (Toleranz 0) und 10 der 14
    `either`-Fälle.
  - Er verweigert alle 4 `must-refuse`-Fälle typisiert.
  - In 134 Fällen gab es keine einzige falsche Antwort, und alle vier Targets
    waren bytegleich.
  - Die geschlossenen Formeln treffen 57 von 57.
- **Onshape:** Von den 15 Probes, die Onshape baut, baut A 12, jeweils mit
  Onshapes Flächenzahl.
  - 9 davon treffen Onshapes Volumen auf ≤ 7e-12 mm³, zwei weitere auf
    1,2e-10 und 8,3e-8 (gerundete Eingabe).
  - FP12 verweigert A wie Onshape.
  - FP08 weicht um 3,5e-3 mm³ ab, liegt aber in Onshapes Fehlerschranke. Alle
    Planflächen stimmen dort exakt mit Onshape überein. Vermutlich ist
    Onshapes Wert hier nur genähert (INFERRED).
- **C (Rolling Ball) wird Gegenprobe, nicht Produktion.**
  - Wo A und C beide bauen (39 Fälle), stimmen die Volumen auf 5,9e-12 mm³
    überein, und die Trägerflächen sind dieselben.
  - C baut keinen Katalogfall, den A verweigert. Umgekehrt baut A 24 Fälle,
    die C verweigert: Gehrungen, Ecken, Full Round, Notch.
  - Die Spline-Variante von C wird die Opt-in-Toleranzstufe für
    nicht-analytische Paare. Dafür gibt es heute noch keine Eingaben.
- **B** wartet auf den Hybrid-Boolean in Produktion. Seine Aufgabe sind die
  Overflow-Fälle, die A in v1 verweigert: Überlappung neben Gehrungen (FP06),
  Overflow auf beiden Seiten, Fasen-Overflow und KS04. **D** entfällt.
- **Geschwindigkeit:** A braucht auf einem Kern im Median 1 ms, im
  schlechtesten Fall 94 ms (50 Kanten). Mehr Threads und Metal helfen nicht.
  Also CPU-Pool, `--gpu off`.
- **Vor Produktion noch offen:**
  - Grenzentscheidungen laufen über Toleranzbänder statt exakter Prädikate
    (für A seit Schritt 4 unten gefiltert und exakt).
  - Bei r = Breite − 1e-9 entstehen 1e-9-mm-Splitterflächen (A verweigert
    sie seit Schritt 4 unten mit `sliver`).
  - Einen Fall innerhalb von v1 verweigert A unnötig: eine konvexe Stufe in
    eine senkrechte Wand, die C korrekt baut.
  - Die Setback-Gehrungen sind nicht per Onshape geprüft.
  - Der STEP-Writer des Harness schreibt keine PCurves (seit Schritt 2 unten läuft A durch den Produktions-Writer).
- **Schritt 1, Harness härten, ist erledigt** (24.09., fillet-plan.md §8
  Schritt 0, Worklog local development evidence):
  - Die zwei Fasenfälle rechnen jetzt mit Onshapes Setback (FP-a); die
    Face-Offset-Formel ist eine abgelehnte Alternative. Eine Face-Offset-Fase
    fällt bei `ch-convex-60-d1` jetzt durch.
  - Jedes `pass` wird zusätzlich über das exakte Divergenzvolumen bewertet
    (jetzt auch mit Kegeln) und über den Tight-Check. Die Regel "Toleranz 0"
    hängt am Anspruch des Prototyps: exakt für A, genähert für C.
  - Die geschlossenen Formeln werden auf der Geometrie des Jobs ausgewertet
    (der Kernel rundet Skizzenkoordinaten auf F32). FP09 hat jetzt eine
    eigene Formel; sie trifft Onshape auf 5e-13.
  - `run.mjs` prüft STEP streng und meldet es; als Urteil zählt es erst mit
    `--step-gate`, bis der Produktions-Exporter A schreibt.
  - A nennt in Ablehnungen den nötigen und den vorhandenen Wert mit ihrer
    Differenz: bei `adv-step-1e-7-front-top-edges-r1` "short by 1.000e-7"
    statt "1.000000 vs 1.000000".
- **Schritt 2, Produktions-Typen und STEP-Export für A, ist gemessen** (24.09.,
  fillet-plan.md §8 Schritt 1, Worklog
  local development evidence, Follow-ups
  `tmp/fillet-prod/followups/s1-types-export.md`):
  - `kernel/fillet/production.bend` bildet A's Ergebnis auf die
    Produktions-Typen ab (Kugel und Torus 1:1, Kegel mit negativem Winkel
    mit umgedrehter Achse, volle Kreise als periodische Kanten). Auf allen
    134 Ergebnissen identisch zum Harness-Decoder.
  - A läuft jetzt durch den Produktions-STEP-Writer, und strenges STEP
    entscheidet mit. Zwei Writer-Korrekturen: Kugel-Rahmen halten ihre Pole
    von den Randbögen fern (schräge Kugelecken), und fern vom Ursprung
    schreibt der Writer keine PCurves mehr, wenn alle Zylinderränder
    Parameterlinien sind. Tori brauchen keine eigenen PCurves: alle ihre
    Randkreise sind Breiten- oder Meridiankreise.
  - Strenges STEP: Katalog 63/63, A's Datei 19/21, C's Datei 25/27 (vorher
    60/63, 15/21, 23/27). Die vier übrigen sind keine Writer-Fehler: drei
    Splitter unter der Toleranz (Schritt 4 unten) und Mitre-Ellipsen bei
    1e6 mm (außerhalb der ±1e4 mm des Kernels, Export mit Namen verweigert).
  - Offen: `kernel/volume.bend` verweigert Spindel-Tori, und die
    Punkt-Klassifikation kann Kugel-, Torus- und Kegelflächen noch nicht.
    Beides gehört nicht zum Fillet-Workflow (Follow-ups F2, F3).
- **Schritt 3, A in den Kernel portiert, ist auf JS und cpu1 gemessen**
  (24.09., fillet-plan.md §8 Schritt 2, Worklog
  local development evidence; cpuN und Metal folgen in der
  Integration):
  - `kernel/fillet/` rechnet auf den Produktions-Trägern von
    `kernel/analytic.bend`; eigene Trägertypen gibt es dort nicht mehr.
    `kernel/proto/fillet-kpart` bleibt unverändert als Referenz.
  - Bytegleich zum Prototyp: Katalog 284/284 Dateien (Ergebnis auf beiden
    Targets, Ladder, Network), A's Datei 124/124, C's Datei 125/128. Die drei
    abweichenden Dateien sind der reparierte Fall.
  - `adv-rb-step-convex-into-riser` baut jetzt: eine konvexe Stufe in eine
    senkrechte Wand ist eine Kappe, deren Wandfläche über das Zwickel-Ende
    wächst. Geschlossene Formel auf 4,5e-13 mm³, C-tori auf 2,3e-13 mm³,
    strenges STEP gültig. Ein konservatives Zertifikat verweigert Fälle, in
    denen eine Kante zu nah an der Kappe liegt, typisiert (zum Beispiel eine
    nur 0,5 mm hohe Wand).
  - Das Ergebnis-Record trägt die Reihenfolge der Kanten und die Notizen
    ("seam-ignored", "propagated"): `production.bend` `fillet(job)`,
    `src/fillet.mjs` `filletJob`.
- **Schritt 4, exakte Grenzentscheidungen, ist für A auf JS und cpu1
  gemessen** (25.09., fillet-plan.md §8 Schritt 3, Worklog
  local development evidence; cpuN und Metal folgen in der
  Integration, C ist unverändert):
  - Nahe einer Grenze entscheidet ein Filter (F32x2-Vorzeichen außerhalb von
    2^-36 × Betrag) und darin exakte Arithmetik auf den Job-Wörtern
    (`kernel/fillet/exact.bend`, `decide.bend`, `refine.bend`): Breite
    Ebene/Ebene gegen Randlinie oder Nachbar-Stripe, Rand (Ebene ⟂ Achse,
    koaxialer Zylinder), Torus-Hauptradius, Sehne, Tangentenkante. Ohne
    exakte Form verweigert A mit `undecidable` (kam in keinem Sweep und
    keiner Suite vor).
  - Sliver-Regel: tau = 1e-6 mm. Genau auf der Grenze baut A die
    Grenztopologie (Fläche aufgefressen, Kugelkappe); innerhalb von tau
    verweigert A mit `sliver` und nennt die nötige Toleranz. Zusammenführen
    innerhalb einer Toleranz macht A nie: nur Verweigerung, als Fähigkeit
    noch offen.
  - Sweeps r = w ± {1e-6, 1e-9, 1e-12}, r = ρ ± dasselbe, Fase d = w ±
    dasselbe, Winkel gegen 180°: 0 Fehler, beide Targets gleich.
    Verschiebung um 1e4 und 1e7 mm (lokaler Rahmen, `frame.bend`),
    Vierteldrehungen und Skalierung 2 halten das Urteil. Die allgemeine
    Drehung (4 Punkte, gerundete Wörter) und Skalierung 1/2 (7 Punkte, tau
    ist absolut) wechseln zu `sliver`: getypt, aber nicht wie gefordert
    invariant.
  - Suites: kein `wrong`. `adv-rb-box-r-width-minus-1e-9` und
    `adv-rb-post-rim-r5-minus-1e-9` sind jetzt `sliver` statt
    Splitterflächen. Offen bleibt `adv-post-rim-rho-minus-1e-6` (`invalid`):
    eine Scheibe von genau 1e-6 mm gegen die 3e-4 mm, die der Produktions-
    Writer angibt. Kernel-Toleranz 3e-4 oder Fillet-Toleranz 1e-6 entscheidet
    Marc.
- **Schritt 5, Frontends, ist auf dem JS-Target gemessen** (25.09.,
  fillet-plan.md §8 Schritt 4, Worklog local development evidence):
  - FeatureScript `opFillet`/`opChamfer` (EQUAL_OFFSETS) und build123d
    `fillet`/`chamfer` laufen über A (`src/fillet-op.mjs`,
    `src/fillet-fs.mjs`, `src/fillet-python.mjs`, `python/_b3d_blend.py`).
    Andere Fasentypen, Nicht-Standard-Optionen und unbekannte Schlüssel
    werden mit Namen verweigert.
  - Marcs Hausstil baut exakt: 0,42-Fase über Deckflächen-Schleifen
    (Ebene/Ebene, Ebene/Zylinder, Bohrungsrand), R4,2 auf senkrechten Kanten
    mit `tangentPropagation` false, Fase nach Fillet, R2 in der Rippenwurzel.
    Volumen gegen geschlossene Formeln auf ≤ 8e-15 relativ, STEP streng gültig.
  - Nur `tangent-edge` (FP12, wie Onshape) ist ein normaler Fehler, den
    `try` fängt; jede andere Verweigerung bleibt ein Capability-Fehler, auch
    in `try silent`. FP11 (`tangentPropagation` false, G1-Fortsetzung
    nicht gewählt) ist weiter nur eine Verweigerung.
  - Offen: cpuN/Metal für die Frontends, Python `.volume` eines
    Fillet-Körpers.
- **KS01–KS09 durch die Produktions-CLI** (Schritt 5, JS-Target und
  natives Backend, 25. September 2026; Tabelle in fillet-plan.md, „Step 5
  measured“):
  - KS02 und KS03 bauen exakt und treffen Onshape (2,3e-15 und 1,6e-14
    relativ, STEP streng gültig).
  - KS07 wird verweigert (`overflow` über die 0,614-mm-Stufe zwischen den
    beiden Boxen); die Vermutung „baut“ stimmt nicht.
  - KS05 und KS09 verweigern am Blend mit Namen, KS05 aber nicht über die
    Parasolid-Regel (offen).
  - KS01 und KS04 erreichen den gemeinten Blend nicht: Sie bleiben vorher
    im Hybrid-Boolean bzw. in `qContainsPoint` über Kegelflächen hängen.
  - Das native Backend erreicht in keinem Fall einen Blend.
- **Integrationsreihenfolge** (Details und Abnahmetests in fillet-plan.md §8):
  1. Harness härten (erledigt, siehe oben).
  2. Produktions-Torus/-Kugel und STEP-Export an A anschließen (gemessen,
     siehe oben).
  3. A in den Kernel portieren (gemessen auf JS und cpu1, siehe oben).
  4. Exakte Prädikate einbauen (gemessen für A auf JS und cpu1, siehe oben).
  5. FS/build123d anbinden.
  6. KS01–KS09 (gemessen auf JS und nativ, offen: KS07, KS01, KS04).
  7. Corpus-Familien.
  8. Onshape-Probes für die Erweiterungen.
  9. C als CI-Gegenprobe, danach die Opt-in-Stufe.
  10. B nach dem Hybrid-Boolean.
- **KS01–KS09** (INFERRED aus den `case.fs`):
  - A sollte KS02, KS03 und KS07 exakt bauen.
  - KS05 muss verweigert werden, wie in Parasolid.
  - KS01 (Wiegenrand mit Quartik-Kanten), KS04 (überlappende Fasen auf
    0,2 mm Steg) und KS09 (Fase an Fase am Kegel) verweigert v1 mit Namen.

Stand: 24. September 2026. Teil 1 der Fillet-Arbeit: Survey, Nutzungsanalyse,
Harness und die Auswahl der Prototypen. Teil 2, der Prototypen-Bake-off, kommt
erst, wenn du diese Landschaft gesehen und die Entscheidungen in §7 getroffen
hast. Implementiert ist noch nichts, committet auch nichts.

Dieses Dokument fasst fünf Detailkapitel zusammen und zieht daraus die
Schlüsse. Die Belege stehen in den Kapiteln:

| Kapitel | Inhalt |
|---|---|
| [fillet/theory.md](fillet/theory.md) | Mathematik und Algorithmen: Rolling Ball, Symmetriesätze, 2D-Solver, Fasen-Definitionen, Vertex-Blends, variabler Radius, Profile, Fehler-Taxonomie, Offsets, Anbindung an den Körper |
| [fillet/implementations.md](fillet/implementations.md) | Open-Source-Code auf Codeebene: OCCT TKFillet, FreeCAD/CadQuery/build123d, remus, keel, vcad, BREP_kernel, monstertruck, Mesh- und SDF-Ansätze, Portgrößen, Fehlerkatalog F1 bis F16 |
| [fillet/commercial.md](fillet/commercial.md) | Parasolid, ACIS/ShapeManager, CGM, C3D, Granite, SMLib; Onshape-Semantik; FDM-Praxis; Patente |
| [fillet/corpus.md](fillet/corpus.md) | wie du Fillets und Fasen in deinen echten Teilen benutzt (gemessen) |
| [fillet/harness.md](fillet/harness.md) | Testumgebung für den Bake-off: 70 Fälle, OCCT-Oracle, Validator, Runner |

Labels: **MEASURED** (in einem hier genannten Lauf gemessen), **DOCUMENTED**
(steht in einer genannten Quelle), **INFERRED** (hier hergeleitet),
**HEARSAY** (nicht verifiziert). Wo nichts steht, gilt das Label des
verlinkten Kapitels.

## 1. Kurzfassung

1. **Du brauchst eine kleine, klar umrissene Teilmenge** (MEASURED,
   corpus.md). 93 Dateien in 52 Familien benutzen 3D-Fillets oder -Fasen.
   Jeder Blend hat konstante Größe in mm. Jede Fase ist equal-offset. Es gibt
   keinen variablen Radius, kein rho/Conic, kein G2, kein Setback, keinen
   Full Round als Option. Die häufigsten Größen: 0,42-mm-Fase (17 Familien),
   Fillets 2 / 4,2 / 3 mm.
2. **Die Triage-Zahl K12 ist zu hoch.** "108 Dateien / 53 Familien" enthält
   tote Helper (`roundX`, `filletXWindow`), die nie aufgerufen werden. Auch
   **r10b braucht kein Fillet** (MEASURED, Call-Graph plus Handprüfung).
3. **Fillets sind heute nicht dein erster Blocker** (MEASURED). Keine der 91
   FS-Einheiten mit Fillet kommt in wonky überhaupt bis zum ersten
   `opFillet`/`opChamfer`. Sie scheitern vorher an `qGeometry` (24),
   importierten Kurven (7), `newSketch` (6) und an der Boolean-Admission. Von
   38 build123d-Dateien erreichen 7 einen Blend.
4. **Eine Konfiguration dominiert** (MEASURED): gerade Plane/Plane-Kante mit
   senkrechten Endkappen, konvex 90° (21 Familien) und ihr konkaver Zwilling
   bei 270° (12 Familien). Danach kommen Fasen-Kantenzüge mit Gehrung, Fasen
   an Loch- und Bossrändern (Kegel) und G1-Ketten aus Linie und Bogen.
5. **Das meiste ist exakt analytisch lösbar** (MEASURED Klassifikation):
   strikt analytisch sind 23 von 39 gemessenen Familien und 69 % der Aufrufe
   (86 % ohne die Radius-Probierschleife in cad-project-046). Mit den erweiterten
   analytischen Fällen sind es 30 von 39 Familien. Alle 18 Fasen-Familien sind
   analytisch.
6. **Der harte Rest ist nicht exotisch, sondern Overflow** (MEASURED): In 5
   von 9 nicht-analytischen Familien ist der Blend breiter als eine
   Nachbarfläche. Dazu kommen B-Spline-Kanten (2 Familien) und eine Ecke mit
   gemischter Konvexität (1 Familie).
7. **Die Theorie ist klar** (DOCUMENTED plus INFERRED, theory.md): Ein
   Fillet ist genau dann ein Zylinder, wenn beide Flächen translationsinvariant
   in derselben Richtung sind, und genau dann ein Torus oder eine Kugel, wenn
   beide Flächen dieselbe Rotationsachse haben. Alles andere ist eine Rohrfläche
   um eine nicht-kreisförmige Spine, die man nur prozedural oder als
   (rationale) B-Spline darstellen kann.
8. **Die kommerziellen Kernel machen alle dasselbe Grundschema** (INFERRED
   aus den Docs): Stützflächen um r offsetten, schneiden, Spine gewinnen,
   wo möglich zu Zylinder/Torus/Kugel vereinfachen, dann den Blend anhängen.
   Sie unterscheiden sich fast nur an den Enden (Kappen, Overflow,
   Vertex-Patches) und beim Anhängen. **Keiner behauptet Vollständigkeit,** und
   alle leben mit Reihenfolgeabhängigkeit.
9. **OCCT scheitert nicht an der Geometrie, sondern an Topologieänderungen**
   (MEASURED): Die analytischen Fälle sind exakt und in 1 bis 13 ms fertig.
   Der Full Round (r = halbe Flächenbreite) scheitert seit über 10 Jahren und
   auch in OCCT 8.0.1. Auf dem Harness schafft OCCT 49 von 70 Fällen (4 der übrigen
   21 muss es ablehnen), scheitert an einem gewöhnlichen Plane/Cone-Fasenfall und liefert einmal ein
   ungültiges Ergebnis.
10. **Voraussetzung für fast alles: Torus und Kugel** (MEASURED durch Lesen von
    `kernel/analytic.bend`): Produktion kennt nur Plane, Cylinder und Cone.
    Randfillets an Löchern und Bossen (Torus) und Kugelecken brauchen die zwei
    neuen Flächentypen, samt STEP, Tessellierung und Boolean-Unterstützung.
    Das ist vermutlich mehr Arbeit als die Fillet-Konstruktion selbst
    (INFERRED).
11. **Vorschlag für den Bake-off: vier Prototypen** (§5). A: analytisch mit
    lokaler Surgery (OCCT-KPart-Idee plus Ecken-zuerst-Netzwerk).
    B: Fillet per Boolean mit exakten Blend-Körpern auf dem
    corefine+recover-Hybrid. C: allgemeiner Rolling-Ball-Walker mit
    ausgewiesener Toleranz. D (optional, klein): morphologisches Runden als
    Referenz-Oracle. Erwarteter Sieger ist ein Hybrid aus A (Normalfall) und
    B (Overflow), mit C als Opt-in-Stufe. Das muss der Bake-off aber erst
    zeigen.
12. **Der Harness steht** (MEASURED): 70 Fälle aus echten wonky-B-Reps,
    57 geschlossene Volumenformeln, ein OCCT-Oracle, ein Validator mit
    15 von 15 richtigen Urteilen im Mutationstest und ein Runner für
    js/cpu1/cpuN/metal.

## 2. Wie du Fillets tatsächlich benutzt

Quelle: [fillet/corpus.md](fillet/corpus.md), maschinenlesbar in
`out/fillet/corpus.json`, Einzelaufrufe in `tmp/fillet/primary-calls.json`.
Der Corpus unter `~/Workspace/cad` wurde nur gelesen.

### 2.1 Wer benutzt Blends (MEASURED, statisch)

| | Aufrufstellen | Dateien | Familien |
|---|---:|---:|---:|
| irgendeine Fillet-/Fasen-Stelle | 282 | 116 | 60 |
| **erreichbar** | **224** | **94** | **53** |
| erreichbar, 3D (ohne 2D-Sketch-Rundungen) | 216 | 93 | 52 |
| FeatureScript | 88 | 55 | 21 |
| build123d | 136 | 39 | 32 |
| Fillet (3D) | 131 | 76 | 38 |
| Fase (3D) | 85 | 34 | 25 |
| tot (Helper-Prelude, nie aufgerufen) | 58 | 37 | |

Familien sind die Primäreinheit, weil Revisionskopien die Dateizahlen
aufblähen (fs560, die Spar-Key-Z-Achse, hat allein 21 Dateien).

### 2.2 Parameter (MEASURED)

- Konstante Größe, nur mm. FS schreibt immer `* millimeter`.
- Fasen immer `EQUAL_OFFSETS`. Kein `TWO_OFFSETS`, `OFFSET_ANGLE`, `length2`,
  `angle`.
- Keine Nutzung von `crossSection`, `rho`, `isVariable`, `allowEdgeOverflow`,
  `keepEdges`, `smoothCorners`, `partialFilletBounds`, `opFullRoundFillet`
  oder `opFaceBlend`. **`allowEdgeOverflow` gilt also immer mit dem Default
  `true`** (DOCUMENTED Default, MEASURED Nichtnutzung).
- `tangentPropagation`: 30 FS-Stellen setzen `false`, 58 lassen `true`. In den
  gemessenen Selektionen hat `false` nie etwas geändert.

| Blend | Größe (mm) | Familien | Dateien | Aufrufe |
|---|---:|---:|---:|---:|
| Fase | 0,42 | 17 | 20 | 42 |
| Fillet | 2 | 12 | 33 | 89 |
| Fillet | 4,2 | 11 | 25 | 68 |
| Fillet | 3 | 10 | 34 | 35 |
| Fillet | 1 | 4 | 20 | 34 |

### 2.3 Kantenauswahl und Fehlerbehandlung (MEASURED)

- Die Auswahl passiert im Host-Code und ist achsgebunden: über alle Kanten
  laufen, gerade Linien mit `abs(direction[axis]) > 0.999` behalten,
  eventuell in einem Koordinatenfenster; oder den Kantenzug einer Fläche
  fasen. In build123d `filter_by(Axis.Z)`, `group_by(Axis.Z)[-1]` und
  Comprehensions über `e.center()`.
- **41 Stellen stehen in `try`, 30 in Schleifen**, oft mit Radius-Fallback
  (erst `rad`, dann kleiner). Dein `cad-fdm-design`-Skill schreibt diesen
  Fallback sogar vor.

Folge (INFERRED, commercial.md §10): Wenn wonky an einer Stelle scheitert, an
der Onshape Erfolg hat, läuft dein Modell still in den `catch`-Zweig und das
Teil ändert sich ohne Fehlermeldung. **wonky muss also genau dort scheitern,
wo Onshape scheitert, oder einen kleineren Radius als Fehlerwert melden.**
Das ist ein Argument für einen Onshape-Paritätstest auf den echten Aufrufen.

### 2.4 Rangliste der Konfigurationen (MEASURED an 39 Familien, 70 Dateien, 891 Aufrufen)

Die Geometrie wurde direkt vor dem Blend gemessen, meist über zwei Oracles
(build123d mit umhülltem `fillet`, und dein `fsocct`-Interpreter aus einer
Kopie), dazu wonky selbst und Onshape-STEP-Exporte.

**Kanten** (Top 10 von 20):

| # | Art | Kante: Stützflächen | Konvexität, Winkel | Familien | Klasse |
|---:|---|---|---|---:|---|
| 1 | Fillet | Linie: Plane/Plane | konvex 90° | 21 | strikt |
| 2 | Fase | Linie: Plane/Plane | konvex 90° | 17 | strikt |
| 3 | Fase | Kreis: Zylinderschnitt/Plane (Loch-, Bossrand) | konvex 90° | 15 | strikt |
| 4 | Fillet | Linie: Plane/Plane | konkav 270° | 12 | strikt |
| 5 | Fillet | Linie: Plane/Plane | konkav 180 bis 270° | 8 | strikt |
| 6 | Fillet | Linie: Plane/Plane | konvex 90 bis 180° | 8 | strikt |
| 7 | Fillet | Linie: Plane/Plane | konkav > 270° | 4 | strikt |
| 8 | Fillet | Linie: Plane/Plane | konvex < 90° | 4 | strikt |
| 9 | Fillet | Kreis: Zylinderschnitt/Plane | konvex 90° | 3 | strikt |
| 10 | Fase | Kreis: Kegelschnitt/Plane | konvex stumpf | 3 | erweitert |

Keine Kante zwischen zwei gekrümmten Flächen, kein Cylinder/Cylinder, kein
Cone/Cone, keine Ellipse. Einzige Sphere/Torus-Stütze ist eine degenerierte
Tangentialkante (MEASURED).

**Kantenenden** (Top 6 von 15):

| # | Art | Ende | Familien | Klasse |
|---:|---|---|---:|---|
| 1 | Fillet | freies Ende, senkrechte Kappe | 27 | strikt |
| 2 | Fase | Gehrung: zwei gefaste Kanten, dritte bleibt scharf | 15 | strikt |
| 3 | Fase | G1-Kette Linie/Bogen | 12 | strikt |
| 4 | Fase | geschlossener Kreis | 9 | strikt |
| 5 | Fase | freies Ende, senkrechte Kappe | 6 | strikt |
| 6 | Fillet | Gehrung zweier Fillet-Zylinder | 5 | erweitert |

Echte 3-Kanten-Ecken sind selten (2 Fillet-, 2 Fasen-Familien). Gemischte
Konvexität an einer Ecke gibt es in **einer** Familie (`project-component-4c7a33fe.fs`). Ecken mit
4 und mehr Blend-Kanten, ungleiche Radien an einer Ecke oder Setbacks kommen
nicht vor.

### 2.5 Analytischer Anteil (MEASURED)

**Strikt** heißt: Plane/Plane-Linien und Plane/Zylinder-Randkreise beliebiger
Konvexität und beliebigen Winkels, Enden als senkrechte Kappe, geschlossene
Schleife, G1-Kette, Kugelecke gleicher Konvexität oder Fasen-Gehrung, und
keine Fläche wird aufgefressen. **Erweitert** fügt Zylinder-Erzeugende,
Kegelschnitte, schräge oder gekrümmte Kappen und Fillet-Gehrungen hinzu.

| Einheit | strikt | erweitert | allgemein | gesamt | strikt | strikt + erweitert |
|---|---:|---:|---:|---:|---:|---:|
| Aufrufe | 619 | 41 | 231 | 891 | 69 % | 74 % |
| Aufrufe ohne unifi-Probierschleife | 544 | 26 | 64 | 634 | 86 % | 90 % |
| Dateien | 50 | 7 | 13 | 70 | 71 % | 81 % |
| **Familien** | **23** | **7** | **9** | **39** | **59 %** | **77 %** |
| Familien, nur Fasen | 12 | 6 | 0 | 18 | 67 % | 100 % |

### 2.6 Der harte Rest (MEASURED)

| Grund | Familien | Aufrufe | OCCT |
|---|---:|---:|---|
| Flächenverbrauch / Overflow: Blend breiter als eine Nachbarfläche (bis 0,05 mm schmale Flächen neben 0,4 bis 10 mm Fillets) | 5 | 208 | 154 der 167 unifi-Schleifenaufrufe scheitern; die 16 Coupon-Aufrufe klappen |
| Fillet entlang B-Spline-Kante (extrudierte Spline-Profile, cad-project-003-Beinwurzeln) | 2 | 18 | alle erfolgreich |
| Fillet auf einer G1-Kante (degenerierte Auswahl, kein echter Bedarf) | 2 | 2 | No-op |
| Ecke mit gemischter Konvexität (`project-component-4c7a33fe`) | 1 | 2 | erfolgreich |

Außerdem scheitert OCCT an einem strikt analytischen Fall aus deinem Corpus:
die 0,42-mm-Fase des äußeren Kantenzugs in
`cad-project-039/r22-planar-guides.fs` (20 Kanten, keine
Überschneidung). Der nachgebaute r22-ähnliche Harnessfall klappt in OCCT.
Der Grund für den Fehlschlag auf der echten Datei ist also noch unbekannt.

### 2.7 Was das für wonky heißt

- **Seam-Kanten ignorieren** (INFERRED): OCCT hat Seam-Kanten auf periodischen
  Flächen, wonkys Zylinder auch, Onshape nicht. "Alle Kanten"-Auswahlen
  greifen sie (12 Kanten in `cad-project-033` und `project-component-4c7a33fe`).
- **Fasen sind so wichtig wie Fillets** (DOCUMENTED, dein Skill und Prusa KB):
  R4,2 auf vertikalen Kanten, dann eine durchgehende 0,42-mm-Fasenkette über
  alle anderen Kanten, zuletzt. Diese Kette läuft über die R4,2-Zylinder, ist
  dort also eine Plane/Zylinder-Fase, ein Kegel.
- Wo wonky schon heute bis zum Blend kommt, stimmt seine Vor-Blend-Geometrie
  mit dem Oracle überein: 8 von 8 Aufrufen (MEASURED).

## 3. Die Landschaft

### 3.1 Theorie (theory.md)

**Die eine Konstruktion** (DOCUMENTED, Choi-Ju, Rossignac): Ein Fillet mit
Radius r ist die Hüllfläche einer Kugel, die beide Flächen berührt. Die
**Spine** (Kugelmittelpunktbahn) ist der Schnitt der beiden um r zur Kugel hin
versetzten Flächen. Die **Kontaktkurven** (Spring Curves) sind die Spine,
entlang der Normalen um r zurückgeschoben. Der Querschnitt ist ein Kreisbogen.
Alles andere ist Spezialfall, Existenzbedingung oder Endbehandlung.

**Zwei Symmetriesätze** entscheiden, wann das exakt analytisch ist (INFERRED
als Vollständigkeit; die Einzelfälle DOCUMENTED bei Kós-Martin-Várady, Shene,
OCCT ChFiKPart, ACIS):

| Familie | Stützflächen | Fillet | Fase |
|---|---|---|---|
| Translation | beide invariant in Richtung d: Plane/Plane, Plane mit achsparallelem Zylinder, parallele Zylinder | **Zylinder** | Plane |
| Rotation | beide rotationssymmetrisch um dieselbe Achse: Plane senkrecht zur Achse, koaxiale Zylinder/Kegel/Tori, Kugel auf der Achse | **Torus**, Kugel wenn der Bogenmittelpunkt auf der Achse liegt | Kegel, Plane oder Zylinder |
| alles andere | z. B. schräge Plane/Zylinder, gekreuzte Zylinder | Rohrfläche um Kegelschnitt- oder Quartik-Spine | rationale Regelfläche |

Beide Familien reduzieren sich auf **einen 2D-Solver** (Kreis tangential an
Linie/Linie, Linie/Kreis oder Kreis/Kreis) mit geschlossenen Formeln. Für
Plane/Plane gibt es eine trigonometriefreie Mittelpunktformel
`c = e + r(m1+m2)/(1+m1·m2)`; Setback `r·tan(θ/2)`; Querschnittsfläche
`r²(tan(θ/2) − θ/2)` (MEASURED numerisch in `tmp/fillet/theory-checks.mjs`).

Weitere Ergebnisse, die für die Prototypen zählen:

- **Existenz:** Liegt die Kugel in einem Zylinder (Bossdeckel, Sacklochboden),
  gilt `r < ρ`; bei `r = ρ` entsteht eine Kugel. Der Spindeltorus für
  `ρ/2 < r < ρ` ist gültig, weil der benutzte Viertelbogen die
  selbstschneidende Innenseite nie erreicht (INFERRED; remus kommt auf
  dasselbe). OCCT und der Harness bestätigen das mit dem Fall
  `pc-post-top-rim-spindle-r3.5` (MEASURED).
- **Vertex-Blends:** Eine Kugelecke existiert immer, wenn drei Blends gleichen
  Radius und gleicher Konvexität zusammentreffen, nicht nur an ebenen Ecken
  (INFERRED §6.4). Ein konkaves Fillet, das an einer scharfen konvexen Kante
  vorbeirollt, gibt einen **Horntorus** (INFERRED; ACIS erlaubt genau diesen
  Fall, DOCUMENTED). Ungleiche Radien, gemischte Konvexität oder 4+ Kanten
  brauchen einen Setback-n-Eck-Patch, also einen neuen nicht-analytischen
  Flächentyp.
- **Full Round** ist exakt analytisch: bei `r = t/2` fallen beide
  Fillet-Zylinder auf denselben Träger, die Fläche dazwischen verschwindet
  (INFERRED §10.3). Genau hier scheitert OCCT.
- **Fasen:** Es gibt mindestens vier unverträgliche Definitionen von
  "Abstand" (DOCUMENTED): Face-Offset (Parasolid, Onshape-Default),
  In-Support-Abstand (OCCT), Apex-Range, Rolling-Ball (ACIS R10). Bei 90° sind
  alle gleich; bei anderen Winkeln nicht. Der Harness misst, dass OCCT bei 60°
  den In-Support-Abstand nimmt (MEASURED).
- **Fehler-Taxonomie:** Onshapes `FILLET_*`-Enum ist fast wörtlich Parasolids
  Fault-Liste (DOCUMENTED). Mehrere Kernel melden Erfolg bei falschem
  Ergebnis: OCCT #1371, monstertruck überspringt Kanten still, ACIS "pocket
  lost" (DOCUMENTED). Also: nach dem Bau validieren und explizit scheitern.
- **Anbinden an den Körper** (§13): per Boolean mit Blend-Körpern (Rossignac,
  ACIS Stage 2) oder per lokaler Surgery (HP-Patente, abgelaufen). Der Boolean
  hat ein Grundproblem: Der Blend ist per Konstruktion tangential an beide
  Stützflächen, und Stufe [C] des Hybrid-Booleans lehnt fast-tangentiale
  Trägerpaare ab (DOCUMENTED, `docs/hybrid-boolean-plan.md` §2, §5: "fillets
  through tangent-cylinder Booleans: conjecture").

**Was wonky exakt halten kann** (MEASURED durch Lesen des Codes):

| Fall | heute exakt? | braucht |
|---|---|---|
| alle Fasen beider Familien | ja (Plane, Cone) | nichts |
| Fillets der Translationsfamilie | ja (Cylinder; Kappen als Circle/Ellipse) | nichts |
| Fillets der Rotationsfamilie (Loch-/Bossrand, koaxial) | nein | **Torus** |
| Kugelecken | nein | **Sphere** |
| Gehrung zweier Fillets | ja (Ellipse) | Oracle-Check |
| schräge Plane/Zylinder, gekreuzte Zylinder | nein | Rohrfläche (prozedural oder B-Spline) |
| Setback-Ecken, gemischte Konvexität | nein | n-Eck-Patch, B-Spline-Export |

Sphere und Torus existieren bisher nur in `kernel/proto/recover/geom.bend`
(`SSphere`, `STorus`) und im Test-Serializer des Boolean-Bake-offs. Ob STEP
für Spindel- und Horntori `DEGENERATE_TOROIDAL_SURFACE` braucht, ist
**HEARSAY** und vor Gebrauch mit `uv run scripts/validate-step.py` zu prüfen.

### 3.2 Open Source (implementations.md)

**Es gibt genau eine Open-Source-Fillet-Implementierung mit breiter
Nutzerbasis: OCCT TKFillet** (DOCUMENTED). FreeCAD, CadQuery, build123d und
Replicad rufen alle nur `BRepFilletAPI_MakeFillet/MakeChamfer` auf. Alle
anderen Kernel mit Fillets sind Arbeiten von 2025/2026, meist LLM-gestützt und
mit einem Maintainer, ohne Nutzer und Erfahrungsschatz.

**Die Architektur ist überall gleich** (DOCUMENTED): Kettenbildung und
Klassifikation, Stripe-Geometrie (geschlossene "KPart"-Leiter oder
Walking-Solver), Ecken, Topologie-Surgery, Validierung. Die Unterschiede
liegen darin, wie viele Stufen exakt sind.

**OCCT im Detail** (DOCUMENTED Code, MEASURED Probe mit OCCT 8.0.1):

- 75.616 Zeilen `.cxx`. Exakt ist es nur über **ChFiKPart** (rund 6k Zeilen):
  Plane/Plane gibt Zylinder, Plane/Zylinder gibt Zylinder oder am Rand Torus
  oder Kugel, Plane/Cone gibt Torus oder Kugel, Fasen geben Plane oder Cone.
  Ecken sind exakt nur bei drei gleichen Radien (`ChFiKPart_Sphere`) und in
  zwei Torus-Sonderfällen. Alles andere ist Walking plus GeomFill/GeomPlate.
- Gemessen: analytische Fälle exakt in 1 bis 13 ms. 10-mm-Würfel mit zwei
  gegenüberliegenden Kanten: R4,99 klappt (0,02-mm-Streifen bleibt), **R5
  scheitert** (#1177, #172, offen seit etwa 2015). Alle 12 Kanten R1:
  12 Zylinder + 8 Kugeln, Volumen gleich der geschlossenen Formel. Zylinderdeckel
  mit R gleich Zylinderradius: Kugel, gültig. T aus zwei Zylindern: eine
  B-Spline-Fläche.
- **Die Fehler liegen in Topologieänderungen, nicht in der Stripe-Geometrie**
  (DOCUMENTED, 47 GitHub-Issues/PRs, 23 offen): aufgefressene Flächen,
  periodische Seams, tangentiale Enden, degenerierte Normalen, Ecken.
- Die Wrapper gehen unterschiedlich damit um: FreeCAD behält ungültige
  Ergebnisse und flickt Toleranzen. build123d verwirft sie und bietet
  `max_fillet()`, eine Bisektion, die monotone Machbarkeit in r annimmt
  (DOCUMENTED). Letzteres ist falsch (F16, Zoo #12429).

**Die neuen Kernel** (alle DOCUMENTED aus Code):

| Kernel | Lizenz | Was es kann | Was man mitnehmen kann |
|---|---|---|---|
| remus | Apache-2.0 (bis brepkit v2.129.15) | breiteste exakte Leiter im Open Source: 9 Fillet-Paare, alles als Cylinder/Torus; Ecken mit ≥ 3 gleichen Stripes als exakte Kugeldreiecke; sonst typisierter Fehler | Paarliste, Radius-Schranken, Fehlercodes. Vorsicht: dokumentierter stiller No-op |
| keel | GPL-3: nur Ideen | Leiter lokaler Operationen: Gehrungs-Ellipse, Oktanten-Kugel, zertifizierter Várady-Rockwood-Setback, Kegelauslauf | Zerlegung, Rezepte; die Teile komponieren aber nicht (alle 12 Würfelkanten: Abbruch an der ersten Ecke) |
| BREP_kernel (brep.io) | Custom, Rückübertragungspflicht: **nicht portierbar** | als Einziger beides versucht: "Fillet per Boolean mit Werkzeugkörper" und direkte Surgery; wandert weg vom Boolean (Cutter-Overshoot, Ecken aus Resten, Reihenfolgeabhängigkeit) hin zu einem Stripe-Netzwerk, das **Eckkugeln zuerst** löst | die Reihenfolge-Idee und die Fallstricke als Fixtures |
| monstertruck | Apache-2.0 | alles als NURBS approximiert, auch wo es geschlossene Formen gibt (etwa 3 % von r im eigenen Test); überspringt fehlgeschlagene Kanten still | Kontaktkreis-Solver (3×3 plus Gauss-Newton), Leibniz-Ableitungen, adaptiver zertifizierter Fit |
| vcad | Apache-2.0 | Plane/Plane auf konvexen Polyedern, Plane/Zylinder, koaxiale Zylinder; ungeprüfte API gibt Eingabe unverändert zurück | Planer für alle Kanten eines konvexen Polyeders |

**Mesh und SDF sind keine CAD-Fillets** (DOCUMENTED): SDF-smooth-min hat
konstante Dicke statt konstantem Radius; ein exakter Viertelkreis entsteht nur
bei exakten Distanzfeldern unter 90°. Manifold, Blender und Minkowski
verlieren die analytische Geometrie.

**Kernel ohne Fillets** (DOCUMENTED): SolveSpace, Fornjot und BRL-CAD. Jedem
fehlt mindestens eine Voraussetzung: ein tangentenrobuster Boolean, eine
lokale Flächen-Surgery oder Offset- und Torusflächen. Für wonky ist das die
Checkliste der Voraussetzungen.

### 3.3 Kommerzielle Kernel (commercial.md)

Kein Code portierbar, alle proprietär. Die Docs sind Referenz. Onshape läuft
für Fillets sehr wahrscheinlich auf Parasolid (INFERRED, stark: die Fehler-Enums
stimmen fast wörtlich, V35-Neuerungen tauchen in Onshape auf). Dein
FS-Corpus hängt also implizit an Parasolids Defaults.

**Was die Kommerziellen machen und sonst niemand** (DOCUMENTED):

1. **Overflow als eigene Typen.** Parasolid: smooth (auf die nächste Fläche
   weiterrollen), cliff, cliff-end, notch ("die Blendfläche bleibt, sie wird
   mit den Flächen der Kerbe getrimmt"), in fester Reihenfolge probiert, mit
   dokumentiertem Default je Konfiguration. SolidWorks "keep edge / keep
   surface", C3D `keepCant`, Onshape `allowEdgeOverflow`/`keepEdges`. Kein
   Open-Source-Kernel hat das.
2. **Ein prozeduraler Blend-Datensatz** als Wahrheit: Parasolids "blended
   edge" (`geom_1, geom_2, radii, spine`), "wherever possible" zu Zylinder
   und Torus vereinfacht.
3. **Handler-Tabellen für Ecken und Wechselwirkungen**: SMLib benennt N×M-Ecken
   (3×1, 3×3 gleiche/gemischte Konvexität, NxN) und Handler für Fillet gegen
   Boss/Loch. Creo hat Übergangstypen (Corner Sphere, Intersect, Patch, Round
   Only). Die Synthese steht als Tabelle C1 bis C8 in commercial.md §4.2.
4. **Blend-Umordnung**: ACIS baut einen großen Blend zwischen zwei kleinen,
   "als ob der große zuerst gemacht worden wäre". Parasolid ordnet nach
   Konvexitätsklassen (`vx_order`, `ov_order` Default "convex first").
5. **Globale Interferenzprüfung** als Option (ACIS). Der Default ist lokal und
   verliert dokumentiert eine Tasche.
6. **Toleranzwachstum bei Fehlschlag** (Parasolid V35, `set_tol` Default
   **ja**, bis 1e-5 m pro Blend). Einige deiner Onshape-Fillets gelingen
   vielleicht nur deshalb (INFERRED). wonky verbietet stilles
   Toleranzwachstum; es sollte stattdessen die nötige Toleranz melden.

**Reihenfolgeabhängigkeit ist überall eingebaut, und die Nutzerratschläge
widersprechen sich** (DOCUMENTED plus HEARSAY): SolidWorks und Onshape sagen
"groß vor klein", Fusion-Foren sagen "klein zuerst, dann vergrößern".
Dein Skill sagt: roh → Kerb-Fillets → Blends → ein Entgrat-Durchgang.

**Fillet per Boolean ist kein exotischer Gedanke** (DOCUMENTED): Es ist ACIS
Stage 2 ("Boolean-artiges Trimmen, das die Schnitte aus Stage 1
wiederverwendet") und deine eigene Praxis im Skill: "Build fillets as geometry
when OCC would choke: posts = Cylinder(R+r,h) − Torus(R+r,r); straight walls =
Box(r,L,r) − Cylinder(r)".

**Patente** (DOCUMENTED, Google Patents; keine Rechtsberatung):

| Patent | Inhalt | Status |
|---|---|---|
| US5615317A (HP) | Blend-Integration mit Euler-Operatoren (shrink/swallow) | abgelaufen, frei |
| US6133922A (HP) | Lücken schließen per DFS über Trimmpfade | abgelaufen, frei |
| US9690878B2 (Siemens) | voneinander abhängige Blends, Reblending | **aktiv bis 2036-04-24**: Ribbon-Breaker-Reblending nicht bauen |
| US8935130B2 (Siemens) | Erkennen und Verketten von Notch-/Cliff-Blends | **aktiv bis 2032-12-15**: Notch erzeugen ist dokumentiertes Verhalten, Erkennen in importierten Modellen prüfen |
| US8004517B1 (Geomagic/Hexagon) | Setback-Vertex-Blends in Flächenstrukturen | **aktiv bis 2027-12-17**: vor jedem Setback-Patch prüfen |

### 3.4 Lizenzen der Quellen, aus denen portiert werden könnte

| Quelle | Lizenz | Was erlaubt ist |
|---|---|---|
| OCCT TKFillet | LGPL-2.1 mit Exception | **nur Oracle und Ideen** (AGENTS.md verbietet OCCT in Produktion); Algorithmen neu herleiten, keinen Code übersetzen |
| remus | Apache-2.0 (≤ brepkit v2.129.15; spätere brepkit-Versionen AGPL) | portierbar mit Attribution |
| monstertruck | Apache-2.0 | portierbar mit NOTICE |
| vcad | Apache-2.0 | portierbar |
| keel | GPL-3.0-or-later | nur Ideen (Clean Room) |
| BREP_kernel | Custom (Rückübertragung an Autodrop3d) | nur Ideen |
| Blender bmesh_bevel | GPL-2.0+ | nur Ideen |
| CGAL | GPL-3 / LGPL-3 je Paket | nur Ideen |
| SISL | AGPL-3.0 | nur Ideen |
| hg_sdf | CC BY-NC | nicht verwenden |
| Onshape std library | MIT (© PTC) | Wrapper mit Hinweis kopierbar; enthält keine Geometrie |
| Parasolid, ACIS, CGM, C3D, Granite, SMLib | proprietär | nur als Referenz lesen, nichts kopieren |
| Paper (Choi-Ju, Rossignac, Várady, Lukács, Dahl, Wallner-Pottmann, Braid, Kós) | Veröffentlichungen | Algorithmen frei nutzbar; Patente separat prüfen |
| Oracles: build123d 0.13.0, cadquery-ocp 8.0.1 | Apache-2.0 (OCCT darunter LGPL) | nur über `uv run` messen |

## 4. Weizen und Spreu

### 4.1 Bewiesen

| Idee | Beleg |
|---|---|
| **Analytische Leiter (KPart)**: Offset-Schnitt → Zylinder/Torus/Kugel/Kegel für die Symmetriefamilien | DOCUMENTED in OCCT, remus, keel, allen kommerziellen Kerneln; MEASURED: wo OCCT einen Fall mit geschlossener Formel baut, stimmt es auf ≤ 1,6e-9 relativ überein, bis auf zwei Semantik-Abweichungen bei Fasen (§6.4) |
| **Kugelecke** bei drei gleichen Radien gleicher Konvexität | DOCUMENTED (OCCT, Parasolid, ACIS, remus); MEASURED: Steiner-Volumen für alle Würfelkanten |
| **Gehrungen** (Fasen-Gehrung, Fillet-Gehrung auf Ellipse) | DOCUMENTED (keel, BREP_kernel, OCCT); MEASURED im Harness |
| **Typisierte Ablehnung statt stiller Erfolg** | DOCUMENTED: Parasolid-Faultliste = Onshape-Enum; remus/vcad/keel; Gegenbeispiele OCCT #1371, monstertruck, ACIS |
| **"Fixen ist der einzige Test"** (Parasolid): bauen, dann global validieren | DOCUMENTED |
| **Alle Stripes und Ecken zuerst berechnen, dann einmal umbauen** | DOCUMENTED (BREP_kernel network, OCCT ist das Gegenbeispiel); passt zu Bend (fork-join, keine Mutation), INFERRED |
| **Fasen-Ketten mit Tangentenpropagation**, Kegel an Bögen | DOCUMENTED (ACIS Smooth-Edge-Tabelle), MEASURED: 12 Familien |

### 4.2 Sackgassen

| Idee | warum raus |
|---|---|
| OCCT Walking + GeomFill/GeomPlate-Ecken + TopOpeBRep-Rekonstruktion | etwa 65k Zeilen Numerik ohne Zertifikat, Quelle der meisten Bugs (DOCUMENTED) |
| alles als NURBS approximieren, auch analytische Fälle (monstertruck) | verliert Exaktheit dort, wo es sie umsonst gibt (DOCUMENTED) |
| SDF-smooth-min als Fillet | falsche Radius-Semantik (DOCUMENTED) |
| Mesh-Bevel, Minkowski | analytische Geometrie weg (DOCUMENTED) |
| stilles Toleranzwachstum (Parasolid-Default) | verstößt gegen wonkys Regeln |
| ungültige Ergebnisse behalten und Toleranzen flicken (FreeCAD) | verschiebt den Fehler nach hinten |
| nur lokale Interferenzprüfung (ACIS-Default) | verliert dokumentiert Features |
| Reihenfolge-Suche in der Regeneration (FilletXpert) | nicht deterministisch im Aufwand; höchstens mit aufgezeichneter Reihenfolge |
| `strict = false` als Default ("runde, was geht") | Teilerfolg nur als expliziter Modus mit Liste |
| Setback-n-Eck-Patches im ersten Wurf | 0 Nutzungen im Corpus, neuer Flächentyp, Patent bis 2027-12-17 |
| `max_fillet()` per Bisektion | nimmt monotone Machbarkeit an, die es nicht gibt (F16) |

### 4.3 Unbekannt (genau das soll Teil 2 klären)

| Frage | Stand |
|---|---|
| Kann der corefine+recover-Hybrid tangentiale Blend-Körper tragen? | **Vermutung** im Hybrid-Plan; Stufe [C] lehnt heute beide tangentialen Corpus-Fälle ab |
| Surgery oder Boolean für das Anhängen, und wo liegt die Grenze? | offen (theory §15.7); BREP_kernel ist vom Boolean weggegangen, ACIS setzt darauf |
| Full Round und aufgefressene Flächen: wer baut das robust? | OCCT scheitert seit 10+ Jahren; kein Open-Source-Kernel hat es gezeigt |
| Welche Overflow-Semantik hat Onshape auf deinen Teilen? | nicht geprobt; `allowEdgeOverflow = true` gilt immer |
| Welche Fasen-Definition gilt in Onshape bei ≠ 90°? | INFERRED Face-Offset; OCCT nimmt In-Support (MEASURED) |
| Eckfase: Punkt (drei Prismen) oder Dreieck (OCCT)? | Onshape nicht geprobt |
| Horntorus bei konkavem Fillet an scharfer konvexer Kante: macht Onshape das? | HEARSAY |
| Rohrflächen: rationale B-Spline (Dahl), Bi-Arc-Tori (Rossignac) oder prozedural mit zertifiziertem Fit? | offen; im Corpus bisher nur 2 Familien (B-Spline-Spines), die wonky noch nicht bauen kann |
| Warum scheitert OCCT an der echten r22-Datei? | offen; der r22-ähnliche Fall klappt |
| STEP-Entitäten für Spindel- und Horntorus | HEARSAY |

## 5. Die Kandidaten für den Bake-off

### 5.0 Gemeinsame Voraussetzungen und Aufbau

- **Torus und Kugel im Prototypenformat**: Das Job/Result-Format des Harness
  kann `sphere` und `torus` schon, der Validator auch, und der STEP-Weg läuft
  über den Serializer des Boolean-Bake-offs. Die Prototypen brauchen die
  Typen also **nicht** vorher in Produktion. Für Produktion bleiben sie
  Voraussetzung (§7, Entscheidung 3).
- **Gemeinsame Stripe-Geometrie**: A und B unterscheiden sich im Anhängen,
  nicht in der Blendgeometrie. Damit der Bake-off die Anhängemethode vergleicht
  und nicht zwei Implementierungen derselben Formeln, sollte die
  KPart-Geometrie (2D-Solver, Spine, Kontaktkurven, Eckkugel) als gemeinsame
  Datei unter `kernel/proto/` liegen, analog zu `kernel/proto/mesh.bend`
  (INFERRED). Der Runner erlaubt keine Imports aus anderen
  Prototypverzeichnissen, gemeinsame Dateien schon (DOCUMENTED, bakeoff.md).
  C rechnet dieselben Fälle unabhängig und dient damit als Gegenprobe.
- **Vertrag**: `kernel/proto/fillet-<name>/main.bend` mit `run(job)`, voller
  Ergebniskörper, jede Fläche als `support`/`blend`/`corner`/`cap` markiert,
  `tol 0` oder ausgewiesene Toleranz ≤ 0,01 mm, Ablehnung als
  `unresolved <Klasse> <Grund>`, byte-identisch auf allen Targets
  (harness.md, "Prototype contract").

Übersicht (Größen in Bend-Zeilen ohne Tests, INFERRED Größenordnung):

| | A kpart-surgery | B blend-boolean | C rolling-ball | D morph-round (optional) |
|---|---|---|---|---|
| Art | Port etablierter Ideen | Port (Rossignac, ACIS Stage 2, deine Praxis) | Port (monstertruck, OCCT BlendFunc-Residuen) | neue Idee (Rossignac-Definition mit Hybrid-Maschinerie) |
| Blendgeometrie | exakte Leiter | exakte Leiter (geteilt mit A) | Walker, zertifizierte Approximation | aus Morphologie, dann Träger-Recovery |
| Anhängen | lokale Surgery | corefine + recover | lokale Surgery (wie A) | recover |
| Zielfälle | 40 core + 12 corpus | hard (Overflow, Kerbe, Full Round) + core zum Vergleich | nicht-analytische Paare, neu zu bauen | hard-Fälle als Referenz |
| Größe | 3 bis 5k | 1,5 bis 2,5k plus Boolean-Änderung 0,5 bis 1k | 2,5 bis 4k plus Formaterweiterung | 1 bis 2k |

### 5.1 A: `fillet-kpart` (analytisch zuerst, lokale Surgery)

- **Portiert:** die Idee von OCCT **ChFiKPart** (nur Algorithmus, neu
  hergeleitet über die Symmetriesätze), die Paarliste und Radius-Schranken aus
  **remus** (Apache-2.0), das **Ecken-zuerst-Netzwerk** aus BREP_kernel (nur
  Idee), die Gehrungs- und Oktanten-Rezepte aus keel (nur Idee) und die
  Topologie-Surgery nach den **HP-Patenten** US5615317A/US6133922A
  (abgelaufen).
- **Ansatz:**
  1. Kanten auflösen, Seams verwerfen, Tangentenketten propagieren
     (`tangentPropagation` inklusive `false`).
  2. Jede Kante klassifizieren (Konvexität, Winkel, Familie); jede Ecke
     klassifizieren: freies Ende mit Kappe, Gehrung, Kugelecke, Kette,
     Horntorus, oder Ablehnung mit Namen (SMLib-N×M-Vokabular,
     Parasolid-Regeln).
  3. Pro Kante parallel: 2D-Solve → Zylinder, Torus, Kugel; Fase → Plane,
     Cone. Existenz- und Reichweitentests mit gefilterten Prädikaten und
     explizitem "unentscheidbar".
  4. Pro Ecke parallel: Kappenkurven, Gehrungsellipsen, Kugelecken.
  5. Erst wenn alles steht, ein einziger Umbau als reine Funktion: Stützflächen
     trimmen, Blendflächen einsetzen, Schleifen neu ableiten.
  6. **Aufgefressene Flächen explizit**: Wenn der Setback die Flächenbreite
     erreicht, Fläche entfernen und Nachbar-Stripes tangential verbinden (Full
     Round als ein Halbzylinder). Das ist der OCCT-Bug seit 2015.
  7. Globale Validierung (geschlossen, orientiert, keine Selbstdurchdringung,
     BVH-Interferenz des Blends gegen alle Flächen); Overflow, Kerbe und
     entfernte Interferenz werden **typisiert abgelehnt**, nicht versucht.
  8. Neben der Ablehnung den **größten machbaren Radius** melden, wo er sich
     analytisch ergibt (`r·tan(θ/2) ≤ Flächenbreite`, `r < ρ`).
- **Deckt ab (gegen den Corpus):** alle strikten und erweiterten Fälle, also
  23 bis 30 von 39 Familien und 69 bis 74 % der Aufrufe (86 bis 90 % ohne die
  Probierschleife). Das sind die Harness-Gruppen core (40) und corpus (12)
  ohne die Overflow-Fälle, plus die typisierten Ablehnungen der `must-refuse`-
  Fälle. Dazu der Full Round (`hard-full-round-r5`,
  `corpus-notch-trial-r1.5`), wo OCCT scheitert.
- **Risiken:**
  - Die Surgery ist die unregelmäßige Graph-Arbeit und in Bend neu; sie muss
    Schleifen, Seams und geschlossene Kreise korrekt umbauen.
  - Kappen an gekrümmten Flächen geben Raumquartiken (nicht im Format).
    Solche Fälle muss A ablehnen.
  - Entscheidungen nahe Grenzen (r = Flächenbreite, r = ρ, Winkel ≈ 180°)
    brauchen exakte oder gefilterte Prädikate; F32x2 allein reicht nicht.
  - Overflow bleibt ungelöst (5 Familien); das ist Absicht und B's Aufgabe.
- **Größe:** 3 bis 5k Bend-Zeilen (Leiter 1,5 bis 2,5k, Eckennetzwerk 1 bis
  2k, Surgery mit Flächenverbrauch 1 bis 1,5k; INFERRED aus
  implementations.md §13.2, auf den Corpus-Umfang zugeschnitten).

### 5.2 B: `fillet-boolean` (Fillet per Boolean mit exakten Blend-Körpern)

- **Portiert:** Rossignacs Blend-Primitive (Paper), **ACIS Stage 2**
  ("Blend-Sheet, dann Boolean-artiges Anhängen"), BREP_kernels `tool.rs`
  (nur Idee, samt seinen dokumentierten Fallstricken als Fixtures) und deine
  eigene Praxis (`Cylinder(R+r) − Torus(R+r, r)`, `Box(r,L,r) − Cylinder(r)`).
  Wiederverwendet den **corefine + recover-Hybrid**.
- **Ansatz:**
  1. Stripe-Geometrie aus der gemeinsamen Leiter (wie A).
  2. Pro Auswahl ein Werkzeugkörper: je Kante das Prisma über "Drachen minus
     Kreis" (konvex: abziehen; konkav: vereinigen), je Randkante das rotierte
     Gegenstück (Torus-Sliver), je Kugelecke das Eckstück; überlange
     Werkzeuge werden an konkaven Enden exakt gekappt (theory §13.2).
  3. Werkzeug per Hybrid-Boolean anwenden. Die Tangentialität wird **deklariert
     statt entdeckt**: Werkzeugflächen verweisen auf dieselben Trägerdatensätze
     wie die Stützflächen, Kontaktkurven gehen als bekannte exakte Kanten in
     recover, und Stufe [C] akzeptiert deklarierte Tangentialpaare statt sie
     abzulehnen.
  4. Notch-Overflow, verschwundene Löcher und entfernte Interferenz ergeben
     sich aus dem Boolean.
- **Deckt ab (gegen den Corpus):** dieselben analytischen Fälle wie A, **plus
  die Overflow-Familien** (5 von 9 im harten Rest: cad-project-046, tripod,
  cad-project-003-Schiene, Preload-Coupon, project-component-d98e059b), wenn Notch-Semantik
  reicht. Das ist der Grund, warum es B gibt. Harness-Fälle:
  `hard-overflow-*`, `hard-concave-rim-overflow-r6.5`,
  `hard-overlapping-blends-thin-wall-r1`, `hard-boss-root-concave-mitres-r1`,
  `corpus-notch-trial-r3`; dazu core zum Vergleich mit A.
- **Risiken:**
  - **Der Hauptpunkt:** tangentiale Kontakte sind der schwerste Fall des
    Booleans. Der Hybrid ist nach eigenem Plan "near tangencies" noch nicht
    sicher (18 falsche `ok` bei corefine, 15 falsche exakte STEP bei recover
    vor Schritt 1 und 2; Schritt 1 ist erledigt). Ohne deklarierte
    Tangentialität lehnt Stufe [C] fast jeden Fillet ab.
  - Deklarierte Tangentialität greift in `kernel/proto/corefine` und
    `kernel/proto/recover` ein. Die gehören gerade anderen Workflows.
  - Kugelecken entstehen **nicht** aus nacheinander angewandten
    Kantenwerkzeugen; das Eckstück ist Pflicht. BREP_kernel dokumentiert
    Cutter-Overshoot und Reihenfolgeabhängigkeit.
  - Notch ist nur eine der vier Parasolid-Overflow-Arten. Wo Onshape "smooth"
    macht, liefert B ein anderes, trotzdem gültiges Teil.
  - Laufzeit: jeder Fillet wird ein voller Boolean (corefine auf
    Tessellierung plus recover), also Größenordnungen langsamer als A
    (INFERRED).
- **Größe:** 1,5 bis 2,5k Bend-Zeilen für Werkzeuge und Eckstücke, plus 0,5
  bis 1k für deklarierte Tangentialität im Boolean (INFERRED;
  implementations.md P4 schätzt 0,8 bis 1,5k für die Werkzeuge allein).

### 5.3 C: `fillet-rollingball` (allgemeiner Walker mit ausgewiesener Toleranz)

- **Portiert:** den **Kontaktkreis-Solver** und den **adaptiven zertifizierten
  Fit** aus monstertruck (Apache-2.0): Mittelpunkt per 3×3-Lösung,
  Gauss-Newton-Projektion, Leibniz-Ableitungen, Kontaktkreise an
  Spannenenden und -mitte, Prüfung gegen die exakte Fläche, höchstens
  16 Runden, sonst Ablehnung. Die Residuen `E1..E4` aus OCCT
  `BlendFunc_ConstRad` als Spezifikation (nur Idee). Spine-Theorie nach
  Choi-Ju und Kós-Martin-Várady; Zertifizierung per Maximal-Kugel-Residuum
  (theory §2.5).
- **Ansatz:** Querschnitte an festen Parametern t **unabhängig** voneinander
  lösen (nicht sequentiell marschieren; passt zu fork-join), dann eine
  Approximation mit **ausgewiesener Toleranz** bauen. Zwei Ausgabevarianten
  gegeneinander:
  - **C1, Bi-Arc-Tori** nach Rossignac (PCC): die Spine durch G1-Bögen
    ersetzen, der Blend wird eine Kette **exakter Tori und Zylinder**, die
    nur approximativ an den Stützflächen anliegen. Passt ins heutige
    Ergebnisformat, in den Boolean und in STEP.
  - **C2, rationale B-Spline** wie monstertruck (Dahl-Formen, wo exakt
    möglich). Braucht eine Formaterweiterung (B-Spline-Fläche, Serializer,
    Oracle-Pfad), bevor der Bake-off sie bewerten kann.
  Jede Fläche trägt ihre Toleranz; der Harness bewertet sie mit
  `pass-approx`, nie `pass`.
- **Deckt ab (gegen den Corpus):** ehrlich gesagt heute wenig. Die einzigen
  nicht-analytischen Paare im Corpus sind die B-Spline-Beinwurzeln
  (2 Familien), und die kann wonky noch nicht bauen (keine B-Spline-Kurven).
  Schräge Plane/Zylinder und gekreuzte Zylinder kommen im gemessenen Corpus
  **nicht** vor. Der Wert von C liegt woanders:
  - **Gegenprobe für A und B**: Auf den analytischen Fällen muss C gegen den
    exakten Zylinder/Torus konvergieren. Das ist ein unabhängiges Oracle, wie
    exact-plane für den Boolean.
  - **Nächste Stufe**, sobald schräge Löcher, Bosse auf Platten und
    Spline-Profile gebaut werden können; das kommt mit dem Hybrid-Boolean.
  - **Smooth Overflow** über gekrümmte Nachbarflächen (Parasolid-Default)
    braucht genau diesen Solver.
- **Risiken:**
  - Keine Eingaben: wonky baut heute weder ein schräges Durchgangsloch noch
    einen schräg abgeschnittenen Zylinder (MEASURED,
    `tmp/fillet/landscape/probe-oblique.mjs`: "through holes need a tool axis
    perpendicular to exactly two faces" bzw. "general trimmed-face booleans
    are not implemented"). Fixtures müssen also als B-Rep-Jobs von Hand oder
    aus dem recover-Prototyp kommen; das Format kann Ellipsen.
  - Bi-Arc-Tori sind an den Springs nur G1 innerhalb der Toleranz; der
    Validator lockert die Springprüfung neben Approximationen auf 1e-3 rad.
  - Newton nahe Tangentialität und degenerierten Normalen (OCCT #1495).
  - Toleranzausweis muss zertifiziert sein, nicht geschätzt.
- **Größe:** 2,5 bis 4k Bend-Zeilen (Solver etwa 0,4k, Fit 0,8k,
  Querschnitts- und Kettenlogik, C1-Bi-Arc etwa 0,8k), plus bei C2 eine
  Formaterweiterung im JS-Harness (INFERRED; implementations.md P5 1,5 bis
  2,5k für Walker plus Fit).

### 5.4 D (optional, klein): `fillet-morph` (morphologisches Runden plus recover)

- **Neue Idee**, aufgebaut auf Rossignacs Definition (DOCUMENTED): Runden
  konvexer Kanten ist `R_r(S) = F_r(S ⊖ r)`, also erst um r schrumpfen, dann
  wachsen (Opening); konkave Kanten entsprechend per Closing. Die
  sdf-Maschinerie des Boolean-Bake-offs berechnet das Feld; recover baut den
  exakten Körper, wobei die Blendträger aus der Leiter kommen (Tags für
  Zylinder/Torus/Kugel an Stellen, wo das Feld vom Kugelmittelpunkt-Set
  bestimmt wird). Auf ausgewählte Kanten beschränkt über eine
  Nachbarschaftsmaske: `S − (Maske ∩ (S − R_r(S)))`.
- **Wozu:** Die Rolling-Ball-Definition gibt für jeden harten Fall **eine
  kernel-unabhängige Antwort**: Full Round, Flächenverbrauch, Kugelecken
  und Horntorus fallen von selbst heraus (INFERRED aus der Definition). Für die `either`-Fälle, bei denen
  OCCT scheitert und Onshape nicht geprobt ist, wäre das die fehlende
  Referenz, gegen die B und C verglichen werden können.
- **Deckt ab:** kein Produktionsziel; Referenz für die hard-Gruppe.
- **Risiken (hoch):** Der Boolean-Judge hat gemessen, dass sdf Wände, Platten
  und Schlitze unterhalb der Zellgröße verliert oder schließt. Deine Teile
  haben 0,42-mm-Fasen und 0,05-mm-Streifen; das verlangt sehr feine,
  lokale Gitter. Die Masken-Beschränkung ist nicht dieselbe Semantik wie
  Parasolids Overflow. Die Zuordnung der Blendträger für recover ist neu.
- **Größe:** 1 bis 2k Bend-Zeilen (INFERRED). Nur machen, wenn Budget übrig
  ist; sonst bleiben die hard-Fälle `unverified` oder brauchen Onshape-Probes.

### 5.5 Was bewusst kein Kandidat ist

- **Port von OCCT ChFi3d Walking + Plate**: 65k Zeilen, LGPL, die
  Fehlerquelle. Nur KPart-Ideen wandern in A.
- **Setback-n-Eck-Patches**: 0 Nutzungen, Patent bis 2027-12-17.
- **2D-Profil-Rundung** (CGAL, OCCT ChFi2d, BOSL2): wertvoll und billig
  (0,3 bis 0,6k), aber kein Kanten-Fillet. Der Spezialfall "Kante parallel
  zur Extrusionsrichtung, beide Kappen senkrecht" ist in A als 2D-Solve schon
  drin.
- **SDF-smooth-min und Mesh-Bevel**: falsche Semantik bzw. Geometrieverlust.

### 5.6 Erwartetes Ergebnis (INFERRED, vom Bake-off zu prüfen)

A wird den Normalfall gewinnen: exakt, schnell, keine Tangentialitätsprobleme,
weil die Springs gesetzt und nicht gesucht werden. B ist die natürliche
Ergänzung für Overflow, Kerben und Interferenz, sobald der Hybrid deklarierte
Tangentialität kann. Der Hybrid aus theory §13.4 wäre dann: Surgery, wenn alle
Kontakte auf ihren Flächen bleiben und die Kappen einfach sind; Boolean nur
für Overflow, Kerbe und Interferenz; die globale Interferenzprüfung immer.
C wird Opt-in-Stufe für nicht-analytische Paare und Gegenprobe. Ob B
tatsächlich trägt, ist die eigentliche offene Frage des Bake-offs.

## 6. Wie der Vergleich abläuft

### 6.1 Der Harness (MEASURED, harness.md)

- **70 Fälle** in `fixtures/fillet/cases.json`, sortiert nach dem
  Corpus-Ranking: 40 analytischer Kern, 12 echte Konfigurationen aus deinem
  Corpus, 18 bekannte harte Fälle; 55 Fillets, 15 Fasen. Erwartung: 52 `ok`,
  4 `must-refuse`, 14 `either` (Overflow, Full Round, überlappende Blends,
  gemischte Konvexität, tangentiale Kanten, `tangentPropagation: false`,
  konkaver Wurzelzug um einen Boss).
- **Jede Eingabe ist ein echter wonky-B-Rep**, gebaut aus einem
  FeatureScript-Snippet über `src/index.mjs build()`. Alle 70 bauen in 13 s,
  byte-identisch reproduzierbar. Konvexität und Winkel jeder Kante sind gegen
  die Fallbeschreibung geprüft.
- **57 geschlossene Volumenformeln** (INFERRED Herleitung, MEASURED
  Übereinstimmung mit OCCT ≤ 1,6e-9 relativ): Spandrels, Pappus für Tori,
  Kugeln und Kegel, eine neue Umrissformel für Prismenkanten
  (`A − P·w + K·w²`), Steiner für alle Würfelkanten, Gehrungen, Eckfase.
- **Validator:** Topologie (geschlossene orientierte 2-Mannigfaltigkeit,
  Euler), Geometrie (alles auf Kurven und Flächen innerhalb 1e-6 mm), exakte
  Flächentypen oder ausgewiesene Toleranz ≤ 0,01 mm, Radius auf 1e-7 mm, G1
  an jedem Spring auf 1e-6 rad, Volumen und Fläche gegen geschlossene Form und
  OCCT, No-op-Erkennung. Selbsttest 15/15, OCCT-Replay 53/53 gültig.
- **Runner:** js, cpu1, cpuN, metal; byte-Vergleich der Targets, Metal-Nachweis
  über den Pass-Zähler. Der `null`-Prototyp läuft durch (1 `declined`,
  2 `expected-refusal`, Targets identisch).

### 6.2 Urteile und Bewertung

Die Urteile pro Fall stehen fest (`pass`, `pass-approx`, `expected-refusal`,
`declined`, `wrong`, `invalid`, `no-op`, `mismatch`, `unverified`, ...). Für
den Vergleich der Prototypen schlage ich diese Rangfolge vor (INFERRED, analog
zum Boolean-Judge):

1. **Falsche Antworten zuerst.** `wrong`, `invalid`, `no-op` und Mismatch
   zwischen Targets sind K.-o.-Kriterien. Ein Prototyp, der einmal still
   falsch liegt, ist schlechter als einer, der zehnmal ablehnt ("decline,
   never wrong").
2. **Abdeckung nach Corpus-Gewicht.** `pass` auf den 52 `ok`-Fällen,
   gewichtet mit dem Familien-Rang der Konfiguration (Rang 1 und 2 zählen
   mehr als Rang 19).
3. **Harte Fälle:** ein gültiger Körper oder eine präzise typisierte Ablehnung
   (richtige Klasse, z. B. `face-consumed` statt `not-implemented`).
4. **Exakt vor approximativ:** `pass` vor `pass-approx`.
5. **Ablehnungsqualität:** meldet der Prototyp den größten machbaren Radius?
6. **Laufzeit** cpu1 und cpuN (nur als Median, der Rechner ist geteilt), dann
   Bend-Größe.

### 6.3 Was vor Teil 2 noch in den Harness muss (INFERRED)

- **Grenz-Sweeps**: r über ρ (Torus → Kugel → Fehler), über die Flächenbreite
  (passt → aufgefressen → Overflow), über die Fasen-Grenze `d2/d1 = |cos φ|`.
  Der Wechsel zum benannten Fehler muss genau dort passieren (theory §14).
- **Metamorphe Tests**: Starrkörperbewegung, Skalierung, Spiegelung,
  1e-13-Störungen ändern das Urteil nicht oder führen zu typisierter
  Ablehnung.
- **Gegenseitige Verifier-Runde** wie beim Boolean: jedes Team schreibt
  Adversarial-Fälle für die anderen.
- **Nicht-analytische Fixtures für C** (von Hand oder aus recover), und
  Fixtures aus den gespeicherten Vor-Blend-Körpern deines Corpus
  (`tmp/fillet/b3d/brep`, `tmp/fillet/fsocct-out/brep`), inklusive der echten
  r22-Datei.
- **Onshape-Probes** über die Bridge für die offenen Semantikfragen, wenn du
  sie freigibst (§7).

### 6.4 Grenzen der Oracles (MEASURED)

- **OCCT schafft nur 49 von 70** (4 der 21 übrigen sind `must-refuse` und
  zu Recht abgelehnt). Es scheitert an `ch-cone-rim-0.42` (ein
  gewöhnlicher Fall mit geschlossener Form), an 5 `either`-Fällen mit
  geschlossener Form (178,9°-Grat, Tangentialkante, zwei Full Rounds,
  r = Flächenbreite) und an allen Overflow-Fällen.
- **OCCT liegt falsch** beim konkaven Wurzelzug um einen Boss (BRepCheck-ungültig,
  4 B-Spline-Flächen) und ignoriert `tangentPropagation: false`.
- **OCCT hat eine andere Semantik** bei Fasen: In-Support-Abstand bei 60°,
  Eckdreieck bei der 3-Kanten-Fase (d³/12 mehr). Beides ist als akzeptierte
  Alternative hinterlegt, weil Onshape nicht geprobt ist.
- **Onshape wurde nicht geprobt.** Die `either`-Kategorie ist die ehrliche
  Antwort auf Semantik, die wir nicht kennen.
- **Eingaben**: Bosse auf Platten, Sacklöcher, B-Spline-Spines und
  Zylinder/Zylinder kann wonky heute nicht bauen. Diese Konfigurationen fehlen
  im Harness.
- **Volumen und Fläche** eines Ergebnisses misst OCCT auf der exportierten
  STEP-Datei. JS rechnet kein unabhängiges Volumen für getrimmte Tori.
- **Die Springregel** stuft Übergänge unter 0,1 rad als Spring ein. Ein
  beabsichtigter 0,05-rad-Knick würde fälschlich markiert; kein Fall hat einen.

## 7. Welche Entscheidungen du treffen solltest

Jeweils mit meiner Empfehlung.

1. **Umfang der ersten Version.** Nur die analytische Stufe (Plane/Plane-Linien
   jeden Winkels, Loch- und Bossränder, Fasen als Plane und Cone, Kappen,
   Gehrungen, G1-Ketten, Kugelecke, Full Round), alles andere typisiert
   abgelehnt? *Empfehlung: ja.* Deckt 23 bis 30 von 39 Familien.
2. **Priorität gegenüber den eigentlichen Blockern.** Heute erreicht keine
   FS-Einheit einen Fillet (`qGeometry`, importierte Kurven, `newSketch`,
   Boolean-Admission gehen vor). *Empfehlung:* Teil 2 parallel laufen lassen,
   aber nicht vor diese Blocker ziehen.
3. **Torus und Kugel in Produktion** (`kernel/analytic.bend`, STEP,
   Tessellierung, Klassifikation, Boolean). Voraussetzung für Randfillets und
   Kugelecken und vermutlich größer als der Fillet selbst. *Empfehlung:* mit
   der Integration des Hybrid-Booleans koppeln, der sie für recover ohnehin
   braucht.
4. **Toleranzbehaftete Blends (B-Spline oder Bi-Arc-Tori) überhaupt
   zulassen?** Optionen: nie (ablehnen); nur mit explizitem Opt-in und
   ausgewiesener Toleranz; standardmäßig mit Label. *Empfehlung: Opt-in.*
   Aber Achtung: Wo Onshape Erfolg hat und wonky ablehnt, laufen deine
   `try`-Stellen still in den Fallback. Wenn du Parität willst, muss der
   Opt-in pro Modell oder global setzbar sein.
5. **G1 oder G2.** Der Corpus nutzt nur kreisförmige Querschnitte.
   *Empfehlung: nur G1 kreisförmig* in Version 1; Conic/G2 erst mit
   Extrusion- und Revolutionsflächentyp.
6. **Fasen-Definition bei Winkeln ≠ 90°**: Face-Offset (Onshape/Parasolid)
   oder In-Support (OCCT). *Empfehlung: Face-Offset*, per Onshape-Probe
   bestätigen. Dazu: Eckfase als Punkt oder als Dreieck?
7. **Full Round und aufgefressene Flächen**: exakt bauen (besser als OCCT)
   oder ablehnen? Onshapes Verhalten ist unbekannt, und wegen der
   `try`-Fallbacks zählt Parität. *Empfehlung:* bauen, sobald eine Probe zeigt,
   dass Onshape es auch tut.
8. **Onshape-Probes freigeben** (onshape-bridge): Overflow-Defaults an deinen
   echten Overflow-Stellen, Fasen-Definition, Eckfase, Horntorus, Full Round,
   gemischte Ecke von `project-component-4c7a33fe`. Etwa ein Dutzend kleine Dokumente.
   *Empfehlung: ja*, sonst bleiben 14 Fälle `either`.
9. **Overflow-Semantik**: Ist Notch (Blend bleibt, wird getrimmt) genug, oder
   brauchst du Smooth (Weiterrollen) wie Parasolid? *Empfehlung:* Notch
   zuerst; Smooth erst, wenn eine Probe zeigt, dass deine Teile es nutzen.
10. **Deklarierte Tangentialität im Hybrid-Boolean** (für Kandidat B): darf
    das Boolean-Team eine Schnittstelle dafür in Stufe [C] und recover
    bauen? Ohne sie kann B nicht antreten.
11. **Kandidaten C und D**: C mit Fixtures von Hand oder aus recover
    antreten lassen, oder bis zum Hybrid-Boolean verschieben? D nur als
    kleines Oracle oder gar nicht? *Empfehlung:* C antreten lassen (Gegenprobe
    lohnt sich), D nur bei übrigem Budget.
12. **Stilles Toleranzwachstum** (Parasolid-Default): *Empfehlung: nie*;
    stattdessen die nötige Toleranz melden. Bestätigen.
13. **Mehrkanten-Reihenfolge**: deterministisch und dokumentiert (gleiche
    Konvexität zusammen, dann eine feste Konvex/Konkav-Folge, dann groß vor
    klein), im Ergebnis aufgezeichnet. *Empfehlung: ja*, keine
    Reihenfolgesuche.
14. **Seam-Kanten in der Auswahl** still ignorieren (Onshape hat keine)?
    *Empfehlung: ja*, mit Vermerk im Ergebnis.
15. **Größter-machbarer-Radius als Abfrage** (neue Hilfsfunktion in FS und
    build123d-Frontend, ersetzt deine Probier-Fallbacks). Das ist eine
    Spracherweiterung und damit deine Entscheidung. *Empfehlung:* als
    wonky-Erweiterung anbieten, die Standard-API unverändert lassen.

## 8. Dateien

- Detailkapitel: `docs/fillet/{theory,implementations,commercial,corpus,harness}.md`.
- Corpus-Ergebnis: `out/fillet/corpus.json`, `tmp/fillet/primary-calls.json`.
- Harness: `fixtures/fillet/{cases.json,reference.json,jobs/}`,
  `scripts/fillet/*`, Berichte in `out/fillet/{null,oracle-occt}/`.
- Theorie-Checks: `tmp/fillet/theory-checks.mjs`; OCCT-Probe:
  `tmp/fillet/occt-probe.py`.
- Diese Landschaft: Probe `tmp/fillet/landscape/probe-oblique.mjs`, Worklog
  local development evidence.
