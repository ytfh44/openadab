---
change_id: "{{change_id}}"
source_chapter: "{{chapter}}"
---

# Wiki Diff

## Operations

### add_current_state

**Target:** `wiki/pages/...`
**Source:** Chapter {{chapter}}, Scene ...

```
Content to append to Current State section.
```

### add_knowledge_timeline

**Target:** `wiki/characters/...`
**Source:** Chapter {{chapter}}, Scene ...

| Chapter | Knowledge |
|---------|-----------|
| {{chapter}} | <!-- description --> |

### update_relationship

**Target:** `wiki/characters/...`
**Source:** Chapter {{chapter}}, Scene ...

- Related Entity: <!-- name -->
- Relationship: <!-- description -->

### update_thread_status

**Target:** `wiki/threads/...`
**Source:** Chapter {{chapter}}, Scene ...

- Status: <!-- open / advanced / resolved -->
- Evidence:
  - <!-- citation -->

### add_evidence

**Target:** `wiki/...`
**Source:** Chapter {{chapter}}, Scene ...

- Evidence: <!-- description -->

### flag_contradiction

**Target:** `wiki/contradictions.md`
**Source:** Chapter {{chapter}}, Scene ...

- Description: <!-- description -->
- Status: <!-- unresolved / explained / retconned -->

### update_field

**Target:** `wiki/...`
**Source:** Chapter {{chapter}}, Scene ...

- Field: <!-- frontmatter field -->
- Value: <!-- new value -->
