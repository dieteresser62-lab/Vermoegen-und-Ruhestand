# QUICKSTART

## Öffnen

Starte `VermoegenUndRuhestand.exe` per Doppelklick. Für die Browserfassung öffnest du unter Windows `start_suite.cmd`; auf anderen Systemen startest du im Projektordner `npm run serve` und öffnest `http://localhost:8000/index.html`. Node.js muss für den Browserbetrieb installiert sein. Weitere Voraussetzungen stehen in [Einrichtung und Betrieb](docs/guides/EINRICHTUNG_UND_BETRIEB.md).

Du landest auf der Übersicht. Warte, bis Haushalt und Speicher geladen sind. Links wechselst du zwischen den Arbeitsbereichen; das Handbuch erreichst du ebenfalls über die Leiste.

## Startart wählen

Bei leerem Bestand bietet die Übersicht die eigene Einrichtung, den Import und das Ausprobieren an.

- Wähle **Eigene Daten anlegen**, wenn du neu anfängst. Die App öffnet die Personenverwaltung in Personen & Vermögen.
- Wähle **Sicherung einspielen**, wenn du eine Vollsicherung der Suite hast. Der Weg führt zum Import in Daten & Sicherung. Personen- oder Ergebnisdateien ersetzen keine Vollsicherung.
- Wähle **Erst ausprobieren – mit Max und Erika** für einen direkten Start mit Beispieldaten. Über **Spielbereich starten …** im Kopf kannst du auch eine Kopie deiner Daten wählen. Standard ist **Stand heute** mit echten Kursabrufen. **Testdatum wählen** schaltet bei einem anderen Datum dauerhaft auf Spielkurse ohne Netz um. Deine echten Daten bleiben unverändert. **Spielbereich beenden** verwirft alle Spieldaten und öffnet die Startseite.

<!-- docs:control {"source":"index.html","selector":"[data-profile-handoff-export=false]","text":"Eigene Daten anlegenPerson, Rente, Tagesgeld und Depot eintragen – etwa 15 Minuten."} -->
<!-- docs:control {"source":"index.html","selector":"#overviewWelcomeImport","text":"Sicherung einspielenEine vorhandene Vollsicherung der Suite laden."} -->
<!-- docs:control {"source":"index.html","selector":"#probelaufStart","text":"Spielbereich starten …"} -->
<!-- docs:control {"source":"index.html","selector":"[data-probelauf-action=end]","text":"Spielbereich beenden"} -->

## Haushalt vorbereiten und sichern

Lege für jede Person einen eigenen Eintrag an. Halte Geburtsdatum, Rentenbeginn, monatliche Nettorente und weitere Einkünfte bereit. Erfasse Tagesgeld und vorhandenes Gold sowie die Depot-Tranchen mit Kaufdatum, Stückzahl, Einstand und Kursstand.

Prüfe in Haushalt & Plan den Planungsbeginn, den jährlichen Grund- und Wunschbedarf und Mindest-Flex. Die Planwerte werden automatisch gespeichert. Die [ersten Schritte im Handbuch](Handbuch.html#erste-schritte) führen durch die Eingaben.

Wenn der eigene Bestand stimmt, öffne Daten & Sicherung und klicke **Jetzt sichern**. Prüfe, ob die JSON-Datei tatsächlich am gewünschten Ort liegt. Der Speicherhinweis der App bestätigt den Ablageort nicht. Im Spielbereich sind Vollsicherung und Vollimport gesperrt; beende ihn vor der eigenen Einrichtung und Sicherung.

<!-- docs:control {"source":"Daten-Sicherung.html","selector":"#fullBackupBtn","text":"Jetzt sichern"} -->

## Weiterarbeiten

Die Übersicht zeigt den Arbeitsstand und anstehende Abschlüsse. Folge im Handbuch dem [Monatsabschluss](Handbuch.html#monat-abschliessen) oder dem [Jahresabschluss](Handbuch.html#jahr-abschliessen). Dort stehen die Schritte und die Bedeutung des Ergebnisses.

In [Balance](Handbuch.html#balance) liest du Plan, Vorschau und Handlungsempfehlung. Im [Simulator](Handbuch.html#simulator) vergleichst du historische Jahre und mögliche Zukunftspfade. Der [Doku-Wegweiser](docs/README.md) führt zu weiteren Themen.
