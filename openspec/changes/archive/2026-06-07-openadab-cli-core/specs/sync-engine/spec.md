## ADDED Requirements

### Requirement: Sync engine shall orchestrate full change synchronization
The `SyncEngine` module SHALL orchestrate the complete sync workflow: validate change, apply wiki-diff, regenerate all indexes, update log.

#### Scenario: Full sync workflow
- **WHEN** running `openadab sync --change draft-ch-012`
- **THEN** the engine SHALL:
  1. Run mechanical validation on the change → fail if validation errors
  2. Apply the wiki-diff (`changes/draft-ch-012/wiki-diff.md`) via wiki-diff-engine
  3. Regenerate `adab/index/mentions.json` via mention-indexer
  4. Regenerate `adab/index/wikilinks.json` via wiki-engine
  5. Regenerate `adab/index/progressions.json` via progression-tracker
  6. Regenerate `adab/index/context-map.json` via context-packer
  7. Update `adab/wiki/index.md` via wiki-engine
  8. Append sync entry to `adab/log.md`
  9. Update `.openadab.yaml` status to "synced"

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
- **WHEN** mechanical validation finds errors (missing required frontmatter, word count out of range)
- **THEN** the engine SHALL abort before wiki-diff application
- **AND** SHALL output the validation errors
- **AND** SHALL return exit code 1

### Requirement: Sync engine shall produce sync report
The engine SHALL output a structured report of all actions taken.

#### Scenario: Sync report format
- **WHEN** sync completes successfully
- **THEN** the output SHALL include:
  - `changeId`: the synced change
  - `wikiPagesModified`: list of wiki pages changed by wiki-diff
  - `contradictionsFlagged`: number of new contradictions
  - `indexesRegenerated`: list of regenerated index files
  - `logEntry`: the appended log entry content

### Requirement: Sync engine shall handle rollback on partial failure
If any step after wiki-diff application fails, the engine SHALL attempt rollback.

#### Scenario: Index regeneration fails after wiki-diff applied
- **WHEN** wiki-diff was applied successfully but mention-indexer crashes
- **THEN** the engine SHALL report the failure
- **AND** SHALL NOT rollback wiki-diff (it was applied correctly)
- **AND** SHALL instruct user to run `wiki index` manually
