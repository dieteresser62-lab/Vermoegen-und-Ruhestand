# CHANGELOG

## Aktuelle dokumentierte Fassung

Stand 26. November 2026.

### Bedienung

- In der „Marktdaten-Korrektur“ zeigen die Felder „Ende …“ und „Allzeithoch“ den Kurs mit zwei, „Jahre seit Allzeithoch“ mit einer Nachkommastelle; gerechnet und gespeichert wird weiter mit dem genauen Wert, solange du das Feld nicht änderst.
- Die Desktop-App fragt beim Sichern und Exportieren mit „Speichern unter“, wo die Datei hin soll, statt sie ungefragt in „Downloads“ abzulegen. Das gilt für Vollsicherung, Wiederherstellungsdatei, Übergabedatei eines Haushalts, Recovery-Exporte und die JSON- und CSV-Exporte im Simulator. Nach dem Speichern nennt die Meldung Ordner und Dateinamen. Erst dann zählt die Vollsicherung. Brichst du ab, ändert sich nichts, und es steht „Speichern abgebrochen – keine Sicherung erstellt.“ Im Browser bleibt der Download; die Meldung nennt dann den Download-Ordner des Browsers.
- „Personen verwalten“ hat kein Häkchen „im Haushalt“ mehr. Jede Person gehört zum Haushalt; ein Haushalt hat eine oder zwei Personen. Für eine weitere Person legst du einen eigenen Haushalt an. Eigene Pflegewerte einer Person außerhalb des Haushalts gibt es damit nicht mehr.
- Balance hat den Knopf „Protokoll“ und die Worker-Diagnose (`?dev=true`) nicht mehr. Die alten Sprungziele `#verlauf` und `#snapshot-management` leiten nicht mehr weiter. Das Protokoll des Jahresabschlusses steht auf der Übersicht, der Vermögensverlauf unter „Personen & Vermögen“.
- In der „Marktdaten-Korrektur“ sind „nicht verwenden“, „Wieder verwenden“ und der Split im Ausprobieren sichtbar gesperrt, der Hinweis steht gleich über dem Block. Die Felder „Ende …“ nennen das Jahr des gespeicherten Stands: Vor dem Jahresabschluss im Januar ist das noch das vorletzte Jahr, und ein Satz sagt, dass der neue Jahresschluss mit dem Abschluss kommt.
- Unter „Alle Parameter“ › „Marktdaten-Korrektur“ markierst du einen falschen Tageskurs als „nicht verwenden“ und nimmst das mit „Wieder verwenden“ zurück; die App bestimmt das Hoch neu, gespeicherte Kurse bleiben. Einen Split trägst du mit Datum und Verhältnis ein; Hoch und Jahresschlüsse werden einmal geteilt, das Jahresprotokoll nennt ihn. Senkst du das Allzeithoch von Hand, warnt die App. Hinweise auf einen Ausreißer oder einen Einbruch über 30 % verwerfen nichts. Die Kachel „Allzeithoch“ nennt die Herkunft: Tagesschluss, Jahresschluss, gespeicherter Wert oder nach Split.
- Die Tageskurse von VWCE.DE lädt die App ab Beginn der Kurshistorie immer, auch ohne VWCE im Depot. Sie dienen nur als Referenz für das Allzeithoch. Fehlen Kurse vor dem ersten gespeicherten Tag, heißt das Hoch „nicht belastbar“, bis du auf der Seite Daten & Sicherung Kurse holst.
- Der Schritt „Marktdaten“ im Jahresabschluss rechnet auch ohne gespeicherte Tageskurse mit dem Jahresendkurs und zeigt dasselbe Hoch wie Plan und Speichern, nicht mehr die Werte des Vorjahrs.
- Liegt der Kurs höchstens 5 % unter einem Allzeithoch, das jünger als ein Jahr ist, rechnet Balance die Marktphase am Hoch. Kleine Schwankungen kippen den Plan so nicht mehr von „Höchststand“ auf „Junge Korrektur“ und von opportunistischem Auffüllen auf eine Notfüllung. Neben dem Hoch steht dann „gilt als Höchststand (Grundrauschen bis 5 %)“; gespeichert bleibt das echte Hoch.
- Ist der Jahresabschluss des Vorjahrs offen, lässt sich ein Split mit Datum im neuen Jahr erst nach diesem Abschluss eintragen. Ist der Jahresstand unklar, wartet der Split ebenfalls. Während „Nur hier ausprobieren“ sind die Korrekturen unter „Marktdaten-Korrektur“ gesperrt. Das Ergebnisfenster des Jahresabschlusses nennt das Grundrauschen am Allzeithoch.
- Hat das gespeicherte Allzeithoch ein Datum, zählt sein Alter bis zum Kursdatum statt pauschal ein Jahr mehr. Ein Hoch aus dem Herbst gilt im Frühjahr danach bei kleinem Rückgang als „Junge Korrektur“.
- Die Marktkachel unter „Diagnose“ nennt das Allzeithoch mit „Tagesschluss vom …“ und die Schwelle „Tiefer Bär“ mit Restabstand oder „Kürzung aktiv“. Der Block „Bärenmarkt, den die Jahresregel nicht sieht“, die Zeile „Mit Hoch vom …“ am Budget und der Kursverlauf entfallen. Bei alten oder fehlenden Kursen steht in „Was zu tun ist“ „Allzeithoch nicht belastbar“.
- Fehlt im Jahresabschluss die Inflation des Jahres, erklärt der Dialog die Zahl: HVPI Deutschland im Jahresdurchschnitt von Eurostat, meist erst nach Mitte Januar abrufbar. Bis dahin wartest du am besten; eine Eingabe von Hand ist vorher nur eine Schätzung.
- Wer den ersten Jahresabschluss über „Vor dem Jahresabschluss …“ zurückholt, startet ihn danach normal. Die Frage, ob das Jahr bereits abgeschlossen ist, kommt auch nach neuen Kursen nicht mehr.
- Passt das Auswahljahr der Ausgaben nicht zum Abschluss, meldet die Übersicht das gleich beim Start und nicht erst nach allen Schritten.
- Ein Haushalt ohne Ausgabenseite kann den Jahresabschluss starten; ein beschädigter Balance-Stand führt beim Start zur Wiederherstellung, und ein fehlgeschlagenes Löschen eines Sicherungspunkts lässt ihn erhalten.
- Das Alter der Vollsicherung zählt nach Kalendertagen. Eine Sicherung von gestern Abend heißt am Morgen „gestern“ statt „heute“. Nach dem Einspielen nennt der Kopf, was eingespielt wurde. Eine Übergabe- oder Wiederherstellungsdatei zählt nicht als Vollsicherung; dort steht „Datei vom … eingespielt am …“ mit der letzten Vollsicherung wie auf der Karte, und die Erinnerung nach 30 Tagen bleibt. Auch Balance meldet ein unpassendes Auswahljahr der Ausgaben vor dem Dialog. Scheitert in der EXE das Speichern nach der Übernahme alter Sicherungspunkte, bleiben sie im Speicher wie in der Datei.
- Beim Zurückholen sagt die Rückfrage, dass seitdem eingetragene Verkäufe oder importierte Ausgaben verloren gehen.
- Ist der gespeicherte Balance-Stand beschädigt, führt der Jahresabschluss zur Wiederherstellung unter Daten & Sicherung. Ein Profilwechsel überschreibt den beschädigten Stand nicht mehr still.
- Der offene Jahresabschluss bleibt über Mitternacht offen. Den Punkt vor dem Abschluss erkennt die App für den ganzen Haushalt, auch bei einem nachgeholten Jahr.
- Nach der Wiederholung mit Handkurs bleiben von Hand eingetragene Inflation und CAPE erhalten.
- Scheitert in der EXE das Speichern von Daten, Metadaten oder einem Sicherungspunkt, bleibt im Speicher der vorige Stand erhalten.
- Die Handy-Seite behält gespeicherte Kursverläufe bei einem Abruffehler. Beim nächsten Öffnen versucht sie den Abruf für den betroffenen Ticker erneut.
- Die Balance-Diagnose zeigt die Zeile „3-Töpfe“ schon beim ersten Öffnen genau einmal.
- Daten & Sicherung kennzeichnet im Spielbereich die Sperre der Vollsicherung. Die Haushalte-Tabelle zeigt den Sicherungsstand der echten Daten.
- Der Backtest erklärt im ⓘ den Unterschied zwischen Kürzungen ab 10 % und der Zählung im Jahresprotokoll. Der Vermögensfächer kennzeichnet aufgebrauchtes Geldvermögen. Im Pflegevergleich erklärt ein Satz das Vorzeichen der Differenz.
- Im Plankopf steht bei deaktivierter Rücklage für Flex-Ausgaben „Flex-Budget aus“.
- In Personen & Vermögen ergeben die gerundeten Anteile am Vermögensbalken zusammen 100 %.
- Die Handy-Seite behält gespeicherte Kursverläufe bei einem Abruffehler. Beim nächsten Öffnen versucht sie den Abruf für den betroffenen Ticker erneut.
- Die Balance-Diagnose zeigt die Zeile „3-Töpfe“ schon beim ersten Öffnen genau einmal.
- Daten & Sicherung kennzeichnet im Spielbereich die Sperre der Vollsicherung. Die Haushalte-Tabelle zeigt den Sicherungsstand der echten Daten.
- Der Backtest erklärt im ⓘ den Unterschied zwischen Kürzungen ab 10 % und der Zählung im Jahresprotokoll. Der Vermögensfächer kennzeichnet aufgebrauchtes Geldvermögen. Im Pflegevergleich erklärt ein Satz das Vorzeichen der Differenz.
- Im Plankopf steht bei deaktivierter Rücklage für Flex-Ausgaben „Flex-Budget aus“.
- Beim Zurückholen eines Stands nennt die Rückfrage Monatsausgaben, erfasste Vermögensstände und den Haushaltsplan für alle Personen. Das gilt auch bei der Wiederholung eines Jahresabschlusses mit Handkurs.
- Nach dem Einspielen zeigt der Kopf von Daten & Sicherung das Datum der Datei und den Tag des Einspielens. Die nächste bestätigte Vollsicherung zeigt wieder „Gesichert am …“.
- „Partnerschaft und Todesfall“ zeigt Pflichtteil und Immobilien mit Steuergeld als An/Aus-Schalter.
- Beim schnellen Seitenwechsel speichert Personen & Vermögen die letzte gültige Profileingabe vor dem Wechsel.

- Die Handy-Seite zeigt je Tranche die Veränderung über Woche, Monat und 52 Wochen und den Abstand zum 52-Wochen-Hoch. Depot und Personen zeigen Woche und Monat mit den heutigen Stückzahlen. Der Kursvermittler liefert dafür unter `/api/verlauf` den Jahresverlauf eines Tickers mit fertigen Bezugswerten.
- Beim Start, im Tranchen-Manager und im Kaufdialog kann ein neuerer Tageskurs für `.DE` von Stuttgart, Düsseldorf oder München/gettex stammen. Börse und Uhrzeit stehen am Kurs. Bei einem Xetra-Ausfall zählt der jüngste gültige Kurs einer dieser Börsen. Die Handy-Seite nutzt dieselbe Kurswahl und teilt große Depots auf mehrere Abrufe auf.
- Der Simulator speichert „Verhalten bei Todesfall“, „Witwen-/Witwerrente“, „Eheschließung in … Jahren“ und „Mindest-Ehedauer“ für den ganzen Haushalt. Die Werte bleiben beim Seiten- und Personenwechsel erhalten. Beim ersten Öffnen übernimmt der Simulator vorhandene Altwerte der aktiven Haushaltsperson. Fehlen ihr Altwerte, nimmt er die erste gespeicherte Haushaltsperson mit Altwerten. Ohne gespeicherten Wert gilt die jeweilige Formularvorgabe, etwa 55 % bei „Prozentregel“.
- Lädt die Seite nach dem Einspielen einer Sicherung nicht neu, speichert sie wie nach dem Zurückholen eines Punkts keine Eingaben mehr. Der Status bittet ums Neuladen; der eingespielte Stand bleibt so erhalten.
- In der Balance-Diagnose steht ein Wert genau auf der Grenze nicht mehr als „Exakt auf Mindestniveau“ neben einem roten Chip. Liegt die „Reichweite (vs. Ziel)“ unter dem Ziel, zeigt die Karte gelb „Unter Ziel“ statt „Mindestgrenze unterschritten“. Die Rechnung bleibt gleich.
- Mit heutigem Pflegegrad rechnet die Balance eine alte Flex-Vorgabe 75 / 25 / 10 / 0 / 0 % ohne Umstellungsmarke wie der Simulator mit 100 / 100 / 50 / 0 / 0 %. Gespeichert wird dabei nichts.
- Unter „Partnerschaft und Todesfall“ kannst du je Erblasser Bestattungs- und Abwicklungskosten eintragen und den Pflichtteil der Kinder sichern. Beides gilt auch bei „Immobilien und Steuergeld“. Dort kürzt die Sicherung nur den zusätzlichen Geldanteil, Immobilien und Steuergeld bleiben. Die Vorschau nennt die Kürzung und den fehlenden Betrag, etwa „es fehlen 18.750 €“.
- Bei „Verkauf mit Wohnkapital“ kannst du „Auszug nach“ auf bis zu 10 Jahre stellen. Bei 1 Jahr wohnt die überlebende Person bis Ende des ersten Folgejahrs mietfrei. Wohnkapital, Erbschaftsteuer und Miete fallen dann im zweiten Folgejahr an. Bei 0 Jahren nennt das Todesjahr den Verkauf, das Wohnkapital, den übrigen Hauserlös für die anderen Erben und den Mietbeginn im Folgejahr. Lebt die überlebende Person beim Tod schon dauerhaft im Heim, entfallen Wohnkapital und Miete auch bei 0 Jahren.
- In den Monte-Carlo-Szenario-Protokollen zeigt die Gruppe „Todesfall“ Pfade, in denen eine Person stirbt und danach noch mindestens zwei Jahre gerechnet sind.
- Der Simulator benennt die verbleibenden Jahre des Partners, trennt die Pflegehinweise und zeigt deutsche Status- und Begründungstexte in Protokollen und CSV. Das Backtest-ⓘ zur Euro-Wahl erklärt den Kaufkraftverlust in der Jahreszeile.
- Balance und Übersicht erklären Grundbedarf und Liquiditätsdeckung genauer. Der Simulator nennt fehlende Tranchen und schätzt den Aufwand auch bei leerer Laufzahl. Speicherfehler beim Anlegen oder Umbenennen einer Person werden gemeldet.
- Fehlt der Partnerschaftsstatus, zeigen Erbvorschau und Protokoll einen Hinweis. Die Erbschaftsteuer rechnet dann mit 20.000 € Freibetrag.
- Neue Bis-Jahre beim Pflegekostenanstieg beginnen im laufenden Jahr, im Spielbereich im Testjahr. Ein bereits abgelaufenes Bis-Jahr lässt die zweite Rate gelten.
- Nach einem gespeicherten Jahresabschluss zeigt der Abschlussdialog Allzeithoch und Marktlage des gespeicherten Stands.
- Das Backtest-Protokoll und sein CSV erklären VPW und die Deckung durch feste Einkünfte auf Deutsch. Anfangsbestände verwenden die Kaufkraft vom Jahresanfang. „Wofür?“ zählt auch Importe aus unvollständigen Haushaltsmonaten.
- Balance erklärt die Kursvorschau. Im Backtest stehen deutsche Schutzregelgründe, Ausgaben nennen fehlende Personenimporte und Abschlussreiter zeigen nach dem Ansehen „über Budget“.
- Fehlt im Monats- oder Jahresabschluss ein Ausgabenimport, zeigt der Reiter „Ausgaben“ auch nach dem Ansehen orange „Import fehlt“. Du kannst den Abschluss fortsetzen.
- Bei mehr als 10 % bis 20 % Rückgang vom Hoch im laufenden Jahr kann Balance auch bei einem starken Jahresplus „Junge Korrektur“ anzeigen.
- Die [Pflege-Referenz](docs/reference/PFLEGE.md) erklärt in fünf Teilen, wie die App Pflegekosten ansetzt, wer bei einer Lücke zahlt und wo die Beträge stehen.
- Übersteigen die Erstattungen einer Person ihre Monatsausgaben, zeigen Ausgaben und Monatsabschluss den Saldo mit Minuszeichen. Der Monat zählt in der Hochrechnung. Die Jahreswerte für Grundbedarf und Flex bleiben je Person mindestens null. Beim Import zählt für die Zuordnung geplanter Zahlungen die Summe der Ausgabenzeilen vor Erstattungen.
- Erstattungen in eigenen Kategorien mindern jetzt auch den Grundbedarf oder Flex im Jahresdiagramm, in „Wofür?“, in der Hochrechnung und in „Bedarf und Plan prüfen“.

- In „Szenario wählen“ siehst du mindestens sechs Einträge auf einmal, auch mit Immobilie und schon bei 1366 × 768. Die Zeile „davon Geldvermögen … · Immobilien …“ steht nicht mehr in jedem Eintrag, sondern im Hinweis beim Darüberfahren und in der Karte „Ausgewählt …“ darunter. Die Liste ist höher (480 statt 300 px) und die Einträge etwas enger.
- Im Monte-Carlo-Fächer „Entwicklung über die Jahre“ bricht das helle Band P5–P95 nicht mehr senkrecht ab, wenn P5 in den späten Jahren unter 1 € liegt. Solche Werte zeichnet der Fächer als 0 €. Die senkrechte Achse und die Endmarken rechts kommen nur noch aus gezeichneten Werten, es steht also keine Marke „P95 · …“ ohne Band darunter. Die Rechnung bleibt gleich.
- „Wohin das Geld geht“ im Jahresabschluss und „Deine Reserven“ teilen den Verkaufszufluss gleich auf. Jede Person erhält Tagesgeld bis zu ihrem eigenen Ziel und behält einen vorhandenen Überschuss. Den Rest erhält der Geldmarkt. Bei Max und Erika sind das ca. 10.000 € aufs Tagesgeld und 25.000 € in den Geldmarkt.
- Die Tagesgeld-Zeilen im Jahresabschluss nennen das Tagesgeldziel. Ein genau gedecktes Tagesgeldziel steht bei einem Schein-Fehlbetrag auch nach dem Eintragen aller Verkäufe auf volle Euro. Im Planversuch rundet „Deine Reserven“ nach der Neuberechnung. Die Marktphasen-Hilfe und die Szenario-Protokolle sprechen von der App. Die Sätze zur Leitplanke und zum Alarm enthalten die passenden Artikel.
- Die Karte „Längste Kürzung“ in Monte Carlo und Backtest nennt die größte Kürzung eines Jahres als „in einem Jahr um bis zu 30 %“ statt „jährlich höchstens 30 %“. Bei 100 % steht „in einem Jahr fiel die Flex-Entnahme ganz weg“.
- Weitere englische Restwörter sind ersetzt: „Grundbedarf“ steht ohne „(Floor)“ in Balance, Simulator und Personen & Vermögen. Aus Seed wird Zufallsstartwert, aus „Tail-Risk-Overlay“ „Zusätzliche Extremereignisse“ wie in den Monte-Carlo-Einstellungen, aus dem Unterreiter „Szenario-Logs“ „Szenario-Protokolle“. Die Diagnose nennt „Max. Allokation (% des Aktienwerts)“ statt „(Eq)“.
- Englische Restwörter heißen jetzt wie die deutschen Begriffe aus Glossar und Rechenweg: „Grundbedarf gedeckt im gewählten Horizont“ statt „Floor-Deckung …“, „Sicherheitsstufe aktiv (Jahre)“ statt „Safety aktiv (Jahre)“. Aus Runway wird Reichweite, aus Guardrail Leitplanke, aus Drawdown Rückgang und aus Pflegebucket Pflegereserve. Auf der Seite Ausgaben heißt die Karte „Grundbedarf und Flex“. Im Ausgabenimport bleiben die Werte „Floor“ und „Flex“ gültig, Exporte bleiben unverändert.
- Negative Beträge und Prozentwerte im Jahresprotokoll stehen mit dem echten Minuszeichen „−“, etwa bei „davon entfällt“ im ⓘ der Ausgaben.
- Im ⓘ der Ausgaben beginnen nur noch eingerückte Erläuterungen mit „davon“. Die Zeilen unter „Summe“ heißen „Hilfe zur Pflege (zahlt der Staat)“ und „Aus dem Vermögen bezahlt“.
- Backtest-Kopf und Protokoll zählen Kürzungen verschieden und heißen jetzt auch verschieden: oben „Jahre mit Kürzung ab 10 %“, im Protokoll „Jahre mit einer Kürzung“ (jede Kürzung zählt).
- Im Handbuch ist die Kopfzeile so hoch wie auf den anderen Seiten (56 statt 62 px); der Knopf „Spielbereich beenden“ sitzt mittig.
- Der Seitenkopf bleibt beim Scrollen oben stehen, im Spielbereich zusammen mit dem orangen Streifen.
- Bei mehreren Suchwörtern zeigt die Handbuchsuche zuerst die Kapitel, in denen die Wörter zusammen stehen, und dort die passende Stelle.
- Im Monte-Carlo-Protokoll hat die feste erste Spalte eine feste Breite. Ein langer Alterstext bricht um, statt die Spalte zu verbreitern und Überschriften daneben zu verdecken.
- Im Jahresabschluss verschwinden beim Tagesgeld Hinweis und Knopf „Stand bestätigen“, sobald du den Stand der Person bestätigst oder änderst.
- Im Monte-Carlo-Protokoll bricht der Alterstext nur zwischen „Simulationsjahr …“ und „Alter …“ um, keine Zeile beginnt mit „·“. Das ⓘ zur Erbschaftsteuer nennt den Versorgungsfreibetrag nur noch einmal, mit Betrag.
- Die Rückfrage „Beispiel neu starten?“ nennt das Datum, an dem das Beispiel neu beginnt.
- In „Was zu tun ist“ und im Ergebnis des Jahresabschlusses rundet die Handlungszeile die Summe der Zeilen je Person einmal: bei 52.298 € und 37.702 € steht „ca. 90.000 €“ statt 95.000 €. „Wohin das Geld geht“, „Deine Reserven“ und die Übersicht nennen denselben Betrag.
- Im Jahresabschluss zeigt beim Tagesgeld eine Person nach „Stand bestätigen“ „bestätigt · Stand vom …“, so wie „geändert · vorher …“ nach dem Ändern.
- Bei Geldbeträgen in heutigen Euro sagt das ⓘ zur Erbschaftsteuer im Protokoll, dass Zugewinnausgleich und Versorgungsfreibetrag nominal gelten, und nennt dahinter den Wert in Euro von heute.
- In der Kopfkarte des Szenario-Protokolls steht „davon Geldvermögen … · Immobilien …“ rechtsbündig wie die Kachel und bricht höchstens einmal um, zwischen Geldvermögen und Immobilien.

### Simulator

- In der Backtest-Ansicht „Real“ stehen Zahlungen des Jahres wie Grundbedarf, Renten, Steuern, Entnahme, Käufe und Verkäufe in Euro vom Jahresanfang. Ein gleichbleibender Grundbedarf von 24.000 € zeigt so in jedem Jahr 24.000 €, bisher schwankte er mit der Inflation des Jahres. Vermögen am Jahresende und die am Jahresende gutgeschriebenen Zinsen von Tagesgeld und Pflegereserve stehen in Euro vom Jahresende. Das gilt auch für Bruttovermögen, offene Steuer und „Tagesgeld danach“ im Handlungs-ⓘ. Die Rechnung bleibt gleich. Monte Carlo rechnete Zahlungen schon so; dort nehmen jetzt auch diese Zinsen und Werte im Handlungs-ⓘ sowie die Detailspalten „Liquidität Jahresende (vor Steuer)“, „Aktives Portfolio am Jahresende“ und „Pflegebucket-Ziellücke“ den Preisstand vom Jahresende.
- Endet ein Backtest mit aufgebrauchtem Vermögen, zeigen Gesamtvermögen, Pflegereserve und Ziellücke in „Real“ einen Betrag statt „—“ oder 0 €. Für die letzte Zeile gilt der Preisstand vom Ende des Vorjahrs.
- Fehlen im Backtest die Kürzungszahlen ab 10 %, stehen statt des Strichs der Grund wie „nicht auswertbar“ und ein ⓘ mit Erklärung. Es nennt auch die Zahl der Jahre mit Kürzung im Jahresprotokoll.
- Beide Stagflationsfilter im Stresstest ziehen Jahre schon ab 6,5 % statt ab 7 % Inflation und damit auch 1947, 1974 und 2022.
- Geplante Einmalausgaben außerhalb des Rechenbereichs weist der Simulator vor der Finanzierung ab und nennt sie im Jahresprotokoll.
- Unter „Modellannahmen“ stellst du „Simulierte Zukäufe“ für den Haushalt ein. In der Vorgabe „in dasselbe Papier“ verkauft die App bei gleicher ISIN zuerst die ältesten Stücke. Die Wahl „in ein eigenes Papier“ passt zu einem zweiten ETF und lässt beim Verkauf die Wahl nach Steuerlast zu. Die zugeklappte Zeile nennt die Wahl, auch bei einer Einzelperson.
- Unter „Partnerschaft und Todesfall“ kannst du „Verkauf, Miete auf Lebenszeit“ wählen. Die anderen Erben erhalten den Verkaufserlös. Die überlebende Person erhält ab dem Folgejahr eine inflationsangepasste Rente. Das Szenario-Protokoll zeigt die Zahlung und die Miete getrennt.
- Die Monte-Carlo-Karte „Wie es jeder Person ergeht“ zeigt die Grundbedarfsdeckung zu Lebzeiten und bei Paaren auch für die Person, die länger lebt.
- Bei Paaren legt der Simulator die Pflegereserve aus dem Geld der jeweiligen Person an und rechnet ihr die Zinsen auf den Baranteil zu.
- Die Exportspalte „Liquidität Jahresende (vor Steuer)“ berücksichtigt in Ansparjahren auch die Sparrate und die Zukäufe.
- Der Reiter „Werkstatt“ mit Stresspfad-Replay, Parameter-Sweep und Auto-Optimize ist entfernt. Du nutzt diese Werkzeuge nicht, deshalb entfallen sie ganz.
- Monte Carlo, Backtest und alle Protokoll- und Ergebnisexporte bleiben unverändert. Eine Entscheidung vergleichst du weiter unter „Monte-Carlo“ › „Vergleich“.
- Alte Vollsicherungen mit Werkstattdaten lassen sich weiter einspielen. Die App übernimmt diese Daten unverändert, liest sie aber nicht mehr.
- Monte Carlo rechnet als Vorgabe mit „Stationary Bootstrap“ und Blocklänge 5. Die bisherige Vorgabe heißt jetzt „Marktregime mit Übergängen (bisherige Vorgabe)“ und bleibt wählbar. Das ⓘ an „Simulationsmethode“ erklärt den Unterschied.
- Gespeicherte Pläne mit der bisherigen Vorgabe rechnen ebenfalls mit der neuen. Willst du die bisherige Methode behalten, wähle sie einmal neu aus; diese Wahl merkt sich die App. Eine andere selbst gewählte Methode bleibt.
- Das Monte-Carlo-Ergebnis eines Haushalts mit Immobilie bleibt jetzt nach einem Seitenwechsel erhalten, auch über 50 Jahre mit 10.000 Läufen. Bisher war es zu groß und ging still verloren. Ist ein Ergebnis doch zu groß, steht unter dem Ergebnis „Ergebnis zu groß zum Merken – nach einem Seitenwechsel neu rechnen.“
- Monte Carlo reicht den Vermögensfächer mit Immobilien aus den Rechenhelfern im Hintergrund ohne Kopie an die Seite weiter, wie schon den Fächer ohne Immobilien. Das spart bei großen Läufen Speicher; das Ergebnis bleibt gleich.

### Was sich an deinen Zahlen ändert

- Balance misst den Markt am Allzeithoch aus deinen gespeicherten Tageskursen, auch wenn es mitten im Jahr oder im Vorjahr lag. Vorschau und Jahresabschluss rechnen mit diesem einen Hoch; der Abschluss speichert es mit Datum. Ein Hoch, das ein Jahresendkurs verdeckt, geht so nicht mehr verloren. Mit den Spielkursen der Beispielhaushalte liegt das Hoch am 12.08.2026; die Vorschau zeigt dort im Herbst „Junge Korrektur“ und verkauft weniger.
- Bei geschütztem Pflichtteil mindert die übernommene Steuerschuld auch den Erwerb der überlebenden Person. Die App berechnet die notwendige Kürzung ihres Geldanteils aus dem Netto-Erwerb.

- Im Simulator senken offene Steuerschulden den Nachlasswert für die Pflichtteilsprüfung. Die Erbschaftsteuer auf später ausgezahltes Wohnkapital erscheint in der Steuersumme des Auszugsjahrs.
- Hat nur eine Person im Paar eine Pflegereserve angelegt, füllt der Simulator sie aus ihrem eigenen Geldmarkt und Tagesgeld. Reicht das eigene Geld dafür nicht, bleibt eine Ziellücke.
- Backtest und Monte Carlo verkaufen bei Aktienzukäufen derselben Person und ISIN die älteren Stücke zuerst. Liegt auf diesen Stücken mehr Gewinn, kann die Steuer beim Verkauf steigen.
- Backtest und Monte Carlo berücksichtigen jetzt die Pflegereserve deines Haushalts. Dadurch können sich deine Simulationsergebnisse mit aktiver Pflegereserve ändern.
- Der Simulator versteuert die Zinsen auf den bar gehaltenen Teil der Pflegereserve wie Tagesgeldzinsen der Eigentümer.
- Die Erbschaftsteuer rundet den steuerpflichtigen Erwerb auf volle 100 € ab, wie es das Gesetz verlangt ([§ 10 ErbStG](docs/reference/STEUERN.md#klassen-und-befreiungsannahmen)). Die Steuer sinkt dadurch um höchstens 99 € mal Steuersatz. Simulator, Vorschau und Protokoll rechnen gleich; Vorschau und ⓘ zur Erbschaftsteuer sagen „auf volle 100 € abgerundet“.
- Die BMF-Tabelle 2027 gilt ab dem 1. Januar 2027 für den Kapitalwert von Wohnrecht, Rente aus dem Erbe und Hinterbliebenenrente.
- Bei Ehe oder eingetragener Partnerschaft rechnet der Simulator im Todesjahr mit dem [Versorgungsfreibetrag](docs/reference/STEUERN.md#versorgungsfreibetrag) nach § 17 ErbStG. Er kürzt ihn um den Kapitalwert der Hinterbliebenenrente und das Sterbevierteljahr. Die Erbvorschau zeigt den persönlichen Freibetrag.
- Im Simulator zählt ein Lauf als Erfolg, wenn der Grundbedarf ohne Pflegekosten gedeckt ist. Der Staat übernimmt ungedeckte Pflegekosten als [Hilfe zur Pflege](docs/reference/PFLEGE.md#grundbedarf-pflege-und-erfolg). Dadurch können die Deckungsquoten steigen.
- Bei unverheirateten Paaren springt der Partner ein, wenn einer Person Geld für den Grundbedarf fehlt. Fehlt nur Geld für ihren Flex-Anteil, kürzt die App diesen Anteil.
- Offene Steuer bleibt als [Steuerschuld](docs/reference/PFLEGE.md#steuerschuld-und-tod) stehen und wird im Folgejahr fällig.
- Einmalige geplante Ausgaben entfallen im Simulator einzeln, wenn das Geld für den ganzen Posten fehlt.
- Wenn der Haushalt den Grundbedarf nicht mehr decken kann, zeigt der Simulator „Vermögen aufgebraucht“.
- Bei „Reichweite zuerst“ verkauft zuerst die Person mit weniger Tagesgeld und Geldmarkt, bis beide gleich viel haben, und die Auszahlung zahlt zuerst die Person mit mehr. Bisher teilte die App meist je zur Hälfte, egal wie viel Liquidität jede Person hatte. Die Summe bleibt gleich.
- Bei „Reichweite zuerst“ mit 0 Zieljahren bei beiden Personen verteilt die App den Betrag über der Liquidität des Haushalts nach Vermögensanteilen. Bisher folgte er der Liquidität oder blieb ganz offen, wenn keine Person Liquidität hatte.
- Bei „Steueroptimiert“ ordnet die Handlungsanweisung Tagesgeld und Geldmarkt in der Personenreihenfolge aus „Haushalt & Plan“ zu, wie die Auszahlung. Die Summe bleibt gleich.
- In Monte Carlo zählt ein Lauf mit aufgebrauchtem Vermögen bei „Max. Rückgang“ mit 100 %, auch in der Stressphase. Bisher zählte nur der Verlust bis zum letzten gerechneten Jahr, bei Ruin im ersten Jahr also 0 %. Median und P90 des Rückgangs können dadurch steigen. Deckung und Entnahmen bleiben gleich.
- „Erholung nach Stress“ nimmt nur noch Läufe in den Median, deren Entnahmerate nach der Stressphase wieder unter 3,5 % fällt. Läufe ohne Erholung stehen darunter mit Anteil und Zahl. Bisher zählten sie mit der Länge der Stressphase, ein Totalverlust sah also je nach Szenario wie 3 bis 12 Jahre Erholung aus.
- Mit der neuen Monte-Carlo-Vorgabe verschieben sich alle Monte-Carlo-Ergebnisse etwas. Balance, Jahresbudget und Backtest bleiben gleich.
- Bei einem positiven Altimport mindert eine Erstattung, etwa −200 € Nebenkosten, die Hochrechnung. Die Person bleibt bei der positiven Vorzeichenkonvention, wenn positive Salden nach Anzahl und Betrag überwiegen.
- Stationary Bootstrap und Block-Bootstrap ziehen jedes Jahr des gewählten Zeitraums gleich oft: Erreicht ein Block das letzte Jahr, geht er mit dem ersten weiter. Mit „Startjahre nach CAPE“ bestimmt der CAPE-Wert nur den ersten Block.
- Dynamic Flex rechnet die Entnahme jetzt vorschüssig: Das Geld eines Jahres steht zu dessen Beginn bereit ([FR-88](docs/reference/JAHRESBUDGET.md#a2)). Das dynamische Budget sinkt dadurch etwas, bei Jan und Lena im Januar 2027 von 4.300 € auf 4.100 € im Monat.
- Schaltest du im Simulator zusätzliche Extremereignisse ein, verteilen sich Crashs im ersten Jahr jetzt auf alle Startjahre. Die Ergebnisse fallen dadurch etwas schlechter aus.
- Im Simulator bekommen Tagesgeld, Geldmarkt und Pflege-Rücklage den Zins eines Jahres jetzt auf den Stand vor der Jahresentscheidung, so wie die Aktien ihre Rendite. Bisher bekam Geld aus verkauften Aktien im selben Jahr zusätzlich Zins, und Geld für Zukäufe verdiente ein Jahr lang nichts. Monte Carlo und Backtest verschieben sich dadurch etwas; mit der Vorgabemethode steigt das mittlere Endvermögen der Beispielhaushalte um bis zu 1 %. Balance, Jahresabschluss und Jahresbudget bleiben gleich.

### Jahresabschluss

- Die Wahl zwischen Jahresendregel und Jahreshoch entfällt. „Jahr abschließen“ wartet nicht mehr auf eine Marktwahl. Der Schritt „Marktdaten“ nennt das Allzeithoch mit „Tagesschluss vom …“, den Abstand, die Marktlage und die Schwelle „Tiefer Bär“. Alte Belege mit der Wahl „Jahreshoch“ nennen sie weiter.
- Bei „Kurse prüfen“ zählt der gespeicherte Schlusskurs vom letzten Xetra-Handelstag auch ohne Verbindung. „Marktdaten“ ordnet Yahoo-Kurse dem Berliner Handelstag zu.
- Im Reiter „Immobilien“ schreibt die App die Werte mit der Jahresinflation fort. Du kannst einen eigenen Wert eintragen.
- Ist der Tagesgeld-Stand einer Person älter als der 31.12. oder ohne Datum, trägst du den Jahresendstand ein oder klickst „Stand bestätigen“.
- Weicht der CAPE um mehr als 25 % vom letzten Jahresabschluss ab, zeigt der Schritt Marktdaten beide Werte. Weiter geht es nach „CAPE-Wert bestätigen“.
- Bei einem solchen CAPE-Sprung ist auch das Feld „US Shiller CAPE von Hand“ offen. Du bestätigst den abgerufenen Wert oder trägst einen eigenen ein.
- In „Marktdaten“ nehmen ETF-Schlusskurs, Inflation und CAPE Komma und Punkt an. Beim Tippen bleiben Fokus und Cursor im Feld.
- Der Jahresabschluss zeigt „Xetra prüfen“, wenn für eine .DE-Tranche nur ein Abendbörsenkurs oder ein Kurs ohne belegte Herkunft vorliegt. „Kurse aktualisieren“ fragt die eingetragene Börse ab.
- Scheitert das Speichern des Jahresabschlusses, nimmt die App ihn auch dann zurück, wenn währenddessen anderswo gespeichert wurde. Die Seite sperrt sich dabei nicht mehr selbst.
- Zur Vorbereitung auf den Jahresabschluss im Januar kannst du im Spielbereich den 2. Januar 2027 wählen und den Abschluss 2026 mit Spielkursen durchgehen.

### Vermögensverlauf und Kurse

- Der Vermögensverlauf zeigt den letzten verfügbaren Tagesstand. Die erfassten Stände sind aus der Ansicht verschwunden.
- Auf der Übersicht rufst du Kurse mit einem Klick auf den Kursstand im Seitenkopf ab.
- Der Kursvermittler der EXE gibt Browseranfragen nur für bekannte Tauri- und lokale HTTP-Herkünfte frei.

### Daten & Sicherung

- Aufgeräumt: Die App übernimmt keine alten Rückkehrpunkte der früheren Snapshot-Form mehr und rechnet alte Liquiditätsangaben in Monaten nicht mehr um (es gilt der Standard). Feature-Schalter aus der Adapter-Zeit sind entfallen. Alte Vollsicherungen lassen sich weiter einspielen.
- Eine ältere Vollsicherung mit einer Person außerhalb des Haushalts spielt die App nicht ein. Die Meldung rät, für diese Person einen eigenen Haushalt anzulegen; dein Stand bleibt unverändert. Enthält der gespeicherte Stand noch eine solche Person, zeigt die App die Profil-Wiederherstellung und schreibt nichts.
- Wiederherstellungspunkte sind einfacher: Die App legt sie beim Monats- und Jahresabschluss und vor dem Ersetzen deines Stands an, immer für den ganzen Haushalt. Zurückholen setzt den ganzen Haushalt zurück; einzelne Personen, Aufräumen und Einzellöschung entfallen. Es bleiben 12 Monatspunkte, alle Jahresabschlüsse und die letzten 3 Punkte vor dem Einspielen. Beim ersten Start werden frühere Punkte entfernt, Jahresabschluss-Punkte bleiben; ein Hinweis erinnert an eine Vollsicherung. Beschädigte Punkte lassen sich nicht zurückholen. [Sicherung](docs/reference/SICHERUNG.md#wiederherstellungspunkt)
- Bietet der Browser einen Speicherdialog an, gilt die Vollsicherung als gespeichert, sobald die Datei geschrieben ist. Andernfalls zeigt die App „Sicherung angestoßen“.
- Die Karte „Austausch“ ist entfallen. Einzelne Personen und Balance-Stände lassen sich nicht mehr exportieren oder einspielen, auch „Bisherigen Ordner verbinden …“ und die Kürzel Alt+E und Alt+I gibt es nicht mehr. Einen Haushalt gibst du mit der Vollsicherung weiter. Protokolle und Ergebnisse exportierst du weiter im Simulator und in der Balance.
- Über der Vollsicherung steht „Seit der letzten Sicherung unverändert“, wenn sich nichts geändert hat. „Seit der letzten Sicherung geändert:“ erscheint nur noch, wenn darunter Änderungen stehen.
- Scheiterte in der EXE die Übernahme aus dem Spielbereich in einen Haushalt ohne gespeicherte Daten, blieb eine leere Datendatei zurück. Danach ließ sich nichts mehr speichern. Die App entfernt diese Datei jetzt wieder.
- Liegt dabei noch eine alte `.json.bak` aus einer früheren Version im Datenordner, benennt die EXE sie in `….bak.<Zeitstempel>.json` um. Die alte Sicherung bleibt so als eigene Datei erhalten.
- Schließt du die EXE, während noch gespeichert wird, wartet sie auch nach der Freigabe durch die Seite bis zu 7 Sekunden auf das Ende der Speicherung.

### Jahresdaten

- `jahresdaten --pruefen` sperrt vorläufige Rohbelege, eine abweichende Lohnindexbasis und doppelte Dezemberwerte in der CAPE-Datei.
- Neue Werkzeuge holen, prüfen und übernehmen die historischen Jahresdaten und zeigen, welche amtlichen Werte fällig sind. Das Datenjahr 2026 folgt im März 2027. [Jahresdaten pflegen](docs/reference/JAHRESDATEN.md)

### Beispiele

- In Beispielhaushalten sind für Monte Carlo 2.000 Läufe voreingestellt.

## Frühere Fassungen

### Verkauf, Kauf und Entnahme

Zuletzt veröffentlicht am 15. November 2026.

#### Was sich an deinen Zahlen ändert

- Bei Paaren, die nicht verheiratet sind, endet ein Lauf seltener mit „Persönlicher Ausgabenanteil ungedeckt“. Fehlt einer Person nur ihr Anteil am Flex, kürzt die App den Flex. Ein fehlender Anteil am Grundbedarf beendete den Lauf.
- Bei mehreren Tranchen desselben Wertpapiers verkauft die App wie die Bank die ältesten Stücke zuerst. Bis zum ersten Todesfall ändert sich nichts. Danach kann der Simulator leicht abweichen, weil geerbte Tranchen nun in dieser Reihenfolge verkauft werden.
- Der Kostenanstieg der Pflege ist gestuft: 5 % pro Jahr bis 2035, danach 2 %.
- Im Modus „Eine Person trägt“ hält die tragende Person die volle Reserve selbst. Sie verkauft dafür mehr als vorher; das Tagesgeld der anderen Person zählt nicht mit.

#### Verkauf und Kauf geführt

- Verkauf und Kauf laufen in Schritten: Überblick, Merkzettel für die Bank, Abrechnung, Gutschrift oder Abbuchung, bei Verkäufen zuletzt die Verteilung des Geldes. Teilausführungen und mehrere Personen gehen in einem Durchgang.
- Die Abrechnung nimmt Stück, Kurs, Gebühren und Steuern auf. Die Gutschrift bzw. Abbuchung bestätigst du mit dem Kontostand vom Tagesgeld.
- Die Karte „Was zu tun ist“ geht auf den Euro auf: Plan gleich verkauft plus offen, dazu „weniger als geplant“ oder „mehr als geplant“, wenn du das so entschieden hast.
- „Kauf rückgängig“ setzt auf Wunsch auch das Tagesgeld zurück.

#### Eine Person trägt

- In Haushalt & Plan wählst du, ob eine Person die Entnahme allein trägt. Die andere Person bekommt dann keine Aufträge; ihr Vermögen bleibt unberührt, solange die tragende Person reicht.
- Reicht das Vermögen der tragenden Person nicht für die volle Reserve, steht ein Hinweis „Reserve unter Ziel“.

#### Tranche im Detail

- Die Tranche öffnet als Ansicht mit fünf Kennzahlen: Stück, Einstand, Wert heute, Gewinn und Steuer bei Verkauf. „wie gerechnet?“ erklärt die Steuer in Klartext.
- Die Stückzahl änderst du über „ändern“ an der Kachel. Bei einem Aktiensplit bleibt der Einstand gleich und der Kaufpreis je Stück wird umgerechnet.
- Der Verlauf zeigt den ursprünglichen Kauf und jede Korrektur mit vorher und nachher. Ab fünf Einträgen ist er verkürzt.
- Name, ISIN, Kursabruf, Anlageform, Steuerart und Kauf stehen eingeklappt unter „Angaben zum Wertpapier“. Die Notiz speichert beim Verlassen des Felds.
- Der Bestand ergibt sich aus dem Kaufdatum: vor 2009 Altbestand, sonst Neubestand. Passt bei vorhandenen Tranchen beides nicht zusammen, steht ein Hinweis da; die App ändert nichts von selbst. Die Steuer hängt nicht am Bestand, sondern an Einstand, Teilfreistellung und „Ganz steuerfrei“.

#### Eingaben und Gestaltung

- Personen & Vermögen sieht aus wie Balance und Übersicht. Betragsfelder haben einen €-Rahmen, Gebühren und Steuern stehen mit Cent.
- Tagesgeld steht überall in ganzen Euro.
- Beim Tippen bleibt der Cursor im Feld; automatisches Speichern sperrt keine Felder mehr.
- Ziehen mit der Maus aus einem Feld über den Fensterrand schließt kein Fenster mehr.

#### Beispiele

- Neue Variante „Max und Erika · Nachkäufe desselben ETF“ für die Bankreihenfolge.
- Martin und Petra haben die Variante „Martin trägt“.

### Gerundete Anzeige, Fondskosten und Lebenserwartung

#### Was sich an deinen Zahlen ändert

- Erfolgsquoten im Simulator sinken. Die App rechnet mit einer längeren Lebenserwartung, simuliert bis zum Alter 110 und zieht Fondskosten von der Aktienrendite ab.
- Mit Dynamic Flex sinkt das Monatsbudget in Balance und Simulator. Fondskosten mindern die erwartete Rendite, und der längere Horizont verteilt das Vermögen auf mehr Jahre.
- Gespeicherte Rentenanpassungen bleiben, wie sie sind. Wer „wie Löhne“ eingestellt hat, rechnet weiter damit und sieht dazu einen Hinweis.
- Ergebnisse, die vor dieser Fassung gerechnet wurden, zeigt die Übersicht einmal als veraltet. Ein Backtest ohne Dynamic Flex bleibt gültig.

#### Gerundete Anzeige

- Beträge, die die App berechnet, stehen gerundet da: unter 10.000 € auf 500 €, unter 25.000 € auf 1.000 €, unter 50.000 € auf 2.500 €, unter 200.000 € auf 5.000 €, unter 1 Mio. € auf 10.000 €, darüber auf 25.000 €. Monatswerte runden auf 50, 100 oder 250 €.
- Was du brauchst oder ausgibst, wird aufgerundet: Bedarf, Ziele, Verkäufe, Steuer, „Tagesgeld auffüllen“. Was dir zur Verfügung steht, wird abgerundet: Budget, Flex, Käufe, Liquidität nach Umsetzung. Der Jahreswert ist der gerundete Monatswert mal 12.
- Genau bleiben Einkünfte, Kontostände, eingetragene Verkäufe, beschlossene Planwerte und deine Eingaben, dazu „Details & Drucken“, Diagnose, Ausgaben-Check, Simulator und alle Exporte. Gerechnet wird weiter genau.
- Summen, Stände „nach Umsetzung“ und Differenzen entstehen aus den angezeigten Beträgen und gehen deshalb auf. Die Budgetzeile nennt Einkünfte und Entnahme ohne Summe, weil die Einkünfte genau bleiben.
- Das gilt im Balance-Überblick, in „Was zu tun ist“, „Deine Reserven“, im Jahresabschluss und in der Übersicht.

#### Balance

- Die Karte „Was zu tun ist“ ersetzt im Überblick Handlungsanweisung, Budgetprüfung und Marktphase. Sie zeigt oben den Plan aus dem Jahresabschluss mit Stand je Zeile: „Offen“, „Teilweise erledigt“ oder „Erledigt“. Der Stand kommt aus den eingetragenen Verkäufen seit dem Beschluss.
- Eine Planzeile gilt als erledigt, sobald etwas verkauft ist und höchstens eine halbe Rundungsstufe fehlt; mehr verkaufen zählt auch. Vorher galt eine feste Grenze von 98 %.
- „Verkauf eintragen“ öffnet den Verkaufsdialog mit der Tranche der Planzeile. Fehlt zu einem Verkauf die Gutschrift aufs Tagesgeld, steht dort „Gutschrift nachtragen“.
- Deckt das Tagesgeld weniger als sechs Monate Entnahme und ist kein Planverkauf offen, schlägt die Karte „Tagesgeld auffüllen“ vor, bei Paaren je Person.
- Unten in der Karte steht zugeklappt „Vorschau auf den Plan ‹Jahr›“: der Plan, den der nächste Jahresabschluss beschließen würde.
- Den Abstand zum Jahreshoch zeigt die App nur noch bei einem verdeckten Bärenmarkt, also wenn gemessen am Jahreshoch der Flex gekürzt würde, nach Kursen zum Jahresende aber nicht. Kleinere Abstände entfallen. Sind die Kurse zu alt oder lückenhaft, steht dort eine Zeile mit dem Weg zu frischen Kursen; in den ersten zehn Tagen nach dem Jahresende fehlt sie, solange kein neuer Kurs da ist.
- „Deine Reserven“ steht rechts unter „Was zu tun ist“. „nach Umsetzung“ zählt nur den Teil der Anweisung, den du noch nicht als Verkauf eingetragen hast. Die Marktphase steht unter „Diagnose“.
- Fehlt nur der Betrag, den die Abrundung der Monatsentnahme weglässt, gilt der Flex als voll finanziert. Die App meldet dann keine Kürzung; der Abschlussbeleg nennt die Rundung.

#### Jahresabschluss

- Der Schritt „Plan“ zeigt, wie weit der alte Plan umgesetzt ist, und den neuen Plan als Karte „Was zu tun ist“.
- Den Vergleich mit dem Jahreshoch gibt es nur noch bei einem verdeckten Bärenmarkt. Dann wählst du im Schritt „Plan“ ohne Vorauswahl zwischen „Nach Kursen zum Jahresende“ und „Mit dem Jahreshoch vom …“. Sonst gilt die Jahresendregel ohne Rückfrage.

#### Planwerte

- Neue Personen und Beispiele starten mit der Rentenanpassung „wie Inflation“. „wie Löhne“ bleibt wählbar; ein Hinweis erklärt, warum die Lohnreihe als Rentenannahme optimistisch ist.
- „Laufende Kosten Aktien-ETF“ ist ein Planwert in Haushalt & Plan unter „Weitere Planwerte › Fondskosten“, vorbelegt mit 0,5 % pro Jahr. Backtest und Monte Carlo ziehen ihn jedes Jahr von der Aktienrendite ab; Gold und Geldmarkt bleiben ohne Abschlag. Mit Dynamic Flex mindert er auch die erwartete Rendite. Im Simulator probierst du einen anderen Wert mit „Nur hier ausprobieren“ aus.
- Feste geplante Ausgaben, etwa eine Kreditrate oder eine Versicherung bis Rentenbeginn, zählen wieder in ihren Monaten zum Grundbedarf. Simulator, Monte Carlo und Backtest kürzen sie nie; die Balance rechnet sie ins Jahresbudget, und das Monatsbudget steigt in diesen Monaten um den Betrag. Ausgaben-Seite, Monatsabschluss und Überblick zeigen diesen Monatswert, der Floor/Flex-Vergleich zählt sie zum Grundbedarf. Einmalige geplante Ausgaben bleiben außerhalb des Budgets, mit Reserve und Zuordnung im Import.
- Übergang: Ein Jahresplan, der vor dem 11.11.2026 beschlossen wurde, behält bis zum nächsten Beschluss seine alte Bedeutung. Sein Monatsbudget bleibt gleichmäßig, und der Import bietet feste Ausgaben in diesem Jahr weiter zur Zuordnung an.
- Der Kostenanstieg der Pflege heißt überall „Inflation + …“.

#### Lebenserwartung und Pflege

- Monte Carlo und Planungshorizont rechnen mit der Kohortensterbetafel V2 des Statistischen Bundesamts für den Geburtsjahrgang jeder Person. Vorher galt die Periodentafel 2023/2025; sie dient jetzt nur noch der Pflegeabstimmung. Für 60- bis 70-Jährige liegt die Lebenserwartung dadurch 0,7 bis 1,6 Jahre höher.
- Wer heute ohne Pflegegrad ist, lebt im Modell im Mittel so lange wie die Tafel, auch mit gezogenem Pflegefall. Ein eingetragener Pflegegrad verkürzt das Leben, auch mit langsamerem Verlauf.
- Pflegeeintritt und Gradfortschritt sind auf die neue Sterblichkeit abgestimmt. Menschen in Pflege leben im Modell länger, ein Pflegefall dauert deshalb länger als vorher.
- „Maximale Dauer“ in Monte Carlo ist leer und damit automatisch: bis die jüngste Person 110 wäre. Eine gespeicherte 35, die frühere Vorgabe, gilt als automatisch. Auch Auto-Optimize rechnet mit dieser Dauer statt fest mit 35 Jahren.

#### Beispiele

- Neue Variante „Plan teilweise umgesetzt“ bei Max und Erika: Sie zeigt den Stand eines halb erledigten Jahresplans und „Gutschrift nachtragen“. Die Variante „Markt erst heiß, dann Rückgang“ führt jetzt zum verdeckten Bärenmarkt im Jahresabschluss.
- Renate hat Übungen zur Rentenanpassung und zu den Fondskosten.


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
