## ADDED Requirements

### Requirement: Sync engine shall orchestrate full change synchronization
The `SyncEngine` module SHALL orchestrate the complete sync workflow: validate change, apply wiki-diff, regenerate all indexes, update log.

#### Scenario: Full sync workflow
- **WHEN** running `openadab sync --change draft-ch-012`
- **THEN** the engine SHALL:
  1. Verify the change manifest status is `in_progress` (reject if already `synced` or `archived`)
  2. Run mechanical validation on the change (file existence, frontmatter, word counts, dependencies) → abort if errors
  3. Parse and apply the wiki-diff (`changes/draft-ch-012/wiki-diff.md`) via wiki-diff-engine → abort if application fails
  4. Regenerate `adab/index/mentions.json` via mention-indexer (incremental by default, full with `--full` flag)
  5. Regenerate `adab/index/wikilinks.json` via wiki-engine
  6. Regenerate `adab/index/progressions.json` via progression-tracker
  7. Regenerate `adab/index/context-map.json` via mention-indexer
  8. Regenerate `adab/wiki/index.md` via wiki-engine
  9. Append sync entry to `adab/log.md`
  10. Update `.openadab.yaml` status to "synced"

#### Scenario: Pre-sync dependency validation
- **WHEN** validating a change before sync
- **THEN** the engine SHALL call `validator.validateDependencies()` to verify every artifact dependency in the schema is present in the manifest
- **AND** SHALL verify that each artifact marked `done` in the manifest has non-empty generated files via `validator.requireNonEmpty()`
- **AND** SHALL treat missing optional artifacts (e.g., `wiki-diff`) with a "File missing" error as non-fatal (skipped, not aborted)

#### Scenario: Sync without wiki-diff
- **WHEN** running `sync` on a change that has no `wiki-diff.md` (e.g., revision didn't change canon)
- **THEN** the engine SHALL skip the wiki-diff application step
- **AND** SHALL still regenerate indexes (in case other changes affected them)

#### Scenario: Wiki-diff exists but contains no operations
- **WHEN** running `sync` on a change where `wiki-diff.md` exists but parses to zero operations (all sections empty or no changes declared)
- **THEN** the engine SHALL skip the wiki-diff application step (no-op)
- **AND** SHALL still regenerate indexes
- **AND** SHALL NOT emit a warning — an empty diff is a valid state

#### Scenario: Sync with validation failures
- **WHEN** mechanical validation finds errors (missing required frontmatter, dependency violations)
- **THEN** the engine SHALL abort before wiki-diff application
- **AND** SHALL output the validation errors
- **AND** SHALL throw `AdabError` with code `SYNC_VALIDATION_FAILED`

### Requirement: Sync engine shall produce sync report
The engine SHALL output a structured report of all actions taken.

#### Scenario: Sync report format
- **WHEN** sync completes successfully
- **THEN** the output SHALL include:
  - `changeId`: the synced change
  - `wikiPagesModified`: list of wiki pages changed by wiki-diff
  - `contradictionsFlagged`: number of new contradictions
  - `indexesRegenerated`: list of regenerated index files
  - `indexErrors`: list of index regeneration errors (empty on success)
  - `logEntry`: the appended log entry content

### Requirement: Sync engine shall handle rollback on partial failure
If any step after wiki-diff application fails, the engine SHALL keep wiki-diff changes and report the failure.

#### Scenario: Index regeneration fails after wiki-diff applied
- **WHEN** wiki-diff was applied successfully but an index regeneration step crashes
- **THEN** the engine SHALL continue through remaining index steps (partial failure won't block subsequent steps)
- **AND** the engine SHALL NOT rollback wiki-diff (it was applied correctly)
- **AND** the engine SHALL throw `AdabError` with code `SYNC_INDEX_FAILED` containing the message: "Index regeneration partially failed after wiki-diff was applied."
- **AND** the error message SHALL list which indexes were regenerated successfully and instruct the user to run `openadab wiki index` manually
