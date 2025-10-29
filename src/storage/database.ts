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

-- Temporal indexes (for Phase 1+)
CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_created_at ON edges(created_at DESC);

-- Metadata queries (optional but useful)
CREATE INDEX IF NOT EXISTS idx_edges_relation_weight ON edges(relation, weight);

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

    return this.getNode(id)!;
  }

  getNode(id: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at
      FROM nodes
      WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    return this.rowToNode(row);
  }

  listNodes(limit: number = 100): Node[] {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at
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
        SELECT n.id, n.type, n.content, n.metadata, n.created_at
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.id = n.id
        WHERE nodes_fts MATCH ?
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
        SELECT id, type, content, metadata, created_at
        FROM nodes
        WHERE content LIKE ?
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
    };
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
