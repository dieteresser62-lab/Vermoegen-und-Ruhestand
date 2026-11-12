# Wissenschaftlicher Rahmen von Vermögen & Ruhestand

<a id="forschungsrahmen"></a>

Diese Seite erklärt die wissenschaftliche Tragweite der Methoden für fachlich Interessierte. Literatur- und Codeabgleich: 27.10.2026. Das [Forschungsregister](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md) belegt 55 Quellen und 17 Mechanismen samt Zugriffsgrenzen.

## Auf einen Blick

- Die App untersucht, wie ein Haushalt unter festgelegten Annahmen zurechtkommt.
- Etablierte Methoden begründen einzelne Bausteine, keine Freigabe ihrer Kombination.
- Mehr Simulationsläufe verringern Zufallsschwankungen der Modellrechnung; ungeeignete Daten oder Regeln bleiben ungeeignet.
- Die interne Pflegeabstimmung auf Destatis 2023 ersetzt keine unabhängige Validierung.

<a id="worauf-die-rechnung-beruht"></a>

## Entnahme und Lebenszyklus

### Feste und flexible Entnahme

Bengen untersucht Entnahmen mit erhaltener Kaufkraft anhand historischer US-Marktdaten. Guyton und Klinger untersuchen regelgebundene Anpassungen. Beide Forschungsrichtungen hängen von Portfolio, Kosten, Zeithorizont und Erfolgsbegriff ab. Die App verbindet sie mit eigenen Haushalts-, Steuer- und Liquiditätsregeln. Ihre Quoten ergeben deshalb keine allgemeingültige sichere Entnahmerate. [Entnahmeursprung und Unterschiede](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-01), [Guardrails](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-03).

Lebenszyklusforschung betrachtet Konsum, Vermögen und unsichere Lebensdauer gemeinsam. Blanchett unterscheidet Bedürfnisse und Wünsche; Waring und Siegel schlagen eine jährlich erneuerte virtuelle Annuität vor. Diese Ansätze begründen, warum flexible Entnahmen neben festen Bedarfen untersucht werden. Die App übernimmt weder deren Nutzenfunktion noch einen versicherten Zahlungsstrom. „Floor“ heißt Grundbedarf, nicht garantierte Zahlung. Mindest-Flex bleibt eine Nutzerpräferenz. [Konsumbezug](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-02), [Mindest-Flex](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-04).

Dynamic Flex verteilt verfügbares Kapital über einen angenommenen Resthorizont. Der Annuitätenkern ist mit der Forschung verwandt; Renditeannahme und Schutzregeln sind eigene Anpassungen. Community-VPW und US-RMD-Divisoren sind getrennte Bezüge. Keine Quelle liefert die passende persönliche Flex-Höhe. [Annuität und Abweichungen](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-05). Die Rechnung steht im [Jahresbudget](JAHRESBUDGET.md).

### Langlebigkeit

Yaari und weitere Lebenszyklusarbeiten zeigen, weshalb unsichere Lebensdauer Entsparen und Versicherungsbedarf verändert. Ein Mittelwert der Restlebensdauer ist kein ausreichendes persönliches Enddatum. Ein vorsichtigeres Quantil kann heutigen Konsum senken; ein zu kurzer Horizont kann ihn zulasten späterer Jahre erhöhen. Die App bildet diese Abwägung mit eigenen Horizont- und Pufferregeln ab. [Lebensdauerdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-14).

Seit FR-75 rechnet die App mit der Kohortensterbetafel des Statistischen Bundesamts, Variante V2 „mittel“, für den Geburtsjahrgang jeder Person. Anders als eine Periodentafel enthält sie die erwartete Verbesserung der Sterblichkeit dieses Jahrgangs; für 60- bis 70-Jährige liegt die Lebenserwartung dadurch 0,7 bis 1,6 Jahre höher. Die künftigen Werte sind eine Vorausberechnung: V1 und V3 liegen rund ein halbes Jahr darunter oder darüber. Wer heute ohne Pflegegrad ist, lebt im Modell im Mittel wie die Tafel; nur ein Pflegegrad verkürzt. Der Schwanz ab 100, divers als Mittelwert und fehlende Abhängigkeit zwischen Partnern bleiben Grenzen. Amtliche Herkunft bestätigt keine persönliche Lebensdauerprognose. [Datenherkunft](DATA_SOURCES.md#sterblichkeit).

## Pfade und Bewertung

<a id="historische-marktpfade-und-monte-carlo"></a>

### Bootstrap und Regime

Ein historischer Backtest zeigt eine zeitlich geordnete Modellrechnung. Resampling erzeugt neue Pfade durch erneutes Ziehen beobachteter Jahre. Efron begründet den Bootstrap; Künsch sowie Politis und Romano behandeln abhängige Beobachtungen mit Blöcken. Die Methodenwahl bestätigt weder die passende Blocklänge noch Stationarität der Markthistorie. Die App zieht vollständige Jahresrecords, damit Beziehungen innerhalb eines Jahres erhalten bleiben. [Samplingdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-08).

Die Jahresbasis 1925–2025 enthält rekonstruierte Forschungsreihen. Sie ist kein durchgehend investierbarer Anbieterindex. Ein Filter für geschätzte frühe Jahre beseitigt nicht alle Datenbrüche. Neue unbekannte Krisentypen entstehen durch Resampling allein nicht. Internationale Forschung macht zudem auf Überlebens- und Datenverfügbarkeitsverzerrungen aufmerksam. [Datenvertrag](DATA_SOURCES.md#gemeinsame-konvention).

Die App unterscheidet Marktlabels der Entnahmeregeln und gezählte Übergänge historischer Monte-Carlo-Klassen. Beides ist von Hamiltons geschätztem Modell verborgener Phasen zu unterscheiden. ARCH/GARCH werden nicht implementiert. Diese Arbeiten liefern Vergleichsmaßstäbe für zeitlich wechselndes Risiko, keine Bestätigung der Appschwellen. [Regimedossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-09).

### CAPE und Stress

Campbell und Shiller begründen einen langfristigen Zusammenhang zwischen Bewertung und Rendite. Welch und Goyal zeigen Grenzen vieler Prädiktoren außerhalb der Entwicklungsdaten. Eine US-CAPE-Reihe begründet deshalb keine verlässliche Jahresprognose für einen deutschen Haushalt. Die CAPE-Renditeregel der App braucht einen Vergleich gegen eine konstante Annahme auf vorab zurückgehaltenen Daten. [Bewertungsdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-11).

Forschung zu schweren Renditeschwänzen begründet das Prüfen extremer Szenarien. Das zusätzliche Tail-Overlay setzt jedoch selbst gewählte Häufigkeiten, Schwere und Erholung ein. Diese Werte sind keine geschätzten Crashwahrscheinlichkeiten. Auch die gleichzeitige Entwicklung von Aktien, Inflation, Zinsen und Gold braucht eine eigene Prüfung. [Stressdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-10).

### Optimierung

Backtests, Replay und Parametersuche helfen, Unterschiede unter gleichen Annahmen zu untersuchen. Werden viele Varianten an derselben Historie ausgewählt, können scheinbar gute Treffer durch Zufall entstehen. Lo und MacKinlay, White sowie Cawley und Talbot begründen diese Prüfpflicht. Eine chronologische Rechnung verhindert keine nachträgliche Regelwahl mit Kenntnis der Geschichte. [Backtest](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-12).

Auto-Optimize bewertet führende Kandidaten mit getrennten Seeds. Da dieses Set auch zur Championwahl dient und aus demselben Generator stammt, ist es kein unabhängiger Markt-Holdout. Der Champion ist der beste gefundene zulässige Kandidat im untersuchten Suchraum. Wiederholte Suchen und manuelle Anpassungen gehören zum Versuchsuniversum. [Suchdossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-13).

## Übertragbarkeit

### Deutscher Haushalt

Amtliche Rentenreihen liefern Populations- und Finanzierungskontext. Die persönliche Simulation braucht eingegebene Beträge und Termine; sie berechnet keinen Rentenbescheid. Steuern, Produktkosten und Anleihen sind vereinfacht. Die Aktienreihe ist eine Bruttorendite; der Simulator zieht pauschal 0,5 % laufende ETF-Kosten ab, ein Mittelwert aus Index- und Fondsdaten, keine Prognose. Die Lohnreihe als Rentenproxy enthält die Wirtschaftswunderjahre und steigt seit 1992 real kaum; „wie Inflation“ ist deshalb die vorsichtigere Vorgabe. Gesamtvermögen enthält Immobilien; Entnahmefähigkeit, Renditen und Ruin sind auf das Geldvermögen zu beziehen. [Rentenbezug](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-15), [Modellüberblick](FACHKONZEPT.md), [Steuern](STEUERN.md).

Liquiditätstöpfe können Entscheidungen strukturieren. Estradas Bucket-Gegenbefund verlangt aber, Verhaltenseffekt und Anlageaufteilung getrennt zu prüfen. Auch Gold ist laut Baur/Lucey und Erb/Harvey kein zeitlos verlässlicher Krisen- oder Inflationsschutz. Ob die jeweiligen Appregeln helfen, braucht Vergleiche bei gleichen Gesamtbeständen, Kosten und Zahlungsströmen. [Liquidität](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-06), [Gold](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-07).

### Pflege und Erbe

Die Pflegewahrscheinlichkeiten, Gradfortschritte und Sterblichkeitsfaktoren wurden intern per Simulation auf Bestände und Gradanteile von Destatis 2023 abgestimmt. Bestandsdaten sind dabei Zielgrößen; sie werden nicht durch eine Dauer geteilt und zu Eintrittsraten umgedeutet. Fehlende Kreuztabellen, individuelle Dauer und regionale Kosten begrenzen die Übertragung. Die externe Validierung ist ausstehend. Brown und Finkelstein behandeln US-Versicherungen; daraus folgt keine deutsche Kalibrierung. [Pflegedossier](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-16).

Angehörigenausfall, Pflegeform, Nachlass, Wohnrechte und Erbsteuer verändern Zahlungsströme. Die implementierten Szenarioregeln sind kein extern bestätigtes Verhaltens- oder Rechtsmodell. Der Pflegebucket reserviert eigenes Kapital und ist keine Versicherung. [Zweckbindung](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#map-17), [Pflege](PFLEGE.md), [Tod und Erbe](TOD_UND_ERBE.md).

### Beispiel und offene Nachweise

Max und Erika wollen mehr Mindest-Flex zulassen. Bei gleichen Markt- und Lebensereignispfaden vergleichen sie heutigen Konsum, spätere Deckung und Nachlass. Eine bessere Deckungsquote allein genügt nicht, wenn sie aus stärkeren Kürzungen entsteht. Dies ist eine synthetische Lesefrage, keine neu ausgeführte Messung. [Vergleich und Zielgrößen](SIMULATION_LESEN.md#varianten).

Eine Wirkungsbehauptung braucht vorab festgelegte Hypothese, Baseline, Daten-/Kostenvertrag, sämtliche Versuche, gesperrte Bestätigungsdaten und unabhängigen Review. Die [offenen Nachweise](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise) erhalten diese Grenzen. Technische Tests und gleiche Ergebnisse in Worker und Hauptthread belegen ihre Verträge, keine wirtschaftliche Eignung.

### Wo du es in der App siehst

<a id="erfolgsquote-und-laufende"></a>
<a id="einschränkungen-richtig-vergleichen"></a>
<a id="reihenfolge-der-auswertung"></a>
<a id="vermögensbasis-und-verteilungen"></a>

Im Simulator und unter „Monte Carlo“ stehen Deckung, Mindest-Flex, Vermögensverteilungen und Jahresprotokolle. „Werkstatt“ zeigt Vergleichs- und Suchergebnisse. Ihre Nenner und Grenzen erklärt [Simulationsergebnisse lesen](SIMULATION_LESEN.md); kurze Begriffe stehen im [Handbuch](../../Handbuch.html#begriffe). Quellenrollen, Risiken und Prüffristen bleiben im [Register](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#aktualitaetsvertrag).
