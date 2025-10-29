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
  SearchOptions,
  TagOperation,
  TemporalOptions,
  TimelineEntry,
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

  // ==================== DOCUMENT VERSIONING (Phase 1.B) ====================

  /**
   * Get all versions/history of a document
   */
  getDocumentHistory(id: string): Node[] {
    return this.db.getNodeHistory(id);
  }

  /**
   * Get specific version of a document
   */
  getDocumentVersion(id: string, version: number): Node | null {
    return this.db.getNodeVersion(id, version);
  }

  /**
   * Get version count for a document
   */
  getDocumentVersionCount(id: string): number {
    return this.db.getNodeVersionCount(id);
  }

  close(): void {
    this.db.close();
  }
}
