# Funktionsinventar

Generiert aus [funktionsinventar.json](funktionsinventar.json). Änderungen und vollständige Detailprüffälle ausschließlich in der JSON-Quelle.

Prüfstatus: geprüft · Anwendungscode-Basis (sourceRevision): 0e39685f2d01c4964e2f64c9bbad69e22afea4a1 · Schema: 2

## Grenzen

Das statische Gate prüft Struktur, Erzeugerort und unterstützte Erzeugung. Es beweist weder Laufzeitaufruf oder DOM-Anfügen noch Bedienung, Optik und fachliche Semantik. Identische Anker können mehrere Elemente bezeichnen.

Geschützte Belege verlangen den vollständigen Selektor und den eigenen Anker an demselben Element. Eltern liefern nur Selektorkontext. Data-Anker ohne value prüfen Attributpräsenz, explizite Werte einschließlich leerer Werte bleiben exakt.

Delegierte Codebezüge nennen eindeutige Ereignisfelder in delegates: jeder statische Treffer liegt unter ancestor, dynamische Felder folgen inventarisierten Hostketten. functions erfasst alle benannten Definitionen oder echten lokalen Importbindungen; leere Listen verlangen eine begründete nonFunction-Klassifikation. HTML-Definitionen stammen ausdrücklich aus inline-module oder gemäß Operatorentscheidung vom 04.10.2026 aus inline-classic. Kommentare, Strings, Aufrufe und externe Scriptattribute liefern keinen Definitionsnachweis. Der Nachweis prüft weder importierte Laufzeittypen noch Funktionskörperidentität.

## Arbeitsbereiche

### Übersicht

Quelle: `index.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| I01 | index.html | Profile und Übersicht | Startseite: Vermögen, Alter heute, Plan, Abschlüsse, Musterstart | sichtbar, bedingt sichtbar | keine; persistent: ui\_suite\_sidebar\_collapsed; persistent: overview\_balance\_summary\_v1; persistent: overview\_… | Node 15; Browser 6; Risiko 1; Schuld 0 | 1, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I25 | index.html | Spielbereich | Ein Jahr durchspielen mit Beispielausgaben und normalen Abschlüssen | bedingt sichtbar | nur Sitzung: probelauf.timelapse.v1; persistent: balance\_expenses\_v1, overview\_month\_provision\_v1, annual\_pla… | Node 1; Browser 0; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |
| I24 | index.html | Jahresabschluss | Gemeinsame Dynamic-Flex-Voreinstellungen im Abschlussentwurf | bedingt sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 0; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#jahr-abschliessen) |
| I23 | index.html | Monats- und Jahresabschluss | Jahresabschluss und Plananpassung direkt auf der Startseite | bedingt sichtbar, sichtbar | nur Sitzung; nur Sitzung: balance.annual-retry.once; persistent: profile\_tagesgeld, profile\_cash\_history\_v1, … | Node 5; Browser 1; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#jahr-abschliessen) |
| I22 | index.html | Haushalt & Plan | Einmalige sichere Zusammenführung der Planungsdaten | bedingt sichtbar | nur Sitzung; persistent: household\_plan\_v1, annual\_plan\_record\_v1 | Node 5; Browser 4; Risiko 0; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I21 | index.html | Ausgaben im Abschlussdialog | CSV, Beispielausgaben, Vorschau und bestätigte Vermögenserfassung | bedingt sichtbar | persistent: balance\_expenses\_v1.years\[year\].months\[month\].profiles\[profileId\] | Node 5; Browser 1; Risiko 0; Schuld 0 | 1 | [Kapitel](../../Handbuch.html#ausgaben) |
| I20 | index.html | Monatsabschluss | Tagesgeld je Haushaltsperson, einzelne Bestätigung und Frischehinweis | bedingt sichtbar, sichtbar | persistent: overview\_month\_provision\_v1, profile\_tagesgeld, profile\_cash\_his… | Node 10; Browser 2; Risiko 1; Schuld 0 | 1, 6.3 | [Kapitel](../../Handbuch.html#monat-abschliessen) |
| I19 | index.html | Personenumstellung | Aufschub und sichere Wiederholung der Personenübernahme | bedingt sichtbar | nur Sitzung; persistent: profile\_person\_schema\_version, profile\_person\_migration\_v1, rs\_p… | Node 5; Browser 2; Risiko 0; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I17 | index.html | Arbeitsstand und letzte Ergebnisse | Gemeinsame offene Pflichtschritte und gespeicherte Simulationsbelege | bedingt sichtbar | persistent: overview\_simulation\_summary\_v1, rs\_profiles\_v1 | Node 5; Browser 1; Risiko 0; Schuld 0 | 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I16 | index.html | Vermögensverlauf | Tagesverlauf mit Nullstartstapeln oder Gesamtfläche, gleichmäßigem Raster und Originaltagesanzeige | bedingt sichtbar | keine | Node 13; Browser 1; Risiko 1; Schuld 0 | 6.3 | [Kapitel](../../Handbuch.html#vermoegensverlauf) |
| I02 | index.html | Personenverwaltung (Ersatzort für Startseite) | Profil auswählen und wechseln | sichtbar | persistent: rs\_profiles\_v1.profiles\[profileId\].data, rs\_profiles\_v1.profiles…; persistent: rs\_wealth\_history\_… | Node 9; Browser 6; Risiko 2; Schuld 0 | 5, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I03 | index.html | Personenverwaltung (Ersatzort für Startseite) | Profil anlegen und leeren Namen abweisen | sichtbar, bedingt sichtbar | persistent: rs\_profiles\_v1.profiles\[newId\].meta, rs\_profiles\_v1.profiles\[new… | Node 2; Browser 1; Risiko 1; Schuld 0 | 5, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I04 | index.html | Personenverwaltung (Ersatzort für Startseite) | Profil umbenennen, löschen und Löschbestätigung | sichtbar | persistent: rs\_profiles\_v1.profiles\[profileId\].meta.name, rs\_profiles\_v1.pro…; persistent: rs\_profiles\_v1.pro… | Node 2; Browser 1; Risiko 1; Schuld 0 | 5, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I05 | index.html | Profile und Übersicht | Vermögen & Ruhestand: Fachnavigation, bestätigter Flush und Profil-Handoff | sichtbar, bedingt sichtbar | nur Sitzung; persistent: rs\_profiles\_v1, rs\_current\_profile, rs\_active\_profile | Node 12; Browser 10; Risiko 1; Schuld 0 | 1, 2 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I06 | index.html | Profile und Übersicht | Handbuch über den Suite-Rahmen öffnen | sichtbar | keine | Node 1; Browser 4; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I07 | index.html | Profile und Übersicht | Vollsicherung: Erinnerung, Kopfpille und dynamischer zentraler Einstieg | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 6.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| I08 | index.html | Profile und Übersicht | Import-Deep-Link zur zentralen Sicherung | sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 2, 6.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| I09 | index.html | Profile und Übersicht | Registry-/Profil-Recovery: Export, bestätigter Reset, erneut versuchen | bedingt sichtbar, bewusst gesperrt | keine; persistent: rs\_profiles\_v1 oder genau recovery.storageKey / profiles\[profile… | Node 4; Browser 2; Risiko 1; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| I10 | index.html | Sicherung und Recovery | Speicher-Migrationswarnung, Importzugang und Schließen | bedingt sichtbar, sichtbar | nur Sitzung; keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| I11 | index.html | Entwickler | Entwicklertelemetrie über URL-Schalter | bedingt sichtbar | persistent: enableWorkerTelemetry | Node 0; Browser 0; Risiko 0; Schuld 1 | 1, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I12 | index.html | Kopfzeile und Altanker | Altanker zum gemeinsamen Probelaufdialog (ersetzt Aufklappzeile) | sichtbar | nur Sitzung | Node 1; Browser 0; Risiko 1; Schuld 0 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |
| I13 | index.html | Profile und Übersicht | Profilkontext beim Zurückkehren aus Browsercache erneuern | sichtbar | keine | Node 3; Browser 1; Risiko 1; Schuld 0 | 1, 2 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I14 | index.html | Profile und Übersicht | Einmaliger sitzungsweiter Kursabruf nach Appstart | sichtbar, bedingt sichtbar | nur Sitzung: rs\_startup\_prices\_session\_v1; persistent: depot\_tranchen, rs\_profiles\_v1 | Node 11; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#erste-schritte) |
| I15 | index.html | Profile und Übersicht | Persistente Verlaufsdatengrundlage und fortsetzbarer Tageskursjob | bedingt sichtbar | nur Sitzung: rs\_history\_fetch\_session\_v1; persistent: rs\_wealth\_history\_start\_v1, profile\_wealth\_history\_lots… | Node 2; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#vermoegensverlauf) |
| I18 | index.html | Kopfzeile und Probelaufband | Spielbereich: Kopie oder vier Beispielhaushalte, relative Zeitachse und Rückkehr | bedingt sichtbar, bewusst gesperrt | persistent: rs\_probelauf\_state\_v1 | Node 14; Browser 2; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |

#### Seitenzusätze

- **Tastatur:** Suite-Rahmenlinks und zentrale Sicherungseinstiege mit geschütztem Handoff und Flush. Native Tab-/Enter-/details-Bedienung; alte Sicherungs-/Importhashes führen zur zentralen Seite, \#probelaufControls nutzt nach sicherer Bindung denselben geschützten Kopfstartdialog. (I02, I05, I06, I08, I12)
- **Druck:** css/suite-frame.css @media print blendet Kopf, Hauptnavigation, Sprunglink und Fehlerhost aus und löst Rahmencontainerzwänge. Kein eigener Druckknopf; Seiteninhalt ohne zusätzliche Drucköffnung. Geschlossene Erweitert-Klappe und Devtools werden nicht für Druck geöffnet; Browserdruck bleibt ungeprüft. (I01, I12, I11, I05)
- **Meldungen:** Oberer Profil-/Speicher-Recoveryhost und fullBackupStatus; vier ruhige Kopfpillen. Speichertechnik ausschließlich auf Daten & Sicherung (D02). (I02, I03, I04, I07, I08, I09, I10)
- **Dialoge:** Vollimportdialoge liegen auf Daten & Sicherung; Profil-Recoveryreset und Personenumstellung behalten ihre Seitendialoge. Probelaufende verwendet Spielbereich beenden/Weiter testen. Personenverwaltung liegt im Manager. (I04, I07, I09, I11)
- **Handbuchanker:** Handbuch bleibt über den Suite-Rahmen mit bestehendem Handoff und Flush erreichbar. (I06, I05)

### Balance

Quelle: `Balance.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| B01 | Balance.html | Hülle und Navigation | Vermögen & Ruhestand: Kopfzeile, Hilfe und Übergabe zu Personen & Vermögen | sichtbar, bedingt sichtbar | keine; persistent: ui\_suite\_sidebar\_collapsed | Node 10; Browser 15; Risiko 1; Schuld 0 | 2 | [Kapitel](../../Handbuch.html#balance) |
| B49 | Balance.html | Personenumstellung | Aufschub und sichere Wiederholung der Personenübernahme | bedingt sichtbar | nur Sitzung; persistent: profile\_person\_schema\_version, profile\_person\_migration\_v1, rs\_p… | Node 5; Browser 2; Risiko 0; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#balance) |
| B02 | Balance.html | Tabs | Drei Balance-Reiter: Überblick, Bedarf & Strategie und Diagnose | sichtbar, bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 1; Schuld 0 | 2, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B03 | Balance.html | Profilverbund | Haushaltsauswahl und Entnahmeverteilung | bedingt sichtbar, technisch verborgen | persistent: rs\_profiles\_v1.profiles\[profileId\].meta.belongsToHousehold; persistent: household\_withdrawal\_mode | Node 1; Browser 1; Risiko 3; Schuld 0 | 3.1, 3.2, 5 | [Kapitel](../../Handbuch.html#balance) |
| B04 | Balance.html | Profilverbund | Versteckte Profil-, Renten- und Depotbrücken | technisch verborgen, sichtbar | keine | Node 2; Browser 1; Risiko 1; Schuld 0 | 3.2, 5 | [Kapitel](../../Handbuch.html#balance) |
| B05 | Balance.html | Bedarf & Strategie → Übernommen | Lesende Kachelreihe für Einkünfte und Bestände; verborgene Wertträger | technisch verborgen, bedingt sichtbar | keine | Node 3; Browser 2; Risiko 1; Schuld 0 | 3.1, 3.2, 5 | [Kapitel](../../Handbuch.html#balance) |
| B07 | Balance.html | Jahresprozess | Lesende Jahresinflation und Fortschreibung im Jahresabschluss | bedingt sichtbar, bewusst gesperrt | keine | Node 4; Browser 1; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#jahr-abschliessen) |
| B08 | Balance.html | Jahresprozess | Jahresprozess: transaktionaler Speicherabschluss über vorhandene Zugänge | sichtbar, bedingt sichtbar | persistent: ruhestandsmodellValues\_v29\_guardrails.inputs, ruhestandsmodellVa…; persistent: ruhestandsmodellVa… | Node 14; Browser 9; Risiko 2; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B09 | Balance.html | Monats- und Jahresabschluss | Jahresdialog, lokale Prüfschritte und Plananpassung | bedingt sichtbar | nur Sitzung; nur Sitzung: balance.annual-retry.once; persistent: profile\_tagesgeld, profile\_cash\_history\_v1, … | Node 15; Browser 7; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#jahr-abschliessen) |
| B12 | Balance.html | Marktdaten | Lesende Marktdatenkacheln, Korrekturfelder und Provenienz | bedingt sichtbar, sichtbar | persistent: ruhestandsmodellValues\_v29\_guardrails.inputs.endeVJ, ruhestandsm… | Node 4; Browser 1; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B13 | Balance.html | Bedarf und Strategie | Drei offene Bedarfswerte und gemeinsamer lokaler Versuch mit Auswahlübernahme | bedingt sichtbar, sichtbar | persistent: household\_plan\_v1 | Node 8; Browser 5; Risiko 2; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B14 | Balance.html | Bedarf & Strategie → Alle Parameter | Flex-Krisenbudget | bedingt sichtbar | persistent: household\_plan\_v1 | Node 0; Browser 0; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#warum-gekuerzt) |
| B15 | Balance.html | Bedarf & Strategie → Alle Parameter | CAPE, Dynamic-Flex-Preset und technische Detailansicht | bedingt sichtbar, sichtbar, technisch verborgen | persistent: household\_plan\_v1 | Node 7; Browser 2; Risiko 2; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#warum-gekuerzt) |
| B16 | Balance.html | Bedarf & Strategie → Alle Parameter | VPW-Horizont | bedingt sichtbar, bewusst gesperrt | persistent: household\_plan\_v1 | Node 1; Browser 1; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B17 | Balance.html | Bedarf & Strategie → Alle Parameter | Go-Go und Langlebigkeitsmodi | bedingt sichtbar, bewusst gesperrt, technisch verborgen | persistent: household\_plan\_v1 | Node 2; Browser 0; Risiko 2; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B18 | Balance.html | Bedarf & Strategie → Alle Parameter | Entnahmestrategie und drei Töpfe | bedingt sichtbar, sichtbar, technisch verborgen | persistent: household\_plan\_v1 | Node 1; Browser 1; Risiko 2; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B19 | Balance.html | Bedarf & Strategie → Alle Parameter | Liquidität, Rebalancing und Verkaufsgrenzen | bedingt sichtbar, sichtbar | persistent: household\_plan\_v1 | Node 2; Browser 0; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B20 | Balance.html | Steuerdaten | Lesender Personen-SPB und Steuern; verborgene Einstands- und TQF-Brücken | bedingt sichtbar, technisch verborgen, sichtbar | persistent: ruhestandsmodellValues\_v29\_guardrails.inputs.kirchensteuerSatz, … | Node 3; Browser 0; Risiko 1; Schuld 0 | 3.2, 5 | [Kapitel](../../Handbuch.html#balance) |
| B21 | Balance.html | Zentrale Sicherungseinstiege | Balance-Dateiaustausch über Navigation und Alt+E/Alt+I | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 6.2, 3.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| B22 | Balance.html | Zentrale Sicherungseinstiege | Wiederherstellung über Jahres-Recovery und alten Deeplink | bedingt sichtbar | keine | Node 3; Browser 1; Risiko 1; Schuld 0 | 6.2, 3.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| B23 | Balance.html | Sicherung | Bisherige Ordnerverbindung unter Daten & Sicherung | sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 6.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| B31 | Balance.html | Überblick | Budget, Handlungskurzfassung, Bedarf, Markt und Entnahme | bedingt sichtbar, sichtbar, technisch verborgen | keine | Node 12; Browser 3; Risiko 2; Schuld 0 | 3.1 | [Kapitel](../../Handbuch.html#balance) |
| B32 | Balance.html | Ergebnisse | Vorher-/Nachher-KPIs | bedingt sichtbar | keine | Node 3; Browser 1; Risiko 1; Schuld 0 | 3.1 | [Kapitel](../../Handbuch.html#balance) |
| B33 | Balance.html | Ergebnisse | Pflegebucket als diagnostische Reserve im Überblick | bedingt sichtbar | keine | Node 2; Browser 1; Risiko 1; Schuld 0 | 3.1 | [Kapitel](../../Handbuch.html#balance) |
| B34 | Balance.html | Ergebnisse | Entnahmeklappe im Überblick; Kapitalfluss im Handlungsdialog | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 3.1 | [Kapitel](../../Handbuch.html#balance) |
| B35 | Balance.html | Ergebnisse | Handlung als Text kopieren | bedingt sichtbar | keine | Node 2; Browser 0; Risiko 1; Schuld 0 | 3.1 | [Kapitel](../../Handbuch.html#balance) |
| B36 | Balance.html | Diagnose | Diagnosereiter öffnen, filtern und kopieren | sichtbar, bedingt sichtbar, technisch verborgen | nur Sitzung | Node 2; Browser 0; Risiko 1; Schuld 0 | 2, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B37 | Balance.html | Diagnose | Statuschips, Entscheidungsbaum, Leitplanken und Transaktionsgrenzen | bedingt sichtbar | keine | Node 4; Browser 1; Risiko 2; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B38 | Balance.html | Diagnose | Alle Kennzahlen mit vollständigen Diagnose-Schlüsselparametern | bedingt sichtbar | keine | Node 1; Browser 0; Risiko 1; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B39 | Balance.html | Meldungen | Berechnungs-, Feld-, Engine-, Persistenz- und Profilwarnungen | bedingt sichtbar, sichtbar | keine | Node 3; Browser 3; Risiko 1; Schuld 0 | 1, 3.1, 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B40 | Balance.html | Tastatur und Dialoge | Tastenkürzel und Dialogschließen | sichtbar, bedingt sichtbar | keine | Node 0; Browser 0; Risiko 1; Schuld 0 | 2, 6.2, 3.2, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B41 | Balance.html | Druck | Vollständiger Handlungsplan im nativen Details-/Druckdialog | sichtbar, bedingt sichtbar | keine | Node 4; Browser 2; Risiko 1; Schuld 0 | 2, 3.1, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B42 | Balance.html | Hilfen | Kontexthilfen, native Klappen und Entwicklertelemetrie | bedingt sichtbar | persistent: enableWorkerTelemetry | Node 1; Browser 0; Risiko 1; Schuld 1 | 1, 2, 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B45 | Balance.html | Meldungen | Unabhängige Erfolg-, Hinweis- und Fehlertoasts | bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 3.1, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B46 | Balance.html | Meldungen | Aktionsmeldungen: Jahresvorprüfung im offenen Dialog, sonst bestehender Seitenkanal | bedingt sichtbar, sichtbar | nur Sitzung | Node 6; Browser 3; Risiko 1; Schuld 0 | 1, 3.1, 3.2, 3.3 | [Kapitel](../../Handbuch.html#balance) |
| B47 | Balance.html | Überblick → Und jetzt? | Offene manuelle Cashbuchungen und Cashstatus-Auditwarnung | bedingt sichtbar | keine | Node 2; Browser 1; Risiko 1; Schuld 0 | 3.2 | [Kapitel](../../Handbuch.html#balance) |
| B48 | Balance.html | Spielbereich | Spielbereich: Kopie oder vier Beispielhaushalte, relative Zeitachse und Rückkehr | bedingt sichtbar, bewusst gesperrt | persistent: rs\_profiles\_v1, depot\_tranchen, profile\_wealth\_history\_lots\_v1, …; persistent: rs\_probelauf\_state… | Node 12; Browser 2; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |

#### Seitenzusätze

- **Tastatur:** Suite-Rahmenlinks nativ mit Navigationsschutz. Drei Balance-Reiter (Überblick, Bedarf & Strategie und Diagnose) mit Klick/Enter/Space sowie Arrow/Home/End, roving tabindex, ARIA und Fokus. Alt+j/e/i bleiben erhalten. Der Handlungsplan ist ein nativer Dialog; Schließen/Escape des Handlungsplans führt zurück zum Auslöser. Info per Hover/Fokus/Klick mit Escape und Fokuswechsel. Aktionsfehler behalten Schließfokus und Scope. (B02, B36, B40, B46, B01)
- **Druck:** Der native actionDetailsDialog enthält den vollständigen Handlungsplan, Empfehlungshinweis und aktuellen fachlichen Kontextfuß. Kopfdruck öffnet denselben Dialog. Druck blendet Rahmen, Eingaben, Historien, Meldungen, Overlays und andere Dialoge aus; keine Beschneidung durch Bildschirm-Maximalhöhe. Popupdruck ist extern offen. (B41, B45, B46, B01)
- **Meldungen:** Getrennte Fehler-, Toast- und Aktionsfehlerhosts unter den drei Reitern; ebenso Engine-/Persistenz-/Profilwarnungen und dauerhafter Pending-Recoveryhinweis. clearError bleibt auf Berechnungsfehler beschränkt; Scope, Toastfrist und Diagnose-Rückfokus bleiben erhalten. (B39, B45, B46)
- **Dialoge:** Jahresdialog, Handkurs und Handlungsplan behalten ihre Fachverträge. Jahres-Recovery führt mit Punkt-ID zur zentralen Vorschau; Snapshotrestore, Punktlöschung und Ordnerverbindung liegen auf Daten & Sicherung. Alte Balance-Sicherungskarte ist entfernt. (B08, B09, B22, B23, B36, B41)
- **Handbuchanker:** Inhalts-Hilfelink a\[href="Handbuch.html"\]\[target="\_blank"\] öffnet nativ ohne Hash den manual-Standardtab; der getrennte Handbuchlink im Rahmen öffnet im selben Tab nach Export und bestätigtem Flush. Keine Balance-spezifische Kapitel-/Fokusübergabe. (B01)

### Ausgaben

Quelle: `Ausgaben.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| B25 | Ausgaben.html | Ausgaben | Jahr, Personen und vier Kennzahlen im gemeinsamen Anzeigebereich | bedingt sichtbar | nur Sitzung | Node 5; Browser 3; Risiko 2; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| B26 | Ausgaben.html | Ausgaben | Monats-/Profilmatrix als alleiniger CSV-Importweg, Details und Löschen | bedingt sichtbar | persistent: balance\_expenses\_v1.years\[year\].months\[month\].profiles\[profileId… | Node 8; Browser 4; Risiko 1; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| B50 | Ausgaben.html | Ausgaben im Spielbereich | Beispielausgaben, Vorschau und bestätigter Fachimport | bedingt sichtbar | persistent: balance\_expenses\_v1.years\[year\].months\[month\].profiles\[profileId… | Node 4; Browser 1; Risiko 0; Schuld 0 | 1 | [Kapitel](../../Handbuch.html#probelauf) |
| B27 | Ausgaben.html | Ausgaben-Check | Native Ausgabendetails und Top-3-Kategorien | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| B28 | Ausgaben.html | Ausgaben | Ausgaben-Recovery mit Export vor Reset | bedingt sichtbar | keine; persistent: balance\_expenses\_v1.activeYear, balance\_expenses\_v1.years | Node 2; Browser 1; Risiko 2; Schuld 0 | 1, 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| B43 | Ausgaben.html | Ausgaben | Ausgaben je Jahr: Diagramm, Tabelle und sichere Zustände | bedingt sichtbar | keine | Node 5; Browser 2; Risiko 3; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| B44 | Ausgaben.html | Ausgaben → Verlauf | Automatische Vermögenserfassung nach bestätigtem Ausgabenimport | bedingt sichtbar | persistent: ruhestandsmodellValues\_v29\_guardrails.wealthHistory, rs\_profiles…; keine | Node 4; Browser 1; Risiko 1; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| E01 | Ausgaben.html | Ausgaben | Kategorien nach Jahr und Person mit erhaltenen Erstattungen | bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 0; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| E02 | Ausgaben.html | Ausgaben | Fälliger Monatsabschluss und Import unabhängig vom Ansichtsjahr | bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 0; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#ausgaben) |

#### Seitenzusätze

- **Tastatur:** Native Rahmenlinks, Jahres-/Personensegmente und Zellknöpfe; Details mit Fokusführung, Escape und bestätigter Löschung. (B25, B26, B50, B27, B28, B43, B44, E01, E02)
- **Druck:** Browserdruck der Ausgabenansicht; Bild-/Druckabnahme extern offen. (B25, B26, B50, B27, B28, B43, B44, E01, E02)
- **Meldungen:** Kennzahlen, Recovery und getrennte Import-/Capturemeldungen am neuen Ort. (B25, B26, B50, B27, B28, B43, B44, E01, E02)
- **Dialoge:** D5-Vorschau, Monatsdetails/Löschen, Recovery und gemeinsamer Monats-/Jahresdialog. (B25, B26, B50, B27, B28, B43, B44, E01, E02)
- **Handbuchanker:** Handbuch.html\#ausgaben; alter Kapitelanker \#balance-ausgaben-check bleibt Alias. (B25, B26, B50, B27, B28, B43, B44, E01, E02)

### Simulator

Quelle: `Simulator.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| S01 | Simulator.html | Hauptnavigation | Vermögen & Ruhestand: Seitennavigation und fünf Haupttabs | sichtbar, bedingt sichtbar | nur Sitzung; persistent: ui\_suite\_sidebar\_collapsed | Node 12; Browser 15; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S75 | Simulator.html | Personenumstellung | Aufschub und sichere Wiederholung der Personenübernahme | bedingt sichtbar | nur Sitzung; persistent: profile\_person\_schema\_version, profile\_person\_migration\_v1, rs\_p… | Node 5; Browser 2; Risiko 0; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#simulator) |
| S02 | Simulator.html | Annahmen | Annahmen: Bedarf offen, gemeinsamer Parameterzugang, Personen- und Pflegedetails | bedingt sichtbar | nur Sitzung | Node 4; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S03 | Simulator.html | Annahmen | Haushaltsprofile, Auswahl und Blockiermeldungen | sichtbar, bedingt sichtbar, bewusst gesperrt | persistent: rs\_profiles\_v1.profiles\[profileId\].meta.belongsToHousehold | Node 11; Browser 9; Risiko 3; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S04 | Simulator.html | Annahmen | Aggregiertes Startportfolio | bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 4; Browser 1; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S05 | Simulator.html | Annahmen | Versteckte Portfolio-/Goldwerte | technisch verborgen | nur Sitzung | Node 0; Browser 1; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S06 | Simulator.html | Annahmen | Planwerte gemeinsam ausprobieren und ausgewählt übernehmen | bedingt sichtbar | persistent: household\_plan\_v1, household\_simulator\_needs\_v1, household\_simul…; nur Sitzung | Node 4; Browser 2; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S07 | Simulator.html | Annahmen | Flex-Krisenbudget und CAPE | bedingt sichtbar | persistent: household\_plan\_v1 | Node 1; Browser 1; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S08 | Simulator.html | Annahmen | Dynamische Entnahme: Voreinstellung und Details | bedingt sichtbar, bewusst gesperrt, technisch verborgen | persistent: household\_plan\_v1, sim\_dynamicFlexPreset, sim\_dynamicFlexShowAdv… | Node 4; Browser 2; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S09 | Simulator.html | Annahmen | Horizontmethode und Anwendbarkeit | bewusst gesperrt, bedingt sichtbar | persistent: household\_plan\_v1 | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S10 | Simulator.html | Annahmen | Go-Go und Langlebigkeit | bewusst gesperrt | persistent: household\_plan\_v1 | Node 1; Browser 1; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S11 | Simulator.html | Annahmen | Standard-/Drei-Topf-Strategie | bedingt sichtbar | persistent: household\_plan\_v1 | Node 1; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S12 | Simulator.html | Annahmen | Liquiditäts-Reichweite, Mindest-Liquidität, Goldband und Verkaufsgrenzen | bedingt sichtbar | persistent: household\_plan\_v1; nur Sitzung | Node 1; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S13 | Simulator.html | Annahmen | Hauptprofil: zentrale Personenwerte und flüchtige Rechenalternativen | bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 7; Browser 3; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S14 | Simulator.html | Annahmen | Gemeinsame und ältere Rentenanpassungsfelder | bewusst gesperrt, technisch verborgen, bedingt sichtbar | nur Sitzung | Node 5; Browser 4; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S15 | Simulator.html | Annahmen | Versteckte Rentenbrücke | technisch verborgen | nur Sitzung | Node 5; Browser 3; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S16 | Simulator.html | Annahmen | Partner und zweite Rente | bewusst gesperrt, bedingt sichtbar, technisch verborgen | nur Sitzung | Node 9; Browser 4; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S17 | Simulator.html | Annahmen | Hinterbliebenenrente | bedingt sichtbar | nur Sitzung | Node 1; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S19 | Simulator.html | Annahmen | Pflege aktivieren, Modell, Ramp-up und Dauer | bedingt sichtbar | persistent: sim\_pflegefallLogikAktivieren, sim\_pflegeModellTyp, sim\_pflegeRa… | Node 3; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S20 | Simulator.html | Annahmen | Pflegekostenmodell und Hinweise | bedingt sichtbar | persistent: sim\_pflegeKostenStaffelPreset, sim\_pflegeMaxFloor, sim\_pflegeReg… | Node 1; Browser 0; Risiko 2; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S21 | Simulator.html | Annahmen | Pflegegrade 1–5: Kosten, Flex-Kürzung und Mortalität | bedingt sichtbar | persistent: sim\_pflegeStufe1Zusatz, sim\_pflegeStufe1FlexCut, sim\_pflegeStufe… | Node 1; Browser 0; Risiko 3; Schuld 0 | 4.1 | [Kapitel](../../Handbuch.html#simulator) |
| S23 | Simulator.html | Monte-Carlo | Monte-Carlo-Einstellungen öffnen und Zusammenfassung lesen | sichtbar, bedingt sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S24 | Simulator.html | Monte-Carlo | MC-Anzahl, Dauer, Methode, Blockgröße, Seed, RNG | sichtbar, bewusst gesperrt | persistent: sim\_mcAnzahl, sim\_mcDauer, sim\_mcMethode, sim\_mcBlockSize, sim\_m… | Node 2; Browser 2; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S25 | Simulator.html | Monte-Carlo | Workersteuerung und Ressourcenbestätigung | sichtbar, bedingt sichtbar | persistent: sim\_mcWorkerCount, sim\_mcWorkerBudget; nur Sitzung | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S26 | Simulator.html | Monte-Carlo | CAPE-Sampling und historische Auswahl | sichtbar, bedingt sichtbar | persistent: sim\_useCapeSampling, sim\_mcStartYearMode, sim\_mcStartYearFilter,… | Node 1; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S27 | Simulator.html | Monte-Carlo | Stresspreset und Tail-Risk-Parameter | sichtbar, bedingt sichtbar | nur Sitzung | Node 0; Browser 1; Risiko 3; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S28 | Simulator.html | Monte-Carlo | Seriell-/Worker-Vergleich mit Laufzeiten und Fallback | sichtbar, bedingt sichtbar | nur Sitzung | Node 0; Browser 0; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S29 | Simulator.html | Monte-Carlo | Monte-Carlo in Ergebnis und Einstellungen starten und abbrechen | sichtbar, bewusst gesperrt, technisch verborgen, bedingt sichtbar | nur Sitzung | Node 5; Browser 4; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S30 | Simulator.html | Monte-Carlo | MC-Fehler und Fehler schließen | bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S31 | Simulator.html | Monte-Carlo | Vollständigen MC-Lauf exportieren | bedingt sichtbar, bewusst gesperrt, sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| S32 | Simulator.html | Monte-Carlo | Vier MC-Ergebnisansichten | sichtbar, bedingt sichtbar | nur Sitzung | Node 3; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S33 | Simulator.html | Monte-Carlo | MC-Zusammenfassung und Kernantworten | bedingt sichtbar | nur Sitzung | Node 8; Browser 5; Risiko 4; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S34 | Simulator.html | Monte-Carlo | Haupt-KPIs und exakte Werte | bedingt sichtbar | nur Sitzung | Node 3; Browser 3; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S35 | Simulator.html | Monte-Carlo | Nominale und reale Drawdown-Karten: vier Prozentkennzahlen | bedingt sichtbar | nur Sitzung | Node 4; Browser 3; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S36 | Simulator.html | Monte-Carlo | Erweiterte operative, Risiko- und Tail-KPIs | bedingt sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S37 | Simulator.html | Monte-Carlo | Stress-KPI-Ausgabe | bedingt sichtbar | nur Sitzung | Node 2; Browser 0; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S38 | Simulator.html | Monte-Carlo | Entnahmequoten-Heatmap | sichtbar, bedingt sichtbar | nur Sitzung | Node 6; Browser 4; Risiko 3; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S39 | Simulator.html | Monte-Carlo | Pflege-KPIs je Person | bedingt sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S40 | Simulator.html | Monte-Carlo | Pflege-KPIs Haushalt und Reserve | bedingt sichtbar | nur Sitzung | Node 2; Browser 0; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S41 | Simulator.html | Monte-Carlo | Szenarioauswahl, Vermögensverläufe und Endwertverteilung | bedingt sichtbar | nur Sitzung | Node 15; Browser 6; Risiko 3; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S76 | Simulator.html | Monte-Carlo | Pfade vergleichen und Auffälligkeiten des gewählten Pfads | bedingt sichtbar | nur Sitzung | Node 4; Browser 0; Risiko 0; Schuld 1 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S42 | Simulator.html | Monte-Carlo | Detailliert und Pflege-Spalten | bedingt sichtbar | persistent: showCareDetails, worstLogDetailLevel | Node 7; Browser 3; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#monte-carlo) |
| S43 | Simulator.html | Monte-Carlo | Szenarioexport und Replay-Wechsel | bedingt sichtbar | nur Sitzung | Node 3; Browser 2; Risiko 2; Schuld 0 | 4.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| S44 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay-Auswahl, Status und Pfadfixierung | sichtbar, bedingt sichtbar, bewusst gesperrt | persistent: sim.stressReplay.active.v1 | Node 3; Browser 1; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S45 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay-Herkunft und Kompatibilität | sichtbar, bedingt sichtbar | nur Sitzung | Node 1; Browser 0; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S46 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay importieren/exportieren/verwerfen | bewusst gesperrt, sichtbar, technisch verborgen, bedingt sichtbar | persistent: sim.stressReplay.active.v1 | Node 3; Browser 1; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| S47 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay-Variantenname, drei Bedarfsfelder und Baseline | bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 1; Browser 1; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S48 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay-Expertenfelder | bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S49 | Simulator.html | Werkstatt / Stresspfad-Replay | Patchvorschau, Variantenliste und Aktionen | bedingt sichtbar, bewusst gesperrt | persistent: sim.stressReplay.active.v1 | Node 3; Browser 2; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S50 | Simulator.html | Werkstatt / Stresspfad-Replay | Replay-Kernaussage und drei Vergleichsansichten | sichtbar, bedingt sichtbar | nur Sitzung; persistent: overview\_simulation\_summary\_v1, rs\_profiles\_v1 | Node 4; Browser 2; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S51 | Simulator.html | Historischer Backtest | Backtestperiode, Validierung und Datenhinweis | sichtbar, bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#simulator) |
| S53 | Simulator.html | Historischer Backtest | Backtest starten, Status und Hinweise | sichtbar, bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 4; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#simulator) |
| S54 | Simulator.html | Historischer Backtest | Backtest-Kennzahlen, Auffälligkeiten, Portfoliochart und Krisenübersicht | bedingt sichtbar, sichtbar | nur Sitzung | Node 16; Browser 2; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#simulator) |
| S55 | Simulator.html | Historischer Backtest | Backtestlog, Detailmodus und Raw-Exporte | bedingt sichtbar | persistent: backtestLogDetailLevel | Node 13; Browser 4; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| S56 | Simulator.html | Historischer Backtest | Engine-/Parity-Diagnose | bedingt sichtbar | nur Sitzung | Node 2; Browser 1; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#simulator) |
| S57 | Simulator.html | Werkstatt / Parameter-Sweep | Sweep-Laufzahl und Arbeitslast | sichtbar | persistent: sim.sweep.runs | Node 3; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S58 | Simulator.html | Werkstatt / Parameter-Sweep | Sieben Sweep-Ranges und Anwendbarkeit | sichtbar, bedingt sichtbar | persistent: sim.sweep.liquidityRunwayYears, sim.sweep.goldRebalancingBand, s… | Node 3; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S59 | Simulator.html | Werkstatt / Parameter-Sweep | Sweep starten/abbrechen und Status | sichtbar, bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 4; Browser 4; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S60 | Simulator.html | Werkstatt / Parameter-Sweep | Sweep-Metrik, Achsen und Heatmap | bedingt sichtbar | nur Sitzung | Node 5; Browser 2; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S61 | Simulator.html | Werkstatt / Parameter-Sweep | Führende Kombination und Parameterübernahme | bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 3; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S62 | Simulator.html | Werkstatt / Parameter-Sweep | Sensitivität und Pareto | bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 4; Browser 2; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S63 | Simulator.html | Werkstatt / Parameter-Sweep | Sweep-Entwickler-/Demoausgaben | bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 3; Browser 1; Risiko 3; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#ausgaben) |
| S64 | Simulator.html | Werkstatt / Auto-Optimize | Auto-Optimize-Ziel und Quantil | sichtbar, bedingt sichtbar | nur Sitzung | Node 2; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S65 | Simulator.html | Werkstatt / Auto-Optimize | Sieben Optimierungs-Presets | sichtbar | nur Sitzung | Node 2; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S66 | Simulator.html | Werkstatt / Auto-Optimize | Dynamische Parameterblöcke, Min/Max/Schritt | sichtbar, bedingt sichtbar | nur Sitzung | Node 3; Browser 2; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S67 | Simulator.html | Werkstatt / Auto-Optimize | Optimierungsläufe, Seeds, Flex-Modus und Constraints | sichtbar | nur Sitzung | Node 0; Browser 1; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S68 | Simulator.html | Werkstatt / Auto-Optimize | Optimierung starten, Fortschritt, Fehler und Ergebnis übernehmen | bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 6; Browser 3; Risiko 2; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S69 | Simulator.html | Werkstatt / Auto-Optimize | Champion, Testmetriken, Deltas, Stabilität und Modellstatus | bedingt sichtbar | nur Sitzung | Node 3; Browser 3; Risiko 4; Schuld 0 | 4.3 | [Kapitel](../../Handbuch.html#werkstatt) |
| S70 | Simulator.html | Übergreifende Bedienung | Toasts, kontextuelle Hilfen und Formvalidierung | sichtbar, bedingt sichtbar | nur Sitzung | Node 1; Browser 0; Risiko 3; Schuld 0 | 2 | [Kapitel](../../Handbuch.html#simulator) |
| S71 | Simulator.html | Übergreifende Bedienung | Tastatur und Druck | sichtbar, bedingt sichtbar | nur Sitzung | Node 3; Browser 2; Risiko 2; Schuld 0 | 2 | [Kapitel](../../Handbuch.html#simulator) |
| S72 | Simulator.html | Übergreifende Bedienung | Worker-Telemetrie | bedingt sichtbar | persistent: enableWorkerTelemetry | Node 0; Browser 0; Risiko 2; Schuld 0 | 2 | [Kapitel](../../Handbuch.html#simulator) |
| S73 | Simulator.html | Profilkontext und Navigation | Profil-Lifecycle: Bootstrap, Handoff, Hintergrundspeicherung und BFCache | sichtbar | persistent: rs\_profiles\_v1.profiles\[profileId\].data | Node 6; Browser 2; Risiko 2; Schuld 0 | 2 | [Kapitel](../../Handbuch.html#simulator) |
| S74 | Simulator.html | Spielbereich | Spielbereich: Kopie oder vier Beispielhaushalte, relative Zeitachse und Rückkehr | bedingt sichtbar, bewusst gesperrt | persistent: rs\_probelauf\_state\_v1 | Node 12; Browser 2; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |

#### Seitenzusätze

- **Tastatur:** Suite-Rahmenlinks mit nativem Tab/Enter und sichtbarem Fokus; ein delegierter Klickbinder hält übernommene Navigation bis zum bestätigten Flush. Haupttabs nur Klick/native Enter/Space, kein ARIA-/Arrowmuster. S02: native Schrittknöpfe (ds-step-toggle) mit Enter/Space und aria-expanded, native details und Segmentknöpfe; Weiter/Zurück entfällt; gebundene Selects sind aus Tabreihenfolge und Barrierefreiheitsbaum entfernt, Labelaktivierung und Korrekturzugang fokussieren den gedrückten oder ersten freigegebenen Segmentknopf. MC-Cockpit: direkte vier Tablistener mit Pfeilen/Home/End/roving tabindex. Replayvergleich: click/keydown am statischen Vergleichshost delegiert, rerenderfester Fokus. Native details/Formular-/Selectbedienung; disabled-Fieldsets/Profil-/Busy-Sperren wirken zusätzlich. Werkstatt: drei sichtbare Kartenknöpfe, Pfeile/Home/End, aktive Tönung, Öffnen/Schließen mit Rückfokus; eine Fläche. Info-Popups unterstützen Hover, Fokus, Klick, Escape mit Rückfokus und Außenklick. (S01, S02, S23, S32, S47, S48, S50, S71)
- **Druck:** css/suite-frame.css @media print verbirgt den Rahmen und löst Containerzwänge. simulator.css zeigt als S71-Ausnahmen MC-/Werkstattahnen, Replaywerkzeug, MC-Setup, vier MC-Ansichten und drei Replayvergleiche auch bei verborgenem Replay. Sweep-/Auto-Optimize-Werkzeuge werden samt vorhandener Heatmap/Pareto beziehungsweise Championausgabe auch mit hidden und bei inaktiver Werkstatt gedruckt. Replay-Expertenfelder sind im Druck zugänglich. Navigation/Karten entfallen; Grafik-, Overflow- und Stickyregeln bleiben wirksam. Druck ändert weder DOM-Werkzeugwahl noch Fokus; für geschlossene Annahmenschritte und Detailklappen bleibt die Auswahl erhalten; MC-Kennzahlen und Floor-/KPI-Texte drucken auch geschlossen, ohne Tooltipduplikate. \#print-footer ist leer ohne Writer. Simulator.html und Designsystem tools registrieren die Werkzeugmatrix, letztere mit Ausgaben bei 1366/1920/2560 px; Ausführung extern offen. Vollständiger Setup-/Backtest-/Sweep-/Optimizerdruck bleibt Prüflücke. (S01, S02, S23, S32, S50, S55, S60, S69, S71)
- **Meldungen:** Getrennte Profil-/Migrationsstatus, customValidity der Haushaltsbedarfe, MC-runstatus/alert-Fehlerbox/exportstatus, Replay-live-status/Vorschau/technische Vergleichsfehler, Backtest-feldbezogene Fehler/status/Info-Popup, Sweep-status und Auto-Optimize-progress plus gemeinsame Seitendialoge für Hinweise, Großlast und Pareto. Kurzlebige Exporttoasts und title-Normalisierung ersetzen diese dauerhaften Zustände nicht. „Niedrige Entnahme“ nur an der sichtbaren Entnahme, strikt unter endlicher CaR-Schwelle auf Basis der realen Jahresentnahme; ohne zugehörige Schwelle keine Markierung. Verkäufe neutral, Käufe hervorgehoben; Rohzeilen und JSON/CSV unverändert. Node-Belege für Zellzuordnung, Exportgleichheit und Kontrast; externe EXE-/Bildabnahme offen. (S03, S06, S29, S30, S31, S44, S45, S49, S50, S51, S53, S57, S59, S62, S68, S70)
- **Dialoge:** Replay-Ersetzen/-Import/-Verwerfen und Sweep-Großlast nutzen app/shared/page-dialog.js mit konkreten Bestätigungs-/Abbruchknöpfen. Pareto verwendet requestPageChoice mit zwei Selects, acht bisherigen Metriken und Diagramm anzeigen/Abbrechen. Hinweise nutzen Verstanden ohne fachliche Zustimmung. Pending/Busy und Kontextprüfung schützen Jobs/Writes. MC-Ergebnispanels, Filechooser, Inline-Telemetrie und Navigationsschutz bleiben eigenständig. Browser-/Bild-/WebViewabnahme extern offen. (S46, S57, S59, S62, S68, S72)
- **Handbuchanker:** Inhalts-Hilfelink a\[href="Handbuch.html"\]\[target="\_blank"\] ohne Kapitelhash öffnet nativ den manual-Standardtab. Rahmenlinks zu Handbuch und Übersicht wechseln im selben Tab nach Export und bestätigtem Flush; kein spezieller Simulator-Handbuchanker. (S01, S73)

### Personen & Vermögen

Quelle: `depot-tranchen-manager.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| V01 | depot-tranchen-manager.html | Personen & Vermögen | Vermögen & Ruhestand: Zurücknavigation, interner Profilkontext und Kartenalter | sichtbar, bedingt sichtbar | keine; persistent: ui\_suite\_sidebar\_collapsed | Node 12; Browser 16; Risiko 2; Schuld 0 | 2, 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V27 | depot-tranchen-manager.html | Personenumstellung | Aufschub und sichere Wiederholung der Personenübernahme | bedingt sichtbar | nur Sitzung; persistent: profile\_person\_schema\_version, profile\_person\_migration\_v1, rs\_p… | Node 5; Browser 2; Risiko 0; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V02 | depot-tranchen-manager.html | Personen & Vermögen | Tagesgeld separat von Tranchen | bedingt sichtbar, bewusst gesperrt | persistent: profile\_tagesgeld, rs\_profiles\_v1.profiles\[profileId\].data.profi…; persistent: profile\_cash\_histo… | Node 10; Browser 0; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V03 | depot-tranchen-manager.html | Personen & Vermögen | Personendaten: heutiges Alter, Januarplanung und Herkunft | bedingt sichtbar, bewusst gesperrt, sichtbar, technisch verborgen | persistent: profile\_rente\_aktiv, profile\_rente\_monatlich, profile\_sonstige\_e…; keine | Node 16; Browser 6; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V04 | depot-tranchen-manager.html | Personen & Vermögen | Goldstrategie: Aktivierung, Ziel, Floor, Band und Steuerfreiheit | bedingt sichtbar, bewusst gesperrt, technisch verborgen | persistent: profile\_gold\_aktiv, profile\_gold\_ziel\_pct, profile\_gold\_floor\_pc… | Node 3; Browser 0; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V05 | depot-tranchen-manager.html | Personen & Vermögen | Pflegebucket: Aktivierung, Betrag, Quelle und Pflegegrad | bedingt sichtbar, bewusst gesperrt, technisch verborgen | persistent: profile\_health\_bucket, rs\_profiles\_v1.profiles\[profileId\].data.p… | Node 3; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V06 | depot-tranchen-manager.html | Personen & Vermögen | Pflegebucket-Policies: Trigger, Deckung, Rendite und Inflationssicht | bedingt sichtbar, bewusst gesperrt | persistent: profile\_health\_bucket, rs\_profiles\_v1.profiles\[profileId\].data.p… | Node 2; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V07 | depot-tranchen-manager.html | Personen & Vermögen | Profil- und Planvalidierung, Autosave, bestätigte Writes und Warteschlange | bedingt sichtbar, bewusst gesperrt, technisch verborgen | persistent: profile\_tagesgeld, profile\_rente\_aktiv, profile\_rente\_monatlich,…; persistent: household\_plan\_v1 | Node 7; Browser 1; Risiko 1; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V07.1 | depot-tranchen-manager.html | Haushalt & Plan | Gemeinsame Dynamic-Flex-Voreinstellungen im Manager | bedingt sichtbar | persistent: household\_plan\_v1 | Node 2; Browser 1; Risiko 0; Schuld 0 | 1 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V08 | depot-tranchen-manager.html | Tranchen und Kurse | Kauf eintragen: neue Tranche öffnen | sichtbar, bewusst gesperrt | nur Sitzung | Node 1; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V09 | depot-tranchen-manager.html | Tranchen und Kurse | Zeilenaktionen bearbeiten/löschen und gesamten Bestand löschen | sichtbar, bedingt sichtbar | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr… | Node 4; Browser 2; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V10 | depot-tranchen-manager.html | Tranchen und Kurse | EUR-Kursbatch, Proxycheck, Teilfehler und Preisprovenienz | sichtbar, bewusst gesperrt, bedingt sichtbar | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr… | Node 6; Browser 3; Risiko 1; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#kauf) |
| V11 | depot-tranchen-manager.html | Tranchen und Kurse | Depotbewertung, Tranchensumme, Kursstand und leerer Bestand | sichtbar, bedingt sichtbar | keine | Node 5; Browser 2; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V12 | depot-tranchen-manager.html | Tranchen und Kurse | Gruppiertes Depot: Anlageformen, Gruppensummen und Kaufdatumssortierung sowie Kursverlauf und aufklappbare Details | sichtbar, bedingt sichtbar | keine | Node 10; Browser 2; Risiko 4; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#vermoegensverlauf) |
| V13 | depot-tranchen-manager.html | Tranchendialog | Identifikation, Bestand und Kurseingaben | bedingt sichtbar | nur Sitzung | Node 4; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V14 | depot-tranchen-manager.html | Tranchendialog | Kategorie-/Typvertrag, Teilfreistellung, explizite Steuerfreiheit und Notiz | bedingt sichtbar, technisch verborgen | nur Sitzung | Node 4; Browser 2; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V15 | depot-tranchen-manager.html | Tranchendialog | Speichern, Dialogretry, Abbruch, Feldfehler und Dialogtastatur | bedingt sichtbar | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr… | Node 6; Browser 4; Risiko 2; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V16 | depot-tranchen-manager.html | Meldungen und Recovery | Speicherstatus und Load-/Save-Retry | bedingt sichtbar | nur Sitzung | Node 4; Browser 2; Risiko 1; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| V17 | depot-tranchen-manager.html | Meldungen und Recovery | Korrupte Tranchen: bewusst Rohdaten anzeigen/kopieren, Reset und Rückwege | bedingt sichtbar | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr… | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| V18 | depot-tranchen-manager.html | Verkauf eintragen → Ausführung, Cash, Vorschau | Broker-Ausführung über exakte Profil-/Tranche-/Action-ID erfassen | sichtbar, bewusst gesperrt, bedingt sichtbar | nur Sitzung | Node 2; Browser 2; Risiko 2; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#verkauf) |
| V19 | depot-tranchen-manager.html | Verkauf eintragen → Ausführung, Cash, Vorschau | Optionale Empfehlung und Ist-Abweichung | sichtbar, bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 1; Browser 1; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#verkauf) |
| V20 | depot-tranchen-manager.html | Verkauf eintragen → Ausführung, Cash, Vorschau | Schreibfreie Vorschau, Status, getrennte Bestätigung und Abbruch | sichtbar, bedingt sichtbar, bewusst gesperrt | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr…; persistent: profile\_wealth\_his… | Node 5; Browser 2; Risiko 2; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#verkauf) |
| V21 | depot-tranchen-manager.html | Verkauf eintragen → Ausführung, Cash, Vorschau | Cashstatuswahl in Verkaufsschritt 2 | sichtbar, bedingt sichtbar, bewusst gesperrt | nur Sitzung | Node 2; Browser 2; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#verkauf) |
| V22 | depot-tranchen-manager.html | Verkäufe & Cashstatus | Dynamische Cashhistorie, Altverkäufe, wirksamer Nachweis und Aktionen | sichtbar, bedingt sichtbar, bewusst gesperrt | keine | Node 2; Browser 1; Risiko 3; Schuld 0 | 1, 5 | [Kapitel](../../Handbuch.html#verkauf) |
| V23 | depot-tranchen-manager.html | Cashdialog | Cashbestätigung und lineare Korrektur mit Grund, Fokus und Konfliktprüfung | bedingt sichtbar, bewusst gesperrt | persistent: rs\_profiles\_v1.trancheReconciliation.actions, rs\_profiles\_v1.tra… | Node 9; Browser 4; Risiko 2; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V24 | depot-tranchen-manager.html | Hilfen und Bedienung | Feldhilfen, Labels und Tabellen-/Dialogzugänglichkeit | bedingt sichtbar | keine | Node 3; Browser 1; Risiko 1; Schuld 0 | 2, 5 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| V25 | depot-tranchen-manager.html | Kurszeit-Datenvertrag | asOf: Lokales Kursdatum im Depot, Provenienz und Balance-Kursfrische | sichtbar, bewusst gesperrt, bedingt sichtbar | persistent: depot\_tranchen, rs\_profiles\_v1.profiles\[profileId\].data.depot\_tr… | Node 11; Browser 3; Risiko 1; Schuld 0 | 5 | [Kapitel](../../Handbuch.html#kauf) |
| V26 | depot-tranchen-manager.html | Spielbereich | Spielbereich: Kopie oder vier Beispielhaushalte, relative Zeitachse und Rückkehr | bedingt sichtbar, bewusst gesperrt | persistent: rs\_probelauf\_state\_v1 | Node 11; Browser 2; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |
| B29 | depot-tranchen-manager.html | Vermögensverlauf | Stand jetzt erfassen mit bestätigten Quellen und Sieben-Tage-Kursgate | sichtbar | persistent: rs\_household\_wealth\_captures\_v1, ruhestandsmodellValues\_v29\_guar… | Node 2; Browser 0; Risiko 0; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#vermoegensverlauf) |
| B30 | depot-tranchen-manager.html | Vermögensverlauf | Tageslinie und Tageskennzahlen getrennt von erfassten Ständen, Abschlussrauten und Tabelle | bedingt sichtbar, sichtbar | keine | Node 2; Browser 0; Risiko 0; Schuld 0 | 3.3 | [Kapitel](../../Handbuch.html#vermoegensverlauf) |

#### Seitenzusätze

- **Tastatur:** Suite-Rahmenlinks mit nativem Tab/Enter und sichtbarem Fokus; ein delegierter Klickbinder hält übernommene Navigation bis zum bestätigten Flush. Keine globalen Tastenkürzel. Native Tab/Enter/Space und details-Bedienung; fokussierbare dynamische Scrollregion. Tranche-/Cashmodal: direkter keydown für Escape/Tab/Shift+Tab, Erstfokus Name/Cashbalance und gespeicherter Rückfokus. Escape/Abbrechen prüfen echte Commitflags; Dirty-Schließen verlangt Verwerfen. Tranchenhintergrund ignoriert Dirty-Klicks und erhält Fokus, Cashhintergrund bleibt ein geprüfter Schließweg. Die oberste Schutznachfrage konsumiert Escape. Cash-Cancelbutton ist während Cashcommit zusätzlich disabled. Keine pauschale Tastaturvollabdeckung behauptet. Tranchendialoge lösen entfernte Auslöser nach Editrender über stabile ID neu auf. Cash-Rückfokus löst erneuerte Auslöser über den Zielverkauf auf; Browserabnahme offen. (V12, V15, V19, V23, V24, V01)
- **Druck:** css/suite-frame.css @media print blendet Kopf, Hauptnavigation, Sprunglink und Fehlerhost aus und löst Rahmencontainerzwänge. Keine eigene @media print-Regel und kein Druckbutton in depot-tranchen-manager.html. Browserdruck druckt den aktuellen sichtbaren Bestand; verborgene Modals/geschlossene Empfehlungsdetails werden nicht eigens geöffnet, Tabelle kann breit bleiben. Vollständiger Druck ist Prüflücke, keine bereits erfüllte neue Druckfunktion. (V12, V19, V24, V01)
- **Meldungen:** Getrennte Hosts für Kurs-/Proxytext, Persistenzstatus mit pending/error/ok und quantifizierter Legacy-Steuerwarnung, Profilfeldalert, Tranchefeldalert, Reconcile-status und dynamischen Cashdialogfehler. Unavailable erhält bestätigten Bestand/Loadretry, corrupt sperrt Verarbeitung und bietet bewusste Rohdaten-/Reset-/Backupwege. Fehlflush rollt zurück und liefert priorisierten Saveretry, nicht unbestätigten Erfolg. Unlesbarer Cashaudit meldet ausdrücklich unvollständige Liste statt leeren Bestand. (V07, V10, V15, V16, V17, V20, V22, V23)
- **Dialoge:** Tranchendialog und Cashbestätigungs-/Korrekturdialog behalten ihre Lifecycle-/Fokusbindung. Einzel-/Gesamtlöschung, Corruptreset, Ausführungsabgleich und Profillöschung verwenden den gemeinsamen Seitendialog app/shared/page-dialog.js. Kurshinweise nutzen Verstanden. Keine fachliche Zustimmung bei Escape, Signalabbruch oder Öffnungsfehler. Kein eigener Bestandimport/-export; zentraler Backupimport per Link zur Startseite. (V08, V09, V10, V13, V14, V15, V17, V20, V23)
- **Handbuchanker:** Rahmenlink zu Handbuch.html ohne Kapitelhash; kein direkter Handbuchkapitelanker. \#managerBackLink führt nach Export und bestätigtem Flush zu index.html. Recoverylinks erhalten Navigationsschutz und Flush ohne Export zu index.html bzw. index.html\#fullBackupImportBtn; der Hash fokussiert den zentralen Backupimport. Anerkannte Manager-Sprungziele laufen beim Start und bei Hashwechseln zentral über startTranchenManagerPage/openManagerOverviewTarget; Karten und Personenverwaltung binden nur ihre eigenen Bedienereignisse. (V01, V17, V24)

### Handbuch

Quelle: `Handbuch.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| H01 | Handbuch.html | Navigation | Vermögen & Ruhestand: Handbuch und Seiteneinstieg | sichtbar, bedingt sichtbar | keine; nur Sitzung; persistent: ui\_suite\_sidebar\_collapsed | Node 9; Browser 15; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| H02 | Handbuch.html | Navigation | Kapitelstart und Suche über den Kapiteltext | bedingt sichtbar | nur Sitzung | Node 1; Browser 1; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| H03 | Handbuch.html | Navigation | Mitlaufende Kapitelnavigation, Hilfesprünge, Hash und Fokus | bedingt sichtbar | nur Sitzung | Node 0; Browser 0; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#haeufige-fragen) |
| H04 | Handbuch.html | Handbuchartikel | Erste Schritte: Personen, Bestände, Tagesgeld und Sicherung | bedingt sichtbar, sichtbar | keine | Node 0; Browser 0; Risiko 1; Schuld 1 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| H05 | Handbuch.html | Handbuchartikel | Simulator-Annahmen: Bedarf, Parameterzugang, Personen und Pflege | bedingt sichtbar | keine | Node 1; Browser 0; Risiko 1; Schuld 2 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#simulator) |
| H06 | Handbuch.html | Handbuchartikel | Simulator-Auswertung und fortgeschrittene Verfahren | bedingt sichtbar | keine | Node 3; Browser 0; Risiko 1; Schuld 1 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#monte-carlo) |
| H07 | Handbuch.html | Handbuchartikel | Balance-Jahresprozess, Marktdaten und Archiv | bedingt sichtbar | keine | Node 2; Browser 0; Risiko 1; Schuld 1 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#balance) |
| H08 | Handbuch.html | Handbuchartikel | Balance lesen: Jahresbeschluss, Mindest-Flex und Parameterzugang | bedingt sichtbar | keine | Node 1; Browser 0; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#balance) |
| H09 | Handbuch.html | Handbuchartikel | Personen & Vermögen: Auf einen Blick, Planwerte und Tranchen | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 1; Schuld 1 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#haushalt-plan) |
| H10 | Handbuch.html | Handbuchartikel | Onboarding und regelmäßige Pflege | bedingt sichtbar | keine | Node 0; Browser 0; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#erste-schritte) |
| H11 | Handbuch.html | Handbuchartikel | Probleme, FAQ und Glossar | bedingt sichtbar | keine | Node 1; Browser 0; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#begriffe) |
| H12 | Handbuch.html | Handbuchartikel | Datenquellen, Versionen, Dokumente und Support | bedingt sichtbar | keine | Node 0; Browser 0; Risiko 1; Schuld 1 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#haeufige-fragen) |
| H13 | Handbuch.html | Handbuchartikel | App-Bilder, Tabellen und Hinweise | bedingt sichtbar | keine | Node 1; Browser 1; Risiko 2; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#haeufige-fragen) |
| H14 | Handbuch.html | Navigation | Querverweise öffnen Kapitel und Abschnitte | bedingt sichtbar | nur Sitzung | Node 0; Browser 0; Risiko 1; Schuld 0 | 1, 2, 6.3 | [Kapitel](../../Handbuch.html#haeufige-fragen) |
| H15 | Handbuch.html | Spielbereich | Spielbereich: Vergleich, Verwerfen und vollständige Übernahme mit Rückkehrpunkt | bedingt sichtbar, sichtbar, bewusst gesperrt | persistent: rs\_probelauf\_state\_v1 | Node 13; Browser 2; Risiko 0; Schuld 1 | 6.3 | [Kapitel](../../Handbuch.html#probelauf) |

#### Seitenzusätze

- **Tastatur:** Native Links und Buttons mit Tab/Enter; Kapitelbinder setzt Zielfokus und Hash. Strg+K/Cmd+K fokussiert die Suche; Escape leert sie. Rahmenhandoff und Flush bleiben beim App-Wechsel erhalten. (H01, H02, H03, H14)
- **Druck:** Keine eigenen Druckregeln oder Druckaktionen im Handbuch; bestehender Suite-Rahmen unverändert. (H13, H01)
- **Meldungen:** Direkte Hilfesprünge zeigen Hinweisleiste und Abschnittsmarkierung; Suche zeigt Trefferzahl oder einen verständlichen Leertreffertext. (H02, H03, H13)
- **Dialoge:** Keine eigenen Fachdaten- oder Tourdialoge. Bestehender Navigationsschutz des Suite-Rahmens bleibt erhalten. (H12)
- **Handbuchanker:** Rahmenlink öffnet den Aufgabenstart. Direkte Hashziele aus HTML und Renderern öffnen passende Kapitel; alte IDs bleiben Aliasse. Die Kapitelnavigation ändert keinen Fachspeicher. (H01, H03, H14)
- **Externer Anker:** index.html → kein Kapitelhash; H01; Tab start; Kein Fokusaufruf beim Laden; normale Seitennavigation ohne Hash.; Handbuchkarte geschützt im gleichen Tab ohne Export; separater Rahmenlink mit Profilhandoff.
- **Externer Anker:** Balance.html → kein Kapitelhash; H01; Tab start; Kein Fokusaufruf beim Laden; normale Seitennavigation ohne Hash.; Inhaltshilfe: neuer Tab durch target=\_blank; Rahmen: gleicher Tab mit Profilhandoff.
- **Externer Anker:** Simulator.html → kein Kapitelhash; H01; Tab start; Kein Fokusaufruf beim Laden; normale Seitennavigation ohne Hash.; Inhaltshilfe: neuer Tab durch target=\_blank; Rahmen: gleicher Tab mit Profilhandoff.
- **Externer Anker:** depot-tranchen-manager.html → kein Kapitelhash; H01; Tab start; Kein Fokusaufruf beim Laden; normale Seitennavigation ohne Hash.; Rahmenlink im gleichen Tab mit Profilhandoff.

### Daten & Sicherung

Quelle: `Daten-Sicherung.html`

| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |
|---|---|---|---|---|---|---|---|---|
| D05 | Daten-Sicherung.html | Neu beginnen | Gesamten Appbestand löschen und mit Erststart neu beginnen | sichtbar, technisch verborgen | persistent: rs\_profiles\_v1, rs\_snapshot\_archive\_v1, ui\_suite\_sidebar\_collaps… | Node 1; Browser 0; Risiko 0; Schuld 0 | 6.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| D01 | Daten-Sicherung.html | Vollsicherung | Vollsicherung ausgeben und einspielen, bestätigte Zeit und Vergleichsbasis | sichtbar, technisch verborgen | persistent: overview\_last\_full\_backup\_v1, rs\_data\_backup\_summary\_v1 | Node 11; Browser 5; Risiko 0; Schuld 0 | 6.2 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| D02 | Daten-Sicherung.html | Zustand und Navigation | Sicherungszustand, Archiv, Kurse und Speicher | sichtbar, bedingt sichtbar, technisch verborgen | keine; persistent: rs\_daily\_prices\_v1, rs\_wealth\_history\_start\_v1, profile\_wealth\_h… | Node 9; Browser 2; Risiko 1; Schuld 0 | 6.2, 6.3 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| D03 | Daten-Sicherung.html | Wiederherstellungspunkte | Punkte mit Vorschau zurückholen und sicher aufbewahren | technisch verborgen, sichtbar | persistent: rs\_snapshot\_archive\_v1 | Node 4; Browser 1; Risiko 1; Schuld 0 | 6.3 | [Kapitel](../../Handbuch.html#daten-sicherung) |
| D04 | Daten-Sicherung.html | Austausch | Personenaustausch, weitere Balance-/Ordnerwege und Simulatorprotokolle | sichtbar, technisch verborgen, bedingt sichtbar | persistent: rs\_profiles\_v1, ruhestandsmodellValues\_v29\_guardrails | Node 3; Browser 1; Risiko 1; Schuld 0 | 6.3 | [Kapitel](../../Handbuch.html#daten-sicherung) |

#### Seitenzusätze

- **Tastatur:** Native Tab-/Enter-Bedienung und bestehender geschützter Suite-Handoff. (D01, D02, D03)
- **Druck:** Suite-Rahmen und Backupaktionen im Druck ausgeblendet; externe Druckabnahme ausstehend. (D01, D02, D03)
- **Meldungen:** Sicherungsstatus live; fehlende Zeit, Basis und unlesbare Daten ausdrücklich benannt. (D01, D02, D03)
- **Dialoge:** Vollimport mit bestehendem Seitendialog, Recoverydatei und bestätigtem Archivpunkt. (D01, D02, D03)
- **Handbuchanker:** Handbuch über geschützten Direktanker \#daten-sicherung; TOC, Hash und Fokus führen zum Kapitel Daten sichern & wiederherstellen. (D01, D02, D03)


### Zusätzliche Auftretensorte

- **I24 → Balance.html · Jahresabschluss:** \[data-plan-dynamic-presets\], \[data-plan-dynamic-preset\], \[data-plan-dynamic-hint\], \[data-plan-dynamic-details\]; Node 2, Browser 1.
- **I23 → Balance.html · Plan prüfen / Plan anpassen:** \[data-annual-plan-toggle\], \[data-annual-plan-panel\], \[data-annual-plan-discard\], \[data-annual-plan-adjusted\], \[data-plan-segment\], \[data-plan-segment-value\]; Node 1, Browser 1.
- **I22 → Balance.html · Haushalt & Plan:** \#householdPlanNotice, \[data-household-plan-open\], \#householdPlanDialog, \[data-household-plan-field\], \[data-household-plan-sources\], \[data-household-plan-validation\], \[data-household-plan-reset\], \[data-household-plan-later\], \[data-household-plan-accept\]; Node 2, Browser 3.
- **I22 → Simulator.html · Haushalt & Plan:** \#householdPlanNotice, \[data-household-plan-open\], \#householdPlanDialog, \[data-household-plan-field\], \[data-household-plan-sources\], \[data-household-plan-validation\], \[data-household-plan-reset\], \[data-household-plan-later\], \[data-household-plan-accept\]; Node 2, Browser 3.
- **I02 → depot-tranchen-manager.html · Haushalt und Ansichten:** \#managerHousehold, \#managerSectionNav, \#managePeopleBtn, \#managerPeopleModal, \#managerPlanPanel, \#managerPersonPanel, \[data-manager-profile\], \[data-manager-people\], .pv-avatar, .pv-person-card, .pv-household-card, .pv-tab, \#managerHistoryStartStatus, \#managerHistoryStartForm, \#managerHistoryStart, \#managerHistoryStartConfirm, .pv-person-history, \[data-history-start-form\], \[data-history-start-input\], \[data-history-recovery\], \#managerHistoryRecoveryStatus, .history-measurement; Node 9, Browser 2.
- **I03 → depot-tranchen-manager.html · Personen verwalten:** \#managePeopleBtn, \#managerPeopleModal, \#managerPeopleList, \#managerPersonName, \#managerPeopleStatus, \#managerPeopleForm, \#managerPersonCreateBtn, \#managerHousehold, \#profileManagePeopleBtn, \[data-manager-people\]; Node 2, Browser 1.
- **I04 → depot-tranchen-manager.html · Personen verwalten:** \#managePeopleBtn, \#managerPeopleModal, \#managerPeopleList, \#managerPersonName, \#managerPeopleStatus, \#managerPeopleForm, \#managerPersonRenameBtn, \#managerPersonRenameCancelBtn, \#managerHousehold, \#profileManagePeopleBtn, \[data-person-action="rename"\], \[data-person-action="delete"\], \[data-person-membership\], \[data-manager-people\]; Node 2, Browser 1.
- **I09 → depot-tranchen-manager.html · Unabhängige Profil-Recovery:** \#managerProfileRecovery, \[data-profile-recovery\], \[data-profile-recovery-action="retry"\], \[data-profile-recovery-action="export"\], \[data-profile-recovery-action="reset"\]; Node 1, Browser 1.
- **I18 → Balance.html · Kopfzeile und Probelaufband:** \#probelaufBand, \#probelaufBandText, \[data-probelauf-action\], \#probelaufStart, \#probelaufStatus; Node 1, Browser 1.
- **I18 → Simulator.html · Kopfzeile und Probelaufband:** \#probelaufBand, \#probelaufBandText, \[data-probelauf-action\], \#probelaufStart, \#probelaufStatus; Node 1, Browser 1.
- **I18 → depot-tranchen-manager.html · Kopfzeile und Probelaufband:** \#probelaufBand, \#probelaufBandText, \[data-probelauf-action\], \#probelaufStart, \#probelaufStatus; Node 1, Browser 1.
- **I18 → Handbuch.html · Kopfzeile und Probelaufband:** \#probelaufBand, \#probelaufBandText, \[data-probelauf-action\], \#probelaufStart, \#probelaufStatus; Node 1, Browser 1.
- **I18 → Daten-Sicherung.html · Kopfzeile und Probelaufband (ohne zusätzliche Karte):** \#probelaufBand, \#probelaufBandText, \[data-probelauf-action\], \#probelaufStart, \#probelaufStatus; Node 1, Browser 1.

## Schutz und Risiken

### Dynamische Schutzstatistik

194 Funktionseinträge; 414 dynamische Belege:

- geschützt: **389**
- ungeschützt (Anker fehlt): **6**
- ungeschützt (Erzeugungsform vom Prüfer nicht unterstützt): **19**

Gemischte Einträge sind nur für ihre einzeln als geschützt ausgewiesenen Belege geschützt. Beide ungeschützten Kategorien zählen separat.

### Funktionen ohne vollständigen Zielbildplatz

- **I04:** Personen & Vermögen → Personen verwalten / Personenreiter — Umbenennen, bestätigtes Löschen und Schutz des letzten Defaultprofils ergänzen.
- **I09:** Personen & Vermögen → Profil-Recovery (auch Startseite) — Recovery sichtbar ergänzen; Exportvoraussetzung, gezielten Scope und Sperren erhalten.
- **I10:** Gemeinsamer seitenweiter Recoverybereich — Warnung außerhalb Erweitert, Importzugang und nur sitzungsweises Schließen ergänzen.
- **I11:** Entwicklerbereich → Worker-Telemetrie — Optionalen Entwicklerbereich samt URLbedingung, lokalem Schalter und Reloadhinweis ergänzen.
- **B07:** Jahresprozess — Eigenständige Anpassung außerhalb des Jahresdialogs unter Marktdaten/Einstellungen erhalten.
- **B35:** Ergebnisse — Textkopie in Handlungsschritten ergänzen.
- **B41:** Druck — Druckbaren Jahresplan mit UI-/Engineversion erhalten; für Auswertung eigene Druckentscheidung treffen.
- **B42:** Kontexthilfen / Entwicklerbereich — Entwicklerbereich separat erhalten und nicht mit druckbarem Finanzbericht verwechseln.
- **B46:** Meldungen — Eigenen persistent sichtbaren Aktionskanal mit Scope und manuellem Schließen ergänzen; keine Vermischung mit zeitlich begrenzten Toasts.
- **B27:** Ausgaben → Ausgaben-Check — Erhaltener Ablauf auf der eigenständigen Ausgabenseite; Filter sind lesend, Imports nutzen D5.
- **V04:** Personen & Vermögen → Person → Gold — Alle fünf Felder ergänzen; Strategie-Steuerfreiheit ist keine stille Umklassifizierung von taxExempt eines Lots.
- **V05:** Personen & Vermögen → Pflegereserve — Vollständige Quelle und Pflegegrad-/Betragsvertrag statt verkürzter Geldmarktangabe.
- **V06:** Personen & Vermögen → Pflegereserve → Policies — Alle vier Policies mit vollständigen Labels erhalten.
- **V07:** Personen & Vermögen → Profilkarten → Validierung und Autosave — Autosavevertrag erhalten; aktive gültige Dezimaleingaben bis zum Verlassen unverändert lassen, dann ohne Rundung deutsch anzeigen. Reiner DOM-Wechsel erzeugt weder Save noch Dirty-Zustand.
- **V09:** Gemeinsame Bestätigung → Vermögen → Zeilenaktionen — Einzel- und Gesamtlöschung samt Negativ-/Retryweg ergänzen.
- **V10:** Gemeinsamer Status → Vermögen → Kurse und Quellen — Proxycheck, Teilfehler, Offlinebestand und Herkunft erhalten; Details nicht in normalen Erfolgsstatus drängen.
- **V13:** Gemeinsamer Dialog → Vermögen → Tranche — ISIN, Ticker und Kaufpreis pro Stück explizit erhalten; Gesamtkosten sind kein Ersatz. Dynamische Dezimalfelder zeigen gültige Punktwerte beim Verlassen mit Komma, ohne Rundung, Events oder Recordänderung.
- **V14:** Gemeinsamer Dialog → Vermögen → Steuermerkmale — Vollständige Typ-/TQF-/Steuerfreiheit-/Notizfelder ergänzen.
- **V16:** Gemeinsamer Speicherstatus → Vermögen → Recovery — Nicht bestätigte Writes nie als gespeichert melden; Load-/Save-Recovery getrennt ergänzen.
- **V17:** Gemeinsame Recovery → Vermögen → beschädigter Bestand — Rohdatengrenze, zentrales Backup und ausdrücklichen destruktiven Reset ergänzen.
- **V18:** Vermögen → Verkäufe und Abgleich → Ist-Ausführung — Realbestand nur nach gesondert bestätigter tatsächlicher Broker-Ausführung ändern; Zielbild-Verkaufsvorschau ist kein Ersatz.
- **V19:** Vermögen → Ausführung → Empfehlung und Abweichung — Optionale Vergleichsdaten ergänzen statt Ist-Daten durch Simulation zu ersetzen.
- **V20:** Gemeinsamer Status → Vermögen → Prüfen und Bestätigen — Preview und bestätigten Write trennen, Idempotenz/Recovery erhalten.
- **V21:** Vermögen → Ausführung → Cashstatuswahl — Vollständige Offen/Bereits-enthalten-Wahl und Cashstandnachweis ergänzen.
- **V22:** Gemeinsamer Status → Vermögen → Vorgänge — Unvollständigkeit/Altstatus, wirksame Nachweise und Korrekturaktionen erhalten.
- **V23:** Gemeinsamer Dialog → Vermögen → Cashabgleich — Grund, erwartete Revision, Feldfehler und Fokus erhalten; ausdrückliche Dialogbestätigung übernimmt absoluten Tagesgeldstand samt Cashhistorie und Audit gemeinsam, ohne Nettoerlös zu addieren.

### Änderungsrisiko

Nachweise gelten für das durch das genannte Paket berührte Verhalten. Jedes Lückenpaket gehört zum Zielpaketsatz des Eintrags. Generische spätere Zuordnungen tragen „vorläufig – wird in der Paket-Idee eingeordnet“. Bei fehlendem Anker zuerst data-* ergänzen, Beleg und Bediennachweis aktualisieren, danach umbauen.

Schrift- und Farbänderungen allein verlangen keinen pauschalen Bediennachweis.

#### Zuordnung 2

Paketbezug: 2.

- **I05:** Beide Fachkarten mit realem Profilbundle und Startseiten-Fehlermeldung; verschachtelte CTA-Buttons gesondert prüfen. — Paket 2 ersetzt die Fachnavigation im gemeinsamen Rahmen; bestätigten Flush, blockierten Wechsel bei Speicherfehler und den unterschiedlichen Profil-Handoff beider Fachkarten erhalten.
- **I10:** Konkreter Inline-Bannerablauf mit Quarantänehinweis, Importzielverweis und Schließen; persistence prüft Backendzustände, nicht diesen Renderer. — Paket 2 verlagert den seitenweiten Recoverybereich in den gemeinsamen Rahmen; Banner, Importzugang und sitzungsweises Schließen müssen außerhalb der Sicherungskarte erreichbar bleiben.
- **I13:** Reale Vorwärts-/Zurücknavigation mit verändertem aktivem Profil und Haushaltspille. — Paket 2 verändert die Seitenwechsel; bei BFCache-Rückkehr müssen aktives Profil und Badge erneut gelesen werden statt den alten Profilkontext anzuzeigen.
- **B01:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — Paket 2 ersetzt Kopf und Navigationscontainer; Hilfe, Rückweg und Profil-Handoff zum Manager müssen trotz veränderter Linkpositionen erreichbar bleiben.
- **B02:** Vollständige Browserprüfung der drei Reiter einschließlich Enter/Space und Arrow/Home/End sowie optische Abnahme fehlen. — Der registrierte Grundbedienungsfall belegt nur den Klickwechsel zwischen Strategie und Überblick; die externe Browserausführung ist offen.
- **B36:** Echter Clipboardzugriff und Screenreaderansage bleiben ohne gezielten Browsernachweis; regulärer Reiter benötigt keine modale Fokusfalle. — Diagnosebedienung einschließlich Filter und Kopieren nach Kartenumbau extern prüfen; Node schützt den vorhandenen Reiterbesitzer.
- **B40:** Vollständiger Browser-Shortcutfall und Fokus-Rückkehr nach Dialogschluss fehlen. — Paket 2 verändert Navigations- und Dialogcontainer; Jahresabschlusskürzel sowie Dialogschluss und Rückfokus dürfen durch neue Fokusziele nicht verloren gehen.
- **B41:** Gezielter vollständiger Balance-Druck-Smoke fehlt; Messages prüft nur Meldungsausblendung. — Paket 2 verändert Container und Drucklayout; der vollständige Ergebnisplan einschließlich Kontextfuß muss druckbar bleiben und Bedienelemente dürfen ihn nicht verdecken.
- **B42:** Kontexthilfen und details nach Container-/Druckumbau nicht vollständig geprüft. — Rahmen und Druck verändern Platz und Sichtbarkeit der Kontexthilfen.
- **S70:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — Paket 2 verändert Formularcontainer, Meldungsplatz und Druck; Feldvalidierung, sichtbare Fehlermeldungen und zugehöriger Fokus müssen auch im neuen Rahmen zuordenbar bleiben.
- **S70:** Quellprüflücke: Toast-Kind wegen unzureichender Templatelexik des bestehenden Gates nur manuell gegen showToast geprüft. — Paket 2 verändert Meldungscontainer und Stapelung; die von showToast erzeugten Toast-Kinder müssen im neuen Rahmen sichtbar bleiben und ihr Erzeugungsbeleg gezielt geprüft werden.
- **S70:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S71:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — Paket 2 verändert Navigation und Druckcontainer; Tastaturzugänge und druckbare Ergebnisse bei laufender Rechnung oder fertigem Ergebnis müssen erhalten bleiben.
- **S71:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S72:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — Technische Telemetrie unter Erweitert; Browserabnahme und Reloadhinweis bleiben extern offen.
- **S72:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S73:** Lifecycleordnung mit echter Facade Node-geprüft; Browser-Unloadabschluss und BFCache samt Backendfehlern bleiben bestmöglich und extern zu prüfen. — Keine garantierte asynchrone Unloadspeicherung. Native Dialoge, Haushaltsreload und Historienwege sind registriert, in der Sandbox aber nicht ausführbar.
- **S73:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **V01:** BFCache-/Sichtbarkeitsrückkehr im echten Browser prüfen; vorhandener Mock deckt nur visibilitychange ab. — Profil-ID, Einzelprofil-Handoff und BFCache-/Sichtbarkeitsrückkehr müssen zum aktiven Profil passen.
- **V01 · \[data-profile-id\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — Profil-ID, Einzelprofil-Handoff und BFCache-/Sichtbarkeitsrückkehr müssen zum aktiven Profil passen.
- **V24:** Screenreader, komplette Labels-/Tabreihenfolge beider Dialoge und tatsächlicher Ausdruck; partielle Renderer-/Browserbelege sind kein Gesamt-A11y-/Drucknachweis. — Paket 2 verändert Dialog-, Tabellen- und Druckcontainer; Labels, Hilfeschalter und Tabreihenfolge beider Dialoge müssen erreichbar und der Ausdruck verständlich bleiben.

#### Zuordnung 6.2

Paketbezug: 6.2.

- **I07:** Nativer Dateidialog, echter Import-/Exportklick, Abbruch, Reload und sämtliche UI-Fehlerzustände im Startseitenlayout; eine künftige Importvorschau ist keine Bestandsfunktion. — vorläufig – wird in der Paket-Idee eingeordnet
- **I08:** Initialer Backup-Deep-Link mit Fokus; Backendtests allein prüfen diesen DOM-Ablauf nicht. — vorläufig – wird in der Paket-Idee eingeordnet
- **B21:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B22:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B23:** Erfolgreiche Ordnerberechtigung und reale Dateischreibung ohne umfassenden Browsernachweis. — vorläufig – wird in der Paket-Idee eingeordnet

#### Zuordnung 3.1

Paketbezug: 3.1.

- **B31:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B31:** Vier historische Warum-Referenzzustände samt Bildern für 1920/2560 sind in den Archivbelegen erfasst; externe Abnahme ausstehend. — Node-Prüfungen ersetzen keine Bildabnahme; Inhaltsbreitengrenze und fehlender Nachher-Runway sind dokumentierte Verträge. Die Warum-Treppe ist mit Node-/DOM-Tests belegt; Browsergrundbedienung, Bildvergleich bei 1920×1080/2560×1440 und Kandidaten-EXE bleiben bis zur externen Messung ausstehend.
- **B32:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B33:** Positive Pflegebucketdiagnostik und sämtliche Policy-/Deckungszustände benötigen gezielten Browsernachweis. — vorläufig – wird in der Paket-Idee eingeordnet
- **B34:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B35:** Browser-Clipboard und Bildabnahme der geänderten Dialogstruktur extern offen. — Nodeerfolg ersetzt keine Browserausführung.
- **B39:** Feldmarkierung per classList ist manuell geprüft; Quellenvalidator kann diese Erzeugungsart nicht als DOM-/Attributbeleg lesen. Vollständige Feldfokus-/Recoverymatrix fehlt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B45:** Screenreaderansage und reale Zeitmessung nicht im Browserfall; Timervertrag gezielt im Node-Test. — vorläufig – wird in der Paket-Idee eingeordnet
- **B46:** Automatische Ansage mit realem Screenreader bleibt ungemessen; DOM-/Fokusvertrag in Node und Browser geprüft. — vorläufig – wird in der Paket-Idee eingeordnet

#### Zuordnung 3.2

Paketbezug: 3.2.

- **I23:** Browserfälle registriert, noch nicht extern ausgeführt. — Browser-, Bild- und Tauri-Abnahme durch die Steuerung offen.
- **B03:** Offen: Bildabnahme 03/04 (1920/2560 px). — Bildabnahme extern offen.
- **B07:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B08:** Alle vier Jahreszugänge und native Periodenwahl nicht in jedem Fehlerschritt als vollständige Browsermatrix geprüft; zusätzliche Kopfaktion extern abnehmen. — vorläufig – wird in der Paket-Idee eingeordnet
- **B08:** P13b: Balance annual commit mit aktivem Jahreszugang, erstem Jahresschritt und Übergang zur Startseite sowie Monats-/Importweg registriert, noch nicht extern ausgeführt. — Browser-/WebView-Abnahme durch die Steuerung außerhalb der Sandbox offen; Nodebelege ersetzen sie nicht.
- **B09:** Browserfälle registriert; Ausführung extern offen. — Steuerung prüft Browser, Bilder und Tauri; Node schützt Fachverträge.
- **B12:** Die Sichtbarkeit der Marktdatenkarte samt Provenienz ausschließlich im aktiven \#tab-strategy ist extern zu prüfen; noch kein aktueller Browsernachweis. — Der Absatz ist in das Strategiepanel umgezogen; Nodeprüfungen sichern Metadaten und Renderer, keinen echten Reiterwechsel.
- **B13:** Blurformatierung und alle ungültigen Mindest-Flex-Eingaben benötigen Browsernachweis; Reader allein prüft keinen Fokus. — vorläufig – wird in der Paket-Idee eingeordnet
- **B13:** Offen: Bildabnahme 03/04 (1920/2560 px). — Bildabnahme extern offen.
- **B14:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B15:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B15:** Offen: Bildabnahme 03/04 (1920/2560 px). — Bildabnahme extern offen.
- **B16:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B17:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B17:** Offen: Bildabnahme 03/04 (1920/2560 px). — Bildabnahme extern offen.
- **B18:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B18:** Offen: Bildabnahme 03/04 (1920/2560 px). — Bildabnahme extern offen.
- **B19:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B47:** P13b: Balance annual commit mit aktivem Jahreszugang, erstem Jahresschritt und Übergang zur Startseite sowie Monats-/Importweg registriert, noch nicht extern ausgeführt. — Browser-/WebView-Abnahme durch die Steuerung außerhalb der Sandbox offen; Nodebelege ersetzen sie nicht.

#### Zuordnung 3.3

Paketbezug: 3.3.

- **B37:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B37:** Offen: Referenzen 07/08/09 und Abschlussrundgang 01–09 bei 1920/2560 px, Browser-Smoke und Kandidaten-EXE. — Node-Prüfungen ersetzen keine externe optische Abnahme.
- **B38:** Vollständigkeit aller Karten und Missing-/Formatzustände nicht durch gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B25:** Jahrwechsel und sämtliche KPI-Grenzen ohne vollständigen Browserfall; annual commit prüft nur Folgeschaltung. — vorläufig – wird in der Paket-Idee eingeordnet
- **B25 · option:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **B26:** Ersetzen, Löschabbruch und alle Zellenaktionen brauchen vollständigen Browsernachweis; Historyfälle testen Import. — vorläufig – wird in der Paket-Idee eingeordnet
- **B27:** Vollständige Dialogbedienung, Top-3 und Fokus-Rückgabe ohne gezielten Browsernachweis. — vorläufig – wird in der Paket-Idee eingeordnet
- **B28:** Recovery-Aktionswerte werden als Parameter übergeben; konkrete Aktionen benötigen einen Bediennachweis. — vorläufig – wird in der Paket-Idee eingeordnet
- **B28 · \[data-action\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **B43:** Diagramm, Tabelle und sichere Zustände: Browser-Smoke wurde hier nur als Quelle geprüft; optische Freigabe und Druck der Auswertung benötigen gesteuerte Sitzung. — vorläufig – wird in der Paket-Idee eingeordnet
- **B43:** Paket 3.3: SVG-Erzeuger, \#expensesChartTitle und ChartDesc sind als dynamische Quellausgaben manuell und durch bestehende Renderer-/Browsertests belegt; der Inventar-Erzeugerleser kann diese Datei wegen des vorherigen escape-RegExp nicht vollständig tokenisieren. Die statischen Hosts und die bestehende Rendererprüfung sind geschützt; die dynamischen SVG-Selektoren bleiben eine zusätzliche manuelle Prüflücke. — vorläufig – wird in der Paket-Idee eingeordnet
- **B43 · table:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **B44:** Keine neue Stichtageingabe oder stillschweigende automatische Kursaktualisierung aus dem Import ableiten. — vorläufig – wird in der Paket-Idee eingeordnet

#### Zuordnung 4.1

Paketbezug: 4.1.

- **S01:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S01:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S02:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S02:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S03:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S03 · input\[data-profile-id\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **S03:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S04:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S04:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S05:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S05:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S06:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S06:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S07:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S07:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S08:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S08:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S09:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S09:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S10:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S10:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S11:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S11:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S12:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S12:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S13:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S13:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S14:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S14:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S15:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S15:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S16:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S16:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S17:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S17:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S19:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S19:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S20:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S20:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S21:** Kosten, Flex-Kürzung und Mortalität: Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S21:** Paket 4.1: Alle 15 Pflegegrad-Eingaben vollständig aufgeführt, aber keine Browsermutation jedes Zusatz-/FlexCut-/Mortalityfelds einschließlich Reload und Kostenpresetrückwechsel. — vorläufig – wird in der Paket-Idee eingeordnet
- **S21:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.

#### Zuordnung 4.2

Paketbezug: 4.2.

- **S23:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S23:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S24:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S24:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S25:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S25:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S26:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S26:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S27:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S27 · option:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **S27:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S28:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S28:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S29:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S29:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S30:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S30:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S31:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S31:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S32:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S32:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S33:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S33:** Quellprüflücke: Interpolierte Summary-Kinder nicht einzeln vom lexikalischen Gate belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **S33:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S33:** MC-Bilder 1920/2560; Simulator · Annahmen 1366/1920/2560 einschließlich Abweichungsmodus und Partnerfall; Grundbedienung Ziel 10/10. — Externe Abnahme offen; kein abgeschnitten. mc-bilder.mjs bleibt extern ohne Repositoryänderung.
- **S34:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S34:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S35:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S35:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S36:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S36:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S37:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S37:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S38:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S38:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S38:** P16b: MC, Sweep, Grundbedienung und Bilder 1366/1920/2560 px extern offen. — Bildfreigabe extern offen.
- **S39:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S39:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S40:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S40:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S41:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S41:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S41:** P16b: MC, Sweep, Grundbedienung und Bilder 1366/1920/2560 px extern offen. — Bildfreigabe extern offen.
- **S42:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S42:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S43:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S43:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.

#### Zuordnung 4.3

Paketbezug: 4.3.

- **S44:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S44:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S45:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S45:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S46:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S46:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S47:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S47:** Paket 4.3: Alle drei Bedarfs- und alle 17 Expertenfelder sind einzeln mit vollständigem data-stress-replay-path und Baselineoutput inventarisiert; Browserfall verändert nur eine Teilmenge. — vorläufig – wird in der Paket-Idee eingeordnet
- **S47:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S48:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S48:** Paket 4.3: Alle drei Bedarfs- und alle 17 Expertenfelder sind einzeln mit vollständigem data-stress-replay-path und Baselineoutput inventarisiert; Browserfall verändert nur eine Teilmenge. — vorläufig – wird in der Paket-Idee eingeordnet
- **S48:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S49:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S49:** Quellprüflücke: Verschachtelte Variantenaktions-Templates: Gate prüft Listenhülle, nicht jedes dynamische Buttonattribut. — vorläufig – wird in der Paket-Idee eingeordnet
- **S49:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S50:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S50:** Quellprüflücke: Arraytemplate der Highlight-Kinder nur manuell/Fachtest, nicht als eigener Tokenbeleg geprüft. — vorläufig – wird in der Paket-Idee eingeordnet
- **S50:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S51:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S51:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S53:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S53:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S54:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S54:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S54:** P16b: MC, Sweep, Grundbedienung und Bilder 1366/1920/2560 px extern offen. — Bildfreigabe extern offen.
- **S55:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S55:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S56:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S56:** Paket 4.3: .dev-on hat keinen Setzer; ?dev=true öffnet nur Telemetrie. Erreichbarkeit der Paritykarte bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **S56:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S57:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S57:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S58:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S58:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S59:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S59:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S60:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S60:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S60:** P16b: MC, Sweep, Grundbedienung und Bilder 1366/1920/2560 px extern offen. — Bildfreigabe extern offen.
- **S61:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S61:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S62:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S62:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S62:** P16b: MC, Sweep, Grundbedienung und Bilder 1366/1920/2560 px extern offen. — Bildfreigabe extern offen.
- **S63:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S63:** Paket 4.3: .dev-on besitzt keinen aktuellen Setzer; normale UI erreicht Selbsttestkarte nicht. Globale Demos sind Entwickleraufrufe und nicht als sichtbare Knöpfe behauptet. — vorläufig – wird in der Paket-Idee eingeordnet
- **S63:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S64:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S64:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S65:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S65:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S66:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S66:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S67:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S67:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S68:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S68:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.
- **S69:** Nicht jede Eingabe-, Fehler-, Fokus- und Druckkombination ist gezielt getestet — vorläufig – wird in der Paket-Idee eingeordnet
- **S69 · \[data-auto-optimize-model-warning\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **S69 · \[data-auto-optimize-model-status\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **S69:** Finale fünf Hauptreiter und drei Werkzeuge mit eindeutigen Hosts. Browser-/Bild-/Druckprüfung extern ausstehend; Bestandsbelege sind keine erneute Laufzeitabnahme. — Produktgestaltung abgeschlossen; externe Steuerung prüft zehn Grundbedienungsfälle, Referenzen 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px. Weitere Browserfälle bleiben ausdrücklich separat offen.

#### Zuordnung 5

Paketbezug: 5.

- **I02:** Echter Startseitenwechsel mit gültigen Optionen, Badge und Fehler-/Recoveryzuständen. — vorläufig – wird in der Paket-Idee eingeordnet
- **I02:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet Historische Startseitenoption durch Managerreiter ersetzt; externe Bedienabnahme bleibt offen.
- **I03:** Startseiten-Anlegen samt Leername, automatischem Wechsel und Status ist nicht gezielt geprüft; profile-ui-contract prüft dieses Ereignis nicht. — vorläufig – wird in der Paket-Idee eingeordnet
- **I04:** Direkte Rename-/Delete-Listener, Abbruch, Namensvalidierung und Default-Schutz im echten Startseiten-DOM. — vorläufig – wird in der Paket-Idee eingeordnet
- **I09:** Retry bei unavailable, Exportfehler und abgebrochene Bestätigung im echten Startseiten-DOM. — vorläufig – wird in der Paket-Idee eingeordnet
- **I14:** Reale Startseiten-/Offlineanzeige, 13 Referenzzustände, 1920/3440px und Kandidaten-EXE. Rust-Laufzeittests des produktiven Dispatchers (Überlappung und sequentielle Gegenprobe, Routen/CORS/Fehler) sind mangels Toolchain in der Sandbox offen. — Externe Browser-/Bild-/EXE-Abnahme bleibt bis Bestätigung durch Steuerung offen.
- **I15:** Echte Browser-/WebView-Ausführung und Abbruch während Navigation mit dauerhaftem Backend sind externe Gates. — Node-Fake-Clock-/Guardproben und Backend-Rundreise ersetzen keine Browserausführung.
- **B03:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B03 · input\[data-profile-id\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **B04:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B05:** Bedienung und Darstellung dieses Bereichs sind nicht vollständig durch einen gezielten Browserfall belegt. — vorläufig – wird in der Paket-Idee eingeordnet
- **B20:** Noch kein aktueller Browsernachweis für editierbare Steuern unter Alle Parameter und dauerhaft verborgene Einstands-/TQF-Brücken. — Externe Steuerung prüft die Sichtbarkeit; Reader- und Profilsyncprüfungen sichern erhaltene Werte, Einheiten und Sperren.
- **V02:** Tagesgeldlistener einschließlich Reload und fehlerhaftem Backend im realen Browser; Node deckt Validierung/Debounce/Retry ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V03:** Alle Alters-/Einkommenslistener und abgeleiteten Rentenstatus nach Autosave/Reload im Browser prüfen; Profilmodultests ersetzen dies nicht. — vorläufig – wird in der Paket-Idee eingeordnet
- **V04:** Alle fünf Goldfelder über echte input/change-Listener speichern und Reload prüfen; Datenmodultest deckt nur Teilwerte ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V05:** Vier Bucket-Grundfelder mit realen Listenern/Reload/Recovery prüfen; keine Engineassertion als UI-Beleg. — vorläufig – wird in der Paket-Idee eingeordnet
- **V06:** Jede Policy per echtem Selectlistener und Reload testen; Validierungsmodul belegt nicht Browserbedienung. — vorläufig – wird in der Paket-Idee eingeordnet
- **V07:** Echte Browserprüfung von Feldfehler-ARIA, queued Autosave und fehlgeschlagenem Profilflush; vorhandene Node-Mocks decken den Ablauf teilweise ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V08:** Gesperrte Neuanlage bei jedem Busy-/Recoveryzustand im Browser; Modal-/Pagetests sind Teilnachweise. — vorläufig – wird in der Paket-Idee eingeordnet
- **V09:** Gesamtlöschung, native Dialogablehnung und gruppierte ID-Zuordnung im Browser; Node belegt gezieltes Edit/Löschen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V10:** Proxyhealth-Bedienung, Timeout, Profilwechsel und Kursflush-Retry im Browser; Node belegt Batch-/Provenienzpfade teilweise. — vorläufig – wird in der Paket-Idee eingeordnet
- **V11:** Alle fünf KPI-Werte einschließlich Verlust und Einstand=0 im realen DOM; Rendererassertionen sind Teilbelege. — vorläufig – wird in der Paket-Idee eingeordnet
- **V12:** Alle Datenspalten und Kaufdatumssortierung mit fehlendem Datum, Tastaturscroll und Aktion nach Rerender prüfen; Browser deckt nur Teilmatrix ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V12 · table.ds-table:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V12 · thead:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V12 · tbody:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V13:** Jede Identifikations-/Datums-/Zahlengrenze als realer Feldfehler; Modulreader und Browserneuanlage decken Teilfälle ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V14:** Alle Kategorien, explizite Checkbox und Notiz ohne Steuerwirkung im Browser; Vertrags-/Readertests sind Teilnachweise. — vorläufig – wird in der Paket-Idee eingeordnet
- **V15:** Vollständiger Tab/Shift+Tab-Zyklus, Escape/Abbruch und Flushfehler mit Fokus im realen Browser; Mock deckt Teilfokus ab. — vorläufig – wird in der Paket-Idee eingeordnet
- **V15:** Echter Rückfokus nach Editrender bleibt extern offen; Node prüft neuen Zeilenbutton derselben ID. Cash-Rückfokus bleibt F-06. — vorläufig – wird in der Paket-Idee eingeordnet
- **V16:** Unavailable-Loadretry und jeder Save-Retrypfad einschließlich Reconcile/Cash im echten Browser; Node-Mocks liefern nur Teilabläufe. — vorläufig – wird in der Paket-Idee eingeordnet
- **V17:** Clipboard-Erfolg/-Ablehnung, Resetablehnung/-Flushfehler und kompletter zentraler Backup-Rückweg im Browser; Recovery-Smoke ist Teilabdeckung. — vorläufig – wird in der Paket-Idee eingeordnet
- **V18:** Alle Eingabegrenzen, gelöschtes Lot und Profilkonflikt über reale Previewlistener; Browser-Smoke enthält nur gültigen Teilablauf. — vorläufig – wird in der Paket-Idee eingeordnet
- **V18 · option:** Stabiler Anker und daran gebundener Bediennachweis fehlen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V19:** Nur-ein-Feld-Referenz und ungültige Referenz über Browserlistener; vorhandener Smoke deckt nur zwei gültige Referenzfelder. — vorläufig – wird in der Paket-Idee eingeordnet
- **V20:** Native Ablehnung, expliziter Previewabbruch, Vollverkauf, Feldinvalidierung, paralleler Konflikt und Reconcile-Flushretry über Browserlistener; Fachmodul und positiver Browserablauf sind Teilbelege. — vorläufig – wird in der Paket-Idee eingeordnet
- **V20:** Browserprüfung endgültiger disabled-Zustände nach Init/Commit/Retry; globale und fachspezifische Sperren sind jetzt gemeinsam gesetzt. — vorläufig – wird in der Paket-Idee eingeordnet
- **V21:** confirmed\_already\_reflected, Sichtbarkeit/required des Cashstands und Invalidierung nach change/input im Browser; vorhandener Smoke zeigt nur den Default. — vorläufig – wird in der Paket-Idee eingeordnet
- **V22:** Echte Hostersatz-/Rerenderdelegation und unlesbarer Auditpfad im Browser; positiver Cashworkflow und Nodewarnung liefern Teilbelege. — vorläufig – wird in der Paket-Idee eingeordnet
- **V22 · \[data-cash-status\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V22 · \[data-target-action-id\]:** Eigener Attributanker vorhanden; vollständiger Bediennachweis bleibt offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **V23:** Cashdialog-Tabzyklus/Escape/Cancel, stale Konflikt und Cash-Flushretry im Browser; vorhandene Modul-/Page-Mocks und positiver Smoke sind Teilbelege. — vorläufig – wird in der Paket-Idee eingeordnet
- **V23:** Browserprüfung des Rückfokus nach Cashcommit; der erneuerte Aktionsknoten wird jetzt über targetActionId aufgelöst. — vorläufig – wird in der Paket-Idee eingeordnet
- **V25:** ISIN-/Ticker-/Kategorie-/Typänderung, leerer Kurs und Kursflush-Retry im echten Browser; Node belegt Feldmatrix und Rollback, bestehender Smoke nur Notiz/Preis sowie Frischekette. — vorläufig – wird in der Paket-Idee eingeordnet

#### Zuordnung 6.3

Paketbezug: 6.3.

- **I01:** Profilbadge, Fallback unbekannt und Abgrenzung zur Haushaltsauswahl nicht gezielt geprüft. — Browser-/WebView-Abnahme einschließlich P13b-Jahreszugang und Monats-/Importweg extern offen.
- **I20:** Browserfälle sind registriert. — Externe Browser-/WebView-Ausführung und Bildabnahme bleiben offen.
- **I16:** P8e: Browserlauf, Grundbedienung Ziel 10/10 und Bildvergleich bei 1366/1920/2560 Hell/Dunkel einschließlich Hover außerhalb der Sandbox offen. Bekannter roter Fall Suite frame profile context bleibt separat sichtbar. — Node- und Quellnachweise ersetzen keine ausgeführte Browser-/Bildabnahme.
- **I06:** Handbuchkartenlink, alle beschreibenden Kartenmerkmale, Enter-Aktivierung und CTA-Button-im-Link. — vorläufig – wird in der Paket-Idee eingeordnet
- **I12:** Kopfzeilenbedienung und initialer Altanker im echten Browser; externe Ausführung offen. — vorläufig – wird in der Paket-Idee eingeordnet
- **H01:** Echter Rücklink und Wechsel zum Schnellstart samt ARIA-Zuständen, Tastatur und Fokus; Basissmoke prüft nur den manual-Button. — vorläufig – wird in der Paket-Idee eingeordnet
- **H02:** Echter Rücklink und Wechsel zum Schnellstart samt ARIA-Zuständen, Tastatur und Fokus; Basissmoke prüft nur den manual-Button. — vorläufig – wird in der Paket-Idee eingeordnet
- **H03:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H04:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H05:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H06:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H07:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H08:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H09:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H10:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H11:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H12:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H13:** Gezielte Kapitel-/Ankernavigation, Inhaltserhalt und vollständiger Druck-/Responsive-Nachweis; Fachmodultests sind kein Beleg für diesen Handbuchinhalt. — vorläufig – wird in der Paket-Idee eingeordnet
- **H13:** Alle sechs Abbildungen, Bildunterschriften und Tippblöcke beim Responsive-/Druckumbau erhalten; Illustrationen nicht als Live-Diagnose interpretieren. — vorläufig – wird in der Paket-Idee eingeordnet
- **H14:** Native Querverweise und Fokusverhalten; bei künftig veränderter Tabzuordnung Erreichbarkeit ausdrücklich prüfen. — vorläufig – wird in der Paket-Idee eingeordnet
- **D02:** Cargo, Windows-EXE und Browser bleiben externe Gates. — Keine Rust-/Browserlaufzeit in der Sandbox.
- **D03:** Registrierter Browserfall; externe Ausführung offen. — Sandbox ohne Server und Browser.
- **D04:** Registrierter Browserfall; externe Ausführung offen. — Sandbox ohne Server und Browser.

### Testschuld

Vorhandene Nachweislücken ohne durch diesen Umbau geändertes Verhalten. Der Paketbezug dient der Einordnung und begründet keine Pflicht vor diesem Paket.

Schrift- und Farbänderungen allein verlangen keinen pauschalen Bediennachweis.

#### Zuordnung 3.2

Paketbezug: 3.2.

- **B42:** tests/worker-telemetry.test.mjs existiert nicht; echte Toggle-/Clipboard-/Reportbedienung ohne gezielten Nachweis. — Entwicklertelemetrie bleibt fachlich unverändert; fehlender Bediennachweis ist Testschuld.

#### Zuordnung 4.2

Paketbezug: 4.2.

- **S76:** Manuelle Kandidaten-EXE-Prüfung offen. — Node und Bilder ersetzen keine EXE-Prüfung.

#### Zuordnung 6.3

Paketbezug: 6.3.

- **I25:** Manuelle Browser-/EXE-Abnahme des Zeitraffers offen. — Neue Browserfälle sind im Auftrag ausgeschlossen.
- **I11:** Telemetrie-UI einschließlich Reload und alert; eine tests/worker-telemetry.test.mjs existiert nicht und wird nicht als Nachweis geführt. — Entwicklertelemetrie bleibt fachlich unverändert; fehlender Bediennachweis ist Testschuld.
- **I18:** Browser-/Druck-/WebView-/Kandidaten-EXE-Abnahme extern offen. — Browser- und EXE-Abnahme durch die Steuerung offen; Node prüft Produktionsadapter, Abschlüsse und bytegleiche echte Speicherbereiche.
- **B48:** Browser-/Druck-/WebView-/Kandidaten-EXE-Abnahme extern offen. — Browser- und EXE-Abnahme durch die Steuerung offen; Node prüft Produktionsadapter, Abschlüsse und bytegleiche echte Speicherbereiche.
- **S74:** Browser-/Druck-/WebView-/Kandidaten-EXE-Abnahme extern offen. — Browser- und EXE-Abnahme durch die Steuerung offen; Node prüft Produktionsadapter, Abschlüsse und bytegleiche echte Speicherbereiche.
- **V26:** Browser-/Druck-/WebView-/Kandidaten-EXE-Abnahme extern offen. — Browser- und EXE-Abnahme durch die Steuerung offen; Node prüft Produktionsadapter, Abschlüsse und bytegleiche echte Speicherbereiche.
- **H04:** architecture-evidence.test.mjs prüft Architektur-Evidenzregister, nicht diese Handbuchkapitel; Ausgangsbezug ist korrigiert. — Vorhandene Nachweislücke; kein durch dieses Designpaket geändertes Verhalten.
- **H05:** longevity-optimizer-docs.test.mjs prüft Optimizer-/Sweepverträge und liest Handbuch.html nicht; kein Inhaltsnachweis. — Vorhandene Nachweislücke; kein durch dieses Designpaket geändertes Verhalten.
- **H05:** P10: Kein kapitelbezogener Browser-Inhalts- oder TOC-/Fokusnachweis für \#simulator-renten. — Der registrierte neue Personenkapitel-Schritt bedient nur \#profilverbund-personendaten (H09); gezielter Node-Inhaltsnachweis ist vorhanden.
- **H06:** P10: Kein kapitelbezogener Browser-Inhalts- oder TOC-/Fokusnachweis für \#simulator-szenario-log. — Der registrierte neue Personenkapitel-Schritt bedient nur \#profilverbund-personendaten (H09); gezielter Node-Inhaltsnachweis ist vorhanden.
- **H07:** P10: Kein kapitelbezogener Browser-Inhalts- oder TOC-/Fokusnachweis für \#balance-jahresupdate / \#balance-snapshots. — Der registrierte neue Personenkapitel-Schritt bedient nur \#profilverbund-personendaten (H09); gezielter Node-Inhaltsnachweis ist vorhanden.
- **H09:** architecture-evidence.test.mjs prüft Architektur-Evidenzregister, nicht diese Handbuchkapitel; Ausgangsbezug ist korrigiert. — Vorhandene Nachweislücke; kein durch dieses Designpaket geändertes Verhalten.
- **H12:** architecture-evidence.test.mjs prüft Architektur-Evidenzregister, nicht diese Handbuchkapitel; Ausgangsbezug ist korrigiert. — Vorhandene Nachweislücke; kein durch dieses Designpaket geändertes Verhalten.
- **H15:** Browser-/Druck-/WebView-/Kandidaten-EXE-Abnahme extern offen. — Browser- und EXE-Abnahme durch die Steuerung offen; Node prüft Produktionsadapter, Abschlüsse und bytegleiche echte Speicherbereiche.

### Prüfergrenzen

Nicht unterstützte Erzeugungsformen sind kein automatischer Auftrag zur Produktänderung. Ihr stabiler Anker ist nur lexikalisch am genannten Ort geprüft.

- **I22 · \#householdPlanDialog:** app/profile/household-plan-dialog.js / requestHouseholdPlanMigration — Dialog-ID wird als Optionswert an runPageDialog übergeben und dort zugewiesen; der statische Prüfer verfolgt diesen Parameterweg nicht. Node- und registrierte Browserfälle prüfen den echten Dialog.
- **S35 · .kpi-grid-pair:** app/simulator/results-renderers.js / renderKpiDashboard — Markupakkumulator mit nichtlokalen map-Rückgaben und bedingten Ergänzungen; kein allgemeiner Datenfluss.
- **S35 · .drawdown-pair-heading:** app/simulator/results-renderers.js / renderKpiDashboard — Markupakkumulator mit nichtlokalen map-Rückgaben und bedingten Ergänzungen; kein allgemeiner Datenfluss.
- **S36 · .mc-more-metrics:** app/simulator/results-renderers.js / renderKpiDashboard — Markupakkumulator mit nichtlokalen map-Rückgaben und bedingten Ergänzungen; kein allgemeiner Datenfluss.
- **S36 · .reporting-reference-note:** app/simulator/results-renderers.js / renderKpiDashboard — Markupakkumulator mit nichtlokalen map-Rückgaben und bedingten Ergänzungen; kein allgemeiner Datenfluss.
- **S76 · \#scenarioLogAnalysisHeading:** app/simulator/log-analysis-view.js / logAnalysisHtml — Betriebsartabhängiges gemeinsames Template; Ausgabe durch Node-Tests und Playwright geprüft.
- **S76 · \[data-scenario-analysis-protocol\]:** app/simulator/log-analysis-view.js / logAnalysisHtml — Betriebsartabhängiges gemeinsames Template; Ausgabe durch Node-Tests und Playwright geprüft.
- **S49 · \[data-stress-replay-action="recompute"\]:** app/simulator/stress-replay-renderer.js / renderStressReplayVariantListV1 — Aktionsbuttons liegen im bedingten verschachtelten Template; der Prüfer löst dessen Zweige nicht auf.
- **S49 · \[data-stress-replay-action="remove"\]:** app/simulator/stress-replay-renderer.js / renderStressReplayVariantListV1 — Aktionsbuttons liegen im bedingten verschachtelten Template; der Prüfer löst dessen Zweige nicht auf.
- **S54 · \#backtestAnalysisHeading:** app/simulator/log-analysis-view.js / logAnalysisHtml — Betriebsartabhängiges gemeinsames Template; Ausgabe durch Node-Tests und Playwright geprüft.
- **S61 · \#applyOptimalParams:** app/simulator/simulator-optimizer.js / displayBestParameters — Markupakkumulator mit berechneten Fremdaufrufen und Rückgabezweigen; kein allgemeiner Datenfluss.
- **S63 · \#applyMultiObjectiveParams:** app/simulator/simulator-optimizer.js / displayMultiObjectiveOptimization — Markupakkumulator mit berechneten Fremdaufrufen; kein allgemeiner Datenfluss.
- **S63 · \#applyConstraintParams:** app/simulator/simulator-optimizer.js / displayConstraintBasedOptimization — Markupakkumulator mit berechneten Fremdaufrufen; kein allgemeiner Datenfluss.
- **V22 · \[data-cash-action="confirm"\]:** app/tranches/tranchen-manager-renderer.js / buildReconciliationCashStatusesHtml — Verschachtelte bedingte Aktionsmarkupvariable; der Prüfer löst ternäre Zweige nicht auf.
- **V22 · \[data-cash-action="correct"\]:** app/tranches/tranchen-manager-renderer.js / buildReconciliationCashStatusesHtml — Verschachtelte bedingte Aktionsmarkupvariable; der Prüfer löst ternäre Zweige nicht auf.
- **V22 · \[data-target-action-id\]:** app/tranches/tranchen-manager-renderer.js / buildReconciliationCashStatusesHtml — Eigener Buttonanker vorhanden; bedingte action-Templatevariable wird nicht aufgelöst.

### Befunde außerhalb des Inventars

#### F-01

Kennungen: I06 · Quelle: index.html / apps-grid: a.app-card \> button.cta-button

Alle drei Anchor-Karten enthalten ein interaktives button.cta-button als Kind. Verschachtelte interaktive Elemente sind ein Bestandsproblem für konsistente Tastatur-/Klickbedienung.

Nur dokumentiert; Bereinigung im späteren Karten-/Navigationsumbau, keine Anwendungsänderung in Paket 0.

#### F-02

Kennungen: H02 · Quelle: Handbuch.html / tabs-container / switchTab

role=tab-Buttons setzen aria-selected, besitzen aber weder roving tabindex noch Arrow-/Home-/End-Tastaturhandler.

Nur dokumentiert; Tastaturnavigation im späteren Hüllen-/Handbuchumbau prüfen und ergänzen.

#### F-03

Kennungen: B02 · Quelle: app/balance/balance-binder.js / handleTabClick

Slice 1: fünf Reiter mit gemeinsamem Klick-/Tastaturpfad für active, hidden, ARIA und Fokus.

Historischer Ausgangsbefund umgesetzt; Browserabnahme extern offen.

#### F-04

Kennungen: B36 · Quelle: app/balance/balance-binder.js / selectTab

Slice 1: Diagnose ist ein reguläres Reiterpanel; Drawer, Overlay und Schließknoten entfallen.

Historischer Ausgangsbefund durch Reitervertrag ersetzt; Copy-/Filterverträge bleiben.

#### F-05

Kennungen: S01, S02 · Quelle: app/simulator/simulator-main-tabs.js / initTabSwitching; Simulator.html: fieldset.collapsible legend

Haupttabs besitzen nur .active-Klickwechsel ohne ARIA-/Arrowvertrag; Accordionlegenden sind nicht als fokussierbare Schaltflächen implementiert und haben keinen Tastaturhandler.

Nur dokumentiert; zugängliche Setup-/Hüllennavigation im späteren Paket 2/4.1 klären, keine Produktänderung in Paket 0.

#### F-06

Kennungen: V09, V15, V23 · Quelle: app/tranches/tranchen-manager-page.js / persistTranchen / executeCashPosting: finally render vor eigenem bestätigtem Dialogschluss

Historisch konnte der Cashrückfokus auf einen entfernten Auslöser zeigen. Paket 5, Slice 2 löst Tranchenaktionen über stabile IDs auf; Slice 3 findet den erneuerten Cashaktionsknoten über targetActionId, mit Node-Gegenprobe.

Historische Kennung bleibt erhalten. Echte Browserfokusprüfung durch Steuerung offen.

#### F-07

Kennungen: V16, V20 · Quelle: app/tranches/tranchen-manager-page.js / setManagerControlsBlocked; renderReconciliationState / renderReconciliationPreview; initTranchenManagerPage und Commit-finally: render vor renderPersistenceState

Historisch konnte der Persistenzrender fachliche Preview-/Confirm-Sperren aufheben. Paket 5, Slice 3 verbindet globale Sperre mit vorhandenem Bestand und ready-Preview; fachliche Handlerprüfung bleibt erhalten.

Historische Kennung bleibt erhalten. Endgültige Zustände sind in Node geprüft; echte Browserprüfung durch Steuerung offen.


## Herkunft

sourceRevision bezeichnet dauerhaft den Anwendungscode vor der Design-Grundlage, nicht den aktuellen Inventarcommit. Die historische Registerprovenienz ist die erste Inventarerhebung (d0418d2 bis db728d0); baselineAudit erhält deren Ausgangskennungen unabhängig davon. Der Fortsetzungscommit 0f4ebce bezeichnet den Inventarstand vor dieser Nachschärfung. Die Basisrevision behauptet kein dort vorhandenes Inventar; das Schutzgate benötigt keinen Live-Git-Zugriff.

Fahrplanreihenfolge: 1 → 2 → 6.2 → 3.1 → 3.2 → 3.3 → 4.1 → 4.2 → 4.3 → 5 → 6.3

### Entfallen auf Nutzerentscheid

Nutzerentscheid vom 05.10.2026.

- **B06:** Entfallen auf Nutzerentscheid (05.10.2026): Statusklappe, manuelles Nachrücken/Undo, Markt-CSV beziehungsweise Balance-Reset entfernt. Cashhinweis bleibt separat als B47 im Überblick erhalten.
- **B10:** Entfallen auf Nutzerentscheid (05.10.2026): Statusklappe, manuelles Nachrücken/Undo, Markt-CSV beziehungsweise Balance-Reset entfernt. Cashhinweis bleibt separat als B47 im Überblick erhalten.
- **B11:** Entfallen auf Nutzerentscheid (05.10.2026): Statusklappe, manuelles Nachrücken/Undo, Markt-CSV beziehungsweise Balance-Reset entfernt. Cashhinweis bleibt separat als B47 im Überblick erhalten.
- **B24:** Entfallen auf Nutzerentscheid (05.10.2026): Statusklappe, manuelles Nachrücken/Undo, Markt-CSV beziehungsweise Balance-Reset entfernt. Cashhinweis bleibt separat als B47 im Überblick erhalten.
- **S18:** P16 Slice 1 entfernt die Ansparbedienung. Alte vier Speicherschlüssel bleiben unverändert erhalten, Simulatoradapter ignorieren sie; explizite DOM-freie Rechnungen bleiben bestehen.
- **S22:** Auf Nutzerentscheid vom 13.10.2026 entfernt: Karte und Knopf zum Zurücksetzen aller Simulator-Einstellungen.
- **S52:** Rolling Cohorts auf Nutzerentscheid vom 14.10.2026 bewusst entfernt: Schalter, Horizont, Ergebniskarte, Zusatzlauf und eigene Tests entfallen. Alte gespeicherte Einstellungen werden ignoriert; der historische Einzelpfad bleibt unverändert.

### Ausgangsregister und Detailquelle

162 Ausgangskennungen bleiben mit Status, Begründung und aktuellen Kennungsbezügen in der JSON-Quelle nachvollziehbar. Zustandsgruppen benennen ihre Selektoren ausdrücklich; Prüf-, Speicher-, Bindungs- und Testdetails stehen dort vollständig.

Die lesbare Schema-2-Quelle schreibt Status, Modul-/Dateipfade, Speicherkeys, Zielpakete und Selektoren unmittelbar aus. Gemeinsame Definitionen enthalten ausschließlich tatsächlich wiederholte Langtexte ab 80 Unicode-Zeichen mit unterscheidbaren sprechenden Namen; jede Definition steht auf einer eigenen Zeile. `@bereich.inhalt` verweist auf einen Langtext, `@@` erhält ein wörtliches @; `join` verbindet ausschließlich Textteile in beschreibenden Feldern. Lokale Audit-/Prüfbezüge nennen den Index im eigenen Eintrag; Zielbezüge benennen den konkreten Zielort und Änderungsgrund. Der allgemeine Resolver unterstützt weiterhin Objektbezüge und Tabellen für Vertragsproben, das lesbare Quellformat erlaubt sie nicht. Fehlende Referenzen, falsche Typen und Zyklen sind Vertragsfehler.

Inklusive UTF-8-Bytegrenzen: Quelle 1500000 B (ausdrückliche Nutzer-/Operatorentscheidung vom 06.10.2026), Lesefassung 225000 B, kompakt serialisierter aufgelöster Eintrag 20000 B. Höchstens 2000 Unicode-Zeichen je Quellzeile.
