# Arbeitsregeln für Agenten

## Projekt

### Zweck

Projektweite Regeln für die lokale Browser-/Tauri-App und beide Betriebsarten: Rollen, Stoppgründe, Ausführung, Validierung, Sicherheit und Doku-Sync. Projekt und Architektur müssen mit `README.md` und den Referenzen übereinstimmen.

### Projektstand

- Einstiege: `Balance.html`, `Simulator.html`, `index.html`, `depot-tranchen-manager.html`, `Handbuch.html` und `Daten-Sicherung.html`.
- Native ES-Module für Fachlogik: `app/`, `engine/`, `workers/` und `types/`.
- Tauri paketiert die Desktop-App in `src-tauri/`. `npm run build:desktop` baut `dist/` mit `scripts/sync-dist.mjs` und danach die EXE.
- Browserstart: `npm run serve` bzw. `start_suite.cmd` (`scripts/serve.mjs`).
- `engine.js` und `dist/` sind generiert; primär die Quellen bearbeiten. Die Desktop-EXE wird lokal gebaut und gehört nicht ins Repository.

### Verbindliche Quellen

- Laufzeit- und Build-Kommandos: `package.json`
- Produkt- und Funktionsüberblick: `README.md`
- Technische Architektur: `docs/reference/TECHNICAL.md`
- Modulzuschnitte:
  - `docs/reference/BALANCE_MODULES_README.md`
  - `docs/reference/SIMULATOR_MODULES_README.md`
  - `engine/README.md`
- Test-Infrastruktur: `tests/README.md`
- Desktop-Konfiguration: `src-tauri/tauri.conf.json`
- Orchestrator-Konfiguration (Pfadklassen, Testbefehl, Ablaufschalter, optionale Rollenbelegung): `orchestrator.toml`
- Anweisungsdateien synchron und widerspruchsfrei halten:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `CODEX.md`
  - `GEMINI.md`

## Arbeiten

### Rollen

- Die Rollen sind **Implementierer** (plant und setzt um), **Prüfer** (prüft Plan und jedes Arbeitspaket gegenläufig) und **Finalprüfer** (prüft den fertigen Zweig als Ganzes). Im orchestrierten Lauf weist die Belegung die Rolle zu, im Handbetrieb der Nutzer. Die Rolle folgt nie aus dem Agentennamen.
- Prüfer und Finalprüfer arbeiten nur lesend. Niemand gibt eigene Arbeit frei.
- Agenten pushen und mergen nie, schreiben keine Historie um und löschen nichts destruktiv ohne ausdrückliche Freigabe des Nutzers. Den lokalen Abschlussmerge im orchestrierten Lauf führt allein der Orchestrator aus; es gilt die [Abschlussregel](#orchestrierter-lauf-dual-agent-orchestrator).

### Betriebsarten

#### Orchestrierter Lauf (Dual-Agent-Orchestrator)

- Der Nutzer legt eine Idee in `inbox/`. Der Orchestrator plant, schneidet Arbeitspakete, legt Zielbranch, Arbeitsplan und Prüfberichte unter `docs/internal/` an, führt nach jedem Arbeitspaket `npm test` aus und committet.
- **Belegung:** Standard ist Codex als Implementierer, Claude als Prüfer und Finalprüfer; diese Plätze sind zertifiziert. Andere Belegungen werden in `orchestrator.toml` unter `[roles]` und `[agent_profiles.*]` gewählt; der Hersteller des Implementierers muss sich von beiden Prüfplätzen unterscheiden. Claude als Implementierer, Codex als Prüfer oder Finalprüfer und Antigravity (Gemini) als Prüfer oder Finalprüfer sind `experimental`; Antigravity sendet den vollständigen Repository-Stand an Google.
- **Abschluss:** Nach einem Finalreview ohne Befunde archiviert der Orchestrator die Laufdokumente unter `docs/internal/archive/`. `merge_completed_branch = false`: Der Zielbranch bleibt ungemergt ausgecheckt. Die gesteuerte Sitzung fährt danach den Browser-Smoke und merged den Branch erst anschließend lokal in `main`; der lokale `post-merge`-Hook baut dabei die EXE. Gepusht wird nie.
- Der Implementierer bleibt im Auftragsumfang: keine Branches anlegen oder wechseln, nicht stagen, committen, pushen oder mergen; keine eigenen Slice-Dokumente neben dem Orchestrator-Arbeitsplan.
- **Codex-Implementierer-Sandbox:** kein Netz; nur Repository und privater Scratch-Ordner (`TMPDIR`) sind beschreibbar. `.git/`, `.orchestrator/`, `inbox/`, `outbox/`, Agentenverzeichnisse wie `.codex/`/`.claude/` bleiben schreibgeschützt. Vom Home-Verzeichnis ist nur das Codex-Programmpaket sichtbar. `node`/`npm` kommen aus dem System, Abhängigkeiten aus `node_modules/` im Repo. `npm install` und Netzzugriffe scheitern; fehlende Abhängigkeit: `OPERATOR-PREREQUISITE-MISSING`.
- **Hängererkennung:** Nach 15 Minuten ohne Implementiererausgabe (laufende Befehle ausgenommen) oder einem Befehl über 60 Minuten bricht der Orchestrator ab und wiederholt den Aufruf. Große Monte-Carlo-/Sweep-Läufe gehören deshalb nicht in gezielte Agententests.
- Nur der Orchestrator fährt die volle Suite, außerhalb der Sandbox. `node tests/run-single.mjs <datei>` ist erlaubt. Gescheiterte Port-, Browser- oder Unterprozessstarts (etwa `spawnSync … EPERM` bei `node`-Kindprozessen) sind kein Stoppgrund; im Bericht als in der Sandbox nicht ausführbar nennen.
- Die Orchestratoranfrage bestimmt Antwortformat und Ablauf. Alle drei Rollen erhalten die ersten 12.000 Zeichen dieser Datei. `CLAUDE.md`, `CODEX.md` und `GEMINI.md` gelten nur im Handbetrieb und bei direkter CLI-Nutzung; der Orchestrator liest sie nicht.

#### Handbetrieb (Claude an der Front)

- Claude arbeitet als vom Nutzer gesteuerte Sitzung: legt vor der Umsetzung einen Feature-Branch an, schreibt eine Implementierungsanweisung und startet Codex direkt.
- Anweisungen und Reviews liegen unversioniert in `inbox/backlog/`; die Wache des Orchestrators liest nur `inbox/*.md`.
- Codex setzt die Anweisung um, meldet wie vorgeschrieben vor dem Bauen, fährt gezielte Tests und berichtet. Keine Branchwechsel, Commits oder Pushes.
- Claude prüft das Ergebnis mit eigenen Messungen (eigene Mutationen, volle Suite auf genau dem Stand, der committet wird), gibt Befunde an Codex zurück und committet erst nach grüner Prüfung lokal, auf ausdrückliche Anweisung des Nutzers. Push und Merge nur auf ausdrückliche Anweisung.
- Commit-Nachrichten: eine Zeile im Conventional-Commit-Stil (`<typ>: <imperativ>`), englisch, ohne Trailer.
- Empfohlene Branch-Namen sind sprechend und präfixiert, z. B. `feature/<kurzname>`.
- Umsetzungs-, Paket- und Slice-Nummern beginnen immer bei 1. Keine neuen Arbeitspläne, Paketlisten oder Slice-Dateien mit 0-basierter Nummerierung anlegen.

### Stoppgründe

Es gelten die Stoppgründe des Orchestrators. Der Implementierer hält an und meldet:
- `CONTRACT-UNCLEAR` – ein Vertrag ist unklar, oder die Umsetzung würde einen bestehenden Vertrag still ändern. Dazu gehören, sofern der Auftrag es nicht ausdrücklich verlangt: geänderte Engine-Semantik, unerwartet abweichende Snapshot- oder Backtest-Ergebnisse, ein auffälliges FlowDelta, unterschiedliche Parameternamen in UI und Engine sowie ein `minimumFlexAnnual`, das still begrenzt statt validiert wird.
- `OPERATOR-PREREQUISITE-MISSING` – eine Voraussetzung fehlt, die nur der Nutzer schaffen kann, etwa ein Werkzeug, ein Zugang oder eine Datei.
- `SCOPE-EXTENSION-REQUESTED` – die Umsetzung braucht Dateien außerhalb des zugewiesenen Umfangs.

Im Handbetrieb gelten zusätzlich die Stoppbedingungen der jeweiligen Anweisung.

## Quellen und Prüfung

### Ausführung

- Umsetzbare Aufträge sofort implementieren oder prüfen.
- Rückfragen nur bei wesentlicher Mehrdeutigkeit, fehlender Berechtigung, Secrets oder destruktiven Aktionen; im Lauf über die Stoppgründe oben.
- Fremde, nicht zum Auftrag gehörende Änderungen im Arbeitsbaum gelten als vorhanden und werden nie überschrieben.
- Arbeite in den Quellmodulen, nicht in generierten Artefakten.
- Teile Logik so auf, wie das Repo bereits strukturiert ist:
  - `app/balance/` und `app/simulator/` für UI-nahe Feature-Logik,
  - `app/profile/` und `app/tranches/` für Profilverbund und Tranchen,
  - `app/shared/` für gemeinsam genutzte Formatter, Flags und Hilfen,
  - `engine/` für deterministische Kernlogik,
  - `workers/` und DOM-freie Runner für parallele Rechenpfade.
- `engine.js` nie manuell editieren. Aktuell ist es ein reiner generierter Modul-Wrapper für `engine/index.mjs`; Fachtests und Worker importieren die Engine-Module direkt. Änderungen an Fachlogik, Versionswerten oder API-Methoden hinter demselben Import erfordern keinen Neuaufbau.
- Über `build-engine.mjs` nur bei fehlendem Artefakt oder geändertem Generator, Import-Einstieg oder Wrapper-/Global-/Exportvertrag neu erzeugen; Generator, Artefakt und Wrappertest gemeinsam prüfen.
- `npm run build:engine` schreibt ohne `esbuild` nicht strikt den konstanten Wrapper, mit `esbuild` ein IIFE-Bundle. Bundles übernehmen Quelländerungen nicht automatisch; `tests/engine-wrapper-contract.test.mjs` weist auch frisch gebaute Bundles ab. Ein Wechsel braucht eine eigene geprüfte Vertragsänderung.
- `npm run build:engine:strict` ist optional für bewusst gewählte Bundle-Auslieferung; der Browser-/Tauri-Wrapperpfad braucht ihn nicht. Ohne `esbuild` scheitert Strict vor dem Fallback. Auch `ENGINE_BUILD_STRICT` oder `CI` mit `1`/`true` (Groß-/Kleinschreibung beliebig) machen normale Builds strikt.
- `scripts/sync-dist.mjs` übernimmt `engine/` und `engine.js` aus demselben gewählten Commit und führt keinen Engine-Build aus. Bestehende Sauberkeits-/Versionierungsanforderungen bleiben erhalten.
- `dist/` nur anfassen, wenn der Auftrag explizit Build-, Sync- oder Release-Artefakte umfasst; keine EXE oder andere Build-Binaries committen.

### Validierung

- Standard: `npm test`. Browser-Smoke (`npm run test:browser`) fährt die gesteuerte Sitzung vor dem Merge: Die Agenten-Sandbox kann weder Server noch Browser starten, deshalb gehört er nicht zur Orchestrator-Validierung. Bei UI-/Logikänderungen trotzdem `tests/browser-smoke.test.mjs` anpassen und Kernverhalten mit Node-Tests sichern. Gescheiterte Sandbox-Browserläufe sind kein Stoppgrund.
- Verpflichtend nach Änderungen an:
  - `engine/`,
  - `workers/`,
  - DOM-freie Runner wie Monte Carlo, Sweep oder Auto-Optimize,
  - Persistenz- oder Datenverträge in Profil-/Tranchen-Modulen,
  - gemeinsam genutzte Formatter, Feature-Flags oder Engine-Contracts.
- Nach Änderungen an `engine/` oder an der öffentlichen `EngineAPI` bleiben Fachtests und Vertragsprüfungen verpflichtend; ein unveränderter Wrapper ist erwartbar. Der Wrappervertrag wird durch `tests/engine-wrapper-contract.test.mjs` in `npm test` geprüft; im orchestrierten Lauf fährt die volle Suite allein der Orchestrator.
- Gezielte Fehlersuche mit `node tests/run-single.mjs <datei>` ist zulässig. Berichten, wenn nicht die ganze Suite lief.

## Doku

- Doku am Hauptort der Gliederung ändern statt anhängen; [Schreibregeln](docs/internal/design/schreibregeln.md) befolgen und jede fertige Datei in einer eigenen Runde auf Stil gegenlesen. Danach `npm run docs:pruefen` ausführen; Warnungen beheben oder einzeln im Ergebnisbericht begründen. Die [Fachregeln](docs/internal/design/fachregeln.md), Schreibregeln und Entwicklungsgrundsätze liegen nur lokal; sie fehlen im veröffentlichten Stand.
- Wenn Architektur, Modulzuschnitt, Build-/Startpfade oder Nutzer-Workflows geändert werden, mindestens die betroffenen Referenzen aktualisieren:
  - `README.md`
  - `docs/reference/TECHNICAL.md`
  - relevante Modul-READMEs
- Änderungen an Projektregeln müssen in `AGENTS.md`, `CODEX.md`, `CLAUDE.md` und `GEMINI.md` widerspruchsfrei bleiben.

## Prioritäten

### Sicherheit

- Keine destruktiven Befehle (etwa `rm -rf`, Hard Reset, History-Rewrite, Force Push) ohne ausdrückliche Freigabe.
- Keine Secrets, Tokens, Zugangsdaten oder sensiblen lokalen Pfade committen.
- Keine Snapshots, Logs, lokale Exporte oder personenbezogene Finanzdaten unbedacht in Doku oder Tests übernehmen.
- Nur den zugewiesenen Auftrag bearbeiten.

### Entwicklungsgrundsätze

Nutzerentscheidung vom 11.10.2026.

- Verbindlich: `docs/internal/design/entwicklungsgrundsaetze.md`. Technische Detailkorrektheit und automatischer Testbetrieb sind wichtig; sie folgen in einer eigenen Phase, wenn die Oberfläche steht. Manuell testfähige Zwischenstände zuerst; automatisierte Tests sichern nur die manuelle Testfähigkeit (Grundbedienung, Datenpfade); keine Browserfälle für Zwischenzustände; Bedienbarkeit mit Maus und Tastatur zählt, Fokusführung/Barrierefreiheit geringe Priorität; Oberfläche für 2560×1440 und 1920×1080, andere Auflösungen geringe Priorität; maximale Entwicklungsgeschwindigkeit statt 100 % Korrektheit in Zwischenschritten (blockierend nur, was der Nutzer im manuellen Test bemerkt, oder Datenfehler).
