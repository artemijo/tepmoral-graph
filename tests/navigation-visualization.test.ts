import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';

describe('Part 2A: Navigation & Visualization', () => {
  let db: GraphDB;

  beforeEach(() => {
    db = new GraphDB(':memory:');
  });

  describe('Graph Exploration', () => {
    beforeEach(async () => {
      // Create network: A → B → C → D, A → D (shortcut)
      await db.addNode({ id: 'A', content: 'Node A', metadata: { type: 'start' }, valid_from: '2024-01-01T00:00:00Z' });
      await db.addNode({ id: 'B', content: 'Node B', metadata: { tags: ['important'] }, valid_from: '2024-01-01T00:00:00Z' });
      await db.addNode({ id: 'C', content: 'Node C', metadata: { tags: ['other'] }, valid_from: '2024-01-01T00:00:00Z' });
      await db.addNode({ id: 'D', content: 'Node D', metadata: { type: 'end' }, valid_from: '2024-01-01T00:00:00Z' });

      db.addEdge({ from: 'A', to: 'B', relation: 'links', valid_from: '2024-01-02T00:00:00Z' });
      db.addEdge({ from: 'B', to: 'C', relation: 'links', valid_from: '2024-01-02T00:00:00Z' });
      db.addEdge({ from: 'C', to: 'D', relation: 'links', valid_from: '2024-01-02T00:00:00Z' });
      db.addEdge({ from: 'A', to: 'D', relation: 'shortcut', valid_from: '2024-01-02T00:00:00Z' });
    });

    test('should explore with BFS', () => {
      const result = db.exploreGraph({
        start: 'A',
        strategy: 'breadth',
        max_depth: 2
      });

      expect(result.strategy).toBe('breadth');
      expect(result.root).toBe('A');
      expect(result.nodes.length).toBeGreaterThan(1);
      expect(result.nodes.find(n => n.id === 'A')).toBeDefined();
    });

    test('should respect max_nodes limit', () => {
      const result = db.exploreGraph({
        start: 'A',
        strategy: 'breadth',
        max_depth: 10,
        max_nodes: 2
      });

      expect(result.nodes.length).toBeLessThanOrEqual(2);
      expect(result.stats.truncated).toBe(true);
    });

    test('should filter by relationship type', () => {
      const result = db.exploreGraph({
        start: 'A',
        strategy: 'breadth',
        max_depth: 2,
        follow_relations: ['links']
      });

      const shortcutEdge = result.edges.find(e => e.relation === 'shortcut');
      expect(shortcutEdge).toBeUndefined();
    });

    test('should filter by tags', () => {
      const result = db.exploreGraph({
        start: 'A',
        strategy: 'breadth',
        max_depth: 2,
        filters: { tags: ['important'] }
      });

      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain('A');
      expect(nodeIds).toContain('B');
      expect(nodeIds).not.toContain('C');
    });

    test('should include depth in results', () => {
      const result = db.exploreGraph({
        start: 'A',
        strategy: 'breadth',
        max_depth: 2
      });

      const nodeA = result.nodes.find(n => n.id === 'A');
      expect(nodeA?.depth).toBe(0);
    });

    test('should throw error if start node not found', () => {
      expect(() => {
        db.exploreGraph({
          start: 'nonexistent',
          strategy: 'breadth'
        });
      }).toThrow('Start node not found');
    });
  });

  describe('Graph Mapping - Scopes', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'First document',
        metadata: { type: 'contract', tags: ['legal'], emoji: '📄' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc2',
        content: 'Second document',
        metadata: { type: 'email', tags: ['urgent'], emoji: '📧' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc3',
        content: 'Third document',
        metadata: { type: 'note', tags: ['personal'], emoji: '📝' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      db.addEdge({ from: 'doc1', to: 'doc2', relation: 'references', valid_from: '2024-01-02T00:00:00Z' });
      db.addEdge({ from: 'doc2', to: 'doc3', relation: 'mentions', valid_from: '2024-01-02T00:00:00Z' });
    });

    test('scope: all - should map all nodes', () => {
      const result = db.mapGraph({
        scope: 'all',
        format: 'json'
      });

      expect(result.metadata.scope).toBe('all');
      expect(result.metadata.total_nodes).toBeGreaterThanOrEqual(3);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    test('scope: filtered - should map by tags', () => {
      const result = db.mapGraph({
        scope: 'filtered',
        filters: { tags: ['legal'] },
        format: 'json'
      });

      expect(result.nodes.every((n: any) => n.metadata?.tags?.includes('legal'))).toBe(true);
    });

    test('scope: subgraph - should map around focus nodes', () => {
      const result = db.mapGraph({
        scope: 'subgraph',
        focus_nodes: ['doc1'],
        radius: 1,
        format: 'json'
      });

      expect(result.nodes.find((n: any) => n.id === 'doc1')).toBeDefined();
      expect(result.nodes.find((n: any) => n.id === 'doc2')).toBeDefined();
    });

    test('scope: temporal_slice - should map at time', () => {
      const result = db.mapGraph({
        scope: 'temporal_slice',
        at_time: '2024-01-01T12:00:00Z',
        format: 'json'
      });

      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('Graph Mapping - Formats', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Test',
        metadata: { emoji: '📄', status: 'draft' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc2',
        content: 'Test',
        metadata: { emoji: '📧' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      db.addEdge({ from: 'doc1', to: 'doc2', relation: 'links', valid_from: '2024-01-02T00:00:00Z' });
    });

    test('JSON format with metadata', () => {
      const result = db.mapGraph({
        scope: 'all',
        include_metadata: true,
        format: 'json'
      });

      expect(result.nodes[0].metadata).toBeDefined();
    });

    test('JSON format with stats', () => {
      const result = db.mapGraph({
        scope: 'all',
        include_stats: true,
        format: 'json'
      });

      expect(result.stats).toBeDefined();
      expect(result.stats.node_type_distribution).toBeDefined();
      expect(result.stats.relationship_types).toBeDefined();
    });

    test('Mermaid format - basic structure', () => {
      const result = db.mapGraph({
        scope: 'all',
        format: 'mermaid'
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('graph TD');
      expect(result).toContain('doc1');
      expect(result).toContain('doc2');
      expect(result).toContain('links');
    });

    test('Mermaid format - includes emojis', () => {
      const result = db.mapGraph({
        scope: 'all',
        format: 'mermaid'
      });

      expect(result).toContain('📄');
      expect(result).toContain('📧');
    });

    test('Mermaid format - includes styling', () => {
      const result = db.mapGraph({
        scope: 'all',
        format: 'mermaid'
      });

      expect(result).toContain('style');
      expect(result).toContain('fill:');
    });
  });

  describe('Graph Mapping - Limits & Options', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++) {
        await db.addNode({
          id: `doc${i}`,
          content: `Document ${i}`,
          valid_from: '2024-01-01T00:00:00Z'
        });
      }
    });

    test('should respect max_nodes limit', () => {
      const result = db.mapGraph({
        scope: 'all',
        max_nodes: 3,
        format: 'json'
      });

      expect(result.nodes.length).toBeLessThanOrEqual(3);
      expect(result.metadata.truncated).toBe(true);
    });

    test('should include content preview', () => {
      const result = db.mapGraph({
        scope: 'all',
        include_content_preview: true,
        format: 'json'
      });

      expect(result.nodes[0].preview).toBeDefined();
      expect(result.nodes[0].preview.length).toBeLessThanOrEqual(103);
    });
  });
});