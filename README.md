# Vermögen & Ruhestand

## App und Grenzen

### Zweck

Vermögen & Ruhestand plant Entnahmen für Einzelpersonen und Paare. Du erfasst Personen, Einkünfte und Bestände, prüfst das Jahresbudget und vergleichst den Plan mit historischen Jahren oder erzeugten Zukunftspfaden. Die App läuft lokal im Browser oder als Windows-EXE.

| Arbeitsbereich | Aufgabe |
| --- | --- |
| [Übersicht](index.html) | Monatsbudget, Vermögen und nächste Abschlüsse sehen. |
| [Personen & Vermögen](depot-tranchen-manager.html) | Personen, Einkünfte, Depot, Immobilien und Haushaltsplan pflegen. |
| [Ausgaben](Ausgaben.html) | Jahreskennzahlen, Monatsimporte und Kategorien lesen; darunter Floor/Flex mit aufklappbaren Monatswerten und gestapelten Jahressäulen. Die Lupe zeigt die importierte Aufteilung auch je Person. |
| [Balance](Balance.html) | Monatsbudget, kompakte Handlungsanweisung mit Details und Reserven heute und nach Umsetzung lesen. |
| [Simulator](Simulator.html) | Historische Pfade, Monte Carlo und Varianten rechnen. |
| [Daten & Sicherung](Daten-Sicherung.html) | Vollsicherungen, Wiederherstellungspunkte und Datenstatus verwalten. |

Wiederherstellungspunkte zeigen „Punkt löschen …“ nur bei aktuell erlaubter Löschung; sonst steht der Aufbewahrungsgrund am Punkt. Rückholpunkte vor Import, Zurückholen und Spielbereich folgen nach 30 Tagen der monatlichen Aufbewahrung je Art und Umfang. Dauerpunkte und benötigte Punkte bleiben. [Aufbewahrung und Rückwege](docs/reference/SICHERUNG.md#wiederherstellungspunkt) erklärt die Grenzen.

Ein Haushalt besteht aus einer oder zwei Personen. Balance empfiehlt Entnahmen und Umschichtungen; du entscheidest über die Umsetzung und pflegst tatsächliche Bestände nach. Die heutige Vorschau nutzt den letzten gespeicherten VWCE.DE-Tagesschluss wie einen Jahresendkurs. „Budgetprüfung für ‹Zieljahr›“ bereitet das Folgejahr mit Inflation, Rentenbeginn und geplanten Posten auf einer Kopie vor. Sie zeigt den Abstand zum Jahreshoch abgestuft als ruhig, Hinweis oder Warnung und nennt bei fehlender Belastbarkeit den Grund. Kurslinie und Tabellen erklären die beiden Lesarten. Bei verschiedenen Budget- oder Verkaufsfolgen wählst du im Jahresabschluss ohne Vorauswahl zwischen Jahresendregel und Jahreshoch. Die Hochwahl speichert Wert, Datum und Alter auch für Folgejahre; ohne sie bleibt der bisherige Speicherpfad erhalten. Die Übersicht behält bis zum Abschluss die Jahresbasis. Simulationen verwenden weiterhin Jahresendstände und vereinfachte Steuer-, Pflege- und Erbannahmen. Sie garantieren keine künftige Finanzierung.

Monats- und Jahresabschluss öffnen ein mittiges Fenster mit Reitern. „Weiter“ steht unten rechts; nur der aktuelle Inhalt scrollt. Im Jahresabschluss folgen auf Tagesgeld die Pflegewerte, Marktdaten und der Plan.

### Geldvermögen und Immobilien

Gesamtvermögen umfasst Geldvermögen und Immobilien. Entnahme, Deckung und Ruin beziehen sich auf Geldvermögen. Immobilien können im Modell verkauft oder vererbt werden; ihre Bewertung ist keine Marktpreisprognose.

Die Daten bleiben im lokalen Speicher der gewählten Laufzeit. Browser, EXE und verschiedene Browseradressen teilen keinen Bestand. Eine Vollsicherung überträgt ihn beim Wechsel und schützt vor Verlust des App-Speichers.

Seitenlinks und das X der EXE warten das Speichern ab. Kann eine Eingabe nicht gespeichert werden, zeigt die App den Grund und fragt vor dem Verlassen nach. „Trotzdem“ verwirft diese Eingabe; bereits übernommene Werte werden weiter gespeichert. Scheitert das Speichern, bleibt die Seite mit einer Meldung offen. Nach einer Rückkehr über „Zurück“ bleibt eine veraltete Seite bis zum Neuladen gesperrt, auch nach „Bleiben“. Der Hinweis bietet „Jetzt neu laden“.

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

Alle Beispielhaushalte enthalten Ausgaben mit Floor/Flex. Bei Max und Erika führt die Steckbriefübung vom Floor über Plan zum Ist-Vorschlag im Jahresabschluss.

Der [QUICKSTART](QUICKSTART.md) führt mit einem Beispiel zur ersten eigenen Sicherung. Das [Handbuch](Handbuch.html) erklärt Klickwege, Abschlüsse und Ergebnisse. [Einrichtung und Betrieb](docs/guides/EINRICHTUNG_UND_BETRIEB.md) hilft bei Installation, Update und Startfehlern.

### Themen

Der [Doku-Wegweiser](docs/README.md) führt zu Budget, Handlungsanweisung, Pflege, Erbe, Immobilien und Simulationsergebnissen. [CHANGELOG](CHANGELOG.md) hält datierte Änderungen fest.

### Entwicklung

Die App verwendet native ES-Module und Tauri. [TECHNICAL](docs/reference/TECHNICAL.md) erklärt Architektur, Module, Diagnose, Selbstbau und Auslieferung; [package.json](package.json) enthält die Befehle. Die EXE wird lokal gebaut und liegt nicht im Repository.

Der [Modulaufbau](docs/reference/TECHNICAL.md#modulaufbau) beschreibt Fassaden, gleichnamige Unterordner, Importgrenzen und den gemeinsamen Zustand.

`app/balance/balance-expenses.js` erhält die Ausgabenzugänge. Der gleichnamige Unterordner trennt Zustand, Speicherhilfen, Recovery, Darstellung, Monatsaktionen und Ereignisbindung; [Balance und Abschluss](docs/reference/TECHNICAL.md#balance-und-abschluss) beschreibt die Zuständigkeiten.

`app/simulator/stress-replay-ui.js` und `app/balance/balance-renderer-action.js` erhalten die Zugänge für Stresspfad und Handlungsanzeige. Ihre Unterordner trennen Controller, Darstellung und Aktionen; [Simulator und Worker](docs/reference/TECHNICAL.md#simulator-und-worker) und [Balance und Abschluss](docs/reference/TECHNICAL.md#balance-und-abschluss) ordnen die Module zu.

`app/simulator/simulator-profile-inputs.js` und `app/profile/profilverbund-balance.js` erhalten die Zugänge für Profil- und Haushaltsprojektionen. Ihre Unterordner trennen Eingabeleser, Pflegequellen, Tranchen, Aggregation und Auszahlungsverteilung. [Projektionen für Balance und Simulator](docs/reference/TECHNICAL.md#projektionen-für-balance-und-simulator) ordnet die Module zu.

Die Fassaden für Profilverbund, Handlungsanzeige und historischen Datenvertrag erhalten auch ihre früheren direkten Ladeabhängigkeiten. So verschiebt die Zerlegung den Start der Kurs- und Verlaufsjobs auf der Übersicht nicht durch zusätzliche Ladestufen. [Modulaufbau](docs/reference/TECHNICAL.md#modulaufbau) beschreibt diese Re-Exporte.

Die Speicherzugänge bleiben unter `app/shared/persistence-facade.js`, `app/shared/persistence-backup.js` und `app/profile/profile-storage.js`. Ihre Implementierungen liegen nach Zuständigkeit in den gleichnamigen Unterordnern; [Speicher und Schreibgrenzen](docs/reference/TECHNICAL.md#speicher-und-schreibgrenzen) und [Personen und Depot](docs/reference/TECHNICAL.md#personen-und-depot) ordnen die Module zu.

`app/balance/balance-binder-imports.js` erhält die bisherigen Import-/Exportzugänge. Der gleichnamige Unterordner trennt Eingabevertrag, Prüfung, Migration, Dateiformate, historische CSV-Verarbeitung und UI-Handler; [Balance und Abschluss](docs/reference/TECHNICAL.md#balance-und-abschluss) nennt die Zuständigkeiten.

`app/tranches/tranchen-manager-page.js` erhält den Einstieg für Personen & Vermögen. Im gleichnamigen Unterordner teilen sich Darstellung, Eingaben, Speicherung, Dialogaktionen und Navigation einen Seitenzustand; [Personen und Depot](docs/reference/TECHNICAL.md#personen-und-depot) beschreibt die Aufrufgrenzen.

`app/profile/profilverbund-action-attribution.js` und `app/tranches/tranche-reconciliation.js` erhalten die bisherigen Zugänge für persönliche Aktionszuordnung und tatsächliche Verkäufe. Die gleichnamigen Unterordner trennen Verkaufsplanung, Steuerzuordnung, Verlauf, Vorschau und Speicherung; [Balance und Abschluss](docs/reference/TECHNICAL.md#balance-und-abschluss) und [Personen und Depot](docs/reference/TECHNICAL.md#personen-und-depot) beschreiben die Grenzen.

`engine/core.mjs` bündelt die bisherigen Engine-Exporte. Die Jahresrechnung, Eingabenormalisierung, Steuer- und Flussprüfung liegen unter `engine/core/`; [Engine-Module](engine/README.md#module) beschreiben die Zuständigkeiten. `app/simulator/simulator-engine-direct.js` bündelt die Simulator-Exporte; die Jahresphasen liegen im gleichnamigen Unterordner. [Simulator und Worker](docs/reference/TECHNICAL.md#simulator-und-worker) ordnet sie zu.

`app/simulator/monte-carlo-runner.js` und `monte-carlo-chunk-result.js` erhalten die bisherigen Monte-Carlo-Zugänge. Lauf, Jahresphasen und Pfadabschluss sowie Chunkverträge, Prüfung und Zusammenführung liegen in den gleichnamigen Unterordnern. `mc-year-sampling.js` bündelt Konfiguration, Startjahrziehung, Jahresziehung und Diagnostik; `monte-carlo-export.js` die Lauf- und Szenarioexporte. Auch ihre Implementierungen liegen in gleichnamigen Unterordnern. Hauptthread und Worker verwenden dieselben Module; Zufallsfolge und Exportformate bleiben erhalten.

`app/simulator/simulator-monte-carlo.js` erhält die Zugänge für Start, Abbruch und Protokollnachläufe; sein Unterordner trennt Laufzustand, seriellen Lauf, Worker und UI-Ablauf. `results-metrics.js` bündelt die Anzeigeprojektionen aus seinem Unterordner für Zusammenfassung, Mindest-Flex, Dashboard, Stress und Pflege. Rundung und Reihenfolge der Kennzahlen bleiben erhalten.

`app/simulator/historical-backtest-contract.js` und `historical-backtest-runner.js` erhalten die bisherigen Backtest-Zugänge. Ihre Unterordner trennen Datenprüfung, Jahresrecords, Periodenvorprüfung und Provider-Cache sowie Laufstart, Jahresrechnung und Ergebnisaufbereitung. [Simulator und Worker](docs/reference/TECHNICAL.md#simulator-und-worker) beschreibt den Modulbesitz.

`app/balance/balance-next-year-budget.js` berechnet den Folgejahresplan als lesenden Jahresentwurf mit heutigen Beständen und ausgewiesenen Annahmen. Budgetkarte, Budgetprüfung und vorläufige Empfehlung nutzen denselben Entwurf. „Bedarf & Strategie“, Reserven und Diagnose verwenden die Werte des laufenden Planjahrs; Eingaben und Speicherung bleiben beim laufenden Plan. Scheitert die Projektion, nennt die Budgetprüfung den Grund und die bisherige Vorschau bleibt verfügbar. [Technischer Vertrag](docs/reference/TECHNICAL.md#balance-und-abschluss).

`app/simulator/monte-carlo-contracts.js` bündelt die Request- und Ergebnisverträge; `sweep-runner.js` die Parameterreihen. Ihre gleichnamigen Unterordner trennen Vertragsprojektion und Prüfung bzw. Eingaben, Einzelpfade, Diagnosen und Ausführung. Die bisherigen Importpfade bleiben erhalten.

`app/simulator/stress-replay-contract.js`, `simulation-data-inventory.js` und `german-gross-wage-growth-chain.js` erhalten die bisherigen Daten- und Replayzugänge. Die gleichnamigen Unterordner trennen Vertragsprüfungen, Inventarklassen und erzeugte Lohnreihen; [Simulator und Worker](docs/reference/TECHNICAL.md#simulator-und-worker) nennt die Zuständigkeiten.

`npm test` enthält die [Typprüfung und Ratschen](docs/reference/TECHNICAL.md#typprüfung) für alle Quellmodule. `npm run check:types` prüft auch neue Dateien automatisch; JavaScript bleibt ohne zusätzlichen Bauschritt ausführbar.

## Lizenz

### Code

Der Programmcode steht unter der [MIT-Lizenz](LICENSE.md). Lizenztext, npm-Paketmetadaten und Tauri-/Cargo-Metadaten weisen das Projekt einheitlich als `MIT` aus.

### Daten

Mitgelieferte Forschungsdaten haben eigene Bedingungen, darunter CC BY-NC-SA 4.0 für die globale Aktienreihe. [Datenquellen](docs/reference/DATA_SOURCES.md) und [Datenlizenz](data/historical/global-equity-research-chain/LICENSE.md) nennen Herkunft und Nutzungsgrenzen. Die MIT-Lizenz des Codes hebt diese Bedingungen nicht auf.
