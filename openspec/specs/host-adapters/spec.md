## ADDED Requirements

### Requirement: Host adapters shall transform core command definitions into host-native files
The `HostAdapters` module SHALL read core command definitions (YAML) from CLI source and generate instruction files for each supported AI host.

#### Scenario: Opencode adapter generates skill files
- **WHEN** generating for the Opencode host
- **THEN** the adapter SHALL create `.agents/skills/adab-draft/SKILL.md` for each command
- **AND** the SKILL.md SHALL include: slash command name (`/adab:draft`), description, parameter documentation, and step-by-step instructions for the AI
- **AND** the instructions SHALL tell the AI to invoke CLI commands in sequence: `openadab context pack`, `openadab instructions`, read context files, write artifact, `openadab validate`

#### Scenario: Cursor adapter generates rule files
- **WHEN** generating for Cursor
- **THEN** the adapter SHALL create `.cursor/rules/adab.mdc`
- **AND** each command SHALL be a `@` command reference (e.g., `@draft`)
- **AND** only CLI steps SHALL be included (read/write/llm steps excluded)

#### Scenario: Copilot adapter generates instruction file
- **WHEN** generating for GitHub Copilot
- **THEN** the adapter SHALL create `.github/copilot-instructions.md`
- **AND** the file SHALL document all OpenAdab commands with usage patterns
- **AND** workflow steps SHALL include CLI, read, and write steps

#### Scenario: Generic AGENTS.md adapter
- **WHEN** generating for generic/fallback host
- **THEN** the adapter SHALL create or update `AGENTS.md` in the project root
- **AND** the file SHALL include complete OpenAdab workflow documentation with parameters and steps

### Requirement: Host adapters shall support parameter interpolation
Command steps containing `{{variable}}` SHALL be interpolated with parameter values provided by the AI host at invocation time.

#### Scenario: Change parameter interpolation
- **WHEN** a command step contains `openadab status --change {{change}} --json`
- **AND** the AI invokes the command with `change: draft-ch-012`
- **THEN** the generated instruction SHALL show `openadab status --change draft-ch-012 --json`
- **AND** unresolved placeholders SHALL be rendered as `<variable>` for documentation

#### Scenario: Captured variable reuse
- **WHEN** a command step captures output as `context_pack`
- **AND** a subsequent step references `{{context_pack.mustRead}}`
- **THEN** the instruction SHALL explain that the AI should extract `mustRead` from the previous command's JSON output

### Requirement: Host adapters shall handle non-tool-use hosts
For hosts that cannot invoke CLI tools, the adapter SHALL generate monolithic comprehensive prompts.

#### Scenario: Monolithic prompt for non-tool-use hosts
- **WHEN** generating for a non-tool-use host via `MonolithicPromptAdapter`
- **THEN** the adapter SHALL generate a single comprehensive `PROMPT.md` containing:
  - Full project context (config: title, language, genre, tense, POV, token budget)
  - Active artifact instructions
  - Inline context (all mustRead files concatenated via dependency content)
  - Current artifact template
  - Writing rules
  - Output path specification
  - Available command definitions
- **AND** the prompt SHALL fit within the host's configurable context window limit (default 8000 tokens) via `chars / divisor` estimation (1.5 for Chinese, 4 for English)
- **AND** SHALL append "[Content truncated to fit token budget]" if truncated

### Requirement: Host adapters shall detect the current host environment
The adapter SHALL auto-detect which host is being used when possible.

#### Scenario: Auto-detect Opencode
- **WHEN** running `openadab init` or `openadab update` in an Opencode environment (`.opencode/` directory exists)
- **THEN** the adapter SHALL generate Opencode-specific skill files
- **AND** the generated files SHALL include slash commands compatible with Opencode's command system

#### Scenario: Auto-detect Cursor
- **WHEN** `.cursor/` directory exists in the project root
- **THEN** `detectHost()` SHALL return `"cursor"`

#### Scenario: Auto-detect Copilot
- **WHEN** `.github/copilot-instructions.md` exists in the project root
- **THEN** `detectHost()` SHALL return `"copilot"`

#### Scenario: Fallback to generic
- **WHEN** the host environment cannot be detected
- **THEN** the adapter SHALL generate the generic AGENTS.md format
- **AND** SHALL advise the user to run `openadab update --host <name>` if needed

#### Scenario: Explicit host selection
- **WHEN** user runs `openadab init --host cursor`
- **THEN** the adapter SHALL generate Cursor-specific files regardless of detected environment

### Requirement: Host adapters shall preserve user modifications
Generated files SHALL be written with a content hash baseline mechanism to detect and preserve user modifications.

#### Scenario: New files are always written
- **WHEN** a generated file does not exist
- **THEN** it SHALL be created and its content hash stored in `.openadab-cache.json`

#### Scenario: Unchanged files are not overwritten
- **WHEN** a generated file exists and its content hash matches the stored baseline
- **THEN** the file SHALL be skipped (no unnecessary writes)

#### Scenario: User-modified files are preserved
- **WHEN** a generated file exists and its content hash differs from the stored baseline
- **THEN** the file SHALL be skipped with a warning: "Skipping <path> — user modifications detected"

#### Scenario: Regenerated files with changed content overwrite
- **WHEN** a generated file exists, its content hash equals the stored baseline, but the new content hash is different (adapter output changed)
- **THEN** the file SHALL be overwritten with the new content (adapter change is intentional)

### Requirement: Host adapters shall not carry full story knowledge
Generated prompt files SHALL define AI behavior protocols, not story content.

#### Scenario: Prompt is a protocol, not a story bible
- **WHEN** examining a generated skill file
- **THEN** it SHALL contain instructions like "Run openadab status --json" and "Read the files listed in contextPack.mustRead"
- **AND** it SHALL NOT contain character names, plot details, or any story-specific content
