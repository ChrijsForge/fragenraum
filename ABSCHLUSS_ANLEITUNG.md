# Abschluss-Anleitung FragenRaum v13

Diese Anleitung geht davon aus, dass dein Projektordner lokal so heißt:

```text
C:\Users\chris\Downloads\fragenraum-web-v13\fragenraum-web-v13
```

Falls der Ordner anders heißt, im Befehl entsprechend ersetzen.

## 1. Projekt starten und testen

```bat
cd /d "C:\Users\chris\Downloads\fragenraum-web-v13\fragenraum-web-v13"
npm install
notepad .env.local
npm run dev
```

In `.env.local` muss stehen:

```env
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=DEIN-PUBLISHABLE-KEY
```

Browser öffnen:

```text
http://localhost:5173/
```

Testen:

1. Raum erstellen.
2. Mit Handy/zweitem Browser beitreten.
3. Frage einreichen.
4. Frage freigeben.
5. Quiz starten.
6. Antworten zählen lassen.
7. Präsentationsmodus testen.
8. Lernkarten drucken testen.
9. Anki/TSV-Lernkartenexport testen.
10. Auswertung zurücksetzen testen.

## 2. Impressum und Datenschutz prüfen

Datei öffnen:

```bat
notepad src\App.tsx
```

Suchen nach:

```text
Platzhalter
Adresse ergänzen
DEINE
HIER DEINE
```

Alle Platzhalter entfernen. Impressum und Datenschutz müssen echte Angaben enthalten.

## 3. Build erstellen

```bat
npm run build
```

Wenn kein Fehler kommt, wurde der Ordner `dist` erzeugt/aktualisiert.

## 4. Deploy zu Cloudflare Workers

```bat
npx wrangler@latest login
npx wrangler@latest deploy
```

Danach zeigt Wrangler die öffentliche URL an.

## 5. Wenn Cloudflare einen Redirect-Fehler meldet

In v13 sollten `_redirects` entfernt sein. Falls trotzdem eine `_redirects` im Projekt liegt:

```bat
if exist "public\_redirects" del "public\_redirects"
if exist "dist\_redirects" del "dist\_redirects"
npm run build
npx wrangler@latest deploy
```

## 6. GitHub-Repo anlegen

Auf GitHub ein neues Repository erstellen.

Empfohlene Felder:

- Repository name: `fragenraum`
- Description: `Datensparsame Web-App zum gemeinsamen Erstellen, Moderieren und Auswerten von Multiple-Choice-Fragen im Unterricht.`
- Visibility: Public, wenn du es als Portfolio zeigen willst.
- README nicht extra auf GitHub erzeugen, weil schon eine `README.md` im Projekt liegt.
- `.gitignore` nicht extra auf GitHub erzeugen, weil schon eine `.gitignore` im Projekt liegt.
- License nicht extra auf GitHub erzeugen, weil schon eine `LICENSE` im Projekt liegt.

## 7. GitHub per CMD befüllen

Im Projektordner:

```bat
git init
git add .
git commit -m "Initial release of FragenRaum"
git branch -M main
git remote add origin https://github.com/DEIN-GITHUB-NAME/fragenraum.git
git push -u origin main
```

`DEIN-GITHUB-NAME` ersetzen.

Wenn Git noch nicht installiert ist oder GitHub beim Push Login verlangt, den Anweisungen im CMD folgen.

## 8. Danach Projekt einfrieren

Nach dem Upload nicht weiter neue Funktionen bauen. Nur noch:

- echte Bugs beheben,
- Impressum/Datenschutz aktuell halten,
- Supabase/Cloudflare im Blick behalten,
- Link bei Bewerbungen/Portfolio verwenden.
