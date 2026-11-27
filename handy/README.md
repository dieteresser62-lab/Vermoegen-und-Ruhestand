# Depot fürs Handy

Eine kleine Web-App für das Smartphone. Sie zeigt den Depotwert jeder Person im Haushalt mit aktuellen Kursen und der Änderung zum Vortag. Tagesgeld, Gold und Immobilien zählen nicht mit. Der PC muss dafür nicht laufen.

Adresse: https://kurse.kurs-vermittler.workers.dev

## Wie die Daten fließen

Die Stückzahlen je Tranche kommen per QR-Code vom PC aufs Handy und liegen nur dort im Browser-Speicher. Die Kurse holt das Handy bei jedem Öffnen über einen kleinen Cloudflare Worker von Yahoo. Der Worker sieht nur die Ticker, keine Stückzahlen und keine Beträge. Yahoo erlaubt keine Abrufe direkt aus einer Webseite, deshalb ist der Umweg nötig.

Für Ticker mit `.DE` fragt der Worker Xetra, Stuttgart (`.SG`), Düsseldorf (`.DU`) und München/gettex (`.MU`) ab. Bei gültigem Xetra-Kurs zählt ein neuerer Eurokurs von einer Abendbörse, wenn er vom heutigen Berliner Tag stammt und höchstens 5 % abweicht. Die Änderung zum Vortag bezieht sich auf den letzten Xetra-Schluss vor heute.

Fehlt ein gültiger Xetra-Kurs, zählt der neueste Eurokurs der drei Abendbörsen, der höchstens sieben Tage alt ist. Die Änderung zum Vortag bezieht sich dann auf dieselbe Börse. Unter jeder Tranche stehen Börse und Uhrzeit. Bei anderen Kürzeln fragt der Worker nur die eingetragene Börse ab.

Unter jeder Tranche steht die Veränderung über Woche, Monat und 52 Wochen und der Abstand zum 52-Wochen-Hoch. Die Seite rechnet dafür den Tageskurs gegen den Jahresverlauf von `/api/verlauf`. Depot und Personen zeigen Woche und Monat mit den heutigen Stückzahlen, also ohne Käufe und Verkäufe dazwischen. Den Verlauf lädt die Seite höchstens alle sechs Stunden und hält ihn im Browser-Speicher.

Ohne Netz zeigt die App die zuletzt geladenen Kurse und einen Hinweis. Der Verlauf bleibt mit seinem Ladezeitpunkt sichtbar.

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
| `worker/index.js` | Kursvermittler unter `/api/kurse?s=TICKER,…` und `/api/verlauf?s=TICKER,…` |
| `public/verlauf.js` | Rechnung für Woche, Monat, Jahr und Hoch, gemeinsam für Worker und Seite |
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

## Jahresverlauf für andere Abrufer

Auch die tägliche Mail-Routine nutzt den Endpunkt. Er liefert je Ticker die Tagesschlüsse eines Jahres und die fertigen Bezugswerte.

```text
GET https://kurse.kurs-vermittler.workers.dev/api/verlauf?s=VWCE.DE,%5EGDAXI,EURUSD=X
```

`s` nimmt 1 bis 40 Ticker in Yahoo-Schreibweise, durch Komma getrennt. Erlaubt sind Buchstaben, Ziffern und `. ^ = -`, also auch Indizes (`^GDAXI`), Devisen (`EURUSD=X`) und Futures (`GC=F`). Der Worker fragt nur die eingetragene Börse ab, ohne Abendbörsen. Bei falschem `s` antwortet er mit HTTP 400, sonst mit 200 und einem Eintrag je Ticker.

Antwort aus den Musterdaten der Tests, `punkte` hier auf zwei Tage gekürzt:

```json
{
  "abgerufen": "2026-11-23T07:15:00.000Z",
  "verlauf": {
    "VWCE.DE": {
      "waehrung": "EUR",
      "punkte": [["2025-11-24", 167.966], ["2026-11-23", 167.62]],
      "woche": { "datum": "2026-11-16", "schluss": 170.031 },
      "monat": { "datum": "2026-10-30", "schluss": 175.408 },
      "jahr": { "datum": "2025-11-24", "schluss": 167.966 },
      "hoch52": { "datum": "2026-01-23", "schluss": 181.029 }
    },
    "FEHLT.DE": { "fehler": "Yahoo 404" }
  }
}
```

| Feld | Bedeutung |
|---|---|
| `abgerufen` | Zeitpunkt der Antwort in UTC. Die Yahoo-Daten können bis zu einer Stunde älter sein. |
| `waehrung` | Währung laut Yahoo |
| `punkte` | `[Tag, Schluss]` je Börsentag, aufsteigend, Tag in Börsenzeit. Während des Handels ist der letzte Punkt der laufende Kurs. |
| `woche` | Schluss vor sieben Kalendertagen, an Wochenenden und Feiertagen der letzte Handelstag davor |
| `monat` | letzter Schluss im Vormonat |
| `jahr` | ältester Punkt, rund ein Jahr zurück |
| `hoch52` | höchster Schluss im Verlauf, mit Tag |
| `hinweis` | nur wenn der Verlauf mehr als eine Woche kürzer als ein Jahr ist: „weniger als ein Jahr Daten“. `jahr` ist dann trotzdem der älteste Punkt. |
| `fehler` | steht allein, wenn Yahoo für den Ticker nichts liefert, etwa „Yahoo 404“ oder „kein Verlauf“ |

`woche` und `monat` zählen vom Berliner Tag des Abrufs aus. Sie sind `null`, wenn der Verlauf nicht so weit zurückreicht. Prozentwerte rechnet der Abrufer selbst: Kurs durch `schluss` minus 1. Als Kurs taugt der letzte Punkt oder `kurs` aus `/api/kurse`. Der Abstand zum Hoch ist 1 minus Kurs durch `hoch52.schluss`.

Cloudflare hält eine erfolgreiche Yahoo-Antwort je Ticker eine Stunde im Zwischenspeicher (`cacheTtlByStatus`: 200–299 eine Stunde, 404 eine Minute, andere Fehler wie 429 oder 5xx gar nicht). Der Zwischenspeicher gilt je Rechenzentrum. Fragen Handy und Mail-Routine über dasselbe Rechenzentrum, geht höchstens eine Abfrage je Ticker und Stunde an Yahoo.

## Kosten und Grenzen

Die Seite teilt Depots mit mehr als zwölf verschiedenen Tickern auf mehrere Abrufe auf. Ein Abruf mit zwölf Xetra-Tickern braucht bis zu 48 Unteranfragen. Die Grenze liegt bei 50. Der Verlauf braucht eine Unteranfrage je Ticker, deshalb nimmt `/api/verlauf` bis zu 40 Ticker. Cloudflare Workers Free erlaubt 100.000 Abrufe am Tag. Im Konto ist keine Zahlungsart hinterlegt, also entstehen keine Kosten. Bei Überschreitung liefert der Worker bis zum nächsten Tag keine Kurse. Yahoo hat keine offizielle Schnittstelle und kann Abrufe aus Rechenzentren jederzeit sperren. Dann bleibt der letzte Stand sichtbar.
