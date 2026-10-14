# FragenRaum

**FragenRaum** ist eine datensparsame Web-App für Unterricht, Workshops und Lerngruppen. Ohne Anmeldung können gemeinsam Multiple-Choice-Fragen gesammelt, moderiert, gespielt und auf Gruppenebene ausgewertet werden.

Demo/Live-App: `https://fragenraum-duwe.chris-duwe.workers.dev`

## Kurzidee

Lernende erstellen selbst Fragen. Die Lehrkraft prüft und moderiert. Danach wird das Quiz im normalen Modus oder im Präsentationsmodus gespielt. Die Auswertung zeigt typische Fehler der Gruppe, ohne individuelle Antwortverläufe oder Punktelisten zu speichern.

FragenRaum ist nicht als Klausur-, Prüfungs- oder Bewertungswerkzeug gedacht, sondern für Wiederholung, formative Lernstandsdiagnose und Unterrichtsgespräch.

## Funktionen

- Räume ohne Registrierung erstellen
- Schülerbeitritt per Code oder QR-Code
- unabhängiger Admincode für Lehrkräfte
- Fragen mit 2 bis 10 Antwortoptionen
- eine oder mehrere richtige Antworten möglich
- Review, Bearbeiten, Freigeben, Zurückgeben mit Kommentar, Löschen
- optional Auto-Freigabe
- normaler Quizmodus
- Präsentationsmodus mit Live-Abgabeanzeige und Auswertung pro Frage
- Übungsmodus ohne Wertung
- aggregierte Auswertung auf Gruppenebene
- Excel-Vorlage und Excel-Import
- JSON-Sicherung und JSON-Import
- Auswertung als Excel
- Lernkarten-Druckansicht
- Anki/TSV-Lernkartenexport
- 21-Tage-Löschlogik vorbereitet
- einfache Schutzmechanismen gegen Dauergeklicke

## Datenschutz-Grundidee

FragenRaum ist bewusst datensparsam angelegt:

- keine Schüleraccounts
- keine E-Mail-Adressen von Schülerinnen und Schülern
- keine Klarnamenpflicht
- keine individuellen Punktzahlen
- keine individuellen Antwortverläufe für die Lehrkraft
- Auswertung nur aggregiert auf Gruppenebene

Wichtig: Aliasnamen können im Klassenkontext trotzdem personenbezogen sein, wenn sie zuordenbar sind. Die App ersetzt keine schulische Datenschutzprüfung.

## Tech-Stack

- React
- TypeScript
- Vite
- Supabase/Postgres
- Cloudflare Workers Static Assets
- SheetJS/xlsx für Excel-Export und -Import

## Lokal starten

Voraussetzung: Node.js ist installiert.

```bash
npm install
npm run dev
```

Dann im Browser öffnen:

```text
http://localhost:5173/
```

Ohne Supabase-Konfiguration läuft FragenRaum im lokalen Demo-Modus. Räume sind dann nur in diesem Browser sichtbar.

## Online-Modus mit Supabase

Im Projektordner eine Datei `.env.local` erstellen:

```env
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=DEIN-PUBLISHABLE-ODER-ANON-KEY
```

Supabase-Datenbank vorbereiten:

1. Supabase-Projekt erstellen.
2. SQL Editor öffnen.
3. Inhalt von `supabase/schema.sql` ausführen.
4. Optional später `supabase/cron.sql` für Löschung abgelaufener Räume prüfen/aktivieren.

Dann neu starten:

```bash
npm run dev
```

Wenn im Header „Online-Modus mit Supabase“ steht, ist die Verbindung aktiv.

## Deployment mit Cloudflare Workers Static Assets

Für den aktuellen Deployment-Weg liegt eine `wrangler.jsonc` bei.

```bash
npm run build
npx wrangler@latest login
npx wrangler@latest deploy
```

Die fertige Website wird aus dem Ordner `dist` ausgeliefert.

## Wichtige Schaltflächen

### Startseite

- **Raum erstellen:** erstellt einen neuen Quizraum mit Schülercode und Admincode.
- **Code öffnen:** öffnet je nach Code die Schüler- oder Adminansicht.
- **Excel-Vorlage herunterladen:** lädt die feste FragenRaum-Vorlage für Quizimporte herunter.

### Adminbereich

- **Normaler Quizmodus:** Schülerinnen und Schüler bearbeiten alle Fragen selbstständig.
- **Präsentationsmodus:** Lehrkraft zeigt die Frage vorne; Schülergeräte zeigen nur Antwortoptionen.
- **Übungsmodus freischalten:** Lernende können später selbstständig üben; diese Antworten zählen nicht in die Auswertung.
- **Fragen sammeln:** zurück in die Sammelphase.
- **Review:** eingereichte Fragen prüfen.
- **Quiz starten:** startet den Quizdurchlauf.
- **Quiz beenden:** beendet den Quizdurchlauf.
- **Auswertung:** zeigt die aggregierte Gruppenanalyse.
- **Auto-Freigabe einschalten:** neue Fragen werden direkt freigegeben.
- **Auswertung als Excel:** lädt eine menschenlesbare Ergebnisdatei herunter.
- **Lernkarten drucken:** öffnet eine Druckansicht aus freigegebenen Fragen.
- **Anki/TSV-Lernkarten:** lädt Lernkarten als Tab-getrennte Textdatei herunter.
- **Quiz als JSON sichern:** stabile Wiederherstellungsdatei.
- **Auswertung zurücksetzen:** löscht Gruppenzähler und startet einen neuen Durchlauf, Fragen bleiben erhalten.
- **Raum löschen:** löscht den Raum.

### Schüleransicht

- **Frage einreichen:** erstellt eine neue Frage.
- **Zurückgegebene Frage überarbeiten:** nur für die Session, die die Frage erstellt hat.
- **Zum Quiz:** öffnet den laufenden Quizdurchlauf.
- **Übungsquiz starten:** sichtbar, wenn die Lehrkraft den Übungsmodus freigeschaltet hat.
- **Lernkarten drucken / Anki/TSV:** erzeugt Lernmaterial aus freigegebenen Fragen.

## Excel-Regeln

Excel-Import ist praktisch, aber strukturgebunden. Bitte die FragenRaum-Vorlage nutzen.

Erwartet wird das Tabellenblatt `Fragen` mit diesen Spalten:

- `Frage`
- `Antwort A` bis `Antwort J`
- `Richtige Antworten`
- `Erklärung`

Regeln:

- 2 bis 10 Antwortoptionen
- leere Antwortspalten werden ignoriert
- mindestens eine richtige Antwort
- richtige Antworten als Buchstaben, z. B. `A` oder `A,C,E`
- KI-generierte Dateien fachlich prüfen
- beim Import wird die Auswertung zurückgesetzt

## Lernkartenexport

Aus freigegebenen Fragen können Lernkarten erzeugt werden:

- **Druckansicht:** öffnet eine druckbare HTML-Seite, die auch als PDF gespeichert werden kann.
- **Anki/TSV:** erzeugt eine Datei mit Vorderseite und Rückseite, die in viele Karteikartenprogramme importiert werden kann.

## Grenzen

- kein Klausurmodus
- keine Notenlogik
- kein Scoreboard
- keine Accounts
- Live-Aktualisierung per Polling, nicht per Supabase Realtime
- Schutzmechanismen sind für Unterrichtsbetrieb gedacht, nicht für gezielte Angriffe

## Lizenz

Siehe `LICENSE`.
