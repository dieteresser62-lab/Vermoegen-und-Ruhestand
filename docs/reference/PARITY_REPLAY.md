# Paritätsaufzeichnung

`ParityReplayLogV1` sichert Simulatorentscheidungen im privaten Arbeitsspeicher. Der [Collector](../../app/simulator/parity-replay-collector.js) liest ausschließlich seine Argumente. Er besitzt weder einen Speicheradapter noch eine Exportschnittstelle zur Oberfläche. Reguläre Läufe aktivieren ihn nicht.

## Aufruf und Phasen

```js
const collector = createParityReplayCollector({ source, initialRecords });
const result = simulateOneYear(state, inputs, yearData, yearIndex,
    careMeta, careFloor, householdContext, flexFactor, engineAPI, collector);
const log = collector.toLog();
const validation = validateParityReplayLog(log, { expectedSource: source });
```

Die Funktionen kommen aus `app/simulator/parity-replay-collector.js`, `parity-replay-contract.js` und dem bestehenden Jahresmodul. Der Wrapper akzeptiert denselben zehnten Parameter. Der Collector gehört nicht in `inputs`: Diese werden zur Engine weitergereicht und als Annahmen aufgezeichnet.

`simulatorStateAtYearStart` ist eine Kopie vor Renditen und Portfolioänderungen. `simulatorStateBefore` sichert den privaten Zustand unmittelbar vor dem Engineaufruf, nach Aktien-/Bond-/Goldrendite und Rentenberechnung. Cashzinsen fehlen zu diesem Zeitpunkt noch. Die Engineargumente werden davor kopiert, `expectedDecision` unmittelbar nach dem Aufruf. Die vollständige Drei-Töpfe-Aktion ist darin enthalten. Inflationsabgleich, Portfolioausführung und endgültige Jahressteuer können diese Kopie nicht mehr verändern.

Die Entscheidungsphase heißt `VOR_TRANSAKTION`. `historicalYear` bezeichnet die gezogene Marktperiode. `logicalPlanningYear` entsteht ausschließlich aus einem ausdrücklich vorhandenen `inputs.referenceYear` und dem Laufindex. Fehlendes Planjahr bleibt unbekannt. Ansparjahre ohne Engineaufruf erzeugen keinen Entscheidungsdatensatz. Wirft die Engine, bleibt der begonnene Datensatz ohne erfundene Entscheidung unvollständig.

## Beleg

Das [JSON-Schema](../../types/parity-replay-log-v1.schema.json) beschreibt die Struktur. Der [Validator](../../app/simulator/parity-replay-contract.js) prüft zusätzlich Hash, Werte, Phasen, Jahresreihenfolge und widersprüchliche Evidenz.

| Feld | Inhalt |
| --- | --- |
| `schemaVersion` | `ParityReplayLogV1` |
| `source` | `sourceHash`, `engineVersion` mit `api`/`build`, `datasetHash`, `temporalConventionId` |
| `initialRecords` | vom Aufrufer bereitgestellte Kopie der anfänglichen Personen-/Plan-/Historienrecords; `null` bei fehlender Herkunft |
| `years` | tatsächliche Engineaufrufe mit Jahr, Phase, `engineInput`, exaktem zweitem Parameter `engineLastState`, `options`, `expectedDecision` |
| `limitations`, `captureIssues` | fehlende Modelle, nicht aufgezeichnete Phasen und nicht darstellbare Werte |
| `logHash` | SHA-256 des gesamten Belegs ohne dieses Feld |

Jeder Jahresdatensatz enthält außerdem:

| Feld | Inhalt und Grenze |
| --- | --- |
| `assumptions`, `householdEvents` | vollständige wirksame Inputs; Pflegekontext, Zusatzfloor, Roh- und normalisierter Haushaltskontext, temporärer Flexfaktor |
| `effectiveAnnualPensions` | unverändertes Ergebnis der Personenjahresrentenberechnung mit `rente1`, `rente2`, Eigen-/Hinterbliebenenanteilen und Summe; Startmonate und Personenherkunft stehen zusätzlich in den Annahmen |
| `cashAndLots` | wirksamer Cashpool, separate gespeicherte Cashkomponenten und aktuelle Engine-Lots mit Werten, Kosten und vorhandenen Besitzern; keine erfundene Poolaufteilung |
| `marketContext` | Jahresdaten samt vorhandener Zeitreferenzen, vorheriges und wirksames Marktfenster, aufgelöstes CAPE; Allzeithoch und Jahresabstand sind im wirksamen Fenster vor der Entscheidung aktualisiert (FR-15) |
| `horizonContext` | tatsächlich übergebener Horizont, vorhandene Runnerdiagnose, Alter, Partner und Personenprojektion |
| `resetEvidence` | vorheriger Enginezustand und vorheriger aufgezeichneter Input, Inflationsfaktor, vom Direktweg vorgenommener Faktorersatz; tatsächlicher Planreset und entfernte Felder nach der gemeinsamen Regel |

Der Aufrufer liefert Quell- und Datensatzhash. Fehlende Herkunft wird `null`; der Collector liest dafür keine Live-Dateien oder heutigen Marktdaten. `hashParityReplayValue` verwendet die bestehende kanonische JSON-Reihenfolge und SHA-256. Der Benchmark bildet den Quellhash aus dem sortierten Manifest der relativen Dateinamen und Inhaltshashes aller JS-/MJS-/JSON-Dateien unter `app/`, `engine/`, `types/` und `workers/`. Sein Datensatzhash umfasst die vorbereitete historische Periode einschließlich Anfangsmarktfenster. Ein Hash belegt Konsistenz; `expectedSource` bindet den Import an eine vom Aufrufer bekannte Herkunft.

`toLog()` liefert eine unabhängige Kopie. JSON bewahrt `undefined` als `{"$parityValue":"undefined"}` und die negative Null als `{"$parityValue":"-0"}`. Vor dem Engine-Replay stellt `restoreParityReplayValue` diese Werte einschließlich vorhandener undefinierter Eigenschaften wieder her. Der Direktweg übergibt heute keinen dritten Engineparameter; das protokollierte `options` bleibt deshalb ausdrücklich `undefined`. Unendliche Reichweite bei Entnahme null erscheint als `{"status":"UNBEGRENZT","value":null,"reason":"zero_withdrawal"}`. Andere nicht endliche Zahlen sind technische Fehler; nicht darstellbare Objekte werden als Lücken gemeldet.

## Balance-Records und Nachrechnung

```js
const replay = evaluateParityBalanceReplayYear(log, yearIndex, {
    engineApi: EngineAPI, expectedSource: source
});
```

[parity-balance-replay.js](../../app/balance/parity-balance-replay.js) bietet `buildParityBalanceReplayYear` für den Eingabebau und `evaluateParityBalanceReplayYear` für die anschließende Rechnung. `yearIndex` ist der gespeicherte Laufindex. Beide Funktionen prüfen zuerst den Replaybeleg. `expectedSource` prüft zusätzlich die vom Aufrufer bekannte Herkunft. Beschädigte Belege oder fehlende benötigte Quellen liefern `calculation: null` mit Befund. Enginefehler erscheinen als `TECHNISCHER_FEHLER` mit `householdResult: null`.

[parity-balance-records.js](../../app/balance/parity-balance-records.js) baut jeden Entscheidungsstand unabhängig aus Kopien der Records und Jahresquellen. `storage` ist eingefroren und besitzt nur einen privaten Recordbestand. `setItem`, `removeItem` und `clear` werfen `PARITY_READ_ONLY_STORAGE`; `toRecords()` gibt eine neue Kopie zurück. Der Adapter akzeptiert keinen echten Speicher und hat keinen Commitweg.

| Private Recordquelle | Übersetzung |
| --- | --- |
| Personenidentität, Geburtsdatum, Rentenbeginn und Steuerparameter | Anfangsrecords samt ausdrücklich aufgezeichneten Personenalternativen. `referenceYear` des Readers ist ausschließlich `logicalPlanningYear`. |
| Monatsrente | Voller Jahresanspruch aus `simulatorStateBefore.currentAnnualPension` beziehungsweise `currentAnnualPension2`, geteilt durch zwölf. Balance bestimmt die Bezugsmonate aus dem erhaltenen Rentenbeginn. Der effektive Partnerzahlbetrag wird nicht eingespritzt. |
| Haushalt & Plan | Wirksame Rohannahmen und jährliche Bedarfsbasis aus `simulatorStateBefore`; gespeicherter Planhorizont und protokollierter CAPE-Anker. Ein bereits vom Runner berechneter Horizont ersetzt den Planwert nicht. Balance berechnet nach FR-13 ihre eigene jährliche Restdauer über denselben Personenbaustein wie der Simulator. |
| Detailtranchen | Aufgezeichnete Entscheidungs-Lots, nach Besitzer getrennt. Marktwert und Kosten werden bei unveränderten Stücken in Kurse übersetzt. Balance normalisiert und aggregiert selbst. Fehlende Stücke oder Steuermerkmale ergeben keine Ersatzlots. |
| Tagesgeld und Geldmarkt | Fortgeschriebene `cashAndLots.cashOwnership.persons` liefern Tagesgeld je Person; Geldmarkt stammt aus ihren aktuellen Lots. Fehlende persönliche Cashherkunft in Altbelegen bleibt `FEHLT_LOG`. |
| Persönliche Steuertöpfe | Aktuelle persönliche Verlustvorträge stammen aus `cashAndLots.cashOwnership.persons[].taxState`. Altbelege ohne diesen Nachweis behalten `FEHLT_MODELL` mit `legacy_personal_tax_state_unavailable`. Der Haushaltsverlustvortrag wird keiner Person zugeschrieben. |
| Marktfenster und Inflation | `marketContext.marketDataCurrentYear`; Herkunft und historische Periode stehen getrennt vom Personenjahr. Ein alter Jahresergebnisrecord wird in der privaten Kopie entfernt, damit er diese Inflation nicht verdrängt. |
| Planhistorie und Resetevidenz | Exakter aufgezeichneter Haushaltsvorzustand und vorheriger Engineinput. Vorhandene Vorjahresaufzeichnungen müssen mit dieser Evidenz übereinstimmen. Die automatische Vorjahresindexierung verschiebt die Vergleichsbasis. Neue Belege halten zusätzlich die rohen Planentscheidungen im Pfadstate fest. Ein einzelner Jahresdatensatz genügt mit eigener Vorgeschichte. Persönliche Steuertöpfe erhalten keinen kopierten Haushaltsverlustvortrag. |

`buildBalanceEngineInputFromStorage` leitet aus diesen Records die Eingaben ab. `evaluateStoredAnnualHousehold` rechnet den Haushalt einschließlich der persönlichen Attribution; ein aktives Einzelprofil verwendet den direkten Engineaufruf des Balance-Vertrags. `calculation`, `runs` und `householdResult` enthalten die echten Ausgaben dieser Wege. `provenance` nennt die Übersetzungsquellen und Lotkennungen. `resetEvidence.balance` enthält Vorzustand, wirksamen State und entfernte Felder; `planHistory` bewahrt die vom Reader projizierte Historie. Die Resetregel liegt für beide Wege in [guardrail-history.js](../../app/shared/guardrail-history.js). Jahres-, Markt- und Inflationswechsel erhalten die Historie; nur bewusst geänderte Planwerte setzen sie zurück. Fachfrage 5 ist entschieden; unerwartete Zustandsabweichungen gelten als technische Fehler.

Die Rechnung heißt `PARTIAL_BALANCE_REPLAY`; `replayable` und `comparisonEligible` bleiben `false`. Die fortgeschriebenen Personenkonten belegen den aktuellen Cashstand; die persönlichen Steuertöpfe sind in neuen Belegen vorhanden. Pflege, Hinterbliebene, Ansparen und temporäre Flex-Absenkung werden als `AUSGEKLAMMERT` gemeldet. Die Probe übersetzt den aufgezeichneten Entscheidungsstand; sie führt weder `computeAnnualPlanUpdate` noch einen unabhängigen Balance-Folgelauf aus. Die gesonderten Ausgangsfälle prüfen Rundungs- und ATH-Fortschreibung über echte private Jahresentwürfe.

## Feldvergleich und Einzelfall

```js
const value = createParityCase(log, yearIndex, { engineApi: EngineAPI, expectedSource: source });
const json = JSON.stringify(value);
const replay = replayParityCase(JSON.parse(json), { engineApi: EngineAPI, expectedSource: source });
```

Die Funktionen aus [parity-case.js](../../app/balance/parity-case.js) erzeugen einen [ParityCaseV1](../../types/parity-case-v1.schema.json). Jeder Fall enthält seine Anfangsrecords, das vollständige isolierte Simulatorjahr samt eigener Resetevidenz, historische und logische Jahre, Herkunft und Konfigurationshash. Dazu kommen originale Engineargumente, rohe private Balance-Records, abgeleitete Eingaben, Reset, erwartete Entscheidung und gemessene Ergebnisse. Eine nicht gelieferte Quellrevision bleibt `null` und erhält `FEHLT_LOG`. Der Fall benötigt keine vorherigen Fall-Dateien und keinen Gesamtlauf. Beschädigte Ausgangsbelege werden als Diagnose bewahrt; ihre Hashes werden nicht repariert.

Der Einzelreplay startet den echten Simulator-Direktweg erneut aus dem Jahresanfang. Er vergleicht dessen Argumente und die frühe Entscheidung exakt mit dem Beleg. Diese Kontrollprüfung bleibt auch bei offenen Fachfragen aktiv. Balance läuft separat über ihren Speicherreader und die Haushaltsattribution. `evaluateAnnualDraft` liefert zusätzlich das Monatsbudget mit ungerundetem Einkommen; `projectBalanceFlexTrace` liefert die getrennte Seitenprojektion. Kein Commitdienst wird aufgerufen.

[parity-year-comparison.js](../../app/balance/parity-year-comparison.js) prüft zuerst Eingaben und Vorzustand, anschließend Entscheidungen, Transaktionen und Reichweite. Jahresende erhält einen eigenen Phasenstatus. [parity-compare.js](../../app/shared/parity-compare.js) verwendet absolut 0,01 Euro je Betrag und 1e−9 für Raten und Monate; Kennungen, Flags und Jahreshorizonte sind exakt. Der rekursive Statevergleich wendet diese Einheiten je Feld an. Monat und Jahr sowie einzelne Quellen werden unabhängig geprüft. Eine ausgeglichene Summe ersetzt keine richtigen Personen- oder Lotbeträge.

Jede Vergleichszeile enthält beide Messwerte als `{status,value,reason,phase,path}`, Einheit, Delta, Toleranz und Klassifikation. Gleichheit, Rundungsursache, nummerierte offene Fachfrage, fehlendes Personenmodell, fehlender Logwert, andere Phase und technischer Fehler bleiben unterscheidbar. Belegt inaktive oder ausgeklammerte Teile erhalten eigene Status. Rundungsursachen bleiben auch unter der Ergebnistoleranz sichtbar. `upstream` nennt gemessene Eingabe-/Resetunterschiede, aus denen eine mögliche offene Ursache der Entscheidungsabweichung abgeleitet wird; das ist keine fachliche Freigabe oder isolierter Kausalbeweis.

Lotinventare werden nach Besitzer und Lotkennung sortiert. Quellen behalten ihre Entnahmereihenfolge; kein Besitzer wird zusammengelegt. Verwendungen werden nach Topf sortiert, explizite Nullverwendungen dürfen entfallen. Fehlend, null und tatsächlich gemessene Null bleiben getrennt. Bei belegter Nullentnahme und endlichem Cash wird die vom Simulator als `null` ausgegebene Reichweite nach dem Vertrag als `UNBEGRENZT` dargestellt; der Rohwert bleibt unter `measured` erhalten. Andere nicht endliche Zahlen bleiben technische Fehler.

Der vollständige Drei-Töpfe-Plan liegt im Engineergebnis und im geprüften `plannedActionFlow` vor. Der Collector meldet dafür keine pauschale Loglücke mehr. Die Ausführungsevidenz prüft auch Anleihenkäufe vor der Auszahlung. Cash und Reichweite werden nur bei belegtem gleichem Transaktionsumfang verglichen; dafür gelten dieselben Feldtoleranzen wie für Quellen und Personenbeträge. Quellenwahl, geplante Steuer und persönliche Verlustvorträge werden verglichen. Ändert die Preisumrechnung eine praktisch gleiche Steuerquote und dadurch die Quellenreihenfolge, erhalten allein Quellen- und Personenbeträge `PHASE_NICHT_VERGLEICHBAR` mit `tax_source_order_after_price_roundtrip`; Haushaltssummen bleiben prüfpflichtig. Persönliche Auszahlungen und ihre Reihenfolge werden verglichen. Eine durch knappe Einzelkonten abweichende Auszahlung nennt `personal_payout_exceeds_owned_liquidity` als Restursache. Sonstige Einkünfte zählen gemäß FR-7 ausschließlich in Balance; betroffene Einkommens- und Budgetvergleiche erhalten `AUSGEKLAMMERT`. Ausgeführte Jahresendbestände werden keinem hypothetischen Balancebestand gleichgesetzt. Der Simulator-FlowDelta wird unabhängig mit der Centgrenze geprüft.

Beidseits nicht berechnete VPW-Werte sind nur bei beidseits ausgeschalteter Dynamik `NICHT_ANWENDBAR` (`dynamic_flex_inactive`). Das schließt die Sicherheitsstufe mit statischem Flex ein. Eine beidseits nicht ausgeführte Mindest-Flex-Notfallprüfung erhält für ihre nicht vorhandene Notfallreichweite `minimum_flex_emergency_not_evaluated`. Ein einseitiger Fehlwert behält seinen Befund. Vorhandene Werte, Entnahme, Mindest-Flex-Status und Sicherheitsstufe bleiben geprüft.

`summary.complete` bleibt bei Modell-/Loglücken, offenen Fragen oder berichteten Rundungsursachen `false`. `TECHNISCHER_FEHLER` hat Vorrang im Gesamtstatus. Ein erfolgreicher Testlauf bestätigt die Nachrechnung der Befunde. Die 13 bytegleich erhaltenen D23-Ausgangsbelege enthalten auch isolierte Kontrollvarianten. Ihre Fälle heißen `D23_PROBE` und behalten die ursprünglichen Annahmen und Beobachtungen im eingebetteten Beleg. Für FR-8 bis FR-15 gelten die beschlossenen Sollwerte. `7-cashaufteilung` rechnet den aktuellen Folgestand durch Simulator und Balance nach; Liquidität und Reichweite sind gleich. `2-haushalt` prüft gleiche persönliche Auszahlungen, Quellen und Steuern; beide Wege versteuern den Verkauf mit 640,04 Euro. Die Fälle `4-drei-toepfe-rendite`, `5-drei-toepfe-phase` und `11-drei-toepfe-steuerreserve` sind gleich; im Phasenfall stehen vor Auszahlung beidseits 150.000 Euro Anleihen. Rentenabschlag, Planungsdauer, Jahresrentenrundung, Jahresfortschreibung und Börsenhoch ergeben damit Gleichheit. `3-horizont` prüft konservativ 33 Jahre und 31.200 Euro Jahresentnahme, ausgewogen 31 Jahre und 36.000 Euro sowie offensiv 25 Jahre und 45.600 Euro. Fachfrage 6 entfällt auch im Jahresvergleich und im unabhängigen Folgelauf. Die Steuerreserve-Gegenprobe prüft einen erfolgreichen Steuerabschluss ohne Fehlbetrag und einen ausgeglichenen Jahresfluss. Beide Fallarten lassen sich über den [Prüfeinstieg](../../tests/README.md#paritätscollector) einzeln nachrechnen.

`caseHash` schützt den gesamten Export. Der Import prüft zusätzlich feste Toleranzen und Eingabebelege; `expectedSource` bindet einen Fall an eine bekannte Herkunft. `reproduced` vergleicht die neue Messung mit der exportierten, ohne sie neu zu basieren. Der Prüfeinstieg schreibt die Fälle und `zusammenfassung.json` in einen neuen temporären Ordner oder das mit `--ausgabe` gewählte Ziel. Echte Speicher bleiben unberührt.

Die privaten Belegfunktionen akzeptieren optional `hashValue`; ohne Angabe bleibt die portable SHA-256-Funktion aktiv. Der Node-Prüfeinstieg liefert [nodeParityHash](../../tests/extended/parity-node-hash.mjs) mit denselben kanonischen Bytes und dem nativen SHA-256. Gegenproben verlangen identische vollständige Fälle und unveränderte Manipulationserkennung. Engine und reguläre Rechenpfade verwenden diese Option nicht.

Der getrennte Szenarienlauf prüft Aus, Konservativ, Ausgewogen und Offensiv für 2000–2025. Fälle mit `replay.sequence` enthalten einmalige private Anfangsrecords und die eingefrorenen externen Ereignisse bis zum Prüfjahr. Ihr Einzelreplay startet den unabhängigen Balancepfad erneut an diesem Anfang. Dem Ausführungsadapter fehlen eigene persönliche Jahresendbuchungen; deshalb hält er mit `NICHT_VOLLSTAENDIG_AUSFUEHRBAR` und `independent_annual_execution_adapter_missing` an. FR-10 hat die Kontenregel entschieden. Der erste betroffene Jahrgang bleibt in späteren Fällen als Ursache erhalten; dort werden weder Entscheidungen noch Auszahlungen ergänzt. Ein solcher Fall ist reproduzierbar und bleibt fachlich unvollständig.

## Jahresvergleich und Restklassen

Stand: 15.10.2026. Der Muster-Haushalt Max und Erika Mustermann startet mit 790.000 Euro, Planjahr 2026 und getrennten Personenkonten. Historische Marktjahre 2000–2025 entsprechen den logischen Planjahren 2026–2051. Die vier Varianten übernehmen dieselben Voreinstellungen wie die Oberfläche.

| Voreinstellung | Entscheidungen gleich | Persönliche Transaktionspläne gleich | Vollständige Jahre gleich | Unabhängige Entscheidungen |
| --- | --- | --- | --- | --- |
| Aus | 26/26 | 26/26 | 0/26 | 1/26 |
| Konservativ | 26/26 | 26/26 | 0/26 | 1/26 |
| Ausgewogen | 26/26 | 26/26 | 0/26 | 1/26 |
| Offensiv | 26/26 | 26/26 | 0/26 | 1/26 |

`decisionEqualYears` zählt die vollständigen `decision.*`-Felder einschließlich Monatsbudget, Monats-/Jahresentnahme und wirksamer Flexdiagnosen. `transactionEqualYears` zählt `transaction.*` einschließlich Quellenreihenfolge, persönlicher Auszahlungen, Steuer und Verlustvortrag. Nicht anwendbare Felder sind keine gemessene Gleichheit, verhindern aber diese Teilzähler nicht. `equalYears` verlangt weiterhin beide vollständig gleichen Jahresfälle. 104 aufgezeichnete Jahre und 104 Folgelauffälle bleiben als 208 einzeln reproduzierbare Dateien erhalten. Es gibt keine offene Fachfrage, technische Abweichung oder unklassifizierte Restursache in dieser Matrix.

[parity-residuals.mjs](../../tests/extended/parity-residuals.mjs) prüft Status, konkreten Grund und Feld jeder verbleibenden Zeile. Die Zusammenfassung nennt Klassen, betroffene Jahre, Fall- und Feldzahlen sowie Beispiele. Im Abgleich bleiben:

| Klasse | Fälle / Felder | Begründung |
| --- | --- | --- |
| `MARKTZEIT_HERKUNFT_FEHLT` | 104 / 312 | Balance-Records haben keine unabhängigen Metadaten für CAPE-Quelljahr, Inflationsquelljahr und Zeitkonvention. Übernommene Werte ersetzen diesen Herkunftsnachweis nicht. |
| `QUELLREVISION_FEHLT` | 104 / 104 | Ein Quellinhaltshash liegt vor; eine Git-Revision wurde dem Collector nicht mitgegeben. |
| `JAHRESENDE_NUR_SIMULATOR` | 104 / 832 | Balance empfiehlt; sie liefert kein ausgeführtes Jahresendportfolio und keine gebuchten Jahresendbeträge zum Vergleich. |
| `FOLGELAUF_AUSFUEHRUNG_FEHLT` | 104 / 208 | Dem unabhängigen Adapter fehlen persönliche Jahresbuchungen. Alle Varianten halten 2000 nach der ersten Entscheidung an; 2001–2025 haben keine Folgeentscheidung. |
| `ZUSAETZLICHE_DECKUNG` | 25 / 125 | Zusätzliche Deckungsverkäufe ändern den Transaktionsumfang vor Auszahlung. Beispiel Aus 2011: Simulator-Cash 56.670,17 Euro, hypothetisches Balance-Cash 48.737,57 Euro; zusätzliche Deckung 7.932,60 Euro. |

Die Klassen ändern keine Feldmessung und geben keine Restabweichung fachlich frei. Unbekannte Befunde lassen den Szenarienlauf scheitern. Die bereits abgesicherten Klassen `TRANSAKTIONSUMFANG_VERSCHIEDEN`, `QUELLREIHENFOLGE_STEUERGLEICH` und `PERSOENLICHE_AUSZAHLUNG_BEGRENZT` treten in dieser Matrix nicht auf.

### Was sieht der Nutzer anders

| Regel | Wirkung in Balance und Simulator |
| --- | --- |
| FR-8 / FR-9 | Drei Töpfe misst Kursrendite minus Inflation. Die vollständige Umschichtung mit gedeckter Steuer liegt vor der Auszahlung; geplante Anleihenverkäufe mindern den Restbestand vor der Auffüllung. |
| FR-10 und Personensteuern | Tagesgeld, Geldmarkt, Quellenwahl und jährliche Steuertöpfe bleiben persönlich. Die Haushaltsverteilung und je Person Tagesgeld vor Geldmarkt bestimmen die Auszahlung. |
| FR-11 | Beide Renten sind Nettobeträge ohne weiteren Abschlag. Alte Steuerquoten bleiben lesbar und wirken nicht mehr. |
| FR-12 | Normale Jahres-, Markt- und Inflationswechsel erhalten die Leitplanken. Bewusste Planänderungen setzen sie zurück; Steuerstände bleiben erhalten. |
| FR-13 | Beide Wege bestimmen die Restdauer jährlich aus Alter, Haushalt und Langlebigkeit. |
| FR-14 | Zwischenwerte behalten ihre Präzision. Anzeige und Buchungen dürfen runden; die fachlichen Entnahmeschritte bleiben erhalten. |
| FR-15 | Hoch und Jahresabstand werden vor der Entscheidung aktualisiert. Ein neues Hoch zählt im selben Jahr. |

Die folgenden Zahlen vergleichen die vollständigen Quellen vor der Angleichung mit dem aktuellen Stand. Jeder Weg liest denselben synthetischen Haushalt mit derselben Voreinstellung. Balance wird je Jahr aus dem jeweiligen aufgezeichneten Entscheidungsbestand nachgerechnet; die Tabelle ist kein unabhängiger Balance-Folgelauf. Marktjahr 2001 entspricht Planjahr 2027. Alle Beträge sind nominale Euro; Entnahme meint den Monatsbetrag aus dem Vermögen.

| Voreinstellung | Balance Monatsbudget vorher → nachher | Balance Entnahme vorher → nachher | Simulator Monatsbudget vorher → nachher | Simulator Entnahme vorher → nachher |
| --- | --- | --- | --- | --- |
| Aus | 5.027,50 → 5.027,50 | 1.850 → 1.850 | 4.421,50 → 5.027,50 | 1.900 → 1.850 |
| Konservativ | 4.927,50 → 5.027,50 | 1.750 → 1.850 | 4.371,50 → 5.027,50 | 1.850 → 1.850 |
| Ausgewogen | 5.277,50 → 5.277,50 | 2.100 → 2.100 | 4.621,50 → 5.277,50 | 2.100 → 2.100 |
| Offensiv | 5.577,50 → 5.877,50 | 2.400 → 2.700 | 5.221,50 → 5.877,50 | 2.700 → 2.700 |

Die Änderungen der Balance-Empfehlung beruhen hier auf den Angleichungen von Historie, Restdauer und Rechenpräzision nach FR-12 bis FR-14; die Tabelle misst deren gemeinsame Wirkung samt fortgeschriebenem Simulatorbestand. Im ersten Marktjahr 2000 ändert sich außerdem Konservativ von 4.800 auf 4.900 Euro Monatsbudget und von 2.500 auf 2.600 Euro Monatsentnahme. Die übrigen drei ersten Jahresentscheidungen bleiben gleich. Drei-Töpfe-Änderungen nach FR-9 sind separat in den D23-Belegen geprüft: Auffüllung 100.000 → 150.000 Euro. Die Steuerdeckung bei persönlichem Liquiditätsmangel ändert diese historischen Entscheidungen und die gespeicherten D23-Ausgangsbelege nicht. Im synthetischen Ansparfall ohne Rentenkalenderlogik ersetzt Partner-Tagesgeld nach FR-16 dagegen einen eigenen Gold-Notverkauf von 131,875 Euro. Sein Finanz-Snapshot folgt dieser beschlossenen Änderung; die drei anderen Finanz-Snapshots des Rententests bleiben gleich.

Die getrennte Monte-Carlo-Messung verwendet 100 Läufe mit maximal 26 Jahren, Seed 12345, Blocksampling mit Blockgröße 3, Startjahre `UNIFORM`, `per-run-seed` und CAPE-Sampling. Erfolg bedeutet `all_dead` oder `horizon_exhausted` ohne vorherigen Ruin; technische Fehler liefern keine Quote. Aus, Konservativ, Ausgewogen und Offensiv erreichen jeweils 100/100: 63 enden mit `all_dead`, 37 mit `horizon_exhausted`, keiner mit Ruin oder technischem Fehler. Das ist eine kleine reproduzierbare Modellprobe und keine Garantie. [personal-tax-liquidity-mc.mjs](../../tests/extended/personal-tax-liquidity-mc.mjs) misst den aktuellen Stand ohne Basiskopie. Der zuvor mit `SIM_PERSONAL_TAX_LIQUIDITY_SHORTFALL:muster_a` abbrechende Offensiv-Laufindex 16 passiert Jahrindex 21 und endet regulär. Offensiv wird damit von „nicht auswertbar“ wieder zu 100 Prozent; vor der fachlichen Angleichung waren es 99 Prozent. Der Versionsvergleich [parity-user-impact.mjs](../../tests/extended/parity-user-impact.mjs) bleibt über den Aufruf im [Test-README](../../tests/README.md#paritätscollector) reproduzierbar.

Für die persönliche Steuerdeckung gilt FR-16 (Nutzerentscheidung vom 15.10.2026): Reicht die eigene Liquidität nicht, zahlen zuerst die anderen Haushaltspersonen aus ihrer Liquidität in der Reihenfolge aus Haushalt & Plan, je Person Tagesgeld vor Geldmarkt. Das gilt auch bei mehr als zwei Personen. Erst danach folgen zusätzliche eigene Notverkäufe mit `calculateSaleAndTax`. Erst die verbleibende Steuerlücke zählt als Ruin. Steuerpflichtige Gewinne aus helfenden Geldmarktkonten werden beim Eigentümer im selben Steuerjahr nachgerechnet. Balance behält ihre persönliche Steuerreserve vom Verkaufserlös; sie führt kein tatsächliches Jahresende mit anschließender Steuerzahlung aus und enthält dafür keine bestehende Deckungsregel. Die gemeinsame Herkunft sind `settleTaxYear`, `calculateSaleAndTax` und `calculateWithdrawalDistribution`.

## Beweisgrenzen

Der Validator trennt `valid` für Struktur und Belegkonsistenz von `engineReplayable` für die vorhandene Enginekontrollrechnung. Die vollständige Haushaltsprobe erhält derzeit `replayable: false` und den Text „nicht vollständig replayfähig“. Alte Jahreslogs werden ebenso bezeichnet. Eine erfolgreiche Enginekontrollrechnung beweist keine Parität der beiden Eingabebauer.

Persönliche Cashkonten, Auszahlungen, Quellenwahl und jährliche Steuertöpfe sind im Simulator vorhanden. Für neue Belege entfällt die bisherige Modellausnahme. Die unabhängige Balancefortsetzung hat weiterhin keinen Ausführungsadapter für persönliche Jahresendbuchungen. Diese Lücke bleibt benannt; Altbelege ohne persönliche Steuerparameter bleiben unbelegt. Die Fragen 1 bis 8 sind durch FR-8 bis FR-15 entschieden; Renten, Leitplankenhistorie, Planungsdauer, Jahresfortschreibung und Börsenhoch werden ohne diese Ausnahme verglichen. Bei vorhandenen Einzeltranchen auf beiden Seiten sind die ungenutzten aggregierten `tqfAlt`/`tqfNeu` als `NICHT_ANWENDBAR` benannt. Die Teilfreistellung jeder Einzeltranche bleibt im Feldvergleich; fehlt eine der beiden Listen, gilt der Vergleich der Aggregate weiter. Keine dieser Größen zählt als Gleichheit oder Testfehler. Bei fehlendem Lotbesitzer meldet der Validator `FEHLT_LOG`; er weist keinen Ersatzbesitzer zu.

Drei Töpfe verwendet dieselbe Renditeschwelle und denselben Finalizer vor der Auszahlung. Alte Logs bleiben lesbar und enthalten weiterhin ihren damaligen Plan; eine abweichende Kontrollrechnung wird ausgewiesen. Frühe Verkaufssteuer und endgültige Jahressteuer sind verschiedene Phasen. Dieser Beleg deckt weder `NACH_TRANSAKTION`, `VOR_AUSZAHLUNG` noch `JAHRESENDE` als vollständigen Haushaltsvergleich ab. Auch Feldvergleich, partielle Balance-Nachrechnung und der bei ungeklärten Buchungen endende Folgelauf schließen diese Lücken nicht.

Prüfbefehl und Laufzeitmessung stehen in [Tests und Prüfwege](../../tests/README.md#paritätscollector).
