# Wonky Viewer

Der Viewer ist die lokale Arbeitsfläche neben dem Editor: `wonky-view` baut
eine FeatureScript- oder Python-Quelle bei jedem Speichern neu, zeigt das
Modell mit exakten B-rep-Daten und hält Messungen, Vergleiche, Reviews,
Quellbezüge und LLM-Kontext bereit. Er läuft ohne Build-Schritt, CDN,
Schrift-Downloads oder zusätzliche npm-Abhängigkeiten (native ES-Module unter
`viewer/`, Server unter `src/viewer/`, Fassade `src/review-server.mjs`).
Aufbau und Erweiterungspunkte stehen in
[`docs/viewer/foundation.md`](viewer/foundation.md), die verbindliche
Beschreibung in [`docs/viewer/spec.md`](viewer/spec.md), die Referenz je
Bereich in `docs/viewer/<bereich>.md`.

Grundsatz: Jede Geometrie und jeder Messwert kommt aus Bend oder aus
aufgezeichneten Modelldaten. Werte aus dem Darstellungsnetz tragen ihre
Toleranz („display ±0.02“). Was der Kernel nicht kann, erscheint als
ausdrückliche Fähigkeitsgrenze („unsupported: …“, „unresolved“), nie als
Schätzung. Ein fehlgeschlagener, abgebrochener oder überholter Build wird nie
als aktuell angezeigt.

Stand: 23. September 2026, nach der Integration aller Umbau-Pakete und zwei
Regression reviewn (Spec Abschnitt 12). Die Nachweise stehen im Abschnitt
[Prüfungen und Nachweise](#prüfungen-und-nachweise).

## Starten

```sh
node bin/wonky-view.mjs ~/Workspace/cad/halter.fs      # Live-Quelle, öffnet einen Tab
node bin/wonky-view.mjs teil.py                         # Python (einzelne Datei)
node bin/wonky-view.mjs out/a.brep.json out/b.brep.json # gespeicherte Modelle
node bin/wonky-view.mjs halter.fs --param 'thickness=12 * millimeter' --out out/halter
node bin/wonky-view.mjs halter.fs --json --no-open      # nur NDJSON-Ereignisse
node bin/wonky-view.mjs workspaces/r20-single-step.view.json   # ein Viewer für ein Projekt
node bin/wonky-view.mjs --help                          # alle Optionen
```

- **Port:** ohne `--port` ein stabiler Port aus dem echten Pfad der ersten
  Eingabe (4400 bis 4499, bei Belegung der nächste freie; der Bereich lässt
  sich mit `WONKY_VIEW_PORT_RANGE=a-b` ändern). `--port N` ist strikt und
  endet bei belegtem Port mit Exit 1 („port N is in use“). Damit landet auch
  `npm run demo:review` nicht mehr auf 4310.
- **Tab:** Nur Live-Quellen öffnen auf einem Terminal einen Tab (`--open`,
  `--no-open`). Ein offener Tab verbindet sich nach einem Neustart innerhalb
  von 2,5 s wieder, statt einen zweiten zu öffnen.
- **Build-Optionen** wie bei `bin/wonky.mjs` (`--feature`, `--param`,
  `--modules`, `--max-steps`, `--curved-contacts`, …). Eine Live-Revision hat
  dieselbe Modell-ID wie die CLI-Ausgabe derselben Quelle mit denselben
  Parametern.
- **`--out präfix`** schreibt die jeweils aktuelle gute Revision wie
  `bin/wonky.mjs` (`--format all|step|print`); ein fehlgeschlagener Build
  berührt die Dateien nicht.
- **Reviews, archivierte Revisionen und Einstellungen** liegen standardmäßig
  unter `reviews/` im Repository (`--reviews DIR`).
- Python läuft über `scripts/viewer/uv-python` (`uv run`), nie direkt über
  `python3`. Projektlokale Python-Module (etwa `dims.py` neben `main.py`)
  werden mitbeobachtet, sobald ein Build sie importiert hat.
- `Strg+C` beendet Server und Worker sauber (spätestens nach 3 s).
- **Mehrere Modelle eines Projekts** laufen über eine Workspace-Datei in
  einem Prozess (Abschnitt [Workspace](#workspace-mehrere-modelle-und-baugruppen)).

## Live-Modus

Technische Referenz: [`docs/viewer/live-server.md`](viewer/live-server.md)
(Server, Worker, Ereignisse) und
[`docs/viewer/live-client.md`](viewer/live-client.md) (Pille, Banner,
Folgen).

`wonky-view teil.fs` beobachtet die Quelle und ihre Moduldateien, baut nach
dem Speichern in einem vorgewärmten Hintergrund-Worker neu (die Oberfläche
blockiert nie) und schiebt jede Revision in den Browser. Bei `.py`-Quellen
gehören zu den Moduldateien alle Projektdateien, die der letzte Build
importiert hat (etwa `dims.py` neben `main.py`); eine Änderung daran baut
genauso neu wie eine Änderung an der Hauptdatei. Mehrere Quellen bauen
unabhängig: pro Quelle läuft höchstens ein Build, insgesamt zwei gleichzeitig,
ein langsamer Build einer Quelle hält eine andere also nicht auf. Wartet ein
Build doch, sagt die Phase warum („waiting for another build“ oder
„warming worker“, wenn erst ein Worker starten muss). Kamera,
Sichtbarkeit, Schnitt, Platte und Einstellungen pro Körper bleiben stehen.
Ein erneutes Speichern während eines Builds bricht den alten Build ab
(„cancelled“), der Ersatz-Worker übernimmt sofort. Ist gerade kein warmer
Worker frei, läuft der abgebrochene Build weiter, bis ein warmer Ersatz
bereitsteht, und übernimmt den neuen Build selbst, wenn er vorher fertig ist;
fünf Speichervorgänge in einer halben Sekunde bei Builds, die kürzer als ein
Worker-Start sind, lassen den letzten also nicht auf einen kalt startenden
Worker warten. Dauern die Builds länger als ein Worker-Start, nimmt der
neueste Build, was zuerst bereit ist: einen Worker, der seinen alten Build
beendet, oder einen frisch gestarteten („cold worker“). Ein abgebrochener
Build behält seinen Worker höchstens, bis er anderthalbmal so lange läuft wie
der letzte Build seiner Quelle, und gibt ihn sofort ab, wenn ein neuer Build einen Platz braucht; auch
hängende Builds (etwa `time.sleep(600)`) blockieren also nie einen neuen
Build. **Cancel** beendet den laufenden Build nach 250 ms. Beim Start wird die
letzte gute Revision der vorigen Sitzung als `r0 previous session` geladen,
sodass Ansicht und Delta sofort da sind.

**Terminal.** Eine Zeile pro Ereignis, zum Beispiel aus dem QA-Lauf vom
23. September 2026 (Pfade gekürzt; `out/viewer/integration/terminal-*.txt`):

```text
wonky-view  http://127.0.0.1:4381/viewer/  (--port)
watching    …/bracket.fs
browser     opened http://127.0.0.1:4381/viewer/
r1 building …/bracket.fs (cold worker)
r0 previous session · 1 body · 8 faces (8 logical) · 50×40×7 mm recorded
r1 ok 11.47 s · 1 body · 8 faces (8 logical) · 50×40×8 mm recorded
r2 ok 0.02 s · 1 body · 8 faces (8 logical) · 50×40×12 mm recorded
r3 FAILED input …/bracket.fs:31:9 Expected ';', found 'opExtrude'
   showing last good r2
…
browser     tab reconnected; no new tab opened          (nach einem Neustart)

r2 cancelled                                             (Cancel im Browser)
r3 FAILED capability …/part.fs:32:5 opBoolean supports coaxial cylinder primitives, …
   at bore (…/part.fs:32:5)
   called from …/part.fs:57:5 in part
   showing last good r1
```

Der erste Build braucht einen kalten Worker (auf der voll ausgelasteten
QA-Maschine gut 11 s), danach laufen Builds des Brackets in Hundertstel-
sekunden. Die Zeit nach `ok` ist die Buildzeit ohne Wartezeit; hat der
Build eine halbe Sekunde oder länger auf einen Worker gewartet, steht das
dahinter (`r1 ok 0.15 s (queued 11.7 s)`). Hinweise zum Build folgen als
`   note: …`-Zeile, etwa wenn ein `result` auf Modulebene show()-Aufrufe
übergeht.

Python-Builds haben eine Zeitgrenze (`--timeout-ms`, Standard 30 s). Hängt
der Interpreter danach noch (`uv run` startet Python als Enkelprozess, den
das Frontend nicht erreicht), beendet wonky-view 2 s später die ganze
Prozessgruppe des Workers und meldet `rN FAILED timeout Python execution
exceeded … ms; the interpreter did not exit, so wonky-view killed its process
group`; kein Python-Prozess bleibt übrig, andere Quellen bauen weiter.

Fehler nennen Art (`capability`, `input`, `provenance`, `timeout`,
`display`, `internal`), `datei:zeile:spalte` und bei Hilfsfunktionen die
Aufrufkette („called from teil.fs:57“). Ein Python-Fehler in einem
importierten Modul steht an der Stelle im Modul (`dims.py:4`), die
importierende Zeile der Hauptdatei als „called from main.py:2“. Grenzen tragen ihr Label
(`recorded`, `kernel` oder `≈ … display ±0.02 mm`). Abgebrochene Builds
stehen als `rN cancelled (superseded by rM)` da. `--json` gibt dieselben
Ereignisse als NDJSON auf stdout aus und sonst nichts; so können Agenten
Builds ohne Browser verfolgen.

**Pille und Vertrauens-Chip.** Die Pille in der Kopfzeile und ihre Kopie in
der Statuszeile des Viewports (auch in schmalen Fenstern sichtbar) sagen
immer, welche Revision zu sehen ist und ob sie aktuell ist:

| Anzeige | Bedeutung |
|---|---|
| Current rN (grün) | angezeigte = letzte gute = letzte versuchte Revision |
| Building rN · Phase · Zeit (blau) | Build läuft; mit „showing rD“, wenn etwas anderes zu sehen ist |
| Source changed / Loading rN (blau) | Quelle geändert bzw. neue Revision wird geladen |
| Last good rG · rA fails at datei:zeile (bernstein) | letzter Build fehlgeschlagen, das Modell ist der letzte gute Stand |
| Last good rG · rA cancelled | Build abgebrochen, der letzte gute Stand bleibt |
| Viewing rD · rG is latest | ältere Revision gewählt oder Folgen aus; „Go to latest“ |
| No successful build / Build worker failed (rot) | noch kein Modell bzw. Worker startet nicht |
| Disconnected · showing rD · reconnecting (grau) | Verbindung zum Server unterbrochen |
| Static file · rN | `.brep.json`-Eingabe ohne Live-Quelle |

Builds unter 250 ms flackern nicht: beim Folgen geht die Anzeige direkt von
„Current r1“ auf „Current r2“, ohne Zwischenstand „Viewing r1 · r2 is
latest“. Während eines längeren Builds läuft oben
im Viewport ein Balken mit Phase, Laufzeit und **Cancel**.

**Fehler.** Ein bernsteinfarbenes Banner am oberen Rand des Viewports (es
liegt über dem Bild, damit das Modell beim Fehlschlagen und Reparieren nicht
springt) nennt
`datei:zeile:spalte`, die fehlgeschlagene Operation und „called from
datei:zeile“; das Modell bleibt der letzte gute Stand. **Details** öffnet die
Schublade mit Auszug, Aufrufkette, Operation, Zeiten, Ausgabe und Rohdaten,
**Open in editor** springt per `zed://file/…:zeile:spalte` in den Editor
(Einstellung „Open in editor“: Zed, VS Code oder Cursor). Gibt es noch keinen
guten Build, erscheint die Fehlertafel statt eines Modells. Ein nicht
startender Worker zeigt ein rotes Banner mit **Rebuild** und der Fehlermeldung
des Workers (nicht der letzten Stack-Zeile). Ein blaues Banner meldet Hinweise
zur angezeigten Revision, etwa „r6: 2 show/export calls ignored: the
module-level 'result' is the result (Python result contract)“. Nach einem
Build, den eine geänderte importierte Datei ausgelöst hat, sagt der Delta-
Streifen „source unchanged · imports: dims.py changed“. An ein Manifest
gebundene `.fs`-Quellen (etwa eine Kopie von r10b) scheitern bei jeder
Änderung absichtlich mit Art `provenance` und dem Manifestpfad.

**Folgen (`L`).** Standardmäßig ersetzt jede neue gute Revision die
angezeigte. `L` schaltet das Folgen pro Quelle aus; neue Revisionen
erscheinen dann als Chip „rN available · follow off (L)“. Das Folgen pausiert
von selbst, solange das offene Review Annotationen auf einer angezeigten
Revision hat; eine bewusst gewählte ältere Revision wird nie ersetzt. Eine
Auswahl wird nur über aufgezeichnete Identitäten übernommen, sonst sagt ein
Hinweis, warum nicht („B1.F4 has a revision-local identity; not carried to
r8“). Abgeleitete Werte (Messung, Überhänge, Plattenbezug, Schnittkontur,
Geist, Wandstärke) sind an die Modell-ID gebunden und stehen nach dem
Wechsel auf „pending“, bis sie für die neue Revision neu berechnet sind.

**Gleiches Modell, Neuladen, Neustart.** Baut ein Speichern ein früheres
Modell exakt nach (Terminal „r5 ok … same model as r3“, etwa nach Rückgängig
im Editor), trägt dieses Modell ab sofort überall die neue Nummer: Pille,
Modellleiste, Bibliothek und Vergleichsauswahl sagen r5, ohne Neuladen; r3
verschwindet als eigener Eintrag, weil es dieselbe Modell-ID ist. Neue
Revisionen einer Quelle, die gerade nicht angezeigt wird, erscheinen sofort
in der Bibliothek. Ein Neuladen der Seite behält die angezeigte Quelle, auch
wenn sie nicht die erste auf der Kommandozeile ist, samt Fehlerbanner. Nach
einem Neustart von wonky-view bleibt das Modell im Bild („Disconnected ·
showing rD · reconnecting“, dann „Building r1 · … · showing rD“), bis seine
Quelle (am Pfad erkannt) in der neuen Sitzung wieder ein gutes Modell hat;
ist es dieselbe Modell-ID (meist `r0 previous session`), wird nur die Liste
aktualisiert, sonst wird die neue Revision eingewechselt. Der Tab springt
dabei nie auf die erste Quelle.

## Workspace: mehrere Modelle und Baugruppen

Technische Referenz: [`docs/viewer/workspace.md`](viewer/workspace.md).

Statt eines Viewers pro Teil gibt es einen Viewer pro Projekt. Eine
Workspace-Datei (`*.view.json`, Schema `wonky.view-workspace/1`) listet die
Modelle, jedes mit eigener Quelle, eigenem Feature, eigenen Parametern,
eigenem Modul-Manifest und optional einer starren Lage, dazu Baugruppen aus
mehreren Modellen:

```sh
# R20 Single Step Feeder: sechs Module, eine Baugruppe "Single Step Feeder"
WONKY_ONSHAPE_STORE=~/Workspace/wonky-kernel/var/onshape-store \
  node bin/wonky-view.mjs workspaces/r20-single-step.view.json --port 4320 --no-open
# direkt aus dem CAD-Projekt (ein Modell pro Modul, Baugruppe "all")
node bin/wonky-view.mjs ~/Workspace/cad/cad-project-041/single-step-r20/build/studios/manifest.json
# daraus eine Workspace-Datei als Startpunkt erzeugen
node bin/wonky-view.mjs …/build/studios/manifest.json --print-workspace > projekt.view.json
```

`WONKY_ONSHAPE_STORE` braucht es nur, wenn der Viewer nicht aus dem
Haupt-Checkout läuft (Worktrees haben kein `var/`); `store:`-Pfade in der
Datei zeigen sonst auf `<repo>/var/onshape-store`.

**Die Datei.** Pflichtfelder pro Modell sind `key` (klein, eindeutig) und
`source` (`.fs`, `.py` oder `.brep.json`); dazu `label`, `feature`,
`params` (`{ "name": "FeatureScript-Ausdruck" }` wie `--param`), `modules`,
`out`, `format`, `maxSteps`, `curvedContacts`, `contactCapMm`, `python`,
`timeoutMs`, `maxRequests`, `deviationMm` (dieselbe Bedeutung wie die
CLI-Schalter) und `transform`. `defaults` gilt für alle Modelle (nicht für
`feature`, `params`, `modules`, `out`). Pfade gelten relativ zur Datei, `~/`
ist das Home-Verzeichnis, `store:` die Onshape-Ablage. Baugruppen sind
Listen von Instanzen (`{ "model": "tray", "transform": … }`); `open` wählt,
was beim Start offen ist (`assembly:feeder` oder `model:tray`). Eine
fehlerhafte Datei startet nicht und nennt die Stelle
(`wonky-view: $.models[1].key: duplicate key "datums"`). Build- und
Ausgabeschalter neben einer Workspace-Datei enden mit Exit 1; sie gehören in
die Datei. Fehlt die Quelldatei eines Modells oder ist sie nicht lesbar,
scheitert nur dieses Modell (r1 „input error“: „Live source … is missing“
bzw. „cannot be read“); die anderen starten und bauen normal, und sobald die
Datei da ist, baut der Watcher das Modell. Nur wenn keine einzige Quelle
lesbar ist und keine gespeicherte `.brep.json` in der Datei steht, startet
der Viewer nicht („Cannot read live source …“).

**Lage (transform).** Standard ist die Identität: alle R20-Module stammen aus
einem Onshape-Part-Studio und liegen schon im gemeinsamen Koordinatensystem,
die Baugruppe zeigt sie einfach zusammen. Eine Lage ist starr, entweder
`{ "rotate": [{ "axis": [0, 0, 1], "deg": 90 }], "translate": [x, y, z] }` oder
`{ "matrix": [12 oder 16 Zahlen, zeilenweise, mm] }`; Skalierung und Spiegeln
werden abgewiesen. Eine Instanz liegt bei Instanz-Lage ∘ Modell-Lage. Mates
gibt es nicht.

**Baum.** Oben im Parts-Tab steht der Workspace: zuerst die Baugruppen (mit
ihren Instanzen), darunter „Models“ mit jedem Modell, jeweils mit
Vertrauensstand („r3“, „r4 building“, „r5 fails · last good r4“) und
Körperzahl. Ein Klick öffnet Baugruppe oder Modell; die Kamera bleibt
dabei stehen (ein gemeinsames Koordinatensystem, eine Kamera). `F` rahmt
alles Sichtbare des offenen Knotens ein. Der offene Knoten steht in der
Adresse (`#node=assembly:feeder`) und übersteht Neuladen und Neustart. Hat
ein Modell noch keinen guten Build (noch nie gebaut oder jeder Build
fehlgeschlagen), zeigt sein Knoten kein Modell: Titel „<Modell>“ mit „no
model yet · r1 fails“, dazu Live-Anzeige und Fehlertafel genau dieses
Modells. Der erste gute Build öffnet sich dann in diesem Knoten.

**Baugruppe.** Alle sichtbaren Modelle werden zusammen gezeichnet, jedes mit
seiner eigenen neuesten guten Revision; baut ein Modul neu, wechselt nur
dieses Modul, die anderen bleiben unverändert. Ausnahme ist das gerade
angezeigte Modell: Es wird immer in der Revision gezeichnet, die
Modellleiste und Inspektor nennen. Ist Folgen aus (`L`) oder eine ältere
Revision gewählt, bleibt es auch mit Lage (verschobenes Modell) auf dieser
Revision, bis die neue gezeigt wird. Ein Modul, dessen erster Build erst
nach dem Öffnen der Baugruppe fertig wird, erscheint in der Ansicht und mit
seinen Körpern in der Teileliste; die Zahl im Parts-Tab zählt es mit. Pro Instanz gibt es im Baum
ein Auge (in dieser Baugruppe aus- und einblenden) und `I` (isolieren,
nochmal: alle zeigen). Sind alle Instanzen ausgeblendet, ist die Ansicht
leer und nichts ist anklickbar („No instance is shown“). Darunter stehen die Körper jedes sichtbaren Moduls in
eigenen Gruppen; Auge, Farbe, Deckkraft, `Y`, `Umschalt+Y` und `I` wirken wie
gewohnt pro Körper und Modul. Ein Körper, der im Modellknoten ausgeblendet
wurde, bleibt in der Baugruppe ausgeblendet und zeigt dort ein
durchgestrichenes Auge („Show …“). Der Hinweis „Every body is hidden; the
viewport is empty.“ erscheint in der Baugruppe nur, wenn alle Körper aller
gezeigten Module ausgeblendet sind. Ein Klick in der Ansicht wählt in jedem Modul;
das gewählte Modul wird das aktive (Titelzeile „active: R20 context“,
Modellleiste, Inspektor). Schnitt schneidet alle Module und deckelt jedes,
Wandstärke misst im getroffenen Modul, Messen arbeitet zwischen Elementen
eines Moduls (zwei Module ergeben „unsupported: entities from different
revisions“). Vergleich (`W`) braucht ein einzelnes Modell: in der Baugruppe
öffnet `W` das aktive Modul und vergleicht dort. In einem Modellknoten ist
alles wie bei einem einzelnen Viewer.

**Ein Prozess, begrenzter Speicher.** Alle Modelle teilen einen Server, einen
Abfrage-Worker und einen Build-Pool. `limits` in der Datei begrenzt ihn:
`concurrency` (gleichzeitige Builds, Standard 2), `maxWorkers`
(Build-Prozesse inklusive auslaufender, Standard 4, R20: 3), `workerRssMb`
(1536: ein größerer Worker wird nach seinem Build ersetzt),
`displayBudgetMb` (512) und `modelBudgetMb` (256) für ältere Revisionen im
Speicher. Obergrenze grob: Server (etwa 0,5 GB plus Budgets) + `maxWorkers` ×
`workerRssMb` + Abfrage-Worker. Gemessen am 25. September 2026 mit allen
sechs R20-Modulen gebaut (Probelauf mit `concurrency` 1, `maxWorkers` 2):
zusammen 2,1 GB (Server 498 MB, Build-Worker 1072 MB und 217 MB,
Abfrage-Worker 360 MB) statt 6,2 GB für die sechs einzelnen Viewer. Die
Buildzeiten der Module im gemeinsamen Prozess: datums 0,1 s, context 2,2 s,
probe 32 s, tray 66 s, edge 14 s, return 149 s (erster Start; danach zeigt
`r0 previous session` jedes Modul sofort).

**Umstieg von den sechs R20-Viewern.** Die Datei schreibt `--out` nach
`<repo>/tmp/r20-view/<modul>` (bisher relativ zum Arbeitsverzeichnis der
Einzel-Viewer). Beim ersten Start gibt es noch kein `r0` (der Cache-Schlüssel
enthält jetzt Feature und Parameter), ab dem zweiten wieder.

## Aufbau

```
Kopfzeile   Marke · Live-Pille bzw. „N model versions · Local workspace“
            · Spalte links · Copy review · Save review · ? · Einstellungen · Spalte rechts
links       Parts | Models | Checks                   (einklappbar mit [ )
Mitte       Modellleiste: Name, rN · Uhrzeit, Delta-Leiste, Compare with previous
            (im Vergleich: Vorher/Nachher-Auswahl, Tauschen, Compare)
            Viewport: Titel oben links, Auswahlfilter oben rechts, Werkzeugleiste
            links, Achsenkreuz unten links, Ansichtsaktionen unten rechts
            (Side by side: oben rechts, die Werkzeugleiste liegt dann waagrecht
            unten in der Mitte), Statuszeile mit Vertrauens-Chip, Plattenbezug,
            Hover-Zeile, Darstellungslegende, Projektion, mm
rechts      Inspect | Review                          (einklappbar mit ] )
Schublade   Berichte, eingefrorene Quelle, Build-Fehler, Deltas
```

Die Statuszeile kürzt keine Aussagen: passt sie nicht in eine Zeile, rücken
ganze Einträge in weitere Zeilen darüber, und Ansichtsaktionen, Achsenkreuz,
Werkzeugleiste (Side by side) und die schwebenden Panels (Geist, Schnitt,
Überhanglegende) rücken mit nach oben. Überhanglegende und Geist-Panel
teilen sich eine Spalte über den Ansichtsaktionen (unter 900 px oben rechts
unter den Ansichtsaktionen, unter 650 px über dem Achsenkreuz) und stapeln
sich, statt einander zu verdecken. Die drei Tabs der Bibliothek passen bei
jeder Breite in die Spalte: unter 1150 px entfällt die Zahl am Parts-Tab,
unter 900 px alle Zahlen. Abzeichen einer Zeile („Open“, „r14 fails“,
„r2 building“) rücken in schmalen Spalten unter den Namen, statt ihn zu
quetschen. Die Hover-Zeile zeigt Wert und
„exact ±t“ immer vollständig (der ganze Text steht zusätzlich im Tooltip),
die Legende immer „display mesh ±0.02 mm“; nur die übrigen Legendeneinträge
werden bei Platzmangel mit „…“ gekürzt. Solange die Hover-Zeile steht,
verschwindet der Navigationshinweis des Auswahlwerkzeugs.

Beide Seitenspalten lassen sich zu 44-px-Leisten einklappen (`[`, `]`, auf
Layouts mit AltGr-Klammern auch `Alt+[`/`Alt+]`, dazu Knöpfe in der
Kopfzeile); der Viewport wird breiter, nichts liegt über ihm. Der Zustand
bleibt über Neustarts erhalten. Unter 1150 px werden die Spalten schmaler,
unter 900 px schwebt der Inspektor unten rechts, unter 650 px stapelt sich
alles (Bibliothek als Streifen, Viewport, Inspektor).

## Maus und Tastatur

Z zeigt nach oben (Drehteller). Die Kamera ist rechtshändig und
standardmäßig orthografisch; die frühere Spiegelung der Ansicht ist behoben.

| Geste | Aktion |
|---|---|
| Ziehen (Auswählen- oder Drehen-Werkzeug) | Modell dreht sich mit dem Zeiger (wie im OCP-Viewer); die Neigung endet bei ±90° |
| Umschalt-Ziehen, mittlere oder rechte Taste | Verschieben |
| Mausrad, Strg+Mausrad (Pinch) | Zoom zum Mauszeiger (1 µm bis 10 m pro Pixel) |
| Zwei-Finger-Scrollen mit „Trackpad mode“ | Verschieben |
| Klick (weniger als 4 CSS-Pixel Bewegung) | Auswählen |
| Umschalt- oder ⌘-Klick | Element ergänzen oder entfernen (verschiebt auch bei zittriger Hand nicht) |
| Alt-Ziehen mit Zeichenwerkzeug | Drehen |
| Rechtsklick ohne Ziehen | kein Browser-Menü |

`?` oder der Knopf in der Kopfzeile öffnet die vollständige, aus der
Befehlsliste erzeugte Kürzelliste mit Geltungsbereich („Anywhere“,
„Viewport focused“, „In a dialog“) und Filterfeld. Überblick:

| Taste | Aktion |
|---|---|
| V, H | Auswählen, Drehen |
| K | Wandstärke (einmalig) |
| C, A, R, P | Kommentar, Pfeil, Rahmen, Freihand (einmalig; zweimal oder Doppelklick = halten bis Esc) |
| E, Umschalt+E | Kanten an/aus; Nähte und Unterteilungen gedämpft zeigen |
| F | Einpassen, Blickrichtung bleibt |
| 0 / Pos1 | Standardansicht (Iso, eingepasst) |
| 1 3 4 6 8 2 5 (Zahlenreihe oder Ziffernblock) | Vorne, Hinten, Links, Rechts, Oben, Unten, Iso |
| Umschalt+1 … 7 | dieselben Ansichten in Onshape-Reihenfolge |
| O | Orthografisch / Perspektive 35° |
| Pfeiltasten (Viewport fokussiert) | Drehen 15°, Strg 5°, Umschalt 90°, Strg+Umschalt verschieben |
| T | Röntgen: alle Körper 50 % transparent |
| Y, Umschalt+Y, I | gewählte Körper ausblenden, alle zeigen, isolieren |
| G, Umschalt+G, Umschalt+B | Druckplatte, Überhänge, auf gewählter Fläche drucken |
| X | Schnittebene |
| W, Umschalt+W | Vergleich mit voriger Revision; Geist der vorigen Revision |
| L | Live folgen an/aus |
| [ , ] | Bibliothek bzw. Inspektor einklappen |
| ? | Kürzelliste |
| ⌘S / Strg+S | Review speichern (auch in Textfeldern) |
| ⌘Z / Strg+Z | Letzte Annotation entfernen |
| Esc | Stapel: Geste, Dialog, Schublade, gehaltenes Werkzeug, Auswahl, Feld |

Buchstaben passen über das gedruckte Zeichen, Ziffern und Pfeile über die
Tastenposition, sodass QWERTZ, Zahlenreihe und Ziffernblock (auch mit
NumLock aus) funktionieren. Kürzel wirken nicht, solange ein Textfeld den
Fokus hat. Die Einstellung „Single-key shortcuts“ (WCAG 2.1.4) schaltet alle
Einzeltasten ab; `⌘S`, `⌘Z`, `Alt+[`/`Alt+]`, Esc, Pos1 und die Pfeile
bleiben. Das **Ansichtsmenü** (Würfel-Knopf) listet die sieben Ansichten,
das Achsenkreuz unten links zeigt die Orientierung. Die letzte Kamera jeder
Quelle gilt auch nach einem Neustart; Revisionen derselben Quelle behalten
die Kamera exakt, ein Modell einer anderen Quelle wird eingepasst.

## Darstellung

- **Kanten** werden aus exakten Daten klassifiziert: scharfe Kanten dunkel
  und 1,5 px breit (Einstellung 1 bis 3 px), tangentiale gedämpft, Nähte
  periodischer Flächen und Unterteilungskanten zwischen Fragmenten derselben
  Fläche ausgeblendet (`Umschalt+E` zeigt sie gedämpft).
- **Normalen** von Ebenen, Zylindern und Kegeln sind exakt aus Bend,
  Bohrungen wirken daher glatt ohne Facettenstreifen.
- **Farben** kommen aus der Modell-`appearance`, sonst aus einer
  Viewer-Palette mit Label „viewer colors“, sonst aus einer eigenen Farbe im
  Bauteilbaum.
- **Röntgen (`T`)** macht alle Körper 50 % transparent, verdeckte Kanten
  schwach sichtbar (pro Quelle gespeichert).
- Die **Legende** in der Statuszeile nennt „display mesh ±0.02 mm“ und alle
  aktiven reinen Darstellungsfunktionen (Schnitt, Röntgen, Überhang-Abtastung,
  verborgene Nahtkanten). Flächen, für die nur Randkurven vorliegen, werden
  als „faces shown as boundaries only“ gezählt und nicht vervollständigt.
- Zum Öffnen lädt der Viewer nur die binäre Zeichennutzlast
  (`/api/models/<sha>/draw`); die JSON-Szene mit Identität und Quelle folgt
  erst bei der ersten Auswahl.
- Der Viewer braucht WebGL2 mit Stencil. Fehlt es, sagt der Viewport das
  ausdrücklich; Inspektor, Bibliothek und API funktionieren weiter. Geht der
  WebGL-Kontext verloren, meldet der Viewport „Restoring the view…“ und
  stellt das Bild von selbst wieder her.

## Bauteilbaum (Parts)

Der Parts-Tab ist Standard bei Modellen mit zwei oder mehr Körpern und bei
Live-Quellen; ein von Hand gewählter Tab gilt pro Quelle und wird danach nicht
mehr automatisch gewechselt. Jede Zeile hat Auge, Farbfeld (genau die
Renderfarbe), Name, Alias, „46 faces (11 logical)“, Farbherkunft
(„appearance“, „viewer color“, „custom color“) und den FDM-Hinweis
(„on plate“, „floats …“, „cuts …“). Ein Klick auf den Namen wählt den
Körper, Hover hebt ihn hervor. Aufgeklappt: Deckkraft, eigene Farbe mit
Reset, aufgezeichnetes Volumen und Größe („not evaluated“, wenn nicht
aufgezeichnet), erzeugende Operation mit Quellzeile, gedruckt/Aufbaurichtung
und **Export for print** dieses Körpers.

`Y` blendet die gewählten Körper aus, `Umschalt+Y` zeigt alle, `I` isoliert
die Auswahl. Ausgeblendete Körper sind weder sichtbar noch wählbar, auch im
Vergleich zweier Quellen mit gleichen Körper-IDs. Sichtbarkeit, Deckkraft
und Farbe gelten pro Quelle und Körpername und bleiben nach einem Neustart
erhalten. Unter dem Baum stehen die Revisionen der angezeigten Quelle, bei
Live-Quellen mit dem letzten fehlgeschlagenen oder abgebrochenen Versuch oben
(„r3 fails · input error at bracket.fs:31“).

## Inspizieren

- **Hover** hebt die ganze logische Fläche (oder Kante, Punkt) hervor und
  schreibt eine Statuszeile, etwa „Cylinder hole Ø4.0000 mm · exact ±0.0003 ·
  B1.F3“.
- **Klick** wählt (Punkt vor Kante vor Fläche, Tiefe und Auswahlfilter
  „Auto select / Faces / Edges / Points / Bodies“ oben rechts; der Filter
  bleibt gespeichert). Gewählt und gezählt werden **logische Flächen**:
  Fragmente, die entlang exakter Unterteilungskanten auf derselben
  Trägerfläche liegen (Alias `B1.L3` mit Fragmenten `B1.F4, B1.F9`);
  Fragment-Aliase bleiben adressierbar, die Auswahlreferenz zeigt auf das
  geklickte Fragment. `Esc` hebt die Auswahl auf.
- **Exact geometry** zeigt geschlossene Formen aus den gespeicherten
  analytischen Parametern: Ebene mit äußerer Normale, Abstand und
  Ebenenrahmen; Zylinder als Bohrung oder Zapfen mit Ø, r, Achsrichtung und
  dem Achspunkt, der dem Ursprung am nächsten liegt; Kegel mit Halbwinkel;
  Linie, Kreis, Bogen und Punkt.
- Die Abschnitte folgen fester Reihenfolge: Überschrift der Auswahl, exakte
  Geometrie, Messung, Identität (Eigenschaften, Comment, Copy reference),
  Quelle, Browse geometry, LLM-Kontext; ohne Auswahl Modellübersicht (Größe
  mit Label recorded, kernel oder display ±0.02), Körperliste und
  LLM-Kontext.
- **Browse geometry** erreicht jeden Körper, jede Fläche, Kante und jeden
  Punkt, auch verdeckte oder nur als Rand dargestellte; der Tastaturfokus
  bleibt dabei auf der Liste.
- **Quelle:** Bei Flächen und Kanten aus Linien- und Bogen-Skizzen steht
  zuerst die Skizzenzeile („Sketch source · skArc "right" · line 10“), die
  Körperoperation als Kontext; sonst „Operation source“. Elemente aus
  Hilfsfunktionen lesen sich „copyBody (line 20) called from r10b.fs:1382“.
  Jeder Ort ist ein Editor-Link `datei:zeile:spalte`. **Copy source
  reference** kopiert den aufgezeichneten Bezug samt Skizzenelement und
  Aufrufstelle. **Open frozen source** öffnet genau die Bytes, aus denen die
  Revision gebaut wurde: Zeilen, die Geometrie erzeugt haben, sind markiert;
  ein Klick (oder Enter) wählt genau diese Geometrie oder sagt, warum eine
  Zeile keine erzeugt hat. **Hide code** verkleinert die Schublade.
- Bei Booleschen Ergebnissen steht direkt an der Auswahl, dass die
  Split-/Merge-Korrespondenz nicht aufgelöst ist; die Historie belegt
  Körpervorfahren, aber keine Zuordnung einzelner Ergebnisflächen.

## Messen

- **Umschalt- oder ⌘-Klick** sammelt zwei bis acht Elemente; der Abschnitt
  **Measurement** fragt `POST /api/models/<sha>/measure`. Der Browser rechnet
  nichts, er formatiert nur.
- Ebene/Ebene: Winkel, Parallelabstand, koplanar. Linie/Linie: Winkel,
  Abstand der unbegrenzten Geraden, Endpunktabstände. Zylinder und Kreise:
  Radien, Achswinkel, Achsabstand, koaxial/konzentrisch. Bei Zylinderpaaren
  mit parallelen Achsen (Achsabstand d) entscheidet die Lage der Kreise im
  Querschnitt: Zapfen in der Bohrung → **radiales Spiel** r_Bohrung −
  r_Zapfen und **diametrales Spiel** (Beispiel Stift in Bohrung: 0.2000 mm und
  0.4000 mm), bei versetzten Achsen **minimales radiales Spiel** r_Bohrung −
  r_Zapfen − d; Bohrung im Zapfen desselben Körpers → **Wandstärke**
  r_Zapfen − r_Bohrung − d (Rohrwand des Distanzstücks: 3.0000 mm, Schraubloch
  im Dom); dasselbe bei zwei Körpern → negatives Spiel mit dem Hinweis
  „interference of two bodies over … mm of axial overlap“; getrennte
  Zylinder → Abstand der Flächen d − r1 − r2; sich schneidende Kreise →
  keine Spielzeile, nur „unsupported“. Die Werte gelten für die tragenden
  Zylinder („supporting cylinders“); zwei Prüfungen gegen die Trimmung macht
  der Viewer trotzdem, beide aus den exakten Kanten, nie aus dem
  Darstellungsnetz:
  - **Axiale Überdeckung.** Wandstärke und Überschneidung werden nur
    behauptet, wenn sich die Flächen entlang der Achse um mehr als t
    überdecken (Höhen aus den Randkreisen). Überdecken sie sich nicht, stehen
    der **axiale Abstand** g und der exakte **Mindestabstand der Flächen**
    √(D² + g²) da (Hauptzeile, Maßlinie zwischen exakten Punkten), mit D =
    max(|r1 − r2| − d, d − r1 − r2, 0), dem Abstand der Kreise im
    Querschnitt; das gilt für jede Lage der Kreise, auch versetzt oder
    schneidend. Der Wert ist eine untere Schranke, und die Zeile erscheint
    nur, wenn die nächsten Punkte der Kreise auf den einander zugewandten
    Randkanten beider Flächen liegen; dann sind sie die Maßpunkte. Sonst
    „unsupported … not on the facing rims of …“. Beispiele: Scheibe auf der
    Platte über der Bohrung (`stack-washer.fs`, koaxial) 4.0000 mm; dieselbe
    Scheibe um 1 mm versetzt (`offset-washer.fs`) 3.0000 mm zwischen
    (−2, 0, 6) und (−5, 0, 6), wie OCCT; ein Zapfen, dessen Kreis den
    Bohrungskreis schneidet, 2 mm darüber (`crossing-stack.fs`) 2.0000 mm;
    ein D-förmiger Zapfen, dessen Bogen die nächste Richtung nicht enthält
    (`offset-half-boss.fs`), wird mit Begründung abgelehnt. Ist die axiale
    Lage nicht bestimmbar (schräg geschnittener Zylinder), steht bei
    koaxialen Flächen nur die Radiusdifferenz mit diesem Hinweis da, bei
    versetzten „unsupported“.
  - **Getrimmte Bögen.** Bei versetzten Achsen müssen die nächsten Punkte der
    tragenden Zylinder auf den Bögen beider Flächen liegen (Abdeckung aus den
    Kreiskanten, Spielraum t / r); koaxiale Flächen (Radialspalt, Wand) müssen
    eine gemeinsame Richtung haben. Überdecken sich die Flächen axial, zählt
    die Abdeckung **in einer gemeinsamen Höhe der Überdeckung**, nicht die
    aller Randkreise zusammen: eine Fläche mit Endkerbe, deren Kerbgrund bei
    z 6 die nächste Richtung zwar enthält, die aber bei z 7 … 10 (dort, wo die
    andere Fläche liegt) fehlt, bekommt keinen „Gap between cylinders“
    (vorher 2.0000 exakt; OCCT 2.2361). Sonst gibt es keine Spiel- oder
    Abstandszeile, sondern „unsupported: general minimum distance … (… lie
    outside the trimmed arc of B1.F4 [at every height of the axial overlap
    of the faces])“; Beispiel: die beiden Enden des Bogenschlitzes, deren
    10-mm-Spanne im Material läge. Ist die axiale Lage einer Fläche nicht
    bestimmbar, wird die versetzte Beziehung mit Begründung abgelehnt.

  Negative Werte stehen mit echtem Minuszeichen da. Alle Beziehungen werden
  an den gewählten Elementen ausgewertet, nie am gespeicherten Ursprung der
  Fläche (der weit weg liegen kann): Ebenen am Schwerpunkt ihrer
  Randecken, Achsen am Fußpunkt dieses Schwerpunkts. Von zwei Flächen wird
  die kleinere (Diagonale ihres Hüllquaders) gegen den Träger der anderen
  gemessen, bei Achse/Ebene die Achse; die Auswahlreihenfolge ändert daher
  keinen Wert und keine Entscheidung. Parallel und koaxial entscheidet die
  Winkeltoleranz max(1e-9 rad, Genauigkeit der gespeicherten
  Einheitsvektoren beider Körper, t / Diagonale des gemeinsamen
  Hüllquaders **beider** Elemente; bei Achse/Ebene der Achse): „Parallel
  yes“ heißt, an jeder Stelle beider Flächen weicht der Abstand zur anderen
  Ebene um höchstens die Entscheidungstoleranz vom angezeigten Versatz ab
  (die Notiz nennt, um wie viel die Träger über beide Elemente
  auseinanderlaufen). Koplanar und koaxial rechnen diese Abweichung mit ein.
  Verkippte Teile wie `tilted-pocket` bleiben parallel (Taschentiefe
  1.5000 mm). Ein leicht verkipptes kleines Pad weit neben einer großen
  Platte (`tilt-pad.fs`) liest „Parallel no“ und bekommt stattdessen
  „Offset of B2.F1 from the plane of B1.F2 5.0000“, gültig über das Pad;
  zwei Zylinder, deren Achsen nur über den kleineren parallel sind
  (`coax-far.fs`), bekommen keine Koaxial-Aussage, und die
  unsupported-Zeile nennt den Grund. Jede Zeile nennt die verwendete
  Winkeltoleranz, die Antwort oben die größte davon.
  Achse/Ebene: Abstand und Winkel. Punkt/Punkt: Abstand mit ΔX/ΔY/ΔZ;
  Punkt/Ebene: vorzeichenbehafteter Abstand.
- Jede Zeile nennt Methode, Eingänge (`B1.L3@<modelId>`) und Toleranz;
  Aussagen über unbegrenzte Träger sagen das („supporting planes“,
  „infinite lines“). Paare ohne geschlossene Form stehen als „unsupported:
  general minimum distance between trimmed faces needs kernel extrema“ da,
  Elemente verschiedener Revisionen als „unsupported: entities from different
  revisions“. Eine abgelehnte Prüfung (etwa ein Flächenabstand, dessen
  nächste Punkte nicht auf den Rändern liegen) steht immer mit Grund da,
  auch neben einer Zeile über die Trägerflächen wie der Radiusdifferenz.
- Die Hauptzeile erscheint als **Maßlinie** im Viewport mit Wert, Chip und
  „anchor: display pick“ (die Ankerpunkte stammen aus dem Klick auf das
  Darstellungsnetz, der Wert nicht).
- **Wandstärke (`K` + Klick):** misst entlang der exakten Innennormalen an der
  Klickstelle bis zur Austrittsfläche; Nullstellen entscheidet der Kernel mit
  der Membership der getrimmten Flächen. Ergebnis mit Chip `kernel` und Linie
  im Viewport, Details in der Karte oben links. Tangentiale, koinzidente oder
  Kanten-Treffer werden mit den blockierenden Elementen abgelehnt
  („unresolved“); der Strahl wird nie verschoben.
- **Copy measurement** archiviert zuerst die Revisionen und kopiert dann
  Werte und `wonky-inspect`-Befehle, die auch nach dem Beenden des Servers
  funktionieren.

Jeder Zahlenwert trägt ein Label und wird auf die Dekade seiner Toleranz
gerundet („Ø4.0000 mm ±0.0003“; das Bracket-Beispiel hat die Toleranz
4.77e-5 mm und zeigt daher „8.00000 mm · exact ±0.00005“; Winkel auf
0,001°):

| Label | Bedeutung |
|---|---|
| exact ±t | geschlossene Form über gespeicherte analytische Parameter, t = Toleranz des Elements |
| kernel | von einer Bend-Funktion entschieden (Strahl, Membership, Schnitt, Kantenbänder); kann „unresolved“ sein |
| recorded | beim Build aufgezeichnet; fehlende Werte heißen „not evaluated“, nie 0 |
| design | Parameter aus dem Quellaufruf: Absicht, keine Geometrie |
| reference | eingefrorene externe Vergleichswerte |
| display ±t | aus Darstellungsdreiecken oder -polylinien |
| unsupported | Fähigkeitsgrenze mit Grund, ohne Wert |

## Vergleich und Diff

Der Viewer zeigt standardmäßig **ein** Modell, die neueste Revision der
ersten Quelle. Die Modellleiste nennt Name, Revision (`r12 · 14:03`) und die
**Delta-Leiste** gegenüber der vorigen Revision derselben Quelle: Körper,
Flächen roh und logisch, Kanten, Volumen und Grenzen mit Label, geänderte
Quellzeilen („source: line 37 changed“). Ein Klick öffnet alle Werte, eine
Tabelle pro Körper und die geänderten Zeilen alt/neu in der Schublade. Die
Leiste öffnet nie von selbst einen Wipe.

- **`W` / Compare with previous:** Wipe gegen die vorige Revision derselben
  Quelle; noch einmal `W` führt zurück zu einem Modell. Ohne vorige Revision
  (etwa bei einer einzelnen `.brep.json`) öffnet sich der Vergleich mit
  fokussierter Vorher-Auswahl. Die Auswahllisten nennen die aktuelle Quelle
  zuerst, jede Option mit Name, Revision und Hash.
- **Wipe** (Teiler ziehen, Pfeiltasten auf dem Griff in 2-%-Schritten) und
  **Side by side** teilen Kamera und Gesamtgrenzen („Linked camera“); Layout
  und Teilung bleiben global gespeichert, Compare an/aus pro Quelle. Waren
  die Modelle vor einem Layoutwechsel vollständig im Bild und würden sie im
  neuen Layout (halbe Breite) abgeschnitten, passt der Viewer sie mit
  gleicher Blickrichtung neu ein; eine bewusst hineingezoomte Ansicht bleibt.
  Ein geladenes Review stellt seinen eigenen Modus her. **Tauschen** vertauscht
  Vorher und Nachher.
- **Models-Tab:** Revisionen nach Quelle gruppiert, neueste zuerst, ältere
  unter „N earlier“, archivierte Snapshots in eigener Gruppe. Ein Klick auf
  eine andere Quelle verlässt den Vergleich und passt die Ansicht ein; ein
  Vorher-Modell aus einer anderen Quelle wird ebenfalls mit eingepasst
  (Blickrichtung bleibt, beide Modelle sind im Bild);
  innerhalb derselben Quelle bleiben Vorher-Modell und Kamera, der Fokus
  bleibt auf der Zeile. Die Suche filtert nach Name und Hash. „rN is newer“
  in der Modellleiste führt bei Live-Quellen zur neuesten Revision und nimmt
  das Folgen wieder auf.
- **Refresh workspace** (↻) liest `.brep.json`-Eingaben und Berichte neu;
  neu gebaute Modelle erscheinen als zusätzliche Revisionen, Auswahlen und
  Kommentare bleiben an ihrer Revision.
- **Geist (`Umschalt+W`):** die vorige Revision derselben Quelle
  halbtransparent hinter dem Modell (im Vergleich das Vorher-Modell), mit
  Überblendregler (global gespeichert) und Grenzen- und Volumen-Delta mit
  Label. Fehlen aufgezeichnete Grenzen, rechnet der Kernel sie aus
  Kantenbändern (Label `kernel`, für Ebenen, Zylinder und Kegel), auch in
  der Delta-Leiste; sonst display ±0.02. Bei jedem Revisionswechsel
  verschwindet der Geist im selben Takt und steht auf „pending“, bis er neu
  berechnet ist. Der Geist ist Darstellung, kein berechnetes
  Materialdifferenz-Volumen.

## Schnitt

`X` (oder der Knopf in den Ansichtsaktionen) schaltet eine Schnittebene durch
die Modellmitte ein, bis zu drei über „+ Plane“. Regler und mm-Feld
verschieben sie, X/Y/Z wählen die Achse (die zur Kamera zeigende Seite wird
weggeschnitten), „From view“ richtet sie nach der Blickrichtung aus, „Flip“
dreht die Seite. Die Schnittflächen werden in Körperfarbe mit leichter
Schraffur geschlossen und als „display section ±0.02 mm“ bezeichnet; Körper
mit reinen Randflächen stehen als „cap unavailable“ in der Liste. Der
weggeschnittene Teil ist nicht wählbar, und ein Klick auf eine
Schnittfläche wählt nichts statt der verdeckten Innenfläche dahinter.
**Exact contour** fragt den Kernel (`sectionSolid`) nach der exakten Kontur
der aktiven Ebene; Grenzen wie `FaceContact`, `FaceRejected` oder
`FaceUnresolved` erscheinen wörtlich mit ihrer Ursachenkette, die Ebene wird
nie verschoben. Eine neue Anfrage bricht die alte ab. Ebenen und Zustand
bleiben pro Quelle gespeichert.

## Druckbarkeit (FDM)

- **`G` Druckplatte:** 256 × 256 mm bei Z = 0 als Raster (10 mm / 1 mm) mit
  Umriss und Ursprungsachsen, bei Live-Quellen standardmäßig an; die
  Untenansicht (`2`) sieht durch die Platte. Die Statuszeile nennt für einen
  sichtbaren Körper „on plate“, „floats 3.2 mm above the plate“ oder „cuts
  0.4 mm into the plate“ mit Label; bei mehreren Körpern steht das in den
  Zeilen des Bauteilbaums.
- **`Umschalt+G` Überhänge:** eine Fläche hängt über, wenn
  α = asin(max(0, −n·up)) größer als α_max ist (cad-khana, Standard 45°).
  Ebenen entscheidet die Druckbarkeits-API exakt, Zylinder und Kegel bekommen
  exakte Winkelbänder, die über exakte Normalen eingefärbt werden (Legende mit
  Bandkantenfehler der Darstellungsstreifen). Die Legende sagt „overhang
  α > 45° from vertical (slicer threshold β = 45°)“, „bridge exemption
  (≤ 10 mm) not applied“ und nennt die Ausnahme kleiner Bohrungen
  (Ø ≤ 12 mm, umrandet „exempt: small bore“). Die Färbung erscheint erst,
  wenn die Antwort für die angezeigte Revision da ist („pending“).
- **`Umschalt+B` Auf gewählter Fläche drucken:** setzt die Aufbaurichtung des
  Körpers auf −n der exakten Flächennormalen; die Geometrie bewegt sich nie.
  „Printed“ und Aufbaurichtung gelten pro Körper und bleiben über Neustarts.
- **Print check** (Ansichtsaktion): Plattengröße, α_max mit β, Ausnahmen und
  pro Körper Druckstatus, Richtung und Plattenbezug.
- **Export for print** (Inspektor oder Bauteilbaum): `print.stl` und
  `print.json` der Revision oder eines Körpers; das Manifest nennt die
  Sehnenabweichung („within 0.0193 mm … requested at most 0.02 mm“).
  Flächen, die das Druck-Netz nicht abdeckt, geben eine Fähigkeitsmeldung.

## Reviews und Annotationen

- **Annotationen:** Kommentar per Klick (`C`), Pfeil (`A`), Rahmen (`R`) und
  Freihand (`P`) per Ziehen; jedes Werkzeug gilt für eine Annotation und
  springt dann auf Auswählen zurück. Der Text wird im Review-Tab bearbeitet;
  eine Karte stellt Modelle, Layout, Teilung, Kamera und Ziel wieder her.
  Annotationen anderer Ansichten werden ausgeblendet („1 annotation in another
  view · Restore“). `⌘Z`/`Strg+Z` entfernt die letzte. Alte Reviews zeigen
  ihre Zeichnungen an derselben Geometrie; Zeichnungen einer alten
  Wipe-Ansicht über zwei verschiedene Modelle werden mit Hinweis ausgeblendet.
- **Save review (`⌘S`/`Strg+S`)** speichert Titel, Notizen, Kamera, Vergleich
  und Annotationen unter `reviews/WKR-….json` (dazu `.md` und `.context.md`)
  und archiviert jede referenzierte Revision, auch Live-Revisionen; neue
  Reviews tragen `cameraConvention: 2`. „Unsaved changes“ erscheint nur,
  wenn das Review Inhalt hat und sich vom gespeicherten Stand unterscheidet;
  die Kamera zählt nicht. **Copy review** kopiert Code, URL `#review=…` und
  den Kontextpfad. Eine beschädigte Review-Datei erscheint als rote Zeile,
  der Arbeitsbereich lädt trotzdem.

## LLM-Kontext und Agenten

- Jede Kopieraktion (**Copy reference**, **Copy references (N)** für eine
  Mehrfachauswahl, **Copy selected geometry**, **Copy model overview**,
  **Copy measurement**, **Copy LLM context**) archiviert zuerst die
  referenzierten Revisionen; die kopierten `wonky-inspect`-Befehle nutzen
  absolute Pfade und funktionieren nach dem Beenden des Servers. Wo der
  Browser `ClipboardItem` kennt, beginnt das Kopieren noch im Klick und wird
  nach der Serverantwort gefüllt (Safari lehnt späte Schreibzugriffe sonst
  ab).
- **Copy LLM context** umfasst nur die sichtbaren Modelle (nie ein
  verstecktes Vergleichsmodell), die Auswahl mit exakten Daten, Messungen ab
  zwei Elementen und die Änderungen gegenüber der vorigen Revision derselben
  Quelle. Kurze Aliase wie `B1.F2` gelten nur zusammen mit dem Modellhash.
- Der Kontext eines gespeicherten Reviews (`GET /api/feedback/<id>/context`,
  auch `reviews/<id>.context.md`) nennt jede annotierte Fläche mit Alias,
  exakten Daten und `wonky-inspect … --revision <sha> --detail <alias>`.
  Reviews aus der Zeit vor gespeicherten Aliasen bekommen den Alias aus
  Körper, Elementart und Index in der eingefrorenen Revision; fehlt die
  Revision, steht dort „detail unavailable“ statt eines falschen Befehls.
- `GET /api/selection` liefert die aktuelle Browser-Auswahl mit Aliasen,
  logischen Flächen und exakten Zusammenfassungen, damit ein Agent „die
  Fläche, die Marc gewählt hat“ ansehen kann. `wonky-view --json` liefert
  Build-Ereignisse ohne Browser.
- `node bin/wonky-inspect.mjs <modell.brep.json> --revision <sha> --detail
  B1.F2` ruft Details ohne laufenden Viewer ab
  ([geometry-summary.md](geometry-summary.md)).

## Prüfberichte

Der Checks-Tab („Workspace checks (not specific to this model)“) öffnet die
Kernel-Berichte aus `out/` in der Schublade: bestandene Prüfungen, offene
Fehler und reine Messberichte getrennt, Rohdaten aufklappbar. Bildberichte
zeigen Vorher, Nachher und geänderte Pixel; die API prüft die aufgezeichneten
SHA-256-Werte der Bilder.

## Einstellungen, Themes und Barrierefreiheit

Der Knopf „Settings“ in der Kopfzeile listet alle Einstellungen: Theme,
Einzeltasten-Kürzel, Kantenbreite, Nähte/Unterteilungen, Trackpad mode,
Überhangschwelle α_max, Ausnahme kleiner Bohrungen, Plattengröße, Editor für
Quell-Links. Alles liegt in `reviews/viewer-settings.json` (global, pro
Quelle, pro Quelle und Körper) und gilt nach einem Neustart weiter. Jede
Änderung im Dialog wirkt sofort (Kantenbreite, Nähte, Projektion usw.), ohne
Neuladen; Einstellungen pro Quelle oder Körper ändert man dort, wo sie wirken.
Überlappende Änderungen gehen nicht verloren: eine späte Serverantwort
überschreibt keinen neueren Wert.

- **Theme:** hell (Standard), dunkel oder „System“, über die Design-Tokens
  in `viewer/styles/tokens.css`. Das Modell behält seine Farben.
- **Kontrast und Größe:** jede Textfarbe erreicht auf jeder Fläche mindestens
  4,5:1, in beiden Themes; kein Text ist kleiner als 11 px.
  `node scripts/viewer/qa/contrast.mjs --url http://127.0.0.1:43NN/viewer/`
  prüft das laufende Programm, `--static` die Stylesheets.
- **Fokus:** Beim Neuzeichnen bleibt der Tastaturfokus auf dem bedienten
  Element. Die Schublade (`role="dialog"`) nimmt den Fokus auf, hält Tab in
  sich, schließt mit Esc und gibt den Fokus zurück. Tabs haben wanderndes
  `tabindex` und Pfeiltasten. Fehlerbanner bleiben 8 s stehen, ein neuerer
  Fehler startet die Zeit neu.
- Reduzierte Bewegung (Betriebssystem) schaltet Übergänge ab.

## API

```text
GET  /                                        -> /viewer/
GET  /viewer/…                                Viewer-Dateien (unbekannt: 404)
GET  /api/workspace                           Modelle, Live-Quellen (sources), Berichte, Reviews, Workspace-Baum (tree)
GET  /api/models/<sha>                        Darstellungsszene (JSON, kompakt)
GET  /api/models/<sha>/draw                   binäre Zeichennutzlast wonky.draw/1 (ETag, gzip)
GET  /api/models/<sha>/summary?format=text&level=bodies
GET  /api/models/<sha>/entities/B1.F2         Rohdaten eines Elements
GET  /api/models/<sha>/geometry?aliases=B1.F7 exakte Parameter
POST /api/models/<sha>/measure                {"entities":[{"alias":"B1.F7"},{"alias":"B2.F3"}]}
GET  /api/models/<sha>/topology               Kantenklassen, logische Flächen
GET  /api/models/<sha>/history                Aufrufe, Quellzeile -> Geometrie
GET  /api/models/<sha>/parts                  Körper mit Zählungen, Farben, Herkunft
POST /api/models/<sha>/printability           Überhänge, Platte, Ausnahmen
POST /api/models/<sha>/section                exakte Schnittkontur
POST /api/models/<sha>/thickness              Wandstärke an einem Punkt oder Strahl
POST /api/models/<sha>/resolve                Auswahl in eine neue Revision übernehmen
POST /api/models/<sha>/archive                Revision nach reviews/models/ archivieren
GET  /api/models/<sha>/print.stl?body=…       Druckexport (dazu print.json)
GET  /api/compare?before=<sha>&after=<sha>    Deltas und geänderte Quellzeilen
GET  /api/compare/revisions                   Revisionsnummern, Zeiten, Arten
GET  /api/diff?after=<sha>[&before=<sha>]     Geist-Paar mit Kernel-Grenzen
GET, POST /api/selection                      aktuelle Auswahl im Browser
POST /api/context                             Referenzen, Übersicht, LLM-Kontext
GET  /api/events                              Server-Sent Events der Live-Builds
GET  /api/live                                Live-Quellen, Jobs, Ring
POST /api/live/<quelle>/rebuild|cancel        Build neu starten oder abbrechen
POST /api/live/pins                           Revisionen des Tabs festhalten
GET, PUT /api/settings                        Viewer-Einstellungen
GET  /api/source/<sha>                        eingefrorene Quelle
GET  /api/reports/<id>                        Prüfbericht
GET  /api/feedback/WKR-<code>[/context]       gespeichertes Review bzw. sein Kontext
POST /api/feedback                            Review speichern
```

Jede Anfrage muss als Host `127.0.0.1:<port>` oder `localhost:<port>`
nennen, schreibende Anfragen kommen nur vom selben Ursprung. Unbekannte
Szenen bleiben wie bisher 400; neue Routen antworten mit 400/404/422/500 und
501 für Fähigkeitsgrenzen.

## Dateien auf der Platte

| Pfad | Inhalt |
|---|---|
| `reviews/WKR-*.json`, `.md`, `.context.md` | Review, Zusammenfassung, LLM-Kontext |
| `reviews/models/<sha>.brep.json` | archivierte, unveränderliche Modellrevisionen |
| `reviews/sources/<sha>.txt` | eingefrorene Quellen (nur mit passendem SHA-256, auch außerhalb des Repos) |
| `reviews/viewer-settings.json` | globale, Quell- und Körper-Einstellungen |
| `tmp/viewer/live-cache/` | letzte gute Revision je Live-Quelle und Build-Optionen (r0 beim nächsten Start) |
| `workspaces/*.view.json` | Workspace-Dateien (R20: `r20-single-step.view.json`) |

Fehlt die passende Quelldatei, bleibt der aufgezeichnete Auszug verfügbar;
neuer Quellcode wird nie als alte Revision ausgegeben.

## Bekannte Grenzen

- Python: Teilenamen und Farben liefert das build123d-Frontend noch nicht
  (Bauteilbaum zeigt Körper-IDs und Viewer-Farben). Überschreitet die Ausgabe
  1 MiB oder das Anfragebudget, bleibt der Interpreter bis zur Zeitgrenze
  plus 2 s hängen und wird dann als `timeout` gemeldet (der eigentliche Grund
  geht dabei verloren, bis das Frontend die Prozessgruppe selbst beendet).
- Keine allgemeinen Mindestabstände, Flächeninhalte oder Schwerpunkte
  (keine Bend-Extremalfunktionen): solche Paare stehen als „unsupported“ da.
  Die Trimmprüfungen beim Messen kennen nur Randkreise und Kreiskanten;
  schräg geschnittene Zylinder bekommen keine Wand- oder
  Überschneidungsaussage.
- Ein abgebrochener Build ohne freien warmen Worker läuft zu Ende oder bis
  ein warmer Ersatz bereitsteht und belegt so lange einen Prozessorkern
  (dafür wartet der neueste Build nie auf einen kalten Start).
- Wandstärke: Startflächen auf Kegeln oder anderen Flächen als Ebene und
  Zylinder antworten mit „unsupported“ (501).
- Schnitt: Deckel sind Darstellung; Kegel geben bei „Exact contour“
  `FaceRejected`, Ebenen auf Flächen oder Ecken einen Kontaktfehler des
  Kernels (`FaceContact`, mit der laufenden Kernel-Arbeit auch
  `FaceUnresolved`); der Viewer zeigt, was der Kernel sagt.
- Überhänge: die Brückenausnahme (≤ 10 mm) wird nicht angewendet.
- Workspace: Änderungen an der Workspace-Datei selbst brauchen einen
  Neustart (die Datei wird noch nicht beobachtet). Reviews speichern das
  aktive Modell, nicht den Baugruppenknoten. Messlinien, Wandstärke-Anzeige
  und Diff-Geist eines Moduls mit einer Lage ungleich der Identität werden
  in Modellkoordinaten gezeichnet (für R20 ohne Bedeutung, alle Lagen sind
  Identität). `GET /api/selection` nennt die Lage einer Auswahl noch nicht.
- „Fit selection“ (`Umschalt+F`), Ansichtswürfel, Drehen um den gewählten
  Punkt und parameterweise Deltas sind zurückgestellt (Spec Abschnitt 14).
- Die Modellgröße im Inspektor nutzt aufgezeichnete Grenzen, sonst das
  Darstellungsnetz (display ±0.02); kernel-berechnete Grenzen erscheinen im
  Geist-Panel, in der Delta-Leiste und beim Plattenbezug.

## Prüfungen und Nachweise

Stand **23. September 2026, 10:34 bis 10:50 Uhr**, auf dem integrierten
Arbeitsbaum, auf einer geteilten, stark ausgelasteten Maschine
(Load-Average 35 bis 85, bei jedem Schritt in `results.json` vermerkt).
Alle Nachweise liegen unter `out/viewer/integration/`; ältere Läufe sind
dort nicht mehr enthalten.

**Browser-QA** (`out/viewer/integration/qa/qa.mjs`, Playwright/Chromium mit
Metal, 1536 × 900 CSS-Pixel, eigene Instanzen auf 4380 bis 4383, danach
beendet): **36 von 36 Schritten bestanden**, keine Konsolenfehler
(`results.json`; die Live-Sitzung wurde um 10:45 Uhr komplett wiederholt,
nachdem der Öffner-Nachweis einen frischen Sitzungsmarker brauchte).

- Statische Sitzung mit zehn Fixtures und `r10b-retained` (s01 bis s21):
  Start mit einem Modell ohne Vorher/Nachher; Ansichtstasten, Ansichtsmenü,
  Perspektive (Pick in Perspektive trifft den Zeiger auf 1e-13 px); Hover
  „Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3“; exakte Geometrie der
  Bohrung; Bracket-Wände „Parallel offset 8.00000 mm · exact ±0.00005“ mit
  Maßlinie „anchor: display pick“; `K` misst 8.00000 mm `kernel`; Schnitt mit
  Deckeln und exakter Kontur; Platte und Überhanglegende mit β und
  Brückenhinweis; Bauteilbaum mit Auge und `Umschalt+Y`; `W` ohne vorige
  Revision öffnet die Vorher-Auswahl, Delta-Leiste und -Schublade, Wipe und
  Side by side; Skizzenquelle „skArc "right" · line 10“ mit `zed://`-Link
  und eingefrorener Quelle; einmaliger Kommentar, `⌘S`, Neuladen über
  `#review=`, LLM-Kontext; Kürzelliste (66 Zeilen) und Einstellungen;
  Prüfberichte mit Fokus in der Schublade; r10b-Farben aus `appearance`;
  WebGL-Kontextverlust stellt sich selbst wieder her; dunkles Theme und
  1150/900/650 px; Kontrastprüfung (hell 1254, dunkel 1362 Texte, 0 unter
  4,5:1, 0 unter 11 px, `contrast.txt`); Suche, Refresh, Pfeil/Rahmen/
  Freihand, `⌘Z`, Copy reference mit Alias, Esc, Copy review, Tauschen,
  Teiler per Pfeiltaste (52 / 48).
- Live-Sitzung auf einer Kopie von `examples/bracket.fs` (l01 bis l09):
  „Current r1“ mit Parts-Tab und Platte; Speichern zeigt r2 **125 ms** nach
  dem Schreiben der Datei, Kamera unverändert, Delta-Leiste „volume
  +4,416 mm³ recorded · bounds Δ 0 × 0 × +4 mm · source: line 37 changed“;
  Syntaxfehler zeigt das Banner mit `bracket.fs:31:9`, die Pille „Last good
  r2 · r3 fails at bracket.fs:31“ und einen `zed://file/…:31:9`-Link; `W`
  vergleicht r4 mit r2; Geist „r2 ghost“; `L` aus zeigt „r5 available ·
  follow off (L)“; LLM-Kontext; Server-Neustart: „Disconnected · showing r5
  · reconnecting“, danach verbindet sich derselbe Tab wieder, der Öffner
  lief genau einmal (`opener-calls.txt`, Terminal „tab reconnected; no new
  tab opened“); alle kopierten `wonky-inspect`-Befehle enden nach dem
  Beenden des Servers mit Exit 0 (`l09-inspect-after-stop.txt`).
- Langsame, fehlschlagende Live-Quelle (w01 bis w03): „Building r2 ·
  evaluating · 0.3 s“ mit Balken und Cancel, danach „Last good r1 · r2
  cancelled“ mit unverändertem Modell; ein Boolean-Fehler in einer
  Hilfsfunktion zeigt „capability error at part.fs:32:5 in opBoolean, called
  from part.fs:57“; der Vertrauens-Chip bleibt bei 1100, 900 und 650 px im
  Viewport.

**Regression review** (23. September 2026, ab 17:20 Uhr, Load-Average 13 bis 27;
`out/viewer/integration/qa/Regression review.mjs`, eigene Instanzen auf 4384 bis
4386, danach beendet): **24 von 24 Schritten bestanden**, keine
Konsolenfehler (`results-Regression review.json`, Screenshots `f01` bis `f14`).

- Statuszeile bei 1600, 1280 und 1024 px: „Cylinder hole Ø4.0000 mm · exact
  ±0.0003 · B1.F3“ und „display mesh ±0.02 mm“ vollständig lesbar, nichts
  überdeckt die Ansichtsleiste (`f01-hud-*.png`); Side by side hält
  Werkzeugleiste und Undo bei 1024 bis 1920 px erreichbar, auch mit
  gespeichertem Review (`f02-*.png`, `f07-*.png`); die Auswahl „Auto
  select“ ist bei 1024 px nicht mehr abgeschnitten (`f14-*.png`).
- Einstellungen wirken sofort: Kantenbreite 1.5 → 3, Nähte, Perspektive
  (`f03-*.png`). Bohrung × Außenzylinder des Distanzstücks: „Wall thickness
  3.0000 mm exact ±0.0003“, keine „interference“ (`f04-wall-thickness.png`).
  Vorher-Modell aus einer anderen Quelle: alle 8 Ecken im Vorher-Bereich,
  Wipe und Side by side (`f05-*.png`). LLM-Kontext eines alten Reviews ohne
  Alias nennt wieder `B1.F2` mit exakten Daten und `--detail`
  (`f06-legacy-review-context.txt`).
- Live mit `bracket.fs`, einer langsamen `.fs`-Quelle und `main.py` mit
  `dims.py`: eine Änderung an `dims.py` baut neu (`main r2 … 26×26×12 mm`);
  eine Endlosschleife endet nach 7,1 s als `FAILED timeout`, in der
  Prozessgruppe des Workers bleibt kein Python übrig; ein Bracket-Speichern
  ist 134 ms später gebaut, während die langsame Quelle noch baut; drei
  Folge-Speicherungen gehen von „Current rN“ direkt auf „Current rN+1“, ohne
  „Viewing … is latest“ (`f11-follow-current.png`); die Statuszeile bleibt
  mit Platten-Chip lesbar (`f12-live-hud-1600.png`).

**Regression review 2** (23. September 2026, 18:35 bis 18:50 Uhr, Load-Average 22
bis 28; `out/viewer/integration/qa/Regression review2.mjs`, eigene Instanzen auf
4387 und 4388, danach beendet): **statisch 10 von 10, live 8 von 8 Schritten
bestanden**, keine Konsolenfehler (`results-Regression review2-static.json`,
`results-Regression review2-live.json`, Screenshots `g01` bis `g12`, Terminals
`terminal-fix2-*.txt`).

- Messen: Bohrung der Platte × Außenfläche der aufliegenden Scheibe
  („Minimum distance between the faces 4.0000 mm“, axialer Abstand 0, keine
  „interference“, `g01-stack-no-interference.png`); die Enden des
  Bogenschlitzes ergeben keinen „Gap between cylinders“ mehr, sondern
  „unsupported … outside the trimmed arc of B1.F4“ (`g02-*.png`); die
  verkippte Tasche misst „Parallel offset 1.5000 mm“ mit „Parallel yes“
  (`g03-*.png`).
- Wipe mit Einpassen (`0`), dann Side by side: beide Modelle vollständig im
  Bild (`g04-*.png`). Der Checks-Tab ist bei 1536, 1280, 1150, 1024 und
  900 px ganz sichtbar (`g05-library-tabs-*.png`).
- Live mit `bracket.fs` und `main.py` + `dims.py`: nach 8 → 12 → 14 mm,
  Syntaxfehler und Rücknahme meldet das Terminal „bracket r5 ok … same model
  as r3“, und Pille, Modellleiste („r5 · … · latest“) und Bibliothek sagen
  ohne Neuladen r5 (`g06-*.png`). Eine fehlschlagende Live-Zeile bleibt bei
  1280 und 1024 px lesbar, „r6 fails“ steht unter dem Namen (`g07-*.png`).
  Geist-Panel und Überhanglegende überdecken sich bei 1600, 1280, 1024 und
  390 px nicht, Schließen und Delta sind anklickbar (`g08-*.png`). Eine
  neue Revision von `main.py` erscheint in der Bibliothek, während
  `bracket.fs` angezeigt wird (`g09-*.png`). Fünf Speichervorgänge an
  `dims.py` in 550 ms bei 1,5 s Buildzeit: r4 bis r6 „cancelled“, r7 ist
  2,9 s nach dem letzten Schreiben fertig, kein „cold worker“. Neuladen mit
  angezeigtem, fehlschlagendem `main.py` zeigt wieder `main.py` samt Banner
  (`g11-*.png`). Neustart des Servers: in 62 Stichproben nie „No models
  yet“, der Chip geht von „Disconnected · showing r10 · reconnecting“ über
  „Building r1 · warming worker · … · showing r10“ zurück, der Tab bleibt
  bei `main.py` (`g12-after-restart.png`).

**CLI und API** (`qa/api-cli.mjs`, `api-cli.json`): 47 von 47 Zeilen
bestanden, darunter `--help`, Argumentfehler, strikter Port (4310 belegt →
Exit 1), statische Dateien und Traversal, `sources` in `/api/workspace`,
Host-Allowlist (403), Cross-Origin (403), Review speichern und Kontext, alle
neuen Routen aus Spec 9.2 und `wonky-inspect`.

**Inventar:** `out/viewer/integration/inventory-checklist.md` ordnet jede
Zeile aus `docs/viewer/feature-inventory.md` einem Nachweis oder der
begründeten Änderung in Spec Abschnitt 13 zu.

**Tests** (`nice node --test` über `test/viewer-*.test.mjs`,
`test/review.test.mjs`, `test/display-*.test.mjs`,
`test/geometry-summary.test.mjs`; 30 Dateien; Lauf nach der Regression review 2,
gegen 19:00 Uhr): **403 von 403 bestanden**
(`out/viewer/integration/tests-Regression review2.txt`), darunter VS 32/32, RV 7/7,
DC, DE und GS und die sieben neuen Regressionstests der Regression review 2
(Messen 4, Worker-Pool 1, Live-Client 1, Kamera/Layout 1).
`scripts/viewer/check-format.mjs` (183 Dateien) und
`scripts/viewer/check-contracts.mjs` (65 DOM-IDs, 20 Fassadenfelder, 21
Harness-Funktionen, statische Prüfung) sind grün.
`src/review-scene.mjs` und `src/display-cylinder.mjs` sind unverändert
(SHA-256 wie in `out/viewer-trims/regression.json`).
