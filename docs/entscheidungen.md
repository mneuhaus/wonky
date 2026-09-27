# Entscheidungen

Protokoll der Produktentscheidungen für wonky. Neue Erkenntnisse oder Anforderungen können jede davon später ändern; dann wird hier ein neuer Eintrag ergänzt, der alte bleibt stehen.

## 24.09.2026: Empfehlungen des Product Owners angenommen

Marc hat alle offenen Empfehlungen angenommen.

### Fillets und Fasen (Details: [fillet.md](fillet.md), Abschnitt 7)

1. **Erste Version nur analytisch.** Dazu gehören:
   - Kanten zwischen Ebenen in jedem Winkel;
   - Bohrungs- und Zapfenränder;
   - Fasen als Ebene oder Kegel;
   - Kappen, Gehrungen und tangentiale Ketten;
   - Kugelecken und Full Round.

   Alles andere wird typisiert verweigert.
2. **Torus und Kugel** kommen als Flächentypen in den Produktionskernel, gekoppelt an die Integration des Hybrid-Booleans.
3. **Freiform-Blends mit Toleranz** gibt es nur auf ausdrücklichen Wunsch (Opt-in), immer mit ausgewiesener Toleranz und nie als exakt gekennzeichnet.
4. **Querschnitt nur kreisförmig (G1)** in Version 1.
5. **Fasen bei Winkeln ungleich 90°** werden wie in Onshape/Parasolid ab der Fläche gemessen (Face-Offset), nicht wie in OCCT.
6. **Onshape-Probes:** etwa ein Dutzend kleine Probe-Dokumente, gebaut über die Session-Bridge. Die Probe-Dokumente sind öffentlich. Sie decken Overflow-Verhalten, Eckfase, Full Round, Horntorus und gemischte Ecken ab.
7. **Overflow:** zuerst „Notch“ (Blend bleibt, wird getrimmt). Weiterrollen wie in Parasolid kommt später.
8. **Deklarierte Tangentialität** im Hybrid-Boolean darf für Kandidat B gebaut werden.
9. **Kandidat C** (Rolling Ball) tritt als Gegenprobe an. **Kandidat D** (morphologisch) läuft nur bei übrigem Budget.
10. Weitere Punkte:
    - kein stilles Toleranzwachstum, stattdessen die nötige Toleranz melden;
    - eine feste, protokollierte Reihenfolge bei mehreren Kanten;
    - Nahtkanten in der Auswahl werden mit Vermerk ignoriert;
    - „größter machbarer Radius“ als wonky-Erweiterung; die Standard-API bleibt unverändert.

### Weitere Punkte

11. **Composite-Parts in Onshape-Importen:** verweigert wird nur, wenn das Composite wirklich benutzt wird, nicht mehr das ganze Modul.
12. **cad_khana `check()`/`inspect()` beim Bauen:**
    - Standard bleibt ein Abbruch mit Capability-Fehler.
    - Ein Opt-in-Flag vermerkt die Checks im Ergebnis sichtbar als „nicht ausgeführt“.
    - Echte wonky-Checks für Kollision und Abstand folgen später.
13. **`export_step`/`export_stl` in Python-Skripten** schreiben die Dateien wirklich, aus Bend-Geometrie.
14. **Die Recherche** wird nach dem r20-gate gedrosselt wieder aufgenommen (7 von 13 Themen fehlen).

### Bestätigte Entscheidungen des Product Owners

15. Fast kollineare Profilpunkte werden zusammengefasst und mit ihrer Abweichung als `regularized` gekennzeichnet (W2).
16. **Python:**
    - `sys.path` verhält sich wie bei `python modell.py`.
    - Ergebnis-Vertrag: `result` vor `assembly` vor `show()`/Export; wonky rät nie.
    - Paketregel: cad_khana ja, sonst ein klarer Fehler an der Import-Zeile.
17. Onshape-Snapshots binden an die Revision (Element und Mikroversion), nicht an den SHA der Quelldatei.

### Bewusst verschoben

- Lizenz von bend-collections (ungeklärt; die Bibliothek ist deshalb nicht im öffentlichen Repository).
- Freigabe der Laws (`docs/laws.md`).

## 24.09.2026: Korrektur zu Punkt 5 (Fasen), durch Onshape-Probe belegt

Die Absicht bleibt „Fasen wie Onshape“. Die Annahme, Onshape messe ab der Fläche (Face-Offset), war falsch. Belegt hat das die Probe FP-a, die die reference capture in Onshape gebaut hat:
- **EQUAL_OFFSETS:** Onshape trägt den Abstand d entlang jeder Stützfläche ab, als Setback.
  - An einer 120°-Kante mit d = 1 und L = 20 ist ΔV = −20·½·1²·sin 120° = −8,6603 mm³.
  - Die Fasenfläche hat 34,641 mm², also eine Breite von 2·sin 60°.
  - Ein Face-Offset hätte −11,547 mm³ ergeben.
- **Quaderecke, alle drei Kanten mit d = 1** (Probe FP-b): Die Ecke schließt nicht in einem Punkt. Onshape setzt ein kleines gleichseitiges Dreieck ein (Seite √2, 0,866 mm²). Das ergibt 10 ebene Flächen, ΔV = −29,3333 mm³.

wonky bildet genau dieses Verhalten nach. Die Probes liegen unter `~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*/` und sind ab jetzt das primäre Orakel für die 14 zuvor offenen Fillet-Fälle. Onshape baut dort 13 von 14 Fillets; OCCT verweigert 10 davon. Den Fall FP12 verweigert Onshape mit FILLET_FAIL_SMOOTH, also muss wonky ihn ebenfalls verweigern.

## 24.09.2026: cad_khana nativ in wonky (Entwurf `docs/khana.md`)

Marcs Vorgabe vom Vormittag: cad_khana vollständig in wonky integrieren statt als externe Abhängigkeit; die Checks grundlegend überarbeiten und aufs Wesentliche reduzieren, einschließlich Tooling und Design-Styles.

Der Product Owner übernimmt die Empfehlungen aus `docs/khana.md` Abschnitt 9. Jede Entscheidung kann Marc revidieren. Die Punkte mit spürbarer Wirkung auf den Arbeitsablauf:

18. **Unerwartete Überlappungen machen den Bericht rot.** Dadurch werden 7 der 39 gespeicherten Mechanik-Berichte rot. Behoben wird das mit `with_pose`, wo es um Posen geht, und mit Assertions (`within=`), wo die Überlappung gewollt ist.
19. **`SystemExit` bei Fehlschlag bleibt Standard.** Der unifi-Cache hängt daran. Durchlaufen bis zum Ende gibt es mit `--collect`.
20. **Alte Pauschal-Abschaltungen gelten weiter.** Gemeint sind Überhang ab 90° und Wand bis 0,05 mm. Jeder Lauf druckt dazu eine `WAIVED`-Zeile. `--strict` wird Standard, sobald K8b (Brücken) und K9a (Wände) abgenommen sind.
21. **Messerkanten unter 60° scheitern, außer mit Waiver.**
22. **Grenzwerte:**
    - Starter-Druckerprofil übernehmen.
    - Passungen zuerst mit Coupons kalibrieren.
    - Bis dahin melden Passungen „nominell frei, nicht kalibriert“.
23. **Clearance und Passung:**
    - Clearance ist Körperabstand.
    - Die Kontakttoleranz ist eine Länge.
    - Passungen werden auf deklarierten Flächen geprüft (`assert_fit`).
    - Erwartete Überlappungen gelten nur in ihrer Region.
24. **Die übrigen Empfehlungen aus Abschnitt 9 gelten wie dort beschrieben:**
    - JSON-Vertrag 0.2 / `0.2+wonky.1`;
    - Druckziele;
    - Orakel-Reihenfolge;
    - Kegel-Kegel-Abstände in v1 `unresolved`;
    - kein `khana`-Alias bis zum Skill-Umstieg;
    - Ergebnisse in `brep.json`;
    - Dateien bleiben am Ort, dazu ein Lauf-Manifest;
    - API als `Assembly`-Methoden;
    - prismatisches Gelenk und explizite Posen in v1.
25. **Hohlräume** brauchen ein neues Körperformat (K21). Das ist zurückgestellt.
26. **Skills:** `cad-khana` und `cad-fdm-design` bleiben unverändert, bis wonky Marcs Schleife in einer vollen echten Runde ersetzt hat (K20).
