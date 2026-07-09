# FreeBird Recon Tracker — Deployment Handoff

**Prepared for:** FreeBird Auto (Phoenix, AZ)
**Owner:** Chelsa (Office Manager / Marketing Lead)
**Goal:** Take the working prototype (`freebird-recon-tracker.jsx`) from Claude artifact hosting to a standalone web app at its own URL, installable on the team's phones, with a real database and push notifications.

---

## 1. What this app is

An internal recon management app for a small used-car dealership. It tracks every vehicle from auction check-in to front line, with an inspection workflow, a repair approval gate, parts tracking, real-time labor clocking, fixed-fee checklist items, a Master Tech sign-off before photos, and a tech scheduling calendar.

**Users (6, no roles system — identity is pick-your-name):**
- Chelsa — office manager, runs the app
- Jerry — owner, approves repair spend
- Oscar — sales
- Mark — technician (8 hr/day labor cap)
- Dan — Master Technician (4 hr/day labor cap; required sign-off before Photos)
- Kansas — detailer (8 hr/day cap)

**Brand:** Navy `#0D2440`, Sky Blue `#3B8CDE`, White. Headings in Montserrat, body in Open Sans.

---

## 2. Feature inventory (all built and working in the prototype)

### Pipeline board
- Stages in order: **Intake → Inspection → Approval → Parts → Mechanical → Detail → Photos → Front Line**
- Vehicles move forward one stage at a time or jump to any stage (forward/backward) via stage pills
- **Gate:** moving to Photos or Front Line is blocked until Dan's final sign-off exists
- Auto-advance: submitting an inspection moves the vehicle to Approval (if fails) or Parts (if clean)
- Board cards show: year/make/model, stock #, VIN tail, miles, progress bar, days in recon, running recon cost, pending-approval count

### Vehicle check-in / edit
- Fields: year, make, model, stock #, VIN, miles, purchase price, intake notes
- Duplicate stock # blocked at entry
- Edit form for corrections (spelling, wrong year, etc.); meaningful changes are logged to the activity feed with before → after

### Inspection (in-app form)
- ~30 items across 6 sections: Road Test, Under Hood, Tires & Brakes, Exterior, Interior, Safety & Compliance
- Each item: Pass / Fail / N/A
- Each **Fail** captures: what's wrong (note), estimated parts $, estimated labor $
- On submit: every fail becomes a **repair line** with status `pending`, and the inspection report (counts + failed items) attaches to the vehicle

### Approval workflow
- All repair lines (from inspection fails, manual "Add line," or supplements) start as `pending`
- Approvals queue view shows all pending lines across the lot with estimated totals; approve/decline per line, decision-maker and timestamp recorded
- Declined lines are excluded from all cost totals and shown struck-through
- "**+ Request add'l**" on any approved line creates a supplemental line (pre-titled "Additional: {job}") that goes through approval separately
- Labor estimates are editable after the fact, with a full audit trail: every edit stores who / date-time / from → to, and the latest edit is displayed on the line

### Parts tracking (per approved line)
- Status: none → **ordered** → **arrived** (checkbox, with arrival date stamped; can be unchecked)
- Fields when ordered: **final price $** (overrides the estimate in all totals) and **ordered from** (vendor, e.g., AutoZone / O'Reilly)
- Dashboard rolls parts up per vehicle in three groups: Needs ordering / Ordered / Arrived, each with counts and $ subtotals

### Real-time labor clock
- Clocking in **requires choosing the specific approved job** ("What failure are you working on?")
- One open clock per person per line; clock-out saves the entry (who, start, end, duration)
- Live view: running timer on the line, "{tech} on it · 47m" badges for others, "● MARK NOW" tags on the dashboard
- **Labor dollars tally automatically:** logged hours × shop labor rate (a global setting, default $100/hr). A manually entered "final labor $" overrides the tally; with no logs and no final, the estimate is used
- Labor Hours report page: every entry across the lot, filters for time period (today / 7 days / 30 days / all), vehicle, and technician, with total hours, billed value, and per-tech breakdown

### Fixed-fee checklist ("Final checks" per vehicle)
| Item | Effect when checked |
|---|---|
| Detail complete | Adds **$150.00** detail fee to recon total; records who/date |
| Passed emissions | Adds **$16.15** emissions fee; records date passed + who brought it (team dropdown) |
| Oil changed | Adds **$79.99**; records oil change date; triggers a persistent windshield-sticker reminder that only clears when "Sticker placed & monitor reset" is checked, which records the sticker date |

All three are reversible (unchecking removes the fee) and all changes fire notifications.

### Finalize Recon (cost sheet + required sign-off)
- Full sheet per vehicle: every line item with per-tech hours ("Mark 2h 10m · Dan 45m"), parts $ + vendor, labor $, line total; fee line items; totals block (parts / labor with hours / fees / **Total recon** / purchase price / Total in)
- Pending-approval lines flagged; declined lines listed as excluded
- **Sign-off:** only Dan, signed in as Dan, typing "Dan," can sign. Signing stamps date/time, notifies with the final total, and moves the vehicle to Photos. The Photos/Front Line gate enforces this

### Scheduler
- Day calendar, **7 AM – 3 PM**, three columns: **Dan, Mark, Kansas**; prev/next day navigation
- Unscheduled approved jobs shown as chips sized in hours: `max(1, round(est labor $ ÷ shop rate))`, capped at 8
- Tap a chip, tap an open slot → job blocks out its hours for that tech; overlaps and jobs that run past 3 PM are rejected with a message
- Column headers tally scheduled hours vs. daily caps (Dan 4 / Mark 8 / Kansas 8) and flag OVER CAP in red
- Scheduled blocks link to the vehicle; "remove" returns the job to the to-schedule list

### Notifications & activity
- In-app notification feed (bell + unread badge, per-user read marker) for: vehicle added, stage moves (incl. backward), inspections, approval requests/decisions, parts ordered/arrived, clock in/out, fee checkboxes, estimate edits, sign-offs, removals
- Per-vehicle activity feed (last 15 events)
- **Deployment upgrade target:** convert these to real web push notifications

### Dashboard
- One expanded card per vehicle: identity + stage badge, final-check chips (incl. "Oil ✓ — STICKER NEEDED" warning), inspection report with failed items, parts rollup, all work lines with $ and status badges, live "NOW" labor tags, and Awaiting Approval / Approved Work totals

### App-level
- Error boundary + persistent dismissible error banner (no flash-and-vanish errors)
- Storage fallback chain with a visible banner when team sync is unavailable
- Double-tap protection on check-in; duplicate stock guard

---

## 3. Data model

Single JSON document today; below is the same model normalized for a real database.

### Vehicle
```
id, stock (unique), year, make, model, vin, miles, buyPrice, notes,
stage (enum: intake|inspection|approval|parts|mechanical|detail|photos|frontline),
addedTs, addedBy,
inspection: { by, ts, results: { "<Section>||<Item>": { status: pass|fail|na } } },
detailDone (bool), detailTs, detailBy,
emPassed (bool), emDate (YYYY-MM-DD), emBy,
oilDone (bool), oilDate, oilSticker (bool), oilStickerDate,
finalSign: { by: "Dan", ts } | null
```

### Repair line (child of vehicle)
```
id, desc, note, source (inspection|manual),
status (pending|approved|declined), addedBy, ts, decidedBy, decidedTs,
estParts, estLabor, actualLabor (manual final labor $),
estEdits: [ { by, ts, from, to } ],           // labor estimate audit trail
partsStatus (none|ordered|arrived), partsTs, partsFinal, partsVendor,
laborLogs: [ { id, by, start, end|null } ],    // null end = clocked in now
sched: { tech, date (YYYY-MM-DD), start (hour 7–14), hours } | null
```

### Global settings
```
laborRate (default 100)
```

### Notification
```
id, ts, text, vehicleId|null, type (stage|approval|approved|declined|info), by
```

### Cost rules (single source of truth)
- Line parts $ = `partsFinal` if set, else `estParts`
- Line labor $ = `actualLabor` if set, else `(sum of laborLogs ms ÷ 1hr) × laborRate` if any logs, else `estLabor`
- Declined lines contribute $0
- Vehicle recon total = Σ(line parts + line labor) + $150 if detailDone + $16.15 if emPassed + $79.99 if oilDone
- Total in = purchase price + recon total

---

## 4. Suggested Airtable base (if using Airtable as the backend)

**Table: Vehicles** — one row per vehicle; fields per the Vehicle model above (checkboxes for the three fee flags, single-select for stage, date fields for emDate/oilDate/oilStickerDate, "Final Sign TS" datetime).

**Table: Repair Lines** — one row per line, linked to Vehicles; single-selects for status and partsStatus; currency fields for estimates/finals; "Scheduled Tech" single-select + "Scheduled Date" + "Start Hour" + "Hours" for the calendar.

**Table: Labor Logs** — one row per clock session, linked to Repair Lines; Tech single-select, Start/End datetimes; formula field for duration; a rollup on Repair Lines gives total hours.

**Table: Estimate Edits** — one row per edit, linked to Repair Lines (who/when/from/to).

**Table: Activity** — the notification feed (timestamp, text, type, linked vehicle, by).

**Table: Settings** — one row: laborRate.

Alternative: **Supabase** (Postgres) mirrors the same tables and adds realtime subscriptions, which makes the live clock badges and shared board update instantly without a refresh button — worth considering over Airtable if push/live updates are the priority.

---

## 5. Deployment steps

1. **Scaffold:** `npm create vite@latest freebird-recon -- --template react`, add Tailwind CSS and `lucide-react`. Drop `freebird-recon-tracker.jsx` in as `App.jsx`.
2. **Replace storage:** the prototype persists everything through `window.storage.get/set` (keys `freebird-recon-v1`, `freebird-recon-me`) via three small functions — `initStorage()`, `persist()`, and `tryRead()`. Swap these for the backend of choice (Airtable REST API or Supabase client). Everything else reads from local state and needs no change. Keep the write-through pattern: update local state first, sync in the background.
3. **Auth:** keep pick-your-name for launch (a 6-person shop doesn't need passwords day one), or add a simple PIN per person. Supabase Auth is the upgrade path if real logins are wanted later.
4. **PWA:** add a manifest (name "FreeBird Recon," navy theme color, icon) and a service worker so Add to Home Screen installs a real full-screen app. Vite plugin: `vite-plugin-pwa`.
5. **Push notifications:** Web Push via the service worker. Trigger on: approval requested (→ Jerry), approved/declined (→ requester), parts arrived (→ Mark, Dan), sign-off needed / completed (→ Dan / Chelsa). Supabase Edge Functions or a small serverless function can send these.
6. **Host:** push to GitHub, import to **Vercel** (free tier is fine). Optionally point `recon.freebirdauto.com` at it via a CNAME.
7. **Migrate data:** the prototype's storage is one JSON blob — export it (ask Claude for a JSON dump from the artifact) and import into the new tables.

**Nice-to-haves once deployed:** PDF export of the Finalize sheet for the dealer jacket; photo uploads per vehicle/line; per-tech labor rates (Master Tech vs. standard); auto-refresh/realtime board; CSV export of the labor report.

---

## 6. How to run this with Claude Code

Open Claude Code in the project folder with `freebird-recon-tracker.jsx` and this document, and prompt:

> "Read freebird-recon-deployment-handoff.md and freebird-recon-tracker.jsx. Scaffold a Vite + React + Tailwind PWA from the .jsx, replace the window.storage layer with [Airtable/Supabase] per section 5, keep all business rules in section 3 exactly as written, and get it deploy-ready for Vercel. Ask me for API keys when you need them."

Work through it feature-by-feature and test the approval gate, the labor tally math, and Dan's sign-off gate against section 3 before going live — those three rules carry the money and the process.
