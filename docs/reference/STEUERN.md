# Steuern

Steuervereinfachungen und Zahlungsfinanzierung im Appmodell. Für fachlich Interessierte. Codeprüfung 23.11.2026; Rechtsquellen geprüft am 27.10.2026.

## Auf einen Blick

- Die App schätzt Steuer auf realisierte Kapitalgewinne und positive Guthabenzinsen.
- Verlustvortrag und Pauschbetrag werden jährlich verrechnet; persönliche Eigentümer bleiben maßgeblich.
- Erbschaftsteuer folgt einer vereinfachten Klassen- und Familienheimannahme.
- Renten und sonstige Einkünfte werden netto eingegeben; eine vollständige Einkommensteuererklärung wird nicht gerechnet.

## Kapitalanlagen

### Gewinn und Teilfreistellung

Steuer entsteht auf den Gewinnanteil eines Verkaufs, nicht auf seinen gesamten Erlös. Die App erhält beim Teilverkauf die anteiligen Anschaffungskosten. Neue Aktienkäufe übernehmen die Teilfreistellung aus dem Aktien-Neubestand derselben Person, sonst aus deren vorhandenem Aktienfonds; ohne Vorlage gilt der Aktien-ETF mit 30 %. Balance und Simulator wählen dieselbe Vorlage. Ein negativer Gewinn geht mit Vorzeichen in die Jahresrechnung ein.

Teilfreistellung vermindert den steuerlich berücksichtigten Gewinn oder Verlust. Für private Aktienfonds nennt [§ 20 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__20.html) 30 %; in der App ist das ein Verhältnis von 0,30. Die Produkteinordnung bleibt deine Aufgabe. Steuerfrei markierte Bestände gehen mit null in die Steuerbasis ein. Bei Gold ist die Steuerfreiheit eine Eingabe; die App prüft keine individuelle rechtliche Berechtigung.

### Simulierte Zukäufe

Die Einstellung „Simulierte Zukäufe“ gilt für den Haushalt in Backtest und Monte Carlo (FR-97). Beide Varianten übernehmen die Teilfreistellung aus der Vorlage derselben Person.

| Einstellung | Steuermodell |
|---|---|
| „in dasselbe Papier“ (Vorgabe) | Der Zukauf übernimmt die ISIN der Vorlage, sofern sie eine hat. Bei derselben Person und ISIN kommen die Stücke aus dem Anfangsbestand zuerst. Danach zählt die Kaufreihenfolge im Pfad. |
| „in ein eigenes Papier“ | Der Zukauf bleibt ohne ISIN. Er konkurriert bei der steueroptimierten Auswahl nach Steuer je Euro mit anderen verfügbaren Tranchen. Das passt etwa zu einem zweiten ETF auf denselben Index. |

Vorlage ist die älteste Neubestandstranche der Person, sonst ihre älteste Aktientranche. Fehlt der Vorlage die ISIN, bleibt sie auch am Zukauf leer. Für vorhandene Tranchen derselben Person und ISIN gilt in beiden Varianten die [Bankreihenfolge (FR-82)](HANDLUNGSANWEISUNG.md#verkaufsreihenfolge).

### Verlusttopf und Pauschbetrag

Die Jahresrechnung summiert steuerlich gewichtete Gewinne und Verluste, verrechnet zuerst den alten Verlustvortrag und dann den Pauschbetrag mit einem positiven Rest. Ein negativer Rest wird neuer Verlustvortrag. Nicht genutzter Pauschbetrag wird nicht ins Folgejahr übertragen.

[§ 20 Abs. 9 EStG](https://www.gesetze-im-internet.de/estg/__20.html) nennt 1.000 € je Person und 2.000 € bei zusammenveranlagten Ehegatten. Die App verwendet die eingetragenen persönlichen Werte. Sie bildet einen gemeinsamen Verlusttopf je Person; besondere Verlustverrechnungsgrenzen, etwa für direkte Aktienverluste, werden nicht getrennt gerechnet.

### Satz und Kirchensteuer

Mit Kirchensteuersatz k als Verhältnis lautet der verwendete Gesamtfaktor einschließlich Solidaritätszuschlag:

`0,25 / (1 + 0,25 × k) × (1 + 0,055 + k)`

Das ergibt ohne Kirchensteuer 26,375 %, bei 8 % Kirchensteuer 27,8186 % und bei 9 % 27,9951 %. Die Minderung der Kapitalertragsteuer durch Kirchensteuer folgt [§ 32d Abs. 1 EStG](https://www.gesetze-im-internet.de/estg/__32d.html). Die App rechnet keine anrechenbare ausländische Quellensteuer und keine Günstigerprüfung.

### Persönliche Jahresrechnung

Verkaufsgewinne und Steuer bleiben beim Eigentümer. Bei aktiver Zusammenveranlagung und genau zwei Personen werden zunächst persönliche Verluste, dann Verluste gegen positive Partnererträge und schließlich eigene sowie ungenutzte Partner-Pauschbeträge verrechnet. Restverluste bleiben beim ursprünglichen Eigentümer. Bei „Nicht verheiratet“ rechnet die App stets getrennt. Dasselbe gilt ohne aktiven Schalter. Der gemeinsame Plan hält diese Wahl; die [Bedienung](../../Handbuch.html#partnerschaft-todesfall) erfolgt unter Partnerschaft.

Im Simulator zählen reguläre Verkäufe, verbrauchte Geldmarktbestände, zusätzliche Deckungsverkäufe und positive Guthabenzinsen zum selben Steuerjahr. Zinsen auf den bar gehaltenen Teil der Pflegereserve zählen bei den Eigentümern wie Tagesgeldzinsen. Negative Zinsen mindern das Guthaben, erzeugen aber keinen steuerlichen Verlust. Gegenläufige Käufe und Verkäufe derselben Person werden vor der Buchung und der Steuerfortschreibung verrechnet. Ein aufgehobener Verlustverkauf erzeugt keinen Verlustvortrag. Der Jahresabschluss gleicht bereits reservierte Steuer ab. Auch Verkäufe für Erbschaft- oder Wohnrechtsteuer gehen in dieses Jahresbuch; der Pauschbetrag wird nicht je Verkauf neu gewährt. Reicht die Finanzierung einschließlich Folgesteuer nicht, scheitert die Deckung. Die [Handlungsanweisung](HANDLUNGSANWEISUNG.md#c16) erklärt den Übergang von Plansteuer zu endgültiger Steuer.

## Erbe

### Klassen und Befreiungsannahmen

Die App kennt für die Partnerrechnung zwei Fälle. Persönliche Freibeträge orientieren sich an [§ 16 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__16.html), die Tarife samt Härteausgleich an [§ 19 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__19.html).

| Appstatus | Freibetrag | Tarif auf den steuerpflichtigen Gesamterwerb |
|---|---:|---|
| Verheiratet | 500.000 € | Klasse I: 7 / 11 / 15 / 19 / 23 / 27 / 30 % |
| Nicht verheiratet oder Status fehlt | 20.000 € | Klasse III: 30 % bis einschließlich 6 Mio. €, darüber 50 % |

Fehlt die Angabe oder der ganze Partnerschaftsdatensatz, rechnet die App ohne Versorgungsfreibetrag, Familienheim-Befreiung und Zugewinnabzug. Erbvorschau und Protokoll zeigen „Partnerschaftsstatus fehlt“.

Bestattungs- und Abwicklungskosten mindern den Geldnachlass vor der Aufteilung. Kürzt die [Pflichtteil-Sicherung](TOD_UND_ERBE.md#pflichtteil-der-kinder) den Geldanteil, zählt der gekürzte Erwerb für die Steuer der überlebenden Person. Das gilt auch für die Sofortzahlung und den Steuersatz bei jährlicher Besteuerung nach § 23 ErbStG.

Die Grenzen der Klasse I sind 75.000 / 300.000 / 600.000 / 6 Mio. / 13 Mio. / 26 Mio. €. Den steuerpflichtigen Erwerb rundet die App nach allen Abzügen auf volle 100 € ab, wie [§ 10 Abs. 1 Satz 6 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__10.html) es vorschreibt. Der Stufensatz gilt für den ganzen steuerpflichtigen Erwerb; an Übergängen begrenzt der Härteausgleich den Sprung. Auch 100 % Erbquote bedeutet keine Steuerfreiheit. Die [Zahlungsfolge](TOD_UND_ERBE.md#zahlung) erklärt die Finanzierung sofortiger Erbschaftsteuer.

Bei Ehe nimmt die App je verstorbener Person nur die wertvollste erworbene selbst genutzte Immobilie als steuerfreies Familienheim an. Weitere selbst genutzte und vermietete Immobilien bleiben steuerpflichtig. Sie zeigt „Familienheim-Befreiung angenommen“. [§ 13 Abs. 1 Nr. 4b ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__13.html) verlangt unter anderem Selbstnutzung durch den Erwerber und sieht eine zehnjährige Bindung mit Ausnahmen vor. Die App prüft diese Voraussetzungen nicht. Beispiel ohne weitere Abzüge: 500.000 € Geld, Familienheim 600.000 € und Ferienwohnung 300.000 €, vollständig an den Ehepartner, ergeben 300.000 € steuerpflichtigen Erwerb und 33.000 € Steuer.

### Zugewinnausgleich

Bei Ehe gilt ohne andere Vorgabe Zugewinngemeinschaft, auch für alte Pläne und Sicherungen. Anfangsvermögen ist das Geldvermögen einschließlich Pflegereserve und der eigene Immobilienwert beim Planstart („Heirat = heute“); Ehejahre davor zählen nicht, deshalb kann die echte Steuer bei langer Ehe niedriger oder höher sein. Das Anfangsvermögen wächst bis zum Todesjahr mit der Inflation des Pfads.

Jeder geplante Zufluss erhöht ab seinem Jahr das Anfangsvermögen der empfangenden Person. Nur die Pfadinflation ab diesem Zuflussjahr wird darauf angewendet. [§ 1374 Abs. 2 BGB](https://www.gesetze-im-internet.de/bgb/__1374.html) ordnet Erbschaften und Schenkungen dem Anfangsvermögen zu; die App behandelt alle geplanten Zuflüsse so, weil andere Zuflüsse meist bereits beim Planstart vorhandene Werte abbilden.

`Zugewinn je Person = max(0, Vermögen vor Erbaufteilung − Anfangsvermögen × Inflationsfaktor)`

Hat die verstorbene Person mehr Zugewinn, bildet die halbe Differenz die Ausgleichsforderung, höchstens den Erwerb des Partners. Bei einem steuerfreien Familienheim wird sie nach [§ 5 Abs. 1 Satz 6 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__5.html) anteilig gekürzt. Für Erwerbe ab 29.12.2020 gilt:

`Steuerfreier Zugewinnbetrag = Ausgleichsforderung × (Endvermögen − steuerfreier Familienheimanteil) / Endvermögen`

Das Endvermögen umfasst Geld und Immobilien der verstorbenen Person vor der Erbaufteilung. Bei Teilquoten zählt der steuerfreie Familienheimanteil. Beispiel: 2,2 Mio. € Geld, 2 Mio. € Familienheim und 500.000 € Ausgleichsforderung ergeben 261.905 € steuerfreien Zugewinnbetrag und 273.220 € Steuer. Der Betrag wirkt zusätzlich zu Freibetrag und Familienheim. Gütertrennung und unverheiratete Haushalte erhalten diesen Abzug nicht. Die heutige Vorschau enthält keinen Zugewinn.

Der Zugewinnausgleich bleibt vereinfacht. Frühere Ehejahre, Vorerwerbe und weitere Befreiungen fehlen. Bestattungs- und Abwicklungskosten mindern den Geldnachlass, während der Zugewinn aus dem Vermögenszuwachs vor dem Kostenabzug berechnet wird. Für Immobilien verwendet die App den fortgeschriebenen eingegebenen Wert.

### Versorgungsfreibetrag

Bei Ehe oder eingetragener Partnerschaft erhält die überlebende Person neben dem persönlichen Freibetrag einen Versorgungsfreibetrag nach [§ 17 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__17.html). Der Güterstand spielt keine Rolle, auch Gütertrennung erhält ihn. Ohne Ehe gibt es ihn nicht. Die App kürzt ihn vorsichtig um die eingetragene Hinterbliebenenrente:

`Versorgungsfreibetrag = max(0, 256.000 € − Jahreswert × BMF-Faktor − Sterbevierteljahr)`

Jahreswert ist die Hinterbliebenenrente für ein volles Jahr, so wie die App sie rechnet: der eingestellte Prozentsatz der Rente der verstorbenen Person abzüglich der Anrechnung der eigenen Rente. Beginnt die eigene Rente erst im Laufe des Todesjahrs, zählt sie für die Anrechnung schon ganz. Der BMF-Faktor ist derselbe wie beim Wohnrecht, mit vollendetem Alter am 1. Juli des Todesjahrs. Die drei Monate volle Rente des Sterbevierteljahrs kommen als Einmalbetrag dazu ([R E 17 Abs. 3 ErbStR](https://ao.bundesfinanzministerium.de/erbsth/2020/A-ErbStG-ErbStDV-BewG/ErbStG/III-Berechnung-der-Steuer/Paragraf-17/inhalt.html)). Rechnet die App im Todesjahr keine Hinterbliebenenrente, etwa beim Tod vor dem Rentenbeginn der verstorbenen Person, bleibt der Freibetrag ungekürzt. Fehlt bei eingetragener Rente das Alter, rechnet sie ohne Versorgungsfreibetrag.

Der Betrag mindert den steuerpflichtigen Erwerb zusätzlich zu Familienheim und Zugewinnabzug, vor Tarif und Härteausgleich. Bei der jährlichen Wohnrechtsteuer mindert er auch Satz und Freibetragsrest. Die heutige Vorschau rechnet ihn nicht.

Beispiel ohne Sterbevierteljahr: Eine Witwe ist 70 Jahre alt und erhält 300 € Hinterbliebenenrente im Monat. Nach dem persönlichen Freibetrag bleiben 750.000 € Erwerb. 3.600 € Jahreswert × 11,107 ergeben 39.985,20 € Kapitalwert und 216.014,80 € Versorgungsfreibetrag. Steuerpflichtig sind 533.985,20 €, abgerundet 533.900 €. Die Steuer beträgt 15 % = 80.085 €. Andere Hinterbliebenenbezüge, etwa aus Betriebsrente oder Beamtenversorgung, kürzen in der App nicht.

### Wohnrecht und jährliche Zahlung

Ein Wohnrecht erzeugt im Modell einen steuerlichen Kapitalwert, aber kein Immobilieneigentum. Je selbst genutztem Anteil gilt:

`Jahreswert = min(12 × ortsübliche Monatsmiete, Immobilienwert / 18,6)`

Ohne Mietangabe gelten 4 % des Werts. Eine eingetragene Miete von 0 € ergibt einen Jahreswert von 0 €. Wert und Miete wachsen bis zum Erbfall mit derselben Inflation. Kapitalwert = Jahreswert × amtlicher BMF-Faktor nach vollendetem Alter und Geschlecht der berechtigten Person. Die Vorschau leitet das Alter aus dem Geburtsdatum zum aktuellen Datum ab, die Simulation am modellierten Todestag, dem 1. Juli des Todesjahrs. Ohne Geburtsdatum gilt das bisherige Planungsalter. Fehlt das Geschlecht, gelten Frauenwerte.

Die Erbvorschau wählt die BMF-Tabelle nach dem laufenden Jahr, im Spielbereich nach dem Testdatum. Im Rechenlauf gilt das Todesjahr. Für 2026 und früher gilt die Tabelle 2026, ab 2027 die Tabelle 2027 bis zur nächsten mitgelieferten Anlage. [Quelle und Stand der BMF-Tabellen](DATA_SOURCES.md#wohnrechtbewertung). Die Jahreswertgrenze folgt [§ 16 BewG](https://www.gesetze-im-internet.de/bewg/__16.html).

| Wahl „Wohnrechtsteuer“ | Todesjahr | Folgejahre |
|---|---|---|
| „sofort“ | Steuer auf Erwerb einschließlich Kapitalwert, mit Härteausgleich | Keine Jahressteuer auf das Wohnrecht |
| „jährlich (§ 23 ErbStG)“ | Geld-/Eigentumserwerb nach Freibetrag × effektiver Satz des Gesamterwerbs einschließlich Wohnrecht | Verbleibender Jahreswert × festgehaltener effektiver Satz |

Beide Wahlen verwenden dieselbe Tarifermittlung mit Härteausgleich (§ 19 Abs. 3 ErbStG). Der effektive Satz ist die Steuer auf den steuerpflichtigen Gesamterwerb geteilt durch diesen Erwerb. Ohne Wohnrechtswert sind beide Wahlen identisch; es entsteht keine Jahressteuer. [Entstehung und Ende des Wohnrechts](TOD_UND_ERBE.md#wohnrecht-und-eigentum) richten sich nach dem Pflege- und Lebenszustand.

Bei der jährlichen Wahl werden persönlicher Freibetrag, steuerfreier Zugewinnausgleich und Versorgungsfreibetrag zuerst vom Geld-/Eigentumserwerb verbraucht. Der Rest wird von den kommenden Jahreswerten aufgezehrt. Ist der Gesamterwerb steuerfrei, sind Satz und Jahressteuer null. Die nominal feste Vorauszahlung beginnt im Folgejahr vor Renditen, Zinsen und Budgetrechnung. Sie endet mit Tod oder Heimpflege der berechtigten Person, unabhängig vom Pflegegrad; es gibt keine anteilige Erstattung im Endjahr. Finanzierung: persönliches Tagesgeld beziehungsweise Verkäufe samt deren Kapitalertragsteuer. Die Zahlung steht außerhalb des Jahresbudgets. Was am Jahresende offen bleibt, wird als [Steuerschuld](PFLEGE.md#steuerschuld-und-tod) im Folgejahr fällig.

[§ 23 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__23.html) beschreibt die Jahresversteuerung im Voraus; [BMF H E 23](https://erbsth.bundesfinanzministerium.de/erbsth/2020/A-ErbStG-ErbStDV-BewG/ErbStG/IV-Steuerfestsetzung-und-Erhebung/Paragraf-23/h-23.html) erläutert den Restfreibetrag. Die Appwahl ist keine allgemeine Stundung. Unterjährige Fälligkeiten, Ablösung, Kürzungsmethode und nachträgliche Berichtigung werden nicht simuliert. Die [Nachlassseite](TOD_UND_ERBE.md#nachlass) erklärt Eigentum und Verteilung.

### Rente aus dem Erbe

Bei „Verkauf, Miete auf Lebenszeit“ ist der steuerliche Jahreswert der zwölffache Monatsbetrag, mit Inflation vom Planstart bis zum Ende des Todesjahrs fortgeschrieben. Der Immobilienwert begrenzt den Jahreswert der Geldrente nicht. Für den Kapitalwert verwendet die App dieselben Alters- und Geschlechtsfaktoren wie beim Wohnrecht. Die Familienheim-Befreiung entfällt für das verkaufte Haus.

Die Wahl „sofort“ rechnet die Steuer im Todesjahr. „Jährlich (§ 23 ErbStG)“ verwendet denselben Satz und Freibetragsverzehr wie beim Wohnrecht. Der im Todesjahr festgehaltene Jahreswert bleibt für die Vorauszahlungen nominal fest. Er wird auch im Heim weiter versteuert, bis die berechtigte Person stirbt. Die Lebenszeit-Zahlung selbst folgt der Inflation im jeweiligen Jahr. Eine Einkommensteuer auf diese Rente bildet die App nicht ab.

### Wohnkapital

Bei „Verkauf mit Wohnkapital“ ist das Wohnkapital ein Geldvermächtnis. Bei „Auszug nach 0 Jahren“ zählt es im Todesjahr zusammen mit dem Geldanteil und geerbten vermieteten Anteilen zum Erwerb. Bei Ehe mit 700.000 € Geld und 54.000 € Wohnkapital sind nach 500.000 € Freibetrag 254.000 € steuerpflichtig. Die Steuer beträgt 27.940 €.

Beim späteren Auszug berechnet die App die Steuer auf den Erwerb aus dem Todesjahr und das Wohnkapital zusammen. Der Freibetrag zählt einmal. Die App zieht von der Gesamtsteuer die bereits im Todesjahr angesetzte Steuer ab. Den Rest behält sie vom Wohnkapital ein und weist ihn in der Steuersumme des Auszugsjahrs aus. Im Beispiel oben fallen bei unveränderten Werten zuerst 22.000 € und im Auszugsjahr weitere 5.940 € an. Grundlage ist die [Zusammenrechnung nach § 14 ErbStG](https://www.gesetze-im-internet.de/erbstg_1974/__14.html).

Der Verkauf lässt die Familienheim-Befreiung entfallen. Die [Nachlassseite](TOD_UND_ERBE.md#verkauf-mit-wohnkapital) erklärt den Zeitpunkt von Verkauf und Mietbeginn.

### Wohnrechtbeispiel

Synthetische Rechenvariante Max und Erika, geprüft am 27.10.2026, ohne Ehe und Inflation: Erika ist im Todesjahr 70. Max hinterlässt 600.000 € Geld und ein Haus für 600.000 €. Sie erhält ein Drittel des Gelds und Wohnrecht, ohne Mietangabe. Jahreswert 24.000 € × Frauenfaktor 11,107 = 266.568 € Kapitalwert. Nach 20.000 € Freibetrag sind 446.568 € steuerpflichtig, abgerundet 446.500 €. „Sofort“ ergibt 133.950 €; „jährlich“ ergibt 54.000 € im Todesjahr und danach 7.200 € pro Jahr bis Tod oder Heimpflege. Ist Erika bereits im Heim, ergeben beide Wahlen nur 54.000 € und keine Wohnrechtsteuer.

## Eingaben und Grenzen

### Netto und Beispiel

Renten, Nettomieten und sonstige Einkünfte sind verfügbare Nettobeträge; ziehe deren Steuern und Abgaben vor der Eingabe ab. Immobilienverkäufe enthalten im Modell keine Einkommensteuer. Vorabpauschalen, vollständige Ausschüttungsbesteuerung und Sozialabgaben werden nicht gesondert als vollständiges Steuermodell berechnet. Fondskosten und die Quellensteuer im Fonds fasst der Planwert „Laufende Kosten Aktien-ETF“ in Haushalt & Plan pauschal zusammen, Vorgabe 0,5 % pro Jahr (FR-76). Backtest und Monte Carlo ziehen ihn von der Aktienrendite ab, Dynamic Flex von der erwarteten Rendite; die Kurse in Balance enthalten diese Kosten schon.

Synthetische Rechenvariante Max und Erika, geprüft am 27.10.2026: Max verkauft für 30.000 € mit 15.000 € Gewinn. 30 % Teilfreistellung ergeben 10.500 € steuerlich gewichteten Gewinn. Nach 1.500 € Verlustvortrag und 1.000 € Pauschbetrag bleiben 8.000 €. Ohne Kirchensteuer sind das 2.110 € Steuer und 27.890 € Nettoerlös. Erika wird getrennt abgerechnet; Partnerausgleich ist hier ausgeschaltet. Die Jahresrechnung enthält keine weiteren Erträge.

### Wo du es in der App siehst

„Personen & Vermögen“ führt persönliche Steuerangaben und Erbvorschau. Balance zeigt die vorgeschlagene Verkaufssteuer; der Simulator ergänzt tatsächliche Jahresbuchungen. „Erbschaftsteuer“, „Steuer Wohnrecht (§ 23)“ und „Erbschaftsteuer jährlich (§ 23)“ bei der Rente aus dem Erbe stehen getrennt von der jährlichen Kapitalertragsteuer. Das ⓘ zur Erbschaftsteuer nennt ein Wohnkapital mit Betrag. Bedienung: [Handbuch](../../Handbuch.html#balance-verlusttopf). Die [technischen Belege](TECHNICAL.md#lebensereignisse-und-steuer-belegen) führen zu Rechnung und vorhandenen Prüfungen.

### Modellgrenzen

- Planungsschätzung mit einem Verlusttopf, kein Broker- oder Finanzamtsbescheid.
- Familienheimbefreiung und Wohnrechtsdauer werden angenommen; rechtliche Voraussetzungen und Fristen werden nicht geprüft.
- Tatsächliche Steuerzahlungen können zeitlich und der Höhe nach abweichen. Im Erbfall ist eine persönliche steuerliche Prüfung nötig.
