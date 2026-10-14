# App-Bilder

Die Bilder zeigen Max und Erika Mustermann mit synthetischen Daten. Öffne [Monat abschließen](monatsabschluss.html) oder [Jahr abschließen](jahresabschluss.html), um den Ablauf Schritt für Schritt anzusehen. Beide Bildfolgen laufen offline.

## Bilder erneuern

Führe im Repository `npm run docs:bilder` aus. Du brauchst die installierten npm-Abhängigkeiten und Playwright Chromium. Fehlt der Browser, installiere ihn einmal mit `npx playwright install chromium`.

Das Werkzeug startet denselben lokalen Server wie `npm run serve`, ohne Kursproxy. Es nutzt einen freien Port und drei frische Browserkontexte für Ansichten, Monat und Jahr. Vorhandene Browserprofile werden nicht geöffnet. Kurse und Marktdaten stammen aus festen lokalen Stubs oder dem Probelauf; externe Abrufe werden blockiert.

Die Ansichten verwenden den 20.10.2026. Für Oktober springt der Probelauf vom 20.10. auf den 10.11.2026. Für den Jahresabschluss springt ein eigener Probelauf vom 15.12.2026 auf den 02.01.2027. Der Simulator rechnet einmal 10.000 Monte-Carlo-Läufe mit Seed 12345; die Werkstatt zeigt Eingaben.

Haushalt & Plan, Balance und Simulator zeigen ihre zunächst geschlossenen Planbereiche. Bei Max wird Person, Rente & Steuern vor der Aufnahme geöffnet. Für die Monte-Carlo-Einstellungen öffnet Einstellungen anzeigen den Bereich Alle Parameter unter Annahmen; die Aufnahme zeigt gezielt die Monte-Carlo-Karte. Danach schließt das Werkzeug den Bereich und wechselt zum Rechnen zurück zu Monte Carlo.

Der Browser läuft mit 1920×1080 Pixeln, Skalierung 1, Deutsch und Europe/Berlin. Die technische Uhr ist festgesetzt; Zeitgeber für Speicher und UI laufen weiter. Ausschnitte und verlustfreie PNG-Kompression begrenzen die Bildgröße. Bilddateien, Unterschriften, Datum, Seite, Zustand, Git-Commit, Ausschnitt, Maße und Dateigröße stehen im [Manifest](manifest.json). Gleiche PNG-Bytes auf verschiedenen Plattformen sind nicht zugesichert.

Nach dem Lauf siehst du dir einige PNGs und beide Abläufe an. Prüfe den Zustand, lesbare Werte und fehlende Lade- oder Fehleranzeigen. Führe danach `npm run docs:pruefen` aus. Das Werkzeug meldet bei einem Abbruch Bild, Aktion und Grund; wiederhole den gesamten Lauf nach der Korrektur. Server und Browser werden auch bei Fehlern geschlossen.

## Ansichten

- [uebersicht.png](uebersicht.png): Auf der Übersicht steht, was als Nächstes ansteht.
- [personen-haushalt-plan.png](personen-haushalt-plan.png): Haushalt & Plan zeigt Vermögen und Bedarf; Weitere Planwerte ist zugeklappt.
- [personen-max.png](personen-max.png): Max zeigt Auf einen Blick und die geöffnete Karte Person, Rente & Steuern.
- [personen-erika.png](personen-erika.png): Erika geht später in Rente als Max.
- [verlauf-haushalt.png](verlauf-haushalt.png): Der Verlauf fasst das Haushaltsvermögen zusammen.
- [verlauf-max.png](verlauf-max.png): Max’ Vermögen lässt sich einzeln verfolgen.
- [verlauf-erika.png](verlauf-erika.png): Erikas Vermögen ist einzeln sichtbar.
- [ausgaben.png](ausgaben.png): Ausgaben zeigt Monats- und Jahreswerte.
- [balance-ueberblick.png](balance-ueberblick.png): Überblick trennt Beschluss und Vorschau.
- [balance-bedarf-strategie.png](balance-bedarf-strategie.png): Bedarf & Strategie zeigt die Bedarfswerte; Alle Parameter fasst die Planwerte zusammen und ist zugeklappt.
- [balance-diagnose.png](balance-diagnose.png): Diagnose erklärt die Empfehlung.
- [simulator-ergebnis.png](simulator-ergebnis.png): Ergebnis zeigt Backtest und MC.
- [simulator-annahmen.png](simulator-annahmen.png): Annahmen zeigt Bedarf, Personen und Pflege; Alle Parameter fasst dieselben Planwerte wie Haushalt & Plan zusammen.
- [simulator-backtest.png](simulator-backtest.png): Backtest zeigt Zeitraum links neben Kennzahlen und Einordnung im ⓘ.
- [monte-carlo-einstellungen.png](monte-carlo-einstellungen.png): Simulation, Zeitraum & Daten und Stresstest stehen in Einstellungen; Erweitert zeigt die technischen Optionen.
- [monte-carlo-ueberblick.png](monte-carlo-ueberblick.png): Überblick zeigt den Musterlauf.
- [monte-carlo-risiko-verteilung.png](monte-carlo-risiko-verteilung.png): Die Verteilung macht die Streuung sichtbar.
- [monte-carlo-pflege.png](monte-carlo-pflege.png): Pflege zeigt das Modellrisiko.
- [monte-carlo-szenario-logs.png](monte-carlo-szenario-logs.png): Einzelne Pfade lassen sich in Szenario-Logs nachlesen.
- [werkstatt.png](werkstatt.png): Drei Werkzeuge stehen in der Werkstatt bereit.
- [werkstatt-replay.png](werkstatt-replay.png): Replay zeigt die Pfadeingaben.
- [werkstatt-sweep.png](werkstatt-sweep.png): Parameter-Sweep zeigt die Eingaben.
- [werkstatt-auto-optimize.png](werkstatt-auto-optimize.png): Auto-Optimize zeigt die Sucheingaben.
- [daten-sicherung.png](daten-sicherung.png): Der Datenstatus steht in Daten & Sicherung.
- [probelauf-band.png](probelauf-band.png): Das Band zeigt Datum und Rückkehr.
- [handbuch-start.png](handbuch-start.png): Die Startseite zeigt die Aufgaben im aktuellen Handbuch.

## Monat abschließen

- [01-faellig.png](monatsabschluss/01-faellig.png): Die Übersicht bietet den Oktoberabschluss an.
- [02-kurse.png](monatsabschluss/02-kurse.png): Kurse prüfen zeigt die vorhandenen Kursstände.
- [03-ausgaben.png](monatsabschluss/03-ausgaben.png): Ausgaben Oktober zeigt den Importstand.
- [04-budget.png](monatsabschluss/04-budget.png): Drei Kacheln zeigen Ausgaben, Monatsbudget und Abweichung.
- [05-tagesgeld.png](monatsabschluss/05-tagesgeld.png): Tagesgeld zeigt Lesewerte und die Bestätigung je Person.
- [06-ergebnis.png](monatsabschluss/06-ergebnis.png): Drei Kacheln zeigen den Oktoberabschluss; Herleitung anzeigen ist zugeklappt.

## Jahr abschließen

- [01-faellig.png](jahresabschluss/01-faellig.png): Die Übersicht bietet den Jahresabschluss an.
- [02-kurse.png](jahresabschluss/02-kurse.png): Kurse prüfen zeigt die vorhandenen Kursstände.
- [03-ausgaben.png](jahresabschluss/03-ausgaben.png): Ausgaben Dezember zeigt den Importstand.
- [04-budget.png](jahresabschluss/04-budget.png): Der Vergleich zeigt Dezemberausgaben und Jahreswerte.
- [05-tagesgeld.png](jahresabschluss/05-tagesgeld.png): Tagesgeld zeigt bestätigte Jahresendstände.
- [06-marktdaten.png](jahresabschluss/06-marktdaten.png): Drei Kacheln zeigen Inflation, ETF-Schlusskurs und CAPE mit gemeinsamer Herkunft.
- [07-plan.png](jahresabschluss/07-plan.png): Plan 2027 zeigt Werte und bewusste Anpassung.
- [08-ergebnis.png](jahresabschluss/08-ergebnis.png): Das Ergebnis zeigt die Handlungsanweisung, das Monatsbudget und geschlossene Herleitungen.
