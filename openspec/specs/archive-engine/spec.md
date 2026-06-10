## ADDED Requirements

### Requirement: Archive engine shall move completed change to archive
The `ArchiveEngine` module SHALL move a completed change directory to `adab/changes/archive/` and copy the final revision to the manuscript.

#### Scenario: Archive completed change
- **WHEN** running `openadab archive draft-ch-012`
- **THEN** the engine SHALL:
  1. Verify the change manifest status is "synced" in `.openadab.yaml`
  2. Infer the chapter ID from the change directory name (e.g., `draft-ch-012` → chapter `012`)
  3. Resolve the revision artifact filename from the schema's `apply.requires` (falls back to `revision.md`)
  4. Check for conflicting in-progress changes targeting the same chapter (blocks archiving by default)
  5. Copy the revision artifact to `adab/manuscript/chapters/ch-012.md`, overwriting if exists
  6. Write the archived manifest status BEFORE moving the directory (safe state)
  7. Move `adab/changes/draft-ch-012/` to `adab/changes/archive/draft-ch-012/`
  8. On rename failure: revert manifest status back to "synced" and throw with appropriate error code
  9. Append archive entry to `adab/log.md`

#### Scenario: Archive un-synced change
- **WHEN** running `archive` on a change with status "in_progress"
- **THEN** the engine SHALL error: "Change draft-ch-012 is not synced. Run `openadab sync --change draft-ch-012` first."
- **AND** SHALL throw `AdabError` with code `ARCHIVE_NOT_SYNCED`

#### Scenario: Archive non-existent change
- **WHEN** running `archive draft-ch-999`
- **THEN** the engine SHALL error: "Change draft-ch-999 not found"
- **AND** SHALL throw `AdabError` with code `ARCHIVE_CHANGE_NOT_FOUND`

### Requirement: Archive engine shall preserve audit trail
All archived change artifacts (brief, scene-plan, draft, revision, continuity-report, wiki-diff) SHALL be preserved.

#### Scenario: Complete audit trail preservation
- **WHEN** a change is archived
- **THEN** the archive directory SHALL contain all original artifact files
- **AND** the `.openadab.yaml` manifest SHALL be preserved with full artifact status history
- **AND** no files SHALL be deleted during archive

### Requirement: Archive engine shall prevent archiving when in-progress changes conflict
The engine SHALL check for conflicts with other in-progress changes before archiving.

#### Scenario: In-progress change exists for same chapter
- **WHEN** archiving `draft-ch-005` and another change (e.g., `revise-ch-005`) also targets chapter 005 with status "in_progress"
- **THEN** the engine SHALL throw `AdabError` with the conflicting change name and chapter
- **AND** SHALL require `--force` flag to proceed

#### Scenario: No conflicting in-progress changes
- **WHEN** archiving `draft-ch-005` and no other change targets chapter 005
- **THEN** the engine SHALL proceed without warning

### Requirement: Archive engine shall handle manuscript chapter conflicts
If the target manuscript file already exists, the engine SHALL handle it according to configured conflict resolution.

#### Scenario: Chapter already exists (revision)
- **WHEN** archiving a revision change for ch-005 and `manuscript/chapters/ch-005.md` already exists
- **THEN** the engine SHALL overwrite the existing file (by default)
- **AND** SHALL warn: "Overwriting existing <path>"

#### Scenario: Chapter backup on overwrite
- **WHEN** `config.archive.backupOnOverwrite: true`
- **AND** archiving overwrites an existing chapter
- **THEN** the engine SHALL create a backup at `manuscript/chapters/ch-005.md.bak.<timestamp>` before overwriting

#### Scenario: Revision artifact not found
- **WHEN** the resolved revision file does not exist in the change directory
- **THEN** the engine SHALL warn and skip the manuscript copy (not fail)

### Requirement: Archive engine shall handle duplicate archive targets
If the target archive directory already exists, the engine SHALL prevent accidental overwrites.

#### Scenario: Archive target already exists
- **WHEN** `adab/changes/archive/draft-ch-012/` already exists
- **THEN** the engine SHALL throw `AdabError` with code `ARCHIVE_DUPLICATE`
- **AND** advise manual removal or using a different change ID

#### Scenario: Rollback on rename failure
- **WHEN** renaming the change directory to the archive fails
- **THEN** the engine SHALL revert the manifest status from "archived" back to "synced"
- **AND** SHALL throw `AdabError` with code `ARCHIVE_RENAME_FAILED`
- **AND** if the failure is due to the archive directory appearing concurrently (ENOTEMPTY or EEXIST), SHALL throw `ARCHIVE_DUPLICATE` instead
