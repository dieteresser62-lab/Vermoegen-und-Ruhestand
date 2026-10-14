# Deutsche Cash- und Geldmarkt-Forschungsreihe

Die festgeschriebenen Quelldateien in diesem Verzeichnis liefern die Eingaben für
`GermanCashMoneyMarketChainV1`.

## Quellenvertrag

- `originals/bundesbank-long-series-2026-03-05.pdf`
  - Deutsche Bundesbank, *Long time series on economic development in
    Germany*, Datenstand 5. März 2026.
  - Die Seiten 15 und 16 enthalten Jahresdurchschnitte der Tagesgeldsätze für
    1949-1998 und die Fortsetzung mit EONIA/EURSTR für 1999-2025.
  - SHA-256:
    `cec782c8a1110a5377fe81f463d6b3b6b4a22e9fde91df98693d76ede56343c1`.
- `originals/bundesbank-money-market-pages-15-16-layout.txt`
  - Mechanisch aus dem festgeschriebenen PDF abgeleiteter Text, extrahiert mit
    Poppler 25.07.0:
    `pdftotext -layout -f 15 -l 16 <pdf> <txt>`.
  - SHA-256:
    `85e3b0f6678944a555bb6848b2eefe5601475124bae497e6e63faf47b759c383`.
- `../global-equity-research-chain/originals/JSTdatasetR6.xlsx`
  - Die Datei wird mitverwendet und nicht dupliziert.
  - Die deutschen `stir`-Beobachtungen decken 1925-1944 ab.
  - SHA-256:
    `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d`.

Der Generator prüft die Hashes aller drei Dateien. Danach liest er das primäre
PDF mit Poppler `pdftohtml` ab Version 25.07.0 und rekonstruiert alle 77
Bundesbank-Tagesgeldwerte aus den XML-Koordinaten. Das Programm wird über
`RUHESTANDSAPP_PDFTOHTML`, `RUHESTANDSAPP_POPPLER_BIN` oder `PATH` gefunden;
der Code enthält keinen entwicklerspezifischen WinGet-Pfad. Die Werte müssen
exakt mit der unabhängigen Auswahl aus dem Layouttext übereinstimmen. Auch eine
neuere kompatible Poppler-Version darf dadurch keinen Quellenwert unbemerkt
ändern. Die manuelle Sichtprüfung der gerenderten Seiten bleibt ein
Prüfvermerk; sie zählt nicht als maschineller Beleg.

Poppler wird für Entwicklung und Tests benötigt. Die App braucht es zur
Laufzeit nicht. Unter Windows lässt es sich mit
`winget install oschwartz10612.Poppler` installieren. Der Befehl
`npm run verify:poppler-toolchain` prüft die lokale Werkzeugkette.

## Transformation

`scripts/build-german-cash-money-market-chain.mjs`:

1. liest `DEU.stir` für 1925-1944 aus der festgeschriebenen JST-Arbeitsmappe;
2. überbrückt die fehlenden Kriegs- und Nachkriegsjahre 1945-1948 ausdrücklich
   mit dem zuletzt beobachteten Satz von 2.13 Prozent aus 1944;
3. wählt für 1949-2025 die erste Spalte `Overnight funds` aus jeder
   Bundesbank-Tabelle mit Jahresdurchschnitten;
4. extrahiert dieselben 77 Werte unabhängig über den koordinatenbasierten
   Pfad `pdftohtml -xml` aus dem PDF und bricht bei jeder Abweichung ab;
5. verwendet den veröffentlichten nominalen Jahresdurchschnittssatz direkt
   als einfachen Proxy für die jährliche Bruttorendite von Cash;
6. bricht bei abweichenden Quellenhashes, nicht deklarierten Lücken, doppelten
   oder fehlenden Jahren und nicht endlichen Werten ab.

Die erzeugte Datei liegt unter
`app/simulator/german-cash-money-market-chain.js`.

## Aussagegrenzen

Die Reihe bildet weder den Nettoinventarwert eines Geldmarktfonds noch die
Rendite eines privaten Tagesgeldkontos ab. Produktkosten, Tracking-Differenz,
Bankmarge, Kontogebühren und Steuern sind ausgeschlossen. Diese Bestandteile
dürfen weder unbemerkt in die historischen Daten einfließen noch doppelt
abgezogen werden.

Die Werte für 1945-1948 bilden eine ausdrücklich gekennzeichnete
Simulationsbrücke. Sie sind keine beobachteten oder amtlichen investierbaren
Renditen. Die Rendite für 1948 bildet die gesonderte Abwertung wesentlicher
Reichsmark-Bar-, Bank- und Sparguthaben im Verhältnis 100:6.5 nicht ab. Läufe
über die Reform hinweg belegen daher keinen durchgehenden realen Verlauf von
Geldbeständen.

Die Beobachtungen für 1949-1996 sind von der Bundesbank veröffentlichte
Proxys. Laut Quelle wurden die Sätze weder amtlich festgesetzt noch notiert.
Es handelt sich um ungewichtete Monatsdurchschnitte der von Frankfurter Banken
gemeldeten Sätze. Die Reihe kennzeichnet den Wechsel des Berichtskreises im
März 1970 und den Wechsel der Zinstagekonvention im Juli 1990. Zur Quellenkette
bis 1975 gehören *Deutsches Geld- und Bankwesen in Zahlen 1876-1975*
(Verlag Fritz Knapp) und Berechnungen der Bundesbank.

Das Laufzeitfeld `cashBondReturn` wendet denselben Tagesgeldproxy auf
operative Liquidität, Geldmarktbestände, den liquiditätsnahen Gesundheitstopf
und Anleihetranchen an. Bei Anleihen ist dies ein deklarierter Modellproxy
mit unpassender Laufzeit. Duration, Laufzeitprämie, Kreditrisiko und
Marktbewertungseffekte werden nicht abgebildet.
