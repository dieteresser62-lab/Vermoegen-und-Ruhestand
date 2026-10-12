# Tranchenmanagement – Modul- und Vertragsreferenz

**Stand:** 2026-10-06
**Rolle:** Verbindliche Referenz fuer Ownership, Datenvertrag und Grenzen zwischen
„Personen & Vermögen“, Persistenz, Balance, Simulator und Engine.

## 1. Ownership und Einstiegspunkte

| Bereich | Primaere Module | Verantwortung |
| --- | --- | --- |
| Kanonischer Vertrag | `types/tranche-contract.js` | Schema, Kategorie-/Typ-Matrix, Normalisierung, abgeleitete Werte, strukturierte Validierungsfehler |
| Manager-State | `app/tranches/tranchen-manager-state.js` | mutationsfreies Laden, kanonisches Speichern, `empty`/`valid`/`corrupt`/`unavailable` |
| Manager-UI | `depot-tranchen-manager.html`, `app/tranches/tranchen-manager-page.js`, `app/tranches/tranchen-manager-modal.js`, `app/tranches/tranchen-manager-renderer.js` | Seitencontroller besitzt Autosave, Personenwechsel, CRUD, Profilwerte, manuelle aktive Kursbatches, fachliche Writes und bestaetigten Flush; Modal und Renderer besitzen Dialogschutz und Darstellung |
| Haushalt und Personen | `app/tranches/tranchen-manager-profiles.js` | rein lesende Haushalts-/Personenprojektion und delegierte Binder fuer Personenwechsel und Personendialog; keine eigenen fachlichen Finanzcommits |
| Verkaufsschritte | `app/tranches/tranchen-manager-sale-dialog.js` | Binder fuer Ausführung → Cash → Vorschau im vorhandenen Verkaufsformular; kein eigener Fachcommit, Vorschau und Ausführung bleiben beim Seitencontroller |
| Startkurse | `app/tranches/tranchen-startup-prices.js` | Binder ausschließlich auf der Startseite, DOM-freier Sitzungskoordinator und datensparsamer Ergebnisstatus mit lesbaren Person-/Tranchennamen |
| Personenverwaltung | `app/profile/profile-manager-bindings.js` | gemeinsame Namens-/Löschprüfung und Verwaltungsaktionen im Manager; Aufrufer besitzt Autosaveabschluss, Navigationsschutz, Flush und Recovery, keine fachlichen Finanzcommits |
| Profil-Recovery | `app/profile/profile-recovery-ui.js` | gemeinsame profilbezogene Recovery mit Export, ausdrücklich bestaetigtem Reset und geschütztem Retry/Reload fuer Startseite und Manager |
| Quotes | `app/tranches/tranchen-price-service.js` | Yahoo-Symbol-, Preis-, Waehrungs-, Zeit- und Quellenvalidierung |
| Status/Consumer | `app/tranches/depot-tranchen-status.js` | fail-closed Status fuer Balance und Simulator |
| Reconcile | `app/tranches/tranche-reconciliation.js` | Vorschau, explizit bestaetigte Fortschreibung real ausgefuehrter Verkaeufe und append-only Cashnachweis/-korrektur |
| Profilgrenze | `app/profile/profile-*.js`, `profilverbund-balance.js` | profilgebundener Rohbestand, Handoff/Flush, Haushaltsaggregation und Herkunft |
| Simulator | `simulator-profile-inputs.js`, `simulator-portfolio-init.js`, `simulator-portfolio-tranches.js` | Deep-Copy, Simulationslots und mutationsfreie Verwendung des Realbestands |
| Engine | `engine/transactions/sale-engine.mjs` | steuerbewusste Verkaufsplanung und Breakdown; keine Realbestandspersistenz |

Der Nutzerzugang liegt auf `index.html`: **Personen & Vermögen** öffnet
`depot-tranchen-manager.html` mit Person 1 als Standardstart; anerkannte Sprungziele haben Vorrang. Eine vorgeschaltete Profilwahl ist nicht erforderlich.
Personenwechsel sind direkt im Manager über die gemeinsame Ansichtsreiterliste mit
Initialavatar und „Öffnen“ möglich. „+ Person anlegen“ außerhalb der Tabrollen
und delegierte „…“-Menüs der Personenkarten öffnen denselben Personendialog;
der Rückfokus erreicht auch nach Rerender den Öffner derselben Person. Die Profilwahl und
Personenverwaltung auf der Startseite bleiben ebenfalls verfügbar.
Der Manager zeigt den Namen der tatsächlich geladenen Person und ihre technische
Profil-ID unter „Technik“. Der Handoff wartet auf den bestätigten Persistenz-Flush;
bei Fehler navigiert der Link nicht weiter. Auch der managerinterne Wechsel
schließt offene Profilautosaves ab und lädt den Zielbestand erst nach bestätigtem
Wechselflush (siehe Paket 5, Slice 1).

Der rahmenlose Kopf besitzt einen Einzel-/Mehrprofiltitel und die Kursaktualisierung; Kauf- und Verkaufsaktionen stehen im Depotkopf. Der gemeinsame Suite-Kopf zeigt Kursstand und Speichermodus; die Profilanzeige entfällt.
Der Kurskontext liest den bestehenden Sitzungsbericht ohne Requests oder Writes;
„automatisch“ verlangt passende erfolgreiche Profil-/Tranchen-/asOf-Belege für
alle dargestellten, einheitlichen und nicht alten Kurse. Unbekannte und gemischte
Stände bleiben sichtbar. Haushaltskarte, drei Personenkennzahlen, Allokation und
Reiter sind reine Projektionen. Der Hauptprofilbezug folgt der vorhandenen
Haushaltsreihenfolge statt der aktiven Auswahl; es gibt kein neues Rollenfeld.
Finanzberechnung und Speicherverträge bleiben erhalten. Browser-/Bildabnahme
der oberen Ansicht gegen 01–03/09 bei 1920/2560 px erfolgt durch die Steuerung.

## 2. Kanonischer Datenvertrag

Persistiert wird unter dem profilbezogenen Key `depot_tranchen` ein JSON-Array.
Der Feldname fuer Engine- und Simulatorinputs bleibt bewusst
`detailledTranches`. Beide Namen haben unterschiedliche Ebenen und duerfen nicht
umbenannt oder vermischt werden.

Eine persistierte Schema-2-Tranche enthaelt:

- `schemaVersion: 2`, stabile `trancheId` und einen nichtleeren `name`;
- optionale, normalisierte Identifikatoren `isin` und `ticker`;
- positive endliche `shares`, `purchasePrice` und `currentPrice`;
- optionales ISO-Kaufdatum `purchaseDate` (`JJJJ-MM-TT`);
- ein zulaessiges Paar aus `category` und `type`;
- explizit bestaetigte Teilfreistellung `tqf` zwischen `0` und `1`;
- den expliziten booleschen Steuerfreiheitsstatus `taxExempt`;
- optionale `notes`.

`marketValue`, `costBasis` und `instrumentId` werden abgeleitet. Persistierte
Fremdwerte fuer Marktwert/Cost Basis sind nicht die Rechenquelle. Beim
Profilverbund kommt `sourceProfileId` erst an der Engine-/Simulationsgrenze hinzu.
Die Laufzeit-`trancheId` wird dort als `<profileId>:<trancheId>` profilbezogen,
damit gleiche profilinterne IDs im Haushalt eindeutig bleiben. Der Manager
schreibt weder Provenienz noch die profilbezogene Laufzeit-ID in den Realbestand.

| `category` | Zulaessiger `type` |
| --- | --- |
| `equity` | `aktien_alt`, `aktien_neu` |
| `bonds` | `anleihe` |
| `money_market` | `geldmarkt` |
| `gold` | `gold` |

Widerspruechliche Schema-2-Paare, doppelte IDs, nicht endliche Finanzwerte,
fehlende TQF, fehlendes beziehungsweise nicht boolesches `taxExempt` oder
unbekannte Schema-Versionen werden gemeinsam und strukturiert abgelehnt.
Nur Aktien-/Aktienfonds-Tranchen duerfen eine positive TQF tragen. Geldmarkt,
Anleihen und Gold muessen `tqf: 0` verwenden. Es gibt keine Prioritaetsregel,
die einen aktuellen Widerspruch still korrigiert.

## 3. Legacy-Migration und Recovery

Unversionierte Datensaetze sowie `schemaVersion: 0` und `schemaVersion: 1` sind
ausschliesslich am Persistenzrand unterstuetzte Legacy-Eingaenge. Alte
Goldkodierung `tqf: 1` wird zu `tqf: 0` plus `taxExempt: true`; andere
Nicht-Aktien-TQF werden auf 0 gesetzt, waehrend Aktien-TQF erhalten bleibt.
Alle uebrigen Legacy-Tranchen erhalten `taxExempt: false`. Die Manager-UI zeigt
Anzahl und Art dieser Migration bis zur Nutzerbestaetigung an. `id` wird zu
`trancheId`, `kind` zu `type`; eine
fehlende Legacy-ID wird deterministisch aus Inhalt und Arrayposition erzeugt. Eine
fehlende Legacy-Kategorie darf eindeutig aus dem Typ abgeleitet werden, ein
fehlender Legacy-Aktuellkurs aus dem Kaufpreis. Fehlende optionale Text-/Datumsfelder
bleiben leer.

Die fruehere Manager-UI liess Kategorie und Typ unabhaengig auswaehlen. Deshalb
migriert der reine Persistenz-Lesepfad bei unversionierten Datensaetzen einen
alten Aktien-Typ (`aktien_alt`/`aktien_neu`) unter `bonds`, `money_market` oder
`gold` auf den jeweils einzigen kanonischen Typ. Diese enge Reparatur gilt nicht
fuer Schema 1, nicht an der Enginegrenze und nicht fuer andere Widersprueche.

Das Laden ist rein lesend und schreibt die normalisierte Darstellung nicht
automatisch zurueck. Dadurch gilt:

- gueltige Legacy-Daten normalisieren deterministisch und idempotent;
- `[]` bleibt ein explizit leerer Profilbestand und faellt nicht auf alte Live-Daten zurueck;
- nicht eindeutig migrierbarer Kategorie-/Typ-Widerspruch, Duplikat-ID und
  syntaktisch korrupter JSON-Rohtext enden `corrupt` und bleiben bytegleich erhalten;
- ein IO-/Backendfehler endet separat `unavailable` und bietet Retry, aber keinen Reset.

Im `corrupt`-Zustand blockiert der Manager alle normalen Writes. Nutzer koennen
zur Startseite abbrechen, das zentrale Komplettbackup wiederherstellen, den
Rohtext bewusst lokal anzeigen/kopieren oder einen ausdruecklich bestaetigten
Reset auf `[]` ausfuehren. Es gibt keinen separaten Tranchen-Teilimport oder
-export.

## 4. Persistenz und Profilgrenzen

Feature-Code nutzt `app/shared/persistence-facade.js`. Im Browser ist IndexedDB
die Source of Truth, in Tauri eine JSON-Datei im App-Datenverzeichnis;
`localStorage` ist nur Legacy-Migrations- beziehungsweise Fallbackpfad. Das
zentrale Komplettbackup auf Daten & Sicherung umfasst Registry und profilbezogene
Daten.

Create, Edit, Delete, Clear, Kursbatch, Profilwerte und Reconcile werden erst nach
erfolgreichem Facade-Flush als bestaetigt angezeigt. Bei Flushfehler stellt die UI
den letzten bestaetigten sichtbaren Cache-/Registrystand wieder her und laesst den
Vorgang retryfaehig. Wiederholte Initialisierung, BFCache und Tab-Rueckkehr duerfen
keine doppelten Listener oder Polling-Intervalle erzeugen.

Reconcile reduziert beziehungsweise entfernt das bestaetigte reale Lot und
protokolliert Brutto-/Nettoerloes sowie Kosten. Es bucht den Nettoerloes nicht
automatisch als freie Liquiditaet. Verbleibt der Brokererloes als Cash, muss
dieser in den Rahmendaten manuell nachgefuehrt werden. Neue Verkaeufe tragen
deshalb entweder den Default `pending_manual_posting` oder – nur nach expliziter
Nutzerwahl samt Cashstand – `confirmed_already_reflected`. Ein offener Verkauf
wird erst nach der manuellen Aktualisierung der freien Liquiditaet durch ein
eigenes `cash_posting_confirmed`-Ereignis geschlossen. Ein Tippfehler im
bestaetigten Cashstand wird nicht ueberschrieben, sondern durch eine lineare
Folge von `cash_posting_corrected`-Ereignissen berichtigt.

Der Verlauf bleibt als additive heterogene `schemaVersion: 1`-Liste in
`rs_profiles_v1.trancheReconciliation.actions` gespeichert. Fuer jeden Consumer
gilt deshalb verbindlich: zuerst nach `eventType` unterscheiden, erst danach
fachlich auswerten. Die Typen sind:

- `sale_reconciled`: Realverkauf mit maximal 128 Zeichen langer `actionId` und
  initialem Cashstatus;
- `cash_posting_confirmed`: Abschluss mit
  `actionId === confirmationActionId === cash-confirmation:v1:<targetActionId>`,
  Zielverkauf, centgleich kopiertem Nettoerloes, bestaetigtem Cashstand und
  Zeitpunkt; die ID darf maximal 149 Zeichen besitzen;
- `cash_posting_corrected`: Korrektur mit
  `actionId === correctionActionId === cash-correction:v1:<targetActionId>:<revision>`,
  lueckenloser Revision 1 bis 999999, Rueckverweis auf den aktuell wirksamen
  Vorgaenger, unveraendertem Nettoerloes, neuem Cashstand, Pflichtgrund und
  Zeitpunkt; die ID darf maximal 154 Zeichen besitzen.

Alle `actionId` sind ueber saemtliche Eventtypen global eindeutig. Nichtkanonische
IDs, unbekannte Eventtypen, Ziel-/Profilwechsel, geaenderte Nettoerloese, Luecken,
Forks oder veraltete Rueckverweise blockieren fail-closed. Eine fachlich gleiche
Wiederholung eines Abschlusses oder einer Korrektur ist auch mit neu erzeugtem
Submit-Zeitstempel ein No-op; der zuerst gespeicherte Nachweiszeitpunkt bleibt
erhalten. Dieselbe ID mit abweichendem Cashstand, Nettoerloes, Ziel, Vorgaenger,
Revision oder Korrekturgrund ist ein Konflikt. Die effektive Anzeige verwendet
nur den Cashstand der letzten gueltigen Korrektur, waehrend alle frueheren
Records unveraendert im Audit bleiben.

Historische Records ohne `eventType` werden nur im Leser als `sale_reconciled`
mit `cashStatus: legacy_unknown` projiziert. Auch sie muessen die unterstuetzte
Recordversion `schemaVersion: 1` tragen; eine fremde Version bleibt fail-closed.
Sie werden nicht umgeschrieben, gelten operativ als abgeschlossen, erscheinen
aber in Zeile und Zusammenfassung ausdruecklich als „Cashstatus nicht
dokumentiert“ statt als „Cash bestaetigt“. Eine freiwillige spaetere
Nachbestaetigung bleibt moeglich.

Der Korrekturdialog bindet Revision, kanonische Action-ID und Vorgaenger an den
beim Oeffnen gezeigten Stand. Er trennt den „Historischen Auditbetrag (letzter
Nachweis)“ vom „Aktuellen Tagesgeld-Stand“ und belegt nur den aktuell validierten
Profilbetrag vor. Unbekannte, nullwertige und beschädigte Livequellen erhalten
keine historische Ersatzvorbelegung. Öffnen und Abbruch sind schreibfrei.
„Aktuellen Tagesgeld-Stand übernehmen und Korrektur bestätigen“ bestätigt den
absoluten Betrag mit Pflichtgrund: unverändert nur ein Auditappend bei bytegleichen
Cashrecords, geändert Tagesgeld, Cashhistorie und Audit gemeinsam atomar.
Beide Cashrohrecords sind seit Öffnung gebunden und werden vor/nach Vorflush
sowie im Transaktionsvorreadback geprüft, auch bei unverändertem Betrag.
Ein Konflikt verlangt sichtbar einen neu geöffneten Dialog mit aktuellem Stand
und schreibt nichts. Technische Fehler behalten Editor und ursprünglichen
Retryauftrag; identische Wiederholungen nach späteren echten Profilwrites sind
vollständige No-ops mit unverändertem ersten Auditzeitpunkt. SOURCE-Node-Nachweise
liegen in den Seiten- und Reconciliationtests; die entsprechenden Browser-Smokes
in `tests/browser-smoke.test.mjs` sind extern auszuführen.
Hat ein anderer Tab die Kette inzwischen
fortgeschrieben, blockiert der Submit vor der Nutzerbestaetigung; er leitet nie
still eine neue Revision ab. Ein unlesbarer Audit besitzt im Manager einen
eigenen Fehlerzustand „Liste unvollstaendig“ und wird nicht als leere Historie
dargestellt. Balance und Simulator nennen Legacy-Faelle im Statusbadge und
zeigen dafuer keinen gruenen Cash-All-clear-Marker.

Vor dem ersten produktiven Einsatz dieses Cashstatus-Workflows ist auf
`Daten-Sicherung.html` unter `Vollsicherung > Jetzt sichern` ein zentrales
Komplettbackup anzulegen. Dieses Backup umfasst `rs_profiles_v1`; es gibt keinen
separaten Reconcile-Teilbackupweg.

## 5. Quote-Grenze

Kursupdates akzeptieren ausschliesslich normalisierte Yahoo-Symbole
und Quotes mit positivem endlichem Preis, `EUR`, plausibler UTC-Unixsekunde und
Quelle. Kurse duerfen maximal sieben Kalendertage alt und hoechstens fuenf Minuten
in der Zukunft liegen. Fremdwaehrung, fehlende Waehrung, Symbolabweichung,
Providerfehler, Rate-Limit, Timeout und Proxy-Nichterreichbarkeit besitzen stabile
Fehlercodes.

Der manuelle aktive Profilbatch im Manager dedupliziert Symbole, arbeitet mit
begrenzter Parallelitaet und seinem eigenen 12-Sekunden-Limit und schreibt
alle gueltigen Teilerfolge in genau einem bestaetigten Commit. Fehlerhafte Lots
behalten ihren alten Kurs; ohne einen einzigen Erfolg erfolgt kein Write.
Der einmalige automatische Sitzungsabruf läuft ausschließlich auf `index.html`
profilübergreifend mit einer globalen 15-Sekunden-Grenze (siehe Paket 5, Slice 4).

## 6. Balance-, Simulator- und Engine-Grenzen

Balance liest nur einen validen nichtleeren Bestand fuer FIFO. `empty` nutzt den
vereinfachten Aggregatpfad, `corrupt`/`unavailable` blockieren fail-closed.
Geldmarkt, Gold, Bonds und Aktien folgen derselben disjunkten Klassifikation; ein
Detailbestand ersetzt ueberlappende Aggregate und wird nicht addiert.

Der Simulator tiefenkopiert Profilinputs vor Haushaltsmerge und
Portfolioinitialisierung. Profilinterne IDs werden mit der Profil-ID eindeutig und
`sourceProfileId` bleibt bis zum Verkaufs-Breakdown erhalten. Teilverkaeufe
reduzieren Stueckzahl, Marktwert und Cost Basis proportional; Vollverkaeufe
entfernen das Lot aus spaeteren Engineinputs. Simulierte Kaeufe erzeugen eigene
`simlot:`-Lots, Legacy-Aggregate stabile `simbase:`-Lots. Keine Simulation schreibt
diese Mutationen in `depot_tranchen` zurueck.

Die Engine plant Verkaeufe, validiert eindeutige Lots und liefert `trancheId` sowie
`sourceProfileId` im `breakdown[]`. Sie besitzt keinen Persistenzpfad zum realen
Depot.

## 7. Empfehlung versus reale Ausfuehrung

Balance-Empfehlung, Jahresrechnung, Backtest, Monte Carlo, Sweep und Optimierung
sind schreibfrei gegen den Realbestand. Nach einer tatsaechlichen Brokerausfuehrung
erfasst der Nutzer im Manager eine stabile `actionId`, Profil, Lot, Datum,
Stueckzahl, Bruttoerloes und Kosten; eine Empfehlungsreferenz ist optional.

Die Vorschau ist schreibfrei. Erst die separate Bestaetigung schreibt Live-Lot,
Profil-Lot und den datensparsamen Auditverlauf in einem Flush. Eine identische
Wiederholung ist ein No-op; dieselbe `actionId` mit anderen Daten ist ein Konflikt.
Ueberverkauf, Profilwechsel oder ein seit der Vorschau veraenderter Bestand brechen
fail-closed ab.

Die Verkaufsvorschau zeigt zusaetzlich den initialen Cashstatus. Solange
`pending_manual_posting` gilt, darf die UI den Vorgang nicht als vollstaendig
abgeschlossen bezeichnen. Nach der eigenen Buchung des Nettoerloeses in den
Rahmendaten bestaetigt der Nutzer Zielverkauf, unveraenderten Nettoerloes und den
Cashstand im Cashdialog. Balance und Simulator zeigen offene Cashrueckstaende
profilbezogen an; ein Tippfehler wird im selben Dialog als append-only Korrektur
mit altem/neuem Cashstand und Pflichtgrund erfasst.

## 8. Test- und Aenderungsgates

Pflichtgates fuer querschnittliche Tranchenaenderungen sind:

```powershell
npm test
npm run test:browser
npm run test:coverage
```

Das Browser-Gate verwendet isolierte synthetische Profile und deckt Profilwahl,
CRUD, Quote, Reload, Profil A/B, mutationsfreie Empfehlung/Simulation,
idempotentes Reconcile, Pending-Anzeige nach Seitenwechsel, Cashabschluss,
append-only Korrektur, exakten Retry, Legacy-Projektion, Recovery, Tastaturfokus
und 390-Pixel-Layout ab. Das
Coverage-Inventar fuehrt zentrale Tranchenmodule explizit; ein geladener
0-Prozent-Pfad bleibt als `runtime-loaded-uncovered` sichtbar und gilt niemals als
vollstaendig getestet.

Weiterfuehrend: [Nutzeranleitung](../guides/MULTI-TRANCHEN-ANLEITUNG.md),
[Technikreferenz](./TECHNICAL.md), [Balance-Module](./BALANCE_MODULES_README.md),
[Simulator-Module](./SIMULATOR_MODULES_README.md) und
[Engine-Module](../../engine/README.md).

## Designsystem im Manager und Status

Managerfelder, Aktionen, Statistik, Tabelle, Cashstatus und beide Dialogflächen
verwenden additive `ds-*`-Rollen aus `css/components.css` sowie die gemeinsamen
Farb- und Schrifttokens. Bestehende IDs und `data-action`, stabile `data-tranche-id`-Zeilenaktionen,
`data-cash-action`, Dialogtitel und Listener bleiben erhalten. Geladene Tranchen
werden neutral dargestellt; nicht geladen, leer, fehlerhaft und offene manuelle
Cashbuchungen behalten ihre unterschiedlichen Aussagen und Sperrbedingungen.
Altverkäufe ohne Cashnachweis bleiben neutrale Information, keine Cashbestätigung.

`applyProfileRenteStatusToDom` in `profile-asset-values.js` zeigt ausschließlich die
bestehende normalisierte Ableitung `renteMonatlich + sonstigeEinkuenfte > 0`.
Das weiterhin gesperrte Select erhält `adopted` und einen sichtbaren,
über `aria-describedby` verknüpften Grund. Initialisierung, bestätigter Autosave
und Wiederherstellung nach Speicherfehler aktualisieren diese Darstellung.
Der Helper persistiert nichts; Profilkeys, gespeicherte Objekte, Validierung,
Debounce und Commit-/Retryvertrag bleiben unverändert. Bestehende Hilfebezüge
bleiben neben der stabilen Begründungs-ID erhalten.

Die Migration ändert weder Dialoglebenszyklus noch Commitreihenfolge. Der im
Funktionsinventar dokumentierte historische Rückfokusbefund F-06 ist seit Paket 5, Slice 3 für Cashaktionsknoten durch erneute Auflösung über den Zielverkauf abgesichert; die Browserprüfung bleibt offen. Tranchendialoge finden nach dem Austausch von Zeilenknoten den neuen Auslöser über dieselbe ID; Schließen/Escape und Abbruch behalten den Rückfokus.

## Container, Auswahlvolltext und deutsche Bestandszahlen

`tranchen-manager-renderer.js` formatiert ausschließlich die Ausgabe über
`designsystem-number-format.js`: Kauf-/Kurswerte in €/Stück, Gewinn in Euro und
Prozent, deutsche Kaufdatumsanzeige und tabellarische Zahlspalten. Gesamtwert
bezeichnet die Tranchen ohne Tagesgeld. Fehlende direkte Werte erhalten einen
Hinweis statt eines neuen Nullfallbacks; vorhandene Summen-/Gewinnberechnung,
Sortierung, ISO-Speichertage und Exportdaten bleiben unverändert.

`renderReconciliationOptions` aktualisiert an seiner bisherigen Renderstelle
über `designsystem-selection-text.js` den sichtbaren umbrechenden Volltext der
nativen ID-Auswahl. `change` aktualisiert nur diesen Text, keine Bestands- oder
Auswahlentscheidung. Managercontainer, schrumpfbare Statistikspalten und eigene
Tabellenregion mit Fortsetzungshinweis halten lange Bestände intern scrollbar.

Nachweise: `designsystem-manager`, `tranchen-manager-renderer`,
`designsystem-layout`, `designsystem-data-display` und der registrierte Browserfall
`Designsystem data layout` mit langen Namen, Auswahlwechsel/Reload und
Tastaturscrollen bei 1366/1920/2560 px. In der Sandbox scheitert der Browserstart
an `listen EPERM`; externe Browserabnahme und vorhandene Druckgrenzen bleiben.


## Rahmen-Rückweg (Paket 2a, Slice 3)

`#managerBackLink` liegt genau einmal am statischen Rahmenlink zur Übersicht und
trägt `data-profile-handoff`. Das unveränderte `updateActiveProfileLabel` setzt
weiter Profil-ID und ARIA-Beschreibung an genau diesem Element; `#suiteProfileContext`
ist die einzige Profilanzeige im Suite-Kopf. Der frühere Inhalts-Rücklink und seine Styles entfallen.
Recoverylinks bleiben eigenständig nativ, insbesondere `index.html#fullBackupImportBtn`
mit Aufklappen und Fokus am zentralen Import. Managerziele verzichten weiterhin
auf Export; der Rückweg wartet auf Export und bestätigten Flush. Node- und
registrierte Browsernachweise messen die identische Bindung. Browser-/Layout-/EXE-Abnahme
ist extern offen. Der Manager-Navigationsschutz ist in Paket 2b angebunden (siehe unten); Ergebnisablage folgt erst in 4.2.

## Navigationsschutz bei Managerwrites (Paket 2b, Slice 4)

`initTranchenManagerPage` registriert einen gemeinsamen
`createNavigationOperationLifecycle` und einen revisionierten Eingabe-/Retryprovider.
`runManagerOperation` besitzt Abgleich, Cashnachweise, CRUD, Korruptionsreset,
Profilwerte und Kursbatch. `commitTrancheReconciliation` und
`commitCashPostingEvent` wechseln unmittelbar vor der ersten Mutation in Commit;
`persistTranchen` und `saveProfileValues` ebenso. Der Besitzer bleibt bis zum
bestätigten Flush und vollständigen Rückschreib-/Fehlerabschluss bestehen.
`flush() === false` ist ein Fehler. Jeder ursprüngliche Key wird unabhängig
zurückgeschrieben; anschließend wird auch der Rückschreibflush abgewartet.
Ein Key-/Flushfehler behauptet keine dauerhafte Wiederherstellung. Die bestätigte
Tranche-/Profilanzeige und Cashprojektion bleiben erhalten, ursprüngliche
Wiederholungsaufträge einschließlich Action-ID bleiben erreichbar. Ein Retrymarker
ist ein Eingabeverlustgrund, kein aktiver Commit.

`#retryTrancheDialogSaveBtn` (statischer Tranchendialog) und
`#retryCashPostingSaveBtn` (`ensureCashPostingModal`) sind native, benannte
`type="button"`-Aktionen außerhalb der ersetzbaren Fehlerhosts. Sie rufen wie
`#retryTrancheSaveBtn` ausschließlich `retryPendingCommit` auf. Pending-Aufträge
blockieren konkurrierende Submits; Write, Rückschreiben und fremde Commitbesitzer
bleiben gesperrt. Tatsächliche Speicherfehler stehen live angekündigt im Dialog.

`captureManagerModalSubmission` hält Öffnungsidentität und Eingabesignatur als
reine UI-Metadaten. `finishManagerModalSubmission` schließt/bestätigt ausschließlich
den unveränderten Ursprungseditor. Bei Folgeeingaben bleibt der Editor geschützt
und meldet den bestätigten alten Auftrag getrennt vom unbestätigten Entwurf.
Der Tranchenseitenhandler stabilisiert den Editorbezug auf die bestätigte ID;
ein späterer bewusster Submit bearbeitet sie. Ein bereits bestätigter Casheditor
liefert keinen weiteren Auftrag; ein neuer Cashworkflow verlangt Schließen und
bewusstes Öffnen am aktuellen Audit. Eine neu geöffnete Instanz wird durch alte
Fortsetzungen auch bei identischen Werten nicht geschlossen.

Erfolgreiche Profilwertefortsetzungen behalten Flag und Besitzer durchgehend.
`setManagerControlsBlocked` deaktiviert sämtliche `PROFILE_INPUT_IDS` bereits
während der Kursvorbereitung sowie während Tranchen-, Cash- und Abgleichwrites
einschließlich Flush und Rückschreiben. Nutzereingaben in Profilautosave-Felder
sind in diesen Phasen nicht möglich; der abwehrende Listenerzweig kann nur durch
programmatisch gesetzte Werte und synthetische Ereignisse erreicht werden.
Nach bestätigtem Operationsende werden die Profilfelder wieder bedienbar und
neue Eingaben wie gewohnt automatisch gespeichert. Bestehende Fehler-/Retry-
sperren gelten weiterhin. Der Nodebeleg hält Fetch-Promises in `preparing` und
einen Tranchenflush getrennt an, prüft `#profileTagesgeld.disabled` vor und nach
der Sperre, ruft den echten Listener synthetisch auf und bestätigt anschließend
eine neue bedienbare Eingabe im Speicher samt Erfolgsstatus.
Kurskündigung nutzt Controller und Batch-ID und wartet sämtliche Jobs ab; nach
Abbruch starten weder Such-/Folgeanfragen noch Saves aus verspäteten Antworten.
Der bestehende Batchtimeout bleibt von der Navigationskündigung getrennt, damit
seine bisherige Teilresultatbehandlung erhalten bleibt. Der Sichtbarkeitsrefresh
läuft über `guard.reload` statt über einen direkten Reload.

Tranche-/Cashdialoge sperren Escape, Knopf und Overlay bei tatsächlichem Write.
`confirmed` allein umgeht weder eigene noch fremde Writes. Nur der erfolgreiche
Handler kann beim internen Schluss seinen noch aktiven Besitzer leihen; fremde
Commitprovider bleiben gesperrt. Flagende und Rerender erfolgen vor diesem Schluss,
der Besitzer endet danach. Dirty-Baselines umfassen Checkboxen und Selects;
Escape im obersten Schutzdialog erhält Fachdialog, Eingaben und Fokusauslöser.

Nodebeleg: `tests/tranchen-manager-navigation.test.mjs` hält tatsächliche Handler
an Flush-, Rückschreib- und Quote-Promises an. Browserfälle: `Navigation guard
manager commits`, `Navigation guard manager dirty inputs`, `Navigation guard
manager price preparation`. Ihre SOURCE-Assertions einschließlich übernommener
EXE-Schließversuche verwenden das Facade-/Protokolldoppel; echte Rust-/EXE-Abnahme
und Browserausführung außerhalb der Sandbox bleiben Aufgaben der Steuerung.

## Historiengrenze

Reale Dirtydialoge aktivieren die native Browsernachfrage nach Nutzeraktivierung
auch bei Zurück, Vor, Reload und `page.close({ runBeforeUnload: true })`. Ablehnung
erhält Dokumentidentität und Eingaben; Zustimmung erreicht das echte Zieldokument
oder schließt den Tab. Diese native Nachfrage wartet keine asynchrone Speicherung
ab und sperrt keine zusätzlichen Browser-/Betriebssystemkürzel. App- und
übernommener EXE-Schließschutz behalten ihre vollständige Commit-/Abbruchordnung.
Erzwungenes Ende bleibt Recoveryfall. Browser: `Navigation guard browser history`
und `Navigation guard native paths`; tatsächliche Abnahme durch Steuerung offen.

## Personen & Vermögen (Paket 5, Slice 1)

Der Einstieg `depot-tranchen-manager.html` zeigt zuerst eine Ansichtsreiterliste und getrennte Plan-/Personenpanels; Haushalt/Personenkarten liegen im Planpanel. `tranchen-manager-profiles.js` trennt rein lesende Kartenprojektion vom delegierten Wechselbinder. Haushaltsmitgliedschaft ist `belongsToHousehold !== false`; alle Profile behalten einen Reiter. Ungültige Daten verhindern eine scheinbar vollständige Haushaltssumme. Vermögen zählt Marktwert plus Tagesgeld; Buchgewinn ist Marktwert minus Einstand, Pflegereserve bleibt Ziel innerhalb der Liquidität.

Reiter und „Öffnen“ verwenden `selectManagerView` im Seitencontroller; bei einem Profilwechsel ruft dieser Einstieg `switchManagerProfile` auf. Noch offene Profilautosaves werden vor Kennungswechsel mit dem vorhandenen Saver und bestätigtem Flush abgeschlossen. Der gemeinsame Navigationsschutz hält Bleiben, Verwerfen, Commitbesitz und Kurskündigung zusammen. Erst nach bestätigtem Wechselflush lädt `initTranchenManagerPage({ profileId })` Zielbestand, Formulare, Profil-/Suiteanzeige und neue Baselines; Listener bleiben je Dokument einmalig. Fehler erhalten die bestätigte Ursprungsansicht beziehungsweise die unabhängige Profil-Recovery.

`profile-recovery-ui.js` ist von Startseite und Manager gemeinsam nutzbar. Bootstrap-Recovery braucht kein Startseiten-DOM und wartet nicht auf eine erfolgreiche Profilanzeige. Export, bestätigter Reset und Retry verwenden dieselben Schutzverträge. Die bisherigen Depot-, Abgleich-, Cashdialog- und Tranchen-Recoveryhosts bleiben in Slice 1 erhalten. Unter „Technik“ liegen Proxyprüfung und Gesamtlöschung; blockierende Fehler bleiben außerhalb sichtbar. Keine Änderungen am Tranchenschema, an Persistenzkeys oder an Reconcile-/Cashsemantik.


## Gruppiertes Depot und Tranchendialog (Paket 5, Slice 2)

`buildTranchenTableHtml()` projiziert bestehende Typen in Aktien/ETFs, Geldmarkt, Gold und Anleihen. Nur die lokalen Gruppenprojektionen werden nach Kaufdatum sortiert, fehlende/ungültige Daten folgen dem bisherigen 1900-Fallback; Gleichstände folgen der Speicherreihenfolge. Gruppensummen und Gewinnquote verwenden `marketValue` und `costBasis`. Der delegierte Handler unter `#tranchenTable` löst die stabile `data-tranche-id` im aktuellen Bestand auf und ignoriert verschwundene IDs. Rendern und Öffnen schreiben oder migrieren keinen Rohbestand.

`quoteDate()` und `quoteSummary()` zeigen lokales Datum aus positiven ganzzahligen `asOf`-Sekunden. Kein Kursbeleg wird aus Kaufdatum, Profilzeit oder Abrufzeit abgeleitet. Leere, unbekannte, teilweise bekannte und gemischte Stände sind getrennt erkennbar. Der Steuerfreiheitschip folgt ausschließlich `taxExempt === true`; TQF und Bestandstyp bleiben eigenständige Angaben.

`setTrancheDialogMode()` benennt Kauf/Bearbeiten und die zugehörige Speicheraktion. `renderTrancheFormPreview()` verwendet die kanonische Ableitung für Einstand/Marktwert einschließlich Kaufpreisfallback, ohne ID-Erzeugung, Baselineänderung oder Write. Das Feldraster erhält alle IDs, Eingabetypen und Pflichtfelder. Die benannten Segmente bedienen die verborgenen nativen Select-Wertträger über deren bisheriges change-Ereignis; die Matrix und Guard-Baseline bleiben erhalten. Kopf-Schließen, Abbruch und Escape verwenden denselben Guard; Retry und bestätigtes Erfolgsschließen behalten ihren bisherigen Operationsbesitzer. Nach Editrender wird Rückfokus über ID und Aktion am neuen Zeilenbutton hergestellt.

Nodebelege: Renderer, Modal, Page, Navigation, State, Tranche-Contract, Manager-/Foundation-Designsystem und Inventar. `npm test` führt der Orchestrator aus; Grundbedienung und Bildvergleich 01–05 bleiben externe Prüfungen der Steuerung.

## Verkaufsschritte, Cashstatus und Personenverwaltung (Paket 5, Slice 3)

- `tranchen-manager-sale-dialog.js`: reiner Schrittbinder am vorhandenen `reconciliationForm`; Ausführung → Cash → Vorschau, Rückkehr ohne neue Kennung und ohne Write. Alle aktiven Tranchen bleiben namentlich auswählbar. `createReconciliationPreview` und `executeReconciliation` im Seitencontroller bleiben die einzigen fachlichen Einstiege.
- `tranchen-manager-modal.js`: zusätzliche Sale-/Personendialoge teilen Guard, Baselines, Escape/Overlay, Tabfolge und Schreibsperre. Verwerfen setzt den unbestätigten Verkaufsentwurf zurück; bestätigter Retry behält den gespeicherten Auftrag. Nach Cashrerender wird der neue Auslöser desselben Zielverkaufs fokussiert. Preview-/Confirm-Sperren bleiben nach Persistenzrender fachlich korrekt.
- `tranchen-manager-profiles.js`: `renderManagerPeople` liest Metadaten, `bindManagerPeopleDialog` delegiert Umbenennen/Löschen und Haushaltsmitgliedschaft, bindet einmal je Dokument und hält Singleflight.
- `profile-manager-bindings.js`: dieselben Namens-/Löschschutz- und Speicheraktionen für Startseite und Manager. Kein Import des Startseitenbootstraps.
- `manageManagerPerson`: aktiven 300-ms-Autosave dauerhaft abschließen, Finanzentwürfe geschützt verwerfen, Verwaltungsaktion mit Flush/Rückschreiben unter Commitbesitz; bestätigten Ziel-/Fallbackbestand vollständig laden und Baselines erneuern. Keine inaktive Finanzbearbeitung. Recovery bleibt bei Bootstrap-/Lade-/Save-/Wechselfehlern unabhängig vom normalen Formular nutzbar.

Die statische Liste „Verkäufe & Cashstatus“ bleibt außerhalb des Verkaufsdialogs sichtbar. Datum, Nettoerlös, bestätigter Stand, wirksame Nachweis-ID, Nachweiszeitpunkt, Korrekturrevision und Grund stammen aus der vorhandenen Auditprojektion. Legacy ist erkennbar, unlesbares Audit wird nie als leerer Verlauf behandelt. Cash „Ja“ verlangt den Stand; „Nein“ erzeugt offene manuelle Buchung. Bestätigung/Korrektur bleiben append-only mit erwarteter Registry, Revision und Vorgänger, ohne automatische Tagesgeldbuchung. `tranche-reconciliation.js`, Speicherformat und Engine werden nicht geändert.

Der vorhandene Browserfall `depot-tranchen-manager.html` benutzt die neuen Dialogöffner und die drei Schritte; seine bisherigen Bestands-, Duplikat-, Cash-/Korrektur-, Legacy- und Scrollorakel bleiben erhalten. Zusätzlich bedient er die Personenverwaltung. Weitere Guard-/Recoveryfälle und Bildvergleich 06–09/12/13 werden durch die Steuerung geprüft, die volle Suite durch den Orchestrator.

## Startkurse und gespeicherter Kurskontext (Paket 5, Slice 4)

- `tranchen-startup-prices.js`: einmaliger Binder ausschließlich auf `index.html` nach Persistenz-/Profilbereitschaft; DOM-freier Koordinator mit drei parallelen Instrumentjobs, profilübergreifender Bündelung und globalen `STARTUP_PRICE_TIMEOUT_MS = 15000` einschließlich Suche, Retry und Warteschlange. Sessionmerker `rs_startup_prices_session_v1` und datensparsames Ergebnis ausschließlich im Tab-`sessionStorage`; Recovery oder fehlender Sitzungsspeicher startet keinen Abruf.
- `tranchen-price-service.js`: gemeinsame Quote-/Suchcache- und Auflösungshilfen. Der manuelle aktive Profilbatch im Manager behält sein eigenes 12-Sekunden-Limit und seine Validierung; Startsuche ignoriert unterschiedliche Anzeigenamen beim gemeinsamen Schlüssel.
- `profile-storage.js`: `patchInactiveProfileQuotes()` setzt ausschließlich Kurs, UTC-Zeitpunkt und aufgelösten Ticker auf eindeutig zugeordneten Rohrecords. Inaktive Stringbestände, Schema-/Legacy-/Zusatzfelder, Metadaten, fremde Daten und Audit bleiben erhalten; aktive Daten nehmen den kanonischen Live-/Registryweg.
- `tranchen-manager-renderer.js`: `renderManagerQuoteContext()` zeigt gespeicherte leere, unbekannte, teilweise bekannte, gemischte und ältere Kursstände in der Kontextzeile. Abrufzeit ist kein Kursdatum. Manuelle aktive Aktualisierung bleibt erreichbar; der Manager startet keinen Sitzungsabruf.

Die direkte Tickerquote-Runde endet vor jeder Suche und behält ihr volles
15-Sekunden-Budget. Sobald irgendein fertiger direkter oder Fallbackkurs vorliegt,
endet die Fallbackrunde spätestens bei `deadline - 1000`: Die Reserve wird auch
beim ersten Fallbackerfolg nachträglich aktiviert. Bei einem ersten Erfolg an
oder nach 14 Sekunden wird dessen Ergebnis übernommen und die Fallbackarbeit
sofort geschlossen; nach einer späten direkten Runde startet keine weitere
Suche. Ohne Erfolg bleibt die globale Frist maßgeblich. Lokaler Leseschluss
bricht offene Leser ab und beendet die Runde auch bei Abort ignorierenden
Promises. Nur offene oder nicht mehr begonnene Auflösungen erhalten
`STARTUP_FALLBACK_TIMEOUT`; fertige Erfolge und abgeschlossene Fachfehler bleiben
erhalten. Timer und Listener werden aufgeräumt. Ein gemeinsamer Commit startet
vor 15 Sekunden und bestätigt Teilkurse erst nach genau einem Erfolgsflush;
sein Navigationsschutz bleibt bis Bestätigung oder vollständiger Kompensation
bestehen. Kein neuer Commit beginnt nach globaler Deadline, und ohne begonnenen
Commit bestätigt ein echter Globalablauf null Kurse bei bytegleichem Speicher.

Teilstatus nennt neutral „nicht aktualisiert“. Reine Antwortzeitfehler heißen
„Kursantwort nicht rechtzeitig erhalten“; nur reine `PROXY_UNREACHABLE`-Berichte
heißen „Kursdienst nicht erreichbar“. Provider-Timeout, vorübergehender
Anbieterausfall und Ratelimit besitzen eigene verständliche Gründe. Lokales
„Zeitlimit für Instrumentauflösung erreicht“ bleibt vom globalen Zeitlimit
unterscheidbar. Technische Codes und Providerfehlermeldungen stehen nicht in
den Fehlerzeilen. Manager-Handoff, gespeicherter Kurszeitpunkt und geschlossene
Technikklappe bleiben auch nach lesendem Sitzungsreload erhalten.

Der Startseitenstatus ordnet jede Ergebniszeile über lesbare Person-/Tranchennamen
aus `meta.name` und `tranche.name` zu; technische IDs bleiben Zuordnungsschlüssel,
Namen sind reine Anzeigemetadaten. Gebündelte Instrumente behalten die Namen des
jeweiligen Jobs. Vollerfolg zeigt nur eine Zusammenfassungszeile;
Teil-/Totalfehler zeigen nur betroffene Tranchen mit verständlichem Grund,
gespeichertem lokalem Kurszeitpunkt oder „Kursdatum unbekannt“ und Managerlink; Abrufzeit ersetzt keinen Kurszeitpunkt. Die Ausgabe verwendet
`textContent` und verständliche Ersatzbezeichnungen wie „Unbenannte Person“,
„Unbenannte Tranche“ beziehungsweise „Bestand“.

Der Sitzungsbericht enthält nur `status`, `updated`, `retrievedAt`, `restored`
und die Ergebnisliste `results`: Statuszusammenfassung, Erfolgsanzahl, Abrufzeit
und gegebenenfalls Rückschreibstatus. Je Ergebnis bleiben ausschließlich
`profileId`, `trancheId`, `profileName`, `trancheName`, `status`, `code`, `message`
und `asOf`, soweit vorhanden. Kursbeträge, Finanzwerte, vollständige Quotes,
Jobs, Profil-/Tranchenobjekte und Rohbestände werden nicht in den Merker kopiert;
es entsteht keine neue Registry-, Backup- oder Exportpersistenz. Nach Rückkehr
oder Reload derselben Sitzung werden Namen, Gründe und gespeicherte Kurszeitpunkte
ohne erneuten Abruf oder Kurs-/Registrywrites wieder angezeigt. Altberichte ohne
Namen und Fehlerzeilen ohne gespeicherten Kurszeitpunkt ergänzen diese ausschließlich lesend aus der aktuellen geprüften Quelle:
Personen über `profileId`, Tranchen eindeutig über stabile `trancheId` oder
Legacy-`id`, niemals über Namen oder Arrayposition. Fehlende oder nicht mehr
auflösbare Daten behalten die Ersatzbezeichnungen; der Merker wird nicht
zurückgesetzt und kein neuer Kursstand behauptet.

Vorbereitung ist über den gemeinsamen Guard abbrechbar. Navigation oder Profilwechsel verwerfen alle Teilergebnisse; tatsächlicher Pagehide/Unload entwertet den Lauf. Deadline speichert ausschließlich rechtzeitige Erfolge, späte Antworten schreiben nie. Vor Staging stehen Identitäts-/Rohquellvergleich, danach Commitbesitz bis zum einzigen bestätigten Erfolgsflush; Fehlflush verwendet kompensierendes Rückschreiben. Es gibt keinen nachlaufenden Kursschreiber und keine zusätzliche Simulator-Kopplung.

Der Quellenabschluss umfasst V01–V25, zusätzliche I02–I04/I09-Orte und I14 als neuen Startabruf. I12 bleibt auf der Startseite bis 6.3. Die volle Suite ist Orchestrator-Gate; Browser-Smoke, Referenzzustände 01–13, Bilder bei 1920/2560px und Kandidaten-EXE bleiben bis Bestätigung durch Steuerung offen.

## Feld- und Anzeigeabschluss (Paket 5b, Slice 2)

- `tranchen-manager-profiles.js`: `bindManagerProfileControls()` und
  `syncManagerProfileControls()` verbinden sichtbare native Schalter mit den
  bisherigen verborgenen Boolselects. Init/Rerender/Rückschreiben sind ohne Writes;
  Benutzerwechsel löst genau ein `change` aus. Pflege-Chip nur bei aktivierter
  Reserve, Rente bleibt abgeleitet und gesperrt. Vollständige Feldhilfen bleiben
  lokal über Info-Komponenten und assistive Rentenbeschreibung zugänglich.
- `tranchen-manager-page.js`: Kopf- und Depotöffner teilen Kauf/Verkauf und den
  tatsächlichen Rückfokus. Das Personenkartenmenü öffnet denselben Verwaltungsweg.
  Einheiten und deutsche native Zahleneingabe ändern keine Wertebereiche,
  Schrittweiten oder Parser. Ein bestätigter Retry aktualisiert unveränderte
  Formularwerte; konkurrierende Eingaben werden nicht überschrieben.
- `tranchen-manager-renderer.js`: Karten- und Depotbeträge ganze Euro, Centpreise,
  eine Prozentnachkommastelle unter dem Zeilengewinn. Summen und Nenner aus
  ungerundeten Daten; exakte Cashbeträge unter „Exakte Beträge“, Bestätigungsdialoge
  unverändert. Fünf gleich breite Kennzahlen, separate Anzahl im Depotkopf,
  lokale Kursdaten aus `asOf`; Automatiktext ausschließlich bei passendem
  Sitzungsbeleg. Symbolaktionen behalten Anker, Namen, Tooltip und Bestätigung.
- `tranchen-startup-prices.js`: Erfolg ohne Einzelliste; Fehlerzeilen lesen den
  alten gespeicherten Kurszeitpunkt ausschließlich aus eindeutig zugeordneten
  Originalrecords. Sitzungsfelder bleiben unverändert, keine zusätzlichen
  Requests, Sessionwrites oder Registry-/Kurswrites durch Darstellung/Reload.
  Nicht-Speicherung und nicht bestätigtes Rückschreiben bleiben Speicherfehler.

Browser-/WebView-Komma-/Punkteingabe, Bildvergleich 01–13 bei 1920/2560 px und
Kandidaten-EXE sowie Grundbedienung einschließlich der getrennten P4f-Ausnahmen
bleiben Abnahmeaufgaben der Steuerung. Die volle Suite fährt der Orchestrator.

## Übersicht und DOM-Dezimalgrenze (Paket 6, Slice 1)

Die Haushaltspille der Übersicht öffnet den vorhandenen Personendialog über
`depot-tranchen-manager.html#personen`. Wechsel und Verwaltung behalten ihre
Autosave-, Schutz-, Flush-, Handoff- und Wiederherstellungswege.
`projectManagerProfiles` bleibt die gemeinsame lesende Quelle für Vermögen und
Allokation; die Übersicht addiert keine Reserveziele und keine Haushalts-Summaries.

Alle Dezimalfelder verwenden Texteingaben mit `inputmode="decimal"` und den
Adapter `tranchen-manager-decimal-input.js`: Komma/Punkt ergeben denselben
kanonischen Wert; die deutsche Anzeige gruppiert/rundet nicht. Das Januaralter ist eine gesperrte Ganzzahlanzeige aus der zentralen Personenprojektion. Optionale Leerwerte und fehlerhafte Werte gehen weiterhin an die
vorhandenen Fachvalidatoren. Kauf-, Verkaufs- und Cashleser verwenden denselben
Adapter. Alle Infohilfen werden über `designsystem-info-popover.js` gebunden;
Escape schließt bei verbleibendem Fokus, bestehende Label-/Tooltipzuordnungen
bleiben erhalten. Browser-/Bildabnahme bleibt außerhalb der Sandbox offen.

### Tagesverlauf und vorläufiger Messbeginn (P8)

`tranchen-history-model.js` projiziert Tagesbewertungen und Depotkurse rein
lesend. Fehlen ausschließlich erste Schlusskurse, beginnt die Messreihe am
ersten vollständig bewertbaren Tagesabschluss. `measurementStart` nennt den
UTC-Tagesindex, der Status bleibt vorläufig. Alle Chartpunkte bleiben erhalten;
unbekannte Tage davor erhalten keine erfundene Fläche. `historyMetrics` selbst
bleibt streng; unbekannte Zwischen-/Endpunkte, Stücke, Ticker, Fremdwährungen
oder Cashbeträge verhindern vollständige Kennzahlen. Die Beginnregel gilt für
`all`, `year` und `12m`, auch im ersten Jahr.

`historyWithdrawals` verwendet rein lesend nur den letzten bestätigten Cashstand
je Kalendertag aus der validierten datumssortierten Liste. Die gespeicherten
Zwischenwerte bleiben erhalten. Pro abgeschlossenem Tag zählt
`max(vorherigerTagesstand - letzterTagesstand, 0)`; eine vollständige intratägige
Erholung ergibt 0. Ausgangsbasis ist `baselineValue`. Stände vor/am tatsächlichen
Messbeginn aktualisieren nur die Basis; erst Tage danach bis einschließlich
`range.end` zählen. Spätere Einträge sind ausgeschlossen. Jede Person wird vor
der Haushaltssummierung getrennt berechnet; fremde Einzahlungen kompensieren
keine Entnahmen. Transfers können enthalten sein, Bruttoabflüsse werden nicht
gemessen. Verkäufe und Monatshaken werden nicht zusätzlich addiert. Veränderung,
bereinigte Veränderung, Höchststand und größter Rückgang verwenden dieselbe
Messreihe und Prozentbasis. Ohne Cashhistorie fehlen Entnahmen und bereinigte
Veränderung. Bei Einzelpunkt und Nullbasis entstehen keine Prozentwerte.

`tranchen-history-ui.js` zeigt den Messbeginn und „vorläufig“ in Personenkarten,
Depotzusammenfassung und Detail; `overview-history.js` in der Übersicht.
`evaluateHistoryCourse` verwendet echte EUR-Kurse unabhängig von Verkäufen,
niemals Kaufpreis oder heutige Quote als Basis. Ein gespeicherter Vorgängerkurs
erlaubt die ursprüngliche Zeitraumgrenze; ohne Kurs bleibt die Entwicklung
`unavailable`. Abrufe bleiben ohne Rückblick zwischen `max(Beginn,Kaufdatum)`
und gestern. Zeitraumwechsel schreiben keine Kurs-/Registrydaten und starten
keinen weiteren Abruf.

### Rückblickverkäufe und Erststart (Paket 6, Slice 3)

Die Jahresübersicht verwendet `readReconciliationHistory` und
`projectReconciliationCashStatuses` lesend. Gezählt werden tatsächliche Verkäufe
für die angezeigten Personen im Ausführungsjahr, eindeutig nach Action-ID.
„Netto ins Tagesgeld“ summiert nur bestätigte Erlöse; Cashkorrekturen oder
Empfehlungen sind keine zusätzlichen Erlöse. Legacy mit unbekanntem Cashstatus
bleibt unbestätigt, fehlerhafter Verlauf unbekannt. Kein neuer Cashwrite.
„Eigene Daten anlegen“ führt zum vorhandenen Personendialog `#personen`,
„Sicherung einspielen“ zum Vollimport in der geschlossenen Übersichtskarte.
Die Vermögenskarte nutzt weiterhin Marktwerte plus Tagesgeld ohne Reserveaddition.


### Datierbare Bestandsunsicherheit und bekannte Teilbeträge (P8-Followup, Slice 2)

Manuelle Änderungen an Stückzahl, Kaufdatum, Typ oder ISIN und manuelles Entfernen
bleiben unbekannter Bestand, kein Verkauf. Beim Übergang einer zuvor verlässlichen
Kopie wird die früheste mögliche Existenz als optionale
`uncertainty: {fromDate, originalTranche}` gesichert. Frühere Kaufdaten erweitern
diese Grenze; spätere Kaufdaten, weitere Captures und Entfernen verschieben sie
nicht nach hinten. Nur vor dieser gesicherten Grenze zählt die unbekannte Tranche
mit null Beitrag, ab ihr bleibt das Total unbekannt. Alte `unknown`-Records ohne
Metadaten können bereits ein überschriebenes Kaufdatum enthalten: Ihr ursprünglicher
Kaufbeginn ist nicht gesichert, deshalb bleiben sie an jedem Tag unbekannt, auch
bei Live-/Kopiegleichheit oder nach Entfernung. Capture und Projektion ergänzen
keine nachträgliche Herkunft. Die bekannte Summe enthält unabhängig vom unbekannten
Anlageklassentotal alle gültigen Tranchenbeiträge plus bewertbares Tagesgeld;
Haushalt und Person zeigen „Teilabdeckung · bekannter Betrag“, keine Vollsumme.
Filter berücksichtigen bei gesicherter Herkunft sowohl ursprüngliche als auch
aktuelle Anlageform; undatierte Unbekanntheit bleibt in jedem Depotfilter sichtbar.
Die Preispräfixregel überspringt keine Bestandsunsicherheit. Speicherkeys,
Recordversion 1 und Verkaufs-/Cashaudit bleiben unverändert.

Im Profil-Assets-Manager bietet die aktive Personenkarte für unbekannte Bestände
zwei ausdrücklich bestätigte Wege: Bei vorhandener Tranche zuerst ihre Stammdaten
über „Bearbeiten“ korrigieren, dann „Korrigierten Bestand für den Verlauf bestätigen“.
Die Nachfrage bestätigt Kaufdatum, Typ, ISIN und Stückzahl als rückwirkend gültig;
berechenbare Vermögenskennzahlen bleiben wegen dieser manuellen Annahme vorläufig.
Ein bewusst späterer Nachkauf gehört in eine neue Tranche. Bei bereits entfernter
Tranche entfernt „Fehleingabe aus dem Verlauf verwerfen“ nur die Verlaufskopie als
nie gültigen Bestand. Dabei entstehen weder Verkaufsmarke noch Entnahme, und Depot
sowie Tagesgeld bleiben unverändert. Für tatsächliche Verkäufe die bestehende
Verkaufsabstimmung verwenden. Bestätigte Verkaufsbelege sperren beide Aktionen;
beschädigte Records/Audits oder widersprüchliche Profilkopien erlauben keine Reparatur.
Das gilt auch für alte unbekannte Kopien ohne gesicherten Kaufbeginn: Erst die
Bestätigung hebt die Unsicherheit auf. Abbrechen schreibt nichts; nach einem
Speicherfehler dieselbe Aktion erneut bestätigen. Reload erhält die Reparatur.
Enter und Leertaste aktivieren die nativen Reparaturknöpfe; nach Abbruch erhält
der Knopf, nach Erfolg die Ergebnismeldung den Rückfokus.

`tranchen-history-recovery.js` projiziert Kandidaten schreibfrei und hält Registry-,
Profilkennungs-, Depot- und Lotquellbytes vor der Nachfrage fest. Vor Writeaufnahme
werden sie samt Dokument-/Profilkontext erneut geprüft. `commitHistoryRecords()`
bestätigt ausschließlich den aktiven Lotkey und seine Registrykopie mit Flush und
kompensierendem Rollback unter dem Manager-Navigationsbesitz. Fremde Profile und
`trancheReconciliation` bleiben unverändert. `correctWealthLot()` übernimmt die
aktuellen kanonischen Stammdaten mit `status: present`, löst `uncertainty` auf und
setzt das validierte lokale ISO-Datum `manualCorrectionAt`; Verwerfen entfernt
nur die unbekannte, nicht mehr vorhandene Lotkopie. Keine ursprüngliche Datierung
wird rekonstruiert. Weitere Captures erhalten die Bestätigung. Die gemeinsame
`projectProfileWealthHistory()` markiert darauf beruhende berechenbare Kennzahlen
als `provisional`, auch nach Reload und in der Übersicht. Native Buttons liefern
Enter/Leertaste, nach Rerender erhält der verbleibende Aktionsknopf oder der
Ergebnisstatus den Fokus. Wiederholung einer abgeschlossenen Reparatur ist No-op.

`mergeWealthLots()` ist die gemeinsame rein lesende Zusammenführung für Personen
und Übersicht. `known` wird vor der Klassenaggregation aus einzelnen gültigen
Beiträgen gebildet; eine unbekannte zweite Tranche derselben Klasse lässt gültige
Beiträge erhalten. `assertWealthLots()` prüft optionale Herkunft auch im Bundle-
Preflight, Profilcapture und Export erhalten sie mit unveränderten Versionen.


## Zentrale Personeneingabe

Die vorhandene Personkarte enthält jetzt vollständiges Geburtsdatum, Geschlecht, Rentenbeginn, Anpassungsart/-satz, Kirchensteuer, SPB und Legacy-Rentensteuerquote. `profileAlter` ist ausschließlich die aus Datum und Januarplanungsjahr abgeleitete Anzeige; ein belegter Altalter-Fallback wird nicht jährlich gespeichert oder erhöht. `profile-asset-values.js` besitzt Validierung und DOM-Projektion; `tranchen-manager-page.js` integriert die Felder in Baseline, Debounce, bestätigten Autosave und Personenwechsel. Teilweise/ungültige ISO-Daten verhindern Speichern, fehlende Daten dürfen ergänzt werden; neue Personen ohne belegtes Alter können bis dahin nicht rechnen. Die UI ist erst nach sicherer Migration bereit. `tranchen-manager-profiles.js` verwendet denselben Jahrbezug für die lesende Personen-/Haushaltsprojektion. Die Sitzungsklappen sind im nachfolgenden Abschnitt beschrieben. Datenmodell, Recovery und Aliaszuordnung: TECHNICAL, „Zentrale Personendaten“.

## Zentrale Personendaten und Sitzungskarten (Paket 10, Slice 2)

„Person & Einkommen“ beginnt ohne gemerkten Zustand geöffnet; „Tagesgeld & Gold“ und „Pflegereserve“ beginnen geschlossen. Ihre Zeilen zeigen echte Profilwerte. Die Personkarte öffnet über die volle Breite mit den Gruppen Person, Rente und Steuer & Sonstiges. Ein Einzelprofil zeigt „Dein Vermögen“ statt einer Haushaltskarte; Außenprofile bleiben als solche im Reiter und Personenkopf erkennbar.

`tranchen-manager-person-cards.js` besitzt ausschließlich die Klappen. Native Buttons liefern Enter/Space/Klick und verknüpfen `aria-expanded`/`aria-controls` mit den benannten, per `hidden` gesteuerten Regionen. Der Gesamtknopf öffnet alle Karten bei gemischtem Zustand und schließt sie, wenn alle offen sind. `rs_manager_person_cards_session_v1` liegt nur in `sessionStorage`, nach Profilkennung und Karte getrennt. Rerender, A/B/A und Sitzungsreload erhalten die Klappen; bei gesperrtem Sitzungsspeicher gilt ein Dokumentfallback. Profilcapture, Export, Backup und Fachpersistenz enthalten keinen Klappenzustand.

`#personendaten` öffnet nach bestätigter Profilbereitschaft die Personkarte und fokussiert die Geburtstagseingabe beziehungsweise den fehlenden Geburtstag im Ergänzungsband. `#personen` bleibt der Einstieg in die Personenverwaltung. `renderManagerPersonData` projiziert Namen als Text, Kernwerte, Pflegezustand, Rentenbeginn und Januarhinweis bei Personen-/Jahreswechsel neu. `describePersonDates` hält die Kalendertexte rein: 1958-03-14/2026 ergibt „67 Jahre am 01.01.2026 · wird am 14.03.2026 68, gerechnet ab 01.01.2027“. Geburt am 01.01. ist bereits am Stichtag berücksichtigt; der 29.02.-Jahrestag erscheint im Nichtschaltjahr als 01.03. Die Rechnung bleibt jahresbezogen.

Bei fehlendem Datum zeigt das Ergänzungsband nur einen Geburtsjahrvorschlag aus dem belegten Altalter; Tag und Monat werden nicht erfunden. `applyManagerBirthDate` validiert den vollständigen ISO-Entwurf und schreibt gezielt das Datum mit Registrycapture über den vorhandenen Manager-Lifecycle und bestätigten Flush. Andere offene Formularänderungen müssen vorher bestätigt sein. Ein Fehlflush schreibt Datum/Registry zurück, hält Entwurf und Fokus und erlaubt erneutes „Übernehmen“. Doppelklick und Profilwechsel können den laufenden Write nicht überholen. Cashhistorie, Tranchen und Goldwerte werden durch diese Ergänzung nicht geschrieben.

Node-Nachweise liegen in `tranchen-manager-person-cards`, `tranchen-manager-profiles`, `tranchen-manager-renderer`, `tranchen-manager-page` und `designsystem-manager`. Der Browserfall „Personendaten Karten 01–04/07“ registriert echte Tastatur-/Datumsbedienung, Fokus, A/B/A, Reload, Außen-/Einzelprofil, lange Namen und 1366/1920/2560/390 Pixel. Browserausführung und Vergleich mit den freigegebenen Entwurfsbildern bleiben bis zur externen Abnahme offen.


### Dokumentations- und Abschlussgrenze (Paket 10, Slice 4)

Handbuch und README beschreiben den zentralen Pflegeweg und die flüchtigen Simulatoralternativen. Der Manager ist der Fachwrite-Besitzer; Balance und Simulator übernehmen nach bestätigtem Speichern beim Öffnen/Profilabgleich. Backup in Daten & Sicherung → Vollsicherung enthält Personenschlüssel und Herkunft, keine Sitzungsklappen. Der vollständige Migrations-Recovery unter Daten & Sicherung → Wiederherstellungspunkte umfasst Registry, Außenprofile und Livealtkeys; Restore wartet auf geschützten Reload und erneute Altbestandsprüfung. Der Jahresabschluss erhöht kein gespeichertes Alter.

Die zehn externen Bedienabläufe, Bildvergleich 01–07 mit identischen synthetischen Daten, Schrift und Zoom bei 1366/1920/2560 px sowie schmale Breite/lange Namen sind eigene Nachweise der Steuerung. Browser-/WebView-/Windows-Nachweise bleiben bis Ausführung offen; registrierte Tests und Node-Gates erteilen keine eigene Freigabe.

### Deutsche Personenkarten und Herkunft (Paket 10b)

Die zentralen Kalenderfelder und das Ergänzungsband zeigen/lesen `TT.MM.JJJJ`; ISO bleibt das Speicherformat. Die zusätzliche Alterseingabe entfällt; der Januar-/Geburtstagshinweis bleibt. „Monatliche Rente, netto“ und im Partnerkontext „Steuerquote der Rente (%)“ beschriften die bestehenden Wertträger. „Rente aktiv“ ist ein abgeleiteter Hinweis. Rentenanpassung und Kirchensteuer verwenden Segmente über denselben Quellen; vorhandenes `cpi`, fremde Kirchensteuersätze und dormante feste Sätze werden ohne bewusste Wahl nicht geändert. Ein ausdrücklich gewählter fester Satz öffnet dessen Eingabe auch bei 0.

`tranchen-manager-page.js` erfasst bewusste Geschlechtsbestätigung und speichert Herkunftsmetadaten im selben bestätigten Profilcommit. Rendering und Änderungen anderer Felder bestätigen den angenommenen Wert nicht; fehlgeschlagener Flush/Rollback erhält „bitte prüfen“, Retry kann denselben Wert bestätigen. `tests/profile-asset-values.test.mjs` prüft echte Formular-/Segmentwege; `tests/tranchen-manager-page.test.mjs` prüft Autosave, Fehlflush, pausierten Retry und dauerhafte Registry-/Live-Reads; `tests/tranchen-manager-renderer.test.mjs` prüft Hinweis, Ergänzungsband und Partnerkontext. Später/Escape beendet die Migration ruhig und lässt Navigation bereit, ohne Fachbootstrap oder neue Writes.

## Rente ab Rentenbeginn (Paket 10d)

`profile-person-data.js` leitet mit `deriveAnnualPension` die Rentenmonate des Planungsjahres rein aus dem ISO-Kalenderdatum ab: fehlender oder vergangener Beginn bedeutet zwölf Monate, ein künftiges Jahr null, das Startjahr `13 − Beginnmonat`. Der Beginnmonat zählt vollständig, auch bei Beginn am 15. Juli. Ungültige Kalenderdaten und Beträge werden abgewiesen. Der gespeicherte Monatsbetrag bleibt die erwartete Nettorente in heutigen Werten nach Kranken- und Pflegeversicherung.

Die Balance verwendet den wirksamen Jahresbetrag und zeigt dessen Monatsdurchschnitt. Sonstige Einkünfte bleiben unabhängig ganzjährig im Budget. Sync, Reader, Haushaltsaggregation, Verteilung und Summary rechnen mit demselben Anteil; Statushinweise nennen in Haushalten die Person. Profilwechsel und ein abgeschlossenes Planungsjahr aktualisieren die rein abgeleitete Anzeige ohne Profilwrite.

Der Simulator transportiert `renteStartMonate` für Hauptperson und Partner zusätzlich zum Jahresoffset. Ohne Zusatz gelten zwölf Monate. Die volle Jahresbasis wird weiterhin ab Index 0 angepasst; nur die Eigenrentenauszahlung am Startindex wird anteilig, danach vollständig verwendet. Partnersteuerquote und Hinterbliebenenregeln bleiben erhalten. `renteKalenderbeginn` beschränkt die kalenderabhängige Korrektur im Ansparpfad auf belegte künftige beziehungsweise unterjährige ISO-Beginne. Historische Requests ohne Zusatz behalten ihren Ansparvertrag. Protokoll und Exporte lesen die berechneten Jahreswerte und kürzen sie nicht erneut. Ein späterer Personenentwurf verändert fertige Laufbelege nicht.

Bei der gesicherten Umstellung bleibt die Profilquelle grundsätzlich vorgeschlagen. Nur Profilbetrag null oder altes explizites Nein zusammen mit positiver Simulatorrente und Startoffset größer null erhält den Vorschlag „künftige Rente aus dem Simulator“. Betrag und Offset müssen derselben Person und Live-/Registryquelle entstammen. Vorschlag, Dialogvorauswahl und unveränderte Übernahme stimmen überein; explizite Profilwahl und Abbruch bleiben möglich. Ein gültiges vorhandenes Datum bleibt erhalten; bei fehlendem Datum bleibt Januar des Referenzjahres plus Offset lediglich der gekennzeichnete Vorschlag, kein erfundener Juli.

Node-Nachweise: `profile-person-data.test.mjs` (Kalenderregel, Zeitzonen und vollständiger synthetischer Altpfad-Bytevergleich), `balance-person-data-readonly.test.mjs` (produktive Eingänge, Engine, Summary und Bestandsschutz), `simulator-household-pension.test.mjs` (Eigenrenten, Anpassung, Partner, Ansparen und Monte Carlo), `historical-backtest-export.test.mjs` (realer Backtest, Protokoll und Export), `profile-person-migration.test.mjs` (Vorschlag, Readback, Reload und Abbruch). Browserfälle „Rentenbeginn Kalenderbudget“ und „Künftige Rentenquelle Umstellung“ sind registriert; Browserausführung und externe Bild-/Bedienabnahme bleiben bis zur tatsächlichen Ausführung offen. Das separate gepinnte Charakterisierungsgate bleibt unverändert und wird auf Linux nicht ausgeführt.


### Synthetische Probelaufkurse (Paket D, Slice 2)

`tranchen-price-service.js` delegiert Quote, lokale ISIN-/Symbolauflösung und Health
im bestätigten Testmodus an `market-price-adapter.js`. `tranchen-history-fetch.js`
nutzt denselben Generator vor jedem HTTP-Aufruf. Derselbe Symbol-/Datumswert gilt
profilübergreifend und nach Reload; Kennungen ohne Instrument bleiben sichtbar
ungeklärt. Kurstage sind Montag–Freitag, Quotezeit 00:00 UTC des letzten Werktags,
History-Ende einschließlich Testdatum, Wochenenden als abgefragt ohne Kurspunkt.
Normalmodus: bisheriger Proxy, Retry, Deadline, Abbruch, Speicherschutz und Ende
gestern. Start/Datumssprung erneuern reale oder spätere Quote-/Historycaches; der
originale Bestand bleibt im Rohsnapshot Vor Probelauf. Jahresend-/ATH-Werte kommen
über Balance aus derselben Kurve; CAPE/Inflation sind keine Wertpapierkurse.
Die sechs Musterlots haben Schema 2, Käufe 2016–2025 und explizite Steuerfelder;
Alt-/Neutypen erzeugen keine neue Steuerbefreiung. Verkäufe und Cashbestätigungen
benutzen dieselben bestehenden Commitfunktionen. Recovery und bytegleiche Rückkehr
bewahren alte Archivpunkte plus Vor Probelauf; Steuerkey bleibt außerhalb von
Import/Export. Node-Nachweise: `probelauf-prices`, `muster-haushalt`,
`probelauf-workflow`, History-/Startup-Verträge. Browser-/EXE-Abnahme extern offen.


### Seitenstart und bestätigte Bereitschaft (Paket D-Folge, Slice 2)

`app/profile/profile-navigation.js` sperrt vorhandene Profil-/Personenfelder vor
Start-I/O. Nach „Übernehmen“ bleiben sie bis zum dauerhaften Quellen-/Schemareadback
und zur Profilbereitschaft gesperrt; Fehler und Recovery geben sie nicht frei.
Bereits vorher gesperrte Felder behalten ihre Sperre. Aktueller Bestand und Tauri-
Unterseiten nutzen den bestehenden Bootstrap ohne unnötige Migrations-Lease.
Nodebeleg: `tests/probelauf-page-start.test.mjs` (Parallelstart, verzögerter Write,
Fehler/Rollback und Reload). Browser-/WebView-Bedienabnahme bleibt offen.

## Personenübernahme und Depotzugänge (Paket 12)

Nach „Später“ oder Escape zeigt der Suitekopf „Umstellung der Personendaten ausstehend“.
„Jetzt übernehmen“ öffnet dieselbe Quellenentscheidung erneut. Aufschub schreibt keine
Personen-/Fachdaten; Rechner und Profilfelder bleiben gesperrt. Erst dauerhaft bestätigte
Übernahme und geschützter Neustart stellen reguläre Bereitschaft her. Technische
Read-/Flushfehler bleiben „Profil nicht verfügbar“ und erfordern Klärung/Recovery.
Der dokumentlokale Wiederholungsweg teilt Doppelklicks; Navigation und Probelauf behalten
ihre bestehenden Guard-Leases. Der gemeinsame Dialog besitzt eigene Zentrierung,
Designsystemschrift und einen lokalen Aktionsabstand auch bei schmalem Viewport.

Kauf und Verkauf sind ausschließlich im Depotkopf über `#depotAddTrancheBtn` und
`#depotOpenSaleEntryBtn` erreichbar; der Seitenkopf enthält nur „Kurse aktualisieren“.
Dialog, Profilbindung, Verwerfen, Speichern und Rückfokus verwenden dieselben bisherigen
Verträge. Direkt unter Rentenbeginn steht genau ein Kalenderhinweis. Ohne Datum bei
positiver Rente: „Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch
nicht, bitte Beginn eintragen.“ Bei Rente 0 entfällt dieser Hinweis. Unter Rentenanpassung
steht kein weiterer Rentenstatus. Balance benennt je Person den wirksamen Start, laufende
Rente oder Teiljahr mit genau einer Budgetangabe.

Fehlt die bestätigte Cashhistorie bei bekannter Tagesgeldbasis, nimmt der Vermögensverlauf
sie rückwirkend als konstant an: Entnahmen sind für diese Person vorläufig 0. Die Summe
behält bestätigte Abnahmen anderer Haushaltsmitglieder. Beschädigte Quellen oder eine
unbekannte Cashbasis ergeben keine bekannte Null. Tagesendaggregation und positive
Auffüllungen behalten ihre Semantik; die Projektion bleibt rein lesend.


### Gemeinsame Verlaufskarte

`tranchen-history-closures.js` kombiniert die Tagesprojektion der gewählten Ansicht mit den bestätigten Abschlussständen aus dem aktiven Profil. ◆ Jahresabschluss und ◇ Unterjährig stehen bei unverändertem `asOf`/`total`; beide Achsen berücksichtigen abweichende Werte und heutige Erfassung. Ohne Tageslinie bleiben ausschließlich Marken sichtbar. Es werden keine Historienstores, Tageswerte oder Profile migriert.

Tabelle und drei Kennzahlen stammen aus der bisherigen Balance-Aufbereitung. Der damalige Profil-/Verbundumfang wird als im aktiven Profil gespeichert gekennzeichnet; Haushaltswechsel summiert keine Abschlüsse. Der Gold-/Anleihenausschluss gilt für Stände, Tabelle und Kennzahlen, nicht für die Tageslinie.

`tranchen-history-wealth-capture.js` bindet den Managerknopf einmal pro Dokument. Nach bestätigten offenen Profil-/Planwrites verwendet er `balance-wealth-history-preview.js`, den bisherigen Schreibdienst und das Sieben-Tage-Gate. Erfolg folgt Readback, danach Anzeige; gleiche Tage ersetzen nur den manuellen Stand. `#verlauf` erhält beim Seitenstart den übergebenen aktiven Profilkontext statt der Standardauswahl. Tests: `tranchen-history-closures.test.mjs`, `tranchen-history-wealth-capture.test.mjs`, `wealth-history-legacy-navigation.test.mjs`.

## Einkommen heute und tatsächliche Klappen (Paket 12e)

`tranchen-manager-profiles.js` projiziert mit einem gemeinsamen `appNow()` laufende Monatsrente plus sonstige Einkünfte. Die altersunabhängige Exportgrenze `projectPersonPension` aus `profile-person-data.js` bewahrt Kalender-/Altbeginnregeln. Vermögen bleibt ohne belegtes Alter verfügbar; beschädigte Kalender-/Herkunftsdaten ergeben keine vollständige Haushaltssumme. Das Planungsjahr aus Abschlussmetadaten bleibt für Januaralter und Jahresplanung maßgeblich. `describePersonDates(data, referenceYear, now)` zeigt mit `personDisplayAge` das heutige Alter in Kartenkopf und geschlossener Personenzusammenfassung; im Probelauf gilt das App-Testdatum. Die Detailzeile erklärt Planung/01.01. und Folgejahr. `values.alter` und das verborgene `profileAlter` bleiben Januarwerte; keine Personenwrites.

`tranchen-manager-renderer.js` zeigt für Haushalt und Einzelprofil dieselbe projizierte Basis. Bestätigte Zukunftsbeginne ergeben kumulierte Stufen, die nächsten zwei sichtbar, übrige über die zugängliche ⓘ-Hilfe. Erwartete Personenrente und kompakte Zeile tragen den künftigen Beginn oder „Rentenbeginn fehlt“. Ohne künftige Herkunft bleibt die bisherige Laufendregel erhalten. Außenprofile bleiben in eigenen Karten und außerhalb der Haushaltssumme.

Der Gesamtknopf entscheidet anhand der vorhandenen `hidden`-Regionen: gemischt → öffnen/ARIA false, alle offen → schließen/ARIA true. Einzelklick, `openPerson`, Hashöffnung, Geburtstagsergänzung und Sitzungswiederherstellung synchronisieren Text/ARIA. Nur der vorhandene Sitzungsschlüssel wird geschrieben. Nodebelege: `tranchen-manager-income`, `tranchen-manager-person-cards`, `tranchen-manager-profiles`, `tranchen-manager-renderer` und `profile-person-data`. Browserfall „Einkommen heute und Gesamtklappen“ ist registriert; externe Browser-/Bild-/Bedienabnahme offen.


### Cashwirkung und fachliche Quellenablehnung

`commitCashPostingConfirmation()` und `commitCashPostingCorrection()` liefern
flüchtig `cashRecordsChanged`: nach bestätigtem `applied` aus dem tatsächlichen
Rohbytevergleich ausschließlich der vorbereiteten Cashkeys mit der gebundenen
Quelle, bei `duplicate` immer `false`. Ein unveränderter numerischer Betrag
(einschließlich `8000,00` statt `8000`) erhält Tagesgeld und Cashhistorie bytegleich;
beide Erfolgsmeldungen nennen nur den Auditnachweis. Nur eine tatsächliche
Cashänderung wird als Übernahme des neuen Tagesgeldstands gemeldet und ergänzt
einen aktuellen datierten Cashbeleg. Registry-/Auditrecords bleiben im bisherigen Vertrag.

`currentCashError` erzeugt beim Öffnen einen sichtbaren fachlichen Fehler und
sperrt Submit auch nach Seitenrender. `readCashPostingForm()` liefert dann keinen
Auftrag; Abbruch bleibt mit der vorhandenen Dirty-Wache erreichbar. Gültiges
Wiederöffnen löscht den flüchtigen Fehler. Fehlende Quellen ohne Fehler bleiben
explizit eingebbar, numerische Null gültig. Der Domaincommit prüft die aktive
Quelle vor und nach dem Vorflush nach der Rohbytebindung und verweigert beschädigte
oder widersprüchliche Quellen mit `RECONCILIATION_CASH_SOURCE_INVALID`,
`retryable: false`, ohne Transaktion, Reparatur oder Wiederherstellungsbehauptung.
Stale bleibt vorrangig, identische Duplikate bleiben frühe No-ops. Nur technische,
retryfähige Speicherfehler halten Editor und ursprünglichen Auftrag/Zeitpunkt;
fachliche Quellenfehler hinterlassen weder Retry noch globale Managersperre.
`getManagerCashPostingDiagnostics()` gibt lesend nur einen eingefrorenen Snapshot
mit `pendingCashPosting: null` oder `'pending'` aus, keine Zustandsreferenz oder Finanzdaten.

SOURCE-Nachweise: Domain-, Modal- und Seitentests sowie isolierte registrierte
Browser-Smokes für Auditappend, neue Cashübernahme und Quellenablehnung mit
Profilbedienbarkeit nach Abbruch. Browserausführung erfolgt extern.

### Gemeinsame Seitendialoge

`app/shared/page-dialog.js` übernimmt Bestätigungen für Einzel-/Gesamtlöschung, Verlaufsreparatur/-verwerfen, Ausführungsabgleich, Corruptreset, Profil-Recovery/-löschung und Komplettbackup-Import. Abbruch/Escape/Signalabbruch und Öffnungsfehler erlauben keinen Write. Pending, Profil-/Bestandsprüfung, Flush/Rollback und Rückfokus bleiben beim jeweiligen Aufrufer. Synchronisationshinweise verwenden „Verstanden“ ohne Änderung des synchronen Boolean-/Silentvertrags. `page-choice-dialog.js` teilt den Lebenszyklus für Personenumstellung („Übernehmen“/„Später“) und Probelaufende („Probelauf beenden“/„Weiter testen“). Tranchen-/Casheditoren und Navigationsschutz behalten ihre eigenen Verträge. Browser-/Bild-/WebViewabnahme bleibt extern offen.

### Daten & Sicherung: Kursabdeckung (Paket 14, Slice 3)

`app/data/data-prices.js` liest den Startupreport über
`readStartupPriceReport()` ohne zusätzlichen Quotejob. Bestätigte Kurszeit,
Frische und Reportidentität müssen zusammenpassen; geteilte Ticker und
verkaufte historische Lots werden zusammengeführt. Die Verlaufsanzeige
verwendet dieselbe Queue wie `tranchen-history-fetch.js`, einschließlich
bestätigter leerer Feiertagsantworten. Angeforderter Beginn und erster
vorhandener Kurs sind getrennte Angaben.

Der manuelle Nachladeknopf verwendet den bestehenden `runHistoryFetch()` mit
Abbruch, 20-Sekunden-Budget und kurzen Navigations-Commitbesitzern. Der Dienst
prüft seine bestätigte Bestands-/Profilquelle über asynchrone Antworten hinweg.
Providerfehler lassen Intervalle offen; Teilfortschritt bleibt bestätigt.
Automatische Sitzungsmarker werden nicht verändert. `probeProxyHealth()`
liefert einen strukturierten Dienstbefund; der bestehende Textknopf delegiert
weiter über `checkProxyHealth()`. Quote-/Währungs-/Frischevalidierung und
synthetische Probelaufquellen bleiben unverändert.

### Zentraler Sicherungs- und Kursdiensteinstieg

Die Technik-Kursdienstprüfung verweist geschützt nach
`Daten-Sicherung.html#kursdienst`; Tranchen-Recovery nach
`Daten-Sicherung.html#fullBackupImportBtn`. Profil-Kennung, manuelle aktuelle
Kursaktualisierung und geschütztes „Alle Tranchen löschen“ bleiben im Vermögen.
Einzelpersonendateien einschließlich Depot und Cashhistorie werden auf Daten & Sicherung
exportiert oder als neue Außenperson importiert; dieser Weg ersetzt keinen bestehenden
Tranchen- oder Profilbestand.


### Haushalt & Plan (H2, Slice 1)

- `tranchen-manager-household-plan.js`: statische sechs Gruppen, bestätigter
  Haushalts-/Außenbereich, vollständige H1-Validierung, entprellte serialisierte
  Patches, Revisionserhalt, Retry und lesende CAPE-/Inflationsherkunft.
- `tranchen-manager-page.js`: bestehender asynchroner Bereitschaftsweg vor dem
  synchronen Init, Einbindung in Manager-Lifecycle/Guard und Flush vor Profilwechsel
  sowie Personenverwaltung. `flushManagerHouseholdPlan` beendet Pendingwrites.
- `tranchen-manager-profiles.js` und `tranchen-manager-renderer.js`: delegierte
  Ansichtssteuerung unter `#managerSectionNav`, Personenwechsel über den
  bestehenden Handler; `#haushalt-plan` fokussiert die statische Überschrift.
- `app/profile/household-plan-comparison.js`: gemeinsame schreibfreie Projektion
  und escaped Darstellung für Manager und Startseite. Beleg (`adopted`) und
  gespeicherte Vorschau bleiben getrennt, Veraltung sichtbar; keine Engineaufrufe
  und keine unterjährige Handlungsaufgabe.

`#managerHouseholdPlan` liegt außerhalb von `#managerHousehold` und
`#managerSectionNav`; Neuzeichnen entfernt keine Eingaben. Außenpersonen zeigen
und schreiben ihren Einzelplan. Planfehler sperren die betroffenen Controls;
unbestätigtes Rollback respektiert die bestehende Persistenzblockade. Die neue
Umstellungs-Snapshot-Art und der exakte manuelle Altpunkt bleiben dauerhaft erhalten.

Gezielte Belege: `tranchen-manager-household-plan`, `tranchen-manager-page`,
`tranchen-manager-navigation`, `tranchen-manager-renderer`, `household-plan-comparison`,
`overview-model`, `overview-ui`, `household-plan-migration`, `snapshot-archive` und
`snapshot-retention`, jeweils unter `tests/` als `.test.mjs`. Browserfall
„Haushalt und Plan Manager und Belegvergleich“ prüft echte Controls, Fokus,
Enter/Space, Pendingerhalt, Backendbestätigung und Bilder bei 390/1366/1920 px.
Browser-/Bild-/WebViewabnahme erfolgt extern durch die Steuerung; im orchestrierten
Lauf führt nur der Orchestrator die vollständige Node-Suite aus.

Die H1-Auswahl erlaubt nur aktuarische Horizontmethoden (`mean`,
`survival_quantile`). Deshalb bleibt der nur im nicht angebotenen Request-Modus
`direct` wirksame `horizonYears`-Wert erhalten und im Manager ausgeblendet;
der neue Editor führt keinen zusätzlichen Fachmodus ein.

### H5 Slice 1: gemeinsame Feldgestaltung

`tranchen-manager-household-plan.js` bindet seine statischen 25 Planfelder über
`app/shared/household-plan-fields.js`, denselben persistenzfreien Adapter wie
der Jahreseditor. Die sechs Gruppen, rechtsbündige Einheiten, Fokus-/Blur-Anzeige
und Segmente nutzen gemeinsame Stile aus `css/components.css`. Native Feldanker
bleiben eindeutig; Options- und Speicherkontrakte bleiben erhalten. Insbesondere
bleiben Steueroptimiert, Anteilig und Nacheinander (Reichweite zuerst) verfügbar.
Aktive Eingaben überleben bestätigte verzögerte Writes; reine Darstellung schreibt
nichts. Fehler werden am Feld ausgewiesen und bleiben korrigierbar.

Der Kopf zeigt „Gilt für“, Scopepille, Autosavehinweis und Inflationsnachweis.
Letzterer verwendet die tatsächliche Periodenkennung des passenden gültigen
Jahresbelegs und dessen Inflation; kein Abzug vom Planjahr. Nach einer
Planabweichung oder bei fehlendem/fremdem/beschädigtem Beleg bleibt der Nachweis
ausdrücklich unbelegt. `tests/household-plan-fields.test.mjs` und die erweiterten
Managerproben sichern Darstellung ohne Writes, Segmentwechsel, Sperren und
Abschluss 2026/Planjahr 2027 sowie H1-Gleichjahr. Browserbilder und Bedienung bei
1366/1920 px bleiben externe Abnahme durch die Steuerung.

### H5: Eigene Planvergleichskarte

`#managerPlanComparisonCard` liegt außerhalb der sechs Planfeldgruppen und trägt
die Überschrift „Planvergleich“. `#managerPlanComparison` behält den vorhandenen
Renderer mit festem Planlabel, Anpassungspille, heutiger Vorschau, semantischer
Tabelle und Quellen-/Aktualitätshinweisen. Die bestehende Balance-Vorschauaktion
bleibt im Kartenrahmen. Anzeige und Seitenwechsel erzeugen keinen Jahresbeleg;
`household-plan-comparison` sichert die gemeinsame Startseitenprojektion mit ab.
Browserbedienung und Bildvergleich bei 1366/1920 px sind extern zu bestätigen.

### H6: heutige Vorschau und lokale Planoberflächen

Der Haushaltsvergleich im echten Managercontroller liest
`projectOverview.previewSummary`, die heutige gespeicherte Balancevorschau.
`projectOverview.summary` bleibt nach Abschluss die feste Anzeige aus dem
Jahresbeleg (`adopted`). Beide Seiten vergleichen damit dieselbe heutige Quelle;
fehlende/ungültige Vorschau wird nicht durch den Beleg ersetzt. Außenpersonen
bleiben beim bisherigen scoped Einzelreader. Fingerprint, Rechendatum,
Planjahr und Planänderungszeit bestimmen weiterhin die Aktualität.

Planfelder erhalten lokale DS-Abstände, Radius und etwa 38 px Höhe, nicht die
versteckten Anker oder Checkboxen. Strategie-Segmente stehen waagerecht unter
dem Label; native Horizont-/Langlebigkeits-Selects erhalten die volle Zeile.
Der CAPE-Output bleibt lesend mit Herkunft. Die Vergleichskarte hat dieselben
Abstände und Überschriftenrollen wie der Planbereich, getrennte Plan-/Vorschaublöcke,
Anpassungspille und den unveränderten bewachten Balance-Link als DS-Knopf.
Managergruppen behalten Nutzungskennzeichen und Hinweise; der gemeinsame
Jahreseditor zeigt eine Gruppenspalte ohne Kennzeichen und CAPE-Fußnote.

Vollauswahl bleibt beim Wechsel zur Fokuszahl erhalten. Jährliche Euroeingaben
über 10.000.000 € sperren Autosave und Vorschau vor dem Fachwrite; gespeicherte
Altwerte werden nicht gekappt. Modell- und Controllerproben verwenden dieselbe
synthetische Abschlussfixture, einschließlich fehlender und veralteter Quellen.
Die Browserfälle messen berechnete Stile und Überlauf bei 1366/1920/390 px sowie
die Vergleichskarte nach echtem Probelaufabschluss. Ihre Ausführung und Bildabnahme
bleiben Aufgabe der Steuerung außerhalb der Agenten-Sandbox.


### Ansichtssteuerung (AU1b, Slice 1)

Ohne anerkanntes Sprungziel startet Personen & Vermögen bei Person 1, dem ersten Haushaltsmitglied (ohne Haushalt beim ersten Profil). Die Reiter stehen direkt vor den Inhaltskarten. Haushalts- und Personenkarten bleiben in „Haushalt & Plan“ erreichbar. Die einzige Ansichtsreiterliste zeigt zuerst „Haushalt & Plan“, dann die Haushaltspersonen in ihrer Reihenfolge, Außenpersonen und zuletzt „Verlauf“. Ohne Haushalt heißt der Planreiter „Plan · <Name>“. Die Planansicht zeigt Haushaltsvermögen neben dem Plananfang sowie die bisherigen Personenübersichten und den Planvergleich; die Personenansicht beginnt mit Person & Einkommen, in einer neuen Sitzung geöffnet, danach Tagesgeld & Gold, Pflege, Depot, Verkäufe/Cashstatus und Technik. Ein Depot-Link im Personenansichtskopf erreicht denselben bestehenden Hashzugang. Der ausführliche Vermögensverlauf steht ausschließlich im Reiter „Verlauf“ mit Haushalt-/Personenwahl und Kartenlinks „Verlauf ansehen ›“. „Öffnen“ auf einer Karte und der Personenreiter führen zur selben Ansicht, auch aus dem Planmodus. Links/Rechts und Home/End bewegen den Fokus; Enter oder Leertaste bestätigen die Auswahl. Ein interner Personenwechsel bleibt beim erneuten Rendern erhalten. Die Ansicht wird nicht dauerhaft gespeichert.

Bekannte Sprungziele wie `#haushalt-plan`, `#personendaten`, `#managerProfileValues`, `#managerDepotTitle` und `#profileTagesgeld` wählen das passende Panel und öffnen den benötigten Abschnitt. `?person=<ID>#profileTagesgeld` und der profilbezogene Planlink wählen erst das bestätigte Profil; `#personen` öffnet weiterhin die Personenverwaltung. Spätere Hashwechsel benutzen denselben Ablauf. Unbekannte Ziele sowie leere, doppelte oder ungültige Personenangaben wechseln kein fremdes Profil. Autosave, Rückfragen, Flush, Retry und Rollback bleiben verbindlich: Auswahl und Panel wechseln erst nach Erfolg.

`selectManagerView` bündelt Reiter, Karten und Sprungziele dokumentlokal. `resolveManagerTarget` akzeptiert nur bekannte Anker und eindeutige Personenparameter; `openManagerOverviewTarget` wartet Auswahl und Bereitschaft ab. `managerPlanPanel` umfasst Plan und Vergleich, `managerPersonPanel` alle Personenbereiche. Beide bleiben im DOM; das inaktive Panel ist `hidden` und `inert`. Der Renderer hält Auswahl und Rerenderfokus getrennt vom aktiven Profil. Personenkarten- und Verwaltungsbinder besitzen keinen eigenen Hashlistener mehr.

## Gemeinsame Dynamic-Flex-Voreinstellungen

`app/shared/dynamic-flex-presets.js` ist die einzige Presetquelle für Balance,
Simulator, Manager und Abschlusseditor: Aus, Konservativ, Ausgewogen, Offensiv,
Benutzerdefiniert. Sie erzeugt ausschließlich bestehende Dynamikfelder; die
Langlebigkeitsdefaults stammen weiterhin aus
`app/simulator/dynamic-flex-longevity-contract.js`. Die Erkennung ist lesend:
Aus gilt unabhängig von erhaltenen Details; aktive Presets vergleichen sieben
Felder mit Toleranz `1e-9`, sonst gilt Benutzerdefiniert. Inaktive
Langlebigkeits-Unterwerte beeinflussen die Erkennung nicht.

`app/shared/household-plan-dynamic-flex.js` bindet die fünf Segmente in Manager
und Jahreseditor. Feste Presets verbergen die Details und zeigen
„Voreinstellung gilt; Details sind ausgeblendet.“. Aus → Benutzerdefiniert
setzt nur `dynamicFlex = true`, erhält vorhandene Details und validiert auch
noch offene Eingaben im selben Batch. Bei aktiver Dynamik öffnet Benutzerdefiniert
nur die Details; diese Absicht bleibt lokal bis zum Neuladen oder Verwerfen.
Die native An/Aus-Kontrolle ist dort verborgen, Ausschalten erfolgt über Aus.
Sperren, fachliche Feldabhängigkeiten, Retry und Rücknahme bleiben erhalten.

Der Manager bestätigt den gesamten Batch über seinen entprellten Autosave.
Der Simulator liest den bestätigten Plan; Presetänderungen im Versuch bleiben
flüchtig bis zur ausdrücklichen Übernahme. Der Jahresabschluss ändert nur den
Entwurf über `createAnnualPlanDraft.changeBatch`: eine Revision und eine aktuelle
Berechnung, ältere Resultate werden entwertet. Abbruch/Verwerfen speichert nichts;
ausschließlich die vorhandene Abschlussbestätigung übernimmt den
`adoptedPlanPatch`. Es gibt keine neue Presetkennung im Plandatensatz und keinen
neuen Persistenzkey; CAPE-Provenienz und übrige Planfelder bleiben erhalten.

Node-Belege: `tests/dynamic-flex-presets.test.mjs`,
`tests/household-plan-fields.test.mjs`, `tests/tranchen-manager-page.test.mjs`,
`tests/annual-plan-editor.test.mjs`, `tests/simulator-dynamic-flex-persistence.test.mjs`
und `tests/balance-dynamic-flex-gate.test.mjs`. Browserfälle:
„Dynamic Flex Voreinstellungen seitenübergreifend“ und
„Dynamic Flex Voreinstellungen im Abschlussentwurf“.


## D6: eigener Verlaufsreiter und sichtbarer Produktname

`renderManagerView` steuert drei dokumentlokale Panels: Plan, Person und Verlauf
(`managerHistoryPanel`). Nur der Verlaufsreiter zeigt `managerWealthHistory`.
`managerHistorySwitch` und die Kartenlinks „Verlauf ansehen ›“ delegieren an
`selectManagerView`; eine Personenwahl durchläuft denselben bestätigten
Profilwechsel wie der Personenreiter. Haushalt zeigt die Haushaltslinie und
behält das aktive Profil als Speicherort der erfassten Stände. `#verlauf`,
`#managerWealthHistory` und `#managerWealthTitle` öffnen die neue Ansicht,
auch nach der bestehenden Balance-Weiterleitung. Erklärungen stehen im ⓘ,
das Diagramm ist 420 px hoch und die Tabelle bleibt offen. Ein Wechsel des
Profils, der Ansicht oder des Verlaufsumfangs leert die Statusmeldung; ein
Refresh derselben Ansicht erhält die Erfassungsmeldung. Speicherformat,
Schreibdienst, Sieben-Tage-Gate und Import-Nacherfassung bleiben unverändert.

Alle Seitenköpfe und Seitentitel sowie der Tauri-Fenstertitel heißen
„Vermögen & Ruhestand“. `suiteProfileContext` bleibt als unsichtbarer
Identitätsträger (`data-profile-id`, `data-profile-name`, `data-profile-state`)
erhalten; die Anzeige „Aktives Profil“ entfällt. Migrations- und Recoveryhinweise
bleiben sichtbar. Paket-/Dateinamen, Storagekeys, Tauri-Produktname und
Identifier bleiben unverändert.
