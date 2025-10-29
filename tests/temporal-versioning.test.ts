import { describe, test, expect, beforeEach } from 'vitest';
import { GraphDB } from '../src/storage/database';

describe('Phase 1.B: Document Versioning', () => {
  let db: GraphDB;

  beforeEach(() => {
    db = new GraphDB(':memory:');
  });

  describe('Version Creation', () => {
    test('should create version 1 on first add', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Version 1 content',
        valid_from: '2024-01-01T00:00:00Z'
      });

      const doc = db.getNodeCurrent('doc1');

      expect(doc).toBeDefined();
      expect(doc?.version).toBe(1);
      expect(doc?.content).toBe('Version 1 content');
      expect(doc?.valid_from).toBe('2024-01-01T00:00:00Z');
      expect(doc?.valid_until).toBeUndefined();
      expect(doc?.supersedes).toBeUndefined();
    });

    test('should use current time if valid_from not provided', async () => {
      const before = new Date().toISOString();
      
      await db.addNode({
        id: 'doc2',
        content: 'Test'
      });

      const after = new Date().toISOString();
      const doc = db.getNodeCurrent('doc2');

      expect(doc?.valid_from).toBeDefined();
      expect(doc!.valid_from! >= before).toBe(true);
      expect(doc!.valid_from! <= after).toBe(true);
    });

    test('should create version 2 on update', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Version 1',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'Version 2',
        valid_from: '2024-02-01T00:00:00Z'
      });

      const current = db.getNodeCurrent('doc1');

      expect(current?.version).toBe(2);
      expect(current?.content).toBe('Version 2');
      expect(current?.valid_from).toBe('2024-02-01T00:00:00Z');
      expect(current?.supersedes).toBe('doc1');
    });

    test('should mark old version as expired', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Version 1',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'Version 2',
        valid_from: '2024-02-01T00:00:00Z'
      });

      const v1 = db.getNodeVersion('doc1', 1);

      expect(v1?.valid_until).toBe('2024-02-01T00:00:00Z');
      expect(v1?.content).toBe('Version 1');
    });

    test('should handle multiple versions', async () => {
      const versions = [
        { content: 'V1', time: '2024-01-01T00:00:00Z' },
        { content: 'V2', time: '2024-02-01T00:00:00Z' },
        { content: 'V3', time: '2024-03-01T00:00:00Z' },
        { content: 'V4', time: '2024-04-01T00:00:00Z' },
      ];

      for (const v of versions) {
        await db.addNode({
          id: 'doc1',
          content: v.content,
          valid_from: v.time
        });
      }

      const history = db.getNodeHistory('doc1');

      expect(history).toHaveLength(4);
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(3);
      expect(history[3].version).toBe(4);

      const current = db.getNodeCurrent('doc1');
      expect(current?.version).toBe(4);
      expect(current?.content).toBe('V4');
    });
  });

  describe('Metadata Versioning', () => {
    test('should preserve metadata across versions', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'V1',
        metadata: { tags: ['draft'], author: 'Alice' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'V2',
        metadata: { tags: ['draft', 'reviewed'], author: 'Alice' },
        valid_from: '2024-02-01T00:00:00Z'
      });

      const v1 = db.getNodeVersion('doc1', 1);
      const v2 = db.getNodeVersion('doc1', 2);

      expect(v1?.metadata?.tags).toEqual(['draft']);
      expect(v1?.metadata?.author).toBe('Alice');
      
      expect(v2?.metadata?.tags).toEqual(['draft', 'reviewed']);
      expect(v2?.metadata?.author).toBe('Alice');
    });

    test('should allow metadata changes without content changes', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Same content',
        metadata: { status: 'draft' },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'Same content',
        metadata: { status: 'final' },
        valid_from: '2024-02-01T00:00:00Z'
      });

      const v1 = db.getNodeVersion('doc1', 1);
      const v2 = db.getNodeVersion('doc1', 2);

      expect(v1?.content).toBe(v2?.content);
      expect(v1?.metadata?.status).toBe('draft');
      expect(v2?.metadata?.status).toBe('final');
    });
  });

  describe('History Retrieval', () => {
    beforeEach(async () => {
      await db.addNode({
        id: 'doc1',
        content: 'V1',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'V2',
        valid_from: '2024-02-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'V3',
        valid_from: '2024-03-01T00:00:00Z'
      });
    });

    test('should get all versions in chronological order', () => {
      const history = db.getNodeHistory('doc1');

      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(1);
      expect(history[0].content).toBe('V1');
      expect(history[1].version).toBe(2);
      expect(history[1].content).toBe('V2');
      expect(history[2].version).toBe(3);
      expect(history[2].content).toBe('V3');
    });

    test('should get specific version', () => {
      const v1 = db.getNodeVersion('doc1', 1);
      const v2 = db.getNodeVersion('doc1', 2);
      const v3 = db.getNodeVersion('doc1', 3);

      expect(v1?.content).toBe('V1');
      expect(v2?.content).toBe('V2');
      expect(v3?.content).toBe('V3');
    });

    test('should return null for non-existent version', () => {
      const v99 = db.getNodeVersion('doc1', 99);
      expect(v99).toBeNull();
    });

    test('should get current version', () => {
      const current = db.getNodeCurrent('doc1');

      expect(current?.version).toBe(3);
      expect(current?.content).toBe('V3');
      expect(current?.valid_until).toBeUndefined();
    });

    test('should get version count', () => {
      const count = db.getNodeVersionCount('doc1');
      expect(count).toBe(3);
    });

    test('should return 0 count for non-existent document', () => {
      const count = db.getNodeVersionCount('nonexistent');
      expect(count).toBe(0);
    });

    test('should return empty array for non-existent document history', () => {
      const history = db.getNodeHistory('nonexistent');
      expect(history).toEqual([]);
    });
  });

  describe('Temporal Validity Windows', () => {
    test('should have non-overlapping validity windows', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'V1',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'V2',
        valid_from: '2024-02-01T00:00:00Z'
      });

      const v1 = db.getNodeVersion('doc1', 1);
      const v2 = db.getNodeVersion('doc1', 2);

      // V1 ends exactly when V2 starts
      expect(v1?.valid_until).toBe(v2?.valid_from);
    });

    test('should have open-ended validity for current version', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Current',
        valid_from: '2024-01-01T00:00:00Z'
      });

      const current = db.getNodeCurrent('doc1');
      expect(current?.valid_until).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('should handle rapid successive updates', async () => {
      const baseTime = new Date('2024-01-01T00:00:00Z').getTime();

      for (let i = 0; i < 10; i++) {
        const time = new Date(baseTime + i * 1000).toISOString();
        await db.addNode({
          id: 'doc1',
          content: `Version ${i + 1}`,
          valid_from: time
        });
      }

      const history = db.getNodeHistory('doc1');
      expect(history).toHaveLength(10);

      const current = db.getNodeCurrent('doc1');
      expect(current?.version).toBe(10);
    });

    test('should handle updates with same timestamp', async () => {
      const sameTime = '2024-01-01T00:00:00Z';

      await db.addNode({
        id: 'doc1',
        content: 'V1',
        valid_from: sameTime
      });

      await db.addNode({
        id: 'doc1',
        content: 'V2',
        valid_from: sameTime
      });

      const current = db.getNodeCurrent('doc1');
      expect(current?.version).toBe(2);
      expect(current?.content).toBe('V2');
    });

    test('should handle very long content in multiple versions', async () => {
      const longContent = 'x'.repeat(100000); // 100KB

      await db.addNode({
        id: 'doc1',
        content: longContent,
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: longContent + 'y',
        valid_from: '2024-02-01T00:00:00Z'
      });

      const v1 = db.getNodeVersion('doc1', 1);
      const v2 = db.getNodeVersion('doc1', 2);

      expect(v1?.content.length).toBe(100000);
      expect(v2?.content.length).toBe(100001);
    });
  });

  describe('Integration with Existing Features', () => {
    test('should maintain embeddings for each version', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'First version about cats',
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'Second version about dogs',
        valid_from: '2024-02-01T00:00:00Z'
      });

      // Current version should have embeddings
      const similar = await db.findSimilar('doc1');
      expect(similar).toBeDefined();
    });

    test('should maintain search functionality', async () => {
      await db.addNode({
        id: 'doc1',
        content: 'Important contract document',
        metadata: { tags: ['legal'] },
        valid_from: '2024-01-01T00:00:00Z'
      });

      await db.addNode({
        id: 'doc1',
        content: 'Updated important contract',
        metadata: { tags: ['legal', 'final'] },
        valid_from: '2024-02-01T00:00:00Z'
      });

      // Should search current version
      const results = db.searchContent('contract');
      expect(results).toHaveLength(1);
      expect(results[0].version).toBe(2);
      expect(results[0].metadata?.tags).toContain('final');
    });
  });
});