import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';

describe('GraphDB', () => {
  let db: GraphDB;

  beforeEach(() => {
    db = new GraphDB(':memory:');
  });

  describe('Node Operations', () => {
    test('should add and retrieve node', async () => {
      await db.addNode({
        id: 'test1',
        content: 'Test content for node 1',
      });

      const node = db.getNode('test1');
      expect(node).toBeDefined();
      expect(node?.id).toBe('test1');
      expect(node?.content).toBe('Test content for node 1');
      expect(node?.type).toBe('content');
    });

    test('should add node with metadata', async () => {
      await db.addNode({
        id: 'test2',
        content: 'Test content',
        metadata: { author: 'John', tags: ['important'] },
      });

      const node = db.getNode('test2');
      expect(node?.metadata).toEqual({ author: 'John', tags: ['important'] });
    });

    test('should list nodes', async () => {
      await db.addNode({ id: 'node1', content: 'Content 1' });
      await db.addNode({ id: 'node2', content: 'Content 2' });
      await db.addNode({ id: 'node3', content: 'Content 3' });

      const nodes = db.listNodes(10);
      expect(nodes.length).toBe(3);
    });

    test('should delete node', async () => {
      await db.addNode({ id: 'test3', content: 'Test' });
      expect(db.getNode('test3')).toBeDefined();

      const deleted = db.deleteNode('test3');
      expect(deleted).toBe(true);
      expect(db.getNode('test3')).toBeNull();
    });

    test('should return false when deleting non-existent node', () => {
      const deleted = db.deleteNode('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('Edge Operations', () => {
    beforeEach(async () => {
      await db.addNode({ id: 'A', content: 'Node A' });
      await db.addNode({ id: 'B', content: 'Node B' });
      await db.addNode({ id: 'C', content: 'Node C' });
    });

    test('should add edge', () => {
      const edge = db.addEdge({ from: 'A', to: 'B', relation: 'links_to' });
      expect(edge.from_node).toBe('A');
      expect(edge.to_node).toBe('B');
      expect(edge.relation).toBe('links_to');
    });

    test('should get outgoing neighbors', () => {
      db.addEdge({ from: 'A', to: 'B' });
      db.addEdge({ from: 'A', to: 'C' });

      const neighbors = db.getNeighbors('A', 'outgoing');
      expect(neighbors.length).toBe(2);
      expect(neighbors.map(n => n.id)).toContain('B');
      expect(neighbors.map(n => n.id)).toContain('C');
    });

    test('should get incoming neighbors', () => {
      db.addEdge({ from: 'A', to: 'B' });
      db.addEdge({ from: 'C', to: 'B' });

      const neighbors = db.getNeighbors('B', 'incoming');
      expect(neighbors.length).toBe(2);
      expect(neighbors.map(n => n.id)).toContain('A');
      expect(neighbors.map(n => n.id)).toContain('C');
    });

    test('should get both neighbors', () => {
      db.addEdge({ from: 'A', to: 'B' });
      db.addEdge({ from: 'B', to: 'C' });

      const neighbors = db.getNeighbors('B', 'both');
      expect(neighbors.length).toBe(2);
    });
  });

  describe('Path Finding', () => {
    beforeEach(async () => {
      // Create chain: A -> B -> C -> D
      await db.addNode({ id: 'A', content: 'Node A' });
      await db.addNode({ id: 'B', content: 'Node B' });
      await db.addNode({ id: 'C', content: 'Node C' });
      await db.addNode({ id: 'D', content: 'Node D' });

      db.addEdge({ from: 'A', to: 'B' });
      db.addEdge({ from: 'B', to: 'C' });
      db.addEdge({ from: 'C', to: 'D' });
    });

    test('should find direct path', () => {
      const path = db.findPath('A', 'B');
      expect(path).toBeDefined();
      expect(path?.path).toEqual(['A', 'B']);
      expect(path?.length).toBe(1);
    });

    test('should find path through multiple nodes', () => {
      const path = db.findPath('A', 'D');
      expect(path).toBeDefined();
      expect(path?.path).toEqual(['A', 'B', 'C', 'D']);
      expect(path?.length).toBe(3);
    });

    test('should return null when no path exists', () => {
      const path = db.findPath('D', 'A'); // No reverse path
      expect(path).toBeNull();
    });

    test('should respect maxDepth', () => {
      const path = db.findPath('A', 'D', 2); // Too short
      expect(path).toBeNull();
    });
  });

  describe('Full-Text Search', () => {
    beforeEach(async () => {
      await db.addNode({ id: '1', content: 'Machine learning and AI' });
      await db.addNode({ id: '2', content: 'Deep learning neural networks' });
      await db.addNode({ id: '3', content: 'Cooking recipes for pasta' });
    });

    test('should search content', () => {
      const results = db.searchContent('learning');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('learning');
    });

    test('should return empty for no match', () => {
      const results = db.searchContent('xyz123');
      expect(results.length).toBe(0);
    });
  });

  describe('Statistics', () => {
    test('should return stats for empty graph', () => {
      const stats = db.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.avgDegree).toBe(0);
    });

    test('should return correct stats', async () => {
      await db.addNode({ id: 'A', content: 'Node A' });
      await db.addNode({ id: 'B', content: 'Node B' });
      db.addEdge({ from: 'A', to: 'B' });

      const stats = db.getStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.edgeCount).toBe(1);
      expect(stats.avgDegree).toBeGreaterThan(0);
    });
  });

  describe('Export', () => {
    test('should export graph', async () => {
      await db.addNode({ id: 'A', content: 'Node A' });
      await db.addNode({ id: 'B', content: 'Node B' });
      db.addEdge({ from: 'A', to: 'B' });

      const exported = db.exportGraph();
      expect(exported.nodes.length).toBe(2);
      expect(exported.edges.length).toBe(1);
    });
  });
});
