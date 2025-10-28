import { GraphAPI } from '../src/api/graph-api.js';

async function main() {
  const graph = new GraphAPI('research.db');

  console.log('🔬 Research Knowledge Graph Example\n');

  // Scenario: Building a research paper knowledge graph

  // 1. Add research papers
  console.log('📚 Adding research papers...');
  
  await graph.addDocument(
    'paper_transformers_2017',
    'Attention Is All You Need. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
    {
      year: 2017,
      authors: ['Vaswani et al.'],
      citations: 50000,
      venue: 'NeurIPS',
    }
  );

  await graph.addDocument(
    'paper_bert_2018',
    'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding.',
    {
      year: 2018,
      authors: ['Devlin et al.'],
      citations: 40000,
      venue: 'NAACL',
    }
  );

  await graph.addDocument(
    'paper_gpt3_2020',
    'Language Models are Few-Shot Learners. We show that scaling up language models greatly improves task-agnostic performance.',
    {
      year: 2020,
      authors: ['Brown et al.'],
      citations: 15000,
      venue: 'NeurIPS',
    }
  );

  await graph.addDocument(
    'paper_palm_2022',
    'PaLM: Scaling Language Modeling with Pathways. Large language models have been shown to achieve remarkable performance.',
    {
      year: 2022,
      authors: ['Chowdhery et al.'],
      citations: 2000,
      venue: 'JMLR',
    }
  );

  await graph.addDocument(
    'concept_attention',
    'Self-attention mechanism allows models to weigh the importance of different parts of the input.',
    {
      type: 'concept',
    }
  );

  await graph.addDocument(
    'concept_pretraining',
    'Pre-training involves training models on large corpora before fine-tuning on specific tasks.',
    {
      type: 'concept',
    }
  );

  console.log('✅ Papers added\n');

  // 2. Create citation and concept relationships
  console.log('🔗 Building citation graph...');
  
  // Citations: newer papers cite older ones
  graph.addRelationship('paper_bert_2018', 'paper_transformers_2017', 'cites');
  graph.addRelationship('paper_gpt3_2020', 'paper_transformers_2017', 'cites');
  graph.addRelationship('paper_gpt3_2020', 'paper_bert_2018', 'cites');
  graph.addRelationship('paper_palm_2022', 'paper_gpt3_2020', 'cites');
  graph.addRelationship('paper_palm_2022', 'paper_bert_2018', 'cites');

  // Concept relationships
  graph.addRelationship('paper_transformers_2017', 'concept_attention', 'introduces');
  graph.addRelationship('paper_bert_2018', 'concept_pretraining', 'uses');
  graph.addRelationship('paper_bert_2018', 'concept_attention', 'uses');
  graph.addRelationship('paper_gpt3_2020', 'concept_pretraining', 'uses');
  
  console.log('✅ Relationships created\n');

  // 3. Analyze citation paths
  console.log('📊 Analyzing research lineage...');
  console.log('\nCitation path from Transformers to PaLM:');
  const path = graph.findPath('paper_transformers_2017', 'paper_palm_2022');
  if (path) {
    path.path.forEach((paperId, idx) => {
      const paper = graph.getDocument(paperId);
      const prefix = idx === 0 ? '  🎯' : idx === path.path.length - 1 ? '  🏁' : '  ➡️';
      console.log(`${prefix} ${paper?.metadata?.year || '?'}: ${paperId}`);
    });
  }
  console.log('');

  // 4. Find related papers
  console.log('🔍 Papers citing BERT:');
  const bertCiters = graph.getNeighbors('paper_bert_2018', 'incoming');
  bertCiters.forEach(n => {
    if (n.relation === 'cites') {
      const paper = graph.getDocument(n.id);
      console.log(`  - ${n.id} (${paper?.metadata?.year})`);
    }
  });
  console.log('');

  // 5. Find papers using specific concepts
  console.log('📌 Papers using attention mechanism:');
  const attentionUsers = graph.getNeighbors('concept_attention', 'incoming');
  attentionUsers.forEach(n => {
    const paper = graph.getDocument(n.id);
    console.log(`  - ${n.id}: ${n.relation}`);
  });
  console.log('');

  // 6. Semantic search for related work
  try {
    console.log('🎯 Finding papers semantically similar to "transformers"...');
    const similar = await graph.findSimilar('paper_transformers_2017', 3);
    
    similar.forEach((doc, idx) => {
      console.log(`  ${idx + 1}. ${doc.id} (similarity: ${doc.similarity.toFixed(3)})`);
      console.log(`     "${doc.content.substring(0, 60)}..."`);
    });
    console.log('');
  } catch (error) {
    console.log('  ⚠️  Vector search not available\n');
  }

  // 7. Full-text search
  console.log('🔎 Searching for "pre-training"...');
  const searchResults = graph.searchContent('pre-training', 3);
  searchResults.forEach(doc => {
    console.log(`  - ${doc.id}`);
    console.log(`    "${doc.content.substring(0, 60)}..."`);
  });
  console.log('');

  // 8. Statistics
  console.log('📈 Knowledge graph statistics:');
  const stats = graph.getStats();
  console.log(`  - Total papers & concepts: ${stats.nodeCount}`);
  console.log(`  - Total relationships: ${stats.edgeCount}`);
  console.log(`  - Average connections: ${stats.avgDegree.toFixed(2)}`);
  console.log('');

  // 9. Export for visualization
  console.log('💾 Exporting graph...');
  const exported = graph.exportGraph();
  console.log(`  - Exported ${exported.nodes.length} nodes and ${exported.edges.length} edges`);
  console.log('  - Can be imported to visualization tools like Gephi or D3.js');
  
  graph.close();
  console.log('\n✨ Research graph analysis complete!');
}

main().catch(console.error);
