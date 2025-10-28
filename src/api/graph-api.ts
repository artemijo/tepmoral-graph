import { GraphDB } from '../storage/database.js';
import type {
  Node,
  Edge,
  AddNodeInput,
  AddEdgeInput,
  SimilarityResult,
  PathResult,
  GraphStats,
  NeighborResult,
  Direction,
} from '../types/index.js';

export class GraphAPI {
  private db: GraphDB;

  constructor(dbPath?: string) {
    this.db = new GraphDB(dbPath);
  }

  // Document management
  async addDocument(id: string, content: string, metadata?: Record<string, any>): Promise<Node> {
    return this.db.addNode({ id, content, metadata });
  }

  getDocument(id: string): Node | null {
    return this.db.getNode(id);
  }

  listDocuments(limit?: number): Node[] {
    return this.db.listNodes(limit);
  }

  deleteDocument(id: string): boolean {
    return this.db.deleteNode(id);
  }

  // Relationship management
  addRelationship(from: string, to: string, relation?: string, metadata?: Record<string, any>): Edge {
    return this.db.addEdge({ from, to, relation, metadata });
  }

  getNeighbors(id: string, direction?: Direction): NeighborResult[] {
    return this.db.getNeighbors(id, direction || 'both');
  }

  findPath(from: string, to: string, maxDepth?: number): PathResult | null {
    return this.db.findPath(from, to, maxDepth);
  }

  // Semantic search
  async findSimilar(id: string, limit?: number): Promise<SimilarityResult[]> {
    return this.db.findSimilar(id, limit);
  }

  searchContent(query: string, limit?: number): Node[] {
    return this.db.searchContent(query, limit);
  }

  // Statistics
  getStats(): GraphStats {
    return this.db.getStats();
  }

  exportGraph(): { nodes: Node[]; edges: Edge[] } {
    return this.db.exportGraph();
  }

  checkIntegrity(): {
    orphanedNodes: string[];
    missingDocuments: string[];
    inconsistentEdges: string[];
  } {
    return this.db.checkIntegrity();
  }

  rebuildSearchIndex(): void {
    this.db.rebuildSearchIndex();
  }

  close(): void {
    this.db.close();
  }
}
