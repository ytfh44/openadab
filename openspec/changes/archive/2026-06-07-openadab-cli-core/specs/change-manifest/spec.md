## ADDED Requirements

### Requirement: Change manifest shall track change metadata and artifact status
The change `.openadab.yaml` manifest SHALL store metadata about a change and the current status of each artifact.

#### Scenario: Manifest creation on new chapter
- **WHEN** running `openadab new chapter ch-012`
- **THEN** the CLI SHALL create `adab/changes/draft-ch-012/.openadab.yaml` with:
  - `changeId: draft-ch-012`
  - `schema` from active config
  - `version` from schema version
  - `created` timestamp in ISO 8601
  - `status: in_progress`
  - `artifacts` map with all schema artifacts initialized to `blocked` except the first artifact set to `ready`
  - `chapter: "012"` extracted from change ID

#### Scenario: Manifest update after artifact write
- **WHEN** an artifact file is written and validated
- **THEN** the manifest SHALL update that artifact's status to `done`
- **AND** the manifest SHALL update `currentArtifact` to the artifact ID
- **AND** the manifest SHALL set any newly unblocked artifacts to `ready`

#### Scenario: Manifest prevents invalid status transitions
- **WHEN** attempting to set a change status from `in_progress` directly to `archived` (skipping `synced`)
- **THEN** the manifest SHALL reject the transition and throw `ChangeStatusError`

#### Scenario: Manifest reflects artifact deletion
- **WHEN** an artifact file is deleted
- **THEN** the manifest SHALL revert that artifact's status to `ready` (if dependencies are met) or `blocked` (if dependencies are missing)

### Requirement: Change manifest shall be machine-parseable
The manifest SHALL use YAML format matching the zod schema defined in design decision 2.

#### Scenario: Valid YAML parsing
- **WHEN** reading a `.openadab.yaml` file
- **THEN** the parser SHALL produce a typed `ChangeManifest` object
- **AND** all fields SHALL match the zod schema types (changeId: string, schema: string, version: number, status: enum, artifacts: record of enum)

#### Scenario: Manifest with unknown fields
- **WHEN** reading a manifest with additional fields not in the schema
- **THEN** the parser SHALL warn about unknown fields (forward compatibility)
- **AND** SHALL preserve them on write-back
