# FragenRaum online bringen – Kurzleitfaden v12

Diese App ist eine Vite/React-App mit Supabase als Backend und Cloudflare Pages als Hosting.

## 1. Lokal testen

```bat
cd /d "C:\Users\chris\OneDrive\Desktop\Frageraum Projekt\fragenraum-web-v12"
npm install
npm run dev
```

## 2. Supabase vorbereiten

1. Neues Supabase-Projekt erstellen.
2. Region möglichst EU/Frankfurt wählen.
3. Im SQL Editor den Inhalt von `supabase/schema.sql` ausführen.
4. Aus Project Settings/API bzw. Connect die Projekt-URL und den public/anon Key kopieren.
5. Lokal `.env.local` anlegen:

```env
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=DEIN-PUBLIC-ODER-ANON-KEY
```

Dann neu starten:

```bat
npm run dev
```

Oben sollte nun „Online-Modus mit Supabase“ stehen.

## 3. Build testen

```bat
npm run build
```

Wenn das klappt, entsteht der Ordner `dist`.

## 4. GitHub und Cloudflare Pages

1. Projektordner als GitHub-Repository hochladen.
2. In Cloudflare: Workers & Pages → Pages → Git verbinden.
3. Repository auswählen.
4. Build command: `npm run build`
5. Build output directory: `dist`
6. Environment Variables setzen:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. Deploy starten.

## 5. Nach dem Deployment testen

- Startseite öffnen.
- Raum erstellen.
- Schülerlink/QR-Code in anderem Browser oder Handy öffnen.
- Frage einreichen.
- Adminseite prüfen.
- Quiz im Präsentationsmodus starten.
- Antwort abgeben und prüfen, ob geantwortet/offen/Antwortverteilung hochzählen.

## 6. Vor öffentlicher Nutzung

- Impressum ausfüllen.
- Datenschutzseite ausfüllen.
- Test-Raum nach 21-Tage-Löschlogik prüfen.
- Bei echter Nutzung keine sensiblen Schülerdaten oder Klarnamen verlangen.


## Nach Update auf v12

Wenn du v11 bereits erfolgreich mit Supabase getestet hast, brauchst du für v12 keinen neuen Supabase-Patch. v12 ändert nur den Präsentationsfluss im Frontend. Falls du von v9 oder v10 kommst, führe weiterhin zuerst `supabase/patch-v11.sql` im Supabase SQL Editor aus.
