# desktop-agent-dock Delta Specification

## MODIFIED Requirements

### Requirement: Agent Dock shall support ACP sessions

The Agent Dock SHALL connect to OpenCode via the `opencode acp` command using the ACP (Agent Client Protocol) JSON-RPC 2.0 stdio protocol. The default agent command SHALL be `opencode acp`. Custom agent commands are supported via `custom-command` mode.

#### Scenario: Start default agent
- **WHEN** the user starts the default agent in `opencode-default` mode
- **THEN** the main process SHALL spawn `opencode acp` as a child process
- **AND** the main process SHALL perform the ACP `initialize` → `session/new` handshake before accepting messages
- **AND** the session SHALL be listed with id, mode, status, and transcript

#### Scenario: Agent command fails to spawn
- **WHEN** the configured agent executable is missing or cannot be launched
- **THEN** the main process SHALL return or emit an error state before the renderer treats the session as active
- **AND** exactly one failure event SHALL be logged for the attempted session

### Requirement: Agent session SHALL forward agent text messages correctly

#### Scenario: Agent sends text via agent_message_chunk
- **WHEN** the agent sends `{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }`
- **THEN** the main process SHALL extract text from `content.text` after checking `content.type === "text"`
- **AND** the main process SHALL NOT attempt to read a non-existent `text` property on the update itself
- **AND** the renderer SHALL receive `event:agent-message` with the extracted text

#### Scenario: Agent sends thought via agent_thought_chunk
- **WHEN** the agent sends `{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking..." } }`
- **THEN** the main process SHALL extract text from `content.text` and prefix with `[thought]`
- **AND** the renderer SHALL receive `event:agent-message` with `{ role: "system", content: "[thought] thinking..." }`

#### Scenario: Agent sends non-text content block
- **WHEN** the agent sends `agent_message_chunk` with `content: { type: "image", ... }`
- **THEN** the main process SHALL emit a placeholder message without crashing

### Requirement: Agent session SHALL handle plan notifications correctly

#### Scenario: Plan notification with entries
- **WHEN** the agent sends `{ sessionUpdate: "plan", entries: [{ status: "pending", content: "Add tests" }] }`
- **THEN** the main process SHALL iterate `entries` and emit each entry
- **AND** the main process SHALL NOT attempt to read a `title` field (which does not exist on ACP Plan type)

### Requirement: Agent session SHALL handle all SessionUpdate types

#### Scenario: Usage update
- **WHEN** the agent sends `{ sessionUpdate: "usage_update", used: 5000, size: 200000 }`
- **THEN** the main process SHALL emit context window usage information

#### Scenario: Mode change
- **WHEN** the agent sends `{ sessionUpdate: "current_mode_update", modeId: "architect" }`
- **THEN** the main process SHALL emit the mode switch notification
