# Sicherung und Wiederherstellung

Was eine Sicherung schützt und was beim Zurückholen verloren gehen kann. Für Nutzer und fachlich Interessierte. Codeprüfung: 02.11.2026.

## Auf einen Blick

- Die Vollsicherung überträgt den gespeicherten fachlichen App-Stand als Datei.
- Ein Wiederherstellungspunkt liegt im selben lokalen Datenbereich wie dein Bestand und schützt nur seinen ausgewiesenen Umfang.
- Ergebnisexporte und einzelne Personendateien ersetzen keine Vollsicherung.
- Browser und EXE haben getrennte Speicher. Ein leerer Bildschirm bedeutet deshalb noch keinen Datenverlust.

## Was geschützt ist

### Vollsicherung

Die Vollsicherung enthält alle gespeicherten Personen einschließlich Außenpersonen, deren Bestände und Einkünfte sowie Haushalt, Plan, Pflege- und Erbentscheidungen. Gespeicherte Ausgaben, Abschlussbelege, Vermögensverläufe, Tageskurse und Simulatoreinstellungen samt gespeicherten Kurzbelegen gehören dazu.

Das Wiederherstellungsarchiv und Layoutpräferenzen gehören nicht in diese Datei. Eine Vollsicherung am anderen Gerät stellt daher keine Liste früherer Wiederherstellungspunkte her. Die Klappenstellung von „Budget im Vergleich“ und „Markt und Umschichtung“ bleibt während der Anzeige bei Aktualisierungen erhalten; sie wird nicht gespeichert. Während des Spielbereichs sind Vollsicherung und Import gesperrt. Auf Daten & Sicherung sind beide Knöpfe deaktiviert; eine graue Zeile erklärt den Grund.

### Wiederherstellungspunkt

Die App legt Punkte etwa vor Monats- und Jahresabschlüssen oder Importen an. Sie helfen, eine Änderung im jeweiligen Umfang zurückzunehmen. Ein normaler Punkt setzt die zugeordnete Person und gemeinsame Fachdaten zurück; andere Personen bleiben erhalten. Tageskurse, Verlaufsbeginn, Funktionseinstellungen und Vollsicherungszeit bleiben dabei unverändert. Ist die zugeordnete Person gelöscht oder der Punkt beschädigt, kann dieser Rückweg gesperrt sein.

Ein neuer Punkt vor einem Haushalts-Monatsabschluss stellt den gesamten erfassten Stand einschließlich aller Personen, Tagesgeldverläufe und Monatsbelege gemeinsam zurück. Auch spätere Änderungen anderer Personen können dadurch entfallen.

Punkte vor Personenlöschung und Haushaltsänderung sichern alle zugelassenen Fachdaten einschließlich aller Personen. Das gilt auch für vorhandene Punkte „Vor dem Löschen aller Tranchen“. Auch Vollimport, „Neu beginnen“ und die Übernahme einer Spielkopie können größere Bereiche ersetzen. Entscheidend ist der Umfang der Vorschau, einschließlich „entfällt“.

Manuelle und monatliche Punkte sowie Punkte vor Vollimport, Balance-Import, Zurückholen und Spielbereich bleiben einschließlich 30 Tagen vollständig erhalten. Danach bleibt je Monat, Rückholpunktart und Datenumfang der letzte Stand; manuelle und monatliche Punkte teilen sich einen Monatsstand. Ein älterer Punkt darf nur weg, wenn ein jüngerer erhaltener Punkt denselben Umfang deckt. Punkte des ganzen Bestands brauchen dieselbe Wiederherstellungsregel; ein personenbezogener Punkt reicht als Deckung nicht aus (FR-70).

Jahresabschlüsse, Plan- und Personenumstellungen, „Neu beginnen“, Übernahmen aus dem Spielbereich und unbekannte Anlässe zeigen „Bleibt immer erhalten“. Punkte vor Personenverwaltung einschließlich Haushaltsänderungen sowie vorhandene Punkte vor einer früheren Tranchengesamtlöschung bleiben beim Aufräumen ebenfalls erhalten. Sie sind einzeln löschbar, solange kein gespeicherter Vorgang sie benötigt und die Prüfung lesbar ist. Beschädigte oder nicht sicher vergleichbare Punkte bleiben.

Jeder Punkt zeigt eine Grundzeile: Einzeln löschbare Personenpunkte nennen „Bleibt, bis du ihn selbst löschst“, Aufräumkandidaten „Fällt beim Aufräumen weg“. „Punkt löschen …“ erscheint nur bei jetzt löschbaren Punkten. Löschen und Aufräumen zeigen ihre Arbeit und das Ergebnis direkt an der Aktion; währenddessen sind die Punktaktionen gesperrt. Nach einer Einzelpunktlöschung bleibt die Bestätigung bis zum nächsten Seitenstart am Anlass sichtbar.

Im laufenden Spielbereich sind Zurückholen und Aufräumen gesperrt. Ein Hinweis erklärt, dass die echten Daten und Sicherungspunkte unverändert bleiben. Beendete Spielbereichspunkte bleiben als Archiv ohne Rückholfunktion gespeichert. Die Spielkopie hat ihren eigenen Rückkehrweg. Bedienung: [Punkte zurückholen und aufräumen](../../Handbuch.html#sicherung-punkte).

Bei „Neu beginnen“ mit Archivlöschung entfallen auch die internen Rückkehrpunkte; ein neuer Punkt vor dem Leeren wird dann nicht angelegt.

### Export

| Datei | Zweck und Grenze |
| --- | --- |
| Ergebnisdatei als CSV oder JSON | Hält ausgewählte Rechenergebnisse fest; stellt keinen App-Bestand wieder her. |
| Personendatei | Überträgt eine Person mit eigenen Daten und Depot; gemeinsame Haushaltsdaten und Belege fehlen. Beim Import entsteht eine neue Außenperson. |
| Balance-Datei | Überträgt den Balance-Zustand des aktuellen Rechenkontexts; ersetzt weder Personenverwaltung noch Vollsicherung. |

## Wiederherstellen und wechseln

### Ersetzung

Ein Vollimport ersetzt die aktuell gespeicherten fachlichen Daten. Daten, die in der Datei fehlen, können dabei entfallen; zwei Haushalte werden nicht zusammengeführt. Das vorhandene Wiederherstellungsarchiv bleibt erhalten. Vor dem Ersetzen erzeugt die App einen internen Rückkehrpunkt und stößt bei vorhandenem Bestand zusätzlich eine Wiederherstellungsdatei an. Prüfe deren Ablage ebenso wie die deiner Vollsicherung.

Vor dem Zurückholen eines Punkts entsteht ein weiterer Punkt des Ausgangsstands. Änderungen nach dem gewählten Sicherungszeitpunkt gehen im ersetzten Bereich verloren.

### Browser und EXE

Im Browser hängt der Bestand an Browserprofil, Hostname und Port. `localhost` und `127.0.0.1` sind verschiedene Herkünfte. Die EXE speichert im App-Datenordner des Windows-Benutzers; ihr Ablageort bestimmt den Datenbereich nicht. Produktiv-App, Entwickler-App, Prüfkandidat und frühere RuhestandSuite können unterschiedliche Bestände zeigen.

Für den Wechsel dient die Vollsicherung aus der bisherigen Laufzeit. Die [Betriebsanleitung](../guides/EINRICHTUNG_UND_BETRIEB.md#speicherorte) nennt die Datenbereiche und den angezeigten Ordner. Browserbestand und interne Punkte gehen beim Löschen der Website-Daten verloren; bei Verlust des EXE-Datenordners fehlen dort Bestand und Archiv.

### Prüfung danach

Vergleiche Personen, Haushaltsauswahl, Tagesgeld, Tranchen und Plan mit dem erwarteten Stand. Prüfe außerdem Abschlussbelege und Kurszeit. Eine erfolgreiche Wiederherstellung macht gespeicherte Kurse nicht aktuell.

Beispiel mit Max und Erika, Prüfdatum 27.10.2026: Spielst du ihre Vollsicherung in einen leeren EXE-Datenbereich ein, folgen ihre gespeicherten Fachdaten und Tageskurse. Das Archiv der Browserherkunft folgt nicht. Ein normaler Wiederherstellungspunkt innerhalb derselben Herkunft lässt hingegen die dortigen Tageskurse erhalten.

## Fehlerfall

### Leere Herkunft

Prüfe zuerst Laufzeit, Adresse und Browserprofil. Lege einen scheinbar fehlenden Haushalt nicht sofort neu an und überschreibe keine vorhandene Sicherungsdatei mit einem leeren oder unklaren Stand.

### Wiederherstellung

Widersprüchliche Personenkennungen und Dateien mit mehr als zwei Haushaltspersonen werden vor dem Vollimport abgewiesen. Ein eigener Altbestand mit mehr Mitgliedern bleibt sicherbar und über Archivpunkte zurückholbar; Rechnungen sind bis zur Haushaltskorrektur gesperrt. Eine ungültige Datei oder veränderte Importgrundlage kann den Import verhindern. Scheitert das Schreiben und bestätigt die App die Rücknahme, ist der bisherige Stand unverändert. Kann sie die Rücknahme nicht bestätigen, prüfe die Meldung und den angelegten Wiederherstellungspunkt. Nach bereits gespeichertem Restore mit fehlgeschlagenem Neuladen bleiben alte Formulare gesperrt; lade die Seite wie gemeldet neu.

Fehlt nach einem abgebrochenen EXE-Schreibvorgang die Hauptdatei, lädt die App eine lesbare Rettungsdatei. Sind nur unlesbare Rettungsdateien vorhanden, meldet sie einen Fehler und erhält die Dateien. Eine beschädigte EXE-Bestandsdatei wird separat aufbewahrt. Lösche den Datenordner nicht als ersten Reparaturversuch.

### Sichere Dateiablage

Bewahre Vollsicherungen außerhalb des App-Datenordners auf, für Geräteverlust auch auf einem getrennten Datenträger. Behalte mehrere datierte Stände.

## Grenzen

- Nur im geöffneten Fenster vorhandene Simulationsergebnisse sind durch die Vollsicherung nicht vollständig geschützt; bewahre benötigte Ergebnisexporte zusätzlich auf.
- Die Meldung über angestoßene Dateiausgabe beweist nicht, dass du die Datei tatsächlich aufbewahrt hast.

## Wo du es in der App siehst

„Daten & Sicherung“ zeigt Vollsicherung, Wiederherstellungspunkte, Austausch und Speicherstatus. Die Klickwege stehen im [Handbuch](../../Handbuch.html#daten-sicherung). Technische Umfänge und Dateiformate: [Datenverträge](DATENVERTRAEGE.md#austausch).
