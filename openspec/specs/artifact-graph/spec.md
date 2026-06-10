## ADDED Requirements

### Requirement: Artifact graph shall build DAG from schema
The `ArtifactGraph` module SHALL construct a directed acyclic graph from a schema's artifact definitions, where nodes are artifacts and edges represent `requires` dependencies.

#### Scenario: Linear chain DAG
- **WHEN** building a graph from a schema with artifacts A → B → C → D (each requiring the previous)
- **THEN** the graph SHALL have nodes A, B, C, D
- **AND** edges: A→B, B→C, C→D (direct dependencies only)
- **AND** topological sort (Kahn's algorithm) SHALL yield [A, B, C, D]

#### Scenario: Parallel-ready DAG
- **WHEN** building a graph where A requires nothing, B requires A, C requires A, and D requires both B and C
- **THEN** the graph SHALL detect that B and C can be worked in parallel
- **AND** `getReadyArtifacts()` after A is done SHALL return [B, C]

#### Scenario: Cycle detection
- **WHEN** a schema has a dependency cycle
- **THEN** the topological sort SHALL throw an Error indicating how many artifacts were processed before the cycle was detected

### Requirement: Artifact graph shall detect artifact state per change directory
The module SHALL determine each artifact's state (blocked/ready/done) by checking file existence and validation status against the change directory.

#### Scenario: All artifacts blocked initially
- **WHEN** a change directory is newly created with only `.openadab.yaml`
- **THEN** the first artifact (no `requires`) SHALL be `ready`
- **AND** all other artifacts SHALL be `blocked`

#### Scenario: Artifact done after file written and valid
- **WHEN** an artifact's `generates` file exists and passes validation
- **THEN** the artifact SHALL be marked `done`
- **AND** validation checks: non-empty content, frontmatter present (if `frontmatterPresent` in mechanical validation rules), and mechanical validator pass (if validator provided)

#### Scenario: Artifact blocked if dependency missing
- **WHEN** artifact B requires artifact A, but A's generated file is missing
- **THEN** B SHALL remain `blocked` regardless of B's file existence

#### Scenario: Artifact ready if all dependencies done and file missing
- **WHEN** all of artifact C's dependencies are `done` but C's generated file does not exist
- **THEN** C SHALL be `ready`

#### Scenario: Artifact re-triggered after deletion
- **WHEN** artifact A was `done` but its generated file is deleted
- **THEN** A SHALL revert to `ready` (if no unmet dependencies) or `blocked`

#### Scenario: Invalid artifact file reverts to ready
- **WHEN** an artifact file exists but fails validation (empty, missing frontmatter when required, or mechanical validation failure)
- **THEN** the artifact SHALL be marked `ready` (needs rewrite), not `done`

### Requirement: Artifact graph shall suggest next step
The module SHALL provide the next artifact(s) ready for work.

#### Scenario: Single next artifact
- **WHEN** the graph has artifact A as `ready` and B as `blocked`
- **THEN** `getNextStep()` SHALL return [{ id: "A", action: "write" }]

#### Scenario: Multiple parallel-ready artifacts
- **WHEN** the graph has B and C both `ready` (dependencies met)
- **THEN** `getNextStep()` SHALL return [{ id: "B", action: "write" }, { id: "C", action: "write" }]

#### Scenario: All artifacts done — apply action
- **WHEN** all artifacts including `apply.requires` are `done`
- **THEN** `getNextStep()` SHALL return [{ action: "apply", target: "<interpolated target>" }]
- **AND** the target SHALL interpolate `{{chapter}}` from the change directory name and schema context variables

### Requirement: Artifact graph shall provide status summary
The module SHALL return a structured status summary suitable for JSON output.

#### Scenario: Status JSON output
- **WHEN** querying status with JSON format
- **THEN** the output SHALL include: `changeName`, `schemaName`, `artifacts` (each with `id`, `status`, `generates`, `requires`), `nextStep`, `blockingIssues`
- **AND** `changeName` SHALL be the basename of the change directory (last path segment)
