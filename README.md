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

### For School Administrators

- School-scoped administrator login.
- Student creation, editing, class transfer, activation, and deactivation.
- Teacher and parent invitations through a protected Edge Function.
- Invite acceptance and password setup after the user opens the email link.
- Class creation and management.
- Teacher-to-subject, teacher-to-class, teacher-to-student, and parent-to-student assignments.
- School subject activation and account deactivation.

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
| Administrator | `admin.demo@mesimi.test` | `DemoPilot123!` |
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
npm run functions:deploy:admin
```

The schema, migrations, RLS policies, and test data are located in `supabase/`.

The `admin-users` Edge Function requires Supabase's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. Set `ADMIN_INVITE_REDIRECT_URL` as a Supabase Function secret to the deployed frontend URL. Email invitations also require the Supabase Auth Site URL and SMTP settings to be configured for the environment.

## Security

- The user's role and school are read from `profiles` in Supabase.
- A parent can read only the data of the child linked to their account.
- A teacher can read and assess only their assigned students and subjects.
- An administrator can manage only profiles, students, classes, subjects, and assignments belonging to their own school.
- Auth invitations use the service role only inside the `admin-users` Edge Function; the service-role key is never sent to the browser.
- Access-denial cases between users must also be tested before the pilot.

## Project Structure

- `index.html` - lightweight document shell
- `src/views/app-shell.html` - main teacher, parent, login, and role-gate markup
- `src/main.js` - loads the app shell and starts the browser app
- `src/app.js` - screen behavior and UI state
- `src/lib/` - shared browser clients, including Supabase
- `src/services/` - Supabase data access grouped by workflow
- `src/admin/` - administrator authentication, rendering, and school-management behavior
- `src/utils/` - reusable formatting, date, HTML, and notice helpers
- `src/data/` - temporary prototype constants and static labels
- `css/styles.css` - CSS entrypoint
- `css/modules/` - ordered CSS modules for base, landing, support, teacher workspace, dashboard, and student folder styles
- `public/assets/` - static images and documents
- `supabase/` - migrations, seed data, and AI function
- `start-localhost.ps1` - local server

## Status

The project is a functional prototype, but it is not yet ready for real school data. The administrator workflow is implemented. Before the pilot, PIA storage, complete adversarial RLS testing, production email delivery, and a review of children's data privacy must be completed.

## Changelog

### 2026-08-13

- Added the school administrator login and database-backed management workspace.
- Added school subject and teacher class relationships with school-isolated RLS.
- Added secure teacher/parent invitations through the `admin-users` Edge Function.
- Simplified the selected-student Today view around the parent update, teacher mood check-in, and a redesigned parent-notice composer.
- Added step-by-step back and forward navigation across the teacher workflow.
- Added a dedicated student folder dashboard with four accessible routes for the summary, academics and grades, PIA, and health history.
- Connected the teacher and parent demo logins to Supabase.
- Split the code into HTML, CSS, and JavaScript and added migrations/RLS.
- Added the pedagogical assistant through a Supabase Edge Function.
- Redesigned the landing page and the teacher's initial `Sot` view.
- Added the date/time, welcome message, daily list, and student moods from Supabase.
- Improved mobile navigation, contrast, and keyboard accessibility.
- Reorganized the frontend into shell, view, service, utility, data, CSS module, and public asset folders to prepare for the administrator workflow.
