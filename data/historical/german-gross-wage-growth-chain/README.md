# Deutscher Bruttolohn-Wachstumsproxy

Die festgeschriebenen Eingaben aus JST R6 und Destatis liefern die Grundlage für
`GermanGrossWageGrowthChainV2`.

## Quellen und Reihenidentität

| Datei | Reihe / Verwendung | SHA-256 |
| --- | --- | --- |
| `../global-equity-research-chain/originals/JSTdatasetR6.xlsx` | JST R6 `DEU.wage`, nominale Lohnindexstände; Veränderungen aufeinanderfolgender Indexstände liefern den Forschungsproxy für 1925-1946 | `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d` |
| `originals/destatis-bruttomonatsverdienst-index-2026-08-01.html` | Index of average gross monthly earnings without special payments; jährliche Indexstände und Veränderungen der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen | `1f62492a2efe78fba3ec2ac81dfd90a1c4ccd6f8b68b7bcc6c53ae4d8cd51f1a` |

Die Quellenseite wurde am 2026-08-01 abgerufen und trägt den
Veröffentlichungsstand 2026-03-10. Sie enthält Indexstände ab 1946 und
veröffentlichte Jahresveränderungen für 1947-2025. Die territoriale Abgrenzung
Deutschlands und die Methodenwechsel der langen Reihe bleiben Teil ihrer
Einordnung.

## Laufzeitzuordnung und Grenzen

```text
npm run build:german-gross-wage-data
npm run verify:german-gross-wage-data
```

Die veröffentlichte Prozentänderung für das Berichtsjahr `t` wird im
Simulationsjahr `t` einmal angewandt, wenn `rentAdjMode=wage` gilt. Für
1925-1946 leitet der Generator dieselbe Prozentänderung für Jahr `t` aus
aufeinanderfolgenden JST-R6-Indexständen von `DEU.wage` ab. Dieses frühe Segment ist ein
makrohistorischer Forschungsproxy und keine amtliche Destatis-Beobachtung.

Der erzeugte Methodenvertrag kennzeichnet vier Brüche: 1925 ist die Normierung
am Reihenanfang; 1945 eine mit `estimated` markierte Kriegs- und
Nachkriegsbrücke ohne beobachteten Marktlohn; 1947 der Quellenwechsel von JST
zu Destatis; 1948 der Kontext der Währungsreform. Die Veränderung für 1946
bleibt die letzte JST-Proxybeobachtung vor dem Quellenwechsel.

Das amtliche Segment nutzt Destatis ab 1947. Es unterscheidet das frühere
Bundesgebiet bis 1990, das wiedervereinigte Deutschland ab 1991, die
Erweiterung auf Produzierendes Gewerbe und Dienstleistungen 2007 sowie die
2022 eingeführte Methode der Verdiensterhebung. Die auf eine Dezimalstelle
gerundeten Indexstände für 1947-1955 liegen zwischen 1.9 und 4.5. Die
Veränderung für 1947 verwendet außerdem den vorherigen Indexstand 1.8 aus
1946. Daraus ergibt sich ein dokumentierter maximaler relativer Einfluss
von etwa 2.8 Prozent durch die halbe Einheit der letzten Indexdezimalstelle.

Die Reihe liefert einen allgemeinen Proxy für die Fortschreibung von
Bruttoverdiensten ohne Sonderzahlungen. Sie bildet weder die historische
gesetzliche Rentenanpassung in Deutschland noch die Faktoren der Rentenformel
oder Schutzklauseln ab und ersetzt keinen individuellen Rentenbescheid.
Der kombinierte Hash der primären Eingaben lautet
`cfd5c598a8bc846a96966fa8ff7388d80c30f3ada39edbfe90d39f234eef9d9b`;
der Hash der 101 erzeugten Werte lautet
`e10e581f6994e07ed0a943b3716dd8fd5dea7b8b272d47a546466af8701a3057`.
