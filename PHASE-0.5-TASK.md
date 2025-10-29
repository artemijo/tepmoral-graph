# Phase 0.5: Rich Metadata + Smart Tag Tool 📋

**Goal:** Add rich metadata support + one universal tag tool  
**Total Time:** ~3-4 hours  
**Tools After Phase 0.5:** 8 total

---

## Task 0.5.1: Update Types for Rich Metadata
**Priority:** Critical 🔴  
**Estimated Time:** 15 minutes  
**File:** `src/types/index.ts`

### Description
Add rich metadata type definition with all JSON fields.

### Code to Add
```typescript
// Replace the existing Node interface with this enhanced version:

export interface RichMetadata {
  // Your JSON ideas
  vocabulary?: Record<string, string> | string[];  // Term definitions
  map?: Record<string, any>;                       // Document structure map
  emoji?: string;                                   // Visual identifier
  tags?: string[];                                  // Categories/labels
  path?: string[];                                  // Hierarchical location
  keywords?: string[];                              // Key concepts
  
  // Standard metadata
  type?: string;                                    // Document type
  author?: string;                                  // Creator
  date?: string;                                    // ISO date string
  
  // Custom fields (allow anything)
  [key: string]: any;
}

export interface Node {
  id: string;
  content: string;
  metadata?: RichMetadata;  // ← Now using RichMetadata
  created_at?: string;
  
  // Temporal fields (for Phase 1)
  valid_from?: string;
  valid_until?: string;
  version?: number;
  supersedes?: string;
}

export interface AddNodeInput {
  id: string;
  content: string;
  type?: string;
  metadata?: RichMetadata;  // ← Now using RichMetadata
  
  // Temporal fields (for Phase 1)
  valid_from?: string;
  version?: number;
}

// Add search options type
export interface SearchOptions {
  query?: string;                    // Full-text search
  filters?: {
    tags?: string[];                 // Must have ALL these tags
    keywords?: string[];             // Must have ALL these keywords
    path_prefix?: string[];          // Path starts with...
    emoji?: string;                  // Has this emoji
    type?: string;                   // Document type
    author?: string;                 // Created by
    [key: string]: any;              // Custom filters
  };
  limit?: number;
  sort_by?: 'created_at' | 'id';
  sort_order?: 'asc' | 'desc';
}

// Add tag operation type
export interface TagOperation {
  action: 'add' | 'remove' | 'rename' | 'list' | 'get';
  document_id?: string;
  document_filter?: {
    tags?: string[];
    keywords?: string[];
    path?: string[];
    content?: string;
  };
  tags?: string[];
  rename?: {
    from: string;
    to: string;
  };
}
```

### Acceptance Criteria
- [ ] All types compile without errors
- [ ] RichMetadata includes all 6 JSON ideas
- [ ] SearchOptions type defined
- [ ] TagOperation type defined

### Test
```bash
npm run build
```

---

## Task 0.5.2: Add Search Method to Database
**Priority:** Critical 🔴  
**Estimated Time:** 45 minutes  
**File:** `src/storage/database.ts`

### Description
Implement smart search with metadata filtering using SQLite JSON functions.

### Code to Add
```typescript
// Add this method to GraphDB class (after searchContent method):

/**
 * Smart search with rich metadata filtering
 */
searchDocuments(options: SearchOptions): Node[] {
  let sql = 'SELECT * FROM nodes WHERE 1=1';
  const params: any[] = [];
  
  // Full-text search on content
  if (options.query) {
    sql += ` AND id IN (
      SELECT id FROM nodes_fts 
      WHERE nodes_fts MATCH ?
    )`;
    params.push(options.query);
  }
  
  // Apply metadata filters
  if (options.filters) {
    const { tags, keywords, path_prefix, emoji, type, author } = options.filters;
    
    // Filter by tags (must have ALL specified tags)
    if (tags && tags.length > 0) {
      for (const tag of tags) {
        sql += ` AND EXISTS (
          SELECT 1 FROM json_each(json_extract(metadata, '$.tags'))
          WHERE value = ?
        )`;
        params.push(tag);
      }
    }
    
    // Filter by keywords (must have ALL specified keywords)
    if (keywords && keywords.length > 0) {
      for (const keyword of keywords) {
        sql += ` AND EXISTS (
          SELECT 1 FROM json_each(json_extract(metadata, '$.keywords'))
          WHERE value = ?
        )`;
        params.push(keyword);
      }
    }
    
    // Filter by path prefix
    if (path_prefix && path_prefix.length > 0) {
      // Check if document's path starts with the specified prefix
      const pathJson = JSON.stringify(path_prefix);
      sql += ` AND (
        json_extract(metadata, '$.path') IS NOT NULL
        AND substr(json_extract(metadata, '$.path'), 1, ?) = ?
      )`;
      params.push(pathJson.length, pathJson);
    }
    
    // Filter by emoji
    if (emoji) {
      sql += ` AND json_extract(metadata, '$.emoji') = ?`;
      params.push(emoji);
    }
    
    // Filter by type
    if (type) {
      sql += ` AND json_extract(metadata, '$.type') = ?`;
      params.push(type);
    }
    
    // Filter by author
    if (author) {
      sql += ` AND json_extract(metadata, '$.author') = ?`;
      params.push(author);
    }
    
    // Handle custom filters
    for (const [key, value] of Object.entries(options.filters)) {
      if (!['tags', 'keywords', 'path_prefix', 'emoji', 'type', 'author'].includes(key)) {
        sql += ` AND json_extract(metadata, '$.${key}') = ?`;
        params.push(value);
      }
    }
  }
  
  // Sorting
  const sortBy = options.sort_by || 'created_at';
  const sortOrder = options.sort_order || 'desc';
  sql += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
  
  // Limit
  const limit = options.limit || 10;
  sql += ` LIMIT ?`;
  params.push(limit);
  
  const stmt = this.db.prepare(sql);
  const rows = stmt.all(...params) as any[];
  
  return rows.map(row => this.rowToNode(row)!);
}

/**
 * List documents grouped by path
 */
listDocumentsByPath(): Record<string, Node[]> {
  const stmt = this.db.prepare(`
    SELECT * FROM nodes 
    WHERE json_extract(metadata, '$.path') IS NOT NULL
    ORDER BY created_at DESC
  `);
  
  const rows = stmt.all() as any[];
  const grouped: Record<string, Node[]> = {};
  
  for (const row of rows) {
    const node = this.rowToNode(row)!;
    if (node.metadata?.path) {
      const pathStr = node.metadata.path.join('/');
      
      if (!grouped[pathStr]) {
        grouped[pathStr] = [];
      }
      grouped[pathStr].push(node);
    }
  }
  
  return grouped;
}

/**
 * Get metadata statistics (all tags, keywords, emojis used)
 */
getMetadataStats(): {
  tags: Record<string, number>;
  keywords: Record<string, number>;
  emojis: Record<string, number>;
  types: Record<string, number>;
  paths: string[];
} {
  const stmt = this.db.prepare('SELECT metadata FROM nodes WHERE metadata IS NOT NULL');
  const rows = stmt.all() as any[];
  
  const stats = {
    tags: {} as Record<string, number>,
    keywords: {} as Record<string, number>,
    emojis: {} as Record<string, number>,
    types: {} as Record<string, number>,
    paths: [] as string[]
  };
  
  const seenPaths = new Set<string>();
  
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata) as RichMetadata;
      
      // Count tags
      if (meta.tags && Array.isArray(meta.tags)) {
        meta.tags.forEach(tag => {
          stats.tags[tag] = (stats.tags[tag] || 0) + 1;
        });
      }
      
      // Count keywords
      if (meta.keywords && Array.isArray(meta.keywords)) {
        meta.keywords.forEach(kw => {
          stats.keywords[kw] = (stats.keywords[kw] || 0) + 1;
        });
      }
      
      // Count emojis
      if (meta.emoji) {
        stats.emojis[meta.emoji] = (stats.emojis[meta.emoji] || 0) + 1;
      }
      
      // Count types
      if (meta.type) {
        stats.types[meta.type] = (stats.types[meta.type] || 0) + 1;
      }
      
      // Collect unique paths
      if (meta.path && Array.isArray(meta.path)) {
        const pathStr = meta.path.join('/');
        if (!seenPaths.has(pathStr)) {
          stats.paths.push(pathStr);
          seenPaths.add(pathStr);
        }
      }
    } catch (error) {
      // Skip invalid JSON
      console.error('Invalid metadata JSON:', error);
    }
  }
  
  return stats;
}
```

### Acceptance Criteria
- [ ] `searchDocuments()` method works with all filters
- [ ] `listDocumentsByPath()` groups by path
- [ ] `getMetadataStats()` returns counts
- [ ] Code compiles

### Test
```bash
npm run build
```

---

## Task 0.5.3: Add Tag Operations to Database
**Priority:** Critical 🔴  
**Estimated Time:** 40 minutes  
**File:** `src/storage/database.ts`

### Description
Implement the universal tag operations method.

### Code to Add
```typescript
// Add this method to GraphDB class:

/**
 * Universal tag operations
 */
performTagOperation(operation: TagOperation): any {
  const { action, document_id, document_filter, tags, rename } = operation;
  
  switch (action) {
    case 'add':
      return this.addTagsToDocuments(document_id, document_filter, tags!);
    
    case 'remove':
      return this.removeTagsFromDocuments(document_id, document_filter, tags!);
    
    case 'rename':
      return this.renameTag(rename!.from, rename!.to);
    
    case 'list':
      return this.listAllTags();
    
    case 'get':
      return this.getDocumentTags(document_id!);
    
    default:
      throw new Error(`Unknown tag action: ${action}`);
  }
}

/**
 * Add tags to document(s)
 */
private addTagsToDocuments(
  documentId?: string,
  filter?: TagOperation['document_filter'],
  newTags: string[] = []
): { updated: number; documents: string[] } {
  return this.transaction(() => {
    const targetDocs = this.getTargetDocuments(documentId, filter);
    const updatedDocs: string[] = [];
    
    for (const doc of targetDocs) {
      const currentTags = doc.metadata?.tags || [];
      const updatedTags = Array.from(new Set([...currentTags, ...newTags]));
      
      const stmt = this.db.prepare(`
        UPDATE nodes 
        SET metadata = json_set(
          COALESCE(metadata, '{}'),
          '$.tags',
          ?
        )
        WHERE id = ?
      `);
      
      stmt.run(JSON.stringify(updatedTags), doc.id);
      updatedDocs.push(doc.id);
    }
    
    return {
      updated: updatedDocs.length,
      documents: updatedDocs
    };
  });
}

/**
 * Remove tags from document(s)
 */
private removeTagsFromDocuments(
  documentId?: string,
  filter?: TagOperation['document_filter'],
  tagsToRemove: string[] = []
): { updated: number; documents: string[] } {
  return this.transaction(() => {
    const targetDocs = this.getTargetDocuments(documentId, filter);
    const updatedDocs: string[] = [];
    
    for (const doc of targetDocs) {
      const currentTags = doc.metadata?.tags || [];
      const updatedTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
      
      const stmt = this.db.prepare(`
        UPDATE nodes 
        SET metadata = json_set(
          metadata,
          '$.tags',
          ?
        )
        WHERE id = ?
      `);
      
      stmt.run(JSON.stringify(updatedTags), doc.id);
      updatedDocs.push(doc.id);
    }
    
    return {
      updated: updatedDocs.length,
      documents: updatedDocs
    };
  });
}

/**
 * Rename a tag across all documents
 */
private renameTag(oldTag: string, newTag: string): { updated: number } {
  return this.transaction(() => {
    // Find all docs with the old tag
    const stmt = this.db.prepare(`
      SELECT id, metadata FROM nodes
      WHERE EXISTS (
        SELECT 1 FROM json_each(json_extract(metadata, '$.tags'))
        WHERE value = ?
      )
    `);
    
    const rows = stmt.all(oldTag) as any[];
    let updated = 0;
    
    for (const row of rows) {
      const meta = JSON.parse(row.metadata) as RichMetadata;
      if (meta.tags) {
        meta.tags = meta.tags.map(tag => tag === oldTag ? newTag : tag);
        
        const updateStmt = this.db.prepare(`
          UPDATE nodes 
          SET metadata = ?
          WHERE id = ?
        `);
        
        updateStmt.run(JSON.stringify(meta), row.id);
        updated++;
      }
    }
    
    return { updated };
  });
}

/**
 * List all tags with counts
 */
private listAllTags(): { tag: string; count: number }[] {
  const stats = this.getMetadataStats();
  
  return Object.entries(stats.tags)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get tags for a specific document
 */
private getDocumentTags(documentId: string): string[] {
  const node = this.getNode(documentId);
  if (!node) {
    throw new Error(`Document not found: ${documentId}`);
  }
  return node.metadata?.tags || [];
}

/**
 * Helper: Get documents matching ID or filter
 */
private getTargetDocuments(
  documentId?: string,
  filter?: TagOperation['document_filter']
): Node[] {
  if (documentId) {
    const node = this.getNode(documentId);
    if (!node) {
      throw new Error(`Document not found: ${documentId}`);
    }
    return [node];
  }
  
  if (filter) {
    return this.searchDocuments({
      query: filter.content,
      filters: {
        tags: filter.tags,
        keywords: filter.keywords,
        path_prefix: filter.path
      },
      limit: 1000 // Max docs to update at once
    });
  }
  
  throw new Error('Must specify either document_id or document_filter');
}
```

### Acceptance Criteria
- [ ] `performTagOperation()` handles all 5 actions
- [ ] Tag operations work in transactions
- [ ] Bulk operations supported via filters
- [ ] Code compiles

### Test
```bash
npm run build
```

---

## Task 0.5.4: Update GraphAPI
**Priority:** High 🟡  
**Estimated Time:** 20 minutes  
**File:** `src/api/graph-api.ts`

### Description
Expose new methods in the API layer.

### Code to Add
```typescript
// Add these imports at the top:
import type {
  SearchOptions,
  TagOperation,
  // ... existing imports
} from '../types/index.js';

// Add these methods to GraphAPI class:

// ==================== RICH METADATA & SEARCH ====================

/**
 * Smart search with metadata filtering
 */
search(options: SearchOptions): Node[] {
  return this.db.searchDocuments(options);
}

/**
 * List documents grouped by path
 */
listByPath(): Record<string, Node[]> {
  return this.db.listDocumentsByPath();
}

/**
 * Get metadata statistics
 */
getMetadataStats(): {
  tags: Record<string, number>;
  keywords: Record<string, number>;
  emojis: Record<string, number>;
  types: Record<string, number>;
  paths: string[];
} {
  return this.db.getMetadataStats();
}

// ==================== TAG OPERATIONS ====================

/**
 * Universal tag operations
 */
manageTags(operation: TagOperation): any {
  return this.db.performTagOperation(operation);
}

// Convenience methods (shortcuts for common operations)
addTags(documentId: string, tags: string[]): { updated: number; documents: string[] } {
  return this.manageTags({
    action: 'add',
    document_id: documentId,
    tags
  });
}

removeTags(documentId: string, tags: string[]): { updated: number; documents: string[] } {
  return this.manageTags({
    action: 'remove',
    document_id: documentId,
    tags
  });
}

getTags(documentId: string): string[] {
  return this.manageTags({
    action: 'get',
    document_id: documentId
  });
}

listTags(): { tag: string; count: number }[] {
  return this.manageTags({
    action: 'list'
  });
}
```

### Acceptance Criteria
- [ ] All methods exposed in API
- [ ] Imports updated
- [ ] Code compiles

### Test
```bash
npm run build
```

---

## Task 0.5.5: Add MCP Tools
**Priority:** High 🟡  
**Estimated Time:** 30 minutes  
**File:** `src/mcp/tools.ts`

### Description
Add/update MCP tools for rich metadata and tags.

### Code to Replace/Add
```typescript
// Replace the entire tools array with this:

export const tools = [
  // ==================== DOCUMENT TOOLS ====================
  
  {
    name: 'graph_add_document',
    description: 'Add or update document with rich metadata (tags, path, emoji, vocabulary, map, keywords)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique document identifier'
        },
        content: {
          type: 'string',
          description: 'Document content (will be vectorized for semantic search)'
        },
        metadata: {
          type: 'object',
          description: 'Rich metadata with tags, path, emoji, keywords, vocabulary, map, and custom fields',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization (e.g., ["legal", "urgent"])'
            },
            path: {
              type: 'array',
              items: { type: 'string' },
              description: 'Hierarchical path (e.g., ["projects", "2024", "contracts"])'
            },
            emoji: {
              type: 'string',
              description: 'Visual identifier (e.g., "📄", "🔥", "⚖️")'
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Key concepts (e.g., ["payment", "deadline"])'
            },
            vocabulary: {
              type: 'object',
              description: 'Term definitions (e.g., {"FOB": "Free On Board"})'
            },
            map: {
              type: 'object',
              description: 'Document structure map (e.g., {"intro": "lines 1-10"})'
            },
            type: {
              type: 'string',
              description: 'Document type (e.g., "contract", "email")'
            },
            author: {
              type: 'string',
              description: 'Document author'
            },
            date: {
              type: 'string',
              description: 'ISO date string'
            }
          }
        }
      },
      required: ['id', 'content']
    }
  },
  
  {
    name: 'graph_get_document',
    description: 'Get document by ID with all metadata',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' }
      },
      required: ['id']
    }
  },
  
  {
    name: 'graph_search',
    description: 'Smart search: full-text search with metadata filtering (tags, path, emoji, keywords, type)',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Full-text search query (optional)'
        },
        filters: {
          type: 'object',
          description: 'Filter by metadata fields',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Documents must have ALL these tags'
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Documents must have ALL these keywords'
            },
            path_prefix: {
              type: 'array',
              items: { type: 'string' },
              description: 'Path must start with this prefix'
            },
            emoji: {
              type: 'string',
              description: 'Filter by emoji'
            },
            type: {
              type: 'string',
              description: 'Filter by document type'
            },
            author: {
              type: 'string',
              description: 'Filter by author'
            }
          }
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)'
        },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'id'],
          description: 'Sort field (default: created_at)'
        },
        sort_order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order (default: desc)'
        }
      }
    }
  },
  
  {
    name: 'graph_list_documents',
    description: 'List documents with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum documents to return (default: 100)'
        }
      }
    }
  },
  
  {
    name: 'graph_delete_document',
    description: 'Delete a document and all its relationships',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID to delete' }
      },
      required: ['id']
    }
  },
  
  // ==================== TAG TOOL ====================
  
  {
    name: 'graph_tags',
    description: 'Manage tags: add, remove, rename, list, or get document tags',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'rename', 'list', 'get'],
          description: 'Tag operation: add/remove tags, rename globally, list all, get doc tags'
        },
        document_id: {
          type: 'string',
          description: 'Target document ID (for add, remove, get actions)'
        },
        document_filter: {
          type: 'object',
          description: 'Filter documents for bulk operations',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
            keywords: { type: 'array', items: { type: 'string' } },
            path: { type: 'array', items: { type: 'string' } },
            content: { type: 'string' }
          }
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to add or remove'
        },
        rename: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' }
          },
          description: 'Rename tag globally (all documents)'
        }
      },
      required: ['action']
    }
  },
  
  // ==================== RELATIONSHIP TOOLS ====================
  
  {
    name: 'graph_add_relationship',
    description: 'Create directed relationship between documents',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source document ID' },
        to: { type: 'string', description: 'Target document ID' },
        relation: {
          type: 'string',
          description: 'Relationship type (e.g., "amends", "cites", "depends_on")'
        },
        metadata: {
          type: 'object',
          description: 'Optional relationship metadata'
        }
      },
      required: ['from', 'to']
    }
  },
  
  {
    name: 'graph_get_neighbors',
    description: 'Get neighboring documents connected by relationships',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
        direction: {
          type: 'string',
          enum: ['incoming', 'outgoing', 'both'],
          description: 'Direction of relationships (default: both)'
        }
      },
      required: ['id']
    }
  },
  
  {
    name: 'graph_find_path',
    description: 'Find shortest path between two documents',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Starting document ID' },
        to: { type: 'string', description: 'Target document ID' },
        maxDepth: {
          type: 'number',
          description: 'Maximum path depth (default: 5)'
        }
      },
      required: ['from', 'to']
    }
  },
  
  {
    name: 'graph_find_similar',
    description: 'Find semantically similar documents using vector embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
        limit: {
          type: 'number',
          description: 'Maximum similar documents (default: 10)'
        }
      },
      required: ['id']
    }
  },
  
  // ==================== STATS TOOL ====================
  
  {
    name: 'graph_stats',
    description: 'Get graph statistics and metadata overview (tag counts, keywords, emojis, paths)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
```

### Acceptance Criteria
- [ ] 10 tools defined (was 12+ before!)
- [ ] `graph_search` replaces `graph_search_content`
- [ ] `graph_tags` is the universal tag tool
- [ ] All schemas valid

### Test
```bash
npm run build
```

---

## Task 0.5.6: Add MCP Handlers
**Priority:** High 🟡  
**Estimated Time:** 30 minutes  
**File:** `src/mcp/server.ts`

### Description
Add handlers for new/updated tools.

### Code to Add/Update
```typescript
// In setupHandlers() method, UPDATE the switch statement:

switch (name) {
  case 'graph_add_document':
    return await this.handleAddDocument(args);
  
  case 'graph_get_document':
    return this.handleGetDocument(args);
  
  case 'graph_search':  // ← NEW (replaces graph_search_content)
    return this.handleSearch(args);
  
  case 'graph_list_documents':
    return this.handleListDocuments(args);
  
  case 'graph_delete_document':
    return this.handleDeleteDocument(args);
  
  case 'graph_tags':  // ← NEW
    return this.handleTags(args);
  
  case 'graph_add_relationship':
    return this.handleAddRelationship(args);
  
  case 'graph_get_neighbors':
    return this.handleGetNeighbors(args);
  
  case 'graph_find_path':
    return this.handleFindPath(args);
  
  case 'graph_find_similar':
    return await this.handleFindSimilar(args);
  
  case 'graph_stats':  // ← UPDATED
    return this.handleStats();
  
  default:
    throw new Error(`Unknown tool: ${name}`);
}

// ADD these new handler methods:

private handleSearch(args: any) {
  const results = this.api.search({
    query: args.query,
    filters: args.filters,
    limit: args.limit,
    sort_by: args.sort_by,
    sort_order: args.sort_order
  });
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          query: args.query,
          filters: args.filters,
          count: results.length,
          results
        }, null, 2)
      }
    ]
  };
}

private handleTags(args: any) {
  const result = this.api.manageTags({
    action: args.action,
    document_id: args.document_id,
    document_filter: args.document_filter,
    tags: args.tags,
    rename: args.rename
  });
  
  // Format response based on action
  let message = '';
  switch (args.action) {
    case 'add':
      message = `✅ Added ${args.tags?.length || 0} tag(s) to ${result.updated} document(s)`;
      break;
    case 'remove':
      message = `✅ Removed ${args.tags?.length || 0} tag(s) from ${result.updated} document(s)`;
      break;
    case 'rename':
      message = `✅ Renamed tag "${args.rename.from}" → "${args.rename.to}" in ${result.updated} document(s)`;
      break;
    case 'list':
      message = `📊 Found ${result.length} unique tags`;
      break;
    case 'get':
      message = `📋 Document has ${result.length} tag(s)`;
      break;
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          message,
          result
        }, null, 2)
      }
    ]
  };
}

// UPDATE handleStats to include metadata stats:
private handleStats() {
  const graphStats = this.api.getStats();
  const metadataStats = this.api.getMetadataStats();
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          graph: graphStats,
          metadata: {
            tags: Object.keys(metadataStats.tags).length,
            keywords: Object.keys(metadataStats.keywords).length,
            emojis: Object.keys(metadataStats.emojis).length,
            types: Object.keys(metadataStats.types).length,
            paths: metadataStats.paths.length,
            top_tags: Object.entries(metadataStats.tags)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([tag, count]) => ({ tag, count })),
            top_emojis: Object.entries(metadataStats.emojis)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([emoji, count]) => ({ emoji, count }))
          }
        }, null, 2)
      }
    ]
  };
}

// REMOVE old handlers (if they exist):
// - handleSearchContent (replaced by handleSearch)
```

### Acceptance Criteria
- [ ] `handleSearch()` implemented
- [ ] `handleTags()` implemented with all 5 actions
- [ ] `handleStats()` updated with metadata stats
- [ ] Old handlers removed

### Test
```bash
npm run build
```

---

## Task 0.5.7: Write Rich Metadata Tests
**Priority:** High 🟡  
**Estimated Time:** 35 minutes  
**File:** `tests/rich-metadata.test.ts` (NEW FILE)

### Description
Test all rich metadata features and search capabilities.

### Code to Add
```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';
import type { RichMetadata } from '../src/types';

describe('Rich Metadata', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(':memory:');
  });

  describe('Adding Documents with Rich Metadata', () => {
    test('should add document with all metadata fields', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Legal contract for equipment purchase',
        metadata: {
          tags: ['legal', 'contract', 'urgent'],
          path: ['contracts', '2024', 'Q1'],
          emoji: '📄',
          keywords: ['payment', 'delivery', 'warranty'],
          vocabulary: {
            'FOB': 'Free On Board',
            'Net 30': 'Payment due 30 days after invoice'
          },
          map: {
            'section_1': 'parties involved',
            'section_2': 'payment terms',
            'section_3': 'delivery schedule'
          },
          type: 'contract',
          author: 'John Doe',
          date: '2024-01-15'
        }
      });

      const doc = db.getNode('doc1');
      expect(doc).toBeDefined();
      expect(doc?.metadata?.tags).toEqual(['legal', 'contract', 'urgent']);
      expect(doc?.metadata?.emoji).toBe('📄');
      expect(doc?.metadata?.keywords).toHaveLength(3);
      expect(doc?.metadata?.vocabulary).toHaveProperty('FOB');
      expect(doc?.metadata?.map).toHaveProperty('section_1');
    });

    test('should handle minimal metadata', async () => {
      await db.addNode({
        id: 'doc2',
        content: 'Simple note',
        metadata: {
          tags: ['note']
        }
      });

      const doc = db.getNode('doc2');
      expect(doc?.metadata?.tags).toEqual(['note']);
    });
  });

  describe('Smart Search', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'contract1',
        content: 'Purchase agreement for equipment',
        metadata: {
          tags: ['legal', 'contract'],
          emoji: '📄',
          type: 'contract',
          author: 'Alice'
        }
      });

      await db.addNode({
        id: 'email1',
        content: 'Urgent email about payment deadline',
        metadata: {
          tags: ['urgent', 'email'],
          emoji: '📧',
          type: 'email',
          author: 'Bob'
        }
      });

      await db.addNode({
        id: 'note1',
        content: 'Meeting notes about legal matters',
        metadata: {
          tags: ['legal', 'meeting'],
          emoji: '📝',
          type: 'note',
          author: 'Alice'
        }
      });
    });

    test('should search by content only', () => {
      const results = db.searchDocuments({ query: 'payment' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('email1');
    });

    test('should filter by single tag', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal'] }
      });
      expect(results).toHaveLength(2);
      expect(results.map(d => d.id)).toContain('contract1');
      expect(results.map(d => d.id)).toContain('note1');
    });

    test('should filter by multiple tags (AND)', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal', 'contract'] }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by emoji', () => {
      const results = db.searchDocuments({
        filters: { emoji: '📄' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by type', () => {
      const results = db.searchDocuments({
        filters: { type: 'email' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('email1');
    });

    test('should filter by author', () => {
      const results = db.searchDocuments({
        filters: { author: 'Alice' }
      });
      expect(results).toHaveLength(2);
    });

    test('should combine content search and filters', () => {
      const results = db.searchDocuments({
        query: 'legal',
        filters: { type: 'contract' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by path prefix', async () => {
      await db.addNode({
        id: 'doc_path',
        content: 'Document in path',
        metadata: {
          path: ['projects', '2024', 'website']
        }
      });

      const results = db.searchDocuments({
        filters: { path_prefix: ['projects', '2024'] }
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc_path');
    });

    test('should respect limit', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal'] },
        limit: 1
      });
      expect(results).toHaveLength(1);
    });

    test('should sort results', () => {
      const resultsDesc = db.searchDocuments({
        filters: { author: 'Alice' },
        sort_by: 'created_at',
        sort_order: 'desc'
      });

      const resultsAsc = db.searchDocuments({
        filters: { author: 'Alice' },
        sort_by: 'created_at',
        sort_order: 'asc'
      });

      expect(resultsDesc[0].id).not.toBe(resultsAsc[0].id);
    });
  });

  describe('Tag Operations', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Document 1',
        metadata: { tags: ['draft'] }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Document 2',
        metadata: { tags: ['draft', 'legal'] }
      });
    });

    test('should add tags to document', () => {
      const result = db.performTagOperation({
        action: 'add',
        document_id: 'doc1',
        tags: ['urgent', 'legal']
      });

      expect(result.updated).toBe(1);
      
      const doc = db.getNode('doc1');
      expect(doc?.metadata?.tags).toContain('urgent');
      expect(doc?.metadata?.tags).toContain('legal');
      expect(doc?.metadata?.tags).toContain('draft');
    });

    test('should remove tags from document', () => {
      const result = db.performTagOperation({
        action: 'remove',
        document_id: 'doc2',
        tags: ['draft']
      });

      expect(result.updated).toBe(1);
      
      const doc = db.getNode('doc2');
      expect(doc?.metadata?.tags).not.toContain('draft');
      expect(doc?.metadata?.tags).toContain('legal');
    });

    test('should rename tag globally', () => {
      const result = db.performTagOperation({
        action: 'rename',
        rename: { from: 'draft', to: 'final' }
      });

      expect(result.updated).toBe(2);
      
      const doc1 = db.getNode('doc1');
      const doc2 = db.getNode('doc2');
      
      expect(doc1?.metadata?.tags).toContain('final');
      expect(doc1?.metadata?.tags).not.toContain('draft');
      expect(doc2?.metadata?.tags).toContain('final');
    });

    test('should list all tags', () => {
      const result = db.performTagOperation({
        action: 'list'
      });

      expect(result).toHaveLength(2); // draft, legal
      expect(result.find((t: any) => t.tag === 'draft')?.count).toBe(2);
      expect(result.find((t: any) => t.tag === 'legal')?.count).toBe(1);
    });

    test('should get document tags', () => {
      const tags = db.performTagOperation({
        action: 'get',
        document_id: 'doc2'
      });

      expect(tags).toEqual(['draft', 'legal']);
    });

    test('should bulk add tags using filter', () => {
      const result = db.performTagOperation({
        action: 'add',
        document_filter: { tags: ['draft'] },
        tags: ['reviewed']
      });

      expect(result.updated).toBe(2);
      
      const doc1 = db.getNode('doc1');
      const doc2 = db.getNode('doc2');
      
      expect(doc1?.metadata?.tags).toContain('reviewed');
      expect(doc2?.metadata?.tags).toContain('reviewed');
    });
  });

  describe('Metadata Statistics', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Doc 1',
        metadata: {
          tags: ['legal', 'urgent'],
          keywords: ['contract', 'payment'],
          emoji: '📄',
          type: 'contract',
          path: ['legal', '2024']
        }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Doc 2',
        metadata: {
          tags: ['legal', 'draft'],
          keywords: ['contract'],
          emoji: '📄',
          type: 'contract',
          path: ['legal', '2024', 'Q1']
        }
      });

      await db.addNode({
        id: 'doc3',
        content: 'Doc 3',
        metadata: {
          tags: ['urgent'],
          emoji: '🔥',
          type: 'email'
        }
      });
    });

    test('should count tags', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.tags['legal']).toBe(2);
      expect(stats.tags['urgent']).toBe(2);
      expect(stats.tags['draft']).toBe(1);
    });

    test('should count keywords', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.keywords['contract']).toBe(2);
      expect(stats.keywords['payment']).toBe(1);
    });

    test('should count emojis', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.emojis['📄']).toBe(2);
      expect(stats.emojis['🔥']).toBe(1);
    });

    test('should count types', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.types['contract']).toBe(2);
      expect(stats.types['email']).toBe(1);
    });

    test('should list unique paths', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.paths).toHaveLength(2);
      expect(stats.paths).toContain('legal/2024');
      expect(stats.paths).toContain('legal/2024/Q1');
    });
  });

  describe('List by Path', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Project doc',
        metadata: { path: ['projects', 'website'] }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Another project doc',
        metadata: { path: ['projects', 'website'] }
      });

      await db.addNode({
        id: 'doc3',
        content: 'App doc',
        metadata: { path: ['projects', 'app'] }
      });
    });

    test('should group documents by path', () => {
      const grouped = db.listDocumentsByPath();
      
      expect(grouped['projects/website']).toHaveLength(2);
      expect(grouped['projects/app']).toHaveLength(1);
    });
  });
});
```

### Acceptance Criteria
- [ ] All tests pass
- [ ] Tests cover search, tags, stats, paths
- [ ] Edge cases tested

### Test
```bash
npm run test:once -- tests/rich-metadata.test.ts
```

---

## Task 0.5.8: Update Documentation
**Priority:** Normal 🟢  
**Estimated Time:** 20 minutes  
**File:** `README.md`

### Description
Document the rich metadata system and new tools.

### Code to Add
```markdown
## 🎨 Rich Metadata System

### All-in-One Metadata

Documents support rich metadata including your custom JSON fields:

```typescript
await graph.addDocument('contract_001', 'Purchase agreement...', {
  // 📋 Tags for categorization
  tags: ['legal', 'contract', 'urgent'],
  
  // 🗂️ Hierarchical path
  path: ['contracts', '2024', 'Q1'],
  
  // 😊 Visual identifier
  emoji: '📄',
  
  // 🔑 Key concepts
  keywords: ['payment', 'delivery', 'warranty'],
  
  // 📚 Vocabulary/definitions
  vocabulary: {
    'FOB': 'Free On Board - shipping term',
    'Net 30': 'Payment due 30 days after invoice'
  },
  
  // 🗺️ Document structure map
  map: {
    'section_1': 'parties involved',
    'section_2': 'payment terms',
    'section_3': 'delivery schedule'
  },
  
  // Standard fields
  type: 'contract',
  author: 'John Doe',
  date: '2024-01-15',
  
  // Custom fields (anything you want!)
  priority: 'high',
  reviewed_by: 'Jane Smith'
});
```

### Smart Search

One powerful search tool with metadata filtering:

```typescript
// Search by content + tags
graph.search({
  query: 'payment terms',
  filters: {
    tags: ['legal', 'urgent'],
    type: 'contract',
    author: 'John Doe'
  },
  limit: 10
});

// Filter by path
graph.search({
  filters: {
    path_prefix: ['contracts', '2024']
  }
});

// Filter by emoji
graph.search({
  filters: {
    emoji: '📄'
  }
});

// Combine everything
graph.search({
  query: 'delivery schedule',
  filters: {
    tags: ['urgent'],
    keywords: ['delivery'],
    type: 'contract',
    emoji: '📄'
  },
  sort_by: 'created_at',
  sort_order: 'desc',
  limit: 5
});
```

### Tag Management

One universal tool for all tag operations:

```typescript
// Add tags to a document
graph.manageTags({
  action: 'add',
  document_id: 'doc1',
  tags: ['urgent', 'legal']
});

// Remove tags
graph.manageTags({
  action: 'remove',
  document_id: 'doc1',
  tags: ['draft']
});

// Get document's tags
const tags = graph.manageTags({
  action: 'get',
  document_id: 'doc1'
});

// List all tags with counts
const allTags = graph.manageTags({
  action: 'list'
});
// Returns: [{ tag: 'legal', count: 15 }, { tag: 'urgent', count: 8 }]

// Rename tag everywhere
graph.manageTags({
  action: 'rename',
  rename: { from: 'urgent', to: 'high-priority' }
});

// Bulk add tags using filters
graph.manageTags({
  action: 'add',
  document_filter: { tags: ['draft'] },
  tags: ['reviewed']
});
```

### Metadata Statistics

See what's in your graph:

```typescript
const stats = graph.getMetadataStats();
console.log(stats);
/*
{
  tags: { legal: 45, urgent: 23, draft: 12 },
  keywords: { contract: 30, payment: 25 },
  emojis: { '📄': 40, '📧': 15, '🔥': 8 },
  types: { contract: 35, email: 20, note: 10 },
  paths: ['contracts/2024/Q1', 'projects/website', 'legal/drafts']
}
*/
```

## 🛠 MCP Tools (10 Total)

| Tool | Description |
|------|-------------|
| `graph_add_document` | Add with rich metadata (tags, path, emoji, keywords, vocabulary, map) |
| `graph_get_document` | Get document with all metadata |
| `graph_search` | Smart search with metadata filtering |
| `graph_list_documents` | List/browse documents |
| `graph_delete_document` | Delete document |
| **`graph_tags`** | **Universal tag tool: add, remove, rename, list, get** |
| `graph_add_relationship` | Create relationships |
| `graph_get_neighbors` | Get connected documents |
| `graph_find_path` | Find shortest path |
| `graph_find_similar` | Semantic search |
| `graph_stats` | Graph + metadata statistics |

### Example MCP Usage

```
# Add document with rich metadata
Use graph_add_document to add a contract with:
- id: "contract_2024_001"
- tags: ["legal", "urgent"]
- emoji: "📄"
- path: ["contracts", "2024", "Q1"]
- vocabulary: {"FOB": "Free On Board"}

# Search with filters
Use graph_search to find all urgent legal contracts from 2024

# Manage tags
Use graph_tags with action "add" to tag document "contract_2024_001" with ["reviewed", "final"]

# Get statistics
Use graph_stats to see all tags, emojis, and document types in the system
```
```

### Acceptance Criteria
- [ ] Rich metadata system documented
- [ ] Examples for all 6 JSON ideas
- [ ] Tool list updated (10 tools)
- [ ] MCP usage examples

---

## Task 0.5.9: Integration Test
**Priority:** Critical 🔴  
**Estimated Time:** 20 minutes  
**File:** `tests/integration.test.ts`

### Description
Add comprehensive integration test for rich metadata workflow.

### Code to Add
```typescript
// Add to existing integration.test.ts:

test('rich metadata and tag workflow', async () => {
  const api = new GraphAPI(':memory:');
  
  // Add documents with rich metadata
  await api.addDocument('contract_001', 'Purchase agreement for equipment worth $1M', {
    tags: ['legal', 'contract'],
    path: ['contracts', '2024', 'Q1'],
    emoji: '📄',
    keywords: ['purchase', 'equipment', 'payment'],
    vocabulary: {
      'FOB': 'Free On Board',
      'Net 30': 'Payment due 30 days after invoice'
    },
    map: {
      'section_1': 'parties',
      'section_2': 'terms',
      'section_3': 'delivery'
    },
    type: 'contract',
    author: 'Alice',
    date: '2024-01-15'
  });

  await api.addDocument('email_001', 'Urgent email about payment deadline', {
    tags: ['urgent', 'email'],
    emoji: '📧',
    keywords: ['payment', 'deadline'],
    type: 'email',
    author: 'Bob'
  });

  await api.addDocument('note_001', 'Meeting notes about legal review', {
    tags: ['legal', 'meeting'],
    path: ['meetings', '2024', 'Q1'],
    emoji: '📝',
    type: 'note',
    author: 'Alice'
  });

  // Test 1: Search by tags
  const legalDocs = api.search({
    filters: { tags: ['legal'] }
  });
  expect(legalDocs).toHaveLength(2);

  // Test 2: Search with multiple filters
  const aliceLegal = api.search({
    filters: {
      tags: ['legal'],
      author: 'Alice'
    }
  });
  expect(aliceLegal).toHaveLength(2);

  // Test 3: Search by emoji
  const contracts = api.search({
    filters: { emoji: '📄' }
  });
  expect(contracts).toHaveLength(1);
  expect(contracts[0].id).toBe('contract_001');

  // Test 4: Search by path prefix
  const q1Docs = api.search({
    filters: {
      path_prefix: ['contracts', '2024']
    }
  });
  expect(q1Docs).toHaveLength(1);

  // Test 5: Content + metadata search
  const paymentLegal = api.search({
    query: 'payment',
    filters: {
      tags: ['legal']
    }
  });
  expect(paymentLegal.length).toBeGreaterThan(0);

  // Test 6: Add tags
  const addResult = api.addTags('email_001', ['legal', 'reviewed']);
  expect(addResult.updated).toBe(1);
  
  const emailTags = api.getTags('email_001');
  expect(emailTags).toContain('legal');
  expect(emailTags).toContain('reviewed');

  // Test 7: Remove tags
  const removeResult = api.removeTags('email_001', ['urgent']);
  expect(removeResult.updated).toBe(1);
  
  const updatedTags = api.getTags('email_001');
  expect(updatedTags).not.toContain('urgent');

  // Test 8: List all tags
  const allTags = api.listTags();
  expect(allTags.length).toBeGreaterThan(0);
  expect(allTags.find(t => t.tag === 'legal')).toBeDefined();

  // Test 9: Rename tag globally
  api.manageTags({
    action: 'rename',
    rename: { from: 'meeting', to: 'meetings' }
  });
  
  const noteTags = api.getTags('note_001');
  expect(noteTags).toContain('meetings');
  expect(noteTags).not.toContain('meeting');

  // Test 10: Bulk operations
  api.manageTags({
    action: 'add',
    document_filter: { tags: ['legal'] },
    tags: ['requires-signature']
  });
  
  const contractTags = api.getTags('contract_001');
  const emailUpdatedTags = api.getTags('email_001');
  const noteTagsUpdated = api.getTags('note_001');
  
  expect(contractTags).toContain('requires-signature');
  expect(emailUpdatedTags).toContain('requires-signature');
  expect(noteTagsUpdated).toContain('requires-signature');

  // Test 11: Metadata stats
  const stats = api.getMetadataStats();
  expect(stats.tags['legal']).toBeGreaterThan(0);
  expect(stats.emojis['📄']).toBe(1);
  expect(stats.types['contract']).toBe(1);

  api.close();
});
```

### Acceptance Criteria
- [ ] Full workflow tested end-to-end
- [ ] All features covered
- [ ] Test passes

### Test
```bash
npm run test:once -- tests/integration.test.ts -t "rich metadata"
```

---

## Task 0.5.10: Run Full Test Suite
**Priority:** Critical 🔴  
**Estimated Time:** 5 minutes

### Steps
```bash
# Clean slate
rm graph.db graph.db-shm graph.db-wal

# Rebuild
npm run build

# Run all tests
npm run test:once

# Test examples (optional)
node examples/basic-usage.js
```

### Acceptance Criteria
- [ ] All tests pass ✅
- [ ] No compilation errors
- [ ] Examples work

### Expected Output
```
✓ tests/database.test.ts
✓ tests/embeddings.test.ts  
✓ tests/integration.test.ts
✓ tests/rich-metadata.test.ts (NEW)

Test Files  4 passed (4)
     Tests  XX passed (XX)
```

---


## Phase 0.5 Checklist Summary

```
Phase 0.5: Rich Metadata + Smart Tags 🎨
├── [✓] 0.5.1: Update types for rich metadata (15 min)
├── [✓] 0.5.2: Add search method to database (45 min)
├── [✓] 0.5.3: Add tag operations to database (40 min)
├── [✓] 0.5.4: Update GraphAPI (20 min)
├── [✓] 0.5.5: Add MCP tools (30 min)
├── [✓] 0.5.6: Add MCP handlers (30 min)
├── [✓] 0.5.7: Write rich metadata tests (35 min)
├── [✓] 0.5.8: Update documentation (20 min)
├── [✓] 0.5.9: Integration test (20 min)
├── [✓] 0.5.10: Run full test suite (5 min)


Total Time: ~4 hours
```

---

## 🎉 After Phase 0.5 You'll Have:

✅ **10 MCP tools** (down from 20+!)  
✅ **Rich metadata** with all 6 JSON ideas  
✅ **Smart search** with powerful filtering  
✅ **Universal tag tool** (one tool for everything)  
✅ **Clean, maintainable codebase**  
✅ **Full test coverage**  
✅ **Ready for Phase 1** (temporal features)

---

## Quick Reference Card 📝

**New Tools:**
```
graph_search     - Replaces graph_search_content
graph_tags       - New universal tag tool
graph_stats      - Enhanced with metadata stats
```

**Removed Tools:**
```
graph_search_content        → graph_search
graph_add_tags              → graph_tags
graph_remove_tags           → graph_tags
graph_get_document_tags     → graph_tags
graph_list_tags             → graph_tags
... (10+ tools consolidated!)
```

**Key Files:**
- `src/types/index.ts` - RichMetadata type
- `src/storage/database.ts` - Search & tag methods
- `src/mcp/tools.ts` - 10 tool definitions
- `tests/rich-metadata.test.ts` - New test file