# CHANGELOG

## Aktuelle dokumentierte Fassung

Stand 12. November 2026.

### Was sich an deinen Zahlen ändert

- Erfolgsquoten im Simulator sinken. Die App rechnet mit einer längeren Lebenserwartung, simuliert bis zum Alter 110 und zieht Fondskosten von der Aktienrendite ab.
- Mit Dynamic Flex sinkt das Monatsbudget in Balance und Simulator. Fondskosten mindern die erwartete Rendite, und der längere Horizont verteilt das Vermögen auf mehr Jahre.
- Gespeicherte Rentenanpassungen bleiben, wie sie sind. Wer „wie Löhne“ eingestellt hat, rechnet weiter damit und sieht dazu einen Hinweis.
- Ergebnisse, die vor dieser Fassung gerechnet wurden, zeigt die Übersicht einmal als veraltet. Ein Backtest ohne Dynamic Flex bleibt gültig.

### Balance

- Die Karte „Was zu tun ist“ ersetzt im Überblick Handlungsanweisung, Budgetprüfung und Marktphase. Sie zeigt oben den Plan aus dem Jahresabschluss mit Stand je Zeile: „Offen“, „Teilweise erledigt“ oder „Erledigt“. Der Stand kommt aus den eingetragenen Verkäufen seit dem Beschluss.
- „Verkauf eintragen“ öffnet den Verkaufsdialog mit der Tranche der Planzeile. Fehlt zu einem Verkauf die Gutschrift aufs Tagesgeld, steht dort „Gutschrift nachtragen“.
- Deckt das Tagesgeld weniger als sechs Monate Entnahme und ist kein Planverkauf offen, schlägt die Karte „Tagesgeld auffüllen“ vor, bei Paaren je Person.
- Unten in der Karte steht zugeklappt „Vorschau auf den Plan ‹Jahr›“: der Plan, den der nächste Jahresabschluss beschließen würde.
- Den Abstand zum Jahreshoch zeigt die App nur noch bei einem verdeckten Bärenmarkt, also wenn gemessen am Jahreshoch der Flex gekürzt würde, nach Kursen zum Jahresende aber nicht. Kleinere Abstände entfallen. Sind die Kurse zu alt oder lückenhaft, steht dort eine Zeile mit dem Weg zu frischen Kursen; in den ersten zehn Tagen nach dem Jahresende fehlt sie, solange kein neuer Kurs da ist.
- „Deine Reserven“ steht rechts unter „Was zu tun ist“. „nach Umsetzung“ zählt nur den Teil der Anweisung, den du noch nicht als Verkauf eingetragen hast. Die Marktphase steht unter „Diagnose“.
- Fehlt nur der Betrag, den die Abrundung der Monatsentnahme weglässt, gilt der Flex als voll finanziert. Die App meldet dann keine Kürzung; der Abschlussbeleg nennt die Rundung.

### Jahresabschluss

- Der Schritt „Plan“ zeigt, wie weit der alte Plan umgesetzt ist, und den neuen Plan als Karte „Was zu tun ist“.
- Den Vergleich mit dem Jahreshoch gibt es nur noch bei einem verdeckten Bärenmarkt. Dann wählst du im Schritt „Plan“ ohne Vorauswahl zwischen „Nach Kursen zum Jahresende“ und „Mit dem Jahreshoch vom …“. Sonst gilt die Jahresendregel ohne Rückfrage.

### Planwerte

- Neue Personen und Beispiele starten mit der Rentenanpassung „wie Inflation“. „wie Löhne“ bleibt wählbar; ein Hinweis erklärt, warum die Lohnreihe als Rentenannahme optimistisch ist.
- „Laufende Kosten Aktien-ETF“ ist ein Planwert in Haushalt & Plan unter „Weitere Planwerte › Fondskosten“, vorbelegt mit 0,5 % pro Jahr. Backtest und Monte Carlo ziehen ihn jedes Jahr von der Aktienrendite ab; Gold und Geldmarkt bleiben ohne Abschlag. Mit Dynamic Flex mindert er auch die erwartete Rendite. Im Simulator probierst du einen anderen Wert mit „Nur hier ausprobieren“ aus.
- Feste geplante Ausgaben, etwa eine Kreditrate oder eine Versicherung bis Rentenbeginn, zählen wieder in ihren Monaten zum Grundbedarf. Simulator, Monte Carlo und Backtest kürzen sie nie; die Balance rechnet sie ins Jahresbudget, und das Monatsbudget steigt in diesen Monaten um den Betrag. Ausgaben-Seite, Monatsabschluss und Überblick zeigen diesen Monatswert, der Floor/Flex-Vergleich zählt sie zum Grundbedarf. Einmalige geplante Ausgaben bleiben außerhalb des Budgets, mit Reserve und Zuordnung im Import.
- Übergang: Ein Jahresplan, der vor dem 11.11.2026 beschlossen wurde, behält bis zum nächsten Beschluss seine alte Bedeutung. Sein Monatsbudget bleibt gleichmäßig, und der Import bietet feste Ausgaben in diesem Jahr weiter zur Zuordnung an.
- Der Kostenanstieg der Pflege heißt überall „Inflation + …“.

### Lebenserwartung und Pflege

- Monte Carlo und Planungshorizont rechnen mit der Kohortensterbetafel V2 des Statistischen Bundesamts für den Geburtsjahrgang jeder Person. Vorher galt die Periodentafel 2023/2025; sie dient jetzt nur noch der Pflegeabstimmung. Für 60- bis 70-Jährige liegt die Lebenserwartung dadurch 0,7 bis 1,6 Jahre höher.
- Wer heute ohne Pflegegrad ist, lebt im Modell im Mittel so lange wie die Tafel, auch mit gezogenem Pflegefall. Ein eingetragener Pflegegrad verkürzt das Leben, auch mit langsamerem Verlauf.
- Pflegeeintritt und Gradfortschritt sind auf die neue Sterblichkeit abgestimmt. Menschen in Pflege leben im Modell länger, ein Pflegefall dauert deshalb länger als vorher.
- „Maximale Dauer“ in Monte Carlo ist leer und damit automatisch: bis die jüngste Person 110 wäre. Eine gespeicherte 35, die frühere Vorgabe, gilt als automatisch. Auch Auto-Optimize rechnet mit dieser Dauer statt fest mit 35 Jahren.

### Beispiele

- Neue Variante „Plan teilweise umgesetzt“ bei Max und Erika: Sie zeigt den Stand eines halb erledigten Jahresplans und „Gutschrift nachtragen“. Die Variante „Markt erst heiß, dann Rückgang“ führt jetzt zum verdeckten Bärenmarkt im Jahresabschluss.
- Renate hat Übungen zur Rentenanpassung und zu den Fondskosten.

## Frühere Fassungen

### Pflege, Haushalte und Abschlüsse

Stand 11. November 2026.

#### Pflege

- Personen & Vermögen › Pflege zeigt eine frühere Flex-Vorgabe 75 / 25 / 10 / 0 / 0 % wie der Simulator als 100 / 100 / 50 / 0 / 0 % und speichert eine Änderung samt dieser Staffel. Der Simulator schreibt beim Öffnen mit „Amtlicher Durchschnitt“ nichts mehr.
- Regionaler Zuschlag und Flex-Level je Grad stehen jetzt ebenfalls in Personen & Vermögen › Pflege, weil auch Balance mit ihnen rechnet. Der Simulator nennt sie in der Zeile „Pflegewerte“ und behält unter Annahmen nur Verlauf, Dauer, Anstiegsdauer und Sterblichkeit je Grad. Gespeichert und gerechnet wird wie bisher.
- Neuer Reiter „Pflege“ in Personen & Vermögen neben Haushalt & Plan: Pflege heute je Person mit angesetztem Monatsbetrag und Link zur Personenkarte, Staffel zu Hause je Grad mit üblicher Form, Deckel, Kostenanstieg, Heim-Bestandteile und Heimjahre, eigene Ausgaben im Heim, Pflegegeld und Preisstand. Der Simulator zeigt diese Werte unter Annahmen › Pflege nur noch in einer Zeile mit Link und behält Verlauf und Simulationsannahmen. Gespeichert und gerechnet wird wie bisher. Der Kopftext „Pflegegrad heute …“ bricht im Simulator um und läuft nicht mehr unter den Schalter.
- Grundbedarf und Flex beschreiben den Haushalt ohne Pflege. Simulator, Backtest und Balance rechnen heutige Pflege selbst: Staffel zu Hause ohne Anlaufphase, Heimkosten nach Heimjahr aus „Im Heim seit“, eigene Ausgaben im Heim, Flex nach dem Pflege-Level, Pflegegeld nach dem Angehörigenausfall. Das Monatsbudget zeigt je Person eine Zeile „Pflege“ oder „Heim“.
- Der Jahresabschluss schreibt Staffel, Deckel, Heim-Bestandteile und eigene Ausgaben im Heim mit der Inflation des Jahres und dem Kostenanstieg fort; Pflegegeld bleibt. Staffel, Deckel und eigene Ausgaben gehören jetzt zu den gemeinsamen Pflegewerten des Haushalts.
- Hat eine Person einen Pflegegrad heute, zeigen Personenkarte, Haushalt & Plan und Balance einmal einen Hinweis mit den angesetzten Pflegekosten je Person: Grundbedarf und Flex ohne Pflege eintragen. „Erledigt“ merkt sich der Haushalt, auch über Sicherung und Spielbereich. Der Hinweis nennt, ob ein eigener Wert oder die Staffel gilt, und folgt jeder gespeicherten Planänderung.
- Neu in der Personenkarte: „Pflegekosten heute über die Kasse hinaus (€/Monat)“ für Pflege zu Hause. Der Betrag ersetzt den Staffelbetrag des heutigen Grads, auch mit 0 €, und wird im Jahresabschluss wie die Staffel fortgeschrieben.
- Korrekturen nach Gutachten: Ohne „Im Heim seit“ zählt das Heimjahr ab dem ersten Jahresabschluss weiter statt jedes Jahr neu bei 1 zu beginnen. Das Liquiditätsziel der Balance nutzt die Einkünfte des Folgejahrs (Rentenbeginn, befristete Einkünfte). Bei unverheirateten Paaren werden eigene Einkünfte der Person angerechnet, deren Pflegekosten sie trägt. Balance rechnet Pflege und Flex-Faktor auch ohne bestätigten Plan. Außenpersonen behalten im Simulator ihre eigene Staffel. Ein bewusst eingegebener Kostenanstieg von 3,5 % bleibt 3,5 %; gemerkte „Individuelle Werte“ kennzeichnen sich selbst. Im Protokoll-ⓘ gilt die 0,50-€-Grenze in der gewählten Eurobasis. Die Fortschreibung rundet kaufmännisch ohne Gleitkommarest.
- Beispiel Helga und Werner: Die Variante „Mit Haus, Werner Pflegegrad 3“ trägt den Grundbedarf ohne Pflege (36.000 € statt 54.000 €). Neue Übung „Werner seit 01/2023 im Heim“; die Übung „Beide Grad 4 im Heim“ setzt beide heute ins Heim. Im Ausgaben-ⓘ des Protokolls entfallen Zeilen mit „-0 €“.
- Korrekturen nach dem zweiten Gutachten: Das Liquiditätsziel der Balance schreibt die Einkünfte des Folgejahrs fort (Rentenanpassung, inflations- oder lohngebundene Einkünfte, Pflegegeld). Außenpersonen behalten im Simulator einen bewusst eingegebenen Kostenanstieg. Der eigene Wert „Pflegekosten heute über die Kasse hinaus“ ist im Jahresabschluss unter „Werte ändern …“ je Person änderbar. Personenkarte und Haushalt & Plan nennen die angesetzten Pflegekosten auch ohne bestätigten Plan; das Feld zeigt als Platzhalter den Staffelbetrag des Grads.
- Korrekturen nach dem dritten Gutachten: „Im Heim seit“ geht beim Speichern der Personenkarte nicht mehr verloren und wandert beim Personenwechsel nicht mehr mit. Das Liquiditätsziel der Balance nimmt für beide Renten die Rentenanpassung des Hauptprofils wie der Simulator. Die Personendatei einer Außenperson nimmt ihre eigenen Pflegepreise mit. Der Jahresabschluss schreibt die Pflegepreise des Haushalts fort, auch wenn zuletzt eine Außenperson geöffnet war. Die Personenkarte zeigt nach dem Angehörigenausfall kein Pflegegeld mehr. Der eigene Wert für Pflege zu Hause erscheint und wirkt nur dort, wo er gilt.
- Korrektur nach dem vierten Gutachten: Wer das Jahr schon im Dezember abschließt, sieht in Balance und Simulator dasselbe Heimjahr. „Im Heim seit“ zählt immer bis heute, ein Heimjahr ohne „seit“ nach dem Planjahr.
- Korrektur im Jahresabschluss: Ändert man unter „Pflegewerte“ nur den eigenen Wert für Pflege zu Hause, zeigt der Schritt „Marktdaten“ die Neuberechnung jetzt als laufend an, auch beim Zurücksetzen auf den Vorschlag.
- Korrektur: Wer seine Pflegeannahmen nie im Simulator gespeichert hatte, rechnete in Vergleichsläufen, Beispielhaushalten und über die Schnittstelle bisher mit Deckel 0 € und Kostenanstieg 0 %, also ohne Pflegezusatz zu Hause bei einem Pflegeeintritt. Jetzt gelten dort wie im Simulator 120.000 € und 5 %.

#### Haushalte und Sicherung

- Eine Installation führt mehrere getrennte Haushalte, etwa den eigenen und den eines erwachsenen Kindes. Der Umschalter oben auf jeder Seite zeigt und wechselt den geöffneten Haushalt. Jeder Haushalt hat eigene Daten, Sicherungen, Kurse und einen eigenen Spielbereich.
- Ein Haushalt lässt sich als Übergabedatei weitergeben und in einer anderen Installation einspielen.
- Daten & Sicherung zeigt je Haushalt, wann die letzte Vollsicherung lief. Bei mehreren Haushalten trägt der Dateiname der Vollsicherung den Haushaltsnamen.
- In einem neuen, leeren Haushalt ersetzt die erste angelegte Person den Platzhalter „Default“.

#### Abschlüsse und Budget

- Monats- und Jahresabschluss öffnen ein Fenster mit Reitern.
- Balance zeigt eine Budgetprüfung für das Folgejahr und den Abstand zum Jahreshoch. Führen Jahresendregel und Jahreshoch zu verschiedenen Folgen, wählst du im Jahresabschluss.
- Liquidität ist ein Reserveziel für Tagesgeld und Geldmarkt; ein einstellbarer Teil davon liegt im Tagesgeld.
- Ausgaben lassen sich mit Aufteilung in Grundbedarf (Floor) und Flex importieren und so auswerten.

#### Planungsumfang

- Erbschaften, Verkäufe, Einmalzahlungen und größere Ausgaben lassen sich je Jahr planen, weitere Einkünfte je Person.
- Für Partnerschaft und Todesfall rechnet die App Erbschaftsteuer mit Güterstand und Zugewinnausgleich. Testament, unverheiratete Paare und Immobilien, selbst genutzt oder vermietet, gehen in die Rechnung ein.
- Das Pflegemodell nutzt amtliche Daten. Pflegegeld zählt als Einkunft, der Pflegeverlauf gilt je Person.
- Der Simulator vergleicht Pläne, sucht Zielwerte und rechnet Monte Carlo schneller.

#### Hilfe und Hinweise

- Handbuch und Themenseiten sind neu geschrieben. Im Spielbereich stehen weitere Beispielhaushalte mit Steckbrief bereit.
- Info-Hinweise öffnen neben ihrem Symbol, auch in Simulator-Ergebnis und Monte Carlo.
- README und Handbuch sagen ausdrücklich, dass die App keine Anlage-, Steuer- oder Rechtsberatung ist.

### Oberfläche, Planung und neuer Name

Stand 13. Oktober 2026.

#### Oberfläche und Navigation

Balance und Simulator zeigen die drei Bedarfswerte offen; weitere Einstellungen liegen unter Alle Parameter. Personen & Vermögen bündelt Tagesgeld, Nettorente und sonstige Einkünfte unter Auf einen Blick sowie die übrigen Planfelder unter Weitere Planwerte. Tagesgeld speichert beim Verlassen oder mit Enter; die Karte Simulator-Werte zurücksetzen entfällt. Handbuchbilder und Texte zeigen die neue Bedienung.

- Die Übersicht beginnt mit dem nächsten Arbeitsschritt sowie Kennzahlen für Vermögen, Monatsbudget und Plan. Der Vermögensverlauf steht als eigene Karte daneben. Erledigte Abschlussschritte lassen sich wieder öffnen; der Startknopf steht im Kartenkopf.
- Haushalts- und Seitenstatus stehen im gemeinsamen Kopf. Die Seitenleiste lässt sich über den Knopf direkt oberhalb der Übersicht einklappen und wieder öffnen. Seitenaktionen stehen beim Titel; Ausgaben und Daten & Sicherung behalten ihre Arbeitsbereiche.
- Personen & Vermögen zeigt die Personenreiter vor den Karten. Haushalt & Plan zeigt Vermögenskarten und die offene Bedarfszeile. Die Personendetails starten geschlossen; vom Kopf der Personenansicht kannst du zum Depot springen. Hinweise zum Verlauf stehen hinter den jeweiligen Info-Knöpfen, Warnungen zur Datenqualität bleiben sichtbar.

#### Planung und Ergebnisse

- Balance stellt Monatsbudget und Handlungsanweisung dichter zusammen. Hilfe ist über einen Symbolknopf erreichbar. Festgeschriebener Plan, aktuelle Vorschau und Diagnose bleiben getrennt lesbar.
- Bei gekürztem Monatsbudget erklärt der Warum-Knopf die tatsächlichen Monatswirkungen als aufklappbare Treppe. Anhebungen erscheinen als Plusbeträge. Der Grundhinweis nennt die Kürzungsregel; die Marktphase steht in der Marktkarte. Ohne Kürzung zeigt die Karte Vollfinanzierung. Nach einer neuen Berechnung ist die Erklärung wieder geschlossen.
- Monats- und Jahresabschluss behalten den Dialog nach einem Teilimport geöffnet. Im Budgetvergleich stehen bereits die übernommenen Teilbeträge. Der Abschlussknopf wird erst nach den erforderlichen Besuchen und Bestätigungen freigegeben.
- Die Jahresvorbereitung umfasst sechs Schritte. Nach dem Speichern zeigt das Ergebnis die verbindliche Handlungsanweisung, den Planstand und die Monatszusammenfassung. Einen fehlgeschlagenen Monatsschritt kannst du erneut abschließen; die Wiederherstellungspunkte für Jahr und Monat bleiben getrennt.
- Beispielimporte in Ausgaben, Abschlussdialogen und Übersicht nutzen kompakte Kopierknöpfe mit erklärenden Tooltips. Der Sammelknopf heißt „Beispiele für alle“.

- Die Ergebnisansicht zeigt die beiden Monte-Carlo-Kernantworten neben dem Backtest. Die drei Backtestkennzahlen stehen kompakter zusammen; Angaben zur historischen Abdeckung findest du im Info-Feld.
- Im Jahresprotokoll steht „Niedrige Entnahme“ an der Entnahme, wenn eine gültige zugehörige CaR-Schwelle unterschritten wird. Der Hinweis erklärt den Vergleich. Aktien-, Gold- und Bondverkäufe erscheinen neutral, Käufe hervorgehoben. JSON- und CSV-Downloads behalten ihren Inhalt.
- Wenn ein Haushalt wirksam gewechselt wird, verwirft der Simulator das vorherige Ergebnis und seine Exporte. Das gilt auch, wenn die neuen Personendaten ungültig sind. Nach einem vollständigen Verkauf verwendet der historische Backtest das leere Depot statt erneut die Starttranchen.
- Wenn ein Balance- oder Vollimport scheitert, zeigt Daten & Sicherung einen bereits angelegten Wiederherstellungspunkt sofort an. Die Fehlermeldung bleibt sichtbar.

#### Namen und Build

Seit 13.10.2026 heißen Repository und Windows-Build-Ordner `VermoegenUndRuhestand`; der alte Repo-Pfad bleibt als Symlink erreichbar. Der Entwickler-Build heißt „Vermögen & Ruhestand Entwicklung“, erzeugt `vermoegen_und_ruhestand.exe` und verwendet `de.vermoegen-ruhestand.entwicklung`. Prüfkandidaten heißen `VermoegenUndRuhestand_KANDIDAT_<datum>_<commit>.exe` und nutzen `de.vermoegen-ruhestand.entwicklung.kandidat`.

Der Windows-Produktivbau nutzt die Release-Konfiguration und erzeugt `VermoegenUndRuhestand.exe` mit dem Produktnamen „Vermögen & Ruhestand“. Seine Kennung `de.vermoegen-ruhestand.suite` und die gespeicherten Daten bleiben erhalten. Die frühere `RuhestandSuite.exe` behält ihren Datenbereich `com.dieter.ruhestandsapp`; ein Bau mit dieser Kennung braucht ausdrücklich `-AltApp`.

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
