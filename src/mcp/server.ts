import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GraphAPI } from '../api/graph-api.js';
import { tools } from './tools.js';

export class TemporalGraphServer {
  private server: Server;
  private api: GraphAPI;

  constructor(dbPath?: string) {
    this.api = new GraphAPI(dbPath);
    this.server = new Server(
      {
        name: 'temporal-graph',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'graph_add_document':
            return await this.handleAddDocument(args);
          
          case 'graph_get_document':
            return this.handleGetDocument(args);
          
          case 'graph_search':  // ← NEW (replaces graph_search_content)
            return this.handleSearch(args);
          
          case 'graph_list_documents':
            return this.handleListDocuments(args);
          
          case 'graph_delete_document':
            return this.handleDeleteDocument(args);
          
          case 'graph_tags':  // ← NEW
            return this.handleTags(args);
          
          case 'graph_add_relationship':
            return this.handleAddRelationship(args);
          
          case 'graph_get_neighbors':
            return this.handleGetNeighbors(args);
          
          case 'graph_find_path':
            return this.handleFindPath(args);
          
          case 'graph_find_similar':
            return await this.handleFindSimilar(args);
          
          case 'graph_update_document':  // ← NEW
            return await this.handleUpdateDocument(args);
            
          case 'graph_get_document_timeline':  // ← NEW
            return this.handleGetDocumentTimeline(args);
            
          case 'graph_compare_versions':  // ← NEW
            return this.handleCompareVersions(args);
            
          case 'graph_get_created_between':  // ← NEW
            return this.handleGetCreatedBetween(args);
            
          case 'graph_get_modified_between':  // ← NEW
            return this.handleGetModifiedBetween(args);
            
          case 'graph_get_deleted_between':  // ← NEW
            return this.handleGetDeletedBetween(args);
            
          case 'graph_map':  // ← NEW
            return this.handleMapGraph(args);
            
          case 'graph_stats':  // ← UPDATED
            return this.handleStats();
            
          case 'graph_explore':  // ← NEW
            return this.handleGraphExplore(args);
            
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Tool ${name} error:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error in ${name}: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleAddDocument(args: any) {
    const node = await this.api.addDocument(
      args.id,
      args.content,
      args.metadata
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            document: node,
            message: `Document "${args.id}" added successfully`,
          }, null, 2),
        },
      ],
    };
  }

  private handleGetDocument(args: any) {
    const { id, at_time } = args;
    const node = at_time
      ? this.api.getDocumentAtTime(id, at_time)
      : this.api.getDocument(id);
    
    if (!node) {
      throw new Error(`Document not found: ${id}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: 1,
            documents: [node],
            ...(at_time && { _queried_at: at_time })
          }, null, 2),
        },
      ],
    };
  }

  private handleListDocuments(args: any) {
    const nodes = this.api.listDocuments(args.limit);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            count: nodes.length,
            documents: nodes,
          }, null, 2),
        },
      ],
    };
  }

  private handleDeleteDocument(args: any) {
    const success = this.api.deleteDocument(args.id);
    
    if (!success) {
      throw new Error(`Document not found: ${args.id}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Document "${args.id}" deleted successfully`,
          }, null, 2),
        },
      ],
    };
  }

  private handleAddRelationship(args: any) {
    try {
      // Предварительная проверка существования документов
      const fromDoc = this.api.getDocument(args.from);
      const toDoc = this.api.getDocument(args.to);
      
      if (!fromDoc) {
        throw new Error(`Source document not found: ${args.from}`);
      }
      
      if (!toDoc) {
        throw new Error(`Target document not found: ${args.to}`);
      }
      
      const edge = this.api.addRelationship(
        args.from,
        args.to,
        args.relation,
        args.metadata
      );
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              relationship: edge,
              message: `✅ Relationship created: ${args.from} → ${args.to}`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error creating relationship: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private handleGetNeighbors(args: any) {
    const { id, depth = 1, direction = 'both', at_time } = args;
    
    const node = at_time
      ? this.api.getDocumentAtTime(id, at_time)
      : this.api.getDocument(id);
    
    if (!node) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Document not found: ${id}`
            }, null, 2)
          }
        ],
        isError: true
      };
    }
    
    const neighbors = this.api.getNeighbors(id, direction, {
      depth,
      at_time
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            node: {
              ...node,
              ...(at_time && { _queried_at: at_time })
            },
            neighbors: neighbors.map((n: any) => ({
              id: n.id,
              relation: n.relation,
              direction: n.direction,
              depth: n.depth
            })),
            total_neighbors: neighbors.length
          }, null, 2),
        },
      ],
    };
  }

  private handleFindPath(args: any) {
    const result = this.api.findPath(args.from, args.to, args.maxDepth);
    
    if (!result) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              found: false,
              message: `No path found between "${args.from}" and "${args.to}"`,
            }, null, 2),
          },
        ],
      };
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            found: true,
            from: args.from,
            to: args.to,
            ...result,
          }, null, 2),
        },
      ],
    };
  }

  private async handleFindSimilar(args: any) {
    try {
      const similar = await this.api.findSimilar(args.id, args.limit);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query: args.id,
              count: similar.length,
              results: similar,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Vector search error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleSearch(args: any) {
    const { query, filters, limit, sort_by, sort_order, at_time } = args;
    
    const results = this.api.searchDocuments(
      { query, filters, limit, sort_by, sort_order },
      { at_time }
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            query,
            filters,
            count: results.length,
            results: results.map(r => ({
              ...r,
              ...(at_time && { _queried_at: at_time })
            }))
          }, null, 2)
        }
      ]
    };
  }

  private handleTags(args: any) {
    const result = this.api.manageTags({
      action: args.action,
      document_id: args.document_id,
      document_filter: args.document_filter,
      tags: args.tags,
      rename: args.rename
    });
    
    // Format response based on action
    let message = '';
    switch (args.action) {
      case 'add':
        message = `✅ Added ${args.tags?.length || 0} tag(s) to ${result.updated} document(s)`;
        break;
      case 'remove':
        message = `✅ Removed ${args.tags?.length || 0} tag(s) from ${result.updated} document(s)`;
        break;
      case 'rename':
        message = `✅ Renamed tag "${args.rename.from}" → "${args.rename.to}" in ${result.updated} document(s)`;
        break;
      case 'list':
        message = `📊 Found ${result.length} unique tags`;
        break;
      case 'get':
        message = `📋 Document has ${result.length} tag(s)`;
        break;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message,
            result
          }, null, 2)
        }
      ]
    };
  }

  private handleStats() {
    const graphStats = this.api.getStats();
    const metadataStats = this.api.getMetadataStats();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            graph: graphStats,
            metadata: {
              tags: Object.keys(metadataStats.tags).length,
              keywords: Object.keys(metadataStats.keywords).length,
              emojis: Object.keys(metadataStats.emojis).length,
              types: Object.keys(metadataStats.types).length,
              paths: metadataStats.paths.length,
              top_tags: Object.entries(metadataStats.tags)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([tag, count]) => ({ tag, count })),
              top_emojis: Object.entries(metadataStats.emojis)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([emoji, count]) => ({ emoji, count }))
            }
          }, null, 2)
        }
      ]
    };
  }

  private handleCheckIntegrity() {
    const integrity = this.api.checkIntegrity();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...integrity,
            summary: {
              totalIssues: integrity.orphanedNodes.length + integrity.inconsistentEdges.length,
              hasIssues: integrity.orphanedNodes.length > 0 || integrity.inconsistentEdges.length > 0
            }
          }, null, 2),
        },
      ],
    };
  }

  private handleRebuildSearchIndex() {
    try {
      this.api.rebuildSearchIndex();
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '✅ Full-text search index rebuilt successfully',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error rebuilding search index: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private async handleUpdateDocument(args: any) {
    try {
      const node = await this.api.updateDocument(
        args.id,
        {
          content: args.content,
          metadata: args.metadata,
          merge_metadata: args.merge_metadata,
          valid_from: args.valid_from
        }
      );
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              document: node,
              message: `Document "${args.id}" updated successfully (v${node.version})`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error updating document: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleGetDocumentTimeline(args: any) {
    try {
      const timeline = this.api.getDocumentTimeline(args.id);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              document: args.id,
              count: timeline.length,
              timeline,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error getting timeline: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleCompareVersions(args: any) {
    try {
      const comparison = this.api.compareDocumentVersions(args.id, args.version1, args.version2);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              document: args.id,
              version1: args.version1,
              version2: args.version2,
              comparison,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error comparing versions: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleGetCreatedBetween(args: any) {
    try {
      const documents = this.api.getDocumentsCreatedBetween(args.start, args.end);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              range: `${args.start} to ${args.end}`,
              count: documents.length,
              documents,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error getting created documents: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleGetModifiedBetween(args: any) {
    try {
      const documents = this.api.getDocumentsModifiedBetween(args.start, args.end);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              range: `${args.start} to ${args.end}`,
              count: documents.length,
              documents,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error getting modified documents: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleGetDeletedBetween(args: any) {
    try {
      const documents = this.api.getDocumentsDeletedBetween(args.start, args.end);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              range: `${args.start} to ${args.end}`,
              count: documents.length,
              documents,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error getting deleted documents: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleMapGraph(args: any) {
    try {
      const map = this.api.mapGraph({
        scope: args.scope,
        filters: args.filters,
        focus_nodes: args.focus_nodes,
        radius: args.radius,
        at_time: args.at_time,
        max_nodes: args.max_nodes,
        max_edges: args.max_edges,
        include_metadata: args.include_metadata,
        include_content_preview: args.include_content_preview,
        include_stats: args.include_stats,
        format: args.format
      });
      
      return {
        content: [
          {
            type: 'text',
            text: typeof map === 'string' ? map : JSON.stringify(map, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error mapping graph: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  private handleGraphExplore(args: any) {
    const params = {
      start: args.start,
      strategy: args.strategy || 'breadth',
      max_depth: args.max_depth || 3,
      max_nodes: args.max_nodes || 50,
      follow_relations: args.follow_relations,
      filters: args.filters,
      at_time: args.at_time
    };
    
    try {
      const result = this.api.exploreGraph(params);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            root: result.root,
            strategy: result.strategy,
            nodes: result.nodes.map((n: any) => ({
              id: n.id,
              depth: n.depth,
              type: n.metadata?.type,
              tags: n.metadata?.tags,
              version: n.version
            })),
            edges: result.edges,
            stats: result.stats
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }
  
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Temporal Graph MCP Server running on stdio');
  }

  close(): void {
    this.api.close();
  }
}
