# Temporal Graph MCP Tools Reference

Complete reference for all 14 MCP tools in the Temporal Graph Database system.

## Overview

The Temporal Graph Database exposes 14 MCP tools organized into 5 categories:

1. **Document Operations** (4 tools) - Create, read, update, delete
2. **Search & Discovery** (2 tools) - Search and explore
3. **Relationships** (1 tool) - Create connections
4. **Navigation** (2 tools) - Open nodes and map graph
5. **History & Analysis** (5 tools) - Timeline, comparison, time-based queries

## Tool Categories

### 1. Document Operations

#### `graph_add_document`
Create new documents in the graph.

**Parameters:**
- `id`: Unique identifier
- `content`: Document text content
- `metadata`: Optional metadata (tags, type, author, etc.)

**Example:**
```json
{
  "id": "contract_2024_v1",
  "content": "Service Agreement...",
  "metadata": {
    "type": "contract",
    "tags": ["legal", "active"],
    "author": "Alice",
    "status": "draft"
  }
}
```

#### `graph_get_document`
Read one or more documents by ID.

**Parameters:**
- `id`: Document ID
- `at_time`: Optional ISO timestamp to read historical versions

**Example:**
```json
{
  "id": "contract_2024_v1",
  "at_time": "2024-01-15T10:00:00Z"
}
```

#### `graph_update_document`
Update existing documents with new content or metadata.

**Parameters:**
- `id`: Document ID to update
- `content`: Optional new content
- `metadata`: Optional new metadata
- `merge_metadata`: Boolean - merge (true) or replace (false)
- `valid_from`: Optional ISO timestamp

**Example:**
```json
{
  "id": "contract_2024_v1",
  "metadata": {
    "status": "final",
    "reviewed_by": "Bob"
  },
  "merge_metadata": true
}
```

#### `graph_delete_document`
Soft-delete documents (marks as deleted, preserves history).

**Parameters:**
- `id`: Document ID to delete

**Example:**
```json
{
  "id": "old_draft"
}
```

### 2. Search & Discovery

#### `graph_search`
Search for documents using text queries and metadata filters.

**Parameters:**
- `query`: Optional full-text search string
- `filters`: Optional filters object
  - `tags`: Array of tags (must have ALL)
  - `type`: Document type filter
  - `path_prefix`: Path hierarchy filter
  - `author`: Author filter
  - `created_after`: ISO timestamp
- `limit`: Maximum results (default: 10)
- `sort_by`: Sort field (default: created_at)
- `sort_order`: Sort order (default: desc)
- `at_time`: Optional temporal query

**Example:**
```json
{
  "query": "service agreement",
  "filters": {
    "tags": ["legal", "active"],
    "type": "contract",
    "created_after": "2024-01-01T00:00:00Z"
  },
  "limit": 10,
  "at_time": "2024-02-01T00:00:00Z"
}
```

#### `graph_explore`
Explore graph from a starting node using BFS.

**Parameters:**
- `start`: Starting node ID
- `strategy`: Exploration strategy ("breadth", "depth", "relationship")
- `max_depth`: Maximum depth to explore (default: 3)
- `max_nodes`: Maximum nodes to return (default: 50)
- `follow_relations`: Optional array of relationship types
- `filters`: Optional node filters (tags, type)
- `at_time`: Optional temporal query

**Example:**
```json
{
  "start": "project_plan",
  "strategy": "breadth",
  "max_depth": 2,
  "follow_relations": ["references", "depends_on"],
  "filters": {
    "tags": ["active"]
  }
}
```

### 3. Relationships

#### `create_relations`
Create relationships (edges) between documents.

**Parameters:**
- `relations`: Array of relationships
  - `from`: Source document ID
  - `to`: Target document ID
  - `relation`: Relationship type (e.g., "references", "cites")
  - `metadata`: Optional edge metadata
  - `valid_from`: Optional timestamp

**Example:**
```json
{
  "relations": [
    {
      "from": "email_2024_03_15",
      "to": "contract_2024_v1",
      "relation": "discusses",
      "valid_from": "2024-03-15T10:00:00Z"
    }
  ]
}
```

### 4. Navigation

#### `open_nodes`
Open a document with its immediate neighbors.

**Parameters:**
- `id`: Document ID to open
- `depth`: Relationship depth (default: 1)
- `at_time`: Optional temporal query

**Example:**
```json
{
  "id": "contract_2024_v1",
  "depth": 2,
  "at_time": "2024-02-01T00:00:00Z"
}
```

#### `graph_map`
Generate comprehensive graph visualization.

**Parameters:**
- `scope`: Map scope ("all", "filtered", "subgraph", "temporal_slice")
- `filters`: Optional filters (tags, type, etc.)
- `focus_nodes`: Optional array of focus nodes (for subgraph)
- `radius`: Subgraph radius (default: 2)
- `at_time`: Optional temporal query
- `max_nodes`: Maximum nodes (default: 100)
- `max_edges`: Maximum edges (default: 500)
- `include_metadata`: Include metadata (default: true)
- `include_content_preview`: Include previews (default: true)
- `include_stats`: Include statistics (default: true)
- `format`: Output format ("json" or "mermaid")

**Example - Filtered Map:**
```json
{
  "scope": "filtered",
  "filters": {
    "tags": ["legal"]
  },
  "format": "mermaid"
}
```

**Example - Subgraph:**
```json
{
  "scope": "subgraph",
  "focus_nodes": ["contract_2024_v1", "amendment_1"],
  "radius": 2,
  "format": "json",
  "include_stats": true
}
```

### 5. History & Analysis

#### `graph_get_document_timeline`
Get complete change history for a document.

**Parameters:**
- `id`: Document ID

**Returns:**
- Array of timeline events with:
  - `timestamp`: When change occurred
  - `event`: "created", "updated", or "deleted"
  - `version`: Version number
  - `changes`: Array of change descriptions
  - `content_preview`: Preview of content at that version

**Example:**
```json
{
  "id": "contract_2024_v1"
}
```

#### `graph_compare_versions`
Compare two versions of a document.

**Parameters:**
- `id`: Document ID
- `version1`: First version number
- `version2`: Second version number

**Returns:**
- Both versions with detailed differences

**Example:**
```json
{
  "id": "contract_2024_v1",
  "version1": 1,
  "version2": 3
}
```

#### `graph_get_created_between`
Get documents created in a date range.

**Parameters:**
- `start`: Start ISO timestamp
- `end`: End ISO timestamp

**Example:**
```json
{
  "start": "2024-01-01T00:00:00Z",
  "end": "2024-03-31T23:59:59Z"
}
```

#### `graph_get_modified_between`
Get documents modified in a date range.

**Parameters:**
- `start`: Start ISO timestamp
- `end`: End ISO timestamp

**Example:**
```json
{
  "start": "2024-04-01T00:00:00Z",
  "end": "2024-04-30T23:59:59Z"
}
```

#### `graph_get_deleted_between`
Get documents deleted in a date range.

**Parameters:**
- `start`: Start ISO timestamp
- `end`: End ISO timestamp

**Example:**
```json
{
  "start": "2024-05-01T00:00:00Z",
  "end": "2024-05-31T23:59:59Z"
}
```

## Common Patterns

### Temporal Queries
Many tools support `at_time` parameter for historical queries:

```json
// Read document as it existed on Jan 15
{
  "id": "doc1",
  "at_time": "2024-01-15T00:00:00Z"
}

// Search documents as of Feb 1
{
  "query": "contract",
  "at_time": "2024-02-01T00:00:00Z"
}

// Explore graph as it was on Mar 1
{
  "start": "project",
  "strategy": "breadth",
  "at_time": "2024-03-01T00:00:00Z"
}
```

### Metadata Patterns
Rich metadata for organization:

```json
{
  "type": "contract",
  "tags": ["legal", "active", "urgent"],
  "status": "draft",
  "author": "Alice",
  "priority": "high",
  "emoji": "📄",
  "keywords": ["services", "payment", "terms"]
}
```

### Relationship Types
Common relationship patterns:

- `references` - Document references another
- `cites` - Formal citation
- `discusses` - Email discusses document
- `amends` - Amendment to original
- `depends_on` - Dependency relationship
- `related` - Generic relationship

## Best Practices

1. **Use meaningful IDs**: `contract_2024_v1` better than `doc1`
2. **Tag consistently**: Use standardized tag sets
3. **Set timestamps**: Use `valid_from` for accurate temporal tracking
4. **Merge metadata**: Use `merge_metadata: true` to preserve existing fields
5. **Explore before mapping**: Use `graph_explore` for focused areas, `graph_map` for overview
6. **Limit results**: Use `max_nodes` to prevent overwhelming responses

## Error Handling

All tools return structured responses:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Document not found: doc1"
}
```

## Tool Count Summary

- **Total Tools**: 14
- **Document Operations**: 4
- **Search & Discovery**: 2
- **Relationships**: 1
- **Navigation**: 2
- **History & Analysis**: 5

All tools support temporal queries where applicable, enabling full time-travel capabilities across your document graph.