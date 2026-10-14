# Lokale Schriften und Symbole

Die Oberfläche lädt Schriften und Symbole ausschließlich lokal, damit Browser und EXE offline gleich aussehen. [sync-dist.mjs](../scripts/sync-dist.mjs) übernimmt `assets/` in `dist/`.

## Schriften (`assets/fonts/`)

Quelle: npm-Pakete von Fontsource, Version 5.3.0, Teilmenge `latin`. Sie deckt Umlaute, ß, € und typografische Zeichen ab. Lizenz: SIL Open Font License 1.1, siehe die `OFL-*.txt` daneben. Die Einbindung steht in [fonts.css](../css/fonts.css).

| Datei | Familie | Schnitt | Verwendung laut Konzept |
|---|---|---|---|
| `newsreader-latin-400-normal.woff2` | Newsreader | 400 | Überschriften, einzelne große Kennzahlen |
| `newsreader-latin-500-normal.woff2` | Newsreader | 500 | Überschriften mit Gewicht |
| `newsreader-latin-400-italic.woff2` | Newsreader | 400 kursiv | Zitate, Hervorhebungen |
| `ibm-plex-sans-latin-400-normal.woff2` | IBM Plex Sans | 400 | Fließtext, Zahlen |
| `ibm-plex-sans-latin-500-normal.woff2` | IBM Plex Sans | 500 | Beschriftungen, Tabellenköpfe |
| `ibm-plex-sans-latin-600-normal.woff2` | IBM Plex Sans | 600 | Hervorhebungen, aktive Navigation |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono | 400 | Kleine Großbuchstaben-Etiketten, Daten |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono | 500 | wie oben, betont |

## Symbole (`assets/icons/lucide/`)

Quelle: npm-Paket `lucide-static` 1.52.0, Lizenz ISC ([LICENSE.txt](icons/lucide/LICENSE.txt)). Jede Datei ist ein eigenständiges SVG mit `stroke="currentColor"`. Die Farbe folgt also dem Text.

Hier liegt nur eine Auswahl: die Symbole aus Zielbild und Prototyp sowie gängige Bedien- und Zustandssymbole. **Weitere Symbole** fordert ein Paket in seiner Idee namentlich an (Lucide-Namen, z. B. `piggy-bank`). Die Steuerung legt sie vor dem Lauf aus derselben Paketversion hier ab, weil im Implementierungslauf kein Netz besteht.
