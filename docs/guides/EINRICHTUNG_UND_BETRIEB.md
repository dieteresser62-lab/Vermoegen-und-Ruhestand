# Einrichtung und Betrieb

## Windows-App starten

Lade die fertige `VermoegenUndRuhestand.exe` aus dem bereitgestellten Release und lege sie in einem lokalen Ordner ab. Du brauchst die Windows-WebView2-Laufzeit. Node.js und ein getrennter Webserver sind für die EXE nicht nötig.

Öffne die EXE per Doppelklick und warte, bis Haushalt und Speicher geladen sind. Die Oberfläche heißt „Vermögen & Ruhestand“. Für die erste Einrichtung folgst du dem [QUICKSTART](../../QUICKSTART.md).

Die EXE startet ihren Kursdienst selbst. Warte laufende Speicher- und Abschlussvorgänge ab, bevor du das Fenster schließt. Beim Schließen wartet die App auf die übernommenen Speicherarbeiten; der Kursdienst endet mit ihrem Prozess.

## Im Browser

Du brauchst den vollständigen Projektordner, Node.js im Suchpfad und einen Browser mit ES-Modulen, IndexedDB und Web Workern. Unter Windows öffnest du `start_suite.cmd` per Doppelklick. Auf anderen Systemen oder aus einer Konsole startest du im Projektordner:

```sh
npm run serve
```

Öffne `http://localhost:8000/index.html`. Der Server liefert die Seiten und startet den Kursdienst. Lass das Konsolenfenster während der Arbeit offen. Mit Strg+C beendest du beide Dienste; das Schließen des Browserfensters beendet den Server nicht.

Der Browserstart braucht weder `npm ci` noch einen App-Build. Öffne die Seiten über den Server: Eine direkt angeklickte HTML-Datei reicht für die ES-Module nicht. Startoptionen stehen in der [technischen Referenz](../reference/TECHNICAL.md#browserstart-und-kursdienst).

## Speicherorte

Die ausgelieferte `VermoegenUndRuhestand.exe` nutzt den Datenbereich `de.vermoegen-ruhestand.suite` im App-Datenordner des Windows-Benutzers. Ein mit `npm run build:release` selbst gebautes Programm verwendet denselben Bereich und damit dieselben Daten. Der Ablageort der EXE ändert diesen Speicherort nicht.

| Daten | Ablage |
|---|---|
| EXE-Bestand | `ruhestand_suite_data.json` im Datenbereich `de.vermoegen-ruhestand.suite`. |
| Wiederherstellungspunkte der EXE | `ruhestand_suite_snapshots.json` im selben Ordner. |
| Browserbestand und Wiederherstellungspunkte | IndexedDB, Datenbank `ruhestand-suite`, im Browserprofil für die verwendete Herkunft. Ohne IndexedDB-API verwendet die App localStorage. |
| Vollsicherung und Ergebnisexporte | JSON- oder CSV-Dateien am vom Dateidialog beziehungsweise Download gewählten Ort. |

Die internen Dateinamen der EXE bleiben erhalten. In Daten & Sicherung zeigt der Bereich Speicher den tatsächlichen App-Datenordner. **Ordner öffnen** öffnet ihn im Windows-Explorer. Im Browser zeigt die App keinen Speicherpfad.

Entwickler-Builds verwenden `de.vermoegen-ruhestand.entwicklung`, Prüfkandidaten `de.vermoegen-ruhestand.entwicklung.kandidat`. Beide sind von den Produktivdaten getrennt. Die frühere `RuhestandSuite.exe` behält ihren Datenbereich `com.dieter.ruhestandsapp`.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataStorageOpen","text":"Ordner öffnen"} -->

Browser und EXE teilen ihren Speicher nicht. Browserprofil, Hostname und Port bestimmen den sichtbaren Browserbestand: `localhost` und `127.0.0.1` sind verschiedene Herkünfte. Ein anderer Port oder Browser kann ebenfalls leer erscheinen. Für einen Wechsel überträgst du die Daten per Vollsicherung.

## Sichern und wiederherstellen

Öffne Daten & Sicherung und klicke **Jetzt sichern**. Prüfe, ob die JSON-Datei tatsächlich am gewünschten Ort liegt. Sichere vor einem Update, vor größeren Änderungen und vor dem Jahresabschluss. Bewahre die Datei außerhalb des App-Datenordners auf.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#fullBackupBtn","text":"Jetzt sichern"} -->

Zum Wiederherstellen öffnest du am Ziel **Sicherung einspielen …** und wählst die Vollsicherung. Lies die Importabfrage, bevor du bestätigst: Der Import ersetzt alle aktuell gespeicherten fachlichen Daten. Prüfe anschließend Haushalt, Bestände und Plan.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#fullBackupImportBtn","text":"Sicherung einspielen …"} -->

Die Vollsicherung enthält fachliche Daten samt Tageskursen, aber weder Wiederherstellungsarchiv noch Layoutpräferenzen. Interne Wiederherstellungspunkte ersetzen keine externe Sicherungsdatei. Das Handbuch erklärt die [Sicherung und Rückkehr zu einem früheren Stand](../../Handbuch.html#daten-sicherung).

## Neue EXE übernehmen

1. Erstelle eine Vollsicherung und prüfe ihre Dateiablage.
2. Warte laufende Speicherarbeiten ab und beende die App.
3. Ersetze die bisherige `VermoegenUndRuhestand.exe` durch die neue EXE aus dem Release.
4. Starte die neue EXE und prüfe Haushalt, Bestände und Plan.

Die neue Release-EXE verwendet weiterhin `de.vermoegen-ruhestand.suite`; deine Daten bleiben im selben Bereich. Beim Wechsel vom Browser oder von der früheren RuhestandSuite spielst du deine Vollsicherung in die neue App ein. Für ein Browserupdate beendest du den Server, ersetzt die Projektdateien und öffnest danach dieselbe Browseradresse.

## Netz und Offlinebetrieb

### Externe Abrufe

Aktuelle Kurse, Wertpapiersuche und historische Tageskurse laufen über den lokalen Proxy zu Yahoo Finance. Übertragen werden Ticker oder Suchbegriffe und bei Kursreihen die Zeiträume, keine Vollsicherungen.

Inflation wird zuerst von der EZB, bei Ausfall von Weltbank oder OECD geladen. Der ETF-Schlusskurs kommt über Yahoo. US Shiller CAPE wird über `r.jina.ai` aus der Yale-Quelle oder dem Shiller-Mirror gelesen; als Rückfall dient ein gespeicherter CAPE-Stand. Die Anbieter können Abrufe verzögern, begrenzen oder ablehnen.

Auf Daten & Sicherung prüft **Kursdienst prüfen** den Dienststatus, ohne neue Depotkurse zu laden. **Lücken jetzt nachladen** ergänzt verfügbare Tageskurse für den Vermögensverlauf.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataPriceCheck","text":"Kursdienst prüfen"} -->
<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataPriceFetch","text":"Lücken jetzt nachladen"} -->

### Offline arbeiten

Gespeicherte Personen, Pläne, Bestände und Ausgaben bleiben verfügbar. Du kannst Eingaben pflegen und Simulationen mit den mitgelieferten Reihen rechnen. Der lokale Browserserver muss auch offline laufen.

Neue Kurse und fehlende Tageskurse lassen sich offline nicht nachladen. Prüfe Kurszeit und Abdeckung; gespeicherte Kurse werden nicht automatisch aktuell. Beim Jahresabschluss müssen Marktdaten zum Zeitraum passen. Fehlen gültige Werte, ergänze sie in der Vorbereitung von Hand. Der [Jahresabschluss im Handbuch](../../Handbuch.html#jahr-abschliessen) erklärt den Weg; die Abschlussprüfung bleibt aktiv.

Der Probelauf verwendet synthetische Markt- und Kursdaten zum Testdatum. Sie sind keine externen Kursstände.

## Startfehler beheben

| Beobachtung | Nächster Schritt |
|---|---|
| Node.js wird nicht gefunden. | Installiere Node.js, öffne eine neue Konsole und prüfe `node --version`. |
| Port 8000 ist belegt. | Beende den bisherigen Server oder wähle mit `npm run serve -- --port 8001` einen freien Webserverport. Die neue Adresse hat einen getrennten Browserbestand. |
| Der Kursdienst antwortet nicht. | Prüfe Port 8787 und im Browserbetrieb das Serverfenster. Beende eine andere Suite-Instanz, starte neu und prüfe den Kursdienst auf Daten & Sicherung. |
| Nur ein Ticker liefert keinen Kurs. | Prüfe Yahoo-Symbol und Fehlermeldung. Ein Provider-Ausfall oder Abruflimit lässt sich durch Neustart allein nicht beheben. |
| Der Bestand scheint leer. | Prüfe Laufzeit, Browserprofil und Adresse, bevor du Daten neu anlegst. Bei bewusstem Wechsel spiele die Vollsicherung ein. |
| Die EXE meldet einen Speicherfehler. | Lies die technischen Details auf Daten & Sicherung und prüfe die Zugriffsrechte auf den angezeigten Ordner. |

Port 8787 kann nur einmal belegt werden. Bei gescheitertem Proxy-Start kann die Oberfläche trotzdem öffnen. Die EXE braucht Port 8000 nicht.

Erkennt die EXE eine beschädigte Bestandsdatei, sichert sie diese als `ruhestand_suite_data.corrupt.<Zeitstempel>.json` und zeigt einen Wiederherstellungshinweis. Spiele eine gültige Vollsicherung ein; lösche den App-Datenordner nicht als ersten Reparaturversuch.

## Selbst bauen

Du brauchst unter Windows Node.js mit npm, Git, Rust mit MSVC-Toolchain und C++-Buildwerkzeuge. Installiere im Repository die Abhängigkeiten aus `package-lock.json`:

```sh
npm ci
```

`npm run build:release` erzeugt `src-tauri/target/release/VermoegenUndRuhestand.exe` als ausgelieferte App und verwendet dieselben Daten wie die vorhandene Release-EXE.

`npm run build:desktop` erzeugt die Entwickler-EXE `src-tauri/target/release/vermoegen_und_ruhestand.exe` mit dem Produktnamen „Vermögen & Ruhestand Entwicklung“ im eigenen Datenbereich `de.vermoegen-ruhestand.entwicklung`.

Die Buildbefehle brauchen einen sauberen, versionierten Stand. Für einen Wechsel zwischen alter App, Entwickler-Build und Produktiv-App überträgst du die Daten per Vollsicherung. Commit-Auswahl, mitgelieferte Dateien und Tauri-Konfiguration stehen unter [Build und Auslieferung](../reference/TECHNICAL.md#build-und-auslieferung).

Der getrennte Windows-Build-Ordner `VermoegenUndRuhestand` liegt außerhalb des Repos auf dem Windows-Laufwerk, in WSL unter `/mnt/c/…/VermoegenUndRuhestand`. Das Repo heißt `~/repos/VermoegenUndRuhestand`; der alte Name `~/repos/RuhestandsApp` bleibt als Symlink erreichbar. Der Cargo-Cache liegt unter `%LOCALAPPDATA%\VermoegenUndRuhestand\cargo-target`.

Im Build-Ordner baut `build.bat` standardmäßig produktiv mit `src-tauri\tauri.release.conf.json` nach `VermoegenUndRuhestand.exe` und archiviert unter `release-archive-vermoegen\`. `build.bat -Kandidat` legt die Prüf-EXE `VermoegenUndRuhestand_KANDIDAT_<datum>_<commit>.exe` unter `pruefkandidaten\` ab. `build.bat -AltApp` greift ausdrücklich auf `com.dieter.ruhestandsapp` zu und ersetzt `RuhestandSuite.exe`; verwende diesen Modus nur bewusst für die alte App.
