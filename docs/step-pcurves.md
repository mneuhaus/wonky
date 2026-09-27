# Explizite STEP-PCurves aus Bend

`kernel/step-pcurves.bend` erzeugt eng begrenzte 2D-Parameterkurven für volle
Kreis-/Ellipsenränder eines Zylinderbandes. Die analytischen 3D-Kurven bleiben
unverändert. Nur ihre Darstellung im Parameterraum der Zylinderfläche wird
explizit approximiert, mit einem räumlichen Gesamtbudget von höchstens
`1e-8 mm`.

Anlass war ein unabhängig reproduzierter STEP-Lesefehler: OCCT rekonstruierte
zu einer präzisen 3D-Ellipse eine Zylinder-PCurve mit etwa `0.000149 mm`
Abweichung, obwohl die importierte Kantentoleranz `1e-7 mm` betrug. Die
standardmäßig abgetastete B-rep-Prüfung übersah dies; die exakte
CurveOnSurface-Prüfung lehnte das Ergebnis ab. Siehe
[`truck-step-review/README.md`](../out/boolean-ports/truck-step-review/README.md).
Der neue Pfad liefert die PCurve selbst aus Bend, ohne Reader-Heilung oder
Geometriekonstruktion durch OCCT.

## Unterstützte Domäne

Der Produktionseinstieg `for_edge_domains` prüft den gesamten Körper mit dem
gemeinsam genutzten nativen Bandvalidator aus `ports/truck-cylinder.bend`:

- zwei Vertices, zwei vollständige periodische Kreis-/Ellipsenränder und eine
  gerade gemeinsame Seam;
- zwei ebene Caps, eine nach außen orientierte Cylinder-Fläche und vollständig
  gepaarte Kantenuses;
- disjunkte globale axiale Wertebereiche der beiden Ränder;
- ausschließlich automatische Kantendomänen.

Die Kanten-/Flächenindizes müssen einen vorhandenen periodischen Rand und seine
Zylinderfläche bezeichnen. Explizite `GivenDomain`-Werte einschließlich voller
Perioden werden derzeit abgewiesen. Der Hostadapter erhält `curveRange` aus
decodierten B-reps als explizite Domäne; er darf diese Information nicht beim
Serialisieren verwerfen. Teilbögen, allgemeine importierte Schalen, Bohrungen,
mehrere Zylinderwände und andere Flächentypen sind nicht abgedeckt.

`cylinder_round` ist zusätzlich als primitives Kurve/Fläche-Werkzeug verfügbar.
Es prüft die Kurveninzidenz, aber keinen ganzen Körper. Es ist kein Ersatz für
den Bandvalidator und keine allgemeine Export-Ausweichstrategie.

## Parameter, Seam und Fehlerbudget

Für den unveränderten natürlichen 3D-Kurvenparameter `t` gilt auf einem
Zylinder:

```text
u(t) = u_start + sign * (t - first)
v(t) = z0 + zc*cos(t) + zs*sin(t)
first <= t <= first + 2*pi
```

`first` stammt vom tatsächlichen periodischen Kantenvertex. Ein Ellipsenrand
kann dort beispielsweise den Parameter `pi` oder `pi/2` haben; ein pauschaler
Start bei null wäre falsch. Eine gemeinsame räumliche Seam bestimmt den
U-Bereich beider Ränder. Positives Winding läuft von `seam_angle` nach
`seam_angle+2*pi`, negatives in umgekehrter Richtung. Dies behandelt auch
unterschiedliche Kurvenframes, umgekehrte Kurvensinne und verschobene
Zylinderframes.

Die U-Komponente ist linear. Für die V-Komponente werden kubische
Hermite-Segmente aus den nativen Funktionswerten und Ableitungen gebildet.
Bei Segmentbreite `h` ist die mathematische Interpolationsschranke

```text
amplitude = sqrt(zc*zc + zs*zs)
interpolation_error <= amplitude * h^4 / 384
```

Bend wählt durch Halbieren höchstens 1024 Segmente und gibt einen kubischen
B-Spline mit `3*N+1` Kontrollpunkten, `N+1` Knoten, Endmultiplizität vier und
innerer Multiplizität drei aus. Die konstanten axialen Kreisränder benötigen
ein Segment; die untersuchten schrägen Ränder benötigen bei `1e-8 mm` Budget
128 Segmente.

Die ausgegebene Gesamtschranke enthält drei getrennte Beiträge:

| Feld | Bedeutung |
| --- | --- |
| `approximation_bound` | Hermite-Ganzintervallschranke für die Höhenfunktion |
| `support_bound` | Normschranke der radialen Koeffizientendifferenzen plus Randvertex-/Seam-Inzidenz |
| `numeric_guard` | vorhandener operativer F32x2-Guard, skaliert mit Koordinaten, Kurvenzentren und Radien |
| `total_bound` | Summe dieser Beiträge, höchstens das explizite Budget |

Die Supportprüfung erfasst die vollständigen trigonometrischen Koeffizienten.
Sie beruht nicht nur auf Stützpunkten. Die mathematische Interpolationsschranke
ist analytisch; ihre Auswertung und der numerische Guard verwenden Wonky
`Real`-Arithmetik. Das ist kein nach außen gerundeter Intervallbeweis. Reicht das
Budget für Maßstab, Inzidenz oder Segmentzahl nicht aus, folgt `Unresolved`
statt einer gröberen stillen Approximation.

## Datenvertrag und synchrone Verwendung

`src/step-pcurves.mjs` serialisiert Eingaben und decodiert Ergebnisse. Alle
Geometrieentscheidungen, Parameter, Kontrollpunkte und Schranken entstehen in
Bend. Der bereits geladene Native-Baustein kann synchron verwendet werden:

```js
const native = await loadStepPCurves();
const pcurve = fullBandPCurve(native, bodyOrSolid, edgeIndex, faceIndex, {
  budgetMm: 1e-8,
  // Optional: domains als native List<DomainChoice>.
});
```

Ein aufgelöstes Host-Ergebnis besitzt `status: 'Resolved'`, `first`, `last`,
`degree`, `points: [[u,v], ...]`, `knots`, `multiplicities`,
`approximationBoundMm`, `supportBoundMm`, `numericGuardMm` und `totalBoundMm`.
Sonst liefert es `status: 'Unresolved'` und `reason`. Die zusätzliche primitive
Adapterfunktion lautet
`cylinderPCurve(native, curve, surface, start, seam, options)`.

Der vom Lead integrierte STEP-Serializer verknüpft die Kurve über
`PCURVE(Cylinder, DEFINITIONAL_REPRESENTATION(...))` und
`SURFACE_CURVE(original_3d_curve, ..., CURVE_3D)`. Die 3D-Circle/Ellipse bleibt
die primäre Geometrie; die enge UV-Approximation ist ausdrücklich benannt.
Andere Exportdomänen behalten ihre gesondert zu prüfenden bisherigen Pfade.

## Prüfung und verbleibende Grenzen

`test/step-pcurves.test.mjs` besteht mit **5/5 Fokus-Tests**. Es prüft die
produzierten Parameterkurven gegen unabhängig ausgewertete analytische
3D-Kurven, Schranken und Topologie. Die Fälle umfassen Kreisränder, Start bei
`pi`/`pi/2`, negatives Winding, umgekehrten Kurvensinn, eine nicht bei U=0
liegende Seam, zwei Ellipsenränder, starre Transformation, feinere Budgets und
die expliziten Ablehnungen. Die Testorakel konstruieren keine Produktionsform.

Neun bestehende Truck-Band-Artefakte und sieben gezielte Exportvarianten unter
`out/step-pcurves/` bestanden die unabhängige Prüfung mit
`BRepCheck_Analyzer(shape, True, False, True)`. Jedes Ergebnis behielt
`1 Solid / 3 Faces / 3 Edges / 2 Vertices`; es wurden keine Seams oder Vertices
ergänzt. Bei den neun Band-Artefakten lag die größte beobachtete importierte
CurveOnSurface-Abweichung bei rund `9.069e-9 mm`, unter ihrer nativen Schranke
von höchstens `9.136e-9 mm`. Die abgetastete Messung bestätigt diese Fälle;
die Ganzintervallschranke stammt aus der nativen Konstruktion.

Die Volumenintegration des Lesers ist eine eigene numerische Operation. Für
den schrägen Halbzylinder beträgt die adaptive Abweichung vom analytischen
Sollwert etwa `4.56e-8 mm³`; die Standardintegration ist weniger genau. Eine
kleine Volumenabweichung allein ersetzt weder die genaue Inzidenzprüfung noch
die PCurve-Schranke. Es werden keine Akzeptanzgrenzen gelockert.

Logs, Native-Daten, STEP/B-rep-Ausgaben und Quell-/Artefakthashes stehen in
`out/step-pcurves/`. Allgemeine Teil-Ellipsen, andere periodische Flächen und
Importkörper mit zusätzlichen Rändern benötigen weitere eigenständige Arbeit.
