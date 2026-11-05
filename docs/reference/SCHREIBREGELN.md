# Schreibregeln

Verbindliche Regeln für Autoren und Agenten. Stand: 27.10.2026. Nutzertexte helfen beim Bedienen; technische Texte helfen beim Pflegen des Codes.

## Leser und Hauptort

### Bedienung

Einführung und Anleitung trennen: QUICKSTART führt mit einem Beispielhaushalt bis zur ersten Sicherung. Das Handbuch beginnt bei einer echten Aufgabe und nennt Schritte, sichtbares Ergebnis und einen Satz Bedeutung. Konkrete Fehlerhilfe steht bei der Aufgabe. App-Beschriftungen wörtlich in „…“.

### Themen

Erklärungen beantworten, warum und wie die App rechnet. Jede Aussage erhält einen Hauptort; Hintergrund dorthin verschieben und mit „Ausführlich: …“ verlinken. Kopf mit Zweck, Zielleser und Stand; drei bis fünf Kernsätze unter „Auf einen Blick“, dann Kernaussage, Regel, Beispiel und Grenzen. „Wo du es in der App siehst“ nennt Seite, Karte oder Protokoll. Varianten als Tabelle.

### Technik

Nachschlagen gehört ins Regelverzeichnis, in Datenverträge, Technik und Designsystem. Technische Feldnamen, Testbezeichnungen und Zuordnungen bleiben dort. Fachbegriffe im [Glossar](../../Handbuch.html#begriffe) kurz erklären, vollständig im zuständigen Thema. FR-Kennungen im Regelverzeichnis, im Thema höchstens einmal in Klammern.

### Einordnung

Marktvergleich und Forschungsrahmen erklären externe Aussagen mit tatsächlich gelesenen Quellen. Recherche und Appstand datieren, Belegstatus und offene Prüflücken beim Kürzen bewahren. Keine Werbung oder Selbstlob. Literaturbezug bedeutet keine externe Validierung der App.

## Sprache

### Begriffe

Kurze Sätze mit Verben, geläufige Wörter und Du-Ansprache; technische Texte brauchen keine Anrede. Absatz- und Satzlänge variieren. Gleiche Begriffe wie in der App: Geldvermögen ohne, Gesamtvermögen mit Immobilien; „Anleihen“.

Bestehende synthetische Beispielhaushalte erhalten, neue Rechenbeispiele bevorzugt mit Max und Erika Mustermann. Nur synthetische Daten, Zahlen aus der App mit Testdatum. Keine echten Haushaltsdaten.

Keine Chronik, Commit-Kennungen oder Arbeitsvermerke in Nutzertexten. Prüfsummen, erzeugte Inventarrevision und benötigte technische Prüfkennungen bleiben erhalten.

### Verbotene Muster

- Floskeln: „Im Folgenden“, „Es ist wichtig zu beachten“, „Zusammenfassend“, „spielt eine zentrale/entscheidende Rolle“, „ermöglicht es Ihnen“, „nahtlos“, „umfassend“, „ganzheitlich“, „robust“, „intuitiv“, „optimal“, „leistungsstark“, „im Wesentlichen“, „grundsätzlich“, „gegebenenfalls“, „nicht nur …, sondern auch“, „Egal ob … oder …“.
- Keine Werbung, Selbstlob, Nominalstil, rhetorischen Überschriften, Emoji oder Ausrufezeichen. Keine Doppelpunkt-Überschriften, mehr als einen Gedankenstrich je Absatz oder schematischen Dreierlisten.
- Keine bloßen Ankündigungen, Wiederholungen zum Schluss oder Selbstverweise ohne Link. Fett nur nach fester Bedienkonvention oder für eine einzelne Warnung. Listen für Schritte und echte Aufzählungen.

## Fertigstellen

### Gegenlesen

Inhalte im passenden Abschnitt ändern, keine Nachträge anhängen. Jede fertige Datei in einer eigenen Runde auf Stil gegenlesen. Keine Platzhalter oder Links auf geplante Dateien.

Handbuchabschnitte höchstens etwa 200, Kapitel etwa 1.000 Wörter; Themenabschnitte etwa 400, Themen höchstens 4.000. Engere Dateigrenzen gelten zusätzlich. Ganze Dateien nach der festgelegten Messweise zählen, einschließlich Tabellen und erzeugter Zahlen.

### Links

Aussagen gegen Code prüfen, lokale Links und Anker testen. `npm run docs:pruefen` ausführen; Warnungen beheben oder einzeln begründen. Die Floskelliste selbst ist ausgenommen. Prüfwerkzeuge und Generatoren stehen unter [Dokuwerkzeuge](TECHNICAL.md#lokale-leserseiten-und-dokuwerkzeuge).

### Bilder und Bedienelemente

Diagramme nur bei Erklärgewinn: Ablauf, Zustand, Zeitachse oder Architektur. Mermaid in Markdown, statisches SVG offline; keine CDN-Abhängigkeit. Titel, Legende, Textalternative, möglichst höchstens zehn Knoten und Designsystemfarben. Quelle und SVG gemeinsam prüfen.

Mermaid-Abläufe ab vier Kästen senkrecht (TD); die Grafik muss bei 700 px Lesebreite ganz sichtbar sein. Beschriftungen kurz halten und mit `<br>` umbrechen. Metadaten stehen als `%% docs:diagram` im Mermaid-Block; im Lesetext genügt höchstens ein kurzer Satz zur Legende.

Bedienelemente über `docs:control` am erklärten Text belegen. Aktuelle Bilder über `docs:bilder` mit synthetischem Haushalt bei 1920×1080 und Maßstab 1 aufnehmen; Herkunft und Ausschnitte erhalten. [Technische Metadaten](TECHNICAL.md#belege-für-bedienelemente-und-bilder) und [Bildablauf](../ui/README.md) beschreiben die Werkzeugverträge.
