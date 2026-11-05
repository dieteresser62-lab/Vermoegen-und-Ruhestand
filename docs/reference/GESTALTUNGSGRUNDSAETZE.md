# Gestaltungsgrundsätze von Vermögen & Ruhestand

Verbindliche Ziele für Entwickler und Agenten. Stand: 27.10.2026. Nutzerentscheidung vom 26.10.2026: Die gesamte App soll eine einheitliche Oberfläche und Bedienung haben.

## Ziel

### Einheitlichkeit

Erweiterungen verwenden dieselben Muster wie die bestehende App. Tokens, Bausteine und belegte Ausnahmen stehen im [Designsystem „Stein & Messing“](DESIGNSYSTEM.md). Bei Widerspruch gilt dessen konkrete Vorgabe; die Steuerung gleicht die Kurzfassung an.

## Regeln

### Zahlen und Texte

| Regel | Vorgabe |
|---|---|
| 2 | Eine große Hauptzahl je Karte in Serifenschrift. Darunter klein Inhalt und Bezug. Drei Zahlenrollen: Kennzahl, Zwischenwert, Erklärung. |
| 3 | Erklärungen knapp halten: ein Satz unter der Zahl, Details hinter ⓘ, Herleitungen im zuständigen Thema. |
| 4 | Jede Zahl nennt Bezug, Zeitraum, Einheit, Stand und Quelle. Null, fehlend und nicht anwendbar bleiben verschieden. |
| 5 | Deutsch, Du-Form, kurze Sätze und dieselben Begriffe: Geldvermögen ohne Immobilien, Gesamtvermögen mit Immobilien; „Anleihen“. |
| 6 | Tabellen: tabellarische Ziffern, Beträge rechtsbündig mit Tausenderpunkt und €. Spalten benennen und gruppieren; Herleitung im Zell-ⓘ. Neue Spalten nur mit Bedeutung für den Haushalt. |
| 9 | Farben aus Tokens: Messing für Hinweise und Überschreitungen, Rot für Fehler, Ruin und Verlust. Keine Farbe ohne Bedeutung. |
| 10 | Vermögensgrafiken zeigen Gesamtvermögen mit unterscheidbaren, gestapelten Teilen für Geldvermögen und Immobilien. Legende benennt genau die gezeichneten Elemente, Achse die Einheit. Lücken und Vereinfachungen im ⓘ erklären. Immobilien in Diagrammen als helle Tönung; Linien des Geldvermögens bleiben führend. |
| 13 | Jede Vermögenshauptzahl heißt „Gesamtvermögen“; darunter „davon Geldvermögen … · Immobilien …“. Bestandsverteilungen enthalten selbst genutzte und vermietete Immobilien. Entwicklung, Rendite, Ruin, Deckung und Strategiequoten beziehen sich auf Geldvermögen und sagen das ausdrücklich. |
| 14 | Ein ⓘ erklärt einen Begriff in höchstens drei Sätzen (etwa 50 Wörter), ohne Speicher-, Migrations- oder Versionsdetails. Längeres steht im Handbuch; das ⓘ verlinkt mit „Mehr im Handbuch“. |

### Bedienung

| Regel | Vorgabe |
|---|---|
| 1 | Vorhandene Karten, Kennzahlen, Tabellen, ⓘ, Dialoge, Felder und Knöpfe verwenden. Neue Muster, Farben oder Schriften begründen; neue Seiten und größere Gestaltung zuerst entwerfen. |
| 7 | Formulare thematisch gruppieren, höchstens drei bis vier Felder je Zeile. Beträge rechtsbündig mit Tausenderpunkt und Einheit im Feld. Optionale Felder kennzeichnen; übernommene und gesperrte Werte mit Grund zeigen. |
| 8 | Gleiche Aufgabe, gleicher Knopf am gleichen Ort. Eingaben wie vorgesehen sichern. Nur bei drohendem Verlust nachfragen. Navigation über die Seitenleiste; Schließen über X verliert nichts. |

### Bildschirm

| Regel | Vorgabe |
|---|---|
| 11 | PC-Ziele 1920×1080 und 2560×1440, Mindestbreite 1280 px. Keine Handy-/Tabletgestaltung und keine neue Druckarbeit. Tastatur und Barrierefreiheit haben geringe Priorität; Bestehendes erhalten. |
| 12 | Handbuchabschnitte höchstens etwa 200, Kapitel etwa 1.000 Wörter. Tabellen nutzen, Bilder aktuell halten, neue Fachfunktionen an einem Beispielhaushalt zeigen. |

## Abnahme

### Bild und Beschriftung

Die Steuerung prüft vor der Prüf-EXE jeden geänderten Bildschirm als Ganzes bei beiden Zielauflösungen: Rangfolge, Gewichtung, Abstände und Ausrichtung. Gleichartige Stellen nebeneinander und gemischte Fälle mit/ohne Immobilien, Gold und Anleihen sowie Haushalt/Person ansehen. Prüfbilder, Handbuchbilder und Beschriftungen gehören dazu. Abweichungen werden konkrete Folgeaufträge. Node-Tests ersetzen diese Abnahme nicht.
