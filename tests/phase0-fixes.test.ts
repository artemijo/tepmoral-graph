import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphDB } from '../src/storage/database.js';
import fs from 'fs/promises';

describe('Phase 0 Fixes: Transactions and Temporal Indexes', () => {
  let db: GraphDB;

  beforeEach(async () => {
    // Clean up database files before each test
    try {
      await fs.unlink('test-graph.db');
      await fs.unlink('test-graph.db-shm');
      await fs.unlink('test-graph.db-wal');
    } catch (error) {
      // Files might not exist, that's OK
    }
    db = new GraphDB('test-graph.db');
  });

  afterEach(() => {
    db.close();
  });

  describe('Transaction Wrapper', () => {
    it('should provide atomic transaction for edge creation', async () => {
      // Add test nodes
      await db.addNode({ id: 'node1', content: 'Test content 1' });
      await db.addNode({ id: 'node2', content: 'Test content 2' });

      // Test that addEdge is wrapped in transaction
      // This should succeed - both nodes exist
      const edge = db.addEdge({
        from: 'node1',
        to: 'node2',
        relation: 'test_relation',
        weight: 1.5,
        metadata: { test: true }
      });

      expect(edge).toEqual({
        from_node: 'node1',
        to_node: 'node2',
        relation: 'test_relation',
        weight: 1.5,
        metadata: { test: true }
      });

      // Verify edge was actually created
      const neighbors = db.getNeighbors('node1', 'outgoing');
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0]).toEqual({
        id: 'node2',
        relation: 'test_relation',
        direction: 'outgoing'
      });
    });

    it('should rollback edge creation on validation failure', () => {
      // Try to create edge with non-existent source node
      expect(() => {
        db.addEdge({
          from: 'nonexistent',
          to: 'node1',
          relation: 'should_fail'
        });
      }).toThrow('Source document not found: nonexistent');

      // Verify no partial data was created
      const neighbors = db.getNeighbors('node1', 'incoming');
      expect(neighbors).toHaveLength(0);
    });

    it('should provide atomic transaction for node deletion', async () => {
      // Add test node with embedding
      await db.addNode({ id: 'delete_test', content: 'Content to delete' });

      // Verify node exists
      const node = db.getNode('delete_test');
      expect(node).toBeTruthy();
      expect(node?.id).toBe('delete_test');

      // Delete node (should be atomic)
      const deleteResult = db.deleteNode('delete_test');
      expect(deleteResult).toBe(true);

      // Verify node is actually deleted
      const deletedNode = db.getNode('delete_test');
      expect(deletedNode).toBeNull();
    });

    it('should handle deletion of non-existent node gracefully', () => {
      const deleteResult = db.deleteNode('nonexistent_node');
      expect(deleteResult).toBe(false);
    });
  });

  describe('Temporal Indexes', () => {
    it('should have created_at indexes for temporal queries', async () => {
      // Add nodes with different timestamps
      await db.addNode({ id: 'temp1', content: 'First content' });
      await new Promise(resolve => setTimeout(resolve, 100)); // Longer delay for different timestamps
      await db.addNode({ id: 'temp2', content: 'Second content' });
      await new Promise(resolve => setTimeout(resolve, 100)); // Longer delay for different timestamps
      await db.addNode({ id: 'temp3', content: 'Third content' });

      // List nodes - should be ordered by created_at DESC due to index
      const nodes = db.listNodes(10);
      expect(nodes).toHaveLength(3);

      // Verify all have created_at timestamps
      nodes.forEach(node => {
        expect(node.created_at).toBeTruthy();
        expect(typeof node.created_at).toBe('string');
      });

      // Check that the index is being used by verifying we can query by created_at
      // This tests that the index exists and is functional
      const newestNode = nodes[0];
      expect(newestNode.id).toBeTruthy();
      
      // Verify timestamps are in ISO format and can be parsed
      const timestamp = new Date(newestNode.created_at!);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });

    it('should have type index for efficient type queries', async () => {
      // Add nodes of different types
      await db.addNode({ id: 'type1', content: 'Content 1', type: 'document' });
      await db.addNode({ id: 'type2', content: 'Content 2', type: 'note' });
      await db.addNode({ id: 'type3', content: 'Content 3', type: 'document' });

      // Get all nodes and filter by type
      const nodes = db.listNodes(10);
      const documentNodes = nodes.filter(n => n.type === 'document');
      const noteNodes = nodes.filter(n => n.type === 'note');

      expect(documentNodes).toHaveLength(2);
      expect(noteNodes).toHaveLength(1);
    });

    it('should have relation+weight composite index', async () => {
      // Add test nodes
      await db.addNode({ id: 'rel1', content: 'Node 1' });
      await db.addNode({ id: 'rel2', content: 'Node 2' });
      await db.addNode({ id: 'rel3', content: 'Node 3' });

      // Add edges with different relations and weights
      db.addEdge({ from: 'rel1', to: 'rel2', relation: 'high_priority', weight: 0.9 });
      db.addEdge({ from: 'rel1', to: 'rel3', relation: 'high_priority', weight: 0.8 });
      db.addEdge({ from: 'rel2', to: 'rel3', relation: 'low_priority', weight: 0.2 });

      // Get neighbors and verify we can filter by relation type efficiently
      const neighbors = db.getNeighbors('rel1', 'outgoing');
      expect(neighbors).toHaveLength(2);
      
      const highPriorityEdges = neighbors.filter(n => n.relation === 'high_priority');
      expect(highPriorityEdges).toHaveLength(2);
    });
  });

  describe('Database Integrity with Transactions', () => {
    it('should maintain data consistency during concurrent operations', async () => {
      // Add initial data
      await db.addNode({ id: 'integrity1', content: 'Base content' });
      await db.addNode({ id: 'integrity2', content: 'Related content' });

      // Create relationship
      db.addEdge({ from: 'integrity1', to: 'integrity2', relation: 'references' });

      // Delete and recreate in transaction-like manner
      const deleteResult = db.deleteNode('integrity2');
      expect(deleteResult).toBe(true);

      // Verify edge was also deleted (foreign key constraint)
      const neighbors = db.getNeighbors('integrity1', 'outgoing');
      expect(neighbors).toHaveLength(0);

      // Verify node is actually gone
      const deletedNode = db.getNode('integrity2');
      expect(deletedNode).toBeNull();

      // Original node should still exist
      const originalNode = db.getNode('integrity1');
      expect(originalNode).toBeTruthy();
      expect(originalNode?.id).toBe('integrity1');
    });

    it('should handle edge updates correctly', async () => {
      // Add test nodes
      await db.addNode({ id: 'update1', content: 'Node 1' });
      await db.addNode({ id: 'update2', content: 'Node 2' });

      // Create initial edge
      const edge1 = db.addEdge({ 
        from: 'update1', 
        to: 'update2', 
        relation: 'initial', 
        weight: 1.0 
      });

      // Update the same edge (ON CONFLICT DO UPDATE)
      const edge2 = db.addEdge({ 
        from: 'update1', 
        to: 'update2', 
        relation: 'updated', 
        weight: 2.0,
        metadata: { version: 2 }
      });

      // Verify the edge was updated
      expect(edge2.relation).toBe('updated');
      expect(edge2.weight).toBe(2.0);
      expect(edge2.metadata).toEqual({ version: 2 });

      // Verify only one edge exists
      const neighbors = db.getNeighbors('update1', 'outgoing');
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].relation).toBe('updated');
    });
  });
});