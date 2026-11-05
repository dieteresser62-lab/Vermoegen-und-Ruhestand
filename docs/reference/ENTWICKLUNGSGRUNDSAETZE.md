# Entwicklungsgrundsätze

Verbindliche Nutzerprioritäten für Entwickler und Agenten in Handbetrieb und orchestrierten Läufen. Stand: 01.11.2026; Entscheidungen vom 11., 21. und 31.10.2026.

## Zwischenstände

### Manuelle Testfähigkeit

Manuell testfähige Zwischenergebnisse haben Vorrang. Der Nutzer soll die EXE bedienen und Fehler und Ideen melden können. Seine Testbefunde kommen zeitnah als nächste Arbeit an die Reihe.

### Fehlerschwere

Entwicklungsgeschwindigkeit geht vor vollständiger Detailkorrektheit jedes Zwischenschritts. Zwischenstände müssen bedienbar sein und dürfen keine Daten gefährden. Arbeit in möglichst wenige, große, ab 1 nummerierte Schritte schneiden. Reviews führen sofort zu Korrekturen, wenn der Nutzer den Fehler im manuellen Test bemerkt oder Daten fehlerhaft werden. Andere Randfälle, Feinschliff und Härtung mit dem Vermerk „später“ in der Härtungsliste sammeln.

Schreibbesitz, bestätigtes Speichern, Recovery und Schutz fremder Daten gelten bereits im Zwischenstand. Härtung verschiebt diese Pflichten nicht. Die [Gestaltungsgrundsätze](GESTALTUNGSGRUNDSAETZE.md) und das [Designsystem](DESIGNSYSTEM.md) gelten für jede Oberflächenänderung.

## Modulpflege

### Dateigröße als Hilfsmittel

Die Größenprüfung (`scripts/check-file-size.mjs`, Liste `typcheck/grosse-dateien.json`) meldet Dateien über 300 Codezeilen; sie ist kein Zerlegungsauftrag. Entscheidend sind klare Aufgaben und wenige verständliche Abhängigkeiten. Wächst eine Datei aus fachlichem Zusammenhang über die Grenze oder ihren Listenwert, wird der neue Wert eingetragen und im Bericht begründet; über 1.000 Codezeilen wird nach Aufgaben zerlegt oder ein offener Punkt genannt. Zerlegt wird nur, was ein Auftrag ohnehin anfasst.

### Zerlegte Ordner über ihre Fassade

Eine Datei mit gleichnamigem Unterordner ist dessen Fassade: Der Rest der App nutzt nur sie, Module im Ordner importieren nur ihre Geschwister. Gemeinsame Zustandsobjekte wie `storeState` bleiben im Ordner; benötigte Zugriffe erhalten sprechende Namen in der Fassade. Direkte Zugriffe von außen machen die Struktur für Menschen schwer nachvollziehbar. `tests/module-boundaries.test.mjs` prüft diese Grenze.

## Prüfungen

### Node

Automatisierte Tests sichern die manuelle Testfähigkeit: Grundbedienung, keine Abstürze und korrekte Datenpfade für Sicherung, Wiederherstellung, Import und Abschlüsse. Neue Logik durch Node-/DOM-Tests nachweisen. Keine Browserfälle für Zwischenzustände anlegen. Bestehende Fälle nur anpassen, wo entfernte Elemente angesprochen werden.

### Browserendstand

Technische Detailkorrektheit und automatischer Testbetrieb sind wichtig. Sie erhalten eine eigene Phase, wenn die Oberfläche steht. Dann folgen das Härtungspaket und die vollständigen Browsertests am Endstand. Bis dahin werden offene Punkte gesammelt, nicht verworfen. Prüfrollen und Zuständigkeiten für die volle Suite stehen in [AGENTS.md](../../AGENTS.md#validierung).

## Bedienung

### PC

PC-Ziele sind 1920×1080 und 2560×1440, Mindestbreite 1280 px. Andere Auflösungen blockieren die Entwicklung nicht. Keine Anpassungen oder Prüfungen für Handy- oder Tabletbreiten.

### Tastatur

Klicken, Tippen und Bestätigen müssen funktionieren. Fokusführung, Tab-Reihenfolge, Screenreader/ARIA und weitere Barrierefreiheit haben geringe Priorität; bestehende Bedienbarkeit darf nicht verloren gehen. Weitergehende Befunde kommen in die Härtungsliste.

### Kein Druck

Aus der App wird nicht gedruckt. Keine neuen Druckansichten, Druckprüfungen oder Nachbesserungen an Druckregeln. Scheitert eine Prüfung ausschließlich an einem Druckvertrag, sie mit Begründung herausnehmen. Vorhandene Druckregeln bleiben bis zum Aufräumen nach der Produktivsetzung unangetastet.
