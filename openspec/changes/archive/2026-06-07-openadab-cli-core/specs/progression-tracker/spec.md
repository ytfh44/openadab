## ADDED Requirements

### Requirement: Progression tracker shall extract timeline events from continuity reports
The `ProgressionTracker` module SHALL parse continuity-report artifacts and wiki-diffs to build a timeline of entity state changes.

#### Scenario: Character knowledge progression
- **WHEN** a continuity-report for ch-012 states "Mara now knows the east gate was opened from inside"
- **THEN** the progression tracker SHALL record: `{ entity: "Mara", chapter: "ch-012", type: "knowledge", change: "Learned east gate was opened from inside" }`

#### Scenario: Relationship progression
- **WHEN** a continuity-report for ch-015 states "Mara and Lin are now allies against the priesthood"
- **THEN** the tracker SHALL record: `{ entity: "Mara", relatedEntity: "Lin", chapter: "ch-015", type: "relationship", change: "allies against priesthood" }`

#### Scenario: Thread advancement
- **WHEN** a wiki-diff advances thread "east-gate-betrayal" from "open" to "advanced"
- **THEN** the tracker SHALL record: `{ thread: "east-gate-betrayal", chapter: "ch-012", type: "thread_status", from: "open", to: "advanced" }`

#### Scenario: Location state change
- **WHEN** a continuity-report notes "East Gate is now permanently sealed after ch-020"
- **THEN** the tracker SHALL record: `{ entity: "East Gate", chapter: "ch-020", type: "state", change: "permanently sealed" }`

### Requirement: Progression tracker shall generate progressions.json
The output SHALL be a structured JSON timeline.

#### Scenario: progressions.json format
- **WHEN** generating `adab/index/progressions.json`
- **THEN** the output SHALL be a JSON array sorted by chapter number:
  ```json
  [
    {
      "chapter": "ch-003",
      "events": [
        { "entity": "Mara", "type": "knowledge", "change": "Learned X" }
      ]
    }
  ]
  ```

#### Scenario: Entity-centric progressions view
- **WHEN** querying progressions for entity "Mara"
- **THEN** the output SHALL filter to only events involving "Mara" across all chapters
- **AND** events SHALL be ordered chronologically by chapter

### Requirement: Progression tracker shall detect contradictions between progressions
The tracker SHALL flag events that contradict earlier recorded events.

#### Scenario: Contradiction detection
- **WHEN** ch-020 records "Mara trusts Lin" but ch-015 recorded "Mara betrayed by Lin"
- **THEN** the tracker SHALL flag this as a potential contradiction
- **AND** SHALL include it in the output with severity "warning"

### Requirement: Progression tracker shall support incremental updates
Similar to the mention indexer, the tracker SHALL support re-processing only changed data. Change detection uses file modification timestamps (mtime) compared against `adab/index/.last-indexed`.

#### Scenario: Incremental update (new chapter)
- **WHEN** only `wiki-diff` for ch-012 is new since last run (mtime > `.last-indexed` timestamp)
- **THEN** the tracker SHALL only process ch-012's continuity-report and wiki-diff
- **AND** SHALL append new events to existing `progressions.json`

#### Scenario: Edited continuity-report triggers re-processing
- **WHEN** an existing continuity-report for ch-008 is edited (mtime updated)
- **THEN** the tracker SHALL re-process ch-008 and replace its prior progression entries
- **AND** SHALL preserve progression entries for other chapters unchanged
