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

export const SearchContentSchema = z.object({
  query: z.string().describe('Search query (full-text search)'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return'),
});

// Tool definitions for MCP
export const tools = [
  {
    name: 'graph_add_document',
    description: 'Add a document to the graph with optional metadata. The content will be automatically vectorized for semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique document identifier',
        },
        content: {
          type: 'string',
          description: 'Document content (will be vectorized for semantic search)',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata (tags, author, etc.)',
          additionalProperties: true,
        },
      },
      required: ['id', 'content'],
    },
  },
  {
    name: 'graph_get_document',
    description: 'Retrieve a document by its ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document identifier',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'graph_list_documents',
    description: 'List all documents in the graph (most recent first)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'graph_delete_document',
    description: 'Delete a document and all its relationships',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document identifier to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'graph_add_relationship',
    description: 'Add a directed relationship between two documents',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Source document ID',
        },
        to: {
          type: 'string',
          description: 'Target document ID',
        },
        relation: {
          type: 'string',
          description: 'Relationship type (e.g., "amends", "references", "causes")',
        },
        metadata: {
          type: 'object',
          description: 'Optional relationship metadata',
          additionalProperties: true,
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graph_get_neighbors',
    description: 'Get all neighboring documents (connected by relationships)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document ID',
        },
        direction: {
          type: 'string',
          enum: ['incoming', 'outgoing', 'both'],
          description: 'Direction of relationships to retrieve (default: "both")',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'graph_find_path',
    description: 'Find the shortest path between two documents in the graph',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Starting document ID',
        },
        to: {
          type: 'string',
          description: 'Target document ID',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum path depth to search (default: 5)',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graph_find_similar',
    description: 'Find semantically similar documents using vector embeddings',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Document ID to find similar documents for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of similar documents to return (default: 10)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'graph_search_content',
    description: 'Full-text search across all document content',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_get_stats',
    description: 'Get statistics about the graph (node count, edge count, average degree)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'graph_check_integrity',
    description: 'Check graph integrity and find orphaned nodes or inconsistent edges',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'graph_rebuild_search_index',
    description: 'Rebuild the full-text search index to fix search issues',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
