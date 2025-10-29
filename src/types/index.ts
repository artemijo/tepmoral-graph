// Core types for the temporal graph

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
  
  // Temporal fields (Phase 1.A)
  valid_from?: string;      // ISO 8601 timestamp
  valid_until?: string;     // NULL = currently valid
  version?: number;         // 1, 2, 3, ...
  supersedes?: string;      // Previous version ID
}

export interface Edge {
  from_node: string;
  to_node: string;
  relation?: string;
  weight?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  
  // Temporal fields (Phase 1.A)
  valid_from?: string;
  valid_until?: string;
  temporal_weight?: number;
}

export interface SimilarityResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: RichMetadata;
}

export interface PathResult {
  path: string[];
  length: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
}

export interface NeighborResult {
  id: string;
  relation: string;
  direction: 'incoming' | 'outgoing';
  depth?: number;  // NEW: for multi-hop queries
}

export type Direction = 'incoming' | 'outgoing' | 'both';

export interface AddNodeInput {
  id: string;
  content: string;
  type?: string;
  metadata?: RichMetadata;  // ← Now using RichMetadata
  
  // Temporal fields (Phase 1.A)
  valid_from?: string;
}

// ADD new temporal types:
export interface TemporalOptions {
  at_time?: string;         // Query state at this time
  include_deleted?: boolean; // Include deleted documents
  all_versions?: boolean;   // Get all versions, not just current
}

export interface TimelineEntry {
  timestamp: string;
  event: 'created' | 'updated' | 'deleted';
  version: number;
  content_preview: string;
  changes?: string[];
}

export interface AddEdgeInput {
  from: string;
  to: string;
  relation?: string;
  weight?: number;
  metadata?: Record<string, any>;
  valid_from?: string;  // NEW
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
