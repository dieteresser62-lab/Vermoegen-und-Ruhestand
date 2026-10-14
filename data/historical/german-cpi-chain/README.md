# Deutsche Verbraucherpreis-Forschungsreihe

Die festgeschriebenen, lizenzierten Quelldateien liefern die deutsche jährliche
Verbraucherpreisinflation des Simulators für 1925-2025.

## Erzeugen und prüfen

```text
npm run build:german-cpi-data
npm run verify:german-cpi-data
```

Der Build schreibt `app/simulator/german-cpi-chain.js`. Die Prüfung
rekonstruiert das Modul aus den festgeschriebenen Originalen und bricht ab,
wenn ein Originalhash oder das erzeugte Modul abweicht.

## Quelldateien

| Datei | SHA-256 | Verwendung |
| --- | --- | --- |
| `../global-equity-research-chain/originals/JSTdatasetR6.xlsx` | `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d` | Deutsche `cpi`-Indexstände für das Proxysegment 1925-1949 |
| `originals/destatis-vpi-lange-reihen-2025-06.xlsx` | `8c728e44fa400d762009fa34507a34e1fee3947641d2579484d7d040763b11f4` | Amtliche Jahresindexstände und Jahresraten für 1950-2024 |
| `originals/destatis-vpi-current-2026-07-10.html` | `82ab91a5e53db7cd74cdf4f7b4d85813e586fbd3ae0bbd3d01a6cb231b596743` | Amtlicher Jahresdurchschnittsindex und Jahresrate für 2025 |

Die Destatis-Arbeitsmappe mit den langen Reihen hat den Quellenstand
`2025-06`; der aktuelle HTML-Stand ist auf `2026-07-10` festgeschrieben.
Die Arbeitsmappe wird aus den maschinenorientierten Blättern `csv-611xx-01`
und `csv-611xx-02` gelesen. Aus dem HTML-Stand werden ausschließlich die beiden
festgeschriebenen Tabellenbereiche für den Gesamtindex ausgewertet:
Jahresdurchschnitte und jährliche Veränderungsraten.

## Reihenvertrag

- 1925-1949: prozentuale Veränderung aufeinanderfolgender deutscher
  CPI-Indexstände aus JST R6; Evidenzklasse `proxy`. Bei einer Normierung auf
  1938=126 sind die Indexstände für 1925-1948 ganzzahlig. Die daraus
  abgeleiteten Jahresraten haben nur eine Auflösung von etwa 0.48-0.85
  Prozentpunkten gegenüber 0.1 Prozentpunkten bei den veröffentlichten
  Destatis-Raten.
- 1950-1962: früheres Bundesgebiet, Vierpersonenhaushalte von Arbeitern und
  Angestellten mit mittlerem Einkommen; Evidenzklasse `official` mit dem
  Bevölkerungszusatz `proxy_population`.
- 1963-1991: früheres Bundesgebiet, alle privaten Haushalte;
  Evidenzklasse `official`.
- 1992-2025: deutscher Verbraucherpreisindex; Evidenzklasse `official`.

Jede Rate an einem Reihenübergang stammt aus einer in sich konsistenten
Quellenreihe. Die veröffentlichten Destatis-Raten werden gegen die gerundeten
Jahresindexstände geprüft; die maximale Toleranz beträgt 0.06 Prozentpunkte.
Der Destatis-Wert für 1948 aus der Vierpersonenhaushaltsreihe ist ein
Durchschnitt des zweiten Halbjahres. Deshalb bleibt die Kette bis 1949 bei
JST und beginnt Destatis mit der veröffentlichten Rate für 1950. Der
Harmonisierte Verbraucherpreisindex (Harmonised Index of Consumer Prices,
HICP/HVPI) gehört nicht zu dieser Kette.

Der Proxy bildet keinen uneingeschränkten Verlauf von Marktpreisen ab.
Deutsche Preiskontrollen und der Preisstopp während des Krieges beeinflussen
1936-1948 erheblich. Der JST-Indexstand für 1949 ist der einzige nicht
ganzzahlige Endpunkt des Segments und überbrückt die Währungsreform von 1948.
Die gewählte JST-Veränderung beträgt `+7.0352%`. Die Destatis-Indexstände
`28.5 -> 28.2` für Haushalte mit mittlerem Einkommen im früheren Bundesgebiet
ergeben dagegen `-1.0526%`. Die Differenz beträgt `8.0878` Prozentpunkte.
Das ist eine dokumentierte Proxyentscheidung; die JST-Rate wird damit nicht
als amtliche deutsche Inflationsrate für 1949 ausgewiesen.
