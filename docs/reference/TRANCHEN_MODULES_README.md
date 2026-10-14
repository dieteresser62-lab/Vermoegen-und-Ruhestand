# Personen, Haushalt und Depot

[Personen & Vermögen](../../depot-tranchen-manager.html) pflegt zentrale Personendaten, Haushalt, Plan und reale Bestände. Die Seite verbindet Module unter `app/profile/` und `app/tranches/`. [Balance](BALANCE_MODULES_README.md) und [Simulator](SIMULATOR_MODULES_README.md) lesen daraus Projektionen für ihre Rechnung.

[TECHNICAL](TECHNICAL.md) führt Speicheradapter und Seitendienste. [DATENVERTRAEGE](DATENVERTRAEGE.md) legt Schlüssel, Records, Austausch und Recoveryumfänge fest; [FACHKONZEPT](FACHKONZEPT.md) erklärt die fachlichen Konventionen. Kauf- und Verkaufsbedienung steht im [Handbuch](../../Handbuch.html).

## Haushalt und Personendaten

| Modul unter `app/profile/` | Zuständigkeit |
| --- | --- |
| [profile-registry.js](../../app/profile/profile-registry.js) | Registry, Profilmetadaten und aktive Identität lesen/schreiben |
| [profile-key-policy.js](../../app/profile/profile-key-policy.js) | profilgebundene Schlüssel bestimmen |
| [profile-live-storage.js](../../app/profile/profile-live-storage.js) | aktive Liveprojektion erfassen und anwenden |
| [profile-storage.js](../../app/profile/profile-storage.js) | Profilstart, Wechsel, Sicherung und Recovery koordinieren |
| [profile-state.js](../../app/profile/profile-state.js) | Profilwerte, Balance-State und Pflegebucket aus Records lesen |
| [profile-manager.js](../../app/profile/profile-manager.js), [profile-manager-bindings.js](../../app/profile/profile-manager-bindings.js) | Profilaktionen und deren UI-Anschlüsse führen |
| [profile-navigation.js](../../app/profile/profile-navigation.js) | Seitenbereitschaft, bestätigten Profilhandoff, Migration und BFCache-Rückkehr schützen |
| [profile-context-reader.js](../../app/profile/profile-context-reader.js), [profile-bridge.js](../../app/profile/profile-bridge.js) | lesenden Seitenkontext und Synchronisation bereitstellen |
| [profile-person-data.js](../../app/profile/profile-person-data.js) | bestätigte Datums-/Einkommenswerte prüfen und Personenprojektion liefern |
| [profile-asset-values.js](../../app/profile/profile-asset-values.js) | zentrale Formularwerte validieren und Vermögens-/Goldprojektion bilden |
| [household-plan.js](../../app/profile/household-plan.js), [household-plan-dialog.js](../../app/profile/household-plan-dialog.js) | kanonischen Planbereich und dessen Editor führen |
| [household-plan-comparison.js](../../app/profile/household-plan-comparison.js) | bestätigte Planwerte und Versuch vergleichen |

Die aktive Einzelperson bestimmt, welches Depot und welche Personendaten gepflegt werden. `belongsToHousehold` bestimmt die Haushaltszuordnung. Eine Außenperson hat eigene bestätigte Werte; sie wird nicht durch eine alte Partneraktivierung automatisch Haushaltsmitglied. Registrykopie und Liveprojektion dürfen nur über die dafür vorgesehenen Leser verbunden werden.

[profile-person-data.js](../../app/profile/profile-person-data.js) projiziert das Planungsalter aus dem Geburtsdatum für den Jahresstichtag. Die Anzeige des heutigen Alters verwendet die App-Uhr. Ein belegtes Altalter bleibt bis zur Datumsergänzung ein eigener Kompatibilitätsfall. Jahresabschluss und Profilmerge schreiben kein Alter fort. Datums-, Rentenbeginn- und Einheitenverträge stehen unter [Personenschlüssel](DATENVERTRAEGE.md#personenschlüssel); ihre fachliche Wirkung im [Fachkonzept](FACHKONZEPT.md).

[household-plan.js](../../app/profile/household-plan.js) besitzt die gemeinsamen Planwerte. Die Seite bearbeitet sie über [tranchen-manager-household-plan.js](../../app/tranches/tranchen-manager-household-plan.js) und die gemeinsamen Feldadapter. Die Balance-/Simulatorprojektion ist keine zweite persistierte Plankopie. Ein fehlender oder ungültiger Planbereich darf nicht still durch einen beliebigen Formularstand bestätigt werden.

## Seite und Dialoge

[tranchen-manager-page.js](../../app/tranches/tranchen-manager-page.js) initialisiert Profilbereitschaft, Personen-/Planansichten, Depot, Kurse und Verlauf. Es besitzt die Seitenfortsetzungen und verbindet deren Writes mit dem Navigationsschutz. Der Ansichtsrenderer hält den kompakten Seitentitel und blendet + Person anlegen nur im Verlauf aus. Namen und Kartenaktionen stehen im offenen Kopf von Auf einen Blick. Die Kurszeile zeigt Datum und erkennbare Kurslücken oder ältere Kurse; ihre ⓘ-Details enthalten Herkunft, Aktualisierungshinweis und Speicherverhalten.

| Modul unter `app/tranches/` | Zuständigkeit |
| --- | --- |
| [tranchen-manager-state.js](../../app/tranches/tranchen-manager-state.js) | kanonische Lots lesen/normalisieren und abgeleitete Werte berechnen |
| [depot-tranchen-status.js](../../app/tranches/depot-tranchen-status.js) | Depotstatus, Kurszustand und Aggregate ableiten |
| [tranchen-manager-renderer.js](../../app/tranches/tranchen-manager-renderer.js) | Personen-/Depotansichten, Statistiken und Tabelle anzeigen |
| [tranchen-manager-person-cards.js](../../app/tranches/tranchen-manager-person-cards.js) | zentrale Personeneingaben an Karten binden |
| [tranchen-manager-profiles.js](../../app/tranches/tranchen-manager-profiles.js) | Personenwahl und Verwaltungsdialog verbinden |
| [tranchen-manager-household-plan.js](../../app/tranches/tranchen-manager-household-plan.js) | Planeditor an die Seite anschließen |
| [tranchen-manager-modal.js](../../app/tranches/tranchen-manager-modal.js) | Kauf-/Bearbeitungs- und Cashdialog, Baseline und Submission führen |
| [tranchen-manager-decimal-input.js](../../app/tranches/tranchen-manager-decimal-input.js) | deutsche Dezimaleingaben lesen und anzeigen |
| [tranchen-manager-sale-dialog.js](../../app/tranches/tranchen-manager-sale-dialog.js) | ausgeführten Verkauf mit Vorschau und separater Bestätigung erfassen |
| [tranche-reconciliation.js](../../app/tranches/tranche-reconciliation.js) | Ausführung, Stückänderung, Profilwerte und Cashbeleg abgleichen |
| [tranchen-price-service.js](../../app/tranches/tranchen-price-service.js), [tranchen-startup-prices.js](../../app/tranches/tranchen-startup-prices.js) | Kursdienst prüfen, aktuelle Kurse abrufen und Startabruf führen |

Die Seite liest zentrale Werte erst nach dem Profilstart. Recovery oder ungeklärte Migration sperrt schreibende Fachaktionen. Während einer Dialogfortsetzung wird ihre Ausgangsbasis festgehalten. Profilwechsel und fremde Mutation machen sie ungültig; ein alter Dialog darf seine Daten nicht in das jetzt aktive Profil schreiben.

Numerische Eingaben werden an der UI-Grenze lokalisiert gelesen. Profilrecords halten kanonische Stringwerte, die Engine erhält numerische Projektionen. Renderer zeigen bestätigte Werte und Status; sie reparieren keine beschädigten Rohrecords.

Haushalt & Plan zeigt die Vermögenskarten in einem Raster mit drei Spalten; weitere Personen bilden eine neue Zeile. Bei einer Person stehen zwei Karten nebeneinander. Summe, Veränderung und die flache Verlaufslinie bleiben offen, ebenso die Haushaltsaufteilung bzw. Rente und Tagesgeld je Person. ▸ Details zeigen öffnet Einstand, Buchgewinn, Einkommen, Pflegereserve-Ziel, Aufteilung und Verlaufsbedienung. Zur Person → wechselt über den vorhandenen Profilhandler zur Personenansicht; Zum Verlauf → wählt den zugehörigen Verlauf. Die gespeicherte aktive Person erhält im Haushaltsraster keine Hervorhebung. Die Bedarfsfelder folgen über volle Breite. Weitere Planwerte und der darunterliegende Planvergleich starten geschlossen. Alle bisherigen Planfelder bleiben im Editor und behalten ihre Speicherwege.

In der Personenansicht stehen die drei Eingaben für Tagesgeld, Nettorente und sonstige Einkünfte unter Auf einen Blick. Person, Rente & Steuern, Gold und Pflegereserve beginnen bei jedem Seitenaufruf geschlossen. Der Kartenbinder merkt Zustände nur im Dokument je Person; er schreibt sie weder ins Profil noch in den Sitzungsspeicher. Alle Details zeigen und direkte Sprungziele bedienen die vorhandenen Regionen. Gold und Pflegereserve zeigen Zusammenfassung und Aktivschalter in einer Kopfzeile; die Schalter liegen außerhalb der Klappknöpfe und verwenden unverändert die bisherigen Wertträger. Klappaktionen heißen ▸ zeigen und ▾ ausblenden, Sprunglinks tragen einen Pfeil und den Messington. Kauf und Verkauf haben im Depotkopf dieselbe sekundäre Knopfrolle; auch der Kursverlauf jeder Tranche hat eine sichtbare Textklappe.

Das Tagesgeldfeld unter Auf einen Blick speichert beim Verlassen eines geänderten Feldes (`change`) oder mit Enter. Nettorente und sonstige Einkünfte stehen daneben direkt zur Eingabe bereit. `input` meldet nur den offenen Entwurf an den Navigationsschutz. Andere Profilfelder behalten ihren Autosave nach 300 ms und übernehmen dabei keinen offenen Tagesgeldwert. Vor Personenwechsel, Seitenwechsel und Fensterschließen sichert der Profilwriter diesen Wert; erst der erfolgreiche Flush bestätigt ihn.

## Depot und ausgeführte Verkäufe

[tranche-contract.js](../../types/tranche-contract.js) ist die gemeinsame Lotgrenze. Der Stateadapter delegiert Normalisierung und Werteberechnung dorthin. `loadTranchesFromStorage` liefert einen Lesestatus: `valid`, `empty`, `corrupt` oder `unavailable`. Fehlerhaftes JSON wird nicht zu einem still leeren Depot. Lotfelder und Versionsunterstützung stehen unter [Lotformat](DATENVERTRAEGE.md#lotformat).

Kauf und Bearbeitung lesen einen validierten Dialogstand und sichern das reale Profildepot. Die Seite prüft Kontext und Baseline der Submission. Verlaufskopien halten die Herkunft einer Bestandsänderung fest; eine manuelle Änderung ist nicht automatisch ein belegter historischer Kauf oder Verkauf.

Ein ausgeführter Verkauf läuft über [tranche-reconciliation.js](../../app/tranches/tranche-reconciliation.js):

1. Ausführungsdaten, Profil-ID und Aktion normalisieren.
2. Vorschau gegen den bestätigten Bestand erzeugen und Stück-/Cashwirkung anzeigen.
3. Eine separate Bestätigung mit derselben Ausgangsbasis verlangen.
4. Stücke, Profilaggregate und Ausführungsbeleg gemeinsam schreiben und bestätigen.

Identische `actionId` mit identischen Daten wiederholt keinen Verkauf. Widersprüchliche Aktionsdaten, ein Profilwechsel, zu viele verkaufte Stücke oder eine veraltete Vorschau blockieren. Eine Balanceempfehlung kann Herkunftsinformation liefern, ist aber selbst keine Broker-Ausführung. Der Simulator schreibt nur seine kopierten Lots.

Der Verkauf hat einen eigenen Cashstatus. Der Nettoerlös kann noch manuell zu buchen oder bereits im bestätigten Tagesgeld enthalten sein. [profile-cash-update.js](../../app/profile/profile-cash-update.js) bereitet personenweise Tagesgeldänderungen vor; Cashbestätigung und Korrektur haben separate Belege. Ihre Formen und Wiederholungsgrenzen stehen unter [Tranchen und ausgeführte Verkäufe](DATENVERTRAEGE.md#tranchen-und-ausgeführte-verkäufe).

Ein bestätigter Stückverkauf darf nicht durch erneutes Klicken denselben Nettoerlös ein zweites Mal zum Tagesgeld addieren. Flush-/Readbackfehler führen zur Rücknahme oder einer sichtbaren Recovery-Sperre. Die Speichertransaktionen gehören zur gemeinsamen Facade; der Dialog meldet Erfolg erst nach deren Bestätigung.

## Vermögensverlauf und Kurse

Der aktuelle Depotwert und der historische Tagesverlauf haben getrennte Quellen. Aktuelle Kurse kommen aus dem Kursservice und den bestätigten Lotständen. Der Verlauf verwendet historische Preise, Kauf-/Verkaufsbelege, Lotkopien und stufige Cashhistorie.

| Modul | Zuständigkeit |
| --- | --- |
| [profile-wealth-history.js](../../app/profile/profile-wealth-history.js) | profilbezogene Cashhistorie und nachvollziehbare Lotkopien erfassen |
| [tranchen-history-store.js](../../app/tranches/tranchen-history-store.js) | Historienstart, Tagespreise und bestätigte Historienwrites |
| [tranchen-history-fetch.js](../../app/tranches/tranchen-history-fetch.js) | fehlende Kursintervalle suchen und begrenzt laden |
| [tranchen-history-model.js](../../app/tranches/tranchen-history-model.js) | Stückzahl und Cash je Tag rekonstruieren und bewerten |
| [tranchen-history-svg.js](../../app/tranches/tranchen-history-svg.js) | Verlauf zeichnen, Darstellungsstichprobe und Interaktion führen |
| [tranchen-history-ui.js](../../app/tranches/tranchen-history-ui.js) | Verlaufsauswahl, Messbeginn und Status verbinden |
| [tranchen-history-recovery.js](../../app/tranches/tranchen-history-recovery.js) | unklare Bestandsherkunft vorbereiten und ausdrücklich korrigieren |
| [tranchen-history-closures.js](../../app/tranches/tranchen-history-closures.js) | erfasste Stände und Tageskennzahlen getrennt darstellen; Tageszeitraum wählen |
| [tranchen-history-wealth-capture.js](../../app/tranches/tranchen-history-wealth-capture.js) | manuelle Erfassung mit bestätigten Quellen verbinden |

`reconstructHistoryShares` verwendet Kaufdatum und bestätigte Verkaufsereignisse. Vollverkauf entfernt den Beleg nicht aus der Historie. Manuelle Bestandsänderungen können eine Unsicherheitsgrenze erzeugen; der Modellpfad darf davor keinen belegten Bestand behaupten. Cashwerte sind stufig und kommen aus dem eigenen Verlauf. Dessen gemeinsamer Writer hält je geschriebenem Tag nur den letzten Stand und entfernt den Tag bei Rückkehr auf den vorherigen Stand. Alte Mehrfacheinträge werden nur am geschriebenen Tag zusammengefasst. Verkaufs- und Abschlussbelege bleiben davon unabhängig erhalten.

`historyPriceAt` und `evaluateWealthHistory` entscheiden, ob ein Tag bewertbar ist. Kurslücken, Querystatus und fehlende Herkunft bleiben als Datenqualität sichtbar. Die SVG-Stichprobe reduziert gezeichnete Punkte, nicht den fachlichen Tagesbestand für Tabelle und Kennzahlen. Interaktion liest den ausgewählten Tag aus dem vollständigen Verlauf.

Alte manuelle oder jährliche Vermögensstände besitzen keinen verlässlichen historischen Personenbezug. Die gemeinsame Karte ergänzt sie als erfasste Stände; sie werden nicht heutigen Haushaltsmitgliedern zugeschlagen. Tageslinie und Altmarker können deshalb verschiedene Abdeckung besitzen. Die sichtbare Herkunftszeile über der Managerkurve trennt die berechnete Tageslinie von Rauten, Tabelle und den drei Kennzahlen aus erfassten Ständen. Der Jahresvergleich braucht zwei erfasste Stände im selben Jahr.

Die Gruppe Aus Tageskursen enthält Aufteilung am letzten Tagesabschluss, Veränderung nach Entnahmen, Entnahmen, Ohne Entnahmen gerechnet, Höchststand und größten Rückgang. Die fünf Kennzahlen lesen die ursprüngliche Tagesprojektion, nicht die um Abschlussstände erweiterte Zeichnungsachse. Zeitraum, Messbeginn und Messstatus stehen bei der Gruppe; die vollständige Lesehilfe und Qualitätsgrenzen öffnen sich über ⓘ. Haushalt-/Personenwahl und die drei Tageszeiträume nutzen denselben Bewertungsweg wie die Übersicht. Die Zeitraumwahl ist dokumentlokal und schreibt keine Daten. Auf der Übersicht bleiben nur Tagesabschluss und Veränderung sichtbar. Messbeginn, Preisgrenzen und Recordformen stehen unter [Vermögensverlauf](DATENVERTRAEGE.md#verlauf-und-datenqualität).

Die Managerlegende folgt der gezeichneten Skala einschließlich der Abschlusswerte. Bei einer Untergrenze über null erklärt sie die Gesamtlinie; bei null zeigt sie auch sichtbare Anlageflächen. Kauf, Verkauf, Schraffur und Abschlussrauten erscheinen nur mit ihren gezeichneten Gegenstücken. Der gemeinsame SVG-Baustein verbindet Ereignisbeschriftungen mit den Punkten, auch auf der Übersicht. Anzeige und Größenänderung schreiben keine Daten.

Der Verlauf wird auch von Übersicht und Balance gelesen. Diese Seiten verwenden die vorhandene Bewertungsprojektion, statt dieselben Kurse erneut nach eigenen Regeln zu bewerten. Kursdienstbetrieb und Offlinegrenzen stehen in [Einrichtung und Betrieb](../guides/EINRICHTUNG_UND_BETRIEB.md).

## Projektionen für Balance und Simulator

[profilverbund-balance.js](../../app/profile/profilverbund-balance.js) aggregiert bestätigte Profile für Balance. [profilverbund-action-attribution.js](../../app/profile/profilverbund-action-attribution.js) hält die Quellen einer finalen Haushaltsaktion bei ihrem Eigentümer. [simulator-profile-inputs.js](../../app/simulator/simulator-profile-inputs.js) projiziert die Profile und verbindet ihre Finanzbestände für den Simulator.

Die zentrale Goldberechnung `calculateProfileGoldStrategy` in [profile-asset-values.js](../../app/profile/profile-asset-values.js) liefert Ziel-/Floorbeträge und eine Diagnose je Profil. Die Aufrufer müssen ihr den genau einmal reconciliierten Vermögensbestand und dessen operative Liquidität liefern. Der Pflegebucketabzug ist auf vorhandene Liquidität begrenzt. Ziel und Floor entstehen je aktivem Goldprofil als Eurobeträge auf der freien Basis. Erst ihre Summen werden in Haushaltsquoten umgerechnet. So erhöht eine weitere Person ohne Goldstrategie nicht das absolute Ziel der anderen Person. Die fachlichen Reservegrenzen stehen im [Fachkonzept](FACHKONZEPT.md#standard-gold-und-drei-töpfe).

Der Simulator übernimmt die Pflegebucketdefinition des Hauptprofils und gliedert die Reserve nach dem Finanzmerge aus. Er hält die Herkunft der kopierten Lots über `sourceProfileId` fest. Balance verwendet seine eigenen lesenden Projektionen und attribuierten Ergebniswerte. Beide Verbraucher behandeln korrupte Bestände als Sperre; keiner darf ungeprüft das aktive Depot einer anderen Person als Ersatz verwenden.

Personenprojektionen behalten die einzelnen Identitäten und Renten. Ein aggregierter Finanzstate ist keine neue zentrale Person. Formen und Status der Verbundprojektionen stehen in [DATENVERTRAEGE](DATENVERTRAEGE.md#verbundprojektionen), die konkreten Rechenanschlüsse in [Balance](BALANCE_MODULES_README.md#haushaltsrechnung) und [Simulator](SIMULATOR_MODULES_README.md#haushaltsmerge).

## Migration, Recovery und Austausch

[profile-person-migration.js](../../app/profile/profile-person-migration.js) bereitet Altquellen und mögliche Partnerzuordnungen als Entwurf vor. Vor dem Write wird ein vollständiger Recoverypunkt dauerhaft bestätigt und zurückgelesen. Erst eine ausdrücklich bestätigte Quellenwahl erzeugt zentrale Personendaten. Abbruch bewahrt den Bestand; Fehler halten die Recovery-/Retrygrenze sichtbar.

[household-plan-migration.js](../../app/profile/household-plan-migration.js) führt alte Planwerte in ihre kanonischen Bereiche. Seitenbereitschaft wird erst nach der dafür nötigen Bestätigung freigegeben. Ein nicht freigegebener Altstand ist keine Erlaubnis für Folgeschreibaktionen.

[profile-recovery-ui.js](../../app/profile/profile-recovery-ui.js) zeigt exportierbaren Rohbestand und zulässige Wiederaufnahmewege. `profile-navigation.js` verbindet Retry und Reset mit Navigationsschutz und Flush. BFCache-Rückkehr hebt eine alte Bereitschaft auf; sie prüft den wiederhergestellten Dokumentkontext erneut. Ein offener Write behält seinen Besitzer bis zum tatsächlichen Ende.

[profile-bundle-io.js](../../app/profile/profile-bundle-io.js) besitzt den ersetzenden Profilbundlevertrag. [profile-person-file.js](../../app/profile/profile-person-file.js) behandelt dagegen den Austausch einer einzelnen Person mit Vorschau und Import als neue Außenperson. Vollsicherung, Restore und Neu beginnen gehören zur Seite [Daten & Sicherung](../../Daten-Sicherung.html). Austauschformen, erlaubte Schlüssel und Recoveryumfänge stehen ausschließlich in [DATENVERTRAEGE](DATENVERTRAEGE.md#sicherung-austausch-und-wiederherstellung).

Schlüsseländerungen müssen Profilcapture, Projektion, Bundle und Vollsicherung gemeinsam berücksichtigen. Testbefehle und Fixturepflege stehen im [Test-README](../../tests/README.md). Neue reine Datenlogik bleibt DOM-frei; Seitenmodule führen die Bestätigung und Anzeige.
