import { describe, test, expect, beforeEach } from 'vitest';
import { GraphAPI } from '../src/api/graph-api';

describe('GraphAPI Integration', () => {
  let api: GraphAPI;

  beforeEach(() => {
    api = new GraphAPI(':memory:');
  });

  test('complete workflow: documents, relationships, and search', async () => {
    // Add documents
    await api.addDocument('contract_001', 'Purchase agreement for equipment', {
      type: 'contract',
      date: '2024-01-15',
    });

    await api.addDocument('amendment_001', 'Amendment to contract regarding delivery', {
      type: 'amendment',
      date: '2024-02-10',
    });

    await api.addDocument('claim_001', 'Claim regarding defects', {
      type: 'claim',
      date: '2024-03-05',
    });

    // Verify documents were added
    const doc1 = api.getDocument('contract_001');
    expect(doc1).toBeDefined();
    expect(doc1?.content).toContain('Purchase agreement');

    // Add relationships
    api.addRelationship('contract_001', 'amendment_001', 'amends');
    api.addRelationship('amendment_001', 'claim_001', 'leads_to');

    // Test neighbors
    const neighbors = api.getNeighbors('amendment_001', 'both');
    expect(neighbors.length).toBe(2);

    // Test path finding
    const path = api.findPath('contract_001', 'claim_001');
    expect(path).toBeDefined();
    expect(path?.path).toEqual(['contract_001', 'amendment_001', 'claim_001']);

    // Test full-text search
    const searchResults = api.searchContent('defects');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].id).toBe('claim_001');

    // Test stats
    const stats = api.getStats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(2);

    // Test list documents
    const docs = api.listDocuments(10);
    expect(docs.length).toBe(3);

    // Test delete
    const deleted = api.deleteDocument('claim_001');
    expect(deleted).toBe(true);
    expect(api.getDocument('claim_001')).toBeNull();

    api.close();
  });

  test('complex graph navigation', async () => {
    // Create a more complex graph
    // A -> B -> C
    // A -> D -> C
    // B -> E
    
    await api.addDocument('A', 'Document A');
    await api.addDocument('B', 'Document B');
    await api.addDocument('C', 'Document C');
    await api.addDocument('D', 'Document D');
    await api.addDocument('E', 'Document E');

    api.addRelationship('A', 'B', 'links');
    api.addRelationship('B', 'C', 'links');
    api.addRelationship('A', 'D', 'links');
    api.addRelationship('D', 'C', 'links');
    api.addRelationship('B', 'E', 'links');

    // Test shortest path (should prefer A->B->C over A->D->C)
    const path = api.findPath('A', 'C');
    expect(path).toBeDefined();
    expect(path?.length).toBeLessThanOrEqual(2);

    // Test neighbors
    const aNeighbors = api.getNeighbors('A', 'outgoing');
    expect(aNeighbors.length).toBe(2);

    const cNeighbors = api.getNeighbors('C', 'incoming');
    expect(cNeighbors.length).toBe(2);

    api.close();
  });

  test('metadata handling', async () => {
    const metadata = {
      author: 'John Doe',
      tags: ['important', 'legal'],
      priority: 'high',
      custom: {
        nested: 'value',
      },
    };

    await api.addDocument('doc_with_metadata', 'Content', metadata);

    const doc = api.getDocument('doc_with_metadata');
    expect(doc?.metadata).toEqual(metadata);

    // Test relationship metadata
    api.addRelationship('doc_with_metadata', 'doc_with_metadata', 'self-ref', {
      note: 'Test relationship',
    });

    api.close();
  });

  test('export and import workflow', async () => {
    // Add some data
    await api.addDocument('doc1', 'Document 1');
    await api.addDocument('doc2', 'Document 2');
    api.addRelationship('doc1', 'doc2', 'links');

    // Export
    const exported = api.exportGraph();
    expect(exported.nodes.length).toBe(2);
    expect(exported.edges.length).toBe(1);

    // Verify structure
    expect(exported.nodes[0]).toHaveProperty('id');
    expect(exported.nodes[0]).toHaveProperty('content');
    expect(exported.edges[0]).toHaveProperty('from_node');
    expect(exported.edges[0]).toHaveProperty('to_node');

    api.close();
  });
});
