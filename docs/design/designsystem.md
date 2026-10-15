# Designsystem „Stein & Messing“

## Grundlagen

### Gestaltung und Funktionsgrenzen

Die Fachlogik kommt aus den Quellmodulen. Ein Entwurf begründet keine neue Funktion und keine geänderte Kennzahl. Die Regeln zu [Jahresbeschluss und Vorschau](../reference/FACHKONZEPT.md#jahresbeschluss-und-vorschau) sowie zur [Einschränkung nach FR-6](../reference/FACHKONZEPT.md#einschränkung-nach-fr-6) gelten auch bei einem Umbau der Oberfläche. Zwischenstände zuerst mit Maus und Tastatur bei 1920×1080 und 2560×1440 prüfen; Härtung folgt, wenn die Oberfläche steht. Neue Druckprüfungen entfallen.

Die App bleibt bei getrennten HTML-Seiten mit gemeinsamem Kopf und Seitenleiste. Der Rahmen erhält Profilübergabe, Flush und BFCache; er führt keine gemeinsame Seitenlaufzeit und kein clientseitiges Routing ein. Bei instabilem Rahmen bleibt ein einfacher Kopf mit Navigation je Seite der Rückweg. Quellen: `app/shared/suite-frame.js`, `app/profile/profile-navigation.js`.

Tokens, Markup und Renderer gemeinsam pflegen. Kein CSS-Overlay aus einem Prototyp übernehmen. Schriften und Symbole bleiben lokal. DOM-Reihenfolge, echte Gruppenüberschriften und benannte Symbolknöpfe erhalten die Grundbedienung. Zahlenkolonnen nutzen Ziffern fester Breite; Serifenschrift bleibt Überschriften und einzelnen großen Kennzahlen vorbehalten. Vollständige Erklärungen bleiben bedienbar erreichbar, statt nur in `title` oder abgeschnittenem Text zu stehen. Die jeweiligen Bausteine und begrenzten Bestandsausnahmen stehen weiter unten.

Die Hauptaufgabe bekommt den Platz. Expertenfelder bilden thematische Gruppen mit höchstens drei bis vier Feldern je Zeile. Die Wahl „Alle Parameter zeigen“ gehört zur Oberfläche, nicht zum Profil. Übernommene, bearbeitbare und nicht anwendbare Felder erhalten ihren Zustand samt Grund über `app/shared/field-state.js`; Sperren und Rohwerte bleiben erhalten. Weitere Planwerte und Alle Parameter teilen `household-plan-more`, die Karten und Zeilen in `css/components.css` sowie die Zusammenfassung aus `app/shared/household-plan-presentation.js`. Übernommene Kästen haben einen gestrichelten Rand ohne weiße Füllung; auch Gold aus steht rechtsbündig in diesem Kasten und verwendet die Textskala der Parameterwerte. Alle Segmentoptionen bleiben sichtbar und gesperrt; die gewählte Option ist hervorgehoben. Die fünf Dynamikoptionen stehen bei 1920×1080 und 2560×1440 mit vollständigen Texten in einer Zeile. Unter 1600 Pixel Fensterbreite dürfen sie mit vollständigen Beschriftungen umbrechen. Im Versuch erscheinen die normalen Eingabekästen und bedienbaren Segmente.

Jede Finanzzahl nennt Bezug, Zeitraum und Einheit. Null, fehlend und nicht anwendbar bleiben unterscheidbar. Ohne fachliche Bewertung bleibt eine Zahl neutral, auch Floor-Deckung und Monate ohne Ausgabendaten. Deutsches Anzeigeformat und Eingabeparsing haben getrennte Verträge. Kernaussagen und Details stammen aus demselben Ergebnis; fehlende Kennzahlen erzeugen keine Behauptung. Für die Einschränkungsanzeige gilt FR-6.

### Ladefolge und Auslieferung

Jeder Kopf lädt zuerst `css/tokens.css`, dann `css/fonts.css`, dann
`css/components.css`, anschließend seine bisherigen Seitenregeln.
Kanonische Tokens gehören ausschließlich in `css/tokens.css`;
bisherige Variablennamen bleiben als azyklische Rollenbrücke erhalten. Kein
Override-Overlay und keine zusätzlichen `!important`-Deklarationen.
Die unveränderten Serve-/Syncpfade liefern vorhandene `assets/fonts/` und
`assets/icons/lucide/` lokal aus. Kein Engine-Build und keine Assetänderung sind nötig.
Die Tauri-CSP verliert ausschließlich die Google-Einträge in `style-src`/`font-src`.
Alle übrigen Direktiven, insbesondere `'self'`, `data:` und bestehende API-Quellen,
bleiben exakt erhalten.

### Farbtokens

| Token | Wert |
|---|---|
| `--page` | `#f1f2ee` |
| `--surface` | `#ffffff` |
| `--surface-sunken` | `#f4f5f1` |
| `--text-main` | `#1d2830` |
| `--text-muted` | `#56626a` |
| `--accent` | `#7a5a1f` |
| `--accent-soft` | `#f2e9d4` |
| `--accent-line` | `#b8954f` |
| `--good` | `#2b6e50` |
| `--good-soft` | `#dcefe5` |
| `--warn` | `#8a5a12` |
| `--warn-soft` | `#f6e7cc` |
| `--bad` | `#9c3b33` |
| `--bad-soft` | `#f5dcd8` |
| `--border` | `#d8dbd3` |
| `--border-strong` | `#c3c8bf` |
| `--backdrop` | `color-mix(in srgb, var(--text-main) 45%, transparent)` |

`--backdrop` ist die neue grafische Ausnahme für den textfreien Navigations-Backdrop.
Der Token gehört nicht zu den opaken Textkontrastrollen; Dialogfläche und Texte bleiben opak.

### Zulässige Textpaare

Die Tabelle ist eine auswertbare Rollenliste; komma-separierte Tokenlisten bilden
alle Kombinationen einer Zeile. Diese Paare erreichen ungerundet mindestens 4,5:1.
Linien-/Randfarben dürfen nicht als Textfarbe dienen. Keine Deckkraft auf Text,
seinen migrierten Eltern oder Steuerelementen; rein grafische Transparenz ist getrennt.

| Vordergrund | Zulässiger Hintergrund | Zweck |
|---|---|---|
| `--text-main`, `--text-muted` | `--page`, `--surface`, `--surface-sunken`, `--accent-soft`, `--good-soft`, `--warn-soft`, `--bad-soft` | Standardtext und Hilfetext |
| `--accent` | `--page`, `--surface`, `--surface-sunken`, `--accent-soft` | Links und Akzentbeschriftung |
| `--good` | `--page`, `--surface`, `--surface-sunken`, `--good-soft` | vorhandene positive Bewertung |
| `--warn` | `--page`, `--surface`, `--surface-sunken`, `--warn-soft` | vorhandene Warnung |
| `--bad` | `--page`, `--surface`, `--surface-sunken`, `--bad-soft` | vorhandener Fehler oder Verlust |
| `--surface` | `--text-main`, `--accent`, `--good`, `--warn`, `--bad` | heller Text auf dunkler Aktion |

`--text-muted` auf `--bad-soft` erreicht rund 4,81:1, `--warn` auf `--warn-soft`
rund 4,85:1, Weiß auf `--text-main` rund 15,02:1. Node-Tests rechnen ungerundet.

Textlinks verwenden auch nach einem Besuch `--accent` (Messing). Die gemeinsame
Regel `:where(a:link, a:visited)` in `css/components.css` verhindert blaue oder
violette Browserfarben auf allen App-Seiten. Ihre geringe Spezifität erhält die
eigenen Rollen von Navigation und Linkbuttons, einschließlich heller Schrift
auf dunklen Aktionen. Der gemeinsame Tastaturfokus bleibt sichtbar.

### Typografie und weitere Tokenfamilien

Newsreader: 400/500 normal, 400 kursiv. IBM Plex Sans: 400/500/600 normal.
IBM Plex Mono: 400/500 normal. Alle acht WOFF2-Dateien stehen in `assets/fonts/`
und verwenden `font-display: swap`. Newsreader ist für echte Überschriften
mit vorhandenem Gewicht 500 vorgesehen, Sans für Text/Daten und Kontrollen,
Mono für technische kleine Etiketten. Ersatzfamilien sind Georgia/serif,
system-ui/Sans sowie ui-monospace/monospace. Keine synthetischen 700er-Serifenschnitte.

| Familie | Tokens und Werte |
|---|---|
| Abstände | `--space-1` .25rem, `--space-2` .5rem, `--space-3` .75rem, `--space-4` 1rem, `--space-6` 1.5rem, `--space-8` 2rem |
| Radien | `--radius-sm` .375rem, `--radius-md` .75rem, `--radius-lg` 1rem |
| Schatten | `--shadow-card`: 0 2px 12px rgba(29, 40, 48, .06) |
| Größen | `--text-sm` .875rem, `--text-base` 1rem, `--text-lg` 1.25rem, `--text-title` 2rem |
| Zeilenhöhe | `--leading-body` 1.5, `--leading-heading` 1.2 |
| Fokus | `--ring-width` 2px, `--ring-offset` 2px, `--ring-color` → `--accent` |
| Diagramm | `--chart-1` → `--text-main`, `--chart-2` → `--accent`, `--chart-3` → `--good`, `--chart-4` → `--text-muted`, `--chart-5` #747c72 |
| Heatmap | `--heatmap-low` → `--surface-sunken`, `--heatmap-mid` → `--accent-line`, `--heatmap-high` → `--text-main` |

Diagramm-/Heatmap-Tokens werden in den benannten Grafikrenderern
verwendet. Serien sind Datenfarben, keine neue Bewertung.

### Typografische Skala

Die Balance konsumiert die `--balance-*`-Tokens aus `css/tokens.css` in
`css/balance.css`. Die allgemeinen `--text-*`-Tokens bleiben unverändert;
Simulator und „Personen & Vermögen“ werden dadurch nicht umskaliert.
Die Containergrenze misst die nutzbare Inhaltsbreite von `.balance-page`
(`container: balance-page / inline-size`), nicht die Fensterbreite oder die
Breite einer einzelnen Karte. Ab 2300 px gelten die Breittokens; unter 1180 px
bleiben alle Schriftgrößen höchstens auf dem Standardwert.

| Rolle / Consumer | Standardtoken | Standard | Ab 2300 px |
|---|---|---:|---:|
| h1 / `.balance-head h1` | `--balance-h1` | 30 px | 30 px |
| h2 / Reiter und Dialoge | `--balance-h2` | 22 px | 22 px |
| h3 / Karten und Dialoge | `--balance-h3` | 18 px | 18 px |
| Lead / `.balance-lead` | `--balance-lead` | 16 px | 16 px |
| Monatsbudget / `.balance-hero-num` | `--balance-budget` / `--balance-budget-wide` | 52 px | 60 px |
| Einheit daneben / `.balance-unit` | `--balance-unit` | 26 px | 26 px |
| Handlungsverb / `.balance-action-verb` | `--balance-verb` / `--balance-verb-wide` | 28 px | 30 px |
| Vorschlagsbetrag / `.balance-action-amount` | `--value-md` | 17 px | 17 px |
| Symbolkachel / `.balance-action-icon` | `--balance-icon` | 56 px | 56 px |
| Große Kennzahl / `#diag-guardrails .value`, `.ds-metric-primary` | `--balance-big` | 26 px | 26 px |
| Kennzahlleiste / `.expenses-card-value`, `.ov-after .value` | `--balance-kpi` | 22 px | 22 px |
| Zwischenzahl / `.balance-budget-parts strong`, Pflegewerte | `--balance-mid` | 22 px | 22 px |
| Fließtext / Kontrollen | `--balance-body` | 16 px | 16 px |
| Hilfstext / Popup, Chip, Provenienz | `--balance-help` | 14 px | 14 px |

Budget- und Handlungskarten verwenden die Überschrift als kleines 14-px-Label. Der Vorschlagsbetrag bleibt bei 17 px; der Vorbehalt steht in einer kurzen Zeile mit ⓘ. Entscheidungsnummern in Balance verwenden Sans. Reiter zeigen den Fokusrahmen nur bei `:focus-visible`;
die übrigen Kartenüberschriften folgen h3. Newsreader bleibt für Überschriften
und hervorgehobene Budget-/Handlungs-/Kennzahlwerte, Sans für Text und Kontrollen.
Die Dialoge `#actionDetailsDialog`, `#expensesDetailDialog` und
`#updateResultModal` sowie `#navigationGuardDialog` übernehmen die Überschriftenskala ebenfalls. Der Aktionsdruck
behält den vollständigen Plan, Titel, Quellen, Verwendungen, Steuer- und
Haushaltsdetails in ganzen Euro; die getrennte Textprojektion bleibt centgenau. Kein Druck aus der Kurzprojektion.

`UIUtils.formatBalanceCurrency` formatiert reguläre sichtbare Balance-Geldbeträge über
`formatDisplayNumber` mit `unit: 'currency'`, `fractionDigits: 0` und
`minimumFractionDigits: 0`. Monats-/Jahresbudget, Einkünfte, Entnahme, Kürzung,
Handlung/Zusatztransfer sowie Ausgaben- und Verlaufkennzahlen zeigen ganze Euro.
Die Kartenzeilen `#neuerBedarf`, `#displayDepotwert` (Ausgabeschlüssel `depotwert`),
`#minGoldDisplay` und `#zielLiquiditaet` in „Dein Bedarf“ und „Deine Reserven“
verwenden in beiden Renderzugängen `UIUtils.formatBalanceCurrency` mit ganzen Euro.
Die benachbarten dynamischen Geldzeilen in `#balanceNeedRows` und
`#balanceReserveRows` sowie alle Pflegebucket-Unterzeilen verwenden denselben
Ganz-Euro-Formatter. Die monatliche Bedarfssumme hat eine kleine Einheit `€ / Monat`.
Die Reserven zeigen freie operative Liquidität und das bestehende Ziel mit
`liquidityRunwayYears × 12` Zielmonaten, dann Progressbar, Ist-Reichweite aus
`ui.runway.months` und Detailzeilen. Die Vermögensfußzeile nutzt ausschließlich
`ui.vpw.gesamtwert` und weist `lockedAmount` separat aus, ohne es erneut zu addieren.
Auch Tabellen, Ausgabendetails, „Alle Kennzahlen“ mit Metazeilen, Transaktionskurzfassung und SVG-Titel zeigen ganze Euro. Diagnosecopy, andere Kopierwege, technische Details, Exporte und Eingaben behalten ihre bisherigen Formatter und genaue Präzision. Der vollständige Handlungsdialog und sein Druck zeigen ganze Euro; seine getrennte Kopierprojektion bewahrt Centpräzision. Keine Rundung gespeicherter oder weitergereichter Zahlen; fehlende
Werte bleiben fehlend, echte Null bleibt Null, Prozent/Monate/Jahre behalten ihre
Einheiten. Diagnose-Leitplanken erhalten über `withGuardrailCardValues` separate
`cardValue`-/`cardThreshold`-Anzeigen aus numerischen Rohwerten: ganze Euro,
deutsche Prozentwerte aus Ratios, Monate und einschließliche Grenzen ≤/≥.
Positive Rückgangsgrößen werden als negative Drawdowns mit entsprechend
gespiegeltem Grenzoperator dargestellt. Die Copyfelder `value`/`threshold`
bleiben unverändert; formatierte Payloadtexte werden nicht zurückgeparst.

Die Handlungskarte zeigt in dieser Reihenfolge Aktienverkauf (Summe externer
Nettoquellen ohne Cashtransfer), Goldverkauf, Goldkauf, Aktienkauf mit exakt der Aktienverwendung, reine Cashumschichtung
oder Nichts-tun. Sonstige materielle Vorschläge heißen „Vorgeschlagene Handlung prüfen“ und zeigen wie bisher keinen Kartenbetrag.
Materielle Profilaktionen ersetzen die Gesamtaktion. `#balanceActionTransfer`
zeigt nur zusätzliche, tatsächlich im Detailplan dargestellte Cashtransfers;
verschiedene Profilströme werden nicht künstlich gepaart. Kurzverb und Alltagssatz
überschreiben keinen Engine-Titel. Vollständige integrierte Titel bleiben im Dialog.

`#marketDataProvenance.balance-provenance` ist eine ruhige 14-px-Zeile in der
Marktdatenkarte ohne `ds-note`-Band. Sichtbar stehen Instrument, Stichtag und Quelle;
ohne Metadaten: „Herkunft der Marktdaten unbekannt – mit dem Jahres-Update aktualisieren“.
Die ausführliche Herkunft bleibt als Erläuterung erreichbar; Viewmodel, Live-Region
und Diagnosedatasets bleiben unverändert. Fehlende Provenienz allein erzeugt keine Warnung oder Sperre.
`peak_hot` erhält eine messingfarbene Skalenposition; wie `peak_stable` bleibt die Phase positiv in Phasenchip,
Marktkarte (`market-good`); der positive Überblick bleibt neutral. Folgeanzeigen entfernen
alte Tints; Phase, Texte, Reihenfolge und unabhängige Alarmwarnungen bleiben gleich.
Aktive Skalenfelder sind mit ihrer Phasenfarbe gefüllt und passend umrandet.
Die Budgetlegende nutzt die Segmentfarben; die erste offene Aufgabe trägt Messing,
ein abgeschlossener Jahrespunkt wird dabei übersprungen. Kopfaktionen tragen
dekorative Drucker-, Kreispfeil- und Kalender-SVGs ohne zusätzlichen Fokuspunkt.
Balance-Textlinks nutzen `--accent` mit Hover und sichtbarem Tastaturfokus;
die kurzen „Bearbeiten“-Herkunftslinks behalten ihre geschützten Handoffwege.

Browser-Smoke, Vergleich bei 1920/2560 px und Kandidaten-EXE-Abnahme erfolgen
extern. Node-Prüfungen belegen weder optische noch Desktopfreigabe.

### Rollenbrücke und Grundflächen

Primärtext (`--primary-color`, `--primary-text`, `--text-color`) → `--text-main`;
Sekundärtext (`--secondary-text`, `--text-light`, `--text-secondary`, `--info-text-color`)
→ `--text-muted`. Akzentnamen (`--secondary-color`, `--accent-color`) → `--accent`.
Seitenhintergrund → `--page`, Karten-/Panel-/Inputnamen → `--surface`, abgesenkte
Inhalte/disabled-Flächen → `--surface-sunken`, Randnamen → `--border`.
Statusnamen und Status-BG-/Textnamen bilden gemeinsam `--good`, `--warn`, `--bad`
mit ihrem jeweils passenden `*-soft` ab. `--tranchen-warning-color` → `--warn` (Textrolle in beiden Stylesheets).

Die sieben zuvor fehlenden Balance-Aliase sind definiert:
`--input-bg` → `--surface`, `--card-shadow` → `--shadow-card`,
`--text-color` → `--text-main`, `--hover-color` → `--surface-sunken`,
`--green-text` → `--good`, `--amber-text` → `--warn`, `--red-text` → `--bad`.
Das Handbuch verwendet die zentralen Rollen direkt. Simulator ergänzt
`--surface-muted` → `--surface-sunken` und `--text-secondary` → `--text-muted`.

Hauptaktionen sind dunkel mit hellem Text. Der Handbuchkopf verwendet dunkle
Schrift auf der Seitenfläche, Kapitelverweise verwenden `--accent`. Balance-Startfehler und Persistenzwarnung
verwenden Fehler-/Warntext auf der jeweiligen weichen Fläche; ein dunkler
Statusalias wird nicht blind zum Hintergrund eines schwarzen Warntextes.
Manager-Seite, Verlaufskarten und grundlegende Panels sind neutralisiert.
Bestehende Druckstruktur, Breakpoints, IDs, DOM-Reihenfolge, Listener,
Emojis, Eingaben, Berechnungen und Persistenzverträge bleiben erhalten.

## Bausteine

### Lokale Symbole

`app/shared/designsystem-icons.js` gibt ausschließlich `book-open`, `circle-help`,
`check` und `triangle-alert` frei. Modul-relative URLs müssen denselben Ursprung
wie das Aufruferdokument haben. Fetch erlaubt keine Weiterleitung; Antwortquellen,
XML-Format, SVG-Elemente und Attribute werden vor dem Import geprüft. Kein
ungeprüftes SVG-Markup, kein fremder Paintserver, Script, Ereignisattribut oder Bild.
`document.importNode` ordnet den geparsten Unterbaum dem aufrufenden Dokument zu.
Die Wurzel hat 20 × 20 px, `stroke="currentColor"`, `aria-hidden="true"`
und `focusable="false"`.

Die Startseite ergänzt `book-open` an der vorhandenen Überschrift ihres
Handbuchlinks. Text und Emoji bleiben bestehen. Bei lokalem Ladefehler wird
kein SVG ergänzt; Linktext und Ziel bleiben bedienbar.

### Gemeinsame Bausteine und Feldzustände

`css/components.css` stellt additive `ds-`-Klassen bereit. Bestehende Klassen,
IDs, Listener und DOM-Reihenfolge bleiben die Funktionsanker. Die Rollen umfassen
`ds-button` mit `ds-button-primary`, `ds-button-secondary`, `ds-button-quiet` und
`ds-button-danger`, benannte `ds-icon-button`, `ds-input`, `ds-select`,
`ds-checkbox`, `ds-card` mit Warn-/Fehlerrand, `ds-tab`, `ds-table` und
`ds-table-scroll`, `ds-note` mit Warn-/Fehlervariante, `ds-badge` sowie
`ds-metrics`/`ds-metric`. Nur `ds-metric-primary` verwendet Newsreader für eine
hervorgehobene große Kennzahl; weitere Werte bleiben Sans mit tabellarischen Ziffern.
Symboltasten benötigen ein nicht leeres `aria-label`. Der gemeinsame
`:focus-visible`-Ring nutzt die Fokustokens; gesperrte Kontrollen bleiben ohne
reduzierte Textdeckkraft lesbar. Neue Hilfsklappen verwenden native Details/Summary.

`setFieldState(field, state, reason)` aus `app/shared/field-state.js` stellt
ausschließlich eine bereits getroffene Entscheidung dar. Zulässige Zustände:

| Zustand | Darstellung und Grund |
|---|---|
| `adopted` | Neutral; vorhandene Herkunft oder Ableitung nennen. |
| `editable` | Bearbeitbar dargestellt; Grund optional, ohne Grund wird nur die eigene Begründung entfernt. |
| `inactive` | Neutral; konkrete bestehende Nichtanwendbarkeit nennen. |
| `empty` | Neutral; vorhandenen Leer-/Verfügbarkeitsgrund nennen. |
| `unrated` | Neutral; Wert ohne fachliche Einstufung begründen. |
| `warning` | Warnrand und lesbarer vorhandener Warnungsgrund. |
| `error` | Fehlerrand und lesbarer vorhandener Fehler-/Blockiergrund. |

Außer bei `editable` ist ein nicht leerer Grund Pflicht. Die Hilfe setzt nur
`data-field-state` und ihre eigene sichtbare Begründung mit eindeutiger, je Feld
stabiler ID. Fremde `aria-describedby`-IDs bleiben additiv erhalten. Werte,
`disabled`, `readonly`, andere Inputattribute und Speicherung werden nicht geändert;
Recovery-/Busy-Sperren werden nicht zu fachlicher Nichtanwendbarkeit umgedeutet.
Balance- und Simulator-Feldherkunft sind angebunden; Ergebnis- und Managerdarstellung verwenden ebenfalls die gemeinsamen Rollen.

Startseite und Handbuch nutzen die Rollen ergänzend. Recovery bleibt nach dem
Hero vor dem Profilpanel; Quarantänepfad, Importdateifeld und sitzungsweises
Schließen behalten ihre bisherigen Abläufe. Das Handbuch verwendet eine mitlaufende
Kapitelnavigation, lokale Textsuche und 17 Aufgaben- und Begriffskapitel. Alte Anker
bleiben Aliasse. Direkte Hilfesprünge öffnen das passende Kapitel mit Hinweisleiste
und markiertem Abschnitt; Querverweise erhalten Hash und Zielfokus. Die App-PNGs
mit Bildunterschriften ersetzen die früheren Schemazeichnungen. Monats- und
Jahresabschluss verwenden die nummerierten Bildfolgen. Es gibt keine eigenen Druckregeln.

### Gemeinsame Planungsrollen und Überblick

Die additiven `--plan-*`-Maße steuern `.ds-plan-card` (18 px Radius,
28/30 px Innenabstand, 18 px Inhaltsabstand), Feldhöhe (44 px),
Feldraster (18/22 px), Tabellenzellen (11/14 px) und Raster (24 px).
Neue Rollen ergänzen bestehende Consumer ohne globale Element- oder Typografieänderung:
`ds-help`, `ds-field`, `ds-unit-frame` (keine Kollision mit `ds-input`),
`ds-field-grid`, `ds-segment`, `ds-toggle`/`ds-slider`, `ds-row`,
`ds-adopted-row`, `ds-source`, `ds-kpi-strip`/`ds-kpi`/`ds-big-number`,
`ds-guardrail-card`, `ds-decision-tree`/`ds-decision-step`/`ds-decision-number`,
`ds-chips`, `ds-table-box`, `ds-hint`, `ds-banner`, `ds-steps`/`ds-step`/`ds-step-dot`,
`ds-mini-button` und `ds-context-pill`. Bestehende Info-Popups behalten ihren Vertrag.

Ein gemeinsamer `#suiteContext` steht im Suite-Kopf. `balanceScope` bleibt stabiler Host;
`suiteHouseholdContext` zeigt den von der Summary bestimmten Berechnungsumfang, während „ändern“ den Strategiereiter und
seine vorhandene Haushaltsauswahl erreicht. Die zusätzliche Kopfaktion
`balanceMarketUpdate` delegiert an `jahresabschlussBtn`, übernimmt dessen
Disabled-Zustand und die Periodensperre des Überblickszugangs und prüft Busy/Commit.
Fehlende Marktdatenprovenienz zeigt „nicht verfügbar“ und sperrt allein nichts.

Das normale Überblickraster nutzt 7/5, 5/7, 6/6 Spalten; die breite Variante
5/4/3 und 4/4/4. Die Grenze bleibt 2300 px nutzbarer Inhaltsbreite.
Handlung und Markt richten ihren Inhalt oben aus; nur der Handlungsfuß nutzt
`margin-top: auto`. Der Vergleich ist eine verbundene dreispaltige KPI-Leiste,
keine Sammlung zentrierter Minikästen. Nachher-Runway ist ausdrücklich nicht verfügbar.
Null, fehlende Werte und Unendlich behalten ihre Datenverträge. Sämtliche Geldzeilen
in „Dein Bedarf“ und „Deine Reserven“, einschließlich der festen, dynamischen und
Pflegebucket-Zeilen, zeigen mit `UIUtils.formatBalanceCurrency` ganze Euro.
Alle regulären sichtbaren Balance-Geldbeträge zeigen ganze Euro. Copy, technische Details, Exporte und Eingaben behalten ihre genaue Präzision. Handlungsdialog und Druck zeigen ganze Euro, die getrennte Textprojektion bleibt centgenau.
Der Alarmbanner übernimmt ausschließlich den vorhandenen
Diagnosealarm. Keine Beispielbeträge, Namen oder Jahreswerte werden gespeichert.

Die Steuerung nimmt Referenzen 01/02 jeweils bei 1920/2560 CSS-Pixeln separat ab;
Tokenvorrang, tatsächliche Inhaltsbreite, dynamische Detailzeilen und fehlender
Nachher-Runway werden dabei als Vertragsgrenzen dokumentiert.

### Container und Datenanzeigen

Balance-Formular, Startseite und Manager nutzen benannte Inline-Size-Container.
Neue Spalten sind mit `minmax(0, …)` beziehungsweise `min-width: 0` schrumpfbar.
Bestehende Viewportgrenzen und DOM-Reihenfolge bleiben erhalten. Ausgabenmatrix,
Verlaufstabellen, datenabhängig breite SVGs und Managerbestände scrollen in
benannten, fokussierbaren Regionen; sichtbare Fortsetzungshinweise entfallen im
Druck. Die Handbuchtabelle erhält eine eigene Scrollkapsel ohne Inhaltsmigration.
Kein globales Abschneiden verdeckt Seitenüberlauf.

`designsystem-selection-text.js` hält den ausgewählten Volltext aktuell und
zeigt ihn ausschließlich bei gemessener Kürzung umbrechend an. Die Messung
berücksichtigt Schrift, Padding und den nativen Auswahlindikator. Passende
Kurztexte erhalten keine sichtbare Wiederholung; nur die eigene
`aria-describedby`-Referenz entfällt. Fremde Beschreibungen bleiben erhalten.
Der Startseiten-Profilwechsel wartet ausdrücklich den vorhandenen Flush ab,
bevor Erfolg erscheint. Währenddessen setzt ein weiterer Auswahlversuch die
Anzeige auf das aktive Profil zurück, ohne neuen Wechsel oder Write.
Profil-Handoff, Speicherformat und andere entprellte Schreibvorgänge bleiben erhalten.

Der Manager-Subpage-Bootstrap kann bei unveränderten Live-Fachdaten einen legitimen
Registry-Snapshot mit neuem `meta.updatedAt` vorbereiten. Bootstrapabschluss und
Tabellenbereitschaft bestätigen noch keinen Adapterwrite: Die Persistenzfassade
schreibt entprellt. Beide Managertextfixture-Aufrufe im Browserfall, einschließlich
des Aufrufs nach Reload, beobachten deshalb den abgeschlossenen Bootstrap und die
initialisierte Persistenz und warten vor dem Vorher-Wert den vorhandenen Flush ab.
Ein weiterer Flush vor dem Nachher-Wert macht während der Fixtures eingereihte
Writes sichtbar. Verglichen wird der vollständige rohe Adapterwert von
`rs_profiles_v1`, einschließlich `updatedAt`; reine Textänderungen müssen zusätzlich
ohne `input`-/`change`-Ereignisse bleiben. Das ändert keine Snapshotpolitik.
`profile-storage.test.mjs` belegt mit echten Bootstrap-/Persistenzfunktionen und
einer Promise-Sperre den verzögerten Registryübergang, die Adapterbestätigung und
den wirkungslosen zweiten Flush ohne feste Wartezeit. `designsystem-selection-text.test.mjs`
sichert die drei Managerauswahlen über `childList` am Optionselement,
`characterData` am Textknoten, Lang-/Kurztexte, Resize und wiederholten Refresh ab.
Node-Evidenz ersetzt nicht die noch ausstehende Browserbestätigung; der sofortige
Reload nach bestätigtem Startseiten-Profilwechsel erhält keinen zusätzlichen Testflush.

`designsystem-number-format.js` ist eine additive UI-Hilfe für deutsche Zahlen,
Ratio/Prozentwert, Euro, €/Stück, Jahre und Monate sowie ISO-Tage in deutscher
Anzeige. Echte Null, fehlend mit Grund, nicht anwendbar mit Grund und ausdrücklich
zulässiges Unendlich bleiben getrennt. Bestehende Shared-Formatter liefern
weiterhin etwa `12.3%`; Parser, numerische Inputs, SVG-Geometrie und Exportwerte
werden nicht lokalisiert. MiniSummary zeigt genau ein Prozentzeichen je Wert,
Vorher → Nachher, Jahre/Monate; die große Entnahme nennt €/Monat und €/Jahr.

Die Ausgabenansicht folgt 05 mit dynamischer Segmentjahrwahl über das erhaltene,
verborgene `expensesYearSelect`, vier verbundenen KPIs und Tabellenbox. Die
zusätzliche Importkarte entfällt; ausschließlich die Profil-/Monatszelle öffnet
den bestehenden CSV-Input. Alle Zellaktionen sind neutral mit SVG und Namen;
Löschen erhält Warnfarbe erst bei Hover/Fokus und die bestehende Bestätigung.
Die Matrix zeigt gewählte Profile, Summe, Monatsbudget und Abweichung. Jahres-KPIs
beziehen sich weiterhin auf alle gespeicherten Profile. Datenmonate zählen
positive Monatssummen, keine Nullimporte. Erläuterungen nutzen `ds-info` mit
Hover, Fokus, Klick und Escape. Jahresdiagramm und vollständige Tabelle liegen
in derselben Karte, ohne neue Hochrechnung oder historische Budgetbehauptung.

Der Vermögensverlauf folgt 06 mit Profilbezug und Captureaktion im Kartenkopf,
drei Istkennzahlen als `ds-kpi-strip`, nominaler Linie/Fläche in
`ds-chart-surface`, Legende und vollständiger Tabelle in `ds-table-box`.
Die benannten Scrollregionen behalten Fokus, Mindestbreiten, Datenpräzision,
Marker und tatsächliche Datumsabstände. Ausdrückliche nominale Vertragsausnahme:
keine vierte Kaufkraftkennzahl, keine reale Linie und keine neue Renditemetrik.
Beide SVGs haben Pixelbreite gleich viewBox-Breite und eine feste Höhe
(Vermögen 360 px, Jahresausgaben 270 px mit maximal 140 px hohen Säulen).
Die Breite umfasst die nutzbare Hostbreite und die datenabhängige Mindestbreite;
13-px-Schrift und 8-px-Anlassmarker wachsen nicht mit der Karte. Eine einmalige
`bindBalanceDisplaySize`-Bindung zeichnet bei Resize und Taböffnung aus der
letzten validierten Anzeigeprojektion, ohne Speicherzugriff oder Neuberechnung.
Ohne ResizeObserver bleibt die initiale Grafik endlich. Jahresausgabensäulen
beginnen bei null. Die Verlaufsachse nutzt kleine Datenränder und äußere glatte
1/2/5-Zehnerpotenzen, ohne erzwungenen Nullstart. Am endlichen Zahlenrand
begrenzt sie äußere Ticks auf ±Number.MAX_VALUE; normierte Koordinaten vermeiden
Überlauf. Achsen-/Betragslabels, SVG-Titel und Tabellen zeigen ganze Euro.
Dichte Jahres-/Abschlusslabels werden ausgedünnt; alle Records bleiben in
Markertiteln und Tabelle erhalten. Alle Balance-Captions bleiben zugänglich, visuell auf eine abgeschnittene 1-px-Fläche ohne Padding/Rand begrenzt.
Hinweise der Matrix und beider Historientabellen erscheinen ausschließlich bei tatsächlichem horizontalem Tabellenüberlauf,
aktualisiert nach Inhaltswechsel, Taböffnung und Größenänderung.
Leere Status-/Live-Absätze bleiben im Accessibility-Baum; nur ihr Außenabstand
entfällt mit `margin: 0`. Geöffnete leere Diagramm-/Tabellenkapseln bleiben
benannt und fokussierbar mit 2 px Mindesthöhe, ohne Rahmen, Flächenton oder
Innenabstand. Der sichtbare Leerhinweis bleibt erhalten; inaktive Reiter hidden.
1920/2560 px werden
extern gegen 05/06 abgenommen. Vermögensstände bleiben die im aktiven Profil
gespeicherten Profil-/Verbundstände. Manager nennt den Tranchenwert ohne
Tagesgeld, Einheiten für Preise und Gewinn sowie Kaufdatum; keine Kursaktualität
wird erfunden.

Nachweise: `designsystem-layout.test.mjs` verwirft fehlende Schrumpfregeln, feste
Seitenspalten, entfernte Scrollkapseln, Tooltip-only-Auswahltexte und globales
Abschneiden. `designsystem-data-display.test.mjs` prüft echte Renderer mit
synthetischen Daten, Skalierung und unveränderten Speicher-/Exportgrundlagen.
Der registrierte Browserfall `Designsystem data layout` ergänzt lange Namen,
Auswahlwechsel/Reload, gefüllte Tabellen, aktive/inaktive Balance-Verläufe,
Tastaturscrollen mit Fokuserhalt und bisherige Druckausblendung/-reihenfolge bei
1366/1920/2560 px. Inventarbelege I02, B25/B26/B30/B31/B32/B43 und V11/V12 nennen
nur diese Teilnachweise. Node-Prüfungen ersetzen keine Browserabnahme.

### Browserkorrekturen und Anzeigevertrag

Sichtbare Zahlen erhalten Dezimalkomma und genau U+00A0 vor Einheiten.
`75,0\u00a0%` bleibt einstellig, `75,00\u00a0%` bleibt zweistellig;
bestehende Tausenderpunkte, Vorzeichen, Ratio-Skalierung, Null-/Fehlwertregeln
und Rundungsverfahren werden je Consumer erhalten. `formatDisplayFixed`
bleibt einheitenlos und verwendet weiter `toFixed`, einschließlich binärer
Halbwerte. Technische SVG-Attribute, Parser, Eingaben und Speicherwerte bleiben
unverändert. Die expliziten `formatDisplayPercentValue`-/
`formatDisplayPercentRatio`-/Monats-/Einheitenvarianten in `shared-formatting.js`
ergänzen die Legacy-Formatter, deren Defaultausgaben für Kopie und Export gelten.

Die fünf belegten Balance-Verbraucher ändern nur Anzeigezweige.
`balance-diagnosis-format.js`, der gemeinsame Guardrailpayload und
`balance-renderer-summary.js` bleiben unverändert. Die Zusammenfassung bekommt
den Einheitenabstand über ihre vorhandene Anzeigehilfe. Backtestspalten haben
einen ausdrücklich gewählten Anzeigezweig; Exportspalten behalten Legacytexte.
`designsystem-display-contract.test.mjs` schützt vollständige vor der Umstellung
festgehaltene UTF-8-Bytes der tatsächlichen Diagnose-, Backtest- und
Szenariologfunktionen einschließlich LF/CRLF, ergänzend zur Rohdatengleichheit.
Die aktuelle Backtest-Downloadaktion wird zusätzlich bis zum tatsächlichen Blob
aufgerufen; vollständige feste JSON-/CSV-Zeugen stammen vom unveränderten Basisstand.
Die Diagnoseformatprüfung bleibt unverändert; Kopierprüfungen behalten Einheiten, Werte und vollständigen Fachinhalt bei erlaubten deutschen Labeländerungen und gemeinsamer Aktionsquelle.

Startseitenübergänge nennen einzelne Eigenschaften und animieren keine Outline.
`Designsystem components` misst aktiven Tastaturfokus, Akzentfarbe, `solid` und
Ringbreite. Die Fixture von `Designsystem tools` beantwortet beide echten
Paretofragen mit `medianEndWealth` und `worst5Drawdown`; SVG, reale Sweepdaten,
Ranking und Übernahme bleiben geprüft. `Simulator Sweep integration` und der
vollständige Managerfall ändern ausschließlich Anzeigeerwartungen.

Der SVG-Syntaxtest entdeckt alle Bilder unter `assets/images/` automatisch,
prüft Elemente, Attribute, Entitäten, Kommentare, CDATA und genau eine Wurzel
und lehnt unsupported Deklarationen ab. Die PNGs im Handbuch werden gegen das
Bildmanifest und durch Laden im Browser geprüft. In `system_overview.svg` ist nur
das nackte Ampersand maskiert. Diagrammprojektionen normalisieren U+00A0 vor
Prozent ausschließlich in Textknoten; die alten Digests bleiben erhalten und
exakte deutsche Labelassertions schützen den neuen Abstand separat.

Die Node-Nachweise ersetzen keine Browserabnahme. Die registrierten Browserfälle
müssen außerhalb der Agentensandbox vor dem Merge ausgeführt werden.

### Benannte Richtungen und unbewertete Zahlen

Reale Depotentnahme P10 einschließlich „Median der Run-P10“ sowie nominale und
reale Drawdown-Median-/P90-Karten verwenden `default`. Die gleichartigen
Stresskarten folgen demselben Vertrag. Zahlen, konservative Rundungen,
Verfügbarkeitsgründe, Beschreibungen und Rohdaten bleiben erhalten; es entsteht
keine Bewertungsschwelle. Die vollständigen Viewmodel-Digests bleiben bestehen:
eine explizite Projektion benennt nur diese acht Karten und ihre früheren Töne.
Direkte Ton- und Markupassertions schützen die neuen neutralen Anzeigen separat.

Optimize-Differenzen sind bei exakt null einschließlich `-0` mit `--text-main`
neutral. Erfolgsquote und Endvermögen behalten positive/grüne und negative/rote
Richtung; Drawdown und Zeitanteil behalten die umgekehrte Richtung. Auch kleine
Rohwerte behalten ihre Richtung ohne Rundungs-Nullschwelle. Die Textdigests und
der deutsche Progressvertrag bleiben erhalten. Der Manager zeigt Nullgewinn
ohne `positive`/`negative`; Gewinnstatistik bleibt neutral. Steuerersparnis
verwendet ausschließlich bei verfügbarem `perRunMean > 0` den positiven Ton.
`small_sample`, technische Fehler, Recovery, Cash- und Bestandswarnungen sowie
alle sonstigen bestehenden Schwellen bleiben begründet und unverändert.

Das echte dynamische Buchsymbol vor „Benutzerhandbuch“ erhält `--space-2` als
logischen Außenabstand; Größe, Schmucksemantik, Link und Fallback bleiben erhalten.
Profilverbundkacheln einschließlich `.compact` umbrechen vollständig; der
Profilheader lässt bei Platzmangel die Namen auf eine eigene Zeile. Namen-Spans
verwenden normalen Wortumbruch mit `overflow-wrap: anywhere` für lange Wörter.
Checkboxen verwenden ihre eigene Breite und schrumpfen nicht. Der Browser misst
Textzeilen, Clipping, kurze Namen und Checkboxgeometrie bei 1366/1920/2560 px.

V03 besitzt genau eine dynamische, sichtbare und ARIA-verknüpfte Rentenerklärung.
Der alte statische `profileRenteHelp` entfällt samt Referenz. Inventar und
Erzeugergegenprobe schützen `.ds-field-reason` an `setFieldState`; Ableitung,
Sperre, Init, Einkommensänderung, Reload und vorhandene Fehler-/Rollbackpfade
behalten ihren Fachvertrag. Browserausführung durch Steuerung ausstehend.

### Statischer Suite-Rahmen

`css/suite-frame.css` folgt auf die Seitenstile. `.suite-shell` und `.suite-content`
sind benannte Inline-Size-Container. Der Kopf verwendet `--space-2` vertikal und `--space-4` horizontal, mit Standardziel 56 px und Wachstum bei mehr Inhalt. `#suiteContext` enthält die aktive Identität und alle globalen Seitenmetadaten genau einmal. `.ds-page-head` ordnet Rubrik, Titel und vorhandene Aktionen auf Titelhöhe sowie vollständige Untertitel; die Umschaltung ist eine `suite-content`-Container-Query. Kopf und volle Leiste verwenden lokale
Flächen-, Rahmen-, Radius- und Abstandstokens. Die Leiste misst ausschließlich
`suite-shell`: unter **82rem** automatisch 4rem; ab 82rem gilt die manuelle Wahl
(12rem/4rem). Abstand und Außenabstand sind jeweils `--space-4` (1rem).
Das Budget bei 16px Grundschrift lautet: ausgeklappt mindestens 1312 − 192 − 16 =
1104px Hauptinhalt; kompakt werden 128px frei. Bei 1366/1920px und je 16px
Außenabstand sind rechnerisch 1334/1888px außen bzw. 1126/1680px Hauptinhalt
verfügbar. Browsermessungen der tatsächlichen Boxen stehen noch aus. Unter 40rem bleibt
der vorhandene gestapelte Rahmen erhalten; seine Navigation bleibt kompakt.

Die Symboltaste verwendet `panel-left-close`/`panel-left`, zugänglichen Namen,
Tooltip, `aria-controls`, `aria-expanded` und sichtbaren Fokus. Unter der Grenze
ist sie gesperrt und ausdrücklich als automatisch kompakt benannt. Navigationslinks
behalten in Symbolansicht Namen, Tooltips und Fokus. Nur manuelle Aktionen speichern
`ui_suite_sidebar_collapsed` im Gerätestorage; Laden und Resize schreiben nichts.
Wiederverbreitern stellt die manuelle Wahl wieder her. Schreibfehler blockieren
keine Profilübergabe und erhalten die Wahl für das Dokument.

`#suiteProfileContext` zeigt nach Seitenbereitschaft die validierte aktive Identität
als Text. Neutralzustände: „Profil wird geladen“, „Kein aktives Profil“,
„Profil nicht verfügbar“. Der Reader initialisiert oder sichert nichts. Balance
zeigt `#suiteHouseholdContext` als Berechnungsumfang aus der Summary; Simulator zeigt darin die aktuelle Haushaltsauswahl. Sein gespeicherter Laufumfang bleibt separat als „Letzter Lauf“ und unter „Gerechnet mit“ erhalten. Startseite, Ausgaben und Daten & Sicherung nutzen ihre bestehenden Modellhosts im selben Kopf; der Manager nutzt die gemeinsame Profilidentität auch für die Kursprovenienz. Das Handbuch bleibt mit reinem Profilkontext kompatibel.

Fünf echte Links bleiben mit sichtbaren Textnamen bedienbar, aktiver Link mit
`aria-current="page"`; `house`, `scale`, `chart-no-axes-combined`, `wallet`,
`book-open` und Marken-Symbol `landmark` sind lokal und dekorativ. Der Sprunglink
führt zu `#suiteMain`. Tastaturfokus ist sichtbar. `#suiteNavigationStatus` ist
ortsgebunden oberhalb Navigation/Inhalt und unabhängig von Recoveryhosts.

Inhaltsumschaltungen messen Balance `suite-content` (1250px), Manager `manager`
(980px) und Simulator `simulator-panel` (1000/899px). Die bisherigen Panelregeln
bleiben ergänzt erhalten. Neue Regeln verwenden weder `!important` noch globales
Abschneiden. Druck entfernt Kopf, Navigation, Sprunglink und Rahmenstatus und
hebt Rahmencontainer auf; Fachinhalt und bestehende Druckverträge bleiben erhalten.

Der Rahmen ersetzt die reinen Start-/Rückanteile B01/S01/V01/H01. Die frühere
Handbuch-Navbar und Manager-Rücklinkstyles entfallen; ihre Farbprüfungen prüfen
jetzt weiße Rahmenflächen, dunkle Linknamen, den neutralen Aktivzustand und das
Fehlerpaar. Kontrast-, Quellen-, Prioritäts- und Layoutschutz gelten weiter.
`#managerBackLink` ist der eindeutige delegierte Rahmenlink zur Übersicht; sein
bestehender Erzeuger aktualisiert Profil-ID und ARIA-Beschreibung. Fachaktionen,
Hilfe im neuen Tab, Startkarten, Manager-Einstieg, Recovery und Handbuch-Kapitelnavigation
bleiben erhalten. Es entstehen keine zusätzlichen Stylesheetquellen oder
Prioritätsdeklarationen. Der registrierte Browserfall `Suite frame navigation replacement`
aktiviert diese Wege einschließlich Fehlern und Gegenproben auf der endgültigen
DOM-Struktur. Tatsächliche Browserbreiten, Druck, BFCache und Kandidaten-EXE
bleiben separate Abnahmen.
Navigationsschutz ist angeschlossen; Ergebnisse werden noch nicht über Seitenwechsel hinweg gespeichert.

### Übergänge und Schreibschutz

Jeder geänderte Übergang hält fest, was erhalten bleibt, was veraltet ist und wohin der Rückweg führt. Neue Zuordnungen oder Speicherverträge brauchen einen eigenen Auftrag.

| Übergang | Geltende Vorgabe und Quellen |
|---|---|
| Simulator → zentrale Personendaten → zurück | Aktuelle Annahmen und der verwendete Laufstand bleiben getrennt. Änderungen entwerten die Aktualität des Ergebnisses. `app/simulator/simulator-result-overview.js` und die Runnerbinder führen diesen Zustand. |
| Balance → bestätigter Verkauf → zurück | Nur die bestätigte Buchung ändert den Realbestand. Balance rechnet mit dem neuen Stand. Eine Zuordnung „Buchung erledigt Empfehlung“ wird nicht eingeführt. `app/tranches/tranchen-manager-page.js`, `app/balance/balance-main.js`. |
| Personenwechsel | Aktive Person und Haushaltsumfang bleiben getrennt. Ein fremdes Ergebnis erscheint nicht als aktuelles. `app/profile/profile-navigation.js`, `app/shared/suite-frame.js`. |
| Abschluss → Daten & Sicherung | Offene Writes und Recovery bleiben ortsfest sichtbar. Die eigene Sicherungsseite ist der aktuelle Ort; die Übersicht liest Bestände und Belege. `app/shared/annual-coordinator.js`, `app/data/data-page.js`, `app/overview/overview-model.js`. |
| Ausgabenimport → Auswertung | Import und automatische Vermögenserfassung behalten ihren gemeinsamen Datenpfad. Fehlende Vergleichsstände werden nicht rekonstruiert. `app/expenses/expenses-main.js`, `app/overview/overview-model.js`. |

`app/shared/navigation-guard.js` trennt abbrechbare Vorbereitung, geschützte Writes und Recovery. Laufende Berechnungen werden vor einem bestätigten Seitenwechsel beendet. Während Write, Validierung, Finalisierung und Restore bleiben Appnavigation und Dialogschließen gesperrt. Ein Fehler nach Schreibbeginn wird nicht als folgenloser Abbruch dargestellt. Dasselbe gilt für Import und Verkaufsabgleich.

Browsernavigation über Dokumentgrenzen, Reload und Fensterschließen haben nur den begrenzten Schutz von `beforeunload`; der Nutzer kann das Verlassen bestätigen. Browser- und Betriebssystemkürzel bilden keine zusätzliche Sperrebene, eine History-Falle wird nicht eingeführt. In Tauri hält das Schließprotokoll den Versuch während eines geschützten Writes an. Quellen: `app/shared/persistence-facade.js`, `src-tauri/src/lib.rs`.

Ergebniserhalt über Seitenwechsel bleibt ein offener Auftrag. Solange er fehlt, fragen die Simulatorbinder vor dem Verlust eines fertigen Ergebnisses nach. Ein späterer Sitzungscache muss Profil, Haushaltsumfang, normalisierte Eingaben, Version, Zeitpunkt und Laufkopf gemeinsam sichern. Er darf Profil-, Backup- und `window.name`-Verträge nicht verändern. Bei Rückkehr sind geänderte Werte mit „vorher → jetzt“ zu benennen; nicht erhaltene Details brauchen einen Hinweis. Kurzfassung und neu gerechnete Details dürfen nicht gemischt werden. Scheitert der Cache, bleibt die Verlustnachfrage. Der Code behauptet derzeit keinen solchen Cache: `app/simulator/simulator-monte-carlo.js`, `app/simulator/simulator-backtest.js`, `app/simulator/simulator-sweep.js`, `app/simulator/auto_optimize_ui.js`.

### Navigationsnachfrage

Alle fünf Seiten besitzen einen statischen nativen `#navigationGuardDialog` mit
zugänglichem Namen und Beschreibung. `showModal()` hält den Hintergrund einschließlich
eines offenen Fachdialogs inert. Erstfokus: **Bleiben**; Tab/Shift+Tab bleiben zwischen
den beiden Bedienzielen; Escape bedeutet Bleiben und erreicht keinen Dialog darunter.
Nach Ende geht der Fokus zum konkreten Auslöser zurück. Der neue grafische
Backdrop mit `var(--backdrop)` lässt die Seite sichtbar gedimmt durchscheinen.
Die gemeinsame Klassenregel setzt `margin: auto` und `padding: var(--space-6)`
resetfest gegen universelle Rücksetzungen und die schwächere Kartenregel durch.
Zentrierung und Innenabstand gelten auf allen fünf Seiten für Seitenwechsel,
Verwerfen und Anwendungsschluss. Dialogfläche (`var(--surface)`) und Text
(`var(--text-main)`) bleiben opak, ohne reduzierte Dialog-/Elterndeckkraft.

Bei Seitenwechseln lautet der zugängliche Titel **Seite verlassen?**, der
Bestätigungsknopf **Trotzdem wechseln**. Direkte Dirty-Schließwege der Tranche-/
Cashdialoge verwenden stattdessen **Änderungen verwerfen?** und **Verwerfen** mit
der Beschreibung „Ungespeicherte Eingaben gehen verloren – trotzdem verwerfen?“.
Jedes Öffnen setzt den Wortlaut passend zum Vorgang; eine spätere Linknavigation
zeigt wieder die Seitenwechselvariante. **Bleiben** erhält in beiden Fällen die Eingaben.

Ergebnisgrund: „Ergebnis geht verloren – trotzdem wechseln?“; Eingabegrund:
„Ungespeicherte Eingaben gehen verloren – trotzdem wechseln?“; Rechnung benennt
explizit den Abbruch. Mehrere Gründe erscheinen in einer Nachfrage. Ein aktiver
Commit zeigt seinen Wartehinweis am ortsfesten `#suiteNavigationStatus`, ohne einen
Verlustdialog zu öffnen. Neue Gründe während Nachfrage/Abbruch/Flush verwerfen die
Zustimmung und verlangen einen neuen Versuch. Der Dialog führt keine Fachwrites aus.

Tranche-/Cashbaselines umfassen tatsächliche Formularwerte, Checkboxen und Selects.
Sie entstehen nach vollständig befülltem Öffnen und bestätigtem Speichererfolg;
Rückänderung zum Ausgangswert ist sauber. Bei Dirty fragen direkte Schließwege nach
Verwerfen; während echter Page-Commitflags bleiben Escape, Overlay und Schließknopf
gesperrt. Native Browsernachfragen sind browsergegeben und kein Ersatz für diesen
zugänglichen Appdialog oder einen bestätigten Appflush.

### Manager-Schreibabschluss

Der Wartehinweis `Manager schreibt – bitte warten.` gilt ab erster Mutation bis
zum bestätigten Flush und vollständigen Rückschreib-/Fehlerabschluss. Escape,
Schließ-/Abbruchknopf, Overlay und programmatische App-Linkaktivierung verwerfen
in dieser Phase keine Eingaben; ein übernommener EXE-Schließversuch bleibt offen.
Auch ein intern als `confirmed` markierter Schluss muss alle fremden Writes
respektieren. Der eigene Erfolgsschluss leiht ausschließlich seinen aktiven
Besitzer, nach Flagende und Rerender; er endet genau einmal. Ein Fehler ersetzt
keine Dialogbaseline und meldet keinen Speichererfolg.

Die nativen Dialogaktionen `#retryTrancheDialogSaveBtn` und
`#retryCashPostingSaveBtn` tragen `type="button"`, den Namen **Speichern erneut
versuchen** und bestehende sekundäre Aktionsklassen. Sie stehen außerhalb der
live angekündigten, textuell ersetzten Fehlerhosts, innerhalb des Fachdialogs.
`renderPersistenceState` zeigt den passenden Auftrag und sperrt Retry bei echtem
Write/Rollback; der Seitenknopf bleibt bedienbar. Wiederholen übernimmt gespeicherte
Daten/IDs ohne neuen Submit. Erfolg schließt nur dieselbe unveränderte
Dialogöffnung. Spätere Eingaben erhalten einen ortsfesten Hinweis und bleiben
unbestätigt geschützt; Tranche behält ihre bestätigte ID, Cash erzeugt keinen
automatischen Folgeauftrag. Eine neue Dialoginstanz bleibt erhalten.

Noch unbestätigte Profil-/Abgleicheingaben und Wiederholungsaufträge sind
revisionierte Verlustgründe. Rückänderungen zum bestätigten Stand sind sauber,
Retrymarker ohne laufenden Handler bleiben bedienbar und erzeugen keine
Dauersperre. Profilwertefortsetzungen behalten den Commit ohne Freigabelücke.
Kursvorbereitung bleibt abbrechbar; Navigation wartet alle Batchjobs ab.
Cashoverlay-Mousedown erhält wie beim Tranchendialog den Fokus im Editor.

Belege: `tests/tranchen-manager-navigation.test.mjs`,
`tests/tranchen-manager-modal.test.mjs` und die registrierten Browserfälle
`Navigation guard manager commits`, `Navigation guard manager dirty inputs`,
`Navigation guard manager price preparation`. Browser-/EXE-Erfolg wird daraus
nicht ohne externe Ausführung abgeleitet.

### Reset-, Recovery- und Profilstatus

Bestehende Resetbestätigungen und Recoveryexportpflicht bleiben vor der
Schutzentscheidung. Bleiben erhält Werte und Fokusauslöser. Reset/Recovery
sperren ihren Aktionsknopf bis zum Flush-/Fehlerende; fremde Appnavigation
überholt den Commit nicht. Neue Eingaben entwerten eine erteilte Zustimmung,
geben aber einen begonnenen Write nicht frei. Speicherfehler stehen am
bestehenden Reset-/Recoveryhost; Zustandsänderungen am Rahmenstatus. Nach Fehler
bleibt Wiederholung erreichbar; Erfolg verursacht genau einen Reload. Profilwrites
behalten die bisherige lokale Identitätsanzeige, Erfolg erst nach Adapterabschluss.
Dirtybaselines und Jahresdialogphasen werden durch diese Fortsetzungen nicht
quittiert. Der zugängliche App-/EXE-Dialog und die begrenzte browsergegebene
Nachfrage bleiben getrennte Verträge; kein Browser-/Betriebssystemkürzel wird
zusätzlich gesperrt. Ergebnisse werden noch nicht über Seitenwechsel hinweg gespeichert.

## Arbeitsbereiche

### Übersicht

Vier Kopfpillen, lokales Datum, Überschrift, Vermögenskarte mit Allokation und
Personenzeilen sowie Plankarte ersetzen die alten Appkacheln. `css/overview.css`
nutzt die bestehenden Farb-/Schriftrollen; Kennzahlen folgen
`--balance-budget`/`--balance-budget-wide`, Überschrift `--balance-h1` und
Kartenüberschriften `--balance-kpi`. Das 7/5-Raster stapelt im vorhandenen
`suite-content`-Container; lange Personennamen brechen um. Sicherungen sind
initial geschlossen, Recovery liegt darüber. Die Fokuskarte belegt links die
erste Rasterzeile, Vermögen und Plan rechts. Das Jahresband steht links in der zweiten Rasterzeile neben dem Plan;
der Bildvergleich 1920/2560 px bleibt extern offen.

Die Fokuskarte übernimmt den Messingverlauf bei Jahres-/Monatsanlass. Im ruhigen
Anlass und ersten Planungsjahr gibt es keine Fokuskarte; Abschlusstermine und
Tagesgeldwarnungen stehen als schlichte Zeilen vor den Kennzahlen. Der Fokustitel
verwendet die vorhandene 28-px-Rolle `--balance-verb`.
Kopficon 52 px, Kopfgap 18 px, Schrittraster
`34px minmax(0,1fr) auto`, Gap 14 px und 13 px vertikale Schrittpolster folgen
Referenzen 01–04. Datenzustände erhalten nicht bedienbare Haken; nur
Bereitstellung und vorhandene Aktionen sind Knöpfe. Simulatorwerkzeuge bleiben
über die Seitenleiste erreichbar. Kursdetails bleiben erreichbar
bei Laden, Offline und Teilfehlern; Pille und Schritt teilen denselben Bericht.
Sicherungsempfehlung nach mehr als sieben Tagen und Warnpille ab 30 Tagen sind
getrennte Rollen. Fehlende Importe/alte Sicherung sperren den Jahreslink nicht.

Managerhilfen und Balancehilfen teilen einen Binder. Escape setzt `data-visible`
auf `false`, auch bei verbleibendem Fokus; CSS erzwingt kein Öffnen durch Hover
oder Fokus. Managerdezimalfelder sind lokalisierte Texteingaben; kanonische
Records und Fachvalidierung bleiben unverändert.

Das Jahresband (`overviewYearBand`) verwendet zwölf beschriftete Monatsplätze,
150 px Balkenraum, 8 px Gap und vier Kennzahlen im 4er-Raster. Dunkle Ausgaben,
Messing für Überschreitung, Schraffur für Teilbelegung sowie getrennte fehlende
und offene Zustände werden zusätzlich als Text benannt. Die gestrichelte
Budgetlinie erscheint nur mit passendem gespeichertem Jahres-/Umfangsrecord.
`ds-sr-only` liefert Textalternativen; schmale Container erhalten horizontales
Diagrammscrollen. Bis 85 rem Inhaltsbreite stehen die Kennzahlen in zwei Spalten;
ihre ⓘ-Knöpfe und Popups bleiben im Fenster. Geldwerte folgen dem bestehenden
Anzeigeformatter und lokale Schriftrollen bleiben unverändert.

Willkommen verwendet dasselbe 7/5-Raster mit zwei Karten, zwei vorhandenen
Aktionswegen und der Liste „Wann du was tust“. Die normale Übersicht und das
Jahresband sind dann verborgen, Backupkarte und Recoveryhosts bleiben außerhalb.
Keine Demoaktion. Quellenprüfungen bestätigen Aufbau und Datenverträge; externe
Optik-/Browserabnahme der Übersichtszustände 01–06/08 bei 1920 und 2560 px sowie
Nutzerprüfung in der Kandidaten-EXE bleiben offen.

### Personen & Vermögen – obere Seitenstruktur

Der bisherige Dateieinstieg bleibt. Die einzige Ansichtsreiterliste steht vor allen großen Inhaltskarten. „Haushalt & Plan“ enthält Haushalts-/Personenübersichten neben dem Plananfang; die Personenansicht beginnt mit der zunächst geöffneten Person-&-Einkommen-Karte. Messbeginn, Messstatus und Zeitraum liegen in eindeutigen vorhandenen `ds-info`-Popovers, Qualitätswarnungen bleiben außerhalb sichtbar. `css/personen-vermoegen.css` verwendet `--balance-h1`, `--balance-h3`, `--balance-body`, `--balance-help` und `--balance-amount`; bei breitem Inhaltscontainer gilt `--balance-amount-wide`. Kurze Herkunfts- und Zeittexte verwenden `--text-base` (16 px). Die gekürzten Erklärzeilen verwenden `ds-explanation` mit `--text-sm` (14 px); der unveränderte Langtext steht im vorhandenen `ds-info`-Fenster. Beim Geburtsdatum bleibt das Planalter offen, bei Reichweite und Haushaltsverteilung nur der kurze Hinweis. Der Planvergleich zeigt seine Erklärung im ⓘ und die Einzelbeträge in geschlossenen Details mit mindestens 14 px. Zusammenfassungszeilen zugeklappter Karten verwenden `--value-md` (17 px) mit `--font-sans`; Überschriften und große Beträge behalten Serifenschrift. Im Reiter Verlauf verwenden Titel und Kennzahlen `--value-lg` (30 px) mit `--font-serif`, der Endbetrag im Diagramm `--value-md` (17 px). Die Herkunftszeile vor der Kurve bleibt kleiner Erklärungstext in `--text-sm`. Leere Status- und Hinweiszeilen belegen keinen Platz. Die Legende erklärt nur gezeichnete Elemente; Ereignisbeschriftungen haben feine Verbindungslinien. Keine neuen Pixelschriftgrößen. Karten und Felder schrumpfen über den Manager-Inhaltscontainer; lange Namen umbrechen. Die Vermögensverteilung folgt ausschließlich dem gespeicherten Bestandstyp und Tagesgeld, niemals einer neu erfundenen Kaufdatumsregel.

Karten sind rein lesend; ungültige Profildaten werden ausdrücklich als unvollständig bezeichnet. Vermögen, Buchgewinn und Pflegereserve-Ziel besitzen getrennte Beschriftungen. Die native Technikklappe bleibt initial geschlossen. Recovery- und Speicherfehler sind außerhalb der Klappe sichtbar. Reiter und „Öffnen“ bleiben benannte native Knöpfe; sie benutzen denselben Speicher-/Navigationsweg. Optische Abnahme der Zustände 01–03/13 bei 1920/3440 px durch die Steuerung steht aus.

### Personen & Vermögen und Tranchenstatus

Alle Manager-Grundbausteine und dynamischen Cashdialog-/Statusfragmente verwenden
gemeinsame Tokens. Statistik ist neutral mit `ds-metric`, Tabellen besitzen
`ds-table`/`ds-table-scroll`, Symbolaktionen `ds-icon-button` und ihre bisherigen
`aria-label`. Violette Flächen, feste Altfarben und Textdeckkraft sind entfernt;
nur der grafische Modalhintergrund mischt den Haupttexttoken mit Transparenz.
Kategorien und Steuerhinweise sind beschreibend, Gewinn/Verlust behalten ihre
bestehenden Vorzeichen mit `--good`/`--bad`; exakte Null bleibt neutral. Leer-/Nichtgeladenstatus bleibt
neutral, Bestands-/Auditfehler verwendet `--bad`/`--bad-soft`, offene manuelle
Cashbuchung `--warn`/`--warn-soft`. Altverkäufe bleiben ausdrücklich ohne
Cashbestätigung. Bestehende Invalid-Prioritäten sind unvermehrt auf Tokens gesetzt.

V03 zeigt den aus Monatsrente plus sonstigen Einkünften abgeleiteten Status als
`adopted` mit sichtbarem verknüpftem Grund. Die Darstellung erhält den bereits
normalisierten Wert und die bestehende Selectsperre bei Init, bestätigtem
Profilupdate und Rollback. Sie verändert keine Profil-Speicherobjekte und keine
Validierungs-/Speicherregeln. V11/V12/V24 besitzen additive Erzeugerbelege im
Inventargate; entfernte Rollen werden gezielt abgewiesen.

`designsystem-manager.test.mjs` prüft echte Fragmente, deutsche Anzeige mit
expliziten Zahlen-/Texterwartungen, unveränderte Lots, Statuszweige und Cashdarstellung. Quellengegenproben verwerfen
Altfarben, Textdeckkraft und ungültige Aliase; Zustandsgegenproben im Profiltest
verwerfen fehlende/versteckte Beschreibungen und entfallene Sperren. Unbenannte
Symbolaktionen scheitern ebenfalls. Der registrierte Browserfall
`depot-tranchen-manager.html` ergänzt Herkunft nach Autosave/Reload, fünf
Null-/Verlustkennzahlen, leere/gefüllte Tabelle, Fehlerfarben, Öffnen/Speichern,
Escape/Abbruch mit Rückfokus und den vorhandenen Schutz vor doppeltem Submit.
Node-Prüfungen ersetzen keine Browserabnahme.

### Personen & Vermögen – Depot und Dialoge

Die Depotkarte zeigt einen Kopf mit aktivem Profil, die Tranchensumme, vier Bewertungskennzahlen und einen belegten UTC-Kursstand. Die Tabelle zeigt gruppierte Anlageformen und Kaufdatumssortierung mit Gruppensummen, unabhängige Steuer-/Teilfreistellungsangaben und Kursdatum neben dem Preis. Die tatsächlichen Erzeuger behalten `ds-table`, `ds-table-scroll`, Kennzahlrollen und benannte SVG-Zeilenaktionen. Lange Namen umbrechen, Zahlspalten bleiben tabellarisch und die schmale Tabelle intern scrollbar.

Kauf/Bearbeiten nach 04/05 besitzt Modustitel, Tagesgeldhinweis, Anlageform-/Bestandssegmente, dreispaltiges Feldraster und Vorschau-/Aktionsfuß. Name spannt zwei Spalten; schmale Dialoge zeigen eine Spalte. Benannte Segmentknöpfe bedienen die verborgenen nativen Select-Wertträger mit dem bisherigen change-Ereignis; Typmatrix und Tastaturbedienung bleiben erhalten. Alle Formularfelder einschließlich expliziter Steuerfreiheit und freier Notiz bleiben erhalten. Geldfelder stehen rechtsbündig und zeigen Tausenderpunkte ohne Rundung; beim Bearbeiten entfällt die Gruppierung. Der vorhandene Zahlenadapter erhält kanonische Werte und löst beim Formatieren keine Eingabeereignisse aus. Kopf-Schließen, Abbruch, Escape und Retry benutzen die vorhandenen Schutzwege. `--balance-h2`, `--balance-kpi`, `--balance-body` und `--balance-help` bestimmen die neuen Rollen; ab 2300 px Inhaltsbreite verwendet die Bewertung `--balance-big`. Kein neuer Pixelschriftwert und kein Datierungs-/Speichervertrag. Bildvergleich 01–05 und Grundbedienung durch die Steuerung sind noch offen.

### Personen & Vermögen – Verkauf und Verwaltung

Verkauf benutzt einen Dialog mit drei nummerierten Schritten „Ausführung“, „Cash“, „Vorschau“. `pv-sale-progress` markiert den aktuellen Schritt über `aria-current="step"`; verborgene Fieldsets liegen außerhalb der Tabfolge. `pv-sale-step` und `pv-dialog-fields` benutzen vorhandene `--balance-h3`, `--balance-body` und `--balance-help`. Namentliche native Tranchenauswahl, Ausführungs-Kennung, Datum, Stücke, Erlös, Kosten und optionale Empfehlung bleiben erreichbar. Rückkehr erhält den Entwurf; Vorschau schreibt nichts, dauerhafte Bestätigung bleibt gesondert. Cash „Ja“ zeigt den Pflichtstand, „Nein“ erläutert die offene manuelle Buchung. Die Cashliste bleibt als eigene Karte außerhalb des Dialogs sichtbar, einschließlich Legacy und unlesbarem Audit.

„Personen verwalten“ öffnet `pv-people-dialog` mit lesender Metadatenliste, Haushaltscheckbox (`ds-checkbox`), Umbenennen, bestätigtem Löschen und Namensfeld für neue Personen. `pv-person-row` bricht lange Namen/Bedienaktionen um. Finanzwerte pflegt der aktive Reiter. Beide zusätzlichen Dialoge nutzen dieselben Verwerf-, Commit-, Escape-/Overlay- und Fokusverträge wie die bestehenden Managerdialoge. Fehler erscheinen im Dialog und in den bestehenden sichtbaren Status-/Recoveryhosts; Technik bleibt standardmäßig zugeklappt. Browser-/Bildabnahme 06–09/12/13 bei 1920/2560 und breiter Darstellung erfolgt extern.

### Personen & Vermögen – Startkurse und Zustände 10/11

Die Übersicht besitzt mit `#startupPriceTitle` und `#startupPriceStatus` einen ortsfesten, höflich angekündigten Kursstatus außerhalb „Erweitert“. `ds-startup-prices` verwendet die bestehende Kartenrolle, `--balance-h3`, `--balance-body`, lokale Schriften und umbrechende Texte. Der Host zeigt Warten, Fortschritt, vollständige oder teilweise Bestätigung, Offline/Timeout, Quellenänderung und Speicherfehler. Pro Profil/Tranche stehen Anzahl und verständlicher Grund; Abrufzeit und echter UTC-Kursstand bleiben getrennt. Vorhandene Profil-/Navigationsfehler werden nicht überschrieben.

In „Personen & Vermögen“ ergänzt `#managerQuoteContext` den gemeinsamen `#suiteContext` mit tatsächlich gespeichertem Kursstand. Unbekannte, teilweise bekannte, gemischte und über sieben Tage alte Kurse bleiben erkennbar; der manuelle aktive Profilknopf bleibt bedienbar. Zustand 10 ist Teilaktualisierung mit erhaltenen Fehlkursen, Zustand 11 zeigt Offline und vorhandene Kurse. Weder Profilzeit noch Appstart datieren einen unbelegten Preis. Der Manager erzeugt keinen zweiten Startabruf. Die übrigen Personen-, Depot- und Verkaufsrollen behalten ihre dokumentierten Tokens und Schutzverträge.

Quellen-/Nodeabsicherung ist vorhanden. Die optische Abnahme aller 13 Referenzzustände bei 1920/2560 und breiter Darstellung bei 3440px/100 %, Browser-Smoke, Tastatur-/Screenreaderbedienung und Kandidaten-EXE bleiben bis zur tatsächlichen Prüfung durch Steuerung offen.

### Balance – Herkunft, Meldungen und Datenloszustände

Balance-Markup ergänzt Rollen an bestehenden Buttons, Feldern, Karten, Reitern,
Hilfen und Kennzahlen. Die benannten Renderer für Summary, Handlung,
Schlüsselparameter, Ausgaben und Jahresdialog erhalten additive Klassen.
`.currency`, `.btn-apply-inflation`, Snapshot-/Summary-Anker und die
Delegationshosts bleiben bestehen. Startfehler und Persistenzwarnung ergänzen
Fehler-/Warnnoten; Recovery bleibt als eigener Blockiergrund erhalten.
Entnahme-Subtexte und Marktinformationen haben volle Textdeckkraft.
Statusflächen verwenden vorhandene Statusgründe mit passenden Tokenpaaren;
der unveränderte Jahresprozess unterscheidet weiterhin Erfolg, veraltete CAPE-Quelle
und Abruffehler. Es entstehen keine neuen fachlichen Statusschwellen.

`renderProfileInputOrigins` wird nach der vorhandenen Synchronisierung bei Start
und Aktualisierung aufgerufen. Sichtbare jährliche Einkünfte, Liquidität,
Depot-/Goldbestände und Einstandswerte erhalten `adopted` sowie den Pflegeort.
Der bestehende Einzel-/Haushaltsprofilzweig liefert den Herkunftstext;
Sperren, Werte, Titel und fremde Beschreibungs-IDs bleiben erhalten.
Das außerhalb dieses Syncs befüllte Anleihenfeld hat eine konstante sichtbare
Profil-/Tranchenherkunft. Verborgene Renten-, Alters- und Depotbrücken
bekommen weder einen Grundknoten noch eine neue sichtbare Darstellung.

Der Ausgabenrenderer merkt pro Matrixhost ausschließlich die Präsenz der in
`refreshExpensesTableValues` bereits vorliegenden Jahresdatensätze. Der vorhandene
Ablauf rendert danach die Summary; zusätzlicher Storagezugriff entfällt.
Monatszellen ohne Profil-Monatsdatensatz zeigen `—` und keinen Budgetstatus.
Gespeicherte Nullimporte zeigen `0 €` und behalten die bestehenden Budgetregeln.
Jahresverbrauch, Restbudget, Forecast und YTD unterscheiden Leerjahr und Nullimport;
die Summary berücksichtigt wie bisher auch ausgeblendete gespeicherte Profile.
`monthsWithData`, Median, Forecast und YTD-Soll zählen weiterhin ausschließlich
positive Datenmonate. Die 5-%-Grenze sowie sämtliche Berechnungen bleiben gleich.
Import-/Details-/Delete-Anker, zugängliche Namen, Hidden-/Tabindex-Regeln und
28-px-Matrixaktionsplätze bleiben erhalten.

`designsystem-balance`, `balance-expenses` und `balance-renderer-summary` prüfen
Quellrollen mit Gegenproben und tatsächliche DOM-Ausgaben. Der registrierte
Browserfall `Designsystem Balance` verwendet nur synthetische Fixtures und prüft
Profilaktualisierung, reine Darstellung, Null-/Leermonate, Matrixaktionen,
Jahresdialog und bestehende Druckausblendungen. Bestehende Engine-Gate-,
Preflight-, Meldungs- und Profil-Recoveryfälle behalten ihre Gründe.

Das Quellmanifest enthält jetzt alle sieben benannten Balance-Renderer zusätzlich
zum Hauptmodul. Ausnahmen sind weiterhin reine Overlay-/Trennliniengrafik,
der vollständig verborgene Tooltipzustand, die bestehende Druckpalette und die
Verlaufsgrafikpalette. Die zwei vorhandenen `.input-error`-Prioritäten
bleiben in Anzahl und Selektor gleich; der Fehlerring nutzt jetzt `--bad`.
Die B32-Prozentformatierung verwendet die deutsche UI-Hilfe.

### Balance – Bedarf & Strategie

Bedarf pro Jahr zeigt Grundbedarf, Wunschbedarf und Mindest-Flex nebeneinander. Die Werte verwenden `--value-lg` (30 px); Einheit, Beschriftung und Hinweise bleiben normaler Text. Inflation und der bestehende Bedarfsstatus stehen in einer kleinen Zeile darunter. Im Kartenkopf stehen die Herkunft aus Haushalt & Plan, der Link Im Plan ändern und der gemeinsame Versuchsknopf.

Übernommen und Marktdaten nehmen jeweils die volle Breite ein. Jede Karte zeigt sechs Kacheln mit `--value-md` (17 px). Übernommen trennt Tagesgeld und Geldmarkt und zeigt Aktien alt/neu sowie Gold/Anleihen gemeinsam. Marktdaten zeigt vier Vorjahreskurse samt Jahreszahl, Allzeithoch mit Zeit seit Hoch sowie CAPE und Inflation. Jahres-Update holen und Protokoll bleiben im Kopf. Die bestehenden Korrekturfelder stehen unter Alle Parameter.

Der native `details`-Host Alle Parameter startet bei jedem Seitenaufruf geschlossen. Sein Kopf zeigt Flex-Budget, Reserven, Strategie, Dynamik und CAPE mit den aktuellen Werten. Die Karten folgen Weitere Planwerte aus Haushalt & Plan: erste Zeile Flex-Budget, Reserven, Entnahme & Umschichten; zweite Zeile Dynamik und Marktdaten. 3-Töpfe blendet seine drei Werte in Entnahme & Umschichten ein. Die Verteilung im Haushalt steht am Ende derselben Karte. Durch eine Linie abgesetzt folgen links Marktdaten-Korrektur, mittig Steuern und rechts Gold sowie darunter Haushalt mit Profilwahl. Die Korrektur bewahrt Kurse, Allzeithoch, Jahre seit Hoch und den gespeicherten Inflationswert. Kirchensteuer und Sparer-Pauschbetrag zeigen rechtsbündige Werte in jeweils einem übernommenen Kasten. Das Kirchensteuerfeld bleibt das bestehende native Auswahlfeld; nur im gesperrten Zustand entfällt sein Auswahlpfeil.

`household-plan-more`, `household-plan-group` und `household-plan-field` teilen die Regeln in `css/components.css` mit dem Plan. Die äußere Karte ist weiß, die inneren Karten verwenden `--surface-sunken` und 16 Pixel Innenabstand. Links stehen Beschriftung und kurzer Hinweis, rechts der 38 Pixel hohe Wertkasten mit rechtsbündigem Wert und Einheit. Beschriftungen und Werte nutzen `--text-base`, Werte Gewicht 500; Titel verwenden die Serifenschrift. `app/shared/household-plan-fields.js` liefert Texte und Einheiten, `household-plan-presentation.js` ergänzt die Darstellung und die gemeinsame Kopfzusammenfassung.

Dynamik zeigt die Voreinstellung als Segmente und den Hinweis Voreinstellung gilt; Details sind ausgeblendet. Benutzerdefiniert öffnet die vorhandenen Details und bleibt als lokale Auswahl sichtbar, auch wenn ihre Werte einer Voreinstellung entsprechen. Das Aufklappen von Alle Parameter öffnet diese Details nicht zusätzlich und schreibt keine Werte. Fachliche Freigaben bleiben erhalten; Quantile und relative Puffer zeigen Prozentwerte aus unveränderten kanonischen Anteilen. Gold aus ersetzt im Lesemodus das Goldband. Nur hier ausprobieren gibt die bisherigen Eingaben frei; Zurück zum Plan verwirft den Versuch. Herkunft steht im Kartenkopf, Feldgründe bleiben über `aria-describedby` zugänglich. Bei ausgeschalteter Dynamik steht der Sperrgrund einmal über den Details; identische Einzelzeilen entfallen. Abweichende Gründe wie die aktuarische Horizontmethode bleiben am Feld. Dynamische Entnahme und Go-Go-Jahre zeigen Beschriftung und Aus/An-Segment in derselben Zeile, auch bei gesperrten Planwerten. Diese Zeilenregeln gelten ebenso im Simulator und in Weitere Planwerte.

### Diagnose im Balance-Reiter

`#tab-diagnosis` ist ein reguläres, initial mit `hidden` verborgenes Reiterpanel.
`#openDiagnosisBtn` bleibt der benannte Reiter und das Meldungsrückfokusziel;
Pfeiltasten, Home/End, ARIA und Panelwechsel gehören dem bestehenden Binder.
Die semantische Abschnittsüberschrift h2 ist visuell verborgen; sichtbar beginnen Statuschips und danach Karten:
„Warum diese Empfehlung?“ mit h2 und „Transaktion“ mit h3 im 7:5-Raster, darunter „Leitplanken“
und „Alle Kennzahlen“. Unter 1180 px Inhaltsbreite wird das Raster einspaltig.
Der Entscheidungsbaum zählt die vorhandenen Schritte; Status und Schweregrad
bleiben Payloadprojektionen. Die Transaktion enthält auch Leer-, Block- und
Haushaltszustände sowie sämtliche vorhandenen Grenzen und Tranchenzeilen.

Der initial ungesetzte `#diagFilterToggle` steht im Leitplankenkopf.
`#diagContent.filter-inactive` verbirgt nur `.decision-inactive` (`inactive`)
und `.guardrail-ok` (`ok`). Statuschips, Transaktion und Kennzahlen werden nicht
gefiltert. „Diagnose kopieren“ steht als beschrifteter stabiler Knopf im
Kennzahlenkopf; die bestehenden Copyregeln und Detailpräzision bleiben erhalten.
Das Diagnoseraster richtet Karten oben mit Inhaltshöhe aus. Transaktionslabels
haben keinen Doppelpunkt. Aktien- und Goldgrenzen zeigen je eine kurze Aussage
aus gelieferten Schwellen/Beständen; fehlende Daten ergeben keine positive
Zustandsbehauptung. Technische Details und Copy behalten alle Einzelwerte.
Leitplankenflächen bleiben neutral außer bei belegter Auslösung (`Inflations-Cap.details.capBinding === true`): leichte Messingtönung und Chip „Löst aus“. Bloße Nähe tönt nur den Chip; Fachstatus und Copy bleiben erhalten. Runway
zeigt die unveränderten Monatswerte als „Runway 62 / 60 Mon.“ mit einer Einheit;
Quelle, Glättung und Tooltip bleiben erhalten.
Leitplanken zeigen vorhandene Werte in lokaler Serif regular (26 px), Kennzahlen
in drei Spalten als Label-/Wertzeilen mit vollständigen Metadaten und Warntrends.
Formatierte Payloadwerte werden nicht zurückgeparst oder fachlich umgerundet.

Runwayquelle/-glättung und erläuternde Leitplankennotizen bei `ok`/`info`
verwenden `.ds-info`, benannte `.ds-info-button` und `.ds-info-pop` mit eindeutigen
ARIA-Bezügen. Popups sind initial geschlossen. Maus, Fokus und Klick öffnen;
Escape mit Rückfokus, Fokuswechsel und Außenklick schließen. Hostbindungen sind
wiederholungsfest, der Außenklicklistener besteht einmal je Dokument. Warn- und
Blocknotizen, Mindest-Flex-/Notlagenmetadaten und Cash-Auditfehler bleiben sichtbar.

Alte Diagnose-Overlay- und Ergebnisspaltenregeln einschließlich ihrer alten
Druckausnahmen entfallen. Der Jahresdialog verwendet die rechte Fläche aus Referenz 09. `#actionDetailsDialog`, `#handlungsanweisung`,
`copyAction` und `#print-footer` erhalten den vollständigen Druckplan samt
Genauigkeit. Jahres-/Recovery-/Schreibschutz und `dev=true` bleiben getrennt.
Ausgabenkennzahlen und Verlaufsdiagramme verwenden weiterhin gespeicherte
nominale Daten; keine Rendite-, Realwert- oder Prognoseableitung aus dem Verlauf.

Die vorhandenen Node-Bedienbelege und Browserproben sind nachgeführt; es gibt
keine neuen Browserfälle. Browser-, Druck- und Entwurfsabnahme bei 1920/2560 px
bleiben Aufgabe der Steuerung und werden nicht aus Node-Ergebnissen abgeleitet.

### Balance – Diagnose und Dialoge

Die Diagnose nutzt Statuschips, nummerierte Schritte mit Ergebnis-Chips,
kuratierten Transaktionsstatus, Leitplankenkarten mit Status-Chips und drei
Kennzahlspalten (unter 1180 px eine Spalte). Keine sichtbare äußere Titelbox.
`ds-technical-details` ist initial geschlossen; vollständige Diagnosekopie und
Filter bleiben unabhängig davon. `ds-rule-toggle` gestaltet den erhaltenen
Checkboxvertrag als Schalter. `ds-decision-number`, `ds-action-band`,
`ds-data-row` und `ds-process-strip` sind additive Darstellungsrollen.

Der Handlungsdialog misst maximal 1080 px mit 20 px Radius und 26/34/32 px
Innenabstand; der Jahresdialog steht rechts mit maximal 600 px und 30/34 px
Innenabstand über die gesamte Fensterhöhe. Die Jahresprozessleiste zeigt vor
bestätigter Speicherung keine abgeschlossenen Schritte. h2/h3 bleiben 22/18 px;
Farben, Flächen, Fokus und Status verwenden die Suite-Tokens. Fremde Consumer
werden durch diese neuen Rollen nicht umskaliert.

Gemeinsame Quelle der geplanten Aktion ist die lesende Handlungskurzfassung,
einschließlich Profilaktionen und interner Cashintegration. Technische Schlüssel
und bekannte Regelwerte sind deutsch erläutert; Rohwerte und Einheiten bleiben
erhalten. Ersetzte Balance-Panel-, Fieldset-, Formraster-, Ergebnis- und
Handlungskastenregeln sind entfernt. Bildabnahme 07/08/09 und Abschlussrundgang
01–09 bei 1920/2560 px, Browser-Smoke sowie Kandidaten-EXE stehen extern aus.

### Balance-Anzeigevertrag

`UIUtils.formatBalanceCurrency` zeigt alle regulären sichtbaren Balance-Geldbeträge
in ganzen Euro: Karten und Nebenzeilen, Monats-/Jahrestabellen, Ausgabendetails,
SVG-Titel, Transaktionskurzfassung und alle Kennzahlen einschließlich Metazeilen.
Genau bleiben Diagnosecopy und andere Kopierwege, technische Details,
Exporte und Eingaben. Der vollständige Handlungsplan in „Details & Drucken“ und sein Druck zeigen ganze Euro; die getrennte Textprojektion erhält alle Planinformationen centgenau.
Die Anzeige formatiert Rohwerte erst nach Summe und Differenz; gespeicherte,
weitergereichte und Enginewerte bleiben ungerundet. Prozent, Ratios, Jahre und
Monate behalten ihre bisherigen Einheiten und Genauigkeiten. Leitplanken erhalten
über `withGuardrailCardValues` getrennte Kartenwerte; Copy liest weiterhin die
unveränderten `value`-/`threshold`-Felder.

Die Monatsmatrix unterscheidet gültige Nullimporte (`0 €`), fehlende Sätze (`—`)
und teilweise benötigte Profilimporte (kursiv „unvollständig“). Gesamtwerte sind
fett ungefärbt, Monatsnamen normal. Aktionen sind neutral rahmenlos links vom
rechtsbündigen Wert; Löschen wird nur bei Hover/Fokus rot. Vergleich nur bei
vollständigen sichtbaren Profilimporten und Budget: unverändertes Ist minus Budget,
„−“ grün, „+“ messing, null neutral. Jahresmetriken zählen unverändert positive
Datenmonate aller gespeicherten Profile, unabhängig von der Matrixvollständigkeit.

Jahresausgaben haben schlichte Säulen ohne eigenen Rahmen, y-Achse oder Raster,
grau-grün für abgeschlossene Kalenderjahre, messing für das aktuelle Jahr, fette
Jahreslabels und eine zugängliche Beschreibung. Tabelle: Jahr, Status, Ausgaben
gesamt, Monate mit Daten, Ø pro Monat. Teil-/Nulljahre und echte Monatszahlen bleiben.
Der Verlauf hat eine gemeinsame h2 „Vermögensverlauf · aktives Profil …“ mit
Untertitel, rechts Capture/Automatik. Anzahl-/Datumshosts bleiben visuell verborgen;
kleines Datum steht bei „Letzter Stand“. Tabelle: neueste Zeile zuerst durch Umkehr
einer Kopie, alle nominalen Spalten, Summe fett. Grafik und gespeicherte Reihenfolge
ändern sich nicht.

`.balance-page .ds-table > caption` gewinnt gegen Tabellenpadding: absolute
abgeschnittene 1-px-Fläche, Padding/Rand null, keine Zugänglichkeitssperre.
`bindBalanceTableOverflow` misst tatsächlichen Überlauf nach Inhalt, Resize und
Tabwechsel für alle drei Tabellen. Breite und aktive leere Tabellenregionen zeigen
keinen Hinweis; benannte/fokussierbare Leerregionen bleiben erhalten.
Leitplankenchips verwenden vorhandene `ds-chip-success`/`warning`/`error`-Tönungen.
Am Inflations-Cap steht genau ein Kopf-Infoelement mit Grundtext und vorhandenem Hinweis. Andere Pflichtwarnungen bleiben sichtbar. Bei Referenzbreiten
füllen sechs Karten 3 × 2 bzw. 6 × 1 (Inhaltscontainer ab 2100 px); kleinere Flächen
bekommen gleichmäßige Spalten. Fehlende Aktivitätsdaten erzeugen keine Auslösung.

Zum Anzeigevertrag gehören vier Bedarfzeilen mit kleiner
`€ / Monat`-Einheit, Dynamic-Flex-Ausprojektion und gebündelter Ausschaltgrund,
flüchtige Parameterklappe, schlichte native Haushaltscheckboxen,
„Letzte Sicherung gespeichert“, neutraler Leertext und grüne Heißphase.
Browser-Smoke, Grundbedienung 10/10, Einstellungen mit 0 Fehlern und Bildvergleich
bei 1920/2560 px bleiben externe offene Abnahmen. Keine statische Assertion gilt
als Bild-/Browserabnahme; keine neuen Browserfälle sind registriert.

### Handlungsdialog – Referenz 08

`#actionDetailsDialog` behält Modalbedienung, Escape, Außenklick, Rückfokus und
Druckscope. Titel: vorhandenes Planungsjahr und Zweck. Darunter genau eine kleine 14-px-Zeile aus vollständigem integriertem
Aktionstitel einschließlich Cashergänzung und verfügbarer Marktphase;
rechts der situationspassende Betrag. Quellen stehen in einer semantischen Tabelle
mit lesbarem Tranchennamen und/oder deutschem Kaufdatum, Brutto, Steuern, Netto
und nur im Haushalt einer Profilspalte. Keine technischen IDs und kein FIFO-Zusatz;
fehlender Name und Kaufzeitpunkt bleiben neutral. Der redundante Zwecksatz entfällt,
Nichtstun-/Mindesthandels-/Schutzhinweise bleiben sichtbar.
Fehlendes Quellen-Netto wird nicht aus Brutto und Steuer berechnet. Autoritative
Summen und vorhandene Settlement-/Verlusttopfdetails bleiben erhalten.

Reihenfolge: Quellen, zusätzliche Steuerdetails nur bei relevanter Zusatzinformation,
interne Umschichtung mit Richtung und ausschließlich im Haushalt Profil,
Kartenzeilen für sämtliche Verwendungen, vorhandene Zielinformation und Nachherdeckung,
messingfarbenes Hinweisband,
genau ein Vermögensknopf mit bisherigem Handoff ohne Zielprofil plus stabiler
Kopierknopf, anschließend „Plan nach Zweck“ und sichtbarer Versions-/Kontextfuß.
Verkaufskennzeichnung und „Verkauf erfassen →“ erscheinen bei Verkaufsquellen;
reiner Kauf verwendet „Kauf erfassen →“, sonst „Vermögen öffnen →“.
Nichtstun ohne Ströme zeigt seinen bestehenden Grund ohne Quellentabelle.
Lange Namen umbrechen; schmale Quellentabellen scrollen gezielt. Druck blendet
Bedienknöpfe aus und erhält sämtliche Inhalte in ganzen Euro.

`ActionRenderer._projectTransaction` übernimmt die vorhandene Cashintegration,
Profilersetzung und Anzeigezuordnungen unverändert als numerische Detaildaten.
`_renderDetails` erzeugt daraus Euroanzeige und aktuelle centgenaue Textprojektion.
Der gebundene Clipboardhandler liest `UIRenderer.getActionCopyText()`;
`#handlungContent.innerText` ist keine Kopierquelle. Folgerendern ersetzt die
Projektion; fehlende/ungültige Aktionen verwerfen sie. Diagnosecopy und Exporte
behalten ihre bisherigen Präzisionsverträge.

„Alle Parameter“ bündelt alle Refreshwege in einem Microtask nach dem synchronen
Setter-/Feldbesitzerdurchlauf. Erst danach wird der bisherige Detailmodusbesitzer
bei tatsächlicher Abweichung aktualisiert und werden Ausschaltgründe gebündelt.
Toggle, Initialisierung, programmatisches Laden und `binding.refresh` nutzen denselben Weg.
„Dein Bedarf“ erhält keine Vermögensersatzzeile: im vorhandenen Profilvertrag
fehlt ein Profilbedarf, daher bleibt `#balanceNeedProfiles` leer und verborgen.
Der Phasenchip ist innerhalb seiner vorhandenen Phasenfarbe kräftiger gefüllt.
In der Jahresausgabentabelle bleiben Jahreszellen ungefärbt und normalgewichtig,
Status steht links; numerische Spalten behalten ihre Ausrichtung.

Fokussierte Nodeprüfungen und angepasste bestehende Browserproben belegen den
SOURCE-Stand. Volle Suite: Orchestrator. Browser-, Druck- und Bildabnahme bei
1920/2560 px bleiben bis zur externen Durchführung offen.

Der Jahresdialog nach Referenz 09 bleibt die rechte 600-px-Fläche. Die messingfarbene
Eyebrow „Jahresabschluss“ (uppercase, `.08em`, 14 px) steht über „<Abschlussjahr> abschließen, <Folgejahr> planen“;
die Jahre stammen aus dem erfassten Periodenkontext, auch nach dem Rollover. Ohne
Kontext bleibt der Titel neutral. Lauf-/Fortsetzungs-/Bestätigungsinformation steht
im Inhalt. Vier beschriftete Balken projizieren vorhandene Zustände: Vorbereitung
im ersten Abschnitt, offene Ergebnisabschnitte grau, alle vier grün erst bei
`confirmed=true`. Der Status bleibt pro Abschnitt zugänglich verborgen.

Vorbereitung zeigt vier kurze Planzeilen; Ergebnisse zeigen nur verfügbare Werte,
ETF-Stichtag/Nachrücken, ATH, CAPE mit Quellenwarnung, Alter und echte Schrittfehler.
Herkunft und Dauer bleiben erhalten. Das Handkursfeld nutzt `ds-field` und
`ds-unit-frame`, die Einheit € und „optional – wenn der Abruf scheitert“ direkt
unter dem Feld in gedämpften 14 px mit 4 px Abstand; Parser,
Grenzen und Retry bleiben erhalten. Schlichtes Schließen oben, sekundäres Schließen
links unten und vorhandene Abschluss-/Retryaktion rechts. „Protokoll ansehen“
erscheint nur mit Sitzungsprotokoll und ergänzt über den bestehenden Loghandler
Start-/Endzeiten sowie Fehlerdetails; in dieser Ansicht entfällt die Aktion.

Bekannte Jahresvorbedingungen erscheinen als warnfarbene Prüfhinweise im vorhandenen
Aktionskanal. Beim falschen Ausgabenjahr lautet der Haupttext „Für den Jahresabschluss
<Jahr> bitte im Reiter Ausgaben das Jahr <Jahr> wählen.“. Der gebundene Knopf
„Ausgaben <Jahr> öffnen“ benutzt den vorhandenen Reiter-/Jahreswechsel, auch ohne
bisherige Option. Er startet keinen Jahresabschluss. Technische Fehler behalten
ihre bisherigen Fehlerrollen; Schließen, Scope, ARIA und Rückfokus bleiben erhalten.
Browser-Smoke und Bildvergleich beider Dialoge bei 1920/2560 px sind extern offen.

### Balance-Restpunkte – Quellvertrag zu Referenzen 08/09

Der Darstellungsadapter bündelt Property-, Toggle-, Observer- und öffentliche
Refreshaufrufe in einem Microtask. Erst nach dem synchronen Feldbesitzerdurchlauf
wird `dynamicFlexShowAdvanced.checked` bei tatsächlicher Abweichung an
`balanceAllParameters.open` angeglichen. Danach werden native Sperren und Gründe
projiziert. Aus bleibt Aus, An/Benutzerdefiniert bleibt nach erneutem Öffnen
bearbeitbar; die aktuarische Nichtanwendbarkeit des direkten Horizonts wird weiterhin
nur als `inactive` samt Grund dargestellt, ohne neue fachliche Sperre. Klappenwechsel
senden kein Formularereignis, starten keine Engine und schreiben keine Finanzdaten;
ein echter Segmentklick behält genau ein natives `change`.

Der Handlungsdialog zeigt unter seiner Überschrift genau eine kleine Kontextzeile:
vollständiger Aktionstitel mit vorhandener Cashergänzung und verfügbarer Marktphase.
Der redundante generierte Zwecksatz entfällt; Nichtstun-, Mindesthandels-, Schutz-
und Umschichtungshinweise bleiben erhalten. Quellen nennen Namen und/oder deutsches
Kaufdatum (volles Datum oder Kaufmonat), ohne technische IDs oder FIFO-Zusatz.
Instrumentinformationen, Quellenreihenfolge und autoritative Brutto-/Steuer-/Nettosummen
bleiben erhalten; fehlende Beträge bleiben fehlend. Profilzuordnungen in Tabellen
erscheinen nur im Haushalt, der aktive Profilkontext bleibt im Fuß.

Eine eigene Steuerkarte entsteht nur mit zusätzlicher Settlement-/Verlusttopf-
oder Profilsteuerinformation. Reine Brutto-/Steuersummen wiederholen keine Box;
die bestehende finale/geschätzte Kennzeichnung steht weiterhin in der Tabelle.
„Wohin es fließt“ vereint alle bestehenden Verwendungen und Zielinformationen als
Kartenzeilen. Liquiditätszufluss zeigt `+` und bei bekanntem Ziel die Monate
Nettoentnahme; „Danach · laut Berechnung“ zeigt ausschließlich die gelieferte Deckung.
Es entsteht weder eine neue Tagesgeldzuweisung noch ein Nachher-Eurobetrag oder
Nullersatz. Interne Umschichtungen bleiben mit Richtung und Betrag getrennt.
Zwecklabels haben keinen abschließenden Doppelpunkt. Dialog und Druck zeigen ganze
Euro; die eigene Kopierprojektion erhält Quellen, Verwendungen, relevante Steuer-
und Transferdetails, Zweckwerte und Kontext centgenau. Berechnung und Export bleiben genau.

Alle bestehenden schließbaren Aktionsbänder verwenden `ds-icon-button` mit
`balance-message-close`. CSS ordnet × rechts neben der optionalen Jahresfolgeaktion;
der Schließknopf bleibt DOM-Kind 1 und damit der bisherige Nachbar-Fokusbesitzer.
ARIA, Scopebereinigung und Stale-Schutz bleiben erhalten. Jahres-Eyebrow: uppercase,
`.08em` Laufweite; Handkurshilfe: gedämpfte 14 px direkt unter dem Feld. Jahresprozess,
Parser, Retry und Commit-/Recovery-Sperren bleiben beim bisherigen Besitzer.

Aktive Kürzel sind Alt+J, Alt+E und Alt+I bei vorhandenen Buttons und ohne Aktionssperre.
Reiter verwenden Klick/Enter/Leertaste sowie Pfeiltasten/Home/End. Markt-CSV, separates
Nachrücken/Undo, Alt+N, Tranchenstatusklappe und Balance-Reset sind entfallen;
Ausgaben-CSV, interner Guardrail-Reset und historische Provenienz
bleiben erhalten. Die vollständige Inventur der 44 Balance-Module samt Exporten und
Imports steht in `docs/reference/BALANCE_MODULES_README.md`.

Nodebelege: `designsystem-balance`, `balance-renderer-action`, `balance-messages` und
`designsystem-start-handbook`. Die bestehenden Browserfälle `Balance.html` und
`Balance annual commit` bleiben erhalten und sind um die Restpunkte ergänzt.
Volle Suite durch den Orchestrator; Grundbedienung 10/10, Druck/Browser und der
Dialogbildvergleich gegen 08/09 bei 1920 und 2560 px bleiben externe offene Abnahmen.

### Simulator-Felder und gemeinsame Dynamic-Flex-Darstellung

Sichtbare Simulator-Inputs und Auswahlfelder ergänzen die Rollen `ds-input`,
`ds-checkbox` und `ds-select`. Bestehende IDs, Klassen, Attribute, Einheiten und
Listener bleiben erhalten. Die Startallokation behält `.calculated-display` und
ergänzt neutrale Kennzahlflächen; ihre Zahlen und Aufteilung bleiben identisch.

Der gemeinsame Dynamic-Flex-Controller stellt die vorhandenen Bedingungen für
Details, Dynamic Flex, Go-Go und Langlebigkeit mit `setFieldState` dar. Die bisherige
Textdeckkraft der Detailgruppe entfällt. Direkter Horizont bei aktuarischer Methode
und Quantil bei Erwartungswert erhalten einen konkreten Nichtanwendbarkeitsgrund,
ohne zusätzliche Sperren oder Wertänderungen. Der bisherige Hinweis
`horizonYearsApplicability` und das Simulator-`readonly` bleiben erhalten.

Profilübernahme markiert Alter, Geschlecht, Rentenanpassung und Partnerwahl als
`adopted`; Cashanzeigen und abgeleitete Portfolioanzeigen erläutern ihre Herkunft.
Haushaltsbedarfs-Overrides bleiben bearbeitbar. `profileFieldOrigin` ist ausschließlich
Darstellungsmetadatum im DOM, kein Speicher- oder Lockvertrag. Die Ansparphase nennt
ihre vorhandene Nichtanwendbarkeit im Profilverbund.

Rentenmodusentscheidung und spätere Profilsperre behalten ihre bisherige Reihenfolge.
`refreshRentAdjustmentPresentation` verändert keine Sperre. Auch programmatische
Modusereignisse behalten den vorhandenen Moduslistener; erneute Profilübernahme setzt
den bisherigen Lock. Die sichtbare Modusauswahl nennt Herkunft und Koppelung additiv,
auch wenn die Prozentgruppe verborgen ist. Alte Titel bleiben erhalten. Versteckte
Renten- und Steuerbrücken erhalten keine Zustandsdarstellung.

Partner-, Anspar-, 3-Bucket- und Pflegewechsel aktualisieren Gründe an den weiterhin
sichtbaren Schaltern oder Auswahlen. Bootstrapblockgröße ist bei `regime_iid` und
`regime_markov` nicht anwendbar, bei `block` und `stationary` bearbeitbar; sichtbarer
Begriff und bisheriger Tooltip stimmen überein. Busy und Recovery erhalten weiter
ihre spezifischen Meldungen und Startblockaden; `disabled` allein erzeugt keinen
fachlichen Zustand.

`designsystem-simulator-fields` prüft 96 Dynamic-Flex-Kombinationen, Initialisierung,
Listenerwechsel, Profilanzahl, Vorrang des nachfolgenden Locks, Portfolioherkunft,
Legacyeinheiten und verborgene Brücken. Das Quellmanifest umfasst zehn Feldconsumer;
Gegenproben verwerfen fehlende Rollen, alte Farben und Textdeckkraft. Registrierter
Browserfall `Designsystem simulator fields` prüft sichtbare Gründe bei 1366, 1920
und 2560 px, Profilwechsel, Presets und Bootstrap. Haushalts-/Reload- und Recoveryfälle
sind erweitert. Browserausführung und vollständige Suite übernimmt die Steuerung.

### Simulator-Ergebnisse und Replay

`renderSummary` und `renderKpiCard` ergänzen `ds-card ds-metric` an ihren
bestehenden Summary-/KPI-Ankern. Die Summary zeigt ihre vorhandenen Beschreibungen
zusätzlich im Kartenkörper; Titel, Werte, Statusgründe und Exaktwert-Zweitwerte
bleiben vollständig. Warnungsfreie Floor-Deckung ist neutral, auch bei 0 oder
1 Prozent. `small_sample`, technische Fehler und fehlende Werte behalten den
bisherigen Warnungston und unveränderten Grund. Wilson-Intervall, Quantile,
Beobachtungszahlen, Missingness und alle übrigen Einstufungen bleiben identisch.

Ergebnis-/Replayreiter, Tabellen, Prioritätskarten, Meldungen und Logexporttasten
verwenden additive Rollen. Verkauf-/Kauftexte in Logs verwenden `bad`/`accent`
statt Direktfarben, ohne Änderung der Zahlen. Replay-Schrittabwicklung erzeugt
keine finanzielle Erfolgseinstufung. Zahlen bleiben Sans/tabellarisch; Serif
bleibt den bestehenden Überschriften vorbehalten. Die Printregeln öffnen weiter
alle Ergebnis- und Replaypanels und erhalten die vollständigen Kartenbeschreibungen.

`designsystem-simulator-results.test.mjs` prüft acht vollständige Viewmodels
gegen eingefrorene Referenzdigests (einzige Normalisierung:
warnungsfreier Floor-Ton), erzeugtes Markup und wirksame Gegenproben für Rollen,
Farben, Kontrast und Deckkraft. `Designsystem simulator results` ergänzt den
Browser-Smoke um die Floor-/Missingnessmatrix, exakte EUR-/Drawdownwerte,
Replayzustände, Reiter und Druck. Browserabnahme erfolgt außerhalb der Sandbox.
Die Grafik- und Werkzeugpalette verwendet ebenfalls Tokenrollen.

### Werkzeug- und Diagrammrollen

`app/shared/designsystem-chart-colors.js` liest `--heatmap-low`, `--heatmap-mid`
und `--heatmap-high` über `document.defaultView.getComputedStyle(documentElement)`.
Eine bereits aufgelöste Tokenmap ist injizierbar; es gibt keine zweite gepflegte
Hex-Palette. Ohne Dokument entstehen dieselben Farben als `var()`-/sRGB-
`color-mix()`-Ausdrücke. Die Browserrenderer lesen die Tokens einmal pro Ausgabe,
interpolieren RGB-Kanäle und runden auf ganze Kanäle. Die zwei gleich langen
Segmente sind Hell → Messing → Schiefer; Werte außerhalb 0–1 bleiben an den Enden,
fehlende/nichtendliche Palettenwerte am hellen Ende. Der kompatible Exportname
`viridis(t)` bleibt erhalten, ebenso die Renderer-Signaturen und Paletteoption;
alle bisherigen Paletteoptionen verwenden jetzt die freigegebene Abbildung.

Die Zuordnung im Portfolio lautet ETF `--chart-1`, Bonds/Puffer `--chart-4`,
Gold `--chart-2`, Liquidität `--chart-3`. Balance-Verlauf verwendet Aktien
`--chart-1`, Geldmarkt `--chart-2`, Tagesgeld und Ausgabenbalken `--chart-3`.
Pareto-Frontier verwendet `--chart-3`, die Kontextwolke `--chart-5`;
Sensitivitätsbalken verwenden `--chart-2` → `--chart-4`. Diese Rollen beschreiben
Datenserien, keine neue Bewertung. Reihenfolge, Skalen, Bins, SVG-Koordinaten,
Warnbedingungen und Übernahmeparameter bleiben erhalten.

Grafiktext verwendet Texttokens. Diagramme haben eine opake `--surface`-Fläche;
Heatmaplabels liegen auf opaken `--surface`-Platten mit `--text-main` darüber.
Die Platten werden nach der kritischen Überlagerung gezeichnet, Sweepplatten
nach der Zelle samt Warnrand. Zahlen und Warnzeichen erhalten zusätzlich einen
opaken surface-Hof, damit auch überstehende lange Zahlen ihre Unterlage behalten.
Damit ist der Labelkontrast über **den gesamten interpolierten Bereich**
unabhängig von Zellfarbe, Null, fehlenden Werten und kritischer Überlagerung.
Die kritische Fläche bleibt `--bad` mit rein grafischer `fill-opacity: .12`;
Warn-/Invalidränder bleiben `--warn`/`--bad` bei unveränderten Bedingungen und
Breiten. Fehlende Sweep-Zellen bekommen eine neutrale `--surface-sunken`-Farbe;
ihr bestehender Zahlen-/N/A-Vertrag wird nicht umgedeutet.

| Vordergrund | Zulässiger Hintergrund | Zweck |
|---|---|---|
| `--text-main` | `--surface` | Opake Grafiklabels, Achsen, Portfoliolegende |
| `--text-muted`, `--warn`, `--bad` | `--surface` | Grafikfußnoten, bestehende Warn-/Fehlertexte |
| `--text-main` | `--accent-line`, `--surface-sunken` | Fortschrittszahl über dem Messingbalken und bei überstehendem Text auf der hellen Restfläche |
| `--surface` | `--good`, `--warn`, `--bad` | Bestehende Stabilitätsstufen; Überschrift und Text explizit hell |
| `--good`, `--bad` | `--good-soft`, `--bad-soft` | Selbsttest-Einzelmeldungen auf erfolgreicher oder fehlgeschlagener Gesamtfläche |

Jedes Paar erreicht mindestens 4,5:1. Serientokens, `--accent-line` und Ränder
werden nicht als Textfarbe eingesetzt. Auf Text und seinen Werkzeugeltern liegt
keine Deckkraft; die Übernahmebestätigung wird nach weiterhin 3,5 Sekunden direkt
entfernt. Die bisherigen Preset-/Sweep-/Paretohosts, `.ao-param-*`, IDs,
`data-param-id` und Listener bleiben erhalten. Input-/Selectrollen werden in den
dynamischen Parameterblöcken am echten DOM addiert, ohne die alten Markup-Anker
zu ersetzen. `ds-portfolio-svg`, `ds-sensitivity-chart` und `ds-pareto-svg` sind
zusätzliche, inventargeschützte Erzeugeranker.

`designsystem-charts.test.mjs` bindet sechs vollständige Grafikprojektionen und
alle Portfolio-Pfadkoordinaten an eingefrorene Referenzwerte; aus der Projektion entfallen
Farb-/Typografieattribute, additive Klassen, opake Labelplatten und die neuen
Scrollkapseln. Dezimalzeichen werden ausschließlich in Textknoten normalisiert;
fehlende Sweepzellen zeigen Gedankenstriche.
1001 Interpolationswerte, Stützpunkte, Zwischenwerte, Null/fehlend, Warnrand und
kritische Überlagerung sowie Dokument-/Tokenmapauflösung werden geprüft.
`designsystem-tools.test.mjs` prüft tatsächliche Championtexte gegen Basisdigests,
Stabilitätsgrenzen, Parameter-Domänenlistener und echte Sweep-Übernahme. Injizierte
Gegenproben verwerfen Altfarben, Serientext, fehlende Aliase, neue Prioritäten,
Textdeckkraft einschließlich erzeugtem `HEATMAP_V4_STYLE` und falsche Labelpaare.
Der neue Browserfall `Designsystem tools` führt kurze echte Backtest-, Sweep-
und Built-in-Optimizerläufe aus; er muss außerhalb der Agentensandbox ausgeführt
werden. Registrierung und Quellprüfung ersetzen keine Browserabnahme.

### Simulatorbreiten und Vertragsabschluss

Simulatorpanels sind benannte Inline-Size-Container (`simulator-panel`). Neue
Spalten beziehen sich auf deren Breite; Kinder besitzen `min-width: 0`.
Die vorhandenen Viewportbedingungen und DOM-Reihenfolgen bleiben erhalten.
Heatmap (980 px), Pareto (800 px), Sensitivität (440 px plus Padding) und
Portfolio (820 px) behalten ihre Geometrie in benannten, fokussierbaren
Scrollregionen. Logs, Replay- und Optimierertabellen erhalten ebenfalls lokale
Regionen und sichtbare Fortsetzungshinweise. Druck blendet Hinweise aus und
öffnet weiterhin die vorhandenen Ergebnis-/Replaypanels. Die Mindestbreite
von SVGs wird im Druck aufgehoben; IDs und Exportaktionen bleiben erhalten.

Native Selects bleiben die Eingabekontrollen. `observeSelectionText` ergänzt
Volltext bei Init, erzeugten Selects und Optionsrefresh; `change`, die nativen
Instanzsetter für `value`/`selectedIndex` und Formularreset aktualisieren ihn
ohne Änderung von Wert, Sperre oder Ereignissen. Alle Manager-Selects mit ID
sind angeschlossen, einschließlich Health-Bucket-Quelle/-Zielmodus und der
dynamischen Cashstatuswahl. Resize, Fontladung und Sichtbarwerden messen erneut;
verborgene/unmessbare Controls liefern keinen Kürzungsnachweis. Beobachter und
Listener werden nicht doppelt gebunden; eigene Hilfsspans erzeugen keine
Beobachterschleife. Die Hilfe speichert nichts.

`formatDisplayFixed` erhält die bisherige `toFixed`-Rundung und Präzision
(einschließlich binärer Halbwerte) und ersetzt ausschließlich das Dezimalzeichen.
`formatDisplayScalar` zeigt bereits skalierte Parameter ohne zusätzliche Rundung.
Heatmap-, Sweep-, Sensitivitäts-, Champion- und Logtexte verwenden diese Grenze;
Euro-/KPItexte, konservative Cent-/Drawdown-Rundung, k-€-Skalierung und
Replay-Jahres-/Prozentpunktdeltas behalten ihre vorhandenen Verträge.
Echte Null, leere Heatmap, fehlende Sweepzelle (— mit „Keine Daten“), ungültige
Kombination (N/A mit Grund), fachlich vorhandenes ∞ und Kleinstwert <0,1 %
werden separat geprüft. Das frühere Kopieren des Farbskalenminimums in die
Beschriftung fehlender Sweepzellen entfällt ausschließlich in der Anzeige;
Skalen, Daten, Ranking und SVG-Koordinaten bleiben gleich.

Die vorhandenen Haushalts-/Setupbeschriftungen, Horizont/Laufzahl, Wilsonintervall,
Quantile, reale/nominale Preisbasis, Beobachtungszahlen und experimentelle
Werkzeugwarnungen bleiben erhalten. Der Portfoliohost nennt Simulationsjahre,
nominale Euro und den ausgeschlossenen Pflegebucket. S18 nennt Übergangsalter,
Simulationsjahr und kumulierte Einzahlungen; im Profilverbund bleibt der
vorhandene Nichtanwendbarkeitsgrund sichtbar. Es entstehen keine neuen
fachlichen Zusammenrechnungen oder Schwellen.

Die gemeinsame Komponentenbrücke definiert zusätzlich `--muted-text` als
Alias auf `--text-muted`: `balance-storage.js` verwendet diesen alten Namen
für seinen Restorehinweis. Speicher-/Snapshotcode bleibt unverändert.

`SOURCE_PATHS` in `tests/designsystem-source-contract.mjs` ist die explizite
Laufzeitliste (59 Quellen, fünf Seiten), ohne Zielbild/Prototyp.
Sie enthält alle Balance-, Simulatorfeld-, Ergebnis-, Werkzeug- und
Managerconsumer sowie lesend `balance-storage.js`,
`balance-reader.js`, `profilverbund-balance-ui.js`, `security-utils.js`,
`simulator-backtest.js` und `simulator-main-init.js`.
`validateCompletePresentation` verbindet die Teilverträge und prüft Aliaszyklen,
fehlende Aliase, Textrollen, Kontrastpaare, sämtliche Text-/Elterndeckkraft und
JS-Textflächen. `validateScrollableMarkup` prüft die tatsächlich erzeugten
Grafik-/Tabellenfragmente. Isolierte Gegenproben verändern nur Quellkopien.

Die SVG-/Championtests verwenden eingefrorene Referenzdigests mit derselben
Textnormalisierung und der ausdrücklich erlaubten Fehlzellenbeschriftung;
Geometrieattribute werden niemals lokalisiert oder normalisiert. Bestehende
Parser-, CSV-/JSON-Export-, Wrapper- und Numeriktests bleiben unverändert.

Registrierte Browserfälle `Designsystem simulator layout`,
`Designsystem tools` und `Designsystem simulator results` messen gefüllte
Summary/KPIs, Heatmap, Szenariolog, echten kurzen Backtest samt Portfolio,
echten kurzen Sweep, Sensitivität/Pareto, Built-in-Optimize und Replay bei
1366/1920/2560 px nach Fontload. Sie prüfen Seitengrenzen, Tastaturscrollen,
Fokus, lange Auswahltexte und erhaltene Druckinhalte. Registrierung und
Nodeprüfung sind keine ausgeführte Browserabnahme. Browser-Smoke, Layoutvergleich,
Offline-/EXE-Abnahme und volle Suite bleiben bei der Steuerung.

### Simulator – Rahmen und Ergebnis

Die Ergebnisübersicht verwendet `ds-plan-card`, `ds-row`, `ds-kpi-strip`, `ds-hint`, `ds-button` und den bestehenden `ds-info`-/`ds-info-button`-/`ds-info-pop`-Popupvertrag. Die Simulatorbindung unterstützt Hover, Fokus, angehefteten Klick, Escape mit Rückfokus und Außenklick. Gemeinsame Komponenten und die Typografieskala werden dabei nicht umskaliert. Lokale `.sim-*`-Styles konsumieren `--balance-h1`, `--balance-h2`, `--balance-h3`, `--balance-body`, `--balance-help` und `--balance-amount`/`-wide`.

Die `.tab-content` ist der benannte Inhaltscontainer `simulator-content`. Unter 2300 px steht das Ergebnisraster 7/5, ab 2300 px Backtest/MC 8/4; Krisen/Laufköpfe bleiben 7/5. Die Krisenkarten wechseln von zwei auf vier Spalten. Unter 1200 px werden Ergebnisflächen gestapelt, unter 640 px auch Krisen und KPI-Zeilen. Die Grenze misst Inhalte nach Sidebar und Panelpadding. SVG-Diagrammtexte verwenden `--balance-help` (14 px). Beim Rendern entspricht die native SVG-Breite der gemessenen Hostbreite, mindestens 820 px; schmale Karten scrollen lokal, anstatt die Schrift zu verkleinern. Druck passt das SVG an die Seitenbreite an; dessen Lesbarkeit bleibt extern zu prüfen.

Die Zustände 01–06 stammen aus Bereitschaft, validiertem Backtest, Ruin, MC-Lifecycle und wirksamen Annahmenrevisionen; Referenzbeispielnamen und -zahlen werden nicht übernommen. Der gemeinsame Suite-Kopf führt den Kontext; der Seitenkopf führt Messing-Eyebrow, H1 und vollständigen Lead, darunter steht die eindeutige Reiterleiste. Die Backtestkarte verwendet Statuschip, Serif-Aussage mit Zeitraum/Ruin, kanonischen Start-/Endbetrag, drei Label-über-Wert-KPIs und Textlinkfuß. Krisenkarten bleiben neutral; einjährige Fenster zeigen nur das Jahr, negative Anzeigeprozente ein echtes Minuszeichen. Kalendercharts erhalten einen nach den vollständigen y-Labels bemessenen Rand, erreichte Krisenbeschriftungen und die vier tatsächlichen Assetreihen; Reserveausschluss bleibt ausdrücklich benannt.

### Simulator – Annahmen

Annahmen zeigt Wer und womit, Bedarf pro Jahr, Alle Parameter, Rente & Personen und Pflege. Grundbedarf, Wunschbedarf und Mindest-Flex stehen offen nebeneinander. Alle Parameter, Details zur Person und die Pflegeannahmen starten geschlossen; ihre Sichtzustände werden nicht gespeichert. Die Profilwahl behält ihren eigenen Klappknopf.

Alle Parameter verwendet dieselben Karten, Zeilen, Segmente und die Kopfzusammenfassung wie Weitere Planwerte in Haushalt & Plan und Balance. Flex-Budget, Reserven und Entnahme & Umschichten stehen in der ersten Zeile, Dynamik und Marktdaten darunter. Die drei 3-Töpfe-Werte gehören in Entnahme & Umschichten; Gold folgt abgesetzt. Der Simulator rechnet den Haushalt als einen Topf und zeigt deshalb keine Verteilung im Haushalt. Nicht hier entfällt auf beiden Rechenseiten, weil dort andere Angaben gepflegt werden als im Plan.

Reserven zeigt Liquiditäts-Reichweite in Jahren und Mindest-Liquidität in Monaten. Beide Werte stammen aus dem Plan, werden im Versuch änderbar und lassen sich bewusst übernehmen. Ohne Vorgabe gelten weiterhin zwei Monate Mindest-Liquidität. Dynamik zeigt zunächst die Voreinstellung mit ausgeblendeten Details; Benutzerdefiniert macht die vorhandenen Detailwerte erreichbar. Planwerte sind außerhalb des Versuchs lesend. Fachliche Sperren, Profilbedingungen und der lokale Versuchsablauf bleiben erhalten.

Die Parameterzeilen verwenden `household-plan-field` mit `ds-input`, `ds-select`, `ds-checkbox` und `ds-segment`. Andere Eingaben behalten `ds-field`. Echte Controls, Feldkennungen und Optionswerte bleiben erhalten. Das ⓘ zum Planungshorizont steht am Label; längere Erklärungen bleiben dort erreichbar. Pflege aus sperrt Modell-, Kosten-, Dauer- und Pflegegradfelder ohne Werteverlust. Die Bedarfswerte verwenden `--value-lg`; Parameterwerte folgen der gemeinsamen Textskala. Monte-Carlo-Einstellungen bleiben ausschließlich im Monte-Carlo-Reiter.

### Simulator – historische Details und Monte-Carlo

Backtest zeigt links die Zeitraumkarte über vier und rechts die Kennzahlen
über acht der zwölf Spalten. Startjahr und Endjahr stehen nebeneinander,
Neu rechnen darunter. Beide Karten strecken sich auf dieselbe Höhe; die
Bedienung bleibt oben. Die Zusatzwerte stehen anfangs geschlossen unter
Weitere Kennzahlen mit `ds-disclosure-toggle`, damit das Kartenpaar kompakt
bleibt. Unterzeilen der Hauptkacheln verwenden `summary-description` und
stehen mit 14 px unter dem Wert. Daten 1929–2025 und die Feldbeschriftungen verwenden
16 px in dunkler Schrift, die Jahreszahlen `--value-md` (17 px Newsreader).
Die Felder sind wie die Planwertkästen 38 px hoch. Revision und Lookback
stehen im ⓘ am Datenhinweis. Die drei Hauptkacheln behalten vollständige
Werte; längere Angaben dürfen umbrechen. Ergänzende Kennzahlen stehen bei
1920 px in zwei, ab 2000 px Inhaltsbreite in drei Spalten. Unter 1200 px
Inhaltsbreite stapeln sich Zeitraum und Kennzahlen, unter 640 px werden die
Kennzahlen einspaltig. Portfolioverlauf und Jahresprotokoll folgen vollbreit.
Die Einordnung steht im Kennzahlenkopf hinter Zeitraum und ausgewerteten Jahren
im gemeinsamen `ds-info`-Popup. Echte Laufhinweise und Datenlücken erscheinen
zusätzlich als Hinweiszahl; geschätzte Werte allein erzeugen keine Warnung.
Ruin und unvollständige Läufe zeigen ihren Ergebnisstatus im Hinweisband
über beiden Karten in voller Breite; der Statuschip bleibt in der Zeitraumkarte.
Rolling Cohorts entfallen auf Nutzerentscheid vom 14.10.2026.

MC-Einstellungen liegen in der nativen Klappe `mcSetupDisclosure` im Monte-Carlo-Reiter. Einstellungen anzeigen öffnet und schließt sie ohne Reiterwechsel. Simulation, Zeitraum & Daten und Stresstest sind ungerahmte Parametergruppen mit Seriftiteln ohne Hintergrundfläche. Alle Gruppen nutzen ein Raster mit fünf gleich breiten Feldspalten bei 1920 und 2560 Pixeln. Zeitraum & Daten und das Start-Szenario stehen nebeneinander auf denselben Feldspalten. Breite Auswahlen belegen mehrere Spalten; die Simulationsmethode belegt nur eine. Unter 1600 Pixel Fensterbreite erhält ihre Spalte das 1,6-Fache der übrigen Simulationsfelder, damit die vollständige Auswahl lesbar bleibt. Dauer, Blockgröße, Schocks, Mindestabstand und Rechenzeit zeigen die Einheit im Feld. Die Extremereignisse des Stresstests bilden darunter eine eigene Gruppe über die volle Breite. Die fünf Werte stehen in einer Zeile, Titel und Kontrollkästchen direkt darüber. Kontrollkästchen stehen in eigenen Zeilen, bündig mit dem Raster. Hinweise bleiben kurz; die Erklärungen zu Gewichtung und Stresstest liegen im ⓘ am Gruppentitel. Rechenlast steht als kurze Zeile am Ende von Simulation. Seed bleibt ohne Tausenderpunkt; Blockgröße bleibt im Eingabekasten.

Erweitert nutzt `ds-disclosure` und dieselbe Schriftgröße wie Details zur Person und Annahmen zeigen. Das ⓘ steht direkt hinter der Zusammenfassung. Zufallsgenerator, parallele Rechenprozesse und Zeitbudget stehen im selben Feldraster; Laufzeitvergleich und Worker-Diagnose bleiben bedienbar. Die Entwicklerkarte steht darin am Ende. Echte Controls, Optionswerte, Ressourcenbestätigung und Laufzustände bleiben erhalten. Die Zusammenfassung zeigt Läufe, Dauer, Methode, Seed,
Stresspreset und Tail-Risk aus den aktuellen Eingaben. Vier Ergebnisansichten
entsprechen 11–15: Überblick, Risiko und Verteilung, Pflege, Szenario-Logs.
Kanonische Deskriptoren liefern Werte und vollständige Infoerklärungen,
einschließlich exakter Nenner, Quantile, getrennten P10-Größen und Pflegegruppen.
Info-Popups unterstützen Hover/Fokus, Klick, Escape mit Rückfokus und Außenklick.

Replay liegt mit vorhandenen IDs und Controller in der Werkstatt; der Badge
zählt weiterhin nur Alternativen. Druck öffnet gezielt MC, Werkstatt und Replay,
Setup, vier MC-Ergebnisse und drei Vergleiche, unabhängig vom Bildschirmzustand.
Andere Werkzeuge und Annahmen werden nicht global geöffnet. Die bestehenden
Typografietokens und benannte `simulator-content`-Query steuern Kartenraster
bei 2300 px nutzbarer Inhaltsbreite; lokale benannte Scrollregionen bleiben.
Bild-/Druckabnahme bei 1920/2560 px erfolgt extern, nicht durch diese Quellregeln.

### Simulator – Werkstatt und endgültige Verträge

Drei `ds-plan-card`-Einstiegskarten stehen in der Reihenfolge Stresspfad-Replay,
Parameter-Sweep, Auto-Optimize. Öffnen ersetzt die Karten durch eine kompakte
`ds-segment`-Wechselnavigation und die volle Arbeitsfläche; Schließen führt mit
Fokus zur Karte zurück. Die vorhandenen Toolhosts werden nur verborgen, niemals
neu erzeugt. Unter 70 rem nutzbarer Inhaltsbreite stapeln sich Karten und Felder.
Werkzeuge sind Unterflächen des benannten `simulator-content`-Containers, keine
zusätzlichen Hauptreiter und kein gemeinsamer Rechenzustand.

Sweep-Ranges verwenden sieben echte editierbare `ds-table`-Zeilen mit Labels,
`ds-input` und einer benannten Tastatur-/Scrollregion. Laufzahl, Rechenlast,
Anwendbarkeit und alle Ergebnisaktionen bleiben erhalten. Optimize verwendet
sieben Presetknöpfe im `ds-segment`, `ds-field-grid` für Ziel, Seeds und
Nebenbedingungen, sowie dynamische `ds-card`-Blöcke mit eindeutigen Labels für
Key/Min/Max/Schritt. Fortschritt und Warnungen sind `ds-note`; Champion,
Testmetriken, Deltas, Stabilität und Modellstatus behalten ihre kanonischen Werte.
Semantische `ds-control-group`-Fieldsets bleiben für Disabled-Vererbung erhalten,
haben aber keinen alten Formularrahmen. Entwicklerzugänge behalten ihren
Aktivierungsvertrag. Kein Emoji ersetzt einen Bedienknopf.

Werkstatt- und Ergebnis-Infofenster verwenden `ds-info`, `ds-info-button` und
`ds-info-pop`: Hover/Fokus, Klick, Escape mit Rückfokus und Außenklick. Alle
Simulatorflächen konsumieren die vorhandene `--balance-*`-Skala; Charttexte
verwenden `--balance-help` (14 px). Heatmaps und Pareto behalten ihre Daten,
Skalen, Labelunterlagen und lokale Scrollkapseln; native Mindestbreiten
verhindern Schrumpfen der Diagrammtexte unter 12 px am Bildschirm.

Ergebnisverträge: Backtest-Endvermögen enthält die Pflegereserve, Portfoliochart
und Krisentiefstände schließen sie aus. Krisenbänder folgen den tatsächlichen
Kalenderzeilen und enden bei Ruin. Das MC-Raster hat 100 Punkte und rundet nur
die Visualisierung; Fallzahlen, exakter Nenner, Wilsonintervall, Quantile und
Missingness bleiben unverändert. Separate flüchtige Laufköpfe und
Veraltetheitszustände sind keine neue Ergebnis-Persistenz. Ab 2300 px
**nutzbarer Inhaltsbreite** gilt das Ergebnisraster 8/4, darunter 7/5;
Krisen/Laufköpfe bleiben 7/5, Krisenkarten wechseln von zwei auf vier Spalten.

Druck öffnet MC-Setup, alle vier MC-Ansichten und drei Replayvergleichsansichten
unabhängig von Hauptreiter und offenem Werkzeug. Toolkarten, Navigation und
Infofenster entfallen; native Details bleiben offen druckbar, lokale Scroll-/
Stickybegrenzungen lösen sich. Es gibt keinen neuen Sweep-/Optimize-Druckvertrag.
Bild-/Druckabnahme 16–18 bei 1920/2560 px und Gesamtvergleich 1920/3440 px sowie
Nutzerprüfung in der Kandidaten-EXE stehen extern aus. Referenzbeispielzahlen
werden nicht als Finanz-Sollwerte benutzt; Referenzbilder bleiben unverändert.

## Ausnahmen

Stand der Grundlagen: 4. Oktober 2026.

### Einzeln begrenzte Bestandsausnahmen und neue grafische Ausnahme

Die folgenden Dekor-, Sichtbarkeits- und Druckdeklarationen sind bis auf den
ausdrücklich neuen Navigations-Backdrop unverändert übernommen.
Sie erlauben keine zusätzliche Textdeckkraft oder Altpalette an
anderen Stellen. Drucktext bleibt auf Weiß kontrastfest; Schatten, Trennlinien
und leere Abdunklungen sind keine Texteltern. Der Balance-Tooltip hat im fertigen Hoverzustand Deckkraft 1; sein bestehender
Sichtbarkeitsübergang bleibt als einzeln begrenzte Bestandsausnahme erhalten.
Neue Textdeckkraft oder zusätzliche Übergänge sind dadurch nicht zugelassen.

| Quelle | Selektor | Deklaration | Begründung |
|---|---|---|---|
| css/components.css | .navigation-guard-dialog::backdrop | background: var(--backdrop) | Neue grafische Ausnahme: textfreier Navigations-Backdrop; keine Text- oder Elterndeckkraft. |
| css/balance.css | .btn:not(:disabled):not(.ds-button-primary):not(.ds-button-danger):hover | box-shadow: 0 4px 12px rgba(197, 160, 89, 0.15) | Bestehender Dekorschatten außerhalb der Textfläche. |
| css/balance.css | .expenses-dialog | box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35) | Bestehender Dialogschatten. |
| css/balance.css | .expenses-dialog::backdrop | background: rgba(0, 0, 0, 0.45) | Grafischer Dialoghintergrund ohne Text. |
| css/balance.css | .annual-update-steps .step-dot | box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08) | Rein grafischer Fortschrittspunkt. |
| css/balance.css | .help-tooltip .tooltip-text | box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) | Bestehender Tooltipschatten. |
| css/balance.css | .profilverbund-header-group | background: linear-gradient(to right, rgba(197, 160, 89, 0.05), transparent) | Bestehende opake Textdarstellung über minimalem Dekor auf heller Fläche. |
| index.html | .app-icon-wrapper | box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05) | Bestehender Symbolschatten. |
| css/balance.css | .basiswerte-divider | opacity: 0.6 | Leere dekorative Trennlinie. |
| css/balance.css | .help-tooltip .tooltip-text | opacity: 0 | Bestehender verborgener Tooltip; im Hoverzustand Deckkraft 1. |
| simulator.css | .chart-svg .area-band | opacity: 0.15 | Reine Datenfläche ohne Textkinder. |

Die grafische Sweep-/Pareto-Kontextwolke (`circle opacity="0.6"`) und die
kritische Heatmapüberlagerung (`fill-opacity: .12`) haben keine Textkinder;
Labelunterlagen bleiben opak. Dies wird an erzeugten Fragmenten geprüft.

### Unvermehrte Prioritätsausnahmen

Jede Ausnahme wird in `PRIORITY_EXCEPTIONS` mit Quelle, normalisiertem Selektor
und exakter Deklaration abgeglichen; entfernte Ausnahmen sind kein Kontingent.
Die bestehenden Regeln betreffen mobile Einspaltenansichten, Logtasten,
Fehlerrahmen, visuell versteckten Hilfstext und die unveränderte Drucköffnung.

| Quelle | Selektor | Bestehende Deklaration |
|---|---|---|
| Simulator.html | .log-export-buttons button | width: auto !important |
| Simulator.html | .log-export-buttons button | min-width: 0 !important |
| Simulator.html | .log-export-buttons button | flex: 0 0 auto !important |
| Simulator.html | .ao-preset-btn:hover | border-color: var(--secondary-color) !important |
| Simulator.html | #scenarioSelect | min-width: 0 !important |
| Simulator.html | .form-grid, .form-grid-three-col, .form-grid-four-col, .form-grid-compact | grid-template-columns: minmax(0, 1fr) !important |
| Simulator.html | .care-sections, .care-section-grid, .care-duration-group, .care-grade-row | grid-template-columns: minmax(0, 1fr) !important |
| depot-tranchen-manager.html | [aria-invalid="true"] | border-color: var(--bad) !important |
| depot-tranchen-manager.html | [aria-invalid="true"] | box-shadow: 0 0 0 3px var(--bad) !important |
| css/balance.css | .input-error | border-color: var(--danger-color) !important |
| css/balance.css | .input-error | box-shadow: 0 0 0 3px var(--bad) !important |
| css/balance.css | .tab-panel | display: block !important |
| simulator.css | .mc-setup-disclosure:not([open]) > .mc-setup-content > :not(#mcButton) | display: none !important |
| simulator.css | .visually-hidden | position: absolute !important |
| simulator.css | .visually-hidden | width: 1px !important |
| simulator.css | .visually-hidden | height: 1px !important |
| simulator.css | .visually-hidden | padding: 0 !important |
| simulator.css | .visually-hidden | margin: -1px !important |
| simulator.css | .visually-hidden | overflow: hidden !important |
| simulator.css | .visually-hidden | clip: rect(0, 0, 0, 0) !important |
| simulator.css | .visually-hidden | white-space: nowrap !important |
| simulator.css | .visually-hidden | border: 0 !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel[hidden], [data-stress-replay-comparison-panel][hidden] | display: block !important |
| simulator.css | .stress-replay-diagnostics > dl | display: grid !important |
| simulator.css | .mc-view-nav, .tab-buttons, .mc-setup-toggle, .stress-replay-comparison-tabs, .stress-replay-expert-toggle, #mcShowReplayButton, #mcShowScenarioLogsButton | display: none !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll | width: auto !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll | max-width: 100% !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll | height: auto !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll | max-height: none !important |
| simulator.css | #mcSetupDisclosure, #mcSetupDisclosure > .mc-setup-content, .mc-view-panel, #monteCarloResults, #simulationLog, #scenarioLogOutput, .stress-replay-table-scroll | overflow: visible !important |
| simulator.css | #tab-montecarlo th | position: static !important |
| simulator.css | #simulationLog table, #scenarioLogOutput table, .stress-replay-table-scroll table | width: 100% !important |
| simulator.css | #simulationLog table, #scenarioLogOutput table, .stress-replay-table-scroll table | min-width: 0 !important |
| simulator.css | #simulationLog th, #simulationLog td, #scenarioLogOutput th, #scenarioLogOutput td, .stress-replay-table-scroll th, .stress-replay-table-scroll td | min-width: 0 !important |
| simulator.css | #simulationLog th, #simulationLog td, #scenarioLogOutput th, #scenarioLogOutput td, .stress-replay-table-scroll th, .stress-replay-table-scroll td | white-space: normal !important |

Der kurze Werkzeug-Browserfall kann eine konstante Sensitivitätsmetrik liefern.
In diesem Fall füllt ausschließlich die Sensitivitätsanzeige eine synthetische
Varianzfixture; echte Sweepdaten, Ranking und Übernahme bleiben unverändert.

Dynamische `.ao-param-key`-Selects erhalten eine stabile additive ID und ein
zugeordnetes Label für den Auswahlvolltext. Bestehende Klassen, `data-param-id`,
Domainlistener und numerische Min-/Max-/Stepwerte bleiben erhalten.

### Nachweise und Abnahmegrenzen

Der Quellvalidator umfasst ausdrücklich die fünf Seiten, Tokens/Fontfaces,
Balance-/Simulator-CSS, Balance-Startmeldungen, die Symbolhilfe sowie gemeinsame
Komponenten und Feldzustandshilfe.
Sein Grundflächenmanifest prüft exakte Rollen, Aliasauflösung, Ladefolge,
Fontpfade, Fremdquellen, Prioritätsausnahmen und Text-/Elterndeckkraft.
Originale und injizierte Gegenproben stehen in `designsystem-foundation.test.mjs`.
`designsystem-icons.test.mjs` prüft die DOM-Grenze in Node; der Browserfall
`Designsystem foundation` prüft echten Parser/Import, Fonts und Grundbild
bei 1366/1920/2560 px mit gesperrten externen Requests einschließlich Symbol-Ladefehler.

`designsystem-components.test.mjs` prüft Rollen, benannte Symboltasten, Ladefolge,
Fokus und Gegenproben für ungültige Zustände/Textdeckkraft.
`designsystem-field-state.test.mjs` prüft alle sieben Zustände, Wechsel,
Idempotenz, eindeutige Gründe und unveränderte Werte/Sperren/Inputattribute.
`designsystem-start-handbook.test.mjs` führt den tatsächlichen I10-Inline-Renderer
in Node aus und schützt Handbuchanker/Abbildungen. Registrierte Browserfälle
`Designsystem components`, `Designsystem recovery banner` und `Handbuch.html`
prüfen echten DOM/Fokus, Quarantäne, Dateiauswahl, Schließen/Reload sowie Kapitel,
Suche, Bilder und Hilfeanker. `handbook-search.test.mjs` prüft die Textsuche mit
Umlauten und mehreren Suchwörtern ohne Browser.

Komponenten und Renderer sind im Quellvertrag erfasst.
Die nachfolgend einzeln dokumentierten Bestandsausnahmen sind an Quelle, Selektor
und Deklaration gebunden. Die Quellprüfung ersetzt keine Kaskaden-/Browserabnahme.
Die Handbuchmigration ist mit 17 Kapiteln,
erhaltenen Aliasankern und lokaler Suche umgesetzt; die Kandidaten-EXE bleibt extern zu prüfen.

Die volle Node-Suite fährt der Orchestrator. Browser-Smoke, Layoutvergleich,
Druck- und Offline-/EXE-Abnahme fährt die gesteuerte Sitzung außerhalb der Sandbox.

### Prüfung und Härtung

<a id="pruefung-und-haertung"></a>

Prüflücken nach dem Änderungsrisiko bearbeiten und die Zuordnung im Auftrag begründen. Eine Änderung an Typografie zieht nicht die gesamte Testschuld eines Elements nach. Neue Hosts oder neues Markup brauchen Bediennachweise für die betroffenen Aktionen; Zustandsänderungen brauchen Nachweise für diese Zustände. Allgemeine Testschuld bleibt im [Funktionsinventar](funktionsinventar.md). Stabile IDs, Data-Anker, Hosts und Funktionen belegen Erreichbarkeit, keine wörtlichen Codeausschnitte. Quelle und Lesefassung werden über `scripts/generate-funktionsinventar.mjs` gemeinsam gepflegt.

Node- und Quellprüfungen belegen keine Browser- oder EXE-Abnahme. Testbefehle und Plattformvoraussetzungen stehen im [Test-README](../../tests/README.md). Vor dem Merge fährt die gesteuerte Sitzung den Browser-Smoke auf dem fertigen Stand und der Nutzer prüft die Kandidaten-EXE. Die fünf Alltagsabläufe bleiben Maßstab: Tranche korrigieren, Verkauf samt Cash erfassen, Simulationsannahme ändern, Ausgaben importieren und auswerten, Jahr abschließen. Gespeicherter Endzustand, Schritte und Seitenwechsel dürfen beim Umbau nicht schlechter werden.

Bildvergleiche verwenden synthetische Haushalte bei 1920×1080 und 2560×1440. Layoutbefunde vollständig erfassen; nur den Bericht kürzen. Zählungen je Art und Ansicht verhindern, dass ein neuer Fehler zwischen alten verschwindet. Kurze echte Rechenläufe und gefüllte Zustände gehören zur Endabnahme. Das externe Abnahmewerkzeug wird nicht Voraussetzung eines Agententests.

Eine Kandidaten-EXE gehört zum exakten Prüfcommit. Herkunftsvermerk und SHA-256 belegen die Zuordnung. Im separaten Buildordner bekommt sie einen eigenen Tauri-Bezeichner und einen erkennbaren Fenstertitel; alternativ wird ein getrenntes Testkonto verwendet. Fachbestand, Snapshot-Archiv und WebView-Speicher der Alltags-App bleiben getrennt. Vor und nach der Abnahme müssen deren Datei-Hashes gleich sein. Beispieldaten oder eine Kopie des Bestands werden nicht in den Alltag zurückgeschrieben. `src-tauri/tauri.conf.json` und `src-tauri/src/lib.rs` bestimmen Bezeichner und Ablage; die Trennung ist vor der Nutzung nachzuweisen.

Bei Änderungen am Monte-Carlo-Aggregator Finanzresultate, Finalisierung, Missingness, Dimensionsgrenzen und Transferbuffer getrennt prüfen. Ein ungültiger Zusatzfächer darf im fehlertoleranten Consumer nur den Fächer verwerfen; der öffentliche Validator bleibt strikt. Quellen: `app/simulator/monte-carlo-chunk-result.js`, `app/simulator/monte-carlo-runner.js`. Laufzeitvergleiche auf Abnahmehardware messen Gesamtzeit, Zusammenführung und Transfer mit gleichem Seed, Inputs und Warm-up über mehrere Wiederholungen. Wiederholbare Verschlechterung über dem Messrauschen ist ein Befund; ein Quelltest verspricht keinen Zeitgewinn und keinen Speichergipfel.

Härtung bleibt offen für große Personenbestände, lange Namen, Providerheuristiken, Mehrfensterkonflikte über den Mindestschutz hinaus, schmale Fenster, Screenreader und kombinierte Dialog-/Recoveryzustände. Schreibbesitz, Deadline, Nichtüberschreiben fremder Daten, Rohdatenerhalt, Flushbestätigung und Recovery sind schon Pflichtverträge. Härtung darf sie nicht aufschieben.
