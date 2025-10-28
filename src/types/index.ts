// Core types for the temporal graph
export interface Node {
  id: string;
  type?: string;
  content: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface Edge {
  from_node: string;
  to_node: string;
  relation?: string;
  weight?: number;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface SimilarityResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
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
}

export type Direction = 'incoming' | 'outgoing' | 'both';

export interface AddNodeInput {
  id: string;
  content: string;
  type?: string;
  metadata?: Record<string, any>;
}

export interface AddEdgeInput {
  from: string;
  to: string;
  relation?: string;
  weight?: number;
  metadata?: Record<string, any>;
}
