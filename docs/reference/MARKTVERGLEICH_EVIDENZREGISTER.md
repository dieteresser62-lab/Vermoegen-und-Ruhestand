# Marktvergleich – Evidenzregister

Dieses Register belegt Produktstufen, Kriterien und Grenzen für fachlich Interessierte und Entwickler. Recherche und eigener Codeabgleich: 27.10.2026, Europe/Berlin. [Kompakte Einordnung](MARKTVERGLEICH.md), [Modellüberblick](FACHKONZEPT.md).

## Vergleichsvertrag

### Auswahl und Vergleichseinheit

Untersucht sind zehn vorhandene externe Werkzeuge plus eigene Referenz: Privatplanung (ProjectionLab Premium, Boldin PlannerPlus), deutsche Einzelangebote (BVI, Finanzfluss, Digitale Rentenübersicht), Berater (MoneyGuide, eMoney Pro), historische Entnahme (FI Calc, FIRECalc 3.0) und lokale Tabelle (Pralana Gold Subscription). Kein Produkt ersetzt. Stufe, Sprache/Region und Abrufdatum begrenzen jeden Befund. Produktkennungen: RS-01 eigene App; CP-01 ProjectionLab, CP-02 Boldin; DE-01 BVI, DE-02 Finanzfluss, DE-03 Rentenübersicht; AD-01 MoneyGuide, AD-02 eMoney; FIRE-01 FI Calc, FIRE-02 FIRECalc; OT-01 Pralana.

Aufnahme verlangt benannte verfügbare Stufe, Vorsorge-/Entnahmezweck, eigenständige Aufgabe und Primärbelege. Reine Portfolioanalyse, doppelte Stufen und nur sekundär belegte Angebote entfallen. Die Stichprobe ist nicht repräsentativ; Marktanteile und Exklusivität folgen daraus nicht.

### Status und Auswertung

Vorhanden = Kriterienkern belegt; teilweise = belegter Teil mit Grenze; nicht vorhanden = ausdrücklicher Ausschluss oder abgegrenzter Eingabevertrag. Unklar = Beleg/Stufe widersprüchlich oder unzureichend; nicht geprüft = Zugang/Ausführung fehlt; nicht anwendbar = außerhalb des Zwecks. Fehlendes Dokument beweist keine fehlende Funktion. Mehrteilige Kriterien folgen der schwächsten verpflichtenden Teilfrage. Keine Addition, Gewichtung oder Rangliste.

### Evidenzklassen und Pflichtfelder

P1 bezeichnet Anbieter-/Projektquelle, P2 offizielle Hilfe oder Funktionsbeschreibung, P3 eigene ausgeführte Beobachtung, P4 historischen Beleg, I1 dokumentierten Recherche-/Prüfpfad. Hier wurde kein Produktbedienlauf ausgeführt. Eine Suchseite oder ein 99-Record bestätigt kein Softwarefehlen. Primärquelle, Veröffentlichung, Abruf, Region, Aussage und Grenze stehen pro Record. Datum unbekannt heißt „undatiert“; relative Updated-Angaben werden nicht in Kalenderdaten umgerechnet. Konten, Käufe, Demoanfragen und echte Finanzdaten sind ausgeschlossen.

### Kriterienkatalog

| ID | Prüfkern |
| --- | --- |
| K-01 Fachmodell | Zahlungsströme, Vermögen, Zeitachse und Ereignisfolge; Produktzweck abgrenzen. |
| K-02 Steuern | Region, Kapitalerträge/Einkommen, Steuerkonten, Teilfreistellung und Grenzen; kein Rechtsgutachten. |
| K-03 Rente | Personen, verschiedene Einkommensarten, Beginn/Ende und Anpassung; deutsche Anspruchsprüfung unterscheiden. |
| K-04 Pflege | Person, Eintritt, Kostenentwicklung und zweckgebundene Reserve; allgemeine Ausgabe kein Pflegegradmodell. |
| K-05 Haushalt | mehrere Personen, Eigentum, Tod und daraus folgende Zahlungsänderungen. |
| K-06 Datenbasis | Quelle, Zeitraum, Region, Transformationen und Ersatzreihen. |
| K-07 Stochastik | historische/zufällige Pfade, Stress, Seed und Wiederholung; historische Tests nicht Monte Carlo nennen. |
| K-08 Transparenz | Formeln, Ablauf, Defaults und Grenzen öffentlich nachvollziehbar. |
| K-09 Szenarien | Speichern, Kopieren und Vergleich vollständiger Pläne; einzelne Parameterprüfungen getrennt. |
| K-10 Optimierung | Suchziel, Grenzen und Constraints; beste gefundene Variante kein globales Optimum. |
| K-11 Datenschutz | Speicherung, Verarbeitung, Datenübertragung und Löschmöglichkeiten; Herstellererklärung kein Audit. |
| K-12 Offline-Fähigkeit | Kernrechnung und Start ohne Netz, Liefer-/Laufzeitabhängigkeiten und verbleibende Netzpfade. |
| K-13 Export | Ausgabe, Vollsicherung, Reimport und Übertragbarkeit; Report allein kein Backup. |
| K-14 Auditierbarkeit | Eingaben, Daten-/Modellversion, Seed, Zwischenschritte und Reproduktion. |
| K-15 UX | zugängliche Bedienung, Hilfen und Fehlerbehandlung; Seitenbeschreibung kein Bedien- oder Usability-Test. |
| K-16 Barrierefreiheit | einzelne Bedienhilfen und formale WCAG-/Screenreader-Nachweise auseinanderhalten. |
| K-17 Preis | konkrete Stufe, Verfügbarkeit, Originalwährung, Periode und ausdrücklich genannte Zusatzkosten. |
| K-18 Lizenz | Nutzungs- und Weitergaberechte der konkreten Software; Daten und Abhängigkeiten getrennt. |

### Referenzhaushalt und Proben

Synthetischer Haushalt, Kaufkraft 01.01.2027, Ende 31.12.2066. Die Eingaben sind Vergleichsannahmen; kein persönlicher Steuer-/Rentenbescheid.

| Inputgruppe | RH-01 Basisfall |
| --- | --- |
| Personen | Max 63, Ruhestand 2027; Erika 61, Ruhestand 2029; verheirateter deutscher Paarhaushalt, ohne vorgegebenen Tod im Basisfall |
| Nettozuflüsse | Erika 30.000 EUR Erwerbseinkommen 2027/2028; gesetzliche Renten Max 22.800 EUR ab 2029, Erika 17.400 EUR ab 2033, je 2 % Anpassung; private Rente Max 4.800 EUR ab 2032, nominal konstant |
| Bedarf | Grundbedarf 42.000 EUR real, Flex 12.000 EUR real, je 2 % Inflation; Gebäudemaßnahme 35.000 EUR real 2035 |
| Vermögen | Aktien-ETF 550.000 EUR Marktwert/350.000 EUR Kostenbasis; Anleihen 120.000; Cash 60.000; Gold 40.000/30.000; Pflegevorsorge 80.000 gesperrt; Immobilie 450.000, nicht entnahmefreigegeben |
| Ertrag/Kosten | nominal Aktien 5 %, Anleihen 2,5 %, Cash/Pflegevorsorge 1,5 %, Gold 2 %; Kosten 0,25 % jährlich auf investiertes Finanzvermögen |
| Teststeuer/Priorität | 25 % Kapitalertragsteuer, Zuschlag 5,5 % darauf, keine Kirchensteuer; ETF-Teilfreistellung 30 %, gemeinsamer Freibetrag 2.000 EUR; Einkommen zuerst, Portfolio für Restbedarf, Pflegevorsorge bis RH-03 gesperrt |

| Probe | Änderung | Verpflichtende Frage |
| --- | --- | --- |
| RH-02 Sequenzstress | Aktien 2027 −25 %, 2028 −10 %; Inflation 6 %/4 %; dann Kontrollannahmen | Exakte datierte Markt-/Inflationsfolge und Entnahmewirkung abbildbar? |
| RH-03 Pflege | Erika ab 01.01.2044 Pflegegrad 3; Bedarf +24.000 EUR real/Jahr, 2 % Anpassung; Reserve zuerst | Person, Pflegegrad, Datum, Kostendynamik und Freigabe der gesperrten Vorsorge nativ? |
| RH-04 Hinterbliebene | Max stirbt 31.12.2048; seine Renten enden; Erika ab 2049 zusätzlich 55 % seiner gesetzlichen Rente; Grundbedarf −20 %, Flex −30 % | Ereignis, verzögerter Rentenzufluss und unterschiedliche Bedarfsänderung konsistent? |

Die Zuordnung unterscheidet native Abbildung, dokumentierten Umweg, grobe Näherung und nicht prüfbare Eingaben. Der konservativste wesentliche Input begrenzt den Gesamtfall. Fehlende Anlagen werden nicht still umgeschichtet, Brutto-/Nettoflüsse nicht vertauscht.

Es wurde kein vollständiger Fremdprodukt-Rechenlauf mit RH-01 bis RH-04 ausgeführt. Die Zuordnung folgt öffentlichen Herstellerbeschreibungen. Daten, Rendite-/Inflationspfad, Ereignisfolge, Steuer, Kosten und Erfolgsdefinition sind nicht harmonisiert; Ergebnisbeträge und Erfolgsquoten werden deshalb nicht nebeneinandergestellt.

<a id="kriterienmatrix-k-01-bis-k-18"></a>

## Werkzeuge

Alle Records dokumentieren den Abruf oder Prüfversuch am 27.10.2026. Anbieterangaben sind keine unabhängigen Audits. Produktversionen ohne öffentlichen Beleg bleiben offen. Gesamtvermögen enthält Geldvermögen und Immobilien; Entnahmen, Rendite, Ruin und Strategiequoten beziehen sich auf Geldvermögen. Kriterienverweise wie 01/02 übernehmen das Quellenpräfix derselben Zeile.

### Vermögen und Ruhestand

Codeabgleich bestätigt Einkünfte-/Ausgabenlisten und Immobilien samt Nachlass. Interne Pflegeabstimmung ist vorhanden; externe Validierung bleibt offen.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-rs-01"></a>MKT-RS-01 | P1 | Projekt, [Plan](../../app/profile/household-plan.js), [Beschluss](../../app/profile/annual-plan-record.js), [Einkünfte](../../app/profile/profile-income.js), [Ausgaben](../../app/profile/household-planned-expenses.js), [Immobilien](../../app/profile/profile-immobilien.js) | Code 27.10.2026; Abruf 2026-10-27 | DE/Deutschland | Haushaltsplan, Beschluss/Vorschau, Einkünfte, geplante Ausgaben, Immobilien, Abschlüsse, Verlauf und Sicherung. | Codeabgleich; keine eigene Bedien-/RH-Gesamtausführung. |
| <a id="mkt-rs-02"></a>MKT-RS-02 | P1 | Projekt, [Engine](../../engine/core.mjs), [Pflegevertrag](../../app/simulator/german-demography-care-survivor-contract.js), [Erbe](../../app/simulator/simulator-inheritance.js), [Heimverkauf](../../app/simulator/simulator-home-sale.js) | Code 27.10.2026; Abruf 2026-10-27 | DE/Deutschland | Entnahme, Kapitalertrag-/Erbsteuer, Pflege, Hinterbliebene, Pfade und Suche. | Planungsschätzung; keine externe Prognosevalidierung. |
| <a id="mkt-rs-03"></a>MKT-RS-03 | P1 | Projekt, [Daten](DATA_SOURCES.md), [Speicher](../../app/shared/persistence-facade.js), [Tauri](../../src-tauri/tauri.conf.json), [Auslieferung](../../scripts/sync-dist.mjs), [Handbuch](../../Handbuch.html) | Code 27.10.2026; Abruf 2026-10-27 | DE/EUR | Lokale Kernrechnung, EXE-Paketierung, getrennte Speicher und Offline-Hilfe. | Livewerte brauchen Netz; keine EXE-Ausführung. |
| <a id="mkt-rs-04"></a>MKT-RS-04 | P1 | Projekt, [LICENSE.md](../../LICENSE.md) | Code 27.10.2026; Abruf 2026-10-27 | EN/international | MIT-Lizenztext stimmt mit den npm- und Cargo-Metadaten überein. | Daten und Abhängigkeiten haben eigene Rechte. |
| <a id="mkt-rs-05"></a>MKT-RS-05 | I1 | Projekt, [package.json](../../package.json), [package-lock.json](../../package-lock.json), [Cargo.toml](../../src-tauri/Cargo.toml) | Code 27.10.2026; Abruf 2026-10-27 | EN/international | Root-Lizenzfelder in npm, Lockfile und Cargo: MIT. | Metadaten sind keine Lizenzgewährung. |
| <a id="mkt-rs-99"></a>MKT-RS-99 | I1 | Projekt, [Diagnosen](../../app/shared/close-dialog.js), [Metriken](../../app/simulator/results-metrics.js) | Code 27.10.2026; Abruf 2026-10-27 | DE/Deutschland | Geführte Bedienung und einzelne Fokus-/ARIA-Hilfen im Code. | UX/WCAG und externe Entscheidungsvalidierung nicht geprüft. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-RS-01, MKT-RS-02 | Gemeinsamer Plan, Empfehlung/Beschluss und Jahresrechnung. |
| K-02 Steuern | teilweise · MKT-RS-02 | Kapitalertrag-/Erbsteuer geschätzt; kein vollständiges Steuerrecht. |
| K-03 Rente | teilweise · MKT-RS-02 | Renten und freie Netto-Einkünfte; kein Anspruchsabruf. |
| K-04 Pflege | teilweise · MKT-RS-02 | Grade, Formen und Reserve; Eintritt nicht frei datierbar. |
| K-05 Haushalt | teilweise · MKT-RS-01, MKT-RS-02 | Eigentümer und Nachlass; Lebensereignisse höchstens zwei Personen. |
| K-06 Datenbasis | teilweise · MKT-RS-03 | Forschungsproxies; Anleihen als Cash-Zins-Ersatz. |
| K-07 Stochastik | vorhanden · MKT-RS-02 | Historische/gesampelte Pfade, Stress und Seeds. |
| K-08 Transparenz | vorhanden · MKT-RS-02 | Offene Regeln/Diagnosen; kein Wirkungsnachweis. |
| K-09 Szenarien | teilweise · MKT-RS-01, MKT-RS-02 | Planversuche, Vergleich und Sweep; kein freier Gesamtplan-Katalog. |
| K-10 Optimierung | vorhanden · MKT-RS-02 | Experimentelle Kandidatensuche; kein globales Optimum. |
| K-11 Datenschutz | vorhanden · MKT-RS-03 | Lokaler Bestand; Liveabrufe mit Netzpfaden, kein Audit. |
| K-12 Offline-Fähigkeit | vorhanden · MKT-RS-03 | Kernrechnung, Reihen und Hilfe lokal; Livewerte online. |
| K-13 Export | vorhanden · MKT-RS-01, MKT-RS-03 | Vollsicherung/Restore; Archiv/Layout ausgenommen. |
| K-14 Auditierbarkeit | vorhanden · MKT-RS-01, MKT-RS-02 | Jahreswerte, Seeds, Belege und Missingness. |
| K-15 UX | teilweise · MKT-RS-01, MKT-RS-99 | Geführte Schritte; keine Nutzerstudie. |
| K-16 Barrierefreiheit | teilweise · MKT-RS-99 | Einzelne Hilfen; kein vollständiger WCAG-Nachweis. |
| K-17 Preis | nicht anwendbar · MKT-RS-03, MKT-RS-04 | Lokale Codekopie, kein untersuchter kommerzieller Tarif. |
| K-18 Lizenz | vorhanden · MKT-RS-04, MKT-RS-05 | MIT-Lizenztext und Projektmetadaten sind konsistent; Datenrechte getrennt. |

### ProjectionLab Premium

Premium-Tarif bestätigt; Terms-Datum jetzt konkret belegt. Alte Self-Hosting-Rechte sind keine heutige Premium-Zusage.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-pl-01"></a>MKT-PL-01 | P1 | ProjectionLab Premium, [Pricing](https://projectionlab.com/pricing) | undatiert; Abruf 2026-10-27 | EN/international | K-01/09/10/17: Premium 129 USD/Jahr; mehrere Pläne, Compare, Monte Carlo und historische Tests. | Tarifbeschreibung; keine Kontositzung. |
| <a id="mkt-pl-02"></a>MKT-PL-02 | P1 | ProjectionLab, [Simulation Engine](https://projectionlab.com/help/simulation-engine), [Cash Flow](https://projectionlab.com/cash-flow) | Hilfe 30.06.2026; Abruf 2026-10-27 | EN/international | K-01/06–08/14: Jahresrechnung und Jahresansicht; eigene Rendite-/Inflationsfolgen in Cash-Flow-Beschreibung. | Datenendjahr und Seed offen. |
| <a id="mkt-pl-03"></a>MKT-PL-03 | P2 | ProjectionLab, [Create a New Plan](https://projectionlab.com/help/create-new-plan), [Inflation Spike](https://projectionlab.com/help/model-inflation-spike) | Hilfe 20./13.07.2026; Abruf 2026-10-27 | EN/international | K-01/04/05/09: Einkommen, Einmalereignisse, Ausgaben, reale Anlagen und Plankopien; zeitliche Inflation. | Kein deutscher Pflegegrad-/Reservevertrag. |
| <a id="mkt-pl-04"></a>MKT-PL-04 | P2 | ProjectionLab, [Tax Analytics](https://projectionlab.com/tax-analytics) | undatiert; Abruf 2026-10-27 | EN/international | K-02/10: Deutschland-Steuerpreset und Steueranalyse. | Lots, Verlusttopf und Teilfreistellung nicht vollständig belegt. |
| <a id="mkt-pl-05"></a>MKT-PL-05 | P2 | ProjectionLab, [Death of a Spouse](https://projectionlab.com/help/life-expectancy-milestone) | 11.03.2025; Abruf 2026-10-27 | EN; Beispiele USA | K-05: Todesmeilensteine und Vermögensübergang. | Steuerbeispiele USA; deutscher Survivor-Vertrag offen. |
| <a id="mkt-pl-06"></a>MKT-PL-06 | P2 | ProjectionLab, [Defined Benefit Pension](https://projectionlab.com/help/defined-benefit-pension) | 11.03.2025; Abruf 2026-10-27 | EN/international | K-03: Rentenbeginn/-ende, Beträge/Gehaltsbezug und steuerfreie Auszahlung. | Kein persönlicher deutscher Rentenanspruch. |
| <a id="mkt-pl-07"></a>MKT-PL-07 | P1 | ProjectionLab, [Data Security](https://projectionlab.com/help/data-security) | 09.06.2023; Abruf 2026-10-27 | EN/international | K-11/13: Konto auf Google Cloud/Firebase, Verschlüsselung, JSON-Sicherung/-Restore und Löschung. | Nur Anbieterangabe; nicht ausgeführt. |
| <a id="mkt-pl-08"></a>MKT-PL-08 | P2 | ProjectionLab, [Self-Hosting Update](https://projectionlab.com/blog/update-on-self-hosting) | 06.03.2025; Abruf 2026-10-27 | EN/international | K-12: Altinstallationen laufen weiter; Fehlerkorrekturen bis 31.12.2025. | Kein heutiges Premium-Offlineangebot daraus ableiten. |
| <a id="mkt-pl-09"></a>MKT-PL-09 | P1 | ProjectionLab, [Terms](https://projectionlab.com/terms) | Terms 07.08.2026; Abruf 2026-10-27 | EN/USA | K-18: Beschränkte proprietäre Nutzungsrechte. | Keine freie Weitergabelizenz. |
| <a id="mkt-pl-99"></a>MKT-PL-99 | I1 | Prüfpfad: [Help](https://projectionlab.com/help), [Changelog](https://projectionlab.com/changelog), Pricing, Security und Terms oben | Changelog 20.04.2026; Abruf 2026-10-27 | EN/international | K-04/15/16: Hilfe/Changelog geprüft; Hauptversion 4.6.0 vom 20.04.2026 sichtbar. | Deutsche Pflege/WCAG offen; Bedienung nicht geprüft. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-PL-01/02/03 | Jahrescashflows und zeitliche Ereignisse; keine eigene Ausführung. |
| K-02 Steuern | teilweise · MKT-PL-04 | Deutschland-Preset; deutsche Depotdetails nicht vollständig belegt. |
| K-03 Rente | teilweise · MKT-PL-06 | Zeitliche Rentenzuflüsse; kein deutscher Anspruchsvertrag. |
| K-04 Pflege | teilweise · MKT-PL-03/99 | Allgemeine Ausgabenereignisse; deutsche Pflege-/Reservefachlichkeit unklar. |
| K-05 Haushalt | teilweise · MKT-PL-03/05 | Personen und Tod/Übergang; deutsche Survivor-Folgen offen. |
| K-06 Datenbasis | teilweise · MKT-PL-02/99 | Historische Datenmodelle beschrieben; heutiges Endjahr/volle Datenbasis offen. |
| K-07 Stochastik | teilweise · MKT-PL-01/02/99 | Historisch, zufällig und eigene Folgen; Seedsteuerung unklar. |
| K-08 Transparenz | teilweise · MKT-PL-02/03 | Ablauf und Beispiele, keine vollständige Formelspezifikation. |
| K-09 Szenarien | vorhanden · MKT-PL-01/03 | Mehrere Pläne, Kopien und Compare in Premium. |
| K-10 Optimierung | teilweise · MKT-PL-01/04 | Steuerstrategien; nicht jeder Suchparameter öffentlich. |
| K-11 Datenschutz | vorhanden · MKT-PL-07/09 | Konto-/Cloudverarbeitung und Rechte dokumentiert; kein eigener Audit. |
| K-12 Offline-Fähigkeit | nicht geprüft · MKT-PL-08/99 | Heutiger Premium-Offlineablauf nicht ausgeführt; Legacy separat. |
| K-13 Export | vorhanden · MKT-PL-07 | JSON-Sicherung und Restore dokumentiert, nicht ausgeführt. |
| K-14 Auditierbarkeit | teilweise · MKT-PL-02/07 | Jahresansicht/JSON, Seed und vollständige Rechnung offen. |
| K-15 UX | nicht geprüft · MKT-PL-99 | Kein Premiumkonto benutzt. |
| K-16 Barrierefreiheit | teilweise · MKT-PL-99 | Einzelne Changelog-Option; formaler Nachweis unklar. |
| K-17 Preis | vorhanden · MKT-PL-01 | Premium 129 USD/Jahr, öffentlich angeboten. |
| K-18 Lizenz | vorhanden · MKT-PL-09 | Proprietäre Nutzung geregelt, keine offene Weitergabe. |

### Boldin PlannerPlus

Sonderprüfung zum 15.10. nachgeholt: 168 USD/Jahr bestätigt. Release Notes und Preisblatt widersprechen sich bei Gebührenansichten; keine ausgelieferte Planübernahme behauptet.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-bd-01"></a>MKT-BD-01 | P1 | Boldin PlannerPlus, [Pricing](https://www.boldin.com/retirement/pricing/); ergänzt [Release Notes](https://www.boldin.com/retirement/release-notes/) | Releases bis 22.10.2026; Abruf 2026-10-27 | EN/USA | K-01/09/10/13/17: 168 USD/Jahr; Szenarien, Monte Carlo, Reports; Release Notes: Gebühren-/Steuerverteilungsansichten ab 22.10. | Preisblatt nennt Gebührenansicht noch kommend; Apply to Plan angekündigt. |
| <a id="mkt-bd-02"></a>MKT-BD-02 | P2 | Boldin, [Outside the US](https://help.boldin.com/en/articles/6509299-is-plannerplus-suitable-for-canadians-or-other-non-us-citizens-planning-for-retirement) | 29.05.2026; Abruf 2026-10-27 | EN/USA | K-02: US-Recht; Nicht-US-Steuern und freie Auslandssteuersätze nicht unterstützt. | Steuerfreie Ausweichwege sind kein deutscher Steuervertrag. |
| <a id="mkt-bd-03"></a>MKT-BD-03 | P1 | Boldin, [Monte Carlo](https://help.boldin.com/en/articles/5805671-boldin-s-monte-carlo-simulation) | nur relatives Updated; Abruf 2026-10-27 | EN/USA | K-07/08/14: 1.000 normalverteilte Läufe und Erfolgsdefinition. | Seed und genaue Schockfolge offen. |
| <a id="mkt-bd-04"></a>MKT-BD-04 | P2 | Boldin, [Return Assumptions](https://help.boldin.com/en/articles/10563826-how-do-i-account-for-rate-of-return-assumptions) | nur relatives Updated; Abruf 2026-10-27 | EN/USA | K-06–08: S&P 500/US-Treasuries 1994–2024; eigene Modellraten. | Holdings-Ansichten belegen keine vollständige Kostenbasis-/Transaktionsrechnung. |
| <a id="mkt-bd-05"></a>MKT-BD-05 | P2 | Boldin, [Create and Compare Scenarios](https://help.boldin.com/en/articles/4326642-video-demo-create-and-compare-scenarios) | 20.02.2026; Abruf 2026-10-27 | EN/USA | K-09: Bis zehn Szenarien, Baselinewechsel und Vergleich. | Einige gemeinsame Annahmen; kein Kontotest. |
| <a id="mkt-bd-06"></a>MKT-BD-06 | P2 | Boldin, [Long-Term Care](https://help.boldin.com/en/articles/5847824-what-are-the-long-term-care-assumptions) | 19.05.2026; Abruf 2026-10-27 | EN/USA | K-04: Standard-LTC letzte 28 Lebensmonate, US-Kostenbasis 2024. | Deutsche Grade/Reserve fehlen als Beleg; Zusatzkosten separat. |
| <a id="mkt-bd-07"></a>MKT-BD-07 | P2 | Boldin, [First Spouse Passes](https://help.boldin.com/en/articles/9293023-assumptions-when-the-first-spouse-passes) | nur relatives Updated; Abruf 2026-10-27 | EN/USA | K-03/05: Einkommen enden, Konten gehen über; US-Survivor-Annahmen. | Ausgaben manuell; frühe Survivor-Fälle begrenzt. |
| <a id="mkt-bd-08"></a>MKT-BD-08 | P1 | Boldin, [Privacy](https://www.boldin.com/retirement/privacy-policy/) | 29.06.2026; Abruf 2026-10-27 | EN/USA | K-11: Datenkategorien, Dienstverarbeitung, Aufbewahrung und Löschrechte. | Keine eigene Prüfung von Konto/Aggregator/Vault. |
| <a id="mkt-bd-09"></a>MKT-BD-09 | P1 | Boldin, [Terms](https://www.boldin.com/retirement/terms-of-use/) | undatiert; Abruf 2026-10-27 | EN/USA | K-18: Persönliche, nicht übertragbare proprietäre Nutzung. | Kopieren/Reverse Engineering eingeschränkt. |
| <a id="mkt-bd-99"></a>MKT-BD-99 | I1 | Prüfpfad: Pricing, alle Hilfen oben, [Help](https://help.boldin.com/), Release Notes, Privacy, Terms | Recherche 27.10.2026; Abruf 2026-10-27 | EN/USA | K-12/15/16: Öffentliche Hilfen, Bedingungen und Releases geprüft. | Offline/WCAG unklar; kein Login oder Bedienlauf. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-BD-01 | Ruhestandsplanung mit Einkommen, Ausgaben und Vermögen. |
| K-02 Steuern | teilweise · MKT-BD-02 | US-Steuern; Nicht-US-Regeln ausdrücklich nicht unterstützt. |
| K-03 Rente | teilweise · MKT-BD-07/02 | Persönliche Pension-/Social-Security-Ströme; deutsche Fachlichkeit fehlt. |
| K-04 Pflege | teilweise · MKT-BD-06 | US-LTC-Annahmen; deutsche Grade/Reserve nicht belegt. |
| K-05 Haushalt | teilweise · MKT-BD-07 | Todes-/Kontofolgen; Ausgaben manuell, Survivor-Ausnahmen benannt. |
| K-06 Datenbasis | teilweise · MKT-BD-04 | US-Modellbasis 1994–2024; Holding-Rechenkern begrenzt. |
| K-07 Stochastik | teilweise · MKT-BD-03 | Monte Carlo; eigener Seed und genaue Schockfolge unklar. |
| K-08 Transparenz | teilweise · MKT-BD-03/04/06/07 | Methodik/Annahmen beschrieben; keine vollständige Rechenspezifikation. |
| K-09 Szenarien | vorhanden · MKT-BD-05 | Bis zehn Szenarien und Gegenüberstellung. |
| K-10 Optimierung | teilweise · MKT-BD-01 | Explorer; Planübernahme angekündigt, Gebührenansicht widersprüchlich beschrieben. |
| K-11 Datenschutz | vorhanden · MKT-BD-08 | Konto-/Dienstverarbeitung und Rechte dokumentiert. |
| K-12 Offline-Fähigkeit | unklar · MKT-BD-99 | Kein heutiger Offlinevertrag gefunden. |
| K-13 Export | teilweise · MKT-BD-01/99 | Reports/Export angeboten; vollständiger Reimport offen. |
| K-14 Auditierbarkeit | teilweise · MKT-BD-03/04 | Annahmen/Ergebnisse erklärt; Seed/Versionierung offen. |
| K-15 UX | nicht geprüft · MKT-BD-99 | Kein Konto oder eigener Bedienlauf. |
| K-16 Barrierefreiheit | unklar · MKT-BD-99 | Kein belastbarer formaler Nachweis gefunden. |
| K-17 Preis | vorhanden · MKT-BD-01 | 168 USD/Jahr; Tarifwechsel bestätigt. |
| K-18 Lizenz | vorhanden · MKT-BD-09 | Proprietäre persönliche Nutzungsrechte geregelt. |

### BVI Entnahme-Rechner

Seitendatum jetzt 15.10.2026; Methoden-/Datenvertrag bestätigt, daraus kein Funktionswechsel abgeleitet.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-bvi-01"></a>MKT-BVI-01 | P1 | BVI, [Entnahme-Rechner](https://www.bvi.de/service/rechner/entnahmerechner/) | Seitendatum 15.10.2026; Abruf 2026-10-27 | DE/Deutschland | K-01/02/06–08/13/14: 100.000 historische Kombinationen, reale EUR, Aktien/Anleihen/Cash, Kosten, Steuer/Verlustübertrag, Download. | 1987–2025, globale Anleihen ab 1990; Seed offen. |
| <a id="mkt-bvi-02"></a>MKT-BVI-02 | P1 | BVI, [Datenschutz](https://www.bvi.de/datenschutz/) | 08.02.2021; Abruf 2026-10-27 | DE/Deutschland | K-11: Website-Logs, Cookies und Betroffenenrechte. | Finanzinputs nicht gesondert vollständig beschrieben. |
| <a id="mkt-bvi-99"></a>MKT-BVI-99 | I1 | Prüfpfad: Rechner, Datenschutz oben, [Rechnerübersicht](https://www.bvi.de/service/rechner/) | Recherche 27.10.2026; Abruf 2026-10-27 | DE/Deutschland | K-09/12/15–18: Rechner und Datenschutz geprüft. | Rechnerübersicht: Timeout. Tarif, Reimport, Offline, Lizenz/WCAG offen; keine Bedienausführung. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | teilweise · MKT-BVI-01 | Entnahmeportfolio, kein Vollhaushalt. |
| K-02 Steuern | teilweise · MKT-BVI-01 | Satz/Verlustübertrag, keine Gesamtsteuer. |
| K-03 Rente | nicht anwendbar · MKT-BVI-01 | Kapitalentnahme, kein Vertragsplaner. |
| K-04 Pflege | nicht anwendbar · MKT-BVI-01 | Außerhalb des Einzelrechnerzwecks. |
| K-05 Haushalt | nicht anwendbar · MKT-BVI-01 | Außerhalb des Einzelrechnerzwecks. |
| K-06 Datenbasis | vorhanden · MKT-BVI-01 | Indizes/Zeiträume/Quellen ausgewiesen. |
| K-07 Stochastik | teilweise · MKT-BVI-01 | Historische Zufallskombinationen, Wiederholungen variieren. |
| K-08 Transparenz | teilweise · MKT-BVI-01 | Methodenhinweise, nicht sämtliche Formeln. |
| K-09 Szenarien | unklar · MKT-BVI-99 | Gespeicherter Vergleich nicht belegt. |
| K-10 Optimierung | nicht anwendbar · MKT-BVI-01 | Einzelrechnung; keine Planoptimierung bewertet. |
| K-11 Datenschutz | teilweise · MKT-BVI-02 | Allgemeine Website-Erklärung. |
| K-12 Offline-Fähigkeit | unklar · MKT-BVI-99 | Kein Offlinevertrag belegt. |
| K-13 Export | teilweise · MKT-BVI-01/99 | Ergebnisdownload, Reimport offen. |
| K-14 Auditierbarkeit | teilweise · MKT-BVI-01 | Methodenbeleg, keine gleiche Zufallswiederholung. |
| K-15 UX | nicht geprüft · MKT-BVI-99 | Keine Bedienausführung. |
| K-16 Barrierefreiheit | unklar · MKT-BVI-99 | Kein belastbarer Nachweis. |
| K-17 Preis | unklar · MKT-BVI-99 | Öffentlicher Zugang, kein Tarifbeleg. |
| K-18 Lizenz | unklar · MKT-BVI-99 | Keine rechnerspezifischen Weitergaberechte belegt. |

### Finanzfluss Entnahmeplan

Öffentlicher Eingabe-/Erklärvertrag bestätigt; keine interaktive Rechnung.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-ff-01"></a>MKT-FF-01 | P2 | Finanzfluss, [Entnahmeplan](https://www.finanzfluss.de/rechner/entnahmeplan/) | undatiert; Abruf 2026-10-27 | DE/Deutschland | K-01/02/06–08/14: Drei Varianten mit konstantem Zins; abgegrenzte Felder ohne Steuer-/Marktpfadmodell. | Herstellerbeschreibung, kein Interaktionstest. |
| <a id="mkt-ff-02"></a>MKT-FF-02 | P1 | Finanzfluss, [Website-Datenschutz](https://www.finanzfluss.de/datenschutz/website/) | undatiert; Abruf 2026-10-27 | DE/EU | K-11: Anonymisierte Websiteanalyse und Verarbeitungsrechte beschrieben. | Kein vollständiger eigener Rechnerdatenfluss. |
| <a id="mkt-ff-03"></a>MKT-FF-03 | P1 | Finanzfluss, [AGB](https://www.finanzfluss.de/agb/) | undatiert; Abruf 2026-10-27 | DE/Deutschland | K-17/18: Allgemeine Dienste-/Inhaltsbedingungen. | Kein rechnerspezifischer Preis oder Weitergabevertrag. |
| <a id="mkt-ff-99"></a>MKT-FF-99 | I1 | Prüfpfad: Entnahmeplan, Datenschutz, AGB oben | undatiert; Abruf 2026-10-27 | DE/Deutschland | K-09/12/13/15–18: Rechner, Datenschutz und AGB geprüft. | Export, Offline, Szenariospeicher/WCAG offen; Bedienung nicht geprüft. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | teilweise · MKT-FF-01 | Deterministische Einzelrechnung. |
| K-02 Steuern | nicht vorhanden · MKT-FF-01 | Abgegrenzter Vertrag ohne Steuerrechnung. |
| K-03 Rente | nicht anwendbar · MKT-FF-01 | Kein Rentenvertragsplaner. |
| K-04 Pflege | nicht anwendbar · MKT-FF-01 | Außerhalb des Einzelrechnerzwecks. |
| K-05 Haushalt | nicht anwendbar · MKT-FF-01 | Außerhalb des Einzelrechnerzwecks. |
| K-06 Datenbasis | teilweise · MKT-FF-01 | Nutzerrendite, keine historische Datenreihe. |
| K-07 Stochastik | nicht vorhanden · MKT-FF-01 | Fester Zinssatz statt Marktpfaden. |
| K-08 Transparenz | teilweise · MKT-FF-01 | Eingaben und Beispiele erklärt. |
| K-09 Szenarien | unklar · MKT-FF-99 | Gespeicherter Vergleich nicht belegt. |
| K-10 Optimierung | nicht anwendbar · MKT-FF-01 | Rückwärtsrechnung, keine Planoptimierung bewertet. |
| K-11 Datenschutz | teilweise · MKT-FF-02 | Allgemeine Website-Erklärung. |
| K-12 Offline-Fähigkeit | unklar · MKT-FF-99 | Kein Offlinevertrag belegt. |
| K-13 Export | unklar · MKT-FF-99 | Rechnerspezifischer Export/Reimport offen. |
| K-14 Auditierbarkeit | teilweise · MKT-FF-01 | Beispiele nachvollziehbar, Formelvertrag begrenzt. |
| K-15 UX | nicht geprüft · MKT-FF-99 | Keine Bedienausführung. |
| K-16 Barrierefreiheit | unklar · MKT-FF-99 | Kein belastbarer Nachweis. |
| K-17 Preis | unklar · MKT-FF-03/99 | Öffentlicher Zugang, kein Tarifbeleg. |
| K-18 Lizenz | unklar · MKT-FF-03/99 | Allgemeine AGB kein Software-Weitergabevertrag. |

### Digitale Rentenübersicht

FAQ bestätigt zusätzlich aktivierbare jährliche Aktualisierung. Downloadseite mit zwei Versionsangaben; PDF-Details offen.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-dr-01"></a>MKT-DR-01 | P2 | ZfDR/DRV Bund, [Häufige Fragen](https://www.rentenuebersicht.de/DE/05_haeufig_gestellte_fragen/haeufig_gestellte_fragen_node.html) | undatiert; Abruf 2026-10-27 | DE/Deutschland | K-01–03/06/09/11–14/17: Kostenfreie Anspruchsübersicht, Inflationslabor, PDF/ZIP/CSV; jährliche Aktualisierung aktivierbar. | Keine Bedarfslücke/Nettoabzüge/Abrufhistorie; kein eID-Login. |
| <a id="mkt-dr-02"></a>MKT-DR-02 | P1 | ZfDR/DRV Bund, [Einrichtungs-FAQ](https://zfdr-vorsorgeeinrichtungen.drv-bund.de/vorsorgeeinrichtungen/FAQ/faq_node.html) | undatiert; Abruf 2026-10-27 | DE/Deutschland | K-03/06/08/14: Anbindung, Zuständigkeit und Standmitteilungen. | Schnittstellensicht, kein Portaltest. |
| <a id="mkt-dr-03"></a>MKT-DR-03 | P1 | ZfDR/DRV Bund, [Datenbeschreibung](https://www.rentenuebersicht.de/SharedDocs/Downloads/Datenbeschreibung.html) | 18.12.2025; Abruf 2026-10-27 | DE/Deutschland | K-06/08/13/14: Downloadseite: Version 10.00.00; Stand 18.12.2025, zusätzliche Angabe Version 30. | PDF nicht vollständig gelesen; Versionswiderspruch offen. |
| <a id="mkt-dr-04"></a>MKT-DR-04 | P1 | ZfDR/DRV Bund, [Barrierefreiheit](https://www.rentenuebersicht.de/DE/Service/Footer/Barrierefreiheit/barrierefreiheit_node.html) | 05.01.2026; Abruf 2026-10-27 | DE/Deutschland | K-16: BGG/BITV-/WCAG-Erklärung mit Restmängeln. | Selbstbewertung; authentifizierter Ablauf nicht geprüft. |
| <a id="mkt-dr-99"></a>MKT-DR-99 | I1 | Prüfpfad: FAQ, Datenbeschreibung, Barrierefreiheit oben | Recherche 27.10.2026; Abruf 2026-10-27 | DE/Deutschland | K-15/18: Öffentliche FAQ und Barrierefreiheit geprüft. | Kein Login; keine Softwareweitergabe untersucht. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | teilweise · MKT-DR-01 | Anspruchsübersicht, keine Haushaltsfinanzierung. |
| K-02 Steuern | nicht vorhanden · MKT-DR-01 | FAQ verneint Steuer-/Sozialabzüge. |
| K-03 Rente | teilweise · MKT-DR-01/02 | Anbieteransprüche, keine frei geplanten Nettozuflüsse. |
| K-04 Pflege | nicht anwendbar · MKT-DR-01 | Außerhalb des Informationszwecks. |
| K-05 Haushalt | teilweise · MKT-DR-01 | Ansprüche nach Versicherungs-/Vertragsbezug, kein Paarcashflow. |
| K-06 Datenbasis | teilweise · MKT-DR-01/02/03 | Standmitteilungen; prognostizierte/garantierte Werte trennen. |
| K-07 Stochastik | nicht anwendbar · MKT-DR-01 | Kein Entnahmesimulator. |
| K-08 Transparenz | teilweise · MKT-DR-01/02/03 | Wertarten/Inflationsgrenze erklärt; PDF nicht neu vollständig geprüft. |
| K-09 Szenarien | teilweise · MKT-DR-01 | Renten-Labor mit Inflationsannahme, keine Gesamtpläne. |
| K-10 Optimierung | nicht anwendbar · MKT-DR-01 | Kein Suchplaner. |
| K-11 Datenschutz | vorhanden · MKT-DR-01 | Identifikation/Verschlüsselung beschrieben; kein eigener Audit. |
| K-12 Offline-Fähigkeit | nicht vorhanden · MKT-DR-01 | Abruf verlangt Internet/Portalzugang. |
| K-13 Export | teilweise · MKT-DR-01/03 | PDF/ZIP/CSV; kein Portal-Reimport belegt. |
| K-14 Auditierbarkeit | teilweise · MKT-DR-01/02/03 | Herkunft/Standmitteilungen; keine Abrufhistorie. |
| K-15 UX | nicht geprüft · MKT-DR-99 | Kein eID-Login. |
| K-16 Barrierefreiheit | teilweise · MKT-DR-04 | Formale Erklärung mit Restmängeln. |
| K-17 Preis | vorhanden · MKT-DR-01 | Freiwillig und kostenfrei. |
| K-18 Lizenz | nicht anwendbar · MKT-DR-99 | Informationsportal, keine Softwareweitergabe untersucht. |

### MoneyGuide

Gleichnamige Stufe und Preis bestätigt; FAQ-Altname und andere Tarife bleiben getrennt.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-mg-01"></a>MKT-MG-01 | P1 | Envestnet MoneyGuide, [Products & Pricing](https://www.moneyguidepro.com/ifa/home/products), [MoneyGuide](https://www.moneyguidepro.com/ifa/Home/MoneyGuidePro) | undatiert; Abruf 2026-10-27 | EN/USA | K-01/03/04/09/10/17: MoneyGuide 2.000 USD/Berater/Jahr, Ziele, Portal, Stress und Steuerplanung. | Lokale Steuern zusätzlich; Wealth Studios/Add-ons getrennt. |
| <a id="mkt-mg-02"></a>MKT-MG-02 | P2 | MoneyGuide, [FAQ](https://www.moneyguidepro.com/ifa/home/faqs) | undatiert; Abruf 2026-10-27 | EN/USA | K-01–10/12–14: Ziele, Einkommen, Monte Carlo, Stress, What-if und Report History. | FAQ auch MoneyGuidePro; deutsche Details/Seed offen. |
| <a id="mkt-mg-03"></a>MKT-MG-03 | P1 | MoneyGuide, [Security](https://www.moneyguidepro.com/ifa/home/security) | undatiert; Abruf 2026-10-27 | EN/USA | K-11: Hosting, Verschlüsselung und Sicherungen. | Herstellerangabe; Auditbericht nicht eingesehen. |
| <a id="mkt-mg-04"></a>MKT-MG-04 | P1 | MoneyGuide, [Terms](https://www.moneyguidepro.com/ifa/license-agreements/display/MoneyGuidePro) | undatiert; Abruf 2026-10-27 | EN/USA | K-11/18: Begrenztes Berater-/Kundenabonnement. | Keine freie Weitergabelizenz. |
| <a id="mkt-mg-99"></a>MKT-MG-99 | I1 | Prüfpfad: Tarif, FAQ, Security, Terms oben; [News](https://www.moneyguidepro.com/ifa/Home/News) | Recherche 27.10.2026; Abruf 2026-10-27 | EN/USA | K-15/16: Produkt, FAQ, Security und Terms geprüft. | Kein Beraterzugang; WCAG unklar; News kein vollständiges Changelog. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-MG-01/02 | Ziele priorisieren, mehrere Zahlungs-/Vermögensarten. |
| K-02 Steuern | teilweise · MKT-MG-01/02 | US-Steuerplanung; deutscher Vertrag unklar. |
| K-03 Rente | teilweise · MKT-MG-01/02 | Social Security/weitere Einkommen, keine deutsche Anspruchsprüfung belegt. |
| K-04 Pflege | teilweise · MKT-MG-01/02 | Health-Care/LTC-Beschreibung, deutsche Pflegegrade/Reserve offen. |
| K-05 Haushalt | teilweise · MKT-MG-02 | Eigentum und Todesstress; genaue deutsche Folgen offen. |
| K-06 Datenbasis | teilweise · MKT-MG-02 | Historische/projizierte Raten konfigurierbar; aktueller Vollbestand offen. |
| K-07 Stochastik | teilweise · MKT-MG-01/02 | Monte Carlo und Stress; Seeddetails offen. |
| K-08 Transparenz | teilweise · MKT-MG-02 | FAQ zu Methode/Defaults; kein vollständiger Formelvertrag. |
| K-09 Szenarien | vorhanden · MKT-MG-01/02 | Planvarianten, What-if und gemeinsamer Arbeitsweg. |
| K-10 Optimierung | teilweise · MKT-MG-01 | Social-Security-/Steuerfunktionen; Suchgrenzen öffentlich begrenzt. |
| K-11 Datenschutz | vorhanden · MKT-MG-03/04 | Speicherung/Schutz/Rechte dokumentiert, kein eigener Audit. |
| K-12 Offline-Fähigkeit | unklar · MKT-MG-02/99 | Webbetrieb belegt, vollständiger Offlinevertrag offen. |
| K-13 Export | teilweise · MKT-MG-01/02 | Reports/Report History; vollständige portable Sicherung offen. |
| K-14 Auditierbarkeit | teilweise · MKT-MG-02 | Berichte und konfigurierbare Raten; Seed-/Versionsreproduktion offen. |
| K-15 UX | nicht geprüft · MKT-MG-99 | Kein Beraterzugang. |
| K-16 Barrierefreiheit | unklar · MKT-MG-99 | Kein belastbarer Nachweis. |
| K-17 Preis | vorhanden · MKT-MG-01 | 2.000 USD/Berater/Jahr; lokale Steuern zusätzlich. |
| K-18 Lizenz | vorhanden · MKT-MG-04 | Beraterabonnement, beschränkte Nutzungsrechte. |

### eMoney Pro

Heutige Pro-Seite bestätigt Planvergleich/CoPlanner; historisches PDF ersetzt keine aktuelle stufenscharfe Simulationserhebung.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-em-01"></a>MKT-EM-01 | P2 | eMoney Advisor, [Pro](https://emoneyadvisor.com/products/emoney-pro/), [CoPlanner](https://emoneyadvisor.com/why-emoney/coplanner/) | undatiert; Abruf 2026-10-27 | EN/USA | K-01/05/09/10: Pro-Cashflow, Portal, Decision Center, Plan Comparisons und CoPlanner. | Renten-/Pflege-/Seed-Details öffentlich nicht vollständig. |
| <a id="mkt-em-02"></a>MKT-EM-02 | P2 | eMoney Advisor, [FAQ](https://emoneyadvisor.com/faq/) | FAQ undatiert; Abruf 2026-10-27 | EN/USA | K-02/11/17: Plattform-FAQ nennt Steueroptionen und Preis auf Anfrage. | Plattformangaben nicht immer Pro-scharf; Premium Client Portal getrennt. |
| <a id="mkt-em-03"></a>MKT-EM-03 | P1 | eMoney Advisor, [Security](https://emoneyadvisor.com/security/) | undatiert; Abruf 2026-10-27 | EN/USA | K-11: TLS und jährliche Drittprüfungen einschließlich SOC 2 beschrieben. | Auditbericht nicht eingesehen. |
| <a id="mkt-em-04"></a>MKT-EM-04 | P4 | eMoney Advisor, [Product Comparison PDF](https://emoneyadvisor.com/wp-content/uploads/2021/01/eMoney-Solutions-to-Grow-and-Scale-Your-Business-Product-Comparison.pdf) | PDF-Pfad 2021-01; historisch; Abruf 2026-10-27 | EN/USA | Historischer Pro-/Premier-Vergleich: Advanced Planning, Monte Carlo und Reports. | PDF 2021 erreichbar; kein heutiger Pro-Detailnachweis. |
| <a id="mkt-em-99"></a>MKT-EM-99 | I1 | Prüfpfad: Pro, FAQ, Security oben, [Planning](https://emoneyadvisor.com/why-emoney/planning/), [News](https://emoneyadvisor.com/resources/news/) | Recherche 27.10.2026; Abruf 2026-10-27 | EN/USA | K-03/04/06–08/12–16/18: Aktuelle Produktseiten/FAQ geprüft. | Pro-Details, Offline, Lizenz/WCAG offen; kein Beraterzugang. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-EM-01 | Pro-Seite belegt Cashflowplanung. |
| K-02 Steuern | teilweise · MKT-EM-02/99 | Plattform-FAQ: US/Flat Tax; heutiger deutscher Pro-Vertrag unklar. |
| K-03 Rente | unklar · MKT-EM-04/99 | Pro-Personen-/Rentenparameter nicht neu belegt. |
| K-04 Pflege | unklar · MKT-EM-99 | Aktueller Pro-Pflegevertrag nicht belegt. |
| K-05 Haushalt | teilweise · MKT-EM-01/02 | Kunden-/Beraterplan und Portal, genaue Todesfolgen offen. |
| K-06 Datenbasis | unklar · MKT-EM-99 | Stufenscharfe Daten/Zeiträume offen. |
| K-07 Stochastik | nicht geprüft · MKT-EM-04/99 | Nur historisches Pro-PDF; heutiger Kern/Seed nicht verifiziert. |
| K-08 Transparenz | teilweise · MKT-EM-01/02/99 | Aufgaben/Steueroptionen erklärt; Formeln offen. |
| K-09 Szenarien | vorhanden · MKT-EM-01 | Decision Center und Plan Comparisons aktuell Pro zugeordnet. |
| K-10 Optimierung | teilweise · MKT-EM-01 | CoPlanner-Vorschläge; Suchraum/Constraints offen. |
| K-11 Datenschutz | vorhanden · MKT-EM-03 | Sicherheitsprogramm dokumentiert; Auditbericht nicht eingesehen. |
| K-12 Offline-Fähigkeit | unklar · MKT-EM-99 | Heutiger Pro-Offlinevertrag offen. |
| K-13 Export | nicht geprüft · MKT-EM-04/99 | Historische Reports; heutiger Pro-Export/Reimport nicht verifiziert. |
| K-14 Auditierbarkeit | unklar · MKT-EM-04/99 | Daten-/Seed-/Formelreproduktion offen. |
| K-15 UX | nicht geprüft · MKT-EM-99 | Kein Beraterzugang. |
| K-16 Barrierefreiheit | unklar · MKT-EM-99 | Kein belastbarer Nachweis. |
| K-17 Preis | teilweise · MKT-EM-01/02 | Pro angeboten, Preis auf Anfrage; kein Betrag ergänzt. |
| K-18 Lizenz | unklar · MKT-EM-99 | Pro-Nutzungsrechte öffentlich nicht vollständig geprüft. |

### FI Calc

Privacy nennt jetzt ausdrücklich Kontospeicherung; Terms vom 05.10.2026. URL-Beta und Konto sind unterschiedliche Belege.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-fi-01"></a>MKT-FI-01 | P1 | FI Calc, [Introduction](https://ficalc.app/docs), [Rechner](https://ficalc.app/) | undatiert; Abruf 2026-10-27 | EN/USA | K-01/07: Historische Entnahmeregeln, Portfolio, Zuflüsse und Zusatzausgaben. | Keine eigene Rechnung ausgeführt. |
| <a id="mkt-fi-02"></a>MKT-FI-02 | P1 | FI Calc, [Historical Data](https://ficalc.app/docs/how-it-works/historical-data-source/) | undatiert; Abruf 2026-10-27 | EN/USA | K-06–08/14: Shiller ab 1871, US-Aktien/Treasuries/VPI; Cash mit fester Nutzerrate. | Aktuelles Datenendjahr offen; keine EUR-Reihe. |
| <a id="mkt-fi-03"></a>MKT-FI-03 | P1 | FI Calc, [One Simulation Year](https://ficalc.app/docs/how-it-works/one-simulation-year/) | undatiert; Abruf 2026-10-27 | EN/USA | K-01/08/14: Erst Jahresentnahme, dann Ertrag/Gebühren, zuletzt Rebalancing. | Reihenfolge nicht wählbar; keine Steuerrechnung. |
| <a id="mkt-fi-04"></a>MKT-FI-04 | P1 | FI Calc, [Withdrawal Strategies](https://ficalc.app/docs/withdrawal-strategies/); ergänzt [What’s New](https://ficalc.app/docs/other/whats-new/) | Changelog 26.08.2023; Abruf 2026-10-27 | EN/USA | K-07/08/10/16: Regelkatalog; Changelog nennt Farb-/Bewegungsoptionen. | Auswahlhilfe keine Optimierung/WCAG-Konformität. |
| <a id="mkt-fi-05"></a>MKT-FI-05 | P1 | FI Calc, [FAQ](https://ficalc.app/docs/other/faq/) | undatiert; Abruf 2026-10-27 | EN/USA | K-02/17: Kostenfrei, Spenden; Steuern selbst in Entnahme einrechnen. | Historischer Kern; keine heutige MC-Negativaussage. |
| <a id="mkt-fi-06"></a>MKT-FI-06 | P1 | FI Calc, [Privacy](https://ficalc.app/privacy); historisch [Guide](https://guide.ficalc.app/privacy/) | undatiert; Abruf 2026-10-27 | EN/international | K-11: Browserrechnung; Konto speichert Rechnungen; URLs können Inputs an Hosting/Analytics geben. | Alte Guide-Privacy nicht als heutiger Gesamtvertrag verwenden. |
| <a id="mkt-fi-07"></a>MKT-FI-07 | P1 | FI Calc, [Exporting Results](https://ficalc.app/docs/usage-guides/exporting-results/); ergänzt [Saving Calculations](https://ficalc.app/docs/usage-guides/saving-calculations/) | undatiert; URL-Beta; Abruf 2026-10-27 | EN/international | K-09/13: CSV für einzelne/alle Simulationen; Speichern per URL/Lesezeichen als Beta. | Konto-Speicherung in Privacy, Reimport-/Versionsvertrag offen. |
| <a id="mkt-fi-08"></a>MKT-FI-08 | P1 | FI Calc, [Income](https://ficalc.app/docs/configuration/income/) | undatiert; Abruf 2026-10-27 | EN/USA | K-03/05: Jährliche Zuflüsse mit Beginn/Dauer/Inflationsoption. | Kein nativer deutscher Personenanspruch. |
| <a id="mkt-fi-09"></a>MKT-FI-09 | P1 | FI Calc, [Extra Withdrawals](https://ficalc.app/docs/configuration/extra-withdrawals) | undatiert; Abruf 2026-10-27 | EN/USA | K-04/05: Zusätzliche Jahresausgaben mit Beginn/Dauer/Inflation. | Kein Pflegegrad-/Reservevertrag. |
| <a id="mkt-fi-99"></a>MKT-FI-99 | I1 | Prüfpfad: Docs, Changelog, aktuelle Privacy oben und [Terms](https://ficalc.app/terms) | Terms 05.10.2026; Abruf 2026-10-27 | EN/international | K-12/15/16/18: Terms 05.10.2026: persönlich/nicht kommerziell, Weitergabe eingeschränkt. | Offline/WCAG offen; kein Bedienlauf. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | teilweise · MKT-FI-01/03 | Jahresportfolio/Entnahme, enger historischer Zweck. |
| K-02 Steuern | nicht vorhanden · MKT-FI-05 | FAQ: Steuer selbst in Entnahme einrechnen. |
| K-03 Rente | teilweise · MKT-FI-08 | Allgemeine jährliche Einkommen; keine Personenansprüche. |
| K-04 Pflege | teilweise · MKT-FI-09 | Allgemeine Zusatzausgabe; Reserve/Grad nicht belegt. |
| K-05 Haushalt | teilweise · MKT-FI-08/09 | Zahlungsänderungen; native Eigentümer-/Todeslogik unklar. |
| K-06 Datenbasis | teilweise · MKT-FI-02 | US-Quellen/Transformationen belegt, aktuelles Endjahr offen. |
| K-07 Stochastik | teilweise · MKT-FI-01/02/05 | Historische Läufe; keine explizite MC-Negativaussage übernommen. |
| K-08 Transparenz | vorhanden · MKT-FI-02/03/04/05 | Regeln/Ablauf/Annahmen öffentlich beschrieben. |
| K-09 Szenarien | teilweise · MKT-FI-07 | URL-Beta; Kontospeicherung laut Privacy, Vergleich offen. |
| K-10 Optimierung | nicht anwendbar · MKT-FI-04 | Regelwahl/Fragebogen; keine Suchoptimierung bewertet. |
| K-11 Datenschutz | teilweise · MKT-FI-06 | Browserrechnung, Kontospeicherung und URL-Inputs bei Diensten. |
| K-12 Offline-Fähigkeit | unklar · MKT-FI-04/99 | Installierbarkeit kein belegter Offlinevertrag. |
| K-13 Export | teilweise · MKT-FI-07 | CSV und URL; vollständiger Versions-/Reimportvertrag offen. |
| K-14 Auditierbarkeit | teilweise · MKT-FI-02/03/07 | Offene Jahresmethodik/CSV; heutiger Datenstand nicht vollständig verifiziert. |
| K-15 UX | nicht geprüft · MKT-FI-99 | Kein eigener Bedienlauf. |
| K-16 Barrierefreiheit | teilweise · MKT-FI-04/99 | Bewegung/Farboptionen beschrieben; kein formaler Nachweis. |
| K-17 Preis | vorhanden · MKT-FI-05 | Kostenfrei, Spenden. |
| K-18 Lizenz | vorhanden · MKT-FI-99 | Terms: persönlich/nicht kommerziell; Kopieren/Verbreiten eingeschränkt. |

### FIRECalc

Version/Datenstand bestätigt; Notes zeigen weiterhin nur bis 2024, keine vollständige Änderungschronik.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-fc-01"></a>MKT-FC-01 | P1 | FIRECalc 3.0, [Rechner](https://firecalc.com/); ergänzt [Methodik und FAQ](https://firecalc.com/intro.php) | Daten 01.01.2026; Update 17.04.2026; Abruf 2026-10-27 | EN/USA | K-01–08/10/13/14/17: FIRECalc 3.0, Historie ab 1871, allgemeine Zahlungen, Zielsuche. | Keine Steuerplanung; Spreadsheet nur 30 Jahre; Seed offen. |
| <a id="mkt-fc-02"></a>MKT-FC-02 | P1 | FIRECalc, [Privacy](https://www.firecalc.com/privacy.php) | undatiert; Abruf 2026-10-27 | EN/USA | K-11: Finanzinputs laut Anbieter nicht dauerhaft; Server-Sessiondateien etwa 15 Minuten, Besuchslogs. | Serververarbeitung; kein Offlinebeleg. |
| <a id="mkt-fc-99"></a>MKT-FC-99 | I1 | Prüfpfad: Rechner/FAQ und Privacy oben; [Change Notes](https://firecalc.com/notes.php), [Supporters](https://firecalc.com/supporters.php) | Notes bis 03.04.2024; Abruf 2026-10-27 | EN/USA | K-09/12/15–18: Rechner/FAQ/Notes/Supporters geprüft. | Unterstützerpreis, Offline, WCAG und Weitergabe offen; keine Ausführung. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | teilweise · MKT-FC-01 | Historischer Entnahmefall. |
| K-02 Steuern | nicht vorhanden · MKT-FC-01 | Offizielle FAQ lässt Steuerplanung ausdrücklich aus. |
| K-03 Rente | teilweise · MKT-FC-01 | Allgemeine Zuflüsse, keine deutschen Ansprüche. |
| K-04 Pflege | teilweise · MKT-FC-01 | Kostenänderung, kein Pflegegradbeleg. |
| K-05 Haushalt | teilweise · MKT-FC-01 | Zahlungsänderungen, Personenvertrag offen. |
| K-06 Datenbasis | vorhanden · MKT-FC-01 | Startjahre/Datenstand ausgewiesen. |
| K-07 Stochastik | teilweise · MKT-FC-01 | Historisch/Zufall, Seed unklar. |
| K-08 Transparenz | teilweise · MKT-FC-01 | Methoden-/Eingabehinweise. |
| K-09 Szenarien | unklar · MKT-FC-99 | Gespeicherter Gesamtplanvergleich offen. |
| K-10 Optimierung | teilweise · MKT-FC-01 | Zielsuche, Grenzen öffentlich begrenzt. |
| K-11 Datenschutz | vorhanden · MKT-FC-02 | Server-/Sessionverarbeitung dokumentiert. |
| K-12 Offline-Fähigkeit | unklar · MKT-FC-99 | Kein belastbarer Offlinevertrag. |
| K-13 Export | teilweise · MKT-FC-01 | Spreadsheet für 30 Jahre, kein Vollbackup. |
| K-14 Auditierbarkeit | teilweise · MKT-FC-01 | Tabellen/Formeln, Wiederholung begrenzt. |
| K-15 UX | nicht geprüft · MKT-FC-99 | Keine Bedienausführung. |
| K-16 Barrierefreiheit | unklar · MKT-FC-99 | Kein belastbarer Nachweis. |
| K-17 Preis | teilweise · MKT-FC-01/99 | Rechner öffentlich, Unterstützerbetrag offen. |
| K-18 Lizenz | unklar · MKT-FC-01/99 | Copyright kein Weitergabevertrag. |

### Pralana Gold

Sonderprüfung zum 20.10. nachgeholt: Abo/Startgebühr bestätigt; §-7.1-Widerspruch bleibt offen. Changelog belegt Oktobererweiterungen nicht.

| Quellen-ID | Klasse | Betreiber, Stufe und Quelle | Veröffentlichung und Abruf | Region/Sprache | Aussage und Kriterien | Grenze |
| --- | --- | --- | --- | --- | --- | --- |
| <a id="mkt-pr-01"></a>MKT-PR-01 | P2 | Pralana Gold, [Gold Highlights](https://pralanaretirementcalculator.com/pralana-gold-highlights/); ergänzt [Herstellerankündigung](https://pralanaretirementcalculator.com/community/general-2-announcements/pralana-gold-is-now-being-sold-as-an-annual-subscription/) | Adminbeitrag 01.10.2026; Abruf 2026-10-27 | EN/USA/Excel | K-01/05/11–13: Gold bleibt lokale Excel-Datei; bestehende Dateien laufen weiter, neue Downloads mit Abo. | Herstellerankündigung; keine Arbeitsmappe ausgeführt. |
| <a id="mkt-pr-02"></a>MKT-PR-02 | P1 | Pralana Gold Subscription, [Produkt/Preis](https://pralanaretirementcalculator.com/product/pralana-gold-subscription/); vorher [Get PRC](https://pralanaretirementcalculator.com/get-prc/) | seit 01.10.2026; Abruf 2026-10-27 | EN/USA/USD | K-17: 99 USD/Jahr + 30 USD Startgebühr; Updates während Abo. | Excel separat; kein uneingeschränktes Dauerrecht abgeleitet. |
| <a id="mkt-pr-03"></a>MKT-PR-03 | P2 | Pralana, [Accounts & Portfolios](https://pralanaretirementcalculator.com/accounts-portfolios/), Gold Highlights in PR-01 | undatiert; Abruf 2026-10-27 | EN/USA | K-01/02/05: Eigene Assetklassen, US-Steuerkonten, Allokation und Eigentum. | Gold/Online gemeinsam beschrieben; deutsche Steuerlogik offen. |
| <a id="mkt-pr-04"></a>MKT-PR-04 | P2 | Pralana, [Analysis & Optimization](https://pralanaretirementcalculator.com/analysis-optimization/); ergänzt [Gold Changes](https://pralanaretirementcalculator.com/gold-changes/) | Changes 17.09.2026; Abruf 2026-10-27 | EN/USA | K-06–10/14: Historisch, Monte Carlo, drei Szenarien und Suchfunktionen. | Changelog endet 17.09.2026; Oktober-Auslieferung/Seed nicht geprüft. |
| <a id="mkt-pr-05"></a>MKT-PR-05 | P2 | Pralana, [Income & Expenses](https://pralanaretirementcalculator.com/income-expenses/) | undatiert; Abruf 2026-10-27 | EN/USA | K-03–05: Partner-Einkommen, Survivor-Optionen, Immobilien und Einmalzahlungen. | US-Kontext; kein deutscher Pflegegrad-/Reservevertrag. |
| <a id="mkt-pr-06"></a>MKT-PR-06 | P1 | Pralana, [Manuals](https://pralanaretirementcalculator.com/manuals/), [2026 Gold User Manual](https://pralanaretirementcalculator.com/product/pralana-2026-gold-user-manual/) | Handbuchangebot 2026; Abruf 2026-10-27 | EN/USA/Excel | K-08/13/14: Öffentliches Angebot des Gold-Handbuchs 2026. | PDF nicht vollständig erneut gelesen; Workbook nicht gekauft. |
| <a id="mkt-pr-07"></a>MKT-PR-07 | P1 | Pralana, [Terms](https://pralanaretirementcalculator.com/terms/); PR-01/02 zum heutigen Abo | Terms 16.05.2025; Abruf 2026-10-27 | EN/USA | K-17/18: Proprietäre Lizenz; § 7.1 nennt Einmalgebühr, Produktseite ein Abo. | Widerspruch nach Sonderprüfung weiter offen. |
| <a id="mkt-pr-99"></a>MKT-PR-99 | I1 | Prüfpfad: Gold Highlights, Preis, Herstellerankündigung, Gold Changes, Manuals, Terms oben | Recherche 27.10.2026; Abruf 2026-10-27 | EN/USA/Excel | K-15/16: Highlights, Preis, Herstellerbeitrag, Changes, Manuals und Terms geprüft. | Workbook, Oktobererweiterungen und WCAG nicht geprüft. |

| ID | Status und Belege | Befund und Grenze |
| --- | --- | --- |
| K-01 Fachmodell | vorhanden · MKT-PR-01/03/05 | Lokales Cashflow-/Vermögensmodell; keine Ausführung. |
| K-02 Steuern | teilweise · MKT-PR-03/05/07 | US-Steuerkonten/-Annahmen, deutscher Vertrag unklar. |
| K-03 Rente | teilweise · MKT-PR-05 | Personen/Pensionen/Survivor, deutsche Fachlichkeit offen. |
| K-04 Pflege | teilweise · MKT-PR-05/99 | Gesundheits-/Zusatzkosten; deutsche Grade/Reserve offen. |
| K-05 Haushalt | teilweise · MKT-PR-01/05 | Partner/Eigentum/Todesfolgen, deutsche Details offen. |
| K-06 Datenbasis | teilweise · MKT-PR-04/06 | Historische Verfahren; Datei/Daten nicht vollständig geprüft. |
| K-07 Stochastik | teilweise · MKT-PR-01/04 | MC/historisch beschrieben; Oktober-Bootstrap-Auslieferung/Seed offen. |
| K-08 Transparenz | teilweise · MKT-PR-04/06 | Beschreibungen/Handbuchangebot; PDF nicht vollständig neu gelesen. |
| K-09 Szenarien | vorhanden · MKT-PR-04 | Drei Szenarien/Compare beschrieben. |
| K-10 Optimierung | vorhanden · MKT-PR-01/04 | Entnahmereihenfolge/Roth/Startalter und Suchziele dokumentiert. |
| K-11 Datenschutz | teilweise · MKT-PR-01/07 | Lokale Datei; Website/Konto und genaue Netzreste nicht getestet. |
| K-12 Offline-Fähigkeit | teilweise · MKT-PR-01/99 | Lokale Excel-Datei läuft weiter; Download/Updates online, kein eigener Offline-Test. |
| K-13 Export | teilweise · MKT-PR-01/06 | Export/Import für Versions-/Rechnerwechsel; Formate nicht ausgeführt. |
| K-14 Auditierbarkeit | teilweise · MKT-PR-04/06 | Jahresprojektionen; Workbook/Versionsreproduktion nicht getestet. |
| K-15 UX | nicht geprüft · MKT-PR-99 | Kein Workbook gekauft oder benutzt. |
| K-16 Barrierefreiheit | unklar · MKT-PR-99 | Kein belastbarer Gold-Nachweis. |
| K-17 Preis | vorhanden · MKT-PR-02 | 99 USD/Jahr + 30 USD Start; lokale Stufe verfügbar. |
| K-18 Lizenz | teilweise · MKT-PR-07 | Proprietäre Rechte belegt; Einmal-/Abovertrag widersprüchlich. |

## Zuordnung und Grenzen

### Haushaltsabbildung

Dokumentationsabgleich vom 27.10.2026; keine gemeinsame Ausführung aller RH-Eingaben. Zuordnungen sind Inferenzen aus dokumentierten Eingaben. Allgemeine Zahlungen belegen keine native deutsche Personen-/Pflege-/Steuerfachlichkeit. Kein Basisfall ist vollständig nativ nachgewiesen.

| Stufe | RH-01 Basisfall und nicht passende Inputs | RH-02 genaue Schockfolge | RH-03 Pflege mit Reserve | RH-04 Tod und Hinterbliebene | Tragende Belege |
| --- | --- | --- | --- | --- | --- |
| Vermögen & Ruhestand | Bedarf, Renten, freie Einkünfte, Einmalzahlungen, geplante Ausgaben und Immobilie vorhanden; Anleihen/Kosten nur vereinfacht | Grobe Näherung mit Daten-/Stresspfaden; kein allgemeiner frei datierter Pfadeditor | Grade und gesperrter Bucket nativ; Eintritt stochastisch, nicht fix 2044 | Modellpfad mit Folgerente; fester Tod 2048/volle Anspruchsregel nicht als Eingabe belegt | MKT-RS-01/02/03; [Fachmodell](FACHKONZEPT.md#modell), [Kosten](HANDLUNGSANWEISUNG.md#reale-ausführung), [Ereignisse](TOD_UND_ERBE.md#nach-dem-tod) |
| ProjectionLab Premium | Dokumentierte zeitliche Einkommen/Ausgaben/Anlagen; Kostenbasis, Goldanlage und genaue deutsche Besteuerung/Reservebindung zusammen nicht geprüft | Eigene Rendite-/Inflationsfolgen dokumentiert; genaue Probe nicht ausgeführt | Allgemeiner Kostenweg; Pflegegrad/Reservefreigabe offen | Todesmeilenstein beschrieben; deutsche Folgerente/Bedarfsänderung über besondere Zuordnung, nicht ausgeführt | MKT-PL-02/03/04/05/06 |
| Boldin PlannerPlus | Zahlungsplanung mit Ausweichwegen; keine native Auslandssteuer, deutsche Lots/Gold-/Reservevertrag nicht belegt | Annahmen/Monte Carlo belegt, genaue Zweijahresfolge offen | US-LTC oder Kostenänderung; deutsche Probe offen | Todesfall/US-Survivor; deutsche Folge-/Bedarfsregeln nicht unverändert belegt | MKT-BD-02/03/04/05/06/07 |
| BVI | Kapital/Verteilung/Auszahlung grob zuordnen; übrige Haushaltseingaben außerhalb Zweck | Zufallshistorie keine genaue Vorgabe | Außerhalb Zweck | Außerhalb Zweck | MKT-BVI-01 |
| Finanzfluss | Startkapital/konstante Auszahlung grob zuordnen; restlicher Haushalt außerhalb Zweck | Fester Zinssatz, keine wechselnde Folge | Außerhalb Zweck | Außerhalb Zweck | MKT-FF-01 |
| Digitale Rentenübersicht | Renteninformationen von Einrichtungen; synthetischer Haushalt im Portal nicht angelegt | Außerhalb Zweck | Außerhalb Zweck | Außerhalb Zweck | MKT-DR-01/02/99 |
| MoneyGuide | Dokumentierte Ziele/Zuflüsse/Vermögen; US-Mapping, genaue deutsche Basis nicht ausgeführt | Stress belegt, genaue Folge offen | LTC-Ziele belegt, deutsche Grad-/Reserveprobe offen | Vorzeitiger-Tod-Stress, genaue deutsche Folge offen | MKT-MG-01/02/99 |
| eMoney Pro | Cashflowzweck belegt; heutiger Detailvertrag/geschlossene Instanz nicht geprüft | Nicht geprüft | Nicht geprüft | Nicht geprüft | MKT-EM-01/04/99 |
| FI Calc | Jährliche Zuflüsse/Zusatzausgaben; Portfolio vereinfacht; EUR/Steuern/Gold/Reserve nicht gleichartig abgebildet | US-Historie; genaue Folge nicht belegt | Zahlungsweg; keine Grad-/Reservefachlichkeit belegt | Getrennte Zahlungsänderungen als Umweg; kein nativer Personenvertrag belegt | MKT-FI-02/05/08/09 |
| FIRECalc | Allgemeine Zahlungs-/Portfolioänderungen; restlicher deutscher Vertrag nicht belegt | Historie/Zufall keine genaue Zweijahresprobe | Kostenänderung als Umweg; Reservevertrag offen | Zahlungsänderungen als Umweg, genaue Probe nicht ausgeführt | MKT-FC-01/99 |
| Pralana Gold | Partnerströme/Immobilien/Einmalzahlungen dokumentiert; US-Steuern, exakte Gold-/Reservekonfiguration ohne Workbook offen | Historische Sequenzwahl, eigene exakte Folge nicht geprüft | Allgemeine Kostenphasen, deutsche Reserveprobe offen | Survivor-/Partneroptionen, deutscher Vertrag nicht ausgeführt | MKT-PR-01/03/04/05/06/99 |

### Eigene Grenzen

| ID | Heutiger Befund | Beleg und Folge |
| --- | --- | --- |
| GAP-MKT-01 | Keine vollständige Einkommensteuer-/Sozialabgabenrechnung; Kapitalertragsteuer und Kirchensteuer vereinfacht. | MKT-RS-02, [Steuern](STEUERN.md#kapitalanlagen); keine volle deutsche Steuerplanung behaupten. |
| GAP-MKT-02 | teilweise geschlossen: versionierte Einkünfte, Einmalzahlungen und geplante Ausgaben vorhanden; frei datierte Markt-/Inflationsfolge weiter offen. | MKT-RS-01/02; [Einkünfte](../../app/profile/profile-income.js), [Ausgaben](../../app/profile/household-planned-expenses.js); RH-01/02 nicht vollständig ausgeführt. |
| GAP-MKT-03 | Kein frei datierter Pflegeeintritt mit Person/Grad als deterministische Oberflächenprobe. | MKT-RS-02, [mc-life-events.js](../../app/simulator/mc-life-events.js), [Pflege](PFLEGE.md); Pflegeanalyse nicht als exakter Eintrittsplan beschreiben. |
| GAP-MKT-04 | Kein freies Speichern/Kopieren/Vergleichen ganzer Planszenarien wie in Privatplanern. | MKT-RS-01/02, [Varianten](SIMULATION_LESEN.md#varianten); Jahresbeleg/Sweep nicht damit gleichsetzen. |
| GAP-MKT-05 | Formale Usability-/WCAG-/Screenreader-Prüfung nicht belegt. | MKT-RS-99; einzelne Hilfen kein Konformitätsnachweis. |
| GAP-MKT-06 | geschlossen am 2026-07-17: Projektlizenz in Lizenztext, npm- und Cargo-Metadaten einheitlich MIT; am aktuellen Codebestand erneut bestätigt. | MKT-RS-04/05; Root-Projektmetadaten bleiben gegen Lizenztext geprüft, Abhängigkeits-/Datenrechte getrennt. |
| GAP-MKT-07 | Kein automatischer persönlicher Rentenanspruchsabruf oder Bank-/Depotaggregation. | MKT-RS-01/02, [Rente](TOD_UND_ERBE.md#einkommen-und-bedarf), [Pflege der Eingaben](../../app/profile/profile-person-data.js); Eingabepflege bleibt Nutzeraufgabe. |
| GAP-MKT-08 | Externe Prognose-/Kalibrierungs-/Entscheidungsvalidierung nicht belegt. | MKT-RS-02/99, [Validierungsstufen](TECHNICAL.md#fehlertypen-und-offene-grenzen); Tests/Transparenz kein Wirkungsbeleg. |

Weitere Grenzen: individuelle Lebensereignisse höchstens zwei Personen, EUR ohne eigenes FX-/Hedgingmodell, Immobilien ohne Beleihungsmodell, Anleihen ohne Kupon/Duration, keine vollständigen TER-/Spread-/Slippage-Cashflows. Mindest-Flex ist nicht garantiert. Verlaufslücken und Tagesgeldübertragungen begrenzen eine Renditedeutung. MKT-RS-01/02/03 tragen diese Grenzen.

## Pflege

### Aktualität und Fälligkeitsvertrag

Letzte Prüfung bezeichnet den Quellenabgleich einschließlich offener Abrufe, keinen Produkttest. Am Abschlusstag wurden Stufe/Preis/Verfügbarkeit geprüft. Vollerhebung höchstens 14 Tage; spätestens quartalsweise wiederholen, bei Stufen-/Tarif-/Modelländerung früher.

| Record-Scope | Reviewklasse | Letzte Prüfung | Nächste Prüfung | Prüfquelle | Ergebnis/Änderungsnotiz |
| --- | --- | --- | --- | --- | --- |
| MKT-RS | Repository/bei Änderung, spätestens quartalsweise | 2026-10-27 | 2027-01-27 | [Vermögen und Ruhestand](#vermögen-und-ruhestand) | Aussagen und Grenzen abgeglichen |
| MKT-PL | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [ProjectionLab Premium](#projectionlab-premium) | Aussagen und Grenzen abgeglichen |
| MKT-BD | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2026-11-03 | [Boldin PlannerPlus](#boldin-plannerplus) | Widerspruch erneut nachsehen |
| MKT-BVI | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [BVI Entnahme-Rechner](#bvi-entnahme-rechner) | Aussagen und Grenzen abgeglichen |
| MKT-FF | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [Finanzfluss Entnahmeplan](#finanzfluss-entnahmeplan) | Aussagen und Grenzen abgeglichen |
| MKT-DR | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [Digitale Rentenübersicht](#digitale-rentenübersicht) | Aussagen und Grenzen abgeglichen |
| MKT-MG | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [MoneyGuide](#moneyguide) | Aussagen und Grenzen abgeglichen |
| MKT-EM | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [eMoney Pro](#emoney-pro) | Aussagen und Grenzen abgeglichen |
| MKT-FI | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [FI Calc](#fi-calc) | Aussagen und Grenzen abgeglichen |
| MKT-FC | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2027-01-27 | [FIRECalc](#firecalc) | Aussagen und Grenzen abgeglichen |
| MKT-PR | Stufe/Preis/Methodik, quartalsweise | 2026-10-27 | 2026-11-03 | [Pralana Gold](#pralana-gold) | Widerspruch erneut nachsehen |

### Pflege und Änderungsvertrag

Quellen, Haupttext, Kriterien und RH-Zuordnung gemeinsam aktualisieren. Unerreichbare Quellen bleiben historisch oder nicht geprüft; ohne Ersatzbeleg wird die heutige Aussage offen. Ereignis-/Steuer-/Pflege-/Haushalts-/Szenarioänderungen verlangen erneut RH-01 bis RH-04 und Positionierungsprüfung. Ein Ersatz braucht gleichen Bereich und Aufnahmegrund; mehr als zwei oder ein verlorener Bereich verlangen neue Stichprobenentscheidung.

`npm run docs:evidence` kontrolliert IDs, Tabellen, lokale Links und Fristen ohne Netz. Es bestätigt keine Livepreise, Bedienung oder Prognosegüte.
