# Wann Wonky zum persönlichen Hauptwerkzeug werden kann

Stand: 22. September 2026. Persönliche Nutzung für Marcs tatsächliche Teile ist
ein plausibles Entwicklungsziel. Ein zuverlässiger Ersatz für den gesamten
Funktionsumfang und die Robustheit industrieller CAD-Kerne ist nicht belegt.
Die beauftragte vollständige Bend-Geometrie bleibt das Ziel; die folgenden
Abnahmestufen dürfen fehlende Fähigkeiten nicht als erledigt umdefinieren.

## Aktuelle Einschätzung

Wonky ist heute noch kein Ersatz im täglichen produktiven Einsatz. Der letzte
vollständige r10b-Lauf scheitert am ersten allgemeinen Boolean und beendet
keine seiner neun Hauptstufen. Fillets fehlen. Gültige Grundkörper, analytische
Exporte und separat geprüfte Schnittverfahren sind echte Teilergebnisse,
aber noch kein Nachweis zuverlässiger längerer Modellierketten.
Der erneute [Integrationslauf](../out/tests-boolean-pcurves-integration.json)
besteht mit 400/400 Tests. Die gleichzeitig aktuelle
[r10b-Abnahme](../out/acceptance-pcurves/report.json) bestätigt dennoch 0/9
Hauptstufen. Beide Zahlen messen unterschiedliche Anforderungen.

Der persönliche Nutzen kann früher entstehen als allgemeine Kernel-Parität:
Code-Herkunft von Flächen, wiederholbare Geometrietests, Modell- und Bilddiffs,
strukturierte Viewer-Kommentare und kurze gezielte LLM-Abfragen. Ob damit eine
Reparatur tatsächlich schneller und zuverlässiger gelingt, muss an Aufgaben
gemessen werden; weniger Text allein belegt weder Tokenersparnis noch Qualität.

build123d ist ein Python-Frontend auf OpenCascade. Ein eigener Code-CAD-
Arbeitsablauf ersetzt deshalb eine andere Schicht als ein eigener B-rep-Kern.
Wonky entwickelt beide. FeatureScript-Syntax zu lesen bedeutet außerdem noch
nicht, die gesamte Onshape-Standardbibliothek oder ihre Semantik abzudecken.

## Abnahme für einen persönlichen Wechsel

1. **r10b vollständig:** unveränderte eingefrorene Quelle und Abhängigkeiten,
   alle neun Hauptstufen, echte geschlossene Ergebnisgeometrie und unabhängig
   geprüfte Exporte. Anschließend Vergleich gegen eine vollständige fixierte
   Referenzgeometrie; ein erfolgreicher Build allein beweist keine Gleichheit.
2. **Repräsentativer Teilebestand:** beispielsweise 20–50 echte eigene Teile,
   ausgewählt nach den tatsächlich benötigten Operationen. Fehler offen
   erfassen; die Auswahl nicht nachträglich auf erfolgreiche Fälle beschränken.
3. **Änderungsfestigkeit:** Parameterreihen, kleine Lageänderungen, Tangential-
   und Kontaktfälle, wiederholte Booleans und Fillets, Transformationen sowie
   neue Builds nach vorherigen Fehlern. Gültigkeit, Maße, Topologie und
   Materialdifferenz separat prüfen.
4. **Referenzen und Diagnose:** Codebezug und Identitäten bleiben bei bekannten
   Änderungen stabil. Split/Merge-Mehrdeutigkeiten werden sichtbar, statt eine
   falsche Flächenkorrespondenz zu erfinden. Fehler nennen Operation und Ursprung.
5. **Praktische Nutzung:** mehrere reale Änderungs- und Fertigungsaufgaben mit
   brauchbaren Exporten abschließen. Erfolgsquote, manuelle Eingriffe und Zeit
   bis zum korrekten Teil zählen ebenso wie die reine Rechenzeit.

Erst danach ist ein Wechsel als persönliches Hauptwerkzeug begründbar.
Bestehende CAD-Werkzeuge bleiben bis dahin externe Vergleichsmöglichkeiten;
sie werden nicht als versteckter Produktionsfallback eingebaut.

## Bend und Zeithorizont

Die [Hardwaremessungen](hardware-performance.md) belegen hohen Durchsatz für
unabhängige einfache Aufgaben auf diesem MacBook. Sie belegen keinen allgemeinen
Vorsprung gegenüber Parasolid, OpenCascade, Rust oder einem vollständigen großen
CAD-Modell. Die Modellierungs-CLI verwendet bisher den JavaScript-Target.

Bend bringt zusätzliche Entwicklungsrisiken durch F32x2-Numerik, kleinere
Werkzeugauswahl und noch zu erprobende native Integration. Rust wäre wegen
`f64`, Bibliotheken und Werkzeugen die pragmatischere Ausgangswahl für ein neues
Produktionsprojekt. Ein Sprachwechsel löst jedoch nicht automatisch die offenen
geometrischen Algorithmen. Erst reale Engpässe profilieren; kein Sprachwechsel
ohne Marcs Entscheidung. Der aktuelle Auftrag bleibt vollständig in Bend.

Belastbare persönliche Einsatzbereiche können über Monate wachsen; breite
industrielle Robustheit ist eher ein mehrjähriges Vorhaben. Das sind
Größenordnungen mit hoher Unsicherheit, keine Fertigstellungstermine.
Nach dem r10b-Meilenstein muss diese Einschätzung anhand des Teilebestands
und der beobachteten Fehlerraten erneut überprüft werden.

Nachweise: [r10b-Abnahme](acceptance.md), [Boolean-Vergleich](boolean-ports.md),
[Hybrid](port-hybrid.md), [Numerik](robust-predicates.md).
