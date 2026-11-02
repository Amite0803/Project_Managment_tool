# NSDI Geoportal Planner

A browser-based task and timeline manager for the NSDI & Geoportal project. It needs no install and no server. Open `index.html`, or use the GitHub Pages link. Viewing needs no account; saving to the shared plan needs a GitHub account with write access.

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

- Edits save automatically in the browser you made them in. Other people do not see them until you save to GitHub.
- **To update everyone:** click **☁ Save to GitHub**. This writes the plan to `project.json` in this repository, and GitHub keeps every earlier version.
- **To get the latest plan:** open or reload the tool. It loads automatically if you have no unsaved changes; otherwise a banner lets you load it or keep your copy. It does not update while the page is open.
- **If someone saved first:** your save is blocked so their work is not overwritten. Download your copy if you want it for reference, load the newer plan, redo your changes and save again.
- **To send one person a copy:** send the project file or the Excel export.

### Setting up an editor

Anyone can view the plan. To save, each editor connects once in each browser:

1. **Repository owner:** add the editor under *Settings › Collaborators*. The editor accepts the invitation.
2. **Create a token.** The tool's *Save to GitHub* dialog links to the right page:
   - Owner: a fine-grained token limited to this repository, with Contents set to read and write.
   - Collaborator: a classic token with only the `public_repo` scope, because GitHub does not support fine-grained tokens for collaborators. This token can write to every public repository the collaborator's account can write to.
3. **Paste the token** into the dialog. It stays in that browser and is never included in the plan or in exports. On a shared computer, untick "Remember it" so it is dropped when the page closes. Use *Disconnect* in the dialog to remove a remembered token.

## How the plan is calculated

- Workdays are Monday to Friday, matching Excel `WORKDAY`. Holidays can be added in Settings.
- Summary rows roll up from their sub-tasks: dates, progress and status. They can differ from the values typed in the workbook; Plan Health lists every difference.
- Workbook entries where a task depends on its own parent (for example `1.1.1 (SS)` on `1.1.1.1`) are treated as part of the hierarchy, not as links.
- Moving a task pushes dependent tasks later when needed. It does not pull them earlier.
- The workbook has no progress column, so starting progress is estimated from status: Not started 0%, Ongoing 50%, Review and QA 90%, Done 100%.
- Milestones are seeded from zero-duration tasks and from names containing sign-off, final approval, kickoff or acceptance certificate.
- Moving a task up or down swaps it with the neighbouring task under the same parent. The two trade WBS codes, including their sub-tasks; links and dates do not change. So codes can differ from the workbook after a move.
- Gantt labels show the assigned role. Tasks with no role show the task owner in italics.
- Critical path shows the chain of dependencies driving the finish of the selected task. It is not a full float calculation.

## Files

`index.html`, `app.css`, `app.js`, `data.js` (seed data), `lib/xlsx.full.min.js` (SheetJS, for Excel).
