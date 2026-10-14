# CHANGELOG

## Aktuelle Fassung

Stand 13. Oktober 2026.

Balance und Simulator zeigen die drei Bedarfswerte offen; weitere Einstellungen liegen unter Alle Parameter. Personen & Vermögen bündelt Tagesgeld, Nettorente und sonstige Einkünfte unter Auf einen Blick sowie die übrigen Planfelder unter Weitere Planwerte. Tagesgeld speichert beim Verlassen oder mit Enter; die Karte Simulator-Werte zurücksetzen entfällt. Handbuchbilder und Texte zeigen die neue Bedienung.

### App-Namen und Desktop-Build

Seit 13.10.2026 heißen Repository und Windows-Build-Ordner `VermoegenUndRuhestand`; der alte Repo-Pfad bleibt als Symlink erreichbar. Der Entwickler-Build heißt „Vermögen & Ruhestand Entwicklung“, erzeugt `vermoegen_und_ruhestand.exe` und verwendet `de.vermoegen-ruhestand.entwicklung`. Prüfkandidaten heißen `VermoegenUndRuhestand_KANDIDAT_<datum>_<commit>.exe` und nutzen `de.vermoegen-ruhestand.entwicklung.kandidat`.

Der Windows-Produktivbau nutzt die Release-Konfiguration und erzeugt `VermoegenUndRuhestand.exe` mit dem Produktnamen „Vermögen & Ruhestand“. Seine Kennung `de.vermoegen-ruhestand.suite` und die gespeicherten Daten bleiben erhalten. Die frühere `RuhestandSuite.exe` behält ihren Datenbereich `com.dieter.ruhestandsapp`; ein Bau mit dieser Kennung braucht ausdrücklich `-AltApp`.

### Übersicht und Navigation

- Die Übersicht beginnt mit dem nächsten Arbeitsschritt sowie Kennzahlen für Vermögen, Monatsbudget und Plan. Der Vermögensverlauf steht als eigene Karte daneben. Erledigte Abschlussschritte lassen sich wieder öffnen; der Startknopf steht im Kartenkopf.
- Haushalts- und Seitenstatus stehen im gemeinsamen Kopf. Die Seitenleiste lässt sich über den Knopf direkt oberhalb der Übersicht einklappen und wieder öffnen. Seitenaktionen stehen beim Titel; Ausgaben und Daten & Sicherung behalten ihre Arbeitsbereiche.
- Personen & Vermögen zeigt die Personenreiter vor den Karten. Haushalt & Plan zeigt Vermögenskarten und die offene Bedarfszeile. Die Personendetails starten geschlossen; vom Kopf der Personenansicht kannst du zum Depot springen. Hinweise zum Verlauf stehen hinter den jeweiligen Info-Knöpfen, Warnungen zur Datenqualität bleiben sichtbar.

### Balance und Abschlüsse

- Balance stellt Monatsbudget und Handlungsanweisung dichter zusammen. Hilfe ist über einen Symbolknopf erreichbar. Festgeschriebener Plan, aktuelle Vorschau und Diagnose bleiben getrennt lesbar.
- Bei gekürztem Monatsbudget erklärt der Warum-Knopf die tatsächlichen Monatswirkungen als aufklappbare Treppe. Anhebungen erscheinen als Plusbeträge. Der Grundhinweis nennt die Kürzungsregel; die Marktphase steht in der Marktkarte. Ohne Kürzung zeigt die Karte Vollfinanzierung. Nach einer neuen Berechnung ist die Erklärung wieder geschlossen.
- Monats- und Jahresabschluss behalten den Dialog nach einem Teilimport geöffnet. Im Budgetvergleich stehen bereits die übernommenen Teilbeträge. Der Abschlussknopf wird erst nach den erforderlichen Besuchen und Bestätigungen freigegeben.
- Die Jahresvorbereitung umfasst sechs Schritte. Nach dem Speichern zeigt das Ergebnis die verbindliche Handlungsanweisung, den Planstand und die Monatszusammenfassung. Einen fehlgeschlagenen Monatsschritt kannst du erneut abschließen; die Wiederherstellungspunkte für Jahr und Monat bleiben getrennt.
- Beispielimporte in Ausgaben, Abschlussdialogen und Übersicht nutzen kompakte Kopierknöpfe mit erklärenden Tooltips. Der Sammelknopf heißt „Beispiele für alle“.

### Simulator und Daten

- Die Ergebnisansicht zeigt die beiden Monte-Carlo-Kernantworten neben dem Backtest. Die drei Backtestkennzahlen stehen kompakter zusammen; Angaben zur historischen Abdeckung findest du im Info-Feld.
- Im Jahresprotokoll steht „Niedrige Entnahme“ an der Entnahme, wenn eine gültige zugehörige CaR-Schwelle unterschritten wird. Der Hinweis erklärt den Vergleich. Aktien-, Gold- und Bondverkäufe erscheinen neutral, Käufe hervorgehoben. JSON- und CSV-Downloads behalten ihren Inhalt.
- Wenn ein Haushalt wirksam gewechselt wird, verwirft der Simulator das vorherige Ergebnis und seine Exporte. Das gilt auch, wenn die neuen Personendaten ungültig sind. Nach einem vollständigen Verkauf verwendet der historische Backtest das leere Depot statt erneut die Starttranchen.
- Wenn ein Balance- oder Vollimport scheitert, zeigt Daten & Sicherung einen bereits angelegten Wiederherstellungspunkt sofort an. Die Fehlermeldung bleibt sichtbar.

## Frühere Fassungen

### Browserstart und Desktop-Build

Stand 24. September 2026.

Der Browserstart läuft über `npm run serve`, unter Windows auch per `start_suite.cmd`. Webserver und Yahoo-Kursdienst laufen in einem Node.js-Prozess und enden gemeinsam. Für die Browserfassung ist Node.js erforderlich.

Damals erstellte `npm run build:desktop` die Entwickler-EXE `ruhestand_suite.exe` über `sync-dist` und den Tauri-Build im Datenbereich der früheren RuhestandSuite. Die Namen und Entwicklerkennung wurden am 13.10.2026 ersetzt. Die Oberfläche stammt aus einem Git-Commit. Das Paket enthält die Laufzeitdateien einschließlich Handbuch und CHANGELOG; weitere Markdown-Dokumente, Tests und Datenquelldateien werden nicht mitgeliefert. Die verwendeten historischen Reihen liegen in den App-Modulen.

Die Windows-EXE wird lokal gebaut und ist nicht mehr im Repository enthalten. Frühere Start- und Buildhilfen wurden durch die genannten Wege ersetzt. Voraussetzungen und Speicherorte stehen in [Einrichtung und Betrieb](docs/guides/EINRICHTUNG_UND_BETRIEB.md).

### Monte-Carlo und Stresspfade

Stand 17. August 2026.

Monte-Carlo hat einen sichtbaren Laufstatus und getrennte Ergebnisansichten für Überblick, Risiko und Verteilung, Pflege und Szenario-Logs. Im Stresspfad-Replay wählst du einen Pfad und vergleichst Varianten anhand von Kennzahlen, Unterschieden und Jahreswerten. Der Vergleich gilt für diesen Pfad und liefert keine allgemeine Strategieempfehlung.

### Steueranzeige und Verlusttopf

Stand 15. Februar 2026.

Verluste aus Verkäufen werden im Verlusttopf in die Folgejahre übernommen und bei späteren Verkäufen verrechnet. Die Steuer wird für das Jahr gemeinsam abgerechnet, auch nach zusätzlichen Notfallverkäufen im Simulator. Balance zeigt die endgültige Steuer mit der Aufschlüsselung vor und nach Verlustverrechnung. Simulatorprotokolle weisen den Verlusttopf und die daraus entstandene Steuerersparnis aus.
