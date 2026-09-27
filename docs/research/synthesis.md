# Synthese: was die Recherche für wonky bedeutet

Stand 2026-09-24. Für Marc, auf Deutsch; Fachbegriffe bleiben englisch.
Grundlage sind die 13 Kapitel, 4 Addenda und 213 Quellennotizen dieser
Wissensbasis ([README.md](README.md)). Diese Synthese wiederholt die Kapitel
nicht, sie verdichtet sie. Jede Aussage verweist auf ein Kapitel oder eine
Notiz; dort stehen die Primärquellen.

**Labels.**

- **DOKUMENTIERT**: aus einer Primärquelle (Code, Paper, Handbuch, Patent,
  Issue), in der verlinkten Notiz belegt.
- **GEMESSEN**: ein wonky-Lauf oder eine Zählung über deinen Korpus, belegt in
  einem wonky-Dokument.
- **ABGELEITET**: meine bzw. die Schlussfolgerung des Kapitels aus Belegen.
- **HÖRENSAGEN**: Sekundärquelle, Forum, Katalogeintrag ohne Tiefenlektüre.

**Eine Korrektur vorweg.** Der Auftrag spricht von einem laufenden Boolean
Bake-off. Der ist entschieden: Judge-Runde 2 hat am 2026-09-23 corefine
(getaggter Mesh-Boolean im Manifold-Stil, F32x2) plus recover (exakte
B-rep-Rückgewinnung aus den Tags) gewählt; exact-plane bleibt
Differential-Orakel, sdf ist kein Boolean-Kandidat mehr (DOKUMENTIERT,
[../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1, §9). Plan-Schritte
1-4 sind committet, 5 und 7 erledigt; Schritt 7 macht den Hybrid zum letzten
Arm von `src/boolean.mjs`. Was jetzt läuft, ist der **Fillet**-Bake-off
(Kandidaten A-D, [../fillet.md](../fillet.md) §5). Abschnitt 4 bewertet die
vier Boolean-Ansätze trotzdem gegen die Literatur, weil die Befunde für die
offenen Plan-Schritte 6 und 8-13 zählen.

---

## 1. Kurzfassung

1. **Die Architektur ist richtig, und sie ist neu.** Kein offener oder
   kommerzieller Kernel gewinnt eine exakte analytische B-rep aus einem
   getaggten Mesh-Boolean zurück (ABGELEITET aus Abwesenheit in den
   gesichteten Quellen; für geschlossene Kernel wie Parasolid, CGM oder
   ShapeManager nicht prüfbar). Der nächste Verwandte, Yang et al. 2025
   (TOG), gibt Schnittkurven als optimierte Polylinien aus und garantiert
   Korrektheit nur, solange keine *mehreren* kleinen Schleifen auftreten,
   deren Größe und Abstand beide unter der Mesh-Auflösung liegen (einzelne
   kleine Schleifen und Tangentenpunkte behandelt es); wonky nimmt jede Kurve aus den beiden
   Trägerflächen und verweigert benannt (DOKUMENTIERT,
   [brep-booleans-ssi.md](brep-booleans-ssi.md) §1.4,
   [Yang-Notiz](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md)).
   Parasolid v39 und zwei Autodesk-Patente zeigen, dass „Mesh und exakte
   Geometrie gemeinsam" der kommerzielle Trend ist, aber mit anderem
   Mechanismus (DOKUMENTIERT, [commercial-kernels.md](commercial-kernels.md)
   §3.9).
2. **Kein kommerzieller Kernel rechnet exakt.** Robustheit kommt dort aus
   festem Weltwürfel plus Auflösung (Parasolid 1e-8 in 1e3, ACIS 1e-6 in 1e4),
   toleranten Entitäten, schweren Checkern, Retries und Rollback. Mindestens
   fünf Mechanismen lassen Toleranzen still wachsen, bis eine Operation
   gelingt (Jackson, ACIS-Fuzz, Parasolid `set_tol`, Zoo-Patent, Autodesk
   ξ-Verdopplung). Genau die Zahl, die sie dabei ausrechnen, ist die „nötige
   Toleranz", die wonky laut Entscheidung 10 melden soll (DOKUMENTIERT,
   [commercial-kernels.md](commercial-kernels.md) §4.1).
3. **Der häufigste Fehler aller Systeme ist der stille Erfolg.** OCCT #1496
   (leeres Common mit `IsDone()==true`), #1543 (Cut entfernt nichts, je nach
   Saumlage), #1371 (Fillet meldet Erfolg, Körper selbstdurchdringend) sind
   allerdings untriagierte Nutzerberichte (Label „0. New“, keine
   Maintainer-Antwort; #1496 hat der Melder nach 8 Minuten selbst geschlossen),
   also Einzelbelege, keine bestätigten Fehler; ACIS
   „pocket lost", remus/BREP.io/CADmium geben die Eingabe unverändert zurück,
   LLM-Evaluatoren werten Abstürze als 0.0 (DOKUMENTIERT,
   [oss-brep-kernels.md](oss-brep-kernels.md) §4.1,
   [fringe-kernels.md](fringe-kernels.md) §4.1,
   [llm-code-cad.md](llm-code-cad.md) §4.1). wonkys Regel „explizit scheitern"
   ist damit das wichtigste Unterscheidungsmerkmal, nicht Bürokratie.
4. **Tangenz und Koinzidenz entscheidet niemand mit Zertifikat.** OCCT nutzt
   ein 1e-8-Totband, SolveSpace `DOTP_TOL = 1e-5`, GoTools `EPS = 1e-5`, Truck
   erklärt koinzidente Flächen für unsupported, ESOLID verweigert
   Degeneriertes. Für Ebene, Zylinder und Kegel werden OCCTs
   Entscheidungsbäume zu exakten Vorzeichentests vom Grad ≤ 4 (ABGELEITET,
   [oss-brep-kernels.md](oss-brep-kernels.md) §1.4, §3.1). Das ist wonkys
   klarste Chance.
5. **wonkys Unresolved-Menge ist ein Katalog fehlender Kurven- und
   Vertex-Typen, kein Topologieproblem.** Hex-Mutter (Hyperbel, Parabel,
   tangentialer Vertex), Steinmetz (zwei Ellipsen mit singulären Ecken aus
   dem Büschel), Pipe-Tee und Querbohrungen (Raumquartiken), Torusschnitte.
   Die ersten beiden sind mit Miller-Goldman, Shene-Johnstone und dem
   Quadrikenbüschel geschlossen lösbar (ABGELEITET,
   [brep-booleans-ssi.md](brep-booleans-ssi.md) §1.5, P1-P5).
6. **Exakt ist in CAD vor allem ein Null-Beweiser.** Im hex-nut-Lauf von
   exact-plane gingen 7,4 % der Prädikate in den exakten Pfad, davon 99,98 %
   exakte Nullen aus koplanarer und berührender Eingabe (GEMESSEN,
   [robust-numerics.md](robust-numerics.md) Takeaways,
   [../proto-exact-plane.md](../proto-exact-plane.md)). Strukturelle
   Nullbeweise und Provenienz bringen mehr als schnellere Bignums.
7. **F32x2 ist Filter- und Auswertungstyp, nie exakter Typ.** Die
   publizierten Double-Word-Algorithmen garantieren etwa 44-46 Bit pro
   Operation im F32-Exponentenbereich; wonkys `R.add` ist die „sloppy"
   Variante ohne Schranke bei Auslöschung, und corefines „etwa 2^-44" ist
   gesetzt, nicht hergeleitet (DOKUMENTIERT,
   [robust-numerics.md](robust-numerics.md) §3.2,
   [mesh-booleans.md](mesh-booleans.md) Takeaways). Die meisten Bits eines
   exakten Budgets kommen aus dem Exponentenbereich, nicht aus der Mantisse.
8. **Metal hilft dem Boolean nicht.** Fünf unabhängige Messungen stimmen
   überein: die GPU gewinnt nur bei uniformer, flacher Arbeit mit mindestens
   4^7 Blättern; wonkys Bake-off misst Metal für jeden Prototyp langsamer als
   18 CPU-Threads (corefine 2,40x). Manifold hat CUDA 2023 aufgegeben
   (#524); einen Grund nennt das Issue nicht, ein Maintainer schrieb vorher,
   die CUDA-Leistung sei „not very good“ (#491), und der Blog von 2022 maß
   insgesamt nur Faktor 2 (ABGELEITET: derselbe Grund). Der echte Engpass ist die CPU-Skalierung (corefine 1,46x, recover
   1,10x von 1 auf 18 Threads) wegen sequentieller Stufen (GEMESSEN und
   DOKUMENTIERT, [parallel-gpu-geometry.md](parallel-gpu-geometry.md) §1.2).
9. **Determinismus ist wonkys stärkster Vorsprung.** Parasolid dokumentiert,
   dass unter SMP Ergebnisreihenfolge, Tag-Vererbung und Fehlerreihenfolge
   variieren, und liefert einen Shuffle-Schalter, damit Anwendungen damit
   leben können. wonky ist byte-identisch auf JS, cpu1, cpu18 und Metal über
   254 Fälle (DOKUMENTIERT und GEMESSEN,
   [commercial-kernels.md](commercial-kernels.md) §3.8).
10. **Namen müssen aus der Operationshistorie kommen, nicht aus Geometrie.**
    Der tragfähige Vertrag ist OCCTs Modified/Generated/Deleted-Algebra plus
    Split/Merge als Mengen. FreeCAD scheitert daran, Historie in
    Namensstrings zu falten (Zufallssuffixe, gekürzte Vorfahren). Der Hybrid
    kennt die Quellflächen jeder Ergebnisfläche schon in JS
    (`attachResultMesh`), aber `kernel/identity.bend` markiert jedes
    Boolean-Ergebnis als revisionslokal (DOKUMENTIERT,
    [topology-identity-data-structures.md](topology-identity-data-structures.md)
    Takeaways).
11. **Fillets: das Onshape-Verhalten ist Parasolid, und Parität zählt.** 41
    Blend-Aufrufe deines Korpus stecken in `try` mit kleinerem Ersatzradius;
    wo wonky verweigert und Onshape gelingt, ändert sich das Teil still.
    Eine Onshape-Probe hat die Fasen-Regel aus vier Notizen umgeworfen
    (Abstand entlang der Stützfläche). Das häufigste Offset im Korpus ist
    kein Shell, sondern `opOffsetFace` +0,15 mm vor einem Cut (51 Aufrufe)
    (GEMESSEN, [fillets-blends-offsets.md](fillets-blends-offsets.md) §1.4,
    §1.8).
12. **Testen: wonky ist weiter als die Literatur, bis auf eine Lücke.**
    Exakter Validator, zwei Orakel plus Arbiter mit geschlossenen Formen,
    Byte-Identität, 216 adversariale Fälle, R20-Gate. Es fehlt metamorphes
    Testen: Achsenpermutationen und 2^k-Skalierung sind auf dem F32x2-Draht
    exakt, also ohne Orakelrauschen prüfbar (DOKUMENTIERT,
    [testing-validation.md](testing-validation.md) §1.3, P1). Das R20-Gate
    ist zehn Größenordnungen lockerer als die Evidenz (GEMESSEN, ebd. §4.2).
13. **Für LLMs zählen Status plus Evidenz, nie eine nackte Zahl.** Ein
    einzelnes „conforms: true" ließ Agenten zu früh aufhören; Zahlen schlagen
    Renderings bei messbaren Fragen; der am klarsten gemessene Modellfehler
    ist die falsche Arbeitsebene (DOKUMENTIERT,
    [llm-code-cad.md](llm-code-cad.md) §4.1).
14. **FDM: der Hebel ist, die Intention als Geometrie zu besitzen.**
    Slicer raten Kreise aus Dreiecken zurück (Orca, 0,01 mm Marge),
    PrusaSlicer tesselliert STEP selbst neu und castet auf float. Ein
    zertifiziertes, wasserdichtes Druckmesh und exakte Prüfungen
    (Überhangbänder, Zwei-Anker-Brücken, Wandstärke als Flächenpaarabstand)
    gibt es nirgends offen (DOKUMENTIERT und ABGELEITET,
    [fdm-geometry.md](fdm-geometry.md) §1.1, §1.4).
15. **Nachfrage aus dem Korpus, die bisher keine Recherche hatte**, ist jetzt
    in Addenda abgedeckt: Skizzenregionen (`qSketchRegion` in 486 Dateien),
    Transformationen (`opTransform` in 304), Lofts (83 blockierte Einheiten)
    und `skText` (174 Dateien; Onshapes Schrift ist Open Sans v1.10 unter
    Apache-2.0, Layout exakt rekonstruiert) (GEMESSEN,
    [addenda/](addenda/)).

---

## 2. Wie die guten Kernels es machen

Die Hersteller veröffentlichen **Verträge, keine Algorithmen**:
Stufenlisten, Optionen, Fehler-Enums, Präzisionszahlen. Flächenklassifikation,
Koinzidenzbehandlung und Blend-Konstruktion stehen in keinem öffentlichen
Dokument (DOKUMENTIERT durch Abwesenheit,
[commercial-kernels.md](commercial-kernels.md) §1.1, §1.4). OCCT ist die
Ausnahme, weil der Code offen ist. Die Beleglage ist sehr ungleich:
Parasolid und ACIS sind über Handbücher (inoffizielle Spiegel) gut belegt,
CGM, ShapeManager und C3D fast nur über Kataloge.

### 2.1 Überblick

| | Parasolid (Siemens) | ACIS (Spatial) / ShapeManager (Autodesk) | CGM (Dassault) | OCCT (offen, LGPL) | C3D (C3D Labs) |
|---|---|---|---|---|---|
| Nutzer | NX, Solid Edge, SolidWorks, **Onshape**, Plasticity | ACIS: viele; ShapeManager: Inventor, Fusion, AutoCAD (Fork von ACIS 7.0, 2001) | CATIA V5, 3DEXPERIENCE | FreeCAD, CadQuery, build123d, Dune 3D | ASCON-Umfeld (Russland), früher Plasticity |
| Beleglage | Handbuch V35, XT-Format, PK-Referenz, Blend-Kapitel v12, Release-Blogs bis v39 | R17-Artikel (Booleans, Checker, Blending, Toleranzen), Spatial-Blogs; ShapeManager: nichts | ein Spatial-Blog, sonst Marketing | Quellcode, Spezifikationen, Issue-Tracker | Hersteller-Blog, eingefrorene Plasticity-Bindings |
| Label | DOKUMENTIERT | DOKUMENTIERT (ACIS), HÖRENSAGEN (ShapeManager) | überwiegend HÖRENSAGEN | DOKUMENTIERT | HÖRENSAGEN |

Quellen: [commercial-kernels.md](commercial-kernels.md) §1.1, §2;
[oss-brep-kernels.md](oss-brep-kernels.md) §1.1-§1.2.

### 2.2 Datenstrukturen

- **Parasolid: Toleranzen an der Topologie, Geometrie exakt.** Ein
  Vertex trägt eine Toleranzkugel, eine tolerante Kante hat keine 3D-Kurve,
  nur je eine pcurve pro Nachbarfläche (XT: Null-Kurve plus Fin-SP-Kurven);
  monotone Regel Vertex ≥ Kante ≥ Fläche. Später kam optionale „nominal
  geometry" in der Toleranzröhre dazu (DOKUMENTIERT,
  [Jackson 1995](sources/jackson-boundary-representation-modelling-with-local-toleran.md),
  [Parasolid V35 Overview](sources/overview-of-parasolid-v35-july-2022.md)
  §3.6).
- **Parasolid: exakte prozedurale Schnittkurve.** Zwei Flächen, eine
  geordnete Stützpunkt-„Chart" mit uv auf beiden Flächen, Tangenten,
  Parametern und Fehlerangaben, Terminatoren an den Enden; ausgewertet wird
  durch Schnitt beider Flächen mit der Ebene senkrecht zur Sehne. Die Kurve ist
  exakt, die Chart nur Startwert; der Sehnenfehler ist eine Schätzung, kein
  Zertifikat (DOKUMENTIERT,
  [XT-Format V35](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md)).
- **Parasolid: gemischte Körper.** Facet- und klassische Geometrie in einem
  Körper (Convergent Modeling), v39 mit Mesh-Euler-Operationen und
  bidirektionalen Mesh/B-rep-Zuordnungen (DOKUMENTIERT,
  [V35](sources/overview-of-parasolid-v35-july-2022.md) Kap. 8,
  [v39-Blog](sources/siemens-blog-parasolid-v39-0-release.md)).
- **ACIS: Schnittgraph als explizites Artefakt.** Disjunkte Drähte,
  Coedges pro Fläche mit Richtung, degenerierte Punktkontakt-Kanten und
  Provenienz-Attribute zwischen den Boolean-Stufen (DOKUMENTIERT,
  [ACIS Booleans](sources/acis-r17-user-guide-booleans-technical-article.md)).
- **OCCT: `TopoDS` mit geteilten `TShape`s, Location und Orientierung;
  jede Entität trägt eine Toleranz.** Das BRep-Format definiert Vertex-,
  Kanten- und Flächenabweichung exakt, dazu SameParameter/SameRange,
  Saumkanten, degenerierte Kanten und Regularität (DOKUMENTIERT,
  [BRep-Format](sources/occt-brep-format-specification-tolerant-modeling-semantics.md),
  [TopoDS-Guide](sources/occt-modeling-data-guide-topods-tshape-location-orientation.md)).
  Die Disziplin drumherum versagt: Toleranzen dürfen nur wachsen, ohne
  Deckel, und Checks sampeln (DOKUMENTIERT,
  [oss-brep-kernels.md](oss-brep-kernels.md) §3.8).
- **CGM, ShapeManager, C3D:** keine technischen Dokumente zu
  Datenstrukturen gefunden (HÖRENSAGEN,
  [commercial-kernels.md](commercial-kernels.md) §1.1, §1.4).

### 2.3 Toleranzmodell

| System | lineare Auflösung | Bereich | weitere Konstanten | Label |
|---|---|---|---|---|
| Parasolid | 1e-8 m | Würfel 1e3 m (Verhältnis 1e11) | Winkel 1e-11; „accurate" Entitäten halbe Sitzungspräzision | DOKUMENTIERT ([V35](sources/overview-of-parasolid-v35-july-2022.md) §3.6) |
| ACIS R17 | `SPAresabs` 1e-6 | 1e4 | `SPAresnor` 1e-10, `SPAresfit` 1e-3, „mindestens eine Dekade Schutzabstand" | DOKUMENTIERT ([Kapitel §3.1](commercial-kernels.md)) |
| Onshape FS std | `zeroLength` 1e-8 m = 1e-5 mm | | `zeroAngle` 1e-11, `booleanDefaultTolerance` 1e-5 m = 0,01 mm | DOKUMENTIERT ([FS std](sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md)) |
| OCCT | `Confusion` 1e-7, `Angular` 1e-12 | unbegrenzt, Toleranzen wachsen | Fuzzy-Wert, `RepeatIntersection` | DOKUMENTIERT ([GFA](sources/occt-boolean-operations-specification-general-fuse-algorithm.md)) |
| wonky | Kontaktgrenze 1e-7 mm; Ebenenvereinigung 2^-44·scale | Exporter-Grenze 1e3-1e5 mm | Import-Vertex 0,0003 mm, Budget 0,01 mm | DOKUMENTIERT ([../proto-recover.md](../proto-recover.md)) |

- **Garantie:** keine formale. Die tolerante Modellierung garantiert nur
  strukturelle Gültigkeit, weil Toleranzen wachsen; Jackson selbst schreibt,
  dass Eindämmung „not always achievable" ist (DOKUMENTIERT,
  [Jackson](sources/jackson-boundary-representation-modelling-with-local-toleran.md)
  §7.3).
- **Stilles Wachstum ist Standard:** ACIS darf den Fuzz ignorieren, „wenn
  erzwungene Koinzidenz schlechte Geometrie erzeugen würde"; Parasolid-Blends
  wachsen per Default bis 1e-5 m; OCCT wächst `Tol(V) = max(Tol(V), D +
  Tol(E))` (DOKUMENTIERT, [commercial-kernels.md](commercial-kernels.md)
  §3.2, [oss-brep-kernels.md](oss-brep-kernels.md) §4.2).
- **Was das für wonky heißt (ABGELEITET):** F32x2 kann Parasolids Auflösung
  mit sieben Größenordnungen Reserve *darstellen*. Das Problem ist, dass wonky
  viel strenger *entscheidet* (2^-44·scale statt 1e-5 mm) und eine echte
  2e-11-mm-Haut behält, die Parasolid verschmelzen würde. FeatureScript-Code,
  der in Onshape funktioniert, kann auf so einer Verschmelzung beruhen. Also
  kein globales Epsilon übernehmen, sondern ein Toleranz-Ledger mit Bezug auf
  `zeroLength` (Backlog B5).

### 2.4 Boolean

| | Parasolid (Jackson 1995 / V35) | ACIS R17 | OCCT GFA | wonky-Hybrid |
|---|---|---|---|---|
| Stufen | imprint → join → select; V35: imprint, divide, remove, fuse | Schnittgraph → imprint → keep/discard → join | pave filler V/V, V/E, E/E, V/F, E/F, F/F, dann Klassifikation | CSG-Schicht → getaggte Tessellierung → Vorzertifikat → corefine → recover |
| Entscheidungsordnung | nach Dimension, niedrigere Entscheidungen werden wiederverwendet | nicht dokumentiert | nach Interferenzklasse, verschachtelte Re-Intersection | symbolische Perturbation in corefine; Kurven aus Trägern in recover |
| Koinzidenz | Summe der Toleranzen, „matched regions" vom Aufrufer | Fuzz, Glue | Fuzzy, same-domain faces | exakte Vereinigung innerhalb 2^-44·scale, sonst benannte Verweigerung |
| Garantie | nur globale Booleans „topologisch konsistent" | „löst viele Tangenzprobleme" | keine; Spezifikation listet Fehlerquellen | gemessen: 32/38 Korpusfälle exakt, adversarial falsches `ok` 18 → 3 (die 3 verweigert der Hybrid) |

- **Dieselbe Treiberidee dreimal dokumentiert:** erst V-V, V-E, E-E, V-F,
  E-F, dann F-F; jede Tatsache einmal entscheiden und überall eintragen; eine
  fast tangentiale Kurve nie neu berechnen, wenn eine niedrigere Stufe sie
  schon erklärt hat. Robustheit kommt aus dieser Ordnung, nicht aus exakter
  Arithmetik (DOKUMENTIERT, [brep-booleans-ssi.md](brep-booleans-ssi.md)
  §1.1, §3.1).
- **Bekannte Koinzidenz als Abkürzung:** ACIS-Glue (12,0 s → 3,3 s → 1,5 s
  in einem Beispiel), Parasolid matched regions und lokale Booleans. Die
  Korrektheit wandert zum Aufrufer; ACIS: bei unvollständigen Angaben ist
  das Ergebnis „undefined" (DOKUMENTIERT,
  [ACIS Booleans](sources/acis-r17-user-guide-booleans-technical-article.md)).
  wonky kann dasselbe mit exakter Prüfung jeder Deklaration (Backlog B11).
- **Schnittkurven:** OCCT hält nur Kegelschnitte exakt; Quartiken werden
  200-Punkt-Walking-Lines und dann B-Splines (DOKUMENTIERT,
  [OCCT ImpImp](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md)).
  Parasolid hat die exakte prozedurale Kurve (oben). Zoo sampelt auf der GPU
  und fittet B-Splines; das Verfahren ist patentiert (US 12,229,885 B1, bis
  etwa 2044) (DOKUMENTIERT,
  [Zoo-Notiz](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md)).
- **Checker:** Parasolid und ACIS prüfen kostengeordnet, mit stabilen
  Fehlercodes, Zeugenpunkten und versionierten Prüfungen; beide sagen
  ausdrücklich, dass „keine Fehler" nicht „gültig" heißt (DOKUMENTIERT,
  [PK_BODY_check](sources/parasolid-pk-reference-pk-body-check-states-and-fault-types.md),
  [ACIS Checker](sources/acis-r17-checker-and-intersectors-articles.md)).
  OCCTs `BRepCheck` hat 37 Statuscodes, sampelt aber Kurve-auf-Fläche an 23
  Punkten und hält eine verdrillte Loft für gültig (#1315) (DOKUMENTIERT,
  [BRepCheck](sources/occt-shape-healing-guide-and-brepcheck-validity-checking-and.md)).
- **CGM:** führt die Flächen-Flächen-Schnitte des Booleans multiprozessual
  aus (DOKUMENTIERT nur über den Spatial-Blog,
  [commercial-kernels.md](commercial-kernels.md) §3.8); zum Algorithmus
  selbst nichts. **C3D, ShapeManager:** nichts (HÖRENSAGEN).

### 2.5 Blends (Fillets, Fasen, Offsets)

- **Eine Konstruktion für alles:** beide Stützflächen um r versetzen, die
  Versätze schneiden (Spine), zurückprojizieren (Spring-Kurven), Kreisbogen
  dazwischen. So beschrieben bei Parasolid, ACIS, OCCT ChFiKPart, Kós und
  Choi-Ju (DOKUMENTIERT,
  [fillets-blends-offsets.md](fillets-blends-offsets.md) §1.1).
- **Pipeline überall gleich:** Anfrage als Daten, Ketten bauen und nach
  Konvexität klassifizieren, pro Kante geschlossene Form oder Walking,
  Vertex-Behandlung (Kappen, Gehrungen, Kugelecken, n-seitige Patches),
  anhängen, validieren (DOKUMENTIERT für ACIS, Parasolid, OCCT, remus;
  ebd. §1.3).
- **Parasolid:** Überlauf-Typen (acht Default-Fälle intern/extern ×
  glatt/scharf × gleiche/entgegengesetzte Konvexität), Regeln sind laut Doku
  „rules of thumb", „der einzige garantierte Test eines Blends ist, ihn zu
  FIXen", Toleranzwachstum per Default an (DOKUMENTIERT,
  [Parasolid v12 Blending](sources/parasolid-v12-functional-description-edge-blending-chapters-.md)).
  Onshapes `FILLET_*`-Enums entsprechen Parasolids Fehlerliste fast
  wörtlich (ABGELEITET, stark,
  [FS std](sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md)).
- **ACIS:** Stufenmodell nach Braid, lokale Interferenzprüfung als Default,
  die im dokumentierten Beispiel eine Tasche verliert; Fasen und Fillets
  auf Splines verlieren den oskulierenden Torus-Sonderfall (DOKUMENTIERT,
  [ACIS Blending](sources/acis-blending-documentation-r17-technical-articles-r10-blnd-.md)).
- **OCCT:** geschlossene Formen nur für konstanten Radius, eine Ebene und
  Linien- oder Kreisspine (Zylinder, Torus, Kugel), sonst Walking plus
  B-Spline, ungleiche Radien an Ecken mit Plate-Flächen. Baut 49 von 70
  Fällen in wonkys Harness; Onshape baut 13 von 14 Fällen, von denen OCCT
  10 verweigert (GEMESSEN,
  [OCCT ChFi3d](sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md),
  [fillets-blends-offsets.md](fillets-blends-offsets.md) §1.4, §1.7).
- **Kein Hersteller** veröffentlicht Blend-Konstruktion, Fehlerraten oder
  einen Benchmark; kein Blend-System nutzt exakte Arithmetik (DOKUMENTIERT
  durch Abwesenheit, ebd. §1.6).

### 2.6 Parallelität

- **Parasolid SMP:** höchstens 8 Threads, parallel nur in Teilalgorithmen
  (Flächenprüfung, Face-Face-Clash der Booleans, Faceting, Masseneigenschaften
  u. a.); „nicht linear", Einzelaufrufe teils langsamer, doppelter
  Arbeitsspeicher bei zwei Threads; Ergebnisreihenfolge nicht deterministisch
  (DOKUMENTIERT, [V35](sources/overview-of-parasolid-v35-july-2022.md)
  §17.2.3).
- **ACIS:** Threadsicherheit über thread-lokalen Speicher und getrennte
  History-Streams; Einzelkörper-Faceting etwa 2x auf 6 Threads, viele Körper
  6-7x; ein serielles Redesign des Stitching brachte 10 % ohne Threads
  (DOKUMENTIERT,
  [Spatial-Blog](sources/spatial-blog-seven-years-of-thread-safe-3d-acis-modeler.md)).
- **OCCT:** `BOPTools_Parallel` für E/E, F/F und Split-Faces (DOKUMENTIERT,
  [GFA](sources/occt-boolean-operations-specification-general-fuse-algorithm.md)).
- **Kein Hersteller** dokumentiert parallele topologische Assemblierung oder
  GPU-Nutzung im Boolean; Zoo nutzt die GPU nur zum SSI-Seeding (DOKUMENTIERT,
  [commercial-kernels.md](commercial-kernels.md) §3.8).
- **Für wonky (ABGELEITET):** Die Gewinne liegen dort, wo auch die Hersteller
  sie finden (Flächenpaar-Arbeit, Prüfungen pro Fläche, Faceting pro Körper),
  plus Parallelität über unabhängige Operationen. wonky kann das ohne Locks
  und mit Determinismus.

### 2.7 Was wonky übernehmen kann, was nicht

| übernehmen (als Vertrag, neu hergeleitet) | nicht übernehmen |
|---|---|
| Entscheidungsordnung nach Dimension; jede Tatsache einmal | Toleranzwachstum, Fuzzy-Retry, RepeatIntersection |
| typisierte Fehler mit Entitäten, Zeugenpunkt und stabilen IDs | Fehler als Prosa; „keine Fehler" als „gültig" lesen |
| versionierte Algorithmen und Checks (FS `isAtVersionOrLater`, ACIS `r14_checks`) | unversionierte Verhaltensänderungen (BEL-110102, Zoo #13200) |
| deklarierte Koinzidenz (Glue, matched regions), aber exakt geprüft | Aufrufer-Hinweise ungeprüft übernehmen |
| gemischte Körper: exakte Flächen, tolerante Einzelkanten | ganzen Körper wegen einer Kante zum Mesh degradieren |
| Clash-Taxonomie (Interferenz, Anlage, Enthaltensein) | Schnittpunkte per Abstands-Schwelle erzeugen (Zoo-Patent Anspruch 16) |

Quelle: [commercial-kernels.md](commercial-kernels.md) §4.12, §5.

---

## 3. Stand der Technik pro Problem

Pro Problem: was die Besten tun, was davon wirklich garantiert ist, wo es
bricht, und wo wonky steht. Details und alle Belege im jeweiligen Kapitel.

### 3.1 Robuste Booleans

**Drei Linien und ein Hybrid** ([mesh-booleans.md](mesh-booleans.md) §1.1,
[oss-brep-kernels.md](oss-brep-kernels.md) §3.3,
[brep-booleans-ssi.md](brep-booleans-ssi.md) §1.4):

- **Mesh, „ask once" mit symbolischer Perturbation** (Smith-Dodgson 2007,
  Manifold). Jede geometrische Frage wird genau einmal beantwortet, die
  Topologie ist dadurch immer konsistent, auch über lange Ketten (Manifold
  bleibt kanonisch auf 223 Terrain-Carves und 1999 Würfel-Operationen)
  (DOKUMENTIERT, [Smith-Notiz](sources/julian-m-smith-towards-robust-inexact-geometric-computation-.md),
  [Manifold](sources/manifold-elalish-manifold.md)). Die Geometrie ist nur
  konsistent, nicht exakt. **Alle** Kettendaten sind in double; der einzige
  float32-Datenpunkt (trueform 0.7.0, laut Solidean „as far as we can tell“
  intern 32-bit) ist gemischt: falsch (invertiert) auf dem Terrain-Carve,
  Ausfall bei etwa 70 % des Dome-Carve (der double-Build hielt), aber
  kanonisch über alle 1999 Schritte des Würfelgitters; F32x2 ist nirgends
  gemessen (DOKUMENTIERT, Solidean-Blog 2026: terrain-carve,
  iterated-dome-carve, iterated-cube-grid;
  [mesh-booleans.md](mesh-booleans.md) §1.2).
- **Exakte Arrangements mit konstruierten Vertices** (Zhou 2016, Cherchi
  2020/2022, Lévy 2024, CGAL corefinement). Exakte Prädikate liefern richtige
  Topologie; exakte Konstruktionen braucht man für Ketten; das Runden auf
  Floats ist ein eigener, zu validierender Schritt (CGAL sagt das explizit)
  (DOKUMENTIERT, [CGAL PMP](sources/cgal-polygon-mesh-processing-boolean-operations-separate-pac.md)).
  Brüche wachsen unbeschränkt (Nef 280-330 s), kaskadierte implizite Punkte
  brechen, Expansionen laufen aus dem Exponenten (Lévy: 65.000 Komponenten)
  (DOKUMENTIERT, [mesh-booleans.md](mesh-booleans.md) Takeaways).
- **Ebenenbasierte Festbreiten-Exaktheit** (Bernstein-Fussell 2009,
  Campen-Kobbelt 2010, Nehring-Wirxel 2021, EMBER, Solidean). Die einzige
  Darstellung, die unter Booleans abgeschlossen ist *und* beschränkte Größe
  hat. Aber: exakt auf quantisierter Eingabe ist exakt für ein Nachbarproblem;
  wonkys exact-plane hat auf dem 2^-24-mm-Gitter Taschen versiegelt und Spalte
  geschlossen (DOKUMENTIERT und GEMESSEN, ebd. §3.3,
  [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1).
- **B-rep-Booleans** (OCCT GFA, Parasolid, ACIS, SolveSpace, Truck):
  Pave-Filler bzw. Imprint-Ordnung, f64, wachsende Toleranzen; typischer
  Fehler ist „IsDone, aber falsch" an Säumen, geteilten Kanten und
  tangentialen Übergängen (DOKUMENTIERT,
  [GFA](sources/occt-boolean-operations-specification-general-fuse-algorithm.md)).
  Kleine B-rep-Kernel sterben an Tangenz und Koinzidenz (SolveSpace #1268 seit
  2022 offen, Truck #57, Fornjot ohne 3D-Boolean eingestellt).
- **Hybrid** (Yang et al. 2025, TOG): robuster Mesh-Boolean entscheidet die
  Topologie, Flächen liefern die Geometrie; im Mittel 17x schneller als OCCT
  und 2,3x als ACIS/Rhino auf 10.000 zufälligen ABC-Paaren (Set A), 0 Fehler
  auf 400 harten Operationen (Set B, 100 Paare × 4 Operationen; OCCT 10,
  Rhino 8, ACIS 1; Tab. 5). Ausgabe sind optimierte Polylinien; laut
  Limitations nicht garantiert, sobald *mehrere* kleine Schleifen mit Größe
  und Abstand unter der Mesh-Auflösung zusammenfallen; das Repository ist ein
  leerer GPL-3.0-Platzhalter (ein Commit vom 2025-04-29) (DOKUMENTIERT,
  [Yang-Notiz](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md)).

**wonky:** corefine + recover ist die strengere Variante des Hybrids (exakte
Kurven aus Trägern, benannte Verweigerung statt Fit). Offen sind: exakte
Provenienz von corefine zu recover (die Sliver-Heuristik hat echte Flächen
gelöscht), gemessene Kettenstabilität in F32x2, eine explizite Politik für
sich berührende Körper, und die hergeleitete Fehlerschranke von corefine
(ABGELEITET, [mesh-booleans.md](mesh-booleans.md) §5).

### 3.2 Surface-Surface-Intersection (SSI)

- **Natürliche Quadriken geschlossen:** Miller-Goldman plus Shene-Johnstone
  geben eine vollständige, transformationsfreie O(1)-Tabelle, mit mehr exakten
  Kegelschnitten als OCCTs `IntAna_QuadQuadGeo` (dem fehlen
  Zylinder/Kegel- und Kegel/Kegel-Fälle mit schneidenden Achsen)
  (DOKUMENTIERT, [brep-booleans-ssi.md](brep-booleans-ssi.md) §3.2).
- **Exakte Quadrikpaare** (Levin, DLLP/QI, Wang-Goldman-Tu, Shao-Chen 2024):
  Klassifikation ist billig (QI etwa 3 ms pro Paar), exakte Geometrie teuer
  (Ausgabehöhen 22-38x der Eingabe). Regel für wonky: Typ, Topologie und
  Inzidenzen exakt auf U32-Limbs entscheiden, Geometrie in F32x2 mit Schranke
  auswerten. Float-Scans von Δ zeigen scheinbare Vorzeichenwechsel, wo Δ Null
  nur berührt; Vielfachheiten lassen sich nicht durch Sampling entscheiden
  (DOKUMENTIERT, ebd. §3.3-§3.4). Der QI-Quellcode ist verloren, nur der
  Webserver antwortet noch.
- **Generator-Chart:** der Zylinder oder Kegel selbst als Büschelmitglied,
  eine quadratische Gleichung pro Erzeugender, Δ(tan φ/2) quartisch; die
  reellen Wurzeln von Δ geben die Morphologie (zwei Äste, eine Schleife, zwei
  Schleifen, Knoten, rationale Zerlegung). Hergeleitet und numerisch geprüft,
  nicht bewiesen (ABGELEITET, ebd. §3.4).
- **Freiform:** Unterteilung mit Normalenkegeln und dann Marching (SISL,
  GoTools), GPU-Boxgitter (Krishnamurthy 2009, ohne Topologiegarantie), IPP
  mit Intervallen (verliert keine Wurzel), ESOLID (exakt, aber verweigert
  Degeneriertes) (DOKUMENTIERT, [oss-brep-kernels.md](oss-brep-kernels.md)
  §3.2). Die Tangenzklassifikation über die Differenz der zweiten
  Fundamentalformen ist Lehrbuch, aber nirgends zertifiziert; für Ebene,
  Zylinder und Kegel ist sie ein exaktes Prädikat niedrigen Grades
  (ABGELEITET, ebd.).
- **Tori** sind der offene Rest: Kreis-Katalog (Villarceau, Meridian),
  Meridianebenen-Chart, sonst die prozedurale XT-Kurve als allgemeiner
  Fallback (ABGELEITET, [brep-booleans-ssi.md](brep-booleans-ssi.md) §3.5,
  §3.6).

**wonky:** recover nimmt jede Kurve aus den Trägern und hat 26
Freitext-Verweigerungen plus fest verdrahtete Schwellen (1e-12, 1e-9, 1e-10)
in `geom.bend` (DOKUMENTIERT, ebd. Takeaways). Die offenen Kurventypen sind
Backlog B8, B9 und B18.

### 3.3 Fillets, Offsets, Shell

- **Stand:** geschlossene Formen für die Quadrikfälle, Rolling-Ball-Walking
  sonst, Vertex-Blends als eigentliches Problem, Überlauf als
  Parasolid-Spezialität (DOKUMENTIERT,
  [fillets-blends-offsets.md](fillets-blends-offsets.md) §3.1-§3.6). Kein
  offenes System implementiert Überlauf; OCCT scheitert, remus stoppt an der
  Klippe, monstertruck überspringt die Kante (ebd. §1.6).
- **Anhängen per Boolean scheitert genau an der Tangenz:** SolveSpace #1291
  (ein filletförmiges Werkzeug tangential an Würfelflächen) brauchte vier
  Jahre und fünf Fixes (DOKUMENTIERT, ebd. §4.1). Darum soll Kandidat B
  Tangenz über geteilte Trägerdatensätze deklarieren und mit Fasenwerkzeugen
  beginnen, die nicht tangential sind.
- **Fasen:** Onshape misst EQUAL_OFFSETS entlang der Stützfläche; bei 120°
  Kante, d = 1, L = 20 gab die Probe ΔV = −8,6603 mm³, beide
  Flächenversatz-Lesarten liegen daneben (GEMESSEN, ebd. Takeaways).
- **Offsets:** der Trägerzoo ist unter Offset abgeschlossen (Ebene bleibt
  Ebene, Zylinder Zylinder, Kegel Kegel mit verschobener Spitze, Kugel und
  Torus behalten ihren Typ). Intersection-Join (scharfe Kanten) ist
  Parasolids Hollow-Semantik; Onshapes Join-Semantik ist ungeprüft
  (DOKUMENTIERT und ABGELEITET, ebd. §1.1, §3.8).
- **Semantik:** Rossignac-Requicha definieren Runden als morphologische
  Öffnung, Filleten als Schließung; daraus folgen auch Clearance
  (dist(X,Y) ≥ 2r) und Toleranzgleichheit als exakte Abstandsabfragen statt
  Offset-Konstruktionen (DOKUMENTIERT,
  [Rossignac-Requicha](sources/rossignac-requicha-offsetting-operations-in-solid-modelling-.md)).

**wonky:** v1 nur analytisch mit typisierter Verweigerung (entschieden).
Prototyp A (Leiter plus Eckennetz) entscheidet in einem 1e-9-mm-Band in
F32x2, Stufe 3 (Chirurgie) fehlt; Prototyp C (Rolling Ball) sampelt
Überlaufprüfungen. B und D sind nicht begonnen (DOKUMENTIERT, ebd. §1.7).

### 3.4 Toleranzen und Numerik unter F32

- **Filter:** Shewchuk-Stil, Ozaki-Stil (statisch), Bartels
  (kompositionale Schranken), alle beweisen unter Round-to-Nearest, ohne
  Kontraktion und mit graduellem Unterlauf (DOKUMENTIERT,
  [robust-numerics.md](robust-numerics.md) §1.2, §3.1). Bend pinnt
  `fp contract(off)` für C und `MTLMathModeSafe` für Metal; JS und nativ
  behalten Subnormale, Metal darf sie wegspülen (FTZ) (DOKUMENTIERT,
  ebd., [parallel-gpu-geometry.md](parallel-gpu-geometry.md) §1.5). Das
  Frames-Addendum liest die MSL-Spezifikation so, dass `MTLMathModeSafe`
  Kontraktion innerhalb einer Anweisung noch erlaubt; das ist mit dem
  Probe-Programm zu klären (Abschnitt 8).
- **Double-Word:** Joldes-Muller-Popescu geben bewiesene Schranken (genaue
  Addition 3u² + 13u³; Division 15u² + 56u³; bei u = 2^-24).
  Multiplikation: < 5u² nur mit FMA (Alg. 12), ohne FMA (Alg. 10, Bends Fall)
  7u²; Muller-Rideau 2022 haben das per Coq auf 5u² bei ties-to-even
  verschärft und dabei einen Fehler in den Originalbeweisen gefunden (die
  Sätze gelten). Ältere publizierte Schranken (Li et al.: 2u² für die
  Addition) waren falsch (DOKUMENTIERT, TOMS 44(2) 2017 Tab. 1,
  TOMS 48(1) 2022,
  [robust-numerics.md](robust-numerics.md) §3.2, §4.1).
- **Exakte Stufe:** Expansionen (Shewchuk) gegen Festbreiten-Integer
  (GTE `UIntegerFP32<N>`, NW21). Festbreite ist die einzige exakte Form mit
  uniformer Arbeit pro Lane, also GPU-tauglich. Bend kennt kein `mulhi`, also
  16-Bit-Halb-Limbs (16x die Multiplikationen der 64-Bit-Limbs der Paper)
  (DOKUMENTIERT, [mesh-booleans.md](mesh-booleans.md) §1.4,
  [GTE](sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md)).
  Bitbudgets: orient3d auf B-Bit-Gitter 3B+6; wonkys `big.bend` ≤ 325 Bit
  (21 Limbs) bei B = 34; beliebige F32-Eingaben brauchen für orient3d 864 Bit
  (DOKUMENTIERT und ABGELEITET,
  [oss-brep-kernels.md](oss-brep-kernels.md) §3.4).
- **Indirekte Prädikate** (Attene 2020, Cherchi): exakte Entscheidungen auf
  konstruierten Punkten, ohne sie zu runden. Attenes PR 15 lieferte 233.200
  falsche Vorzeichen, permutationskonsistent, also von Symmetrietests
  unentdeckbar (DOKUMENTIERT, [robust-numerics.md](robust-numerics.md) §3.4,
  §4.1).
- **Symbolische Perturbation** macht Gleichstände konsistent, nicht
  beabsichtigt; flache CAD-Flächen brauchen eine explizite Koplanarpolitik
  (ABGELEITET, [mesh-booleans.md](mesh-booleans.md) §4.2).
- **Frames:** Floats können keinen gekippten Einheitsvektor exakt halten
  (Bahrdt-Seybold: nur die Pole liegen exakt auf S²); `rotationAround(z,
  90°)` erzeugt im Frontend 6,12e-17-Reste, womit alle „exakt
  achsenparallel"-Regeln nicht mehr greifen. Deine Rotationen sind fast alle
  speziell (130 von 141 in Grad, alle um Koordinatenachsen) (DOKUMENTIERT und
  GEMESSEN,
  [Frames-Addendum](addenda/frames-rigid-transforms-and-trigonometry-in-f32x2-exact-spec.md)
  §0).

**wonky:** Filter-Kaskade existiert (exact-plane: 0,10-0,20 µs gefiltert
gegen 1,3-6,0 µs exakt). Das 2^-40 → 2^-44-Lehrstück zeigt die Regel:
Toleranzen aus dem Rundungsfehler herleiten, den sie absorbieren, nie auf
exakte Eingabe anwenden, im Ergebnis ausweisen (GEMESSEN,
[robust-numerics.md](robust-numerics.md) §4.2).

### 3.5 Persistente Benennung und Diffs

- **Sechs Identitätsfamilien:** History-Relationen (OCCT), aus Historie
  abgeleitete Namen (FreeCAD/realthunder), lösbare Selektionsrezepte (OCAF
  TNaming), Feature- und Support-basierte Namen (Bidarra, Wang-Nnaji,
  Capoyleas), transiente IDs plus Übersetzung (Onshape), operationsrelative
  Selektoren (build123d); dazu historienfreies Matching (Jones 2023) als
  Import-Fallback (DOKUMENTIERT,
  [topology-identity-data-structures.md](topology-identity-data-structures.md)
  §1.2, §3).
- **Was funktioniert:** Alle produktiven Systeme trennen Operationshistorie,
  persistentes Referenzrezept und Auflösung auf eine aktuelle Menge mit
  expliziter Kardinalität (OCAF, Onshape, Bidarra). Onshapes Split ist eine
  bekannte Menge von Nachfolgern, kein Raten (DOKUMENTIERT, ebd.
  Takeaways).
- **Was scheitert:** Historie in Namensstrings falten (FreeCAD: erster
  Elternteil plus höchstens vier, Zufallssuffixe in Release-Builds, 1.0 noch
  „nicht vollständig gelöst", V2 als Entwurf #31040); positionale Identität;
  „den ersten" eines Splits wählen (DOKUMENTIERT, ebd. §4.1).
- **Bidarras Invariante:** jede Fläche hat genau einen Eigentümer; koplanare
  Flächen verschiedener Eigentümer verschmelzen nicht. recovers
  Trägervereinigung bricht sie, und `hybridRemovedMaterial` stößt schon heute
  darauf („coincident triangles may carry either tag") (DOKUMENTIERT, ebd.).
- **Diff:** Brière-Côté/Rivest: Rahmen und Einheiten, dann Entitäts-Lineage,
  dann Geometrieabweichung, dann Regionen; historienfreies Matching liegt bei
  1,1-2,8 % falschen Labels und ist durch PTCs US11288411B2 belegt
  (DOKUMENTIERT, ebd. §3.7-§3.8).

**wonky:** Identität trennt schon Ursprung, Instanz und Revision; die
Frontend-Lücke ist `qCreatedBy(id, FACE)`, das per Körper filtert und nach
einer Subtraktion alle Flächen liefert (ABGELEITET aus Code, nicht
ausgeführt, ebd. Takeaways). Backlog B3, B14.

### 3.6 Parallelität und GPU

- **Bend 2.0.25 ist kein Interaction-Net-Runtime mehr:** affines Eigentum,
  bulk-synchroner 16.384-Lane-Würfel ohne Work-Stealing; CPU und GPU rechnen
  nie gleichzeitig; Balance ist Sache des Programms (DOKUMENTIERT, BendRT §6,
  [parallel-gpu-geometry.md](parallel-gpu-geometry.md) §1.1).
- **GPU gewinnt nur bei uniformer, flacher Arbeit** mit ≥ 4^7 Blättern
  (BendRT 52-67x); verliert bei divergenter, topologischer Arbeit
  (n-queens 1,24 s GPU gegen 0,46 s auf 16 Threads; wonkys schlechtes
  64x256-Split 777 ms gegen 21 ms) (DOKUMENTIERT und GEMESSEN, ebd. §1.2).
- **Exakte Mesh-CSG läuft auf Multicore-CPUs** (Cherchi, Lévy, EMBER),
  Industrie-SMP nur in Teilalgorithmen; niemand hat einen exakten
  gekrümmten B-rep-Boolean auf der GPU (DOKUMENTIERT, ebd. §1.3, §1.6).
- **Zwei Bend-CPU-Fallen:** Teilen erzwingt atomare Referenzzähler; ein
  nicht-tail Aufruf, der geforkt hat, serialisiert alle späteren parallelen
  `let` im selben Frame (190 ms bei 1 wie bei 18 Threads) (GEMESSEN, ebd.
  §1.2).
- **Bend-Lücken:** kein `fma`, kein `clz`, `U32.mul` liefert nur das untere
  Wort, obwohl die Hardware 32x32→64 kann (DOKUMENTIERT, ebd. §1.5).

**wonky:** Produktion bleibt `--gpu off`; Parallelität über unabhängige
Operationen und das Parallelisieren der sequentiellen Stufen ist der Hebel
(Backlog B25). wonky hat drei getrennte Morton/BVH-Implementierungen, der Keim
einer Bend-Geometriebibliothek (ebd. Takeaways).

### 3.7 SDF / implizite Modellierung

- **Konvergierter Auswertungskern:** hash-consed DAG → Register-Tape →
  Intervall- oder Lipschitz-Auswertung pro Zelle → Tape-Pruning → feste
  hierarchische Splits (Fidget, libfive, MPR). f32-nativ, bit-identisch über
  Backends (DOKUMENTIERT, [implicit-sdf.md](implicit-sdf.md) §1.3).
- **Meshing ist die zugegebene Schwachstelle:** topologiesichere Mesher
  runden Features ab, featureerhaltende (DC/MDC) können sich selbst
  schneiden und hängen an getunten QEF-Schwellen (DOKUMENTIERT, ebd. §1.4).
- **wonkys Feld ist trägerweise:** `f − r` ist genau das
  Intersection-Join-Offset, mit Überschuss r·(1/sin(θ/2) − 1) an konvexen
  Kanten (0,414 r bei 90°), also konservativ für Clearance und Wände
  (ABGELEITET, ebd. §1.5).

**wonky:** sdf lieferte als Boolean 47 von 216 adversarialen Fällen „ok" mit
falscher Geometrie und ist nur noch für FDM-Analysen (Wandstärke-Strahlen,
Feld) im Einsatz (GEMESSEN, [../bakeoff.md](../bakeoff.md)). Die Kapitel
sind Sweep-Niveau, ihre Urteile vorläufig.

### 3.8 LLM-Ergonomie

- **Code als Aktion** schlägt Tool-Ketten; numerische Beobachtungen schlagen
  Renderings (VLM-Antworten zu Renderings etwa zwei Drittel richtig, 19-27 %
  „Unclear") (DOKUMENTIERT, [llm-code-cad.md](llm-code-cad.md) §3.2-§3.4).
- **Validität** ist überall der eigene Checker plus Mesh-Heuristik,
  Ähnlichkeit gesampelt und auf eine Einheitsbox normiert, keine Zahl hat eine
  Fehlerschranke, kein Benchmark bewertet Druckbarkeit oder ob eine Änderung
  den Rest des Teils exakt erhalten hat (ABGELEITET, ebd. §1.4, §3.6).
- **Messbare Modellfehler:** falsche Arbeitsebene (BenchCAD Tab. 14: GPT-4o
  Rotationsgewinn 0,23 für XZ und 0,21 für YZ gegen 0,05 für XY), fallen
  gelassene Details, Sweep/Loft durch Sketch plus Extrude ersetzt
  (DOKUMENTIERT, ebd. §4.1).
- **Korrekturen am Scout:** CAD-Assistants überparametrisiertes JSON gewann
  nicht (0,747 gegen 0,748); SpatialClaws kontrollierter Gewinn ist +3,2,
  nicht +11,2 Punkte; „CADBench" bezeichnet drei verschiedene Benchmarks
  (DOKUMENTIERT, ebd. Takeaways).

**wonky** hat schon viel davon (revisionsgebundene Summaries mit `null` für
Unbekanntes, Fähigkeitsfehler mit Quellposition, `--check`, `--param`,
khanas Drei-Zustands-Urteile). Das meiste ist „anschließen und fertig
machen" (Backlog B15).

### 3.9 Testen und Validieren

- **Fünf Praktiken, die sich kaum zitieren:** Gültigkeitschecker,
  Property-Orakel und Regressionskorpora, Differential-Orakel mit
  Schiedsrichter, metamorphe Relationen, geschlossene Formen
  (DOKUMENTIERT, [testing-validation.md](testing-validation.md) §1.1).
- **Industrielle Checker** sind kostengeordnet, ausdrücklich unvollständig und
  sampeln Inzidenz; wonky kann die Inzidenzstufe für seine Träger exakt
  machen und muss für unbekannte Paare „indeterminate" sagen, nie „valid"
  (ABGELEITET, ebd. §3.1).
- **Metamorphes Testen** (Spatter: 34 Bugs, 30 bestätigt; relationenreiche
  Ableitung fand mehr verschiedene Bugs als viermal so viele einfache
  Trigger) ist die größte fehlende Schicht (DOKUMENTIERT, ebd. §3.4).
- **Schwellen anderer Projekte taugen nicht für Kernel-Regression:** OCCT
  checkprops 1 %, GEOS 1e-3 relativ, CAx-IF 0,5 %; nur für STEP-Austausch
  (DOKUMENTIERT, ebd. Takeaways).
- **Datensätze** (ABC, DeepCAD, Fusion 360 Gallery) sind Korpora mit
  dokumentierten semantischen Verlusten, keine Wahrheit; die Fusion-Lizenz ist
  nicht-kommerziell und bindet Arbeitgeber (DOKUMENTIERT, ebd.).

**wonky:** zwei Orakel plus Arbiter, Byte-Identität über 254 Fälle, 216
adversariale Fälle, strikte OCCT-CurveOnSurface-Prüfung, R20-Gate (16/17).
Lücken: metamorphe Relationen, Toleranzband-Sweeps, ein Bend-B-rep-Checker
für gekrümmte Ergebnisse, ein zertifiziertes Hausdorff-Intervall statt der
Stichproben-Untergrenze in R20 (GEMESSEN und ABGELEITET, ebd. §1.3, §4.2).

### 3.10 FDM

- **Bruchlinie:** Designbibliotheken (NopSCADlib, BOSL2, Gridfinity)
  kodieren Druckintention als Geometrie; Slicer rekonstruieren sie aus
  Dreiecken. Exakte Bögen erreichen die Maschine nie (Klipper segmentiert
  G2/G3 per Default in 1-mm-Segmente, `[gcode_arcs] resolution`) (DOKUMENTIERT, [fdm-geometry.md](fdm-geometry.md) §1.1).
- **Kriegsgeschichten aus deinem Korpus:** 52 von 175 Ausgaben haben die
  Überhangprüfung abgeschaltet, 17 die Wandprüfung; 59 von 61 Fehlern sind
  Wände nahe der 0,05-mm-Sliver-Grenze; ein vergrabener Würfel besteht 5 mm
  Clearance; ein nominales 0,25-mm-Spiel misst 0,24999999999999983 und
  scheitert (GEMESSEN, ebd. §4).
- **Passungen sind überall schlecht gelöst** (BOSL2 #1679 „Rethink $slop"
  offen); veröffentlichte Clearance-Werte sind Startwerte (DOKUMENTIERT,
  ebd. §3.5).
- **IceSL:** Slicen kommutiert mit CSG; das gibt ein unabhängiges
  Slice-Orakel für den Hybrid und eine exakte 2D-Schichtmaschine für
  Stützen, Brücken und erste Schicht (ABGELEITET, ebd. §3.8).
- **Konkurrenz beobachten:** OrcaSlicer main hat einen CAD-Tab mit OCCT und
  SolveSpace-Solver, aktiv bis 2026-09-23 (DOKUMENTIERT, ebd. Takeaways).

**wonky:** `src/print-mesh.mjs` hat bereits Filip-artige Schranken (Sagitta,
`grid_bound`) mit geteiltem Kanten-Sampling. Das khana-Design (C1-C11,
K1-K20) ist der am besten recherchierte Plan und sollte zuerst gebaut werden
(Backlog B21).

### 3.11 Skizzen, Transformationen, Lofts, Text (Addenda)

- **Skizzenregionen:** Onshape-Regionen sind Flächen des Kurvenarrangements,
  nicht Schleifen; `qSketchRegion(id, true)` entfernt eine Schachtelungsebene,
  nicht Even-Odd. Linien und Kreise brauchen nur One-Root-Zahlen α + β√γ; das
  schwerste Ordnungsprädikat hat Grad ≤ 12 (Devillers 2002). wonky lässt heute
  genau eine geschlossene Schleife zu (DOKUMENTIERT,
  [2D-Addendum](addenda/exact-2d-arrangements-of-sketch-curves-lines-arcs-conics-wit.md)
  §0).
- **Lofts:** Onshape erzeugt aus deinen Profilen Ebenen, exakte Kegel,
  bilineare Patches (hyperbolische Paraboloide, als 3x1-B-Spline gespeichert)
  und kubische C2-Skins; keine rationalen Splines. 63 der 83 blockierten
  Loft-Einheiten brauchen nur Ebenen, Kegel und den bilinearen Patch
  (GEMESSEN aus deinen STEP-Exporten,
  [Loft-Addendum](addenda/lofts-and-sweeps-ruled-and-skinned-surfaces-vertex-matching-.md)
  §0).
- **Text:** Onshape nutzt Open Sans v1.10 (Apache-2.0), nicht v3 (OFL);
  Layout exakt rekonstruiert (FreeType-artig ungehintet bei 100 ppem, 1/64-px
  Gitter, kein Kerning); TrueType-Segmente bleiben exakte quadratische
  Béziers, also Parabeln und parabolische Zylinder, eine Quadrik
  (DOKUMENTIERT und GEMESSEN,
  [skText-Addendum](addenda/sktext-as-exact-geometry-truetype-outlines-font-sourcing-and.md)
  §0).

---

## 4. Folgen für den Bake-off

**Status:** entschieden am 2026-09-23 für corefine + recover
(DOKUMENTIERT, [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1).
Die Literatur bestätigt die Entscheidung. Hier trotzdem pro Ansatz, was sie
stützt, wo er scheitern dürfte und was als Kandidat fehlte, weil die Punkte in
Plan-Schritt 6 und 8-13 und im Fillet-Bake-off weiterwirken.

### 4.1 Tagged Mesh Boolean mit symbolischer Perturbation (corefine)

- **Gestützt:** Smith/Manifold „ask once" ist die einzige Linie mit
  dokumentierter Topologiekonsistenz über lange Ketten; Manifold ist Stand der
  Technik für Geschwindigkeit; OpenSCAD ist von Nef über corefinement zu
  Manifold gewandert (DOKUMENTIERT, [mesh-booleans.md](mesh-booleans.md)
  §1.2, [oss-brep-kernels.md](oss-brep-kernels.md) §1.3).
- **Wo es scheitern dürfte:**
  - Koplanare und berührende Flächen: Manifolds dokumentierte Schwäche
    (#1656, #1430); SoS macht Gleichstände konsistent, nicht beabsichtigt
    (DOKUMENTIERT, [mesh-booleans.md](mesh-booleans.md) P2).
  - F32x2 in langen Ketten: nirgends gemessen; trueform-float32 scheiterte
    auf Terrain- und Dome-Carve, bestand aber das 1999-Schritt-Würfelgitter
    (DOKUMENTIERT, Solidean-Blog; ebd. §1.2). wonky ist nie mehr als 6
    Schritte gelaufen.
  - Identität per Koordinatengleichheit (Manifold #1516) und Aufräumregeln
    ohne abnehmendes Maß (Manifold #1842, PDMS) (DOKUMENTIERT, ebd. §4.1).
  - Determinismus unter Parallelität mit Atomics (Manifold #1320, #1848); bei
    wonky durch Bend ausgeschlossen (GEMESSEN).
- **Konsequenz:** Iterated-CSG-Suite, Koinzidenz-Replay aus Manifolds
  Tracker, hergeleitete Schranke (Backlog B2, B4).

### 4.2 EMBER-artiger exakter ebenenbasierter Boolean (exact-plane)

- **Gestützt:** ebenenbasierte Festbreite ist die einzige unter Booleans
  abgeschlossene, beschränkte exakte Darstellung (NW21, EMBER, Solidean)
  (DOKUMENTIERT, [mesh-booleans.md](mesh-booleans.md) §3.3).
- **Wo es scheitert:** nur planare Geometrie; Quantisierung ändert Topologie
  unter dem Gitter (gemessen: versiegelte Taschen); Ausgabe auf Floats kann
  sich selbst schneiden (Blenders EMBER-Port wurde 2025-02 genau an der
  Ausgabestufe zurückgestellt); variable Bigs sind etwa 175x langsamer pro
  exakter Klassifikation als NW21s 256-Bit-Festbreite (DOKUMENTIERT und
  ABGELEITET, ebd. Takeaways, §4.1).
- **Rolle:** Differential-Orakel. Mit Festbreiten-Limbs (Backlog B19) würde
  es billig genug für CI und einen Paranoid-Modus.

### 4.3 libfive-artiges SDF mit Dual Contouring (sdf)

- **Gestützt:** als Feld-Auswerter und für Analysen (Wandstärke, Clearance,
  Broad Phase) ist der Fidget/libfive-Kern Stand der Technik und in Bend auf
  der CPU gut (cpu1/cpu18 = 3,57, byte-identisch) (DOKUMENTIERT und GEMESSEN,
  [implicit-sdf.md](implicit-sdf.md) Takeaways).
- **Wo es scheitert:** als Boolean-Autorität: gitterbedingte Topologie
  (Wände und Schlitze unter der Zellgröße, weit entfernte Kleinteile, Kegelspitze),
  featureerhaltendes Meshing ohne Garantie; 47/216 falsche „ok" (GEMESSEN,
  ebd. §1.4). Die Literatur (Plantinga-Vegter) schlägt selbst Tiefendeckel
  plus farbkodierte unzertifizierte Regionen vor.
- **Rolle:** FDM-Analysen, mit zertifizierten F32-Bereichsschranken (S2)
  und Feldqualitätsklassen (S1).

### 4.4 Analytische B-rep-Rückgewinnung aus getaggtem Mesh (recover)

- **Gestützt:** Yang 2025 ist der publizierte Zwilling; Nefs Autoren fanden,
  dass Paarung über propagierte Indizes geometrische Gleichheit schlägt; CGAL
  trennt ausdrücklich exakte Prädikate von Rundung (DOKUMENTIERT,
  [brep-booleans-ssi.md](brep-booleans-ssi.md) §1.4,
  [oss-brep-kernels.md](oss-brep-kernels.md) §1.6).
- **Wo es scheitern dürfte:**
  - Tangentiale Vertices und Kontakte unter der Tessellierungsabweichung
    (Yang garantiert nichts bei mehreren kleinen Schleifen unter der
    Mesh-Auflösung; wonkys Vorzertifikat verweigert sie) (ABGELEITET).
  - Nach Fillets: Torus-Flächen treffen Ebene und Zylinder tangential entlang
    ganzer Kreise. OCCT #1496 ist nur ein schwacher Hinweis: ein
    unbestätigter, vom Melder selbst geschlossener Bericht über das Common
    zweier *geometrisch identischer* MakePipeShell-Körper mit
    Zylinder-Torus-Zylinder-Übergang, laut Melder aus Primitiven nicht
    reproduzierbar (HÖRENSAGEN-Grad,
    [Issue](https://github.com/Open-Cascade-SAS/OCCT/issues/1496);
    [brep-booleans-ssi.md](brep-booleans-ssi.md) §6 Frage 12).
  - Sliver-Absorption statt Provenienz (hat echte Flächen gelöscht)
    (GEMESSEN).
- **Konsequenz:** Provenienz (B3), exakte Klassifikation (B8), fehlende
  Kurventypen (B9, B18), lokale Verfeinerung statt Verweigerung (B12).

### 4.5 Welche Kandidaten fehlten

| fehlender Kandidat | was er gebracht hätte | heute sinnvoll als |
|---|---|---|
| Nef-artiges vertexlokales Overlay mit Krümmungs-Tie-Break | unabhängiges Orakel für degenerierte Vertices von Ebene/Zylinder/Kegel-Körpern | Orakel, [oss-brep-kernels.md](oss-brep-kernels.md) §6 Q4 |
| trueform-artige exakte Kontakttypisierung (Grad 3, ohne SoS) | Refusals nach „wirklich unentscheidbar" und „SoS-Artefakt" trennen | Seitenkanal neben corefine, [mesh-booleans.md](mesh-booleans.md) §6 Q4 |
| deklarierte Koinzidenz (ACIS-Glue, Parasolid matched regions), exakt geprüft | koplanare Fälle ohne 2^-44-Vereinigung, Fillet-Kandidat B | Backlog B11 |
| exakte Mitgliedschaftsstruktur (NW21: persistenter Oktree aus BSPs) | exakte Kontakt-gegen-Überlappung, A xor B für Diffs | später, [mesh-booleans.md](mesh-booleans.md) §6 Q5 |
| Slice-Kommutations-Orakel (IceSL) | Referee ohne OCCT, zugleich FDM-Schichtmaschine | [fdm-geometry.md](fdm-geometry.md) R4 |
| exakte semantische Mitgliedschaft (Proben plus exakte Implizit-Vorzeichen) | viertes, unabhängiges Schiedsorakel | [fringe-kernels.md](fringe-kernels.md) F5 |

### 4.6 Folgen für den laufenden Fillet-Bake-off

- **A (Leiter, fillet-kpart):** Entscheidungen vom 1e-9-mm-Band auf exakte
  Prädikate ziehen; Stufe 3 als rein funktionale Chirurgie nach dem
  abgelaufenen HP-Patent, danach immer globale Interferenzprüfung und die
  Prüfung, dass sich (F,E,V) und Volumen geändert haben (Backlog B17).
- **B (Blend-Boolean):** Tangenz nie entdecken, sondern über geteilte
  Trägerdatensätze deklarieren; mit Fasenwerkzeugen beginnen; Parasolids
  acht Überlauf-Defaults als Daten (Backlog B11,
  [fillets-blends-offsets.md](fillets-blends-offsets.md) P4).
- **C (Rolling Ball):** gesampelte Überlaufprüfungen durch exakte Tests
  gegen Flächenränder ersetzen; Metal nur für den Station-Solve
  (ebd. P1, §4.1).
- **D (morphologisch):** Rossignacs Definitionen als Orakel, nicht als
  Konstruktion; Feldqualität beachten (Intersection-Join-Überschuss)
  ([implicit-sdf.md](implicit-sdf.md) S1).
- **Für alle:** Fehler als Daten mit Onshape-Namen und dem größten
  machbaren Radius (ebd. P5), Harness-Orakel, die nicht die Konstruktion
  teilen (ebd. P6).

---

## 5. Priorisiertes Ideen-Backlog

25 Einträge, dedupliziert über alle Kapitel (viele Kapitel schlagen dieselbe
Idee unter anderem Namen vor; die Quellenzeile nennt alle). Reihenfolge nach
Nutzen pro Risiko auf dem heutigen Pfad:

- **Stufe A (zuerst):** billig, macht spätere Arbeit beweisbar oder sichtbar.
- **Stufe B (danach):** schließt gemessene Lücken des Hybrids und des
  Korpus.
- **Stufe C (größer):** neue Fähigkeiten und neue Infrastruktur.

Aufwand: **klein** (Tage, ein Modul), **mittel** (mehrere Module oder ein
neuer Test-Layer), **groß** (neue Geometrie, neues Format oder mehrere
Wochen Arbeit). „Bend" bewertet F32/U32, fork-join und GPU-Eignung.

### Übersicht

| # | Idee | Stufe | Aufwand | trifft |
|---|---|---|---|---|
| B1 | Numerischer Vertrag pro Target, FTZ-Audit | A | klein | Metal, alle Filter |
| B2 | Genaue Double-Word-Addition, hergeleitete corefine-Schranke | A | klein | corefine, Ketten |
| B3 | Exakte Provenienz corefine → recover, typisierte OperationHistory | A | mittel | Slivers, Namen, Diffs |
| B4 | Metamorphe Suite, Toleranzband-Sweeps, Ketten-CSG | A | mittel | Hybrid-Regression |
| B5 | Toleranz-Ledger und stabile Fehlercodes | A | mittel | Verweigerungen, LLM |
| B6 | Algorithmus-Versionsvektor am FS-Header | A | klein | reproduzierbare Teile |
| B7 | Typisierte Platzierungen, exakte Sonderwinkel | A | klein | Rotationen, Spiegelungen |
| B8 | Exakter Trägerpaar-Klassifikator plus Hyperbel/Parabel | B | mittel | Tangenz, Senkungen |
| B9 | Steinmetz-Ecken und tangentiale Vertices | B | mittel | hex-nut, Steinmetz |
| B10 | Kanonisches Abtastgitter pro Kreis | B | mittel | Slivers, Koaxiales |
| B11 | Deklarierte Kontakte, exakt geprüft | B | mittel | koplanar, Fillet B |
| B12 | Lokale Verfeinerung statt Clearance-Verweigerung | B | mittel | dünne Wände |
| B13 | `opOffsetFace` mit Intersection-Join | B | mittel | 51 Passungsaufrufe |
| B14 | Namen durch Booleans: Creator-Sets, Split/Merge | B | mittel | Fillet-Referenzen |
| B15 | Agenten-Ergebnis-Envelope und dünne MCP-Schicht | B | mittel | LLM-Workflow |
| B16 | Zertifizierter Vergleich und Clash-Taxonomie | B | mittel | Passungen, Diffs |
| B17 | Fillet-Leiter exakt, Stufe 3 als Chirurgie | C | groß | Fillets v1 |
| B18 | Zertifizierte Raumquartik-Kurve | C | groß | Querbohrungen, T-Stücke |
| B19 | Festbreiten-Limbs und Prädikatgenerator | C | groß | alle exakten Pfade |
| B20 | Typisierter B-rep-Checker in Bend | C | groß | Gültigkeit gekrümmt |
| B21 | khana-FDM-Prüfkern | C | groß | Druckbarkeit |
| B22 | Zertifizierter Druck-Export (3MF, Snap-Rounding) | C | mittel | Slicer-Übergabe |
| B23 | Skizzenregionen exakt, dann skText | C | groß | 486 bzw. 174 Dateien |
| B24 | Lofts: Bilinear-Träger | C | mittel | 28+ Loft-Einheiten |
| B25 | Parallelität über Operationen und sequentielle Stufen | C | mittel | Laufzeit |

### Stufe A

**B1. Numerischer Vertrag pro Target, FTZ-Audit**

- **Idee:** Ein Bend-Probe-Programm liefert rohe U32-Bitmuster für feste
  Vektoren auf JS, nativ und Metal (TwoProd mit 4097-Split, 2^-126·0,5 für
  FTZ, Bitmuster von 1/3 und √2, Kontraktionstest, Überlauf). Jeder Filter
  zitiert eine Vertragsklausel. Dazu: jedes numerische Modul als immun,
  fenster-bewiesen FTZ-sicher oder nur-graduell klassifizieren; die untere
  Schranke in `kernel/intersections.bend` von 151 auf 174 heben (oder auf den
  U32-Big-Pfad legen).
- **Nutzen:** Macht die Byte-Identität erklärbar statt zufällig; schließt die
  einzige konkret gefundene FTZ-Gefahr (falsches exaktes Null-Zertifikat auf
  Metal); klärt den Widerspruch zur Kontraktion unter `MTLMathModeSafe`.
- **Bend:** ideal, eine gerade, uniforme Funktion über feste Vektoren.
- **Risiko:** gering; Metal-Verhalten kann je GPU-Generation variieren, also
  pro Maschinenklasse laufen lassen.
- **Aufwand:** klein.
- **Erster Abnahmetest:** TwoProd von (1+2^-12)² ergibt p = 1+2^-11 und
  Rest 2^-24 auf allen drei Targets; ein absichtlich kontrahierter Build fällt
  durch.
- **Quellen:** [robust-numerics.md](robust-numerics.md) P1, P2;
  [parallel-gpu-geometry.md](parallel-gpu-geometry.md) P5;
  [Frames-Addendum](addenda/frames-rigid-transforms-and-trigonometry-in-f32x2-exact-spec.md)
  P8; [mesh-booleans.md](mesh-booleans.md) P4.

**B2. Genaue Double-Word-Addition, hergeleitete corefine-Schranke**

- **Idee:** `R.add` (Joldes-Muller-Popescu Alg. 5, ohne Schranke bei
  Auslöschung) durch Alg. 6 ersetzen, mindestens in corefines
  Interpolate/Intersect; Smiths Fehlertabellen (Kap. 8) für corefines echte
  Operationsfolge nachrechnen; prüfen, dass 2^-36-Kollaps und
  2^-44-Vereinigung mit genanntem Abstand über α liegen.
- **Nutzen:** corefines numerisches Modell wird beweisbar; die Gate-Filter und
  die Vereinigung hängen davon ab; entfernt eine latente Quelle falscher
  Gleichstände bei kurzen Kanten weit vom Ursprung.
- **Bend:** exzellent, feste skalare Graphen (20 statt 11 F32-Operationen).
- **Risiko:** letzte Bits ändern sich, Byte-Baselines müssen bewusst neu
  aufgenommen werden (gleiche Urteile als Gate).
- **Aufwand:** klein.
- **Erster Abnahmetest:** Property-Test über 10^6 Paare mit
  entgegengesetztem Vorzeichen gegen exakte dyadische Subtraktion bleibt
  innerhalb 3·2^-48 und zeigt ein Gegenbeispiel für die heutige Addition;
  Korpus-Urteile unverändert, Volumina innerhalb 1e-12.
- **Quellen:** [mesh-booleans.md](mesh-booleans.md) P4;
  [robust-numerics.md](robust-numerics.md) P8;
  [Joldes-Notiz](sources/joldes-muller-popescu-2017-tight-and-rigorous-error-bounds-f.md).

**B3. Exakte Provenienz corefine → recover, typisierte OperationHistory**

- **Idee:** corefine gibt pro neuem Vertex die Tag-Menge, auf der er liegt,
  und pro Schnittkante das Paar (P-Tag, Q-Tag) aus; recover nimmt
  Kurvenzuordnungen daraus, prüft sie gegen die Patch-Nachbarschaft
  (Widerspruch = benannte Verweigerung) und lässt Sliver-Absorption fallen,
  wo die Zuordnung bekannt ist. Darauf eine unveränderliche History aus
  U32-Zeilen (Unchanged/Modified/Generated, gelöschte Eingaben,
  Vollständigkeitsflag), komponiert nach OCCTs Algebra; ersetzt
  `boolean_result` in `kernel/identity.bend`.
- **Nutzen:** entfernt die Heuristik, die echte Flächen gelöscht hat; macht
  recover billiger (48 % der Hybrid-Zeit bei 18 Threads); jede Kante bekommt
  eine Ursache, die Namen, Diffs und LLM-Erklärungen brauchen.
- **Bend:** exzellent, U32-Tupel pro Dreieck/Kante, Sortieren plus
  segmentierte Reduktion.
- **Risiko:** Weld und 2^-36-Kollaps machen Provenienz zu Mengen;
  inkonsistente Mengen müssen verweigert werden; Drahtformat wächst.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** auf den 38 Korpusfällen gleichen die
  Provenienzpaare recovers abgeleiteten Paaren (0 Abweichungen); recover mit
  Provenienz ist auf den 32 exakten Fällen byte-identisch; die Algebra
  komponiert M12(a)={b}, removed23(b), G23(b)={c} zu G13(a)={c}.
- **Quellen:** [mesh-booleans.md](mesh-booleans.md) P3;
  [fringe-kernels.md](fringe-kernels.md) F3;
  [brep-booleans-ssi.md](brep-booleans-ssi.md) P9;
  [topology-identity-data-structures.md](topology-identity-data-structures.md) P1.

**B4. Metamorphe Suite, Toleranzband-Sweeps, Ketten-CSG**

- **Idee:** (a) 48 vorzeichenbehaftete Achsenpermutationen, 2^k-Skalierung,
  Operandentausch, Mengenidentitäten (vol(A∪B)+vol(A∩B) = vol(A)+vol(B)) über
  alle 38 Korpus- und 216 adversarialen Fälle, verglichen nach exakter
  Rücktransformation. (b) Für jede benannte Toleranzkonstante Spalten,
  Häute und Streifschnitte bei c·{1/1000, 1/2, 1, 2, 1000} mit
  aufgeschriebenem Erwartungswert. (c) Solidean-Würfelgitter in drei
  dyadischen Varianten gegen ein exaktes Zellorakel, Kettenlänge 53 bis
  über 1000.
- **Nutzen:** 50-100x mehr Abdeckung ohne Orakelkosten; hätte beide
  Vereinigungsdefekte (2^-40) vor dem Verifier gefunden; erste
  Kettenmessung unter double-Präzision überhaupt.
- **Bend:** keine Kernel-Änderung; Transformationen sind auf dem F32x2-Draht
  exakt.
- **Risiko:** Laufzeit (nächtlich auf cpu18, Stichprobe in `npm test`);
  exakt degenerierte Fälle dürfen je Rahmen verschieden auflösen, dann nennt
  die Relation die Anforderung.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** 38 Korpusfälle × 48 Permutationen plus 2^±3 auf JS
  und cpu1 geben dieselbe Urteilsklasse; ein Transformer mit absichtlichem
  Windungsfehler wird erkannt; die Toleranz 2^-40 in einer Kopie wird von der
  Haut-Sweep als falsches `ok` gemeldet; 3x3x3-Gitter (Variante c) stimmt in
  allen 53 Schritten mit dem Zellorakel.
- **Quellen:** [testing-validation.md](testing-validation.md) P1, P2;
  [mesh-booleans.md](mesh-booleans.md) P1; [fringe-kernels.md](fringe-kernels.md) F1.

**B5. Toleranz-Ledger und stabile Fehlercodes**

- **Idee:** Jede Stelle, die einen Abstand mit einer Toleranz vergleicht,
  schreibt `Tol{site, a, b, measured, err, limit, decision}`; jede
  toleranzbedingte Verweigerung nennt `needed.merge` und
  `needed.deviation` und ihre Lage relativ zu FS `zeroLength` (1e-5 mm) und
  `booleanDefaultTolerance` (0,01 mm). Jede Verweigerung bekommt einen
  stabilen Code aus einer Registry (Kategorie, Fähigkeitszelle, Permanenz,
  Budget, Sicherheitsklasse), Codes werden nur hinzugefügt.
- **Nutzen:** Verweigerungen werden handlungsfähig (Fläche um X verschieben,
  Budget heben, feiner tessellieren); LLMs verzweigen auf Codes statt Prosa;
  schließt Entscheidung 10 für Booleans und Fillets.
- **Bend:** gut, Datensätze aus U32-IDs und F32x2-Abständen, die jede Stelle
  schon berechnet; sortiert nach (site, a, b).
- **Risiko:** ein falsches `err` macht „needed" irreführend; ein opt-in
  Budget darf nie Default werden (sonst kehrt der 1e-11-mm-Haut-Bug zurück).
- **Aufwand:** mittel.
- **Erster Abnahmetest:** der 2e-11-mm-Haut-Fall verweigert weiter, jetzt mit
  `needed.merge` = 2e-11 mm ± err, byte-identisch auf vier Targets; jede
  Verweigerung in `npm test` und den vier Suites trägt einen registrierten
  Code; ein Test scheitert an einer uncodierten Stelle.
- **Quellen:** [commercial-kernels.md](commercial-kernels.md) C1;
  [fringe-kernels.md](fringe-kernels.md) F4; [llm-code-cad.md](llm-code-cad.md)
  P2; [fillets-blends-offsets.md](fillets-blends-offsets.md) P5.

**B6. Algorithmus-Versionsvektor am FeatureScript-Header**

- **Idee:** `{tessellation, corefine, unify, recover, certificates, checker,
  fillet}` als U32-Versionen in `operationEvidence`, `brep.json` und
  Job-Header; eine Tabelle ordnet FS-Header-Bereichen Vektoren zu; ein
  Golden-Test speichert Vektor plus kanonischen Ausgabe-Hash je Fall; eine
  Ausgabeänderung ohne Versionssprung scheitert und nennt die Fälle.
- **Nutzen:** reproduzierbare Regeneration deiner gepinnten Dokumente; jede
  Verhaltensänderung wird sichtbar. Billige Versicherung gegen die
  BEL-110102- und Zoo-#13200-Klasse, solange wonkys Toleranzen noch wandern.
- **Bend:** nur Daten; ein U32 im Job-Header wählt die Variante einmal pro
  Job.
- **Risiko:** alte Varianten lebendig zu halten kostet Code, die Politik muss
  „Bruch markieren" erlauben.
- **Aufwand:** klein.
- **Erster Abnahmetest:** 2^-44 → 2^-43 ohne Versionssprung lässt den
  Golden-Test scheitern und listet genau die geänderten Fälle; mit Sprung
  läuft er, und die r10b/R20-Fixtures (Header 3044) melden den Vektor.
- **Quellen:** [commercial-kernels.md](commercial-kernels.md) C2, §3.7.

**B7. Typisierte Platzierungen, exakte Sonderwinkel**

- **Idee:** Eine Platzierungs-IR mit Formtag (`identity`, `translation`,
  `signedPermutation` inklusive Paritätsbit, `axisRotation` mit exakten
  Grad, `pattern{axis, k, N}`, `general`). `rotationAround` um eine
  Koordinatenachse mit Vielfachen von 90° und `mirrorAcross` an
  Koordinatenebenen werden exakte Permutationen; Grad werden als exakte
  Rationalzahl durchgereicht; Trigonometrie in `kernel/real.bend` über
  exakte Turn/Grad-Reduktion.
- **Nutzen:** 24 von 39 Literalwinkel-Rotationen und 14 von 21 Spiegelungen
  deines Korpus werden exakt; gedrehte achsparallele Träger bleiben exakt
  achsparallel, die Spiegel-Verweigerung für Koordinatenebenen fällt weg;
  `sin(180°)` wird exakt 0.
- **Bend:** perfekt, Wortvertauschungen und Vorzeichenwechsel, keine
  Arithmetik; Trig-Tabellen uniform.
- **Risiko:** gering; Parität muss auf jeder Körperart getestet werden.
- **Aufwand:** klein.
- **Erster Abnahmetest:** ein Block mit bündiger Tasche, um 90° um z gedreht
  und an x = 0 gespiegelt, als Ganzes und als getrennte Operanden
  geboolt: Ergebnis wortgleich mit dem exakt transformierten ungedrehten
  Fall, kein `AmbiguousContact`; der D03-Sektor hat y exakt 0.
- **Quellen:** [Frames-Addendum](addenda/frames-rigid-transforms-and-trigonometry-in-f32x2-exact-spec.md)
  P1-P3; [mesh-booleans.md](mesh-booleans.md) §6 Q3.

### Stufe B

**B8. Exakter Trägerpaar-Klassifikator plus Hyperbel und Parabel**

- **Idee:** Ein Bend-Modul bildet jedes Trägerpaar plus Toleranz auf
  `Disjoint{gapLowerBound} | Transversal{curveKind} | Tangent{line|circle|point}
  | Coincident | Unresolved` ab, entschieden durch exakte Vorzeichen auf den
  gespeicherten Wörtern (z. B. n·a = 0, n×a = 0, sign(d² − r²|n|²)); deckt die
  Kegelschnittzeilen von Miller-Goldman und die Tangenztests von
  Shene-Johnstone; `analytic.Curve` bekommt Hyperbel und Parabel; die 26
  Freitext-Verweigerungen und festen Schwellen in `geom.bend` werden
  typisierte Codes. Kegel mit exakter Steigung speichern.
- **Nutzen:** Tangenz und Koinzidenz werden Entscheidungen statt Toleranzen;
  Senkungen mit gekippten Ebenen und die halbe hex-nut werden exakt;
  Voraussetzung für B9, B12 und die Fillet-„passt"-Prädikate.
- **Bend:** exzellent, O(1)-Funktionen auf kleinen Datensätzen, Grad ≤ 4
  (Tori mehr), feste Limbzahl, nach Paartyp gebündelt uniform.
- **Risiko:** exakt auf den Wörtern ist nicht gleich Designabsicht (1e-13
  gedrehte koplanare Flächen), die Absichtsebene bleibt getrennt und
  protokolliert; STEP-Leser müssen HYPERBOLA/PARABOLA auf CONICAL_SURFACE
  akzeptieren (ungeprüft).
- **Aufwand:** mittel.
- **Erster Abnahmetest:** etwa 30 FS-Trägerpaar-Fixtures plus um 1e-9 mm /
  2^-40 rad gestörte Zwillinge: jede Relation korrekt, byte-identisch auf
  vier Targets, kein Epsilon-Literal im Klassifikator; ein Sechskantprisma
  minus Fasenkegel ohne Tangenz ist exakt und besteht strikte STEP-Prüfung.
- **Quellen:** [oss-brep-kernels.md](oss-brep-kernels.md) R1;
  [brep-booleans-ssi.md](brep-booleans-ssi.md) P1.

**B9. Steinmetz-Ecken und tangentiale Vertices**

- **Idee:** Ecken mit nur zwei Trägerklassen aus dem Büschel λA+B bauen
  (rationale Wurzel λ0 mit Rang-2-Mitglied → Ebenenpaar → zwei Ellipsen, die
  recover schon hat; Vertices als singuläre Punkte). Tangentiale Vertices
  (heute „degenerate tangent vertex") über die Differenz der zweiten
  Fundamentalformen klassifizieren (definit, indefinit, singulär) und
  Überlappsektoren mit Mäntyläs korrigierter ON-Regel auflösen.
- **Nutzen:** steinmetz-intersect, steinmetz-union und zusammen mit B8
  hex-nut werden exakt; die Klasse von SolveSpace #1268 (Würfel plus
  tangentialer Zylinder) wird Entscheidung statt Verweigerung.
- **Bend:** gut, 4x4-Integermatrizen, rationale Wurzel- und Rangtests auf
  Limbs; pro Vertex unabhängig, aber nicht uniform, also CPU-fork-join.
- **Risiko:** nur für rationales λ0 (gleiche Radien, dyadische Eingaben),
  sonst benannte Verweigerung; Kontakt höherer Ordnung verweigert.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** steinmetz-intersect exakt mit Volumen 16r³/3 auf
  1e-12 relativ und strikter STEP; hex-nut exakt mit Volumen innerhalb 1e-7;
  die 1e-9-mm-Zwillinge exakt oder benannt verweigert, nie falsch.
- **Quellen:** [brep-booleans-ssi.md](brep-booleans-ssi.md) P3, P4;
  [oss-brep-kernels.md](oss-brep-kernels.md) R2.

**B10. Kanonisches Abtastgitter pro Kreis**

- **Idee:** Jeden Kreis aus einem globalen Winkelgitter abtasten, das am
  Kreis hängt (Zentrum, vorzeichenkanonische Normale, Radius), nicht am Bogen;
  kanonischer Rahmen, Stützzahl auf einer Leiter wie 3·2^k, Winkel k·2π/n aus
  exaktem k; Bögen emittieren die Gitterpunkte innerhalb plus ihre
  B-rep-Endpunkte. Zylinder-, Kegel-, Kugel- und Torusnetze nutzen dasselbe
  Gitter.
- **Nutzen:** koinzidente Kurven verschiedener Blätter teilen ihre Samples
  Bit für Bit; das entfernt die Ursache, die der Plan für recovers Slivers
  nennt (plate-countersink absorbiert heute 36); weniger Dreiecke.
- **Bend:** jedes Sample ist reine Funktion von (Kreisschlüssel, k, n), also
  uniform und GPU-förmig.
- **Risiko:** gedrehte Blätter haben in den letzten Bits andere Normalen,
  Rahmen besser aus den `unify.bend`-Klassen ableiten (oder aus B7); jede
  Tessellierung ändert sich, bewusste Neu-Baseline hinter einem Flag.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** zwei Bögen auf einem Kreis aus gedrehten
  Eingaberahmen geben byte-identische geteilte Samples auf vier Targets;
  plate-countersink exakt mit 0 absorbierten Slivers; weiterhin 32 exakte
  Korpusfälle; plate-hole-grid-10x10 höchstens +10 % Dreiecke.
- **Quellen:** [fringe-kernels.md](fringe-kernels.md) F2
  ([Fornjot](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md),
  [vcad](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md)).

**B11. Deklarierte Kontakte, exakt geprüft**

- **Idee:** Ein optionaler Job-Abschnitt deklariert (tagA, tagB, Relation,
  Kurve?) mit Relation gleicher Träger, gegenläufig gleicher Träger,
  tangential entlang einer Kurve, anliegend. Quellen: der FS-Evaluator
  (gleiche Skizzenebene, geteilte Offset-Ausdrücke, Pattern-Instanzen) und
  Fillet-Kandidat B. Jede Deklaration wird exakt verifiziert; eine falsche wird
  benannte Verweigerung mit Ledger-Eintrag, nie ACIS' „undefined".
- **Nutzen:** die beabsichtigten Koinzidenzen deiner Modelle werden durch
  Konstruktion exakt, statt über 2^-44-Vereinigung gerundeter
  Transformationen; entsperrt Fillet B; ACIS maß für Glue große Speedups.
- **Bend:** gut, flaches Deklarationsarray, ein exaktes Prädikat pro Eintrag.
- **Risiko:** der Interpreter muss Konstruktionsprovenienz führen; gedrehte
  Kopien müssen als gleicher Trägerdatensatz deklariert werden.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** zwei Extrusionen aus einer Skizzenebene liefern
  eine Deklaration; die 14 gedrehten koplanaren Fälle geben mit
  Vereinigung aus und Deklarationen an dieselbe kanonische Ausgabe; eine
  falsche Deklaration um 1e-9 mm verweigert benannt auf vier Targets.
- **Quellen:** [commercial-kernels.md](commercial-kernels.md) C3;
  [fillets-blends-offsets.md](fillets-blends-offsets.md) P4;
  [mesh-booleans.md](mesh-booleans.md) §6 Q3.

**B12. Lokale Verfeinerung statt Clearance-Verweigerung**

- **Idee:** Wenn B8 ein nahes Paar als `Disjoint` mit Lückenschranke g > 0
  (oder als transversal mit getrennten Kurven) beweist, nur diese Blätter mit
  Abweichung < g/3 neu tessellieren und erneut rechnen, in begrenzten Runden
  (höchstens drei Halbierungen oder ein Dreiecksbudget); unterhalb einer
  deklarierten Untergrenze (etwa 1e-6 mm) benannt verweigern. Echte Tangenz
  bleibt Verweigerung, jetzt mit Namen.
- **Nutzen:** etwa zehn „Topologie auf Toleranzniveau"-Verweigerungen
  realer FDM-Geometrie (Boss sticht 0,005 durch, Bohrung bricht oben 0,005
  durch, 1-µm-Wände) werden exakt.
- **Bend:** gut, Neutessellierung pro Blatt ist eine Map, der Retry-Treiber
  kurz, sequentiell, mit hartem Deckel.
- **Risiko:** Dreiecke wachsen 4x pro Halbierung; gemischte Abweichungen
  müssen an geteilten Kanten wasserdicht bleiben (Fornjot #1937), also
  zuerst ganze Blätter verfeinern.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** die zehn Toleranzniveau-Fälle sind exakt (1e-9
  relatives Volumen) oder nennen eine Lücke unter der Untergrenze; 0 falsche
  `ok` auf 216 Fällen; Korpus-Laufzeit höchstens 1,1x;
  cylinder-tangent-box-face bleibt erwartete Verweigerung mit Namen.
- **Quellen:** [oss-brep-kernels.md](oss-brep-kernels.md) R7;
  [brep-booleans-ssi.md](brep-booleans-ssi.md) P6.

**B13. `opOffsetFace` mit Intersection-Join, exakt auf dem Trägerzoo**

- **Idee:** `@opOffsetFace` für alle Flächen eines Körpers oder eine
  Flächenmenge mit Parasolid/Onshape-Intersection-Join-Semantik (zuerst
  proben). Träger versetzen sich exakt (Ebene verschieben, Zylinder- und
  Kugelradius ± d, Kegelradius ρ0 + d/cos α, Torus-Nebenradius ± d);
  Nachbarn per analytischer SSI neu schneiden; Topologieänderungen exakt
  erkennen und in v1 verweigern (`OffsetCollapse`, `OffsetFaceVanishes`,
  `OffsetVertexSplit`).
- **Nutzen:** deckt die dominante Offset-Nutzung ab: 51
  Passungs-Aufrufe (+0,15 mm) in 67 FS-Dateien, weit mehr als `opShell`
  (1 Datei); multipliziert sich mit der Boolean-Integration, weil das
  Offset-Werkzeug danach geschnitten wird.
- **Bend:** Trägerversatz ist eine uniforme Map, Neuschnitt fork-join über
  Nachbarpaare, Kollapstests skalar.
- **Risiko:** Onshapes Join-Semantik ist ungeprobt (scharf gegen rund,
  Splits an Valenz-4-Vertices); importierte B-Spline-Flächen brauchen
  Verweigerung oder eine gelabelte Näherung.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** Box 10×20×30 um +0,15 ergibt exakt
  10,3×20,3×30,3; Zylinder r = 4, h = 77 ergibt r = 4,15, h = 77,3; −6 auf
  einer 10-mm-Box verweigert typisiert, nie ein umgestülpter Körper.
- **Quellen:** [fillets-blends-offsets.md](fillets-blends-offsets.md) P3,
  §1.8.

**B14. Namen durch Booleans: Creator-Sets, Split/Merge-Status**

- **Idee:** Aus B3 pro Fläche, Kante und Vertex `CreatedBy` nach
  FeatureScript-Regeln ableiten (Generated → {op}; eins-zu-eins Modified
  behält; Split fügt op hinzu; Merge vereinigt plus op), sodass
  `qCreatedBy(id, FACE)` Entitäten filtert statt ganze Körper;
  `matchTopologyReference` um `split`, `merged`, `deleted-with-generated`
  erweitern, nie „den ersten" eines Splits liefern; Eigentümermengen durch die
  Trägervereinigung tragen; Schnittkanten über geordnetes Stützflächenpaar
  plus exaktes Halbraum-Vorzeichen benennen.
- **Nutzen:** Fillet- und Fasenauswahl nach Feature (FDM-Bodenkanten) hängt
  daran; Referenzen überleben Boolean-Edits; der Viewer und das LLM sehen
  „Fläche in 2 geteilt" statt „unsupported".
- **Bend:** sortierte U32-Listen, Merge plus Unique, Joins; keine Floats.
- **Risiko:** Onshapes Vererbung von Creators und Caps durch Booleans mit
  getrenntem Werkzeug ist nicht dokumentiert, also einmal als Orakel
  einfrieren; bestehende Korpus-Ergebnisse können sich ändern.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** Block a, Werkzeug b, Subtraktion c:
  `qCreatedBy(a, FACE)` enthält die Schnittwände nicht mehr; ein
  Durchgangsschlitz teilt `box.cap/end` → `split` mit 2 Flächen, Löschen des
  Schlitzes → wieder eindeutig; gleich große sich kreuzende Bohrungen liefern
  `ambiguous`.
- **Quellen:** [topology-identity-data-structures.md](topology-identity-data-structures.md)
  P2-P5; [oss-brep-kernels.md](oss-brep-kernels.md) R8.

**B15. Agenten-Ergebnis-Envelope und dünne MCP-Schicht**

- **Idee:** Ein Schema (`wonky-agent-result/1`) für Build, Summary, Messung,
  Check, Diff und Boolean-Evidenz: khana-Urteile, [lo, hi]-Intervalle mit
  Labels exact/bounded/estimate/approximation, Einheiten, Revisions-Hash,
  Abdeckung (was lief, was übersprungen wurde, warum); Anforderungen einzeln
  mit Residuum, die Zahl offener Anforderungen zuerst, kein einzelnes
  `conforms`. Ausnahmen, Timeouts und leere Selektionen werden `unresolved`
  oder `refused`. Darüber höchstens fünf MCP-Tools (build, inspect, check,
  diff, render als sekundär) über der CLI, reine Builds, Revisions-Handles.
  Dazu Rahmen und Effekte in jedem Feature-Record (Skizzenebene in
  Weltkoordinaten, Volumen-Delta, Treffer jeder Query).
- **Nutzen:** schließt konstruktiv die Klasse „Fehler als Zahl" (#381,
  CADBench 0.0, INFO als ok); macht den Arbeitsebenen-Fehler vor jedem
  Rendering sichtbar; bekanntes Token-Budget.
- **Bend:** nur Host; Labels und Intervalle kommen aus Bend.
- **Risiko:** Ausführlichkeit (Concise-Modus nötig); Agenten könnten
  `unresolved` als Bestanden lesen, das misst der Eval-Harness.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** Fehlerinjektion (Throw, Skip, leere Selektion,
  Timeout) liefert nie `ok` oder 0; ein Concise-Build von r10b-retained
  bleibt unter 2.000 Tokens; die CLI liefert byte-identisches JSON.
- **Quellen:** [llm-code-cad.md](llm-code-cad.md) P1, P2, P4, P6.

**B16. Zertifizierter Vergleich und Clash-Taxonomie**

- **Idee:** `clash(a, b)` liefert disjoint (mit zertifizierter Clearance),
  abutment (Flächen-, Kanten-, Punktkontakt mit Tag-Paaren und Zeugen),
  interference (Volumen, Komponenten), containment oder undecided mit Grund.
  Allgemeiner Vergleich als zertifiziertes Hausdorff-Intervall nach Metro
  (neu implementiert, nicht aus GPL vcglib): deterministisches
  Gitter-Sampling, exakter Punkt-Dreieck-Abstand, Überdeckungsradius, also
  [untere, obere] Schranke mit pass/fail/undecided. Clearance nach Rossignac
  als exakte Abstandsabfrage zwischen Trägern.
- **Nutzen:** echte Passungsprüfung (Pin r = 2,9 in Bohrung r = 3,1 ergibt
  0,2) ohne Offsets; macht R20s Stichproben-Untergrenze zu einer echten
  Aussage; Revisions-Diff im Viewer mit entferntem und hinzugefügtem Material
  samt Quellflächen.
- **Bend:** exzellent, Sample-Map und Max/Summen-Reduktion fork-join,
  uniform pro Sample-Dreieck-Paar.
- **Risiko:** Anlage ist genau das Kontaktregime, in dem corefine heute
  verweigert, also zuerst `undecided`; feine Gitter sind in JS langsam.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** zwei Blöcke 0,2 mm auseinander geben Clearance 0,2
  auf 1e-9 mm; überlappende Boxen geben interference 1500 mm³ exakt; eine
  0,3-mm-Delle scheitert mit unterer Schranke ≥ 0,286; jedes Intervall der 16
  R20-Fälle enthält den heutigen Stichprobenwert.
- **Quellen:** [testing-validation.md](testing-validation.md) P4;
  [commercial-kernels.md](commercial-kernels.md) C5;
  [fillets-blends-offsets.md](fillets-blends-offsets.md) P7;
  [fringe-kernels.md](fringe-kernels.md) F7.

### Stufe C

**B17. Fillet-Leiter exakt, Stufe 3 als rein funktionale Chirurgie**

- **Idee:** Jede Zulassungsentscheidung der Fillet/Fasen-Leiter als
  Vorzeichen eines Polynoms in gespeicherten Werten (Konvexität, Flächenpassung
  quadriert, Kugelecken-Konkurrenz als 4x4-Determinante) über
  `kernel/robust-predicates.bend`, sonst typisiertes „undecidable". Stufe 3
  als Schrumpfen-und-Verschlucken-Lauf nach dem abgelaufenen HP-Patent
  US5615317A, mit KEV/KBFV als reinen Rewrites; danach Lückentest an jedem
  berührten Vertex, globale BVH-Interferenzprüfung, (F,E,V) und Volumen müssen
  sich ändern; Provenienz-Ereignisse.
- **Nutzen:** Fillets v1 werden baubar und byte-identisch über Targets;
  Endkappen, Gehrungen, Kugelecken und Full Rounds (wo OCCT scheitert);
  Defillet wird eine Abfrage.
- **Bend:** Entscheidungen einmal pro Kante, uniform; die Läufe sind
  irregulär aber pro Stripe-Ende unabhängig (CPU-fork-join); Persistenz macht
  Backtracking gratis.
- **Risiko:** Grad steigt ohne Wurzeln; Saum auf periodischen Flächen;
  Bend-Verbosität.
- **Aufwand:** groß.
- **Erster Abnahmetest:** roundX mit ΔV = −(4−π)r²a und F=10, E=24, V=16;
  alle 12 Kanten ergeben das Steiner-Volumen mit F=26, E=48, V=24; der
  Verdikt-Umschlag liegt exakt an der rationalen Schwelle, identisch auf vier
  Targets; der ACIS-„pocket lost"-Fall behält die Tasche oder verweigert.
- **Quellen:** [fillets-blends-offsets.md](fillets-blends-offsets.md) P1,
  P2, P6.

**B18. Zertifizierte Raumquartik-Kurve**

- **Idee:** Ein neuer Kurventyp für nicht-konische Trägerpaare: zwei Träger,
  Astindex, exakte Parametrisierung über das Generator-Chart (eine
  quadratische Gleichung pro Erzeugender; für Zylinder/Zylinder OCCTs
  geschlossene Form), Morphologie exakt auf Limbs (quadratfreier Teil, ggT,
  Sturm), Astpunkte mit QFNumber isoliert, zertifizierte B-Spline mit
  Hausdorff-Schranke nur für STEP; nahe Astpunkten
  `Unresolved{IllConditionedBranch}`.
- **Nutzen:** schließt die häufigsten nicht-planaren FDM-Schnitte:
  Querbohrungen, T-Stücke, Bohrung durch Kugel, Senkung mit Querbohrung.
- **Bend:** exakte Stufe klein und verzweigt (CPU, etwa 7-25 Limbs);
  Auswertung uniform pro Sample (GPU-fähig, dient Tessellierung und
  Druckmesh).
- **Risiko:** das größte Einzelstück: Format- und Exporter-Änderungen,
  Zertifizierungskosten, Singularität der Geschwindigkeit an Astpunkten.
- **Aufwand:** groß.
- **Erster Abnahmetest:** pipe-tee und x-rod-cross-hole intern exakt
  (Samples innerhalb 1e-12 mm beider Implizitflächen), strikte STEP mit
  B-Spline-Abweichung ≤ 1e-6 mm; eine Radiusverhältnis-Sweep 1 ± 2^-k (k =
  4..40) ist zertifiziert oder verweigert, nie falsch.
- **Quellen:** [brep-booleans-ssi.md](brep-booleans-ssi.md) P5, P8;
  [oss-brep-kernels.md](oss-brep-kernels.md) R4;
  [fringe-kernels.md](fringe-kernels.md) F6.

**B19. Festbreiten-Limbs und Prädikatgenerator**

- **Idee:** Die variablen `List<U32>`-Bigs in den exakten Stufen (Gate,
  exact-plane `big.bend`, `robust-predicates.bend`) durch statisch große
  U32-Datensätze mit 16-Bit-Limbs ersetzen, Breite pro Teilausdruck aus Grad
  und deklariertem Eingabebereich (GTE `BSPrecision`, Fortune-Van Wyk). Ein
  Build-Zeit-Generator macht aus einem Polynom drei Bend-Funktionen:
  F32x2-Filter mit Fehlerkonstante, strukturelle Nullmuster, exakte
  Festbreite, SoS-Kaskade. Außerhalb des Vertrags `CapacityExceeded`.
  Upstream ein U32-`mulhi` für Bend anfragen.
- **Nutzen:** vorhersagbare, allokationsfreie exakte Arbeit; geschätzt 5-10x
  schnellere exakte Stufe (die Lücke zu NW21 ist 175x, davon nur 16x
  Limb-Strafe); macht Metal-Batches exakter Arbeit erstmals möglich; ersetzt
  etwa zehn handhergeleitete Schranken.
- **Bend:** die bestmögliche Passung: feste Form, keine Allokation,
  verzweigungsfrei.
- **Risiko:** Generatorfehler sind systematisch (gegen B4 und die
  bestehenden Bigs testen); große Datensätze treffen Bends
  „arity over 255"-Grenze.
- **Aufwand:** groß.
- **Erster Abnahmetest:** pred-bench exakte Klassifikation von 6,0 µs auf
  ≤ 1,0 µs, 10^6 Prädikate bit-gleich mit den heutigen Bigs; der Generator
  reproduziert GTEs dokumentierte Budgets und `big.bend`s 325 Bit; exact-plane
  bleibt byte-identisch.
- **Quellen:** [mesh-booleans.md](mesh-booleans.md) P8;
  [robust-numerics.md](robust-numerics.md) P4, P5;
  [oss-brep-kernels.md](oss-brep-kernels.md) R5;
  [parallel-gpu-geometry.md](parallel-gpu-geometry.md) P4.

**B20. Typisierter B-rep-Checker in Bend**

- **Idee:** Ein geordneter Checker für exakte B-reps: Stufe 0 U32-Topologie
  (aus `topology-spec.bend`), Stufe 1 Träger-Wohlgeformtheit, Stufe 2 exakte
  oder beschränkte Inzidenz per algebraischer Identität pro Trägerpaar,
  Stufe 3 Schleifenorientierung und -schachtelung, Stufe 4
  Schalenorientierung, Stufe 5 opt-in Flächen-Disjunktheit. Bericht mit
  checked/invalid/indeterminate/cancelled, Abdeckung pro Stufe, sortierter
  Fehlerliste mit Codes, Entitäten, Zeuge, Residuum und Schranke. Nie heilen.
- **Nutzen:** die erste produktive Gültigkeitsprüfung für gekrümmte
  Ergebnisse (heute prüft OCCT nur in Tests); läuft nach recover, nach der
  Vereinigung und vor STEP; Vor- und Nachbedingung für Fillets.
- **Bend:** gut, Maps pro Entität, fork-join-Reduktionen, Paartests nach
  Trägertyp gebündelt.
- **Risiko:** ein falscher Checker ist schlimmer als keiner, braucht
  Mutations-Fixtures und Differenzläufe gegen OCCT.
- **Aufwand:** groß.
- **Erster Abnahmetest:** 12 Einzel-Invarianten-Mutationen aus ACIS' Katalog
  liefern genau ihren Code; die 32 exakten Korpusergebnisse sind „checked" mit
  byte-identischem Bericht auf JS und cpu1; KT1 ist „indeterminate" in Stufe 2.
- **Quellen:** [testing-validation.md](testing-validation.md) P3;
  [oss-brep-kernels.md](oss-brep-kernels.md) R6;
  [commercial-kernels.md](commercial-kernels.md) §3.6.

**B21. khana-FDM-Prüfkern**

- **Idee:** design.md §5.7-5.8 wie entworfen: exakte Überhangbänder pro
  Fläche; eine Brücke ist eine Region, deren minimale Breite in der
  Profilspannweite liegt und die beidseitig in Nicht-Kandidaten-Material
  verankert ist; Wandzertifikat aus Flächenpaarabständen (Normalen ≥ 120°
  auseinander); Messerkanten (< 60°) und Luftspalte getrennt; jedes Urteil
  dreiwertig mit Zeugen. Danach ein Druckprofil mit gerichtetem,
  kalibriertem Passungsmodell und von wonky erzeugten Kalibriercoupons.
- **Nutzen:** repariert die zwei Prüfungen, die du am häufigsten abschaltest
  (52/175 Überhang, 59/61 Fehler sind Wände); ersetzt die Ø12-Ausnahme und den
  Zwei-Sonden-Test; Wände exakt statt 0,05-mm-Selbsttreffer.
- **Bend:** gut, geschlossene Formen pro Fläche und Flächenpaar in F32x2,
  fork-join über Paare, begrenzte zertifizierte 1D-Suche.
- **Risiko:** Q6 (Abstand) und Q10 (minimale Regionsbreite) sind neue große
  Kernel-Stücke; v1 nur Ebene, Zylinder, Kegel.
- **Aufwand:** groß.
- **Erster Abnahmetest:** 45°-Senkung hat keinen Kandidaten; horizontale
  Ø20-Bohrung ergibt eine 14,14-mm-Brücke und scheitert bei 10 mm; eine
  20-mm-Platte mit Ø60-Bohrung hat Wandstärke exakt 20.
- **Quellen:** [fdm-geometry.md](fdm-geometry.md) R1, R2;
  [../khana/design.md](../khana/design.md).

**B22. Zertifizierter Druck-Export (3MF, Snap-Rounding)**

- **Idee:** `src/print-mesh.mjs` auf Ellipsenkanten und hybrid-rückgewonnene
  Flächen erweitern, Abweichung aus dem Profil plus halbes float32-ulp,
  3MF Core mit Abweichung und Profil in Metadaten. Beim Runden auf F32
  exakten Selbstschnitt-Check; bei Treffern die Snapping-Hälfte von
  Valque-Lazard auf ein grobes Zweierpotenz-Gitter (z. B. 2^-10 mm), höchstens
  fünf Runden, sonst benannt verweigern.
- **Nutzen:** ersetzt die zweite, unkontrollierte Tessellierung des Slicers;
  wasserdicht mit einer zertifizierten Zahl in der Datei; STL garantiert
  selbstschnittfrei (die 24-gegen-53-Bit-Reserve des Papers fehlt bei F32).
- **Bend:** gut, Rundung, Broad Phase, Sort-Unique der Zellen sind uniform.
- **Risiko:** Netzgröße bei engen Schranken; Snapping kann dünne Features
  kollabieren, die Schranke muss unter der FDM-Toleranz bleiben.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** gebohrte Platte und ebenengeschnittener Zylinder
  exportieren mit jeder Kante genau zweimal benutzt, unabhängiger Validator
  bestätigt die Schranke; STL von pipe-tee und beiden Steinmetz-Ergebnissen
  besteht einen exakten Selbstschnitt-Check.
- **Quellen:** [fdm-geometry.md](fdm-geometry.md) R6;
  [oss-brep-kernels.md](oss-brep-kernels.md) R9;
  [mesh-booleans.md](mesh-booleans.md) P6.

**B23. Skizzenregionen exakt, danach skText**

- **Idee:** Onshape-Regionsemantik als Fixtures plus eine Probe; exaktes
  Linien/Kreis-Arrangement in Bend auf einem skizzenlokalen 48-Bit-Gitter mit
  One-Root-Vertices, Devillers-Ordnung, F32x2-Filter und exaktem Fallback
  (Batch-Pässe statt Sweep); eine explizite Toleranzschicht auf FS
  `zeroLength`; stabile Regionsnamen. Darauf skText: gepinntes Open Sans
  v1.10, Onshape-Layout exakt in Bend, Parabel als Träger, 2,5D-Gravur-Arm.
- **Nutzen:** `qSketchRegion` in 486 Dateien, 217 davon mit
  `filterInnerLoops`; `skText` in 174 Dateien, meist Revisionsmarken, heute
  Blocker für 18 Einheiten.
- **Bend:** Maps, Sorts, Pointer-Jumping; feste Integer (≤ etwa 600 Bit,
  19 Limbs).
- **Risiko:** Tie-Break der Tangentenrichtung an Vertices und
  Überlappbehandlung sind die klassischen Fehlerquellen (CGAL #8468); zu
  lockere Toleranzregeln verschmelzen echte Features.
- **Aufwand:** groß.
- **Erster Abnahmetest:** `line-arc-sketch-with-holes.fs` extrudiert,
  validiert, Volumen auf 1e-9 relativ; zwei überlappende Kreise r = 10, d =
  12 geben 3 Flächen mit geschlossenen Flächeninhalten, invariant unter
  Permutation und Umkehr; „CORNER POST R10" reproduziert jeden
  Onshape-Gitterpunkt (359/367 exakt).
- **Quellen:** [2D-Addendum](addenda/exact-2d-arrangements-of-sketch-curves-lines-arcs-conics-wit.md)
  R1-R4, R6; [skText-Addendum](addenda/sktext-as-exact-geometry-truetype-outlines-font-sourcing-and.md)
  P1-P4.

**B24. Lofts: exakte Zuordnungsregeln und ein Bilinear-Träger**

- **Idee:** Parasolids Zuordnungsregeln (n-tes zu n-tem Vertex, sonst
  explizite Imprints, monotone Treppe) mit expliziten Mehrdeutigkeitsfehlern
  und Introspektion; `Bilinear{p00, p10, p01, p11}` als Träger in
  `analytic.bend` mit geschlossener Inversion und Implizitform; ein
  Verdrillungs- und Selbstschnittzertifikat mit Zeugen; danach Booleans, die
  Bilinear-Flächen akzeptieren.
- **Nutzen:** 63 der 83 blockierten Loft-Einheiten brauchen nur Ebenen,
  Kegel und den bilinearen Patch; genau das erzeugt Onshape selbst.
- **Bend:** geschlossene F32x2-Arithmetik, uniform pro Sample; exakte
  Entscheidungen mit 3-7 Limbs.
- **Risiko:** jeder Boolean-Pfad muss eine Quadrik akzeptieren, die weder
  natürlich noch rotationssymmetrisch ist; ohne Boolean-Unterstützung
  wandern die Einheiten nur zum nächsten Blocker.
- **Aufwand:** mittel.
- **Erster Abnahmetest (ABGELEITET aus dem Addendum):** die verdrillten
  Loft-Einheiten bauen; jede Bilinear-Fläche stimmt mit den
  `.RULED_SURF.`-Kontrollpunkten aus Onshapes STEP auf ≤ 1,4e-12 mm überein;
  ein verdrillter Draht nach dem Muster von OCCT #1315 wird mit Zeuge
  verweigert.
- **Quellen:** [Loft-Addendum](addenda/lofts-and-sweeps-ruled-and-skinned-surfaces-vertex-matching-.md)
  P-L1 bis P-L4.

**B25. Parallelität über Operationen und in den sequentiellen Stufen**

- **Idee:** Alle bereiten Booleans einer CSG-Ebene und alle unabhängigen
  Teile in einem balancierten Fork-Baum mit tail-rekursivem Treiber zwischen
  den Ebenen; corefines Union-Find durch deterministische Min-Label-Propagation
  oder Pointer-Jumping ersetzen, Weld durch paralleles Sort-Unique, recovers
  Finish-Stufe pro Fläche forken; die drei Morton/BVH-Implementierungen in
  ein `kernel/lib/spatial.bend` zusammenführen; jeden GPU-Aufruf durch einen
  Helfer mit Mindestarbeit und CPU-Fallback leiten.
- **Nutzen:** die einzige Parallelität mit klarem Spielraum; Mehrteil-Modelle
  skalieren mit der Zahl unabhängiger Operationen statt der 1,46x/1,10x pro
  Boolean.
- **Bend:** gut, wenn der Fork-Baum vor jedem schweren Fork gebaut wird und
  Operanden eindeutig besessen bleiben (sonst die zwei CPU-Fallen).
- **Risiko:** Speicher-Spitzen (eine ganze Ebene lebt gleichzeitig);
  ungleiche Booleans lassen Lanes leer laufen (kein Work-Stealing);
  Determinismus muss byte-identisch bleiben.
- **Aufwand:** mittel.
- **Erster Abnahmetest:** ein Modell mit 20 Bossen macht 1 Hybrid-Aufruf;
  cpu18/cpu1 > 2x auf einem Zweiteil-Modell; corefine und recover je ≥ 2,0x
  cpu1/cpu18 bei höchstens +10 % cpu1-Zeit; Ausgabe byte-identisch.
- **Quellen:** [parallel-gpu-geometry.md](parallel-gpu-geometry.md) P1-P3, P6;
  [mesh-booleans.md](mesh-booleans.md) §6 Q7.

**Bewusst nicht im Backlog** (die Kapitel begründen das): ein globales
1e-5-mm-Epsilon; Metal für Boolean-Topologie; SDF als Boolean; Polyholes
statt exakter Kreise; Arc-Splines als primäre Textdarstellung; ein
XT-Reader, bevor sein Rechtsstatus geklärt ist; das Portieren von
OCCT-, SolveSpace- oder CGAL-Code
([commercial-kernels.md](commercial-kernels.md) §6,
[fdm-geometry.md](fdm-geometry.md) Anti-proposals,
[mesh-booleans.md](mesh-booleans.md) „Not proposed").

---

## 6. Kriegsgeschichten und Anti-Patterns

### 6.1 Warum Kernels gescheitert sind oder aufgegeben wurden

| System | was passiert ist | Lehre | Beleg |
|---|---|---|---|
| **Fornjot** (Rust, 0BSD) | nach knapp 6 Jahren (erster Commit 2020-07-30) und 44 GitHub-Konten als Beitragende (56 einschließlich anonymer Commit-Autoren) archiviert, letzter Push 2026-06-19, ohne 3D-Boolean jenseits disjunkter Gruppierung; „I ran into a cliff", weitere 2-3 Jahre geschätzt; die fertigen Schnitttests waren „basically dead code", Kantenidentität (#993) kostete Monate, globale 3D-Geometrie verlor die (u,v)-Koordinaten an Säumen und Polen | von scheiternden realen Modellen treiben, geteilte Kanten per Konstruktion, (u,v) aus der Konstruktion behalten, Introspektion; „Be a tool instead of a building block" | DOKUMENTIERT, [Shutdown](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md), [Experiment](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md) |
| **CADmium** (auf Truck) | App-Team ohne Kernel-Eigentümer wartete auf Truck; die blockierenden Lücken (#53, #57, #68) waren zwei Jahre später offen; „Add" behielt still den ungemergten Körper, „Remove" berechnete durch einen auskommentierten Komplementaufruf eine Schnittmenge | ein Kernel braucht einen Eigentümer; Fallbacks, die die Eingabe zurückgeben, sind stille Fehler | DOKUMENTIERT/ABGELEITET, [Notiz](sources/cadmium.md) |
| **BRL-CAD libbrep** | NURBS-Boolean seit 2023 ruhend; eine Koplanar-Box-Vereinigung verliert Flächen (#33); Flächen werden mit **einem** Strahl per Parität klassifiziert, innere Schleifen ignoriert | Klassifikation nie mit iterativen Lösern oder Einzelstrahlen | DOKUMENTIERT, [Notiz](sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md) |
| **Blender EMBER-Port** | exakter Kern funktionierte; die Ausgabestufe verschweißte Vertices per `float3`-Gleichheit in einem O(n²)-Scan und clusterte Kanten mit Epsilon; 2025-02 zurückgestellt („quite difficult to get a reasonable, connected mesh") | Materialisierung auf Floats ist der ungelöste Schritt jeder exakten Linie | DOKUMENTIERT, [Issue](sources/blender-issue-114476-exact-boolean-v2-howard-trickey.md) |
| **Manifold CUDA** | Schnitte auf der GPU über 20x schneller, insgesamt nur etwa 2x, weil Triangulierung nicht GPU-parallel ist; CUDA/OMP 2023 abgekündigt, durch TBB ersetzt; ein Metal-PR (#1646) starb am Dispatch-Overhead | GPU nur für uniforme Stufen, Messung end-to-end | DOKUMENTIERT, [Manifold](sources/manifold-elalish-manifold.md), [parallel-gpu-geometry.md](parallel-gpu-geometry.md) §1.2 |
| **ESOLID** | exakt für nicht-degenerierte Eingabe; „cannot be considered a robust system", weil reale Teile voller Degenerationen sind; seit Mitte der 2000er tot | Exaktheit allein reicht nicht, Degenerationen sind der Normalfall in CAD | DOKUMENTIERT, [Notiz](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md) |
| **QI** (exakte Quadrikschnitte) | Quellcode verloren (gforge down, keine Archivkopie), hing an LiDIA, nur der Webserver lebt | Orakel jetzt ernten, bevor sie verschwinden | DOKUMENTIERT, [brep-booleans-ssi.md](brep-booleans-ssi.md) §4.1 |
| **SolveSpace** | #1268 (Würfel plus tangentialer Zylinder) seit 2022 offen; #1291 (filletförmiges Werkzeug) vier Jahre und fünf Fixes, danach brach der Streifschnitt-Fix die Gegenfläche; Erfolg hängt an der Sehnentoleranz (#297) | der Tracker ist eine geordnete Vorhersage von wonkys nächsten Fehlern | DOKUMENTIERT, [Notiz](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md) |
| **OCCT** | lebendig, aber Nutzerberichte (untriagiert, Label „0. New“, ohne Maintainer-Antwort; #1496 vom Melder selbst geschlossen): #1496 leeres Common mit `IsDone()`, #1543 Cut entfernt je nach Saumlage nichts, #1371 Fillet meldet Erfolg bei Selbstschnitt, #1541 `UnifySameDomain` bläht eine Vertex-Toleranz auf den Kreisdurchmesser, #1177 Full Round seit etwa 2015 | Erfolg ist nicht Gültigkeit, Gültigkeit ist nicht Korrektheit; nach jeder Aufräumstufe validieren | DOKUMENTIERT, [oss-brep-kernels.md](oss-brep-kernels.md) §4 |
| **FreeCAD Naming** | Problem seit etwa 2015 bekannt; Element-Map 2024 ausgeliefert und „mitigation, not finished"; Zufallssuffixe in Release-Builds; 27 offene Toponaming-Issues; V2 als Entwurf | Historie nicht in Strings falten; Mengen und Mehrdeutigkeit zurückgeben | DOKUMENTIERT, [Notiz](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md) |
| **Zoo / KCL** | koplanare Vereinigung scheitert (#7485, CEO: „the coplanar bug"), koaxialer Kegel/Zylinder (#10621), reihenfolgeabhängige Subtraktion (#13438), 3-mm-FDM-Platte mit Kabelkerbe (#12578), Fillet bricht nur durch Header-Bump (#13200) | genau deine Teileklasse; Versionierung und exakte Koplanarität | DOKUMENTIERT, [Zoo](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md), [commercial-kernels.md](commercial-kernels.md) §4.3-§4.6 |
| **Agenten-gebaute Kernel 2026** (vcad, remus, keel, forge, Aetheris) | vcad: „every failure was silent", Kugel-Bohrung lieferte die unberührte Kugel; remus #190: stilles Mesh-Fallback mit falschem Volumen; keel: etwa 393 Epsilon-Literale trotz Regel, WRONG nur per Volumen; forge: 340/345 Fähigkeitszellen, aber Parametersweeps beantworten 0-9 % | Behauptungen schrumpfen bei Prüfung; Orakel dürfen nicht das Gate sein; Abdeckung per Sweep, nicht per Zellzählung | DOKUMENTIERT, [fringe-kernels.md](fringe-kernels.md) §4 |
| **Truck** | koinzidente Flächen dokumentiert unsupported (#57 seit Jahren offen); STEP-Export schrieb Fläche 1 an Index 0 (#129); einziger Boolean-Test ohne Assertion; LLM-Fix #110 ohne Review | Tests ohne Assertion prüfen nichts | DOKUMENTIERT, [Notiz](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md) |

### 6.2 wonkys eigene Kriegsgeschichten (GEMESSEN)

- **Die Toleranz, die 1000x zu groß war:** Trägervereinigung bei
  2^-40·scale öffnete eine versiegelte Leere unter einer 2e-11-mm-Haut
  (Fläche 1840 statt 2040), nach dem ersten Fix noch einmal unter einer
  gekippten Fläche; Endwert 2^-44 aus dem Rundungsfehler einer starren
  Transformation hergeleitet ([robust-numerics.md](robust-numerics.md) §4.2).
- **Sliver-Absorption löschte echte Flächen** mit Volumenfehler bis 2,7e-4,
  als exakt gelabelt; recover schrieb eine B-rep eines selbstberührenden
  Körpers aus corefines ungültigem Punktkontakt-Mesh
  ([mesh-booleans.md](mesh-booleans.md) §4.1).
- **Ein Grader teilte den blinden Fleck des Orakels:** recover wurde nur
  gegen OCCTs Fuzzy-CSG bewertet; OCCT und die Vereinigung öffneten dieselbe
  Leere, also „exakt"; OCCT selbst lag bei sphere-minus-cone 1,3e-6 relativ
  daneben ([testing-validation.md](testing-validation.md) §4.2).
- **OCCTs gesampelte Prüfung** akzeptierte eine pcurve, die 1,49e-4 mm neben
  der Kante lag, bei Kantentoleranz 1e-7 mm; neun Exporte mussten
  zurückgestuft werden ([../step-validation.md](../step-validation.md)).
- **R20 ist zehn Größenordnungen lockerer als die Evidenz** und nutzt eine
  gesampelte Hausdorff-Untergrenze als Abnahmekriterium
  ([testing-validation.md](testing-validation.md) §4.2).
- **Bend-spezifisch:** `Bool.pick` wertet beide Zweige aus (rekursive Läufe
  wurden exponentiell, 2 min → 277 ms nach Fix); der ganze Build als
  Metal-Aufruf sprengte den Stack; Datensätze über 255 Wörter brechen den
  nativen Build ([fillets-blends-offsets.md](fillets-blends-offsets.md) §4.1).

### 6.3 Anti-Patterns und die wonky-Regel dagegen

| Anti-Pattern | gesehen bei | wonky-Regel |
|---|---|---|
| Toleranz wächst, bis die Operation gelingt | Jackson, ACIS-Fuzz, Parasolid `set_tol`, OCCT, Zoo, Autodesk | nur innerhalb eines protokollierten Budgets; sonst Verweigerung mit nötiger Toleranz (B5) |
| Erfolg melden, Eingabe zurückgeben oder still auf Mesh fallen | OCCT, remus, BREP.io, CADmium, vcad | jede Stufe liefert ein typisiertes Ergebnis, „nicht entscheidbar" ist eines |
| Fehler als Wert (0.0, [], false, `neither`) | build123d-mcp, CADBench, BenchCAD, CADFit, jarvis | Status plus gelabelte Evidenz (B15) |
| Epsilon auf Prädikaten, Toleranz nicht aus Rundungsmodell | trueform (halbe Vereinigungsmasse vernichtet), keel (bistabiles Band), wonky 2^-40 | Prädikate exakt; Toleranz auf der Eingabe oder als benannte, hergeleitete Vereinigung |
| Identität per Koordinatengleichheit | Manifold #1516, Blender EMBER, Truck `TOLERANCE` | Schweißen per Konstruktion (welche Primitive machten diesen Punkt) (B3, B10) |
| Reihenfolge oder Container bestimmen Ergebnisse | vcad #893 (HashMap plus Umgebungsgröße), Parasolid SMP, Manifold Atomics, Zoo #13438 | Byte-Identität über vier Targets, totale Sortierschlüssel |
| SoS als Semantik | Manifold, SoS-Literatur | `exact_sign` und `sos_sign` trennen; Koplanarpolitik explizit |
| ein Orakel oder nur Volumen prüfen | Carve (Volumen richtig, Fläche +10,7 %), keel, recover-Grader | zwei unabhängige Orakel plus geschlossene Form, dazu Fläche, bbox, offene Kanten |
| Checker, der „keine Fehler" als „gültig" liest oder am ersten Fehler stoppt | Parasolid `max_faults = 0`, OCCT `HasFaulty()`, wonky `validateSolid` | explizit checked/invalid/indeterminate/not-run (B20) |
| Aufräumregeln ohne abnehmendes Maß, Tiefendeckel als „Fix" | Manifold #1842, Smith PDMS | jede Regel mit Maß; Erschöpfung als benannte Verweigerung |
| unversionierte Verhaltensänderung | BEL-110102, Zoo #13200, ACIS `r14_checks` | Versionsvektor plus Golden-Hashes (B6) |
| Formeln aus Papers oder Agenten-Notizen ungeprüft übernehmen | Wallner-Pottmann Gl. (1) (Preprint und beide Notizen falsch) | Identitätstest auf zufälligen rationalen Eingaben vor jedem Port |
| Planarität oder Koinzidenz aus Float-Epsilon auf Löser-Ausgabe | Zoo #12429 (Fillet geht bei Größe 20, nicht bei 18, 19, 21, 22) | erst Provenienz, dann exaktes Prädikat |
| Umgebungsannahmen ungetestet (FMA, Rundung, FTZ) | Geogram #382 (clang-FMA auf Apple Silicon), remus #483 (WASM-Kontraktion), Thall (Compiler aß den Rest) | Probe-Programm pro Target (B1) |

Quellen: die Anti-Pattern-Tabellen der Kapitel
([commercial-kernels.md](commercial-kernels.md) §4.12,
[oss-brep-kernels.md](oss-brep-kernels.md) §4.9,
[mesh-booleans.md](mesh-booleans.md) §4.2,
[fringe-kernels.md](fringe-kernels.md) §4.8,
[robust-numerics.md](robust-numerics.md) §4.3,
[testing-validation.md](testing-validation.md) §4.3,
[llm-code-cad.md](llm-code-cad.md) §4.2,
[fillets-blends-offsets.md](fillets-blends-offsets.md) §4.2,
[topology-identity-data-structures.md](topology-identity-data-structures.md) §4.2).

---

## 7. Lizenzkarte fürs Portieren

wonky hat keine Open-Source-Lizenz (alle Rechte vorbehalten). Nicht-kommerzielle Lizenzen sind für alles tabu, was kommerziell genutzt werden kann. Nichts hier ist Rechtsberatung (ABGELEITET, Lizenzabschnitte aller Kapitel).

| Klasse | Quellen (Auswahl) | was wonky darf |
|---|---|---|
| **permissiv** (MIT, Apache-2.0, BSD, BSL-1.0, 0BSD, ISC) | Manifold, Geogram, GTE (BSL), Truck, monstertruck, vcad, remus (nur bis brepkit v2.129.15), Fornjot (0BSD), BREP.io (MIT ab 2026-09-12), Cherchi Boolean-Code, forge, hypermesh, verified-3d-mesh-intersection (Lean), CavalierContours, Curv, sdfx, Bend, Futhark, parlaylib, gDel3D (BSD-3-artig laut README), FS std Library (MIT, © PTC), KCL/modeling-app, build123d-mcp, BenchCAD-Harness, CADGenBench-Evaluator, ttf-parser, fonttools, Open Sans v1.10 (Apache-2.0) | portieren oder transliterieren mit Attribution und NOTICE; Formeln und Tabellen frei |
| **offene Daten, Paper mit CC-Lizenz** | Valque-Lazard (CC BY 4.0), BenchCAD-Daten (CC BY), CADGenBench-Daten (ODC-BY), Arko-T (CC BY-SA: Share-alike für kopierten Text) | mit Nennung; abgeleitete Fixtures tragen den Hinweis |
| **Datei-Copyleft** (MPL-2.0) | Fidget, libfive-Kern, OpenSolid, libigl-Kern, MPR | Ideen neu implementieren; eine transliterierte Datei bleibt MPL |
| **schwaches Copyleft** (LGPL) | OCCT (LGPL-2.1 plus Exception), FreeCAD, BRL-CAD libbrep, Cork, mcut, Indirect_Predicates, CGAL-Algebra-Kernel (LGPL-3.0 oder kommerziell) | studieren und neu herleiten; Übersetzung ist plausibel abgeleitetes Werk, relevant bei Veröffentlichung |
| **starkes Copyleft** (GPL, AGPL) | SolveSpace, CGAL (Nef, PMP, Arrangements, außer mit kommerzieller Lizenz), Dune 3D, SISL und GoTools (AGPL), Blender, CADAM, keel, Aetheris, brepkit ab v3 (AGPL, nie lesen), Slicer-Interna (AGPL), Metro/vcglib | nur studieren; aus Papern und Handbüchern neu herleiten; GPL-Testnetze bleiben lokal |
| **nicht-kommerziell** | trueform (PolyForm NC), CAD-Recode, CAD-Assistant, CADFit (CC BY-NC, dazu vorläufiges Patent), SpatialClaw-Code, Fusion 360 Gallery (bindet Arbeitgeber), hg_sdf, QI-Server, IRIT, Patrikalakis-Software, GWB 1988 | nur Paper lesen; keine Code-, Gewichts- oder Datenübernahme; QI-Fakten als Fixtures erst nach Freigabe |
| **ohne Lizenz** (alle Rechte vorbehalten) | ESOLID-Spiegel, quadmotor/hypercut, MeshIntersection, CADCodeVerify-Repo, realthunders asm3-wiki, HVM4 | nichts kopieren; eigene Fixtures schreiben |
| **proprietär oder source-available** | Parasolid- und ACIS-Dokumentation (inoffizielle Spiegel), Solidean SDK, Onshape, Zoo-Engine, CADmium (Elastic License 2.0) | Verhalten und Datenmodell mit eigenen Namen neu ausdrücken; keine Enums, Header, Tabellen oder API-Namen kopieren |
| **aktive Patente** | Zoo US 12,229,885 B1 (GPU-SSI, bis etwa 2044, Anspruch 16: Schnittpunkte per Abstandsschwelle); Autodesk US11886165B2 (Abstandsinzidenz, Pulling, Gap-Filling) und US11016470B2 (Randfit zuerst, eingefroren); PTC US11288411B2 (historienfreies B-rep-Matching, Anspruch 2 breit); Siemens-Blend-Patente US9690878B2 (bis 2036) und US8935130B2 (bis 2032); Geomagic US8004517B1 (bis 2027-12-17) | Abstandstests nur als Verifikatoren, nie als Punktgeneratoren; Terrain-Notiz mit Design-arounds (commercial C8); vor Notch/Cliff-Erkennung in Importen und vor Setback-Patches prüfen |
| **abgelaufene Patente** | HP US5615317A, US6133922A (Blend-Topologie) | frei implementierbar (Grundlage für B17) |

**Zwei konkrete Handlungspunkte:**

1. `kernel/ports/solvespace.bend`, `solvespace-bsp.bend` (GPL-3.0-or-later) und `occt.bend`, `occt-edges.bend` (LGPL-2.1 mit OCCT-Exception) sind aus Lizenzgründen nicht Teil des öffentlichen Repositorys. Der Hybrid hat diese Pfade weitgehend abgelöst (DOKUMENTIERT, [oss-brep-kernels.md](oss-brep-kernels.md) §1.5).
2. Die FS std Library ist MIT (© PTC), verifiziert am Header von
   `sketch.fs`; die Angabe „std library license unverified" im
   Identitätskapitel ist damit überholt (DOKUMENTIERT,
   [FS std](sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md),
   Critic-Worklog). Onshapes Verhalten ist damit der Vertrag, den wonky
   reproduzieren darf, samt `TOLERANCE`-Konstanten und Fehler-Enums.

---

## 8. Offene Fragen, die nur ein Prototyp beantworten kann

Ausgewählt und gruppiert aus den Abschnitten 6 aller Kapitel; jede Frage
nennt den kleinsten Prototyp. Vollständige Listen in den Kapiteln.

**Numerik und Targets**

1. **Was tut Bends Metal-Target auf deinen Maschinen wirklich?** FTZ bei
   Ein- und Ausgaben, Rundung, korrekt gerundete ÷ und √, und ob
   `MTLMathModeSafe` innerhalb einer Anweisung doch kontrahiert (das
   Frames-Addendum liest die MSL-Spezifikation so, das GPU-Kapitel nicht).
   *Prototyp:* B1-Probe pro Maschinenklasse
   ([robust-numerics.md](robust-numerics.md) §6 Frage 1).
2. **Wie oft gehen CAD-Prädikate exakt, und wie viele davon sind Nullen?**
   Eine hex-nut-Zahl ist zu wenig. *Prototyp:* Zähler (Filter, strukturelle
   Null, exakte Null, exakt ungleich null, Kapazität) in
   `robust-predicates.bend` und im Gate über den ganzen Korpus; entscheidet
   zwischen Nullmustern und Festbreite in B19 (ebd. Frage 3).
3. **Welche Limbzahlen brauchen echte Beinahe-Tangenzen auf F32x2-Eingaben?**
   ESOLID sah bis 141 Bit bei rationalen Eingaben. *Prototyp:* dynamischen
   exakten Pfad instrumentieren, ESOLID-artige Serie zweier Zylinder mit
   schrumpfender Durchdringung 2^-k
   ([oss-brep-kernels.md](oss-brep-kernels.md) §6 Q1,
   [brep-booleans-ssi.md](brep-booleans-ssi.md) §6 Frage 1).

**Boolean-Hybrid**

4. **Wo hört F32x2 „ask once" auf, eine Kette zu überleben?** *Prototyp:*
   B4c im Mesh-only-Modus auf dem 223-Operationen-Terrain-Carve gegen eine
   double-Referenz; erste Abweichung über 2^-44·scale pro Schritt
   ([mesh-booleans.md](mesh-booleans.md) §6 Q1).
5. **Kann Koplanarität aus Identität statt aus Toleranz kommen?**
   *Prototyp:* im Job-Encoder (Schritt 6) die FS-Referenz jeder Ebene
   mitschreiben und zählen, wie viele vereinigte Paare eine gemeinsame Quelle
   haben (ebd. Q3; [commercial-kernels.md](commercial-kernels.md) §6 Q2).
   Entscheidet, ob B11 Hauptpfad oder nur Fillet-B-Enabler ist.
6. **Überleben Konstruktionsidentitäten corefines Reparaturen?** Weld, Zip
   und 2^-36-Kollaps verschmelzen Vertices. *Prototyp:* Identitäten emittieren
   ohne sie zu konsumieren und zählen, wie viele verschmolzene Vertices
   Trägermengen haben, die sich nicht in einem Punkt treffen können
   ([fringe-kernels.md](fringe-kernels.md) §6 Frage 2). Muss vor B3 geklärt
   sein.
7. **Liefert corefines Mesh an einem exakt tangentialen Vertex die richtige
   lokale Flächenstruktur, oder muss recover Spitzenflächen analytisch
   bauen?** *Prototyp:* SolveSpace #1268, hex-nut, ein tangentiales
   Schlitzende ([oss-brep-kernels.md](oss-brep-kernels.md) §6 Q2).
8. **Verweigern oder darstellen: sich berührende Körper?** Für FDM ist eine
   Kantenberührung meist Schweißnaht oder Riss, aber Gitter und
   Print-in-place erzeugen Kontakt absichtlich. *Prototyp:* Würfelgitter
   Variante a mit duplizierten Vertices entlang Kontaktkanten, getrennte
   Schalen in recover, was machen STEP-Writer und Slicer daraus
   ([mesh-booleans.md](mesh-booleans.md) §6 Q2).
9. **Ist der Hybrid äquivariant unter Achsenpermutationen?** Wenn corefines
   Perturbationsrichtungen in Weltkoordinaten fest sind, lösen exakt
   degenerierte Fälle in einem anderen Rahmen anders auf. *Prototyp:* erster
   Abnahmetest von B4 plus byteweiser Diff nach Rücktransformation
   ([testing-validation.md](testing-validation.md) §6 Q1).

**SSI und Kurven**

10. **Kann die analytische Morphologie bescheinigen, dass das Mesh jede
    Schleife gesehen hat?** Yang 2025 kann es nicht. *Prototyp:* versetzte
    Querbohrungen durch r = ρ + a ± ε, Komponentenzahl nach Trimmung gegen
    corefines Schleifenzahl, bei Widerspruch verweigern
    ([brep-booleans-ssi.md](brep-booleans-ssi.md) §6 Frage 2).
11. **Akzeptieren STEP-Leser HYPERBOLA/PARABOLA-Kanten auf
    CONICAL_SURFACE mit wonkys pcurves?** *Prototyp:* das Sechskantprisma aus
    B8 exportieren, strikt mit OCCT und einem zweiten Leser prüfen (ebd.
    Frage 3).
12. **Tangenz entlang einer Kurve nach Fillets.** Ein Fillet-Torus trifft
    Ebene und Zylinder G1 entlang ganzer Kreise; OCCT #1496 deutet das Risiko
    an (unbestätigter Nutzerbericht, siehe §4.4).
    *Prototyp:* Box mit gefilletem Bohrungsrand minus Stab durch das Fillet
    (ebd. Frage 12). Entscheidet, ob Fillets später durch den Hybrid gehen
    können.

**Fillets und Offsets**

13. **Onshapes Offset-Semantik** (scharf oder rund, neue Kante an
    Valenz-4-Vertex, verschwindende Fläche an konkaver Kante, Shell bei r < t
    und r > t). *Prototyp:* etwa fünf Dokumente über die Session-Bridge
    (Freigabe wie bei den Fillet-Proben)
    ([fillets-blends-offsets.md](fillets-blends-offsets.md) §6 Frage 1).
    Entscheidet B13.
14. **Trägt Parasolids Toleranzwachstum manche deiner Onshape-Erfolge?**
    *Prototyp:* die engen Überlauf-Fälle proben und mit einer exakten
    Konstruktion vergleichen (ebd. Frage 9); zusammen mit Frage 15.
15. **Wo entscheiden Onshape und wonky zwischen 2^-44·scale und 1e-5 mm
    verschieden?** *Prototyp:* ein Dutzend FS-Proben (versetzte Flächen,
    kurze Kanten, fast koaxiale Zylinder, gedrehte koplanare Flächen) in
    beiden Systemen ([commercial-kernels.md](commercial-kernels.md) §6 Q1).
    Kalibriert B5 und entscheidet, ob ein FS-Kompatibilitätsbudget
    existieren sollte.

**Identität, LLM, FDM, Parallelität**

16. **Wie oft wird Hybrid-Provenienz zur Menge?** *Prototyp:* instrumentieren,
    nicht ändern: abgelehnte Zuordnungen in `attachResultMesh` nach Grund,
    verschweißte Vertices aus verschiedenen Paaren, Kanten mit mehrdeutigen
    Trägerklassen ([topology-identity-data-structures.md](topology-identity-data-structures.md)
    §6 Frage 1).
17. **Stoppt eine Zahl offener Anforderungen Agenten zur richtigen Zeit, und
    behebt eine Rahmenzeile den Arbeitsebenen-Fehler?** *Prototyp:* drei Arme
    im Eval-Harness ([llm-code-cad.md](llm-code-cad.md) §6.1, §6.2).
18. **Welche Ebenenmengen fangen die falschen `ok` des Bake-offs im
    Slice-Orakel?** *Prototyp:* nur Layer gegen Layer plus Ereignishöhen, Kosten
    gegen OCCT-Arbitrierung ([fdm-geometry.md](fdm-geometry.md) §6 Frage 2).
19. **Kann eine Boolean-Operation mehr als 1,5x von 18 Kernen nutzen?**
    *Prototyp:* Min-Label-Propagation oder Pointer-Jumping für Winding03 und
    sortierbasierte Assemblierung in `tmp/corefine/prof/`
    ([mesh-booleans.md](mesh-booleans.md) §6 Q7). Entscheidet, ob B25 innerhalb
    oder nur über Operationen skaliert.
20. **Gibt es überhaupt einen uniformen Kernel im Boolean, der cpu18 auf
    Metal schlägt?** *Prototyp:* ein flacher SoA-F32-Kernel für den Gate-Filter
    über alle Kandidatenpaare eines ganzen Modells, gemessen nach den drei
    Bedingungen von Plan §6 (ebd. Q6).

---

*Erstellt 2026-09-24 aus den Kapiteln, Addenda und Quellennotizen dieser
Wissensbasis. Nichts wurde gebaut, ausgeführt oder committet. Worklog:
local development evidence.*

## Faktencheck

Unabhängige Prüfung am 2026-09-24 gegen Primärquellen (Papers, Repositories,
Herstellerdokumentation, Patentregister, Issue-Tracker); die Kapitelnotizen
wurden dafür nicht als Beleg genommen. 25 tragende Aussagen geprüft:
**19 bestätigt, 6 korrigiert, 0 nicht belegbar** (ein Teilaspekt von Nr. 19
bleibt HÖRENSAGEN, wie schon gelabelt). Korrekturen stehen direkt im Text
oben. Worklog: local development evidence.

| # | Aussage | Ergebnis | Befund | Quelle |
|---|---|---|---|---|
| 1 | Yang et al. 2025 (TOG): 17x schneller als OCCT, 0 Fehler, OCCT 10 / Rhino 8 / ACIS 1, Polylinien, GPL-Repo leer | **korrigiert** | 17x gilt für Set A (10.000 ABC-Paare, Fig. 19), 0 Fehler für Set B (100 Paare × 4 Op. = 400, Tab. 5). Die Limitation betrifft nur *mehrere* kleine Schleifen, deren Größe *und* Abstand unter der Mesh-Auflösung liegen, nicht „kleine Schleifen“ generell. Das Repo hat einen einzigen Initial-Commit (2025-04-29), GPL-3.0 | https://doi.org/10.1145/3730908, https://github.com/ying-yu-yang/SolidBoolean |
| 2 | Parasolid: lineare Auflösung 1e-8 (Einheit Meter) in 1e3-Box, Winkel 1e-11 | bestätigt | Overview V35 | http://www.q-solid.com/Parasolid_Docs_V35/pdf/ov.pdf |
| 3 | ACIS: SPAresabs 1e-6, SPAresnor 1e-10, SPAresfit 1e-3, Arbeitsraum 1e4 | bestätigt | dazu resmch 1e-11 und Guard Band | http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_totol.htm |
| 4 | Onshape FS `TOLERANCE`: zeroLength 1e-8, zeroAngle 1e-11, booleanDefaultTolerance 1e-5 m | bestätigt | `math.fs`; booleanDefaultTolerance ist `@internal` | https://github.com/javawizard/onshape-std-library-mirror |
| 5 | OCCT `Precision::Confusion` 1e-7, `Precision::Angular` 1e-12 | bestätigt | `Precision.hxx` | https://github.com/Open-Cascade-SAS/OCCT |
| 6 | Double-Word-Fehlerschranken (Joldes-Muller-Popescu 2017): Addition 3u², Multiplikation < 5u², Division 15u² | **korrigiert** | Addition 3u²+13u³ (Alg. 6), Division 15u²+56u³ (Alg. 16/17). Multiplikation 5u² nur **mit FMA** (Alg. 12). Ohne FMA (Alg. 10, Bends Fall) steht im Paper 7u², Muller-Rideau 2022 zeigen 5u² unter ties-to-even (5,5u² allgemein) | https://hal.science/hal-01351529v3/document, https://hal.science/hal-02972245v2/document |
| 7 | wonkys `R.add` entspricht der „sloppy“ Addition (Alg.-5-Familie) | bestätigt | `kernel/real.bend`: 2Sum auf den hi-Wörtern, dann (e+al)+bl und Fast2Sum-Renormierung. Die Summationsreihenfolge weicht leicht ab | `kernel/real.bend` (lokal) |
| 8 | Zoo-Patent US 12,229,885 B1, Laufzeit bis ca. 2044, Anspruch 16 | bestätigt | angemeldet 2024-05-13, erteilt 2025-02-18, voraussichtliches Ende 2044-05-13. Erfinder Alyn Rockwood, Inhaber „Individual“. Zoo nennt es in der eigenen Doku „patented method“ | https://patents.google.com/patent/US12229885B1, https://github.com/KittyCAD/documentation |
| 9 | HP US5615317A und US6133922A abgelaufen | bestätigt | beide „Expired - Lifetime“ | https://patents.google.com/patent/US5615317A, https://patents.google.com/patent/US6133922A |
| 10 | Siemens US9690878B2 (2036), US8935130B2 (2032), Geomagic US8004517B1 (2027-12-17) aktiv | bestätigt | US8004517B1 gehört seit 2025-10-02 Hexagon | https://patents.google.com/patent/US9690878B2, https://patents.google.com/patent/US8935130B2, https://patents.google.com/patent/US8004517B1 |
| 11 | FeatureScript-Standardbibliothek MIT, © PTC | bestätigt | „Copyright (c) 2013-Present PTC Inc.“ | https://github.com/javawizard/onshape-std-library-mirror |
| 12 | Open Sans v1.10 Apache-2.0, v3 OFL | bestätigt | METADATA APACHE2 und TTF-Namenstabelle. PR #4206 hat nur die v3-VF-Dateien verschoben | https://github.com/google/fonts |
| 13 | Fornjot archiviert 2026-06-19, ca. 6 Jahre, 57 Beitragende, 0BSD | **korrigiert** | Archivierung, letzter Push, 0BSD, erster Commit 2020-07-30 und Zitate stimmen. Die GitHub-API zählt aber 44 Konten bzw. 56 mit anonymen Autoren, nicht 57 | https://github.com/hannobraun/fornjot, https://www.fornjot.app/ |
| 14 | Manifold gab CUDA/OMP 2023 auf „aus demselben Grund“ (schwache GPU-Leistung); Metal-PR #1646; Apache-2.0 | **korrigiert (Label)** | #524/#525 (2023-08) nennen keinen Grund. #491: CUDA-Leistung „not very good“. Der Blog von 2022 misst Schnitte > 20x, gesamt nur etwa 2x. Die Kausalität ist deshalb jetzt als ABGELEITET markiert. #1646 hat der Autor am 2026-04-13 wegen des Dispatch-Overheads geschlossen | https://github.com/elalish/manifold/issues/524, https://github.com/elalish/manifold/issues/491, https://github.com/elalish/manifold/pull/1646 |
| 15 | Blender #114476: EMBER-Solver 2025-02 zurückgestellt | bestätigt | Kommentar Trickey 2025-02-25, Wechsel auf Manifold (#120182) | https://projects.blender.org/blender/blender/issues/114476 |
| 16 | OCCT #1496/#1543/#1371: stille Erfolge (leeres Common mit IsDone, Cut ohne Wirkung, Fillet mit Selbstschnitt) | **korrigiert** | Alles untriagierte Nutzerberichte (Label „0. New“, keine Maintainer-Antwort). #1496 hat der Melder nach 8 Minuten selbst geschlossen. Der Auslöser ist MakePipeShell mit identischen Operanden und ließ sich mit Primitiven nicht reproduzieren. Als Beleg für „G1-Tangenz im Boolean“ war das überdehnt, der Text ist in §1, §4.4, §6.1 und §8 herabgestuft | https://github.com/Open-Cascade-SAS/OCCT/issues/1496, https://github.com/Open-Cascade-SAS/OCCT/issues/1543, https://github.com/Open-Cascade-SAS/OCCT/issues/1371 |
| 17 | SolveSpace #1268 seit 2022 offen, #1291 | bestätigt | #1268 offen seit 2022-07-10 (tangentialer Würfel/Zylinder, nackte Kanten). #1291 wurde 2026-08-22 über PRs #1731/#1746/#1751 geschlossen | https://github.com/solvespace/solvespace/issues/1268, https://github.com/solvespace/solvespace/issues/1291 |
| 18 | Parasolid SMP höchstens 8 Threads, Ergebnisreihenfolge nicht deterministisch | bestätigt | Overview l. 5208 und fd_chap.115, dazu `PK_DEBUG_shuffle` | http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.115.html |
| 19 | ShapeManager = ACIS-7.0-Fork (2001); Onshape und Plasticity auf Parasolid | bestätigt | Machine Design 2002-02-07 und Plasticity-FAQ. Der C3D-Teil zur Plasticity-Vorgeschichte bleibt HÖRENSAGEN, wie gelabelt | https://www.machinedesign.com/, https://doc.plasticity.xyz/ |
| 20 | OCCT BRepCheck: 37 Statuswerte, 23 Stützpunkte | bestätigt | `BRepCheck_Status` (37 Einträge inkl. NoError, CheckFail), `BRepCheck_Edge.cxx` NCONTROL = 23 | https://github.com/Open-Cascade-SAS/OCCT |
| 21 | Klipper segmentiert G2/G3 in 1-mm-Stücke | bestätigt (präzisiert) | 1,0 mm ist der Default von `[gcode_arcs] resolution` und konfigurierbar | https://www.klipper3d.org/Config_Reference.html#gcode_arcs |
| 22 | trueform PolyForm NC; float32-trueform „scheiterte“ in Ketten | **korrigiert** | Die Lizenz stimmt (dual PolyForm NC 1.0.0 / kommerziell, XLAB). Der float32-Befund ist gemischt: invertiert auf Terrain-Carve, Ausfall bei etwa 70 % des Dome-Carve, aber kanonisch über 1999 Schritte Würfelgitter. „Intern 32-bit“ ist Solideans Vermutung. §3.1 und §4.1 wurden angepasst | https://github.com/polydera/trueform, https://solidean.com/blog/2026/iterated-dome-carve-benchmark/, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/ |
| 23 | Fusion 360 Gallery: nur nicht-kommerziell, bindet Arbeitgeber | bestätigt | LICENSE.md §1 und §11 | https://github.com/AutodeskAILab/Fusion360GalleryDataset |
| 24 | Bend 2.0.25: kein Interaction-Net-Runtime, 16.384 Lanes, kein fma/clz, `U32.mul` liefert das niedrige Wort, FP-Kontraktion aus | bestätigt | BendRT-Paper: 128×128-Würfel, kein Work-Stealing, CPU/GPU nie gleichzeitig. `base.bend`: `U32.log2` als Schleife. `comp.ts`: `fp contract(off)`, `MTLMathModeSafe`, `--fmad=false` | https://github.com/bendlang/bend (paper/BendRT.pdf, base.bend, comp.ts) |
| 25 | OCCT LGPL-2.1 + Ausnahme; SISL und GoTools AGPL-3.0 | bestätigt | gh api license | https://github.com/Open-Cascade-SAS/OCCT, https://github.com/SINTEF-Geometry/SISL, https://github.com/SINTEF-Geometry/GoTools |
