# Einrichtung und Betrieb

Start, Update und Fehlerhilfe für Nutzer der Windows-App und Browserfassung. Stand: 27.10.2026.

## Start

### EXE

Lege die bereitgestellte `VermoegenUndRuhestand.exe` in einem lokalen Ordner ab und öffne sie per Doppelklick. Windows benötigt WebView2. Node.js und ein getrennter Server sind nicht nötig. Warte, bis Haushalt und Speicher geladen sind. Die erste Übung steht im [QUICKSTART](../../QUICKSTART.md).

Die EXE startet ihren Kursdienst selbst. Warte laufende Speicher- und Abschlussvorgänge ab, bevor du sie schließt. Der Kursdienst endet mit dem App-Prozess.

<a id="im-browser"></a>

### Browser

Du brauchst den vollständigen Projektordner, Node.js und einen Browser mit ES-Modulen, IndexedDB und Web Workern. Unter Windows öffnest du `start_suite.cmd`. Sonst startest du im Projektordner:

```sh
npm run serve
```

Öffne `http://localhost:8000/index.html`. Lass das Konsolenfenster offen; Strg+C beendet Server und Kursdienst. Das Schließen des Browsers beendet den Server nicht. Der Browserstart braucht weder Abhängigkeitsinstallation noch App-Build. Öffne HTML-Seiten über den Server. Startoptionen stehen in [TECHNICAL](../reference/TECHNICAL.md#start).

## Wechsel und Update

<a id="speicherorte"></a>

### Datenbereich

Die Produktiv-EXE speichert im Bereich `de.vermoegen-ruhestand.suite` des Windows-App-Datenordners. Der Ablageort der EXE ändert das nicht. Unter „Daten & Sicherung → Speicher“ zeigen „Speicherort anzeigen“ und „Ordner öffnen“ den tatsächlichen Ordner. Im Browser gibt es keinen Dateipfad.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataStorageOpen","text":"Ordner öffnen"} -->

Entwickler-Builds, Prüfkandidaten, frühere RuhestandSuite und Browser haben getrennte Datenbereiche. Auch andere Browserprofile, Adressen oder Ports öffnen einen anderen Bestand. [Sicherung](../reference/SICHERUNG.md#browser-und-exe) erklärt Umfang und Wechsel; die [technische Speicherübersicht](../reference/TECHNICAL.md#speicher-und-schreibgrenzen) nennt die Kennungen.

### Bestehende Installation

1. Erstelle eine Vollsicherung und prüfe die Dateiablage.
2. Warte laufende Speicherarbeiten ab und beende die App.
3. Ersetze die EXE durch die neue Produktivfassung.
4. Starte sie und prüfe Haushalt, Bestände und Plan.

Die neue Produktiv-EXE verwendet denselben Datenbereich. Beim Wechsel vom Browser oder einem anderen App-Bereich spielst du die Vollsicherung am Ziel ein. Im Browser beendest du für ein Update den Server, ersetzt die Projektdateien und öffnest danach dieselbe Adresse. Klickwege: [Sichern und zurückholen](../../Handbuch.html#daten-sicherung).

## Netz und Fehler

### Offlinegrenze

Handbuch und freigegebene Themenseiten sind offline lesbar. Gespeicherte Personen, Bestände, Ausgaben und Pläne bleiben verfügbar. Simulationen verwenden mitgelieferte historische Reihen. Im Browser muss der lokale Server auch offline laufen.

Neue Kurse, Wertpapiersuche und fehlende Tageskurse benötigen Internet und Kursdienst. „Kursdienst prüfen“ testet den Status; „Lücken jetzt nachladen“ ergänzt verfügbare Tageskurse. Im [Jahresabschluss](../../Handbuch.html#jahr-abschliessen) prüfst du Zeitraum und Herkunft der Marktdaten; fehlende gültige Werte ergänzt du in den angebotenen Handfeldern. Inflation kommt von EZB oder Weltbank, CAPE aus der shillerdata-XLS über r.jina.ai. [Datenquellen](../reference/DATA_SOURCES.md#live-daten) erklärt Anbieter und Abrufgrenzen.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataPriceCheck","text":"Kursdienst prüfen"} -->
<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#dataPriceFetch","text":"Lücken jetzt nachladen"} -->

### Startfehler

| Beobachtung | Nächster Schritt |
| --- | --- |
| Node.js fehlt | Installiere Node.js, öffne eine neue Konsole und prüfe `node --version`. |
| Port 8000 belegt | Beende den bisherigen Server oder starte `npm run serve -- --port 8001`. Beachte den getrennten Browserbestand. |
| Kursdienst antwortet nicht | Prüfe Serverfenster und Port 8787. Beende eine andere Suite-Instanz, starte neu und prüfe den Dienst. |
| Ein Ticker scheitert | Prüfe Yahoo-Symbol und Meldung; Anbieter können Abrufe begrenzen. |
| Bestand erscheint leer | Prüfe Laufzeit, Browserprofil und Adresse vor einer Neueinrichtung. |
| Speicherfehler | Lies Details in Daten & Sicherung; prüfe Zugriffsrechte auf den angezeigten Ordner. |

<a id="selbst-bauen"></a>

Die EXE benötigt Port 8000 nicht. Port 8787 kann nur einmal belegt werden. Bei der Wiederherstellung folge [Sicherung](../reference/SICHERUNG.md#wiederherstellung). Selbstbau und Auslieferung stehen in [TECHNICAL](../reference/TECHNICAL.md#build-und-auslieferung).
