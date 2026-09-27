# cad_khana in wonky: Landschaft, Entscheidung, Plan

Stand: 24. September 2026, nach zwei Reviews überarbeitet. Ergebnis des
Workflows `khana-design`. Das ist ein Entwurf: implementiert ist
noch nichts. Grundlage ist deine Vorgabe vom Vormittag: cad_khana
komplett und nativ in wonky integrieren, die Checks grundlegend überdenken,
aufs Wesentliche reduzieren, sauber vereinen, Tooling und Design-Stil gleich
mit.

| Dokument | Inhalt |
|---|---|
| [khana/design.md](khana/design.md) | Architektur, die elf Checks, Ergebnismodell, API, Berichte, Tooling, Orakel, 34 Pakete, Umgang mit jedem Review-Befund (Abschnitt 16), Zuordnung aller cad_khana-Namen (englisch) |
| [khana/doctrine-draft.md](khana/doctrine-draft.md) | deine Design-Doktrin, jede Regel mit Check und Profilwert (englisch, Entwurf) |
| [khana/review-exactness.md](khana/review-exactness.md) | Review zu Exaktheit und Bend-Machbarkeit |
| local design note | die verbindliche Vorgabe |
| [khana/inventory-mechanism.md](khana/inventory-mechanism.md), [inventory-printability.md](khana/inventory-printability.md), [inventory-tooling.md](khana/inventory-tooling.md), [kernel-gaps.md](khana/kernel-gaps.md), local design note, [prior-art.md](khana/prior-art.md) | Bestandsaufnahmen mit Messungen und Quellen |

Labels: **GEMESSEN** (in einem genannten Lauf gemessen), **GELESEN** (im Code
oder einer Quelle gelesen), **VORSCHLAG** (Entwurf).

## 1. Kurzfassung

1. **Ein Prüfkern in Bend für alle Frontends** (VORSCHLAG). Jede geometrische
   Entscheidung fällt in Bend. Der Host lädt Prüfspezifikation und
   Druckerprofil, plant, cacht, schreibt Berichte und kombiniert nur Urteile
   und Intervalle, die Bend geliefert hat.
2. **Elf Checks statt rund dreißig Funktionen.** Paarbeziehung, Abdeckung,
   Posen, Bewegung, Teilefakten, Überhang mit Brücken und Bett, Wände mit
   Messerkanten, Kanten und Hausstil, zusammenhängender Körper, Bohrungen,
   Orientierung.
3. **Urteile sind dreiwertig und nie optimistisch.** `pass` nur mit
   geschlossener Formel samt angegebener Rundungsschranke oder mit
   verifizierter Einschließung, `fail` nur mit Zeugen, sonst `unresolved`.
   Ein Waiver macht aus `unresolved` nie Grün (`waived-unresolved`).
4. **Berührung ist eine eigene Antwort, definiert über Zeugen.** Überlappend
   heißt: ein Punkt liegt tiefer als `contact_mm` in beiden Teilen.
   Berührend heißt: Abstand höchstens `contact_mm` und eine tolerante
   Kontaktfamilie (plan aufeinander, Zylinder auf Ebene, koaxial). Alles
   andere ist `unresolved`. Paare werden im Rahmen eines der beiden Teile
   gerechnet; gemeinsam bewegte Teile haben dann keine Rundungsdifferenz.
5. **Abstand ist Körperabstand.** Ein vergrabenes Teil hat Abstand 0
   (cad_khana: 8,0, GEMESSEN). Der Ø3-Stift in der Ø3,5-Bohrung besteht
   `min_mm=0.25` (cad_khana: 0,24999999999999983, scheitert). Passungen
   werden auf den Führungsflächen geprüft (`assert_fit`), nicht als
   kleinster Abstand des ganzen Paars: ein sitzender Schieber berührt seinen
   Anschlag und hat trotzdem Spiel an den Flanken.
6. **Kein `status ok` mehr neben einer Überlappung.** Jede
   Überlappungskomponente wird geprüft. Eine erwartete Überlappung gilt nur
   in ihrer Region (`within=`); eine zweite Kollision desselben Paars
   scheitert trotzdem. Posen haben eine Basispose und werden in Assertions
   ausdrücklich benannt.
7. **Waiver lokal, begründet, sichtbar.** Pro Fläche, Kante oder Paar über
   stabile IDs. Alte Abschaltungen (91°, Wand ≤ 0,05 mm) werden weiter
   gelesen, drucken aber bei jedem Lauf eine `WAIVED`-Zeile mit der
   verdeckten Fläche. `--strict` wird ab einem Datum Standard, das du
   festlegst.
8. **Druckbarkeit aus der Geometrie.** Exakte Überhangbänder je Fläche. Eine
   Brücke ist ein Bereich, dessen Sehnen an beiden Enden auf verankertem
   Material enden und kürzer als die Spannweite sind. Eine waagerechte
   Bohrung hat die Sehne `2r sin(halbes Band)`, unabhängig von ihrer Länge:
   ein Ø6-Loch durch 3 mm Wand besteht. Ob der Anker beim Drucken schon
   existiert, prüft erst K8b über Schichtschnitte; bis dahin ist eine
   bestandene Brücke eine geometrische Vorprüfung, keine Stützfrei-Freigabe.
9. **Ein Druckerprofil für Doktrin und Checks**, mit Herkunft (`starter` oder
   `calibrated`). Profil, Prüfdatei und Waiver-Datei werden vom Live-Viewer
   überwacht: JSON ändern genügt für einen neuen Prüflauf.
10. **Zwei Aufrufverträge.** Standard bleibt cad_khanas Verhalten: das
    Ergebnis wird aufgezeichnet, die JSON geschrieben, dann `SystemExit` bei
    einem Fehlschlag. Dein unifi-Cache hängt davon ab (GEMESSEN: ohne
    Exception überspringt der zweite Lauf alle fünf fehlgeschlagenen
    Prüfungen). Durchlaufen bis zum Ende gibt es mit `--collect`.
11. **Werkzeug schrittweise vereint.** `wonky view` ersetzt OCP-Viewer,
    `watch.py` und `khana check`. Dein separates Export-Skript für `out/`
    bleibt, bis ein Projekt seine Druckziele deklariert hat (Teil, Variante,
    Drucklage, Anzahl, Pfad, geprüfte Revision).
12. **34 Pakete, vier brauchen r20** (K17a bis K17c, K18). K14 und K15 nutzen
    nur das committete Druck-Mesh und verweigern andere Flächen mit Namen.
    Hohlräume brauchen ein neues Körperformat (K21), nicht r20. K1a und K1b
    sind ein Pilot auf Modellen, die heute bauen (`pin_hinge`, die
    cad-project-003-Coupons), kein Ersatz deiner täglichen Schleife.

## 2. Wie du cad_khana heute nutzt (GEMESSEN)

- 734 Aufrufe in 74 Dateien aus 14 Projekten: `with_part` 202,
  `assert_no_interference` 183, `FDM` 105, `inspect` 73, `Assembly` 57,
  `check` 54, `assert_clearance` 22, `assert_interference` 14,
  `viewer.push` 13, `suggest_orientation` 6.
- Keine Rückgabe von `check()` wird gelesen. Von `inspect()` nur `.status`
  (26 Stellen); mehrere Skripte fangen `SystemExit` und bauen darauf auf.
- 175 Printability-Berichte: 61 scheitern, 59 davon an der Wand. 52 schalten
  den Überhang mit 90° oder 91° ab, 17 die Wand mit höchstens 0,05 mm.
- 39 Mechanism-Berichte: alle `ok`, aber 7 listen 25 Überlappungen, 20 ohne
  Assertion.
- Bewegung wird bisher von Hand und immer linear geprüft. Ein bestehendes Projekt hat eine eigene Prüfbibliothek auf STL-Netzen (PASS/FAIL/UNRESOLVED), im Kern dieselbe Idee.

## 3. Was bei cad_khana schief läuft (GEMESSEN)

- Toleranz als Volumen: bei großen Kontakten scheitert Rauschen, bei kleinen
  rutscht eine echte Überlappung durch.
- Clearance ohne Toleranz: nominelle Spalte scheitern um ein ulp;
  vergrabene Teile bestehen.
- Überhang aus dem Netz: 45°-Kegel, Senkungen, gedrehte Schlitze und Brücken
  zwischen dünnen Wänden scheitern.
- Wandstärke aus dem Netz: Selbsttreffer (0,07 statt 20 mm), Messerkanten als
  0,06-mm-Wand.
- STEP ohne Namen und Farben, GLB nur mit externem `gltf-transform`.

## 4. Der neue Kern

| Check | Frage | Urteil |
|---|---|---|
| C1 Paarbeziehung | getrennt, berührend, überlappend, enthalten? mit Zeugen | über Assertions |
| C2 Abdeckung | ist jede Überlappungskomponente erwartet? | Gate |
| C3 Posen | ist jeder Zustand eines Teils frei vom Rest? | Gate |
| C4 Bewegung | bleibt das Paar über den Gelenkbereich frei? | Gate |
| C5 Teilefakten | Volumen, Box, Fläche, Schwerpunkt aus Bend | Daten |
| C6 Überhang, Brücken, Bett | welche Bereiche brauchen Stütze? | Gate (Vorprüfung bis K8b) |
| C7 Wände, Messerkanten | ist jede Wand dick genug? | Gate |
| C8 Kanten und Hausstil | R4,2, 0,42-Fase, Kerben | Rat, Messerkanten Gate |
| C9 Zusammenhang | ist ein Druckteil ein Körper? | Gate |
| C10 Bohrungen | welche Passbohrung braucht einen Teardrop? | Daten und Rat |
| C11 Orientierung | welche Lage kostet was? | Rat |

Neue Python-Namen auf `Assembly`: `with_pose`, `expect_contact`, `assert_fit`,
`assert_clearance_over`, `assert_no_interference_over`, `waive`,
`print_target`, dazu `PrismaticJoint` und `within=` bei
`assert_interference`.

Bewusste Lücken in v1, jeweils `unresolved` statt Grün: Abstände zwischen
Kegelflächen im Inneren (zwei Fasenringe gegenüber), Dauerkontakte, die das
Gelenk nicht invariant lässt (Nocken, Rastrampen), Brücken, die keine
zugelassene Sehnenfamilie abdeckt.

## 5. Was wegfällt und warum

- **Volumen-Epsilon als Urteil:** nicht skalenfrei.
- **Pins als eigener Check:** 0 Treffer in 175 Berichten; `pins[]` kommt aus C7.
- **Strahl-Mindestwand als Gate:** beweist nie eine dicke Wand; bleibt
  Schätzkanal.
- **Bohrungsausnahme bis Ø12 und Brückentest mit zwei Probepunkten:** ersetzt
  durch die Brückenregel. Ø12 besteht (Sehne 8,5 mm), Ø20 nicht (14,1 mm).
- **Hohlraum-Check:** ein committeter wonky-Körper kann keinen Hohlraum haben.
- **OCCT-Index-Pick und Regex-Hints:** ersetzt durch Viewer-Aliase und Hints
  aus wonkys Fehlercodes.

Jeder cad_khana-Name hat eine Zuordnung (design.md, Anhang A). Bei der
Überarbeitung neu gezählt, mit eigenem Skript: 246 öffentliche Deklarationen
(144 bleiben, 31 ersetzt, 55 dünne Hüllen, 16 fallen weg), 203 importierte
Namen (4 mehr als zuvor, nur unter `TYPE_CHECKING`), 107 private Namen. Kein
Name ist offen.

## 6. Werkzeug

| heute | künftig |
|---|---|
| OCP-Viewer plus `watch.py` plus `khana check` | `wonky view assembly.py`: Neubau beim Speichern, Checks live, Zeugen im Bild |
| `khana build` / `khana check` | `wonky build` / `wonky check`, für `.py` und `.fs` |
| `uv run <part>.py` für `out/` | bleibt, bis das Projekt Druckziele deklariert; dann schreibt wonky sie aus der geprüften Revision |
| `export_assembly` | STEP mit Baum, Namen, Farben; STL je Teil, soweit das committete Druck-Mesh reicht |
| `export_glb` mit `gltf-transform` | eigener GLB-Schreiber, Animation aus den Gelenken |
| `khana diff` | `wonky diff` samt Checks, mit Toleranzen und IDs |
| `khana pick` mit Indizes je Push | Viewer-Auswahl und `wonky pick` mit stabilen Aliasen |

## 7. Was kompatibel bleibt

- Assembly-Builder, `check()`, `inspect(...).status`, JSON-Dateien an ihren
  Pfaden, `SystemExit` bei Fehlschlag (Standard), STEP- und GLB-Export.
- JSON: echtes Schema 0.2 nur, wenn jeder Wert darin darstellbar ist. Sonst
  (verweigertes Volumen, Status `unresolved`) schreibt wonky `0.2+wonky.1`;
  das installierte `khana diff` lehnt das sauber ab statt mit `TypeError`
  abzustürzen (GEMESSEN). `wonky diff` liest beides.
- Werte, die der Kern nicht liefern kann, sind in Python ein `Refused`-Objekt,
  das bei jeder Verwendung einen Capability-Fehler wirft, nie `None`.
  `.status` ist dann `refused`, nicht `unresolved`.
- Bewusste Brüche: doppelte Teilenamen scheitern an der `with_part`-Zeile;
  unerwartete Überlappungen machen den Bericht rot; `draco=True` ist ein
  Capability-Fehler.

## 8. Plan

| Pakete | Inhalt | r20 | Größe |
|---|---|---|---|
| K1a, K1b | Prüfvertrag, beide Aufrufverträge, Berichte; Live-Verdrahtung, Pilot, Diff für Kompat-Dateien | nein | M, M |
| K2 | Orakel: geschlossene Formeln zuerst, OCCT misst wonkys eigenes STEP, cad-khana nur als Verhaltensreferenz | nein | M |
| K3a bis K3e | Flächenfakten, Konvexität, Kegel-Zugehörigkeit, Kegelschnitte, Strahltreffer | nein | M, M, L, M, M |
| K4a bis K4d | Abstand, Durchdringungstest, tolerante Kontakte mit Transformschranke, nativ | nein | L, L, M, M |
| K5 | Mechanik-Assertions, Komponenten, Posen, Passungen auf Flächen | nein | L |
| K6a, K6b | Profil, gemeinsamer Loader, Waiver; Druckziele und Proxy-Beziehungen | nein | M, M |
| K7 | Bewegung mit Gleitkontakten | nein | L |
| K8a, K8b | Überhang und Bett; Brücken, Inseln, Schicht- und Ankertest | nein | M, L |
| K9a, K9b | Wände; Messerkanten, Luftspalte | nein | L, M |
| K10, K11 | Kanten, Zusammenhang, Bohrungen; Orientierung | nein | M, M |
| K12, K13 | Viewer-Ebenen und Waiver; CLI, Diff, Status, Pick | nein | L, M |
| K14, K15 | STEP, STL je Teil, 3MF; GLB | teilweise | M, M |
| K16 | FeatureScript-Prüfdatei, WK/0, R20-Szenen | nein | M |
| K17a bis K17c, K18 | gekrümmte Volumen, Kugel und Torus, Netz-Abstand | **ja** | L |
| K19 | Zeichnungen aus Bend | nein | L |
| K20 | Umstieg des Skills | nein | S |
| K21 | Körper mit Hohlräumen | nein | L |

Früher Nutzen: K1a und K1b geben ehrliche Prüfeinträge und die Live-Schleife
auf Modellen, die heute bauen, ohne deine Exception-Skripte zu brechen. K3
bis K5 bringen die Mechanik-Checks. K6a, K8 und K9 reparieren die beiden
Checks, die du am häufigsten abschaltest.

Umstieg eines echten Projekts: `cad-project-033` und `cad-project-026` brauchen
zuerst Fillets und Fasen im Kernel (heute Capability-Fehler), LEGO zusätzlich
K11. K20 kommt erst nach einer vollen echten Runde: bearbeiten, prüfen,
Viewer, Export der deklarierten Druckziele, Slicer.

## 9. Deine Entscheidungen

Jeweils mit meiner Empfehlung.

1. Unerwartete Überlappungen machen den Bericht rot. Empfohlen.
2. Kontakttoleranz als Länge statt 0,001 mm³. Empfohlen.
3. Clearance als Körperabstand. Empfohlen.
4. Zwei Aufrufverträge: `SystemExit` bleibt Standard, `--collect` optional.
   Empfohlen (geändert nach dem Review).
5. Strahl-Mindestwand nur noch Schätzkanal. Empfohlen.
6. Alte Abschaltungen weiter lesen, mit `WAIVED`-Zeile; `--strict` wird
   Standard ab einem Datum, das du setzt (Vorschlag: nach K8b und K9a).
7. R20-Prüfbibliothek bleibt, wonky importiert den gemeinsamen Teil.
8. Kein `khana`-Alias im PATH bis zum Skill-Umstieg.
9. Check-Ergebnisse in `brep.json`.
10. Dateien bleiben, wo das Skript sie schreibt, plus Lauf-Manifest.
11. Messerkanten unter 60° scheitern, außer mit Waiver.
12. Starter-Profil übernehmen, Passungen zuerst mit Coupons kalibrieren.
13. Neue API als Methoden auf `Assembly`.
14. Prismatisches Gelenk und explizite Posen in v1.
15. Orakel: geschlossene Formeln zuerst, dann OCCT auf wonkys STEP, dann
    cad-khana als Verhaltensreferenz.
16. Passungen auf deklarierten Flächen (`assert_fit`), globale Clearance nie
    als Spiel melden. Empfohlen.
17. Erwartete Überlappungen an eine Region binden (`within=`); alte
    paarweite Assertions zeigen ihre Komponentenzahl. Empfohlen.
18. Druckziele deklarieren statt Proxys über Namen zu erraten. Empfohlen.
19. JSON-Vertrag je Datei: 0.2 nur, wenn darstellbar, sonst `0.2+wonky.1`.
    Empfohlen.
20. Kegel-Kegel-Abstände im Flächeninneren in v1 `unresolved`. Empfohlen.

## 10. Risiken

- Volumen gekrümmter Boolean-Ergebnisse und Schwerpunkte fehlen bis r20
  (`null` mit Grund). Die Urteile hängen nicht daran.
- „Exakt“ heißt: geschlossene Formel plus angegebene Rundungsschranke, nicht
  gerichtete Rundung. Jedes Paket schreibt seine Schranke neben die Tests.
- Die Transformschranke für gedrehte Teile gibt es heute nicht; bis K4c
  landen gedrehte bündige Kontakte als `unresolved`.
- v1 lässt benannte Lücken `unresolved`; Teile mit vielen Fasenringen nahe an
  anderen Fasenringen können anfangs mehrere solche Einträge zeigen.
- Der alte Exception-Vertrag behält „erster Fehler verdeckt den Rest“, bis
  ein Projekt auf `--collect` umstellt.
- Die meisten deiner Modelle bauen in wonky noch nicht vollständig; frühe
  Parität stützt sich auf synthetische Fälle.

## 11. Was die Reviews geändert haben

Alle 33 Befunde sind angenommen, keiner abgelehnt (design.md, Abschnitt 16).
Die zwei Blocker: Berührung war auf platzierten Teilen nicht beweisbar
(jetzt Zeugen und tolerante Kontaktfamilien), und die Durchdringungssuche
hätte einen Stift, der 2 mm in einen Zylinder ragt, als frei gemeldet (jetzt
ein expliziter Flächen-Durchdringungstest). Dazu: Brücken über
Sehnenfamilien, Wände über gegenüberliegende Teilbänder, Gleitkontakte in der
Bewegung, Kegelschnitte, beide Aufrufverträge, JSON-Vertrag je Datei,
Passungen auf Flächen, Druckziele, gemeinsamer Loader, Pakete kleiner
geschnitten.
