# Vlerësimi i Nxënësit / Mësim i Qartë

Mobile-first school pilot for Kosovo classrooms. The app keeps the original pastel/mobile prototype experience, but the first production hardening pass moves the project toward a Supabase-backed, role-based architecture.

## Current Architecture

- `index.html` is now the document shell.
- `css/styles.css` contains the preserved visual design.
- `src/app.js` contains the browser application logic.
- `supabase/migrations/` contains reproducible schema and RLS changes.
- `supabase/functions/support/` contains the authenticated pedagogical AI endpoint.
- Supabase Auth is the identity layer; user role and school come from `profiles`, not from a frontend selector.

## What This Pass Implements

- Splits the previous monolithic HTML into separate HTML, CSS, and JavaScript files.
- Removes browser localStorage as the write path for chapters, grades, parent mood updates, subject-specific parent notices, and teacher-to-parent notices.
- Adds a multi-school schema target: schools, profiles, classes, students, relationships, subjects, chapters, grades, moods, notices, support profiles, continuous assessments, and PIA plans.
- Adds RLS policies for parent, teacher, and school-admin boundaries.
- Adds synthetic local seed data for one school, one admin, two teachers, two parents, and three students.
- Moves the AI production path to a Supabase Edge Function with a small provider abstraction and server-side OpenAI configuration.
- Removes invented analytics fallback data; empty progress views now say there is not enough data.
- Stops opening the hard-coded demo PIA PDF as if it were a real student document.

## Local Frontend Run

```powershell
powershell -ExecutionPolicy Bypass -File .\start-localhost.ps1
```

Open `http://localhost:8080`.

The PowerShell server serves `index.html`, `css/`, and `src/`. It still includes the older local `/api/support` fallback, but the browser now calls the Supabase Edge Function for production AI.

## Supabase Setup

Install and log in to the Supabase CLI, then run:

```powershell
supabase start
supabase db reset
supabase functions serve support --env-file .env
```

Apply to a hosted project with:

```powershell
supabase db push
supabase functions deploy support
```

## Environment Variables

Copy `.env.example` to `.env` for local Supabase function work.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER=openai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT` for the optional local PowerShell server

Never put `OPENAI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript.

## Demo Accounts

When using `supabase/seed.sql`, each account uses password `DemoPilot123!`.

- `admin.demo@mesimi.test`
- `teacher.math@mesimi.test`
- `teacher.lang@mesimi.test`
- `parent.one@mesimi.test`
- `parent.two@mesimi.test`

These are synthetic local accounts only.

## Security Model

The schema uses `profiles.school_id` and relationship tables as the authorization source:

- Parents read linked children through `parent_students`.
- Teachers read assigned students through `teacher_students`.
- Teachers can grade only assigned students in assigned subjects, and only when the chapter belongs to that subject.
- Admins manage records only inside their own school.
- Subject-specific parent notices are visible to the parent and to teachers assigned to that subject.
- Teacher-to-parent notices are persisted in `teacher_parent_notices`.

RLS must be tested with real authenticated parent, teacher, and admin users before any pilot deployment.

## AI Endpoint

`supabase/functions/support/index.ts`:

- accepts authenticated teacher requests only,
- strips obvious email/phone/name patterns before sending text to the provider,
- handles immediate-risk wording conservatively,
- uses an `AIProvider` interface with an OpenAI implementation,
- requests structured JSON output for predictable UI rendering.

The OpenAI API key is read only from Edge Function environment variables, following official OpenAI documentation guidance for environment-stored API keys and structured JSON outputs.

## Intentionally Incomplete

This is not yet production-ready.

- The admin UI is not implemented in the browser yet, though the schema and policies support it.
- Full session restoration and route protection still need a UI pass.
- Multi-child parent switching is not yet exposed; the parent loader currently opens the first linked child.
- PIA document upload/download is modeled but not wired to Supabase Storage.
- Continuous assessment has schema and seed categories, but the teacher UI is not fully database-backed yet.
- RLS has been written but not validated against a live Supabase project in this workspace.
- The browser still contains some prototype-only helper interactions marked by text/alerts rather than complete workflows.

## Test Checklist

Before a school pilot, manually verify:

- Parent, teacher, and admin login.
- Invalid login and logout.
- Parent A cannot read Student B.
- Teacher A cannot read or grade unrelated students.
- Teacher A cannot grade an unassigned subject.
- Admin A cannot manage School B.
- Parent mood upsert persists and can be updated for the same day.
- Subject-specific parent notices are visible only to assigned subject teachers.
- Teacher notices persist after logout/login.
- AI requests require an authenticated teacher and no provider secret appears in frontend code.

## Privacy And Legal Review

This system handles child-related educational information. A school or operator still needs formal privacy, retention, access-control, safeguarding, and document-storage policies before real deployment.
