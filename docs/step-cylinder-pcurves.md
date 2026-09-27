# Explizite PCurves für getrimmte Zylinderflächen

`kernel/step-cylinder-pcurves.bend` plant die STEP-PCurves eines ganzen Körpers
atomar. `step-cylinder-pcurves-geometry.bend` erzeugt die Parameterkurven und
Fehlerschranken. Die bestehenden Vollband-Module aus
[`step-pcurves.md`](step-pcurves.md) bleiben unverändert.

Der neue Pfad erhält die analytischen 3D-Kurven, Trims, Vertices, geteilten
Kanten und Coedges. Ausschließlich die zweidimensionalen PCurves werden als
explizite B-Splines dargestellt. Der räumliche Gesamtfehler darf höchstens
`1e-8 mm` betragen. OCCT dient ausschließlich der unabhängigen Prüfung bereits
exportierter Artefakte; es konstruiert oder heilt keine Produktionsgeometrie.

## Unterstützte Körper und Domänen

Vor der Planung prüft der native `curved-validate`-Audit den ganzen Körper mit
seinem aufgezeichneten Quellbudget. Unterstützt sind ebene und zylindrische
Flächen, wobei jede Cylinder-Fläche genau einen äußeren Loop besitzt. Inward
Cylinder-Flächen sind eingeschlossen. Die Zylindergrenzen bestehen aus
Circle-, Ellipse- und Generator-Line-Kanten. Ein Generator darf als Seam zweimal
in entgegengesetzter Richtung vorkommen. Zwei unterschiedliche Cylinder-Flächen
dürfen eine Kante teilen.

AutoDomain löst Lines auf endliche Intervalle und geschlossene Koniken auf eine
Periode ab ihrem tatsächlichen Kantenvertex auf. `GivenDomain{Untrimmed}` ist
ebenfalls nur bei geschlossenen Koniken zulässig. Explizite Intervalle werden
ohne Umskalieren oder individuelles Winkel-Wrapping erhalten. Negative Werte
und Werte über `2*pi` sind zulässig. Periodische Intervalle müssen nach der
bestehenden Domänenregel innerhalb `±8*pi` liegen und kürzer als eine Periode
sein; der Export lehnt zusätzlich die numerische Guard-Zone direkt an einer
vollen Periode ab. Explizite Vollperioden-Intervalle werden somit klar abgewiesen.

Mehrere Zylinderloops, fehlende Trims offener Koniken, unauflösbare Charts,
inkonsistente Seams, mehr als zwei Kantenassoziationen oder unzureichende
Fehlerbudgets ergeben `Unresolved`. Auch bei einer späten Ablehnung enthält die
Rückgabe keine teilweise erfolgreiche PCurve-Liste. Der native Pfad besitzt
keinen automatischen Ausweichpfad zum impliziten Reader-PCurve-Fitting.

## API und Assoziationen

Der synchrone Adapter serialisiert und decodiert ausschließlich:

```js
const native = await loadStepCylinderPCurves();
const plan = cylinderPCurves(native, bodyOrSolid, {
  budgetMm: 1e-8,
  // optional: domains, inputTolerance
});
```

Die entsprechende native Funktion ist
`for_cylinders_domains(solid, domains, tolerance, source_budget, budget)`.
`curveRange` am B-rep bleibt gegenüber einem optionalen AutoDomain-Override
verbindlich. Der Adapter prüft die Repräsentationsfelder; geometrische
Domänenauflösung, Audit, Chartwahl und alle Assoziationen entstehen in Bend.

Ein aufgelöstes Ergebnis hat diese Struktur:

```text
{ status: 'Resolved', maxTotalBoundMm,
  charts: [{ faceIndex, closureBoundMm,
    pcurves: [{ edgeIndex, loopIndex, useIndex,
      forward, increasing, periodLift,
      first, last, degree, points, knots, multiplicities,
      approximationBoundMm, supportBoundMm, normalizationBoundMm,
      numericGuardMm, totalBoundMm }] }],
  edges: [{ edgeIndex, kind: 'Ordinary' | 'Seam',
    associations: [{ faceIndex, pcurveIndex }] }] }
```

`periodLift` ist eine nativ bestimmte ganzzahlige Periodenzahl. Sämtliche
ausgegebenen Pole sind bereits verschoben; der Host darf daraus keine neuen
Geometrieentscheidungen ableiten. `first/last` sind immer natürliche
3D-Kurvenparameter. `increasing` bezeichnet separat die Loop-Traversierung.
Der aktuelle einzelne Loop trägt `loopIndex: 0` aus dem nativen Ergebnis.

Eine Ordinary-Kante besitzt eine Assoziation bei Cylinder/Plane oder zwei bei
Cylinder/Cylinder. Eine Seam besitzt zwei Assoziationen auf derselben Fläche.
Ihre beiden geraden PCurves unterscheiden sich genau um eine U-Periode. Bend
liefert die niedrigere U-Lage zuerst. Ordinary-Assoziationen folgen der nativen
Flächenreihenfolge. Der Host serialisiert diese Referenzen über `SURFACE_CURVE`
beziehungsweise `SEAM_CURVE`, jeweils mit der unveränderten analytischen
3D-Kurve als primärer Geometrie (`CURVE_3D`). Kein zusätzlicher `EDGE_CURVE` wird
für eine Seam erzeugt.

Fehler liefern `{ status: 'Unresolved', reason, ...indices }`; vorhandene
`faceIndex`, `loopIndex`, `useIndex` und `edgeIndex` lokalisieren den Fehler.

## Chart und kontinuierliche Schranke

Für natürliche Konikenparameter gilt:

```text
u(t) = phase + sign*t + 2*pi*periodLift
v(t) = z0 + zc*cos(t) + zs*sin(t)
```

Die vollständigen radialen Konikkoeffizienten bestimmen und prüfen diese
Darstellung. Lines erhalten konstantes U und affines V. Bei der Loop-Wanderung
bedeutet `coedge.forward == edge.sameSense` zunehmenden natürlichen Parameter.
Die Flächenorientierung `face.sameSense` ändert diese Regel nicht.

Bend hebt jeden anschließenden Use nur um ganzzahlige Perioden an und prüft die
räumlich gewichteten UV-Joins sowie den Loop-Schluss. Endpunkte oder Phasen
werden nicht passend verschoben. Der größte Join-/Schlussfehler geht in die
Supportschranke aller PCurves des Charts ein. Für eindeutige, numerisch begrenzte
Charts gelten `radius > 4*budget` und `abs(periodLift) <= 16`. Schleifen mit
nichtschließendem Lift werden abgewiesen.

Die V-Komponente einer Konik verwendet kubische Hermite-Segmente mit
`amplitude*h^4/384`, `amplitude = sqrt(zc²+zs²)`, und höchstens 1024 dyadisch
gewählten Segmenten. U ist exakt linear. Endknoten werden direkt aus der
admittierten Domäne übernommen. Lines sind Grad-1-B-Splines über derselben
Domäne; dadurch bleiben ihr Parametermaßstab und ihre affine V-Komponente
erhalten.

Die Gesamtschranke ist die Summe folgender getrennter Beiträge:

| Beitrag | Bedeutung |
| --- | --- |
| `approximationBoundMm` | analytische Hermite-Ganzintervallschranke, bei Lines null |
| `supportBoundMm` | vollständige radiale Koeffizienten-/Line-Endpunktschranke, Kantenvertex- und Chart-Joins |
| `normalizationBoundMm` | räumliche Schranke für STEP-normalisierte Kurven-/Flächenframes und Line-Richtungen |
| `numericGuardMm` | operativer F32x2-Guard `8*angular_guard*scale` |

STEP normalisiert Richtungen in `AXIS2_PLACEMENT_3D` und `DIRECTION`. Bend bildet
diese vorhandene Serialisierungssemantik für die PCurve-Berechnung ab und
schließt ihre Abweichung vom unveränderten Input ein. Bei einer Line beträgt
die Parameterabweichung höchstens
`max(abs(first),abs(last))*norm(D-unit(D))`. Eine materielle Abweichung ergibt
`ParameterMismatch`; Trims werden niemals still umskaliert. Das Quellbudget
und die STEP-Modellunsicherheit erhöhen das PCurve-Budget nicht.

Die Hermite-Schranke ist analytisch. Ihre F32x2-Auswertung samt Guard ist kein
nach außen gerundeter Intervallbeweis. Abgetastete Testmessungen sind zusätzliche
Beobachtungen und ersetzen die native Ganzintervallschranke nicht.

## Nachweise

`test/step-cylinder-pcurves.test.mjs` prüft negative und überperiodische Trims,
Line-Parameteroffsets, umgekehrte Koniken und Seams, inward und transformierte
Bohrungen, eine geteilte Kante zwischen zwei Cylinder-Flächen, explizite
Untrimmed-Domänen, Normalisierung, Budgettrennung und atomare Fehler.

Die Ausgangsdiagnose unter `out/step-pcurves/partial-diagnostics.json` isoliert
die Reader-Fehler der beiden echten P10-Schnitte. Alle 34 Cylinder-Charts und
21 Seam-Paare waren bereits topologisch passend. Die ursprünglichen STEP-Dateien
bestanden die abgetastete B-rep-Prüfung, scheiterten aber an der exakten
CurveOnSurface-Prüfung; rekonstruierte Ellipsen-PCurves wichen bis
`2.57735e-5 mm` von den präzisen 3D-Ellipsen ab.

Die ersten neuen nativen P10-Pläne lösen beide Schnitte vollständig auf und
melden höchstens `5.017e-9 mm` Gesamtfehler. Fokusartefakte und Messungen stehen
unter `out/step-pcurves/cylinder-focused/`. Die unabhängigen Prüfungen des normal
integrierten STEP-Exporters sind eine separate Abnahme; eine erfolgreiche native
Planung allein belegt noch keinen gültigen STEP-Import.
