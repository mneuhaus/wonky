# Geschlossene Körper klassifizieren

`kernel/solid-classification.bend` entscheidet `Inside`, `Outside`, `Boundary`
oder `Unresolved` für einen Punkt und eine geschlossene B-rep-Grenze. Die
aktuell integrierte Domäne besteht aus planaren und zylindrischen Flächen mit
analytischen Linien-, Kreis- und Ellipsenrändern. Es werden keine Randkurven polygonisiert.
Der Adapter in `src/solid-classification.mjs` serialisiert lediglich Eingänge.

```js
import {
  classifySolid,
  requireResolvedSolidClassification,
} from './src/solid-classification.mjs';

const result = await classifySolid(body, [4, 3, 2], {
  linear: 1e-7,
  angular: 1e-10,
  inputTolerance: 0,
});
requireResolvedSolidClassification(result);
```

Native Schnittstelle:

```text
classify(solid: analytic.Solid,
         domains: List<face-classification.DomainChoice>,
         point: precise.Vec3,
         tolerance: intersections.Tolerance,
         source_budget: real.Real) -> Classification

Classification = Inside{rays} | Outside{rays} | Boundary{face}
               | Unresolved{reason}
```

`Boundary.face` ist ein Index in genau diesem Körper. Er ersetzt keine stabile
Topologiereferenz. `Inside` und `Outside` enthalten mindestens zwei bestätigende
Richtungen. Ein unbekanntes Ergebnis wirft über den optionalen `require…`-Helper
einen `UnsupportedFeatureError`; es darf nicht als leerer Körper gelten.

## Verfahren und Voraussetzungen

Vor jeder Klassifikation prüft Bend für jede Kante genau zwei entgegengesetzte
Coedges. Ein leerer, offener oder an Kanten nichtmannigfaltiger Rand wird
zurückgewiesen. Danach prüft der Face-Classifier alle Flächen einschließlich
Referenzen, Trim-Bereichen, Loop-Schluss und analytischer Inzidenz. Ein Punkt
auf einer frühen gültigen Fläche kann eine spätere ungültige Fläche nicht
verbergen. Gespeicherte `validation`-Metadaten sind kein Ersatz für diese
Prüfungen.

Die Prüfungen beweisen **keine globale eingebettete Mannigfaltigkeit**.
Einfache, nichtschneidende Face-Anordnungen, korrekt liegende Löcher und
geometrisch passende Schalen bleiben Voraussetzungen. Selbstüberschneidungen,
überlappende koplanare Flächen und nichtmannigfaltige Vertex-Links werden noch
nicht allgemein erkannt. Die Innenregion folgt gerader/ungerader Schalenparität;
verschachtelte Schalen repräsentieren Hohlräume, getrennte Schalen getrennte
Materialbereiche. Das ist keine Vereinigung überlappender Körper.

Zunächst wird die Mitgliedschaft des Abfragepunkts auf jeder begrenzten Fläche
geprüft. Danach schneiden fünf deterministische räumliche Linien die
Stützflächen mit `ray.bend`. Nur transversale Treffer **innerhalb der echten
Flächentrims** zählen. Treffer an einer Kante, nahe am Ursprung, Tangenten,
koinzidente Linien und unaufgelöste numerische Fälle verwerfen die jeweilige
Linie. Auch hinter dem Punkt wird gezählt: beide Halbstrahlen müssen dieselbe
Parität ergeben. Mindestens zwei Linien müssen gültig sein; alle gültigen
Linien müssen übereinstimmen. Es gibt keine Mehrheitsentscheidung oder
stilles Versetzen des Punkts.

Die Abfrage übernimmt die dokumentierten operationalen Numerikgrenzen von
[ray.md](ray.md), [face-classification.md](face-classification.md) und
[cylinder-classification.md](cylinder-classification.md), keine
zertifizierte Intervallarithmetik. Die Source-Toleranz ist das konservative
Maximum der Vertex-Budgets und der expliziten `inputTolerance`. Sie bleibt
bei Rand- und Strahltests wirksam. Die Face-Projektion definiert eine
tolerante Mitgliedschaft, keine euklidische Abstandsmessung zum Körper.

`InvalidInput`, `InvalidTopology`, `UnsupportedSurface{face}`,
`FaceUnresolved{face}`, `AmbiguousRays` und `ConflictingRays` bleiben sichtbare
Gründe. Ein Face-Detail lässt sich mit dem einzelnen Face-Classifier weiter
untersuchen. Endliche Koordinaten außerhalb des Ray-Moduls oder zu enge
Toleranzen können auch für ansonsten gültige Körper unaufgelöst bleiben.

## Nachweise und verbleibende Arbeit

`test/solid-classification.test.mjs` prüft unabhängige Innen/Außen-Erwartungen
für Quader und konkave Extrusionen, endliche Flächen statt unbeschränkter
Ebenen, Flächen-/Kanten-/Vertex-Grenzen, native starre Transformationen,
eingeschlossene Hohlräume, getrennte Schalen, zylindrische Bohrungen und
abgewiesene ungültige Grenzen. Die gemeinsame Serialisierung weist fehlende
Richtungsflags und ungültige Indizes ausdrücklich ab, auch bei nativen Werten;
fehlende Booleans werden nicht in `false` umgewandelt.

Die [unabhängige STEP-Punktprüfung](solid-classification-validation.md)
bestätigt 56/56 deterministische Proben, einschließlich acht Proben des
tatsächlich platzierten P10. Die exportierten Körper werden nur zum Vergleich
mit OpenCascade gelesen; keine OCP-Geometrie fließt in den Kern zurück.

Kegelflächen sind in diesem Integrationsstand noch ausdrücklich
nicht unterstützt. Diese Komponente baut keine Schnittkanten, teilt keine
Flächen und konstruiert keinen Boolean-Ergebniskörper. Der vollständige
r10b-Test bleibt offen.
