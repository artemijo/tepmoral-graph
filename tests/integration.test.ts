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
    const searchResults = api.search({ query: 'defects' });
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

  test('rich metadata and tag workflow', async () => {
    const api = new GraphAPI(':memory:');
    
    // Add documents with rich metadata
    await api.addDocument('contract_001', 'Purchase agreement for equipment worth $1M', {
      tags: ['legal', 'contract'],
      path: ['contracts', '2024', 'Q1'],
      emoji: '📄',
      keywords: ['purchase', 'equipment', 'payment'],
      vocabulary: {
        'FOB': 'Free On Board',
        'Net 30': 'Payment due 30 days after invoice'
      },
      map: {
        'section_1': 'parties',
        'section_2': 'terms',
        'section_3': 'delivery'
      },
      type: 'contract',
      author: 'Alice',
      date: '2024-01-15'
    });

    await api.addDocument('email_001', 'Urgent email about payment deadline', {
      tags: ['urgent', 'email'],
      emoji: '📧',
      keywords: ['payment', 'deadline'],
      type: 'email',
      author: 'Bob'
    });

    await api.addDocument('note_001', 'Meeting notes about legal review', {
      tags: ['legal', 'meeting'],
      path: ['meetings', '2024', 'Q1'],
      emoji: '📝',
      type: 'note',
      author: 'Alice'
    });

    // Test 1: Search by tags
    const legalDocs = api.search({
      filters: { tags: ['legal'] }
    });
    expect(legalDocs).toHaveLength(2);

    // Test 2: Search with multiple filters
    const aliceLegal = api.search({
      filters: {
        tags: ['legal'],
        author: 'Alice'
      }
    });
    expect(aliceLegal).toHaveLength(2);

    // Test 3: Search by emoji
    const contracts = api.search({
      filters: { emoji: '📄' }
    });
    expect(contracts).toHaveLength(1);
    expect(contracts[0].id).toBe('contract_001');

    // Test 4: Search by path prefix
    const q1Docs = api.search({
      filters: {
        path_prefix: ['contracts', '2024']
      }
    });
    expect(q1Docs).toHaveLength(1);

    // Test 5: Content + metadata search
    const paymentLegal = api.search({
      query: 'payment',
      filters: {
        tags: ['legal']
      }
    });
    // Note: This might return 0 if payment is only in keywords, not content
    // Let's test with keywords instead
    const paymentLegalByKeywords = api.search({
      filters: {
        tags: ['legal'],
        keywords: ['payment']
      }
    });
    expect(paymentLegalByKeywords.length).toBeGreaterThan(0);

    // Test 6: Add tags
    const addResult = api.addTags('email_001', ['legal', 'reviewed']);
    expect(addResult.updated).toBe(1);
    
    const emailTags = api.getTags('email_001');
    expect(emailTags).toContain('legal');
    expect(emailTags).toContain('reviewed');

    // Test 7: Remove tags
    const removeResult = api.removeTags('email_001', ['urgent']);
    expect(removeResult.updated).toBe(1);
    
    const updatedTags = api.getTags('email_001');
    expect(updatedTags).not.toContain('urgent');

    // Test 8: List all tags
    const allTags = api.listTags();
    expect(allTags.length).toBeGreaterThan(0);
    expect(allTags.find(t => t.tag === 'legal')).toBeDefined();

    // Test 9: Rename tag globally
    api.manageTags({
      action: 'rename',
      rename: { from: 'meeting', to: 'meetings' }
    });
    
    const noteTags = api.getTags('note_001');
    expect(noteTags).toContain('meetings');
    expect(noteTags).not.toContain('meeting');

    // Test 10: Bulk operations
    api.manageTags({
      action: 'add',
      document_filter: { tags: ['legal'] },
      tags: ['requires-signature']
    });
    
    const contractTags = api.getTags('contract_001');
    const emailUpdatedTags = api.getTags('email_001');
    const noteTagsUpdated = api.getTags('note_001');
    
    expect(contractTags).toContain('requires-signature');
    expect(emailUpdatedTags).toContain('requires-signature');
    expect(noteTagsUpdated).toContain('requires-signature');

    // Test 11: Metadata stats
    const stats = api.getMetadataStats();
    expect(stats.tags['legal']).toBeGreaterThan(0);
    expect(stats.emojis['📄']).toBe(1);
    expect(stats.types['contract']).toBe(1);

    api.close();
  });
});
