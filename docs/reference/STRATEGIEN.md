# Strategien und Reserven

Welche Aufgabe Standard, Drei Töpfe, Gold und Rücklagen erfüllen. Für Nutzer und fachlich Interessierte. Codeprüfung: 27.10.2026.

## Auf einen Blick

- Die Strategie ordnet die Finanzierung der Entnahme; das [Jahresbudget](JAHRESBUDGET.md) bestimmt den Bedarf und die Flex-Rate.
- Gold ist ein optionaler Baustein, keine dritte Entnahmestrategie.
- Liquiditätsreserve und Pflege-Rücklage sind verschieden: Nur freie Mittel finanzieren das normale Budget.
- Keine Einstellung verspricht höhere Rendite oder sichere Deckung.

## Auswahl

### Standard

„Standard“ passt zu einer Planung mit freier Liquidität und Wachstumsanlagen, ohne gesonderte Anleihensteuerung. Die App prüft Schutzpuffer und Liquiditätsziel, plant erforderliche Verkäufe und legt freigegebene Überschüsse an. Im Bärenmarkt haben Schutz und begrenzte Notauffüllung Vorrang. Eine feste Aktienzielquote wird dabei nicht wiederhergestellt.

Vorhandene Anleihen werden auch im Standardpfad als Bestände berücksichtigt. Erst „3-Töpfe“ aktiviert die besondere Nutzung und Auffüllung des Anleihentopfs. Eine Warnung bei Anleihen im Standardmodus stellt die Strategie nicht automatisch um.

### Drei Töpfe

„3-Töpfe“ trennt freie Liquidität, Anleihen und Wachstumsanlagen. In einem schlechten realen Aktienjahr können Anleihen die vorgesehenen Verkaufsquellen ersetzen. Gute Jahre erlauben unter den bestehenden Schutzbedingungen den Wiederaufbau des Anleihentopfs aus Aktien. Freigegebenes Tagesgeld füllt zuerst fehlende Anleihen, danach Gold und Aktien.

Die Einstellungen bestimmen Zielgröße, Renditeauslöser und Auffüllschwelle. Ein leerer Anleihentopf bleibt ein Finanzierungsproblem; der Strategiename garantiert keine Auszahlung. [C14/C15](HANDLUNGSANWEISUNG.md#c14) beschreibt Sperren, Quellenersatz und Wiederauffüllung, [S3/S4](HANDLUNGSANWEISUNG.md#s3) die zusätzliche Deckungsprüfung im Simulator.

### Gold

Aktive Gold-Allokation ergänzt Standard oder Drei Töpfe. Zielquote, unterer Verkaufsrahmen und Rebalancingband haben verschiedene Aufgaben: Die Zielquote bestimmt den gewünschten Bestand, das Band löst reguläre Anpassungen aus, der untere Rahmen begrenzt Verkäufe. Notfälle können diesen Schutz lockern. Eine Goldposition ohne aktive Allokation erzeugt einen Hinweis; erst deine Wahl aktiviert die Einstellung.

Die Quoten beziehen sich auf die operative Geldvermögensbasis, ohne Immobilien und gesperrte Pflege-Rücklage. Gold verändert auch die gewichtete Renditeannahme für Dynamic Flex. Steuerfreiheit ist eine ausdrückliche Eingabe; die App prüft sie nicht aus der Haltedauer. Ausführlich: [Verkaufsquellen](HANDLUNGSANWEISUNG.md#verkaufsreihenfolge) und [Steuermodell](STEUERN.md#gewinn-und-teilfreistellung).

## Reserven

### Liquidität

Die Reserve für mehrere Jahre und „Mindest-Liquidität“ steuern den freien Zahlungsmittelvorrat. Letztere setzt einen Mindestpuffer aus dem Haushaltsbedarf vor Einkommen. Tagesgeld und Geldmarkt bilden dafür einen gemeinsamen freien Topf. Liquiditätsziel, harte Mindestreichweite und Tagesgeldziel sind unterschiedliche Größen; ihre Rechnung steht in der [Handlungsanweisung](HANDLUNGSANWEISUNG.md#liquiditätsziel).

Eine längere Reserve bindet mehr Geld außerhalb von Aktien und Gold. Sie kann Verkäufe zeitlich verschieben, kostet aber mögliche Marktbeteiligung. Eine Flex-Kürzung baut das Ziel nicht automatisch ab. Fällige geplante Ausgaben werden zusätzlich bereitgehalten.

### Pflege

Die „Pflege-Rücklage“ ist zweckgebunden und wird vom aktiven Geldvermögen getrennt. Ihr Betrag bleibt Bestandteil des Geldvermögens und damit des Gesamtvermögens, steht aber nicht für die gewöhnliche Entnahme bereit. Die Rücklage ist kein zweites Liquiditätsziel und wird nicht automatisch aus freien Mitteln aufgefüllt.

Bei mehreren Personen summiert die App aktivierte Beträge; die erste aktivierte Rücklage liefert Auslöser und Einstellungen. Unterschiedliche Einstellungen erzeugen eine Warnung. [Pflege](PFLEGE.md#reserve-und-flex) erklärt Freigabe, Deckungsumfang und Folgen im Modell.

## Folgen und Grenzen

### Beispiel

Max und Erika werden in den [erzeugten Beispielen](JAHRESBUDGET.md#max-und-erika-im-jahresvergleich) mit synthetischen Beständen vom 17.10.2026 gerechnet. Im Bärenjahr 2002 senken Alarm und Rundung die Entnahme; die [Handlungsanweisung](HANDLUNGSANWEISUNG.md#max-und-erika-im-bärenjahr) wartet bei ausreichender Liquidität. Eine gekürzte Auszahlung erzwingt also keinen Verkauf.

Für einen Strategievergleich müssen Anfangsbestände, Zeitraum, Bedarf und Ereignisse gleich sein. Eine Variante nur mit einem anders verteilten Portfolio beantwortet eine andere Frage als ein Wechsel der Handelsregel. Die zusätzlichen synthetischen Fälle mit Gold sowie Helga und Werner mit Anleihen und Pflege-Rücklage stehen als [technische Beispiele](TECHNICAL.md#vollständige-handelsbeispiele) bereit.

### Kein Wirksamkeitsversprechen

Reservehöhe, Anleihen und Gold können den Verlauf verändern. Ein einzelner historischer Pfad beweist keinen allgemeinen Vorteil. Mehr Reserven sind auch keine zusätzliche Vermögensquelle. Für Anlageklassen gelten vereinfachte Rendite- und Steuermodelle; Anleihen haben keine eigene Zinskurve oder Bonitätsentwicklung. Der [Forschungsrahmen](WISSENSCHAFTLICHER_RAHMEN.md) ordnet offene Nachweise ein.

## Wo du es in der App siehst

„Haushalt & Plan“ führt Strategie und Reserven. Balance zeigt Hinweise auf unpassende Bestände sowie Quellen und Verwendung. Der Simulator übernimmt die Planwerte; Varianten prüfst du auf gleicher Grundlage. Bedienung: [Plan pflegen](../../Handbuch.html#plan-pflegen) und [Balance lesen](../../Handbuch.html#balance-lesen).
