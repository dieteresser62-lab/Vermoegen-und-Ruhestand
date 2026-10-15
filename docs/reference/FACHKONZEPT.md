# Fachkonzept

Vermögen & Ruhestand verbindet erfasste Bestände mit einem jährlichen Entnahmeplan und Modellpfaden. Personen, Einkommen, Bedarf und Anlagen bilden die Eingaben. Die Engine schlägt Entnahmen und Umschichtungen vor. Der Nutzer entscheidet über reale Überweisungen und Wertpapiergeschäfte; die App führt sie nicht aus.

Das Modell folgt dem fachlichen Aufbau des Whitepapers: Haushalt, Zeit- und Geldbasis, Entnahme, Reserven, Steuern, Lebensereignisse und Aussagegrenzen. Maßgeblich für das implementierte Verhalten sind die verlinkten Quellmodule. FR-1 bis FR-5 stehen unter [Jahresbeschluss und Vorschau](#jahresbeschluss-und-vorschau), FR-6 unter [Einschränkung](#einschränkung-nach-fr-6). Begriffe erklärt das [Handbuch](../../Handbuch.html#glossar). Die [technische Architektur](TECHNICAL.md) beschreibt Laufzeiten und Rechenpfade, [Datenverträge](DATENVERTRAEGE.md) die gespeicherten Belege.

## Modell und Geltungsbereich

### Anlagen und Vermögensbasis

Das Modell umfasst Aktien-ETF-Tranchen, Geldmarkt, Tagesgeld sowie optionale Gold- und Anleihenbausteine. [tranche-contract.js](../../types/tranche-contract.js) trennt `equity`, `money_market`, `gold` und `bonds`. Stückzahl mal Kurs ergibt den Bestandswert. Historische Renditeproxies bilden die Pfade; sie sind keine genaue Rekonstruktion des gehaltenen Produkts.

Die Rechnung verwendet EUR. [market-price-adapter.js](../../app/shared/market-price-adapter.js) weist Nicht-EUR-Quotes zurück. Ein FX-, Hedging-, Immobilien- oder vollständiges Multi-Asset-Modell fehlt. Anleihen verwenden im Simulator den Cash-Rate-Proxy, ohne Duration, Bonität, Kupons oder Zinskurven abzubilden.

Ein aktivierter Pflegebucket ist vom aktiven Vermögen abgetrennt. Er steht weder für Dynamic Flex noch für die normale Liquiditätsreichweite frei zur Verfügung.

### Personen und Haushalt

[profile-registry.js](../../app/profile/profile-registry.js) trennt geöffnete Person und Haushaltszugehörigkeit. Ein Personenwechsel ersetzt die Mitglieder des gemeinsamen Plans nicht. Außenprofile bleiben eigenständige Bereiche.

[Personen & Vermögen](../../depot-tranchen-manager.html) bleibt die Quelle für Personendaten, reale Bestände und gemeinsame Planwerte. Auf einen Blick zeigt Tagesgeld, Nettorente und sonstige Einkünfte direkt zur Eingabe. Tagesgeld speichert beim Verlassen des Feldes oder mit Enter; die übrigen Profilfelder speichern automatisch. Unter Haushalt & Plan stehen Grundbedarf, Wunschbedarf und Mindest-Flex offen, die übrigen Werte unter Weitere Planwerte. Balance und Simulator übernehmen den Plan lesend; Nur hier ausprobieren aktiviert einen lokalen Versuch, Zurück zum Plan verwirft ihn. Die Klappbereiche ändern nur die Sichtbarkeit, nicht die wirksamen Werte.

Finanzielle Werte mehrerer Profile können aggregiert werden. [simulator-profile-inputs.js](../../app/simulator/simulator-profile-inputs.js) bildet individuelle Pflege-, Sterblichkeits- und Hinterbliebenenpfade für höchstens zwei Personen ab. Bei mehr Profilen erscheint die Warnung zu dieser Grenze.

### Jahresbeschluss und Vorschau

[annual-plan-record.js](../../app/profile/annual-plan-record.js) hält Empfehlung und beschlossenen Jahresplan getrennt. Bewusst geänderte Planfelder werden mit `adjusted` und `adjustedFields` belegt. Der Monatsbetrag folgt weiterhin der Rechnung. Unterjährige Vorschauen überschreiben diesen Beleg nicht.

Nach FR-1 und FR-2 ist die jährliche Handlungsanweisung die festgehaltene Empfehlung. Der Nutzer entscheidet über ihre Umsetzung, ohne Pflichtschritt oder Begründung. Die nächste Rechnung verwendet gepflegte Bestände; geplante Zugänge wie Erbschaften haben keinen Eingabevertrag. [balance-action-origin.js](../../app/balance/balance-action-origin.js) und [balance-next-steps.js](../../app/balance/balance-next-steps.js) trennen Jahresstatus und heutige Vorschau.

FR-3 bis FR-5 verlangen getrennte Planbelege, besuchte Vorbereitungsschritte und ausdrücklich bestätigtes Tagesgeld je Person. Überweisungen und Wertpapiergeschäfte erscheinen nur als Information. Der Hauptklick führt ohne weitere Rückfrage zum Abschluss. Jahr und anschließender Dezembermonat besitzen getrennte Speichergrenzen.

## Zeit und Geld

### Jahresachse und Betragbasis

Floor, Flex und Mindest-Flex sind nominale Beträge des aktuellen Modelljahrs. Die Engine inflationiert sie nicht erneut. Der Simulator schreibt den Bedarf mit der Inflation dieses Jahres für das Folgejahr fort.

`cumulativeInflationFactor` hält die Kaufkraftbasis des ersten Simulatorjahrs. Reale Entnahme ist effektive nominale Entnahme geteilt durch den aktuellen Faktor. Erst der Rückgabestate schreibt ihn einmal mit `1 + inflation / 100` fort; die Engine erhält denselben Faktor als Spiegel. Die Quellen sind [simulator-engine-helpers.js](../../app/simulator/simulator-engine-helpers.js), [simulator-year-result.js](../../app/simulator/simulator-year-result.js) und [cumulative-inflation-contract.js](../../types/cumulative-inflation-contract.js).

Geldbasis und Messzeitpunkt gehören zu jeder Kennzahl. Die Mindest-Flex-Messung verwendet nominale Jahresbeträge; ein realer Jahresendwert kann einen anderen Zeitpunkt als die reale Entnahme haben.

### Kalender und Rente

[profile-person-data.js](../../app/profile/profile-person-data.js) berechnet das Planungsalter am 1. Januar, das heutige Anzeigealter dagegen am Appdatum. Beide werden aus dem Geburtsdatum abgeleitet. Der Jahresabschluss schreibt kein gespeichertes Alter hoch.

Eine Rente ab Juli umfasst im ersten Jahr sechs Monatsbeträge, vor dem Jahr zwölf und nach dem Jahr null. Der Beginnmonat zählt unabhängig vom Tag. Datierte Altangaben haben einen Migrationsvertrag; fehlende Daten werden nicht erfunden. Ein Backtest verwendet heutige Personenangaben auf einer historischen Marktjahresachse und rekonstruiert keine historische Steuer- oder Produktwelt.

### Folge eines Simulatorjahres

| Phase | Rechnung und Zeitbezug |
| --- | --- |
| Markt und Ereignisse | Jahresrecord bestimmen, Pflege fortschreiben, Mortalität ziehen; Tod aller Personen kann vor dem Finanzschritt beenden |
| Anfangsbestände | Aktien-/Goldrendite und Bond-Proxy vor Auszahlung anwenden |
| Bedarf | Pflegezusatz und Rente in aktuellen nominalen Jahreswerten verrechnen |
| Planung | Marktregime, Dynamic Flex, Spending-Policies und Liquiditätsaktion berechnen |
| Finanzierung | Vorschlag auf Simulatorportfolio anwenden, Pflegebucket und Forced Sales prüfen |
| Jahresende | Liquiditätszins und Steuer aus sämtlichen Jahresverkäufen reconciliieren |
| Folgejahr | Bedarf, Mindest-Flex, Budget und laufende Renten fortschreiben |

Die Folge liegt in [mc-life-events.js](../../app/simulator/mc-life-events.js), [simulator-engine-direct.js](../../app/simulator/simulator-engine-direct.js) und [simulator-year-result.js](../../app/simulator/simulator-year-result.js). Sie verändert das reale Depot nicht.

## Entnahme

### Grundbedarf und Zusatzbedarf

Floor ist der eingegebene jährliche Grundbedarf. Flex ist der veränderbare Zusatzbedarf. Eine reale Flexibilität wird nicht aus historischen Ausgaben geschätzt; sie folgt der Eingabe. Der Pflegezusatz kann den Floor im Simulator erhöhen.

Die Rente mindert zuerst Floor, danach Flex. Für Jahresrente `R`, aktuellen Brutto-Floor `F` und Flex `X` ergibt sich der Ausgangspunkt:

```text
Netto-Floor = max(0, F − R)
Rentenüberschuss = max(0, R − F)
Offener Flex = max(0, X − Rentenüberschuss)
Portfolioentnahme = Netto-Floor + freigegebener offener Flex
```

[engine/core.mjs](../../engine/core.mjs) und [simulator-household-pension.js](../../app/simulator/simulator-household-pension.js) verrechnen den Jahreszufluss gegen den Bedarf. Er wird nicht nochmals als freier Cashzufluss gebucht. Haushaltsbudget und Portfolioentnahme bleiben dadurch verschieden. Die sichtbare Monatsauszahlung folgt der finalen Quantisierung; ein Zwischenwert aus Rate und Basis ist noch nicht der tatsächlich ausgezahlte Flex.

Die historischen Namen `inflatedBedarf.floor` und `inflatedBedarf.flex` bezeichnen im laufenden Engineaufruf die aktuellen nominalen Nettowerte. Der Name allein rechtfertigt keine zweite Inflationsrechnung.

### Policies und Reihenfolge

[MarketAnalyzer](../../engine/analyzers/MarketAnalyzer.mjs) bestimmt das Marktregime. Alarm-, Vermögens-, Erholungs- und Entnahmequotenregeln beeinflussen die Flex-Rate. Die Enginepolicy kombiniert eigene Regeln; deren Wirkung ist nicht allein durch die Bezeichnung Guardrail belegt.

Die Leitplanken behalten ihre Historie bei normalen Jahres-, Markt- und Inflationswechseln. Nur eine bewusste Änderung von Bedarf oder Plan beginnt sie neu: Bedarfswerte, Flex-Budget, Reserven, Strategie, Dynamik und Haushaltsverteilung. Das gilt für Haushalt & Plan und Anpassungen im Jahresabschluss, auch bei kleinen Betragsänderungen. CAPE, Bestände und Renten zählen nicht dazu. Balance und Simulator verwenden dafür [guardrail-history.js](../../app/shared/guardrail-history.js); Steuerstände bleiben erhalten.

[spending-policy-pipeline.mjs](../../engine/planners/spending-policy-pipeline.mjs) bindet die Reihenfolge an `SpendingPolicyOrderV2`: Nach Alarm und Guardrails folgen Mindest-Flex, Flex-Budget, finale Glättung und Safety-Cap. Das [Ablaufdiagramm der Entnahme-Kette](ENGINE_DECISION_LOGIC.md#bedarf-und-flex-trace) zeigt auch das Notlage-Gate.

Mindest-Flex darf die vorherige Rate anheben, wenn keine Notlage blockiert. Das [Minimum-Modul](../../engine/planners/minimum-flex-policy.mjs) berücksichtigt den Rentenbeitrag zum Flex und prüft die Finanzierung des verbleibenden Mindestbetrags samt erforderlicher Reserve. Ein aktiver Alarm oder nicht wiederherstellbare Deckung kann die Anhebung sperren. Budget und finale Glättung bleiben danach wirksam.

Normale Safety-Ziele schützen einen zulässigen Mindest-Flex und respektieren die Änderungsgrenzen. Die schwere Flex-Notlage ist ein gesondertes Gate: tiefer Bärenmarkt, realer Drawdown des aktiven Gesamtvermögens über der Schwelle und kritische geschützte Portfolioentnahmequote müssen zusammen vorliegen. Dann kann Flex einschließlich Mindest-Flex auf null sinken. Der geplante Floor bleibt unverändert. Die Diagnose zeigt Gate, Rate und begrenzende Policy.

`minimumFlexAnnual` ist eine validierte Eingabe. Der aktuelle Haushaltsplan und die Enginegrenze lassen keinen Wert oberhalb des statischen Flex-Bedarfs zu; eine ungültige Zahl wird nicht still begrenzt. Mindest-Flex ist trotzdem keine garantierte Auszahlung. Policy, vorhandenes Vermögen und tatsächliche Auszahlung entscheiden über die Erfüllung.

### Dynamic Flex

Dynamic Flex kann die Flex-Basis durch einen aus dem Vermögen abgeleiteten Rahmen ersetzen. Der Core berechnet aus erwarteter Realrendite `r` und Resthorizont `h` den Annuitätenfaktor:

```text
Bei |r| < 0,001: a = 1 / h
Sonst:           a = r / (1 − (1 + r)^(−h))
VPW-Rahmen = aktives Vermögen × a × wirksamer Go-Go-Faktor
```

Die Näherung um null ist Teil der implementierten Formel. Anschließend wird der Netto-Floor abgezogen, bevor die Flex-Basis weiterverarbeitet wird. Spending-Policies, Sicherheitsstufen, Wiedereinstiegsrampe und Monatsquantisierung bleiben wirksam. Der Annuitätenfaktor allein ist weder die vollständige Appformel noch eine sichere Entnahmerate.

[vpw-return-policy.mjs](../../engine/planners/vpw-return-policy.mjs) unterscheidet `legacy_step` und `cape_continuous`. Der kontinuierliche Pfad leitet einen Aktienbeitrag aus `1 / CAPE` und dem konfigurierten Zuschlag ab, begrenzt ihn und gewichtet Aktien, Gold und sichere Anlagen. Die erwartete Portfoliorealrendite wird ebenfalls begrenzt und im Core geglättet. Fehlendes oder ungültiges CAPE verwendet den bezeichneten Ersatzwert. Das ist eine Renditeannahme, keine Vorhersage für das nächste Jahr.

[planning-horizon.js](../../app/shared/planning-horizon.js) und [life-expectancy.js](../../app/shared/life-expectancy.js) leiten den Horizont in Balance und Simulator jedes Jahr aus Alter und Haushalt ab. Die gewählte Methode verwendet Mittelwert oder Überlebensquantil. Die gespeicherte Jahresvorgabe bleibt im Plan und wird bei diesen Methoden nicht als feste Restdauer verwendet. Zusätzliche Vorsicht kann das Quantil verschieben, einen relativen Horizontpuffer oder feste Jahre hinzufügen. Grenzen und Übergangsglättung gehören zur Policy. Ein kürzerer Horizont kann heute mehr Flex erlauben und spätere Versorgung schwächen.

Die gemeinsamen Voreinstellungen stehen in [dynamic-flex-presets.js](../../app/shared/dynamic-flex-presets.js). Ihre Namen sind Parameterauswahlen; sie belegen keine zertifizierten Risikoklassen. Ausgeschaltetes Dynamic Flex muss die Rechnung ohne dieses Modul erhalten.

### Einschränkung nach FR-6

Einschränkung ist bezahlter Haushalts-Flex einschließlich Rentenbeitrag streng unter dem im abgeschlossenen Entnahmejahr angewandten positiven Mindest-Flex:

```text
Eingeschränkt = Jahresminimum > 0 UND bezahlter Haushalts-Flex < Jahresminimum
```

Gleichheit zählt nicht. Ein Mindestbetrag von null zählt nicht. Eine Kürzung gegenüber Wunsch-Flex oder einer Dynamic-Flex-Basis ist für sich kein Einschränkungsjahr. [minimum-flex-metrics.js](../../app/simulator/minimum-flex-metrics.js) verwendet ausschließlich protokollierte Jahresbeträge; es berechnet keine zweite Inflation.

Der Nenner enthält auswertbare abgeschlossene Entnahmejahre bis Laufende. Ansparjahre, terminale Todes-/Ruinzeilen und technische Fehlerzeilen zählen nicht. Ein Pfad mit fehlenden Jahresbeträgen bleibt nicht auswertbar. Der Backtest zeigt Anzahl, Nenner und Anteil dieses Einzelpfads.

Monte Carlo berechnet zuerst den Jahresanteil je auswertbarem Lauf und dann dessen Median über die Läufe. Der Anteil der Läufe mit mindestens einem Einschränkungsjahr steht gleichwertig daneben. Ein Median von 0 % kann bei einem positiven Anteil betroffener Läufe auftreten. Jahre werden nicht über alle Pfade gepoolt. Ein Lauf ohne Beobachtungen liefert keine erfundene Nullquote; technische Fehler sperren die betroffene Gesamtantwort.

Die Erklärung nennt den eingefrorenen Mindestbetrag zum Laufstart und seine jährliche Fortschreibung. Bezahlter, gewünschter und schwächster Flexbetrag sind nominale Jahresbeträge. Spätere Formulareingaben ersetzen den Laufwert nicht. [results-metrics.js](../../app/simulator/results-metrics.js) und [simulator-result-overview.js](../../app/simulator/simulator-result-overview.js) projizieren die Messung; [overview-simulation-summary.js](../../app/overview/overview-simulation-summary.js) speichert den kompakten Beleg.

Bei Start-Mindest-Flex null oder einem Altresultat ohne neue Messung bleibt die vorhandene Altanzeige „mehr als 10 % unter Wunsch-Flex“. Ihre ältere Berechnung zählt einschließlich genau 10 %. Die Beschriftung korrigiert diese historische Rechensemantik nicht. Eine fehlende Altzahl bleibt fehlend. Ein Median von 0 % garantiert weder alle Pfade noch die gesamte Lebenszeit.

## Reserven und Strategien

### Liquiditätsreichweite

[liquidity-runway-contract.js](../../types/liquidity-runway-contract.js) bindet `liquidityRunwayYears` an ein bis zehn Jahre in Halbjahresschritten. Die interne harte Mindestreichweite ist auf 24 Monate begrenzt; sie ist eine Enginepolicy.

Operativer Runway ist freie Liquidität relativ zur final quantisierten Netto-Portfolioentnahme. Der kanonische KPI misst nach Transaktionen und vor Jahresauszahlung; der Jahresendwert ist eine eigene Diagnose. Dynamic-Flex-Safety verwendet dagegen den ungekürzten nominalen Nettobedarf vor den Policies. Eine Kürzung darf nicht ihr eigenes Entspannungssignal erzeugen.

[TransactionEngine](../../engine/transactions/TransactionEngine.mjs) ordnet Refill, Abschöpfung und Quellenwahl. Puffer und Abschöpfungsgrenzen steuern Transaktionen. Entnahme, Bruttoverkauf und Nettozufluss sind verschiedene Beträge.

### Standard, Gold und drei Töpfe

Gold kann Zielquote, unteren Rahmen und Rebalancingband haben. Steuerfreiheit ist ein explizites Flag und keine aus dem Kaufdatum automatisch geprüfte Rechtslage.

[three-bucket-logic.mjs](../../engine/transactions/three-bucket-logic.mjs) ergänzt bei `3_bucket_jilge` Liquidität, Anleihen und Wachstumsanlagen. Ziel, Drawdowntrigger und Auffüllschwelle steuern die einmalige Finalisierung im Rechenpfad. Ein schlechtes Jahr wird an Kursrendite minus Inflation gemessen. Die vollständige Umschichtung wird vor der Auszahlung geplant: Geplante Anleihenverkäufe mindern den Bestand, erst danach wird der Rest auf das Ziel aufgefüllt. Der zusätzliche Aktienverkauf nutzt nur den noch freien Sparerpauschbetrag; sein Bruttobetrag wahrt die Aktienreserve. Reicht der Aktienbestand nicht, bleibt die Auffüllung begrenzt. Drei Töpfe belegen keinen Rendite- oder Sicherheitsvorteil.

### Pflegebucket

[simulator-health-bucket.js](../../app/simulator/simulator-health-bucket.js) und [simulator-portfolio-care.js](../../app/simulator/simulator-portfolio-care.js) bilden die cash-nahe Zweckbindung. Der Startbetrag wird vom aktiven Vermögen abgezogen; der Rest erhält Cash-Ertrag, ohne automatische Auffüllung.

Nutzung hängt von Pflegegrad und gewähltem Deckungsumfang ab. Die Reserve wirkt vor Forced Sales und darf nicht zusätzlich als normaler Verkauf oder freier Zufluss zählen. Pflegezusatz und breitere Floor-Finanzierung sind getrennte Verwendungsregeln. Free Cash, Runway-Ziel, Gold-Floor und Pflegebucket sind keine austauschbaren Reserven.

## Steuern und reale Verkäufe

### Rohwerte und Jahres-Settlement

[sale-engine.mjs](../../engine/transactions/sale-engine.mjs) schätzt Bruttoverkauf, vorzeichenbehafteten Gewinn und steuerlich gewichteten Gewinn. `tqf` ist ein Verhältnis der Teilfreistellung. `taxExempt` kennzeichnet ausdrücklich steuerfreie Lots. Die Quellenwahl berücksichtigt die implementierte Klassifikation und Steuerparameter; sie garantiert kein Broker-FIFO und keine vollständige steuerliche Optimierung.

[tax-settlement.mjs](../../engine/tax-settlement.mjs) verrechnet die Jahresrohaggregate mit `taxState.lossCarry`. Dann wendet es den Sparer-Pauschbetrag an und berechnet die pauschale Belastung. Für den implementierten Pfad gilt:

```text
Nach Verlustvortrag = steuerlich gewichteter Jahresgewinn − alter Verlustvortrag
Steuerbasis = max(0, Nach Verlustvortrag − Sparer-Pauschbetrag)
Neuer Verlustvortrag = max(0, −Nach Verlustvortrag)
Steuerquote = 0,25 × (1 + 0,055 + Kirchensteuersatz)
Steuer = Steuerbasis × Steuerquote
```

Diese Formel beschreibt die Software. Sie ist eine Planungsschätzung und keine vollständige Veranlagung. Die Kirchensteuervereinfachung bleibt als D-10 offen; aus einem vorhandenen Test folgt keine aktuelle rechtliche Eignung.

Die Engine reconciliiert finale Quellensteuer und Nettobeträge. Zusätzliche Forced Sales im Simulator fließen in das gesamte Jahresaggregate ein. [simulator-tax-recompute.js](../../app/simulator/simulator-tax-recompute.js) berechnet das Settlement neu und korrigiert die Cashdifferenz. Der Pauschbetrag darf nicht je Einzelverkauf erneut verbraucht werden.

### Empfehlung und Bestandsänderung

[tranche-reconciliation.js](../../app/tranches/tranche-reconciliation.js) verarbeitet die bestätigte reale Ausführung. Identität, Profil, Tranche und Ausgangsbestand werden geprüft; identische Wiederholung ist ein No-op, widersprüchliche Wiederholung ein Fehler. Stücke, Gebühr und Erlös werden im Ausführungsbeleg festgehalten.

Der Verkaufserlös erhöht nicht automatisch den gepflegten Tagesgeldstand. Der Nutzer trägt den absoluten Stand ein und bestätigt seine Zuordnung; Cashnachweis und Korrekturen bleiben im Beleg nachvollziehbar. Die Fachentscheidung D-15 verhindert, dass ein Modellnettoerlös als schon gebuchtes Bankgeld erscheint.

Allgemeine Produkt- und Transaktionskosten wie TER, Spread und Slippage werden im Simulator nicht als eigene laufende Cashflows abgezogen. Eine erfasste reale Ausführungsgebühr macht daraus kein vollständiges Simulationskostenmodell.

## Lebensereignisse und Einkommen

### Rente und Hinterbliebene

Der Simulator rechnet nur mit Renten; sonstige Einkünfte zählen als Monatsbetrag nur in der Balance.

Renten sind Nutzereingaben mit Anpassungsart `wage`, `cpi` oder `fix`. Es gibt keine automatische persönliche Rentenauskunft. Netto-/Bruttobasis muss zu den Eingaben passen. [simulator-household-pension.js](../../app/simulator/simulator-household-pension.js) und [simulator-portfolio-pension.js](../../app/simulator/simulator-portfolio-pension.js) führen die Verrechnung; im Haushaltshelfer hat Person 2 einen optionalen Pauschalabschlag, Person 1 keinen gleichartigen separaten Abzug.

[mc-life-events.js](../../app/simulator/mc-life-events.js) leitet Hinterbliebenenstatus aus dem Jahresanfang ab. Ein gezogener Tod wirkt im aktuellen Jahr, eine neu entstehende Hinterbliebenenrente erst im Folgejahr. Die Varianten bleiben Szenarioannahmen, ohne vollständige persönliche Anspruchs-, Einkommens- und Steuerprüfung.

### Mortalität und Horizont

Alters- und geschlechtsspezifische Jahreswahrscheinlichkeiten treiben Tod und Überlebenshorizont. Der [Demografievertrag](../../app/simulator/german-demography-care-survivor-contract.js) verwendet die importierte Destatis-Periodensterbetafel 2023/2025 für Männer und Frauen im Laufzeitalter 18–100. Die Fortsetzung 101–110 und divers als ungewichteter Mittelwert sind Modellannahmen. [DATA_SOURCES](DATA_SOURCES.md#demografie--pflege--und-hinterbliebenenvertrag) belegt Quelle, Transformation und Hashes. `all_dead` kann vor dem Horizont enden; `horizon_exhausted` ist Zensierung eines noch lebenden Haushalts. Die Rechnung ist keine Individualprognose und enthält keine künftige Kohortenverbesserung. Langlebigkeitsaufschläge ergänzen Szenariovorsicht.

### Pflege

Eintritt, Grad, Progression, Dauer und Kosten werden fortgeführt. Die amtliche Pflegestatistik 2023 liefert Bestand und Prävalenz als Kontext; sie wird nicht durch eine angenommene Dauer geteilt oder als jährliche Inzidenz verwendet. Der [Demografievertrag](../../app/simulator/german-demography-care-survivor-contract.js) trennt diese Beobachtungen von den Modellwahrscheinlichkeiten für Neueintritt in Pflegegrad 1/2 und Fortschreiten bis Grad 5. Chronische Pflege läuft bis Tod; akute Pflege zieht eine ganzzahlige Dauer aus dem Nutzerbereich. [simulator-engine-wrapper.js](../../app/simulator/simulator-engine-wrapper.js) berechnet Kosten und Flexfaktoren, `mc-life-events.js` die Ereignisse. Pflege kann Floor erhöhen, Flex vermindern und Mortalität beeinflussen; zwei Personen können zugleich betroffen sein.

[simulator-input-care.js](../../app/simulator/simulator-input-care.js) normalisiert die Pflegekosten-Drift einmal von Prozent zum nicht negativen Verhältnis. 3,5 % entsprechen Faktor 1,035. Caps und Anlaufregeln begrenzen den Kostenpfad. Reserven belegen Modellfinanzierung, keinen Versicherungsschutz. Eintritt, Dauer, Kosten und Leistungen brauchen getrennte Sensitivitäten.

## Historische und mögliche Pfade

### Historischer Backtest

Die Jahresbasis umfasst 1925 bis 2025. Mit vierjährigem Lookback leitet [historical-backtest-contract.js](../../app/simulator/historical-backtest-contract.js) Laufgrenzen von 1929 bis 2025 ab. Ein Einjahreslauf ist zulässig. Realisierte Aktien-, Gold-, Cash-/Bond-, Inflations- und Lohnwerte stammen aus `t`; CAPE ist `decision-as-of t-1`.

`global_equity_research_index` ist eine Forschungsproxykette mit unterschiedlichen Währungs-, Gewichtungs- und Dividendenkonventionen. Sie ist kein Anbieterindex und kein investierbares ETF-Produkt. [DATA_SOURCES](DATA_SOURCES.md) führt Quellenketten und Lizenzen.

Überlappende rollierende Kohorten bleiben In-sample-Diagnosen. Ihre Anteile sind keine empirischen Erfolgswahrscheinlichkeiten unabhängiger Versuche. `completed`, `ruin`, `incomplete`, `technical_error`, `cancelled` und `insufficient_horizon` werden getrennt inventarisiert.

### Monte Carlo

[mc-year-sampling.js](../../app/simulator/mc-year-sampling.js) verbindet Block-Sampling, Stationary Bootstrap, Regime-Markov und unabhängige Regimewahl. Gemeinsame Jahresrecords bewahren Beziehungen innerhalb eines Records. Zeitliche Abhängigkeit, Filter, Gewichtung und Abschnittslänge hängen vom Verfahren ab. `mcExcludeEstimatedHistory` entfernt seinen definierten Vor-1950-Bereich, ohne alle Proxyannahmen auszuschließen.

[tail-risk-overlay.js](../../app/simulator/tail-risk-overlay.js) ergänzt vorgegebene Stressereignisse. Deren Häufigkeit und Schwere sind Szenarioparameter, ohne Kalibrierung keine empirischen Eintrittswahrscheinlichkeiten. Seeds, Laufindizes, Datenhashes und Implementierung bestimmen Reproduzierbarkeit. Mehr Läufe stabilisieren die Modellquote, ohne Daten- oder Policyfehler zu beseitigen.

### Varianten und Suche

Replay hält einen materialisierten Pfad fest, Sweep untersucht Parameterwerte, Auto-Optimize bewertet Kandidaten nach Zielen und Constraints. Der Champion ist der beste gefundene Kandidat im Suchraum, kein nachgewiesenes globales Optimum und kein automatisch beschlossener Plan.

Train-/Test-Seeds stammen aus derselben Modellwelt und erzeugen keinen Markt-Holdout. `experimental_point_estimate` und der [Auto-Optimize-Modellstatus](../../app/simulator/auto_optimize.js) kennzeichnen die Grenze. Custom-Evaluatoren erben die technischen und internen Belege des eingebauten Evaluators nicht.

## Ergebnisse und Aussagegrenzen

### Ergebnisregister und Interpretationsregeln

| Ergebnis | Basis | Grenze |
| --- | --- | --- |
| Floor-Deckung im gewählten Horizont | `all_dead + horizon_exhausted` über angeforderte Läufe; bei technischen Fehlern nicht auswertbar | Deckung bis Laufende, keine Garantie bis zum realen Lebensende |
| Terminale Outcomes | `ruin`, `all_dead`, `horizon_exhausted`, `technical_error` getrennt | Horizontende ist Zensierung, technischer Fehler kein Marktverlust |
| Ruin | Aktive Vermögensdeckung oder Auszahlungs-Fallback deckt Netto-Floor nicht | keine Aussage über rechtliche Insolvenz oder alle externen Vermögenswerte |
| Endvermögen | MC nach seiner aktiven Vermögensbasis; kanonischer Backtest einschließlich Pflegebucket | Vermögensbasis des jeweiligen Ergebnisses nennen; keine externen Anlagen hinzurechnen |
| Depoterschöpfung | Fehler/Ruin oder Aktien plus Gold höchstens 100 EUR | freie Liquidität und Pflegebucket sind aus der 100-EUR-Schwelle ausgeschlossen |
| Operativer Runway | freie Liquidität relativ zur finalen Portfolioentnahme, mit Messzeitpunkt | keine Lebensdauer des Gesamtvermögens |
| Reale Entnahme | nominale Entnahme geteilt durch aktuellen Inflationsfaktor | Kaufkraft der Ausgangsbasis, kein individuelles Nutzenmaß |
| Mindest-Flex-Einschränkung | FR-6, abgeschlossene Entnahmejahre und eingefrorener Laufwert | Median und betroffene Läufe gemeinsam lesen; fehlend ist nicht null |
| Pflegebucket | Start, Nutzung, Rest und modellierte Deckung | keine Versicherungsleistung |
| Optimizer-Champion | Zielfunktion und Constraints über gewählte Seeds | Kandidat im Suchraum |

[monte-carlo-aggregates.js](../../app/simulator/monte-carlo-aggregates.js), [historical-backtest-metrics.js](../../app/simulator/historical-backtest-metrics.js) und [results-metrics.js](../../app/simulator/results-metrics.js) führen Berechnungsbasis und Missingness. Ein beobachteter Wert von 0 bleibt 0; er darf nicht per Truthiness aus einer Verteilung entfernt werden. Eine Quantilkurve kann zu jedem Zeitpunkt einen anderen Lauf repräsentieren. Konkrete Szenario-Logs zeigen dagegen zusammenhängende Pfade.

Die Endwertverteilung zeigt monotone Perzentile derselben Geldbasis und Population. Ausgewählte Szenarien stehen getrennt und behalten ihre nominale Rangwahl auch bei Anzeige in heutigen Euro. Die Deckung nennt erfolgreiche und angeforderte Läufe; 100,0 % wird nur bei Erfolg in allen Läufen angezeigt.

### Annahmenregister

| ID | Konvention | Wirkung und Grenze |
| --- | --- | --- |
| A-01 | Finanz- und Lebensereignisse in Jahresschritten | keine unterjährige Pfad- und Zahlungsstromsimulation |
| A-02 | Bedarf zu Jahresbeginn nominal | Engine ohne zweite Inflation; der State-Roll bereitet das Folgejahr vor |
| A-03 | Rente als bedarfsmindernder Jahreszufluss | zuerst Floor, dann Flex; keine zusätzliche Cashbuchung |
| A-04 | Historische Jahresrecords als Proxys | reproduzierbares Sampling, keine Verteilungsgarantie |
| A-05 | EUR als Rechenwährung | Nicht-EUR-Quotes werden abgelehnt; kein FX-Modell |
| A-06 | Keine vollständigen separaten Kosten-Cashflows im Simulator | reale Gebühren im Verkaufsbeleg erweitern das Simulationsmodell nicht |
| A-07 | Parametrisierte Steuerschätzung | Verlustvortrag und Pauschbetrag, keine vollständige Veranlagung |
| A-08 | Pflege aus Altersbuckets und Übergangsannahmen | Kosten-, Dauer- und Kalibrierungsunsicherheit |
| A-09 | Mortalität aus Periodenannahmen | populationsbezogene Pfade, keine individuelle Diagnose |
| A-10 | Cash-naher Pflegebucket ohne automatische Auffüllung | außerhalb der normalen Entnahmebasis |
| A-11 | Bond-Bucket mit Cash-Proxy | kein vollständiges Zins- und Bonitätsmodell |
| A-12 | Planung schreibfrei gegen reale Lots | erst bestätigte reale Erfassung verändert den Bestand |
| A-13 | Eingefrorener Code-, Daten- und Parameterstand | keine automatische Anpassung an Recht, Tarife oder Produktänderungen |

### Modellrisikoregister

| ID | Risiko | Einordnung |
| --- | --- | --- |
| MR-01 | Rekonstruierte Aktiensegmente und eingefrorener Dividendenbaustein | Filter und Teilperioden vergleichen; 1950 bleibt trotz Vor-1950-Filter ein USD-Proxy |
| MR-02 | Keine extern bestätigte Anbieterindexäquivalenz | reproduzierbare Quellen ersetzen keinen investierbaren Benchmark |
| MR-03 | Kosten-Cashflows fehlen | reale Nettoentnahmefähigkeit kann geringer sein |
| MR-04 | EUR ohne FX | Fremdwährung und Hedging bleiben außerhalb der Rechnung |
| MR-05 | Vereinfachte Steuer und Rentensteuer | Nettoergebnisse brauchen Prüfung am persönlichen Fall |
| MR-06 | Enges Asset- und Bond-Modell | Aussagen nur innerhalb des unterstützten Universums |
| MR-07 | Pflege- und Mortalitätskalibrierung | Szenarioannahmen und externe Eignung getrennt behandeln |
| MR-08 | Unterschiedliche Nenner und Vermögensbasen der KPIs | Floor-Deckung, Depoterschöpfung, Flex und Reserve gemeinsam lesen |
| MR-09 | Reale Entnahme braucht den fortgeschriebenen Faktor | aktueller Vertrag deflationiert genau einmal; PD-01 beschreibt den Schutz |
| MR-10 | Drift braucht genau eine Prozentnormalisierung | aktueller Vertrag verwendet das Verhältnis; PD-02 beschreibt den Schutz |
| MR-11 | Sampling, CAPE, VPW und Guardrails sind Modellentscheidungen | mehrere Seeds, Datenfilter und Stressannahmen vergleichen |
| MR-12 | Eingaben und tatsächliche Ausführung außerhalb der Automatik | Einstand, Steuerflags, Cash und Ausführung am Beleg prüfen |

### Modell-, Datenstands- und Validierungsmatrix

Die Belegmatrix hält Quellstand, Einheiten, Verantwortung, drei getrennte Statusachsen und Reviewfristen fest. Die Datumsfelder kennzeichnen den jeweiligen Belegstand; sie werden durch einen neuen technischen Test nicht automatisch erneuert. Die Zeilen MS-01 bis MS-10 bleiben der gemeinsame Evidenzvertrag der Fachreferenzen.

`ModelValidationStatusVocabularyV1` bildet `technically_tested` auf „ja“, `partially_plausibilized` auf „teilweise“ und `not_validated` auf „nein“ ab. Ein Custom-Evaluator verwendet `custom_evaluator_not_assessed`, also „nicht bewertet“. Keine Achse setzt eine andere automatisch frei.

| ID / Domaene | Owner | Implementierte Quelle, Datenstand und Einheit | Geltungsbereich / wesentliche Grenze | Technisch getestet | Intern plausibilisiert | Extern validiert | Naechster Review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MS-01 Markt-/Inflationshistorie | Daten-Owner: Nutzer; externe Datenpruefung unbesetzt | `HistoricalDataManifestV1`, Revision `2026-07-29.2`, Jahre 1925-2025; `global_equity_research_index`, Prozent p.a., CAPE-Verhaeltnis | offene Forschungsproxykette statt Anbieterindex; Aktiensegmente 1925-1950 USD-Proxy, 1951-2020 deutsche Anlegerwaehrung, 2021-2025 modellierter Dividendenbaustein; keine Verteilungsgarantie | ja, Manifest-/Hash-/Sampling-/Vollnachrechnungsvertraege | teilweise, interne Konsistenz und Ausschlussfilter | nein | 2027-01-15 oder vor jeder Datenrevision |
| MS-02 Steuer | Fach-Owner: Nutzer; Steuerreview unbesetzt | vereinfachte Kapitalertragsteuer in `tax-settlement.mjs` und `sale-engine.mjs`; Vergleich: [Paragraph 32d EStG](https://www.gesetze-im-internet.de/estg/__32d.html), [BMF/LStH 2026 Paragraph 43a](https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/3-Steuerabzug-vom-Kapitalertrag-KapSt-43-45e/Paragraf-43a/inhalt.html), Abruf 2026-07-28; EUR und Steuersaetze als Verhaeltnis | Planungsnaeherung, keine Veranlagung; Kirchensteuerformel D-10 weicht ab | ja, heutiger Contract | teilweise, nur implementierte Formel | nein | 2026-10-31 oder vor Steuerjahr-/Formelaenderung |
| MS-03 Ausgaben | Produkt-Owner: Nutzer | importierte Kategorien als vorzeichenbehaftete EUR-Betraege; Monats-/Jahresaggregation; Contractstand 2026-07-28 | aktueller Wert ist Betrag der saldierten Kategorien und damit Netto-Cash-Abfluss, keine Bruttoausgabe; D-12 offen | ja, Metrik-/Importvertraege | teilweise | nein | 2026-10-31 |
| MS-04 Verkauf/Reconciliation | Produkt-Owner: Nutzer; Accounting-Review unbesetzt | bestaetigte Stuecke, Nettoerloes, Gebuehr und append-only Cashnachweis/-korrektur in EUR; Contractstand 2026-08-07 | bestaetigte Lots werden entfernt; Verkaufserloes wird nicht automatisch gebucht; Cashstand bleibt eine explizite Nutzereingabe | ja, Reconciliation-, Persistenz- und Browser-Vertraege | teilweise, operativer Ablauf dokumentiert | nein | 2026-10-31 |
| MS-05 Mortalitaet | Modell-Owner: Nutzer; aktuarielle Pruefung unbesetzt | importierte Destatis-Periodensterbetafel 2023/2025, qx fuer Maenner/Frauen bis 100; Modellfortsetzung 101-110 und divers-Mittelwert; Quellen-/Contractstand 2026-08-01; amtlicher Anker: [Destatis Sterbetafel 2023/2025](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Sterbefaelle-Lebenserwartung/sterbetafel.html), Seite 2026-07-07, Abruf 2026-07-28; Wahrscheinlichkeit p.a. | maximal zwei demografische Personen; Periodenmodell, keine individuelle Diagnose und keine belegte Kohortenverbesserung | ja, Lebensereignis-/Runnervertraege | teilweise, Richtungs-/Grenzchecks | nein | 2027-01-15 oder vor Tabellenrevision |
| MS-06 Pflege | Modell-Owner: Nutzer; Pflege-/Aktuarreview unbesetzt | GermanDemographyCareSurvivorContractV1, Revision 2026-08-01.1; amtliche Pflegebestaende 2023 nur Kontext, Eintritt und Progression ausdrueckliche Modellwahrscheinlichkeiten p.a.; amtliche Kontexte: [BMG-Leistungen, Stand 2026-02-13](https://www.bundesgesundheitsministerium.de/themen/pflege/online-ratgeber-pflege/leistungen-der-pflegeversicherung/leistungen-im-ueberblick/seite), [Destatis Pflegebestand Ende 2023](https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/12/PD24_478_224.html), Abruf 2026-07-28 | keine Praevalenz-zu-Inzidenz-Umrechnung; anfänglicher Eintritt PG1/2 und Progression bis PG5, Dauer, individuelle Kosten und Leistungen nicht gemeinsam extern kalibriert | ja, Care-/Workervertraege | teilweise, interne Grenz-/Monotoniechecks | nein | 2027-01-15 oder vor Parameterrevision |
| MS-07 Rente | Eingabe-Owner: Nutzer; Fachreview unbesetzt | manuelle Brutto-/Netto-Jahreswerte in EUR und Nutzersteigerung in Prozent p.a.; Referenz: [DRV-Werte](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html), Abruf 2026-07-28 | keine automatische DRV-Datenuebernahme, keine individuelle Bescheid- oder vollstaendige Steuerpruefung | ja, Input-/Pensionsvertraege | teilweise, Nutzereingabe bleibt massgeblich | nein | bei jedem neuen Rentenbescheid, spaetestens 2027-01-15 |
| MS-08 Sweep/Auto-Optimize | Methoden-Owner: Nutzer; unabhaengiger Statistikreview unbesetzt | MC-Datenhashes, Sampling-/Seed-/CAPE-Contract und Optimizer-Modellversion; dimensionslose Scores sowie Ergebnis-KPIs; Contractstand 2026-07-28 | experimentelle Punktschaetzung beziehungsweise Kandidatensuche; kein globales Optimum und keine Empfehlung | ja, Parameterfidelity/CRN/Ergebnisvertraege | teilweise, synthetische und interne Szenarien | nein | 2026-10-31 oder vor produktiver Entscheidungsnutzung |
| MS-09 Kosten/FX/Asset-Universum | Produkt-Owner: Nutzer; Portfolio-Review unbesetzt | EUR-Einwaehrungsmodell; keine separate Einheit fuer TER, Spread, Slippage und Gebuehren-Cashflows; Scope-Inventur 2026-07-28 | keine FX-Konvertierung; enges ETF-/Gold-/Cash-/Bond-Proxy-Universum; reale Nettorendite kann niedriger sein | entfaellt, kein Kosten-/FX-/breites Assetmodell vorhanden | nein | nein | 2027-01-15 oder vor Erweiterung des Assetmodells |
| MS-10 Alarmstaerke | Policy-Owner: Nutzer | `flex-rate-policy.mjs`; dimensionsloser UI-Schweregrad; Contractstand 2026-07-28 | bei jeder nicht negativen Unterdeckung effektiv konstant `10`; D-11 offen | ja, Ist-Verhalten | nein, keine beschlossene monotone Fachfunktion | nein | 2026-10-31 oder vor Engine-Aenderung |

### Offene und gebundene Fachentscheidungen

| ID | Ist-Vertrag | Status |
| --- | --- | --- |
| D-10 | Vereinfachte Steuerquote `0,25 × (1 + 0,055 + Kirchensteuersatz)` | Steuerformel, Jahr, Rundung und Pfadparität brauchen einen eigenen Fachvertrag |
| D-11 | Alarmstärke `min(10, round(10 + 20 × Unterdeckungsquote))` ergibt für nicht negative Quoten konstant 10 | eine andere monotone Funktion ist nicht beschlossen |
| D-12 | Vorzeichenbehaftete Ausgabenkategorien werden erst saldiert, dann als Betrag dargestellt | Kennzahl misst Netto-Cash-Abfluss; Bruttoausgaben brauchen einen eigenen Begriff |
| D-13 | Konservativer Importvergleich verwendet den Unterrand des Window-High-Intervalls | im Marktdatenvertrag gebunden |
| D-14 | Disjunkte terminale Outcomes und versionierte Metriken | null und beobachtete 0 bleiben verschieden |
| D-15 | Verkauf entfernt bestätigte Stücke; Erlös wird nicht automatisch als Tagesgeld gebucht | Cashzuordnung und Korrekturen werden ausdrücklich belegt |
| D-16 | Finanzaggregation, Demografie höchstens zweier Personen | echte Mehrpersonendemografie bleibt offen |
| D-18 | Auto-Optimize erbt den kanonischen Sampling-, Seed-, Filter- und CAPE-Vertrag | technischer Vertrag; externe Methodenvalidierung bleibt offen |
| D-19 | Terminale beobachtete Nullwerte bleiben in Aggregaten erhalten | keine Truthinessfilter für finanzielle Messwerte |

Die Quellen sind [tax-settlement.mjs](../../engine/tax-settlement.mjs), [flex-rate-policy.mjs](../../engine/planners/flex-rate-policy.mjs), [balance-expenses-metrics.js](../../app/balance/balance-expenses-metrics.js), [annual-marketdata.js](../../app/shared/annual-marketdata.js), [monte-carlo-aggregates.js](../../app/simulator/monte-carlo-aggregates.js), [tranche-reconciliation.js](../../app/tranches/tranche-reconciliation.js) und [auto-optimize-evaluate.js](../../app/simulator/auto-optimize-evaluate.js). Offene Entscheidungen sind keine Erlaubnis, diese Semantik in der Dokumentation umzudeuten.

### Produktmängel aus dem Fachabgleich

| ID | Geschützter aktueller Vertrag | Codebeleg |
| --- | --- | --- |
| PD-01 | Reale Entnahme verwendet den fortgeschriebenen kumulierten Inflationsfaktor | `simulator-engine-helpers.js`, `simulator-year-result.js` |
| PD-02 | Pflegekosten-Drift wird einmal von Prozent zum Verhältnis normalisiert | `simulator-input-care.js` |
| PD-03 | Depoterschöpfung nennt Ruin sowie Aktien/Gold-Schwelle und ausgeschlossene Reserven | `results-metrics.js` |

Diese Kennungen erhalten die Zuordnung des Forschungsabgleichs. Sie bezeichnen die dokumentierten Korrekturverträge und keine offenen Zusagen zur externen Kalibrierung.

### Validierungsstufen

| Stufe | Nachweis | Aussagegrenze |
| --- | --- | --- |
| V1 Contract | Eingaben, Einheiten, Fehler und Ergebnisformen sind konsistent | keine ökonomische Validierung |
| V2 Rechenregression | deterministische Formeln und bekannte Ergebnisse bleiben stabil | auch stabile Semantik kann ungeeignet sein |
| V3 Pfadparität | Main Thread, Worker, Chunking und Optimizer rechnen gleich | gemeinsame Fehler bleiben möglich |
| V4 Historische Plausibilität | Datenherkunft, Perioden und Größenordnungen sind nachvollziehbar | keine Zukunftsgarantie |
| V5 Kalibrierung | externe Evidenz passt zu Mechanismus und Zielgruppe | populations- und annahmenabhängig |
| V6 Entscheidungsvalidierung | persönlicher Fall stimmt mit Unterlagen und tatsächlicher Umsetzung überein | nicht durch Softwaretests ersetzbar |

Lokale Tests können V1 bis V3 für ihre abgedeckten Pfade belegen. Externe Kalibrierung, Prognosegüte und individuelle Eignung folgen daraus nicht. Prüfwege führt das [Test-README](../../tests/README.md).

### Marktvergleich und Forschung

Der [Marktvergleich](MARKTVERGLEICH.md#ergebnis-in-klartext) beginnt mit dem Ergebnis und ordnet die App und zehn andere Werkzeuge am Stand vom 13.10.2026 ein. Sein [Evidenzregister](MARKTVERGLEICH_EVIDENZREGISTER.md#kriterienkatalog) führt die vollständigen Kriterien, Herstellerquellen und Abrufdaten. Die [Haushaltsabbildung](MARKTVERGLEICH_EVIDENZREGISTER.md#haushaltsabbildung) hält Eingabewege und Grenzen des synthetischen Beispiels fest; sie ist kein ausgeführter Produkttest. Ein fehlender öffentlicher Beleg beweist keine fehlende Funktion. Transparenz und Implementierungsprüfungen belegen keinen besseren Prognoseerfolg.

Der [wissenschaftliche Rahmen](WISSENSCHAFTLICHER_RAHMEN.md#worauf-die-rechnung-beruht) erklärt Rechenbausteine und Forschungsgrenzen in Worten. Seine [Ergebnisdeutung](WISSENSCHAFTLICHER_RAHMEN.md#wie-du-die-ergebnisse-liest) führt durch die Kennzahlen. Das [Forschungsregister](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md) erhält die vollständigen Quellen und Mechanismusdossiers sowie die [offenen Nachweise](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise). Methodenursprung, empirischer Befund, Kalibrierungsinput und Gegenbefund bleiben getrennt. Literatur zu einer Methode validiert deren konkrete Kombination in der App nicht. Herkunft und Lizenzen der Daten stehen in [DATA_SOURCES](DATA_SOURCES.md); Registerbelege werden dort am jeweiligen Hauptort gepflegt.
