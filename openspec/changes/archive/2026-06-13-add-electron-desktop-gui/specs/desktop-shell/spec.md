## ADDED Requirements

### Requirement: Desktop shell shall run as a separate Electron application
The desktop GUI SHALL be packaged as an Electron application with distinct main, preload, and renderer processes.

#### Scenario: Main process owns privileged operations
- **WHEN** the renderer needs to open a project, read a project file, save an artifact, run a CLI command, or communicate with an agent process
- **THEN** the request SHALL go through the preload IPC API to the Electron main process
- **AND** the renderer SHALL NOT receive unrestricted Node.js `fs`, `child_process`, or `process` access

#### Scenario: Renderer cannot import CLI business modules
- **WHEN** renderer code needs OpenAdab workflow state
- **THEN** it SHALL request CLI JSON, bounded file reads, or main-process state through the desktop API
- **AND** it SHALL NOT import `src/modules/*` implementation classes to compute canonical project state

#### Scenario: Desktop app starts without selected project
- **WHEN** the app starts and no recent valid project is selected
- **THEN** it SHALL show a project landing state with actions to open an existing project or initialize a new project
- **AND** it SHALL NOT attempt project-scoped CLI commands until a project root is selected

### Requirement: Desktop shell shall validate OpenAdab project roots
The desktop shell SHALL treat a directory as an OpenAdab project root only when it contains `adab/config.yaml`.

#### Scenario: Open valid project directory
- **WHEN** the user selects a directory containing `adab/config.yaml`
- **THEN** the desktop shell SHALL set that directory as the active project root
- **AND** it SHALL load Project workbench health data

#### Scenario: Open non-project directory
- **WHEN** the user selects a directory without `adab/config.yaml`
- **THEN** the shell SHALL present initialize-project and choose-another-directory actions
- **AND** it SHALL NOT run project-scoped commands except `openadab init` if the user chooses initialization
- **AND** it SHALL NOT set that directory as the active `ProjectInfo` until `adab/config.yaml` exists and passes project detection
- **AND** project-scoped file APIs SHALL continue to reject requests while no valid project is active

#### Scenario: Recent project no longer exists
- **WHEN** a recent project root no longer exists on disk
- **THEN** the shell SHALL mark it unavailable
- **AND** the user SHALL be able to remove it from recents or choose another project

#### Scenario: Open project request result
- **WHEN** the renderer asks the main process to open a project
- **THEN** the IPC result SHALL distinguish valid project, non-project directory, cancelled selection, and unreadable path states
- **AND** the renderer SHALL use that state to show recovery actions rather than assuming a valid `ProjectInfo`

### Requirement: Desktop shell shall provide top-level information architecture
The shell SHALL expose the top-level areas Project, Manuscript, Changes, Timeline, Wiki, Schemas, and Agent.

#### Scenario: Route selection updates central workbench
- **WHEN** the user selects a top-level area from the left navigation
- **THEN** the central workbench SHALL render that area's primary view
- **AND** the top bar SHALL continue to show the active project, active change if any, active schema if known, and active agent status if known

#### Scenario: Changes route selected
- **WHEN** the Changes route is active
- **THEN** the shell SHALL show the artifact DAG and selected artifact workbench as the primary view
- **AND** it SHALL show the Inspector and CLI Transcript unless the user explicitly collapses them

### Requirement: Desktop shell shall preserve UI state separately from project truth
The desktop app SHALL persist UI preferences separately from OpenAdab project files.

#### Scenario: Persist recent projects
- **WHEN** a user opens a valid project
- **THEN** the app SHALL persist the project path in its app preference store
- **AND** it SHALL NOT write this preference into `adab/config.yaml`

#### Scenario: Persist panel layout
- **WHEN** the user resizes or collapses navigation, inspector, or transcript panels
- **THEN** the app SHALL persist layout preferences
- **AND** those preferences SHALL NOT affect CLI status, manifest state, validation, sync, archive, or wiki-diff behavior
