# Vermögen & Ruhestand

## App und Grenzen

### Zweck

Vermögen & Ruhestand plant Entnahmen für Einzelpersonen und Paare. Du erfasst Personen, Einkünfte und Bestände, prüfst das Jahresbudget und vergleichst den Plan mit historischen Jahren oder erzeugten Zukunftspfaden. Die App läuft lokal im Browser oder als Windows-EXE.

| Arbeitsbereich | Aufgabe |
| --- | --- |
| [Übersicht](index.html) | Monatsbudget, Vermögen und nächste Abschlüsse sehen. |
| [Personen & Vermögen](depot-tranchen-manager.html) | Personen, Einkünfte, Depot, Immobilien und Haushaltsplan pflegen. |
| [Ausgaben](Ausgaben.html) | Monatsausgaben je Person importieren, nach Floor und Flex lesen und mit dem Budget vergleichen. |
| [Balance](Balance.html) | Monatsbudget, „Was zu tun ist“ mit dem Stand des Jahresplans, Reserven und Diagnose lesen. |
| [Simulator](Simulator.html) | Historische Pfade, Monte Carlo und Varianten rechnen; heutige Pflegekosten automatisch aus Staffel und Heimjahr ergänzen. |
| [Daten & Sicherung](Daten-Sicherung.html) | Haushalte, Vollsicherungen, Wiederherstellungspunkte und Datenstatus verwalten. |

„Erst ausprobieren – mit Max und Erika“ auf der leeren Übersicht startet mit Spielkursen am 23.10.2026 und 790.000 € Gesamtvermögen, auch ohne Kursdienst. Im Startdialog bieten Beispielhaushalte ausschließlich Spielkurse; bei „Kopie meiner Daten“ kannst du auch echte Kurse von heute wählen.

Eine Installation kann mehrere getrennte Haushalte führen, etwa den eigenen und den eines erwachsenen Kindes. Den geöffneten Haushalt zeigt und wechselt der Umschalter oben links; jeder Haushalt hat eigene Daten, Sicherungen und einen eigenen Spielbereich.

Ein Haushalt besteht aus einer oder zwei Personen. Balance empfiehlt Entnahmen und Umschichtungen; du entscheidest über die Umsetzung, führst Geschäfte selbst aus und pflegst tatsächliche Bestände nach. Monats- und Jahresabschluss halten Tagesgeld, Marktdaten und Plan fest. In Balance zeigt die Karte „Was zu tun ist“ den Plan aus dem Jahresabschluss, wie weit du ihn umgesetzt hast, und eine Vorschau auf den nächsten Plan; daneben stehen deine Reserven. Das Jahreshoch erscheint nur bei einem verdeckten Bärenmarkt. Dann wählst du im Jahresabschluss die Lesart; [Jahresbudget](docs/reference/JAHRESBUDGET.md) erklärt beide. Simulationen rechnen mit Jahresendständen, Fondskosten auf Aktien, der Kohortensterbetafel des Geburtsjahrgangs und vereinfachten Steuer-, Pflege- und Erbannahmen. Sie garantieren keine künftige Finanzierung.

### Keine Beratung

Die App ist ein privates Planungswerkzeug und keine Anlage-, Steuer- oder Rechtsberatung. Handlungsanweisungen sind Rechenergebnisse aus deinen Eingaben und vereinfachten Annahmen; ob und wie du sie umsetzt, entscheidest du selbst.

### Geldvermögen und Immobilien

Gesamtvermögen umfasst Geldvermögen und Immobilien. Entnahme, Deckung und Ruin beziehen sich auf Geldvermögen. Immobilien können im Modell verkauft oder vererbt werden; ihre Bewertung ist keine Marktpreisprognose.

Die Daten bleiben im lokalen Speicher der gewählten Laufzeit. Browser, EXE und verschiedene Browseradressen teilen keinen Bestand. Eine Vollsicherung überträgt den geöffneten Haushalt beim Wechsel und schützt vor Verlust des App-Speichers. [Sicherung](docs/reference/SICHERUNG.md) erklärt Vollsicherung, Wiederherstellungspunkte und Aufbewahrung.

## Starten

### EXE

Öffne die bereitgestellte `VermoegenUndRuhestand.exe`. Windows benötigt WebView2. Ein getrennter Server oder Node.js ist für die EXE nicht erforderlich.

### Browser

Du brauchst den vollständigen Projektordner und Node.js. Unter Windows öffnest du [start_suite.cmd](start_suite.cmd); sonst startest du im Projektordner:

```sh
npm run serve
```

Öffne `http://localhost:8000/index.html` und lass das Serverfenster offen. Direkt angeklickte HTML-Dateien reichen nicht. Gespeicherte Daten, Handbuch, Themenseiten und Simulationen mit mitgelieferten Reihen funktionieren offline; neue Kurse benötigen Internet.

## Weiterlesen

### Bedienung

Der [QUICKSTART](QUICKSTART.md) führt mit einem Beispiel zur ersten eigenen Sicherung. Das [Handbuch](Handbuch.html) erklärt Klickwege, Abschlüsse und Ergebnisse. [Einrichtung und Betrieb](docs/guides/EINRICHTUNG_UND_BETRIEB.md) hilft bei Installation, Update und Startfehlern.

### Themen

Der [Doku-Wegweiser](docs/README.md) führt zu Budget, Handlungsanweisung, Pflege, Erbe, Immobilien und Simulationsergebnissen. [CHANGELOG](CHANGELOG.md) hält datierte Änderungen fest.

### Entwicklung

Die App verwendet native ES-Module und Tauri. [TECHNICAL](docs/reference/TECHNICAL.md) erklärt Architektur, [Modulaufbau](docs/reference/TECHNICAL.md#modulaufbau), Diagnose, Selbstbau und Auslieferung; [package.json](package.json) enthält die Befehle. Die EXE wird lokal gebaut und liegt nicht im Repository.

## Lizenz

### Code

Der Programmcode steht unter der [MIT-Lizenz](LICENSE.md). Lizenztext, npm-Paketmetadaten und Tauri-/Cargo-Metadaten weisen das Projekt einheitlich als `MIT` aus.

### Daten

Mitgelieferte Forschungsdaten haben eigene Bedingungen, darunter CC BY-NC-SA 4.0 für die globale Aktienreihe. [Datenquellen](docs/reference/DATA_SOURCES.md) und [Datenlizenz](data/historical/global-equity-research-chain/LICENSE.md) nennen Herkunft und Nutzungsgrenzen. Die MIT-Lizenz des Codes hebt diese Bedingungen nicht auf.
