# Doku-Wegweiser

## Lesen nach Aufgabe

| Aufgabe | Einstieg |
|---|---|
| Die App kennenlernen und starten | [README](../README.md), [QUICKSTART](../QUICKSTART.md) |
| Personen und Vermögen pflegen, abschließen oder Ergebnisse lesen | [Handbuch](../Handbuch.html) |
| Browser oder EXE einrichten, aktualisieren und Startfehler beheben | [Einrichtung und Betrieb](guides/EINRICHTUNG_UND_BETRIEB.md) |
| Modell und Aussagegrenzen verstehen | [Fachkonzept](reference/FACHKONZEPT.md), [wissenschaftlicher Rahmen](reference/WISSENSCHAFTLICHER_RAHMEN.md) |
| Code und Datenverträge pflegen | [Technik](reference/TECHNICAL.md), [Datenverträge](reference/DATENVERTRAEGE.md) |

Die Modulreferenzen führen zu [Balance, Übersicht und Ausgaben](reference/BALANCE_MODULES_README.md), [Simulator](reference/SIMULATOR_MODULES_README.md) und [Personen & Vermögen](reference/TRANCHEN_MODULES_README.md). Das [Engine-README](../engine/README.md) erklärt die API; [Entscheidungslogik](reference/ENGINE_DECISION_LOGIC.md) und [Auto-Optimize](reference/AUTO_OPTIMIZE_DETAILS.md) beschreiben die Rechenabläufe. Prüfwege stehen im [Test-README](../tests/README.md).

Fachbelege findest du im [Forschungsregister](reference/FORSCHUNGSABGLEICH_EVIDENZREGISTER.md), im [Marktvergleich](reference/MARKTVERGLEICH.md#ergebnis-in-klartext) mit seinem [Evidenzregister](reference/MARKTVERGLEICH_EVIDENZREGISTER.md) und bei den [Datenquellen](reference/DATA_SOURCES.md). Preis- und Funktionsstand des Marktvergleichs sind datiert; das Register nennt die Prüftermine. [CHANGELOG](../CHANGELOG.md) und [Lizenz](../LICENSE.md) stehen im Hauptordner.

## Ordner

- `guides/` führt durch Einrichtung und Betrieb. Bedienaufgaben gehören ins Handbuch.
- `reference/` erklärt Architektur, Module, Daten und Fachgrundlagen.
- `design/` enthält das [Designsystem](design/designsystem.md) und das [Funktionsinventar](design/funktionsinventar.md).
- [ui/](ui/README.md) enthält Handbuchbilder, Bildmanifest und die Abläufe für Monats- und Jahresabschluss.

Die [lokalen Schriften und Symbole](../assets/README-schriften-symbole.md) sind bei den Assets beschrieben. [Dev-Skripte](../scripts/dev/README.md) dienen einzelnen Analysen und gehören nicht zur App-Laufzeit.

## Doku pflegen

Ändere Inhalte an ihrem Hauptort in dieser Gliederung, statt Abschnitte anzuhängen. Schreibe kurze, konkrete Sätze und sprich Nutzer mit „du“ an. Prüfe Aussagen gegen den Code und lies jede fertige Datei in einer eigenen Runde auf Stil gegen. Führe `npm run docs:pruefen` aus; behebe Warnungen oder begründe sie einzeln im Ergebnisbericht. Die Arbeitsregeln stehen in [AGENTS.md](../AGENTS.md#doku).

Das Inventar wird aus [funktionsinventar.json](design/funktionsinventar.json) erzeugt. Pflege seine Lesefassung über den [Generator](../scripts/generate-funktionsinventar.mjs); die [Schutzprüfungen](../tests/README.md#schutzprüfungen) müssen grün bleiben.

Erneuere die App-Bilder mit `npm run docs:bilder`. Das [Bildverzeichnis](ui/README.md#bilder-erneuern) beschreibt Voraussetzungen, feste Testdaten und die Sichtprüfung.
