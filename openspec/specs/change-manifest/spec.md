## ADDED Requirements

### Requirement: Change manifest shall track change metadata and artifact status
The change `.openadab.yaml` manifest SHALL store metadata about a change and the current status of each artifact.

#### Scenario: Manifest creation on new chapter
- **WHEN** running `openadab new chapter ch-012`
- **THEN** the CLI SHALL create `adab/changes/ch-012/.openadab.yaml` (or matching the change ID as-is) with:
  - `changeId`: the change identifier
  - `schema` from active config
  - `version` from schema version
  - `created` timestamp in ISO 8601
  - `status: in_progress`
  - `artifacts` map with all schema artifacts initialized to `blocked` except the first (no `requires`) artifact set to `ready`
- **AND** the manifest uses Zod `passthrough()` for forward compatibility with unknown fields, emitting warnings

#### Scenario: Manifest update after artifact write
- **WHEN** an artifact file is written and validated
- **THEN** the manifest SHALL update that artifact's status to `done`
- **AND** the manifest MAY set newly unblocked artifacts (dependencies met) to `ready`

#### Scenario: Manifest prevents invalid status transitions
- **WHEN** attempting to set a change status from `in_progress` directly to `archived` (skipping `synced`)
- **THEN** the manifest SHALL reject the transition and throw `ChangeStatusError`

#### Scenario: Manifest reflects artifact deletion
- **WHEN** an artifact file is deleted
- **THEN** the manifest SHALL revert that artifact's status to `ready` (if dependencies are met) or `blocked` (if dependencies are missing)

### Requirement: Change manifest shall be machine-parseable
The manifest SHALL use YAML format.

#### Scenario: Valid YAML parsing
- **WHEN** reading a `.openadab.yaml` file
- **THEN** the parser SHALL produce a typed `ChangeManifest` object
- **AND** all fields SHALL match the Zod schema types:
  - `changeId`: string
  - `schema`: string
  - `version`: number
  - `created`: string (ISO 8601)
  - `status`: enum ("in_progress" | "synced" | "archived")
  - `currentArtifact`: optional string
  - `artifacts`: record of enum ("blocked" | "ready" | "done")
  - `chapter`: optional string
  - `metadata`: optional record

#### Scenario: Manifest with unknown fields
- **WHEN** reading a manifest with additional fields not in the schema
- **THEN** the parser SHALL warn about unknown fields via `process.emitWarning` (forward compatibility)
- **AND** SHALL preserve them on write-back (via `passthrough`)
