# Abläufe im Handbuch

Mermaid-Quellen und statische SVGs für die Offline-Hilfe. Stand: 27.10.2026. Pfeile zeigen den nächsten Bedienabschnitt. Die Farben folgen dem Designsystem „Stein & Messing“; Messing markiert den Abschluss beziehungsweise die Rückkehr.

## Monat abschließen

```mermaid
flowchart TD
    %% docs:diagram {"src":"../../assets/handbook/ablauf-monat.svg","title":"Monat abschließen","alt":"Die vier Prüfschritte führen zum gespeicherten Monatsbeleg.","legend":"Pfeile zeigen den nächsten Schritt."}
    A["Kurse prüfen"] --> B
    B["Ausgaben ansehen"] --> C
    C["Budget vergleichen"] --> D
    D["Tagesgeld bestätigen"] --> E
    E["Monatsbeleg prüfen"]
```

## Jahr abschließen

```mermaid
flowchart TD
    %% docs:diagram {"src":"../../assets/handbook/ablauf-jahr.svg","title":"Jahr abschließen","alt":"Sieben Prüfschritte führen zum Jahresbeschluss und Dezemberbeleg.","legend":"Pfeile zeigen den nächsten Schritt."}
    A["Kurse prüfen"] --> B
    B["Dezember ansehen"] --> C
    C["Budget vergleichen"] --> D
    D["Tagesgeld bestätigen"] --> E
    E["Pflegewerte bestätigen"] --> F
    F["Marktdaten prüfen"] --> G
    G["Bedarf und Plan prüfen"] --> H
    H["Jahr und Dezember speichern"]
```

## Spielbereich und Rückkehr

```mermaid
flowchart TD
    %% docs:diagram {"src":"../../assets/handbook/ablauf-spielbereich.svg","title":"Spielbereich und Rückkehr","alt":"Beispiele und Datumssprünge erlauben nur Verwerfen; eine Kopie ohne Datumssprung kann bei unverändertem echtem Bestand übernommen werden.","legend":"Pfeile zeigen den nächsten Schritt."}
    A["Eigener Bestand"] --> B
    B["Kopie oder Beispiel"] --> C
    C["Im Spielbereich ändern"] --> D
    D["Beenden und prüfen"] --> E
    E["Verwerfen oder Kopie übernehmen"] --> F
    F["Zurück zum eigenen Bestand"]
```
