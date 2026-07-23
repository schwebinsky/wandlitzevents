# Wandlitz-Veranstaltungen für Squarespace

Dieses Starterprojekt liest die öffentliche Veranstaltungsliste der Gemeinde
Wandlitz serverseitig aus und stellt sie als responsives Widget bereit.

## Warum ein externes Widget?

Squarespace bietet keine dokumentierte öffentliche API, mit der normale
Kalender-/Event-Einträge automatisiert angelegt und aktualisiert werden können.
Ein eingebettetes Widget ist deshalb stabiler als Browser-Automatisierung im
Squarespace-Backend.

## Funktionsweise

1. `/api/events` lädt `https://www.wandlitz.de/veranstaltungen/`.
2. Die Event-Links werden anhand ihrer URL-Struktur erkannt.
3. Titel, Datum, Uhrzeit und Veranstaltungsort werden extrahiert.
4. Vercel cached die Antwort sechs Stunden.
5. `index.html` zeigt die Termine als responsive Liste.
6. Squarespace bindet das Widget per `iframe` ein.

Das Widget kopiert bewusst keine Beschreibungstexte oder Bilder. Dadurch bleibt
die Darstellung kompakt, vermeidet unnötiges Hotlinking und führt für Details
immer zur Originalquelle.

## Deployment auf Vercel

1. Kostenloses Konto bei Vercel erstellen.
2. Diesen Ordner in ein neues GitHub-Repository hochladen.
3. In Vercel `Add New > Project` wählen und das Repository importieren.
4. Framework Preset: `Other`.
5. Deploy ausführen.
6. Die erzeugte URL öffnen und prüfen.

Alternativ mit der Vercel-CLI:

```bash
npm install
npx vercel
```

## In Squarespace einbauen

Voraussetzung: Ein Squarespace-Tarif, der JavaScript und iframes in Code-Blöcken
unterstützt.

1. Eine normale Squarespace-Seite öffnen.
2. `Bearbeiten > Block hinzufügen > Code`.
3. Als Typ `HTML` wählen.
4. Den Inhalt aus `squarespace-embed.html` einfügen.
5. `https://DEIN-PROJEKT.vercel.app/` durch deine Vercel-URL ersetzen.
6. Speichern und die Seite ausgeloggt bzw. im Inkognito-Fenster testen.

Mit `?limit=20` bestimmst du die maximale Anzahl angezeigter Termine.

## Aktualisierungsintervall

Der API-Endpunkt setzt:

```text
s-maxage=21600
```

Damit wird die Quelle höchstens alle sechs Stunden neu geladen. Das schützt die
Wandlitz-Seite vor unnötigen Abrufen. Für ein anderes Intervall den Wert in
`api/events.js` ändern.

Beispiele:

- 1 Stunde: `s-maxage=3600`
- 12 Stunden: `s-maxage=43200`
- 24 Stunden: `s-maxage=86400`

## Anpassungen

Farben, Abstände und Schriftgrößen stehen am Anfang von `index.html` als
CSS-Variablen:

```css
--surface: #ffffff;
--text: #172019;
--muted: #66706a;
--line: #dfe5e1;
--accent: #215c39;
--accent-soft: #edf5ef;
```

## Betrieb und Wartung

Webseiten können ihre HTML-Struktur ändern. Falls keine Termine mehr erscheinen:

1. Vercel-Logs prüfen.
2. `/api/events?limit=5` direkt öffnen.
3. Die Selektions- und Erkennungslogik in `api/events.js` anpassen.

Vor einem öffentlichen Dauerbetrieb sollte die Gemeinde Wandlitz um Zustimmung
zur regelmäßigen Übernahme gebeten werden. Die Quelle sollte sichtbar genannt
und jede Veranstaltung zur Originalseite verlinkt bleiben.
