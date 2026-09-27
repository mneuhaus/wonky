# Pilot-Batch: Ergebnis des Beweisers

Stand: 22.09.2026, Bend 2.0.25. Gegenstand ist der Pilot-Batch aus [docs/laws.md](../laws.md) Abschnitt 6:
37 Laws in `kernel/laws/pilot/LAWS.bend`, bewiesen in `kernel/laws/pilot/PROOF.bend`. Produktionscode,
Root-`LAWS.bend` und Root-`PROOF.bend` sind unverändert.

## Kurz

- **Alle 37 Laws sind bewiesen.** Kein `?TODO`, kein `@unsafe`, kein fremder Import. Kein Law ist
  unbeweisbar, keines musste umformuliert werden.
- **Die Aussagen sind wortgleich mit dem Batch.** `scripts/laws/check-pilot.mjs` vergleicht jedes Law mit
  der gepinnten Fassung in `scripts/laws/pilot-batch.json` und prüft die Hashes der Spec-Helfer. Ein
  abgeschwächtes Law oder ein Law ohne Beweis-Def fällt dort durch, bevor der Checker läuft (beides
  getestet, siehe unten).
- **Checker-Zeit für den ganzen Pilot: 0,77 bis 0,87 s** bei Load 15 bis 21 (Maschine mit anderen
  Agents geteilt). Jedes Law einzeln: 0,31 bis 0,63 s, davon ca. 0,3 s Grundlast für das Laden der
  Kernel-Module.
- **Mutationstest: 41 von 41 Mutanten gefangen**, die Kontrolle (unveränderte Kopie) prüft grün. Jeder
  Mutant wurde zusätzlich dem Law zugeordnet, das ihn fangen soll, indem dieses Law **allein** geprüft
  wurde. 39 davon fängt das Law selbst. 2 fängt nur der Beweis, das Law bliebe wahr (siehe "Grenzen").
- **Befund:** `T.extrude` hat keinen Ablehnungspfad. Für 0 oder 2 Profilpunkte liefert es still einen
  kaputten Körper, das ist jetzt als Law bewiesen (`kernel/laws/proposals/`). Vorschlag K-2 behebt das.
- **Zwei Kernel-Änderungen als Vorschlag** (K-1 Boolean-Opcodes, K-2 Extrude-Zulassung), beide auf einer
  Kopie angewendet und mit neuen Laws bewiesen. Diffs unten, Produktionscode nicht angefasst.

## So prüfst du nach

```bash
node scripts/laws/check-pilot.mjs              # Gate: Pin + Paarung + Hygiene + Checker (exit 1 bei offenem/falschem Law)
node scripts/laws/check-pilot.mjs --per-law    # zusätzlich jedes Law einzeln, schreibt out/laws/pilot-per-law.json
node scripts/laws/pilot-mutants.mjs            # 42 Läufe Mutationstest, schreibt out/laws/pilot-mutants.json
node scripts/laws/gate.mjs kernel/laws/proposals   # 6 Zusatz-Laws (Befunde, stärkere Varianten)
node scripts/laws/kernel-proposals.mjs         # K-1/K-2 auf einer Kopie anwenden und beweisen
```

`check-pilot.mjs` prüft in dieser Reihenfolge:

1. **Pin:** Die 37 Law-Blöcke in `LAWS.bend` stimmen (bis auf Leerraum) mit `scripts/laws/pilot-batch.json`
   überein, keines fehlt, keines ist dazugekommen. Der Kopf von `LAWS.bend` (die Spec-Helfer `a_edges`,
   `a_faces`, `a_loop_count`, `euler_holds`, `flip_sign`, `origin_of`, `is_exact_in_plane`) und die
   Spec-Module `kernel/laws/spike/topology-spec.bend` und `arith-spec.bend` haben den gepinnten SHA-256.
   Das ist ausdrücklich **keine Freigabe durch Marc**, nur ein Drift-Schutz. Die Freigabe bleibt der
   Hash-Lock von `gate.mjs --write-lock`.
2. **Paarung:** Jedes Law hat genau eine `def Laws.<name>`, und es gibt keine `def Laws.*` ohne Law.
3. **Hygiene und Urteil** über `scripts/laws/gate.mjs`: kein `@unsafe`, kein `?hole`, kein `import "…"`,
   letzte Ausgabezeile exakt `All terms check.`. Zeit und `uptime` landen in `out/laws/gate-timings.jsonl`.

Selbsttest: Eine Kopie mit abgeschwächtem Law (`B.selected(0, a, b) == B.selected(0, a, b)`) wird in
Schritt 1 abgelehnt, eine Kopie mit gelöschtem Beweis von `expansion_zero_needs_safe` in Schritt 2
(beides exit 1). Bend selbst lehnt ein Law ohne Def mit "1 TODO found" ab (Mutant `open-law`).

## Ergebnis pro Law

Beweisart: **Auswertung** heißt `{==}`, der Checker rechnet beide Seiten mit undurchsichtigen Koordinaten
aus. **Fallunterscheidung** heißt `match` auf die Eingaben, jeder Fall `{==}`. **Lemma** heißt, der Beweis
ruft Lemmata aus `kernel/laws/spike/*-lemmas.bend` (Induktion). Zeit: das Law allein, mit Grundlast,
Load 21 bis 23 (`out/laws/pilot-per-law.json`). Mutanten: vom Law allein gefangen, außer "(nur Beweis)".

| Law | Status | Beweisart | Zeilen | Lemma-Module | Zeit s | Gefangene Mutanten |
|---|---|---|---|---|---|---|
| `boolean_selected_union` | bewiesen | Fallunterscheidung | 14 | | 0,35 | `union-is-xor` |
| `boolean_selected_intersection` | bewiesen | Fallunterscheidung | 14 | | 0,34 | `intersection-is-union`, `intersection-is-a` |
| `boolean_selected_difference` | bewiesen | Fallunterscheidung | 14 | | 0,33 | `difference-is-and` |
| `coedge_flip_toggles_direction` | bewiesen | Auswertung | 2 | | 0,45 | `flip-identity` |
| `extrude_triangle_well_formed` | bewiesen | Auswertung | 2 | | 0,43 | `side-wrong-vertical`, `next-off-by-one`, `top-face-shares-bottom-ring` |
| `extrude_quad_well_formed` | bewiesen | Auswertung | 2 | | 0,39 | `side-wrong-vertical`, `next-off-by-one`, `top-face-shares-bottom-ring` (einzeln nachgeprüft) |
| `extrude_euler_every_profile` | bewiesen | Lemma (Induktion) | 2 | topology | 0,37 | |
| `transform_preserves_well_formed` | bewiesen | Lemma + Umschreiben | 10 | topology | 0,35 | `transform-reverses-loops` (nur Beweis) |
| `reverse_uses_swaps_use_counts` | bewiesen | Lemma (Induktion) | 4 | base, topology | 0,36 | `reverse-no-flip` |
| `reverse_uses_preserves_closure` | bewiesen | Lemma (Induktion) | 2 | topology | 0,36 | |
| `frustum_edges_closed` | bewiesen | Auswertung | 2 | | 0,38 | `frustum-seam-twice-forward`, `frustum-top-cap-reversed` |
| `frustum_vertex_links` | bewiesen | Auswertung | 2 | | 0,35 | `frustum-extra-vertex` (einzeln nachgeprüft) |
| `frustum_euler_poincare` | bewiesen | Auswertung | 2 | | 0,35 | `frustum-extra-vertex` |
| `revolve_triangle_edges_closed` | bewiesen | Auswertung | 2 | | 0,40 | `revolve-loop-by-height` (Fehlerklasse 8b21014) |
| `revolve_quad_genus_one` | bewiesen | Auswertung | 2 | | 0,34 | `revolve-extra-vertex` |
| `revolve_refuses_empty` | bewiesen | Auswertung | 2 | | 0,33 | `revolve-empty-reason-0`, `open-law` |
| `revolve_refuses_two_points` | bewiesen | Auswertung | 2 | | 0,39 | `revolve-accepts-two-points` (Fall 9467cfb) |
| `exact_self_difference_is_zero` | bewiesen | Lemma | 2 | exact | 0,38 | `sub-drops-negation` |
| `exact_decision_on_plane_origin` | bewiesen | Lemma (Kongruenz) | 3 | exact | 0,36 | `exact-decision-tagged-filter` |
| `exact_difference_normal` | bewiesen | Lemma | 2 | exact | 0,35 | `make-keeps-negative-zero` |
| `big_sign_neg` | bewiesen | Fallunterscheidung | 16 | | 0,33 | `neg-keeps-sign` |
| `mag_cmp_antisymmetric` | bewiesen | Lemma (Induktion) | 2 | exact | 0,35 | `mag-cmp-finish-swapped` (nur Beweis) |
| `mag_add_exact` | bewiesen | Lemma (Induktion) | 3 | mag (+ limb, order, arith, word, base) | 0,63 | `mag-add-carry-shift-11`, `mag-add-drops-carry-in`, `mag-add-mask-4094` |
| `point_plane_invalid_normal` | bewiesen | Umschreiben mit Hypothese | 4 | | 0,34 | `point-plane-skips-normal-check` |
| `expansion_zero_needs_safe` | bewiesen | Auswertung | 2 | | 0,34 | `expansion-zero-ignores-safe` |
| `planar_choose_rejects_invalid_first` | bewiesen | Fallunterscheidung | 8 | | 0,37 | `choose-ignores-first-validity` |
| `planar_choose_subtraction` | bewiesen | Fallunterscheidung | 14 | | 0,42 | `choose-subtraction-is-union`, `choose-count-not-incremented` |
| `planar_choose_union` | bewiesen | Fallunterscheidung | 14 | | 0,57 | `choose-union-is-and` |
| `planar_add_body_unresolved_left` | bewiesen | Fallunterscheidung | 6 | | 0,33 | `add-body-left-dropped` |
| `planar_add_body_unresolved_right` | bewiesen | Auswertung | 2 | | 0,38 | `add-body-right-swallowed` |
| `hybrid_undefined_sign_invalidates` | bewiesen | Auswertung | 2 | | 0,37 | `hybrid-undefined-keeps-valid` |
| `hybrid_invalid_contact_route` | bewiesen | Auswertung | 2 | | 0,34 | `hybrid-invalid-routes-cylinder` |
| `bounds_join_unknown_left` | bewiesen | Fallunterscheidung | 8 | | 0,33 | `bounds-unknown-with-empty` |
| `bounds_join_unknown_right` | bewiesen | Fallunterscheidung | 8 | | 0,34 | `bounds-unknown-right-dropped` |
| `threshold_never_exact` | bewiesen | Fallunterscheidung | 10 | | 0,35 | `threshold-claims-exact` |
| `transformed_keeps_origin` | bewiesen | Fallunterscheidung | 4 | | 0,31 | `transformed-renames-origin` |
| `semantic_origin_ignores_revision` | bewiesen | Auswertung | 2 | | 0,34 | `semantic-origin-uses-revision` |

**Größen.** `PROOF.bend` hat 261 Zeilen (37 Defs, 194 Zeilen Beweiskörper, der Rest Importe und
Kommentare). 15 Laws sind reine Auswertung, 13 Fallunterscheidung, 9 stützen sich auf Lemmata. Die
benutzten Lemma-Module aus dem Spike haben zusammen 1.336 Zeilen (topology 324, mag 234, limb 212, arith
136, base 131, order 125, word 89, exact 85), dazu die Spec-Module topology-spec (172) und arith-spec (94).
Der Pilot selbst hat keine neuen Lemmata gebraucht.

**Zeiten des ganzen Pilots** (`gate.mjs` über `check-pilot.mjs` bzw. direkt, Log `out/laws/gate-timings.jsonl`):

| Zeit | uptime vorher |
|---|---|
| 0,87 s | 22:24, load averages: 17.65 17.07 15.75 |
| 0,83 s | 22:32, load averages: 20.97 20.62 17.98 |
| 0,77 s | 22:36, load averages: 15.15 17.71 17.36 |
| 0,77 s | 22:36, load averages: 15.15 17.71 17.36 |
| 0,79 s | 22:36, load averages: 14.98 17.63 17.34 |

Zum Vergleich im selben Fenster: Root-Gate (4 Laws) 0,40 s, `kernel/laws/proposals` (6 Laws) 0,18 s.

## Mutationstest

`scripts/laws/pilot-mutants.mjs` kopiert `kernel/*.bend`, `kernel/ports/*.bend` und `kernel/laws/{pilot,spike}`
nach `tmp/laws/pilot-mutants/<name>/`, ändert **eine** Stelle und lässt den Checker auf dem Pilot laufen.
Fängt er den Mutanten, prüft das Skript danach das zuständige Law **allein** (Kopf plus ein Law, ohne
Lemma-Module, die dessen Beweis nicht benutzt). Grund: Bend meldet nur den ersten Fehler, im Gesamtlauf
steht dort oft ein Lemma, nicht das Law. Ergebnis (Lauf 22:30, Load 23,8 bis 24,9, je 0,35 bis 1,1 s):

- Kontrolle: prüft grün.
- `open-law` (Beweis von `revolve_refuses_empty` gelöscht): abgelehnt mit "1 TODO found".
- 39 Mutanten: vom zuständigen Law allein abgelehnt. Darunter die drei, die die heutigen Root-Laws
  überleben (`intersection-is-union`, `intersection-is-a`, `flip-identity`), die beiden historischen
  Fehler (`revolve-loop-by-height` = 8b21014, `revolve-accepts-two-points` = 9467cfb) und alle
  "kein stiller Fallback"-Mutanten der Gruppe 4.
- 2 Mutanten nur vom Beweis gefangen, siehe nächster Abschnitt.

Die Mutanten sind von Hand gewählt. Dass alle gefangen werden, zeigt, dass die Laws die typischen
Fehler an diesen Stellen sehen. Es zeigt nicht, dass es keine Fehler gibt, die sie übersehen.

## Grenzen (ehrlich)

1. **Zwei Laws sind schwächer, als ihr Name klingt.** `transform_preserves_well_formed` bliebe wahr, wenn
   eine Transformation alle Schleifen umdreht, und `mag_cmp_antisymmetric` bliebe wahr, wenn der
   Ziffernvergleich falsch herum läuft. Beide Mutanten fallen heute nur durch, weil das benutzte Lemma
   die Implementierung nachbildet. Ein Agent, der das Lemma passend umschreibt, bekäme den Mutanten
   durch. Abhilfe für Transform: die stärkeren Laws `transform_keeps_edges` und
   `transform_keeps_loops` in `kernel/laws/proposals/` (bewiesen; `transform_keeps_loops` ist ohne das
   Lemma unter dem Mutanten nicht mehr beweisbar, sein Checker meldet `LAWS.transform_keeps_loops`).
   Für `mag_cmp` fehlt ein Law "Vergleich stimmt mit `AS.value` überein" (Welle 2, braucht
   Normalform-Hypothese ohne führende Nullziffern).
2. **Spezifikation durch Kernel-eigene Prüfer.** `frustum_edges_closed`, `revolve_triangle_edges_closed`
   und `frustum_vertex_links` benutzen `S.edges_closed` und `CT.valid` als Spec. Sie sagen "der
   Kernel-Gate akzeptiert jedes Frustum", nicht unabhängig "jedes Frustum ist eine geschlossene
   2-Mannigfaltigkeit" (TOP-21/22).
3. **Beschränkte Laws bleiben beschränkt.** Extrude-Wohlgeformtheit gilt bewiesen für n = 3 und 4,
   Revolve für n = 3 (Kanten) und n = 4 (Geschlecht). Auswertung skaliert gut (n = 5 in
   `kernel/laws/proposals/` kostet nichts messbar), ersetzt aber kein Law für jedes n. Ein Law für
   jedes n braucht zwei Hypothesen: n ≥ 3 (sonst ist es falsch, siehe Befund) und eine obere Schranke,
   weil `extrude` Kantenindizes als `2 * n + i` in U32 rechnet und im Modell für sehr große n überläuft.
   Die JS-Grenze von 256 Punkten (`src/brep.mjs:29`) wäre eine passende Schranke.
4. **Keine Aussage über F32.** Koordinaten, Radien, Toleranzen sind in allen 37 Laws undurchsichtige,
   allquantifizierte Werte. `point_plane_invalid_normal` setzt `vec_valid(n) == False` voraus und sagt
   nichts darüber, ob `vec_valid` NaN richtig erkennt.
5. **Checker-Soundness.** Bend 2 hat einen offenen `False`-Beweis (#994, prior-art §1.6). Die Laws
   ergänzen Tests, sie ersetzen sie nicht.
6. **Abhängigkeit vom Spike.** `PROOF.bend` importiert Lemmata und Spec aus `kernel/laws/spike/`. Wer den
   Spike ändert, kann den Pilot brechen. Beim Übernehmen gehören sie nach `kernel/laws/lib/` (Lemmata,
   Agent-Besitz) und `kernel/laws/spec/` (Spec, Marcs Hash-Lock).

## Befund: Extrude lehnt kurze Profile nicht ab

`kernel/laws/proposals/LAWS.bend` beweist gegen den unveränderten Produktionscode:

- `extrude_empty_is_ill_formed`: `W.solid_ok(T.extrude(Nil{}, delta)) == False{}`
- `extrude_two_points_is_ill_formed`: `W.solid_ok(T.extrude([a, b], delta)) == False{}`

`T.extrude` baut also für jedes Profil mit weniger als drei Punkten still einen ungültigen Körper. Das
verstößt im Kernel gegen die Regel "explizite Fähigkeitsfehler, nie stille Fallbacks". Heute schützt
nur die JS-Seite: `src/brep.mjs:29` lehnt Profile mit weniger als 3 oder mehr als 256 Punkten vorher ab,
`validateSolid` (`src/kernel.mjs:76`) prüft danach. Jeder neue Aufrufer in Bend (etwa
`kernel/lang/spike/kernel-ops.bend`) hat diesen Schutz nicht. Revolve hat dafür einen Refused-Pfad
(`revolve_refuses_empty`, `revolve_refuses_two_points`), Extrude nicht.

Weitere Zusatz-Laws dort (nicht Teil des Batches, nicht freigegeben): `revolve_refuses_one_point` (der
Zwilling für 1 Punkt), `transform_keeps_edges`, `transform_keeps_loops`, `extrude_pentagon_well_formed`.

## Vorschläge für Kernel-Änderungen (nicht angewendet)

Beide Vorschläge prüft `node scripts/laws/kernel-proposals.mjs` auf einer Kopie unter
`tmp/laws/proposal-k1/` bzw. `-k2/`: Diff anwenden, neue Laws beweisen. Ergebnis 22:37 (Load 13,7):
K-1 3 Laws, K-2 3 Laws, je `All terms check.` in 0,22 s.

### K-1: Unbekannte Boolean-Opcodes ablehnen (BOO-05)

Heute rechnet `B.coaxial` jeden Opcode ≥ 3 still als Differenz. Vorschlag: Zulassung als eigene,
geometriefreie Funktion. `src/boolean.mjs` wirft bei `supported == False` schon heute einen
Fähigkeitsfehler, JS muss sich nicht ändern (nur die Fehlermeldung dort nennt dann den falschen Grund).

```diff
--- a/kernel/boolean.bend
+++ b/kernel/boolean.bend
@@ -349,7 +349,7 @@
     case Cell{z, r} <> tail:
       Bool.and(resolvable([z, r]), material_resolvable(tail))

-def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:
+def arrangement(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:
   +axis = G.normalize(G.sub(a1, a0))
   +ha = G.dot(G.sub(a1, a0), axis)
   +db0 = G.sub(b0, a0)
@@ -373,3 +373,12 @@
   # the construction resolution; tiny retained material is still rejected.
   BooleanResult{Bool.and(Bool.not(enclosed_void), Bool.and(aligned, material_resolvable(material))), enclosed_void,
     bodies(components(6n, material), all, U32.from_nat(List.length(&2, R.Real, zs)), a0, axis, x)}
+
+# Op codes: 0 union, 1 intersection, 2 difference. Any other code is refused
+# (supported = False) instead of being evaluated as a difference.
+def admit(+op: U32, result: BooleanResult) -> BooleanResult:
+  BooleanResult{supported, enclosed_void, bodies} = result
+  BooleanResult{Bool.and(U32.is_lt(op, 3), supported), enclosed_void, bodies}
+
+def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:
+  admit(op, arrangement(a0, a1, ra, b0, b1, rb, op))
```

Damit beweisbar (bewiesen auf der Kopie):

```python
law boolean_refuses_unknown_op:
  for +op: U32
  for +r: B.BooleanResult
  for h: {U32.is_lt(op, 3) == False{} : Bool}
  {supported(B.admit(op, r)) == False{} : Bool}

law boolean_known_op_passes_through:      # op 0..2 ändert nichts
law coaxial_is_admitted:                  # coaxial == admit(op, arrangement(...)), für jede Geometrie
```

Die drei Pilot-Laws zu `B.selected` bleiben unverändert gültig. `planar-boolean-selection.bend` codiert die
Operation als `subtraction: Bool` und hat das Problem nicht.

### K-2: Extrude mit Zulassung (Befund oben)

```diff
--- a/kernel/topology.bend
+++ b/kernel/topology.bend
@@ -89,6 +89,15 @@
     List.append(&2, Edge, lower, List.append(&2, Edge, upper, vertical_edges(count, n, 0))),
     bottom <> top <> side_faces(points, first, delta, n, 0)}

+type Extruded is Data:
+  Built{solid: Solid}
+  Refused{reason: U32}
+
+# A profile needs at least three points. Shorter profiles are refused with
+# reason 1 instead of producing an ill-formed solid.
+def extrude_checked(+points: List<&2, G.Vec3>, +delta: G.Vec3) -> Extruded:
+  Bool.pick(Extruded, Nat.is_ge(List.length(&2, G.Vec3, points), 3n), Built{extrude(points, delta)}, Refused{1})
+
 def transform_faces(faces: List<&2, Face>, +rotation: G.Rotation, +offset: G.Vec3) -> List<&2, Face>:
```

Damit beweisbar (bewiesen auf der Kopie): `extrude_refuses_short_profiles` (für **jedes** Profil mit
`Nat.is_ge(len, 3n) == False`: `Refused{1}`), `extrude_checked_triangle_well_formed`,
`extrude_checked_quad_well_formed`. Folgearbeit außerhalb meiner Pfade: `src/kernel.mjs` ruft
`extrude_checked` und wirft bei `Refused` einen Fähigkeitsfehler; `kernel/lang/spike/kernel-ops.bend`
(Sprach-Workflow) ebenso.

### K-3: Prozess (keine Kernel-Änderung)

- `package.json`: `"test:laws:pilot": "node scripts/laws/check-pilot.mjs"`, und bei Übernahme in den Root
  den Pin durch Marcs Hash-Lock ersetzen.
- Spike-Lemmata nach `kernel/laws/lib/` umziehen (Grenze 6).
- `pilot-mutants.mjs` vor jeder Freigabe eines neuen Laws laufen lassen und nur Laws mit mindestens einem
  vom Law **allein** gefangenen Mutanten aufnehmen.

## Dateien

- `kernel/laws/pilot/LAWS.bend`, `PROOF.bend`: Pilot (37 Laws, bewiesen). Die Beweise stammen aus dem
  Entwurf zu docs/laws.md Abschnitt 6 und wurden hier geprüft, gepinnt und mutationsgetestet.
- `kernel/laws/proposals/LAWS.bend`, `PROOF.bend`: 6 Zusatz-Laws (Befund Extrude, stärkere
  Transform-Laws, Revolve 1 Punkt, Extrude n = 5).
- `scripts/laws/check-pilot.mjs`: Gate für den Pilot (Pin, Paarung, Hygiene, Urteil, `--per-law`, `--dir`).
- `scripts/laws/pilot-batch.json`: gepinnte Aussagen und Spec-Hashes.
- `scripts/laws/pilot-split.mjs`: zerlegt LAWS/PROOF in Einzel-Laws (für `--per-law` und Mutanten).
- `scripts/laws/pilot-mutants.mjs`: Mutationstest mit Zuordnung zum Law.
- `scripts/laws/kernel-proposals.mjs`: K-1 und K-2 auf einer Kopie anwenden und beweisen.
- `out/laws/gate-timings.jsonl`, `out/laws/pilot-per-law.json`, `out/laws/pilot-mutants.json`: Messwerte
  mit `uptime`.
