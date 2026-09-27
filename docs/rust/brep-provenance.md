# B-rep und Konstruktionsherkunft (W0-Spike)

## Entscheidung

`wonky-brep` hält typisierte Arena-Indizes für Vertex, Kurve, Kante mit
Parameterintervall, Coedge mit Richtung, Loop, Trägerfläche, orientierte Face,
Shell und Solid. Indizes sind **lokal zu einem Modell**, keine globalen Beweistoken.
Der W0-Prototyp verwendet `usize` als In-Memory-Index, ohne Wire-Repräsentation.
BR1 muss die spezifizierten `u32`-IDs mit geprüften Arena-Grenzen einführen;
WC0 muss ihre Darstellung im Wire-v3-Vertrag festlegen. `usize` ist keine
Festlegung für diesen Vertrag.
`Draft` ist die unbewiesene Konstruktions-/Importgrenze; `finish()` prüft sie und
liefert einen unveränderlichen `Brep`. Eine Änderung über `to_draft()` verliert
alle Beweise und muss erneut durch `finish()`. Keine ungeprüfte Tag-API.

Maßgeblich sind die binary64-Eingaben im **Quellrahmen**, nicht gerundete
Zwischenergebnisse. Die Gerade wird als `a + t*(b-a)` aufbewahrt; selbst die
Differenz wird für Entscheidungen exakt ausgewertet. Bewiesene Fakten sind
Vertex–Kante, Kante–Face, Vertex–Face und Trägertangentialität zweier Faces an
ihrer gemeinsamen Kante. Sie werden beim Abschluss der Konstruktion gespeichert.
Abfragen benutzen zuerst diese Fakten, danach exakte Quellprädikate oder eine
benannte Ablehnung. Drei Faces an einem Vertex erhalten drei einzelne Fakten.
`Contained` bezeichnet die Inzidenz mit dem **Träger** einer Face, nicht die
Mitgliedschaft in ihrem beschnittenen Inneren. Vertex–Kante prüft dagegen das
**geschlossene beschnittene Geradensegment**, einschließlich innerer Punkte,
gleicher Koordinaten unter verschiedenen IDs und negativer Außenentscheidungen.
Der Audit beweist die Endpunkte an beiden Parametergrenzen. Exakte projizierte
Orientierungen und Koordinatenschranken entscheiden dann ohne Parameterdivision,
auch wenn der Parameter eines inneren Punktes nicht als binary64 darstellbar ist.
Numerisch unentscheidbare Prädikate lehnen weiterhin benannt ab.
`tangent_along` verlangt eine echte Coedge-Inzidenz der Kante mit **beiden** Faces;
andernfalls `Degenerate("edge not shared by both faces")`, kein erfundenes `false`.
Parallele Trägernormalen genügen, auch bei umgekehrtem Vorzeichen oder anderer
Skalierung. Das ist Trägertangentialität, kein orientierter G1-Beweis.

Alle Entitäten teilen eine unveränderte Quelle und eine Folge **symbolischer
starrer Operationen**. `around_axis(translation, axis, angle)` bedeutet
`R(axis, angle)*p + translation` wie in W0-GEOM, keine Drehung um einen Pivot.
Normierung, Sinus und Kosinus gehören semantisch zur exakten Operation; die
f64-Matrix ist ausschließlich eine unzertifizierte Ansicht (`approximate_*`).
Drei Transformationen werden nicht zu einer angeblich exakten f64-Matrix
multipliziert. Kopien erhalten Quelle, Fakten und Rahmenfolge, aber eigene Werte.
Die private Konstruktion erlaubt keine beliebige Matrix als Starrheitsbeweis.
Daher bleiben bewiesene Inzidenzen und das Volumen des symbolischen Körpers
exakt invariant, auch wenn die Weltansicht den W0-GEOM-Inzidenzfehler zeigt.

## Geprüfter Bereich und Grenzen

Der Prototyp baut und prüft echte konvexe Polyeder mit linearen Kanten und
streng konvexen planaren Polygonen. Prüft Referenzen, eindeutigen Besitz,
Schleifenschluss, entgegengesetzte effektive Coedge-Richtungen (inklusive
Face-Orientierung), Kantenzahl zwei, einen zusammenhängenden Vertex-Link,
zusammenhängende Shells, exakte Endpunkt-/Trägerinzidenz, positive Orientierung
und konvexe Halbräume. Löcher, Kavitäten und nichtkonvexe Shells werden benannt
abgelehnt. Mehrere Solids sind eigenständige Körper; gegenseitige Disjunktheit
ist **nicht** bewiesen. Koplanare Nachbarfaces können erhalten bleiben.

Halbräume und Vertex-Links allein schließen eine mehrfach überdeckte Shell
nicht aus. Deshalb prüft der Audit zusätzlich jedes koplanare Face-Paar einer
Shell mit exakten Separationsprädikaten an den Kanten **beider** konvexen Polygone.
Überlappende offene Innenbereiche führen zu `OverlappingFaces(faceA, faceB)`;
reiner Kanten-/Vertex-Kontakt bleibt erlaubt. Auch verschiedene Vertex-IDs und
unterschiedliche Unterteilungen derselben Fläche werden geprüft. Ein exakter
Prädikatsentscheid muss gelingen, sonst folgt eine benannte numerische Ablehnung.
Im geprüften konvexen Bereich liegen alle Faces auf stützenden Hull-Ebenen:
nichtkoplanare Faces können sich daher nur am Rand treffen. Geschlossenheit,
Außenorientierung und positives Volumen ergeben eine positive ganzzahlige
Überdeckungszahl; disjunkte Face-Innenbereiche begrenzen sie auf eins. Das ist
kein allgemeiner Schnitt-/Einbettungsbeweis für nichtkonvexe oder gekrümmte Shells.

Volumen: orientierte Randdreiecke im Quellrahmen, mit `wonky-num::Iv` inklusive
Rundungsfehlern, kein gecachter `x*y*z`-Sonderpfad. Property-Tests prüfen gegen
exakte rationale Determinanten und `x*y*z`; maximale relative Intervallbreite
`1e-9`. Die Schranke gilt für den **symbolisch transformierten Körper**, nicht
für unabhängig gerundete exportierte Vertex-Koordinaten. Zertifizierte
Materialisierung benötigt VA1 und ein eigenes Konstruktions-/Exportbudget.

Die lokalen Line/Plane-Typen sind ein minimaler Adapter, keine Kopie des
parallel entstehenden `wonky-geom`. Gekrümmte Träger, Schnittkonstruktionen,
Trim-Domänen und G1-Blend-Tangentialität sind offen. N1 muss für solche
Konstruktionen prüfbare Witness-Varianten ergänzen, statt gerundete Schnittpunkte
nachträglich als maßgebliche Quelle zu behandeln. Teiltransformationen, neue
Schnitte und Geometrieänderungen dürfen alte Fakten nicht übernehmen. Beweise
zwischen verschiedenen Rahmen sind noch kein Bestandteil dieses Prototyps.
WC0/BR1 muss dafür explizite Gleichheit/Relation der Rahmen prüfen und sonst
`CrossFrameUnproved` ablehnen, statt einen räumlichen Epsilon-Vergleich zu nutzen.
Dieser Name ist ein Vertragsvorschlag, keine vorhandene W0-Fehlervariante.

## Wire-v3-Vorschlag (noch kein Codec)

Das bisherige `analytic_Solid {vertices, edges, faces}` (Wire v1/v2) verliert
Herkunft, Rahmen, Shells und Beweise. WC0 soll eine neue ADT transportieren:

```
BodyV3 {
  schemaVersion, bodyId, revision,
  vertices[], curves[], edges[], coedges[], loops[], surfaces[], faces[], shells[], solids[],
  constructionNodes[], frames[], facts[], budgets
}
Frame = Source(sourceId)
      | Rigid(parentFrameId, translation: Binary64[3], axis: Binary64[3], angle: Binary64)
Construction = Input(binary64Bits) | LineThrough(a,b) | Plane(origin,normal)
             | EvaluatedOn(carrier,parameter) | CertifiedIntersection(witness)
Fact = VertexOnEdge(vertex,edge,parameter,witness)
     | EdgeOnSurface(edge,surface,domain,witness)
     | VertexOnSurface(vertex,surface,witness)
     | TangentAlong(faceA,faceB,edge,domain,witness)
Witness = ExactSourcePredicate(nodeIds) | ConstructionRule(ruleVersion,nodeIds)
Budget = { construction, approximation, integration, export } // Einschließung != Schätzung
```

Referenzen tragen Body/Revision/Quellrahmen bzw. unverwechselbare DAG-Knoten;
Kopieren remappt sämtliche Entitäts-/Witness-Referenzen atomar. Ein gemeinsamer
Rigid-Knoten leitet alle inneren Fakten unverändert weiter. Hashes identifizieren
Daten, beweisen aber keine Geometrie. Decoder validiert Indizes, Zyklen, Grenzen,
Revisionen, endliche Werte, nichtverschwindende Achsen und **rechnet Witnesses
nach**; er vertraut keinem vom Host gesendeten `true`. Unbekannte Regeln lehnen
benannt ab. JS erhält und reicht v3 unverändert weiter; die verlustbehaftete
Viewer-Sicht darf nie wieder Kerneingabe sein. V1/v2-Import heißt `NoProvenance`,
nicht erfundene Tags: neu beweisbare Quellfakten dürfen geprüft werden; die
ursprüngliche Konstruktionsabsicht/E4 lässt sich nicht wiederherstellen.

## Erwogene Alternativen

* **Exakte rationale Transformmatrizen:** erhalten Inzidenz bei konsistenter
  affiner Auswertung, aber die gerundete Matrix ist nicht exakt orthogonal und
  bewahrt deshalb Volumen/Tangentialität nicht allgemein. Winkel `0.1` hat keine
  rationale Sinus-/Kosinusdarstellung. Allein nicht ausreichend.
* **Nur Quelle plus Transformkette:** hält Inzidenz und Rigid-Invarianten, kostet
  wiederholte Beweise; bei Schnitten fehlen explizite Konstruktions-Witnesses.
* **Nur Inzidenztags:** schnell, aber ohne private Erzeugung, Revision und
  Referenzbindung nach Änderungen/Import gefährlich; kein Volumenbeweis.
* **Gewählt: Quelle + symbolische Rahmen + geprüfte Fakten.** Die Quelle ist
  Beweisgrundlage, Tags sind abgeleitete Fakten, f64-Weltgeometrie ist Ansicht.
