# acp-client Specification

## Purpose
ACP-compliant JSON-RPC 2.0 stdio client for the Electron main process, implementing the ACP v1 agent lifecycle for communication with `opencode acp`.

## MODIFIED Requirements

### Requirement: ACP client SHALL handle session/update notifications correctly

The client SHALL listen for `session/update` JSON-RPC notifications from the agent and translate them into IPC events for the renderer. The `update` field is a `SessionUpdate` discriminated union with `sessionUpdate` as the discriminator. The client SHALL handle all 13 discriminator values defined by ACP v1 (`@agentclientprotocol/sdk` v0.25.0).

#### Scenario: Agent text message (agent_message_chunk)
- **WHEN** the agent sends `session/update` with `{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }`
- **THEN** the client SHALL extract text from `update.content.text` after checking `update.content.type === "text"`
- **AND** the client SHALL emit `event:agent-message` with `{ role: "agent", content: "Hello" }`

#### Scenario: Agent thought chunk (agent_thought_chunk)
- **WHEN** the agent sends `session/update` with `{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Let me think..." } }`
- **THEN** the client SHALL extract text from `update.content`
- **AND** emit `event:agent-message` with `{ role: "system", content: "[thought] Let me think..." }`

#### Scenario: User message chunk (user_message_chunk)
- **WHEN** the agent sends `{ sessionUpdate: "user_message_chunk", content: { type: "text", text: "..." } }`
- **THEN** the client SHALL emit `event:agent-message` with `{ role: "agent", content: "..." }`

#### Scenario: Tool call (tool_call)
- **WHEN** the agent sends `{ sessionUpdate: "tool_call", toolCallId: "tc-1", title: "read_file", kind: "read" }`
- **THEN** the client SHALL emit `event:agent-message` with tool call details
- **AND** for gated capabilities, the client SHALL emit `event:permission-request`

#### Scenario: Tool call update (tool_call_update)
- **WHEN** the agent sends `{ sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: { status: "completed" } }`
- **THEN** the client SHALL emit `event:agent-message` with the update details

#### Scenario: Plan (plan)
- **WHEN** the agent sends `{ sessionUpdate: "plan", entries: [{ status: "pending", content: "Add tests" }] }`
- **THEN** the client SHALL iterate `update.entries` and emit `event:agent-message` with each entry''s status and content
- **AND** the client SHALL NOT attempt to read a non-existent `title` field

#### Scenario: Plan update (plan_update)
- **WHEN** the agent sends `{ sessionUpdate: "plan_update", entries: [...] }`
- **THEN** the client SHALL emit `event:agent-message` with updated plan entries

#### Scenario: Plan removed (plan_removed)
- **WHEN** the agent sends `{ sessionUpdate: "plan_removed" }`
- **THEN** the client SHALL emit `event:agent-message` indicating plan removal

#### Scenario: Available commands update (available_commands_update)
- **WHEN** the agent sends `{ sessionUpdate: "available_commands_update" }`
- **THEN** the client SHALL emit `event:agent-message` noting available commands changed

#### Scenario: Current mode update (current_mode_update)
- **WHEN** the agent sends `{ sessionUpdate: "current_mode_update", modeId: "architect" }`
- **THEN** the client SHALL emit `event:agent-message` with the new mode

#### Scenario: Config option update (config_option_update)
- **WHEN** the agent sends `{ sessionUpdate: "config_option_update" }`
- **THEN** the client SHALL emit `event:agent-message` noting config changed

#### Scenario: Session info update (session_info_update)
- **WHEN** the agent sends `{ sessionUpdate: "session_info_update" }`
- **THEN** the client SHALL emit `event:agent-message` with session metadata

#### Scenario: Usage update (usage_update)
- **WHEN** the agent sends `{ sessionUpdate: "usage_update", used: 5000, size: 200000 }`
- **THEN** the client SHALL emit `event:agent-message` with context window usage info

#### Scenario: Agent streaming output
- **WHEN** the agent sends multiple `session/update` notifications for a single response
- **THEN** the client SHALL accumulate the content and emit `event:agent-message` events as they arrive

### Requirement: ACP client SHALL handle non-text ContentBlock types gracefully

#### Scenario: Image content block
- **WHEN** the agent sends `{ sessionUpdate: "agent_message_chunk", content: { type: "image", ... } }`
- **THEN** the client SHALL emit `event:agent-message` with `"[image]"` placeholder
- **AND** the client SHALL NOT crash on unknown content types

#### Scenario: Audio content block
- **WHEN** the agent sends `{ sessionUpdate: "agent_message_chunk", content: { type: "audio", ... } }`
- **THEN** the client SHALL emit `event:agent-message` with `"[audio]"` placeholder

#### Scenario: Resource link content block
- **WHEN** the agent sends `{ sessionUpdate: "agent_message_chunk", content: { type: "resource_link", uri: "file:///..." } }`
- **THEN** the client SHALL emit `event:agent-message` with the resource URI

### Requirement: ACP client SHALL handle initialize handshake

#### Scenario: Successful initialize
- **WHEN** the agent process responds with a valid `initialize` response containing `protocolVersion: 1` and `agentCapabilities`
- **THEN** the client SHALL store the agent capabilities and proceed to session creation

#### Scenario: Initialize timeout
- **WHEN** the agent process does not respond to `initialize` within 30 seconds
- **THEN** the client SHALL kill the agent process and emit `event:agent-spawn-failed`

#### Scenario: Protocol version mismatch
- **WHEN** the agent responds with a `protocolVersion` other than `1`
- **THEN** the client SHALL disconnect and emit `event:agent-spawn-failed`

### Requirement: ACP client SHALL support cancellation via session/cancel

#### Scenario: Cancel during active prompt
- **WHEN** the renderer invokes `agent:stop-session` while a `session/prompt` is in progress
- **THEN** the client SHALL send a `session/cancel` notification
- **AND** the client SHALL wait up to 5 seconds for the agent to respond, then SIGTERM/SIGKILL the process

### Requirement: ACP client SHALL handle agent process failures gracefully

#### Scenario: Agent process crashes
- **WHEN** the agent process exits with a non-zero code
- **THEN** the client SHALL emit `event:agent-message` with role `"system"` and the exit reason
- **AND** the session status SHALL be set to `"error"`

### Requirement: Custom command mode SHALL remain protocol-agnostic

#### Scenario: Custom command does not speak ACP
- **WHEN** a custom command does not respond to `initialize` within 15 seconds
- **THEN** the client SHALL fall back to treating each stdout line as a raw `"system"` message
- **AND** messages from the renderer SHALL be forwarded as raw JSON `{ "type": "message", "content": "..." }` lines
