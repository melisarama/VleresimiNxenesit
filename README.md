# Vlerësimi i Nxënësit / Mësim i Qartë

Mobile-first school pilot for Kosovo classrooms. The app keeps the original pastel/mobile prototype experience, but the first production hardening pass moves the project toward a Supabase-backed, role-based architecture.

## Current Status

As of this handoff, the repository can run locally against the hosted Supabase project configured in `.env`.

- Supabase CLI is installed locally through `package.json`; a global Supabase install is not required.
- The hosted project has been linked and the current migrations have been pushed.
- Teacher and parent demo logins have been verified against Supabase Auth.
- Teacher post-login reads for profile, assigned subject, assigned students, grades, moods, support profiles, chapters, and teacher notices have been verified through the Supabase REST API.
- Parent post-login reads for linked child, grades, moods, subject notices, and teacher notices have been verified through the Supabase REST API.
- The browser app still needs more UI polish and workflow completion, but the core auth/data path is now usable for logic work.

## Current Architecture

- `index.html` is now the document shell.
- `css/styles.css` contains the preserved visual design.
- `src/app.js` contains the browser application logic.
- `supabase/migrations/` contains reproducible schema and RLS changes.
- `supabase/functions/support/` contains the authenticated pedagogical AI endpoint.
- `start-localhost.ps1` serves the static frontend and generates browser config from `.env`.
- `package.json` contains local scripts for the frontend server, Supabase CLI, migrations, seed, and checks.
- Supabase Auth is the identity layer; user role and school come from `profiles`, not from a frontend selector.

## Change Log

### 2026-08-13

- Rebuilt the teacher's initial `Sot` view as a focused mobile dashboard with a live Albanian date/time, personalized welcome banner, and a clean daily student list.
- Added database-backed parent mood summaries directly to each student card while keeping the full student tools under `Nxënësit`.
- Replaced the teacher bottom-navigation symbols with accessible custom SVG icons and preserved direct access to all four teacher sections.
- Redesigned the role-selection landing page with a solid white central panel over a pastel educational line-art tapestry.
- Added an original VN emblem with wings and a heart, plus custom vector illustrations for the teacher and parent access paths.
- Improved mobile reflow, keyboard focus states, contrast, reduced-motion support, and visual hierarchy without changing the existing role navigation logic.
- Excluded local PowerShell server logs from Git tracking.

## What This Pass Implements

- Splits the previous monolithic HTML into separate HTML, CSS, and JavaScript files.
- Removes browser localStorage as the write path for chapters, grades, parent mood updates, subject-specific parent notices, and teacher-to-parent notices.
- Adds a multi-school schema target: schools, profiles, classes, students, relationships, subjects, chapters, grades, moods, notices, support profiles, continuous assessments, and PIA plans.
- Adds RLS policies for parent, teacher, and school-admin boundaries.
- Adds synthetic seed data for one school, one admin, two teachers, two parents, and three students.
- Adds Auth repair and API grant migrations needed for the hosted Supabase Auth and PostgREST paths.
- Moves the AI production path to a Supabase Edge Function with a small provider abstraction and server-side OpenAI configuration.
- Removes invented analytics fallback data; empty progress views now say there is not enough data.
- Stops opening the hard-coded demo PIA PDF as if it were a real student document.

## Migration Notes

The current migration sequence is:

- `202608120001_school_pilot_schema.sql`: creates the pilot schema, helper functions, indexes, RLS policies, subjects, and assessment categories.
- `202608120002_repair_demo_auth_users.sql`: repairs deterministic demo Auth users after early seed attempts, including email identities and non-null Auth token fields.
- `202608120003_public_api_grants.sql`: grants authenticated API access to public tables while keeping RLS responsible for row-level authorization.

The second migration exists because direct SQL inserts into Supabase Auth can leave fields in a state that causes `Database error querying schema` during login. Keep it while this dev project uses deterministic seeded demo users.

## Local Frontend Run

Install project tooling once:

```powershell
npm install
```

Then start the app:

```powershell
npm run dev
```

Open `http://localhost:8080`.

The PowerShell server serves `index.html`, `css/`, and `src/`. It still includes the older local `/api/support` fallback, but the browser now calls the Supabase Edge Function for production AI.

## Supabase Setup

The Supabase CLI is installed as a local dev dependency through `package.json`; a global install is not required.

For hosted Supabase work, log in, link the project, preview migrations, then push:

```powershell
npm run supabase:login
npm run supabase:link
npm run db:push:dry
npm run db:push
```

To load or re-apply `supabase/seed.sql` into the hosted project, run:

```powershell
npm run db:push:seed
```

If seed data changes do not appear to run again, create a migration for any required hosted-project repair. `supabase db push --include-seed` may update the remote seed hash without forcing old seed rows to be repaired the way a migration does.

For a fully local Supabase stack with Docker, run:

```powershell
npm run supabase -- start
npm run db:reset:local
npm run functions:serve
```

Deploy the Edge Function with:

```powershell
npm run functions:deploy
```

## Environment Variables

Copy `.env.example` to `.env` for local Supabase function work.

For the static frontend, `start-localhost.ps1` reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from `.env` and serves them to the browser as `src/config.js`. Browser-safe Supabase publishable keys are not secrets, but keeping them out of `app.js` makes project switching cleaner.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER=openai`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `PORT` for the optional local PowerShell server

Never put `OPENAI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript.

## Demo Accounts

When using the seed/migrations in this dev project, each account uses password `DemoPilot123!`.

- `admin.demo@mesimi.test`
- `teacher.math@mesimi.test`
- `teacher.lang@mesimi.test`
- `parent.one@mesimi.test`
- `parent.two@mesimi.test`

These are synthetic demo accounts only. They are acceptable for local/dev testing, but should not be used for real school data.

Verified logins:

- `teacher.math@mesimi.test` / `DemoPilot123!`
- `parent.one@mesimi.test` / `DemoPilot123!`

## Security Model

The schema uses `profiles.school_id` and relationship tables as the authorization source:

- Parents read linked children through `parent_students`.
- Teachers read assigned students through `teacher_students`.
- Teachers can grade only assigned students in assigned subjects, and only when the chapter belongs to that subject.
- Admins manage records only inside their own school.
- Subject-specific parent notices are visible to the parent and to teachers assigned to that subject.
- Teacher-to-parent notices are persisted in `teacher_parent_notices`.

RLS must be tested with real authenticated parent, teacher, and admin users before any pilot deployment.

The current dev smoke test has verified the happy path for the seeded teacher and parent. Cross-user denial cases still need to be manually tested before any pilot.

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
- The admin demo Auth user exists, but there is no admin screen yet.
- Full session restoration and route protection still need a UI pass.
- Multi-child parent switching is not yet exposed; the parent loader currently opens the first linked child.
- PIA document upload/download is modeled but not wired to Supabase Storage.
- Continuous assessment has schema and seed categories, but the teacher UI is not fully database-backed yet.
- RLS happy paths have been checked for seeded parent and teacher accounts; denial cases still need testing.
- The browser still contains some prototype-only helper interactions marked by text/alerts rather than complete workflows.

## Test Checklist

Before a school pilot, manually verify:

- Parent, teacher, and admin login. Teacher and first parent demo logins are currently verified; admin UI is not built.
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
