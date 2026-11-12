# Depot fürs Handy

Eine kleine Web-App für das Smartphone. Sie zeigt den Depotwert jeder Person im Haushalt mit aktuellen Kursen und der Änderung zum Vortag. Tagesgeld, Gold und Immobilien zählen nicht mit. Der PC muss dafür nicht laufen.

Adresse: https://kurse.kurs-vermittler.workers.dev

## Wie die Daten fließen

Die Stückzahlen je Tranche kommen per QR-Code vom PC aufs Handy und liegen nur dort im Browser-Speicher. Die Kurse holt das Handy bei jedem Öffnen über einen kleinen Cloudflare Worker von Yahoo. Der Worker sieht nur die Ticker, keine Stückzahlen und keine Beträge. Yahoo erlaubt keine Abrufe direkt aus einer Webseite, deshalb ist der Umweg nötig.

Xetra schließt um 17:30. Für Ticker mit `.DE` fragt der Worker zusätzlich Stuttgart und Düsseldorf ab, die bis etwa 22 Uhr handeln, und nimmt den neuesten Kurs. Ein Abendkurs zählt nur, wenn er von heute ist und höchstens 5 % vom Xetra-Kurs abweicht. Die Änderung zum Vortag rechnet die App immer gegen den letzten Xetra-Schluss vor dem heutigen Tag. Unter jeder Tranche steht, von welcher Börse und welcher Uhrzeit der Kurs stammt.

Ohne Netz zeigt die App die zuletzt geladenen Kurse und einen Hinweis.

## Einrichten auf dem Handy

1. In Chrome die Adresse öffnen, im Menü ⋮ „Zum Startbildschirm hinzufügen“ wählen und installieren.
2. Am PC im Ordner `handy/` den Befehl `npm run qr` ausführen. Der QR-Code öffnet sich im Browser.
3. In der App „Code scannen“ tippen und den Code vom Bildschirm einlesen.
4. Am PC Enter drücken. Das Skript löscht die QR-Datei.

Nach einem Kauf oder Verkauf zuerst die Desktop-App speichern, dann Schritt 2 bis 4 wiederholen. In der App geht das über ⋮ → „Positionen neu einlesen“. Unten steht, von welchem Tag die Positionen stammen.

## Ordner

| Pfad | Inhalt |
|---|---|
| `public/` | Handy-Seite: HTML, CSS, Logik, Manifest, Service Worker, Schriften, Symbole |
| `public/code.js` | Format des QR-Inhalts: `DEPOT1:` und base64url-JSON mit Name, Ticker und Stückzahl je Tranche |
| `worker/index.js` | Kursvermittler unter `/api/kurse?s=TICKER,…` |
| `pc/qr-ausgabe.mjs` | liest `ruhestand_suite_data.json` aus `%APPDATA%\de.vermoegen-ruhestand.suite` und erzeugt den QR-Code |
| `pc/test.mjs`, `pc/worker-test.mjs`, `pc/ui-test.mjs` | Tests für QR-Weg, Kurswahl und Seite, mit erfundenen Musterdaten aus `pc/muster.mjs` |
| `quellen/` | Vorlage für das maskierbare App-Symbol |

## Befehle

Alle Befehle laufen im Ordner `handy/`.

- `npm ci` installiert die QR-Bibliotheken.
- `npm test` prüft QR-Weg, Kurswahl des Workers und die Seite im Browser in Pixel-Größe. Playwright kommt aus dem App-Repo.
- `npm run vorschau` startet die Seite lokal unter http://localhost:8788.
- `npm run deploy` lädt Worker und Seite zu Cloudflare hoch. Wrangler muss einmal mit `npx wrangler@4 login` angemeldet sein.

Die Seite gehört nicht zur EXE. `sync-dist` und die Prüfskripte der App lassen diesen Ordner aus.

## Kosten und Grenzen

Cloudflare Workers Free erlaubt 100.000 Abrufe am Tag. Im Konto ist keine Zahlungsart hinterlegt, also entstehen keine Kosten. Bei Überschreitung liefert der Worker bis zum nächsten Tag keine Kurse. Yahoo hat keine offizielle Schnittstelle und kann Abrufe aus Rechenzentren jederzeit sperren. Dann bleibt der letzte Stand sichtbar.
