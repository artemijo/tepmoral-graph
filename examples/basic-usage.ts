import { GraphAPI } from '../src/api/graph-api.js';

async function main() {
  const graph = new GraphAPI('example.db');

  console.log('🚀 Temporal Graph Example\n');

  // 1. Add documents
  console.log('📄 Adding documents...');
  await graph.addDocument('contract_001', 'Purchase agreement for equipment worth 1M RUB', {
    type: 'contract',
    date: '2024-01-15',
  });

  await graph.addDocument('amendment_001', 'Amendment to contract regarding delivery terms', {
    type: 'amendment',
    date: '2024-02-10',
  });

  await graph.addDocument('claim_001', 'Claim regarding defects in delivered equipment', {
    type: 'claim',
    date: '2024-03-05',
  });

  await graph.addDocument('settlement_001', 'Settlement agreement for dispute resolution', {
    type: 'settlement',
    date: '2024-04-01',
  });

  console.log('✅ Documents added\n');

  // 2. Add relationships
  console.log('🔗 Creating relationships...');
  graph.addRelationship('contract_001', 'amendment_001', 'amends');
  graph.addRelationship('amendment_001', 'claim_001', 'leads_to');
  graph.addRelationship('claim_001', 'settlement_001', 'resolves_to');
  console.log('✅ Relationships created\n');

  // 3. Find path
  console.log('🔍 Finding path from contract to settlement...');
  const path = graph.findPath('contract_001', 'settlement_001');
  if (path) {
    console.log(`Path found (${path.length} steps):`, path.path.join(' → '));
  }
  console.log('');

  // 4. Get neighbors
  console.log('👥 Getting neighbors of amendment_001...');
  const neighbors = graph.getNeighbors('amendment_001', 'both');
  neighbors.forEach(n => {
    console.log(`  - ${n.id} (${n.direction}, relation: ${n.relation})`);
  });
  console.log('');

  // 5. Search content
  console.log('🔎 Searching for "defects"...');
  const searchResults = graph.searchContent('defects', 5);
  searchResults.forEach(doc => {
    console.log(`  - ${doc.id}: ${doc.content.substring(0, 50)}...`);
  });
  console.log('');

  // 6. Find similar documents (if vector search is available)
  try {
    console.log('🎯 Finding similar documents to contract_001...');
    const similar = await graph.findSimilar('contract_001', 3);
    similar.forEach(doc => {
      console.log(`  - ${doc.id} (similarity: ${doc.similarity.toFixed(3)})`);
      console.log(`    ${doc.content.substring(0, 50)}...`);
    });
    console.log('');
  } catch (error) {
    console.log('⚠️  Vector search not available (sqlite-vec extension not loaded)\n');
  }

  // 7. Statistics
  console.log('📊 Graph statistics:');
  const stats = graph.getStats();
  console.log(`  - Nodes: ${stats.nodeCount}`);
  console.log(`  - Edges: ${stats.edgeCount}`);
  console.log(`  - Avg Degree: ${stats.avgDegree}`);
  console.log('');

  // 8. List all documents
  console.log('📋 All documents:');
  const docs = graph.listDocuments(10);
  docs.forEach(doc => {
    console.log(`  - ${doc.id} (${doc.type}): ${doc.content.substring(0, 40)}...`);
  });

  graph.close();
  console.log('\n✨ Example completed!');
}

main().catch(console.error);
