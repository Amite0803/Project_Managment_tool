# NSDI Geoportal Planner

A browser-based task and timeline manager for the NSDI & Geoportal project. It needs no install, no server and no account. Open `index.html`, or use the GitHub Pages link.

Seed data: `NSDI_Geoportal_Task_Breakdown_V11_01112026.xlsx`.

## Tabs

| Tab | What it does |
|---|---|
| Executive Summary | Headline, KPIs, stage timeline, main tasks by stage, categories, owners, coming up, needs attention |
| WBS | Collapsible task tree with click-to-edit cells, filters and search; add sub-tasks and milestones |
| Gantt | Drag to move or resize, drag to link, FS/SS/FF/SF dependencies with lag, milestones, baseline, critical path, zoom |
| Milestones | Milestone list with countdown, baseline variance and add/complete actions |
| Board | Kanban by status with drag and drop |
| Workload | Open tasks per owner, role or participant, by month or quarter |
| Risks & Issues | Risk, issue, action and decision log with scoring |
| Plan Health | Automatic checks: overdue, conflicts, duplicates, missing owners, past project end |
| Settings | Project details, holidays, auto-scheduling, baseline, reset, activity log |

Also included: undo/redo, autosave, Excel import and export, project files, print to PDF, and light and dark themes.

## Saving and sharing

- Edits save in the browser you made them in. Other people do not see them automatically.
- **To update everyone:** use *File › Save project file*, rename the file `project.json`, and upload it to the root of this repository. Visitors are prompted to load the newer plan.
- **To send one person a copy:** send the project file or the Excel export.

## How the plan is calculated

- Workdays are Monday to Friday, matching Excel `WORKDAY`. Holidays can be added in Settings.
- Summary rows roll up from their sub-tasks: dates, progress and status. They can differ from the values typed in the workbook; Plan Health lists every difference.
- Workbook entries where a task depends on its own parent (for example `1.1.1 (SS)` on `1.1.1.1`) are treated as part of the hierarchy, not as links.
- Moving a task pushes dependent tasks later when needed. It does not pull them earlier.
- The workbook has no progress column, so starting progress is estimated from status: Not started 0%, Ongoing 50%, Review and QA 90%, Done 100%.
- Milestones are seeded from zero-duration tasks and from names containing sign-off, final approval, kickoff or acceptance certificate.
- Critical path shows the chain of dependencies driving the finish of the selected task. It is not a full float calculation.

## Files

`index.html`, `app.css`, `app.js`, `data.js` (seed data), `lib/xlsx.full.min.js` (SheetJS, for Excel).
