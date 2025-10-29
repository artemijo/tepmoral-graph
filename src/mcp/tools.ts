import { z } from 'zod';

// Tool schemas
export const AddDocumentSchema = z.object({
  id: z.string().describe('Unique document identifier'),
  content: z.string().describe('Document content (will be vectorized for semantic search)'),
  metadata: z.record(z.any()).optional().describe('Optional metadata (tags, author, etc.)'),
});

export const GetDocumentSchema = z.object({
  id: z.string().describe('Document identifier'),
});

export const ListDocumentsSchema = z.object({
  limit: z.number().optional().default(100).describe('Maximum number of documents to return'),
});

export const DeleteDocumentSchema = z.object({
  id: z.string().describe('Document identifier to delete'),
});

export const AddRelationshipSchema = z.object({
  from: z.string().describe('Source document ID'),
  to: z.string().describe('Target document ID'),
  relation: z.string().optional().default('related').describe('Relationship type (e.g., "amends", "references", "causes")'),
  metadata: z.record(z.any()).optional().describe('Optional relationship metadata'),
});

export const GetNeighborsSchema = z.object({
  id: z.string().describe('Document ID'),
  direction: z.enum(['incoming', 'outgoing', 'both']).optional().default('both')
    .describe('Direction of relationships to retrieve'),
});

export const FindPathSchema = z.object({
  from: z.string().describe('Starting document ID'),
  to: z.string().describe('Target document ID'),
  maxDepth: z.number().optional().default(5).describe('Maximum path depth to search'),
});

export const FindSimilarSchema = z.object({
  id: z.string().describe('Document ID to find similar documents for'),
  limit: z.number().optional().default(10).describe('Maximum number of similar documents to return'),
});

export const SearchSchema = z.object({
  query: z.string().optional().describe('Full-text search query (optional)'),
  filters: z.object({
    tags: z.array(z.string()).optional().describe('Documents must have ALL these tags'),
    keywords: z.array(z.string()).optional().describe('Documents must have ALL these keywords'),
    path_prefix: z.array(z.string()).optional().describe('Path must start with this prefix'),
    emoji: z.string().optional().describe('Filter by emoji'),
    type: z.string().optional().describe('Filter by document type'),
    author: z.string().optional().describe('Filter by author'),
  }).optional().describe('Filter by metadata fields'),
  limit: z.number().optional().describe('Maximum results (default: 10)'),
  sort_by: z.enum(['created_at', 'id']).optional().describe('Sort field (default: created_at)'),
  sort_order: z.enum(['asc', 'desc']).optional().describe('Sort order (default: desc)'),
});

export const TagOperationSchema = z.object({
  action: z.enum(['add', 'remove', 'rename', 'list', 'get']).describe('Tag operation: add/remove tags, rename globally, list all, get doc tags'),
  document_id: z.string().optional().describe('Target document ID (for add, remove, get actions)'),
  document_filter: z.object({
    tags: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    path: z.array(z.string()).optional(),
    content: z.string().optional(),
  }).optional().describe('Filter documents for bulk operations'),
  tags: z.array(z.string()).optional().describe('Tags to add or remove'),
  rename: z.object({
    from: z.string(),
    to: z.string(),
  }).optional().describe('Rename tag globally (all documents)'),
});

export const UpdateDocumentSchema = z.object({
  id: z.string().describe('Document identifier to update'),
  content: z.string().optional().describe('New document content'),
  metadata: z.record(z.any()).optional().describe('New metadata (tags, path, emoji, keywords, vocabulary, map, and custom fields)'),
  merge_metadata: z.boolean().optional().default(true).describe('Merge with existing metadata (true) or replace completely (false)'),
  valid_from: z.string().optional().describe('ISO timestamp for when this version becomes valid (default: now)'),
});

export const GetDocumentTimelineSchema = z.object({
  id: z.string().describe('Document identifier'),
});

export const CompareVersionsSchema = z.object({
  id: z.string().describe('Document identifier'),
  version1: z.number().describe('First version number to compare'),
  version2: z.number().describe('Second version number to compare'),
});

export const GetTimeRangeSchema = z.object({
  start: z.string().describe('Start date (ISO 8601 format)'),
  end: z.string().describe('End date (ISO 8601 format)'),
});

export const MapGraphSchema = z.object({
  scope: z.enum(['all', 'filtered', 'subgraph', 'temporal_slice']).optional().default('all').describe('Map scope: all nodes, filtered, subgraph around focus nodes, or temporal snapshot'),
  filters: z.object({
    tags: z.array(z.string()).optional().describe('Filter by tags (must have ALL)'),
    path_prefix: z.array(z.string()).optional().describe('Filter by path prefix'),
    created_after: z.string().optional().describe('Filter by creation date (ISO 8601)'),
    type: z.string().optional().describe('Filter by document type'),
  }).optional().describe('Filter criteria for "filtered" scope'),
  focus_nodes: z.array(z.string()).optional().describe('Focus nodes for "subgraph" scope'),
  radius: z.number().optional().default(2).describe('Search radius for "subgraph" scope (default: 2)'),
  at_time: z.string().optional().describe('Timestamp for "temporal_slice" scope (ISO 8601)'),
  max_nodes: z.number().optional().default(100).describe('Maximum nodes to return (default: 100)'),
  max_edges: z.number().optional().default(500).describe('Maximum edges to return (default: 500)'),
  include_metadata: z.boolean().optional().default(true).describe('Include metadata in results (default: true)'),
  include_content_preview: z.boolean().optional().default(true).describe('Include content preview (default: true)'),
  include_stats: z.boolean().optional().default(true).describe('Include graph statistics (default: true)'),
  format: z.enum(['json', 'mermaid']).optional().default('json').describe('Output format (default: json)'),
});

// Tool definitions for MCP
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
    name: 'graph_update_document',
    description: 'Update document (creates new version) with content and metadata changes',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document identifier to update'
        },
        content: {
          type: 'string',
          description: 'New document content'
        },
        metadata: {
          type: 'object',
          description: 'New metadata (tags, path, emoji, keywords, vocabulary, map, and custom fields)'
        },
        merge_metadata: {
          type: 'boolean',
          description: 'Merge with existing metadata (true) or replace completely (false)',
          default: true
        },
        valid_from: {
          type: 'string',
          description: 'ISO timestamp for when this version becomes valid (default: now)'
        }
      },
      required: ['id']
    }
  },
  
  {
    name: 'graph_get_document_timeline',
    description: 'Get timeline of changes for a document (created, updated, deleted events)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document identifier'
        }
      },
      required: ['id']
    }
  },
  
  {
    name: 'graph_compare_versions',
    description: 'Compare two versions of a document to see what changed',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document identifier'
        },
        version1: {
          type: 'number',
          description: 'First version number to compare'
        },
        version2: {
          type: 'number',
          description: 'Second version number to compare'
        }
      },
      required: ['id', 'version1', 'version2']
    }
  },
  
  {
    name: 'graph_get_created_between',
    description: 'Get documents created in a specific date range',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'Start date (ISO 8601 format)'
        },
        end: {
          type: 'string',
          description: 'End date (ISO 8601 format)'
        }
      },
      required: ['start', 'end']
    }
  },
  
  {
    name: 'graph_get_modified_between',
    description: 'Get documents modified in a specific date range',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'Start date (ISO 8601 format)'
        },
        end: {
          type: 'string',
          description: 'End date (ISO 8601 format)'
        }
      },
      required: ['start', 'end']
    }
  },
  
  {
    name: 'graph_get_deleted_between',
    description: 'Get documents deleted in a specific date range',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'Start date (ISO 8601 format)'
        },
        end: {
          type: 'string',
          description: 'End date (ISO 8601 format)'
        }
      },
      required: ['start', 'end']
    }
  },
  
  {
    name: 'graph_map',
    description: 'Generate comprehensive graph map with various scopes and output formats',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'filtered', 'subgraph', 'temporal_slice'],
          description: 'Map scope: all nodes, filtered, subgraph around focus nodes, or temporal snapshot',
          default: 'all'
        },
        filters: {
          type: 'object',
          description: 'Filter criteria for "filtered" scope',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags (must have ALL)'
            },
            path_prefix: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by path prefix'
            },
            created_after: {
              type: 'string',
              description: 'Filter by creation date (ISO 8601)'
            },
            type: {
              type: 'string',
              description: 'Filter by document type'
            }
          }
        },
        focus_nodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Focus nodes for "subgraph" scope'
        },
        radius: {
          type: 'number',
          description: 'Search radius for "subgraph" scope (default: 2)',
          default: 2
        },
        at_time: {
          type: 'string',
          description: 'Timestamp for "temporal_slice" scope (ISO 8601)'
        },
        max_nodes: {
          type: 'number',
          description: 'Maximum nodes to return (default: 100)',
          default: 100
        },
        max_edges: {
          type: 'number',
          description: 'Maximum edges to return (default: 500)',
          default: 500
        },
        include_metadata: {
          type: 'boolean',
          description: 'Include metadata in results (default: true)',
          default: true
        },
        include_content_preview: {
          type: 'boolean',
          description: 'Include content preview (default: true)',
          default: true
        },
        include_stats: {
          type: 'boolean',
          description: 'Include graph statistics (default: true)',
          default: true
        },
        format: {
          type: 'string',
          enum: ['json', 'mermaid'],
          description: 'Output format (default: json)',
          default: 'json'
        }
      }
    }
  },
  
  {
    name: 'graph_stats',
    description: 'Get graph statistics and metadata overview (tag counts, keywords, emojis, paths)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
