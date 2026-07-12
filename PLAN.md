# Phase 2 Plan

## Scope

Implement only ROADMAP Phase 2:

- Navigation mark parsing for repeat and jump symbols
- Pure domain RepeatExpander with warnings and loop protection
- PerformanceMeasure-based playback order
- Pure domain PlaybackTimeline with injected clock
- Viewer playback UI for BPM, count-in, play/pause/resume/stop, previous/next performance measure
- Highlight and scroll driven by PerformanceMeasure sourceMeasureId
- IndexedDB persistence for playback-related viewer state
- Phase 2 unit tests and Playwright coverage on top of real Verovio rendering

## Out of Scope

- OMR
- Backend or WebSocket sync
- Score editing
- Canvas annotation
- Mid-score tempo changes
- Real audio/metronome engine
- Phase 3 and later features

## Implementation Order

1. Expand `packages/score-domain` with navigation, performance-order, and playback types.
2. Extend the MusicXML parser with duration and navigation mark extraction.
3. Implement and test `RepeatExpander` as a pure domain state machine.
4. Implement and test `PlaybackTimeline` with an injected monotonic clock.
5. Add Phase 2 sample fixtures for repeat and navigation flows.
6. Integrate playback order, warnings, and timeline controls into the viewer.
7. Persist playback-related viewer state in IndexedDB without auto-resuming playback.
8. Add Playwright coverage using a controllable injected clock while keeping the same production timeline logic.
9. Run build, unit tests, E2E, markdown link verification, and a Phase 2 acceptance self-check.

## Decisions

### Domain Placement

Put repeat expansion and playback timeline logic in `packages/score-domain`.

Reason: Phase 2 rules must stay renderer-independent, UI-independent, and reusable by future backend or native clients.

Impact: The viewer consumes derived playback data instead of embedding a repeat state machine in React state.

Alternative: Keep the logic in `web-app/src/domain`. Rejected because the roadmap and domain model expect cross-platform domain reuse.

### PerformanceMeasure Model

Represent the actual playback order as `PerformanceMeasure[]` that reference source measures by ID.

Reason: Repeated measures must be distinguishable without duplicating source `Measure` objects.

Impact: UI, playback, and future sync can use `performanceMeasureId` while still mapping back to source measures for Verovio highlight and scroll.

Alternative: Duplicate `Measure` objects per occurrence. Rejected because it blurs source structure and playback structure.

### Repeat Expansion Strategy

Use a pure state machine with explicit guards:

- max transition count
- max output length
- repeated navigation state detection
- single-use D.C. / D.S. / Coda jumps

Reason: Loop prevention must come from deterministic domain rules, not from timeouts in UI tests or rendering code.

Impact: Unsupported or malformed navigation produces warnings and the safest partial result available.

Alternative: Recursive traversal with ad hoc counters. Rejected because it is harder to inspect, test, and keep loop-safe.

### Playback Clock

Use an injected `PlaybackClock` with `performance.now()` in production and a controllable manual clock in tests.

Reason: The timeline must compute position from monotonic elapsed time and remain testable without sleeping.

Impact: Visibility recovery and timer throttling are handled by recomputing from elapsed time instead of trusting timer tick counts.

Alternative: Interval-driven state progression only. Rejected because it is brittle in background tabs and produces flaky E2E behavior.

### Viewer Selection Policy

When the user selects a source measure from the list or rendered score:

- while stopped or paused: seek to the nearest matching PerformanceMeasure occurrence, preferring the current occurrence or the earliest future one
- while playing: seek immediately to the nearest matching PerformanceMeasure occurrence and keep playback running

Reason: Phase 2 should keep manual measure navigation useful without introducing a second disconnected selection model.

Impact: Source measure interactions remain available even when the playback order contains repeated occurrences.

Alternative: Disable seek during playback. Rejected because the viewer already supports active navigation and the phase expects previous/next playback navigation.

### Renderer Contract

Keep Verovio responsible only for source score rendering and source measure DOM mapping.

Reason: The renderer should not calculate playback order or interpret repeat semantics.

Impact: Playback highlight uses `PerformanceMeasure.sourceMeasureId` and the viewer keeps the occurrence state separately.

Alternative: Teach the renderer about repeated occurrences. Rejected because Verovio renders source notation, not playback clones.

### Verovio Loading Policy

Load Verovio with a dynamic import only after the score viewer route is entered.

Reason: The score library route should not pay the cost of the Verovio bundle when the user has not opened a score yet.

Impact: The viewer must expose an explicit renderer-loading state, and renderer initialization failures must surface a retry action instead of leaving the view blank.

Alternative: Keep Verovio in the initial app bundle or add preload logic now. Rejected for this phase because the policy is route-entry loading only, without preload or deeper chunk tuning.

### Representative Part Policy

Use the first MusicXML part as the representative part for repeat expansion, navigation interpretation, and measure-duration playback timing in the MVP.

Reason: Phase 2 needs one deterministic playback order without inventing cross-part merge rules that the product has not approved yet.

Impact: Other parts share the representative part's `PerformanceMeasure` order. When a later part disagrees on measure count, time signature, or navigation marks, the app emits structured warnings instead of auto-merging the structure.

Alternative: Attempt to reconcile all parts automatically or let the user choose a representative part now. Rejected for this phase because both choices expand scope beyond the agreed MVP.

### No New State Libraries

Do not add a new state-management dependency for Phase 2.

Reason: The existing app is still small enough for local React state around a pure domain engine.

Impact: We avoid dependency churn and keep the new complexity in domain modules instead of UI infrastructure.

Alternative: Zustand or XState. Rejected for now because the behavior can be kept testable with plain domain classes and focused hooks/effects.

## Risks

- MusicXML navigation marks vary across files; Phase 2 must support the scoped fixtures clearly and warn on unsupported variants.
- Verovio exposes source notation, so occurrence-level playback state must remain separate from DOM mapping.
- Playback persistence must restore position and settings without auto-playing on refresh.
- E2E playback must avoid real-time sleeps while still using the same production timeline logic.
