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
  RichMetadata,
  SearchOptions,
  TagOperation,
} from '../types/index.js';

const SCHEMA_SQL = `
-- Узлы (документы)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'content',
    content TEXT NOT NULL,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Temporal fields (Phase 1.A)
    valid_from TEXT,
    valid_until TEXT,
    version INTEGER DEFAULT 1,
    supersedes TEXT,
    
    PRIMARY KEY (id, version)
);

-- Связи между узлами
CREATE TABLE IF NOT EXISTS edges (
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'related',
    weight REAL DEFAULT 1.0,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Temporal fields (Phase 1.A)
    valid_from TEXT,
    valid_until TEXT,
    temporal_weight REAL DEFAULT 1.0,
    
    PRIMARY KEY (from_node, to_node),
    FOREIGN KEY (from_node) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

-- Temporal indexes (for Phase 1+)
CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_created_at ON edges(created_at DESC);

-- Metadata queries (optional but useful)
CREATE INDEX IF NOT EXISTS idx_edges_relation_weight ON edges(relation, weight);

-- ==================== TEMPORAL EXTENSIONS ====================
-- Phase 1.A: Adding temporal support to existing tables

-- Temporal indexes for nodes
CREATE INDEX IF NOT EXISTS idx_nodes_valid_from ON nodes(valid_from);
CREATE INDEX IF NOT EXISTS idx_nodes_valid_until ON nodes(valid_until);
CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(id, version);
CREATE INDEX IF NOT EXISTS idx_nodes_supersedes ON nodes(supersedes);

-- Temporal indexes for edges
CREATE INDEX IF NOT EXISTS idx_edges_valid_from ON edges(valid_from);
CREATE INDEX IF NOT EXISTS idx_edges_valid_until ON edges(valid_until);

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

-- Convenience views for current state (no history)
CREATE VIEW IF NOT EXISTS current_nodes AS
SELECT * FROM nodes WHERE valid_until IS NULL;

CREATE VIEW IF NOT EXISTS current_edges AS
SELECT * FROM edges WHERE valid_until IS NULL;
`;

export class GraphDB {
  private db: Database.Database;
  private embeddingGen = getEmbeddingGenerator();
  private vecTableInitialized = false;

  constructor(dbPath: string = 'graph.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = OFF'); // Disable FK constraints for versioning
    this.initialize();
  }

  private initialize(): void {
    // Handle migration for existing databases FIRST (Phase 1.A)
    this.migrateToTemporalSchema();

    // Execute schema (will create missing tables/indexes)
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

  /**
   * Migrate existing database to temporal schema (Phase 1.A)
   */
  private migrateToTemporalSchema(): void {
    try {
      // Check if tables exist first
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
      const hasNodesTable = tables.some((t: any) => t.name === 'nodes');
      const hasEdgesTable = tables.some((t: any) => t.name === 'edges');
      
      if (!hasNodesTable || !hasEdgesTable) {
        // Tables don't exist yet, will be created by schema
        return;
      }
      
      // Check if temporal columns already exist
      const nodesTableInfo = this.db.prepare("PRAGMA table_info(nodes)").all() as any[];
      const edgesTableInfo = this.db.prepare("PRAGMA table_info(edges)").all() as any[];
      
      const hasValidFrom = nodesTableInfo.some((col: any) => col.name === 'valid_from');
      const hasValidUntil = nodesTableInfo.some((col: any) => col.name === 'valid_until');
      const hasVersion = nodesTableInfo.some((col: any) => col.name === 'version');
      const hasSupersedes = nodesTableInfo.some((col: any) => col.name === 'supersedes');
      
      // Check if we need to migrate from single PK to composite PK
      const pkInfo = this.db.prepare("PRAGMA table_info(nodes)").all() as any[];
      const hasIdOnlyPK = pkInfo.filter(col => col.pk > 0).length === 1 && pkInfo.some(col => col.name === 'id' && col.pk > 0);
      
      // If we have the old schema with id as primary key, we need to recreate the table
      if (hasIdOnlyPK && (hasValidFrom || hasValidUntil || hasVersion)) {
        console.log('Migrating nodes table from single PK to composite PK...');
        
        // Disable foreign key constraints temporarily
        this.db.exec('PRAGMA foreign_keys = OFF');
        
        // Create a backup of the existing data
        this.db.exec(`
          CREATE TABLE nodes_backup AS SELECT * FROM nodes;
        `);
        
        // Drop the old table
        this.db.exec('DROP TABLE nodes');
        
        // Create the new table with composite primary key
        this.db.exec(`
          CREATE TABLE nodes (
              id TEXT NOT NULL,
              type TEXT NOT NULL DEFAULT 'content',
              content TEXT NOT NULL,
              metadata JSON,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              
              -- Temporal fields (Phase 1.A)
              valid_from TEXT,
              valid_until TEXT,
              version INTEGER DEFAULT 1,
              supersedes TEXT,
              
              PRIMARY KEY (id, version)
          );
        `);
        
        // Restore data from backup, ensuring version is set
        this.db.exec(`
          INSERT INTO nodes (id, type, content, metadata, created_at, valid_from, valid_until, version, supersedes)
          SELECT
              id,
              type,
              content,
              metadata,
              created_at,
              COALESCE(valid_from, created_at, datetime('now')),
              valid_until,
              COALESCE(version, 1),
              supersedes
          FROM nodes_backup;
        `);
        
        // Drop the backup table
        this.db.exec('DROP TABLE nodes_backup');
        
        // Re-enable foreign key constraints
        this.db.exec('PRAGMA foreign_keys = ON');
        
        console.log('Migration to composite PK completed.');
      } else {
        // Add temporal columns to nodes table if they don't exist
        if (!hasValidFrom) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN valid_from TEXT');
        }
        if (!hasValidUntil) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN valid_until TEXT');
        }
        if (!hasVersion) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN version INTEGER DEFAULT 1');
        }
        if (!hasSupersedes) {
          this.db.exec('ALTER TABLE nodes ADD COLUMN supersedes TEXT');
        }
        
        // Set default valid_from for existing records
        if (!hasValidFrom) {
          this.db.exec(`
            UPDATE nodes
            SET valid_from = COALESCE(created_at, datetime('now'))
            WHERE valid_from IS NULL
          `);
        }
      }
      
      // Add temporal columns to edges table if they don't exist
      const edgesHasValidFrom = edgesTableInfo.some((col: any) => col.name === 'valid_from');
      const edgesHasValidUntil = edgesTableInfo.some((col: any) => col.name === 'valid_until');
      const edgesHasTemporalWeight = edgesTableInfo.some((col: any) => col.name === 'temporal_weight');
      
      if (!edgesHasValidFrom) {
        this.db.exec('ALTER TABLE edges ADD COLUMN valid_from TEXT');
      }
      if (!edgesHasValidUntil) {
        this.db.exec('ALTER TABLE edges ADD COLUMN valid_until TEXT');
      }
      if (!edgesHasTemporalWeight) {
        this.db.exec('ALTER TABLE edges ADD COLUMN temporal_weight REAL DEFAULT 1.0');
      }
      
    } catch (error) {
      console.warn('Migration warning:', error instanceof Error ? error.message : String(error));
    }
  }

  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private initVectorTable(): void {
    // Create vector table if extension is loaded
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
        embedding float[384]
      );
      
      -- Separate mapping table for IDs
      CREATE TABLE IF NOT EXISTS vec_nodes_map (
        rowid INTEGER PRIMARY KEY,
        node_id TEXT UNIQUE NOT NULL
      );
    `);
  }

  /**
   * Helper method to generate and store embedding for a node
   */
  private async vectorizeNode(id: string, content: string): Promise<void> {
    try {
      const embedding = await this.embeddingGen.generateEmbedding(content);
      
      // Check if mapping already exists
      const existingRow = this.db.prepare('SELECT rowid FROM vec_nodes_map WHERE node_id = ?').get(id) as any;
      
      if (existingRow) {
        // Update existing embedding by deleting and re-inserting
        const deleteStmt = this.db.prepare('DELETE FROM vec_nodes WHERE rowid = ?');
        deleteStmt.run(existingRow.rowid);
        
        // Insert new vector (let sqlite-vec assign the rowid)
        const vecStmt = this.db.prepare('INSERT INTO vec_nodes (embedding) VALUES (vec_f32(?))');
        
        // Convert Float32Array to JSON array for vec_f32()
        const embeddingArray = Array.from(embedding);
        const embeddingBlob = JSON.stringify(embeddingArray);
        
        const insertResult = vecStmt.run(embeddingBlob);
        
        // Update mapping table with new rowid
        const updateMapStmt = this.db.prepare('UPDATE vec_nodes_map SET rowid = ? WHERE node_id = ?');
        updateMapStmt.run(insertResult.lastInsertRowid, id);
      } else {
        // Insert new vector first (let sqlite-vec assign the rowid)
        const vecStmt = this.db.prepare('INSERT INTO vec_nodes (embedding) VALUES (vec_f32(?))');
        
        // Convert Float32Array to JSON array for vec_f32()
        const embeddingArray = Array.from(embedding);
        const embeddingBlob = JSON.stringify(embeddingArray);
        
        const insertResult = vecStmt.run(embeddingBlob);
        
        // Then insert mapping with the assigned rowid
        const mapStmt = this.db.prepare(`
          INSERT INTO vec_nodes_map (rowid, node_id) VALUES (?, ?)
        `);
        mapStmt.run(insertResult.lastInsertRowid, id);
      }
    } catch (error) {
      console.error('Error generating embedding:', error);
    }
  }

  async addNode(input: AddNodeInput): Promise<Node> {
    const { id, content, type = 'content', metadata, valid_from } = input;
    const validFrom = valid_from || this.now();

    // Validate inputs
    if (content.length > 2 * 1024 * 1024) {
      throw new Error('Content exceeds 2MB limit');
    }

    // Perform database operations in a transaction
    const result = this.transaction(() => {
      // Check if node already exists (get current version)
      const existingStmt = this.db.prepare(`
        SELECT * FROM nodes
        WHERE id = ? AND valid_until IS NULL
        ORDER BY version DESC
        LIMIT 1
      `);
      const existing = existingStmt.get(id) as any;

      let version = 1;
      let supersedes: string | undefined;

      if (existing) {
        // This is an UPDATE - create new version
        version = (existing.version || 1) + 1;
        supersedes = id;

        // Mark old version as no longer valid
        const updateStmt = this.db.prepare(`
          UPDATE nodes
          SET valid_until = ?
          WHERE id = ? AND version = ? AND valid_until IS NULL
        `);
        updateStmt.run(validFrom, id, existing.version);

        console.log(`📝 Creating version ${version} of document: ${id}`);
      } else {
        console.log(`✨ Creating new document: ${id} (v1)`);
      }

      // Insert new version
      const insertStmt = this.db.prepare(`
        INSERT INTO nodes (
          id, type, content, metadata,
          valid_from, valid_until, version, supersedes, created_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)
      `);

      insertStmt.run(
        id,
        type,
        content,
        metadata ? JSON.stringify(metadata) : null,
        validFrom,
        version,
        supersedes
      );

      // Return the newly created version info
      return { version, isNew: !existing };
    });

    // Generate embedding for new version (async operation outside transaction)
    if (this.vecTableInitialized) {
      await this.vectorizeNode(id, content);
    }

    // Return the newly created version
    return this.getNodeCurrent(id)!;
  }

  // ==================== TEMPORAL GET METHODS (Phase 1.B) ====================

  /**
   * Get current version of node (most common query)
   */
  getNodeCurrent(id: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE id = ? AND valid_until IS NULL
      ORDER BY version DESC
      LIMIT 1
    `);

    return this.rowToNode(stmt.get(id) as any);
  }

  /**
   * Get all versions of a node (history)
   */
  getNodeHistory(id: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE id = ?
      ORDER BY version ASC
    `);

    const rows = stmt.all(id) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }

  /**
   * Get specific version of a node
   */
  getNodeVersion(id: string, version: number): Node | null {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE id = ? AND version = ?
    `);

    return this.rowToNode(stmt.get(id, version) as any);
  }

  /**
   * Get version count for a document
   */
  getNodeVersionCount(id: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM nodes
      WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    return row?.count || 0;
  }

  getNode(id: string): Node | null {
    return this.getNodeCurrent(id);
  }

  listNodes(limit: number = 100): Node[] {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at, valid_from, valid_until, version, supersedes
      FROM nodes
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }

  deleteNode(id: string): boolean {
    return this.transaction(() => {
      // Also delete from vec_nodes and vec_nodes_map if exists
      if (this.vecTableInitialized) {
        // Get the rowid from mapping table first
        const getRowidStmt = this.db.prepare('SELECT rowid FROM vec_nodes_map WHERE node_id = ?');
        const rowidRow = getRowidStmt.get(id) as any;
        
        if (rowidRow) {
          // Delete from vec_nodes using rowid
          const vecStmt = this.db.prepare('DELETE FROM vec_nodes WHERE rowid = ?');
          vecStmt.run(rowidRow.rowid);
          
          // Delete from mapping table
          const mapStmt = this.db.prepare('DELETE FROM vec_nodes_map WHERE node_id = ?');
          mapStmt.run(id);
        }
      }

      const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    });
  }

  addEdge(input: AddEdgeInput): Edge {
    const { from, to, relation = 'related', weight = 1.0, metadata } = input;

    return this.transaction(() => {
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
    });
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

    // Get the node's embedding using the mapping
    const getRowidStmt = this.db.prepare(
      'SELECT rowid FROM vec_nodes_map WHERE node_id = ?'
    );
    const rowidRow = getRowidStmt.get(id) as any;
    
    if (!rowidRow) {
      throw new Error(`No embedding found for node: ${id}`);
    }

    const getEmbedStmt = this.db.prepare(
      'SELECT embedding FROM vec_nodes WHERE rowid = ?'
    );
    const embeddingRow = getEmbedStmt.get(rowidRow.rowid) as any;
    
    if (!embeddingRow) {
      throw new Error(`No embedding found for node: ${id}`);
    }

    // Search for similar vectors using proper distance calculation
    const stmt = this.db.prepare(`
      SELECT
        m.node_id as id,
        n.content,
        n.metadata,
        vec_distance_cosine(?, vn.embedding) as distance
      FROM vec_nodes vn
      JOIN vec_nodes_map m ON vn.rowid = m.rowid
      JOIN nodes n ON m.node_id = n.id
      WHERE m.node_id != ?
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
        SELECT n.id, n.type, n.content, n.metadata, n.created_at, n.valid_from, n.valid_until, n.version, n.supersedes
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.id = n.id AND nodes_fts.rowid = n.rowid
        WHERE nodes_fts MATCH ? AND n.valid_until IS NULL
        ORDER BY rank
        LIMIT ?
      `);

      const rows = stmt.all(query, limit) as any[];
      
      return rows.map(row => {
        // Parse metadata and merge type into it if it exists
        return this.rowToNode(row)!;
      });
    } catch (error) {
      console.error('Full-text search error:', error);
      // Fallback to basic LIKE search if FTS fails
      const fallbackStmt = this.db.prepare(`
        SELECT id, type, content, metadata, created_at, valid_from, valid_until, version, supersedes
        FROM nodes
        WHERE content LIKE ? AND valid_until IS NULL
        ORDER BY created_at DESC
        LIMIT ?
      `);
      
      const rows = fallbackStmt.all(`%${query}%`, limit) as any[];
      return rows.map(row => {
        // Parse metadata and merge type into it if it exists
        return this.rowToNode(row)!;
      });
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
        for (let i = 0; i < path_prefix.length; i++) {
          sql += ` AND EXISTS (
            SELECT 1 FROM json_each(json_extract(metadata, '$.path'))
            WHERE value = ?
          )`;
          params.push(path_prefix[i]);
        }
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

  /**
   * Helper method to convert database row to Node
   */
  private rowToNode(row: any): Node | null {
    if (!row) return null;
    
    // Parse metadata and merge type into it if it exists
    let metadata: RichMetadata = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) as RichMetadata : {};
    } catch (error) {
      console.error('Error parsing metadata:', error, 'Raw metadata:', row.metadata);
      metadata = {};
    }
    
    if (row.type && row.type !== 'content') {
      metadata.type = row.type;
    }

    return {
      id: row.id,
      content: row.content,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      created_at: row.created_at,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined, // Convert null to undefined
      version: row.version,
      supersedes: row.supersedes || undefined, // Convert null to undefined
    };
  }

  // ==================== TEMPORAL HELPERS (Phase 1.A) ====================

  /**
   * Check if a timestamp is valid at a given time
   */
  private isValidAtTime(
    validFrom: string | null | undefined,
    validUntil: string | null | undefined,
    timestamp: string
  ): boolean {
    if (!validFrom) return false;
    
    const isAfterStart = validFrom <= timestamp;
    const isBeforeEnd = !validUntil || validUntil > timestamp;
    
    return isAfterStart && isBeforeEnd;
  }

  /**
   * Generate ISO timestamp for 'now'
   */
  private now(): string {
    return new Date().toISOString();
  }

  /**
   * Validate ISO timestamp format
   */
  private isValidTimestamp(timestamp: string): boolean {
    try {
      const date = new Date(timestamp);
      return date.toISOString() === timestamp;
    } catch {
      return false;
    }
  }

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
        const currentTags = Array.isArray(doc.metadata?.tags) ? doc.metadata.tags : [];
        const updatedTags = Array.from(new Set([...currentTags, ...newTags]));
        
        const stmt = this.db.prepare(`
          UPDATE nodes
          SET metadata = json_set(
            COALESCE(metadata, '{}'),
            '$.tags',
            json(?)
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
        const currentTags = Array.isArray(doc.metadata?.tags) ? doc.metadata.tags : [];
        const updatedTags = currentTags.filter(tag => !tagsToRemove.includes(tag));
        
        const stmt = this.db.prepare(`
          UPDATE nodes
          SET metadata = json_set(
            metadata,
            '$.tags',
            json(?)
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

  close(): void {
    this.db.close();
  }
}
