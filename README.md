# Vermögen & Ruhestand

Vermögen & Ruhestand ist ein lokal betriebenes Planungstool ohne serverseitige
Fachlogik oder automatischen Cloud-Sync. Die Suite verbindet Jahresplanung, Ausgaben und Simulation:

* **Balance-App** – steuert den jährlichen Entnahmeprozess, verwaltet Liquidität und erzeugt Diagnoseberichte.
* **Ausgaben** – zeigt Monate, Budget, Kategorien und Jahre; CSV-Import und Monatsabschluss sind hier erreichbar.
* **Simulator** – führt Monte-Carlo-Simulationen, Parameter-Sweeps und Pflegefall-Szenarien aus.

Der Simulator öffnet die Ergebnisübersicht mit einem historischen Backtest nach
Profil- und Persistenzbereitschaft. Unter **Annahmen** stehen fünf unabhängig
klappbare Schritte: Wer und womit, Bedarf, Strategie, Personen und Rente, Pflege.
„Alle Parameter zeigen“ öffnet die vorhandenen Detailfelder; Herkunft und
Profilsperren bleiben erhalten. Pflege aus sperrt Details ohne Wertverlust, die
Reserveanzeige bleibt sichtbar. Wirksame Änderungen markieren Monte-Carlo als
veraltet und rechnen den Backtest bei Rückkehr zum Ergebnis neu. Der geschützte
Simulator-Reset steht am Ende der Annahmen.

Backtest und Monte-Carlo-Szenarien verwenden ein gemeinsames Jahresprotokoll mit
Gruppenüberschriften, Spaltenerklärungen, feststehender Jahrspalte und Markierungen
für Kürzung, Pflege und Ruin. Kalenderjahr, Simulationsjahr, historisches Marktjahr
und Alter sind getrennt. **Details** und **Pflege-Details** ändern nur die Anzeige;
**JSON herunterladen** und **CSV herunterladen** stehen im jeweiligen Protokollkopf
und laden weiterhin die vollständigen Daten nach dem bestehenden Exportvertrag.
„Liquidität reicht“ zeigt die Reichweite vor Entnahme in Jahren. „Kein Ruin“ im
MC-Protokoll bedeutet keinen vollständigen Lebensabschluss. Der Ergebnisverlustschutz
gehört zum jeweiligen Dokument: Ein abgebrochener Erstlauf übernimmt kein fremdes
Ergebnis; ein abgebrochener Folgelauf erhält den Schutz des verfügbaren alten Ergebnisses.

Dynamic Flex verwendet überall dieselben Voreinstellungen aus
`app/shared/dynamic-flex-presets.js`: **Aus · Konservativ · Ausgewogen · Offensiv ·
Benutzerdefiniert**. Im Manager und im Jahresdialog verbergen feste Presets alle
Details. Benutzerdefiniert schaltet ausgeschaltete Dynamik mit den vorhandenen
Detailwerten ein; bei aktiver Dynamik öffnet es nur die Details. Im Manager
speichert der bestehende Autosave den vollständig validierten Batch. Ein
Simulatorversuch bleibt flüchtig bis zur ausdrücklichen Übernahme. Im
Jahresabschluss wird nur der Entwurf neu berechnet; erst die Abschlussbestätigung
übernimmt ihn. Abbruch und „Anpassung verwerfen“ erhalten den bestätigten Plan.
Eine Presetkennung wird nicht im Plan gespeichert. Nach Neuladen erkennen alle
Verbraucher dieselben Werte; ausgeschaltete Dynamik erscheint auch mit alten
Detailwerten als Aus.

Beide Anwendungen teilen sich eine modulare Berechnungs-Engine. Der
Browserbetrieb benötigt keinen Anwendungs-Build, wird wegen ES-Modulen und
Workern aber über den mitgelieferten lokalen HTTP-Start geöffnet. Kernrechnung,
manuelle Dateneingabe und lokale Persistenz funktionieren ohne Internet;
Live-Kurse und Inflations-/CAPE-Abrufe sind optionale externe Netzwerkpfade.
Schriften (Newsreader, IBM Plex Sans/Mono) und Lucide-Symbole werden lokal ausgeliefert.

Die sieben Seiteneinstiege laden zuerst `css/tokens.css`, dann `css/fonts.css`
danach `css/components.css` und ihre bestehenden Seitenstile. Komponenten,
Feldherkunft, Ergebnis-/Werkzeugrenderer und deutsche UI-Ausgaben verwenden
das gemeinsame Designsystem. Breite Tabellen und Grafiken besitzen benannte
Scrollregionen; lange native Auswahlen zeigen zusätzlich ihren Volltext. Rollen, Kontrastpaare und Migrationsgrenzen: [Designsystem](docs/design/designsystem.md).

Alle sieben Seiten besitzen einen statischen gemeinsamen Kopf, sieben benannte Hauptlinks,
einen Sprunglink zur Hauptaufgabe und eine ortsfeste Fehlerregion. Profil und Seitenstatus stehen einmal im gemeinsamen Kopf; die kompakten Seitenköpfe ordnen vorhandene Aktionen zur Titelzeile. Lange Namen bleiben vollständig lesbar. Der Rahmen lädt
`css/suite-frame.css` nach den Seitenstilen; `app/shared/suite-frame.js` ergänzt nur
lokale Schmucksymbole, lesende Kontextanzeigen und die Gerätepräferenz; es startet die zentrale Profilübergabe. Alle lokalen HTML-Links im selben Tab
(einschließlich Handbuchkarte und Recovery) verwenden den gemeinsamen Navigationsschutz
und warten auf bestätigten Persistenz-Flush. Nur markierte Bestandseinstiege exportieren
das Profilbundle (außer zum Manager). Bei angeschlossenen Verlustgründen fragt ein
modaler Dialog mit „Bleiben“ und „Trotzdem wechseln“; aktive Schreibvorgänge sperren
mit einem Wartehinweis. Tranche-/Cashdialoge erkennen tatsächliche geänderte Eingaben,
Rückänderungen und bestätigte Speicherstände. Verwerfen benötigt Zustimmung, Schließen
bleibt während eines Writes gesperrt. Monte Carlo, Sweep, Auto-Optimize und Backtest warten ihre Abbruchenden ab;
Jahresabschluss, Importe, Snapshot-, Manager-, Verlauf- und Profilwrites bleiben
bis zum bestätigten Speicher-/Fehlerabschluss gesperrt. Simulator-Reset und Profil-Recovery
verwenden denselben geschützten Reloadweg ohne Bundleexport. Ist der Reset gespeichert,
aber wegen neuer Eingaben oder fremder Writes nicht neu geladen, bleibt eine sichtbare
Reloadaufforderung stehen; Eingaben werden im alten Dokument nicht mehr gespeichert.
Eine erneute bestätigte Resetaktion bestätigt nur den ausstehenden Flush und lädt neu,
ohne nochmals zurückzusetzen. Auch nach einem Speicherfehler bleiben alte Eingaben
gesperrt; ein Vorbereitungsabbruch vor der Mutation erzeugt keine neue Schreibsperre.
Native Browsernavigation und Reload verwenden
bei Schutzgründen die browsergegebene Nachfrage nach Nutzeraktivierung; sie versprechen
keinen asynchronen Abbruch oder bestätigten Flush. Fehler verhindern App-Wechsel.
Das Handbuch initialisiert Persistenz ohne Profilbootstrap und automatische Speicherhooks, aber mit EXE-Schließschutz.
Der Kopf zeigt den Haushalts- und Seitenkontext; die validierte aktive Profilidentität bleibt intern erhalten. Balance
und Simulator melden ihre bestehende Haushaltsauswahl getrennt. Fehlender Kontext
bleibt neutral; das Handbuch erzeugt kein Defaultprofil. Die Leiste wird bei äußeren
Containerbreiten unter 82rem automatisch kompakt (4 statt 12rem). Darüber gilt die
manuelle Gerätepräferenz; nur die Symboltaste speichert `ui_suite_sidebar_collapsed`
lokal, getrennt von Profilen, Bundles, fachlichen Backups und Snapshots. Der Rahmen ersetzt
die früheren Start-/Rücklinks auf Balance, Simulator, Manager und Handbuch. Hilfe auf
Balance/Simulator öffnet weiterhin einen neuen Tab; Startkarten, Manager-Einstieg,
Jahresabschluss, Diagnose, Handbuchkapitel und Recoverywege bleiben erhalten.
`#managerBackLink` liegt genau einmal am Rahmenlink zur Übersicht und erhält weiter
Profil-ID und zugängliche Beschreibung vom Manager. Navigationsschutz ist in Paket 2b angeschlossen; Ergebnisablage
folgt erst in Paket 4.2. Browser-/Layout-/BFCache-/EXE-Abnahmen stehen extern noch aus;
die volle Node-Suite prüft der Orchestrator. Balance-, Manager- und betroffene Simulator-Spalten
messen ihre verfügbaren Inhaltscontainer. Beim Drucken verschwindet der Rahmen.

Die gemeinsame Volltexthilfe `app/shared/designsystem-selection-text.js` hält
`<id>-fulltext` synchron bei jeder programmatischen Auswahländerung aktuell:
Nach der Bindung delegieren instanzbezogene `value`- und `selectedIndex`-Accessoren
an die ursprünglichen DOM-Accessoren und lesen den tatsächlich ausgewählten
Optionstext. Initialisierung und Optionsrefresh erfassen Werte vor der Bindung;
`change` und der MutationObserver bleiben für Benutzereingaben und Optionsänderungen.
`option.selected` in `profile-manager.js` wird durch den bestehenden expliziten
Refresh am Ende von `renderProfiles` erfasst. Der Reset von `reconciliationForm`
führt über `clearReconciliationPreview` und `renderReconciliationState` zum
bestehenden expliziten Refresh in `renderReconciliationOptions`. Die anderen
Formular-Resets (`trancheForm`, `stressReplayVariantEditor`) treffen keine Selects
mit Volltext; der Varianteneditor vergibt auch nachträglich keine Select-IDs.
Leere Auswahl ergibt leeren Volltext. Globale DOM-Prototypen, Fachwerte,
Optionsentscheidungen, Sperren, Speicher und fremde `aria-describedby`-Bezüge
bleiben erhalten; die Hilfe erzeugt keine künstlichen `input`-/`change`-Events.
Node-DOM-Tests sichern die Produktpfade und scheiternde Settergegenproben ab;
die registrierten Browserfälle prüfen native Setter samt Indexgegenprobe,
Profilwechsel/Reload, Preset/Custom und den Reset nach Abgleichbestätigung.

---

## Release-Stand

**Aktueller Dokumentationsstand:** 2026-10-05

**Changelog:** siehe [CHANGELOG.md](CHANGELOG.md)

---

## Dokumentation

| Dokument | Zielgruppe | Inhalt |
|----------|------------|--------|
| **[QUICKSTART.md](QUICKSTART.md)** | Einsteiger | Start in 2 Minuten, erste Schritte |
| **[docs/guides/GUIDED_TOURS.md](docs/guides/GUIDED_TOURS.md)** | Alle Nutzer | Schritt-für-Schritt-Anleitungen für typische Aufgaben |
| **[Daten-Sicherung.html](Daten-Sicherung.html)** | Alle Nutzer | Vollsicherung, Sicherungszustand und vorhandene Archivpunkte |
| **[Handbuch.html](Handbuch.html)** | Alle Nutzer | Interaktive Hilfe im Browser |
| **[CHANGELOG.md](CHANGELOG.md)** | Alle Nutzer/Entwickler | Änderungen pro Release |
| **[docs/reference/ARCHITEKTUR_UND_FACHKONZEPT.md](docs/reference/ARCHITEKTUR_UND_FACHKONZEPT.md)** | Fortgeschrittene | Algorithmen, Fachlogik, Modell-/Datenstandsmatrix, offene Entscheidungen und getrennte Validierungsstatus |
| **[docs/reference/MARKTVERGLEICH.md](docs/reference/MARKTVERGLEICH.md)** | Fortgeschrittene | Marktvergleich mit zehn externen Werkzeugen: Methodik, Kriterienmatrix, Modellierbarkeit, Positionierung und belegte Lücken |
| **[docs/reference/WISSENSCHAFTLICHER_RAHMEN.md](docs/reference/WISSENSCHAFTLICHER_RAHMEN.md)** | Fortgeschrittene | Quellenlage der 17 Rechenmechanismen, Aussagegrenzen, Ergebnisinterpretation, Forschungsrisiken und offene Fragen |
| **[docs/reference/TECHNICAL.md](docs/reference/TECHNICAL.md)** | Entwickler | Architektur, Build, Debugging |
| **[docs/reference/TRANCHEN_MODULES_README.md](docs/reference/TRANCHEN_MODULES_README.md)** | Nutzer/Entwickler | Tranchenvertrag, Persistenz, Quotes, Consumer und Reconcile |
| **[docs/README.md](docs/README.md)** | Autoren/Entwickler | Doku-Struktur und Aufräum-Status |
| **[docs/internal/archive/2026-dynamic-flex/](docs/internal/archive/2026-dynamic-flex/)** | Entwickler (intern) | Archiv der Dynamic-Flex-Implementierungsunterlagen (Plan, Tickets, Rollout, Baseline, CAPE-Contract) |

---

## Funktionen im Überblick

### Personen & Vermögen

Die gemeinsame Verlaufskarte verbindet die Tageslinie der gewählten Haushalts-/Personenansicht mit gespeicherten Ständen: ◆ Jahresabschluss, ◇ Unterjährig. Marken stehen am gespeicherten Datum und Wert, auch ohne bewertbare Tageslinie. Darunter stehen die vollständige Tabelle (neueste zuerst) und die drei bisherigen Kennzahlen. Stände sind im aktiven Profil gespeichert; ihr damaliger Profil-/Verbundumfang wird nicht heutigen Personen zugeordnet oder summiert. Gold und separate Anleihen fehlen in Ständen, Tabelle und Kennzahlen; die Tageslinie behält ihre Anlageformen.

„Stand jetzt erfassen“ nutzt bestätigte Quellen und das bestehende Sieben-Tage-Kursgate: exakt sieben Tage und kursfreie Bestände sind erlaubt; alte oder unbekannte Belege schreiben nichts. Derselbe Tag ersetzt den unterjährigen Stand, ein anderer ergänzt ihn; Jahresstände bleiben erhalten. Erfolg folgt bestätigter Speicherung. Anzeigen und Resize schreiben keine Finanzdaten.

`depot-tranchen-manager.html` bleibt der Einstieg für Personenwerte und den realen Depotbestand. Der Rahmen zeigt „Personen & Vermögen“ mit „Rente, Depot, Gold“; unveränderte andere HTML-Einstiege enthalten ohne JavaScript noch die bisherige statische Managerbezeichnung. Haushalt und Personenkarten sind ausschließlich lesende Zusammenfassungen. Vermögen umfasst Tranchenmarktwert plus Tagesgeld; die Pflegereserve ist ein Ziel innerhalb der Liquidität. Auch Profile außerhalb des Haushalts sind über Reiter erreichbar.

Der rahmenlose Seitenkopf zeigt je nach Profilanzahl „Alles über dich, an einem Ort.“ oder „Alles über euch beide, an einem Ort.“ und die Aktionen für Kurse, Kauf und Verkauf. Der gemeinsame Suite-Kopf nennt gespeicherten Kursstand und Speichermodus. „Automatisch“ beim Kursstand erscheint nur mit passendem Sitzungsbeleg für die dargestellten Kurse. Haushalt und Personenkarten zeigen Allokation, Einkommen und Initialavatars; die aktive Karte ist hervorgehoben. Der Hauptprofilbezug folgt der vorhandenen Haushaltsreihenfolge, unabhängig vom aktiven Profil und ohne neue Rollenpersistenz.

Die drei Karten „Person & Einkommen“, „Tagesgeld & Gold“ und „Pflegereserve“ bedienen die vorhandenen Profilfelder. Personenreiter der gemeinsamen Ansichtssteuerung und „Öffnen“ sichern ausstehende gültige Profilwerte einschließlich des 300-ms-Autosaves dauerhaft vor dem Wechsel. Offene Bestands-, Cash- und Abgleichentwürfe verlangen den vorhandenen Verwerfentscheid. Kursjobs enden vor dem Wechsel, die komplette Zielansicht erhält neue Baselines. Speicherfehler erhalten den Ursprung beziehungsweise zeigen Profil-Recovery direkt im Manager. Verkaufsschritte, Cashstatus und Tranchen-Recovery bleiben direkt erreichbar; Kursdienstprüfung und Gesamtlöschung liegen unter „Technik“. „+ Person anlegen“ außerhalb der Ansichtsreiterliste und die „…“-Menüs der Personenkarten öffnen denselben Dialog für Anlegen, Umbenennen, bestätigtes Löschen und Haushaltsmitgliedschaft; die Startseitenverwaltung bleibt ebenfalls nutzbar. Technische Profilkennungen stehen in der Technikansicht; die gewählte Person ist am Reiter erkennbar.


Das Depot gruppiert Aktien/ETFs, Geldmarkt, Gold und Anleihen, mit Gruppensummen und nach Kaufdatum sortierten Zeilen. Die Bewertungsleiste zeigt Marktwert ohne Tagesgeld, Einstand und Buchgewinn absolut/relativ; die tatsächliche Tranchensumme steht daneben. Kursdatum und Kursstand werden lokal aus dem gespeicherten `asOf` (UTC-Unixsekunden) angezeigt; fehlende und gemischte Stände bleiben erkennbar. „Steuerfrei“ folgt allein der expliziten Bestätigung, Teilfreistellung und Altbestand werden separat ausgewiesen.

„Kauf eintragen“ und die Zeilenaktion „Bearbeiten“ öffnen denselben Dialog mit passenden Speicheraktionen, allen bisherigen Vertragsfeldern und einer lesenden Einstand-/Marktwertvorschau. Bearbeiten erhält die Kennung; Abbruch schreibt nichts. Käufe ziehen kein Tagesgeld automatisch ab. Einzellöschung verlangt weiter Bestätigung, Gesamtlöschung liegt unter Technik.

„Verkauf eintragen“ führt durch Ausführung, Cash und schreibfreie Vorschau. Alle aktiven Tranchen sind namentlich auswählbar; die Ausführungs-Kennung bleibt bei Rückkehr und Retry erhalten. Cash „Ja“ verlangt den bestätigten Stand, „Nein“ hält die manuelle Buchung offen. Erst die gesonderte Bestätigung verändert den Realbestand. „Verkäufe & Cashstatus“ zeigt offene, bestätigte, korrigierte und Legacyvorgänge einschließlich Nachweiszeitpunkt; Korrekturen verlangen einen Grund und hängen einen neuen Nachweis an. Verkaufserfassung erhöht Tagesgeld nicht automatisch. „Tagesgeld nachgetragen – bestätigen“ übernimmt dagegen den ausdrücklich eingegebenen absoluten Stand gemeinsam mit Cashhistorie und append-only Audit; der Nettoerlös bleibt unverändert und wird nicht addiert.

Personenaktionen schließen aktive Profilwerte zuerst dauerhaft ab. Anlegen und Löschen des aktiven Profils laden den tatsächlich gewählten Ziel-/Fallbackbestand einschließlich Formularen und neuen Baselines. Inaktive Finanzdaten werden nicht bearbeitet. Bootstrap-, Lade- und Schreibfehler bieten Recovery unabhängig vom geschlossenen Technikbereich.

### Balance-App

Die Balance-Rechnung baut ihre vollständigen Eingaben aus dem gespeicherten Rechenumfang über `buildBalanceEngineInputFromStorage({ scope, storage })`. Der Leser arbeitet ohne DOM und Fensteraggregate, einschließlich Personen-, Tranchen-, Haushalts- und LastState-Projektion. Das Formular bestätigt valide Änderungen samt vorgemerkter Depotmetadaten vor der anschließenden Rechnung in den bestehenden Speicherbesitzern. Eine Vorschau verwendet einen isolierten Speicherentwurf und schreibt weder Plan noch Engine-State oder Jahresbeleg; der gemeinsame H1-Plan bleibt die Quelle für Bedarf und Strategie. Der bisherige DOM-Reader bleibt als Vergleichsorakel erhalten. Die transaktionale Jahresfortschreibung folgt im nächsten Arbeitspaket.


Balance verwendet drei Reiter: Überblick, Bedarf & Strategie und
Diagnose. „Alle Parameter“ synchronisiert die Detailansicht nach dem abgeschlossenen
Feldbesitzerdurchlauf, ohne Formularereignis, Berechnung oder Finanzwrite. Auch Aus
und An/Benutzerdefiniert erhalten beim erneuten Öffnen ihre gültigen Feldgründe.

„Details & Drucken“ zeigt einmal den vollständigen Aktionstitel samt Cashergänzung
und verfügbarer Marktphase. Quellen verwenden lesbare Tranchennamen/Kaufdaten;
technische IDs und pauschales FIFO entfallen. Profilspalten erscheinen nur im
Haushalt. Steuersummen bleiben in der Quellentabelle; eine eigene Detailsbox gibt
es nur bei zusätzlicher relevanter Steuerinformation. Alle Verwendungen und Ziele
stehen in „Wohin es fließt“, Liquiditätszufluss mit Plus und gegebenenfalls Zielmonaten
Nettoentnahme. Die Nachherzeile zeigt nur gelieferte Deckung, keinen erfundenen Betrag.
Interne Umschichtungen bleiben getrennt, Zwecklabels ohne Schlussdoppelpunkt.
Sichtbarer Plan und Druck zeigen ganze Euro, die getrennte Textkopie bleibt centgenau.
Die ×-Knöpfe der Aktionsbänder erhalten Namen/Fokus und stehen rechts neben vorhandenen
Folgeaktionen; der Jahresdialog zeigt die großgeschriebene Eyebrow und eine gedämpfte
14-px-Handkurshilfe. Fachwerte, Export, Parser und Jahresprozess bleiben unverändert.

Die vollständige Liste aller 44 Balance-Module, Exporte und Imports steht in der
[Modulreferenz](docs/reference/BALANCE_MODULES_README.md). Grundbedienung 10/10,
Browser/Druck und der Dialogbildvergleich 08/09 bei 1920/2560 px bleiben externe
Abnahmen; die volle Node-Suite führt der Orchestrator aus.

Bedarf & Strategie gliedert sich in Dein Bedarf, Übernommen, Marktdaten, Haushalt und Alle Parameter. Alle Parameter enthält Flex-Budget & Mindest-Flex, Dynamic Flex · Details, Notfallpuffer & Gold, Steuern und 3-Bucket. Bestehende Langlebigkeitsmodi, Freigaben und Mindest-Flex-Validierung bleiben erhalten. Runway bleibt gemäß vorhandenem Vertrag in Jahren; es gibt keine Umrechnung auf die Entwurfsbeispielwerte. Übernommene Bestände und Einkünfte erscheinen als Herkunftszeilen mit geschützten Pflegewegen zu Personen & Vermögen. Ihre nativen Wertträger einschließlich TQF und Kostenbasis bleiben unter bisherigen IDs, Typen, Werten und Sperren dauerhaft verborgen; Laden, Lesen, Speichern und Einheiten ändern sich nicht. Einheitsfelder tragen ihre tatsächlichen Einheiten: Runway in Jahren, Quantile und relative Puffer als Ratios. Entnahmestrategie, Dynamic-Flex-Preset und Haushaltsverteilung sind Segmente über den bestehenden Selects; Detailschalter spiegeln die vorhandenen Checkboxen. Programmgesteuertes Laden aktualisiert die Ansicht ohne weitere Profilreads oder Writes. „Alle Parameter“ ist eine flüchtige native Klappe; ihr Öffnen aktualisiert nur die Detailansicht, ohne neue Speicherkeys. Ein Klick auf „Benutzerdefiniert“ öffnet sie auch bei presetgleichen Werten und fokussiert nach dem nativen Abgleich das erste freigegebene Dynamic-Flex-Detailfeld. Die bestehende Preseterkennung und Sperren bleiben maßgeblich. Marktdaten zeigt sechs Korrekturfelder mit Provenienzuntertitel und Textaktion Protokoll; CAPE liegt bei den Dynamic-Flex-Details. Export, Import, Legacy-Ordnerverbindung und Wiederherstellungspunkte liegen auf Daten & Sicherung; Balance enthält keine eigene Sicherungskarte. Suite-Navigation, Alt+E/Alt+I und Jahres-Recovery führen geschützt zur zentralen Seite. Markt-CSV, manuelles Nachrücken/Undo, Alt+N, Tranchenstatusklappe und Balance-Reset entfallen. Ausgaben-CSV und Simulator-Reset bleiben erhalten.

Die Kopfzugänge „Marktdaten aktualisieren“ und „Jahresabschluss“, der Strategiebutton und die Jahresaktion im Überblick sowie Alt+J starten denselben Snapshot-/Periodenkoordinator über `manual.withAnnual`. Der Jahresdialog zeigt vor Start nur geplante Schritte; „Jahr … abschließen“ ersetzt die bisherige Abschlussbestätigung an derselben Grenze nach Legacy-/Periodenprüfung. Optionaler Handkurs ersetzt ausschließlich den ETF-Abruf: aktive Periode, VWCE.DE, 31.12. des Zieljahrs, bisherige Plausibilitätsprüfung und Ganz-Euro-Rundung. Kursrotation, ATH, Inflation, CAPE, Alter, Readback, Rollover, Verlauf und finaler Flush behalten ihren Vertrag. Der Speicherweg bereitet Inflation, fünf Bedarfswerte, Kurskette, ATH und CAPE isoliert vor. Genau ein fachlicher transaktionaler Write bestätigt gemeinsamen Plan, Balance-/Profilstates, Ausgabenjahr, tatsächliches Tagesgeld, Verlauf, Summary und Jahresbeleg; Snapshot und technische Recovery-Phasen werden gesondert bestätigt. Das Ergebnis heißt erst nach endgültiger Speicherbestätigung bestätigt. Während Commit, Finalisierung und Restore ist der Dialog unschließbar; Fokusfalle, Rückfokus und vorhandener Navigations-/Fensterschutz bleiben aktiv.

Bei ETF-Ausfall bleibt der Abschluss unvollständig und sein Recovery-Snapshot erreichbar. „Mit diesem Kurs erneut abschließen“ validiert den Handkurs vor Restore, fragt die bestehende Restorebestätigung ab und führt Restore → Flush → geschützten Reload → einmaligen Abschluss derselben Periode mit dem bereits eingegebenen Kurs aus. Weder erneute Kurseingabe noch Jahresbestätigung sind nötig. Nur der bestehende `StorageManager.restoreSnapshot(..., { reload })`-Callback legt nach bestätigtem Restoreflush `balance.annual-retry.once` in tabgebundenem `sessionStorage` ab. Der Auftrag enthält Kurs, den bestätigten `adoptedPlanPatch`, die bestätigten Jahresend-Cashwerte einschließlich Rohquellen sowie Profil-/Perioden-/Instrument-/Snapshotbindung, Token und Zeit; höchstens fünf Minuten gültig. Beide Seiten geben den bestätigten Beschluss ohne erneute Eingabe an den Koordinator weiter; der Restore ersetzt ihn nicht durch den alten Plan oder Cashstand. `init()` konsumiert und entfernt ihn synchron vor dem ersten `await`. Nach Persistenzinitialisierung, Engine-Handshake, restaurierten Inputs, Profil-/Tranchen-/Haushaltssynchronisierung, Binding und Vorschau werden Kontext, ursprünglicher Snapshot und offene Nicht-Legacy-Periode geprüft. Pending-Recovery, Profil-/Periodenabweichung, verbrauchter Auftrag oder Initialisierungsfehler erlauben keinen automatischen Write. Abbruch, Restore-/Flushfehler und ausgebliebener Reload verwerfen den Auftrag. Ein normaler Snapshotrestore startet keinen Abschluss. Der technische Auftrag gehört weder zu Finanz-/Profilkeys noch zu Export, Backup oder Snapshot.

Der erhaltene Cashhinweis liegt in `#balanceNextSteps` im Überblick. Der unveränderte `getReconciliationCashStatus()` liest denselben aktiven Profilkontext: nur `valid` mit `pendingCount > 0` liefert den nummerierten Schritt „N Realverkauf/Realverkäufe mit offener manueller Cashbuchung“ und den bestehenden geschützten Managerweg. Ein unlesbares Audit warnt; bestätigte, Legacy- oder fehlende Statusdaten erzeugen keinen Cashschritt. Erneutes Rendern ersetzt die Schritte. Die bisherige Tranchen-Input-Synchronisierung und ihr Storage-Listener bleiben ohne Badgehost und Badgetimer erhalten; die Anzeige schreibt weder Cash noch Bestände.

* **Kurzmeldungen und Aktionsfehler:** Kurzmeldungen bleiben sechs Sekunden sichtbar; eine neue Kurzmeldung ersetzt die vorherige und beginnt eine eigene Frist, auch bei identischem Text. Erfolg (✓), neutraler Hinweis (i) und Fehler (!) unterscheiden sich durch Symbol, Form und zugängliche Typkennzeichnung. Fortschritt, lokale CAPE-Warnungen und Vorgänge ohne neue Änderung erscheinen als Hinweis. Fehler aus Import, Export, Jahresprozess, Snapshotaktionen und Ausgaben-Recovery bleiben je Bereich bis zum nächsten tatsächlich begonnenen passenden Vorgang oder bis „Schließen“ sichtbar. Die kompakte Fehlerliste scrollt bei langen Texten. Eingabeänderungen, Berechnungen, Tabwechsel und Erfolgsmeldungen anderer Bereiche entfernen diese Fehler nicht. Eine leere Dateiauswahl, abgebrochene Bestätigung oder abgewiesener Doppelklick setzt sie nicht zurück. Beim Snapshotordner bleibt ein vorhandener Fehler während der Auswahl und bei Dialogabbruch erhalten; erst bestätigte Berechtigung und gespeicherte Verbindung bereinigen ihn. „Schließen“ heißt zugänglich „Fehlermeldung schließen“ und übergibt den Fokus an den nächsten Schließenknopf, am Listenende an einen verbleibenden Nachbarn, beim letzten Fehler an den Diagnoseknopf. Automatische Bereinigung verschiebt keinen Fokus. Schließen repariert keine Daten; Recovery-Hinweise bleiben fachlich maßgeblich. Berechnungs- und Eingabevalidierungsfehler mit Feldmarkierungen behalten ihren bisherigen Lebenszyklus. Meldungen werden nicht gespeichert; nach Reload sind sie weg, erforderliche Recovery bleibt offen.
* **Ansichten:** Überblick, Bedarf & Strategie und Diagnose sind drei getrennte Reiter. Start und Reload öffnen Überblick. Der vollständige Vermögensverlauf liegt in Personen & Vermögen, Jahresausgaben auf `Ausgaben.html`.
* **Abschlussstände:** Jahresabschluss und bestätigter Ausgabenimport schreiben weiterhin denselben profilbezogenen Historienvertrag. Der Import bleibt auch bei abgelehnter Nacherfassung gültig. Alte Balance-Verlaufsanker führen geschützt zur Managerkarte mit erhaltenem Profilkontext.
* Speichert Eingaben ueber die zentrale Persistenz-Facade; im Browser ist IndexedDB die lokale Source of Truth, Tauri nutzt `ruhestand_suite_data.json` im App-Datenverzeichnis. Ein optional verbundenes Browser-Snapshot-Verzeichnis wird in einer eigenen Handle-Datenbank gespeichert; bestehende Handles aus der frueheren `snapshotDB` werden einmalig uebernommen, ohne die Snapshot-Archivmigration zu blockieren.
* Komplett-Backup und Komplett-Import liegen zentral auf `Daten-Sicherung.html`; Jahresabschluss-Snapshots bleiben als fachlicher Sicherungspunkt in einem separaten internen Snapshot-Archiv erhalten.
* Ausgaben werden weiterhin je Monat und Profil aus CSV importiert. Gespeicherte historische Markt-CSV-Provenienz und ihre Parser-/Exportverträge bleiben kompatibel; die Balance-Bedienung zum Markt-CSV-Import entfällt.
* **Typisierter Balance-Import:** Das aktuelle JSON-Format validiert alle
  importierbaren Eingabefelder gegen den V2-Typ-/Bounds-/Enum-Vertrag.
  Booleanfelder akzeptieren nur echte Booleans; Balance-Dateien V1 und die
  expliziten v21.1-/v22.0-Legacy-Envelopes besitzen benannte Migratoren.
  Erreichbare Livewerte ausserhalb des strikten Importvertrags verhindern den
  Recovery-Export nicht, sondern werden darin feldgenau als
  `validationWarnings` markiert. Preview, Recovery-Snapshot, Replace und
  bestaetigender Persistenzlauf bilden weiterhin eine fehlersichere Kette.
  Nach fehlgeschlagenem JSON-Import werden die Eingaben wiederhergestellt. Vor dem Aktionsfehler wartet die
  App eine neue Vorschau ab: KPIs und Handlungsschritte beziehen sich wieder
  auf diese Eingaben; die Vorschau schreibt keine Daten und erzeugt keinen
  Ersatz-Commit. Berechnungsfehler aus verworfenen Importdaten werden bereinigt,
  echte Fehler des wiederhergestellten Standes können weiterhin erscheinen.
  Bei `rollback_failed` bleibt der Recovery-Snapshot maßgeblich; die Vorschau
  bestätigt keine Reparatur des Speichers.
* **Fail-safe Jahresprozess mit Online-Datenabruf:** Jahres-Update und Jahresabschluss starten denselben periodengebundenen Ablauf. Nach lokaler Vorprüfung und erfolgreichem Flush entsteht zuerst ein verifizierter Recovery-Snapshot; erst danach werden Alter, Inflationsdaten (ECB, World Bank, OECD), ETF-Kurse (VWCE.DE via Yahoo Finance über lokalen Proxy), CAPE, Bedarf und Ausgabenjahr fortgeschrieben. Das Alter zum 01.01. des Folgeplanungsjahrs wird aus der Person projiziert und im Jahresbeleg festgehalten; Geburtsdatum und festes Altalter bleiben unveränderte Personenquellen. Der ETF-Wert für `endeVJ` stammt beim Online-Abruf aus dem letzten verfügbaren Handelstag vom 27. bis 31. Dezember der laufenden Abschlussperiode; Kurs, ISO-Stichtag, Ticker, Quelle und Zieljahr werden gemeinsam gespeichert.
* **Auto-CAPE im Jahreswechsel:** US-Shiller-CAPE wird im Jahresprozess automatisch geladen (Fallback: Yale → Mirror → letzter gespeicherter Wert). Ein nicht auflösbarer CAPE-/Datenfehler lässt den Recovery-Snapshot und einen sichtbaren unvollständigen Periodenstatus bestehen, statt den Abschluss als erfolgreich zu markieren.
* **Ausgaben-Check (monatlich):** CSV-Import pro Monat und Profil, Budgetkontrolle je Monat, Detailansicht mit Top-3-Kategorien, Jahreshochrechnung (ab 2 Datenmonaten mit Median), Soll/Ist auf Basis importierter Monate sowie Jahres-Historie per Jahr-Auswahl. Korrupte Ausgabendaten werden nicht als leer interpretiert: Der Bereich bleibt schreibgesperrt und bietet Recovery-Export, bestaetigten Reset oder Abbruch an.
* **Idempotenter Jahresabschluss + Ausgaben-Historie:** Eine stabile Perioden-ID verhindert Doppelklick- und Wiederholungs-Commits. Die Abschlussperiode stammt aus dem gemeinsamen Koordinator, unabhängig vom Ausgaben-Ansichtsjahr. Das gespeicherte aktive Ausgabenjahr wechselt nach erfolgreicher Post-Write-Validierung auf das Folgejahr; Vorjahre bleiben vollständig einsehbar.
* **Jahresbeleg:** `annual_plan_record_v1` verknüpft Planungsjahr `targetYear + 1` mit dem Abschluss `calendar-year:targetYear`. Empfehlung und beschlossener Plan enthalten Ergebniswerte sowie Plan-, Inflations- und Altersmomentaufnahme; ohne bewusste Änderung sind beide bytegleich. H1-Belege mit gleichjähriger Periodenkennung bleiben lesbar. Der interne Abschlussanschluss unterstützt validierte Planänderungen mit regulärer Neuberechnung, keine direkten Monatsbetrags-Overrides. Die Bedienung dafür und ein Startseiten-Abschluss folgen in H4. Vorschau und unterjährige Planänderung erzeugen keinen Jahresbeleg. Der Vorabschluss-Snapshot nimmt Plan, Beleg, Marker, Profile und Verlauf gemeinsam zurück.
  Alle Jahreszugänge (Kopf, Bedarf & Strategie, Überblick) teilen denselben
  Coordinator und dessen Doppelklickschutz. Separate Inflations-, ETF- oder
  CAPE-Abrufknöpfe gibt es in Balance nicht; direkte Aufrufe und ihre zusätzlichen
  Sperren sind interne Absicherungen. Die Abschlussmeldung bleibt mindestens
  drei Sekunden sichtbar.
* **Mindest-Flex p.a.:** Optionale, bedingte Untergrenze fuer Flex-Ausgaben in kuerzenden Safety-/Guardrail-Phasen; sie ersetzt nicht den Floor und wird in Diagnose sowie Kopiertext transparent ausgewiesen.
* Nutzt die Engine v31 zur Marktanalyse, Entnahmeplanung und Liquiditätssteuerung.
* **Kanonischer Liquiditaets-Runway:** `liquidityRunwayYears` (Default 5 Jahre, zulaessig 1 bis 10 in 0,5er-Schritten) steuert das Netto-Runway-Ziel. Seine Bedarfsbasis ist ausschliesslich die vom SpendingPlanner nach Alarm, Guardrails, Mindest-Flex, Flex-Budget, finaler Glaettung und Monatsquantisierung freigegebene nominale Netto-Portfoliojahresentnahme. Die zugrunde liegenden Jahres-/Monatswerte und genauen Kopier-/Exportprojektionen müssen centgenau zusammenpassen; reguläre sichtbare Balancebeträge bleiben ganze Euro; fehlende, ungueltige oder widerspruechliche Planner-Werte stoppen den Produktivpfad. Der ungekürzte Bedarf bleibt davon getrennt: Vor der Entscheidung speist er den SpendingPlanner, nach der Transaktion bleibt er der kalibrierte Nenner der Dynamic-Flex-Safety, damit eine Ausgabenkürzung nicht ihr eigenes Entspannungssignal erzeugt. `dynamicFlexSafetyRunwayBasis` beziehungsweise das bestehende `safety_runway_post_months` machen diese Safety-Basis sichtbar; Transaktionsziel und operative Runway-KPIs verwenden sie nicht. Davon getrennt begrenzt `minCashBufferMonths` (0 bis 12, Default 2) das Ziel nach unten: Der Brutto-Notfallpuffer verwendet Floor plus Flex vor Rentenverrechnung, ist kein zweiter Runway und kein separater Vermögenstopf. Das auf volle 100 EUR aufgerundete Ziel ist das Maximum aus Netto-Runway-Ziel und Brutto-Notfallpuffer. Zielhoehe und Zielerfuellung werden nicht geglaettet. Die generische Runway-Deckung, die Runway-Monate sowie historische und Monte-Carlo-Jahreslogs messen den Bestand nach Jahrestransaktionen und vor der Jahresauszahlung; der Sweep aggregiert dieselbe Phase in echten Monaten. `RunwayMeasurementPhase = after_transaction_before_payout` kennzeichnet diesen Vertrag. `RunwayCoveragePostPayoutEndOfYearPct`, `runway_post_payout_end_of_year_months` und `liq_post_payout_end_of_year` bewahren den Jahresendstand nach Auszahlung als ausdrueckliche Diagnose; `liqEnd` behaelt seine bisherige Semantik. Terminale Ruin-/Todeszeilen ohne Jahresentscheidung liefern keine erfundene Null-Prozent-Deckung. `hardMinimumMonths = min(targetMonths, 24)` ist eine abgeleitete Schwelle, nicht der Brutto-Notfallpuffer und keine zweite Nutzereingabe.
* Jahresübergreifende Verlustverrechnung (Verlusttopf) ist integriert; die finale Steuer stammt aus dem Jahres-Settlement.
* **Strikte Action-Grenzen:** `types/planned-action-contract.js` prueft Quellen, Verwendungen, Brutto/Steuer/Netto, Lot-Kapazitaet und die aus Cost Basis, TQF und Steuerfreiheit ableitbaren Rohsteuerwerte vor jeder Ausfuehrung. Der Simulator validiert einen injizierten Engine-Plan vor und nach einer 3-Bucket-Ersetzung und gleicht die rohe Jahressteuer zusaetzlich gegen `settleTaxYear()` sowie den Folgezustand ab. Nach Forced Sales, Bond-Refill oder Cashzins bleibt der vor Ausfuehrung gepruefte Plan als `plannedActionFlow` erhalten; `SimulatorExecutedTaxContractV1` reconciliert dessen Steuerreserve explizit mit finaler Verkaufssteuer, Zinssteuer, Jahressteuer und Cash-Anpassung.
* Diagnoseansicht mit Guardrails, Entscheidungsbaum und Key-Performance-Parametern.
* **Profil-Assets-Manager:** Detaillierte Tranchen werden profilgebunden, schema-validiert und fuer steueroptimierte Verkaeufe genutzt. Empfehlungen bleiben schreibfrei; reale Brokerverkaeufe werden nur ueber Vorschau plus explizit bestaetigten, idempotenten Reconcile fortgeschrieben. Neue Verkaufsrecords bleiben standardmaessig `pending_manual_posting`, bis der Nutzer den Nettoerloes selbst in der freien Liquiditaet nachgefuehrt und den resultierenden Cashstand append-only bestaetigt hat. Bereits beruecksichtigte Erloese koennen beim Verkaufscommit explizit bestaetigt werden; Tippfehler im Cashstand werden als lineare `cash_posting_corrected`-Folgeereignisse berichtigt. Ein parallel veralteter Korrekturdialog scheitert vor der Bestaetigung, Legacy-Verkaeufe bleiben sichtbar „Cashstatus nicht dokumentiert“, und ein unlesbarer Audit wird nie als leere Historie dargestellt. Verkauf, Abschluss und Korrekturen werden nie in-place mutiert, und es erfolgt keine automatische Erlösaddition. Der gesonderte Cashnachtrag übernimmt den bestätigten absoluten Tagesgeldstand gemeinsam mit Cashhistorie und Audit. Der Dialog zeigt den historischen Auditbetrag getrennt vom aktuellen Tagesgeldstand und belegt ausschließlich den aktuellen Betrag vor. Öffnen und Abbruch schreiben nichts; erst „Aktuellen Tagesgeld-Stand übernehmen und Korrektur bestätigen“ übernimmt eine bewusste Änderung. Bei unverändertem Betrag wird nur der Nachweis ergänzt; Status- und Persistenzmeldung nennen ausschließlich den Auditnachweis. Nur eine tatsächliche Änderung meldet die Übernahme des neuen Tagesgeldstands. Änderungen an Tagesgeld oder Cashhistorie seit Öffnung verlangen einen neu geöffneten Dialog. Unbekannte oder beschädigte aktuelle Quellen erhalten keine historische Ersatzvorbelegung. Beschädigte oder widersprüchliche Tagesgeldquellen werden bereits im Dialog fachlich abgelehnt: Submit bleibt gesperrt, Abbrechen und die anschließende Profilbedienung bleiben möglich. Es gibt dafür keinen technischen Retry und keine automatische Reparatur; nach Prüfung der Quelle wird der Dialog neu geöffnet. Technische Speicherfehler behalten dagegen den ursprünglichen Auftrag für einen sicheren Retry. Die entsprechenden Browser-Smokes sind extern auszuführen.
  Erfolgreiche Kursabrufe erhalten den gelieferten Kurszeitpunkt zusammen mit dem Preis, auch bei gleichem Preis. Alte und manuell angelegte Bestände bleiben ohne Zeitnachweis; manuelle Kurs-/Instrumentänderungen entfernen ihn, reine Notiz-/Anteils-/Steueränderungen bewahren ihn. Profilbundle und Komplettbackup erhalten vorhandene Kurszeitpunkte.
* **Profil-Verwaltung:** Optionales Namensfeld zur Unterscheidung von Snapshots (z. B. "Max" vs. "Partnerin") für effektive Mehr-Personen-Planung.
* **Pflegebucket-Diagnose:** Liest die in der Profilpflege definierte gesperrte Geldmarkt-/Cash-Reserve und zeigt Brutto-Liquidität, Pflege-Zweckbindung, operative Liquidität und inflationsbezogene Zieldeckung. In der Balance-App ist der Bucket aktuell bewusst `diagnostic_only`; es erfolgt keine automatische operative Freigabe.
* Tastenkürzel: Alt+J für Jahresabschluss, Alt+E für Balance-Export und Alt+I für Balance-Import; Export/Import nur, wenn der jeweilige Button vorhanden ist; alle Kürzel respektieren laufende Aktionssperren.

### Simulator

Der Simulator öffnet den Reiter **Ergebnis**; danach folgen **Annahmen**, **Backtest**, **Monte-Carlo** und **Werkstatt**. Nach Persistenz-, Profil- und Haushalts-/Trancheninitialisierung rechnet er einmal historisch ab 2000 bis zum kleineren Wert aus Vorjahr und letztem verfügbaren Datenjahr. Recovery, ungültige Eingaben und fehlende Engine/Daten verhindern den Start. Eine fehlende Vorjahresabdeckung wird genannt; der Öffnungslauf führt keine Rolling Cohorts aus. Monte-Carlo startet nur auf Anforderung. Alle fünf Hauptreiter markieren die Auswahl durch kräftige Schrift und einen Unterstrich; der Fokus bleibt separat erkennbar.

Die Ergebnisübersicht liest vorhandene Backtest-/MC-Resultate. Das Backtest-Endvermögen enthält die Pflegereserve, Chart und Krisenstände schließen sie aus. Der Chart verwendet Kalenderjahre und endet bei Ruin. Das MC-Punktraster rundet allein die Visualisierung; exakte Fallzahlen, kanonischer Nenner, Wilsonintervall und P10/Median/P90 bleiben erhalten. „Gerechnet mit“ hält separate dokumentlokale Laufköpfe. Geänderte wirksame Annahmen markieren MC veraltet und lösen beim nächsten Anzeigen/Aktualisieren von Ergebnis je Revision einen Backtest ohne Cohorts aus. Lauf, Fehler und Abbruch erhalten den letzten erfolgreichen MC-Inhalt.

Bei einer wirksamen Haushaltsauswahländerung ersetzt `simulator-result-overview.js` die Kontextrevision und ruft synchron `invalidateBacktestForHousehold()` im Backtestadapter auf. Dieser verwirft `window.globalBacktestData`, Summary, Jahreslog, Portfoliochart, Protokollpersonenbeleg, Cohorts, Hinweise und den bisherigen Perioden-/Erfolgsstatus; JSON und CSV sind sofort gesperrt. Detailwechsel und erneute UI-Initialisierung können den Altbestand nicht wiederherstellen. Ein ausstehender, wegen Personendaten/Recovery gesperrter oder technisch fehlgeschlagener Ersatz bleibt ohne aktuelle Backtestquelle; gemeldete Vorbereitungs-, Sperr- und Fehlerphasen werden auch im Backtest-Reiter angezeigt. In der Übersicht darf der bisherige Lauf weiter sichtbar bleiben, aber Urteil, Beträge, Chart, Krisen und Personenlaufkopf sind ausdrücklich als veraltet gekennzeichnet. Haushaltsrevision und Laufgeneration weisen überholte Vorbereitung und verspätete Summary-Ablage ab. Mehrere Auswahlwechsel während einer offenen Vorbereitung führen zu einem Ersatz für die neueste Auswahl, auch nach Rückkehr zu denselben Zahlen; unwirksame Wiederholungen erhalten das aktuelle Resultat. Erst ein erfolgreicher Ersatz veröffentlicht eine gemeinsame immutable Quelle für Summary, Tabelle, Chart und Exporte mit den aktuellen Profil-IDs. Die neuen Veraltetkennzeichnungen gelten ausschließlich bei einer Abweichung von `metadata.householdContextRevision` zur aktuellen `contextRevision`. Gewöhnliche Annahmenänderungen erhalten das bisherige Erfolgs-/Ruinurteil und den Hinweis „Annahmen seitdem geändert“; eine Rückänderung entfernt diesen Hinweis nach dem bisherigen Wertevergleich. Rechen- und Exportschemata ändern sich nicht.

Stresspfad-Replay, Sweep und Auto-Optimize liegen in getrennten Werkstattflächen. Monte-Carlo besitzt genau vier Ergebnisansichten: Überblick, Risiko und Verteilung, Pflege, Szenario-Logs. „In Replay anzeigen“ öffnet die vorhandene Werkstatt mit derselben Auswahl; der Rückweg öffnet die Szenario-Logs. Backtest zeigt Zeitraum/Downloads, Einordnung, Kennzahlen, Jahresprotokoll und danach Rolling Cohorts. Die Werkstatt startet mit drei Karten: Stresspfad-Replay, Parameter-Sweep, Auto-Optimize. Die drei Auswahlkarten bleiben sichtbar. Die aktive Karte ist messing getönt und bietet „Schließen“; Öffnen oder Wechseln zeigt genau eine vorhandene Arbeitsfläche unter den Karten. Schließen gibt den Fokus an den Kartenknopf zurück und erhält Eingaben, Ergebnisse und laufende Controller. Übernommene Werte landen in den Annahmen und machen bisherige Ergebnisse veraltet. Sweep bietet sieben editierbare Bereiche, Optimize sieben Presets und einen sichtbaren Abbruchknopf. Übernahme verwendet die bestehenden Annahmenfelder; externe Browser-/Referenzbildabnahme bleibt erforderlich.
* Monte-Carlo-Simulationen mit unterschiedlichen Renditequellen (historisch, Regime, Block-Bootstrap, Stationary Bootstrap) inkl. Worker-Parallelisierung. Ein aktiver Worker-Lauf kann ueber **Monte-Carlo-Lauf abbrechen** beendet werden; der Abbruch startet keinen seriellen Ersatzlauf, und ein neuer Pool wird erst beim naechsten ausdruecklichen Start aufgebaut. Historische Daten reichen bis 1925 (Schwarze-Schwan-Phase optional per Filter/Recency abgewichtbar); ein optionales Fat-Tail-/Crash-Overlay kann als expliziter Stresstest zugeschaltet werden.
* **Monte-Carlo-Ressourcenvertrag:** Der Standard sind 10.000 Runs. Bis 100.000 Runs ist keine Grosslastbestaetigung erforderlich; 100.001 bis 1.000.000 Runs zeigen Run-Jahre und eine Speicherklasse und muessen vor jedem Start ausdruecklich bestaetigt werden. Runzahl, Dauer, Blocklaenge, Seed, Samplingmodus, Workerzahl (0=auto, maximal 32) und Jobbudget (50-5.000 ms) werden in UI, direktem Runner, Worker und Auto-Optimize durch denselben strikten Vertrag validiert; Dezimalzahlen, Suffixe und stille Begrenzungen werden abgewiesen. Fortschritt, Abbruch, Fehler und Abschluss besitzen sichtbare sowie assistenztechnisch lesbare Zustaende.
* **Monte-Carlo-Ergebnis-Cockpit:** Einstellungen, tatsächlicher Stress-/Tail-Risk-Zustand, Laufstatus, Fortschritt, Abbruch und Fehler stehen gemeinsam in einer Karte. „Einstellungen anzeigen“ klappt die Felder auf; die Startknöpfe in Ergebnis und Einstellungen nutzen denselben kanonischen Lauf mit gemeinsamem Fortschritt, Laufzähler und Abbruch; Strategieparameter liegen in Annahmen, Schritt 3 „Strategie“. „Ergebnis exportieren (JSON)“ erscheint erst für ein erfolgreich veröffentlichtes Ergebnis. Darunter stehen die Ergebnisansichten „Ueberblick“, „Risiko und Verteilung“, „Pflege“ und „Szenario-Logs“ sowie das „Stresspfad-Replay“ in der Werkstatt. Nach einem erfolgreichen Lauf klappt das Setup ein und der Ueberblick wird aktiviert. Tastaturbedienbare Untertabs und sichtbare Fokusreaktivierung halten alle Ergebnis- und Vergleichssektionen erreichbar. Der Druck öffnet MC-Setup, alle vier Ergebnisse und alle drei Replayvergleiche auch bei inaktiver Werkstatt und verborgenem Replaywerkzeug; Sweep und Auto-Optimize werden einschließlich vorhandener Ausgaben auch mit `hidden` und bei inaktivem Werkstatt-Reiter gedruckt; Werkzeugkarten und Aktionsknöpfe entfallen. Werkzeugwahl und Fokus bleiben erhalten. Im Replay steht vor den Detailtabellen je Variante hoechstens eine priorisierte materielle Abweichung (Mindest-Flex-Luecke, Ruinjahr, reales oder nominales Endvermoegen). Sie ist eine Lesehilfe fuer genau den fixierten Pfad, keine Rangfolge, Strategieempfehlung oder neue Kennzahl.
* Monte-Carlo-Runner ist DOM-frei modularisiert; Chunk-Kontext, Startjahr-/CAPE-Sampling, Life-State-Initialisierung, Stress-Metriken, Logzeilen-Builder und Run-Metriken liegen in eigenen Simulator-Modulen.
* **Versionierter Samplingvertrag:** `MonteCarloSamplingContractV1` verankert das gewaehlte Startjahr als erstes tatsaechliches Marktjahr. Fixed- und Stationary-Block starten dort zusammenhaengend, Markov initialisiert dort sein Regime und IID zieht erst ab Jahr 2 unabhaengig. CAPE hat vor Filter/Recency Vorrang; die Oberflaeche weist den Konflikt sichtbar aus. Chunk- und Workerresultate enthalten kompakte, merge-invariante Ziehungsdiagnostik mit Datenfingerprints.
* **Schaetzerunsicherheit und reale Depotentnahme:** Die Floor-Deckungsquote zeigt neben Zaehler und Runzahl ein Wilson-95-Prozent-Intervall sowie bei weniger als 1.000 Runs eine Unsicherheitswarnung. `Reale Depotentnahme P10` ist laufbasiert: Jeder auswertbare Run liefert genau einen P10-Wert; nach Ruin werden weitere Dekumulationsverpflichtungen bis Tod oder Horizont mit 0 Euro aufgefuellt. Technische Fehler und Tod vor der ersten Verpflichtung bleiben als Missingness sichtbar. Quantile zeigen Stichprobengroesse und Missingness, beanspruchen aber kein Konfidenzintervall.
* **Wahrheitsgetreue Risikoanzeigen:** P10/P50/P90-Endvermoegen, reale Depotentnahme P10, Median der Run-P10-Entnahmen, kumulierte Steuern und Verlustvortragsersparnis erscheinen auf den Ergebniskarten centgenau ohne Grobstufenrundung. Bei weiteren Dezimalstellen wird die Anzeige richtungstreu quantisiert: Nutzen abwaerts, Kosten und positive Verlustbetraege aufwaerts. Nominaler und kaufkraftbereinigter Maximum-Drawdown werden getrennt, paarweise und mit Preisbasis dargestellt; Werte ausserhalb 0 bis 100 Prozent, fehlende oder nicht anwendbare Aggregate erscheinen fail-closed als Gedankenstrich mit Grund und gemessener Beobachtungszahl. Fehlt die Zahl im Aggregat, steht `unbekannt` statt einer erfundenen Null; bei mehreren Missingness-Ursachen wird der zaehlerisch dominante Grund genannt. Die 4,5-Prozent-Auswertung bezeichnet in Ergebnissen und Auto-Optimize die realisierte Entnahmequote strikt groesser 4,5 Prozent, in der klassenbasierten Heatmap dagegen groesser/gleich 4,5 Prozent. Sie ist eine Berichtsreferenz, keine Alarm- oder Guardrail-Schwelle. Im Überblick steht der Hinweis als Zeile in „Weitere Kennzahlen“.
* **Reproduzierbarer Monte-Carlo-Export:** Nach jedem fachlich oder technisch abgeschlossenen Lauf wird der Button „Ergebnis exportieren (JSON)“ freigeschaltet. Der aktuelle Writer erzeugt `MonteCarloExportV2` mit expliziten Heatmap-Intervallen, Ratio-/Prozentpunkteinheiten, Beobachtungszahlen sowie nominalem und realem Maximum-Drawdown. Historische `MonteCarloExportV1` bleiben ueber den Versionsdispatcher mit sichtbarer Kompatibilitaetswarnung lesbar; unbekannte Versionen werden fail-closed abgewiesen. Der Export enthaelt den normalisierten `MonteCarloRunRequestV1`, das projizierte `MonteCarloRunResultV2`, Seed-, Sampling-, Stress-, Worker-/Chunk-, App-, Engine-, Snapshot- und Datenprovenienz sowie Missingness und Warnungen. Historische Stresspresets exportieren dabei Evidenzart, Claim-Grenze und den gepinnten Rohpool. Request-/Run-ID und SHA-256-Fingerprints sind vom Exportzeitpunkt unabhaengig. Der Download erfolgt nur auf ausdrueckliche Nutzeraktion; lokale Pfade, Secret-Felder und nicht endliche Zahlen werden fail-closed abgewiesen. Der Export enthaelt die Finanzannahmen des aktuellen Szenarios und sollte vertraulich behandelt werden.
* **Stress-Pfad-Replay:** Ein ausgewaehltes Monte-Carlo-Szenario kann als vollstaendiger exogener Pfad fixiert und mit der unveraenderten Baseline sowie bis zu drei erlaubten Strategievarianten erneut gerechnet werden. Im fokussierten Editor sind Variantenname, Floor-Bedarf, Flex-Bedarf und Mindest-Flex sichtbar; die bisherigen 17 Strategieparameter liegen unter „Expertenfelder“. Leere Bedarfsfelder uebernehmen die eingefrorene Baseline, `0` ist ein ausdruecklicher Patchwert. Mindest-Flex oberhalb des effektiven Flex-Bedarfs wird erklaert abgewiesen und nie still begrenzt. Der Vergleich gilt ausschliesslich fuer diesen einen Pfad und ist weder allgemeines Ranking noch Finanzempfehlung. Assetallokation, reale Profile und Tranchen bleiben ausgeschlossen. Neue Varianten verwenden `StressReplayVariantWhitelistV2`; importierte V1-Varianten behalten ihre Regeln und Fingerprints. Neue Arbeitsstaende binden die toleranzfaehige `StressReplaySourceIdentityV2`; Arbeitsstaende mit der alten hashbasierten V1-Herkunftsidentitaet bleiben unveraendert inspizierbar, sind aber bis zum erneuten Fixieren des Stresspfads nur lesbar. Nach Ruin setzt der fixierte Pfad den kanonischen Marktstatus fort; `ruin` und `all_dead` besitzen symmetrische Terminalzeilen, wobei das Todesjahr finanziell nicht ausgewertet wird. Pfad, Herkunftsidentitaet, Baseline und Varianten werden lokal als ein aktiver Arbeitsstand transaktional gespeichert; versionierter JSON-Export/-Import erhaelt Identitaet und Groessenlimits. Die V2-Herkunftsidentitaet enthaelt fuer den gebundenen Quellpraefix die tatsaechlichen Reconciliation-Werte je Zeile statt nur Hashes, darunter Vermoegen, Renten, Flex-Erfuellung und Jahresentnahme. Vollstaendige Source-Scenario-Logs, lokale Dateipfade, Zugangsdaten und sonstige Speicherrecords bleiben ausgeschlossen; trotzdem enthaelt der Export Finanzdaten und sollte vertraulich behandelt werden. Mutations- und Vergleichserfolg werden getrennt gemeldet: Schlaegt eine Berechnung fehl, bleiben Fehlercode und Meldung sichtbar, auch wenn die Variante bereits gespeichert oder entfernt wurde. Waehrend asynchroner Aktionen sperrt ein gemeinsamer Busy-Zustand alle konkurrierenden Replay-Aktionen.
* **V1-Abschlussvertrag:** V1-Writer und -Reader verwenden nur noch die kanonischen KPI-Felder; die befristeten Legacy-Read-Aliase sind entfernt. Die unveraenderliche Referenz `pre-hardening-v1`, die semantischen Post-Slice-Snapshots und der extern noch nicht freigegebene Kandidat `monte-carlo-v1-final` bleiben getrennt. Unerklaerte Deltas blockieren; der Kandidat ist ein technischer Regressionsnachweis, keine empirische Modellfreigabe.
* **Experimenteller Parameter-Sweep mit Auto-Optimize:** Der interaktive Sweep bietet sieben Dimensionen mit geprueftem kanonischem Datenpfad; die VPW-Felder zaehlen nur bei wirksamer Strategie: Liquiditaets-Runway, Gold-Rebalancing-Band, maximale Skim-Quote, maximale Bear-Refill-Quote, Goldziel, Survival-Quantil und Go-Go-Multiplikator. Das Survival-Quantil zaehlt nur bei aktivem Dynamic Flex mit Horizontmethode `survival_quantile`, der Go-Go-Multiplikator nur bei aktivem Dynamic Flex und Go-Go. Inaktive VPW-Ranges bleiben gespeichert, werden aber weder gezaehlt noch an den Sweep-Runner uebergeben. Der Grid-Zaehler zeigt die Zahl der tatsaechlich gestarteten Kombinationen bis zum Limit von 300. Auto-Optimize verwendet davon sechs Dimensionen; die maximale Bear-Refill-Quote bleibt eine reine Sweep-Dimension. `targetEq`, `runwayTargetMonths`, `runwayMinMonths` und `rebalBand` sind keine aktuellen Suchparameter. Nur der direkte Horizont bleibt ein explizites programmatisches Requestfeld, weil die Browseroberflaeche den Horizont aktuarisch bestimmt. Die Traceability-Matrix belegt Zuordnung, Consumer und Provenienz der sichtbaren Parameter; sie ist kein eigenstaendiger Nachweis ihrer KPI-Wirkung oder fachlichen Modellguete. Whitelist, Deep-Clones und Wächterlogik schützen Zwei-Personen-Setups. Worker-Parallelisierung, mehrphasige Kandidatensuche mit LHS, Quick-Filter, voller Evaluation, Refinement und Bestaetigungsseeds, dynamische Parameter-UI (1-6 Parameter) und Champion-Config-Output bleiben erhalten. Sweep-Rankings sind experimentelle Punktschaetzer; der Auto-Optimize-Champion ist ein modellinterner Szenariokandidat, kein globales Optimum und keine Finanzempfehlung. Die Ergebnisanzeige nennt Modellversion, Hashes des gesamten Datenuniversums, die effektive Filterauswahl und getrennte technische/interne/externe Validierungsstatuswerte. Details siehe `docs/reference/AUTO_OPTIMIZE_DETAILS.md`.
  Der Sweep verwendet standardmaessig 500 Simulationen je Kombination; seine eigene Laufzahl ist unabhaengig vom Monte-Carlo-Laufzahlfeld und bleibt nach einem Neuladen erhalten. Ein leerer oder ungueltiger gespeicherter beziehungsweise eingegebener Wert wird nicht still auf 500 zurueckgesetzt: Ein Validierungsfehler verhindert den Start, bis die Laufzahl korrigiert ist. Der Zaehler zeigt Kombinationen × Laeufe × Jahre als nominelle Laufjahre; erst oberhalb von 5.000.000 Laufjahren verlangt der Start eine Bestaetigung. Worker- und serieller Pfad zeigen Zwischenfortschritt bereits innerhalb einer Kombination beziehungsweise eines Worker-Blocks. Vor der vollstaendigen Veroeffentlichung des neuen Ergebnisses zeigt die Anzeige hoechstens 99 %, 100 % erst nach erfolgreichem Abschluss. Mit „Abbrechen“ kann ein laufender Worker- oder serieller Sweep beendet werden. Ein Abbruch oder Fehler bewahrt die letzte vollstaendige Heatmap; ohne vorheriges Ergebnis bleibt der Ergebnisbereich leer. Erst ein vollstaendiger neuer Lauf ersetzt das Ergebnis.
* **Dynamic-Flex (VPW) Profile:** Profilsteuerung (`Aus`, `Defensiv`, `Ausgewogen`, `Offensiv`) mit optionalen erweiterten Parametern für `horizonYears`, `survivalQuantile` und `goGoMultiplier`.
* **CAPE-Return-Policy fuer VPW:** Die kontinuierliche CAPE-to-Return-Policy ist als expliziter Config-Modus `cape_continuous` verfuegbar. Default bleibt `legacy_step`, weil lokale Backtest-Vergleiche sichtbare Entnahme-/Endvermoegens-Deltas zeigen und der Default-Wechsel fachlich freigegeben werden muss. Die erwartete Portfoliorendite wird aus der tatsaechlichen Aktien-, Gold- und Liquiditaetszusammensetzung gewichtet, nicht aus einer festen Aktienzielquote.
* **Mindest-Flex p.a.:** Wird in Backtest, Monte Carlo, Sweep und Profilverbund bis in die Engine durchgereicht. Nach Planbestätigung gilt der gemeinsame Mindest-Flex genau einmal; nur vor Umstellung werden Profilwerte addiert. Werte oberhalb des wirksamen Flexbedarfs sowie nicht-finite Werte werden fail-closed abgelehnt. Das Haushalts-Ist zaehlt den auf Flex entfallenden Rentenueberschuss und den tatsaechlichen Depotflex genau einmal. Scenario-/Backtest-Logs und Raw-Export zeigen Ziel, final wirksamen Haushalts-Flex, Fehlbetrag und den Grund einer nachgelagerten Begrenzung.
* **Safety-Cap und schwere Flex-Notlage:** Ein strukturell wirksamer Alarm, positiver `bear_deep`-Rohcut oder tatsaechlich bindender Guardrail/Hard-Cap setzt ein Safety-Ziel fuer nachgelagerte Komfortanhebungen. Im normalen Pfad wird dieses Ziel nur innerhalb der bestehenden jaehrlichen Flex-Aenderungsgrenzen erreicht; Diagnose und Jahreslog unterscheiden deshalb Policy-Ziel, aktuell wirksame Obergrenze und eine gegebenenfalls aufgeschobene Bindung. Mindest-Flex bleibt dabei die Untergrenze, sofern kein bestehender Alarm-, Solvenz- oder Runway-Blocker greift. Der gesamte Flex einschliesslich Mindest-Flex wird nur dann sofort auf 0 gesetzt, wenn gleichzeitig `bear_deep`, mehr als 25 Prozent realer Drawdown des aktiven Gesamtvermoegens und eine kritische geschuetzte Portfolioentnahmequote vorliegen. Diese Quote ist `(Netto-Floor aus Portfolio + offener Mindest-Flex aus Portfolio) / aktives Gesamtvermoegen`; kritisch ist sie ab der bereits konfigurierten vollen Belastungsschwelle von 3,5 Prozent. Ein lokaler Extrembaer oder hoher Drawdown bei komfortabel tragbarem Mindest-Flex reicht nicht. Dieser Ausnahme-Nullwert wird nicht als Glättungsanker der Erholung gespeichert. Der separat geplante Floor bleibt unveraendert. Diagnose und Jahreslogs trennen Safety-Quelle, Drawdown-, Belastungs- und Alarmwerte, Mindest-Flex-Ueberstimmung und Floor-Schutz.
* **Historische Backtest-Zeitachse:** Der Backtest verwendet validierte Jahresrecords mit realisierten Aktien-, Gold-, Cash-/Bond-, Inflations- und Lohnwerten aus dem Simulationsjahr `t`. CAPE ist Robert J. Shillers konventionelles US-Price-CAPE: Die Dezemberbeobachtung `t-1` wird unter Entscheidungsjahr `t` gespeichert und ohne zweiten Lag verwendet; Entscheidungsjahre 1925-1935 sind wegen der zehnjaehrigen, teilweise interpolierten Vorkriegsbasis als `estimated` abgegrenzt. Die Lohnfortschreibung nutzt ab 1947 den Destatis-Bruttoverdienstindex ohne Sonderzahlungen und davor aus JST-R6-Nominallohnstaenden abgeleitete Veraenderungen als Forschungsproxy; sie bleibt ein Rentenfortschreibungsproxy, keine gesetzliche Rentenanpassungsreihe. Maschinenlesbare Naehte markieren 1925 als Startnormalisierung, 1945 als geschaetzte Kriegs-/Nachkriegsbruecke ohne Marktlohnbeobachtung, 1947 als JST-/Destatis-Quellenwechsel und 1948 als Waehrungsreformkontext; Gebiets-, Praezisions- und Methodenbrueche 1991, 2007 und 2022 bleiben ebenfalls sichtbar. Unvollstaendige Perioden oder Lookback-Fenster werden vor der Rechnung als `incomplete` abgewiesen. Monte Carlo, Sweep und Worker verwenden weiterhin ihre eigenen Recordpfade.
* **Reproduzierbare Cash-/Bond-Proxykette:** `zinssatz_de` stammt aus einer
  gepinnten 1925-2025-Kette. Ab 1949 wird die Bundesbank-PDF im Build direkt
  und koordinatenbasiert gegen einen getrennten Layout-Extrakt geprueft.
  Der gemeinsame Runtimewert `cashBondReturn` ist ein Interbank-Bruttoproxy
  fuer Cash, Geldmarkt und Anleihetranchen, kein erreichbarer
  Endkundenreturn und kein historischer Bondindex. Die nicht modellierte
  Geldvermoegensabschreibung der Waehrungsreform 1948 sowie Laufzeit-,
  Kredit- und Mark-to-Market-Risiken von Anleihen bleiben ausdrueckliche
  Modellgrenzen.
* **Reproduzierbare Goldkette:** `gold_eur_perf` stammt vollstaendig aus
  `gold-german-investor-chain.js`. Die 1925-2025-Kette kombiniert eine
  ausdruecklich als Proxy markierte US-Goldpreis-/deutsche-Jahresend-FX-Historie
  mit gesondertem offiziellem RFC-Jahresendpreis 1933, eine
  sichtbare Schaetzbruecke 1945-1950, das Bundesbank-Frankfurter Goldfixing
  und ab 1999 World-Bank-Goldpreise mit Bundesbank-USD/EUR. Alle zwoelf
  literal verbleibenden Nullwerte sind quell- oder modellseitig erklaert;
  Produktaufschlag, Spread, Verwahrung und Steuer bleiben ausserhalb der
  Bruttorenditereihe. Jahresend-, Teiljahres- und Jahresdurchschnittssegmente
  sind getrennt dokumentiert; die nominale Nullbruecke und fruehen Proxyjahre
  bleiben eine sichtbare Monte-Carlo-Modellgrenze.
* **Dateninventar und Evidenz-Gates:** `SimulationDataInventoryV1` inventarisiert
  die sechs historischen Reihen mit eigenen 1925-2025-Qualitaetssegmenten
  sowie Demografie-, Pflege-, Hinterbliebenen-, Steuer-/Tranchen-,
  Renten-/Sozial-, Stress-/Regime- und Default-/Fallbackklassen. Kanonische
  SHA-256-Wertfingerprints belegen nur technische Reproduzierbarkeit.
  Ungeklaerte Quelle, Reihenkennung, Lizenz oder Abrufstand bleiben
  `unresolved` und blockieren eine Behauptung externer Validierung oder einen
  Datenersatz. Details: `docs/reference/DATA_SOURCES.md`.
* **Demografie-/Pflegevertrag:** Die Sterbewahrscheinlichkeiten fuer
  Alter 18-100 stammen reproduzierbar aus dem Destatis-`Statistischen Bericht
  Sterbetafeln 2023/2025` (EVAS 12621), Tabellen `12613-b01` und `12613-b02`;
  101-110 bleiben ein offengelegter Modellrand und `divers` eine
  Modellableitung. Amtliche Pflegequoten 2023 dienen nur als
  Bestands-/Praevalenzreferenz und werden nicht in individuelle
  Jahresuebergaenge umgerechnet. Pflegeeintritt, Progression und Dauer bleiben
  getrennte Modellannahmen. Die 55-Prozent-Hinterbliebenenoption ist ein
  vereinfachter Nutzer-Cashflow, keine gesetzliche Anspruchsberechnung.
  Build/Verify: `npm run build:german-demography-data` und
  `npm run verify:german-demography-data`.
* **Reproduzierbarer Backtest-Export:** Die Backtest-Buttons erzeugen nur auf ausdrueckliche Nutzeraktion ein `HistoricalBacktestExportV2`-Raw-JSON oder eine technische `HistoricalBacktestCsvV2`-Rohdatenansicht mit 34 festen Spalten und fuehrender `run_id`. JSON enthaelt Request, Outcome, die inklusive Periode (2000-2025 sind 26 Jahre), Daten-/Zeitachsen-/Engine-/Source-Commit-Provenienz, nicht restartfaehige `HistoricalBacktestPortfolioBoundariesV2`, Jahresrecords/-zeilen, Quantisierungs- und Eingabesemantik sowie Metriken als echte Zahlen. Die Portfoliogrenzen nennen aktives Portfolio plus Pflegebucket; der separat angezeigte Pflegebucket ist bereits in Start-/Endvermoegen enthalten und darf nicht addiert werden. Interne Start-/End-Portfolioobjekte gehoeren weder zum kanonischen Resultat noch zum Export. Vor dem Browserlauf wird der unterpfadfaehige Same-Origin-Endpunkt `./__build-provenance.json` explizit abgewartet; eine globale Laufzeitueberschreibung existiert nicht. Ein fehlender Source-Commit oder dirty Quellbaum blockiert nur den Raw-JSON-Export mit sichtbarem stabilem Fehlercode, waehrend die eigenstaendige technische CSV-Projektion verfuegbar bleibt. JSON und CSV tragen dieselbe kanonische Run-ID; JSON-Dateinamen tragen ausserdem den Result-Fingerprint, CSV-Dateinamen ihren formatspezifischen Byte-Fingerprint. `sync-dist` baut `dist/` ausschliesslich aus einem Git-Commit: ohne `--rev` verlangt es einen sauberen Stand aller versionierten Quelldateien und blockiert normale wie auch per `.gitignore` ausgeblendete unversionierte Dateien in Runtime-Quellpfaden; die Desktop-Provenienz ist damit per Konstruktion clean. Sonstige unversionierte Scratchdateien blockieren den Vorgang nicht und gelangen nicht nach `dist/`. Run-/Request-ID und der gepinnte SHA-256-Fingerprint identifizieren den kanonischen Lauf; der Exportzeitpunkt gehoert nicht zum Result-Fingerprint. Ein ungueltiger veraenderlicher Rundungsvertrag faellt auf den freigegebenen Default zurueck und meldet einmalig den stabilen Diagnosecode `SPENDING_ROUNDING_CONTRACT_FALLBACK`. Der Export enthaelt die vollstaendigen lokalen Finanzannahmen und sollte entsprechend vertraulich behandelt werden.
* **Backtest-Status und Rolling Cohorts:** Die Zeitraumfelder zeigen manifestabgeleitete Grenzen und feldnahe Fehler. Ein fokussierbarer Live-Status trennt `completed`, `ruin`, `incomplete` und `technical_error`; Nutzertexte nennen einen stabilen Code, Ursache und naechsten Schritt ohne Stacktrace. Optional lassen sich feste, ueberlappende Rolling Cohorts fuer den gewaehlten Zeitraum auswerten. Das Inventar trennt Outcomes und Ausschluesse; historische Einzelpfade und Cohorts bleiben In-sample-Diagnosen, keine unabhaengigen Versuche und keine Erfolgswahrscheinlichkeit.
* **Auto-Optimize Dynamic-Flex-Modus:** `inherit`, `force_on`, `force_off`; Dynamic-Flex-Parameter sind nur bei effektiv aktivem Dynamic-Flex optimierbar, inklusive Safety-Guards gegen zu aggressive Lösungen.
* **Workflow-Transparenz:** Die Hauptabläufe (Balance, Monte-Carlo, Backtest) sind nun als Pseudo-Code dokumentiert: `docs/reference/WORKFLOW_PSEUDOCODE.md`.
* **Log-Transparenz für Entnahmen:** Detaillierte Monte-Carlo-Scenario-Logs und Backtest-Logs zeigen additive Payout-/VPW-Erklärfelder (`EntPlan`, `EntEff`, `VPW€`, `VPWFlex`, `Liq>P`, `Liq<P`, `Port>P`, `PortEnd`) sowie Return-Policy-Diagnosen (`RetPol`, `RetSrc`, `CAPESt`, `ERRaw`, `ERClamp`, `SafeR`, `SafeSrc`), damit hohe Dynamic-Flex-Entnahmen nachvollziehbar bleiben.
* **Tail-Risk-Overlay:** Optionales, standardmäßig deaktiviertes Ereignis-Overlay für seltene Crash-/Inflationsschocks. Historische Krisenjahre erhalten keinen zusätzlichen Return-Schock; Ergebnis-KPIs und Scenario-Log-Exporte weisen aktive, angewandte und übersprungene Tail-Events separat aus.
* **Getrennte Pflege-KPIs:** Monte Carlo weist Eintrittsquote, Eintrittsalter, Pflegejahre und realen Pflege-Mehrbedarf fuer P1 und P2 getrennt aus. Bedingte Kennzahlen ohne Beobachtungen erscheinen als Gedankenstrich; Haushaltswerte summieren den tatsaechlich modellierten P1-/P2-Zusatzbedarf und werden nicht als kausal depotfinanzierte Kosten bezeichnet.
* Stresstests, Pflegefall-Szenarien und Heatmap-Visualisierung (fokussiert auf Rentenphase). Presets kennzeichnen historische Filter, rekonstruierte Proxy-Zeitfenster, hybride und synthetische Schocks getrennt. Die Fenster 1929-1933 und 1939-1945 sind ausdrücklich Rekonstruktionen aus der Forschungsproxyreihe, keine exakten historischen Replays. Unvereinbare Startjahr-/Historienfilter oder weniger als drei unterschiedliche historische Stressjahre werden vor dem Lauf mit Handlungshinweis abgewiesen.
* Sweep-Schutz für Partner:innen-Renten inklusive Rente-2-Invarianz und Heatmap-Badges.
* Ab 100.000 Läufen erklärt ein Hinweis Dauer und 95-%-Wilsonintervall der Floor-Deckung; ab 1.000.000 ist er verstärkt. Ohne vergleichbaren erfolgreichen Lauf ist die Dauer unbekannt, ohne bekannten Erfolgsanteil gilt eine ausdrücklich benannte konservative 50-%-Grundlage. Der bewusste Hinweisknopf startet denselben kanonischen Lauf; „Auf 10.000 Läufe zurück“ ändert ausschließlich die Laufzahl. Das harte Maximum bleibt 1.000.000.
* Endvermögensverteilung mit gemeinsamem Real-/Nominalmaßstab, Histogramm mit Achse aus P97,5 der positiven Endwerte (mindestens 1.000 €), nominal ausgewählten Szenariomarken und Leiter. Reale Euro stammen aus den beobachteten Einzelpfaden; technische Fehler, Ruin, erfolgreiche Nullendwerte und obere Restklasse bleiben unterscheidbar; die Restklasse erscheint nur bei tatsächlich höheren Endwerten. Satzwerte verwenden interpolierte Perzentile, Szenariomarken den unveränderten `floor(n*p)`-Index. Fehlende ältere Realbeobachtungen zeigen einen Neuberechnungshinweis. Die nominalen KPI-Karten und vollständigen Downloads bleiben erhalten; der Jahresfächer zeigt zusätzlich P5–P95, P25–P75, Median und eine Lebens-/Ruinleiste für noch lebende gültige Haushalte. Real-/Nominalzähler sind getrennt, der Fächer endet strikt unter 5 % lebenden Haushalten. Alte oder fehlende Jahresdaten zeigen einen Platzhalter. Der serielle MC-Aufruf und jede MC-Jobnachricht aktivieren ihn ausdrücklich mit `collectWealthFan: true`; der gemeinsame Worker erzeugt und überträgt nur bei diesem booleschen Opt-in Fächerpuffer. Jobs ohne Feld, mit `false` oder anderen Werten sowie Optimize/Sweep bleiben ohne Zusatzbeobachtung. Nur sein Zusatzspeicher bleibt bei gleichem Horizont und gleicher Workerzahl konstant; die bisherigen MC-Ergebnisdaten wachsen weiter mit der Laufzahl.
* Szenario-Log-Analyse per Linie oder gruppierter Listbox mit bis zu 31 auswählbaren Szenarien: bis zu 16 charakteristische (Perzentile, getrennte P1-/P2-Pflege-Extremfälle, Risiko-Szenarien) und 15 deterministisch ausgewählte Stichproben für typisches Verhalten. Unter „Heutige Euro“ verwenden die Linien stets beobachtete Jahresendpreise relativ zum Laufstart, auch bei fehlendem oder inkompatiblem Jahresfächer mit Platzhalter. Der Log-Jahresbeginnfaktor wird dafür mit der beobachteten Jahresinflation fortgeschrieben; fehlt gültige Inflation, bleiben reale Lücken statt Ersatzwerte. Nominal bleiben die Rohwerte sichtbar. Bei vollständigen Beobachtungen entspricht der reale Endpunkt dem Listenbetrag aus `realByRun` desselben globalen Quelllaufs; Start, Tod ohne neue Finanzmessung und expliziter Ruinnullpunkt bleiben erhalten.
* Checkboxen für Pflege-Details und detailliertes Log, JSON/CSV-Export für ausgewählte Szenarien als `ScenarioLogExportV2`; Finanz- und Terminalrecords sind typisiert, Akkumulationsjahre erfinden keine beobachteten Entnahmequoten, und beide Formate stammen aus derselben beim Exportklick validierten Einheiten- und Feldprojektion. Ein fehlerhafter Pfad erzeugt eine sichtbare Meldung und niemals den Download des zuvor gewählten Szenarios.
* **Tranchen-Integration:** Steuerorientierte, modellbasierte Verkäufe mit detaillierten Depot-Positionen. Der Simulator tiefenkopiert profilgebundene Lots, bewahrt `sourceProfileId` und schreibt Simulationsmutationen niemals in den Realbestand zurueck.
* Notfallverkäufe werden steuerlich per Gesamt-Settlement-Recompute mit den regulären Verkäufen des Jahres konsistent verrechnet.
* **Pflegebucket als gesperrte Geldmarkt-/Cash-Reserve:** Der Simulator gliedert den optionalen Bucket nach dem Profilverbund-Merge aus Geldmarkt-Tranchen, ungetranchtem Geldmarkt und Tagesgeld aus. Die Engine sieht nur die operative Liquidität; der Bucket kann erst bei Pflege-Trigger vor Forced Sales Liquiditätslücken decken.

#### Schrittfolge für den Simulator (Simulator.html)
1. **Ergebnis ansehen:** Beim Öffnen wird der historische Backtest gerechnet und im Reiter „Ergebnis“ zusammengefasst. Danach folgen die Hauptreiter „Annahmen“, „Backtest“, „Monte-Carlo“ und „Werkstatt“.
2. **Annahmen prüfen:** In Schritt 1 „Wer und womit“ die Profile wählen; Vermögen und Renten werden übernommen. Schritt 2 „Bedarf“ enthält Floor-Bedarf und Flex-Bedarf. Strategieparameter, einschließlich Liquiditäts-Runway, Goldstrategie und Dynamic Flex, liegen in Schritt 3 „Strategie“. Schritt 4 „Personen und Rente“ und Schritt 5 „Pflege“ ergänzen die Personenannahmen. „Alle Parameter zeigen“ öffnet die jeweiligen verfügbaren Details; Klappen ohne weitere bedienbare Felder sind verborgen und erscheinen bei Freigabe wieder. Dynamic Flex nutzt die volle Kartenbreite. Die Pflegereserve mit ihrem unveränderten Erhaltungshinweis steht direkt bei der Pflegelogik-Schalterzeile.
3. **Monte-Carlo rechnen:** Im Reiter „Monte-Carlo“ die Laufeinstellungen prüfen. „Monte-Carlo rechnen“ (`mcButton`) in „Einstellungen“ startet den Lauf und heißt nach erfolgreichem Ergebnis „Monte-Carlo neu rechnen“. Derselbe Start steht direkt in der Ergebniskarte; „Einstellungen ändern“ öffnet den Monte-Carlo-Reiter. „Einstellungen anzeigen“ öffnet die anfangs geschlossenen Optionen; technische Einstellungen stehen unter „Erweitert“. Ein aktiver Workerlauf lässt sich mit „Monte-Carlo-Lauf abbrechen“ kontrolliert beenden; während des Abbruchs bleibt ein Neustart gesperrt, es gibt keinen seriellen Fallback. Nach erfolgreichem Abschluss speichert „Ergebnis exportieren (JSON)“ (`exportMonteCarloRunJson`) den versionierten Run-/Result-/Provenienzvertrag. JSON/CSV eines ausgewählten Szenario-Logs bleibt ein eigener vollständiger Export. Die kompakten Schalter „Detailliert“ und „Pflege-Spalten“ ändern nur die Tabelle. Listbox, Linie und Navigation wählen denselben Lauf; bis zu 15 Stichproben erscheinen als gleichwertige Optionszeilen.
4. **Backtest untersuchen:** „Backtest“ untersucht bekannte historische Marktverläufe, etwa ab 2000. Das ist eine historische In-sample-Diagnose, keine Zukunftsvalidierung oder Erfolgswahrscheinlichkeit. Datensatzgrenzen, Outcome, Datenqualität und In-sample-Hinweis bleiben sichtbar. Optionale Rolling Cohorts verwenden eine feste Horizontlänge und weisen ungeeignete Fenster getrennt aus. JSON enthält den vollständigen reproduzierbaren Laufvertrag einschließlich Cohort-Inventar; CSV ist eine flache technische Jahresansicht mit Punkt als Dezimaltrenner und leeren Feldern für fehlende Werte. Der sichtbare Detailmodus verändert diese Raw-Exporte nicht.
5. **Ergebnisse interpretieren:** Die Monte-Carlo-Kennzahl „Floor-Deckung im gewählten Horizont“ ist eine modellinterne Quote, keine Garantie und keine Aussage des historischen Backtests. Das Terminalinventar trennt `ruin`, `all_dead`, den zensierten Zustand `horizon_exhausted` und `technical_error`; bei mindestens einem technischen Fehler werden Quote und Wilson-Intervall fail-closed nicht ausgewiesen. Das Intervall beschreibt nur Monte-Carlo-Stichprobenfehler, nicht Modellrisiko. Immer gemeinsam mit P10/P50/P90, der laufbasierten `Realen Depotentnahme P10`, dem Anteil abgeschlossener Dekumulationsjahre mit mindestens 10 % Kürzung, Portfoliovolatilität, nominalem und realem Drawdown, Depoterschöpfung und Pflege-KPIs lesen. Die entscheidungsrelevanten EUR-Werte einschliesslich P10/P50/P90-Endvermoegen sind auf den Karten centgenau; Nutzen wird bei Untercent-Werten abwaerts, Kosten aufwaerts angezeigt. Ein Gedankenstrich mit Grund ist keine beobachtete 0; steht bei der Beobachtungszahl `unbekannt`, hat das Aggregat keine Zahl geliefert. Bei der Depotentnahme werden Jahre nach Ruin bis Tod oder Horizont mit 0 Euro aufgefuellt; sie ist kein Mass fuer den gesamten Haushaltskonsum. Die sichtbare 4,5-Prozent-Auswertung ist lediglich eine Berichtsreferenz der realisierten Entnahmequote und keine Alarm- oder Guardrail-Schwelle; wegen der Klassenbildung verwendet die Heatmap `>=`, der Gesamt-KPI dagegen strikt `>`. Pflegebetraege sind reale modellierte Mehrbedarfe zur Preisbasis des Simulationsstarts, keine kausal zugeordneten Depot-Cashflows. Der Vergleich „ohne minus mit Pflege“ stellt ungepaarte Gruppenmediane gegenueber und ist nicht kausal. Heatmaps zeigen Sensitivitäten, und das Szenario-Log bietet Analysen zu typischen und extremen Verläufen. Für hohe Dynamic-Flex-Entnahmen den detaillierten Logmodus aktivieren und Payout-/VPW-Spalten prüfen.
6. **Werkstatt öffnen:** Die Karten „Stresspfad-Replay“, „Parameter-Sweep“ und „Auto-Optimize“ bieten jeweils „Öffnen“; die aktive Karte bietet „Schließen“. Wechsel und Schließen erhalten Felder, Ergebnisse und laufende Controller. Pfeiltasten und Home/End wählen die Werkzeuge, Enter/Leertaste bedienen den Kartenknopf. Für einen gepaarten Stressvergleich in „Szenario-Logs“ einen Lauf wählen und „In Replay anzeigen“ verwenden; „Auswahl in Szenario-Logs ändern“ führt zurück. Den Stresspfad fixieren und nur freigegebene Strategieparameter variieren. Import, Export, Variantenrechnung und Ersetzen sind während einer Replay-Aktion gemeinsam gesperrt. Ein nur lesbarer V1-Arbeitsstand muss über einen neuen Monte-Carlo-Lauf erneut fixiert werden. Nach einer Variantenmutation den getrennten Vergleichsstatus prüfen: Eine gespeicherte Änderung bedeutet noch keinen erfolgreich berechneten Vergleich. **Experimenteller Vergleich (Sweep/Auto-Optimize):** In **Werkstatt → Parameter-Sweep** können die fuenf allgemeinen und je nach Dynamic-Flex-/Go-Go-Zustand zwei weitere sichtbare Dimensionen automatisiert variiert werden; Auto-Optimize bietet sechs davon an. Fuer jeden sichtbaren Parameter sind kanonische Zuordnung, Consumer und Ergebnisprovenienz geprueft; das ist kein unabhaengiger KPI-Wirkungsnachweis. Nutzen Sie Heatmap und Champion nur zum Erkunden des gewählten Modellraums; beide sind keine fachlich validierte Optimierung oder Empfehlung.
7. **Dynamic-Flex verifizieren:** Für neue Entnahmelogik zuerst Backtest prüfen, danach Monte Carlo, dann Sweep/Auto-Optimize mit denselben Dynamic-Flex-Einstellungen. Backtest- und Scenario-Log verwenden im detaillierten Modus dieselben Payout-/VPW- und Return-Policy-Begriffe.
8. **Tail-Risk vergleichen:** Für Stressanalysen zuerst einen Standardlauf ohne Overlay speichern/merken, dann Tail-Risk bewusst aktivieren und Floor-Deckung im gewählten Horizont, terminale Outcomes, P10/P50/P90, Max Drawdown und Tail-Risk-KPIs vergleichen. Die `Reale Depotentnahme P10 (Stress)` verwendet pro Run genau einen realen P10 im festen Stressfenster und fuellt nach Ruin verbleibende Verpflichtungsjahre bei noch lebendem Haushalt mit 0 Euro auf.

**Häufige Eingabefehler und Korrekturen**
* Negative oder unrealistisch hohe Werte (z. B. `Gesamtvermögen` < 0 oder CAPE > 80) führen zu Warnungen – bitte auf plausible Spannen korrigieren.
* Prozentwerte im Sweep vergessen zu normalisieren: sicherstellen, dass Quoten in Prozent eingegeben werden (z. B. 60 statt 0.6) und den Tooltip beachten; Werte ausserhalb des dokumentierten Bereichs werden abgewiesen und nicht still begrenzt.
* Fehlende Pflichtfelder nach Tab-Wechsel: Wenn das UI Inputs deaktiviert (z. B. Rentenprozente bei CPI-Indexierung), zuerst den Anpassungsmodus zurück auf „fix“ stellen oder den Wert via Reset-Button neu laden und anschließend den gewünschten Modus wählen.
* Konflikte zwischen Partner:inneneingaben (Rente-2-Invarianz): Sweep-Wächter meldet blockierte Felder; Personendaten zentral prüfen; im Sweep ausschließlich freigegebene Strategiedimensionen variieren.
* Ungültige Tail-Risk-Parameter (z. B. Wahrscheinlichkeit > 5%, Dauer > Horizont oder Schocks außerhalb der erlaubten Grenzen) blockieren die Monte-Carlo-Simulation statt still geklemmt zu werden.
* Browser blockiert CSV/JSON-Export oder Dateiimporte: Pop-up/Download-Berechtigungen prüfen oder alternativen Browser mit File-System-Access-Unterstützung verwenden.

#### Ansparphase (Accumulation Phase)

Der Simulator unterstützt nun optional eine Ansparphase vor dem Renteneintritt:
* **Startalter & Dauer:** Flexible Definition des Simulationsbeginns (z. B. ab 40) und der Anspardauer.
* **Sparrate:** Jährliche Sparleistung, die dem Portfolio zugeführt wird (statt Entnahmen).
* **Übergang:** Automatischer Wechsel in die Entnahmephase nach Ablauf der Dauer.
| PG 2       | 18 000                       | 45              |
| PG 3       | 28 000                       | 40              |
| PG 4       | 36 000                       | 35              |
| PG 5       | 44 000                       | 30              |

Alle Werte lassen sich situationsgerecht anpassen; die Engine übernimmt die grade-spezifischen Zusatzkosten automatisch,
berücksichtigt Ramp-Ups, Max-Floor-Caps sowie Flex-Verluste und protokolliert den aktiven Pflegegrad im Worst-Run-Log.
Zusätzlich gibt es nun Staffel-Presets (ambulant/stationär), einen regionalen Zuschlagsregler, Echtzeit-Badges zum Maximal-
Floor sowie Listener, die alle Pflegefelder synchron halten – inklusive Info-Hinweis und Tooltips im UI.【F:simulator-main.js†L89-L1506】

Das Simulator-Dashboard trennt die Pflegeanalyse nach P1, P2 und Haushalt. Eintrittsalter und Pflegejahre sind nur auf tatsaechliche
Eintritte bedingt; leere Stichproben bleiben `null`. Geldwerte zeigen reale Pflege-Mehrbedarfe zur Preisbasis des Simulationsstarts,
waehrend nominale Rohwerte im Laufvertrag ein `NominalEur`-Suffix tragen. Simultane Pflege wird als P1-plus-P2-Jahressumme erfasst.
Die Szenario-Log-Auswahl hebt den fruehesten Eintritt fuer beide Personen sowie den hoechsten realen Pflege-Mehrbedarf getrennt hervor.

#### Rentenlogik

Personenwerte kommen aus „Personen & Vermögen → Person & Einkommen“. Hauptprofil und Partner liefern ihre eigene Rente, Geschlecht, Kirchensteuer und Sparer-Pauschbetrag; die gemeinsame Anpassung folgt dem Hauptprofil (`fix`, Lohn oder CPI). Hinterbliebenenmodell und Mindest-Ehezeit bleiben Simulatorannahmen. Die numerischen Fachparameter und Rentenformeln bleiben erhalten.

Normalerweise stehen Personenwerte als schreibfreie Liste ohne Eingaben in der Karte. „In Personen & Vermögen ändern“ führt zur zentralen Karte. „Für diese Rechnung abweichend ansetzen“ erlaubt flüchtige Alternativen, ohne Profile oder Personen-`sim_*`-Keys zu schreiben. Alter und Rentenoffset bleiben Ableitungen. Der fixe Satz ist bei Lohn-/CPI-Kopplung gesperrt. Partneraktivierung folgt der Profilauswahl; der Sweep schützt weiterhin Partnerfelder.

#### Profilverbund (Multi-Profil)

Die Suite kann mehrere Profile als Profilverbund gleichzeitig auswerten. Es gibt keinen separaten Tab mehr – die Auswahl der Profile steuert Balance und Simulator direkt.

**Profilverwaltung:**
* Personen werden im Manager (`depot-tranchen-manager.html`) angelegt, umbenannt und über die Personenreiter gewechselt; die Haushaltspille der Übersicht öffnet seine Verwaltung
* Jedes Profil speichert zentrale Personendaten, Vermögen, Ausgaben, Tranchen und eigene Modellannahmen; Balance und Simulator lesen die Personenwerte
* Export/Import-Funktion für Backups der gesamten Profil-Registry

**Balance-App (Profilverbund):**
* Profile werden per Checkbox ausgewählt (Standard: alle aktiv).
* Vermögenswerte, Tranchen und feste Einkünfte werden über die gewählten Profile aggregiert.
* Entnahme-Verteilung: Proportional (nach Vermögen), Runway-First oder Steueroptimiert.

**Simulator (Profilverbund):**
* Profile werden unter „Annahmen“, Schritt 1 „Wer und womit“, ausgewählt.
* Startvermögen, Floor/Flex und Renten werden aus den Profilen gefüllt.
* Personenanzahl und Renten ergeben sich automatisch aus der Profilwahl.
* Sobald mindestens ein Profil valide Detailtranchen verwendet, blockiert ein weiteres Profil mit positiven Depot-/Geldmarkt-Aggregaten ohne Detailtranchen sichtbar. So werden belegte Assets weder still ausgelassen noch mit unbekannter Steuerprovenienz synthetisiert.

**Wichtige Hinweise:**
* Goldziel und Gold-Floor werden pro Profil als Eurobetrag auf der frei investierbaren Profilbasis berechnet. Ein Pflegebucket wird dabei bis zur vorhandenen operativen Liquidität ausgeschlossen; erst die Summe der Profilbeträge wird adapterseitig in eine Haushaltsquote umgerechnet.
* Die Haushalts-Goldstrategie hängt nur von den ausgewählten Profilen ab, nicht vom aktuell in der UI geöffneten Profil.
* Tranchen werden aus den aktiven Profilen zusammengeführt.
* Kategorie und Typ folgen einer disjunkten Matrix; korrupte oder widerspruechliche Bestände blockieren fail-closed statt auf einen anderen Bestand zurueckzufallen.
* Detaillierte Designdokumentation siehe `docs/reference/PROFILVERBUND_FEATURES.md`

#### Pflegebucket

Der Pflegebucket ist eine optionale, zweckgebundene Selbstversicherungsreserve für schwere Pflegefälle. Er wird nicht als normale Liquidität, Runway-Puffer oder frei konsumierbares VPW-Vermögen behandelt.

**Source of Truth:** Die Definition liegt in der Profilpflege (`profile_health_bucket`) und wird von Simulator und Balance-App gelesen. Im Profilverbund gilt das Hauptprofil als maßgebliche Haushaltsdefinition; abweichende sekundäre Profildefinitionen erzeugen Warnungen.

**Simulator-Wirkung:** Beim Start wird der Bucket nach dem Profilverbund-Merge aus cash-nahen Quellen ausgegliedert: zuerst Geldmarkt-Tranchen per FIFO, dann ungetranchter Geldmarkt, danach Tagesgeld. Reicht die verfügbare Geldmarkt-/Cash-Liquidität nicht aus, wird der Bucket gekappt und im Log gewarnt. Der Engine-Air-Gap sorgt dafür, dass VPW, Runway, Ziel-Liquidität und Transaktionen nur mit operativer Liquidität rechnen.

**Freigabe:** Der Bucket wird nur bei definiertem Pflege-Trigger genutzt, standardmäßig ab Pflegegrad 4 im Modus `OR` für Person 1 oder Person 2. Der Standard `care_additional_floor_only` deckt nur pflegebedingte Zusatzlücken; `floor_when_care_active` kann den gesamten Floor-Shortfall bei aktivem Trigger decken.

**Diagnose:** Jahreslogs, Backtests und Monte Carlo zeigen Start, Nutzung, Verzinsung, Restbetrag, Trigger, reale Zieldeckung und inflationsindexierte Ziellücke. Der inflationsangepasste Zielwert ist eine Diagnosegröße; Version 1 füllt den Bucket nicht automatisch wieder auf.

**Steuervereinfachung:** Der Bucket-Verbrauch wird in Version 1 als cash-like Reserve modelliert. Geldmarkt-Tranchen werden beim Carve-Out nachvollziehbar geführt, aber Bucket-Verbrauch erzeugt noch keine eigenen Tax-Aggregate.

### Gemeinsame Engine
* Modulare ES-Module (`engine/`) kapseln Validierung, Marktanalyse, Ausgabenplanung und Transaktionslogik.
* Der lesende Flex-Trace ist an der Engine ausdrücklich zuschaltbar: `EngineAPI.simulateSingleYear(input, lastState, { includeFlexTrace: true })`. Bestehende Simulator-/Worker-/Exportaufrufe erfassen ihn nicht; die Balance-Anzeige fordert ihn für die aktuelle Budgetkarte an. Details: [engine/README.md](engine/README.md).
* `engine.js` ist aktuell ein reiner generierter Modul-Wrapper: Er importiert `EngineAPI` aus `engine/index.mjs`, stellt `window.EngineAPI` und den Legacy-Alias bereit und exportiert beide Namen. Balance und Simulator laden ihn als ES-Modul; Fachtests und Worker importieren die Engine-Module direkt. Die Implementierung bleibt unter `engine/`.
* Konfigurierbare Guardrails, Marktregime-Übersetzungen und Strategien für Liquiditätsziele.
* Kontinuierliche Regime-Signale sind DOM-frei getestet. Grenzwerte um 10%, 20% und 30% Drawdown werden bei aktivierter Zielwert-Glättung monoton interpoliert; harte Mindest-Runway- und Notfallgrenzen bleiben hart.

---

## Repository-Struktur

```
Ruhestand-App-Final/
├── Balance.html                # Einstiegspunkt Balance-App
├── Simulator.html              # Einstiegspunkt Simulator
├── app/
│   ├── balance/                # ES6-Module der Balance-App
│   ├── simulator/              # ES6-Module des Simulators
│   ├── profile/                # Profilverwaltung / Profilverbund
│   ├── tranches/               # Tranchen-Status & Aggregation
│   └── shared/                 # gemeinsame Utilities/Formatter
├── engine/                     # Quellmodule der Berechnungsengine (ESM)
│   ├── config.mjs
│   ├── core.mjs
│   ├── errors.mjs
│   ├── index.mjs
│   ├── analyzers/
│   │   ├── MarketAnalyzer.mjs
│   │   └── regime-signals.mjs
│   ├── planners/
│   │   ├── SpendingPlanner.mjs
│   │   ├── alarm-policy.mjs
│   │   ├── final-rate-policy.mjs
│   │   ├── flex-budget-policy.mjs
│   │   ├── flex-rate-policy.mjs
│   │   ├── spending-diagnosis.mjs
│   │   ├── spending-guardrails.mjs
│   │   ├── spending-policy-pipeline.mjs
│   │   ├── spending-policy-helpers.mjs
│   │   └── wealth-reduction.mjs
│   ├── transactions/
│   │   ├── TransactionEngine.mjs
│   │   ├── transaction-action.mjs
│   │   ├── transaction-opportunistic.mjs
│   │   ├── transaction-surplus.mjs
│   │   ├── sale-engine.mjs
│   │   └── transaction-utils.mjs
│   └── validators/InputValidator.mjs
├── engine.js                   # Reiner Modul-Wrapper (generiert)
├── build-engine.mjs            # Generator: Modul-Fallback oder IIFE-Bundle
├── css/
│   └── balance.css             # Styling der Balance-App
├── simulator.css               # Styling der Simulator-Oberfläche
├── docs/reference/TECHNICAL.md                # Technische Details & Architektur
├── docs/reference/BALANCE_MODULES_README.md   # Modulübersicht Balance-App
└── ...                         # Weitere Hilfsdateien und Tests
```

---

## Systemvoraussetzungen

Die Anwendung ist bewusst minimalistisch gehalten, hat aber für den vollen Funktionsumfang folgende Anforderungen:

1.  **Browser:** Ein moderner Browser (Chrome, Edge, Firefox) mit Unterstützung für ES6-Module und die File System Access API (für Dateiimport/-export; Jahresabschluss-Snapshots liegen intern in IndexedDB).
2.  **Node.js (optional, nur Browservariante):** Für den automatischen Abruf von Online-Kursdaten (ETF-Preise) wird dort ein lokaler Proxy benötigt. Dieser setzt eine installierte [Node.js](https://nodejs.org/)-Laufzeitumgebung voraus. Die Tauri-Variante bringt ihren Loopback-Proxy selbst mit.
    *   *Ohne Node.js im Browserbetrieb:* Die App startet normal, aber der Button "Online-Update" im Tranchen-Manager ist ohne Funktion. Manuelle Kurspflege ist weiterhin möglich.
3.  **Poppler ab 25.07.0 (nur Windows-Entwicklungsgate):** Das
    Primaerquellengate der historischen Cash-/Geldmarktkette liest die
    gepinnte Bundesbank-PDF mit `pdftohtml`. Das Programm muss ueber `PATH`,
    `RUHESTANDSAPP_POPPLER_BIN` oder `RUHESTANDSAPP_PDFTOHTML` erreichbar
    sein. Unter Windows kann Poppler beispielsweise mit
    `winget install oschwartz10612.Poppler` installiert werden. Die
    Installation laesst sich mit `npm run verify:poppler-toolchain` pruefen.
    Eine neuere kompatible Poppler-Version wird nicht allein wegen ihrer
    Versionsnummer abgewiesen; Quellenhash und extrahierte 77-Jahres-Reihe
    bleiben fail-closed gepinnt. Unter WSL/Linux weist `npm test` dieses echte
    Windows-Poppler-Gate als separates Pflichtgate aus, statt eine
    inkompatible Linux-Toolchain vorauszusetzen.

---


## Nutzung

### Option 1: Standalone-Anwendung

**RuhestandSuite.exe** – portables Windows-Artefakt auf Basis von Tauri. Die EXE liegt nicht im Repository, sondern wird lokal gebaut:
* Keine Installation, kein Installer und keine Administratorrechte erforderlich
* Plattformneutraler Buildpfad über `npm run build:desktop` (`npm run sync-dist` plus `npm run tauri:build`)
* Beinhaltet beide Apps (Balance & Simulator) in einer nativen Desktop-Umgebung
* Kernrechnung und lokale Datenhaltung sind offline nutzbar; Live-Kurse, Inflation und CAPE benötigen Netzwerkzugriff; Schriften und Symbole sind lokal
* Nutzt kein separates lokales Webserver-Setup; das Frontend wird direkt aus `dist/` in der Tauri-WebView geladen
* Enthaelt einen integrierten Yahoo-Proxy fuer Kurs-Updates (lokaler Port 8787)

Die Tauri-Konfiguration beschreibt Bundleziele für weitere Plattformen, und
`npm run build:desktop` läuft auf jedem Host mit Node.js, Git, Rust und den
Tauri-Systemvoraussetzungen; validiert ist bisher nur der Windows-Build. Ein vorhandenes lokales EXE-Artefakt ist noch kein Nachweis für
einen grünen Testlauf, einen manuellen Desktop-Smoke oder eine Veröffentlichung.
macOS-/Linux-Desktop-Builds sind hier weder aktuell validiert noch als
ausgeliefert dokumentiert.

**So bauen und nutzen Sie die portable EXE:**
1. Voraussetzungen installieren: Node.js, Git und Rust, unter Windows mit MSVC-Toolchain und Visual Studio Build Tools (Desktop development with C++).
2. Im Repository `npm ci` und danach `npm run build:desktop` ausführen. `sync-dist` baut `dist/` aus dem aktuellen Commit; der Tauri-Build legt die Binary unter `src-tauri/target/release/` ab (unter Windows `ruhestand_suite.exe`, Installer zusätzlich unter `src-tauri/target/release/bundle/`).
3. Die Binary in einen beliebigen Ordner kopieren, unter Windows z. B. als `RuhestandSuite.exe`.
4. Per Doppelklick starten; die Tauri-App öffnet die Oberfläche direkt aus dem gebündelten `dist/`-Stand.
5. Optionale Live-Datenzugriffe funktionieren bei Internetverbindung; ETF-Kurse laufen über den integrierten lokalen Proxy, Inflation und CAPE direkt über freigegebene externe Endpunkte. Ohne Internet bleiben lokale Planung und manuelle Werte nutzbar. Ein gestarteter, noch unvollständiger Jahresabschluss kann bei einem fehlgeschlagenen periodengebundenen Datenschritt bewusst im Recovery-Zustand bleiben, statt mit einem falschen Stichtag fortzufahren.
6. Eigene Szenarien werden im Benutzerprofil als Tauri-App-Daten gespeichert. Live-Daten liegen in `ruhestand_suite_data.json`, Jahresabschluss-Snapshots separat in `ruhestand_suite_snapshots.json`; der Wechsel zwischen Browser und EXE laeuft ueber das zentrale Komplettbackup auf Daten & Sicherung.

Bei optionalen Abrufen verlassen nur die jeweiligen Requestparameter den
Rechner: etwa Yahoo-Symbol/Suchbegriff und Zeitfenster oder fest konfigurierte
Reihen und Zieljahre für Inflation/CAPE. Depotmengen, Cost Basis, Bedarfe und
Profilzustände werden über diese Pfade nicht absichtlich übertragen. Übliche
IP-/Transportmetadaten fallen bei externen Providern dennoch an.

### Option 2: Browser-basierte Nutzung

1. Repository klonen oder herunterladen.
2. **Suite starten:** Doppelklick auf `start_suite.cmd` (Windows) oder `npm run serve` (alle Plattformen, auch WSL).
   * Startet den lokalen Webserver (Port 8000) und im selben Node.js-Prozess den Yahoo-Proxy für Online-Kurse (Port 8787); beide binden nur an `127.0.0.1`.
   * `start_suite.cmd` öffnet den Browser mit `http://localhost:8000/index.html`. Unter WSL erreicht der Windows-Browser dieselbe Adresse.
   * Ctrl+C oder das Schließen des Fensters beendet Webserver und Proxy gemeinsam.
3. `Balance.html` bzw. `Simulator.html` im Browser aufrufen.
   * Das automatisierte Browser-Gate läuft mit Chromium; weitere Browser bleiben Teil der manuellen Kompatibilitätsprüfung.
   * Keine Build-Schritte nötig.

Der Wrapper lädt die Module unter `engine/` direkt. Fachänderungen werden beim nächsten Reload übernommen; Build-Varianten und Neuerzeugungsanlässe stehen im Abschnitt „Entwicklung“.

**Optionen des Servers** (`node scripts/serve.mjs …` bzw. `npm run serve -- …`):
* `--port <n>` und `--proxy-port <n>` ändern die Ports; `--no-proxy` startet nur den Webserver (Online-Kurse dann nicht verfügbar).
* `--open` öffnet den Standardbrowser.

> **Hinweis:** Dateiimporte und -exporte benötigen Browser mit passender Datei-/Download-Unterstützung. Jahresabschluss-Snapshots nutzen im Browser das interne IndexedDB-Archiv. Die Browser-Variante benötigt Node.js für Webserver und Yahoo-Proxy. Die Tauri-EXE bringt den Proxy selbst mit und benötigt zur Laufzeit kein Node.js.

---

## Entwicklung

* Die Balance- und Simulator-Module nutzen native ES6-Imports. Änderungen an einzelnen Modulen werden nach dem Speichern direkt beim nächsten Reload geladen.
* Engine-Anpassungen erfolgen unter `engine/`, niemals manuell in `engine.js`. Fach-, Versions- und API-Methodenänderungen hinter demselben Import erfordern keinen Wrapper-Neuaufbau; Fachtests und Vertragsprüfungen bleiben verpflichtend. `tests/engine-wrapper-contract.test.mjs` prüft in `npm test` den vollständigen reinen Wrapper.
* Eine Neuerzeugung über `npm run build:engine` ist nur bei fehlendem Artefakt oder Änderungen am Generator, Import-Einstieg oder Wrapper-/Global-/Exportvertrag nötig. Dabei Generator, Artefakt und Test gemeinsam prüfen: Ohne `esbuild` schreibt der nicht strikte Generator den konstanten Modul-Fallback; mit `esbuild` entsteht ein echtes IIFE-Bundle mit kopierter Engine-Implementierung. Ein solches Bundle übernimmt Quelländerungen nicht automatisch und wird vom Wrappertest auch frisch gebaut abgewiesen. Ein bewusster Bundlewechsel benötigt eine eigene geprüfte Vertragsänderung; der Test darf dafür nicht still abgeschwächt werden.
* `npm run build:engine:strict` ist ein optionales Gate für einen ausdrücklich gewählten Bundle-Auslieferungsvertrag, keine Voraussetzung für den bestehenden Browser-/Tauri-Wrapperpfad. Ohne `esbuild` scheitert Strict vor dem Fallback; auch `ENGINE_BUILD_STRICT` oder `CI` mit `1` oder `true` (Groß-/Kleinschreibung beliebig) machen den normalen Build strikt. Andere Buildfehler werden nicht durch einen erfolgreichen Fallback verdeckt. Details: [engine/README.md](engine/README.md#build-prozess).
* Der Desktop-Build bleibt ein bewusst manueller Schritt nach grüner Suite: `npm run build:desktop`. `scripts/sync-dist.mjs` baut `dist/` ausschließlich aus einem Git-Commit (ohne `--rev` aus `HEAD`, dann nur bei sauberem Stand ohne unversionierte Laufzeitdateien) und kopiert nur Laufzeitdateien: `app/`, `engine/`, `workers/`, `types/`, `css/`, `assets/` sowie die HTML-, JS- und CSS-Dateien im Wurzelverzeichnis. `engine/` und `engine.js` stammen dabei aus demselben gewählten Commit; der Sync führt keinen Engine-Build aus. `__build-provenance.json` hält den Quell-Commit fest. Mit `--rev <commit> --out <ordner>` lässt sich ein Commit in einen externen Buildordner übertragen. Die EXE ist kein Repository-Artefakt; ältere Stände für Regressionsvergleiche werden außerhalb des Repositories archiviert.
* Für schnelle QA bitte `npm test` einmal durchlaufen lassen. Der Node-Läufer nutzt pro Testdatei einen eigenen Prozess und standardmäßig alle CPU-Kerne bis auf vier; `TEST_WORKERS=8 npm test` begrenzt die Last, `TEST_WORKERS=1 npm test` dient der seriellen Fehlersuche. Normal erscheint je Datei eine Ergebniszeile mit Assertionzahlen, Dauer und Status, bei Fehlern zusätzlich kompakte Diagnosen. Nach Zusammenfassung und den zehn langsamsten Dateien steht zuletzt die Liste aller roten Dateien mit ihren Fehlern. `TEST_VERBOSE=1 npm test` zeigt alle Einzelprüfungen und Dateilogs; direkte `run-single.mjs`-Aufrufe bleiben ausführlich. Im orchestrierten Lauf führt allein der Orchestrator die volle Node-Suite aus; gezielte Node-Prüfungen fährt der Implementierer. Die gesteuerte Sitzung prüft kritische Browserabläufe mit dem separaten `npm run test:browser` außerhalb der Agentensandbox vor dem Merge; dieses Gate ist nicht Teil von `npm test`. `npm run test:coverage` aktualisiert die transparente V8-Coverage-Baseline. Wenn lokal `npm` defekt ist, kann die fachliche Suite direkt mit `node tests/run-tests.mjs` validiert werden; der Tauri-Release-Build selbst benötigt weiterhin ein funktionierendes `npm`.

## Abschluss-Checkliste

* **Verlauf prüfen:** Der Orchestrator führt `npm test` auf dem fertigen Stand aus. Node-/DOM-Fixtures sichern Marken, Kennzahlen-/Tabellenparität, Managererfassung mit Kursgate, Readback, Reload und geschützte Altlinkweiterleitung. Die gesteuerte Sitzung fährt vor dem Merge den Browser-Smoke; neue Browserfälle sind in dieser Entwicklungsphase nicht vorgesehen.

* **Dokumentation synchron halten:** Nach Engine-Änderungen oder neuen Simulator-Modulen (z. B. Monte-Carlo-Runner/UI/Analyzer) README, `docs/reference/TECHNICAL.md` und `docs/reference/SIMULATOR_MODULES_README.md` aktualisieren.
* **Snapshot-/Backup-Grenze beachten:** Komplettbackup/Import ist der Wechselpfad zwischen Browser und EXE. Jahresabschluss-Snapshots sind interne Sicherungspunkte; Standard-Restore erhaelt die Snapshot-Historie, prueft die Profilzuordnung und ersetzt keinen Profil-Merge.
* **Konsole sauber halten:** Vor dem Release auskommentierten Code entfernen, damit Nutzer:innen keine unnötigen Meldungen im Browser-Log sehen.
* **Tauri/Web-Worker:** Die Parallelisierung nutzt Web Worker mit Transferables (kein SharedArrayBuffer). Das funktioniert in Tauri als EXE, sofern die Worker-Skripte gebündelt und per `new URL(..., import.meta.url)` erreichbar sind. CSP/Asset-Bundling sollten Worker-Module erlauben.
* **Desktop-Smoke nach EXE-Build:** Nach `npm run build:desktop` kurz Startseite/Profilverwaltung, Balance, Simulator, Tranchenmanager, Handbuch, Worker-Pfade sowie optionale Live-Daten und Offline-Fallbacks prüfen.

---

## Weitere Dokumentation

* **docs/reference/TECHNICAL.md** – kompakte technische Referenz (Module, Datenflüsse, Laufzeitverhalten).
* **docs/reference/ARCHITEKTUR_UND_FACHKONZEPT.md** – vertiefte Architektur-, Fach- und Methoden-Dokumentation (inkl. Herleitungen/Abgrenzungen).
* **docs/reference/MARKTVERGLEICH.md** – Marktvergleich mit zehn externen Werkzeugen (Stichtag 2026-07-15).
* **docs/reference/WISSENSCHAFTLICHER_RAHMEN.md** – Quellenlage, Aussagegrenzen und Forschungsrisiken der Rechenmechanismen.
* **docs/reference/BALANCE_MODULES_README.md** – Modulübersicht der Balance-App.
* **docs/reference/SIMULATOR_MODULES_README.md** – Modulübersicht des Simulators (MC, Sweep, Backtest, UI-Pfade).
* **docs/reference/TRANCHEN_MODULES_README.md** – zentraler Tranchen-Daten-, Persistenz-, Quote- und Reconcile-Vertrag.
* **engine/README.md** – Engine-Module und Build-Prozess.
* **tests/README.md** – Aufbau und Ausführung der Test-Suite.
* **docs/reference/WORKFLOW_PSEUDOCODE.md** – Ablaufdarstellung zentraler Workflows in Pseudocode.

---

## Lizenz

Der Programmcode ist unter der MIT-Lizenz veröffentlicht. Die vollständigen
Bedingungen und die Abgrenzung zur Datenbeilage stehen in `LICENSE.md`.
Lizenztext, npm-Paketmetadaten und Tauri-/Cargo-Metadaten weisen das Projekt einheitlich als `MIT` aus.
Diese Metadaten beschreiben den Programmcode; für die mitgelieferten Forschungsdaten
gelten die nachfolgend dokumentierten abweichenden Bedingungen.

Die Forschungsdaten unter
`data/historical/global-equity-research-chain/` und
`data/historical/german-cpi-chain/` sowie die Cash-/Geldmarktdaten unter
`data/historical/german-cash-money-market-chain/` und die Golddaten unter
`data/historical/gold-german-investor-chain/` und die daraus erzeugten Werte
unterliegen teilweise `CC BY-NC-SA 4.0`, einschließlich
Nichtkommerzialitäts- und Share-Alike-Bedingungen; World-Bank-Anteile stehen
unter `CC BY 4.0`. OECD-, EZB- und
Bundesbank/ESCB-Bedingungen gelten zusätzlich; für die Destatis-Anteile gilt die Datenlizenz Deutschland
– Namensnennung – Version 2.0. Vor einer kommerziellen Verteilung des Repositories,
eines `dist/`-Standes oder einer ausführbaren Anwendung ist eine gesonderte
Lizenzprüfung erforderlich. Fuer EURSTR gilt zusaetzlich der in der
Cash-/Geldmarkt-Lizenzbeilage verlinkte Administratorhinweis der EZB. Details
und Namensnennung:
`data/historical/global-equity-research-chain/LICENSE.md` und
`data/historical/german-cpi-chain/LICENSE.md` sowie
`data/historical/german-cash-money-market-chain/LICENSE.md` und
`data/historical/gold-german-investor-chain/LICENSE.md`.

## Grenzen des Navigationsschutzes

Bei Speicherfehlern bieten Tranche- und Cashdialog den Knopf **Speichern erneut
versuchen** unmittelbar neben der Fehlermeldung. Er wiederholt die ursprünglichen
Daten und IDs. Spätere Eingaben bleiben nach diesem Erfolg offen und unbestätigt;
bei Tranche bearbeitet ein bewusster Folgesubmit dieselbe bestätigte ID. Bei Cash
wird kein Folgeauftrag erzeugt: Entwurf bewusst verwerfen und bei Bedarf den
aktuellen Korrekturworkflow neu öffnen. Nur der unveränderte Ursprungsdialog
schließt automatisch. Der Wiederholenknopf auf der Managerseite bleibt erhalten.

App-Wechsel und vom JavaScript übernommenes EXE-Schließen warten sämtliche
Abbruchenden und bestätigte Flushes ab; aktive Commits bleiben gesperrt. Nur der
bisher nicht übernommene EXE-Versuch besitzt den Drei-Sekunden-Fallback. Native
Browserwege (Zurück, Vor, Reload, Tab-Schließen) bieten nach Nutzeraktivierung
lediglich die Browsernachfrage. Es gibt keine zusätzliche Browser- oder
Betriebssystemkürzelsperre und keine garantierte asynchrone Unloadspeicherung.
Profilseiten beginnen die bestmögliche Sicherung zusätzlich früh bei `beforeunload`,
ohne selbst nachzufragen. Pagehide/Hidden sichern weiterhin vor dem Facadeflush;
aktive Commits und Restore-/Reset-Schreibsperren lassen den unabhängigen
Profil-Speicherpfad aussetzen. Das Handbuch bleibt ohne Profilsicherung.
Erzwungenes Ende bleibt ein Recoveryfall. Ergebnisse sind flüchtig; Downloads
quittieren ihren Verlustgrund nicht. Eine Ergebnisablage kommt erst mit Paket 4.2.
BFCache-Rückkehr verwirft alte Freigaben und prüft vor einem erneuten Start Schutz
und Flush. Ablehnung erhält das wiederhergestellte Dokument.


### Balance: Überblick und Arbeitsreiter

Balance startet mit **Überblick**. Der gemeinsame Suite-Kopf zeigt Berechnungsumfang mit „ändern“, Planungsjahr und vorhandenen Marktdatenstichtag. „ändern“ öffnet Bedarf & Strategie und fokussiert die Haushaltsauswahl ohne Write. Drucken, Marktdaten aktualisieren und Jahresabschluss stehen in dieser Reihenfolge im Kopf; Marktdaten aktualisieren nutzt denselben gesperrten Jahresprozess wie die vorhandenen Jahreszugänge. Die sieben Karten zeigen Monatsbudget, Handlung, nächste Schritte, Bedarf, Reserven, Markt und Vorher/Nachher-Werte; ab 2300 px nutzbarer Inhaltsbreite stehen Markt, Bedarf und Reserven in dieser Reihenfolge. **Bedarf & Strategie** bündelt die bisherigen Jahres-Update- und Einstellungseingaben; die eigenständige Seite **Ausgaben** zeigt Monatstabelle und Jahresausgaben; **Verlauf** enthält Vermögensstände; **Diagnose** enthält Entscheidungsbaum, Filter und Kopieren. Pfeiltasten sowie Home/End bedienen die Reiter mit übereinstimmender Auswahl und Fokus.

Monatsbudget und vollständige aktuelle Handlungsanweisung stehen bei etwa 1280 px
Inhaltsbreite nebeneinander. Jahresbeschluss und heutige Vorschau bleiben getrennt
lesbar; die Hilfe im Kopf ist über das Fragezeichen erreichbar.

Die Monatsbudget-Karte zeigt bei Kürzung den belegten Grund und den Knopf **Warum?**. Die Treppe enthält nur wirksame Schritte mit Monatsbeträgen aus dem Netto-Flex-Trace; Anhebungen, etwa durch Mindest-Flex, haben ein Pluszeichen. Sie beginnt nach Seitenstart und jedem Ergebnis-/Profilwechsel geschlossen, ohne Speicherung. Ohne Kürzung steht „Dein flexibler Bedarf ist voll finanziert.“; Knopf und Treppe entfallen. Die Marktphase steht in der Marktkarte.

**Details & Drucken** öffnet den vollständigen Handlungsplan in einem modalen Dialog. Quellen und Zweckplan haben jeweils einen sichtbaren Tabellenkopf; Profilnamen bleiben einzeilig und nutzen bei Platzmangel den Tabellenüberlauf. Kopieren und Drucken erhalten Haushalt, Tranchen, Steuern und interne Cashumschichtung. Der Kontextfuß enthält vorhandenes Planungsjahr, Profil-/Haushaltsnamen und Marktdatenstand; die Engineversion steht optional klein am Ende. Die Empfehlung führt keine Brokerbuchung aus. Escape, Schließen oder Außenklick führen zurück zum Auslöser. Meldungen und Recoveryhinweise bleiben unter den Reitern sichtbar. Bei unklaren Jahresbelegen bleibt der Jahresstatus ungeklärt; ein markerloser Bestand ohne Abschlussindiz bleibt nach bestätigter Archivlesung offen; fehlende Nachherwerte werden nicht erfunden.

Der Entwurfsvergleich bei 1920/2560 px, Seitenwechsel/Handoff/Navigationsschutz, Browser-Smoke und Popupdruck sind extern offen. Bestehende Browserfälle nutzen die erhaltenen Reiter- und Dialoganker. Das volle `npm test` fährt der Orchestrator.

Die **Ausgaben** wählen das gespeicherte Jahr über dynamische Jahressegmente. CSV-Dateien mit „Kategorie“ und „Betrag“ werden ausschließlich über die jeweilige Profil-/Monatszelle importiert; die zusätzliche Importkarte entfällt. Vier Kennzahlen stehen in einer gemeinsamen Leiste, die Matrix mit Profilspalten, Summe, Monatsbudget und Abweichung in einer intern scrollbaren Tabellenbox. Fehlende Monate erscheinen als —, erfasste Nullimporte als 0 €. Jahreskennzahlen und Jahresübersicht bleiben auf alle gespeicherten Profile bezogen. Erläuterungen sind über die Info-Tasten erreichbar. Bei beschädigtem Store sind auch die Jahressegmente gesperrt; nach Export und Bestätigung wird der gesamte Ausgabenbereich geleert, alle Jahre und Profile. Abbruch oder Exportfehler lassen die Rohdaten bestehen.

**Verlauf** bündelt die drei vorhandenen Kennzahlen, Diagramm und vollständige Tabelle in einer Karte und nennt das aktive Profil. Er zeigt gespeicherte nominale Gesamtsummen als Linie mit Fläche, echten Datumsabständen und Jahresmarken. Letzter Stand, Höchststand und Bestandsänderung im letzten erfassten Jahr stammen aus gespeicherten Werten; ohne zweiten Stand gibt es keinen Jahresvergleich. Die Änderung enthält Entnahmen und ist keine Rendite. Der Realwertslot und die Realwertlinie des Entwurfs entfallen mangels belastbarer historischer Inflationsbasis. Tabelle, Alt-/Neu-Depotwerte, aktive Profilhistorie und „Stand jetzt erfassen“ bleiben erhalten.


### Diagnose-Reiter und Abschlussbereinigung

Die Diagnose beginnt sichtbar mit Statuschips. Nummerierte Entscheidungsschritte
zeigen Beschreibung, Wirkung und Ergebnis-Chip; Schrittzahl und Filter bleiben
von den tatsächlichen Daten abhängig. Die Transaktion zeigt kuratierte Zeilen
mit Auslösung, Blockierung, Betrag, Tranchenauswahl und Aktien-/Goldgrenzen.
„Geplante Aktion“ nutzt ausschließlich die flüchtige Kurzfassung des tatsächlichen
Handlungsrenderers einschließlich materiellem Haushalt und Cashintegration.
`UIRenderer.getActionSummary()` stellt dieselbe Quelle für Copy bereit;
Initialisierung und Null-/fehlende Aktionen verwerfen alte Kurzfassungen.
Hypothetische Handelswerte bleiben getrennt in den initial geschlossenen
„Technischen Details“. Diese Klappe enthält die vollständige lesende
Transaktionsprojektion mit deutschen Schlüssel- und Regelbezeichnungen.
Copy liest alle Daten unabhängig vom Klappenstatus; Filtersemantik (`inactive`
bei Schritten, `ok` bei Leitplanken), Einheiten und Detailpräzision bleiben erhalten.
Die Leitplanken haben getrennte Karten-/Copywerte und Status-Chips; alle
Kennzahlen stehen in drei Spalten, unter 1180 px in einer Spalte, mit ihren Metadaten.

Der Handlungsdialog ist zentriert (bis 1080 px, Radius 20 px, Innenabstand
26/34/32 px) mit Kurzband, Quellen-/Verwendungs- und Zweckzeilen. Druck und
Schließen stehen oben, Copy außerhalb des ersetzbaren Handlungshosts.
Der Jahresdialog liegt rechts (bis 600 px, Innenabstand 30/34 px) mit einer
lesenden Prozessleiste und Statuszeilen. Die Leiste zeigt vor `confirmed=true`
ausdrücklich unbestätigte Schritte; sie führt keine neue Prozessstufe ein.
Bestätigung, Handkurs, Einmal-Retry, Commit-/Recovery-Sperren, Fokus,
Schließen und Protokoll bleiben beim bestehenden Jahresablauf.

`bindBalanceInfoPopups` bindet statische und dynamische Erläuterungen einmal je
Host. Warn-/Blocknotizen und Kennzahlenmetadaten bleiben sichtbar. Ersetzte
Panel-/Fieldset-/Formularraster-, Ergebniskasten- und Handlungskastenstile sind
entfernt; gemeinsame Suiteconsumer bleiben erhalten. Bekannte ältere Abruftexte
werden nur am Jahresbutton beziehungsweise am zuständigen Anzeigehost deutsch
und ohne Emojis dargestellt, ohne Fach- oder Speichertexte umzuschreiben.
Sicherung, Vertragsinputs, Meldungskanäle, Entwicklerbereich und offener
Cashschritt mit geschütztem Managerweg bleiben angeschlossen.

Gezielte Node-Prüfungen sichern die bestehenden Fach-/Dialogverträge; neue
Prüfinhalte betreffen ausschließlich die gemeinsame Aktionsquelle. Volle Suite
durch den Orchestrator, Browser-Smoke, Bildvergleich 07/08/09 und Abschlussrundgang
01–09 bei 1920/2560 px sowie Kandidaten-EXE durch die Steuerung bleiben getrennt.


### Balance: Schriftskala und Handlungskurzfassung

Alle drei Balance-Reiter und Dialogüberschriften konsumieren die lokalen
`--balance-*`-Tokens aus `css/tokens.css`. h1/h2/h3 sind 30/22/18 px;
Monatsbudget 52/60 px, Handlungsverb 28/30 px und Handlungsbetrag 38/44 px
(Standard/ab 2300 px nutzbarer `balance-page`-Inhaltsbreite). Unter 1180 px
bleiben höchstens die Standardwerte. Die vollständige Skala und Consumer stehen
in `docs/design/designsystem.md`; allgemeine Suite-Tokens bleiben unverändert.

`summarizeBalanceAction` in `balance-action-summary.js` projiziert nach der unveränderten Cashintegration die dargestellten Ströme: Aktienverkauf vor
Goldverkauf/-kauf, Aktienkauf, reiner Cashumschichtung und Nichts-tun. Der Aktienkaufbetrag entspricht ausschließlich der Aktienverwendung; ein gemischter Gold-/Aktienkauf behält den Goldvorrang. Sonstige materielle
Transaktionen zeigen „Handlung prüfen“. Materielle Profilaktionen ersetzen die
Gesamtaktion, externe Nettoquellen schließen Cashtransfers aus.
`#balanceActionTransfer` nennt zusätzliche dargestellte interne Umschichtungen
einmalig; getrennte Profilströme werden nicht zu einem Transfer kombiniert.
Alltagssätze folgen vorhandenen Verwendungen bzw. Blockgründen. Der vollständige,
gegebenenfalls durch Cashintegration ergänzte Titel sowie sämtliche bestehenden
Detail-, Haushalts- und Steuerzeilen bleiben in Details, Copy und Druck erhalten.

`UIUtils.formatBalanceCurrency` zeigt ganze Euro ausschließlich in Budget,
Einkünften, Entnahme, Kürzung, Handlung/Zusatztransfer und Kartenkennzahlen von
Überblick, Ausgaben und Verlauf. Tabellen, Detailzeilen, Charttitel und Copy
behalten ihre Präzision. Große Diagnose-Leitplankenwerte erhalten über
`withGuardrailCardValues` eine separate Ganz-Euro-Kartenanzeige aus dem Rohwert;
Copy liest weiterhin den unveränderten centgenauen `value`.
Numerische Speicher-/Export-/Enginewerte bleiben gleich.
Die Provenienz ist eine kleine Zeile der Marktdatenkarte mit unverändertem
Text-/Datasetvertrag; fehlende Provenienz allein sperrt nichts. `peak_hot` ist
wie der Höchststand positiv in Chip und Karte; der positive Überblick bleibt neutral und die Skala differenziert heiß gelaufen in Messing, bei unveränderter
Phase und unabhängigen Alarmwarnungen. Jahres-/Recovery-/Schreibschutz,
Profil-Handoff, Cashhinweis, Import und Capture behalten ihre bisherigen Besitzer.

Die bestehenden Browser-Grundbedienungsproben prüfen die Skala und Provenienz
zusätzlich; keine neuen Browserfälle und kein geänderter Jahresablauf.
Volle Suite durch den Orchestrator, Browser-/Optik-/Kandidaten-EXE-Abnahme durch
die Steuerung bleiben gesonderte Prüfungen.

### Personen & Vermögen: Startkurse (Paket 5)

Nach erfolgreichem Start der Übersicht werden lesbare Tranchen sämtlicher Profile einmal je Tab-Sitzung aktualisiert, auch außerhalb des Haushalts. Der ortsfeste Kursstatus zeigt bei vollständigem Erfolg genau eine Zusammenfassungszeile. Bei Teil-/Totalfehlern erscheinen nur betroffene Tranchen mit Namen, verständlichem Grund, gespeichertem Kurszeitpunkt in deutscher Ortszeit oder „Kursdatum unbekannt“ und Managerlink. Historische Abrufe zeigen ihr wirkliches Datum; Abrufzeit ersetzt keinen Kurszeitpunkt. Das globale Limit beträgt 15 Sekunden einschließlich Suche, Wiederholung und Speicherbeginn. Sobald ein direkter oder späterer Fallbackkurs fertig ist, endet die Instrumentauflösung spätestens bei 14 Sekunden, damit eine Sekunde für den gemeinsamen Speicherbeginn bleibt. Die direkte Kursrunde behält ihr volles Budget; kommt der erste Erfolg nach 14 Sekunden, wird nach der direkten Runde beziehungsweise sofort nach dem Fallbackerfolg ohne weitere Auflösung gespeichert. Ohne Erfolg bleibt die volle globale Frist verfügbar. Teilkurse gelten erst nach einem gemeinsamen bestätigten Flush als aktualisiert; ein vor Frist begonnener Speicherabschluss bleibt bis Bestätigung oder Rückschreiben geschützt. Erfolglose Tranchen behalten ihren bisherigen Kurs. Teilfehler heißen „nicht aktualisiert“; Antwortzeitüberschreitung, vorübergehender Anbieterausfall, zu viele Anfragen, lokale Auflösungsfrist und globale Zeitgrenze haben eigene Gründe. Nur ein reiner Proxyausfall heißt „Kursdienst nicht erreichbar“. Ohne Sitzungsspeicher oder bei Profil-Recovery startet kein automatischer Abruf.

Seiten- oder Profilwechsel während des Abrufs verwerfen alle Teilergebnisse. Der kurze Speicherabschluss sperrt Navigation bis zur Bestätigung. „Personen & Vermögen“ liest danach die gespeicherten Kursstände; „Kurse aktualisieren“ aktualisiert weiterhin manuell nur das aktive Profil. Balance und Simulator lesen beim Öffnen den gespeicherten Bestand. Personenverwaltung liegt im Personendialog von „Personen & Vermögen“, Backupverwaltung auf der Seite „Daten & Sicherung“; eine separate Seite „Profile & Rente“ wird nicht angelegt. Browser-, Bild- und Kandidaten-EXE-Abnahme durch die Steuerung stehen noch aus.

### Personen & Vermögen: Felder und kompakte Anzeige (Paket 5b, Slice 2)

Karten, Depotkennzahlen, Gruppensummen und Verkaufs-/Cashkarten zeigen ganze Euro;
Kaufpreise und Kurse behalten Cent, Gewinnprozent stehen mit einer Nachkommastelle
unter dem Zeilengewinn. Die gespeicherten Zahlen, Summen und Prozentnenner bleiben
ungerundet. Exakte Cashbeträge sind unter „Exakte Beträge“ erreichbar; die
Bestätigungsdialoge behalten ihre centgenauen Nachweise.

Gold-Strategie, steuerfreie Gold-Verkäufe und aktive Pflegereserve sind zugängliche
Schalter. Ihre bisherigen `true`/`false`-Wertträger und Autosavewege bleiben erhalten,
auch nach Fehlflush, Rückschreiben, Retry und Personenwechsel. Rente aktiv bleibt
sichtbar gesperrt und aus Rente plus sonstigen Einkünften abgeleitet. Einheiten
stehen im Feld; native Zahlentypen, Validierung und Parser bleiben erhalten.
Kauf und Verkauf öffnen auch im Depotkopf dieselben Dialoge mit Rückfokus;
das Menü in Person & Einkommen öffnet die bestehende Personenverwaltung.
Regulär geladene Bestände haben keine dauerhafte Ladekarte, Fehler und Retry
bleiben außerhalb von Technik sichtbar. Browser-/WebView-Zahleneingabe,
Bildvergleich 01–13 bei 1920/2560 px und Kandidaten-EXE bleiben extern abzunehmen.

### Übersicht: Vermögen, Plan, Jahresband und Erststart

Beim Erststart bietet die linke Karte auch **Mit Muster-Haushalt ausprobieren**: den vorhandenen Probelauf direkt mit Muster-Haushalt und heutigem Datum der App-Uhr starten, ohne Startdialog und mit Sicherungspunkt **Vor Probelauf**.

`index.html` zeigt den ausgewählten Haushalt, Depotmarktwerte plus Tagesgeld,
die Allokation und den letzten passenden Balanceplan. Ein fehlender oder
unvollständiger Bestand erscheint ausdrücklich als solcher; Pflegeziele werden
nicht zusätzlich zum Vermögen addiert. Ohne passenden gespeicherten Plan steht
„Noch nicht gerechnet“. Der Plan nennt Entnahme und das davon verschiedene
Monatsbudget mit festen Einkünften. „Fest“ folgt dem bestätigten Jahresabschluss
aller betroffenen Personen, nicht allein einem erfolgreichen Preview.

Oben stehen der nächste Schritt und die Kennzahlen Vermögen, Monatsbudget und
Plan, danach der Vermögensverlauf. Offene Abschlussschritte sind einzelne Zeilen;
erledigte Schritte stehen einmal in „Erledigt (Anzahl)“. Aufklappen schreibt
keine Daten. „Abschluss starten“ steht im Kopf der Fokuskarte. Im ruhigen Zustand
und im ersten Planungsjahr entfällt die Fokuskarte; auf Überschrift und Lead folgen
nur die nächsten Abschlusstermine und gegebenenfalls Tagesgeldwarnungen vor den Kennzahlen. Allokation, Personen,
Jahresband und vollständiger Planvergleich folgen darunter.

Die geschlossene Karte „Daten & Sicherung“ verweist auf Vollsicherung und Einspielen
auf der Sicherungsseite; die Probelaufsteuerung bleibt in der Übersicht. Der
Sicherungslink in der Seitenleiste und der bisherige Importhash öffnen die
Sicherungsseite. Beide Recoveryarten bleiben über geschützte Verweise erreichbar.
Die Sicherungszeit bestätigt die erfolgreich angestoßene Vollbackup-Dateiausgabe
und deren gespeicherten Zeitrecord; das spätere Speichern der Datei durch den
Nutzer ist im Browser nicht nachweisbar. Recoveryexporte setzen diese Zeit nicht.
Personenverwaltung liegt im Manager; seine Dezimalfelder akzeptieren `7,5` und
`7.5` und zeigen gespeicherte Zahlen deutsch ohne Rundung.

Die Fokuskarte prüft zuerst den Abschluss des vorigen Kalenderjahrs für alle
angezeigten Personen, danach den Monatshaken des Vormonats. Legacy- und
Recoveryzustände bleiben ungeklärt. Im Januar gehört der Vormonat zum Vorjahr.
Fehlende Ausgaben und eine alte Sicherung sind Empfehlungen und sperren die
Jahresvorbereitung nicht. „Jetzt sichern“ verwendet denselben Vollbackupknopf.
Die Sicherungspille warnt ab 30 Tagen; vor dem Jahresabschluss wird unabhängig
davon eine Sicherung nach mehr als sieben Tagen empfohlen.

„Abschluss starten“ öffnet den Monatsdialog „<Vormonat> abschließen“ mit vier
Schritten: Kurse, personenbezogene Ausgaben, Budgetvergleich und Tagesgeld mit
Monatsbetrag. CSV-Dateien werden je Person nach Vorschau ausdrücklich bestätigt;
im aktiven Probelauf stehen außerdem Einzel-/Gesamtbeispiele bereit. Bestätigte
Imports bleiben beim Schließen erhalten. Ein echter CSV-Import kann wie in Balance
bei bestätigten frischen Kursen einen Vermögenspunkt erfassen; Folgefehler werden
getrennt gemeldet und nehmen den Ausgabenimport nicht zurück. Beispiele erfassen
kein Vermögen. Fehlende Ausgaben oder Budgets bleiben ehrlich sichtbar und werden
nicht zu zusätzlichen Abschlussbedingungen.

„Tagesgeld-Stand jetzt“ zeigt den ungerundeten bestätigten Quellstand jeder
Haushaltsperson mit Datum. Nach der tatsächlichen Überweisung aufs Girokonto wird
der verbleibende absolute Stand eingegeben; die App rechnet keine Überweisung.
Deutsche Tausendergruppen wie `18.000` und `18000` sind finanziell gleich;
null ist gültig, leere, negative oder ungültige Werte müssen korrigiert werden.
Schließen, Kreuz und Escape schreiben keinen Monat. Bei geändertem oder ungültigem
Cashentwurf fragt der Seitenguard „Bleiben“ oder „Verwerfen“: Nur ungespeichertes
Tagesgeld wird verworfen, bestätigte Imports und Vermögenspunkte bleiben erhalten.
Während eines Commits sind die Schließwege gesperrt.

Bestätigung sichert einen geprüften Wiederherstellungspunkt und speichert Haken,
geänderte Cashstände und Historien gemeinsam mit dauerhaftem Readback.
Unveränderte Werte, Doppelklick und identischer Retry erzeugen keine Zusatzbelege.
Erst danach zeigt dieselbe Dialoginstanz „Alles gespeichert“ mit Ausgaben,
Budgetvergleich, exakten Cashwerten je Person und Summe, Datum und Monatsbetrag
des Folgemonats. `#overviewMonthStatus` meldet „<Monat> abgeschlossen ✓“.
„Fertig“ schließt ohne weiteren Write oder Verlustnachfrage. Speicherfehler erhalten
den Entwurf und bieten „Erneut versuchen“; bei unbestätigtem Rollback bleibt der
Recoveryhinweis sichtbar und der Retry gesperrt. Der Jahresweg liegt direkt auf der Startseite; Balance ist ein alternativer Einstieg in denselben Dialog mit Periodenprüfung, Snapshot und Abschlussbestätigung.
Mehr als 35 lokale Kalendertage seit dem letzten Cashbeleg zeigen pro Person
„Tagesgeld zuletzt am TT.MM.JJJJ aktualisiert“. Fehlende oder zukünftige Belege
lösen keine Alterswarnung aus. Der Link öffnet die passende Person und ihr
Tagesgeldfeld über die vorhandenen Navigations- und Profilwechselwege.
Der Simulator bleibt über die Seitenleiste erreichbar; die Übersicht bietet keine Simulator-Kacheln.
Balancelinks öffnen Jahresvorbereitung oder Ausgaben mit passendem Jahr/Monat;
Importlinks fokussieren den bestehenden Monatsknopf. Der Jahreslink bestätigt
keinen Abschluss, Simulatorlinks starten keinen zusätzlichen Rechenlauf.

Das Jahresband zeigt zwölf Monate: vollständig, unvollständig (schraffiert),
Import fehlt oder noch offen. Nur im Januar mit offenem Vorjahresabschluss
erscheint das Vorjahr; sonst das laufende Jahr bis einschließlich Vormonat.
Nullimporte gelten als vorhandene Daten. Summen enthalten belegte Teilmonate
und kennzeichnen Lücken; Hochrechnung verwendet nur vollständige Monate mit der
bestehenden Regel (Median ab zwei positiven Monaten, sonst Durchschnitt × 12).
Ein fehlender Import gilt nie als sichere Nullhochrechnung. Budgetlinie und
Prozentbezug stammen allein aus einem Plan desselben Jahrs und Haushaltsumfangs;
Altbudgets werden nicht rekonstruiert. Vier Kennzahlen zeigen im Rückblick
Ausgaben, Vermögensvergleich, Überbudgetmonate/höchsten Monat und tatsächliche
Verkäufe mit bestätigtem Netto. Laufend zeigen sie Ausgaben, Hochrechnung,
Vermögensvergleich und Januar als nächsten vorgesehenen Abschlusszeitraum.
„Stand vom“ bezeichnet das Lesedatum des Speicherbestands, kein Importdatum.

Profilgebundene Vermögensverläufe können Haushaltssummen enthalten. Schema 1
belegt weder den damaligen Umfang noch die Mitgliedschaft; eine passende heutige
Plan-Summary liefert diesen Nachweis ebenfalls nicht. Deshalb zeigt der bisherige Jahresvergleich der Übersicht
keine numerische Gesamtänderung aus diesen Schema-1-Ständen, auch im heutigen
Einzelprofil und bei vollständigen Jahresgrenzen oder im Rückblick. Die neue
Tageskurshistorie besitzt eine eigene belegte Bewertung. Beide Vergleichsstellen erklären den fehlenden
Vergleichsstand, die Vermögenskennzahl zeigt `—`. Die Historie bleibt unverändert
in Balance lesbar; die Vermögenskarte zeigt die volle heutige Marktwertsumme.
Gold/Anleihen fehlen zudem im bestehenden Verlauf. Cashbestätigungen und
Korrekturen zählen nicht als weitere Verkäufe.
Ein leerer Defaultbestand zeigt Willkommen: „Eigene Daten anlegen“ öffnet den
Personendialog, „Sicherung einspielen“ den bestehenden Vollimport. Keine Demo;
Recoveryhinweise und der zentrale Sicherungszugang bleiben zugänglich; der Probelauf hat eine eigene geschlossene Zeile.

Die vier Übersichtseinträge heißen `overview_balance_summary_v1` (profilbezogen,
Jahr/Umfang), `overview_month_provision_v1` (profilbezogen, Vormonat/Umfang) und
`overview_simulation_summary_v1` (profilbezogen, Umfang/Art) sowie
`overview_last_full_backup_v1` (global). Summaries und Monatshaken folgen Profilen
und fachlichen Snapshots, die reale Vollsicherungszeit wird dadurch nicht
zurückgesetzt. Vollbackup enthält diese Records, aber kein separates
Snapshot-Archiv; dessen Erweiterung bleibt Paket 6.2a. Die volle Testsuite führt der
Orchestrator aus; Browser- und Bildabnahme bei 1920/2560 px bleiben bei der
Steuerung. Die hier beschriebenen Nodeprüfungen ersetzen diese Abnahme nicht.

### Persistente Datengrundlage für den Tageskursverlauf (P8, Slice 1)

Nach dem bisherigen Startkursjob auf der Übersicht folgt ein eigener Tageskursjob
mit 20 Sekunden Budget. Er lädt die ältesten offenen Werktagsintervalle seriell,
einmal je Symbol über alle Profile. Ein neuer Appstart setzt offene Intervalle
fort; Reloads derselben Sitzung starten keinen zweiten Job. Geprüfte Feiertage
und erfolgreiche leere Antworten bleiben abgedeckt, ohne Kurse zu erfinden.
Drei echte Symbolfehler über getrennte Starts ergeben in den Kursdetails einen
Hinweis mit dem Fehlergrund. Abbruch und Speicherfehler zählen dafür nicht.

Der gemeinsame Beginn wird einmal als 1. Januar des ersten belegten
Planungsjahrs bestätigt und bleibt bei Profilwechsel und Jahreswechsel erhalten.
Globale Schlusskurse und geprüfte Intervalle werden gemeinsam bestätigt.
Bestätigte Tagesgeldänderungen erhalten pro Profil datierte Einträge mit dem
vorherigen Betrag als rückwirkender Basis. Ab jetzt bestätigte Totalverkäufe
bewahren Kaufdatum, Typ und Ticker in einer profilgebundenen Stammdatenkopie;
der aktuelle Tranchenbestand und das bestehende Abgleichsaudit behalten ihre
Verträge. Vor P8 entfernte Tranchen ohne erhaltene Stammdaten können damit
nicht nachträglich vollständig rekonstruiert werden.

Vollbackup und Profilbundle transportieren diese Datengrundlage einschließlich
beider Profilhistorien und Fehlerstatus. Diagramm und Kennzahlen sind in der Übersicht integriert; Personen- und
Tranchenverläufe sowie die Beginnbedienung stehen unter „Personen & Vermögen“.

### Tagesbewertung in der Übersicht (P8, Slice 2)

Der eigenständige Tagesverlauf folgt auf Fokus und die drei Kennzahlen. Die
Diagrammfläche ist etwa 294 px hoch; Jahresband, Allokation/Personen und der
vollständige Planvergleich folgen darunter. Der aktuelle
Bestand behält seinen Kursstichtag; die Verlaufsgrafik zeigt Schlussbewertungen
bis gestern und nennt diesen Tagesabschluss gesondert. „Seit Beginn der
Aufzeichnung“, „Laufendes Jahr“ und „12 Monate“ ändern nur die Ansicht, ohne
Speicherung oder zusätzlichen Abruf. Beginn und Kalendergrenzen begrenzen die
Reihe, nicht die Laufzeit eines Simulationsplans.

Flächen unterscheiden die tatsächlich vorhandenen Anlageformen einschließlich
Anleihen und Tagesgeld, die Linie zeigt den Gesamtwert. Legendenwerte gelten am
Ende der gewählten Reihe. Kauf-/Verkaufsmarken verwenden belegte Bestandsdaten;
Empfehlungen, Preview und Cashbestätigungen sind keine Verkäufe. Ungeprüfte
Werktage sind schraffiert; geprüfte Feiertage schreiben den letzten Schlusskurs
fort. Fehlender erster Kurs, fehlender Ticker, unbekannter Bestand und nicht
unterstützte Währung erzeugen kenntliche Teilabdeckung statt einer erfundenen
Gesamtsumme. Rückwirkend angenommene Tagesgeldbasen bleiben benannt.

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
Die Aktionsknöpfe lassen sich mit Enter oder Leertaste bedienen. Nach Abbruch
kehrt der Fokus zum Knopf zurück, nach Erfolg zur Ergebnismeldung.

Fünf Kennzahlen zeigen Veränderung, Entnahmen, „Ohne Entnahmen gerechnet“,
Höchststand und größten Rückgang. Entnahmen stammen ausschließlich aus erfassten
Tagesgeld-Tagesnettorückgängen: Nur der letzte bestätigte Stand je Kalendertag
zählt gegenüber dem vorherigen Tagesstand. Zwischenwerte bleiben gespeichert;
ein Rückgang mit vollständiger Erholung am selben Tag ergibt keine Entnahme.
Jede Person wird getrennt berechnet, erst danach wird für den Haushalt summiert;
Einzahlungen einer anderen Person kompensieren die Entnahmen nicht.
Verkäufe und Monatshaken werden nicht zusätzlich addiert. Solche Rückgänge
können Transfers enthalten und messen keine Bruttoabflüsse. Die bereinigte Veränderung ist
keine Renditeberechnung; ohne Cashhistorie fehlt sie. Bei offenen Kurslücken oder
angenommener Cashbasis sind berechenbare Werte vorläufig. Fehlen ausschließlich
erste Schlusskurse, beginnen die Kennzahlen vorläufig am ersten vollständig
bewertbaren Tagesabschluss; der tatsächliche „Messbeginn“ wird genannt. Die
unbekannten Tage davor bleiben im Chart ohne Fläche. Entnahmen zählen erst nach
diesem Messtag, dessen Tagesgeld-Rückgänge bereits in der Basis enthalten sind.
Unbekannte Zwischen-/Endpunkte, Bestände, Ticker, Währungen oder Cashbeträge
bleiben sperrend. Das gilt für alle drei Zeiträume. Laufendes oder unterbrochenes Nachladen blockiert die Bedienung
nicht. Personen-/Tranchenverläufe und die Änderung des Beginns sind im Manager verfügbar.


### Personen- und Depotverläufe (P8)

Haushalts- und Personenkarten zeigen dieselben Schlussbewertungen wie die
Übersicht, mit Veränderung nach Entnahmen seit Beginn der Aufzeichnung. Profile
außerhalb des Haushalts haben eine eigene Karte, zählen aber nicht zur
Haushaltssumme. Die aktive Person bleibt eingerahmt. Die aktuellen Bestandswerte
und ihr Buchgewinn bleiben vom historischen Tagesabschluss getrennt.

An der Haushaltskarte lässt sich „Verlauf ab …“ mit einem Datum bestätigen.
Das gemeinsame Datum übersteht Personenwechsel, Reload und Komplettbackup.
Ein früherer Beginn öffnet zusätzliche ungeprüfte Zeiträume, ein späterer
blendet frühere Tage aus. Gespeicherte Kurse werden dabei nicht gelöscht.
Ungültige oder zukünftige Daten sowie Speicherfehler ändern den bestätigten
Beginn nicht. Die Bedienung startet keinen weiteren Download; Nachladen erfolgt
beim nächsten regulären Start auf der Übersicht.

Im Depot zeigen „Verlauf“ und „Entwicklung“ die Kursentwicklung ab dem späteren
Datum von Kauf und Aufzeichnungsbeginn. Verkäufe verändern den Vermögensbeitrag,
aber nicht den Kursnenner. Ein gespeicherter Vorgängerkurs erlaubt die ursprüngliche
Basis. Fehlt nur der Anfangskurs, beginnt der Vergleich vorläufig am ersten
tatsächlichen EUR-Schlusskurs; Zusammenfassung und Detail nennen den Messbeginn.
Ohne Kurs bleibt der Vergleich nicht verfügbar, bei Einzelpunkt oder Nullbasis
fehlt der Prozentwert. Es gibt keinen zusätzlichen Abruf vor Aufzeichnungsbeginn
oder Kaufdatum und keinen heutigen Verlaufskurs.
Der Aufklappknopf ist per Enter/Leertaste bedienbar und erhält seinen Fokus nach
Rerender. Details zeigen Schlusskurse, Kaufpreislinie, belegte Verkaufspunkte,
Stücke heute, aktuellen Bestandswert, Kursdatum und gespeicherte Kursanzahl.
Die Abdeckungsleiste trennt geprüfte Tage, ungeprüfte Werktage und ungeprüfte
Wochenenden. Kein Ticker, beschädigte Historie und nicht unterstützte Währung
werden kenntlich gemacht; Kurs- und Beginnwrites werden bei Fehlern zurückgesetzt.

Vier versionierte Records bilden die Datengrundlage: global
`rs_wealth_history_start_v1` (`version`, `startDate`) und `rs_daily_prices_v1`
(`version`, Symbolrecords mit `currency`, `days`, `closes`, `queried`, `failures`,
`lastError`); profilgebunden `profile_cash_history_v1` (`version`, `baselineValue`,
`entries` mit `date`/`value`) und `profile_wealth_history_lots_v1` (`version`,
`lots` mit `tranche`, `remainingShares`, `capturedAt`, `status`). Schlusskurse,
bestätigte Bestände, Verkaufsbelege und Tagesgeldstände sind die Quellen;
Kaufpreise und heutige Quotes werden nicht als historische Kurse erfunden.
Die technische Referenz beschreibt Kalender-, Commit- und Größenverträge.


### Zentrale Personendaten und Alternativen (Paket 10)

Geburtsdatum, Geschlecht, Rentenbeginn, Monatsrente, sonstige Einkünfte, Rentenanpassung, Kirchensteuer und Sparer-Pauschbetrag werden einmal je Person in „Personen & Vermögen“ gepflegt. Die gekennzeichnete Legacy-Rentensteuerquote bewahrt den bestehenden Partnerrechenweg. Hauptprofilregel, SPB-Summe, Steuergewichtung und Pflegereserve bleiben unverändert. Der vollständige Schlüssel-/Quellenvertrag steht in [TECHNICAL](docs/reference/TECHNICAL.md#zentrale-personendaten-quellen-umstellung-und-rechengrenze).

Personenkarten, geschlossene Personenzusammenfassungen und Startseitenmitglieder zeigen das heutige Alter nach der App-Uhr (im Probelauf nach dem Testdatum). Für die Planung bedeutet Alter unverändert vollendete Jahre am 01.01. des Planungsjahrs. Beispiel 14.03.1958: 67 am 01.01.2026, 68 ab 01.01.2027. Ein Geburtstag am 01.01. wirkt sofort. Ohne vollständiges Datum bleibt ein belegtes Altalter fest; ohne beide Angaben blockiert die Rechnung bis zur zentralen Ergänzung. Der Jahresabschluss und sein Retry erhöhen kein gespeichertes Alter. Für den Rentenbeginn gilt die Regel aus [Rente ab Rentenbeginn](#rente-ab-rentenbeginn): Die Balance zählt den Beginnmonat mit (Juli = sechs Monate); der Simulator zahlt in Entnahmejahren im Startjahr den Kalenderanteil und danach die volle fortgeschriebene Rente.

Die Erstumstellung sichert und liest zuerst einen vollständigen `person-data-migration-recovery`-Snapshot dauerhaft zurück. Widersprüche und unklare Partnerzuordnung verlangen eine Auswahl; Abbruch/Escape erhält fachliche Rohwerte, Reload erlaubt Retry. Der Wiederherstellungspunkt unter Daten & Sicherung → Wiederherstellungspunkte ersetzt Registry und Livewerte vollständig, einschließlich Außenprofilen. Der geschützte Reload prüft alten Bestand erneut. Vollbackup und Import bleiben in Daten & Sicherung → Vollsicherung.

Ohne gemerkten Zustand beginnt Person & Einkommen geöffnet, die beiden weiteren Sitzungskarten geschlossen. Klick/Enter/Leertaste und „Alle aufklappen“ bedienen sie; A/B/A und Sitzungsreload erhalten den Zustand je Person. `rs_manager_person_cards_session_v1` gehört ausschließlich zur Sitzungs-UI, nicht zu Profilen oder Backups.

Simulatoralternativen verschwinden bei Ausschalten, Profilwechsel, Reset und Reload. Fertige Ergebnisse, Protokolle und Downloads behalten ihren eingefrorenen Laufbeleg `personDataContext` (Version 1, Referenzjahr, Januarregel, Profil-ID/Rolle, Profil-/wirksame Werte). JSON-Fingerprints berücksichtigen ihn; CSV ergänzt `personDataReferenceYear`, `personDataDeviationApplied`, `personDataChanges`. Vorhandene Pflicht-/Finanzspalten und lesbare Altdateien ohne Kontext bleiben erhalten. Abweichende Replay-Arbeitsstände bleiben dokumentlokal und sind nur ausdrücklich als Datei exportierbar.

Quell-/Node-Prüfungen ersetzen keine Bedienabnahme: Die Steuerung bestätigt die zehn Abläufe und vergleicht Entwurfszustände 01–07 bei 1366/1920/2560 px, zusätzlich schmale Breite und lange Namen. Browser, Bilder, Windows-Kandidaten-EXE und WebView bleiben bis tatsächlicher Ausführung offen. Die volle `npm test`-Suite fährt im orchestrierten Lauf allein der Orchestrator; gezielte Tests und Browser-Syntax prüft der Implementierer. Das separate win32/x64/Node-v25.2.1-Charakterisierungsgate bleibt bestehen.

### Personenumstellung und Rechenbereitschaft (Paket 10b)

Die Rückfrage zeigt deutsche Feldnamen und Radiokarten mit dem Profilvorschlag. „Später“ und Escape erhalten die Fachwerte und erlauben Navigation ohne Umstellungswarnung; auf der nächsten Seite wird erneut gefragt. Bis zur Übernahme bleiben davon abhängige Rechnungen und Writes gesperrt. Bei „Übernehmen“ bleiben Quellenwahl und Dialog bis zum dauerhaften Schreib-/Readbackabschluss eingefroren und fokussiert. Beide Personenmarker und alle Registrykopien müssen bestätigt sein; mehrere Personen und Partner werden gemeinsam übernommen. Fehler bleiben im offenen Dialog sichtbar, Rechner und Felder bleiben gesperrt. „Jetzt übernehmen“ lädt nach Erfolg höchstens einmal neu und gibt die alten Felder vorher nicht frei. Ein sofortiger Neustart fragt nicht erneut; Zukunftsrente, Betrag und Herkunft bleiben erhalten. Dialogtexte und Optionen haben 16 px, Titel 32 px und Knöpfe 14 px, auch auf der kompakten Balance.

Nach ausdrücklich bestätigter erfolgreicher Übernahme verweist ein ruhiger Hinweis bei fehlendem Geburtstag ohne Altalter auf „Geburtsdatum einmal ergänzen“.

Dieser benannte Folgehinweis bleibt auf Startseite und Simulator nach abgeschlossenem Seitenstart und erneuter Bereitschaftsanzeige im selben Dokument sichtbar, auch für Außenpersonen. Aktuelle Sperrbegründungen und Altalterhinweise stehen bei Bedarf daneben. Ein vollständiger Haushalt bleibt trotz unvollständiger Außenperson rechenfähig. Der Hinweis wird weder gespeichert noch in ein frisches Dokument übernommen; aktuelle Profile oder eine konfliktfreie automatische Migration erzeugen ihn nicht. Speicherformat, Haushaltsmitgliedschaft und Finanz-/Engine-Semantik bleiben unverändert.

Simulator und Balance unterscheiden fehlende Angaben von technischen Speicherfehlern. Der Simulator lädt zuerst den Profilkontext; ohne Geburtstag oder belegtes Altalter überspringt er den Öffnungs-Backtest mit Name und Ergänzungslink. Auch programmatisches Rechnen bleibt gesperrt. Unvollständige Partner sperren den gewählten Simulatorhaushalt, Außenprofile nicht. Balance rechnet mit den angehakten Haushaltsmitgliedern, unabhängig von der geöffneten Person. Ist nur B ausgewählt und A geöffnet, stammen Alter, Einkommen, SPB und Kirchensteuer aus B; fehlende Angaben bei A sperren B nicht. Ohne Auswahl rechnet die geöffnete Person allein, der Kopf zeigt „Haushalt: Keine Auswahl“. Vermögensanzeige und vorhandene Ergebnisse bleiben verfügbar. Der leere Erststart behält seinen Dokumentstandard ohne erfundene Profilgeburtstage.

Geburtsdatum, Rentenbeginn und Ergänzungsband verwenden `TT.MM.JJJJ`, gespeichert wird weiterhin ISO. Die Personenkarten bieten Renten-/Kirchensteuersegmente; vorhandene Inflation und andere gültige Altsätze bleiben erhalten. „Rente aktiv“ ist ein abgeleiteter Hinweis. Quellenloses Geschlecht bleibt rechnerisch `m` und zeigt „bitte prüfen“; erst bewusste, dauerhaft gespeicherte Bestätigung entfernt die Herkunft „angenommen“.

### Rente ab Rentenbeginn

Bei fehlendem Rentendatum ist ein positiver migrierter Versatz an `profile_person_migration_v1.referenceYear` gebunden: Beginn ist der 01.01. des Referenzjahres plus ursprünglichem Versatz. `projectPerson()` liefert `max(0, referenceYear + renteStartOffsetJahre - year)`, vor Beginn null Rentenmonate/-betrag und ab Beginn zwölf Monate. Positive Versätze ohne gültige datierte Herkunft werden kontrolliert abgewiesen. Fehlender oder nullwertiger Versatz bleibt mit laufender Zwölfmonatsrente kompatibel; sonstige Einkünfte wirken stets unabhängig ganzjährig. Projektion verändert keine Profil- oder Migrationbytes.

Der Simulator erhält die originale Monatsrente, den im jeweiligen Planjahr wirksamen Versatz und zwölf Startmonate. Referenzjahr 2026 mit Versatz 2 ergibt 2026/2027/2028/2029 die Versätze 2/1/0/0 und Balance-Jahresrenten 0/0/12.000/12.000 bei 1.000 monatlich. Ein bloßer Januarvorschlag ersetzt kein bestätigtes Datum. Ein expliziter Beginn hat Vorrang, einschließlich Juli-Teiljahr mit sechs Monaten. Kalender- und Betragsfehler bleiben kontrollierte Fehler.

Die Monatsrente in Personen & Vermögen ist die erwartete Nettorente in heutigen Werten. Die Balance berücksichtigt sie erst ab dem angegebenen Rentenbeginn, einschließlich des Beginnmonats: Juli bedeutet sechs Monate, Dezember einen Monat. Sie zeigt den Jahresdurchschnitt; sonstige Einkünfte wirken unabhängig ganzjährig. Ohne Datum und ohne positiven ursprünglichen Migrationsoffset sowie ab dem datierten Altbeginn oder bei vergangenem explizitem Beginn gelten zwölf Monate. Der Simulator passt die volle Basis weiterhin ab dem ersten Planungsjahr an. In Entnahmejahren zahlt er im Startjahr den Kalenderanteil, danach die volle fortgeschriebene Rente für Hauptperson und Partner. In Ansparjahren bleiben dagegen `rente1`, `rente2`, `renteSum` und `pension_annual` exakt null: Als externe Wertflüsse werden nur Cashzins und Sparrate verbucht. Cashende entspricht Anfangscash plus Zins und Sparrate abzüglich Aktien- und Goldkäufen. Belegte Kalenderbeginne wirken ausschließlich auf das Liquiditätsziel und damit auf die Cash-/Kaufverteilung, anhand der zeitanteiligen fortgeschriebenen Eigenrentenbasen und beim Partner vor seiner Steuerquote (`rente2BruttoEigen`). Bei vollem Kalenderfaktor entsprechen Zielbasis und Kauf-/Cashverteilung dem Altpfad, auch mit positiver Partnersteuerquote. Ohne Kalendermarker bleiben die bisherigen Ziele und Wertflüsse erhalten. Die Nullspalten kürzen keine Rentenbasis; das erste Entnahmejahr verwendet die unveränderte volle fortgeschriebene Basis mit bisherigen Renten-/Steuerregeln. Protokoll sowie JSON-/CSV-Exporte übernehmen diese tatsächlichen Jahreswerte ohne erneute Kürzung oder Ersatzwerte; fertige Laufbelege bleiben an ihren Lauf gebunden.

Die gesicherte Personenübernahme schlägt grundsätzlich den Profilwert vor. Ausnahme: Profilbetrag null oder altes explizites Nein mit belegter positiver künftiger Simulatorrente und eigenem Startoffset größer null. Dann lautet der Vorschlag „künftige Rente aus dem Simulator“; Betrag und Beginnherkunft bleiben gekoppelt. Ein vorhandenes Datum bleibt erhalten, ein fehlendes Datum behält den gekennzeichneten Januarvorschlag. Andere Quellenwahl und Abbruch bleiben möglich. Kalender-/Statusanzeigen schreiben keine Profile.

### Startseite: letzte Ergebnisse und offene Arbeit (Paket 13)

Im ruhigen Zustand und im ersten Planungsjahr zeigt die Übersicht keine
Durchspielen-Karte oder Simulationsergebnisse. Überschrift und Lead mit Links auf
offene Schritte bleiben erhalten, ebenso die nächsten Abschlusstermine und
gegebenenfalls der Hinweis auf veraltetes Tagesgeld. Monats- und Jahreskarten
bleiben bestehen. Der Simulator ist über die Seitenleiste erreichbar.
Gespeicherte letzte Simulationsergebnisse bleiben in Profilen und Sicherungen
enthalten; die Übersicht lädt sie nicht mehr.

Werkstattabschlüsse entstehen nur durch einen expliziten erfolgreichen Vergleich
mit vergleichbarer Alternative und passendem Herkunftsbeleg. Dieser dokumentlokale
Beleg wird am Beginn des ursprünglichen Monte-Carlo-Laufs an dessen Inputs gebunden
und erst nach erfolgreichem Fixieren dem Arbeitsstand zugeordnet. Vor dem Vergleich
müssen Fingerabdruckversion, Profilidentität, Haushaltsumfang und Quellenbasis noch
passen; Änderungen während des Vergleichs erhalten die eingefrorene Basis und
machen den gespeicherten Abschluss veraltet. Ein neuer MC-Kontext etikettiert keinen
alten Arbeitsstand um. Öffnen und Import rechnen den Vergleich weiter, ersetzen
aber weder Abschlusszeitpunkt noch Quellenfingerabdruck. Nach Reload/Import fehlt
der Beleg: Auch „Neu berechnen“ und Variantenänderungen erhalten dann den letzten
gespeicherten Simulationserfolg. Für einen neuen gespeicherten Simulationseintrag einen neuen MC-Lauf fixieren und
eine Alternative vergleichen. Replay, Exporte und Persistenzfelder bleiben gleich.
Bereits früher falsch gestempelte Einträge werden nicht repariert, da ihre
ursprüngliche Quellenbasis nicht zuverlässig rekonstruierbar ist.

Liquidität unterscheidet „heute“ und „nach Umsetzung“; alte Einträge ohne Istwert
zeigen „Heute unbekannt“. Entnahme und Budget sind Planwerte. Balance „Und jetzt?“
und Übersicht verwenden dieselben offenen Pflichtschritte.
Die verbindliche Handlungsanweisung des laufenden Planjahres stammt ausschließlich
aus dem gespeicherten Jahresbeleg (`adopted.action`), einschließlich Abschlussdatum.
Die heutige Rechnung ist eine vorläufige Vorschau, als wäre heute Jahresabschluss;
sie wird erst im nächsten Jahresabschluss verbindlich. Die Umsetzung bleibt deine
Entscheidung, ohne Ablage oder Umsetzungsbestätigung. Monatsbestätigung
belegt nur die Bereitstellung. Handlungsanweisungen und fehlende oder veraltete
Vorschauen erzeugen keine offenen Schritte. Die seitliche Navigation bleibt beim Scrollen sichtbar und
scrollt bei geringer Fensterhöhe intern. Tagesfelder im Verlauf stehen seitlich
neben der Hilfslinie; „Tagesgeld (stufig)“ bleibt der gestapelten Legende vorbehalten.


### P16, Slice 1: vereinfachte Simulator-Eingaben

Monte-Carlo startet direkt in der Ergebniskarte „Reicht das Vermögen?“ oder mit `mcButton`
in der Karte „Einstellungen“ des Monte-Carlo-Reiters, auch bei geschlossenen Optionen.
Beide Knöpfe heißen zunächst „Monte-Carlo rechnen“, nach erfolgreichem Lauf „Monte-Carlo neu rechnen“.
`initializeResultOverview()` delegiert beide Starts an denselben `runMonteCarlo` ohne Reiterwechsel;
nur „Einstellungen ändern“ in der Ergebniskarte öffnet den Monte-Carlo-Reiter. Der bestehende
Run-Guard verhindert Doppelläufe. Beide Hosts spiegeln Vorbereitung, Prozentfortschritt,
fertig gerechnete Läufe, Auswertung, Abbruch und Fehler aus einem dokumentlokalen UI-Zustand.
Der Zähler stammt aus fertig gerechneten Läufen beziehungsweise abgeschlossenen Workerchunks;
Auswertung und seriell/paralleler Vergleich werden als Phase bezeichnet und nicht in Läufe umgerechnet.
Ein Neurender der Ergebniskarte erhält Bedienung und Zustand. Abbruch oder Fehler erhalten den
letzten erfolgreichen Ergebnisstand; Änderungen der Annahmen markieren ihn wie bisher als veraltet.
Nicht berechenbare Backtest-Kürzungen nennen den Grund, etwa „Nicht vergleichbar: Entnahmebasis
wechselt“. Ein Zweiprofilhaushalt allein ist kein Fehler; gemischte Flex-Basen bleiben unauswertbar.
`mcSetupDisclosure` und `mcAdvancedDisclosure` beginnen bei jeder Initialisierung geschlossen,
ohne Speicherwrite für Klappzustände. „Einstellungen anzeigen“/„Einstellungen ausblenden“
synchronisieren ARIA. Erweitert enthält RNG, Workerzahl, Zeitbudget, Vergleich und Telemetrie;
die Kurzzeile meldet nur Abweichungen von per-run-seed, 8 Prozessen, 500 ms und ausgeschalteten Diagnosen.
Ungültige Werte öffnen die nötigen Klappen und fokussieren das konkrete Feld.

Personenkarten zeigen übernommene Werte als deutsch formatierte Liste. Erst der flüchtige
Abweichungsmodus versetzt dieselben Editor-Knoten aus dem verborgenen Cache in die Karten.
IDs und Listener bleiben einmalig; Ausschalten, Reset, Profilwechsel und Reload verwerfen den Entwurf.
Die gemeinsame Rentenanpassung folgt dem Hauptprofil; fertige Ergebnisse behalten ihren Laufbeleg.

Die Ansparbedienung samt Init-, Sperr- und Speicherwirkung ist entfernt. Die vier alten Schlüssel
`sim_accumulationPhaseEnabled`, `sim_accumulationDurationYears`, `sim_accumulationSparrate`
und `sim_sparrateIndexing` bleiben bei Laden, Import und Reset unverändert erhalten.
Gewöhnliche Profilsicherungen ergänzen fehlende Livefelder aus der Registry; ein
Teilbestand löscht deshalb keine Personen-, Vermögens- oder Tranchendaten.
Der bestätigte Simulatorreset benennt dagegen die zu löschenden Simulatorparameter
ausdrücklich: Er entfernt zuerst deren Registrykopien, danach die Livewerte und
bestätigt beide Änderungen mit demselben Flush. Gelöschte Parameter bleiben nach
Reload, Indexstart und Profilwechsel entfernt. Ungültiger Profilkontext oder
unlesbare Livewerte verhindern die Löschung; Flushfehler verhindern den Reload
und erlauben einen gemeinsamen Speicherretry. Eine unvollständige Resetmutation
benötigt Neuladen/Recovery und kann nicht durch einen reinen Flush bestätigt werden.
DOM-/Profiladapter liefern Ansparen aus, Dauer/Sparrate/Übergangsjahr 0 und Übergangsalter gleich Startalter.
Explizite DOM-freie Ansparrechnungen bleiben unverändert. Merker für eine spätere Neukonzeption:
noch arbeitende Person mit Sparrate und Rentenbeginn aus Personen & Vermögen.

Browserfälle warten beim Verlaufsresize auf SVG-Ersetzung und passende reale Hostmaße;
die Pflegemessung aktiviert ausdrücklich Annahmen. Der gewollte Ergebnisstart bleibt erhalten.
Node-Prüfungen und Browserregistrierung ersetzen keine Browserabnahme. Browser-Smoke,
Personenkartenbilder bei 1366/1920/2560 und das Plattformgate sind extern offen;
die volle Node-Suite führt im orchestrierten Lauf der Orchestrator aus.


### Protokolle und Kernantworten

In der Ergebnisansicht stehen die beiden vorhandenen MC-Kernantworten neben dem Backtest oben; der MC-Detailreiter behält sie vor Kennzahlen und Grafiken. Die Antworten lauten „Ist mein Grundbedarf gedeckt?“
und „Muss ich mich einschränken?“. Die großen Werte übernehmen die bestehende Deckungsquote
und `cutYearSharePct.p50` als Prozentanteil der Jahre; der Satz ergänzt `kpiMaxKuerzung.p50`.
Der Anteil zählt abgeschlossene Entnahmejahre mit Flex-Kürzungen ab 10 %; sein Nenner
sind abgeschlossene Entnahmejahre mit endlicher Kürzungsentscheidung. Flex-Bedarf meint
frei planbare Ausgaben. Beide p50-Werte sind Mediane und können aus unterschiedlichen
Läufen stammen. Zeitraumende ist kein nachgewiesenes Lebensende. Nur ein vollständiger
simulierter Todpfad erlaubt die entsprechende Lebensendaussage. Technische Fehler sind
nicht auswertbar, fehlende Angaben bleiben „—“; Legacy-Ergebnisse tragen den fehlenden
Endzustandsbeleg ausdrücklich. Rechnung, Ergebnis-/Exportverträge und Finanzwerte bleiben gleich.
Nach wirksamer Annahmenänderung zeigen beide Antworten denselben Hinweis „Annahmen seitdem geändert“
wie das MC-Ergebnis. Reiter-/Klapp-/Detailwechsel erhalten Zahlen und Laufbeleg; erst ein
neuer vollständiger Run ersetzt Antworten und Status gemeinsam. Das verfügbare Backtest-Endjahr und fehlende Vorjahresabdeckung stehen vollständig im bestehenden Backtest-ⓘ. Entnahmen, Kürzungsjahre und Steuern sind kompakter angeordnet; Fehlgründe und Datenwarnungen bleiben erhalten.

MC- und Backtestprotokolle gliedern sich in Jahr / Alter, Personen, Entnahme und Rente,
Strategie, Marktphase, Handlung, Vermögen am Jahresende und Pflege. Die MC-Personenspalten
verwenden Profilinitialen mit vollständigem Namen in der Erklärung; der Backtest zeigt keine
Personenspalten. „Detailliert“ erweitert sichtbare Spalten; „Pflege-Spalten“ wirkt nur im MC
bei zugleich aktivierter Detailansicht. Der Backtest zeigt nie Pflege. Gold bleibt modulabhängig,
Bonds bleiben 3-Bucket-abhängig. Die vorläufige Entnahmequote erscheint nur unter Details.
58 interne Rechenspuren sowie die sechs bisherigen Personen-Einzelspalten sind ausschließlich
im vollständigen Export enthalten. Standard-/Detailansicht und Downloads lesen dieselbe
unveränderte Ergebnisquelle; kein Schalter verändert Rohwerte oder Exportvollständigkeit.

Die Node-Nachweise und registrierten Browserfälle sind getrennt von ausgeführter Browserabnahme.
Extern offen bleiben Grundbedienung Ziel 10/10, MC-Bilder bei 1920/2560 px und
„Simulator · Annahmen“ bei 1366/1920/2560 px, einschließlich Abweichungsmodus und Partnerfall.
Die Bildabnahme verlangt kein „abgeschnitten“; `mc-bilder.mjs` bleibt ein externes Werkzeug
ohne Repositoryänderung. Browser-/WebView-/Druckabnahme und das gepinnte
win32/x64/Node-v25.2.1-Charakterisierungsgate bleiben eigene Nachweise. Unter Linux wird
`tests/simulator-backtest-characterization.test.mjs` nicht separat ausgeführt; weder Baseline
noch Runnerpolicy ändern sich. Die abschließende volle `npm test`-Suite führt ausschließlich
der Orchestrator außerhalb der Sandbox auf dem fertigen Stand aus. Sandboxverbote für
Browser, Ports oder Kindprozesse sind weder Produktfehler noch ein positives Gate.

### Probelauf mit Kopie oder Muster-Haushalt

Auf allen sieben Seiten startet **Probelauf …** rechts in der Kopfzeile eine Kopie
oder den Muster-Haushalt. Alltags-EXE, Kandidaten-EXE sowie Browser über http, https
und file sind ohne Freischaltparameter verfügbar. Unbekannte Laufzeiten bleiben
gesperrt. Bei aktivem Lauf ersetzt das bestehende Band den Startknopf. Fortschritt,
Speicherwarten und Fehler erscheinen sichtbar unmittelbar unter der Kopfzeile.

Beim Seitenstart bleiben Profil- und Personenfelder bis zur bestätigten Bereitschaft
gesperrt. Nach „Übernehmen“ erfolgt die Freigabe erst nach dauerhaftem Quellenwert
und bestätigter Schemaversion; bei Fehler oder Recovery bleibt die Sperre erhalten.
Bandknöpfe erklären ihre Sperre über einen konkreten Hinweis. Vollsicherung und
Import melden auch auf einer im Recovery blockierten Startseite sichtbar ihre Sperre.

Vor der Datumauswahl wird **Vor Probelauf** dauerhaft gespeichert und rückgelesen.
Die Auswahl bietet **mit meinen Daten (Kopie)** oder **mit Muster-Haushalt**.
Der Kopiepfad verwendet den Arbeitsbestand und einen unveränderlichen vollständigen
Rückkehrpunkt; es entsteht kein Export mit echten Haushaltsdaten. Der Musterpfad
ersetzt den Arbeitsbestand durch zwei Profile **Max** / **Erika** mit
zusammen 790.000 € (700.000 € Aktien, 60.000 € Geldmarkt, 30.000 € Tagesgeld).
Max hält 180.000 € Altaktien, 180.000 € Neuaktien, 36.000 € Geldmarkt und 18.000 € Tagesgeld
(414.000 €); Erika hält 160.000 € Altaktien, 180.000 € Neuaktien, 24.000 € Geldmarkt und
12.000 € Tagesgeld (376.000 €). Der Haushaltsbedarf beträgt jährlich 30.000 € Floor
und 30.000 € Flex, mit 7.500 € Mindest-Flex; der Simulator-Override stimmt damit überein.
Die erwarteten Nettorenten in heutigen Werten nach Kranken- und Pflegeversicherung
betragen monatlich 2.300 € / 1.600 €. Im Startjahr hat Max zwölf und Erika keine
Rentenmonate, im Folgejahr Erika sechs, danach zwölf. Der feste Startjahrplan enthält
2.700 € Monatsentnahme und 5.000 € Monatsbudget; die Modellrechnung wendet zusätzlich
die bestehenden Budgetregeln an. Der echte Balance-Durchstich für frische Starts
2026, 2027, 2031 und 2060 ergibt 2.400 € Monatsentnahme, 144.000 € Liquiditätsziel,
62,5 % Deckung und eine strukturierte finale Haushaltsaktion mit Profilattribution.
Ein 2026 gestarteter und nach 2027 fortgesetzter Lauf behält dagegen Erikas sechs
Rentenmonate; er wird beim Datumssprung nicht neu erzeugt.

Der Musterstart ist ab 01.01.2026 möglich und startet ohne offene Abschlüsse.
Vorjahr und Vormonat sind für beide Personen bestätigt, der Startjahresplan ist fest.
Ausgaben reichen bis zum Vormonat; Tagesgeld ist zum ersten Tag des Startmonats
bestätigt. Erst ein späterer Monats- oder Jahreswechsel macht neue Abschlüsse fällig;
beim Jahreswechsel hat der Jahresabschluss Vorrang. Geburtsdaten 14.03.1958 /
22.08.1961 und Rentenbeginn 01.01.2023 / 01.07.2027 sind die Referenz für 2026.
Bei einem frischen Start werden diese Daten und die Neuaktien-/Geldmarktkäufe um
Startjahr minus 2026 verschoben: Max/Erika bleiben am Januarstichtag 67/64 Jahre.
Altaktien behalten das Kaufdatum 15.06.2016. Der Vermögensverlauf beginnt am
Vorjahresbeginn; historische Stände verwenden damalige synthetische Kurse und
Cashwerte. Ab Startjahr 2027 enthält er einen Vorjahresabschluss zum 31.12., immer
einen Eröffnungsstand zum 01.01.; für 2026 wird kein unzulässiger Jahresstand 2025 erzeugt.

Alle Wertpapierkurswege sind im aktiven Probelauf lokal synthetisch: automatische
und manuelle Quotes, ISIN-/Symbolsuche, Healthprüfung, Charts sowie Jahresend-/ATH-Kurse.
Derselbe Symbol-/Datumswert ist unabhängig von Profil, Reload und Aufrufreihenfolge.
Werktage sind Montag bis Freitag; Wochenendquotes verwenden den letzten Werktag,
mit festem Stichtag 00:00 UTC. Der Verlauf reicht einschließlich Testdatum.
Start und Datumssprung erneuern Quote-/Verlaufscaches; reale oder spätere Kurse
bleiben ausschließlich im Rückkehrpunkt. Außerhalb des Probelaufs gelten unverändert
die bisherigen Kursanbieter und das Verlaufsende gestern. Im Probelauf sind Kurse,
Inflation und CAPE synthetisch. Inflation hängt allein vom abgeschlossenen Jahr ab
(1,5–3,0 Prozent); CAPE folgt dem synthetischen VWCE-Jahresendkurs (20–35).
Der Jahresabschluss benötigt dafür weder Netz noch manuelle Marktdaten. Ergebnisse
und Protokoll nennen „Probelauf · synthetisch“. Pflichtprüfungen, Tagesgeldbestätigung,
Recovery-Snapshot und dauerhafte Abschlussbestätigung bleiben erhalten.

Das Band auf allen fünf Seiten zeigt Testdatum und Testbetrieb. **+1 Tag**,
**+1 Monat** (mit Monatsendbegrenzung) und **Datum wählen …** ändern das fachliche
Jetzt auf lokale 12 Uhr. Renten-/Altersprojektionen und Jahresabschluss behalten
ihre vorhandenen Jahres-/Stichtagsregeln; technische Fristen und Engineformeln
bleiben unverändert. Datumssprünge löschen die Kurs-/History-Sitzungssperren und den
Jahresretrykontext und laden geschützt neu.

**Probelauf beenden** stellt nach Rückfrage den vollständigen ursprünglichen
Keyumfang samt Rohstrings wieder her, entfernt Testrecords und neue Test-Snapshots
und bewahrt alte Archivpunkte sowie **Vor Probelauf**. Nach bytegleichem Readback
in Backend und Cache werden Testdatum, Steuerzustand und Kurs-/History-/Retry-Sitzungen
entfernt. Die Rückkehr öffnet `index.html` mit echtem Datum und neuem Abruf echter
Kurse; normale Startschreibvorgänge der Übersicht sind danach erlaubt. Fehlgeschlagene Wiederherstellung bleibt mit
Snapshot-ID gesperrt und ist wiederholbar. Bei fehlgeschlagenem Reload bleiben
Eingaben im alten Dokument gesperrt. Vollbackup-Importe und andere Snapshot-Restoreaktionen
sind während des Probelaufs gesperrt. **Vollsicherung und Vollimport** zeigen auch
über „Jetzt sichern“ im Fokus einen sichtbaren Sperrhinweis. Direkte Backup- und
Importaufrufe sowie programmatische Dateiauswahl bleiben ebenfalls gesperrt:
Es entstehen weder Vollbackup-/Recovery-Dateien noch zusätzliche Import-Recovery-
Snapshots; Sicherungszeit und vorhandene Archivpunkte bleiben unverändert.
Die Sperre gilt bereits beim Start und bei der Wiederherstellung sowie bei
beschädigtem oder nicht sicher lesbarem Probelaufzustand. Nach erfolgreichem
Beenden und neuem Seitenstart sind die Aktionen wieder verfügbar. Der Parameter
`?probelauf=1` allein sperrt ohne gestarteten Lauf keine Sicherung und keinen Import.
Node-Prüfungen sind vorhanden; echte
Browser-, Druck- und Kandidaten-EXE-Abnahme bleibt extern offen.


### Gemeinsamer Jahresstatus und erster Planungsmonat (Paket 12, Slice 1)

`app/shared/planning-start.js` besitzt die DOM-freie P6c-Regel: Perioden-, Vermögens-, passende Summary- und Ausgabenbelege sowie die eng begrenzte Vorjahresinitialisierung bestimmen den Beginn. Quellfehler bleiben sichtbar. `deriveOverviewPlanningStart()` ist der kompatible Datenadapter; Startseite, Balanceüberblick und Abschlusskoordinator verwenden dieselbe Regel und die fachliche App-Uhr.

Der Periodenstand wird getrennt von den Haushaltsmitgliedern über seine Profilidentität projiziert: Liveüberlagerung beim geöffneten Writer, sonst Registry. Eine eindeutige bestehende Abschlussablage genügt auch ohne persönlichen Balance-Stand jedes Mitglieds; identische Kopien dürfen übereinstimmen, widersprüchliche Ablagen verlangen Klärung. Fremde bestätigte Quellen benötigen eine Anzeige für den exakten Umfang. Pending bleibt Recovery, beschädigte Quellen bleiben gesperrt. Der gemeinsame Plan passt ausschließlich zu Jahr und Scope und wird niemals aus Haushaltsergebnissen aufsummiert. Es werden keine neuen Abschlussmarker angelegt oder Periodenmetadaten auf Personen verteilt.

Liegt der Vormonat vor dem ersten Planungsjahr, zeigt die Startseite den ruhigen Zustand `start`, keinen Dezemberabschluss und keine Bereitstellung. Balance zeigt „Erstes Planungsjahr 2026 · erster Jahresabschluss Anfang 2027“. Der Kopfknopf öffnet einen schreibfreien Hinweis; alter Jahreslink und Ausgabenjahrkorrektur umgehen die Grenze nicht. Ab Februar wird Januar angeboten, ab Anfang 2027 der erste Abschluss 2026. Vorjahresbelege, Legacyprüfung, Recovery und Finalisierungsreadback behalten ihren Schutz.

Paket 12c erhält den ruhigen Hinweis nach Ende des vollständigen Kopfhandlers und beim alten Jahreslink, auch wenn der Überblickszugang fachlich deaktiviert ist. Technische Sperren bleiben wirksam. Eine gültige leere Vorjahresinitialisierung mit offenem ausgewähltem Periodenstand zählt eigenständig: Eine später automatisch gespeicherte Summary oder Vermögensanzeige 2027 verdrängt den Beginn 2026 nicht. Das Minimum früherer gültiger Belege bleibt maßgeblich; beliebiges `activeYear`, fremder Umfang und beschädigte notwendige Quellen erzeugen keinen Beginn. Der echte Balance-Summarywriter bleibt aktiv.

Die Browserfälle „Stabiler Planungsbeginn nach Balanceöffnung“, „Household annual source“ und „First planning year“ sind registriert. Ihre tatsächliche Ausführung und die externe Browser-/WebView-Abnahme bleiben offen; Nodebelege ersetzen sie nicht. Der bestehende Fall „Suite frame profile context“ bleibt unverändert.

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


### Einkommen heute und Sitzungskarten (Paket 12e)

„Einkommen im Monat, netto“ in Personen & Vermögen zeigt laufende Renten plus sonstige Einkünfte am heutigen App-Datum. Der Beginnmonat zählt vollständig, auch bei einem Beginn am 15. des Monats. Sonstige Einkünfte zählen unabhängig davon. Die erwartete Rente an jeder Person bleibt mit künftigem Beginn gekennzeichnet. Für Haushalt und Einzelprofil gelten dieselben Regeln; Außenprofile fließen nicht in die Mehrpersonen-Haushaltssumme ein.

Bestätigte künftige Rentenbeginne ergeben chronologisch kumulierte Stufen `ab MM/JJJJ`. Die nächsten zwei stehen sichtbar; weitere Änderungen sind über die ⓘ-Hilfe mit Maus und Tastatur erreichbar. Ein fehlender bestätigter Beginn mit noch künftigem datiertem Altbeginn zeigt „Rentenbeginn fehlt“, ohne eine Vorschlagsstufe auszugeben. Das Testdatum im Probelauf gilt als heute; ein vorgerücktes Balanceplanungsjahr verändert diese Anzeige nicht. Die jahresbezogene Budgetrechnung bleibt erhalten.

„Alle aufklappen“ richtet sich nach den tatsächlich geschlossenen Regionen. Sind alle offen, zeigt der Knopf „Alle zuklappen“. Gesamt- und Einzel-ARIA folgen den Regionen; die Sitzung merkt den Zustand je Person. Reines Klappen speichert keine Finanzdaten. Nodebelege und Browserfall „Einkommen heute und Gesamtklappen“ sind ergänzt; externe Browser-, Bild- und Bedienabnahme bleiben offen.

Beim Jahresabschluss enthält der vorhandene Vorbereitungsdialog dieselben Personenfelder
unter „Tagesgeld-Stand zum Jahresende“. Bis zur Zustimmung gibt es keine Cashwrites.
Der ursprüngliche Jahres-Recovery-Snapshot bleibt der einzige Sicherungspunkt,
auch bei Handkursfortsetzung. Die Finalisierung bestätigt Periode, Cashstände,
Historien und ab 2026 den passenden Jahres-Vermögenspunkt gemeinsam. Cashbelege
tragen den lokalen Bestätigungstag; der Jahrespunkt behält den Periodenstichtag.

### Beispielausgaben im bestätigten Probelauf

Der Leistenknopf steht auf allen sieben Seiten direkt über „Übersicht“ in der
Seitenleiste und bleibt auch bei kompakter Leiste dort sichtbar. „Leiste einklappen“
beziehungsweise „Leiste ausklappen“ schaltet die gespeicherte Gerätepräferenz.

Das Kopiersymbol „Beispielausgaben einspielen“ steht als kompakter Symbolknopf auf
Ausgaben je Person, gewähltem Ausgabenjahr und Monat sowie im Ausgabenschritt der
Monats-/Jahresdialoge und auf der Startseite bereit. Der vollständige Tooltip nennt
Monat und Person beziehungsweise die Personenwahl. „Beispiele für alle“ trägt dasselbe
Symbol und importiert nur den aktuellen
Haushaltsumfang und Abschlussmonat (bei Jahresanlass Dezember). Andere fehlende
Jahresmonate werden einzeln auf Ausgaben ergänzt. Datei-CSV und Beispiel-CSV gehen
über denselben Parser, dieselbe Kategorien-/Summenvorschau und ausdrückliche
Bestätigung; vorhandene Zielmonate werden dabei ersetzt. Abbrechen schreibt nichts.

Der Generator verteilt eine einmalige gemeinsame Budget-/Bedarfsbasis centgenau,
deterministisch und saisonal auf die Personen (85–110 Prozent, Reparatur in jedem
fünften absoluten Monat). „Beispieldaten (Probelauf)“ bleibt nach Reload in Monatswert,
Details und Jahresverlauf sichtbar; eine echte CSV entfernt die Beispielherkunft.
Ohne bestätigten aktiven Modus entstehen keine Beispielknöpfe. Vollbackup- und
Snapshot-Wiederherstellung bleiben gesperrt. Bestehende Abschlusskoordinatoren
bleiben verbindlich; Inflation, CAPE und ETF-Jahresenddaten entstehen im aktiven
Probelauf automatisch synthetisch und ohne Netz.

### Gemeinsamer Jahres- und Monatsabschluss (A2)

„Abschluss starten“ auf der Startseite und die Jahreszugänge in Balance öffnen denselben Abschlussdialog: Kurse,
personenweiser CSV-Import des tatsächlichen Vormonats, Monats-/Jahresbudget,
Tagesgeld am 31.12. des offenen Jahres, Marktdaten und Planvorschau: genau sechs
Vorbereitungsschritte ohne zusätzliche Jahres-/Januargruppe. Inflation, ETF-Schlusskurs und CAPE werden zunächst
nur gelesen; erfolgreiche Werte werden beim Jahresabschluss wiederverwendet.
Ein erneuter Abruf lädt nur fehlgeschlagene Typen, ein Handkurs ersetzt nur ETF.
Die Vorschau zeigt alle Haushaltspersonen, Januaralter und die Rentenbezugsgröße.
Der Jahresteil speichert weiterhin erst nach Vorprüfung und bestätigtem
Wiederherstellungspunkt. Nach dauerhaftem Jahresabschluss und bestätigtem neuen
Plan folgt automatisch der Monatsabschluss mit denselben bestätigten Tagesgeldzahlen.
Das Ergebnis zeigt unmittelbar die verbindliche Handlungsanweisung für das Folgejahr und den Planstand.
Im Teil MONAT steht der Monatsbetrag genau einmal mit seinem Planjahr. Der Monatswriter
sichert einen eigenen Wiederherstellungspunkt, der das abgeschlossene Jahr enthält.
Die einmal bestätigten Tagesgeldwerte werden unverändert verwendet; es entsteht kein
zweiter Cashbeleg. Ergebnis C zeigt beide Speicherbelege, alle Personen und den neuen
Plan. Die Handlungsanweisung ist sofort sichtbar; „Protokoll anzeigen“ und „Fertig“ schreiben keine Fachdaten.
Bei Monatsfehler bleibt das Jahr gespeichert; ein Retry speichert ausschließlich den
Monat. Ein Rollbackfehler sperrt Eingaben bis zur Wiederherstellung.
Die Startseitenkarte öffnet den Jahresdialog direkt. `Balance.html?year=<Vorjahr>#abschluss`
und der bisherige Anker `#jahresabschluss` bleiben alternative Einstiege. Auch beim verspäteten Abschluss werden
tatsächlicher Vormonat und aktueller Bereitstellungsmonat getrennt vom Jahresende gezeigt.
Der normale Monatsabschluss auf der Startseite bleibt vierstufig.
Die Schrittköpfe und „Weiter zu …“ ändern nur die Ansicht. Erledigte Schritte werden
ebenfalls angesehen; „entfällt“ erscheint neutral ohne Haken. Im letzten Schritt gibt es keinen Weiterknopf. Kursaktualisierung und Kursdetails
bleiben im Dialog: Der vorhandene Kursdienst speichert bestätigte Ergebnisse und zeigt
Abrufzeit, ältestes Kursdatum sowie Einzelprobleme. Ein laufender Sitzungsabruf wird
abgewartet; Tagesgeldentwürfe und geöffnete Details bleiben erhalten.
Ausgaben lassen sich mit Personenbeträgen, Kategorien und Summe lokal ansehen.
Ohne Budget für den Abschlussmonat entfällt der Vergleich mit datiertem Grund;
Nullbudget bleibt ein echter Vergleich, widersprüchliche Quellen ein Prüfhinweis.
Ein Teilimport hält den Ausgabenschritt geöffnet und nennt die fehlende Person. Erst vollständige
Ausgaben für den Abschlussmonat öffnen automatisch Budget; der Budgetinhalt zeigt bereits vorhandene Teilbeträge.
Kurse, Ausgaben und Budget sind Empfehlungen. Alle Schritte ansehen und Tagesgeld je Person ändern
oder „Stand stimmt“ bestätigen. Der Abschluss bestätigt keine ausgeführte Überweisung. Startseite und Balance lesen denselben Jahresstatus.

Bei fälligem Monatsabschluss ist „Abschluss starten“ der einzige Einstieg in der Monatskarte.
Das beige Band nennt nur den Monatsbetrag; zusätzliche Tagesgeldzeilen und Frischehinweise entfallen hier.
Tagesgeld bleibt im Abschlussdialog und unter Personen & Vermögen erreichbar. Im Ausgabenschritt
stehen Dateifeld und Beispiel-Symbol nebeneinander, sowohl im Monats- als auch im Jahresdialog.
Während Monte-Carlo läuft, zeigt die Ergebniskarte Fortschritt und Abbruch; Start und
„Einstellungen ändern“ erscheinen nach Ende, Abbruch oder Fehler wieder.

Kann der Jahreszugang wegen eines abweichenden Profil- oder Periodenstands nicht
über die gemeinsame Vorbereitung laufen, meldet er den Schutzabbruch ohne
Vorbereitungsdialog und Jahresänderung. Profilstand und Sicherungsverwaltung
müssen dann geprüft werden.

Die Auswahl unter **Szenario-Logs** verwendet vier Gruppen mit tatsächlichen
Anzahlen: Endvermögen, Pflege, Risiko und Stichprobe. Jede Zeile zeigt den
Quellnamen, Endwert oder Ruin und beobachtete Ereignisse je Person. Die Stichprobe
steht nach nominalem Endvermögen aufsteigend; Real/Nominal erhält diese Reihenfolge.
Pfeil hoch/runter und Home/End bewegen den Fokus, Enter/Leertaste wählen den Lauf.
Vorheriges/Nächstes bleiben in der aktiven Gruppe. „Ausgewählt“ nennt außerdem
Startjahr und Logzeilenzahl. Auf schmalen Fenstern öffnet „Szenario: Name · Wert“
dieselbe Liste. Linien und Randmarken wählen denselben Lauf; der Replay-Rückweg
öffnet die Auswahl und fokussiert ihn. JSON/CSV bleiben vollständig nominal und
unabhängig von Maßstab, Details, Pflege-Spalten und Fenstergröße.

### Gemeinsame Seitendialoge (Paket 9)

Rückfragen und Hinweise aus `app/` erscheinen als gestaltete Seitendialoge statt `confirm`, `alert` oder `prompt`. `app/shared/page-dialog.js` stellt Bestätigung, Hinweis und geprüfte Eingabe bereit; `page-choice-dialog.js` ergänzt Mehrfachauswahl und den bestehenden Speichervertrag. Nur eine ausdrückliche Bestätigung erlaubt die jeweilige Aktion. Escape, Abbrechen und Signalabbruch erhalten den bisherigen Bestand; technische Öffnungsfehler bedeuten keine Zustimmung.

Probelaufende heißt „Probelauf beenden“/„Weiter testen“, Personenumstellung „Übernehmen“/„Später“. Der Simulator fragt vor Reset und oberhalb von 5.000.000 nominellen Sweep-Laufjahren; die Pareto-Auswahl bietet beide bisherigen Achsenmetriken in einem Dialog. Rechenlogik, Exportinhalt und Speicherformate bleiben erhalten. Navigation, Monats-/Jahresabschlüsse, Cash-/Trancheneditoren, Dateiauswahl und Inline-Telemetrie der HTML-Einstiegspunkte behalten ihre eigenen Verträge. Browser-, Bild- und WebViewabnahme sind extern auszuführen.

## Daten & Sicherung (Paket 14, Slice 1)

Die Suite umfasst sechs Quellseiten: `index.html`, `Balance.html`,
`Simulator.html`, `depot-tranchen-manager.html`, `Handbuch.html` und
`Daten-Sicherung.html`. Der gemeinsame Rahmen führt mit geschützter Profilübergabe
zur Sicherungsseite. Die Startseite erinnert ab 30 Tagen; die getrennte
Jahresvorbereitungsempfehlung nach sieben Tagen bleibt erhalten.

`app/data/data-page.js` verwendet die vorhandenen Vollbackupbinder und zeigt
bestätigte Speicherrecords und Archivpunkte. „Jetzt sichern“ bleibt ausschließlich
in der Vollsicherungskarte (`#fullBackupBtn`); der Probelaufeinstieg liegt in der
Kopfzeile (`#probelaufStart`), ohne zusätzliche Karte. `data-model.js` und
`data-renderer.js` projizieren den Bestand ohne Fachrechnung oder Renderwrites.
`data-backup-summary.js` speichert unter `rs_data_backup_summary_v1` eine globale,
versionierte Vergleichsbasis mit SHA-256-Signaturen von Monatsbelegen,
Tagesgeld-Einträgen und Tranchen je Profil. Neue, geänderte und entfernte Einträge
werden getrennt gezählt; Kaufdaten werden nicht zu Aktivitätsbelegen. Ohne passende
Basis ist der Vergleich unbekannt. Normale Snapshot-Restores behalten die Basis.

Nach angestoßener Dateiausgabe bestätigt `persistence-backup.js` Sicherungszeit und
Basis gemeinsam über eine enge Transaktion samt Readback und Rollback. Der Browser
bestätigt keinen Speicherort oder abgeschlossenen Dateidialog. Vollbackup-Versionen
1 und 2 bleiben importierbar; das separate kanonische Archiv ist kein Dateibestandteil.
Vollimport erfordert den bestätigten Recoverypunkt und unveränderten Livebestand;
Probelauf bleibt für Sicherungsaktionen gesperrt. Die übrigen Karten enthalten
Vorschau, Wiederherstellung, Aufbewahrung, Kursdienst und Datenaustausch. Die neue Seite ist Pflichtdatei im
Runtime-Sync, ohne Engine- oder Buildartefaktänderung.

### Daten sichern und austauschen

`Daten-Sicherung.html` bündelt Vollsicherung, Einspielen, lokale Wiederherstellungspunkte,
Aufbewahrung, Kursdienst und Speicheranzeige. Alte Einstiege auf Übersicht, Balance und
Vermögen führen geschützt in den konkreten Bereich. Die Hilfe öffnet
`Handbuch.html#daten-sicherung` mit Fokus und TOC.

Personenexport enthält genau die bestätigte gewählte Person mit Depot, Personendaten und
Tagesgeld-Historie. Import legt nach Vorschau eine neue Außenperson mit neuer ID an;
vorhandene Personen, aktive Auswahl, Livewerte, Globals und Tageskurse bleiben erhalten.
Die Haushaltsmitgliedschaft wird danach in Personen & Vermögen gepflegt.
Balance-JSON bleibt ein eigener Austauschvertrag mit Engine-Vor-/Nachprüfung und
bestätigtem Import-Recoverypunkt. Die Legacy-Ordnerverbindung erhält Browser-Handles;
kanonische Punkte bleiben unabhängig davon im App-Speicher.

Eine Vollsicherungsdatei enthält kein separates Wiederherstellungsarchiv. Lokale Punkte
ersetzen keine externe Datei. Standard-Zurückholen bewahrt andere Profile, Tageskurse und
technische Einstellungen; vollständige Vollimport-Recovery hat den größeren Umfang.
Vor Zurückholen entsteht ein bestätigter Rückkehrpunkt im gleichen Umfang. Aufräumen
und Punktlöschen erhalten Dauerpunkte und noch benötigte Recoverystände. Im Probelauf
sind Sicherung, Austausch und Recoveryaktionen gesperrt. Simulatorprotokolle bleiben im
Simulator; manuelle Kursaktualisierung und „Alle Tranchen löschen“ im Vermögen.


### Daten & Sicherung: Karten und zentrale Einstiege

Die Kurskarte trennt Wertpapiername, Ticker, Tageskurszahl, erstes Kursdatum und
Lücken. Datumswerte sind deutsch; Lücken bezeichnen offene Abrufzeiträume, keine
fehlenden Wochenenden oder Börsenfeiertage. Eine erreichbare Dienstprüfung
behauptet keine Quoteaktualisierung. Einzelheiten und Fehlerursachen stehen in
standardmäßig geschlossenen „Technischen Details“.

„Zurückholen …“ öffnet die beige Vorschau in der gewählten Archivzeile. Sie nennt
Eurobeträge, entfallende, unveränderte und erhaltene Bereiche aus demselben Plan,
der danach ausgeführt wird. Vor dem Lesen speichert sie bereits ausstehende
Eingaben; sie erzeugt keinen Rückkehrpunkt und schreibt kein Wiederherstellungsziel.
Erst die Bestätigung sichert „vor Zurückholen“ und setzt den gewählten Umfang
zurück. Spätere Bestandsänderungen erfordern eine neue Vorschau. „Aufräumen …“
verwendet den bisherigen konservativen Aufbewahrungsplan; bei null entfernbaren
Punkten erscheint nur „Nichts aufzuräumen“ mit „Verstanden“.

Ein Recovery-Link mit `?punkt=<Archiv-ID>#wiederherstellung` öffnet die konkrete
Vorschau einmal beim Seitenstart. Spätere Hashwechsel erhalten ihren Zustand;
eine manuell geschlossene Vorschau bleibt geschlossen.
Einzelpunktlöschung unter „Weitere Aktionen“ meldet Schutz, Abbruch und Fehler
in der Karte „Wiederherstellungspunkte“, mit der Ursache in deren „Technischen
Details“. Erst nach Bestätigung, Archivprüfung, Löschung und Listenaktualisierung
erscheint „Punkt entfernt.“. Dauerhafte oder noch nicht abgedeckte Punkte bleiben
erhalten. Meldungen anderer Austauschwege bleiben dabei bestehen.

Balance hat keine Sicherungskarte mehr. Alt+E/Alt+I öffnen den jeweiligen
Balance-Dateiknopf auf Daten & Sicherung; Jahres-Recovery übergibt die konkrete
Punkt-ID. Die Startseite behält Erinnerung, Sicherungspille, Erststartimport und
dynamischen Sicherungsweg, ohne die beiden zusätzlichen Verweisknöpfe. Der Altanker
`index.html#probelaufControls` öffnet nach sicherer Bindung denselben Kopfzeilendialog
einmalig; bei aktivem Lauf führt er zum Band. Speicher-/Backup-Technikangaben stehen
ausschließlich auf Daten & Sicherung. Dort zeigen die technischen Speicherdetails
Backend, Eintragszahl und gegebenenfalls die Migrations-/Wiederherstellungswarnung.
Die Sicherungserinnerung in der Kopfzeile und der gelbe Fälligkeitsbalken bleiben
auf allen Seiten erhalten; Fehler- und Wiederherstellungsanzeigen bleiben am betroffenen Bedienweg.
„Weitere Austauschwege“ enthält Balance-Dateien und die bisherige Ordnerverbindung.
Auch nach einem gescheiterten Balance- oder Vollimport erscheint ein bereits
bestätigter Wiederherstellungspunkt sofort in der Liste; die Fehlermeldung bleibt erhalten.
Simulator-Ergebnis-, Protokoll- und Stresspfadexporte bleiben im Simulator;
die Vermögens-Notfallwiederherstellung führt weiterhin zum zentralen Vollimport.


### Gemeinsamer Haushalt und Plan (H1)

`household_plan_v1` speichert einen validierten Plan je sortiertem Haushaltsumfang
und einen eigenen Bereich je Außenperson. Floor, Flex, Mindest-Flex, Krisenbudget,
Reichweite und Strategie werden in Balance und Simulator genau einmal verwendet.
Nur Personen, Einkommen, Vermögen und Tranchen werden weiter zusammengeführt.

Bei einem Altbestand werden tatsächlich gespeicherte Balance- und Simulatorwerte
verglichen, keine Readerdefaults. Gleiche Quellen werden still übernommen.
Abweichungen öffnen „Planungsdaten zusammenführen“ mit Balance als Vorschlag und
gegebenenfalls dem Hinweis auf einen Guardrail-Reset. Ungültige gekoppelte Werte
verlangen eine ausdrückliche Korrektur. „Später“ und Escape erhalten die bisherigen
Quellen und den bisherigen Rechenweg; beim nächsten Start wird wieder gefragt.
Vor dem ersten Planwrite wird „Vor Umstellung Haushalt & Plan“ dauerhaft und
bytegleich als Wiederherstellungspunkt bestätigt. Die Altdaten bleiben erhalten.

Der Hinweis „Planungsdaten zusammenführen“ öffnet die Umstellung auch auf der
bereits gestarteten Balance-Seite erneut. Nach erfolgreicher Übernahme werden
Formular und Bereichsbaseline sofort aus dem bestätigten Plan befüllt und die
Vorschau neu gerechnet, ohne Reload oder Jahresabschluss. Die nächste gültige
Flex-Eingabe bleibt dadurch im Formular und im gemeinsamen Plan gespeichert.
Erneutes „Später“, Escape oder eine fehlgeschlagene Migration lösen keinen
Erfolgsrefresh aus.

Im Manager öffnet der erste Ansichtsreiter „Haushalt & Plan“ das Planpanel mit Haushalts-/Personenübersichten und Planvergleich.
Die Balancefelder bearbeiten weiterhin denselben Plan. Im Simulator sind die
Planwerte zunächst lesend als „aus Haushalt & Plan“ gekennzeichnet. „Nur hier
ausprobieren“ öffnet einen flüchtigen Versuch; Presets gehören ebenfalls zum
Versuch. Reload und „Zurück zum Plan“ zeigen den bestätigten Plan. Erst
„In den Plan übernehmen“ schreibt nach Bestätigung die angezeigten Unterschiede
für Balance und Simulator gemeinsam. Versuchsläufe ersetzen kein Planergebnis
auf der Startseite.
Auch programmatische `input`-/`change`-Ereignisse auf Planwerten stellen im
Lesemodus sofort den bestätigten Formularwert wieder her; die Laufeingabe bleibt
damit identisch. Eine abweichende Championübernahme über „Übernehmen“ wird ohne
Erfolgshinweis abgewiesen und verweist bei gültigem bestätigtem Plan auf
„Nur hier ausprobieren“. Nach dessen ausdrücklichem Start wirkt derselbe Champion
nur im lokalen Versuch, einschließlich
Go-Go-Faktor und Checkbox. Der Hinweis richtet sich nach dem bestätigten Planlesezustand,
auch wenn Go-Go ausgeschaltet ist und bereits die Nebenwirkungsprüfung ablehnt.
Vor Erstbestätigung und im aktiven Versuch werden Anwendungsfehler allgemein erklärt.
Bei gültigem bestätigtem Plan bleiben identische erfolgreich zurückgelesene
Champions auch ohne Versuch erfolgreich.
Plan, alte `sim_*`-Werte, Bedarfskopie und Profile werden
dabei nicht gespeichert. Ungültige Versuchswerte sperren die Rechnung mit ihrem
Validierungsgrund. Fehlt ein zuvor bestätigter gemeinsamer Plan oder ist er ungültig,
prüft „Übernehmen“ den synchronisierten Zustand vor jeder Formularmutation und
verlangt die Wiederherstellung vor erneuter Übernahme. Auch ein identischer
Champion wird dann vor Formularanwendung, Anzeigenrefresh und Erfolgsanhang gesperrt.
In diesem Zustand bleiben Versuchsstart, Laufeingabe und Altwrite gesperrt; der Hinweis stellt keinen Plan automatisch her.
Vor der ersten Bestätigung bleibt das Altformular bedienbar.
Die Bestätigungsgrenze gilt auch ohne Reload: Wird der Plan erst auf der bereits
gestarteten Simulatorseite bestätigt, erzeugen Preset- und Detailereignisse keine
weiteren alten `sim_*`-Writes. Im Lesemodus wird das Planpreset zurückprojiziert;
im ausdrücklich gestarteten Versuch wirkt die Presetwahl lokal. Die erweiterten
Details bleiben seitenlokal bedienbar. Auch nach späterem Planverlust bleiben
diese Altwritewege gesperrt; vor Erstbestätigung bleibt die bisherige Persistenz aktiv.
Ausführbare Nachweise: `node tests/run-single.mjs tests/simulator-plan-trial.test.mjs`
und `node tests/browser-smoke.test.mjs --only="Simulator Planlesemodus und Championübernahme"`.
Die Node-Probe nutzt echte Listener und Formularanwendung und prüft bei Planverlust
identische und abweichende Champions gegen unveränderte Formular- und Speicherbytes.
Der registrierte Browserfall bedient beide Varianten bei Go-Go an und aus über
den echten Knopf und Seitendialog. Registrierung und Syntaxprüfung ersetzen
keine Browserabnahme; diese bleibt ein externes Pflichtgate außerhalb der Agentensandbox.
Den Übergang ohne Reload prüfen `node tests/run-single.mjs tests/simulator-household-plan.test.mjs`
und `node tests/browser-smoke.test.mjs --only="Simulator Altformular nach Später und Planübernahme ohne Reload"`.
Mindest-Flex darf Flex nicht überschreiten und wird nicht automatisch gekürzt.
Simulatorreset erhält den gemeinsamen Plan. Pflege, Stress, Rechenzeiträume,
Monte-Carlo-Einstellungen und technische Darstellungsflags bleiben separat.
Mindest-Liquidität und Haushaltsentnahmemodus werden auch ohne Simulatorfeld aus
dem Plan gelesen; Engineformeln und ausdrückliche flüchtige Laufparameter bleiben
unverändert. `household_simulator_needs_v1` und alte `sim_*`-Planwerte sind nach
Bestätigung keine Quellen mehr.

Eine bewusst übernommene manuelle Simulator-CAPE-Eingabe speichert den
neuen Wert mit `asOf: null` und `source: null`. Andere Planänderungen und reine
Lesewege erhalten vorhandene CAPE-Herkunft; ungültige Eingaben schreiben nichts.
Bestätigte Jahresmarktdaten aus Balance übernehmen weiterhin ihre Provenienz.

`annual_plan_record_v1` hält den unveränderlichen Beleg eines bestätigten
Jahresabschlusses für Jahr und Umfang. Öffnung und Umstellung erfinden keinen
Altbeleg. H3/H4 erweitern später Jahresdarstellung und getrennte Annahmenbedienung.
Muster-Haushalt und Probelauf nutzen denselben Planvertrag; die Probelaufrückkehr
stellt den ursprünglichen Bestand einschließlich Planrohbytes wieder her.
Die Browserabnahme mit echter lokaler Altbestandskopie, Konflikt, Vertagung,
Reload, Seitenwechsel und Probelaufrückkehr bleibt Aufgabe der Steuerung.


### Haushalt & Plan im Manager (H2, Slice 1)

`depot-tranchen-manager.html#haushalt-plan` öffnet Bedarf, Flex-Budget, Reserven,
Entnahme & Umschichten, Dynamik und die lesenden Jahresmarktdaten. Die
Ansichtssteuerung trennt Plan und Personenbereiche. Mitglieder
teilen genau einen Plan; eine Außenperson sieht neben „Gilt für“ die Scopepille „<Name> (allein gerechnet)“.
Gültige Änderungen werden nach kurzer Pause dauerhaft bestätigt. Leere oder
ungültige Eingaben, insbesondere Mindest-Flex über Flex, bleiben ungespeichert.
Bei einem Speicherfehler wird der bestätigte Stand angezeigt; „Speichern wiederholen“
erhält den ursprünglichen Auftrag. Profilwechsel und Personenverwaltung schließen
wartende Planänderungen zuerst ab. „Später“ sperrt nur den unbestätigten Planbereich;
„Planungsdaten zusammenführen“ setzt die bestehende Umstellung fort.

Manager und Startseiten-Karte unterscheiden „Plan <J> · festgeschrieben am
TT.MM.JJJJ“ aus dem passenden Jahresbeleg und „Vorschau heute“ aus der gespeicherten
Balance-Rechnung. Verglichen werden Monatsbetrag, Monatsbudget, Handlungsanweisung
und Liquidität nachher. Geld-Deltas bedeuten Vorschau minus beschlossener Plan,
Liquiditäts-Deltas Prozentpunkte. Der Beleg zeigt den beschlossenen Wert (`adopted`),
bei Anpassung „bewusst angepasst“. Die Vorschau behauptet keine Umsetzung und
erzeugt keine neue Handlungsaufgabe. Ohne Beleg steht: „Noch kein festgeschriebener
Plan – er entsteht im nächsten Jahresabschluss.“ Fehlende oder veraltete Vorschau
und beschädigte Belege werden ausdrücklich benannt. Öffnen rechnet und schreibt
weder Plan noch Beleg neu; H3 ergänzt später den Belegschreiber.

Umstellungspunkte heißen im Archiv „Planumstellung · dauerhaft“. Sowohl die neue
Art als auch der exakt benannte alte manuelle Punkt „Vor Umstellung Haushalt & Plan“
bleiben beim Aufräumen erhalten. Gewöhnliche manuelle Vergleichspunkte unterliegen
weiterhin der bisherigen Aufbewahrung.

### Gemeinsamer Plan und Simulatorversuche (H2, Slice 2)

Der bewachte Link vor den Balance-Planfeldern und „Im Plan ändern“ im Simulator
öffnen den Manager im aktuellen Profilkontext. Haushaltsmitglieder teilen einen
Plan; eine Außenperson hat ihren eigenen Einzelplan. Der Manager speichert
Änderungen automatisch. „festgeschrieben“ stammt ausschließlich aus einem
passenden Jahresbeleg mit beschlossenen Werten; „Vorschau heute“ zeigt, wie es
bei einem heutigen Jahresabschluss aussähe. Nur die Handlungsanweisung aus dem
Jahresabschluss ist verbindlich. Die Anzeige behauptet keine Ausführung.

Simulatorversuche speichern weder Planwerte noch Altkopien. Feldgenaue Übernahme,
Mindest-Flex-Validierung, Kontextschutz und Rücknahme nutzen den bestehenden
Planvertrag. „mit Abweichung vom Plan“ bezieht sich auf die beim Laufstart
festgehaltene Basis, auch nach Rückweg oder Übernahme. Ein nur geöffneter,
unveränderter Versuch bleibt ein normaler Planlauf.

### Gemeinsamer Jahresdienst und Dialog (H4)

Der Balance-Jahresabschluss verwendet den DOM-freien Dienst
`app/shared/annual-coordinator.js`. Er liest bestätigte Speicherquellen, prüft
Periode und Recovery, sichert den vollständigen H3-Bestand und bestätigt genau
einen fachlichen Jahresbatch mit Planbeleg. Das Ausgaben-Ansichtsjahr ist unabhängig von der
Abschlussperiode; gespeichert wird nach Bestätigung Abschlussjahr + 1. Erfolgs- und Fehlerergebnisse geben denselben Protokollknopf frei.

Jahresvorbereitung und anschließende Monatsbereitstellung halten einen gemeinsamen
seitenübergreifenden Besitzer. Ein zweiter Jahresstart, Monatswrite oder
Probelaufwechsel meldet die Sperre. Ohne atomaren Sperrprovider wird kein Jahreswrite
gestartet. Nach Handkurs-Restore lädt dieselbe Seite neu und nimmt dieselbe Periode
höchstens einmal wieder auf. Der Einmalauftrag erhält die bestätigte Plananpassung und die Jahresend-Cashwerte; Januarbetrag und Anzeige stammen auch nach Wiederaufnahme aus dem beschlossenen Plan. Die Engine wird beim gemeinsamen Dienst erst bei
Jahresanlass geladen und gegen den bestehenden API-Vertrag geprüft.

Startseiten- und Balanceadapter sind auf Dienstebene mit identischen vollständigen
Records geprüft. Die Startseite öffnet den Jahresdialog direkt; Balance bietet denselben alternativen Einstieg.
Browser-/Tauri-Abnahme bleibt bei der gesteuerten Sitzung.

Schritt 6 zeigt zuerst eine Vergleichstabelle „Empfehlung der App“ / „Dein Plan“ mit Monatsbetrag und Monatsbudget in ganzen Euro. „Plan anpassen …“ öffnet den zunächst geschlossenen Feldbereich ohne Planänderung. Nach tatsächlicher Anpassung zeigt „Dein Plan“ die Pille „angepasst“; Verwerfen entfernt alle Änderungen und lässt die Felder offen. Alle bearbeitbaren Felder aus Haushalt & Plan sind mit derselben Validierung und bedingten Sichtbarkeit verfügbar; CAPE bleibt Herkunft, der berechnete Monatsbetrag ist kein Eingabefeld. Ungültiger Mindest-Flex sperrt die Bestätigung sichtbar. „Anpassung verwerfen“ stellt die Empfehlung wieder her. Die Änderungen bleiben bis zur Jahresbestätigung flüchtig. Der Jahresbeleg speichert beide Rechnungen aus derselben historischen Basis, `adjusted` und ausschließlich tatsächlich abweichende Feldpfade. Das Ergebnis und die feste Anzeige verwenden den beschlossenen Plan. Eine spätere Balancevorschau überschreibt den Beleg nicht und erzeugt aus ihrer vorläufigen Handlung keinen neuen Umsetzungsschritt.

Die Startseite lädt die Engine ausschließlich beim Jahresstart oder seiner Wiederaufnahme. Ohne Abschlussanlass und beim normalen Monatsabschluss erfolgt kein Engineimport. Protokoll und Handkurs-Recovery sind ohne Balance-Seite erreichbar; beide alten Balance-Jahreshashes bleiben alternative Einstiege.

Der gemeinsame Abschlussdialog hat sechs Vorbereitungsschritte. Gültiges bestätigtes
Tagesgeld heißt „eingetragen“ und wird erst beim Jahresabschluss gespeichert.
Die Bereitschaft steht genau einmal über dem Hauptknopf: fehlender Besuch,
„Tagesgeld ändern oder ‚Stand stimmt‘ bestätigen.“ oder „Alles bereit – jetzt ‚Jahr … abschließen‘.“
Import und Speicherung sperren den Hauptknopf. Schritt 6 hat keinen Weiterknopf.
Der Klick speichert Jahr und Vormonat nacheinander. Das Ergebnis folgt der Reihenfolge:
Alles gespeichert → Handlungsanweisung J+1 (verbindlich) → Planstand J → J+1 → MONAT → Wiederherstellungspunkte.
Verkäufe/Entnahmen, Käufe/Verwendung und Steuer sind getrennt lesbar; ohne passenden
bestätigten Jahresbeleg erscheint ein Hinweis. Bedarf zeigt nur bei sicher bekanntem
Vorherwert einen Inflationsübergang, bewusste Anpassungen heißen „von dir angepasst“.
Der vorbereitende Sicherungshinweis verschwindet nach dem Jahreswrite.
Bei Monatsfehler steht „Jahr J gespeichert. Der <Abschlussmonat>-Abschluss konnte nicht gespeichert werden.“
Die Meldung nennt den tatsächlichen Vormonat; fehlt dessen Angabe, steht dort neutral „Der Monatsabschluss konnte nicht gespeichert werden.“
„Erneut versuchen“ speichert ausschließlich den Monat; Recovery bleibt über die Sicherungsverwaltung erreichbar.
Browserfolge und Dialogbilder sind registriert, ihre Abnahme erfolgt außerhalb der Agentensandbox.

### Gemeinsame Planfeldgestaltung (H5, Slice 1)

Manager und Jahreseditor verwenden denselben persistenzfreien Feldbaustein
`app/shared/household-plan-fields.js`: sechs Gruppen, Einheiten im Feld und Segmente
für Strategie, Verteilung, Dynamik und Go-Go. Alle drei Verteilungen bleiben
erreichbar, einschließlich Steueroptimiert; „Nacheinander“ bedeutet Reichweite zuerst.
Deutsche Zahlen erscheinen beispielsweise als `30.000 €`, `5 Jahre`, `10 %` oder
`85 %`; bei Fokus wird die ungegliederte Zahl ohne Einheit editierbar. Fokus, Blur
und erneute Darstellung erhalten die volle interne Präzision und speichern nichts.
Fehler bleiben am Feld korrigierbar; Mindest-Flex wird niemals begrenzt. CAPE
bleibt lesende Herkunft mit Stand und Quelle.
Eine vollständige Tab-/Programmauswahl bleibt beim Wechsel zur reinen Fokuszahl
erhalten; ein erster Mausklick setzt die Einfügemarke ans Ende. Jährliche
Euroeingaben über 10.000.000 € werden vor Autosave oder Vorschau abgewiesen,
ohne den gespeicherten Plan zu begrenzen. Der geöffnete Jahreseditor zeigt die
sechs Gruppen in einer Spalte, ohne Nutzungskennzeichen und CAPE-Fußnote.
Erneutes „Plan anpassen …“ schließt die Felder ohne Änderung des Entwurfs.

Die Scopepille nennt den bestätigten Haushalt oder Einzelbereich. Der
Inflationsnachweis folgt ausschließlich der Periodenkennung eines gültigen,
passenden Jahresbelegs: Abschluss 2026 für Planjahr 2027 nennt Inflation 2026.
Fehlt dieser Nachweis oder weicht der aktuelle Plan ab, steht
„Inflationsfortschreibung noch nicht belegt“. Browser-/Bildabnahme bei
1366/1920 px erfolgt durch die gesteuerte Sitzung vor einer Kandidaten-EXE.

### Haushalt & Plan: Vergleich und Simulatorversuch

Der Manager zeigt den Planvergleich als eigene Karte: festgeschriebener Jahresplan,
bewusste Anpassung, heutige Vorschau und deren Aktualität bleiben getrennt.
Startseite und Manager vergleichen auch nach einem Abschluss dieselbe gespeicherte
heutige Rechnung. Die feste Startseitenanzeige bleibt beim beschlossenen Jahresbeleg;
eine fehlende Vorschau wird nicht aus dem Beleg ersetzt. Die Karte trennt Plan und
Vorschau in eigene Blöcke und nutzt Kartenabstände, Anpassungspille und DS-Knopf.
„Vorschau in der Balance rechnen“ nutzt den bestehenden bewachten Seitenwechsel.

Im Simulator stehen die Planwerte in „2 Bedarf“ und „3 Reserven & Entnahme“
lesend mit Herkunft. Beide Kartenköpfe bieten „Nur hier ausprobieren“ und
„Im Plan ändern“. Der Versuch gibt beide Karten gemeinsam frei; beide Kopfknöpfe
werden zu „Zurück zum Plan“. Nur im Versuch erscheint das kompakte beige Band
mit den echten Änderungen und dem Hinweis auf den Spielbereich. Die
Liquiditäts-Reichweite bleibt auch ohne Versuch sichtbar.
„Auswahl in den Plan übernehmen“ bietet pro Änderung „Übernehmen“ oder „Im Plan
belassen“. Nur die ausgewählten gültigen Änderungen werden nach Prüfung des
Gesamtplans gespeichert; Abbruch erhält den Versuch. Reload und Rückkehr
verwerfen ihn. Das Gold-Umschichtungsband ist ein zusätzlicher lokaler Profilwert
und wird nicht in den Haushaltsplan übernommen. Zahlenfelder zeigen deutsche
Einheiten und beim Fokus ungruppierte Eingaben; Quantile/Anteile werden als Prozent
bearbeitet, Faktoren bleiben Faktoren. Darstellung und Versuch schreiben keine Plandaten.

Balance zeigt „Bedarf“ und „Reserven & Entnahme“ einschließlich „Alle Parameter“
lesend aus Haushalt & Plan. Beide Kopfaktionen steuern denselben flüchtigen Versuch;
Rückkehr und Reload verwerfen ihn. Die Auswahlübernahme prüft den gesamten Plan und
speichert nur gewählte gültige Planfelder. Das Gold-Umschichtungsband bleibt lokal
und dauerhaft unter Personen & Vermögen erreichbar. Ein Versuchsergebnis trägt
„mit Abweichung vom Plan“; Startseitenvorschau, Handlungsanweisung, nächste Schritte
und Jahresbeleg bleiben beim Plan. Der Jahresabschluss beginnt aus dem bestätigten Plan.
Inflation bleibt auch im Versuch lesend: Wert und Jahr stammen aus dem passenden
Jahresbeleg (Jahr aus `periodId`), sonst aus dem gespeicherten Jahres-/Altstand mit
ehrlichem Herkunftshinweis. Fortschreibung und manuelle Ersatzrate bleiben im
Jahresabschluss. Ein erneuter Jahresabschlussstart ohne neue Ergebnisdaten meldet
„Die Jahresperiode <J> wurde bereits abgeschlossen.“; das Jahr stammt aus der Periodenkennung.


### Eigenständige Ausgaben (AU1)

Die sieben Suite-Einstiege sind `index.html`, `depot-tranchen-manager.html`,
`Ausgaben.html`, `Balance.html`, `Simulator.html`, `Handbuch.html` und
`Daten-Sicherung.html`. Die Navigation folgt dieser Reihenfolge.
`app/expenses/` besitzt den Seiteneinstieg, die lesende Jahres-/Personenprojektion,
Kategorien, Kennzahlen und die Anbindung an den gemeinsamen Monats-/Jahresdialog.
Die Import-, Speicher-, Recovery- und Jahresvergleichsdienste unter
`app/balance/balance-expenses*.js` bleiben gemeinsam importierbar; bestätigte CSV-
und Beispielimporte nutzen ausschließlich D5. Budgets stammen aus passenden
übernommenen Jahresbelegen oder passenden vorläufigen Zusammenfassungen.
Ansicht und Filter schreiben weder Ausgaben noch Jahresplan und benötigen keine
Balanceberechnung.

Balance enthält Überblick, Bedarf & Strategie und Diagnose. Seine
Ausgabenübersichtszeile verlinkt das Planjahr und liest dieselbe Budgetprojektion.
Vermögensverlauf und „Stand jetzt erfassen“ liegen in Personen & Vermögen. Der
Abschlusskontext benötigt keinen Ausgaben-DOM und erhält seine Periode vom
gemeinsamen Jahreskoordinator.
Alte Balanceziele `#ausgaben`, `#ausgaben-import` und gültige `?year=…&month=…`
ohne Hash leiten geschützt auf `Ausgaben.html` weiter; der initiale Altlink wird
vor Berechnung und Planmigration in der Browserhistorie ersetzt. Ungültige und
doppelte Parameter bewirken keine Ausgabenaktion. Abschluss-/Handlungslinks
bleiben Balanceziele. Der bestehende Dist-Sync übernimmt die neue Root-HTML-Datei
und ihre lokalen Module/CSS/Assets automatisch; Tauri besitzt keine Seitenliste.


### Personen & Vermögen: Ansichten und Sprungziele

Ohne anerkanntes Sprungziel startet Personen & Vermögen bei Person 1, dem ersten Haushaltsmitglied (ohne Haushalt beim ersten Profil). Die Reiter stehen direkt vor den Inhaltskarten. Haushalts- und Personenkarten bleiben in „Haushalt & Plan“ erreichbar. Die einzige Ansichtsreiterliste zeigt zuerst „Haushalt & Plan“, dann die Haushaltspersonen in ihrer Reihenfolge, Außenpersonen und zuletzt „Verlauf“. Ohne Haushalt heißt der Planreiter „Plan · <Name>“. Die Planansicht zeigt Haushaltsvermögen neben dem Plananfang sowie die bisherigen Personenübersichten und den Planvergleich; die Personenansicht beginnt mit Person & Einkommen, in einer neuen Sitzung geöffnet, danach Tagesgeld & Gold, Pflege, Depot, Verkäufe/Cashstatus und Technik. Ein Depot-Link im Personenansichtskopf erreicht denselben bestehenden Hashzugang. Der ausführliche Vermögensverlauf steht ausschließlich im Reiter „Verlauf“ mit Umschalter für Haushalt und Personen. Die Personenwahl nutzt den bestehenden aktiven Profilwechsel; „Verlauf ansehen ›“ unter den kleinen Kartenlinien öffnet die passende Auswahl. Alte Verlaufsanker öffnen diesen Reiter. Erklärung im ⓘ, Diagramm 420 px, Tabelle offen; Meldungen werden bei Personen-/Ansichtswechsel geleert. „Öffnen“ auf einer Karte und der Personenreiter führen zur selben Ansicht, auch aus dem Planmodus. Links/Rechts und Home/End bewegen den Fokus; Enter oder Leertaste bestätigen die Auswahl. Ein interner Personenwechsel bleibt beim erneuten Rendern erhalten. Die Ansicht wird nicht dauerhaft gespeichert.

Bekannte Sprungziele wie `#haushalt-plan`, `#personendaten`, `#managerProfileValues`, `#managerDepotTitle` und `#profileTagesgeld` wählen das passende Panel und öffnen den benötigten Abschnitt. `?person=<ID>#profileTagesgeld` und der profilbezogene Planlink wählen erst das bestätigte Profil; `#personen` öffnet weiterhin die Personenverwaltung. Spätere Hashwechsel benutzen denselben Ablauf. Unbekannte Ziele sowie leere, doppelte oder ungültige Personenangaben wechseln kein fremdes Profil. Autosave, Rückfragen, Flush, Retry und Rollback bleiben verbindlich: Auswahl und Panel wechseln erst nach Erfolg.

### Jahresbelege und Wiederherstellung

Startseite und Balance prüfen dieselben Jahresbelege vor der Vorbereitung. Ohne
Periodenvermerk und ohne Abschlussindiz bleibt das Jahr normal offen; es gibt keine
pauschale Jahresperiodenfrage. Ein passender endgültiger Planbeleg oder Jahresverlauf
bestätigt das Jahr. Die App übernimmt ausschließlich die Periodenmetadaten dauerhaft,
ohne Rechnung, Inflation, Plan oder Tagesgeld erneut zu schreiben. Ein Abschlussdatum
erscheint nur mit belegtem Zeitpunkt. Fremde Jahre, fremder Umfang, manuelle Stände
und Vorschauanzeigen zählen nicht als Abschluss. Alte Alters-/Inflationsmarker,
teilweise Jahresmarker und isolierte Vorabpunkte verlangen zuerst Klärung.
Bei undatierten Altmarkern oder isolierten markerlosen Vorabpunkten führt „Noch nicht abgeschlossen“ zur normalen Vorbereitung;
die App speichert dabei nur den offenen Periodenstand, keinen Jahreserfolg. Belegte
Teilanpassungen des Zieljahres bleiben für eine erneute Anpassung gesperrt. Nach Laden
eines vollständigen, quellgleichen Jahresvorabpunkts blockiert dessen Archivierung
den normalen Jahresknopf nicht; der vollständige Finanzquellsatz muss übereinstimmen.

Ein unvollständiger Jahresabschluss zeigt den vorhandenen Wiederherstellungspunkt
mit Label und Datum sowie „Wiederherstellungspunkt laden“, auch ohne Marktergebnisse.
Bei einem ETF-Fehler bleibt zusätzlich der geschützte Handkurs-Retry verfügbar.
Eine bestehende Pending-Recovery hat Vorrang. Nach gespeichertem Jahr gilt ein
Monatsfehler einschließlich fehlgeschlagener Sitzungserzeugung nur für den Monat:
„Erneut versuchen“ wiederholt weder Jahresrechnung noch Planbeleg oder Inflation.

### Sichtbare Klärung nach Jahresvorabpunkt und Kurswrite (AU1c-Follow-up, Slice 2)

Nach einem abgebrochenen Jahreslauf oder dem vollständigen Restore eines markerlosen
Jahresvorabpunkts kann ein späterer Kurswrite in `depot_tranchen` und der Registry den
quellgleichen Vorabstand verändern. Der archivierte Vorabpunkt beweist keinen
Jahresabschluss. Startseite und Balance zeigen dann vor der normalen Vorbereitung
„Jahresstatus klären“; Balance kennzeichnet den Jahresstatus zusätzlich als ungeklärt.
Die initiale Archivlesung und das Rendern bleiben lesend und öffnen kein Popup.

Erst die Nutzeraktion öffnet die gemeinsame Jahresklärung. „Noch nicht abgeschlossen“
bestätigt bei einem isolierten markerlosen Vorabpunkt ausschließlich offene
Periodenmetadaten und führt einmal in die vollständige normale Vorbereitung. Der
anschließende Coordinatorabschluss fragt nicht erneut. Abbrechen beendet den Weg ohne
Vorbereitung, Metadatenübernahme, neuen Snapshot oder Fachwrite. Echte Teilmarker des
Zieljahres erlauben weiterhin keine Offenfreigabe; Pending-Recovery hat Vorrang.
Ein vollständig quellgleicher Restore bleibt dagegen ohne diese Zusatzfrage offen.

Beide Seiten verwenden bestätigte Archivpayloads für Profil, Umfang und Abschlussjahr.
Ausstehende oder fehlerhafte Lesungen geben den markerlosen Jahresstand nicht normal
frei; veraltete Antworten nach Kontextwechsel werden verworfen. Aktuelle Finanzrecords
werden bei jeder Projektion erneut klassifiziert, auch bei unveränderter Archivliste.
Ein Nutzerstart prüft das Archiv erneut und erreicht die aktuelle Klärung auch aus
einer veralteten offenen Anzeige. Beide Jahreseinstiege erneuern die gemeinsame
Archivevidenz zusätzlich nach jedem beendeten Versuch (`cancelled`, `invalid`,
`incomplete_recovery` und `already_committed`), auch nach früher Vorbereitung,
Ausnahme oder Wiederaufnahme. Nach der Lesung wird die jeweilige Anzeige automatisch
lesend aktualisiert; ein paralleles `in_flight` beginnt keinen weiteren Versuch.
So kennt die geöffnete Seite einen gerade gespeicherten Vorabpunkt auch dann, wenn
der Versuch vor dem Metadatenstart endet. Ein späterer bestätigter Kurswrite führt
beim reinen Rendern ohne Reload oder weiteren Jahresklick zu „Jahresstatus klären“.
Die Nachlesung öffnet keinen Dialog und schreibt weder Finanzdaten noch Archivpunkte;
sie ersetzt keinen Ergebnisstatus und keine ursprüngliche Ausnahme. Fehlerhafte oder
veraltete Readerantworten geben keine normalen Jahresaktionen aus alten Payloads frei.
Erfolg und begonnener Teilfehler behalten ihren Abschluss- beziehungsweise Recoverystatus.
Snapshot-/Restoreformat, Engine-Semantik, Fachcommit
und geschützter ETF-Retry bleiben unverändert. Der registrierte Browserfall
„Jahresabschluss abgebrochener Vorabpunkt auf derselben Seite“ prüft den Fehler vor
dem Metadatenstart und den Folgewrite auf beiden Seiten;
„Jahresabschluss Vorabpunkt nach Kurswrite“ ergänzt „Jahresabschluss Altdaten ohne Popup“
und „Jahresabschluss Jahr und Dezember“; die Browserausführung erfolgt außerhalb der
Agenten-Sandbox.

Der gemeinsame Kopf zeigt den Markennamen **Vermögen & Ruhestand** und den jeweiligen Haushalts-/Seitenkontext. Die doppelte Anzeige „Aktives Profil“ entfällt; Laden, Speichern und Profilwechsel bleiben unverändert. Technische Paket-, Speicher- und EXE-Namen bleiben erhalten.
