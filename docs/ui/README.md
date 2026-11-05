# App-Bilder

Die Bilder zeigen Max und Erika Mustermann sowie Sophie Mustermann mit synthetischen Daten. Öffne [Monat abschließen](monatsabschluss.html) oder [Jahr abschließen](jahresabschluss.html), um den Ablauf Schritt für Schritt anzusehen. Beide Bildfolgen laufen offline.

## Bilder erneuern

Mit `npm run docs:bilder -- --ph1b` erneuerst du daten-sicherung und daten-sicherung-punkte im Normalbetrieb außerhalb des Spielbereichs. Ein frischer Browserkontext enthält nur den synthetischen Musterhaushalt. Die fünf über App-Funktionen angelegten Punkte aus drei Anlässen sind zurückholbar. Die drei PH-1b-Prüfbilder zeigen die gruppierte Liste, die Drei-Personen-Vorschau und das gesperrte letzte Haushalts-Häkchen. Der Lauf misst auch den Textplatz der Kirchensteuer-Auswahl bei 1366, 1920 und 2560 Pixeln in Plan und beiden Versuchsarten. Alle Aufnahmen verwenden isolierte synthetische Sitzungen.

Mit `npm run docs:bilder -- --km1` erzeugst du die neun KM-1-Prüfbilder mit Testdatum 23.10.2026 unter auftrag/. Sie zeigen Budget, Bedarf, Personen, Partnerschaft und den Protokollkopf. Das Budget wird auch bei 2560×1440 aufgenommen; die übrigen Bilder verwenden 1920×1080. Die Personenaufnahme prüft getönte Gruppen und weiße Eingabefelder. Das Protokoll verwendet 2.000 Pfade und Seed 12345. Ein zusätzliches Medianbild liegt unter /tmp/.

Mit `npm run docs:bilder -- --bd1` erneuerst du die Balance- und Simulator-Planübersicht mit dem schmalen Monatsbalken. Fünf Prüfbilder zeigen Max und Erika mit aktiver Dynamik bei 1920×1080 und 2560×1440, geöffnete Einkünfte, Sophies Ansparjahr und die Simulator-Monatszeile. Die Dynamikwahl gilt nur in der isolierten Musterkopie.

Mit `npm run docs:bilder -- --gf1` erneuerst du die Balance-Übersicht und die Simulator-Planübersicht. Dazu entstehen sechs unversionierte GF-1-Prüfbilder: Entnahme mit synthetischem Pflegegeld bei 1920 und 1280 Pixeln, Sophie mit begrenztem Budget und angelegtem Überschuss, Simulator-Entnahme, Sophies Autojahr und ein synthetisches Ansparjahr. Die Musterrechnung bleibt unverändert.

Führe im Repository `npm run docs:bilder` aus. Du brauchst die installierten npm-Abhängigkeiten und Playwright Chromium. Fehlt der Browser, installiere ihn einmal mit `npx playwright install chromium`.

Das Werkzeug startet denselben lokalen Server wie `npm run serve`, ohne Kursproxy. Es nutzt einen freien Port und isolierte Browserkontexte für Ansichten, Monat, Jahr, Vergleich und Jahresbudget. Vorhandene Browserprofile werden nicht geöffnet. Kurse und Marktdaten stammen aus festen lokalen Stubs oder dem Spielbereich; externe Abrufe werden blockiert.

Im Startdialog wählt das Werkzeug „Max und Erika“ und den Kursmodus „Testdatum wählen“, trägt das Datum ein und bestätigt mit „Spielbereich starten“. Die Ansichten verwenden den 20.10.2026. Für Oktober springt der Spielbereich vom 20.10. auf den 10.11.2026. Für den Jahresabschluss springt ein eigener Spielbereich vom 15.12.2026 auf den 02.01.2027. Der Simulator rechnet einmal 10.000 Monte-Carlo-Läufe mit Seed 12345; die Werkstatt zeigt Eingaben. Die Backtestaufnahme zeigt „Was im Lauf auffällt“ mit drei Karten und geschlossenem „Weitere“. Die Aufnahme aus Szenario-Logs zeigt „Pfade vergleichen“ mit P10, Median und P90. Die Aufnahme Vergleich verwendet eine eigene Mustersitzung mit Wunschbudget +300 €/Monat, 1.000 gepaarten Läufen je Plan bei Einstellung 10.000 und Seed 12345. Das Werkzeug rechnet außerdem eine einmalige Ausgabe, eine verschobene Rente und die Zielwertsuche mit beiden Grenzen (99 % Grundbedarfsdeckung, höchstens 10 % Läufe mit Jahren unter Mindest-Flex). Es schreibt die drei VG-1-Prüfbilder und ZW-1b-pruefbild.png unter auftrag/. Das Zielwertbild nutzt 1.000 Läufe je Schritt und eine Endprobe mit 10.000 Läufen, Seed 12345. Hält keine Endprobenstufe, zeigt es den schnellen Fund als unbestätigt.

Mit `npm run docs:bilder -- --spielbereich` erneuerst du Band und Vergleich und behältst die übrigen Aufnahmen. Das Band zeigt den Zeitraffer links von Spielbereich beenden. Bei Max und Erika prüft das Werkzeug danach die kurze Beenden-Bestätigung ohne Vergleich und Übernehmen. Für das Vergleichsbild legt es Max und Erika als erfundenen echten Bestand in einem frischen Browserkontext an, startet eine Kopie ohne Datumssprung und ändert Gold, Flex und Tagesgeld. Es öffnet keine Balance und wartet auf die frisch gerechnete Vorschau mit höherem Monatsbudget und Goldkauf.

Mit `npm run docs:bilder -- --verlauf` erneuerst du die drei bisherigen Verlaufsaufnahmen und zwei Bilder der Depotkennzahlen. Rendite und Risiko sowie Monatsrenditen stehen in verlauf-kennzahlen; verlauf-jahresuebersicht zeigt die vollständigen Jahreskarten. Die drei neuen Karten sind zusammen höher als der Bildschirm und werden deshalb in zwei Ausschnitten aufgenommen.

Mit `npm run docs:bilder -- --protokolle` erneuerst du nur die vier Backtest- und Monte-Carlo-Protokollbilder. Auch der volle Bilderlauf verwendet dafür denselben Musterlauf in einer eigenen Sitzung. Er ergänzt bei Max eine Betriebsrente von 3.000 €/Monat und 50.000 € Rückzahlung sowie 2.500 € für ein Auto im Planjahr und rechnet 128 Monte-Carlo-Pfade mit Seed 12345. Die Backtest-Übersicht zeigt das geöffnete Einnahmen-ⓘ der ersten Jahreszeile. Die Monte-Carlo-Bilder verwenden einen weiteren Spielbereich mit Nicht verheiratet, geerbten Immobilien samt Steuergeld und geöffnetem Erbe-ⓘ mit positiver Steuer im Todesjahr. Dazu kommt jeweils die Detailansicht.

Mit `npm run docs:bilder -- --pv2` erneuerst du die Personenbilder von Max und Erika, die Vermögenskarte mit bearbeitetem Tagesgeld und die Simulator-Annahmen. Die Aufnahmen verwenden nur einen frischen Muster-Spielbereich.

Mit `npm run docs:bilder -- --up1b` erneuerst du die beiden Monte-Carlo-Protokollbilder. Ein eigener Muster-Spielbereich rechnet Nicht verheiratet mit Immobilien und Steuergeld, zusätzlich 0 % vom übrigen Geldvermögen, und 128 Pfaden (Seed 12345). Im Todesjahr ist das Erbe-ⓘ geöffnet; Detailliert zeigt An Erben und Erbschaftsteuer. Das Prüfbild liegt unversioniert unter auftrag/UP-1b-pruefbild-protokoll.png.

Mit `npm run docs:bilder -- --pt1` erneuerst du Haushalt & Plan mit geschlossener Partnerschaftskarte, die geöffnete Partnerschaftskarte und beide PT-1-Prüfbilder.

Mit `npm run docs:bilder -- --up1a` erneuerst du Partnerschaft und Todesfall, Max’ Vermögenskarte mit zwei Immobilien und die Hinterbliebenenrente im Simulator. Ein frischer Muster-Spielbereich verwendet Haus 450.000 €, Wohnung 210.000 €, Nettomiete 650 €/Monat mit Inflation und Erika als Erbin aller Immobilien samt Steuergeld bei Nicht verheiratet, zusätzlich 0 % vom übrigen Geldvermögen. Das Prüfbild mit gesetztem Häkchen steht unter auftrag/EP-2-pruefbild-partnerschaft.png.

Mit `npm run docs:bilder -- --sophie` erneuerst du nur personen-sophie. Ein eigener Spielbereich wählt Sophie und zeigt ihre Einkünfte mit Gehalt bis Dezember 2037 und Rente ab Januar 2038.

Mit `npm run docs:bilder -- --zg5a` erzeugst du die vier Prüfbilder für Einkünfte bei 1920 und 1280 px sowie Übersicht und Haushalt & Plan mit 660.000 € Immobilien unter auftrag/. Eine eigene Sitzung ergänzt nur für die Bilder eine Betriebsrente mit Anpassung wie Löhne und zwei Immobilien. Sie prüft die Knopfgruppen auf Überlauf. Der Musterhaushalt bleibt unverändert. Neue Simulatoraufnahmen starten mit Real; im Backtest ist das die Kaufkraft des Startjahres.

Mit `npm run docs:bilder -- --euro` erneuerst du die sechs Simulator-Ergebnisbilder mit der Voreinstellung Real. Der Musterlauf verwendet 10.000 Pfade und Seed 12345. Backtestbilder zeigen die Kaufkraft des Startjahres.

Mit `npm run docs:bilder -- --szenarien` erneuerst du nur das Bild des Pfadvergleichs. Der Musterlauf verwendet ebenfalls 10.000 Pfade und Seed 12345. Zusätzliche Aufnahmen der Szenarioliste bei beiden PC-Zielgrößen liegen im Prüfverzeichnis.

Haushalt & Plan, Balance und Simulator zeigen ihre zunächst geschlossenen Planbereiche. Bei Max wird unter Einkünfte eine einmalige Rückzahlung über 50.000 € für Januar 2028 als Personendatum gespeichert. Die vorhandene Aufnahme personen-max zeigt den Bereich Einkünfte mit diesem Eintrag und den Summen. Für die Monte-Carlo-Einstellungen öffnet Einstellungen → zeigen die Klappe im Monte-Carlo-Reiter; die Aufnahme zeigt gezielt die Monte-Carlo-Karte. Danach schließt das Werkzeug den Bereich und wechselt zum Rechnen zurück zu Monte Carlo. Die Aufnahme simulator-annahmen zeigt die Monatszeile über der Jahrestabelle in Einkünfte, Ausgaben und Bedarf. Der Eintrag bleibt nur im frischen Aufnahme-Spielbereich und wird mit dessen Browserkontext verworfen.

Der Browser läuft mit 1920×1080 Pixeln, Skalierung 1, Deutsch und Europe/Berlin. Die technische Uhr ist festgesetzt; Zeitgeber für Speicher und UI laufen weiter. Ausschnitte und verlustfreie PNG-Kompression begrenzen die Bildgröße. Bilddateien, Unterschriften, Datum, Seite, Zustand, Git-Commit, Ausschnitt, Maße und Dateigröße stehen im [Manifest](manifest.json). Gleiche PNG-Bytes auf verschiedenen Plattformen sind nicht zugesichert.

Nach dem Lauf siehst du dir einige PNGs und beide Abläufe an. Prüfe den Zustand, lesbare Werte und fehlende Lade- oder Fehleranzeigen. Führe danach `npm run docs:pruefen` aus. Das Werkzeug meldet bei einem Abbruch Bild, Aktion und Grund; wiederhole den gesamten Lauf nach der Korrektur. Server und Browser werden auch bei Fehlern geschlossen.

## Ansichten

Die [Ablaufdiagramme](ablaufdiagramme.md) halten die Mermaid-Quellen der drei statischen Handbuch-SVGs fest. Sie benötigen im Browser und in der EXE keine Bibliothek und kein Netz.

- [uebersicht.png](uebersicht.png): Auf der Übersicht steht, was als Nächstes ansteht.
- [personen-haushalt-plan.png](personen-haushalt-plan.png): Haushalt & Plan zeigt zuerst den Bedarf; Partnerschaft und Todesfall ist darunter zugeklappt.
- [personen-max.png](personen-max.png): Max zeigt Einkünfte mit einer einmaligen Rückzahlung von 50.000 €.
- [personen-erika.png](personen-erika.png): Erika geht später in Rente als Max.
- [verlauf-haushalt.png](verlauf-haushalt.png): Der Verlauf fasst das Haushaltsvermögen zusammen.
- [verlauf-max.png](verlauf-max.png): Max’ Vermögen lässt sich einzeln verfolgen.
- [verlauf-erika.png](verlauf-erika.png): Erikas Vermögen ist einzeln sichtbar.
- [verlauf-kennzahlen.png](verlauf-kennzahlen.png): Rendite und Risiko sowie Monatsrenditen zeigen Anlagen ohne Tagesgeld.
- [verlauf-jahresuebersicht.png](verlauf-jahresuebersicht.png): Die Jahresübersicht trennt Wertänderung, Käufe und Verkäufe sowie Rendite.
- [ausgaben.png](ausgaben.png): Ausgaben zeigt Monats- und Jahreswerte.
- [balance-ueberblick.png](balance-ueberblick.png): Überblick zeigt Beschluss, Vorschau und Reserven heute und nach Umsetzung.
- [balance-bedarf-strategie.png](balance-bedarf-strategie.png): Bedarf & Strategie zeigt die Bedarfswerte; Alle Parameter fasst die Planwerte zusammen und ist zugeklappt.
- [balance-diagnose.png](balance-diagnose.png): Diagnose erklärt die Empfehlung.
- [simulator-ergebnis.png](simulator-ergebnis.png): Ergebnis zeigt Backtest und MC.
- [simulator-annahmen.png](simulator-annahmen.png): Die Planübersicht zeigt den gewählten Monat über den Jahreswerten.
- [simulator-backtest.png](simulator-backtest.png): Was im Lauf auffällt zeigt drei Backtest-Karten und Jahreslinks; Weitere bleibt geschlossen.
- [monte-carlo-einstellungen.png](monte-carlo-einstellungen.png): Simulation, Zeitraum & Daten und Stresstest stehen in Einstellungen; Erweitert zeigt die technischen Optionen.
- [monte-carlo-ueberblick.png](monte-carlo-ueberblick.png): Überblick zeigt den Musterlauf.
- [monte-carlo-risiko-verteilung.png](monte-carlo-risiko-verteilung.png): Die Verteilung macht die Streuung sichtbar.
- [monte-carlo-pflege.png](monte-carlo-pflege.png): Pflege zeigt das Modellrisiko.
- [monte-carlo-szenario-logs.png](monte-carlo-szenario-logs.png): Pfade vergleichen zeigt P10, Median und P90 mit Gesamtanteilen und Kennzahlen der Einzelpfade.
- [werkstatt.png](werkstatt.png): Drei Werkzeuge stehen in der Werkstatt bereit.
- [werkstatt-replay.png](werkstatt-replay.png): Replay zeigt die Pfadeingaben.
- [werkstatt-sweep.png](werkstatt-sweep.png): Parameter-Sweep zeigt die Eingaben.
- [werkstatt-auto-optimize.png](werkstatt-auto-optimize.png): Auto-Optimize zeigt die Sucheingaben.
- [daten-sicherung.png](daten-sicherung.png): Der Datenstatus steht in Daten & Sicherung.
- [daten-sicherung-punkte.png](daten-sicherung-punkte.png): Wiederherstellungspunkte sind nach Anlass gruppiert und zeigen je eine Grundzeile; einzeln löschbare Personenpunkte nennen „Bleibt, bis du ihn selbst löschst“.
- [probelauf-band.png](probelauf-band.png): Das Band zeigt Testdatum und Kursmodus; Ein Jahr durchspielen steht links von Spielbereich beenden.
- [spielbereich-vergleich.png](spielbereich-vergleich.png): Eine Kopie ohne Datumssprung zeigt beim Beenden den Vergleich Echt / Spielbereich.
- [handbuch-start.png](handbuch-start.png): Die Startseite zeigt die Aufgaben im aktuellen Handbuch.
- [personen-sophie.png](personen-sophie.png): Sophie spart mit ihrem Gehalt an; die Rente beginnt im Januar 2038.
- [einkuenfte-offen.png](einkuenfte-offen.png): Einkünfte geöffnet: Rente, feste und einmalige Einkunft mit einheitlichen Feldern.
- [einkuenfte-geschlossen.png](einkuenfte-geschlossen.png): Einkünfte geschlossen: Die Zusammenfassung nennt Beträge und Zeiträume.
- [geplante-ausgaben-offen.png](geplante-ausgaben-offen.png): Geplante Ausgaben geöffnet: Ratenkredit und Auto außerhalb von Grundbedarf und Flex.
- [geplante-ausgaben-geschlossen.png](geplante-ausgaben-geschlossen.png): Geplante Ausgaben geschlossen: Die Zusammenfassung nennt die geplanten Zahlungen.
- [balance-geplante-posten.png](balance-geplante-posten.png): Balance zeigt die geplanten Posten des Planjahres mit Monat und Vorzeichen.
- [ausgaben-geplante-zuordnung.png](ausgaben-geplante-zuordnung.png): Beim Ausgabenimport wird die bezahlte geplante Ausgabe außerhalb des Monatsbudgets zugeordnet.
- [protokoll-backtest.png](protokoll-backtest.png): Backtest-Protokoll: Das Einnahmen-ⓘ der ersten Jahreszeile zeigt Rente, sonstige und einmalige Einkünfte.
- [protokoll-backtest-details.png](protokoll-backtest-details.png): Backtest-Protokoll: Detailliert zeigt die Einzelbeträge.
- [protokoll-monte-carlo.png](protokoll-monte-carlo.png): Monte-Carlo-Protokoll: Das Erbe-ⓘ zeigt positive Erbschaftsteuer und ihre Herkunft aus geerbtem Steuergeld.
- [protokoll-monte-carlo-details.png](protokoll-monte-carlo-details.png): Monte-Carlo-Protokoll: Detailliert ergänzt die Jahresphasen; An Erben und Erbschaftsteuer stehen auch in Normal.
- [tagesgeld-bearbeiten.png](tagesgeld-bearbeiten.png): Tagesgeld lässt sich direkt in der Vermögenskarte bearbeiten.
- [personen-pflegegrad.png](personen-pflegegrad.png): Max Mustermann im Spielbereich: Pflegegrad 2, angenommener langsamerer Verlauf und automatisch gerechnetes Pflegegeld.
- [partnerschaft-todesfall.png](partnerschaft-todesfall.png): Nicht verheiratet: Erika erbt Immobilien und Steuergeld von Max, zusätzlich 0 % vom übrigen Geldvermögen.
- [personen-immobilien.png](personen-immobilien.png): Max: Haus 450.000 € und vermietete Wohnung 210.000 € mit 650 € Nettomiete pro Monat.
- [simulator-hinterbliebene.png](simulator-hinterbliebene.png): Nicht verheiratet: Erbanteile und gesperrte Rentenfelder; Grundbedarf, Wunsch- und Mindest-Flex bleiben einstellbar.
- [partnerschaft-verheiratet.png](partnerschaft-verheiratet.png): Verheiratet: Erika erbt 50 % von Max, Klasse I mit steuerfreiem Familienheim.
- [monte-carlo-vergleich.png](monte-carlo-vergleich.png): Vergleich: Wunschbudget +300 €/Monat, 1.000 gepaarte Läufe je Plan bei Einstellung 10.000, Seed 12345.
- [monte-carlo-zielwert.png](monte-carlo-zielwert.png): Zielwertsuche: 1.000 gepaarte Läufe je Schritt, Endprobe mit 10.000 Läufen, Seed 12345; unbestätigter Fund wird gekennzeichnet.

## Jahresbudget

Die zwei Budgetbilder verwenden dieselben Engine-Ergebnisse wie die erzeugten Handbuchbeispiele. Die produktive Balance-Karte zeigt im normalen Jahr 2000 voll finanzierten Flex ohne Warum-Knopf. Für 2002 öffnet das Werkzeug die echte Warum-Treppe. Heutige Planvergleiche und Ausgaben werden im historischen Ausschnitt ausgeblendet; die Fachwerte bleiben unverändert. Der Lauf bindet beide Bilder anschließend im Handbuch ein.

- [jahresbudget-max-erika-normal.png](jahresbudget-max-erika-normal.png): Im normalen Jahr ist der Flex voll finanziert. Die App zeigt keine Warum-Treppe.
- [jahresbudget-max-erika-2002.png](jahresbudget-max-erika-2002.png): 2002 senken Alarm und Rundung den Monatsbetrag. Die Warum-Treppe zeigt beide Eingriffe.

## Monat abschließen

- [01-faellig.png](monatsabschluss/01-faellig.png): Die Übersicht bietet den Oktoberabschluss an.
- [02-kurse.png](monatsabschluss/02-kurse.png): Der Reiter Kurse zeigt Kursstand und Tranchen-Tabelle nebeneinander.
- [03-ausgaben.png](monatsabschluss/03-ausgaben.png): Der Reiter Ausgaben zeigt Personenkarten und die offene Kategorie-Tabelle.
- [04-budget.png](monatsabschluss/04-budget.png): Drei Kacheln zeigen Ausgaben, Monatsbudget und Abweichung.
- [05-tagesgeld.png](monatsabschluss/05-tagesgeld.png): Der Reiter Tagesgeld zeigt Personen nebeneinander und den Monatsbetrag darunter.
- [06-ergebnis.png](monatsabschluss/06-ergebnis.png): Das Ergebnis zeigt links das Monatsbudget und rechts Kacheln und Herleitung ohne Reiter.

## Jahr abschließen

- [01-faellig.png](jahresabschluss/01-faellig.png): Die Übersicht bietet den Jahresabschluss an.
- [02-kurse.png](jahresabschluss/02-kurse.png): Der Reiter Kurse zeigt Kursstand und Tranchen-Tabelle nebeneinander.
- [03-ausgaben.png](jahresabschluss/03-ausgaben.png): Der Reiter Ausgaben Dezember zeigt Personenkarten und die offene Kategorie-Tabelle.
- [04-budget.png](jahresabschluss/04-budget.png): Der Reiter Budgetvergleich zeigt links Dezember und rechts das Jahr.
- [05-tagesgeld.png](jahresabschluss/05-tagesgeld.png): Der Reiter Tagesgeld 31.12. zeigt die Jahresendstände nebeneinander.
- [06-marktdaten.png](jahresabschluss/06-marktdaten.png): Der Reiter Pflegewerte steht vor Marktdaten und zeigt Pflegegeld und Heim-Eigenanteil nebeneinander.
- [07-pflegewerte.png](jahresabschluss/07-pflegewerte.png): Der Reiter Marktdaten zeigt Jahreswerte und die abgestufte Budgetprüfung; bei verschiedenen Folgen ist eine ausdrückliche Wahl nötig.
- [08-plan.png](jahresabschluss/08-plan.png): Der Reiter Plan 2027 zeigt Bedarf links, Monatsbudget und Marktwahl rechts; „Wahl ändern“ führt zu Marktdaten.
- [09-ergebnis.png](jahresabschluss/09-ergebnis.png): Das Ergebnis zeigt links Handlung und Monatsbudget, rechts Kacheln und Herleitungen ohne Reiter.
