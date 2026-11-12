<p align="center"><img src="web/icon.svg" width="96" alt="PlanLite logo"></p>

# PlanLite Viewer (beta)

**A free Microsoft Project viewer and editor for Linux.** Open an .mpp programme
as a Gantt chart with critical path, baseline comparison and resources, update
it or build a new schedule, then save it as Project XML, print it to PDF or
export it to Excel. No Windows, Wine or Project licence.

## What it does

- Opens **.mpp / .mpt** (Microsoft Project), **Project XML**, .mpx and
  Primavera **.xer** / P6 XML
- **Gantt chart** with task table, summary roll-ups, milestones, progress,
  dependency arrows, weekends and holidays, today line
- **Critical path** highlighting and **baseline** bars with finish variance
- Outline levels, expand/collapse, filters (critical, incomplete, completed,
  milestones, late vs baseline) and search
- **Task details**: slack, constraints, predecessors, successors, notes
- **Resources** view with each resource's assignments
- **PDF / print** on A4, A3, A2, A1 or A0, landscape or portrait
- **Excel** export of tasks, resources and assignments
- Runs locally: your schedules never leave your computer

## Creating and editing

- **New** starts an empty project (name, start date, working days).
- **+ Task / + Milestone**, **Delete**, **Indent / Outdent**, move up and down.
- Double-click a task (or press Enter) to edit name, duration (5d, 2w, 4h),
  start, constraint, % complete, predecessors (5, 7SS+2d, 9FF-1d), resources
  and notes. New resource names are created as you type them.
- Dates downstream **recalculate automatically** on the working calendar, and
  critical path and slack are recomputed. Circular links are refused.
- **Set baseline** stores the current dates as the baseline.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y), 40 steps.
- **Save** (Ctrl+S) writes Microsoft Project XML.

### About saving

PlanLite cannot write .mpp; no free tool can. It saves **Project XML**, which
Microsoft Project opens with File > Open and can save back to .mpp. Data that
PlanLite does not show (costs, custom fields, calendars) is carried over from
the opened file, but view formatting and macros of an .mpp are not part of XML.

### How scheduling behaves

Opening a file never changes its dates. On your first edit PlanLite works out
what it needs to reproduce the saved dates, then moves only what your change
affects. Tasks that have started (% complete above 0) keep their start. It
handles working days, holidays, FS/SS/FF/SF links with lag, and date
constraints. It does **not** do resource levelling, task or resource calendars,
split tasks or effort-driven work, so a schedule that relies on those can come
out differently from Microsoft Project after an edit. Check key dates after
editing such files.

## Install

Any Linux (Bazzite, Fedora, Arch, openSUSE ...), no root needed:

    tar xzf planlite-1.2.0-linux.tar.gz
    cd planlite-1.2.0
    ./install.sh

Ubuntu / Debian / Mint: `sudo apt install ./planlite_1.2.0_all.deb`

Start it from the application menu ("PlanLite Viewer"), with "Open With" on a
project file, or from a terminal: `planlite programme.mpp`.
Remove it with `./install.sh --uninstall`.

Requirements: Python 3.6+. PlanLite opens in its own small native window when
the system has GTK with WebKitGTK and PyGObject (standard on GNOME desktops,
including Bazzite GNOME). Otherwise it uses a Chromium-family browser in app
mode (Chrome, Chromium, Brave, Edge, Vivaldi; native or Flatpak), then Firefox
or your default browser. `planlite --browser` forces the browser. In the native
window, saved and exported files go to your Downloads folder.
It talks only to a private service on 127.0.0.1.

## .mpp support (one-time setup)

Project XML opens straight away. .mpp is a closed Microsoft format, so PlanLite
reads it with the open-source **MPXJ** library, which needs Java. Open any .mpp
and click **Set up MPP support** (or run `planlite --setup-mpp`). PlanLite then
downloads into ~/.local/share/planlite/engine:

- the MPXJ library, from pypi.org (LGPL)
- a Java runtime (Eclipse Temurin 21, from adoptium.net), only if no Java 11+
  is already installed

About 60-100 MB, needed once. Password-protected files cannot be opened.

Command line: `planlite programme.mpp --to-xml programme.xml` converts a file
to Project XML.

## Using it

- Scroll to move; Ctrl + mouse wheel or + / - to zoom the timescale; F fits the
  whole project; T jumps to today.
- Click a task for details; double-click to bring its bar into view.
- "Baseline" adds baseline bars and variance columns (scroll the table right).
- PDF / Print prints the tasks currently shown. In the print window choose
  "Save as PDF".

## Known limits (beta)

Saves Project XML only, not .mpp. Shows baseline 0 only. Holidays and working hours cannot be edited yet. No resource usage histogram, cost tables or
custom fields. Task calendars and split tasks are drawn as plain bars. PDF
pages are high-resolution images, not vector. The code was written with AI
assistance; please report files that open wrongly.

## Licence

MIT. MPXJ and the Java runtime are separate open-source software downloaded by
the user under their own licences.
