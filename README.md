# Student Assessment

A mobile-first application for collaboration between teachers and parents in Kosovo schools. It enables continuous student monitoring, with special attention to children with special needs.

## Core Features

### For Teachers

- Student registry and individual student folder.
- Daily mood and notification from the parent.
- Parent-message inbox with persistent read status and confirmed deletion.
- Database-backed replies to parent messages.
- Grading by subject and chapter.
- Period-aware assessments tied to the student's class school year.
- Final-grade publication with a warning and typed student-name confirmation.
- Private material publishing by class, subject, or selected students.
- Automatic image compression and 90/120-day material retention.
- Learning preferences and support profile.
- Continuous chapter assessment and final grades by academic period.
- Saved email-notification preferences; delivery will be implemented later.
- Live inbox and notification updates through Supabase Realtime without refreshing the page.
- AI pedagogical assistant for immediate classroom situations.

### For Parents

- Switching between children linked to the parent by a school administrator.
- Reporting each child's daily mood and an optional comment to all assigned teachers.
- Reviewing previous mood entries and comments.
- Viewing chapter assessments, teacher comments, averages, and final grades by subject and academic period.
- Viewing and downloading assigned materials, including publication and deletion dates.
- Starting subject-specific conversations with teachers assigned to the selected child.
- Replying to teacher messages, tracking unread conversations, and archiving conversations from the parent's inbox.
- Receiving in-app notifications for assessments, final grades, materials, teacher replies, and other updates.
- Saving each child's learning and communication preferences for teachers to reference.
- Saving parent email-notification preferences; delivery will be implemented later.
- Live message, assessment, material, and notification updates without refreshing the page.

### For School Administrators

- School-scoped administrator login.
- Student creation, editing, class transfer, activation, and deactivation.
- Teacher and parent invitations through a protected Edge Function.
- Invite acceptance and password setup after the user opens the email link.
- Class creation and management.
- Academic period creation, activation, and closure with one active period per school.
- Teacher-to-subject, teacher-to-class, teacher-to-student, and parent-to-student assignments.
- School subject creation, activation, deactivation, and account deactivation.

## Technologies

- HTML, CSS, and JavaScript
- Supabase Auth, Database, Storage, Cron, and Row Level Security (RLS)
- Supabase Edge Functions for the AI assistant, account administration, and material retention
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

These accounts use fictional test data created by `supabase/seed.sql`. Names such as `Ana Demo` and `Driton Demo`, and chapters such as `Numrat dhe veprimet`, are database records rather than hardcoded UI placeholders. Keep this dataset while the parent workflow is under development; replace it with a larger coherent fictional dataset before full manual testing. Never use real children's information in development.

## Supabase

Main migration commands:

```powershell
npm run supabase:login
npm run supabase:link
npm run db:push:dry
npm run db:push
npm run functions:deploy:admin
npm run functions:deploy:retention
```

The schema, migrations, RLS policies, and test data are located in `supabase/`.

The `admin-users` Edge Function requires Supabase's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. Set `ADMIN_INVITE_REDIRECT_URL` as a Supabase Function secret to the deployed frontend URL. Email invitations also require the Supabase Auth Site URL and SMTP settings to be configured for the environment.

Classroom files use the private `class-materials` Storage bucket. Images are resized to a maximum dimension of 1920 pixels and converted to WebP when that reduces their size. PDFs remain unchanged. Stored files are limited to 10 MB each; source images may be up to 25 MB before compression.

Teachers can retain materials for 90 or 120 days. Permanent retention is intentionally unavailable. The `material-retention` Edge Function runs daily through Supabase Cron, creates an in-app warning seven days before expiry, removes expired Storage objects, and then deletes their metadata. Its generated `MATERIAL_RETENTION_CRON_SECRET` is stored in Supabase Function Secrets and Vault, not in this repository.

## Security

- The user's role and school are read from `profiles` in Supabase.
- A parent can read only the data of the child linked to their account.
- Parent-teacher conversations are limited to teachers assigned to the selected child and are stored as shared threads with participant-specific read and archive state.
- Daily mood updates notify every teacher assigned to the child and remain available in the child's mood history.
- A teacher can read and assess only their assigned students and subjects.
- Teachers can add or change assessments only in the active period matching the student's class school year.
- Final grades may be published before every chapter is assessed, but the teacher sees a warning and must type the selected student's full name. The database validates this confirmation.
- Teacher inbox replies, read status, deletion, and notification preferences are persisted in Supabase.
- Realtime subscriptions listen only to RLS-protected `user_notifications` changes and are removed on logout.
- Material recipients are snapshotted at publication, and private files are readable only through authorized short-lived links.
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
- `src/parent/` - parent workspace state, rendering, and interactions
- `src/teacher/` - teacher workspace state, rendering, and interactions
- `src/utils/` - reusable formatting, date, HTML, and notice helpers
- `src/data/` - static subject labels and parent mood options
- `css/styles.css` - CSS entrypoint
- `css/modules/` - ordered CSS modules for base, landing, support, teacher workspace, dashboard, and student folder styles
- `public/assets/` - static images and documents
- `supabase/` - migrations, seed data, Edge Functions, Storage policies, and scheduled retention logic
- `start-localhost.ps1` - local server

## Status

The project is a functional prototype, but it is not yet ready for real school data. The administrator workflow and the main teacher and parent workflows are database-backed, including assessments, materials, mood history, notifications, shared inbox conversations, and saved email preferences. Production email delivery, complete adversarial RLS testing, a refreshed fictional test dataset, and a review of children's data privacy are still required before a pilot.

## Changelog

### 2026-08-14

- Enabled Supabase Realtime for RLS-protected user notifications and connected live parent and teacher inbox refreshes.
- Redesigned the responsive parent workspace with warm desktop and mobile layouts, multi-child switching, progress, materials, messages, notifications, and profile settings.
- Added secure shared parent-teacher conversation threads with replies, read state, participant-specific archiving, and in-app notifications.
- Connected parent mood updates and history to assigned teachers and added parent-managed learning and communication preferences.
- Added parent notifications for new assessments, final grades, materials, and teacher replies.
- Added school academic periods and linked chapter assessments to a required period.
- Added administrator controls for creating, activating, and closing periods.
- Added administrator controls for creating and deactivating school subjects while preserving historical data.
- Added period-aware teacher assessment controls and parent grade queries.
- Connected the teacher inbox to parent messages with secure mark-as-read and delete actions.
- Added database-backed chapter assessments, final grades, inbox replies, and teacher email preferences.
- Replaced the chapter-completion lock with typed student-name confirmation for final grades.
- Added a teacher warning when final grades are published before all chapters are assessed.
- Enforced final-grade student-name confirmation inside the Supabase RPC.
- Removed the unused PIA data model.
- Moved the database connection status from the public role-selection screen to the administrator dashboard.
- Removed the remaining hardcoded demo-student placeholder from the app shell; seeded fictional records remain for development.
- Removed the hidden legacy teacher workspace and its mock scores, learning suggestions, health panels, tasks, and obsolete AI client code.

### 2026-08-13

- Added the school administrator login and database-backed management workspace.
- Added school subject and teacher class relationships with school-isolated RLS.
- Added private classroom material uploads, image compression, recipient-scoped access, and automatic retention cleanup.
- Added secure teacher/parent invitations through the `admin-users` Edge Function.
- Simplified the selected-student Today view around the parent update, teacher mood check-in, and a redesigned parent-notice composer.
- Added step-by-step back and forward navigation across the teacher workflow.
- Added a dedicated student folder dashboard for summary, academics, and support information.
- Connected the teacher and parent demo logins to Supabase.
- Split the code into HTML, CSS, and JavaScript and added migrations/RLS.
- Added the pedagogical assistant through a Supabase Edge Function.
- Redesigned the landing page and the teacher's initial `Sot` view.
- Added the date/time, welcome message, daily list, and student moods from Supabase.
- Improved mobile navigation, contrast, and keyboard accessibility.
- Reorganized the frontend into shell, view, service, utility, data, CSS module, and public asset folders to prepare for the administrator workflow.
