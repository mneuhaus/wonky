# Laws im wonky-Kernel: Bestand, Nutzen, Prozess, Pilot-Batch

Stand: 22.09.2026, Bend 2.0.25. Grundlage sind drei Vorarbeiten mit gemessenen Ergebnissen:
[Inventur](laws/inventory.md) (101 Kandidaten über alle 61 Module), [Spike](laws/spike.md) (17 Laws über
Produktionscode bewiesen, Mutationstest) und [Prior Art](laws/prior-art.md) (Bend-Soundness, Gate-Loch,
Literatur). Dieses Dokument ist der Plan daraus. Produktionscode, `LAWS.bend` und `PROOF.bend` sind
unverändert.

## Kurzantwort

- **Nutzen wir Laws?** Kaum. Es gibt 4 kleine Laws, und 3 davon halten auch dann noch, wenn man den Code
  gezielt kaputt macht. Der Gate in `npm test` leistet trotzdem schon etwas: Er prüft, dass alle 61
  Kernel-Module (17.661 Zeilen) typchecken und terminieren.
- **Lohnt es sich?** Ja, für den **diskreten Kern**: Topologie-Buchhaltung der Konstruktoren, exakte
  Integer-Arithmetik, Gates und Fehlerpfade ("kein stiller Fallback"), Identität und Wire-Codecs. Für
  Gleitkomma-Geometrie nein. Bend behandelt jede F32-Operation als Axiom ohne Definition, dort lässt sich
  nichts beweisen.
- **Was ist fertig?** Ein Pilot-Batch mit **37 Laws** in `kernel/laws/pilot/` (Entwurf, nicht im Root).
  Alle sind bewiesen, der Check dauert **0,83 bis 1,07 s** (Load 17 bis 20). Dazu kommt ein Gate-Skript
  `scripts/laws/gate.mjs` mit Hash-Lock und Hygiene-Lint. Die 3 Mutanten, die die heutigen Laws
  überleben (∩ = ∪, ∩ = a, flip = Identität), fallen mit dem Pilot durch.
- **Was du tun musst:** Abschnitt 6 durchgehen, pro Law freigeben oder streichen. Danach vier kleine
  Änderungen an Dateien, die nur du freigibst (Abschnitt 5.6).

## 1. Was Laws sind

Ein Law ist eine Behauptung über echten Kernel-Code, formuliert in Bend. Ein `def` gleichen Namens liefert den
Beweis. Taktiken gibt es nicht: Der Beweis ist ein Term, den der Checker nachrechnet. `bend PROOF.bend`
schlägt fehl, solange ein Law offen oder falsch ist. Das Law formuliert also, *was* gelten soll, und der
Code kann sich davon nicht unbemerkt entfernen.

Beispiel aus dem Pilot, über das unveränderte `kernel/topology.bend`:

```python
law extrude_triangle_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c], delta)) == True{} : Bool}

def Laws.extrude_triangle_well_formed(a, b, c, delta):
  {==}
```

Lies das so: Für **jedes** Dreieck und **jeden** Extrusionsvektor ist das Ergebnis von `T.extrude` ein
kombinatorisch gültiger geschlossener Körper. `W.solid_ok` ist die diskrete Hälfte von `validateSolid` aus
`src/brep.mjs`, als Bend-Funktion geschrieben: Kantenendpunkte gültig, jede Schleife geschlossen, jede
Kante genau einmal vorwärts und einmal rückwärts benutzt, V + F = E + 2. Der Beweis `{==}` heißt: Der
Checker rechnet `extrude` symbolisch aus, während alle Koordinaten unbekannte Variablen bleiben, und kommt
auf `True{}`.

Der Test mit eingebautem Fehler zeigt, dass das keine Formalität ist. Macht man im Spike den
Ring-Nachfolger um eins falsch (`next-off-by-one`), meldet der Checker
`expected : False{} / observed : True{}` an genau diesem Law.

Die Grenze steht schon im Beispiel: Das Law sagt nichts über Geometrie. Auch drei identische Punkte ergeben
hier einen "gültigen" Körper. Dass die Flächen nach außen zeigen, ist eine F32-Frage und bleibt Aufgabe von
Laufzeit-Validierung und Tests.

## 2. Was wonky heute hat

`LAWS.bend` (27 Zeilen) und `PROOF.bend` (86 Zeilen). `npm test` ruft `scripts/check-bend.mjs` auf, das
`bend PROOF.bend` ausführt (0,38 bis 0,45 s).

| Law | Was es wirklich sagt | Bewertung |
|---|---|---|
| `coedge_flip_involution` | `flip(flip(u)) == u` | Wahr, aber auch `flip = Identität` erfüllt es (Mutant überlebt) |
| `translation_preserves_vertex_count` | `translate` erhält die Listenlänge | Ein Längen-Law. Über Koordinaten sagt es nichts |
| `boolean_union_partition` | ∪ = ∩ ∪ (a\b) ∪ (b\a) als Wahrheitstabelle | Überlebt `∩ = ∪` und `∩ = a` |
| `boolean_differences_disjoint` | a\b und b\a sind disjunkt | Fängt nur `Differenz = ∩` |

Ehrliches Urteil:

- **Der Gate ist mehr wert als die Laws.** `PROOF.bend` importiert transitiv alle 61 Module unter `kernel/`
  und `kernel/ports/`, und Bend prüft importierte Module vollständig (Probe in `tmp/laws/probe`). Damit
  beweist `npm test` bei jedem Lauf, dass der ganze Kernel typcheckt und jede Rekursion terminiert, ohne
  `@unsafe` und ohne Fremdcode.
- **Die 4 Laws sind wahr, aber schwach.** Die Kommentare in `LAWS.bend` sind ehrlich zum Umfang. Die Namen
  versprechen trotzdem mehr, als die Aussagen halten (Mutationstest in prior-art §1.7).
- **Der Gate hat ein Loch.** Füllt man ein falsches Law über einen `@unsafe`-Helfer, endet Bend 2.0.25 mit
  Exit 0 ("All terms check, but 2 defs rely on unsafe or foreign code"), und `check-bend.mjs` prüft nur den
  Exit-Code (prior-art §1.6, Upstream-Issue #966).
- Alles, was den Kernel tatsächlich korrekt hält, läuft zur Laufzeit oder in Tests: `validateSolid` und
  `validateAnalytic` in JS, `S.edges_closed`, `CT.valid`, `H.valid` und `CV.audit` in Bend, dazu die
  BigInt-Orakel und die OCCT/Manifold-Vergleiche.

## 3. Was sich beweisen lässt und was es bringt

Sortiert nach Nutzen. Jede Zeile ist gemessen, nicht geschätzt, sofern nicht "Schätzung" dabeisteht.

| Rang | Bereich | Was bewiesen ist | Kosten (gemessen) | Welchen Fehler es verhindert |
|---:|---|---|---|---|
| 1 | **Gates und Fehlerpfade** | Ein `Unresolved`-Teil verwirft den ganzen planaren Boolean. Eine ungültige Membership wird `Failed` statt innen/außen. Ein `Undefined`-Vorzeichen führt zu `InvalidRoute`. `UnknownBounds` wird nie weggejoint. Revolve verweigert 0- und 2-Punkt-Profile. | je 1 bis 10 Zeilen, Fallunterscheidung | 9467cfb (ein Validator, den niemand aufrief). Genau die Fehlerklasse, die KI-Refactorings erzeugen: Fehlerpfad beim Umbau "vereinfacht" |
| 2 | **Topologie der Konstruktoren** | Extrude für n = 3, 4 gültig; V+F = E+2 für **jedes** n; Transformation erhält Gültigkeit für **jeden** Körper; Umkehren einer Schleife erhält Geschlossenheit für **jede** Schleife; Frustum geschlossen und Genus 0; Revolve n = 3 geschlossen, n = 4 Genus 1 | Evaluation: 0,1 s (n=3) bis 12,7 s (n=64). Closure-Law allgemein: ca. 190 Zeilen | 8b21014 (Revolve-Kante zweimal gleich herum benutzt). Mutanten `side-wrong-vertical`, `next-off-by-one`, `top-face-shares-bottom-ring`, `reverse-no-flip` gefangen |
| 3 | **Exakte Integer-Arithmetik** | `x - x` ist exakt null für jede `Big`; Differenzen sind nie negative Null; `mag_cmp` antisymmetrisch; `mag_add` rechnet exakt wie Nat-Addition (bei Ziffern ≤ 4095) | `mag_add_exact`: ca. 630 Zeilen inkl. U32-Lemma-Bibliothek, Check 0,44 s | Mutanten `sub-drops-negation`, `make-keeps-negative-zero`, drei `mag_add`-Mutanten gefangen |
| 4 | **Wire-Codecs** | Round Trip `decode(encode(x)) == Some(x)` für Coedge, Edge, Face; nachgestellte Wörter werden abgelehnt | ca. 85 Zeilen, großteils mechanisch | Mutanten `codec-bool-swapped`, `codec-ignores-trailing` gefangen |
| 5 | **Identität** | Transformation erhält den Ursprung; semantische Ursprünge hängen nicht von der Revision ab | je 1 bis 3 Zeilen | Stille Umbenennung von Entitäten bei Refactorings |

Einordnung:

- **Rang 1 hat das beste Verhältnis.** Diese Laws kosten fast nichts und treffen genau das, was AGENTS.md
  verlangt ("explicit capability errors, never silent fallbacks"). Laufzeit-Tests treffen solche Pfade nur,
  wenn jemand den passenden Fehlerfall konstruiert.
- **Rang 2 ist der größte inhaltliche Gewinn**, hat aber eine klare Grenze: Allgemeine Laws (für jedes n)
  gibt es für Zählungen, Transformation und Schleifenumkehr. "Extrude ist für jedes n gültig" ist nicht
  bewiesen, die Schätzung liegt bei 600 bis 1.200 Beweiszeilen (U32-Indexarithmetik). Bis dahin: feste
  kleine n als Law plus Laufzeitprüfung für alle n (Vorschlag spike §9.4).
- **Rang 3 deckt nur die exakte Rückfallebene ab.** `point_plane` rechnet zuerst mit einem F32-Filter, und
  dessen Entscheidung ist unbeweisbar. Bewiesen ist die Integer-Schicht darunter. Dieselbe Technik passt auf
  das `big.bend` des exact-plane-Prototyps im Bake-off (16-Bit-Limbs statt 4096er-Ziffern).
- **Rang 4 gehört dem Native-Binding-Workflow.** Bewiesen wurde auf einer generierten Kopie in
  `kernel/laws/spike/wire`. Für den Produktions-Codec braucht `gen-wire.mjs` eine Zeile Änderung (F32
  strukturell kodieren statt über das Axiom `F32.bits`, Vorschlag PR-6 in der Inventur). Deshalb nicht im
  Pilot.

## 4. Was sich nicht beweisen lässt

**Gleitkomma-Geometrie.** In `bend2/base.bend` ist jede F32-Operation (`F32.add`, `F32.is_lt`, `F32.bits`,
...) ein `law` ohne `def`, also ein Axiom. Der Checker rechnet nicht einmal `0.0 + 0.0` aus. Deshalb ist
unbeweisbar:

- Orientierung (zeigen Flächen nach außen), Punkt-Klassifikation, Schnittkurven, Volumen, Toleranzen;
- der F32-Filter der robusten Prädikate und die Umwandlung F32 → `Big` (`from_word`);
- alles "geometrisch richtig" an einem Boolean.

Bends eigene Demos ziehen dieselbe Grenze ("The F32 scene is not claimed", Raytracer-Demo).

**Weitere harte Grenzen des Checkers:**

- Berechnete Nats ab 2^15 in einem Typ lassen den Checker-Stack überlaufen. "Unter 2^32" lässt sich nur
  breitengenerisch oder als Hypothese formulieren.
- Beweise per Evaluation wachsen etwa kubisch: Extrude mit n = 64 braucht 12,7 s. Instanz-Laws also klein halten.
- Vertrauensbasis: Die Laws gelten über Bends `Word(32n)`-Modell von U32. Die JS- und C-Runtimes rechnen
  nativ, ihre Übereinstimmung wird angenommen, nicht bewiesen. Der Checker ist 5 Tage alt, mit 5 gemeldeten
  Beweisen von `False` seit 2.0.0 (4 behoben, #994 offen). Ein grüner Gate ist starke Evidenz, keine Gewissheit.
- Ein Law über eine Bend-Funktion sagt nichts über JS-Pfade, die sie umgehen.

**So ist der F32-Teil stattdessen abgedeckt:**

| Anspruch | Heute | Vorschlag |
|---|---|---|
| Vorzeichen der Prädikate | Exakte Integer-Rückfallebene (deren Kern jetzt bewiesen ist), BigInt-Orakel in `test/robust-predicates.test.mjs` | Differentialtest "Filter-Entscheidung == exakte Entscheidung" auf Zufalls- und Grenzfällen (EXA-15) |
| Körper ist gültig | `validateSolid`/`validateAnalytic` (JS), `S.edges_closed`, `CT.valid`, `H.valid`, `CV.audit` (Bend) | Konstruktoren prüfen ihr eigenes Ergebnis in Bend (PR-7). `solid_ok` aus dem Spike zur Laufzeit nach jeder Konstruktion aufrufen (spike §9.4); die Laws garantieren dann Eigenschaften der Prüfung selbst |
| Boolean geometrisch richtig | Bake-off-Referee: OCCT exakt und manifold3d als unabhängige Orakel über `uv run` (`scripts/bakeoff/reference.py`), öffentliche Regressionen, STEP-Validierung | beibehalten; Volumen-Gegenprüfung nach pierce/revolve (GEO-05) |
| Rotationen sind echt | Guard in `src/queries.mjs` (nur JS) | Guard in Bend (PR-7), damit Native-Binding und neue Frontends ihn nicht umgehen |

Faustregel: **Laws halten die Kombinatorik fest, Laufzeit-Checks und Differentialtests die Geometrie.** Die
Laws ersetzen keinen Test, sie machen eine Klasse von Fehlern unmöglich statt nur unwahrscheinlich.

## 5. Der Prozess

### 5.1 Wer besitzt was

| Datei | Besitzer | Regel |
|---|---|---|
| `LAWS.bend` (Root) | **Marc** | Nur Marc ändert. Agents schlagen vor (5.2) |
| `kernel/laws/spec/*.bend` | **Marc** | Spec-Helfer, die in einem Law aufgerufen werden (`solid_ok`, `value`, `digits_ok`, Projektionen). Sie *sind* Teil der Spezifikation: Wer `solid_ok` auf `True{}` stellt, entwertet jedes Topologie-Law, ohne `LAWS.bend` anzufassen |
| `laws.lock.json` (Root) | **Marc** | SHA-256 von `LAWS.bend` und allen Spec-Dateien. Das Schreiben des Locks ist der Freigabe-Akt |
| `PROOF.bend` (Root), `kernel/laws/lib/*.bend` | Agents | Beweise und Lemmata. Dürfen jederzeit geändert werden, solange der Gate grün ist |
| `kernel/laws/draft/LAWS.bend` + `PROOF.bend` | Agents | Vorschläge, jeweils schon bewiesen |

Bis zur Freigabe liegen die Spec-Helfer noch in `kernel/laws/spike/` (`topology-spec.bend`,
`arith-spec.bend`) bzw. oben in `kernel/laws/pilot/LAWS.bend`. Bei der Übernahme wandern sie nach
`kernel/laws/spec/`, die Lemma-Dateien des Spikes nach `kernel/laws/lib/`.

### 5.2 Ablauf für ein neues Law

1. Ein Agent schreibt das Law in `kernel/laws/draft/LAWS.bend`, **mit Beweis** in `draft/PROOF.bend`.
   Zu jedem Law gehört ein Kommentar mit: was es garantiert, was nicht, und mindestens ein Mutant (eine
   konkrete Fehländerung am Kernel), den es nachweislich fängt. Ohne gefangenen Mutanten kein Vorschlag:
   Das ist die Absicherung gegen Laws, die nichts aussagen (siehe `coedge_flip_involution`).
2. Der Draft-Gate läuft mit: `node scripts/laws/gate.mjs kernel/laws/draft`.
3. Marc liest den Draft, streicht oder ändert Formulierungen und übernimmt freigegebene Laws in den Root.
   Praktisch: Der Agent legt einen Patch bereit, Marc wendet ihn an und schreibt danach selbst den Lock
   (`npm run laws:lock`, 5.6). Der Beweis wandert in dieselbe Änderung nach `PROOF.bend`.
4. Ab da gilt das Law für jeden Agent als unveränderlich.

### 5.3 Wenn ein Refactoring ein Law bricht

- **Beweis bricht, Law ist noch wahr** (im Spike bei 2 von 13 Mutanten): Der Agent repariert den Beweis.
  Das ist normale Wartung.
- **Law ist falsch geworden oder die Signatur ändert sich:** Der Agent hält an und schreibt einen
  Änderungsvorschlag in den Draft, mit Begründung, warum das alte Law nicht mehr gelten soll. Marc
  entscheidet. Genau diese Reibung ist der Zweck: Eine Spezifikation ändert sich nicht nebenbei.

### 5.4 Schutz gegen stilles Abschwächen

Drei Schichten, von "verhindert" bis "fällt auf":

1. **Hash-Lock (fällt auf, wie der r10b-Freeze).** `scripts/laws/gate.mjs --lock laws.lock.json` bricht ab,
   sobald `LAWS.bend` oder eine gelockte Spec-Datei nicht mehr den freigegebenen SHA-256 hat. Getestet:
   Ein manipulierter Hash liefert `locked spec file kernel/laws/spike/arith-spec.bend changed ... Laws and
   spec helpers change only with Marc's approval.`, Exit 1. Wie bei `fixtures/r10b/provenance.json`
   verhindert der Hash nicht, dass jemand Datei *und* Lock ändert. Er macht daraus aber eine absichtliche,
   im Diff sichtbare Handlung, und AGENTS.md verbietet sie.
2. **Claude-Code-Hook (verhindert den normalen Weg).** Eine `deny`-Regel für Edit/Write auf `LAWS.bend`,
   `laws.lock.json` und `kernel/laws/spec/**` sowie ein PreToolUse-Hook, der Bash-Befehle blockt, die
   diese Pfade schreiben. Das funktioniert wie dein bestehender Hook gegen Gedankenstriche.
3. **Hygiene-Lint und exaktes Urteil.** Der Gate lehnt `@unsafe`, fremde `import "..."` und offene
   `?`-Löcher in allen Law-Dateien ab, verlangt `import ./LAWS.bend as Laws` in `PROOF.bend` und akzeptiert
   als letzte Zeile nur exakt `All terms check.`, mit 120 s Timeout. Getestet: Ein falsches Law, das über
   einen `@unsafe`-Helfer "bewiesen" wird, fällt durch (`PROOF.bend:8: @unsafe`, Exit 1).

Was bleibt: Ein Agent kann den *Kernel* so umbauen, dass ein Law trivial wird (z. B. `extrude` liefert
immer denselben Würfel). Dagegen helfen nur die normalen Tests. Laws und Tests ergänzen sich.

### 5.5 Laws für neuen Kernel-Code

Wer Kernel-Code schreibt, liefert passende Law-Vorschläge im Draft mit:

| Neuer Code | Erwartetes Law |
|---|---|
| Konstruktor (neuer Körpertyp) | Gültigkeit für die kleinsten Instanzen per `{==}` (wie Frustum/Revolve), Zählungen/Euler für jedes n |
| Admission-Gate, Validator | "Ergebnis existiert nur nach bestandener Prüfung", z. B. `revolve == Swept{s}` ⇒ `rejection == 0` |
| Fehlerpfad (`Unresolved`, `Failed`, `Undefined`) | Absorption: ein Fehlerteil macht das Gesamtergebnis zum Fehler |
| Fuel-Schleife | Fuel reicht für die zulässigen Eingaben (Law), sonst expliziter Capability-Error bei Erschöpfung statt stiller Kürzung |
| Codec-Typ | generiertes Round-Trip-Law |
| Integer-Arithmetik | Korrektheit gegen Nat-Semantik oder mindestens Vorzeichen-/Normalform-Laws |
| Reine Gleitkomma-Geometrie | kein Law; Laufzeit-Check oder Differentialtest benennen |

Laws kommen nur auf **stabile Schnittstellen**. Der Bake-off-Code unter `kernel/proto/` bekommt Laws erst,
wenn ein Algorithmus gewählt ist. Dann ist die Aufteilung arrange/classify/assemble des
exact-plane-Prototyps ein Ziel für das stärkste realistische Boolean-Law: "die Zusammensetzung ist
kombinatorisch gültig, egal wie die Prädikate entscheiden" (Smith und Dodgson, prior-art §2.4).

### 5.6 Nötige Änderungen an Marc-Dateien (Vorschläge, nicht angewendet)

`scripts/check-bend.mjs`: exaktes Urteil statt Exit-Code, dazu der freigegebene Law-Bereich.

```diff
-import { execFileSync } from 'node:child_process';
-import { fileURLToPath } from 'node:url';
-import { readFileSync, existsSync } from 'node:fs';
-import { join } from 'node:path';
-const root = fileURLToPath(new URL('../', import.meta.url));
-const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
-const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
-if (!existsSync(bend)) throw new Error('Run npm run setup to install the pinned Bend compiler.');
-execFileSync(bend, ['PROOF.bend'], {
-  cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: 'inherit',
-});
+import { execFileSync } from 'node:child_process';
+import { existsSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+const root = fileURLToPath(new URL('../', import.meta.url));
+const gate = dir => execFileSync(process.execPath,
+  ['scripts/laws/gate.mjs', dir, '--lock', 'laws.lock.json'], { cwd: root, stdio: 'inherit' });
+gate('.');
+if (existsSync(new URL('../kernel/laws/draft/PROOF.bend', import.meta.url))) execFileSync(process.execPath,
+  ['scripts/laws/gate.mjs', 'kernel/laws/draft'], { cwd: root, stdio: 'inherit' });
```

`package.json`:

```diff
     "check:bend": "node scripts/check-bend.mjs",
+    "laws:lock": "node scripts/laws/gate.mjs . --write-lock laws.lock.json kernel/laws/spec/*.bend",
```

`AGENTS.md`:

```diff
+- Laws: `LAWS.bend`, `laws.lock.json` and `kernel/laws/spec/**` belong to Marc. Never edit them; propose
+  laws in `kernel/laws/draft/` with proof, guarantee, non-guarantee and one killed mutant. Keep proofs in
+  `PROOF.bend` and `kernel/laws/lib/` green. If a change makes an approved law false, stop and propose.
```

`.claude/settings.json` (Projekt):

```diff
+  "permissions": {
+    "deny": ["Edit(LAWS.bend)", "Write(LAWS.bend)", "Edit(laws.lock.json)", "Write(laws.lock.json)",
+             "Edit(kernel/laws/spec/**)", "Write(kernel/laws/spec/**)"]
+  },
+  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command",
+    "command": "node scripts/laws/deny-spec-writes.mjs" }] }] }
```

(`deny-spec-writes.mjs` wäre ein 15-Zeilen-Skript, das Bash-Befehle mit Schreibzugriff (`>`, `sed -i`,
`mv`, `cp`, `rm`, `tee`) auf diese Pfade abweist. Es wird erst geschrieben, wenn du das Modell freigibst.)

## 6. Der erste Law-Batch zur Freigabe

**Datei:** `kernel/laws/pilot/LAWS.bend` (37 Laws, 7 Spec-Helfer), Beweise in
`kernel/laws/pilot/PROOF.bend`. **Gate:** `node scripts/laws/gate.mjs kernel/laws/pilot`, Ergebnis
`37 laws, All terms check.` in 0,85 s, 0,83 s und 1,07 s (Load 18,96, 16,84 und 19,77; Log in
`out/laws/gate-timings.jsonl`). Alles läuft über unveränderten Produktionscode. Prüfung, Messwerte pro
Law und Mutationstest: [docs/laws/pilot.md](laws/pilot.md), Gate `node scripts/laws/check-pilot.mjs`.

Aufnahmekriterium: Jedes Law ist **bewiesen** (im Spike, in den Inventur-Probes oder hier neu) und schützt
eine Stelle, an der ein Fehler still bliebe. Keine Aussage hängt vom Wert eines F32 ab. Koordinaten,
Radien und Toleranzen sind universell quantifizierte, undurchsichtige Werte: Das Law gilt für *jede*
Geometrie, sagt aber auch nichts über sie.

Spec-Helfer, die du mit freigibst (sie entscheiden, was die Laws bedeuten):

- `W.solid_ok` (`kernel/laws/spike/topology-spec.bend`): Endpunkte im Bereich und verschieden, jede
  Ecke referenziert, pro Fläche eine Schleife mit ≥ 3 gültigen Coedges, jede Schleife geschlossen, jede
  Kante genau einmal vorwärts und einmal rückwärts, V + F = E + 2. **Prüft nicht:** dass die zwei
  Benutzungen einer Kante auf verschiedenen Flächen liegen, Zusammenhang, Orientierung zur Normale.
- `AS.value`, `AS.digits_ok`, `AS.le`, `AS.cmp_flip`, `AS.negative_zero` (`arith-spec.bend`): Nat-Wert einer
  Basis-4096-Ziffernliste, Ziffern ≤ 4095, Ordnung, Vergleich umdrehen, "negative Null".
- In `pilot/LAWS.bend`: `a_edges`, `a_faces` (Projektionen), `euler_holds` (V + 2F + 2G = E + L + 2S),
  `flip_sign`, `origin_of`, `is_exact_in_plane`.
- Wichtig: `frustum_*` und `revolve_triangle_edges_closed` benutzen die **Kernel-eigenen** Prüfer
  `S.edges_closed` und `CT.valid` als Spezifikation. Sie sagen also "der Kernel-Gate akzeptiert jedes
  Frustum", nicht unabhängig "jedes Frustum ist eine geschlossene 2-Mannigfaltigkeit". Dass diese Prüfer
  halten, was ihr Name sagt, ist Welle 2 (TOP-21/22).

### Gruppe 1: Wahrheitstabelle und Coedge-Flip (ersetzt drei schwache Laws)

```python
law boolean_selected_union:
  for +a: Bool
  for +b: Bool
  {B.selected(0, a, b) == Bool.or(a, b) : Bool}

law boolean_selected_intersection:
  for +a: Bool
  for +b: Bool
  {B.selected(1, a, b) == Bool.and(a, b) : Bool}

law boolean_selected_difference:
  for +a: Bool
  for +b: Bool
  {B.selected(2, a, b) == Bool.and(a, Bool.not(b)) : Bool}

law coedge_flip_toggles_direction:
  for +edge: U32
  for +forward: Bool
  {T.flip(T.Use{edge, forward}) == T.Use{edge, Bool.not(forward)} : T.Coedge}
```

| Law | Garantiert | Garantiert nicht |
|---|---|---|
| `boolean_selected_*` | Die Zellauswahl ist exakt die Wahrheitstabelle von ∪, ∩ und a\b. Impliziert die beiden heutigen Boolean-Laws | Dass die Zellen richtig als innen/außen klassifiziert sind. Op-Codes ≥ 3 werden weiter still als Differenz behandelt (BOO-05, Vorschlag PR-5: Op als ADT) |
| `coedge_flip_toggles_direction` | `flip` behält die Kante und kehrt genau die Richtung um. Impliziert die heutige Involution | Etwas über die Geometrie der Kante |

Nachweis: Die drei Mutanten, die die heutigen Laws überleben (∩ = ∪, ∩ = a, flip = Identität), und der
schon heute gefangene (Differenz = ∩) fallen alle durch, die unveränderten Kopien bestehen
(`tmp/laws/pilot-mut/results.jsonl`, je ca. 0,07 s). **Empfehlung:** `boolean_union_partition` und
`boolean_differences_disjoint` durch die drei Tabellen-Laws ersetzen, `coedge_flip_involution` durch
`coedge_flip_toggles_direction`. `translation_preserves_vertex_count` bleibt, der Kommentar sollte es als
Längen-Law benennen.

### Gruppe 2: Topologie der Konstruktoren

```python
law extrude_triangle_well_formed:                 # beschränkt: n = 3
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c], delta)) == True{} : Bool}

law extrude_quad_well_formed:                     # beschränkt: n = 4
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +d: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c, d], delta)) == True{} : Bool}

law extrude_euler_every_profile:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {Nat.add(W.nv(T.extrude(points, delta)), W.nf(T.extrude(points, delta))) == Nat.add(W.ne(T.extrude(points, delta)), 2n) : Nat}

law transform_preserves_well_formed:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {W.solid_ok(T.transform(s, r, o)) == W.solid_ok(s) : Bool}

law reverse_uses_swaps_use_counts:
  for +cs: List<&2, T.Coedge>
  for +k: Nat
  for +dir: Bool
  {W.use_count(T.reverse_uses(cs, Nil{}), k, dir) == W.use_count(cs, k, Bool.not(dir)) : Nat}

law reverse_uses_preserves_closure:
  for +cs: List<&2, T.Coedge>
  for +edges: List<&2, T.Edge>
  {W.closed(T.reverse_uses(cs, Nil{}), edges) == W.closed(cs, edges) : Bool}

law frustum_edges_closed:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {S.edges_closed(a_edges(A.frustum(bottom, top, x, r0, r1)), a_faces(A.frustum(bottom, top, x, r0, r1)), 0) == True{} : Bool}

law frustum_vertex_links:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {CT.valid(A.frustum(bottom, top, x, r0, r1)) == True{} : Bool}

law frustum_euler_poincare:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {euler_holds(A.frustum(bottom, top, x, r0, r1), 1n, 0n) == True{} : Bool}

law revolve_triangle_edges_closed:                # beschränkt: 3-Punkt-Profil
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +rc: R.Real
  for +hc: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {S.edges_closed(a_edges(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), a_faces(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), 0) == True{} : Bool}

law revolve_quad_genus_one:                       # beschränkt: 4-Punkt-Profil
  for +r0: R.Real
  for +h0: R.Real
  for +r1: R.Real
  for +h1: R.Real
  for +r2: R.Real
  for +h2: R.Real
  for +r3: R.Real
  for +h3: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {euler_holds(Rv.shell([Rv.Ring{r0, h0}, Rv.Ring{r1, h1}, Rv.Ring{r2, h2}, Rv.Ring{r3, h3}], o, axis, x), 1n, 1n) == True{} : Bool}

law revolve_refuses_empty:
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve(Nil{}, t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}

law revolve_refuses_two_points:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}], t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}
```

| Law | Garantiert | Garantiert nicht |
|---|---|---|
| `extrude_triangle/quad_well_formed` | Für jedes 3- bzw. 4-Punkt-Profil und jeden Vektor ist das Extrudat kombinatorisch gültig (`solid_ok`). Fängt `next-off-by-one`, `side-wrong-vertical`, `top-face-shares-bottom-ring` | n ≥ 5. Geometrie (auch entartete Profile gelten als "gültig"). Orientierung |
| `extrude_euler_every_profile` | Für **jede** Profillänge: V + F = E + 2 (V = 2n, E = 3n, F = n + 2) | Nur Zählungen; über Indizes und Paarung für n ≥ 5 nichts |
| `transform_preserves_well_formed` | Starre Transformation ändert an der Kombinatorik **jedes** Körpers nichts | Dass die Rotation echt ist (F32, JS-Guard). Mutant "Transformation kehrt alle Schleifen um" bricht nur den Beweis, nicht das Law, weil `solid_ok` keine Orientierung kennt |
| `reverse_uses_*` | Umkehren einer Schleife (Bodenfläche des Extrudats) tauscht vorwärts/rückwärts exakt und erhält Geschlossenheit, für **jede** Schleife und Kantentabelle. Fängt `reverse-no-flip` | Dass die umgekehrte Fläche geometrisch nach außen zeigt |
| `frustum_*` | Für jedes Frustum: jede Kante gepaart (`S.edges_closed`), jede Ecken-Umgebung ein Zyklus (`CT.valid`), Euler-Poincaré mit einer Schale, Genus 0 | Radien > 0, nicht entartete Achse. Unabhängigkeit von den Kernel-Prüfern (siehe oben) |
| `revolve_triangle_edges_closed` | Die Fehlerklasse von 8b21014 (Kante zweimal gleich herum) für 3-Punkt-Profile | n ≥ 4 (bewiesen bis n = 32 in `tmp/laws/inventory/revolve32.bend`, 3,72 s, als generierte Evidenz statt Spec vorgesehen) |
| `revolve_quad_genus_one` | Ein 4-Punkt-Profil ergibt eine Schale vom Genus 1 (Volltorus) | Andere n; Geometrie |
| `revolve_refuses_*` | 0- und 2-Punkt-Profile werden abgewiesen, bevor Geometrie entsteht (Fall 9467cfb). Hängt nicht von F32-Prüfungen ab | 1-Punkt-Profile (gleiches Muster, nicht als Law ausgeführt). Dass Profile ab 3 Punkten nur nach bestandener Admission gebaut werden (TOP-13, Welle 2) |

### Gruppe 3: Exakte Integer-Arithmetik (`kernel/robust-predicates.bend`)

```python
law exact_self_difference_is_zero:
  for +x: RP.Big
  {RP.sign(RP.sub(x, x)) == RP.ExactlyZero{} : RP.Sign}

law exact_decision_on_plane_origin:
  for +n: PG.Vec3
  for +a: PG.Vec3
  {RP.exact_decision(n, a, a) == RP.Decision{RP.ExactlyZero{}, RP.ExactDyadic{}} : RP.Decision}

law exact_difference_normal:
  for +a: RP.Big
  for +b: RP.Big
  {AS.negative_zero(RP.sub(a, b)) == False{} : Bool}

law big_sign_neg:
  for +a: RP.Big
  {RP.sign(RP.neg(a)) == flip_sign(RP.sign(a)) : RP.Sign}

law mag_cmp_antisymmetric:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  {AS.cmp_flip(RP.mag_cmp(b, a)) == RP.mag_cmp(a, b) : Cmp}

law mag_add_exact:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for +c: U32
  for da: {AS.digits_ok(a) == True{} : Bool}
  for db: {AS.digits_ok(b) == True{} : Bool}
  for dc: {AS.le(U32.to_nat(c), 1n) == True{} : Bool}
  {AS.value(RP.mag_add(a, b, c)) == Nat.add(Nat.add(AS.value(a), AS.value(b)), U32.to_nat(c)) : Nat}

law point_plane_invalid_normal:
  for +n: PG.Vec3
  for +p: PG.Vec3
  for +o: PG.Vec3
  for h: {RP.vec_valid(n) == False{} : Bool}
  {RP.point_plane(n, p, o) == RP.Decision{RP.Undefined{}, RP.Invalid{}} : RP.Decision}

law expansion_zero_needs_safe:
  for +words: List<&2, F32>
  {I.expansion_zero(I.Expansion{False{}, words}) == False{} : Bool}
```

| Law | Garantiert | Garantiert nicht |
|---|---|---|
| `exact_self_difference_is_zero` | `x - x` hat für **jede** `Big` (auch nicht normalisierte) das Vorzeichen exakt null. Fängt `sub-drops-negation` | Allgemeine Vorzeichen-Antisymmetrie `sign(x-y) = -sign(y-x)`: ohne Ziffernbereich **falsch** (Gegenbeispiel Ziffer 4096), mit Bereich noch nicht bewiesen (`mag_sub` fehlt) |
| `exact_decision_on_plane_origin` | Die exakte Rückfallentscheidung setzt den Ebenenursprung selbst auf "exakt auf der Ebene" | Etwas über `point_plane` als Ganzes: Davor läuft der F32-Filter |
| `exact_difference_normal` | Differenzen liefern nie eine negative Null. Fängt `make-keeps-negative-zero` (wurde genau dafür ergänzt) | Normalform bei Addition/Multiplikation im Allgemeinen |
| `big_sign_neg` | Negation dreht das Vorzeichen, für jede `Big` | Korrektheit von `neg` auf dem Betrag (trivial, nicht formuliert) |
| `mag_cmp_antisymmetric` | Betragsvergleich ist antisymmetrisch | Dass die Ordnung zum Wert passt: Mutant "Tie-Break vertauscht" bleibt antisymmetrisch und bricht nur den Beweis. Ein Law `mag_cmp` vs. `value` fehlt (Welle 2) |
| `mag_add_exact` | Der Mehr-Limb-Addierer rechnet exakt wie Nat-Addition, bei Ziffern ≤ 4095 und Übertrag ≤ 1. Fängt drei `mag_add`-Mutanten | `mag_sub`, `mag_mul` (Schätzung 80 bis 120 bzw. 300 bis 400 Zeilen); `from_word` (F32, unbeweisbar) |
| `point_plane_invalid_normal` | Wenn die Validitätsprüfung die Normale verwirft, gibt `point_plane` `Undefined/Invalid` zurück und nie ein Vorzeichen | Ob `vec_valid` NaN/Inf richtig erkennt (F32, BigInt-Orakel-Tests) |
| `expansion_zero_needs_safe` | Eine als unsicher markierte Expansion bescheinigt nie "null" | Dass das Sicherheits-Flag richtig gesetzt wird (F32) |

### Gruppe 4: Kontrollfluss, kein stiller Fallback

```python
law planar_choose_rejects_invalid_first:
  for +x: Bool
  for +b: Q.Membership
  for +polys: List<&2, H.Polygon>
  for +prior: Q.Selection
  for +index: U32
  for +sub: Bool
  {Q.choose(Q.Membership{False{}, x}, b, polys, prior, index, sub) == Q.Failed{P.UnsupportedArrangement{}, 4, index} : Q.Selection}

law planar_choose_subtraction:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, H.Polygon>
  for +before: List<&2, H.Polygon>
  for +count: U32
  for +index: U32
  {Q.choose(Q.Membership{True{}, ai}, Q.Membership{True{}, bi}, polys, Q.Selection{before, count}, index, True{})
    == Q.Selection{Bool.pick(List<&2, H.Polygon>, B.selected(2, ai, bi), List.append(&2, H.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(2, ai, bi), 1, 0) : U32)} : Q.Selection}

law planar_choose_union:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, H.Polygon>
  for +before: List<&2, H.Polygon>
  for +count: U32
  for +index: U32
  {Q.choose(Q.Membership{True{}, ai}, Q.Membership{True{}, bi}, polys, Q.Selection{before, count}, index, False{})
    == Q.Selection{Bool.pick(List<&2, H.Polygon>, B.selected(0, ai, bi), List.append(&2, H.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(0, ai, bi), 1, 0) : U32)} : Q.Selection}

law planar_add_body_unresolved_left:
  for +reason: P.Reason
  for +stage: U32
  for +detail: U32
  for +budget: R.Real
  for +stats: PT.Stats
  for +rest: PT.Result
  {PB.add_body(PT.Unresolved{reason, stage, detail, budget, stats}, rest) == PT.Unresolved{reason, stage, detail, budget, stats} : PT.Result}

law planar_add_body_unresolved_right:
  for +bodies: List<&2, PT.Body>
  for +b0: R.Real
  for +s0: PT.Stats
  for +reason: P.Reason
  for +stage: U32
  for +detail: U32
  for +budget: R.Real
  for +stats: PT.Stats
  {PB.add_body(PT.Bodies{bodies, b0, s0}, PT.Unresolved{reason, stage, detail, budget, stats}) == PT.Unresolved{reason, stage, detail, budget, stats} : PT.Result}

law hybrid_undefined_sign_invalidates:
  for +contact: Bool
  for +valid: Bool
  {Hy.contact_sign(RP.Undefined{}, Hy.ContactState{valid, contact}) == Hy.ContactState{False{}, contact} : Hy.ContactState}

law hybrid_invalid_contact_route:
  for +planar: Bool
  for +contact: Bool
  {Hy.choose_route(planar, Hy.ContactState{False{}, contact}) == Hy.InvalidRoute{} : Hy.Route}

law bounds_join_unknown_left:
  for +b: FB.Bounds
  {FB.join(FB.UnknownBounds{}, b) == FB.UnknownBounds{} : FB.Bounds}

law bounds_join_unknown_right:
  for +a: FB.Bounds
  {FB.join(a, FB.UnknownBounds{}) == FB.UnknownBounds{} : FB.Bounds}

law threshold_never_exact:
  for +within: Bool
  for +exceeds: Bool
  for +ev: CB.Evidence
  {is_exact_in_plane(CB.classify_threshold(within, exceeds, ev)) == False{} : Bool}
```

| Law | Garantiert | Garantiert nicht |
|---|---|---|
| `planar_choose_rejects_invalid_first` | Eine unaufgelöste Membership des ersten Operanden führt immer zu `Failed` (Stage 4, mit Zellindex), nie zu innen/außen | Den Fall des zweiten Operanden (gleiches Muster, Welle 2). Dass die Membership geometrisch stimmt |
| `planar_choose_subtraction/union` | Die planare Auswahl benutzt dieselbe Wahrheitstabelle wie `boolean.bend` (zwei Kodierungen, eine Spezifikation), inklusive Zähler | Schnitt-Operation (nicht in `choose`). Dass die parallele Auswahl gleich der alten Faltung ist (BOO-10, Welle 2) |
| `planar_add_body_unresolved_*` | Ein `Unresolved`-Teil macht das ganze Ergebnis `Unresolved`, von links und von rechts: keine Teilkörper | Dass jeder veröffentlichte Körper seinen Gate (`CT.valid`) bestanden hat. Das ist TOP-27, das wichtigste Law für Welle 2 |
| `hybrid_*` | Ein unentscheidbares Kontakt-Vorzeichen macht den Kontakt ungültig, und ein ungültiger Kontakt wählt nie einen Konstruktor | Dass `Undefined` in allen Fällen erzeugt wird, in denen es sollte (F32) |
| `bounds_join_unknown_*` | Unbekannte Flächengrenzen werden durch Vereinigung nie zu bekannten | Dass endliche Grenzen konservativ sind (GEO-07, F32) |
| `threshold_never_exact` | Eine Toleranz-Klassifikation liefert nie das Zertifikat "exakt in der Ebene"; exakt heißt immer exakt bewiesen | Richtigkeit der Toleranzentscheidung selbst (F32) |

Hinweis: Gruppe 4 hängt an `kernel/ports/planar-boolean*` und `kernel/ports/hybrid.bend`. Ersetzt der
Bake-off diese Pfade, gehen die Laws mit ihnen in Rente. Das ist erwünscht: Der Nachfolger bekommt dieselben
Aussagen als Einstiegslatte.

### Gruppe 5: Identität

```python
law transformed_keeps_origin:
  for +e: Id.EntityIdentity
  for +op: String
  for +occ: String
  for +rev: String
  {origin_of(Id.transformed(e, op, occ, rev)) == origin_of(e) : String}

law semantic_origin_ignores_revision:
  for +ns: String
  for +op: String
  for +occ: String
  for +r1: String
  for +r2: String
  for +kind: String
  for +role: String
  for +parents: List<&2, Id.ParentIdentity>
  {origin_of(Id.created(ns, op, occ, r1, kind, role, "semantic", parents)) == origin_of(Id.created(ns, op, occ, r2, kind, role, "semantic", parents)) : String}
```

| Law | Garantiert | Garantiert nicht |
|---|---|---|
| `transformed_keeps_origin` | Eine Transformation ändert den logischen Ursprung einer Entität nicht | Stabilität der übrigen Felder |
| `semantic_origin_ignores_revision` | Ein semantischer Ursprung hängt nicht von der Geometrie-Revision ab: Namen bleiben über Revisionen stabil | Injektivität (zwei verschiedene Entitäten, zwei verschiedene Namen, IDN-01/IDN-09, Aufwand L) |

### Bewusst nicht im Pilot

| Kandidat | Warum nicht jetzt |
|---|---|
| TOP-27: jeder vom planaren Boolean veröffentlichte Körper hat `CT.valid` bestanden | Höchster Wert, Klasse A, aber noch nicht bewiesen (ca. 12 Pipeline-Stufen, Schätzung M). **Erstes Law von Welle 2** |
| Wire-Codec-Round-Trips | Bewiesen, aber nur auf einer Kopie. Der Produktions-Codec gehört dem Native-Binding-Workflow und braucht dort PR-6 |
| Extrude/Revolve gültig für jedes n | 600 bis 1.200 Zeilen (Schätzung). Bis dahin Laufzeitprüfung (spike §9.4) |
| Vorzeichen-Antisymmetrie der Subtraktion | Braucht `digits_ok` und `mag_sub` (80 bis 120 Zeilen, Schätzung) |
| BOO-10 parallele Auswahl = Faltung | Aufwand L, braucht U32-`from_nat`-Lemmata |
| Revolve-Instanzen n = 8..32 | Bewiesen (bis 3,72 s), aber lange Aussagen; als generierte Evidenz im Gate, nicht als Spec |

## 7. Aufwand und Risiken

**Aufwand**

| Schritt | Aufwand |
|---|---|
| Pilot übernehmen: Spec- und Lemma-Dateien umziehen, Root-`PROOF.bend` erweitern, Gate umstellen | ca. ½ Tag Agent. Dazu 1 bis 2 h dein Review von Abschnitt 6 |
| Gate-Laufzeit danach | heute 0,4 bis 0,6 s, Pilot 0,8 bis 1,1 s. Insgesamt deutlich unter 2 s pro `npm test` |
| Welle 2: TOP-27, TOP-13/14 (Admission), U32-Lemma-Bibliothek, `mag_sub`, Antisymmetrie, `mag_cmp` vs. Wert | 3 bis 5 Agent-Tage (Inventur-Schätzung, durch Spike-Tempo gestützt: 17 Laws in ca. 40 min, 36 von 94 Läufen abgelehnt, jede Ablehnung ≤ 0,34 s) |
| Codecs mit dem Binding-Workflow (PR-6 + generierte Beweise) | 1 bis 2 Tage, dort |
| Laufende Wartung | Beweise brechen bei Refactorings (im Spike 2 von 13 Mutanten nur am Beweis). Das kostet pro Fall Minuten, nicht Stunden, solange Laws auf stabilen Schnittstellen sitzen |

Zur Einordnung (prior-art §2.5): Volle funktionale Korrektheit nach seL4/CompCert-Verhältnissen hieße
100.000 bis 400.000 Beweiszeilen. Das ist ausdrücklich **nicht** das Ziel. Das Ziel ist ein schmaler,
billiger Streifen diskreter Verträge, die Agents beim Umbauen typischerweise kaputt machen.

**Risiken**

1. **Schwache Spezifikation.** Ein Law ist nur so stark wie seine Spec-Helfer. `solid_ok` kennt keine
   Orientierung, `mag_cmp_antisymmetric` keine Ordnung zum Wert; zwei Spike-Mutanten sind genau dort
   durchgerutscht. Gegenmittel: jeder Vorschlag mit einem gefangenen Mutanten, Mutations-Harness
   (`scripts/laws/spike-mutants.mjs`) vor jeder Freigabe laufen lassen.
2. **Agents schwächen Laws ab.** Gegenmittel: Lock, Hook, Lint (5.4). Rest-Risiko: Kernel so umbauen,
   dass ein Law trivial wird. Das fangen nur Tests.
3. **Checker-Soundness.** Bend 2 ist seit 17.09. draußen, ein `False`-Beweis (#994) ist offen. Laws
   ersetzen deshalb keine Tests. Vor jedem Bend-Upgrade alle Gates neu laufen lassen und das Changelog auf
   Soundness-Fixes lesen.
4. **Reibung mit laufender Arbeit.** Laws auf `kernel/ports/planar-boolean*` können den Bake-off-Umbau
   bremsen. Deshalb stehen sie im Pilot nur als Kontrollfluss-Laws, die leicht zu übertragen sind, und
   `kernel/proto/` bleibt bis zur Entscheidung ohne Laws.
5. **Falsches Sicherheitsgefühl.** "Kernel verifiziert" wäre falsch. Richtig ist: Der diskrete Kern ist
   in diesen 37 Punkten bewiesen, die Geometrie bleibt getestet. Das sollte in README und Statusberichten
   genau so stehen.
6. **Checker-Grenzen.** Stack-Überlauf bei großen Nats in Typen, kubisches Wachstum bei Evaluation.
   Instanz-Laws klein halten, Schranken breitengenerisch formulieren.

## Dateien

- `kernel/laws/pilot/LAWS.bend`, `kernel/laws/pilot/PROOF.bend`: Pilot-Entwurf (37 Laws, bewiesen).
- [`docs/laws/pilot.md`](laws/pilot.md): Ergebnis des Beweisers: Zeiten und Beweisgrößen pro Law,
  Mutationstest mit Zuordnung zum Law, Grenzen, Befund Extrude, Kernel-Vorschläge K-1/K-2 als Diff.
- `scripts/laws/check-pilot.mjs`: Gate für den Pilot (gepinnte Aussagen, Paarung, Hygiene, Urteil).
- `scripts/laws/pilot-mutants.mjs`, `scripts/laws/kernel-proposals.mjs`, `kernel/laws/proposals/`:
  Mutationstest, Vorschläge auf einer Kopie, Zusatz-Laws.
- `scripts/laws/gate.mjs`: Gate mit Hash-Lock, Hygiene-Lint, exaktem Urteil, Timeout, Uptime-Log.
- `out/laws/gate-timings.jsonl`: Laufzeiten mit `uptime`.
- `tmp/laws/pilot-mut/`: Mutanten gegen Gruppe 1 (`node tmp/laws/pilot-mut/run.mjs`).
- `tmp/laws/gate-selftest/`, `tmp/laws/pilot-lock*.json`: Selbsttests des Gates (`@unsafe`, falscher Hash).
- Hintergrund: `docs/laws/inventory.md`, `docs/laws/spike.md`, `docs/laws/prior-art.md`,
  `out/laws/candidates.json`.

## Stand (24.09.2026)

Auf Marcs Wunsch zurückgestellt. Der Pilot (37 bewiesene Laws in `kernel/laws/pilot/`, `scripts/laws/`) wird mit seinem letzten Stand eingecheckt; das Root-`LAWS.bend` bleibt unverändert, bis Marc den Pilot-Batch freigibt.
