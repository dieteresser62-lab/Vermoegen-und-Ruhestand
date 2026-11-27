# Sicherung und Wiederherstellung

Was die Vollsicherung und die Wiederherstellungspunkte schützen. Für Nutzer und fachlich Interessierte. Codeprüfung: 26.11.2026.

## Auf einen Blick

- Die Vollsicherung ist eine Datei mit dem gespeicherten fachlichen Stand des geöffneten Haushalts. Du erstellst sie selbst und spielst sie bei Bedarf wieder ein.
- Wiederherstellungspunkte legt die App selbst an, immer für den ganzen Haushalt.
- Zurückholen setzt immer den ganzen Haushalt auf den Stand des Punkts.
- Mit mehreren Haushalten sicherst du jeden Haushalt einzeln. Ergebnisdateien ersetzen keine Vollsicherung.
- Browser und EXE haben getrennte Speicher. Ein leerer Bildschirm bedeutet deshalb noch keinen Datenverlust.

## Was geschützt ist

### Vollsicherung

Die Vollsicherung enthält alle Personen des Haushalts, deren Bestände und Einkünfte sowie Haushalt, Plan, Pflege- und Erbentscheidungen. Gespeicherte Ausgaben, Abschlussbelege, Vermögensverläufe, Tageskurse und Simulatoreinstellungen gehören dazu. Die Wiederherstellungspunkte und Layoutpräferenzen gehören nicht in die Datei.

Die Desktop-App fragt mit „Speichern unter“, wo die Datei hin soll, und nennt danach Ordner und Dateinamen. Bietet der Browser einen Speicherdialog an, wartet die App ebenso, bis die Datei geschrieben ist. Erst dann gilt die Sicherung als erstellt. Ein Abbruch im Dialog ändert nichts. Browser ohne Speicherdialog legen die Datei im Download-Ordner ab; dann heißt der Status „Sicherung angestoßen – bitte Ablage prüfen“. Im Spielbereich sind Vollsicherung und Einspielen gesperrt. Das Alter der letzten Vollsicherung zählt Kalendertage. Eine Sicherung von gestern Abend heißt am nächsten Morgen „gestern“.

### Wiederherstellungspunkt

Die App legt einen Punkt an

- beim Monatsabschluss, bevor sie ihn speichert, mit oder ohne Tagesgeldbuchung,
- beim Jahresabschluss, bevor sie ihn speichert,
- bevor sie den Stand ersetzt: beim Einspielen einer Vollsicherung, beim Zurückholen eines Punkts, bei der Übernahme der Spielkopie und bei „Neu beginnen“.

Ein Punkt enthält den ganzen Haushalt: alle Personen mit ihren Belegen, Plan, Ausgaben, Vermögensverläufe und Simulatoreinstellungen. Punkte vor dem Ersetzen enthalten zusätzlich alles Ersetzte, etwa Tageskurse, Funktionseinstellungen und die Sicherungszeit; Zurückholen stellt genau das wieder her.

Die App bewahrt auf (FR-70):

| Art | Was bleibt |
| --- | --- |
| Monatsabschluss | je Kalendermonat der letzte Punkt, für die letzten 12 Monate |
| Jahresabschluss | alle Punkte |
| Vor dem Einspielen, Zurückholen, Übernehmen der Spielkopie und Neu beginnen | die letzten 3 Punkte |

Gekürzt wird nur innerhalb derselben Art und erst, wenn der neue Vorgang erfolgreich war. Der Punkt, den du gerade zurückholst, und ein Punkt, auf den ein offener Jahresabschluss verweist, bleiben immer. Jeder Punkt wird wie eine Vollsicherung geprüft. Einen beschädigten zeigt die Liste als „beschädigt“; er lässt sich nicht zurückholen und zählt bei der Kürzung mit. Punkte einzeln löschen oder aufräumen kannst du nicht.

Bei Personenlöschung und Haushaltsänderung legt die App keinen Punkt an. Vor dem Löschen einer Person erinnert die Rückfrage: „Erstelle vorher eine Vollsicherung unter Daten & Sicherung.“

Der Spielbereich legt keine Punkte an und zeigt keine; seine Abschlüsse sichern sich nur technisch innerhalb der Spielkopie. Bedienung: [Punkte zurückholen](../../Handbuch.html#sicherung-punkte).

### Umstellung auf die einfachen Punkte

Beim ersten Start dieser Version entfernt die App die früheren Punkte des Haushalts; Jahresabschluss-Punkte bleiben. Daten & Sicherung zeigt dann einmalig: „Die Wiederherstellungspunkte wurden vereinfacht. Frühere Punkte sind entfernt. Erstelle jetzt eine Vollsicherung.“ Der Hinweis bleibt, bis du eine Vollsicherung erstellt oder angestoßen hast oder ihn schließt; danach erscheint er nicht wieder. Im Spielbereich, bei offenem Jahresabschluss oder solange ein offener Vorgang auf einen früheren Punkt verweist, wartet die Leerung. Neue Punkte entfernt sie nie.

## Wiederherstellen und wechseln

### Ersetzung

Einspielen ersetzt die gespeicherten fachlichen Daten durch die Datei. Daten, die in der Datei fehlen, entfallen; zwei Haushalte werden nicht zusammengeführt. Vorher legt die App einen Punkt an und speichert bei vorhandenem Bestand zusätzlich eine Wiederherstellungsdatei. Prüfe deren Ablage ebenso wie die deiner Vollsicherung. Brichst du in der Desktop-App den Dialog für diese Datei ab, spielt die App nichts ein.

Nach dem Einspielen nennt der Kopf von Daten & Sicherung, was eingespielt wurde. Bei einer Vollsicherung steht dort „Sicherung vom … eingespielt am …“. Eine Übergabe- oder Wiederherstellungsdatei zählt nicht als Vollsicherung. Dann heißt es „Datei vom … eingespielt am …“ und dazu „letzte Vollsicherung: …“ oder „noch keine Vollsicherung“. Karte, Haushaltsliste und Startseite zeigen nur echte Vollsicherungen und erinnern nach 30 Tagen. Die nächste eigene Vollsicherung zeigt wieder den Sicherungsstatus.

Zurückholen zeigt Datum und Anlass. Der Dialog nennt die Monatsausgaben, erfassten Vermögensstände und den Haushaltsplan für alle Personen. Er sagt auch, dass seitdem Eingetragenes wie Verkäufe oder importierte Ausgaben verloren geht. Das gilt auch, wenn du den Jahresabschluss für eine Person mit einem Handkurs wiederholst. Vorher legt die App den Punkt „Vor dem Zurückholen“ an. So kannst du das Zurückholen rückgängig machen. Einspielen, Zurückholen, Übernahme und „Neu beginnen“ schreiben in einem Schritt. Scheitert etwas, bleibt der heutige Stand.

### Browser und EXE

Im Browser hängt der Bestand an Browserprofil, Hostname und Port; `localhost` und `127.0.0.1` sind verschiedene Herkünfte. Die EXE speichert im App-Datenordner des Windows-Benutzers. Produktiv-App, Entwickler-App und Prüfkandidat können unterschiedliche Bestände zeigen.

Für den Wechsel dient die Vollsicherung aus der bisherigen Laufzeit. Die [Betriebsanleitung](../guides/EINRICHTUNG_UND_BETRIEB.md#speicherorte) nennt die Datenbereiche. Browserbestand und Punkte gehen beim Löschen der Website-Daten verloren; bei Verlust des EXE-Datenordners fehlen dort Bestand und Punkte.

## Fehlerfall

### Leere Herkunft

Prüfe zuerst Laufzeit, Adresse und Browserprofil. Lege einen scheinbar fehlenden Haushalt nicht sofort neu an und überschreibe keine Sicherungsdatei mit einem unklaren Stand.

### Wiederherstellung

Dateien mit widersprüchlichen Personenkennungen oder mehr als zwei Haushaltspersonen weist die App vor dem Einspielen ab. Das gilt auch für ältere Dateien mit einer Person außerhalb des Haushalts; die Meldung rät, für sie einen eigenen Haushalt anzulegen. Bestätigt die App nach einem Fehler die Rücknahme, ist der bisherige Stand unverändert. Kann sie die Rücknahme nicht bestätigen, sperrt die Seite; lade sie neu und hole den Punkt davor zurück oder spiele deine letzte Vollsicherung ein. Nach einem Einspielen oder Zurückholen ohne Neuladen bleiben alte Formulare bis zum Neuladen gesperrt.

Fehlt nach einem abgebrochenen EXE-Schreibvorgang die Hauptdatei, lädt die App eine lesbare Rettungsdatei. Lösche den Datenordner nicht vorschnell.
