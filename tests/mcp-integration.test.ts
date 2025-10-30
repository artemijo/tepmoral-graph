import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';
import { GraphAPI } from '../src/api/graph-api';

describe('Part 3: MCP Integration', () => {
  let db: GraphDB;
  let api: GraphAPI;

  beforeEach(() => {
    db = new GraphDB(':memory:');
    api = new GraphAPI(':memory:');
  });

  describe('Graph Explore Tool', () => {
    beforeEach(async () => {
      await api.addDocument('doc1', 'Start', { type: 'root' });
      await api.addDocument('doc2', 'Middle', { tags: ['important'] });
      await api.addDocument('doc3', 'End', { type: 'leaf' });

      api.addRelationship('doc1', 'doc2', 'links');
      api.addRelationship('doc2', 'doc3', 'links');
    });

    test('should explore from starting node', () => {
      const result = api.exploreGraph({
        start: 'doc1',
        strategy: 'breadth',
        max_depth: 2
      });

      expect(result.root).toBe('doc1');
      expect(result.nodes.length).toBeGreaterThan(1);
      expect(result.nodes.find((n: any) => n.id === 'doc1')).toBeDefined();
      expect(result.nodes.find((n: any) => n.id === 'doc2')).toBeDefined();
    });

    test('should filter by relationship type', () => {
      api.addRelationship('doc1', 'doc3', 'shortcut');

      const result = api.exploreGraph({
        start: 'doc1',
        strategy: 'breadth',
        max_depth: 2,
        follow_relations: ['links']
      });

      // Should not include direct doc1->doc3 shortcut edge
      const directEdge = result.edges.find(
        (e: any) => e.from_node === 'doc1' && e.to_node === 'doc3'
      );
      expect(directEdge).toBeUndefined();
    });

    test('should filter by node type', () => {
      const result = api.exploreGraph({
        start: 'doc1',
        strategy: 'breadth',
        max_depth: 2,
        filters: { type: 'leaf' }
      });

      const nodeIds = result.nodes.map((n: any) => n.id);
      expect(nodeIds).toContain('doc1'); // Start node is always included
      // Check if we can find doc3 through the exploration
      const foundDoc3 = result.nodes.some((n: any) => n.id === 'doc3');
      expect(foundDoc3).toBe(true);
      // Note: doc2 might still be included as start node's neighbor, but won't match type filter
    });

    test('should respect max_nodes limit', () => {
      const result = api.exploreGraph({
        start: 'doc1',
        strategy: 'breadth',
        max_depth: 10,
        max_nodes: 2
      });

      expect(result.nodes.length).toBeLessThanOrEqual(2);
      expect(result.stats.truncated).toBe(true);
    });
  });

  describe('Update Document Tool', () => {
    beforeEach(async () => {
      await api.addDocument('doc1', 'Original', { tags: ['draft'], author: 'Alice' });
    });

    test('should update content only', async () => {
      await api.updateDocument('doc1', {
        content: 'Updated content'
      });

      const doc = api.getDocument('doc1');
      expect(doc?.content).toBe('Updated content');
      expect(doc?.metadata?.tags).toEqual(['draft']);
      expect(doc?.metadata?.author).toBe('Alice');
      expect(doc?.version).toBe(2);
    });

    test('should merge metadata', async () => {
      await api.updateDocument('doc1', {
        metadata: { status: 'review', priority: 'high' },
        merge_metadata: true
      });

      const doc = api.getDocument('doc1');
      expect(doc?.metadata?.tags).toEqual(['draft']);
      expect(doc?.metadata?.author).toBe('Alice');
      expect(doc?.metadata?.status).toBe('review');
      expect(doc?.metadata?.priority).toBe('high');
    });

    test('should replace metadata', async () => {
      await api.updateDocument('doc1', {
        metadata: { status: 'final' },
        merge_metadata: false
      });

      const doc = api.getDocument('doc1');
      expect(doc?.metadata?.tags).toBeUndefined();
      expect(doc?.metadata?.author).toBeUndefined();
      expect(doc?.metadata?.status).toBe('final');
    });
  });

  describe('Timeline Tool', () => {
    test('should generate document timeline', async () => {
      await api.addDocument('doc1', 'V1', { status: 'draft' });

      await api.updateDocument('doc1', {
        content: 'V2',
        metadata: { status: 'review' },
        merge_metadata: false
      });

      await api.updateDocument('doc1', {
        content: 'V3',
        metadata: { status: 'final' },
        merge_metadata: false
      });

      const timeline = api.getDocumentTimeline('doc1');

      expect(timeline).toHaveLength(3);
      expect(timeline[0].event).toBe('created');
      // The second and third events should be 'updated' (not 'deleted')
      expect(timeline[1].event).toBe('updated');
      expect(timeline[2].event).toBe('updated');
      
      expect(timeline[1].changes).toContain('Content modified');
      expect(timeline[1].changes && timeline[1].changes.some((c: any) => c.includes('Status'))).toBe(true);
    });
  });

  describe('Compare Versions Tool', () => {
    test('should compare document versions', async () => {
      await api.addDocument('doc1', 'Short', { tags: ['v1'] });

      await api.updateDocument('doc1', {
        content: 'Much longer content with details',
        metadata: { tags: ['v2'], status: 'final' },
        merge_metadata: false
      });

      const comparison = api.compareDocumentVersions('doc1', 1, 2);

      expect(comparison.version1.version).toBe(1);
      expect(comparison.version2.version).toBe(2);
      expect(comparison.differences.content_changed).toBe(true);
      expect(comparison.differences.metadata_changes).toContain('tags');
      expect(comparison.differences.metadata_changes).toContain('status');
      expect(comparison.differences.content_diff.length_change).toBeGreaterThan(0);
    });
  });

  describe('Time Range Query Tools', () => {
    beforeEach(async () => {
      // Create documents with specific timestamps using the GraphAPI constructor
      const testDb = new GraphDB(':memory:');
      
      // Create documents with specific timestamps
      await testDb.addNode({
        id: 'doc1',
        content: 'Jan doc',
        valid_from: '2024-01-15T00:00:00Z'
      });

      await testDb.addNode({
        id: 'doc2',
        content: 'Feb doc',
        valid_from: '2024-02-15T00:00:00Z'
      });

      await testDb.addNode({
        id: 'doc3',
        content: 'Mar doc',
        valid_from: '2024-03-15T00:00:00Z'
      });

      // Update doc2 in April
      await testDb.updateNode('doc2', {
        content: 'Updated in April',
        valid_from: '2024-04-15T00:00:00Z'
      });

      // Replace the api's db with our test db
      (api as any).db = testDb;
    });

    test('should get documents created in range', () => {
      const q1Docs = api.getDocumentsCreatedBetween(
        '2024-01-01T00:00:00Z',
        '2024-03-31T23:59:59Z'
      );

      expect(q1Docs).toHaveLength(3);
      expect(q1Docs.map((d: any) => d.id).sort()).toEqual(['doc1', 'doc2', 'doc3']);
      expect(q1Docs.every((d: any) => d.version === 1)).toBe(true);
    });

    test('should get documents modified in range', () => {
      const aprilDocs = api.getDocumentsModifiedBetween(
        '2024-04-01T00:00:00Z',
        '2024-04-30T23:59:59Z'
      );

      expect(aprilDocs).toHaveLength(1);
      expect(aprilDocs[0].id).toBe('doc2');
      expect(aprilDocs[0].version).toBe(2);
    });
  });

  describe('Map Graph Tool', () => {
    beforeEach(async () => {
      await api.addDocument('doc1', 'First', { type: 'contract', emoji: '📄' });
      await api.addDocument('doc2', 'Second', { type: 'email', emoji: '📧', tags: ['urgent'] });
      await api.addDocument('doc3', 'Third', { type: 'note', emoji: '📝' });

      api.addRelationship('doc1', 'doc2', 'references');
      api.addRelationship('doc2', 'doc3', 'mentions');
    });

    test('should map all nodes', () => {
      const result = api.mapGraph({
        scope: 'all',
        format: 'json'
      });

      expect(result.metadata.scope).toBe('all');
      expect(result.metadata.total_nodes).toBeGreaterThanOrEqual(3);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });

    test('should generate Mermaid diagram', () => {
      const result = api.mapGraph({
        scope: 'all',
        format: 'mermaid'
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('graph TD');
      expect(result).toContain('doc1');
      expect(result).toContain('📄');
      expect(result).toContain('references');
      expect(result).toContain('style');
    });

    test('should include statistics', () => {
      const result = api.mapGraph({
        scope: 'all',
        format: 'json',
        include_stats: true
      });

      expect(result.stats).toBeDefined();
      expect(result.stats.node_type_distribution.contract).toBe(1);
      expect(result.stats.node_type_distribution.email).toBe(1);
      expect(result.stats.node_type_distribution.note).toBe(1);
      expect(result.stats.relationship_types.references).toBe(1);
      expect(result.stats.relationship_types.mentions).toBe(1);
    });
  });

  describe('Temporal Parameters on Existing Tools', () => {
    beforeEach(async () => {
      // Create documents with current time
      await api.addDocument('doc1', 'Version 1', { status: 'draft' });
      await api.updateDocument('doc1', {
        content: 'Version 2',
        metadata: { status: 'final' },
        merge_metadata: false
      });
      await api.addDocument('doc2', 'Second doc');
      api.addRelationship('doc1', 'doc2', 'links');
    });

    test('getDocumentAtTime should work', () => {
      // Test with current time - should get latest version
      const now = new Date().toISOString();
      const current = api.getDocumentAtTime('doc1', now);
      
      expect(current?.version).toBe(2);
      expect(current?.metadata?.status).toBe('final');
    });

    test('getNeighbors with temporal options', () => {
      // Test with current time
      const now = new Date().toISOString();
      const neighbors = api.getNeighbors('doc1', 'both', {
        depth: 1,
        at_time: now
      });
      
      expect(neighbors.length).toBeGreaterThan(0);
      expect(neighbors[0].id).toBe('doc2');
    });
  });
});