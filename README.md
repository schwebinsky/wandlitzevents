# Veranstaltungs-Widget für Wandlitz und Bernau

Dieses Projekt liest öffentliche Veranstaltungstermine aus zwei Quellen aus und
zeigt sie gemeinsam in einem responsiven Squarespace-Widget:

- Gemeinde Wandlitz: `https://www.wandlitz.de/veranstaltungen/`
- Tourist-Information Bernau: `https://www.bernau-besuchen.de/veranstaltungen-2`

## Was neu ist

- beide Quellen werden parallel geladen
- fällt eine Quelle vorübergehend aus, bleibt die andere sichtbar
- Termine werden nach Datum und Uhrzeit zusammengeführt
- jede Karte zeigt die Herkunft `Wandlitz` oder `Bernau`
- zusätzlicher Regionsfilter: Alle Orte, Wandlitz oder Bernau
- Suche berücksichtigt Titel, Ort und Quelle
- Ergebnisse werden sechs Stunden gecacht

## Aktualisierung bei GitHub

1. Den Inhalt dieses Ordners öffnen.
2. Im bestehenden GitHub-Repository `Add file > Upload files` wählen.
3. Alle Dateien und den Ordner `api` hochladen.
4. Vorhandene Dateien überschreiben lassen.
5. Einen Commit erstellen, zum Beispiel `Bernau-Termine ergänzt`.
6. Vercel startet danach automatisch ein neues Deployment.

## Testen

Nach dem Deployment zuerst den API-Endpunkt öffnen:

```text
https://DEIN-PROJEKT.vercel.app/api/events?limit=20
```

Die JSON-Antwort sollte unter `sources` beide Quellen und unter `events`
Termine mit `sourceKey: "wandlitz"` beziehungsweise `sourceKey: "bernau"`
enthalten.

Danach das Widget öffnen:

```text
https://DEIN-PROJEKT.vercel.app/?limit=80
```

Eine Vorschau mit lokalen Beispieldaten ist weiterhin verfügbar:

```text
https://DEIN-PROJEKT.vercel.app/?demo=1
```

## Squarespace

Der vorhandene Code-Block kann grundsätzlich unverändert bleiben, wenn er
bereits dieselbe Vercel-Adresse einbindet. Empfehlenswert ist `limit=80`, weil
die Bernauer Quelle deutlich mehr Termine enthält.

Der vollständige Einbettungscode steht in `squarespace-embed.html`.

## Konfiguration

Die Quelladressen können in Vercel über Umgebungsvariablen überschrieben
werden:

```text
WANDLITZ_SOURCE_URL
BERNAU_SOURCE_URL
```

Ohne diese Variablen werden automatisch die oben genannten URLs verwendet.

## Wartung

Webseiten können ihre HTML-Struktur ändern. Wenn eine Quelle nicht mehr geladen
wird, liefert `/api/events` im Feld `warnings` einen Hinweis. Die andere Quelle
wird trotzdem weiter ausgegeben.

Quellenangaben und Links zu den Originalveranstaltungen sollten sichtbar
bleiben. Für einen dauerhaften öffentlichen Betrieb empfiehlt sich die
Abstimmung mit den jeweiligen Seitenbetreibern.

## Fehlerkorrektur in Version 5

Die Wandlitz-Quelle wird nun über zwei alternative Seitenadressen und mit zwei
Abrufprofilen versucht. Teilweise erfolgreiche Antworten werden nur zwei Minuten
zwischengespeichert, damit ein kurzfristiger Ausfall nicht stundenlang als reine
Bernau-Liste sichtbar bleibt. Nach dem Deployment kann der Status unter
`/api/events?limit=20&widgetVersion=5` geprüft werden.


## Version 6: ausgewogene Quellen

Die API reserviert nun bei einem gemeinsamen Limit Plätze für jede aktive Quelle.
Bei `limit=80` werden zunächst bis zu 40 Termine je Quelle berücksichtigt; freie
Plätze werden anschließend chronologisch mit weiteren Terminen aufgefüllt. Dadurch
kann eine umfangreiche Quelle die andere nicht mehr vollständig aus der Ausgabe
verdrängen. Im API-Feld `sources` zeigt `returnedCount`, wie viele Termine jeder
Quelle tatsächlich an das Widget übergeben wurden.


## Version 7: stabilerer Wandlitz-Abruf

Der Wandlitz-Import versucht weiterhin zuerst den direkten Abruf der offiziellen
Seite. Falls die Seite eine Vercel-/Rechenzentrumsanfrage blockiert oder dabei
keine Eventlinks liefert, wird als Rückfallweg die öffentliche Jina Reader API
verwendet. Die Eventlinks führen weiterhin ausschließlich zur offiziellen
Wandlitz-Seite. Im API-Feld `sources[].strategy` steht `direct-html` oder
`reader-fallback`, sodass der verwendete Abrufweg sichtbar bleibt.
