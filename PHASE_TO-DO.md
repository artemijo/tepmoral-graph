You're absolutely right! 🎯 Let's focus on what makes this a **TEMPORAL** graph first. The temporal features are the core innovation, not just "nice to have later"!

# 🕐 Temporal Graph MCP - **TEMPORAL-FIRST** Roadmap

## Phase 0: Minimal Foundation (1 week)
**Goal:** Just enough cleanup to add temporal features cleanly  
**Priority:** Quick wins only ⚡

### 0.1 Add Basic Transactions (Critical for temporal consistency)
```typescript
// ✅ Task: Wrap multi-step operations only
// File: src/storage/database.ts

class GraphDB {
  private transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  
  // Only update addEdge and deleteNode to use transactions
  // Everything else can wait
}
```

### 0.2 Add Missing Indexes (for temporal queries)
```sql
-- ✅ Task: Just these indexes - they'll be critical for Phase 1
-- File: src/storage/schema.sql

CREATE INDEX IF NOT EXISTS idx_nodes_created_at ON nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edges_created_at ON edges(created_at DESC);
```

**That's it for Phase 0!** Now let's add the temporal magic ✨

---

## Phase 1: Core Temporal Features 🕰️
**Goal:** Add time-awareness to the graph  
**Estimated Time:** 2-3 weeks  
**Priority:** HIGHEST 🔥
### 1.0 Tag system 

#### Think about adding the tag system to maske graph oriantation faster and easier

### 1.1 Extend Schema with Temporal Fields
```sql
-- ✅ Task: Add temporal columns
-- File: src/storage/schema.sql

-- Add to nodes table:
ALTER TABLE nodes ADD COLUMN valid_from TEXT; -- ISO 8601 timestamp
ALTER TABLE nodes ADD COLUMN valid_until TEXT; -- NULL means "still valid"
ALTER TABLE nodes ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE nodes ADD COLUMN supersedes TEXT; -- Points to previous version

-- Add to edges table:
ALTER TABLE edges ADD COLUMN valid_from TEXT;
ALTER TABLE edges ADD COLUMN valid_until TEXT;
ALTER TABLE edges ADD COLUMN temporal_weight REAL DEFAULT 1.0; -- Decays over time

-- Indexes for temporal queries
CREATE INDEX IF NOT EXISTS idx_nodes_valid_from ON nodes(valid_from);
CREATE INDEX IF NOT EXISTS idx_nodes_valid_until ON nodes(valid_until);
CREATE INDEX IF NOT EXISTS idx_edges_valid_from ON edges(valid_from);
CREATE INDEX IF NOT EXISTS idx_edges_valid_until ON edges(valid_until);
CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(id, version);

-- View for "current" state (nodes that are currently valid)
CREATE VIEW IF NOT EXISTS current_nodes AS
SELECT * FROM nodes
WHERE valid_until IS NULL;

CREATE VIEW IF NOT EXISTS current_edges AS
SELECT * FROM edges
WHERE valid_until IS NULL;
```

### 1.2 Update TypeScript Types
```typescript
// ✅ Task: Add temporal fields to types
// File: src/types/index.ts

export interface Node {
  id: string;
  type?: string;
  content: string;
  metadata?: Record<string, any>;
  created_at?: string;
  
  // Temporal fields
  valid_from?: string;      // ISO 8601: "2024-03-15T10:30:00Z"
  valid_until?: string;     // NULL = currently valid
  version?: number;         // 1, 2, 3, ...
  supersedes?: string;      // ID of previous version (if this is v2+)
}

export interface Edge {
  from_node: string;
  to_node: string;
  relation?: string;
  weight?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  
  // Temporal fields
  valid_from?: string;
  valid_until?: string;
  temporal_weight?: number; // Weight that changes over time
}

export interface TemporalQuery {
  at?: string;              // Query state at specific time
  from?: string;            // Query state in time range
  to?: string;
}

export interface TemporalNode extends Node {
  is_current: boolean;      // Is this the current version?
  has_history: boolean;     // Are there older versions?
  has_future: boolean;      // Are there newer versions?
}

export interface AddNodeInput {
  id: string;
  content: string;
  type?: string;
  metadata?: Record<string, any>;
  
  // Temporal fields
  valid_from?: string;      // Defaults to NOW
  version?: number;         // Auto-incremented if updating
}
```

### 1.3 Add Temporal Node Operations
```typescript
// ✅ Task: Implement temporal CRUD
// File: src/storage/database.ts

class GraphDB {
  
  // Enhanced addNode with temporal support
  async addNode(input: AddNodeInput): Promise<Node> {
    const { id, content, type = 'content', metadata, valid_from } = input;
    
    const validFrom = valid_from || new Date().toISOString();
    
    return this.transaction(async () => {
      // Check if node with this ID already exists and is current
      const existing = this.getNodeCurrent(id);
      
      let version = 1;
      let supersedes: string | undefined;
      
      if (existing) {
        // This is an update - create new version
        version = (existing.version || 1) + 1;
        supersedes = existing.id;
        
        // Mark old version as no longer valid
        const updateStmt = this.db.prepare(`
          UPDATE nodes 
          SET valid_until = ? 
          WHERE id = ? AND version = ? AND valid_until IS NULL
        `);
        updateStmt.run(validFrom, id, existing.version);
      }
      
      // Insert new version
      const stmt = this.db.prepare(`
        INSERT INTO nodes (id, type, content, metadata, valid_from, valid_until, version, supersedes)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `);
      
      stmt.run(
        id,
        type,
        content,
        metadata ? JSON.stringify(metadata) : null,
        validFrom,
        version,
        supersedes
      );
      
      // Generate embedding for new version
      if (this.vecTableInitialized) {
        await this.vectorizeNode(id, content);
      }
      
      return this.getNodeCurrent(id)!;
    });
  }
  
  // Get current version of a node
  getNodeCurrent(id: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at, 
             valid_from, valid_until, version, supersedes
      FROM nodes
      WHERE id = ? AND valid_until IS NULL
      ORDER BY version DESC
      LIMIT 1
    `);
    
    return this.rowToNode(stmt.get(id) as any);
  }
  
  // Get node at specific point in time
  getNodeAtTime(id: string, timestamp: string): Node | null {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at,
             valid_from, valid_until, version, supersedes
      FROM nodes
      WHERE id = ?
        AND valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY version DESC
      LIMIT 1
    `);
    
    return this.rowToNode(stmt.get(id, timestamp, timestamp) as any);
  }
  
  // Get all versions of a node
  getNodeHistory(id: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at,
             valid_from, valid_until, version, supersedes
      FROM nodes
      WHERE id = ?
      ORDER BY version ASC
    `);
    
    const rows = stmt.all(id) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }
  
  // Get specific version of a node
  getNodeVersion(id: string, version: number): Node | null {
    const stmt = this.db.prepare(`
      SELECT id, type, content, metadata, created_at,
             valid_from, valid_until, version, supersedes
      FROM nodes
      WHERE id = ? AND version = ?
    `);
    
    return this.rowToNode(stmt.get(id, version) as any);
  }
  
  // Helper to convert row to Node
  private rowToNode(row: any): Node | null {
    if (!row) return null;
    
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      version: row.version,
      supersedes: row.supersedes,
    };
  }
  
  // Delete node (temporal soft delete)
  deleteNode(id: string, deletedAt?: string): boolean {
    const timestamp = deletedAt || new Date().toISOString();
    
    return this.transaction(() => {
      // Mark current version as deleted
      const stmt = this.db.prepare(`
        UPDATE nodes
        SET valid_until = ?
        WHERE id = ? AND valid_until IS NULL
      `);
      
      const result = stmt.run(timestamp, id);
      
      // Also mark edges as invalid
      const edgeStmt = this.db.prepare(`
        UPDATE edges
        SET valid_until = ?
        WHERE (from_node = ? OR to_node = ?) AND valid_until IS NULL
      `);
      edgeStmt.run(timestamp, id, id);
      
      return result.changes > 0;
    });
  }
}
```

### 1.4 Add Temporal Edge Operations
```typescript
// ✅ Task: Temporal relationships
// File: src/storage/database.ts

class GraphDB {
  
  addEdge(input: AddEdgeInput): Edge {
    const { 
      from, to, 
      relation = 'related', 
      weight = 1.0, 
      metadata,
      valid_from 
    } = input as AddEdgeInput & { valid_from?: string };
    
    const validFrom = valid_from || new Date().toISOString();
    
    return this.transaction(() => {
      // Validate nodes exist at this time
      const fromNode = valid_from 
        ? this.getNodeAtTime(from, validFrom)
        : this.getNodeCurrent(from);
      const toNode = valid_from
        ? this.getNodeAtTime(to, validFrom)
        : this.getNodeCurrent(to);
      
      if (!fromNode) {
        throw new Error(
          `Cannot create relationship: source document "${from}" ` +
          `does not exist${valid_from ? ` at time ${valid_from}` : ''}`
        );
      }
      
      if (!toNode) {
        throw new Error(
          `Cannot create relationship: target document "${to}" ` +
          `does not exist${valid_from ? ` at time ${valid_from}` : ''}`
        );
      }
      
      // TEMPORAL CAUSALITY CHECK
      // Relationship cannot start before either node exists
      if (fromNode.valid_from && validFrom < fromNode.valid_from) {
        throw new Error(
          `⚠️ Temporal violation: relationship cannot exist (${validFrom}) ` +
          `before source document was created (${fromNode.valid_from})`
        );
      }
      
      if (toNode.valid_from && validFrom < toNode.valid_from) {
        throw new Error(
          `⚠️ Temporal violation: relationship cannot exist (${validFrom}) ` +
          `before target document was created (${toNode.valid_from})`
        );
      }
      
      const stmt = this.db.prepare(`
        INSERT INTO edges (from_node, to_node, relation, weight, metadata, valid_from, valid_until, temporal_weight)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      `);
      
      stmt.run(
        from, to, relation, weight,
        metadata ? JSON.stringify(metadata) : null,
        validFrom,
        weight // temporal_weight starts same as weight
      );
      
      return {
        from_node: from,
        to_node: to,
        relation,
        weight,
        metadata,
        valid_from: validFrom,
        valid_until: undefined,
        temporal_weight: weight,
      };
    });
  }
  
  // Get edges at specific time
  getEdgesAtTime(timestamp: string): Edge[] {
    const stmt = this.db.prepare(`
      SELECT from_node, to_node, relation, weight, metadata, 
             valid_from, valid_until, temporal_weight, created_at
      FROM edges
      WHERE valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
    `);
    
    const rows = stmt.all(timestamp, timestamp) as any[];
    return rows.map(row => this.rowToEdge(row));
  }
  
  private rowToEdge(row: any): Edge {
    return {
      from_node: row.from_node,
      to_node: row.to_node,
      relation: row.relation,
      weight: row.weight,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      temporal_weight: row.temporal_weight,
    };
  }
}
```

### 1.5 Add Basic Temporal Queries
```typescript
// ✅ Task: Time-based graph traversal
// File: src/storage/database.ts

class GraphDB {
  
  // Get neighbors at specific time
  getNeighborsAtTime(
    id: string, 
    timestamp: string,
    direction: Direction = 'both'
  ): NeighborResult[] {
    let query = '';
    const params: any[] = [];
    
    if (direction === 'outgoing' || direction === 'both') {
      query += `
        SELECT to_node as id, relation, 'outgoing' as direction
        FROM edges
        WHERE from_node = ?
          AND valid_from <= ?
          AND (valid_until IS NULL OR valid_until > ?)
      `;
      params.push(id, timestamp, timestamp);
    }
    
    if (direction === 'both') {
      query += ' UNION ALL ';
    }
    
    if (direction === 'incoming' || direction === 'both') {
      query += `
        SELECT from_node as id, relation, 'incoming' as direction
        FROM edges
        WHERE to_node = ?
          AND valid_from <= ?
          AND (valid_until IS NULL OR valid_until > ?)
      `;
      params.push(id, timestamp, timestamp);
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id,
      relation: row.relation,
      direction: row.direction as 'incoming' | 'outgoing',
    }));
  }
  
  // Find path at specific time
  findPathAtTime(
    from: string, 
    to: string, 
    timestamp: string,
    maxDepth: number = 5
  ): PathResult | null {
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
      length: row.depth,
    };
  }
  
  // Get timeline of changes for a node
  getNodeTimeline(id: string): {
    timestamp: string;
    event: 'created' | 'updated' | 'deleted';
    version: number;
    content_preview: string;
  }[] {
    const stmt = this.db.prepare(`
      SELECT 
        valid_from as timestamp,
        CASE 
          WHEN version = 1 THEN 'created'
          WHEN valid_until IS NOT NULL THEN 'deleted'
          ELSE 'updated'
        END as event,
        version,
        substr(content, 1, 100) as content_preview
      FROM nodes
      WHERE id = ?
      ORDER BY valid_from ASC
    `);
    
    return stmt.all(id) as any[];
  }
  
  // Get graph state at specific time (snapshot)
  getGraphSnapshot(timestamp: string): { nodes: Node[]; edges: Edge[] } {
    const nodeStmt = this.db.prepare(`
      SELECT DISTINCT ON (id) *
      FROM nodes
      WHERE valid_from <= ?
        AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY id, version DESC
    `);
    
    const nodes = (nodeStmt.all(timestamp, timestamp) as any[])
      .map(row => this.rowToNode(row)!)
      .filter(n => n !== null);
    
    const edges = this.getEdgesAtTime(timestamp);
    
    return { nodes, edges };
  }
}
```

### 1.6 Update API Layer
```typescript
// ✅ Task: Expose temporal methods in GraphAPI
// File: src/api/graph-api.ts

export class GraphAPI {
  
  // ... existing methods ...
  
  // Temporal queries
  getDocumentAtTime(id: string, timestamp: string): Node | null {
    return this.db.getNodeAtTime(id, timestamp);
  }
  
  getDocumentHistory(id: string): Node[] {
    return this.db.getNodeHistory(id);
  }
  
  getDocumentVersion(id: string, version: number): Node | null {
    return this.db.getNodeVersion(id, version);
  }
  
  getNeighborsAtTime(
    id: string, 
    timestamp: string,
    direction?: Direction
  ): NeighborResult[] {
    return this.db.getNeighborsAtTime(id, timestamp, direction || 'both');
  }
  
  findPathAtTime(
    from: string, 
    to: string, 
    timestamp: string,
    maxDepth?: number
  ): PathResult | null {
    return this.db.findPathAtTime(from, to, timestamp, maxDepth);
  }
  
  getDocumentTimeline(id: string): any[] {
    return this.db.getNodeTimeline(id);
  }
  
  getGraphSnapshot(timestamp: string): { nodes: Node[]; edges: Edge[] } {
    return this.db.getGraphSnapshot(timestamp);
  }
}
```

### 1.7 Add MCP Tools for Temporal Operations
```typescript
// ✅ Task: New MCP tools for temporal queries
// File: src/mcp/tools.ts

// Add these new tool definitions:

export const tools = [
  // ... existing tools ...
  
  {
    name: 'graph_get_document_at_time',
    description: 'Get document state at specific point in time',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
        timestamp: { 
          type: 'string', 
          description: 'ISO 8601 timestamp (e.g., "2024-03-15T10:30:00Z")' 
        },
      },
      required: ['id', 'timestamp'],
    },
  },
  
  {
    name: 'graph_get_document_history',
    description: 'Get all versions/history of a document',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
      },
      required: ['id'],
    },
  },
  
  {
    name: 'graph_get_document_timeline',
    description: 'Get timeline of all changes to a document',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document ID' },
      },
      required: ['id'],
    },
  },
  
  {
    name: 'graph_find_path_at_time',
    description: 'Find path between documents as it existed at specific time',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Starting document ID' },
        to: { type: 'string', description: 'Target document ID' },
        timestamp: { 
          type: 'string', 
          description: 'ISO 8601 timestamp' 
        },
        maxDepth: { 
          type: 'number', 
          description: 'Maximum search depth (default: 5)' 
        },
      },
      required: ['from', 'to', 'timestamp'],
    },
  },
  
  {
    name: 'graph_get_snapshot',
    description: 'Get complete graph state at specific time',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: { 
          type: 'string', 
          description: 'ISO 8601 timestamp' 
        },
      },
      required: ['timestamp'],
    },
  },
];
```

**Phase 1 Deliverables:**
- ✅ All nodes and edges have temporal validity periods
- ✅ Document versioning (v1, v2, v3...)
- ✅ Query graph state at any point in time
- ✅ View history/timeline of any document
- ✅ Temporal causality validation (no time paradoxes!)
- ✅ 5 new MCP tools for temporal operations

---

## Phase 2: Advanced Temporal Queries 🔮
**Goal:** Time-range queries, temporal patterns  
**Estimated Time:** 2 weeks

### 2.1 Time-Range Queries
```typescript
// ✅ Task: Query nodes/edges across time ranges
// File: src/storage/database.ts

class GraphDB {
  
  // Find all nodes that existed during a time range
  getNodesInTimeRange(start: string, end: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT id, type, content, metadata, 
             valid_from, valid_until, version, created_at
      FROM nodes
      WHERE (
        (valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?))
        OR (valid_from >= ? AND valid_from <= ?)
      )
      ORDER BY valid_from ASC
    `);
    
    const rows = stmt.all(start, start, start, end) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }
  
  // Find relationships that existed during time range
  getEdgesInTimeRange(start: string, end: string): Edge[] {
    const stmt = this.db.prepare(`
      SELECT from_node, to_node, relation, weight, metadata,
             valid_from, valid_until, temporal_weight, created_at
      FROM edges
      WHERE (
        (valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?))
        OR (valid_from >= ? AND valid_from <= ?)
      )
      ORDER BY valid_from ASC
    `);
    
    const rows = stmt.all(start, start, start, end) as any[];
    return rows.map(row => this.rowToEdge(row));
  }
  
  // Get nodes created in time range
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
  
  // Get nodes deleted in time range
  getNodesDeletedBetween(start: string, end: string): Node[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_until >= ? AND valid_until <= ?
      ORDER BY valid_until ASC
    `);
    
    const rows = stmt.all(start, end) as any[];
    return rows.map(row => this.rowToNode(row)!);
  }
}
```

### 2.2 Temporal Decay & Weight Changes
```typescript
// ✅ Task: Edge weight decays over time
// File: src/storage/database.ts

class GraphDB {
  
  // Calculate temporal weight based on age
  calculateTemporalWeight(
    edge: Edge,
    atTime: string,
    decayRate: number = 0.1 // 10% decay per month
  ): number {
    if (!edge.valid_from || !edge.temporal_weight) {
      return edge.weight || 1.0;
    }
    
    const start = new Date(edge.valid_from).getTime();
    const current = new Date(atTime).getTime();
    const ageInMonths = (current - start) / (1000 * 60 * 60 * 24 * 30);
    
    // Exponential decay: weight * e^(-decayRate * age)
    const decayedWeight = edge.temporal_weight * Math.exp(-decayRate * ageInMonths);
    
    return Math.max(decayedWeight, 0.01); // Minimum 0.01
  }
  
  // Find path with temporal weights
  findPathWithTemporalWeights(
    from: string,
    to: string,
    atTime: string,
    decayRate?: number
  ): PathResult & { totalWeight: number } | null {
    // This is complex - needs Dijkstra with temporal weights
    // For now, find path and calculate weights
    const path = this.findPathAtTime(from, to, atTime);
    
    if (!path) return null;
    
    let totalWeight = 0;
    for (let i = 0; i < path.path.length - 1; i++) {
      const edgeStmt = this.db.prepare(`
        SELECT * FROM edges
        WHERE from_node = ? AND to_node = ?
          AND valid_from <= ?
          AND (valid_until IS NULL OR valid_until > ?)
        LIMIT 1
      `);
      
      const edgeRow = edgeStmt.get(
        path.path[i], 
        path.path[i + 1],
        atTime,
        atTime
      ) as any;
      
      if (edgeRow) {
        const edge = this.rowToEdge(edgeRow);
        totalWeight += this.calculateTemporalWeight(edge, atTime, decayRate);
      }
    }
    
    return {
      ...path,
      totalWeight,
    };
  }
}
```

### 2.3 Temporal Pattern Detection
```typescript
// ✅ Task: Find recurring patterns over time
// File: src/storage/database.ts

interface TemporalPattern {
  pattern: string; // e.g., "A->B->C"
  occurrences: {
    timestamp: string;
    nodes: string[];
    frequency: number;
  }[];
  avgDurationDays: number;
}

class GraphDB {
  
  // Find recurring path patterns
  findRecurringPatterns(
    startNodeType?: string,
    minOccurrences: number = 3
  ): TemporalPattern[] {
    // This is advanced - simplified version:
    // 1. Find all paths of length 2-4
    // 2. Group by structure (relation types)
    // 3. Find patterns that occur multiple times
    
    const patterns: Map<string, any[]> = new Map();
    
    // Get all edges with timestamps
    const edgeStmt = this.db.prepare(`
      SELECT 
        e1.from_node as n1,
        e1.to_node as n2,
        e1.relation as r1,
        e1.valid_from as t1,
        e2.to_node as n3,
        e2.relation as r2,
        e2.valid_from as t2
      FROM edges e1
      JOIN edges e2 ON e1.to_node = e2.from_node
      WHERE e2.valid_from > e1.valid_from
      ORDER BY e1.valid_from
    `);
    
    const rows = stmt.all() as any[];
    
    for (const row of rows) {
      const patternKey = `${row.r1}->${row.r2}`;
      
      if (!patterns.has(patternKey)) {
        patterns.set(patternKey, []);
      }
      
      patterns.get(patternKey)!.push({
        timestamp: row.t1,
        nodes: [row.n1, row.n2, row.n3],
        duration: new Date(row.t2).getTime() - new Date(row.t1).getTime(),
      });
    }
    
    // Convert to result format
    const result: TemporalPattern[] = [];
    
    for (const [patternKey, occurrences] of patterns.entries()) {
      if (occurrences.length >= minOccurrences) {
        const avgDuration = occurrences.reduce((sum, o) => sum + o.duration, 0) / occurrences.length;
        
        result.push({
          pattern: patternKey,
          occurrences: occurrences.map(o => ({
            timestamp: o.timestamp,
            nodes: o.nodes,
            frequency: occurrences.length,
          })),
          avgDurationDays: avgDuration / (1000 * 60 * 60 * 24),
        });
      }
    }
    
    return result;
  }
}
```

**Phase 2 Deliverables:**
- ✅ Time-range queries (nodes/edges in period)
- ✅ Temporal weight decay calculation
- ✅ Recurring pattern detection
- ✅ Duration analysis between events

---

## Phase 3: Predictive Temporal Features 🔮
**Goal:** Predict future relationships based on patterns  
**Estimated Time:** 2-3 weeks

### 3.1 Predict Future Edges
```typescript
// ✅ Task: Machine learning-lite predictions
// File: src/storage/temporal-predictions.ts (NEW FILE)

export class TemporalPredictor {
  constructor(private db: GraphDB) {}
  
  // Predict likely future relationships
  predictFutureEdges(
    nodeId: string,
    horizonDays: number = 30
  ): {
    to_node: string;
    relation: string;
    probability: number;
    reason: string;
    expected_timeframe_days: number;
  }[] {
    // Analysis based on:
    // 1. Historical patterns of this node
    // 2. Similar nodes' behavior
    // 3. Temporal patterns in the graph
    
    const predictions: any[] = [];
    
    // Get node's history
    const history = this.db.getNodeHistory(nodeId);
    if (history.length === 0) return [];
    
    const currentNode = history[history.length - 1];
    
    // Find edges this node created in the past
    const pastEdgesStmt = this.db.prepare(`
      SELECT 
        to_node,
        relation,
        valid_from,
        julianday(valid_from) - julianday(
          (SELECT valid_from FROM nodes WHERE id = ? ORDER BY version LIMIT 1)
        ) as days_after_creation
      FROM edges
      WHERE from_node = ?
      ORDER BY valid_from ASC
    `);
    
    const pastEdges = pastEdgesStmt.all(nodeId, nodeId) as any[];
    
    // Group by relation type
    const relationStats = new Map<string, number[]>();
    
    for (const edge of pastEdges) {
      if (!relationStats.has(edge.relation)) {
        relationStats.set(edge.relation, []);
      }
      relationStats.get(edge.relation)!.push(edge.days_after_creation);
    }
    
    // Predict based on average timing
    const nodeAge = this.getNodeAgeDays(currentNode);
    
    for (const [relation, timings] of relationStats.entries()) {
      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length;
      const stdDev = this.calculateStdDev(timings);
      
      // If we're approaching the average timing for this relation
      if (nodeAge >= avgTiming - stdDev && nodeAge <= avgTiming + horizonDays) {
        const probability = this.calculateProbability(nodeAge, avgTiming, stdDev);
        
        predictions.push({
          to_node: '?', // We don't know the target yet
          relation,
          probability,
          reason: `This node typically creates "${relation}" relationships around ${Math.round(avgTiming)} days after creation`,
          expected_timeframe_days: Math.max(0, avgTiming - nodeAge),
        });
      }
    }
    
    return predictions.sort((a, b) => b.probability - a.probability);
  }
  
  private getNodeAgeDays(node: Node): number {
    if (!node.valid_from) return 0;
    const created = new Date(node.valid_from).getTime();
    const now = Date.now();
    return (now - created) / (1000 * 60 * 60 * 24);
  }
  
  private calculateStdDev(values: number[]): number {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    return Math.sqrt(avgSquareDiff);
  }
  
  private calculateProbability(current: number, expected: number, stdDev: number): number {
    // Simple normal distribution probability
    const z = Math.abs(current - expected) / stdDev;
    return Math.max(0, 1 - (z / 3)); // 3-sigma rule
  }
}
```

### 3.2 Temporal Anomaly Detection
```typescript
// ✅ Task: Detect unusual temporal patterns
// File: src/storage/temporal-predictions.ts

export class TemporalPredictor {
  
  // Detect anomalies in timing
  detectAnomalies(nodeId: string): {
    type: 'too_fast' | 'too_slow' | 'unexpected_relation' | 'missing_relation';
    description: string;
    severity: 'low' | 'medium' | 'high';
    details: any;
  }[] {
    const anomalies: any[] = [];
    
    // Get node's edges
    const edgesStmt = this.db.prepare(`
      SELECT *
      FROM edges
      WHERE from_node = ?
      ORDER BY valid_from ASC
    `);
    
    const edges = (edgesStmt.all(nodeId) as any[]).map(row => this.db.rowToEdge(row));
    
    // Check for edges created too quickly
    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1];
      const curr = edges[i];
      
      if (!prev.valid_from || !curr.valid_from) continue;
      
      const timeDiff = new Date(curr.valid_from).getTime() - new Date(prev.valid_from).getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      // If two edges created within 1 hour - might be suspicious
      if (hoursDiff < 1) {
        anomalies.push({
          type: 'too_fast',
          description: `Two relationships created within 1 hour: "${prev.relation}" and "${curr.relation}"`,
          severity: 'medium',
          details: {
            edge1: prev,
            edge2: curr,
            hoursApart: hoursDiff,
          },
        });
      }
    }
    
    // Check for expected but missing relations
    const predictions = this.predictFutureEdges(nodeId, 365); // Look back 1 year
    
    for (const pred of predictions) {
      if (pred.probability > 0.7 && pred.expected_timeframe_days < 0) {
        // This relation was expected but never happened
        anomalies.push({
          type: 'missing_relation',
          description: `Expected "${pred.relation}" relationship never created`,
          severity: 'low',
          details: pred,
        });
      }
    }
    
    return anomalies;
  }
}
```

**Phase 3 Deliverables:**
- ✅ Predict future relationships based on history
- ✅ Detect temporal anomalies
- ✅ Statistical analysis of temporal patterns
- ✅ Confidence scores for predictions

---

## Example Usage After All Phases 🎉

```typescript
const api = new GraphAPI('temporal-graph.db');

// ===== Phase 1: Basic Temporal Features =====

// Add document with temporal info
await api.addDocument('contract_001', 'Purchase agreement...', {
  type: 'contract',
  valid_from: '2024-01-15T00:00:00Z',
});

// Update it (creates v2)
await api.addDocument('contract_001', 'Amended purchase agreement...', {
  type: 'contract',
  valid_from: '2024-02-01T00:00:00Z',
});

// Get history
const history = api.getDocumentHistory('contract_001');
console.log(`Document has ${history.length} versions`);

// Time travel!
const jan20 = api.getDocumentAtTime('contract_001', '2024-01-20T00:00:00Z');
console.log('In January, the contract said:', jan20.content);

const feb10 = api.getDocumentAtTime('contract_001', '2024-02-10T00:00:00Z');
console.log('In February, it said:', feb10.content);

// ===== Phase 2: Time Ranges & Patterns =====

// What documents were created in Q1?
const q1Docs = api.db.getNodesCreatedBetween(
  '2024-01-01T00:00:00Z',
  '2024-03-31T23:59:59Z'
);

// Find recurring patterns
const patterns = api.db.findRecurringPatterns(undefined, 3);
console.log('Discovered pattern:', patterns[0].pattern);
console.log(`Occurs on average every ${patterns[0].avgDurationDays} days`);

// ===== Phase 3: Predictions =====

const predictor = new TemporalPredictor(api.db);

// What might happen next?
const predictions = predictor.predictFutureEdges('contract_001', 30);
console.log('Likely next event:', predictions[0]);
// "This node typically creates 'amendment' relationships around 45 days after creation"

// Are there any unusual patterns?
const anomalies = predictor.detectAnomalies('contract_001');
if (anomalies.length > 0) {
  console.log('⚠️ Anomaly detected:', anomalies[0].description);
}

api.close();
```

---

## Summary

**Phase 0 (1 week):** Minimal prep → Just transactions & indexes  
**Phase 1 (2-3 weeks):** CORE TEMPORAL → Versioning, time travel, causality  
**Phase 2 (2 weeks):** Advanced queries → Time ranges, decay, patterns  
**Phase 3 (2-3 weeks):** Predictions → ML-lite forecasting, anomaly detection  

**Total: 7-9 weeks to full temporal graph awesomeness!** 🚀

This is what makes your project unique - not just "another graph DB" but a **time-aware knowledge system** that understands causality, tracks evolution, and predicts the future! 

Want to start with Phase 0 + Phase 1.1 (the schema changes)?