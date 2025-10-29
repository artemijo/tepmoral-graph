-- Узлы (документы)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'content',
    content TEXT NOT NULL,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Temporal fields (Phase 1.A)
    valid_from TEXT,
    valid_until TEXT,
    version INTEGER DEFAULT 1,
    supersedes TEXT
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

-- Convenience views for current state (no history)
CREATE VIEW IF NOT EXISTS current_nodes AS
SELECT * FROM nodes WHERE valid_until IS NULL;

CREATE VIEW IF NOT EXISTS current_edges AS
SELECT * FROM edges WHERE valid_until IS NULL;

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
