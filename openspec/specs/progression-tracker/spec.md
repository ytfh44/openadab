## ADDED Requirements

### Requirement: Progression tracker shall extract timeline events from continuity reports
The `ProgressionTracker` module SHALL parse continuity-report artifacts and wiki-diffs to build a timeline of entity state changes.

#### Scenario: Character knowledge progression
- **WHEN** a continuity-report for ch-012 states "Mara now knows the east gate was opened from inside" (under a `## Character Knowledge` heading)
- **THEN** the progression tracker SHALL record: `{ entity: "Mara", chapter: "ch-012", type: "knowledge", change: "Learned east gate was opened from inside" }`

#### Scenario: Relationship progression
- **WHEN** a continuity-report for ch-015 states "Mara and Lin are now allies against the priesthood" (under a `## Relationships` heading)
- **THEN** the tracker SHALL record: `{ entity: "Mara", relatedEntity: "Lin", chapter: "ch-015", type: "relationship", change: "allies against priesthood" }`

#### Scenario: Thread advancement
- **WHEN** a wiki-diff contains `update_thread_status: <thread> from open to advanced`
- **THEN** the tracker SHALL record: `{ entity: "<thread>", chapter: "<changeId>", type: "thread_status", from: "open", to: "advanced" }`

#### Scenario: Location state change
- **WHEN** a continuity-report notes "East Gate is now permanently sealed" under a `## Location State` heading
- **THEN** the tracker SHALL record: `{ entity: "East Gate", chapter: "<chapter>", type: "state", change: "permanently sealed" }`

### Requirement: Progression tracker shall generate progressions.json
The output SHALL be a structured JSON timeline wrapped in `{ chapters: [...] }`.

#### Scenario: progressions.json format
- **WHEN** generating `adab/index/progressions.json`
- **THEN** the output SHALL be `{ "chapters": [ ... ] }` sorted by numeric chapter number:
  ```json
  {
    "chapters": [
      {
        "chapter": "ch-003",
        "events": [
          {
            "entity": "Mara",
            "type": "knowledge",
            "change": "Learned X",
            "timestamp": "2026-01-01T00:00:00.000Z"
          }
        ]
      }
    ]
  }
  ```
- **AND** each event SHALL include a `timestamp` field in ISO 8601 format

#### Scenario: Loading progressions.json
- **WHEN** loading `progressions.json` to merge new events
- **THEN** the loader SHALL accept both the legacy array format (`[ { chapter, events } ]`) and the current `{ chapters: [...] }` format
- **AND** SHALL rebuild from scratch if the file is corrupt or unparseable (logging a warning)

#### Scenario: Entity-centric progressions view
- **WHEN** querying progressions for entity "Mara"
- **THEN** the output SHALL filter to only events involving "Mara" (as `entity` or `relatedEntity`) across all chapters
- **AND** events SHALL be ordered chronologically by chapter

### Requirement: Progression tracker shall detect contradictions between progressions
The tracker SHALL flag events that contradict earlier recorded events.

#### Scenario: Contradiction detection
- **WHEN** ch-020 records "Mara trusts Lin" but ch-015 recorded "Mara betrayed by Lin"
- **THEN** the tracker SHALL flag this as a potential contradiction
- **AND** SHALL detect knowledge contradictions (learned vs forgot), relationship reversals (allies ↔ enemies, etc.), state incompatibilities (destroyed ↔ repaired, etc.), and thread status backward progressions

### Requirement: Progression tracker shall support incremental updates
Similar to the mention indexer, the tracker SHALL support re-processing only changed data. Change detection uses file modification timestamps (mtime) compared against `adab/index/.last-progression-indexed`.

#### Scenario: Incremental update (new chapter)
- **WHEN** only `wiki-diff` for ch-012 is new since last run (mtime > `.last-progression-indexed` timestamp)
- **THEN** the tracker SHALL only process ch-012's continuity-report and wiki-diff
- **AND** SHALL merge new events into existing `progressions.json`, replacing entries for re-processed chapters

#### Scenario: Edited continuity-report triggers re-processing
- **WHEN** an existing continuity-report for ch-008 is edited (mtime updated)
- **THEN** the tracker SHALL re-process ch-008 and replace its prior progression entries
- **AND** SHALL preserve progression entries for other chapters unchanged

#### Scenario: Crash-safe write ordering
- **WHEN** writing incremental updates
- **THEN** the tracker SHALL write `progressions.json` BEFORE `.last-progression-indexed`
- **AND** this ordering ensures that if a crash occurs between writes, the next run will re-process (redundant but safe), rather than skip modified files (which would cause data loss)
