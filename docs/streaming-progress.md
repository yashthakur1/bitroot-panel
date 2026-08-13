# Streaming progress — step markers over the existing log stream

Design note for turning the panel's raw log streams into something that reports
*what is happening* and *what broke*, without rewriting the backend.

## Why

Four routes already stream long, multi-phase machine work through `runStream`:

| Route | Phases it runs through |
|---|---|
| `api/projects` | clone → install → build → register port → pm2 start → tunnel |
| `api/static` | clone → build → publish → route |
| `api/system/install` | package installs |
| `api/upgrades` | fetch → build → restart |

All four currently emit an undifferentiated feed. A deploy that spends four
minutes in `npm install` and then fails in `build` looks, from the outside, like
a wall of text that stopped. The operator's real questions — *is it still going*,
*which part is slow*, *what actually failed* — are all unanswerable without
reading every line.

## What this is not

It is **not** for `/setup`. That wizard collects input (domain, Cloudflare token,
password), validates each field against the live service, and finishes in
milliseconds. A progress rail and a log pane around a four-field form is noise.
The pattern here is for work the machine does unattended while the operator
waits.

## The protocol

`runStream` already speaks markers: `[[HB]]` for heartbeats and `[[EXIT:<code>]]`
for completion. Three more cover everything the UI needs, and anything
unrecognised stays ordinary log text.

```
[[STEPS:6]]                              declared once, up front — total phases
[[STEP:2:Install dependencies]]          phase 2 has begun
[[OK:2]]                                 phase 2 finished cleanly
[[FAIL:2:no lockfile, and npm ci needs one]]   phase 2 failed, with the reason
```

Rules:

- `[[STEPS:n]]` is optional. Without it the UI shows a running list rather than
  `2 / 6`, which is the honest rendering when the total is not known in advance.
- A `[[STEP:n:…]]` implicitly closes the previous step as OK, so scripts that only
  announce starts still produce a correct rail.
- The **reason text in `[[FAIL:…]]` is the whole point.** It is written by the
  script, which is the only place that knows what the failure means. The UI must
  never try to infer a cause by pattern-matching log output.
- Markers are emitted on their own line. `runStream` interleaves stdout and
  stderr, so the parser tolerates a marker appearing mid-line and splits around it.

Emitting them from a shell script costs one function:

```sh
step() { printf '[[STEP:%s:%s]]\n' "$1" "$2"; }
fail() { printf '[[FAIL:%s:%s]]\n' "$1" "$2"; exit 1; }
```

## UI

Two panes, following the reference but with four corrections.

**Left — log stream.** Collapsed by default, showing the last line only. Auto-expands
on failure. The operator's question is "is it working", not "show me npm's output";
the logs matter when something breaks, and then they matter completely.

**Right — step rail.** One row per phase: pending / running / done / failed, with
elapsed time per step once finished. `2 / 6` when the total is known.

Corrections to the reference design:

1. **Never truncate failure text.** The reference elides the most important string
   on the screen (`"Mail engine started but these component…"`) and puts the full
   text only in a second panel. Wrap it; let the row grow.
2. **One retry affordance.** The reference offers both a per-step *Retry* and a
   *Retry from step 5* button for the same action.
3. **Show step durations.** Without them you cannot see which phase is slow, which
   is most of the diagnostic value for a deploy.
4. **Keep the invariants visible** — project name, repo, branch, target port —
   in a small panel that does not scroll with the logs.

Retry semantics: resume from the failed step where the underlying script supports
it, and say plainly when it cannot. Re-running a four-minute `npm install` because
`build` failed is the cost of getting this wrong.

## Order of work

1. `lib/steps.ts` — the marker parser, plus a `useStepStream` hook. Pure, testable,
   no UI.
2. `components/step-progress.tsx` — the two-pane view driven by that state.
3. `api/projects` — first conversion. Deploys are watched most and fail most
   informatively.
4. `api/static`, `api/upgrades`, `api/system/install` — same treatment.

Steps 1 and 2 are shared; each route after that is only the `step`/`fail` calls
added to its script.
