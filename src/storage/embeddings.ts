import { pipeline } from '@xenova/transformers';

export class EmbeddingGenerator {
  private model: any = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('Initializing embedding model...');
    this.model = await pipeline('feature-extraction', this.modelName);
    this.initialized = true;
    console.log('Embedding model initialized');
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.initialized || !this.model) {
      await this.initialize();
    }

    if (!this.model) {
      throw new Error('Failed to initialize embedding model');
    }

    // Generate embedding
    const output = await this.model(text, { pooling: 'mean', normalize: true });
    
    // Extract the embedding array
    const embedding = Array.from(output.data) as number[];
    
    // Verify dimension (should be 384 for all-MiniLM-L6-v2)
    if (embedding.length !== 384) {
      throw new Error(`Unexpected embedding dimension: ${embedding.length}, expected 384`);
    }

    return new Float32Array(embedding);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = [];
    
    for (const text of texts) {
      embeddings.push(await this.generateEmbedding(text));
    }
    
    return embeddings;
  }

  getDimension(): number {
    return 384; // Fixed for all-MiniLM-L6-v2
  }
}

// Singleton instance
let embeddingGenerator: EmbeddingGenerator | null = null;

export function getEmbeddingGenerator(): EmbeddingGenerator {
  if (!embeddingGenerator) {
    embeddingGenerator = new EmbeddingGenerator();
  }
  return embeddingGenerator;
}
