---
change_id: "{{change_id}}"
source: "{{source}}"
---

# Wiki Diff

## Operations

### add_current_state

**Target:** `wiki/pages/...`
**Source:** {{source}}

```
Content to append to Current State section.
```

### add_knowledge_timeline

**Target:** `wiki/characters/...`
**Source:** {{source}}

| Chapter | Knowledge |
|---------|-----------|
| <!-- chapter or source ref --> | <!-- description --> |

### update_relationship

**Target:** `wiki/characters/...`
**Source:** {{source}}

- Related Entity: <!-- name -->
- Relationship: <!-- description -->

### update_thread_status

**Target:** `wiki/threads/...`
**Source:** {{source}}

- Status: <!-- open / advanced / resolved -->
- Evidence:
  - <!-- citation -->

### add_evidence

**Target:** `wiki/...`
**Source:** {{source}}

- Evidence: <!-- description -->

### flag_contradiction

**Target:** `wiki/contradictions.md`
**Source:** {{source}}

- Description: <!-- description -->
- Status: <!-- unresolved / explained / retconned -->

### update_field

**Target:** `wiki/...`
**Source:** {{source}}

- Field: <!-- frontmatter field -->
- Value: <!-- new value -->
