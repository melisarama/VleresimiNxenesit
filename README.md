# Vlerësimi i Nxënësit

Aplikacion mobile-first për bashkëpunimin mes mësimdhënësve dhe prindërve në shkollat e Kosovës. Mundëson ndjekjen e vazhdueshme të nxënësit, me vëmendje të veçantë ndaj fëmijëve me nevoja të veçanta.

## Funksionet kryesore

### Për mësimdhënësin

- Regjistri dhe dosja individuale e nxënësit.
- Humori dhe njoftimi ditor nga prindi.
- Notimi sipas lëndës dhe kapitullit.
- Preferencat e të nxënit dhe profili i mbështetjes.
- PIA dhe vlerësimi i vazhdueshëm.
- Asistenti pedagogjik AI për situata të menjëhershme në klasë.

### Për prindin

- Raportimi i humorit dhe komenteve ditore.
- Komente për të gjithë mësimdhënësit ose për një lëndë të caktuar.
- Rezultatet, mesataret dhe ecuria sipas lëndëve.
- Njoftimet nga mësimdhënësi.

## Teknologjitë

- HTML, CSS dhe JavaScript
- Supabase Auth, Database dhe Row Level Security (RLS)
- Supabase Edge Function për asistentin AI
- PowerShell për serverin lokal

## Nisja në localhost

Në PowerShell, brenda dosjes së projektit:

```powershell
npm install
npm run dev
```

Pastaj hapni [http://localhost:8080](http://localhost:8080).

## Konfigurimi

Krijoni `.env` duke u bazuar në `.env.example`:

```env
SUPABASE_URL=https://projekti.supabase.co
SUPABASE_PUBLISHABLE_KEY=publishable-key
PORT=8080
```

`OPENAI_API_KEY` dhe `SUPABASE_SERVICE_ROLE_KEY` ruhen vetëm në server ose në Supabase Secrets—kurrë në JavaScript-in e shfletuesit.

## Llogaritë demo

| Roli | Email | Fjalëkalimi |
| --- | --- | --- |
| Mësimdhënës | `teacher.math@mesimi.test` | `DemoPilot123!` |
| Prind | `parent.one@mesimi.test` | `DemoPilot123!` |

Këto llogari përdorin vetëm të dhëna testuese.

## Supabase

Komandat kryesore për migrimet:

```powershell
npm run supabase:login
npm run supabase:link
npm run db:push:dry
npm run db:push
```

Skema, migrimet, politikat RLS dhe të dhënat testuese gjenden në `supabase/`.

## Siguria

- Roli dhe shkolla e përdoruesit merren nga `profiles` në Supabase.
- Prindi mund të lexojë vetëm të dhënat e fëmijës së lidhur me llogarinë e tij.
- Mësimdhënësi mund të lexojë dhe vlerësojë vetëm nxënësit dhe lëndët e caktuara.
- Para pilotimit duhen testuar edhe rastet e refuzimit të qasjes ndërmjet përdoruesve.

## Struktura e projektit

- `index.html` — struktura e ndërfaqes
- `css/styles.css` — dizajni dhe pamja mobile
- `src/app.js` — logjika dhe lidhja me Supabase
- `supabase/` — migrimet, seed dhe funksioni AI
- `start-localhost.ps1` — serveri lokal

## Statusi

Projekti është prototip funksional, por jo ende gati për të dhëna reale shkollore. Para pilotimit duhen përfunduar rrjedha e administratorit, ruajtja e PIA-s, testet e plota RLS dhe rishikimi i privatësisë së të dhënave të fëmijëve.

## Changelog

### 2026-08-13

- U lidhën hyrjet demo të mësimdhënësit dhe prindit me Supabase.
- U nda kodi në HTML, CSS dhe JavaScript dhe u shtuan migrimet/RLS.
- U shtua asistenti pedagogjik përmes Supabase Edge Function.
- U ridizajnua faqja hyrëse dhe pamja fillestare `Sot` e mësimdhënësit.
- U shtuan data/ora, mirëseardhja, lista ditore dhe humori i nxënësve nga Supabase.
- U përmirësuan navigimi mobile, kontrasti dhe qasja me tastierë.
