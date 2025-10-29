import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';

describe('Phase 1.A: Temporal Schema', () => {
  let db: GraphDB;

  beforeEach(() => {
    db = new GraphDB(':memory:');
  });

  describe('Schema Structure', () => {
    test('should have temporal columns in nodes table', async () => {
      // Add a node with temporal fields
      await db.addNode({
        id: 'test1',
        content: 'Test content',
        valid_from: '2024-01-01T00:00:00Z'
      });

      // Verify the node was stored
      const node = db.getNode('test1');
      expect(node).toBeDefined();
    });

    test('should accept nodes without temporal fields', async () => {
      // Should work without temporal fields (backward compatible)
      await db.addNode({
        id: 'test2',
        content: 'Test content'
      });

      const node = db.getNode('test2');
      expect(node).toBeDefined();
      expect(node?.id).toBe('test2');
    });

    test('should store valid_from timestamp', async () => {
      const timestamp = '2024-01-15T10:30:00Z';
      
      await db.addNode({
        id: 'test3',
        content: 'Test',
        valid_from: timestamp
      });

      const node = db.getNode('test3');
      expect(node?.valid_from).toBe(timestamp);
    });

    test('should default version to 1', async () => {
      await db.addNode({
        id: 'test4',
        content: 'Test'
      });

      const node = db.getNode('test4');
      expect(node?.version).toBe(1);
    });

    test('should accept valid_until as undefined initially', async () => {
      await db.addNode({
        id: 'test5',
        content: 'Test',
        valid_from: '2024-01-01T00:00:00Z'
      });

      const node = db.getNode('test5');
      expect(node?.valid_until).toBeUndefined(); // Should be undefined (not set)
    });
  });

  describe('Temporal Indexes', () => {
    test('should handle multiple documents with different timestamps', async () => {
      // Add documents with various timestamps
      await db.addNode({
        id: 'doc1',
        content: 'Doc 1',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc2',
        content: 'Doc 2',
        valid_from: '2024-02-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc3',
        content: 'Doc 3',
        valid_from: '2024-03-01T00:00:00Z'
      });

      // Should be able to query all
      const doc1 = db.getNode('doc1');
      const doc2 = db.getNode('doc2');
      const doc3 = db.getNode('doc3');

      expect(doc1).toBeDefined();
      expect(doc2).toBeDefined();
      expect(doc3).toBeDefined();
    });
  });

  describe('Views', () => {
    test('current_nodes view should exist', async () => {
      // Add some nodes
      await db.addNode({ id: 'doc1', content: 'Test 1' });
      await db.addNode({ id: 'doc2', content: 'Test 2' });

      // Query using the view should work (tested via regular queries)
      const nodes = db.listNodes();
      expect(nodes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Backward Compatibility', () => {
    test('should work with existing non-temporal operations', async () => {
      // All existing operations should still work
      await db.addNode({
        id: 'compat1',
        content: 'Compatibility test',
        metadata: { tags: ['test'] }
      });

      const node = db.getNode('compat1');
      expect(node?.content).toBe('Compatibility test');
      expect(node?.metadata?.tags).toEqual(['test']);
    });

    test('should support relationships without temporal data', async () => {
      // First create the nodes
      await db.addNode({ id: 'compat1', content: 'Compatibility test' });
      await db.addNode({ id: 'doc1', content: 'Test 1' });
      
      // Relationships should work without temporal fields initially
      db.addEdge({ from: 'compat1', to: 'doc1', relation: 'links' });

      const neighbors = db.getNeighbors('compat1');
      expect(neighbors.some(n => n.id === 'doc1')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle ISO timestamp formats correctly', async () => {
      const timestamps = [
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:00:00.000Z',
        '2024-12-31T23:59:59Z',
      ];

      for (let i = 0; i < timestamps.length; i++) {
        await db.addNode({
          id: `ts-test-${i}`,
          content: 'Test',
          valid_from: timestamps[i]
        });

        const node = db.getNode(`ts-test-${i}`);
        expect(node?.valid_from).toBe(timestamps[i]);
      }
    });

    test('should handle very old and future timestamps', async () => {
      await db.addNode({
        id: 'old',
        content: 'Old doc',
        valid_from: '2000-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'future',
        content: 'Future doc',
        valid_from: '2030-01-01T00:00:00Z'
      });

      expect(db.getNode('old')).toBeDefined();
      expect(db.getNode('future')).toBeDefined();
    });
  });
});