# NSDI Geoportal Planner

A browser-based task and timeline manager for the NSDI & Geoportal project. It needs no install. Use the GitHub Pages link. Viewing needs no account; editors sign in with an email and password.

Seed data: `NSDI_Geoportal_Task_Breakdown_V11_01112026.xlsx`.

## Tabs

| Tab | What it does |
|---|---|
| Executive Summary | Headline, KPIs, stage timeline, main tasks by stage, categories, owners, coming up, needs attention |
| WBS | Collapsible task tree with click-to-edit cells, filters and search; reorder with ▲▼; add sub-tasks and milestones |
| Gantt | Drag to move or resize, drag to link, FS/SS/FF/SF dependencies with lag, milestones, baseline, critical path, zoom; reorder with ▲▼; bars labelled with the assigned role |
| Milestones | Milestone list with countdown, baseline variance and add/complete actions |
| Board | Kanban by status with drag and drop |
| Resources | Teams, roles and people that fill the owner, role and participant dropdowns; add, rename, merge or delete |
| Workload | Open tasks by owner and by assigned role within each owner, or by participant, by month or quarter |
| Risks & Issues | Risk, issue, action and decision log with scoring |
| Plan Health | Automatic checks: overdue, conflicts, duplicates, missing owners, past project end |
| Settings | Project details, holidays, auto-scheduling, baseline, reset, activity log |

Also included: undo/redo, autosave, Excel import and export, project files, print to PDF, and light and dark themes.

## Saving and sharing

The plan lives in a Firebase Firestore database, and the tool itself is hosted on GitHub Pages.

- **Viewing:** anyone with the link can view the plan. No account is needed.
- **Editing:** changes save automatically and reach everyone within seconds.
- **Two people at once:** changes to different fields are all kept, even on the same task. If two people change the same field, the last change wins.
- **Undo:** undo history is cleared when someone else's change arrives, so an undo cannot overwrite newer work.
- **Backups:** the free Firebase plan has no automatic backups. Use *File › Save project file* regularly. To restore, use *File › Open project file*, which replaces the shared plan for everyone.
- **To send someone a copy:** send the project file or the Excel export.

### Adding an editor

1. **Owner:** click your name at the top, enter the editor's email and click *Add editor*.
2. **Editor:** open the link, click *Sign in to edit*, then *Create an account* with that same email.
3. **Editor:** click the link in the confirmation email, then *I've confirmed it*.

Editors stay signed in on that browser. To remove someone, the owner clicks *Remove* next to their email.

### Privacy and setup

- The activity log shows the part of each editor's email before the @, and anyone with the link can read it. Full addresses on the editors list are visible only to the owner; each editor can check only their own.
- `app.js` holds the Firebase web config. It identifies the project and is not a secret. `firestore.rules` holds the access rules; paste it into *Firestore Database › Rules* in the Firebase console, with `OWNER_EMAIL` replaced by the owner's address.
- The original workbook data (`data.js`) stays public in this repository.
- If the database cannot be reached, for example if the Firebase scripts are blocked, the tool falls back to the copy in that browser.

## How the plan is calculated

- Workdays are Monday to Friday, matching Excel `WORKDAY`. Holidays can be added in Settings.
- Summary rows roll up from their sub-tasks: dates, progress and status. They can differ from the values typed in the workbook; Plan Health lists every difference.
- Workbook entries where a task depends on its own parent (for example `1.1.1 (SS)` on `1.1.1.1`) are treated as part of the hierarchy, not as links.
- A task with a predecessor starts on the date its links require: FS the next workday after the predecessor finishes, SS with it, FF and SF so it finishes on time, plus the lag in workdays. With several links, the latest date applies.
- When a task changes, the tasks that follow it move too, earlier or later. To delay a linked task, edit the lag; a start date typed by hand goes back to the required date.
- A parent's links hold for its sub-tasks: sub-tasks without links of their own move with the parent as a block and cannot start before the date the parent's links require.
- Dates only move when a task or its predecessor changes. *Plan Health › Apply dependencies to all tasks* applies the rule to the whole plan at once.
- Settings has the project start and end dates and an option that blocks edits taking a task past the end. Tasks already past the end stay where they are and are listed in Plan Health. The limit rejects the whole edit, including tasks it would push.
- Turn off "Schedule tasks from their dependencies" in Settings to set linked dates by hand.
- The workbook has no progress column, so starting progress is estimated from status: Not started 0%, Ongoing 50%, Review and QA 90%, Done 100%.
- Milestones are seeded from zero-duration tasks and from names containing sign-off, final approval, kickoff or acceptance certificate.
- Moving a task up or down swaps it with the neighbouring task under the same parent. The two trade WBS codes, including their sub-tasks; links and dates do not change. So codes can differ from the workbook after a move.
- Gantt labels show the assigned role. Tasks with no role show the task owner in italics.
- Critical path shows the chain of dependencies driving the finish of the selected task. It is not a full float calculation.

## Files

`index.html`, `app.css`, `app.js`, `firestore.rules` (database access rules), `data.js` (seed data), `lib/xlsx.full.min.js` (SheetJS, for Excel).
