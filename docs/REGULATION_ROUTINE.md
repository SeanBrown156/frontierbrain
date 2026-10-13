# Regulation routine (runbook)

The routine decides which regulation the app calls **current**. It checks the official Champions news source, confirms a changeover happened, switches the label, looks for the next regulation's dates and schedules its own next check. It changes `knowledge/regulations/` only. It never rewrites teams, replays, benchmarks or any player data: a team built for M-C stays an M-C team.

Code: `tools/regulation.ts` (index, records, validators), `tools/regulation-routine.ts` (the pure `runRegulationRoutine` plus the CLI wrapper), `tools/format.ts` (`regulationStatus`, primer). Workflow: `.github/workflows/regulation-routine.yml`. Tests: `tools/tests/regulation-routine.test.ts` (fake clock, injected fetch, fixtures in `tools/tests/fixtures/regulation/`).

## Files

| File | What |
|---|---|
| `knowledge/regulations/index.json` | `active`, `next` (id or null), `nextCheckAt`, `lastCheckedAt`, `history[]` (every switch with evidence), `lastError`, `errorStreak`, `issuesRequested` (issue keys already raised), optional `sources.official[]` / `sources.secondary[]` (extra pages to read). |
| `knowledge/regulations/<id>.json` | One record per regulation: `startsAt`, `endsAt`, `officialURL`, `status` (`active`/`upcoming`/`ended`/`draft`), `confidence` (`official`/`secondary`), `engine.verified`, rules. |
| `knowledge/regulations/notices.json` | `{notices:[{id,at,kind:'regulation',level:'info'|'warning',title,body,url?}]}`, newest 50. The Inbox reads this; keep the schema. |

Reads go through the data channels (data directory, shared rows, repository), so the hosted site picks up a switch from the seeded rows without a deploy.

## What a run does

1. **Due check.** If `now < index.nextCheckAt` it exits at once (no network). The workflow is daily; most runs do nothing.
2. **Upkeep.** A confirmed next regulation's official page is re-read, and so is the active record's page; if the official page states different dates the record is corrected (the M-B end date moved in practice) and a notice is written.
3. **Discovery** (no next, or only a draft). It reads the Champions news listing (`<news origin>/en/json/list.json`, found from the active record's `officialURL`), fetches articles titled `Regulation Set X-Y` that sort after the active one or were published after it started, and parses `Wednesday, December 2, 2026, at 02:00 UTC` style timestamps.
   - Both dates on an official host: `next` = `upcoming`/`official`.
   - Partial, or on a non-official host: `next` = `draft`/`secondary` and an issue request. A draft never becomes current.
4. **Changeover.** If the active regulation's `endsAt` has passed, or the next record's `startsAt` has, **and** the next record is `upcoming`/`official`: re-fetch its official page, require it still states the dates and that `now >= startsAt`, then switch (`index.active`, old record `ended`, new `active`, a `history` entry, a notice). Otherwise it does not switch, opens an issue request and writes a "has ended, next unconfirmed" notice.
5. **After a switch** it immediately runs discovery for the following regulation.
6. **Reschedule.** `nextCheckAt` is the earliest of: the next start (re-read at least every 14 days, since dates move), the active end while no next is known (weekly inside 60 days, then the end itself), otherwise now + 30 days. After the active regulation has ended with no confirmed successor it checks daily. A drafted next is re-checked weekly. It is never in the past.
7. **Failure.** A fetch error is stored in `index.lastError`, the switch is not made, and the run retries tomorrow. Three failed runs in a row open an issue. A failure is never read as "nothing changed".

After a switch the engine is still the pinned M-C engine. The new record has `engine.verified: false`, so the status, primer and banner say "legality data for X is not verified yet". Verifying is a separate step (update the pin, check the legal list, set `engine.verified` true with a note).

## Running it by hand

```sh
npm run vgc -- regulation-check --dry-run          # prints actions, notices, issues, what it would write
npm run vgc -- regulation-check --force            # ignore nextCheckAt (still never switches on unofficial evidence)
npm run vgc -- regulation-check --out result.json  # JSON summary to a file (the workflow reads this)
```

With `APP_DATA` set, files are read from the data directory first and written there. In the workflow `APP_DATA` is unset and the repository is the data root. To run the workflow now: Actions, Regulation routine, Run workflow (tick "force" to ignore the schedule).

Seed the hosted site by hand: `node tools/hosted-seed.ts --only knowledge/regulations/` (needs `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).

## Confirming or correcting a draft

An issue titled "Confirm Regulation X (unconfirmed announcement)" or "... ended; X is unconfirmed" means the routine could not confirm the successor from an official page.

1. Open the official announcement (Champions news, "Regulations" category) and read the start and end timestamps.
2. Edit `knowledge/regulations/<x>.json`: set `officialURL`, `startsAt`, `endsAt` (ISO UTC, e.g. `2026-12-02T02:00:00Z`), `status: "upcoming"`, `confidence: "official"`, and add the page to `evidence`.
3. Make sure `knowledge/regulations/index.json` has `"next": "<X>"`. Leave `active` alone: the routine switches it at the start time after re-verifying the page. To bring the check forward, set `nextCheckAt` to a time that has passed, or run `regulation-check --force`.
4. Run `npm test` (the validator enforces one active record, ISO dates, `startsAt < endsAt`, and official confidence for upcoming), commit to main, and seed (the workflow does this on its next run).

If the dates are wrong, correct the record's dates the same way. The next run re-reads the official page and overwrites dates only from an official host.

To **undo a wrong switch**: set `index.active` back, record `status` `active`/`ended` accordingly, remove the history entry and the notice id, and set `nextCheckAt` in the future. The routine cannot see a mistake it believes is right, so check the official page first.

## If a source changes shape

Symptoms: `lastError` set, `errorStreak` growing, an issue "cannot reach its sources", or an "unverified" issue because the official page no longer states dates the parser recognises.

- The listing: `https://champions-news.pokemon-home.com/en/json/list.json` returns `{data:[{id,title,link,kindTxt,pubAt,...}]}`; the site's own `list_cm.js` reads it. `listingRegulations` falls back to anchors in HTML. If both fail, discovery finds nothing (it does not guess).
- Article wording: `parseAnnouncements` looks for `Regulation (Set) X-Y` and `Month D, YYYY, at HH:MM UTC`. Update `TIMESTAMP`/`REGULATION` in `tools/regulation-routine.ts`, add a fixture under `tools/tests/fixtures/regulation/` with the new wording, and a test.
- A different host: add it under `index.sources.official` (a page to read) and, if it is a new official domain, to `DEFAULT_OFFICIAL_HOSTS`. Third-party sites go under `sources.secondary`; they can only create drafts.
- Meanwhile set the dates by hand as above. The routine keeps working around the manual record.

## Limits

- The parser has been tested against the real M-C page and listing (retrieved 2026-10-13) and invented successor pages. It has not seen a real successor announcement.
- Events can use a different regulation from the ladder (the 2027 Indonesia PBL used M-B after M-C started). The routine tracks the ladder regulation only.
- The routine switches a label. Per-regulation data partitioning, engine binding and revalidation are later phases of issue #32.
