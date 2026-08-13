# Student Assessment

A mobile-first application for collaboration between teachers and parents in Kosovo schools. It enables continuous student monitoring, with special attention to children with special needs.

## Core Features

### For Teachers

- Student registry and individual student folder.
- Daily mood and notification from the parent.
- Grading by subject and chapter.
- Learning preferences and support profile.
- Individual Education Plan (PIA) and continuous assessment.
- AI pedagogical assistant for immediate classroom situations.

### For Parents

- Reporting daily mood and comments.
- Comments for all teachers or for a specific subject.
- Results, averages, and progress by subject.
- Notifications from the teacher.

## Technologies

- HTML, CSS, and JavaScript
- Supabase Auth, Database, and Row Level Security (RLS)
- Supabase Edge Function for the AI assistant
- PowerShell for the local server

## Running on Localhost

In PowerShell, from the project directory:

```powershell
npm install
npm run dev
```

Then open [http://localhost:8080](http://localhost:8080).

## Configuration

Create `.env` based on `.env.example`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=publishable-key
PORT=8080
```

`OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must be stored only on the server or in Supabase Secrets—never in browser JavaScript.

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Teacher | `teacher.math@mesimi.test` | `DemoPilot123!` |
| Parent | `parent.one@mesimi.test` | `DemoPilot123!` |

These accounts use test data only.

## Supabase

Main migration commands:

```powershell
npm run supabase:login
npm run supabase:link
npm run db:push:dry
npm run db:push
```

The schema, migrations, RLS policies, and test data are located in `supabase/`.

## Security

- The user's role and school are read from `profiles` in Supabase.
- A parent can read only the data of the child linked to their account.
- A teacher can read and assess only their assigned students and subjects.
- Access-denial cases between users must also be tested before the pilot.

## Project Structure

- `index.html` — interface structure
- `css/styles.css` — design and mobile layout
- `src/app.js` — application logic and Supabase integration
- `supabase/` — migrations, seed data, and AI function
- `start-localhost.ps1` — local server

## Status

The project is a functional prototype, but it is not yet ready for real school data. Before the pilot, the administrator workflow, PIA storage, complete RLS testing, and a review of children's data privacy must be completed.

## Changelog

### 2026-08-13

- Connected the teacher and parent demo logins to Supabase.
- Split the code into HTML, CSS, and JavaScript and added migrations/RLS.
- Added the pedagogical assistant through a Supabase Edge Function.
- Redesigned the landing page and the teacher's initial `Sot` view.
- Added the date/time, welcome message, daily list, and student moods from Supabase.
- Improved mobile navigation, contrast, and keyboard accessibility.
