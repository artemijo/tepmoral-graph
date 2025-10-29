import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';
import type { RichMetadata } from '../src/types';

describe('Rich Metadata', () => {
  let db: GraphDB;

  beforeEach(async () => {
    db = new GraphDB(':memory:');
  });

  describe('Adding Documents with Rich Metadata', () => {
    test('should add document with all metadata fields', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Legal contract for equipment purchase',
        metadata: {
          tags: ['legal', 'contract', 'urgent'],
          path: ['contracts', '2024', 'Q1'],
          emoji: '📄',
          keywords: ['payment', 'delivery', 'warranty'],
          vocabulary: {
            'FOB': 'Free On Board',
            'Net 30': 'Payment due 30 days after invoice'
          },
          map: {
            'section_1': 'parties involved',
            'section_2': 'payment terms',
            'section_3': 'delivery schedule'
          },
          type: 'contract',
          author: 'John Doe',
          date: '2024-01-15'
        }
      });

      const doc = db.getNode('doc1');
      expect(doc).toBeDefined();
      expect(doc?.metadata?.tags).toEqual(['legal', 'contract', 'urgent']);
      expect(doc?.metadata?.emoji).toBe('📄');
      expect(doc?.metadata?.keywords).toHaveLength(3);
      expect(doc?.metadata?.vocabulary).toHaveProperty('FOB');
      expect(doc?.metadata?.map).toHaveProperty('section_1');
    });

    test('should handle minimal metadata', async () => {
      await db.addNode({
        id: 'doc2',
        content: 'Simple note',
        metadata: {
          tags: ['note']
        }
      });

      const doc = db.getNode('doc2');
      expect(doc?.metadata?.tags).toEqual(['note']);
    });
  });

  describe('Smart Search', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'contract1',
        content: 'Purchase agreement for equipment',
        metadata: {
          tags: ['legal', 'contract'],
          emoji: '📄',
          type: 'contract',
          author: 'Alice'
        }
      });

      await db.addNode({
        id: 'email1',
        content: 'Urgent email about payment deadline',
        metadata: {
          tags: ['urgent', 'email'],
          emoji: '📧',
          type: 'email',
          author: 'Bob'
        }
      });

      await db.addNode({
        id: 'note1',
        content: 'Meeting notes about legal matters',
        metadata: {
          tags: ['legal', 'meeting'],
          emoji: '📝',
          type: 'note',
          author: 'Alice'
        }
      });
    });

    test('should search by content only', () => {
      const results = db.searchDocuments({ query: 'payment' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('email1');
    });

    test('should filter by single tag', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal'] }
      });
      expect(results).toHaveLength(2);
      expect(results.map(d => d.id)).toContain('contract1');
      expect(results.map(d => d.id)).toContain('note1');
    });

    test('should filter by multiple tags (AND)', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal', 'contract'] }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by emoji', () => {
      const results = db.searchDocuments({
        filters: { emoji: '📄' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by type', () => {
      const results = db.searchDocuments({
        filters: { type: 'email' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('email1');
    });

    test('should filter by author', () => {
      const results = db.searchDocuments({
        filters: { author: 'Alice' }
      });
      expect(results).toHaveLength(2);
    });

    test('should combine content search and filters', () => {
      const results = db.searchDocuments({
        query: 'agreement',
        filters: { type: 'contract' }
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('contract1');
    });

    test('should filter by path prefix', async () => {
      await db.addNode({
        id: 'doc_path',
        content: 'Document in path',
        metadata: {
          path: ['projects', '2024', 'website']
        }
      });

      const results = db.searchDocuments({
        filters: { path_prefix: ['projects', '2024'] }
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc_path');
    });

    test('should respect limit', () => {
      const results = db.searchDocuments({
        filters: { tags: ['legal'] },
        limit: 1
      });
      expect(results).toHaveLength(1);
    });

    test('should sort results', () => {
      const resultsDesc = db.searchDocuments({
        filters: { author: 'Alice' },
        sort_by: 'created_at',
        sort_order: 'desc'
      });

      const resultsAsc = db.searchDocuments({
        filters: { author: 'Alice' },
        sort_by: 'created_at',
        sort_order: 'asc'
      });

      expect(resultsDesc[0].id).not.toBe(resultsAsc[0].id);
    });
  });

  describe('Tag Operations', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Document 1',
        metadata: { tags: ['draft'] }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Document 2',
        metadata: { tags: ['draft', 'legal'] }
      });
    });

    test('should add tags to document', () => {
      const result = db.performTagOperation({
        action: 'add',
        document_id: 'doc1',
        tags: ['urgent', 'legal']
      });

      expect(result.updated).toBe(1);
      
      const doc = db.getNode('doc1');
      expect(doc?.metadata?.tags).toContain('urgent');
      expect(doc?.metadata?.tags).toContain('legal');
      expect(doc?.metadata?.tags).toContain('draft');
    });

    test('should remove tags from document', () => {
      const result = db.performTagOperation({
        action: 'remove',
        document_id: 'doc2',
        tags: ['draft']
      });

      expect(result.updated).toBe(1);
      
      const doc = db.getNode('doc2');
      expect(doc?.metadata?.tags).not.toContain('draft');
      expect(doc?.metadata?.tags).toContain('legal');
    });

    test('should rename tag globally', () => {
      const result = db.performTagOperation({
        action: 'rename',
        rename: { from: 'draft', to: 'final' }
      });

      expect(result.updated).toBe(2);
      
      const doc1 = db.getNode('doc1');
      const doc2 = db.getNode('doc2');
      
      expect(doc1?.metadata?.tags).toContain('final');
      expect(doc1?.metadata?.tags).not.toContain('draft');
      expect(doc2?.metadata?.tags).toContain('final');
    });

    test('should list all tags', () => {
      const result = db.performTagOperation({
        action: 'list'
      });

      expect(result).toHaveLength(2); // draft, legal
      expect(result.find((t: any) => t.tag === 'draft')?.count).toBe(2);
      expect(result.find((t: any) => t.tag === 'legal')?.count).toBe(1);
    });

    test('should get document tags', () => {
      const tags = db.performTagOperation({
        action: 'get',
        document_id: 'doc2'
      });

      expect(tags).toEqual(['draft', 'legal']);
    });

    test('should bulk add tags using filter', () => {
      const result = db.performTagOperation({
        action: 'add',
        document_filter: { tags: ['draft'] },
        tags: ['reviewed']
      });

      expect(result.updated).toBe(2);
      
      const doc1 = db.getNode('doc1');
      const doc2 = db.getNode('doc2');
      
      expect(doc1?.metadata?.tags).toContain('reviewed');
      expect(doc2?.metadata?.tags).toContain('reviewed');
    });
  });

  describe('Metadata Statistics', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Doc 1',
        metadata: {
          tags: ['legal', 'urgent'],
          keywords: ['contract', 'payment'],
          emoji: '📄',
          type: 'contract',
          path: ['legal', '2024']
        }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Doc 2',
        metadata: {
          tags: ['legal', 'draft'],
          keywords: ['contract'],
          emoji: '📄',
          type: 'contract',
          path: ['legal', '2024', 'Q1']
        }
      });

      await db.addNode({
        id: 'doc3',
        content: 'Doc 3',
        metadata: {
          tags: ['urgent'],
          emoji: '🔥',
          type: 'email'
        }
      });
    });

    test('should count tags', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.tags['legal']).toBe(2);
      expect(stats.tags['urgent']).toBe(2);
      expect(stats.tags['draft']).toBe(1);
    });

    test('should count keywords', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.keywords['contract']).toBe(2);
      expect(stats.keywords['payment']).toBe(1);
    });

    test('should count emojis', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.emojis['📄']).toBe(2);
      expect(stats.emojis['🔥']).toBe(1);
    });

    test('should count types', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.types['contract']).toBe(2);
      expect(stats.types['email']).toBe(1);
    });

    test('should list unique paths', () => {
      const stats = db.getMetadataStats();
      
      expect(stats.paths).toHaveLength(2);
      expect(stats.paths).toContain('legal/2024');
      expect(stats.paths).toContain('legal/2024/Q1');
    });
  });

  describe('List by Path', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Project doc',
        metadata: { path: ['projects', 'website'] }
      });

      await db.addNode({
        id: 'doc2',
        content: 'Another project doc',
        metadata: { path: ['projects', 'website'] }
      });

      await db.addNode({
        id: 'doc3',
        content: 'App doc',
        metadata: { path: ['projects', 'app'] }
      });
    });

    test('should group documents by path', () => {
      const grouped = db.listDocumentsByPath();
      
      expect(grouped['projects/website']).toHaveLength(2);
      expect(grouped['projects/app']).toHaveLength(1);
    });
  });
});