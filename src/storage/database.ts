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
  TimelineEntry,
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
   * Get node at specific time
   */
  getNodeAtTime(id: string, timestamp: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE id = ?
        AND valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY version DESC
      LIMIT 1
    `);

    return this.rowToNode(stmt.get(id, timestamp, timestamp) as any);
  }

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
    const validFrom = input.valid_from || this.now();
    
    return this.transaction(() => {
      // CAUSALITY CHECK: Both nodes must exist at this time
      const fromNode = this.getNodeAtTime(input.from, validFrom);
      const toNode = this.getNodeAtTime(input.to, validFrom);
      
      if (!fromNode) {
        throw new Error(
          `🚫 Temporal violation: Cannot create edge from "${input.from}" ` +
          `at ${validFrom} - source node does not exist at this time`
        );
      }
      
      if (!toNode) {
        throw new Error(
          `🚫 Temporal violation: Cannot create edge to "${input.to}" ` +
          `at ${validFrom} - target node does not exist at this time`
        );
      }
      
      // Edge cannot exist before either node was created
      if (fromNode.valid_from && validFrom < fromNode.valid_from) {
        throw new Error(
          `🚫 Causality violation: Edge cannot exist (${validFrom}) ` +
          `before source node was created (${fromNode.valid_from})`
        );
      }
      
      if (toNode.valid_from && validFrom < toNode.valid_from) {
        throw new Error(
          `🚫 Causality violation: Edge cannot exist (${validFrom}) ` +
          `before target node was created (${toNode.valid_from})`
        );
      }
      
      // Create edge with temporal validity
      const stmt = this.db.prepare(`
        INSERT INTO edges (
          from_node, to_node, relation, weight, metadata,
          valid_from, valid_until, temporal_weight, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(from_node, to_node) DO UPDATE SET
          relation = excluded.relation,
          weight = excluded.weight,
          metadata = excluded.metadata,
          valid_from = excluded.valid_from,
          temporal_weight = excluded.temporal_weight
      `);
      
      stmt.run(
        input.from,
        input.to,
        input.relation || 'related',
        input.weight || 1.0,
        input.metadata ? JSON.stringify(input.metadata) : null,
        validFrom,
        input.weight || 1.0
      );
      
      console.log(`🔗 Created temporal edge: ${input.from} → ${input.to} (valid from ${validFrom})`);
      
      return {
        from_node: input.from,
        to_node: input.to,
        relation: input.relation || 'related',
        weight: input.weight || 1.0,
        metadata: input.metadata,
        valid_from: validFrom,
        temporal_weight: input.weight || 1.0
      };
    });
  }

  getNeighbors(
    id: string,
    direction: Direction = 'both',
    options?: {
      depth?: number;
      max_results?: number;
      relation_filter?: string[];
      at_time?: string;  // NEW: temporal support
    }
  ): NeighborResult[] {
    const depth = options?.depth || 1;
    const maxResults = options?.max_results || 50;
    const relationFilter = options?.relation_filter;
    const atTime = options?.at_time;
    
    if (depth === 1) {
      // Simple single-hop query
      let sql = '';
      const params: any[] = [];
      
      // Temporal filtering
      const temporalFilter = atTime
        ? `AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)`
        : `AND valid_until IS NULL`;  // Default: current edges only
      
      if (direction === 'outgoing' || direction === 'both') {
        sql += `
          SELECT to_node as id, relation, 'outgoing' as direction
          FROM edges
          WHERE from_node = ?
            ${temporalFilter}
        `;
        params.push(id);
        if (atTime) {
          params.push(atTime, atTime);
        }
        
        if (relationFilter) {
          sql += ` AND relation IN (${relationFilter.map(() => '?').join(',')})`;
          params.push(...relationFilter);
        }
      }
      
      if (direction === 'both') {
        sql += ' UNION ALL ';
      }
      
      if (direction === 'incoming' || direction === 'both') {
        sql += `
          SELECT from_node as id, relation, 'incoming' as direction
          FROM edges
          WHERE to_node = ?
            ${temporalFilter}
        `;
        params.push(id);
        if (atTime) {
          params.push(atTime, atTime);
        }
        
        if (relationFilter) {
          sql += ` AND relation IN (${relationFilter.map(() => '?').join(',')})`;
          params.push(...relationFilter);
        }
      }
      
      sql += ` LIMIT ?`;
      params.push(maxResults);
      
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as NeighborResult[];
    } else {
      // Multi-hop BFS
      const visited = new Set<string>();
      const results: NeighborResult[] = [];
      const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }];
      
      while (queue.length > 0 && results.length < maxResults) {
        const current = queue.shift()!;
        
        if (current.depth >= depth) continue;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        
        // Get neighbors at this depth
        const neighbors = this.getNeighbors(current.id, direction, {
          depth: 1,
          relation_filter: relationFilter,
          max_results: maxResults - results.length,
          at_time: atTime
        });
        
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor.id)) {
            results.push({ ...neighbor, depth: current.depth + 1 });
            queue.push({ id: neighbor.id, depth: current.depth + 1 });
          }
        }
      }
      
      return results;
    }
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
          AND e.valid_until IS NULL  -- Only current edges
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

  /**
   * Find path at specific time
   */
  findPathAtTime(
    from: string,
    to: string,
    timestamp: string,
    maxDepth: number = 5
  ): { path: string[]; length: number } | null {
    const stmt = this.db.prepare(`
      WITH RECURSIVE path_search(node, path, depth) AS (
        SELECT ?, ?, 0
        
        UNION ALL
        
        SELECT
          e.to_node,
          ps.path || ',' || e.to_node,
          ps.depth + 1
        FROM path_search ps
        JOIN edges e ON ps.node = e.from_node
        WHERE ps.depth < ?
          AND instr(ps.path, ',' || e.to_node || ',') = 0
          AND e.valid_from <= ?
          AND (e.valid_until IS NULL OR e.valid_until > ?)
      )
      SELECT path, depth
      FROM path_search
      WHERE node = ?
      ORDER BY depth
      LIMIT 1
    `);
    
    const row = stmt.get(from, from, maxDepth, timestamp, timestamp, to) as any;
    
    if (!row) return null;
    
    return {
      path: row.path.split(','),
      length: row.depth
    };
  }

  /**
   * Get graph snapshot at specific time
   */
  getGraphSnapshot(timestamp: string): { nodes: Node[]; edges: Edge[] } {
    // Get all nodes valid at this time
    const nodeStmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
    `);
    
    const nodeRows = nodeStmt.all(timestamp, timestamp) as any[];
    const nodes = nodeRows.map(row => this.rowToNode(row)!);
    
    // Get all edges valid at this time
    const edgeStmt = this.db.prepare(`
      SELECT * FROM edges
      WHERE valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
    `);
    
    const edgeRows = edgeStmt.all(timestamp, timestamp) as any[];
    const edges = edgeRows.map(row => ({
      from_node: row.from_node,
      to_node: row.to_node,
      relation: row.relation,
      weight: row.weight,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      valid_from: row.valid_from,
      valid_until: row.valid_until
    }));
    
    return { nodes, edges };
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

  // ==================== GRAPH EXPLORATION (Part 2A) ====================

  /**
   * Explore graph from starting point using BFS
   */
  exploreGraph(options: {
    start: string;
    strategy: 'breadth' | 'depth' | 'relationship';
    max_depth?: number;
    max_nodes?: number;
    follow_relations?: string[];
    filters?: {
      tags?: string[];
      type?: string;
    };
    at_time?: string;
  }): {
    root: string;
    strategy: string;
    nodes: Array<Node & { depth: number }>;
    edges: Edge[];
    stats: {
      total_nodes: number;
      max_depth_reached: number;
      truncated: boolean;
    };
  } {
    const {
      start,
      strategy,
      max_depth = 3,
      max_nodes = 50,
      follow_relations,
      filters,
      at_time
    } = options;
    
    const nodes: Array<Node & { depth: number }> = [];
    const edges: Edge[] = [];
    const visited = new Set<string>();
    
    // Get starting node
    const startNode = at_time
      ? this.getNodeAtTime(start, at_time)
      : this.getNodeCurrent(start);
    
    if (!startNode) {
      throw new Error(`Start node not found: ${start}`);
    }
    
    // Check if start node matches filters
    if (filters) {
      if (filters.tags && startNode.metadata?.tags) {
        const hasAllTags = filters.tags.every(tag =>
          startNode.metadata!.tags!.includes(tag)
        );
        if (!hasAllTags) {
          throw new Error(`Start node "${start}" does not match tag filters`);
        }
      }
      
      if (filters.type && startNode.metadata?.type !== filters.type) {
        throw new Error(`Start node "${start}" does not match type filter`);
      }
    }
    
    nodes.push({ ...startNode, depth: 0 });
    visited.add(start);
    
    if (strategy === 'breadth') {
      // BFS implementation
      const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
      
      while (queue.length > 0 && nodes.length < max_nodes) {
        const current = queue.shift()!;
        
        if (current.depth >= max_depth) continue;
        
        // Get neighbors
        const neighbors = this.getNeighbors(current.id, 'both', {
          depth: 1,
          relation_filter: follow_relations,
          at_time
        });
        
        for (const neighbor of neighbors) {
          if (visited.has(neighbor.id)) continue;
          
          // Get the node
          const node = at_time
            ? this.getNodeAtTime(neighbor.id, at_time)
            : this.getNodeCurrent(neighbor.id);
          
          if (!node) continue;
          
          // Apply filters
          if (filters) {
            if (filters.tags && node.metadata?.tags) {
              const hasAllTags = filters.tags.every(tag =>
                node.metadata!.tags!.includes(tag)
              );
              if (!hasAllTags) continue;
            }
            
            if (filters.type && node.metadata?.type !== filters.type) {
              continue;
            }
          }
          
          visited.add(neighbor.id);
          nodes.push({ ...node, depth: current.depth + 1 });
          queue.push({ id: neighbor.id, depth: current.depth + 1 });
          
          // Record edge
          edges.push({
            from_node: neighbor.direction === 'incoming' ? neighbor.id : current.id,
            to_node: neighbor.direction === 'incoming' ? current.id : neighbor.id,
            relation: neighbor.relation
          });
          
          if (nodes.length >= max_nodes) break;
        }
      }
    } else if (strategy === 'depth') {
      // DFS not yet implemented
      console.log('⚠️  DFS not yet implemented, using BFS');
      return this.exploreGraph({ ...options, strategy: 'breadth' });
    } else {
      // Relationship strategy not yet implemented
      console.log('⚠️  Relationship strategy not yet implemented, using BFS');
      return this.exploreGraph({ ...options, strategy: 'breadth' });
    }
    
    const maxDepthReached = nodes.length > 0
      ? Math.max(...nodes.map(n => n.depth))
      : 0;
    
    return {
      root: start,
      strategy,
      nodes,
      edges,
      stats: {
        total_nodes: nodes.length,
        max_depth_reached: maxDepthReached,
        truncated: nodes.length >= max_nodes
      }
    };
  }

  // ==================== GRAPH MAPPING (Part 2A) ====================

  /**
   * Generate comprehensive graph map
   */
  mapGraph(options: {
    scope: 'all' | 'filtered' | 'subgraph' | 'temporal_slice';
    filters?: {
      tags?: string[];
      path_prefix?: string[];
      created_after?: string;
      type?: string;
    };
    focus_nodes?: string[];
    radius?: number;
    at_time?: string;
    max_nodes?: number;
    max_edges?: number;
    include_metadata?: boolean;
    include_content_preview?: boolean;
    include_stats?: boolean;
    format?: 'json' | 'mermaid';
  }): any {
    const {
      scope,
      filters,
      focus_nodes,
      radius = 2,
      at_time,
      max_nodes = 100,
      max_edges = 500,
      include_metadata = true,
      include_content_preview = true,
      include_stats = true,
      format = 'json'
    } = options;
    
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    
    // ==================== GET NODES BASED ON SCOPE ====================
    
    if (scope === 'all') {
      if (at_time) {
        // Get nodes valid at the specified time
        const nodeStmt = this.db.prepare(`
          SELECT * FROM nodes
          WHERE valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
          ORDER BY created_at DESC
          LIMIT ?
        `);
        const nodeRows = nodeStmt.all(at_time, at_time, max_nodes) as any[];
        nodes = nodeRows.map(row => this.rowToNode(row)!);
      } else {
        nodes = this.listNodes(max_nodes);
      }
        
    } else if (scope === 'filtered') {
      nodes = this.searchDocuments({
        query: undefined,
        filters,
        limit: max_nodes
      });
      
    } else if (scope === 'subgraph' && focus_nodes) {
      const visited = new Set<string>();
      
      for (const focusId of focus_nodes) {
        try {
          const explored = this.exploreGraph({
            start: focusId,
            strategy: 'breadth',
            max_depth: radius,
            max_nodes: max_nodes - visited.size,
            at_time
          });
          
          for (const node of explored.nodes) {
            if (!visited.has(node.id)) {
              visited.add(node.id);
              nodes.push(node);
            }
          }
        } catch (e) {
          console.warn(`Could not explore from ${focusId}:`, e);
        }
      }
      
    } else if (scope === 'temporal_slice' && at_time) {
      const snapshot = this.getGraphSnapshot(at_time);
      nodes = snapshot.nodes.slice(0, max_nodes);
      edges = snapshot.edges.slice(0, max_edges);
    }
    
    // ==================== GET EDGES BETWEEN NODES ====================
    
    if (edges.length === 0 && nodes.length > 0) {
      const nodeIds = new Set(nodes.map(n => n.id));
      const nodeIdArray = Array.from(nodeIds);
      
      if (nodeIdArray.length > 0) {
        const placeholders = nodeIdArray.map(() => '?').join(',');
        
        let sql = `
          SELECT * FROM edges
          WHERE from_node IN (${placeholders})
            AND to_node IN (${placeholders})
        `;
        
        const params = [...nodeIdArray, ...nodeIdArray];
        
        if (at_time) {
          sql += ` AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)`;
          params.push(at_time, at_time);
        } else {
          sql += ` AND valid_until IS NULL`;
        }
        
        sql += ` LIMIT ?`;
        params.push(String(max_edges));
        
        const edgeStmt = this.db.prepare(sql);
        const edgeRows = edgeStmt.all(...params) as any[];
        
        edges = edgeRows.map(row => ({
          from_node: row.from_node,
          to_node: row.to_node,
          relation: row.relation,
          weight: row.weight,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          valid_from: row.valid_from,
          valid_until: row.valid_until
        }));
      }
    }
    
    // ==================== GENERATE OUTPUT ====================
    
    if (format === 'mermaid') {
      return this.generateMermaidDiagram(nodes, edges, {
        include_metadata,
        include_content_preview
      });
    } else {
      // JSON format
      const result: any = {
        metadata: {
          scope,
          timestamp: at_time || new Date().toISOString(),
          total_nodes: nodes.length,
          total_edges: edges.length,
          truncated: nodes.length >= max_nodes || edges.length >= max_edges
        },
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.metadata?.type,
          version: node.version,
          ...(include_metadata && { metadata: node.metadata }),
          ...(include_content_preview && {
            preview: node.content.substring(0, 100) + (node.content.length > 100 ? '...' : '')
          })
        })),
        edges: edges.map(edge => ({
          from: edge.from_node,
          to: edge.to_node,
          relation: edge.relation,
          ...(include_metadata && edge.metadata && { metadata: edge.metadata })
        }))
      };
      
      if (include_stats) {
        result.stats = this.calculateGraphStats(nodes, edges);
      }
      
      return result;
    }
  }

  /**
   * Generate Mermaid diagram
   */
  private generateMermaidDiagram(
    nodes: Node[],
    edges: Edge[],
    options: { include_metadata?: boolean; include_content_preview?: boolean }
  ): string {
    let mermaid = 'graph TD\n';
    
    // Add nodes
    for (const node of nodes) {
      const emoji = node.metadata?.emoji || '📄';
      let label = `${emoji} ${node.id}`;
      
      let subtitle = `v${node.version || 1}`;
      if (node.metadata?.status) {
        subtitle = node.metadata.status;
      }
      
      mermaid += `    ${this.sanitizeMermaidId(node.id)}["${label}<br/>${subtitle}"]\n`;
    }
    
    mermaid += '\n';
    
    // Add edges
    for (const edge of edges) {
      const label = edge.relation || 'related';
      const fromId = this.sanitizeMermaidId(edge.from_node);
      const toId = this.sanitizeMermaidId(edge.to_node);
      mermaid += `    ${fromId} -->|${label}| ${toId}\n`;
    }
    
    mermaid += '\n';
    
    // Add styling
    const styleMap: Record<string, string> = {
      'contract': '#90EE90',
      'email': '#87CEEB',
      'note': '#FFB6C1',
      'draft': '#FFE4B5',
      'review': '#F0E68C',
      'final': '#90EE90',
      'urgent': '#FF6B6B'
    };
    
    for (const node of nodes) {
      const type = node.metadata?.type;
      const status = node.metadata?.status;
      const nodeId = this.sanitizeMermaidId(node.id);
      
      if (type && styleMap[type]) {
        mermaid += `    style ${nodeId} fill:${styleMap[type]}\n`;
      } else if (status && styleMap[status]) {
        mermaid += `    style ${nodeId} fill:${styleMap[status]}\n`;
      }
      
      if (node.metadata?.tags?.includes('urgent')) {
        mermaid += `    style ${nodeId} stroke:#FF0000,stroke-width:3px\n`;
      }
    }
    
    return mermaid;
  }

  /**
   * Sanitize node ID for Mermaid
   */
  private sanitizeMermaidId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Calculate graph statistics
   */
  private calculateGraphStats(nodes: Node[], edges: Edge[]): any {
    const stats: any = {
      node_type_distribution: {} as Record<string, number>,
      relationship_types: {} as Record<string, number>,
      tag_distribution: {} as Record<string, number>,
      version_distribution: {} as Record<number, number>
    };
    
    for (const node of nodes) {
      const type = node.metadata?.type || 'unknown';
      stats.node_type_distribution[type] = (stats.node_type_distribution[type] || 0) + 1;
      
      const version = node.version || 1;
      stats.version_distribution[version] = (stats.version_distribution[version] || 0) + 1;
      
      if (node.metadata?.tags) {
        for (const tag of node.metadata.tags) {
          stats.tag_distribution[tag] = (stats.tag_distribution[tag] || 0) + 1;
        }
      }
    }
    
    for (const edge of edges) {
      const relation = edge.relation || 'related';
      stats.relationship_types[relation] = (stats.relationship_types[relation] || 0) + 1;
    }
    
    return stats;
  }

  // ==================== DOCUMENT MANAGEMENT (Part 2B) ====================

  /**
   * Update document (creates new version)
   */
  async updateNode(
    id: string,
    updates: {
      content?: string;
      metadata?: RichMetadata;
      merge_metadata?: boolean;
      valid_from?: string;
    }
  ): Promise<Node> {
    const current = this.getNodeCurrent(id);
    
    if (!current) {
      throw new Error(`Cannot update non-existent document: ${id}`);
    }
    
    const finalContent = updates.content !== undefined
      ? updates.content
      : current.content;
    
    let finalMetadata: RichMetadata | undefined;
    
    if (updates.metadata) {
      if (updates.merge_metadata) {
        finalMetadata = {
          ...current.metadata,
          ...updates.metadata,
          tags: updates.metadata.tags || current.metadata?.tags,
          keywords: updates.metadata.keywords || current.metadata?.keywords,
        };
      } else {
        finalMetadata = updates.metadata;
      }
    } else {
      finalMetadata = current.metadata;
    }
    
    console.log(`📝 Updating document "${id}" (creating v${(current.version || 1) + 1})`);
    
    return this.addNode({
      id,
      content: finalContent,
      metadata: finalMetadata,
      valid_from: updates.valid_from
    });
  }

  // ==================== TIMELINE & HISTORY (Part 2B) ====================

  /**
   * Get timeline of changes
   */
  getNodeTimeline(id: string): TimelineEntry[] {
    const stmt = this.db.prepare(`
      SELECT
        valid_from as timestamp,
        CASE
          WHEN version = 1 THEN 'created'
          WHEN valid_until IS NOT NULL THEN 'deleted'
          ELSE 'updated'
        END as event,
        version,
        substr(content, 1, 100) as content_preview,
        metadata
      FROM nodes
      WHERE id = ?
      ORDER BY valid_from ASC
    `);
    
    const rows = stmt.all(id) as any[];
    
    if (rows.length === 0) {
      return [];
    }
    
    return rows.map((row, idx) => {
      const changes = this.detectChanges(row, rows, idx);
      
      return {
        timestamp: row.timestamp,
        event: row.event as 'created' | 'updated' | 'deleted',
        version: row.version,
        content_preview: row.content_preview,
        changes
      };
    });
  }

  /**
   * Detect what changed
   */
  private detectChanges(current: any, allVersions: any[], currentIdx: number): string[] {
    const changes: string[] = [];
    
    if (currentIdx === 0) {
      return ['Initial version'];
    }
    
    const previous = allVersions[currentIdx - 1];
    
    if (current.content !== previous.content) {
      changes.push('Content modified');
    }
    
    try {
      if (current.metadata && previous.metadata) {
        const currentMeta = JSON.parse(current.metadata);
        const prevMeta = JSON.parse(previous.metadata);
        
        if (JSON.stringify(currentMeta.tags) !== JSON.stringify(prevMeta.tags)) {
          changes.push('Tags updated');
        }
        
        if (currentMeta.status !== prevMeta.status) {
          changes.push(`Status: ${prevMeta.status || 'none'} → ${currentMeta.status || 'none'}`);
        }
        
        if (currentMeta.type !== prevMeta.type) {
          changes.push(`Type: ${prevMeta.type || 'none'} → ${currentMeta.type || 'none'}`);
        }
        
        const allKeys = new Set([
          ...Object.keys(currentMeta),
          ...Object.keys(prevMeta)
        ]);
        
        for (const key of allKeys) {
          if (!['tags', 'status', 'type'].includes(key) &&
              JSON.stringify(currentMeta[key]) !== JSON.stringify(prevMeta[key])) {
            changes.push(`${key} changed`);
          }
        }
      }
    } catch (e) {
      // Skip if JSON parse fails
    }
    
    return changes.length > 0 ? changes : ['Minor update'];
  }

  /**
   * Compare two versions
   */
  compareVersions(id: string, version1: number, version2: number) {
    const v1 = this.getNodeVersion(id, version1);
    const v2 = this.getNodeVersion(id, version2);
    
    if (!v1 || !v2) {
      throw new Error(`Version not found for document: ${id}`);
    }
    
    const differences = {
      content_changed: v1.content !== v2.content,
      metadata_changes: [] as string[],
      content_diff: {
        length_change: v2.content.length - v1.content.length,
        v1_length: v1.content.length,
        v2_length: v2.content.length
      }
    };
    
    const meta1 = v1.metadata || {};
    const meta2 = v2.metadata || {};
    
    const allKeys = new Set([...Object.keys(meta1), ...Object.keys(meta2)]);
    
    for (const key of allKeys) {
      if (JSON.stringify(meta1[key]) !== JSON.stringify(meta2[key])) {
        differences.metadata_changes.push(key);
      }
    }
    
    return {
      version1: v1,
      version2: v2,
      differences
    };
  }

  /**
   * Get documents created in time range
   */
  getNodesCreatedBetween(start: string, end: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_from >= ? AND valid_from <= ?
        AND version = 1
      ORDER BY valid_from ASC
    `);
    
    const rows = stmt.all(start, end) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }

  /**
   * Get documents deleted in time range
   */
  getNodesDeletedBetween(start: string, end: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_until >= ? AND valid_until <= ?
      ORDER BY valid_until ASC
    `);
    
    const rows = stmt.all(start, end) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }

  /**
   * Get documents modified in time range
   */
  getNodesModifiedBetween(start: string, end: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_from >= ? AND valid_from <= ?
        AND version > 1
      ORDER BY valid_from ASC
    `);
    
    const rows = stmt.all(start, end) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }

  close(): void {
    this.db.close();
  }
}
