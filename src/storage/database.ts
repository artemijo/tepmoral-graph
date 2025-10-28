import Database from 'better-sqlite3';
import { load } from 'sqlite-vec';
import { getEmbeddingGenerator } from './embeddings.js';
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

const SCHEMA_SQL = `
-- Узлы (документы)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'content',
    content TEXT NOT NULL,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Связи между узлами
CREATE TABLE IF NOT EXISTS edges (
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'related',
    weight REAL DEFAULT 1.0,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (from_node, to_node),
    FOREIGN KEY (from_node) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

-- Полнотекстовый поиск
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    content,
    content='nodes',
    content_rowid='rowid'
);

-- Триггеры для синхронизации FTS
CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
    DELETE FROM nodes_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes BEGIN
    DELETE FROM nodes_fts WHERE rowid = old.rowid;
    INSERT INTO nodes_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
END;
`;

export class GraphDB {
  private db: Database.Database;
  private embeddingGen = getEmbeddingGenerator();
  private vecTableInitialized = false;

  constructor(dbPath: string = 'graph.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    // Execute schema
    this.db.exec(SCHEMA_SQL);

    // Try to load sqlite-vec extension using npm package
    try {
      load(this.db);
      this.initVectorTable();
      this.vecTableInitialized = true;
      console.log('✅ Vector search initialized successfully');
    } catch (error) {
      console.warn('⚠️ sqlite-vec extension not available:', error instanceof Error ? error.message : String(error));
      console.warn('Install from: https://github.com/asg017/sqlite-vec');
      this.vecTableInitialized = false;
    }
  }

  private initVectorTable(): void {
    // Create vector table if extension is loaded
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
        node_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `);
  }

  async addNode(input: AddNodeInput): Promise<Node> {
    const { id, content, type = 'content', metadata } = input;

    // Validate size
    if (content.length > 2 * 1024 * 1024) {
      throw new Error('Content exceeds 2MB limit');
    }

    const stmt = this.db.prepare(`
      INSERT INTO nodes (id, type, content, metadata)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(id, type, content, metadata ? JSON.stringify(metadata) : null);

    // Generate and store embedding if vec extension is available
    if (this.vecTableInitialized) {
      try {
        const embedding = await this.embeddingGen.generateEmbedding(content);
        const vecStmt = this.db.prepare(`
          INSERT OR REPLACE INTO vec_nodes (node_id, embedding)
          VALUES (?, ?)
        `);
        
        // Convert Float32Array to buffer for sqlite-vec
        const buffer = Buffer.from(embedding.buffer);
        vecStmt.run(id, buffer);
      } catch (error) {
        console.error('Error generating embedding:', error);
      }
    }

    return this.getNode(id)!;
  }

  getNode(id: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at
      FROM nodes
      WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
    };
  }

  listNodes(limit: number = 100): Node[] {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at
      FROM nodes
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
    }));
  }

  deleteNode(id: string): boolean {
    // Also delete from vec_nodes if exists
    if (this.vecTableInitialized) {
      const vecStmt = this.db.prepare('DELETE FROM vec_nodes WHERE node_id = ?');
      vecStmt.run(id);
    }

    const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  addEdge(input: AddEdgeInput): Edge {
    const { from, to, relation = 'related', weight = 1.0, metadata } = input;

    // Проверяем существование обоих документов
    const fromExists = this.getNode(from);
    const toExists = this.getNode(to);
    
    if (!fromExists) {
      throw new Error(`Source document not found: ${from}`);
    }
    
    if (!toExists) {
      throw new Error(`Target document not found: ${to}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO edges (from_node, to_node, relation, weight, metadata)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(from_node, to_node) DO UPDATE SET
        relation = excluded.relation,
        weight = excluded.weight,
        metadata = excluded.metadata
    `);

    try {
      stmt.run(from, to, relation, weight, metadata ? JSON.stringify(metadata) : null);
    } catch (error) {
      throw new Error(`Failed to create relationship: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      from_node: from,
      to_node: to,
      relation,
      weight,
      metadata,
    };
  }

  getNeighbors(id: string, direction: Direction = 'both'): NeighborResult[] {
    let query = '';
    let params: string[] = [];

    if (direction === 'outgoing' || direction === 'both') {
      query += `
        SELECT to_node as id, relation, 'outgoing' as direction
        FROM edges
        WHERE from_node = ?
      `;
      params.push(id);
    }

    if (direction === 'both') {
      query += ' UNION ALL ';
    }

    if (direction === 'incoming' || direction === 'both') {
      query += `
        SELECT from_node as id, relation, 'incoming' as direction
        FROM edges
        WHERE to_node = ?
      `;
      params.push(id);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      relation: row.relation,
      direction: row.direction as 'incoming' | 'outgoing',
    }));
  }

  findPath(from: string, to: string, maxDepth: number = 5): PathResult | null {
    // BFS implementation using recursive CTE
    const stmt = this.db.prepare(`
      WITH RECURSIVE path_search(node, path, depth) AS (
        -- Base case: start node
        SELECT ?, ?, 0
        
        UNION ALL
        
        -- Recursive case: explore neighbors
        SELECT 
          e.to_node,
          ps.path || ',' || e.to_node,
          ps.depth + 1
        FROM path_search ps
        JOIN edges e ON ps.node = e.from_node
        WHERE ps.depth < ?
          AND instr(ps.path, ',' || e.to_node || ',') = 0  -- Avoid cycles
      )
      SELECT path, depth
      FROM path_search
      WHERE node = ?
      ORDER BY depth
      LIMIT 1
    `);

    const row = stmt.get(from, from, maxDepth, to) as any;
    
    if (!row) return null;

    const pathArray = row.path.split(',');
    return {
      path: pathArray,
      length: row.depth,
    };
  }

  async findSimilar(id: string, limit: number = 10): Promise<SimilarityResult[]> {
    if (!this.vecTableInitialized) {
      throw new Error('Vector search not available. sqlite-vec extension not loaded.');
    }

    // Get the node's embedding
    const getEmbedStmt = this.db.prepare('SELECT embedding FROM vec_nodes WHERE node_id = ?');
    const embeddingRow = getEmbedStmt.get(id) as any;
    
    if (!embeddingRow) {
      throw new Error(`No embedding found for node: ${id}`);
    }

    // Search for similar vectors
    const stmt = this.db.prepare(`
      SELECT 
        vn.node_id as id,
        n.content,
        n.metadata,
        vec_distance_cosine(vn.embedding, ?) as distance
      FROM vec_nodes vn
      JOIN nodes n ON vn.node_id = n.id
      WHERE vn.node_id != ?
      ORDER BY distance
      LIMIT ?
    `);

    const rows = stmt.all(embeddingRow.embedding, id, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      similarity: 1 - row.distance, // Convert distance to similarity
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  searchContent(query: string, limit: number = 10): Node[] {
    try {
      const stmt = this.db.prepare(`
        SELECT n.id, n.type, n.content, n.metadata, n.created_at
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.id = n.id
        WHERE nodes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const rows = stmt.all(query, limit) as any[];
      
      return rows.map(row => ({
        id: row.id,
        type: row.type,
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        created_at: row.created_at,
      }));
    } catch (error) {
      console.error('Full-text search error:', error);
      // Fallback to basic LIKE search if FTS fails
      const fallbackStmt = this.db.prepare(`
        SELECT id, type, content, metadata, created_at
        FROM nodes
        WHERE content LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      
      const rows = fallbackStmt.all(`%${query}%`, limit) as any[];
      return rows.map(row => ({
        id: row.id,
        type: row.type,
        content: row.content,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        created_at: row.created_at,
      }));
    }
  }

  getStats(): GraphStats {
    const nodeCount = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as any;
    const edgeCount = this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as any;
    
    const avgDegree = edgeCount.count > 0
      ? (edgeCount.count * 2) / nodeCount.count
      : 0;

    return {
      nodeCount: nodeCount.count,
      edgeCount: edgeCount.count,
      avgDegree: Math.round(avgDegree * 100) / 100,
    };
  }

  exportGraph(): { nodes: Node[]; edges: Edge[] } {
    const nodes = this.listNodes(10000); // Export all nodes
    
    const edgeStmt = this.db.prepare(`
      SELECT from_node, to_node, relation, weight, metadata, created_at
      FROM edges
    `);
    
    const edgeRows = edgeStmt.all() as any[];
    const edges = edgeRows.map(row => ({
      from_node: row.from_node,
      to_node: row.to_node,
      relation: row.relation,
      weight: row.weight,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
    }));

    return { nodes, edges };
  }

  checkIntegrity(): {
    orphanedNodes: string[];
    missingDocuments: string[];
    inconsistentEdges: string[];
  } {
    // Найти узлы без связей
    const orphanedStmt = this.db.prepare(`
      SELECT n.id
      FROM nodes n
      LEFT JOIN edges e ON n.id = e.from_node OR n.id = e.to_node
      WHERE e.from_node IS NULL AND e.to_node IS NULL
    `);
    
    const orphanedNodes = orphanedStmt.all() as any[];
    
    // Найти связи с несуществующими узлами
    const inconsistentStmt = this.db.prepare(`
      SELECT
        CASE
          WHEN fn.id IS NULL THEN 'from_node missing: ' || e.from_node
          WHEN tn.id IS NULL THEN 'to_node missing: ' || e.to_node
        END as issue
      FROM edges e
      LEFT JOIN nodes fn ON e.from_node = fn.id
      LEFT JOIN nodes tn ON e.to_node = tn.id
      WHERE fn.id IS NULL OR tn.id IS NULL
    `);
    
    const inconsistentEdges = inconsistentStmt.all() as any[];
    
    return {
      orphanedNodes: orphanedNodes.map(n => n.id),
      missingDocuments: [],
      inconsistentEdges: inconsistentEdges.map(e => e.issue),
    };
  }

  rebuildSearchIndex(): void {
    this.db.exec(`
      DELETE FROM nodes_fts;
      INSERT INTO nodes_fts(rowid, id, content)
      SELECT rowid, id, content FROM nodes;
    `);
    console.log('FTS index rebuilt');
  }

  close(): void {
    this.db.close();
  }
}
