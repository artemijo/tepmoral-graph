import { describe, test, expect, beforeAll } from 'vitest';
import { EmbeddingGenerator } from '../src/storage/embeddings';

describe('EmbeddingGenerator', () => {
  let generator: EmbeddingGenerator;

  beforeAll(async () => {
    generator = new EmbeddingGenerator();
    await generator.initialize();
  }, 30000); // 30 second timeout for model loading

  test('should generate embedding', async () => {
    const text = 'This is a test document about machine learning';
    const embedding = await generator.generateEmbedding(text);
    
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 dimension
  }, 10000);

  test('should generate different embeddings for different texts', async () => {
    const text1 = 'Machine learning and artificial intelligence';
    const text2 = 'Cooking recipes for Italian pasta';
    
    const emb1 = await generator.generateEmbedding(text1);
    const emb2 = await generator.generateEmbedding(text2);
    
    expect(emb1).not.toEqual(emb2);
  }, 10000);

  test('should generate batch embeddings', async () => {
    const texts = [
      'First document',
      'Second document',
      'Third document',
    ];
    
    const embeddings = await generator.generateBatchEmbeddings(texts);
    
    expect(embeddings.length).toBe(3);
    embeddings.forEach(emb => {
      expect(emb).toBeInstanceOf(Float32Array);
      expect(emb.length).toBe(384);
    });
  }, 15000);

  test('should return correct dimension', () => {
    const dim = generator.getDimension();
    expect(dim).toBe(384);
  });
});
