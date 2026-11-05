# Datenverträge

Nachschlagewerk für Entwickler zu Persistenz, Austausch und Laufbelegen. Stand: 04.11.2026. Die [Architektur](TECHNICAL.md#datenwege) beschreibt Aufruf- und Schreibgrenzen, [Fachthemen](FACHKONZEPT.md) die Bedeutung. Speicheradapter halten Stringrecords; Domänenmodule validieren deren Inhalt. Cachezustand und bestätigter Backendbestand sind verschieden.

In der Lesefassung markiert ein Messingstrich die angesprungene Überschrift. Darüber stehen der Seitentitel und „zum Seitenanfang ↑“ für die Rückkehr zum Seitenkopf.

## Bestand

### Schlüssel und Adapterhüllen

| Schlüssel/Gruppe | Eigentümer unter `app/` und Umfang |
|---|---|
| `rs_profiles_v1`, `rs_current_profile`, `rs_active_profile` | `profile/profile-registry.js`; Registry, offene Person, Besitzer der Liveprojektion |
| `rs_profile_live_base_v1` | `profile/profile-storage/live-base.js`, öffentlich über `profile/profile-storage.js`; String mit Ladebasis der Registry- und Liveprojektion |
| `household_plan_v1`, `annual_plan_record_v1` | `profile/household-plan.js`, `annual-plan-record.js`; Plan bzw. Jahresbeschluss |
| `household_partnership_v1`, `household_planned_expenses_v1`, `household_care_values_v1` | jeweiliges `household-*.js` in `profile/` bzw. `shared/`; globale Haushaltsrecords |
| `profile_*`, `depot_tranchen` | Person und reale Bestände nach `profile/profile-key-policy.js` |
| `ruhestandsmodellValues_v29_guardrails` | Balance-State, Vorstate, Jahresmetadaten |
| `balance_expenses_v1` | `balance/balance-expenses-storage.js`; Monate/Personen |
| `overview_balance_summary_v1`, `overview_month_provision_v1`, `overview_simulation_summary_v1` | `overview/`; Anzeige-, Monats- und Laufbelege |
| `overview_last_full_backup_v1`, `rs_data_backup_summary_v1` | Sicherungszeit und Vergleichsbasis |
| `rs_wealth_history_start_v1`, `rs_daily_prices_v1`, `rs_household_wealth_captures_v1` | Messbeginn, Tagesschlusskurse, bestätigte Messpunkte |
| `sim_*`, `sim.*` | Simulator-/Replaywerte nach jeweiliger Policy |
| `rs_probelauf_state_v1` | Bereichssteuerung außerhalb normaler Sicherungsrecords |

`persistence-key-policy.js` bestimmt Vollimport, Snapshot und Probelaufumfang; Zulassungen sind nicht gleich. Normale Snapshots schließen UI-/Layout-/Debugwerte, Legacy-Snapshotkeys und `sim.stressReplay.active.v1` aus. Vollimport erlaubt keine beliebigen Browserdaten.

Browser: IndexedDB `ruhestand-suite`, Version 2, Stores `kv`, `metadata`, `snapshots`; localStorage-Ersatz mit `rs_snapshot_archive_v1`. Tauri: `ruhestand_suite_data.json` mit `{schemaVersion: 1, savedAt, records, metadata}`, `ruhestand_suite_snapshots.json` mit `{schemaVersion: 1, savedAt, snapshots}`. Adapterhüllen sind keine Importdateien. [Datenbereiche](TECHNICAL.md#build-und-auslieferung) synchronisieren sich nicht automatisch.

Mehrere Haushalte (seit HV-1): Das Verzeichnis `rs_households_v1` (Tauri `ruhestand_suite_households.json` in der Wurzel) hält `{version: 1, active, generation, households: [{id, name, createdAt}]}` und keine Finanzdaten. Haushalt 1 (`h1`) bleibt an den bisherigen Orten. Jeder weitere Haushalt hat eine Kennung aus 12 Zeichen `[a-z0-9]` und einen eigenen Bereich: IndexedDB `ruhestand-suite-hh-<Kennung>`, Web Storage mit Präfix `rs_hh_v1:<Kennung>:`, Tauri `households/<Kennung>/` mit denselben Dateinamen. Ein Bereich gilt erst mit dem Fertigmarker `householdReady` als angelegt. Altmigration und Altbereinigung laufen nur in Haushalt 1. Wechsel und Anlegen erhöhen `generation`; ältere Seiten schreiben danach nicht mehr.
Seit HV-2 hat jeder weitere Haushalt einen eigenen Spielbereich: IndexedDB `ruhestand-suite-hh-<Kennung>-spiel`, Web Storage `rs_hhspiel_v1:<Kennung>:`, Tauri `households/<Kennung>/ruhestand_suite_spiel_*.json`. Die Steuerung bleibt eine Datei in der Wurzel und nennt mit `household` den Haushalt, dem der Spielbereich gehört. Fehlt beim Öffnen der Bereich eines Haushalts, trägt das Verzeichnis `missing: true` ein. „Wieder anlegen“ setzt den Fertigmarker neu und entfernt den Merker. Löschen nimmt den Eintrag aus dem Verzeichnis und entfernt danach alle Orte dieses Haushalts (Tauri `delete_household_state`).
Übergabedatei (HV-3): Vollsicherungsformat mit `backupPurpose: "household-transfer"` und `household: {id, name}` (Herkunft), ohne Wiederherstellungspunkte. Einspielen prüft sie wie den Vollimport, schreibt in einen neuen Bereich mit neuer Kennung, liest alles zurück und trägt erst dann ins Verzeichnis ein; scheitert das, wird der Bereich wieder entfernt. Vollsicherungen tragen bei mehreren Haushalten ebenfalls `household`; der Vollimport nennt dann die Herkunft.
Absicherung (HV-4): Jeder native Write (`save_app_state`) nennt `expectedGeneration`. Rust prüft unter einer gemeinsamen Sperre, ob das Verzeichnis noch diese Generation trägt, und weist sonst mit `HOUSEHOLD_CONTEXT_CHANGED` ab (die Oberfläche verlangt dann ein Neuladen). Das Verzeichnis selbst wird nur geschrieben, wenn seine Generation unverändert ist. Legen zwei Fenster gleichzeitig an, gewinnt das erste, der Bereich des zweiten wird wieder entfernt.

### Personen und Haushalt

`profile-registry.js`: `{version: 1, profiles}`; je Profil `meta` und Stringrecords `data`. `belongsToHousehold: false` bedeutet Außenprofil. Ein Haushalt umfasst eine oder zwei Personen. `createProfile` und `setProfileVerbundMembership` lehnen eine dritte Mitgliedschaft ab. Die Personenverwaltung sperrt Austritt und Löschen der letzten Haushaltsperson vor dem Rückkehrpunkt; Außenpersonen bleiben löschbar. Profil- und Vollimporte prüfen die Grenze vor jedem Write; bestehende Registrys bleiben lesbar, damit die Verwaltung einen Altbestand korrigieren kann. Eigene Vollsicherung, Personenexport und Depotlöschung bleiben auch bei drei Mitgliedern möglich; nur Rechnungen bleiben bis zur Korrektur gesperrt. Der Hinweis nennt die tatsächliche Mitgliederzahl. Balance, Simulator und Übersicht sperren Rechnungen mit mehr als zwei Mitgliedern; Balance und Simulator schreiben keine Mitgliedschaft. `profile-context-reader.js` verbindet Registry und aktive Liveprojektion. `missing`/leer, `valid`, `corrupt`, `unavailable` bleiben nach Readervertrag getrennt; Schäden sperren Writes und erhalten Rohtext.

`profile-person-data.js` besitzt die bestätigten Personenschlüssel:

| Schlüssel | Inhalt |
|---|---|
| `profile_geburtsdatum`, `profile_geschlecht` | echter Kalendertag YYYY-MM-DD; m/w/d |
| `profile_rentenbeginn` | Kalenderbeginn; Beginnmonat zählt ganz |
| `profile_rentenanpassung_art`, `profile_rentenanpassung_pct` | wage/cpi/fix und Prozent p.a. |
| `profile_kirchensteuer_pct`, `profile_sparer_pauschbetrag` | persönlicher Prozentwert bzw. Euro/Jahr |
| `profile_rente_steuerquote_pct` | gespeicherte Altannahme; Nettorente wird nicht erneut gekürzt |
| `profile_person_schema_version`, `profile_person_migration_v1` | String 1 für bestätigte Daten; datierte Migrationsherkunft |
| `profile_rente_aktiv`, `profile_rente_monatlich`, `profile_tagesgeld` | Rentenstatus, Nettomonatsbetrag, Cashstand |

Import und Start prüfen Personenkennungen mit `assertProfileIdentityRecords`: gesetzte Kennungen müssen existieren und bei gemeinsamer Angabe übereinstimmen. Vermögenswerte verwenden auch im Manager `parseStoredNumber`; akzeptierte Dezimalkommawerte bleiben erhalten, nichtleere unlesbare Zahlen bleiben als `NaN` erkennbar und sperren das Speichern.

`profile_aktuelles_alter` bleibt Altwert; bestätigtes Datum hat Vorrang. Das Planungsalter folgt `january-1-completed-years`; Prozentwerte werden einmal zu Engineverhältnissen normalisiert.

`profile_einkuenfte_v1`: `{schemaVersion: 1, entries}`. Feste Zeile: `{id, art: 'sonstige', bezeichnung, betragMonat, ab, bis, anpassung}`; einmalig: `{id, monat, betrag, bezeichnung}`. Positive endliche Netto-Euro, eindeutige IDs, Bezeichnung ≤60 Zeichen; Monatsgrenzen YYYY-MM/null, geordnet; Anpassung keine/inflation/lohn. Neue Liste hat Vorrang. `profile_einkuenfte_migration_v1: '1'` belegt einmalige Übernahme; `profile_sonstige_einkuenfte`, `profile_planned_inflows_v1` bleiben Rücksprungbestand. `profile_rente_bezeichnung` benennt nur die separate Rentenzeile.

Pflege: `profile_care_grade_today` 0–5, `profile_care_progression` usual/slower/much_slower, `profile_care_form_today` family/home-support/residential. `sim_pflegeStufe1Form` bis `sim_pflegeStufe5Form` halten die Gradstaffel. Alte external-Werte normalisieren nach Grad; fehlende Formen folgen `care-benefits.js`. `household_care_forms_notice_v1` ist pending/shown. `profile_care_additional_monthly` und `profile_care_allowance_as_income` bleiben gespeichert, werden ignoriert und nicht überschrieben. `profile_health_bucket` hält die Reservekonfiguration. Formen, Staffel und Datenhaltung sind von [Kostenwirkung](PFLEGE.md) getrennt.

`household_care_values_v1` hält Pflegegeld Grad 2–5 und Heim-Eigenanteil samt Stand, Quelle, Herkunft, gültig ab und Bestätigungsjahr; Validator/Writer: `shared/household-care-values.js`. Runner transportieren eigene Werte als `careValues` ohne neue einzelne Payloadfelder.

### Immobilien und Nachlass

`profile_immobilien_v1`: `{schemaVersion: 1, entries}`. Je Zeile `id`, `bezeichnung`, `nutzung` selbst/vermietet, `wert` eigener Anteil, `stand` YYYY-MM, `mieteNetto`, `anpassung` keine/inflation. Optional `ortsueblicheMiete`: endliche Monats-Euro ≥0; fehlend und gesetzte 0 verschieden. Leeren entfernt das Feld. Keine Schreibmigration; ungültige neue Werte blockieren Import. Eigentümer: `profile-immobilien.js`.

`household_partnership_v1`: Schema 1, Status married/unmarried, `maritalPropertyRegime` community/separation (Vorgabe community = Zugewinngemeinschaft), `inheritance` je Person (Vorgabe 0 %), optional `marriedInheritance` (100 %) und `homeAndTaxInheritance` (aus). Fehlender Record bedeutet verheiratet. Optional `testament[profileId]`: `minimum` ≥0, zugehöriger `minimumStand` YYYY-MM, `maximumPercent` 0–100, `home` money/residence/life-estate, `residenceTax` immediate/annual. Fehlend: kein Minimum, Maximum 100 %, Immobilien wie Geld, sofortige Wohnrechtsteuer. `activeInheritanceRule[profileId]` speichert testament/home-and-tax; die Häkchenwahl erhält inaktive Testamentfelder. Ohne positive eigene Immobilien wirken diese trotz home-and-tax. `readPartnership()` ergänzt einen fehlenden Güterstand nur lesend als community; allein deshalb bleiben Altbytes beim Start, Import und Restore unverändert. Bei Altständen mit Testament und Häkchen ergänzt es testament als Vorrang. Nur eine fehlende Vorrangzuordnung löst `migratePartnershipRecord()` aus; dabei wird ausschließlich `activeInheritanceRule` ergänzt, andere und unbekannte Altschlüssel bleiben erhalten. `profile-partnership-migration.js` bestätigt sie beim Seitenstart transaktional im echten Livebestand, auch nach Snapshot-Restore. Im Spielbereich bleibt diese Schreibmigration bis zum nächsten echten Start aufgeschoben; Fehler werden geloggt und brechen die Initialisierung nicht ab. Ausdrückliche Entscheidungen und archivierte Snapshot-Bytes bleiben unverändert. Bundle, Sicherung Schema 1/2 und Spielkopie erhalten den ganzen Record.

Nur im Laufzustand stehen:

| Form | Felder und Invariante |
|---|---|
| `portfolio.homeInheritance[JSON.stringify([profileId, homeId])]` | `{share, mode}`, bei Wohnrecht `residenceActive`; tatsächlicher Anteil auch für Stücke und Einstand |
| `portfolio.homeSales` | verkaufte oder vollständig abgegebene Immobilienkennungen |
| `personAccounts[].homeSaleProceeds` | je Immobilie `{homeId, amount, year}`, nominal; Nachlasszuordnung höchstens vorhandenes Geldvermögen |
| `portfolio.homeRent` | `{amount, startYear, inflationFactor, active}`, nominale Jahresmiete bei Verkauf; ohne selbst genutzten Notverkauf fehlend |
| `portfolio.equalizationInflows[profileId]` | Summe gebuchter geplanter Zuflüsse in Planstart-Kaufkraft; Betrag geteilt durch Pfadinflation vor dem jeweiligen Zuflussjahr, nur bei Zugewinngemeinschaft mit Zuflüssen |
| `portfolio.residenceTax` | `{profileId, annualValue, rate, annualTax, allowanceRemaining, immediateComparison}`, eingefroren im Todesjahr |

Nur bei aktivem Wohnrecht ergänzen Simulatorinputs `residenceReferenceYear` und `simulationPeople[].geburtsdatum` aus dem wirksamen Personenentwurf. Das Datum bestimmt das vollendete Alter am 1. Juli des modellierten Todesjahrs; ohne Datum bleibt die Altersfortschreibung erhalten. Speicherung und Profilformat ändern sich nicht.

Nachlasslog: Bei sofortiger Steuer und verfügbarem Depot ergänzt `inheritance.funding` das `reserveTarget`, tatsächliches `saleGross`, verwendetes `saleUsed`, `liquidityUsed` und zusätzliche `saleTax` in nominalen Euro. Bei „Immobilien und Steuergeld“ trennt `inheritedTaxCashUsed` den verwendeten geerbten Baranteil samt freigegebener Pflegereserve von eigener Liquidität; realisierte Nachlasslots zählen zu `saleUsed`. `saleUsed + liquidityUsed + (inheritedTaxCashUsed || 0)` entspricht der gezahlten Erbschaftsteuer samt zusätzlicher Kapitalertragsteuer; verbleibender Verkaufserlös zählt nicht als verwendet. Altbelege ohne dritte Herkunft behalten ihre damalige Zuordnung. Verhindert Heimpflege das Wohnrecht, gilt `residenceIneligible: true`. Ohne Steuer oder Depot entstehen keine Finanzierungsfelder. Nur bei positivem steuerfreiem Zugewinnausgleich ergänzt `inheritance.exemptGain` dessen nominalen Eurobetrag nach Kürzung um den steuerfreien Familienheimanteil im Verhältnis zum Endvermögen. Die [Aufrufkette](TECHNICAL.md#simulator-und-worker) bestimmt den Bewertungszeitpunkt. Weitere Nachlassfelder: `homeMode`, `moneyShare`, `minimumNominal`, `residenceCapital`; `inheritedHome` bei Wohnrecht null. Wirksame Erlöse ergänzen `inheritedSaleProceeds`/`homeSaleProceeds` mit Verkaufsjahr, Steuergeld `taxCash` und `taxCashSaleTax`. Sofortwahl erhält keine Jahressteuerzustände. Jährliche Wahl: `inheritance.residenceTax` ohne Personenkennung; Folgejahre `wohnrechtsteuer` und `residenceTaxPayment` mit profileId/annualValue/rate/annualTax/exempt/allowanceRemaining/due/paidCost/sources/shortfall. Verkaufsgewinn gehört ins Jahressteuerbuch. JSON/CSV bewahren additive Rohzeilenfelder; Altbelege erhalten sie nicht nachträglich.

Notverkaufslogs ergänzen `immobilien_notverkauf`, `wohnmiete`, `wohnmiete_startjahr`, `wohnmiete_aktiv`, auch bei Ruin. Nach Mietbeginn bleiben Mietfelder bei Ende mit 0 erhalten. Verkaufsfelder heißen `immobilienverkauf`, `immobilienverkauf_jahr`, `immobilienverkauf_personen`, `immobilienverkauf_hinweis`. Immobilienendwerte: `immobilien_wert_end`, `immobilien_selbst_end`, `immobilien_vermietet_end`. Nach Tod aller Personen fehlen Immobilien-, Geld- und Gesamtendwert einheitlich.

### Plan und geplante Ausgaben

`household-plan.js` bildet `scope = {kind, ids, key}`: household/single, sortierte eindeutige IDs, `key = JSON.stringify([kind, ids])`; single hat eine Person. `household_plan_v1`: `{version: 1, entries}` nach scope.key, je `{scope, updatedAt, values}`. `PLAN_FIELDS`, `PLAN_FIELD_PATHS`, `assertPlanValues` binden vollständige Feldliste; unbekannt/ungültig ist invalid, fehlender Bereich missing.

`values.liquidityCashMonths` speichert „davon im Tagesgeld“ in ganzen Monaten: Vorgabe 12, mindestens 0, höchstens `liquidityRunwayYears × 12`. Es ist unabhängig von `minCashBufferMonths`. Fehlt das Feld in einem alten Plan oder einer Sicherung, ergänzt nur die gelesene Projektion 12; Rohbytes und Zeitstempel bleiben unverändert. Kein Migrationsschritt. Der Aktionsbeleg erhält keine zusätzlichen Felder; interne Transfers und ihre Steuer bleiben Anzeige- und Spielbuchungsdaten. Der Balance-Input trägt den bestätigten Planwert mit; der optionale Wert im Balance-Dateiimport wird auf ganze Monate innerhalb der Reichweite geprüft. Ein Abschlussdialog erhält die zur Abschlusszeit gültigen Bestände und persönlichen Ziele nur als flüchtigen Anzeigekontext. `personalTagesgeldTarget`, `minimumTagesgeld` und `liquidityTargetBasis` sind Anzeige-/Ausführungsprojektionen, keine Plan- oder Belegfelder. Die Simulatorprojektion lässt den Tagesgeldanteil aus. [Aufteilung und Belegbedeutung](HANDLUNGSANWEISUNG.md#tagesgeldanteil).

`values` enthält Bedarf, Mindest-Flex, Flex-Budget, Reserven, Entnahme-/Dynamik-/Horizont-/Langlebigkeitswerte, Verteilung, `jointAssessment`, `decumulation` mit mode/bondTargetFactor/drawdownTrigger/bondRefillThreshold und `cape` mit value/asOf/source. Manuelles CAPE hält source manuell und Eingabedatum; erfolgreicher Jahresabruf ersetzt alle drei Werte. `minimumFlexAnnual` ist endlich, ≥0, ≤flexBedarf: validieren statt begrenzen. Der Rückgangsauslöser bleibt in Prozent gespeichert, auch bei Werten bis 1; der Rechenkern teilt stets durch 100. Unversionierte kleine Werte werden nicht als Brüche umgedeutet. Ohne Ehe wird `jointAssessment` in Balance und allen Simulatorläufen unwirksam. Writer prüft Scope und Ausgangsbytes; neue Bereiche entstehen über Umstellung.

`household_planned_expenses_v1`: `{version: 1, entries}`, je Scope `{scope, items}`. Feste Zeile: `{id, bezeichnung, betragMonat, ab, bis, anpassung}`; einmalige: `{id, monat, betrag, bezeichnung}`. Positive Euro, eindeutige IDs, Monatsgrenzen geordnet, Bezeichnung ≤60; Anpassung keine/inflation. `priceYear` 1–9999 wird nur bei Betragsänderung neu gesetzt; fehlend bedeutet 2026. Kein Personenrecord, deshalb kein Einzelpersonenexport. Fehlender Bereich ist leer, beschädigter bleibt Fehler.

Runner übernehmen `plannedExpenses`/`plannedExpensesReferenceYear`. Der alte Ansparmodus lehnt geplante Ausgaben vor Zustandsänderungen ab. `priceFactor` friert bestätigte Vorjahresinflation ein, fehlendes Jahr verwendet gespeicherten Inflationswert. Balance nutzt dieselbe Projektion. `geplante_ausgaben` protokolliert nominale Zahlung getrennt vom Budget. Backtest-CSV ergänzt nur bei Plan `planned_expenses_nominal_eur`; ohne Plan alte Spaltenfolge.

Monatsimport hält optional `plannedExpenses` als `{id, month, label, amount, scopeKey}` je Profilmonat. Positive bestätigte Zahlung, Summe ≤Import, Kombination Scope/ID/Monat eindeutig. Rohkategorien bleiben vollständig; nur Budgetverbrauch zieht Zahlungen ab. Reimport bietet vorhandene Nachweise auch nach Planlöschung erneut ausgewählt an; nur ausdrückliches Abwählen oder Löschen des Monatsimports entfernt die Zuordnung. Zahlungsfelder lesen Tausenderpunkte und ein Dezimalkomma ohne zusätzliche Rundung. CSV-Aggregate und gespeicherte Kategoriesummen müssen endlich sein. `hasExpenseImport` liest endliche Zahlenstrings aus Altständen auf Ausgaben und im Monatsabschluss gleich. Lade-, Restore- und Speichergrenze weisen unzulässige Kategoriewerte wie null zurück; der Loader meldet corrupt für die vorhandene Recovery. Speicherprüfung nur für geänderte Records; Rücknahme eines fehlgeschlagenen Imports stellt unter Kandidatenvergleich die gesicherten Originalbytes wieder her.

### Tranchen und Ausführungsbelege

`types/tranche-contract.js` validiert `depot_tranchen` als Array, Schema 2 je Lot; fehlend/0 und 1 sind unterstützte Altversionen. Identität: trancheId/name/isin/ticker; Bestand: shares/purchasePrice/currentPrice positiv; Zeit: purchaseDate/asOf; Steuer: tqf als Verhältnis, taxExempt als Flag; notes sowie abgeleitete marketValue/costBasis/instrumentId. Kaufvorlage für Aktien ist je Eigentümer zuerst der Neubestand, dann ein anderer Aktienfonds, innerhalb dieser Gruppen nach Kaufdatum und Tranche-ID; `equityPurchaseTemplate` wird von Balance und Simulator verwendet. Der Simulator hält die persönliche Kauf-Teilfreistellung vor Bestandsänderungen fest. Bei genau einer Person ergänzt er fehlende Eigentümer; aggregierte Alteingaben behalten `tqfNeu` für Neukäufe. Klassifikation: equity mit aktien_alt/aktien_neu, money_market/geldmarkt, gold/gold, bonds/anleihe. Eindeutige IDs und gesamte Collection prüfen.

Haushaltslots sind tiefe Kopien mit Profilpräfix und `sourceProfileId`, kein reales Lotfeld. Simulatorstatus absent/empty/valid/corrupt: explizit leeres Array bleibt leer. Positive Aggregate ohne Detailherkunft im Detailhaushalt liefern `SIMULATOR_PROFILE_ASSET_PROVENANCE_MISSING`, Schäden `SIMULATOR_PROFILE_TRANCHES_CORRUPT`. Tagesgeld braucht keine Lots.

`trancheReconciliation` im Registryprofil, Schema 1: profileId/trancheId/actionId binden Ausführung. Ereignisse sale_reconciled/cash_posting_confirmed/cash_posting_corrected; Cashstatus pending_manual_posting/confirmed_already_reflected/legacy_unknown/confirmed_manual_posting/confirmed_corrected. Stücke und Beleg werden gemeinsam bestätigt; identische Wiederholung No-op, Fremdmutation Fehler. Erlös erhöht Tagesgeld nicht automatisch.

Spielwerte tragen `source: spielwert`, Verkäufe optional `actual.taxes`; Netto = Brutto − Gebühren − Steuern. `playActionExecutions` hält Kennung, Datum, Personen, Verkaufskennungen, Nettoerlös, Kaufsumme und Tagesgeld vor/nach Gutschrift. Offene Verkäufe verändern Tagesgeld noch nicht; separate Gutschrift bestätigt die normalen Belege. Reine Käufe buchen sofort. Diese Herkunft ist nur im Spielbereich erlaubt.

## Belege

### Jahr und Monat

`balance-annual-period.js`: `calendar-year:J`, Schema 1, lastCommittedPeriod/pendingCommit; snapshot_confirmed/writes_started/validating, bei ungeklärter Rücknahme incomplete_recovery. Nach einem bestätigten Abschluss ist nur das direkte Folgejahr zulässig; Überspringen scheitert vor Snapshot und Fachwrite. `resolveAnnualTargetYear` wählt das nächste offene Jahr, höchstens das letzte vollständige Kalenderjahr; alle Abschlussphasen und der historische Dezemberbeleg erhalten dasselbe Zieljahr. Altperioden brauchen belegte Zuordnung.

`annual_plan_record_v1`: `{version: 1, entries}` nach `JSON.stringify([Planjahr, scope.key])`; year/scope/periodId/committedAt/recommended/adopted/adjusted/adjustedFields. Abschluss J beschließt J+1. Vorschau, Empfehlung, Beschluss und Summary rechnen mit denselben persönlichen Tagesgeldwerten aus den direkt überschreibbaren Feldern im privaten Entwurf. Der bestehende Jahresmarker schützt die Inflationsfortschreibung des tatsächlich verwendeten Einzel-/Haushaltszustands; alle Haushaltskopien erhalten denselben Faktor. `adopted.snapshot` hält Plan, Inflation und Januaralter. Neue Belege behalten ungerundete Bedarfe, CAPE, Inflation und Monatsbudgets; alte gerundete bleiben gültig. Vorhandene Jahr-/Scope-Belege werden nicht überschrieben. Optional recommended/adopted.plannedPosts mit Jahr, offener Reserve, Jahressumme, Monatsliste und Zahlungsstatus.

`annualMarketDataMeta` im haushaltseigenen Balance-State bleibt Schema 1: `periodId`, `targetYear`, `price`, `asOf`, `ticker`, `source` und `ath = {value, yearsSince, evaluatedAsOf, lastHighAsOf}`. Optional `ath.reading`: `year_high` nach ausdrücklicher Jahreshochwahl, sonst `year_end`. Fehlt das Feld, gilt lesend `year_end`; Altbytes werden nicht ergänzt. Nur die Jahreshochwahl ersetzt `inputs.ath`, `inputs.jahreSeitAth` und Hoch-Metadaten. Das Alter ist die Tagesdifferenz vom Hochdatum bis zum 31.12. des Abschlussjahrs geteilt durch 365,2425. Im Folgejahr zählt die bestehende Jahresendregel +1; ein Schluss am Hoch setzt 0, ein höherer Schluss erneuert das Hoch. Ohne Jahreshochwahl bleiben die bisherigen Abschlussrecords bytegleich. Import akzeptiert beide Lesarten und alte Exporte ohne Feld, einschließlich früherer Eingabeschlüssel. Bei `year_high` muss das Hochdatum im Abschlussjahr vor dem Stichtag liegen und das Alter größer als 0 sein; `inputs.ath` und `inputs.jahreSeitAth` dürfen danach in der Balance geändert sein.

Bei Jahreshochwahl halten `recommended.snapshot.marketReading` und `adopted.snapshot.marketReading` im Jahresbeleg `{reading: 'year_high', value, asOf}`. Der Beleg bewahrt damit die Herkunft auch nach späteren Jahresabschlüssen. Ohne Jahreshochwahl fehlt die Ergänzung. Ergebnis, Protokoll und Handlungsanweisung lesen die Wahl aus dem passenden Beleg beziehungsweise dessen Abschlussresultat.

`overview_balance_summary_v1`: Version 1, entries nach Jahr/Scope, Monatsentnahme/-budget und createdAt; ersetzbare Anzeige, kein Beschluss. `overview_month_provision_v1`: Version 1, entries nach `JSON.stringify([YYYY-MM, scope.key])`, month/scope/completedAt; Cash, Registry und aktive Projektion gemeinsam bestätigt. Der Abschluss speichert gültige Feldwerte ohne separate Tagesgeldbestätigung; Vorbelegung aus dem letzten Stand, ohne bekannten Stand leer. Im Spielbereich wird nur ein unverändert belassener Vorschlag als `playValues` mit Herleitung gespeichert; eigene Eingaben sind normale Werte. Neue Spielvorschläge enthalten keine ungenutzten `withdrawals` mehr und lesen keinen Entnahmeplan. Rente und feste Einkünfte zählen monatsgenau; bereits gespeicherte Herleitungen bleiben lesbar. Jahr und Dezember haben getrennte Wiederholungsgrenzen.

`balance_expenses_v1`: Version bleibt 1, activeYear/years mit Monats-/Personenrecords. `categories` enthält unverändert signierte EUR-Summen. Optional `categoryNeeds: { [Kategorie]: { floor: number, flex: number } }`, dieselben Kategorien und Vorzeichen, floor + flex entspricht der Kategoriesumme auf den Cent. Ohne Feld keine Aufteilung. Reimport ersetzt den Personenmonat einschließlich dieses Felds; ohne Bedarfspalte entfällt eine alte Aufteilung. Loader ok/empty/corrupt; ungültige Aufteilungen bleiben beim Laden und Speichern unverändert erhalten. `diagnostics[].code = expenses-category-needs-invalid` nennt Jahr/Monat/Profilkennung. Rechnen und Anzeige behandeln den Monat als ohne Aufteilung; die Haushaltskarte nennt Monat und Person mit der Aufforderung zum Neuimport. Kategorien bleiben erhalten. Vollsicherung, Spielbereich und Wiederherstellungspunkte transportieren den Record vollständig. Signierte EUR-Kategorien werden erst saldiert, dann als Betrag angezeigt: Nettoabfluss. Sicherungszeit ist Zeitstempelstring, Vergleichsbasis kommt aus `data-backup-summary.js`; ein Snapshot ersetzt beides nicht.

### Jahreszustand

| Wert im State | Verwendung im Folgejahr |
| --- | --- |
| `flexRate` | Tatsächlich finanzierter Flex-Anteil nach Rundung; Ersatzanker für alte Zustände. |
| `flexRateSmoothingReference` | Ratenanker vor Rundung, bei Notlage besondere Referenz aus B12. |
| `lastEntnahmeReal` | Letzte Jahresentnahme nach Rundung geteilt durch den beim Beschluss verwendeten kumulierten Inflationsfaktor; im Simulator zählt die tatsächlich ausgezahlte Entnahme. |
| `peakRealVermoegen` | Bisher höchstes reales aktives Geldvermögen; Basis des Rückgangs. |
| `peakLockedHealthBucketReal` | Zuletzt geführte reale gesperrte Pflege-Rücklage; bereinigt nach FR-35 den Höchststand bei Änderungen der Rücklage. Gespeichert, sobald eine Rücklage besteht oder das Feld bereits vorhanden ist; Altstände ohne Feld verwenden 0. |
| `cumulativeInflationFactor` | Gemeinsame Geldbasis für Entnahme und Vermögen. Die Aufrufer führen ihn fort. |
| `alarmActive` | Fortbestehender Alarm und dessen Ausstiegsprüfung. |
| `flexBudgetBalanceYears` | Verbleibende Regeljahre des Flex-Budgets. |
| `vpwSafetyStage` | Wirksame Sicherheitsstufe zu Jahresbeginn. |
| `vpwSafetyRiskStreak`, `vpwSafetyStableStreak` | Folgen kritischer und stabiler Jahre. |
| `vpwSafetyReentryRemaining` | Verbleibende Rückkehrschritte zur Dynamik. |
| `vpwLastDynamicFlex` | Letzter dynamischer Bedarf vor Haushaltsdeckeln als Basis des Sicherheitsbodens. |
| `vpwExpectedRealReturn` | Geglättete Renditeannahme für A2. |
| `lastMarketSKey`, `lastTotalBudget`, `lastInflationAppliedAtAge` | Mitgeführte Markt-, Budget- und Fortschreibungsangaben. Der Budget-Floor liest `lastTotalBudget` nicht als sein Ziel. |

### Verlauf

`rs_wealth_history_start_v1`: `{version: 1, startDate, confirmed?}`. Nur `confirmed: true` belegt eine ausdrückliche Beginnbestätigung; automatisch gesetzte und ältere Records ohne Marker bleiben bis zur Bestätigung im Formular. Der optionale Marker ist boolesch und ändert weder Datum noch Bewertungsrechnung. `rs_daily_prices_v1`: version/symbols, je Symbol currency, aufsteigende eindeutige UTC-days, gleich lange positive closes, queried/failures/lastError. Abfrageabdeckung ist keine tägliche Preisabdeckung. Abgefragte Börsentage ohne Schluss fragt der Abruf bei jedem Lauf erneut ab, bis sie 10 Tage zurückliegen; Lücken vom 20.09. bis 20.11.2026 fragt er nach, bis sie 45 Tage zurückliegen. Nachprüfblöcke enthalten nur Tage ohne Schluss.

`profile_wealth_history_lots_v1` hält version 1/lots: capturedAt, kanonische tranche, remainingShares, status present/sold/unknown; optional uncertainty mit fromDate/originalTranche und manualCorrectionAt. Verkaufte Lots bleiben mit 0 Reststücken erhalten. `profile_cash_history_v1` hält version 1/baselineValue/entries mit datierten absoluten Cashständen; ein Write ersetzt nur den geschriebenen Tag durch seinen letzten Stand, bei Rückkehr zum Vorwert entfällt er. `profile_tagesgeld_confirmed_date` ist optionales YYYY-MM-DD aus der App-Uhr, getrennt vom fachlichen Abschlussstichtag. Ein unveränderter Feldwert beim Abschluss aktualisiert nur das Prüfdatum und ändert Betrag/Verlauf nicht; nach mehr als 35 Tagen fordert die Übersicht erneut zur Prüfung auf. Lesende Charts ergänzen keine Bestandswrites. `wealthHistory` im Balance-State: Schema 1/entries, manuelle Identität manual:Datum, Jahre über Periode; frühestens 01.01.2026. `rs_household_wealth_captures_v1`: Schema 1/captures, je capturedAt/household/people; gemeinsamer Stichtag, Gold/Anleihen getrennt, total aus Geldkomponenten und Personen summengleich. Manuelle Tage ersetzbar, bestätigte Jahresstände erhalten. Altbestände bleiben gültig ohne erfundene Personenaufteilung. Messpunkte und aus Kursen bewerteter Verlauf sind getrennte Datenformen.

### Simulatorabweichungen

`SIMULATOR_PLAN_FIELD_MAP` projiziert floorBedarf/flexBedarf nach startFloorBedarf/startFlexBedarf und cape.value nach marketCapeRatio. `household_simulator_needs_v1` und `household_simulator_needs_warning_ack_v1` sind Altverträge; gültiger gemeinsamer Plan hat Vorrang. sim_survivorFloorPercent 40–200 (Vorgabe 75), beide Flexanteile 0–100. `sim_pflegeCustomCosts` merkt fünf Zahlenstrings nach Grad; nur Eingabemerker, kein Rechenpayload.

Personenalternativen sind flüchtig. `personDataContext` ist eingefroren: schemaVersion 1/referenceYear/ageRule/deviationApplied/persons. CSV: `personDataReferenceYear`, `personDataDeviationApplied`, `personDataChanges`; JSON behält das Objekt. Spätere Eingaben verändern Downloads nicht.

Backtest-CSV: portfolio_equity_end_nominal_eur ohne Anleihen, portfolio_bond_bucket_end_nominal_eur separat; portfolio_cash_end_nominal_eur enthält Pflegereserve, health_bucket_end_nominal_eur ist Davon-Feld. Aktien+Anleihen+Gold+Liquidität ergeben portfolio_total_end_nominal_eur. `summary.healthBucket` enthält enabled/end/realCoveragePct/targetGap aus der letzten Zeile mit `health_bucket_enabled === true`; ohne aktivierte Zeile false/0/null/0. Optionale MC-Pfadfelder displayHomeValueNominalEur/displayHomeValueRealEur fehlen ohne Immobilien; displayWealth dient Anzeige, nicht Finanzmetriken.

MC-Pfadfelder `healthBucketUsedRealEur`, `healthBucketEndRealEur` und `healthBucketTargetGapRealEur` messen Startkaufkraft, auch bei Ruin. Nutzung wird mit dem Jahresanfangs-, Endbestand und Ziellücke mit dem Jahresendfaktor umgerechnet. `healthBucketInterestAmounts` enthält je aktiviertem Rücklagenlauf die Summe seiner nominalen Jahreszinsen, einschließlich null und negativer Werte. `healthBucketUsedEur` zählt nominale Nutzung; reale und nominale Nutzungsquantile verwenden nur Läufe mit positiver Nutzung, bei aktivierter Rücklage ohne Nutzung 0. Restbestand und Ziellücke verwenden alle aktivierten Rücklagenläufe. `health_bucket_interest` bleibt vorzeichenbehaftet; negativer Zinsabzug höchstens bis zum vorhandenen Reservebestand.

### Optimizerrequest

Die angebotenen Suchdimensionen stammen aus `AUTO_OPTIMIZE_PARAMETER_OPTIONS`: liquidityRunwayYears, goldTargetPct, goldRebalancingBand, maxSkimPct, survivalQuantile und goGoMultiplier. horizonYears und maxBearRefillPct sind Kompatibilitätsrequests; direkter Horizont ist bei aktuarieller Ableitung unanwendbar.

| Objective | Gelesenes Feld |
|---|---|
| EndWealth_P50/P25 | angefordertes Endvermögensquantil |
| SuccessRate | successProbFloor |
| Drawdown_P90 | worst5Drawdown |
| TimeShare_WR_gt_4_5 | timeShareWRgt45 |
| Median_WR | medianWithdrawalRate |

`direction = min` negiert nur die Rangbewertung. Aktivierte Constraints prüfen Floor-Erfolg ≥99 %, Erschöpfung ≤0,5 %, Quotenzeitanteil ≤1 % und Drawdown-Metrik ≤55 %. Missingness bleibt Fehler statt erfüllter Grenze.

### Ergebnisdateien

`runMeta.equityCagr` ist die nominale geometrische Aktienjahresrendite als Verhältnis, etwa 0,05 für 5 %. Sie verwendet nur vollständig gerechnete Finanzjahre; ohne Finanzjahr ist sie `null`. Das Szenario `typicalMarket` wählt den nach Rendite und absolutem Laufindex sortierten Lauf an Position `floor(n / 2)` aus den endlichen Werten. Seine `sourceIdentity.selectionMetric` lautet `nominal_equity_cagr`. Die Vermögensszenarien behalten `nominal_terminal_wealth_eur`; sichtbare Namen nennen das Geldendvermögen. Diese Laufmetadaten ergänzen keine Persistenzrecords und verändern weder Pfadsummary noch Heatmap.

| Format | Eigentümer unter `app/simulator/` und Inhalt |
|---|---|
| HistoricalBacktestExportV2/HistoricalBacktestCsvV2 | historical-backtest-export.js; Request, Ergebnis, Provenienz, Einheiten, Quantisierung, Fingerprints |
| MonteCarloExportV2 | monte-carlo-export.js/monte-carlo-contracts.js; Seed-/Daten-/Request-/Resultverträge, Outcomes, Missingness, optional result.kpis.euroMetrics als MonteCarloEuroMetricsV1 |
| ScenarioLogExportV2 | monte-carlo-export.js; ausgewählter Pfad, Annahmen, Personenbeleg und Geldbasis |
| Stress-Replay | stress-replay-export.js; materialisierter Markt-/Ereignispfad und Varianten |

`overview_simulation_summary_v1`: Version 1/entries nach `[scope.key, kind]`, kind backtest/montecarlo/workshop; scope/completedAt/statement/priceBasis/fingerprintVersion/sourceFingerprint/runFingerprint/deviationApplied/metrics. Quellfingerprint Version 2, SHA-256, ohne Namen/Anzeige-/Workerwahl. Optional Mindest-Flex-Belege bleiben fehlend/null statt heutiger Ersatzwerte. Kurzfassung und Ergebnisdateien sind weder Vollsicherung noch restartfähiger Bestand.

### Paritätsbelege

`types/parity-replay-log-v1.schema.json` und `parity-replay-contract.js`: ParityReplayLogV1 mit source (sourceHash/engineVersion/datasetHash/temporalConventionId), initialRecords, years, limitations/captureIssues/logHash. Je Jahr: historicalYear/logicalPlanningYear, VOR_TRANSAKTION, engineInput/engineLastState/options/expectedDecision, assumptions/householdEvents/effectiveAnnualPensions/cashAndLots/marketContext/horizonContext/resetEvidence und beide Simulatorzustände. SHA-256 über kanonische JSON-Werte ohne logHash. Fehlende Herkunft null, undefined/-0 über $parityValue markiert, unbegrenzte Reichweite ausdrücklich UNBEGRENZT; andere nicht endliche Zahlen sind Fehler. `ParityCaseV1` bewahrt Anfangsrecords, Messungen und isolierten Einzelfall samt Sequenzereignissen. [Aufruf und Beweisgrenzen](TECHNICAL.md#paritätsreplay).

## Austausch

### Vollsicherung

`persistence-backup.js`: backupType ruhestand-suite-full-persistence-backup, app ruhestand-suite, Export schemaVersion 2 (Import auch 1), exportedAt/runtime, recordScope authorized-application-records, records/localStorage inhaltsgleiche Stringmaps, recordCount und excludedRecordCount/excludedKeys. Schema 1 filtert Altumfang, Schema 2 weist unerlaubte Keys zurück. Prototype-Keys, falsche Anzahl/Alias und Domänenschäden verhindern Import. Archiv ist ausgeschlossen. Import ersetzt den zugelassenen Umfang einschließlich fehlender Zielrecords; bestätigter Recoverypunkt vorher. Schlüsselversionen bleiben bis zu Kontrollvergleich und Rücknahme maßgeblich: Neuere Eingaben bleiben erhalten und werden geflusht; zurückgenommen werden nur unverändert eigene Schreibwerte. rollback_failed sperrt, Probelaufsteuerung blockiert Austausch.

### Person und Restore

`profile-bundle-io.js`: bundleType ruhestand-suite-profile-bundle, app ruhestand-suite, schemaVersion 1, Profilversion/exportedAt/Anzahl/registry/currentProfileId/globals. `profile-person-file.js`: genau eine Person ohne Globals und ohne Ausgaben. Der Export enthält kein `expenses`; beim Import wird ein vorhandenes Zusatzfeld `expenses` ignoriert. Der Ausgabenstore wird nicht geschrieben. Konfliktfreie neue ID/Name, zunächst Außenprofil. Aktive Person und Plan bleiben erhalten. Migration vor Filterung; ungeklärte Partnerzuordnung sperrt Vorschau.

Snapshot: `schemaVersion: 1`, `snapshotType: persistence-records-v1`, id/kind/createdAt/label/Profilangaben/recordCount/records/restoreScope. Die [technischen Abläufe](TECHNICAL.md#wiederherstellungsarchiv) trennen Archivbestätigung, Fachwrite und geschützten Reload.

| Umfang | Vertrag |
|---|---|
| Standardrestore | Registry erhalten, Zielprofil muss existieren; andere Profile bleiben erhalten. |
| `profile-management-before` | Vor Personenlöschung und Mitgliedschaftsänderung alle erlaubten Importrecords sichern. Diese Punkte sowie vorhandene Altpunkte einer früheren Tranchengesamtlöschung verwenden für Registry und Livebestand `replace-all-rollback`, `liveKeyMode: full-import`; auch gelöschte Personen, Partnerschaft und Plan werden bytegleich zurückgeholt. |
| Haushalts-Monatsrückkehrpunkt | Beide Restore-Modi `replace-all-rollback`; gesamter erfasster Umfang einschließlich aller Personen, Cashverläufe und Monatsbelege. |

`validateProfileManagementRecords` prüft Registry, Kennungen und betroffene Personendaten inhaltlich; beim Löschen der angezeigten Person auch deren Ladefallback. Für `rs_profile_live_base_v1` prüft es ausschließlich den Stringtyp, weder JSON-Struktur noch Prüfsummenkonsistenz. Unveränderte gemeinsame Bereiche wie Plan, Ausgaben und Sicherungsvergleichsbasis sperren die Personenaktion nicht, gehören aber vollständig zum Vorabpunkt. Dieser entsteht nach den schreibfreien Vorprüfungen und wird vor dem Write dauerhaft zurückgelesen. Die Vorschau darf einen Altpunkt mit mehr als zwei Mitgliedern zurückholen und nennt die Rechnungssperre bis zur Haushaltskorrektur.

Anlässe sind `annual-close-pre-mutation`, `monthly-close-pre-mutation`, `balance-import-recovery`, `full-backup-import-recovery`, `person-data-migration-recovery`, `household-plan-migration-recovery`, `probelauf-before`, `probelauf-transfer-before`, `new-beginning-before`, `before-restore-recovery`, `profile-management-before` und `manual`. `probelauf-before` dient nur der Ablösung alter Sitzungen. Vergleichbare manuelle und monatliche Punkte sowie Vollimport-, Balanceimport-, Restore- und Spielbereich-Rückholpunkte bleiben einschließlich 30 Tagen vollständig; danach je Monat und Umfang ein letzter Stand, Rückholpunktarten getrennt. Ein älterer Punkt benötigt jüngere erhaltene Deckung mit identischem Umfang. `replace-all-rollback` wird als Ganzbestand nach tatsächlichem `liveKeyMode` und vollständigem Scope verglichen, unabhängig von der aktiven Person; es deckt keine Profilumfänge. `restore-target-profile` mit `restore-previous-live` wird nur für Restore-Rückholpunkte mit derselben Zielperson und demselben Scope verglichen. Nicht lesbare, beschädigte, benötigte und andere nicht vergleichbare Punkte bleiben. Jahresabschluss-, Umstellungs-, Neubeginn-, Übernahme-, Personenverwaltungs- und unbekannte Punkte bleiben beim Aufräumen dauerhaft. Nur freie lesbare Personenverwaltungspunkte sind zusätzlich einzeln löschbar. Einzelpunktlöschung prüft Identität, Referenzen und Löschbarkeit erneut; Aufräumen prüft außerdem die Deckung vor jedem Delete. Das Speicherformat bleibt unverändert.

Ein Indexeintrag allein beweist keine Wiederherstellbarkeit. IndexedDB führt die Altbereinigung mit einem laufenden Hintergrund-Löschauftrag aus; Archiv und Abschlüsse warten nicht darauf. Erst Löscherfolg setzt den Bereinigungsmarker. Altkey-Writes invalidieren den Migrationsmarker und ändern eine Generation in derselben Transaktion. Ein Scan setzt seinen Abschlussmarker nur bei unveränderter Generation im atomaren Abschlussvergleich; bereits migrierte Punkte bleiben unverändert.

## Lebenszyklus

### Migration, Spielbereich und Recovery

Migration bestätigt Quellenwahl und Vorabpunkt statt still neue Kalenderdaten zu erfinden. Personenimport erhält datierte Altannahmen; bereits umgestellte Strings ohne neue Altangaben bleiben unverändert.

`rs_probelauf_state_v1`: neue Sitzungen Version 2, active true, phase starting/active, source copy/demo, runtime/testDate/hasDateJump; startedAt/realDomainChecksum/initialDomain/initialMonteCarloRuns belegen den Start. Version 1 dient nur Ablösung über alten Rückkehrpunkt. Datumssprung setzt dauerhaft synthetische Kurse. Nur Kopie ohne Sprung und mit gleicher echter Fachprüfsumme ist übernehmbar. CAPE zählt als Marktdatum weder zur Fachprüfsumme noch zur Änderungsliste; die Übertragung erhält deshalb den aktuellen echten `values.cape` samt Datum und Quelle je Planbereich, auch in Profilkopien. Vorabpunkt probelauf-transfer-before mit liveKeyMode play-transfer schützt vollständigen Registry-/Live-Rollback; Steuerung/Archivcontainer getrennt.

„Neu beginnen“ verlangt bestätigte Sicherungswahl. Ohne Archivlöschung Vorabpunkt new-beginning-before mit liveKeyMode new-beginning, sonst kein interner Rückweg. Hauptumfang und optional Archiv werden geleert, geprüft und geschützt neu geladen. Ungeklärter Speicher, Recovery und Probelauf sperren den Vorgang. [Technische Sequenz](TECHNICAL.md#navigation-und-laufende-operationen).
