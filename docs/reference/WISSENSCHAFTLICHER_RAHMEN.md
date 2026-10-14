# Wissenschaftlicher Rahmen von Vermögen & Ruhestand

<a id="forschungsrahmen"></a>

Die App berechnet, wie ein Ruhestandsplan unter historischen oder simulierten Bedingungen verläuft. Sie verbindet Grundbedarf, veränderbare Ausgaben, Rente, Vermögen und mögliche Lebensereignisse. Die Ergebnisse hängen von deinen Eingaben und den Modellannahmen ab. Eine hohe Erfolgsquote ist keine Zusage für deinen Haushalt.

Stand: Oktober 2026. Das [Fachkonzept](FACHKONZEPT.md) beschreibt die Regeln. Das [Register](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#literaturpruefung) führt 55 vorhandene Quellen samt Metadatenprüfung und unbestätigten Angaben. Die Prüfung ist keine neue Literaturrecherche oder externe Validierung der App.

## Worauf die Rechnung beruht

### Entnahme aus Grundbedarf und Flex

Du gibst den jährlichen Grundbedarf, Floor, und den veränderbaren Zusatzbedarf, Flex, vor. Rente deckt zuerst Floor, danach Flex. Der verbleibende Bedarf wird aus Vermögen finanziert und im Simulator für das Folgejahr mit Inflation fortgeschrieben. Die Aufteilung folgt deiner Eingabe, nicht vergangenen Ausgaben. [Rechenvertrag](FACHKONZEPT.md#grundbedarf-und-zusatzbedarf).

Bengens historische Entnahmearbeit begründet den Ausgangspunkt eines Bedarfs mit erhaltener Kaufkraft. Forschung zu flexiblen Entnahmen und Konsum über den Lebenszyklus stützt die Trennung von Grundbedarf und Wünschen. Die App kombiniert diese Ideen mit eigenen Steuer-, Renten- und Liquiditätsregeln. Sie repliziert keine Studie und leitet keine allgemeingültige sichere Rate ab. Floor bezeichnet Bedarf, keine garantierte oder versicherte Zahlung. [Entnahmebelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-01), [Konsumforschung](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-02).

### Guardrails und Erholung

Guardrails ändern Flex nach Regeln für Marktverluste, Entnahmequote, Inflation und Liquidität. Nach Alarm und Guardrails folgen Mindest-Flex, Flex-Budget, Glättung und Sicherheitsgrenze. Die Diagnose erklärt die Einflussregeln; der Vorschlag ist noch keine tatsächlich finanzierte Auszahlung. [Entnahme-Kette](ENGINE_DECISION_LOGIC.md#bedarf-und-flex-trace).

Guyton und Klinger liefern den Praxisursprung regelbasierter Entnahmeanpassungen. Die App verwendet andere Auslöser, Schwellen und Cashflows. Die Regeln sind umgesetzt und technisch prüfbar, ihre wirtschaftliche Wirkung ist nicht unabhängig bestätigt. Eine höhere Floor-Deckung kann durch weniger Flex entstehen. [Forschungsgrenze](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-03).

### Mindest-Flex und Einschränkung

Mindest-Flex ist dein gewünschter unterer Jahresbetrag für den Haushalts-Flex. Die App rechnet Rentenüberschuss auf Flex an und versucht, den verbleibenden Mindestbetrag durch Anhebung der Flex-Rate zu erreichen. Alarm oder unzureichende Finanzierung samt Reserve können das sperren; Budget und Glättung bleiben danach wirksam. Normale Sicherheitsziele schützen ein zulässiges Minimum. Bei gleichzeitig tiefem Bärenmarkt, starkem realem Vermögensrückgang und kritischer geschützter Entnahmequote kann geplanter Depot-Flex trotzdem auf null fallen. Der geplante Floor bleibt unverändert. [Regeln](FACHKONZEPT.md#policies-und-reihenfolge).

Ein Mindest-Flex über dem statischen Flex-Bedarf wird abgelehnt, nicht still gekappt. Die Forschung liefert den Zusammenhang von Bedarf, Wünschen und mentalen Budgets; keine Quelle bestimmt den richtigen Betrag für deinen Haushalt. Mehr Mindest-Flex kann heutigen Konsum stützen und spätere Versorgung schwächen. Es ist keine Auszahlungsgarantie. [Belegdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-04).

„Einschränkung“ bedeutet gezahlten Haushalts-Flex einschließlich Rentenbeitrag streng unter dem angewandten positiven Jahresminimum. Gleichheit und Mindestwert null zählen nicht. Eine Kürzung gegenüber Wunsch-Flex allein zählt ebenfalls nicht. Die Messung verwendet nominale Jahresbeträge und abgeschlossene Entnahmejahre; die [Ergebnisdeutung](#einschränkungen-richtig-vergleichen) erklärt die Anteile. [Messvertrag](FACHKONZEPT.md#einschränkung-nach-fr-6).

### Dynamic Flex

Dynamic Flex berechnet aus aktivem Vermögen, angenommener Realrendite und Resthorizont einen jährlich erneuerten Entnahmerahmen. Nach Abzug des Netto-Floors entsteht die Flex-Basis. Go-Go-Faktor, Sicherheitsstufen, Glättung, Wiedereinstieg und weitere Entnahmeregeln beeinflussen das Ergebnis. Der Pflegebucket gehört nicht zur verfügbaren Vermögensbasis. [Formel](FACHKONZEPT.md#dynamic-flex).

Waring und Siegel beschreiben eine jährlich erneuerte virtuelle Annuität; die Community-Methode VPW ist ein praktischer Bezug. Die US-RMD-Tabelle ist eine eigene Steuerregel. Die App übernimmt weder diese Tabelle noch das VPW-Spreadsheet unverändert. Ihr Annuitätenkern verteilt Kapital über einen angenommenen Zeitraum. Ein kürzerer Horizont kann heute mehr Flex erlauben und spätere Deckung schwächen; die Schutzregeln beseitigen diese Unsicherheit nicht. [Quellen und Abweichungen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-05).

### Liquidität, Anleihen und Gold

Liquiditätsreichweite setzt freie Liquidität zur Portfolioentnahme ins Verhältnis. Zielwerte und Verkäufe steuern die Finanzierung. Die optionale Drei-Topf-Regel kann in schlechten Aktienjahren Anleihen als Verkaufsquelle vorziehen. Der Simulator verwendet dafür einen Cash-Proxy ohne vollständige Laufzeit-, Kupon- und Bonitätsrechnung. Sequenzrisikoforschung begründet, weshalb Verlust- und Entnahmezeitpunkt zählen. Bucket-Forschung liefert auch Gegenbefunde: Ein verständlicher Topf beweist keinen Renditevorteil. Vergleiche brauchen gleiche Anfangsallokation, Cashflows und Kostenbasis. [Reservevertrag](FACHKONZEPT.md#reserven-und-strategien), [Forschungsbelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-06).

Gold besitzt optionale Zielquote, unteren Rahmen und Verkaufsregeln. Baur und Lucey sowie Erb und Harvey untersuchen Krisen- und Inflationsschutz mit unterschiedlichen Befunden. Daraus folgt keine dauerhaft passende Goldquote. Zeitraum, Markt, Währung und Steuerannahme begrenzen die Übertragung; Quote und Steuerfrei-Flag bleiben Eingaben beziehungsweise Appregeln. [Goldbelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-07).

### Historische Marktpfade und Monte Carlo

Der Backtest rechnet Jahresrecords chronologisch. Die Daten reichen von 1925 bis 2025; vier Jahre Rückblick begrenzen auswählbare Starts auf 1929 bis 2025. Renditen und Makrowerte stammen aus dem Laufjahr, das CAPE-Entscheidungssignal aus dem Vorjahr. Heutige Haushaltsangaben laufen auf dieser Marktachse, ohne damalige Renten, Produkte oder Steuergesetze zu rekonstruieren. Backtesting dient der Diagnose; Forschung zu Daten- und Auswahlverzerrung begrenzt die Aussage. [Rechenvertrag](FACHKONZEPT.md#historischer-backtest), [Belege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-12).

Monte Carlo zieht aus derselben Jahresbasis viele Pfade. Feste Blöcke erhalten die Reihenfolge eines Abschnitts, Stationary Bootstrap verwendet zufällig lange Abschnitte. Zwei Regimeverfahren wählen Records nach Marktklassen, mit Übergängen oder unabhängiger Klassenwahl. Gemeinsame Jahresrecords erhalten die Beziehungen zwischen Aktien, Gold, Zins, Inflation und Lohn innerhalb eines Records; zeitliche Abhängigkeit hängt vom Verfahren ab. [Samplingvertrag](FACHKONZEPT.md#monte-carlo).

Efron, Künsch sowie Politis und Romano sind die Resampling-Methodenanker. Sie bestätigen nicht die konkrete Blocklänge, Gewichtung oder Datenauswahl. Die Aktienreihe ist eine Forschungsproxykette mit wechselnden Konventionen, kein investierbarer Anbieterindex. Der Vor-1950-Filter entfernt nicht alle Proxyannahmen. Mehr Läufe stabilisieren Modellquoten, ohne Datenfehler zu beseitigen. [Samplingbelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-08), [Datenherkunft](DATA_SOURCES.md).

### Regime und zusätzlicher Stress

Die Entnahmeregeln bilden Marktlabels aus festen Schwellen und können Signale glätten. Der Monte-Carlo-Markovpfad zählt dagegen Übergänge zwischen historischen Rendite-/Inflationsklassen und zieht danach. Das ist ein implementierter Übergangsmechanismus, kein geschätztes Modell verborgener Phasen nach Hamilton. ARCH/GARCH sind ebenfalls nicht implementiert; diese Forschungsarbeiten liefern den Vergleichsmaßstab. Schwellen und Zukunftsübertragung sind nicht extern validiert. [Regimebelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-09).

Das optionale Tail-Overlay ergänzt Schocks mit konfigurierter Häufigkeit, Schwere, Dauer und Erholung. Eine Regel vermeidet ausgewählte Überlagerungen mit historischen Krisenjahren. Forschung zu schweren Renditeschwänzen und Stresstestprinzipien begründet das Prüfen solcher Szenarien, kalibriert aber nicht die Einstellungen. Die Ereignisrate ist keine geschätzte Crashwahrscheinlichkeit; die gemeinsame Konsistenz von Aktien, Inflation, Zins und Gold bleibt offen. [Stressdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-10).

### CAPE als Renditeannahme

Die App verwendet CAPE-Bewertungsstufen und optional eine kontinuierliche Renditeregel für Dynamic Flex. Diese bildet aus dem CAPE-Kehrwert und einem Zuschlag einen begrenzten Aktienbeitrag, gewichtet ihn mit Gold und sicheren Anlagen und begrenzt und glättet die Portfoliorealrendite. Ungültiges oder fehlendes CAPE bekommt einen bezeichneten Ersatzwert. Eine separate Option beeinflusst die Startjahrauswahl. [Rechenvertrag](FACHKONZEPT.md#dynamic-flex).

Campbell und Shiller begründen den langfristigen Bewertungskontext; Welch und Goyal liefern Gegenbefunde zur Vorhersagegüte außerhalb der Entwicklungsdaten. Eine US-CAPE-Reihe in einer jährlichen Appregel sagt nicht die nächste Jahresrendite voraus. Ein Vorteil gegenüber konstanter Renditeannahme ist erst auf unangetasteten Daten zu prüfen. [CAPE-Belege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-11).

### Lebensdauer, Rente und Pflege

Altersabhängige Todesereignisse und ein Resthorizont aus Mittelwert oder Überlebensquantil bilden Lebensdauer ab. Bei Paaren berücksichtigt der Horizont das längere relevante Überleben. Quantilaufschlag, relative oder feste Puffer und Übergangsglättung ergänzen Vorsicht. Forschung zu unsicherer Lebensdauer und Annuitäten begründet die Fragestellung; sie bestätigt keine passende persönliche Pufferhöhe. [Lebensdauerdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-14).

Die Laufzeit verwendet die Destatis-Periodensterbetafel 2023/2025 für Männer und Frauen bis 100. Fortsetzung bis 110 und divers-Zuordnung sind Modellannahmen. Künftige Kohortenverbesserung, individuelle Gesundheit und Partnerabhängigkeit fehlen. Finanzwerte können für mehr Profile aggregiert werden, persönliche Lebensereignisse für höchstens zwei Personen. [Demografievertrag](DATA_SOURCES.md#demografie--pflege--und-hinterbliebenenvertrag), [Haushaltsgrenze](FACHKONZEPT.md#personen-und-haushalt).

Rentenbetrag, Beginn, Anpassung und Hinterbliebenenannahmen sind Eingaben. Rente mindert Bedarf, ohne nochmals freies Cash zu erzeugen. Eine neu entstehende Hinterbliebenenrente beginnt im Folgejahr. Amtliche Zeitreihen liefern Kontext, keinen individuellen Bescheid oder vollständigen Anspruchs-, Steuer- und Abgabennachweis. Brutto-/Nettobasis muss zu den Eingaben passen. [Rentenvertrag](FACHKONZEPT.md#rente-und-hinterbliebene), [Belege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-15).

Pflege kann Floor, Flex und Mortalität verändern. Der Simulator zieht Eintritt in Pflegegrad 1/2, Fortschreiten bis Grad 5 und akute Dauer; Kosten folgen den Eingaben. Destatis-Pflegebestand und Prävalenz 2023 dienen nur als Kontext; sie werden nicht durch Dauer geteilt und zu Eintrittsraten gemacht. Eintritt, Progression, Dauer, Kosten und Mortalität bleiben getrennte Modell- oder Nutzereinstellungen. Brown und Finkelstein liefern US-Versicherungskontext, keine deutsche Kalibrierung. [Pflegevertrag](FACHKONZEPT.md#pflege), [Pflegebelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-16).

Der Pflegebucket reserviert cash-nahes Vermögen außerhalb der normalen Entnahmebasis, erhält Cash-Ertrag und wird nicht automatisch aufgefüllt. Pflegegrad und Deckungsregel bestimmen die Nutzung vor zusätzlichen Verkäufen. Mental Accounting erklärt Zweckbindung, bestätigt weder Betrag noch Auslöser. Die Reserve ist Selbstfinanzierung im Modell, keine Versicherung. [Reservevertrag](FACHKONZEPT.md#pflegebucket), [Belege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-17).

### Vergleiche und Auto-Optimize

Replay hält einen Pfad für Varianten fest, Sweep untersucht Parameterkombinationen. Auto-Optimize filtert Kandidaten, bewertet führende Varianten genauer, untersucht Nachbarn und bestätigt bis zu drei auf getrennten Seeds. Der Champion wird nach der Bestätigungsbewertung gewählt und mit der aktuellen Konfiguration verglichen. Er ist der beste gefundene zulässige Kandidat für Suchraum und Bewertungsgröße. [Suchablauf](AUTO_OPTIMIZE_DETAILS.md#bewertung-und-suchstufen).

Forschung zu Mehrfachtests und Überanpassung erklärt, weshalb viele Versuche scheinbar gute Treffer liefern können. Getrennte Seeds stammen aus derselben Historie und demselben Generator; das Bestätigungsset dient außerdem zur Championauswahl. Es ist kein externer Markt-Holdout. Ein vollständiges dauerhaftes Versuchsinventar und unabhängige Bestätigungsstudien fehlen. Das Verfahren ist experimentell; Formularübernahme beschließt keinen Jahresplan und verändert kein Depot. [Forschungsbelege](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-13), [Übernahmevertrag](AUTO_OPTIMIZE_DETAILS.md#ergebnisstatus-und-übernahme).

## Begriffe

| Begriff | Bedeutung |
| --- | --- |
| Floor und Flex | Floor ist dein Grundbedarf, Flex dein veränderbarer Zusatzbedarf. |
| Mindest-Flex | Mindest-Flex ist die gewünschte untere Jahresgrenze des Haushalts-Flex ohne Auszahlungsgarantie. |
| Einschränkung | Einschränkung heißt gezahlter Haushalts-Flex einschließlich Rente streng unter dem positiven Jahresminimum. |
| Monte Carlo | Monte Carlo wertet viele zufällig erzeugte Modellpfade aus. |
| Bootstrap | Bootstrap zieht vorhandene Beobachtungen erneut. |
| Stationary Bootstrap | Stationary Bootstrap verbindet historische Abschnitte zufällig wechselnder Länge. |
| Sequenzrisiko | Sequenzrisiko bezeichnet die Wirkung der Renditereihenfolge auf ein Vermögen mit Entnahmen. |
| Guardrails | Guardrails passen Entnahmen bei festgelegten Auslösern an. |
| CAPE | CAPE setzt Aktienpreise zum über zehn Jahre gemittelten realen Gewinnniveau ins Verhältnis. |
| Dynamic Flex und VPW | Dynamic Flex leitet einen Entnahmerahmen aus Vermögen, Renditeannahme und Resthorizont ab. |
| Runway | Runway ist die Reichweite freier Liquidität bezogen auf Entnahme und Messzeitpunkt. |
| Regime | Ein Regime ist eine Marktklasse nach dem jeweiligen Appverfahren. |
| Tail-Overlay | Ein Tail-Overlay ergänzt konfigurierte extreme Stressereignisse. |
| Backtest | Ein Backtest rechnet eine Regel über historische Daten. |
| Floor-Deckungsquote | Die Quote zählt angeforderte Läufe ohne modellierten Ruin bis Laufende, sofern technische Fehler die Auswertung nicht sperren. |
| Ruin | Ruin ist der finanzielle Abbruch wegen fehlender aktiver Vermögensdeckung oder Floor-Auszahlung. |
| Quantil und Median | Ein Quantil ist eine Verteilungsposition, der Median deren Mitte und P10 das zehnte Perzentil. |
| Nominal und real | Nominal nennt den Modelljahresbetrag, real die Kaufkraft zur angegebenen Preisbasis. |
| Holdout | Ein Holdout enthält vorab zurückgehaltene Daten, die nicht zur Regelwahl verwendet wurden. |
| Kalibrierung | Kalibrierung prüft oder bestimmt Parameter anhand passender externer Daten. |
| Ablation | Eine Ablation verändert einen Baustein bei sonst gleichen Bedingungen. |

Die [Handbuchbegriffe](../../Handbuch.html#begriffe) erklären die Bedienperspektive. Das [Ergebnisregister](FACHKONZEPT.md#ergebnisregister-und-interpretationsregeln) definiert die Rechengrößen. Methodenbelege stehen bei den [Rechenbausteinen](#worauf-die-rechnung-beruht).

## Wie du die Ergebnisse liest

### Erfolgsquote und Laufende

Die Floor-Deckungsquote zählt die angeforderten Monte-Carlo-Läufe, die ohne modellierten Ruin enden. Dazu gehören sowohl der Tod aller simulierten Personen als auch das Erreichen des gewählten Horizonts. Ein noch lebender Haushalt am Horizontende ist nur bis dahin geprüft. Tod, Horizontende, Ruin und technischer Fehler werden getrennt ausgewiesen; technische Fehler machen die finanzielle Gesamtquote nicht auswertbar. Diese Quote misst weder die Chance eines unveränderten Lebensstandards noch eine Garantie bis zum realen Lebensende. [Ergebnisvertrag](FACHKONZEPT.md#ergebnisregister-und-interpretationsregeln), [Deckungsdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-01).

Historische rollierende Startfenster überschneiden sich. Ihr Erfolgsanteil beschreibt die untersuchten Fenster und ist keine Wahrscheinlichkeit aus unabhängigen Marktversuchen. Auch ein technisch reproduzierbarer Pfad bleibt an Daten, Haushalt, Regeln und Laufende gebunden. [Backtestgrenze](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-12).

### Einschränkungen richtig vergleichen

Bei positivem Start-Mindest-Flex misst Monte Carlo zunächst den Anteil der Einschränkungsjahre in jedem auswertbaren Lauf. Angezeigt wird der Median dieser Laufanteile, zusätzlich der Anteil der Läufe mit mindestens einer Einschränkung. Die Jahre aller Pfade werden nicht zusammengezählt. Der Backtest nennt Anzahl, Nenner und Anteil seines einzelnen Pfads. Gezählt werden nur auswertbare abgeschlossene Entnahmejahre bis Laufende; Ansparjahre und terminale Todes-, Ruin- oder Fehlerzeilen gehören nicht dazu. [Messung und Nenner](FACHKONZEPT.md#einschränkung-nach-fr-6), [Belegdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-04).

Ein Median von 0 % kann deshalb mit betroffenen Läufen zusammenfallen. Die Erklärung nennt den zum Laufstart eingefrorenen Mindestbetrag und seine jährliche Fortschreibung. Nachträglich geänderte Formulareingaben ersetzen diesen Wert nicht. Fehlende Jahreswerte ergeben keine erfundene Nullquote; technische Fehler sperren die betroffene Gesamtantwort. Bei Start-Mindest-Flex null oder älteren Resultaten ohne diese Messung bleibt die Altanzeige „mehr als 10 % unter Wunsch-Flex“. Ihre Berechnung zählt einschließlich genau 10 % und beschreibt etwas anderes als Mindest-Flex-Einschränkung. [Aktueller und älterer Ergebnisvertrag](FACHKONZEPT.md#einschränkung-nach-fr-6).

### Reihenfolge der Auswertung

1. Prüfe Eingaben, Datenstand, Fehlermeldungen und Laufende. Ein technischer Fehler ist kein schlechter Marktpfad.
2. Lies Floor-Deckung, Ruin und Liquidität. Die Reichweite freier Liquidität ist eine andere Größe als die Lebensdauer des Gesamtvermögens.
3. Lies Einschränkungen und tatsächlich gezahlten Flex. Eine bessere Floor-Quote bei geringerem Konsum ist ein Tausch zwischen Zielen.
4. Beziehe Steuern, Pflege, Stressdauer und Restvermögen ein. Ein höheres Endvermögen kann durch niedrigere Entnahmen entstanden sein.
5. Vergleiche Varianten erst bei gleicher Daten-, Seed-, Haushalts-, Horizont- und Kostenbasis. Ändere für einen zurechenbaren Vergleich zunächst einen Baustein.

Diese Reihenfolge verbindet die [Ergebnisverträge](FACHKONZEPT.md#ergebnisse-und-aussagegrenzen) mit den [offenen Nachweisen zu Ergebnissen und Vergleichen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise).

### Vermögensbasis und Verteilungen

P10, P50 und P90 zeigen verschiedene Positionen einer Modellverteilung. Eine Quantilkurve kann in jedem Jahr von einem anderen Lauf stammen; sie ist kein durchgehender Lebenslauf. Für einen zusammenhängenden Verlauf brauchst du einen Szenariopfad. Ein Median allein zeigt außerdem nicht, wie tief oder lange schlechte Ergebnisse ausfallen. [Kennzahlvertrag](FACHKONZEPT.md#ergebnisregister-und-interpretationsregeln), [offene Ergebnisfragen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#forschungsfragen).

Monte-Carlo-Endvermögen und das Vermögen des kanonischen historischen Backtests haben unterschiedliche Reservebasen: Monte Carlo verwendet das aktive Vermögen, der kanonische Backtest schließt den Pflegebucket ein. Reale Werte brauchen eine benannte Preisbasis; die reale Depotentnahme verwendet die Kaufkraft des Simulationsstarts. Ein Depoterschöpfungsindikator mit Aktien-/Goldschwelle misst ebenfalls etwas anderes als Floor-Ruin. Vergleiche daher gleich benannte Größen erst nach ihrem Berechnungsvertrag. [Vermögens- und Betragbasen](FACHKONZEPT.md#ergebnisregister-und-interpretationsregeln).

Pflegekennzahlen beschreiben modellierte Eintritte, Kosten und Finanzierung. Die Differenz der Endvermögensmediane von Läufen mit und ohne Pflege ist ein Vergleich verschiedener Gruppen. Unterschiedliche Lebensdauern und Ereignisse sind dabei nicht kontrolliert; die Differenz misst keine kausale Pflegewirkung. Auch eine vorhandene Reserve belegt keine passende Versorgungshöhe. [Pflegebelege und Ergebnisanker](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-16), [Reservegrenze](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-17).

## Was die App nicht kann und nicht behauptet

Das Anlagenmodell rechnet in EUR. Ein vollständiges Fremdwährungs-, Hedging-, Immobilien- oder Versicherungsmodell fehlt. TER, Spread und Slippage werden nicht als vollständige eigene Kosten-Cashflows simuliert. Die Steuerrechnung mit Verlustvortrag und Pauschbetrag ist eine Planungsschätzung; Renten- und Pflegeleistungsrecht werden nicht vollständig geprüft. [Geltungsbereich](FACHKONZEPT.md#modell-und-geltungsbereich), [Steuer und Kosten](FACHKONZEPT.md#steuern-und-reale-verkäufe).

Jahresschritte erfassen keine vollständige unterjährige Zahlungskette. Nicht erfasste Vermögen und geplante Zugänge wie Erbschaften fehlen. Die App führt keine Überweisungen oder Wertpapiergeschäfte aus. Die jährliche Handlungsanweisung ist eine Empfehlung; die nächste Rechnung folgt gepflegten Beständen. [Annahmen](FACHKONZEPT.md#annahmenregister), [Jahresbeschluss](FACHKONZEPT.md#jahresbeschluss-und-vorschau).

Eine Quelle, Formel oder ein grüner Test belegt keinen Nutzen der konkreten Appregel. Behauptet werden weder universell sichere Rate, garantierter Floor oder Mindest-Flex noch richtige Pflegereserve oder globales Champion-Optimum. Historische und simulierte Anteile sind keine gemessenen Zukunftswahrscheinlichkeiten. Auch Main Thread und Worker können denselben Modellfehler fortführen. [Nachweisgrenze](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#validierungsstufen).

## Forschungsrisiken und offene Fragen

Datenübertragung, eigene Entnahmeschwellen, CAPE, Lebensdauer und Pflege begrenzen die Aussage. Technische Prüfung, externe Kalibrierung und persönliche Eignung bleiben getrennt. Das [Risiko- und Fragenregister](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#forschungsrisiken) erhält alle bisherigen Kennungen.

Vorrang haben klare Rendite-/Kostenbasen, Vergleiche außerhalb der Entwicklungsdaten und Verteilungen von Floor-Lücken, Einschränkungen und Liquiditätsstress. Pflegeparameter brauchen gemeinsame Kalibrierung; Reserven und Gold Vergleiche bei gleichem Gesamtvermögen. [Priorisierte Fragen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#forschungsfragen).

Datenmanifeste, getrennte Outcomes, Realwertfortschreibung, Pflege-Driftnormalisierung und Mindest-Flex-Messung sind umgesetzt. Fehlende Studienprotokolle, Versuchsinventare, gesperrte Bestätigungsdaten und unabhängige Prüfungen stehen unter [Offene Nachweise](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise). Der frühere Backlog ist archiviert.

## Wie der Rahmen gepflegt wird

Bei Quellenänderungen werden zuerst Metadaten, Fassung, Datenstand und Abruf im Register geprüft, danach Quellenrolle, Übertragung und Rechendossiers. Anschließend folgen Haupttext und offene Nachweise. Nicht erreichbare Quellen bleiben mit letztem bestätigtem Stand und genauer Prüflücke sichtbar. [Pflegevertrag](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#aktualitaetsvertrag).

Codeänderungen erfordern passende Rechenbeschreibungen, Einheiten, Ergebnisdefinitionen und Verweise. Tests prüfen nur ihre abgedeckten Verträge. `docs:pruefen` kontrolliert Dokuverweise, `docs:evidence` Registerstruktur und Fristen ohne Netz; beide ersetzen keine Literaturprüfung oder Kalibrierung. [Prüfstufen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#validierungsstufen), [Testwege](../../tests/README.md).

Eine Wirkungsbehauptung braucht vorab festgelegten Vergleich, Baseline, Daten-/Kostenvertrag, alle Versuche, Holdout, Seeds und das Ergebnisbündel einschließlich negativer und instabiler Resultate. Ohne passende Nachweise bleiben Aussagen auf „implementiert“, „technisch getestet“ oder „im gewählten Szenario beobachtet“ begrenzt. [Nachweisvertrag](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise).
