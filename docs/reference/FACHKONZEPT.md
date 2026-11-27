# Fachkonzept und Regelverzeichnis

Modellüberblick und fachliche Hauptorte für Nutzer, Fachleser und Entwickler. Stand: 26.11.2026. Die Kennungen verweisen auf belegte Entscheidungen; sie bilden keine zweite Regelerklärung. [Technik](TECHNICAL.md) und [Datenverträge](DATENVERTRAEGE.md) führen Implementierung und Records.

## Modell

### Haushalt

Die App verbindet Personen, Einkünfte, Bedarf und Anlagen zu einem jährlichen Budget mit Handlungsvorschlag. Balance rechnet den gepflegten Bestand; Simulatorpfade führen Vorschläge auf Kopien aus. Reale Überweisungen und Geschäfte bleiben Entscheidungen des Nutzers.

### Zeit und Geld

Die Rechnung verwendet nominale Euro in Jahresschritten. Ergebnisse können in Startkaufkraft gezeigt werden. Geldvermögen umfasst Konten und Anlagen, Gesamtvermögen zusätzlich Immobilien. Immobilien werden erst nach einem modellierten Verkauf liquide. Gesperrte Pflegereserven stehen nicht für die normale Entnahme frei.

### Grenzen

Ein Haushalt umfasst eine oder zwei Personen; die [Verwaltung](../../Handbuch.html#personen-verwalten) legt sie an. Eine weitere Person bekommt einen eigenen Haushalt. Kein vollständiges Kosten-, FX-, Kredit- oder Anleihelaufzeitmodell; Aktien tragen in Simulator und Dynamic Flex nur einen pauschalen Fondskostenabschlag aus Haushalt & Plan. Historische Proxies und Lebensereignisse sind Modellannahmen, keine individuelle Prognose. [Quellen und Validierungsgrenzen](DATA_SOURCES.md#modellgrenzen-und-validierung) erhalten offene Nachweise; [technische Befunde](TECHNICAL.md#fehlertypen-und-offene-grenzen) bleiben sichtbar.

## Regelverzeichnis

Status „umgesetzt“ bedeutet im gelieferten Code belegt, keine externe Validierung. Die [technische Zuordnung](TECHNICAL.md#stufen-und-codebesitz) und [Lebensereignisbelege](TECHNICAL.md#lebensereignisse-und-steuer-belegen) führen zu Quellen und Prüfungen. FR-59 ist im belegten Bestand nicht vergeben; daraus wird keine Regel abgeleitet.

### Beschluss und Budget

| Kennung | Gegenstand und Hauptort | Status |
|---|---|---|
| <a id="fr-1"></a>FR-1 | [Festgeschriebene Empfehlung](HANDLUNGSANWEISUNG.md#beschluss) | umgesetzt |
| <a id="fr-2"></a>FR-2 | [Freiwillige reale Umsetzung](HANDLUNGSANWEISUNG.md#reale-ausführung) | umgesetzt |
| <a id="fr-3"></a>FR-3 | [Bewusste Planänderung](JAHRESBUDGET.md#bewusster-neustart) | umgesetzt |
| <a id="fr-4"></a>FR-4 | [Tagesgeld direkt überschreiben, Handlungen ansehen](../../Handbuch.html#monat-abschliessen) | umgesetzt |
| <a id="fr-5"></a>FR-5 | [Vorbereitung vor Abschluss](../../Handbuch.html#jahr-abschliessen) | umgesetzt |
| <a id="fr-6"></a>FR-6 | [Einschränkung unter Mindest-Flex](SIMULATION_LESEN.md) | umgesetzt |
| <a id="fr-7"></a>FR-7 | [Frühere Einkünfte-Abgrenzung](JAHRESBUDGET.md#einkommen) | ersetzt durch FR-42 |
| <a id="fr-8"></a>FR-8 | [Reale Drei-Topf-Renditeschwelle](HANDLUNGSANWEISUNG.md#c14) | umgesetzt |
| <a id="fr-9"></a>FR-9 | [Vollständige Drei-Topf-Aktion](HANDLUNGSANWEISUNG.md#c15) | umgesetzt |
| <a id="fr-10"></a>FR-10 | [Persönliche Konten und Quellen](HANDLUNGSANWEISUNG.md#eigentümer) | umgesetzt |
| <a id="fr-11"></a>FR-11 | [Renten netto](JAHRESBUDGET.md#einkommen) | umgesetzt |
| <a id="fr-12"></a>FR-12 | [Historie und Planreset](JAHRESBUDGET.md#jahresgedächtnis) | umgesetzt |
| <a id="fr-13"></a>FR-13 | [Jährlicher Planungshorizont](JAHRESBUDGET.md#dynamik) | umgesetzt |
| <a id="fr-14"></a>FR-14 | [Präzision vor Anzeige/Buchung](JAHRESBUDGET.md#rundung) | umgesetzt |
| <a id="fr-15"></a>FR-15 | [Hoch vor Jahresentscheidung](HANDLUNGSANWEISUNG.md#c8) | umgesetzt |
| <a id="fr-16"></a>FR-16 | [Haushaltsdeckung persönlicher Steuer](STEUERN.md#persönliche-jahresrechnung) | umgesetzt |
| <a id="fr-18"></a>FR-18 | [Rentengarantie](JAHRESBUDGET.md#einkommen) | umgesetzt |
| <a id="fr-19"></a>FR-19 | [Einheitlicher Kirchensteuersatz](STEUERN.md#satz-und-kirchensteuer) | umgesetzt |
| <a id="fr-20"></a>FR-20 | [Schwere Flex-Notlage](JAHRESBUDGET.md#b12) | umgesetzt |
| <a id="fr-25"></a>FR-25 | [Negative Zinsen ohne Steuergewinn](STEUERN.md#persönliche-jahresrechnung) | umgesetzt |
| <a id="fr-26"></a>FR-26 | [Doppelter Wunsch-Flex als Grenze](JAHRESBUDGET.md#a5) | umgesetzt |
| <a id="fr-27"></a>FR-27 | [Haushaltsliquidität vor Verkäufen](HANDLUNGSANWEISUNG.md#d1) | umgesetzt |
| <a id="fr-28"></a>FR-28 | [Zusammenveranlagung](STEUERN.md#persönliche-jahresrechnung) | umgesetzt |
| <a id="fr-29"></a>FR-29 | [Schnellerer Flex-Anstieg](JAHRESBUDGET.md#b4) | umgesetzt |
| <a id="fr-30"></a>FR-30 | [Liquiditätsziel nach geplantem Bedarf](HANDLUNGSANWEISUNG.md#c1) | umgesetzt |
| <a id="fr-31"></a>FR-31 | [Go-Go-Altersgrenze](JAHRESBUDGET.md#a3) | umgesetzt |
| <a id="fr-32"></a>FR-32 | [S-Kurve und geschützte Quote](JAHRESBUDGET.md#b5) | umgesetzt |
| <a id="fr-33"></a>FR-33 | [CAPE-Renditekurve](JAHRESBUDGET.md#a2) | umgesetzt |
| <a id="fr-34"></a>FR-34 | [Rundung und Glättungsanker](JAHRESBUDGET.md#b13) | umgesetzt |
| <a id="fr-35"></a>FR-35 | [Höchststand und Reservebasis](JAHRESBUDGET.md#b0) | umgesetzt |
| <a id="fr-37"></a>FR-37 | [Kaufkraft-Anhebung](JAHRESBUDGET.md#b8) | umgesetzt |
| <a id="fr-42"></a>FR-42 | [Feste Einkünfte einschließlich Überschuss](JAHRESBUDGET.md#einkommen) | umgesetzt |
| <a id="fr-43"></a>FR-43 | [Feste geplante Ausgaben im Grundbedarf, einmalige außerhalb Budget](HANDLUNGSANWEISUNG.md#liquiditätsziel) | umgesetzt |
| <a id="fr-44"></a>FR-44 | [Balance im Planungsjahr](HANDLUNGSANWEISUNG.md#liquiditätsziel) | umgesetzt |
| <a id="fr-46"></a>FR-46 | [Abschöpflimit nur für Verkäufe](HANDLUNGSANWEISUNG.md#c9) | umgesetzt |
| <a id="fr-50"></a>FR-50 | [Bedarf und Pflegewerte im Jahresdialog](../../Handbuch.html#jahr-abschliessen) | umgesetzt |
| <a id="fr-52"></a>FR-52 | [Ansparjahr und Budgetgrenze](JAHRESBUDGET.md#ansparjahr) | umgesetzt |
| <a id="fr-57"></a>FR-57 | [Sparplananlage in Ansparjahren](HANDLUNGSANWEISUNG.md#c9) | umgesetzt |
| <a id="fr-60"></a>FR-60 | [Begrenzte Kaufkraft-Anhebung](JAHRESBUDGET.md#b8) | umgesetzt |
| <a id="fr-63"></a>FR-63 | [Drei Töpfe ohne Gegenaufträge](HANDLUNGSANWEISUNG.md#drei-töpfe) | umgesetzt |
| <a id="fr-65"></a>FR-65 | [Personen verwalten und Haushaltsgrenze](../../Handbuch.html#personen-verwalten) | umgesetzt |
| <a id="fr-71"></a>FR-71 | [Wahl zwischen Jahresendregel und Jahreshoch](JAHRESBUDGET.md#marktphasen) | geändert durch FR-89 |
| <a id="fr-74"></a>FR-74 | [Rentenanpassung „wie Inflation“ als Vorgabe](../../Handbuch.html#person-rente) | umgesetzt |
| <a id="fr-77"></a>FR-77 | [Jahresplan und Umsetzungsstand in „Was zu tun ist“](HANDLUNGSANWEISUNG.md#beschluss) | umgesetzt, Jahreshoch geändert durch FR-89 |
| <a id="fr-79"></a>FR-79 | [Geführte Verkäufe und Käufe mit Tagesgeldabgleich](HANDLUNGSANWEISUNG.md#reale-ausführung) | umgesetzt |
| <a id="fr-80"></a>FR-80 | [Eine Person trägt](HANDLUNGSANWEISUNG.md#eigentümer) | umgesetzt |
| <a id="fr-81"></a>FR-81 | [Flex-Kürzung bei Unverheirateten](HANDLUNGSANWEISUNG.md#eigentümer) | umgesetzt |
| <a id="fr-88"></a>FR-88 | [Vorschüssige Rate im Dynamic Flex](JAHRESBUDGET.md#a2) | umgesetzt |
| <a id="fr-89"></a>FR-89 | [Allzeithoch aus Tageskursen, ohne Wahl im Jahresabschluss](JAHRESBUDGET.md#marktphasen) | umgesetzt |
| <a id="fr-90"></a>FR-90 | [Junge Korrektur bei einem Hoch im laufenden Jahr](JAHRESBUDGET.md#marktphasen) | umgesetzt |
| <a id="fr-92"></a>FR-92 | [Erstattungen im Jahresbedarf je Person verrechnen](JAHRESBUDGET.md#einkommen) | umgesetzt |

### Lebensereignisse

| Kennung | Gegenstand und Hauptort | Status |
|---|---|---|
| <a id="fr-17"></a>FR-17 | [Pflege endet mit Tod](PFLEGE.md#eintritt-fortschritt-und-verlaufswahl) | umgesetzt |
| <a id="fr-21"></a>FR-21 | [Grundbedarf nach Tod](TOD_UND_ERBE.md#einkommen-und-bedarf) | umgesetzt |
| <a id="fr-22"></a>FR-22 | [Hinterbliebenenrente mit Anrechnung](TOD_UND_ERBE.md#einkommen-und-bedarf) | umgesetzt |
| <a id="fr-23"></a>FR-23 | [Sterbejahr](TOD_UND_ERBE.md#sterbejahr) | umgesetzt |
| <a id="fr-24"></a>FR-24 | [Nachlass und persönliche Steuerstände](TOD_UND_ERBE.md#nachlass) | umgesetzt |
| <a id="fr-38"></a>FR-38 | [Pflegepreise ab Start](PFLEGE.md#kostenstaffel-und-kostenanstieg) | umgesetzt |
| <a id="fr-39"></a>FR-39 | [Flex je Pflegegrad](PFLEGE.md#pflegereserve-und-flex) | umgesetzt |
| <a id="fr-40"></a>FR-40 | [Pflege-Flex nach Partnertod](PFLEGE.md#pflegereserve-und-flex) | umgesetzt |
| <a id="fr-41"></a>FR-41 | [Interne Pflegeabstimmung](PFLEGE.md#modellannahmen-und-grenzen) | intern abgestimmt, extern unvalidiert |
| <a id="fr-45"></a>FR-45 | [Heutiger Grad und Verlauf](PFLEGE.md#grad-und-pflegeform) | umgesetzt |
| <a id="fr-47"></a>FR-47 | [Pflegeform und Pflegegeld](PFLEGE.md#pflegegeld-als-einkunft) | umgesetzt |
| <a id="fr-48"></a>FR-48 | [Unverheiratete und Erbquote](TOD_UND_ERBE.md#nachlass) | umgesetzt |
| <a id="fr-51"></a>FR-51 | [Ehequote und Erbsteuer](STEUERN.md#klassen-und-befreiungsannahmen) | umgesetzt |
| <a id="fr-54"></a>FR-54 | [Immobilien und Steuergeld](TOD_UND_ERBE.md#andere-erben-und-steuergeld) | umgesetzt |
| <a id="fr-55"></a>FR-55 | [Getrennte Hinterbliebenenanteile](TOD_UND_ERBE.md#einkommen-und-bedarf) | umgesetzt |
| <a id="fr-56"></a>FR-56 | [Hauserlös im Nachlass](TOD_UND_ERBE.md#andere-erben-und-steuergeld) | umgesetzt |
| <a id="fr-64"></a>FR-64 | [Testament, Wohnrecht und Jahressteuer](STEUERN.md#wohnrecht-und-jährliche-zahlung) | umgesetzt |
| <a id="fr-67"></a>FR-67 | [Erbschaftsteuer mit Reserveschutz](TOD_UND_ERBE.md#zahlung) | umgesetzt |
| <a id="fr-72"></a>FR-72 | [Heimkosten und eigene Ausgaben im Heim](PFLEGE.md#heimkosten-und-jahresabschluss) | umgesetzt |
| <a id="fr-73"></a>FR-73 | [Heutige Pflege im Bedarf von Balance und Simulator](PFLEGE.md#pflege-im-bedarf) | umgesetzt |
| <a id="fr-75"></a>FR-75 | [Kohortensterbetafel für Lebenserwartung und Planungshorizont](WISSENSCHAFTLICHER_RAHMEN.md#langlebigkeit) | umgesetzt |
| <a id="fr-84"></a>FR-84 | [Grundbedarfsdeckung, Hilfe zur Pflege und Steuerschuld](PFLEGE.md#wenn-das-geld-nicht-reicht) | umgesetzt |
| <a id="fr-93"></a>FR-93 | [Verkauf im Erbfall und Miete auf Lebenszeit](TOD_UND_ERBE.md#verkauf-und-miete-auf-lebenszeit) | umgesetzt |
| <a id="fr-96"></a>FR-96 | [Abwicklungskosten und Pflichtteil bei Immobilien und Steuergeld](TOD_UND_ERBE.md#andere-erben-und-steuergeld) | umgesetzt |

### Vermögen und Strategie

| Kennung | Gegenstand und Hauptort | Status |
|---|---|---|
| <a id="fr-36"></a>FR-36 | [Summe persönlicher Pflegereserven](STRATEGIEN.md#pflege) | umgesetzt |
| <a id="fr-49"></a>FR-49 | [Eigentumsanteil, Miete und Vermögensbasis](IMMOBILIEN.md#wert-und-einkommen) | umgesetzt |
| <a id="fr-53"></a>FR-53 | [Verkauf bei Heimpflege](IMMOBILIEN.md#verkauf) | umgesetzt |
| <a id="fr-58"></a>FR-58 | [Bestandswarnung und Strategiewahl](STRATEGIEN.md#auswahl) | umgesetzt |
| <a id="fr-61"></a>FR-61 | [Einzelner Notverkauf, bevor das Vermögen aufgebraucht ist](IMMOBILIEN.md#verkauf) | umgesetzt |
| <a id="fr-62"></a>FR-62 | [Wohnmiete nach Notverkauf](IMMOBILIEN.md#danach) | umgesetzt |
| <a id="fr-66"></a>FR-66 | [Tagesgeld und Geldmarkt aufteilen](HANDLUNGSANWEISUNG.md#tagesgeldanteil) | umgesetzt |
| <a id="fr-76"></a>FR-76 | [Fondskosten Aktien im Simulator und im Dynamic Flex](DATA_SOURCES.md#fondskosten-aktien) | umgesetzt |
| <a id="fr-82"></a>FR-82 | [Älteste Tranche je Person und ISIN zuerst verkaufen](HANDLUNGSANWEISUNG.md#d2) | umgesetzt |
| <a id="fr-83"></a>FR-83 | [Altbestand und Neubestand nach Kaufdatum](../../Handbuch.html#kauf-korrigieren) | umgesetzt |
| <a id="fr-85"></a>FR-85 | [Immobilienwerte im Jahresabschluss fortschreiben](IMMOBILIEN.md#wertverlauf-und-fortschreibung) | umgesetzt |
| <a id="fr-97"></a>FR-97 | [Simulierte Aktienzukäufe in dasselbe oder ein eigenes Papier](STEUERN.md#simulierte-zukäufe) | umgesetzt |

### Sicherung

| Kennung | Gegenstand und Hauptort | Status |
|---|---|---|
| <a id="fr-70"></a>FR-70 | [Aufbewahrung von Wiederherstellungspunkten](SICHERUNG.md#wiederherstellungspunkt) | umgesetzt |

## Ergebnisse

### Begriffe und Quellenverweise

Das [Glossar](../../Handbuch.html#glossar) erklärt Bedienbegriffe. [Simulationsergebnisse lesen](SIMULATION_LESEN.md) definiert Deckung, aufgebrauchtes Vermögen, Mindest-Flex, Kaufkraft, Perzentile und Geld-/Gesamtvermögen. Nenner und fehlende Werte bleiben Teil der Aussage.

[Marktvergleich](MARKTVERGLEICH.md) und [Forschungsrahmen](WISSENSCHAFTLICHER_RAHMEN.md) ordnen Werkzeuge und Methoden ein; ihre Evidenzregister bewahren Quellen, Prüfdatum und offene Nachweise. Methodenliteratur, interne Abstimmung und unabhängige Validierung sind verschiedene Belege.
