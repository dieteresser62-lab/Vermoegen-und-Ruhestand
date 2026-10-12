# Profilverbund: Multi-Profil-Auswertung

Der Profilverbund verbindet mehrere Profile zu einer gemeinsamen Analyse. Es gibt keinen separaten Verbundmodus oder separaten Tab mehr; die Profilauswahl steuert Balance und Simulator direkt.

## Ziele
- Mehrere Profile parallel auswerten, ohne separate Modus-Umschalter.
- Ergebnisse bleiben deterministisch und worker-kompatibel.
- Balance und Simulator nutzen dieselbe Profilauswahl.

## Datenquellen
- Profile werden in `profile-storage.js` verwaltet.
- Vermoegen, Tranchen, Renten und Gold-Strategie werden pro Profil gepflegt.
- `depot_tranchen` ist ein profilbezogener Rohpayload der zentralen Persistenz-Facade; `localStorage` ist nur Legacy-/Fallbackpfad.
- Der Pflegebucket wird als Profil-/Haushaltsdefinition im Key `profile_health_bucket` gepflegt.
- Profilselektion erfolgt per Checkboxen (Standard: alle aktiv).

## Balance-App (Profilverbund)
- Aktivierte Profile werden aggregiert: Tagesgeld, Geldmarkt, Depot Alt/Neu, Gold, Renten.
- Entnahmeverteilung erfolgt nach Modus:
  - `tax_optimized` (Steuerlast minimieren)
  - `proportional` (Vermoegensanteil)
  - `runway_first` (mehr Runway traegt mehr)
- Handlungsanweisungen listen Quellen/Verwendungen pro Profil getrennt.
- Transaktionen bleiben pro Profil (keine Profil-Grenzueberschreitungen).

## Simulator (Profilverbund)
- Profilauswahl unter „Annahmen“, Schritt 1 „Wer und womit“.
- Kombinierte Inputs:
  - Startvermoegen = Summe der Profile (unter Beruecksichtigung der Profileingaben)
  - Floor/Flex und Renten werden summiert
  - Tranchen werden zusammengefuehrt
- Personen/Renten: das aktive ausgewählte Profil ist Hauptprofil, sonst das erste ausgewählte; höchstens ein weiteres Profil ist Partner (maximal zwei).
- Ansparphase bleibt deaktiviert (vorerst).
- Pflegebucket: Die Definition des Hauptprofils gilt als Haushaltsdefinition. Abweichende Pflegebucket-Definitionen in weiteren aktiven Profilen werden als Warnung gemeldet, aber nicht gemischt.
- Der Pflegebucket-Carve-Out erfolgt erst nach dem Profilverbund-Merge auf dem aggregierten Haushaltsportfolio. Dadurch wird der Bucket nicht faelschlich gekappt, wenn ein Einzelprofil wenig Geldmarkt/Cash hat, der Haushalt insgesamt aber ausreichend cash-nahe Mittel besitzt.

## Hinweise
- Goldziel und Gold-Floor entstehen zuerst je aktivem Goldprofil als Eurobetrag auf dessen frei investierbarer Basis. Diese Basis umfasst das genau einmal reconciliierte Depot inklusive Gold sowie operative Liquiditaet; ein aktiver Pflegebucket wird hoechstens bis zur vorhandenen operativen Liquiditaet abgezogen.
- Erst die Summe der Profil-Euroziele wird durch die summierte freie Haushaltsbasis geteilt und als kompatible Haushaltsquote an bestehende Rechenpfade uebergeben. Profile ohne Goldstrategie vergroessern damit nicht das absolute Ziel eines anderen Profils.
- Die Goldstrategie-Diagnostik weist Basis, Pflegebucket-Abzug, Ziel und Floor je Profil aus. Die aktuell geoeffnete Profil-UI darf den Vertrag bei gleicher Profilauswahl nicht veraendern.
- Ein explizit leerer Tranchebestand bleibt leer. Korrupte, doppelte oder widerspruechlich klassifizierte Bestände blockieren fail-closed; es gibt keinen Rueckfall auf den Bestand eines anderen Profils.
- Sobald ein Profil valide oder explizit leere Detailtranchen repraesentiert, blockiert ein weiteres Profil mit positiven Depot-/Geldmarkt-Aggregaten, aber ohne Detailtranchen, mit `SIMULATOR_PROFILE_ASSET_PROVENANCE_MISSING`. Tagesgeld bleibt als separat provenienzfaehige Liquiditaet zulaessig; reine Aggregate-Haushalte bleiben kompatibel.
- Kombinierte Simulator-Tranchen erhalten profilbezogene IDs und `sourceProfileId`, damit spaetere Steuer-/Portfolio-Pfade die Herkunft nachvollziehen koennen.
- Der Simulator tiefenkopiert die Lots vor Merge und Portfolioinitialisierung. Simulierte Verkaeufe/Kaeufe mutieren nie den profilgebundenen Realbestand.
- Pflegebucket-Tranchen werden nach dem Merge aus kombinierten Geldmarkt-Tranchen ausgegliedert. Sie behalten Herkunftsinformationen und werden nicht als freie operative Liquiditaet an die Engine gegeben.
- Legacy-Keys wie `belongsToHousehold` und `household_withdrawal_mode` bleiben intern bestehen, sind aber UI-seitig nicht sichtbar.

## Beteiligte Module

### Balance-App
- `profilverbund-balance.js` – Aggregation, Verteilung, Tranche-Auswahl
- `profilverbund-balance-ui.js` – Profilverbund-UI (Profilwahl + Karten)
- `balance-main.js` – Integration und Zustandssynchronisation

### Simulator
- `profile-storage.js` – Profil-Registry und Persistenz-Layer
- `profile-manager.js` – UI-Steuerung fuer Profilverwaltung (index.html)
- `simulator-profile-inputs.js` – Profilaggregation und Simulator-Input-Mapping
- `simulator-portfolio-init.js` – Haushaltsportfolio und Pflegebucket-Carve-Out nach dem Merge
- `simulator-health-bucket.js` – Pflegebucket-Trigger, Nutzung, Verzinsung und Diagnose im Jahreslauf

### Profilverwaltung
- `index.html` – Zentraler Einstiegspunkt fuer Profilverwaltung
- `profile-bridge.js` – Synchronisation zwischen Balance und Simulator

## Tests
- `tests/profilverbund-balance.test.mjs` – Aggregation und Verteilungslogik
- `tests/profilverbund-profile-gold-overrides.test.mjs` – Gold-Strategie bei Profilkombination
- `tests/profile-storage.test.mjs` – Persistenz und Profilwechsel
- `tests/simulator-multiprofile-aggregation.test.mjs` – Simulator-Kombination und Tranchen-Merge
- `tests/browser-smoke.test.mjs` – Profil-A/B-Handoff, Reload und unveraenderter Realbestand nach Empfehlung/Simulation
- `tests/health-bucket.test.mjs` – Pflegebucket-Trigger, Deckung und Diagnose
- `tests/balance-health-bucket.test.mjs` – Balance-Diagnose und `diagnostic_only`-Policy

## Verwandte Dokumentation
- `README.md` → Abschnitt "Profilverbund (Multi-Profil)"
- `TECHNICAL.md` → Abschnitt "Multi-Profil Simulator"
- `TRANCHEN_MODULES_README.md` → verbindlicher Tranchen- und Reconcile-Vertrag
- `ARCHITEKTUR_UND_FACHKONZEPT.md` → Abschnitte Pflegefall-Modellierung, Marktvergleich und Forschungsabgleich


## Suite-Kontextanzeige (Paket 2a, Slice 2)

Der gemeinsame Kopf trennt aktive Einzelprofilidentität von der vorhandenen
Balance-/Simulator-Haushaltsauswahl. `profile-context-reader.js` liest Registry
und aktuelle/aktive ID erst nach Seitenbereitschaft; fehlende oder beschädigte
Kontexte werden nicht ersetzt. Profilmanager-Refresh erneuert den Kopf auch
bei lokal bereits gewechselter Identität während eines offenen Flush, ohne
die bestehende Erfolgsmeldung vorzuziehen. Das Handbuch liest ohne Bootstrap.

Die Leistenpräferenz `ui_suite_sidebar_collapsed` ist reine Geräte-UI und gehört
weder zu Profilen noch zu Bundles, Fachbackups oder Snapshots. Unter 82rem
äußerer Containerbreite ist die Leiste automatisch kompakt; darüber gilt die
manuelle Wahl. BFCache-Rückkehr widerruft alte Freigaben und führt den `pageshow.persisted`-Reload
erst nach erneuter Schutzentscheidung und bestätigtem Flush aus.


## Abschließende Rahmennavigation (Paket 2a, Slice 3)

Die gemeinsame Übersicht ersetzt die bisherigen Start-/Rücklinks. Profilauswahl,
Haushaltsmitgliedschaft und getrennte Anzeige bleiben bei ihren vorhandenen
Eigentümern. Der Manager-Rahmenlink `#managerBackLink` erhält Profil-ID und
zugängliche Beschreibung weiterhin von `updateActiveProfileLabel`; kein zweiter
Rücklink und keine zusätzliche Profilwahl entstehen. Markierte Karten und
Manager-Einstiege behalten den zentralen bestätigten Handoff; die Handbuchkarte,
Inhaltshilfe im neuen Tab und Recoverywege behalten ihren eigenen Vertrag.
Browser-/Layout-/BFCache-/EXE-Abnahme steht extern aus; Schutzdialoge sind
angeschlossen, Ergebnisablage folgt erst in Paket 4.2.

## Profilwrite, Recovery und BFCache mit Navigationsschutz

Der Startseitenwechsel schützt die erste Registry-/Profilmutation bis Flush und
abschließender Statusanzeige. Auswahl, Volltext, Badge und lokale aktuelle ID
wechseln wie bisher vor der bestätigten Backend-ID; Erfolg folgt ausschließlich
nach bestätigtem Flush. Zweitwechsel bleibt singleflight. Erfolgreiche Create-/
Save-/Rename-/Deletefortsetzungen sind mit demselben Schreibbesitzer verbunden.
Navigation und fremde Schreibaktionen überholen diese Fortsetzungen nicht.

Recovery bewahrt Exportpflicht und ausdrückliche Resetbestätigung. Reset und
Retry verwenden `reloadGuardedPage`: Entscheidung vor Mutation, alle Abbruchenden,
eigener Commit durch letzten Flush, Schlussprüfung und genau ein Reload ohne
Bundleexport. Fehler bleiben im Recoveryhost; Wiederholung ist möglich. Bereits
mutierte Resetdaten werden nach Flushfehler erneut bestätigt, ohne eine neue
Rollbackgarantie zu behaupten. BFCache widerruft alte Freigaben und verwendet
Schutz/Flush vor Wiedereinführung; Ablehnung erhält das wiederhergestellte Dokument.
Eine noch eingefrorene Handoff-Fortsetzung behält ihre Reservierung bis zum
tatsächlichen Ende und darf kein altes Linkziel mehr schreiben. Danach beginnt
automatisch genau ein neuer geschützter Reloadversuch. Neue Eingaben während
des Wartens oder nach der neuen Zustimmung verhindern Reload; ein Warteabbruch
durch Eingabe erklärt sich im ortsfesten Navigationsstatus.
Node: `profile-ui-contract`, `profile-navigation`, `navigation-guard-reload`.
Browser: `Navigation guard profile writes`, `Navigation guard resets and recovery`,
`Navigation guard browser history`, `Suite frame bfcache`; externe Abnahme offen.


## Zentrale Personenquelle (Paket 10)

Die vollständige Verlaufskarte in Personen & Vermögen verbindet die Tageslinie der gewählten Ansicht mit erfassten ◆/◇-Ständen des aktiven Profils. Alte Profil-/Verbundstände besitzen keinen verlässlichen historischen Personenbezug: Sie werden weder heutigen Mitgliedern zugeordnet noch für den Haushalt summiert. Tabelle und Kennzahlen behalten ihre Werte; Gold und separate Anleihen fehlen nur in den erfassten Ständen. Der Managerknopf verwendet bestätigte Quellen und das bestehende Sieben-Tage-Kursgate.

Jede tatsächliche Profil-ID besitzt ihre Personendaten zentral unter „Personen & Vermögen → Person & Einkommen“. `profile-person-data.js` liefert Januaralter, Geschlecht, Monatsrente, Rentenbeginn, Rentenanpassung, Kirchensteuer und SPB; Schlüssel und Legacyquellen stehen in TECHNICAL. Außenprofile behalten eigene Daten; alte Partneraktivierung ändert keine Mitgliedschaft. Personenkarten, geschlossene Zusammenfassungen und Startseitenmitglieder zeigen das heutige Alter der App-Uhr; die Detailzeile erklärt das unveränderte Planungsalter am 01.01. Geburt am 01.01. zählt in der Planung am Stichtag, sonst erst im Folgejahr. Ein belegtes Altalter bleibt bis Datumsergänzung fest. Jahresabschluss/Retry schreiben kein Profilalter; Rentenbeginn bleibt jahresbezogen ohne Monatskürzung.

Balance liest die zentrale Projektion einschließlich des gesperrten SPB. Der Simulator projiziert je Profil vor dem vorhandenen Merge: SPB wird summiert, Kirchensteuer nach bestehendem Vermögensmaß gewichtet, Rentenanpassung und Pflegekonfiguration folgen dem Hauptprofil. Die höchstens zwei Personen behalten ihre Identität und eigenen Renten; ein Finanzmerge schreibt keine Personendaten zurück.

Sichere Umstellung läuft vor freigegebener Seitenbereitschaft über `profile-navigation.js`: vollständiger dauerhaft geprüfter Recovery-Punkt, explizite Quellen-/Partnerauswahl, bestätigte Transaktion und je Profil Version 1. Abbruch erhält Fachbytes, Fehler erlauben kontrollierten Retry beziehungsweise Recovery. Capture, Bundles und Vollbackup erhalten Personenschlüssel und Migrationsherkunft. Der Migrations-Snapshot unter Daten & Sicherung → Wiederherstellungspunkte ersetzt Registry und Livealtwerte vollständig; geschützter Reload prüft Altbestand erneut.

Sitzungskarten sind je Profil getrennte UI, keine Fachwerte. Simulatoralternativen bleiben im Dokument; Aus/Profilwechsel/Reset/Reload verwerfen sie ohne Personenwrites. Der eingefrorene `personDataContext` am Lauf dokumentiert Profil-ID/Rolle, Januarregel, Referenzjahr und wirksame Änderungen vor der Aggregation. Ergebnis/Protokoll/JSON/CSV bleiben auch nach neuer Eingabe an ihren Lauf gebunden; Kontext und additive CSV-Felder ändern keine bisherigen Pflicht-/Finanzspalten. Abweichende Replayworkspaces werden nicht automatisch persistiert.

Node-/Quellbelege, volle Orchestrator-Suite und externe zehn Bedienabläufe, Bildvergleich 01–07, Windows-EXE/WebView werden getrennt abgenommen. Externe Gates bleiben bis tatsächlicher Ausführung offen.

### Einzelperson als Datei

Unter Daten & Sicherung lässt sich eine bestätigte gewählte Person mit eigenem Depot,
Personendaten und Cashhistorie exportieren. Der vorhandene Bundlevalidator prüft einen
auf genau eine Person begrenzten Container ohne Globals. Import legt nach expliziter
Vorschau eine neue Außenperson mit kollisionsfreier ID und Namen an, schreibt nur die
Registry und bestätigt den Backend-Readback. Aktive IDs, bisherige Personen und Live-
sowie globale Records bleiben erhalten; Partnerzuordnungen werden nicht übernommen.
Die Haushaltsmitgliedschaft wird anschließend in Personen & Vermögen gepflegt.
`profile-person-file.js` bleibt getrennt vom ersetzenden Vollbundle-/window.name-Vertrag.
Abbruch und Kontextwechsel verwerfen die Vorschau; im Probelauf bleibt Austausch gesperrt.
