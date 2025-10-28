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
          
          case 'graph_list_documents':
            return this.handleListDocuments(args);
          
          case 'graph_delete_document':
            return this.handleDeleteDocument(args);
          
          case 'graph_add_relationship':
            return this.handleAddRelationship(args);
          
          case 'graph_get_neighbors':
            return this.handleGetNeighbors(args);
          
          case 'graph_find_path':
            return this.handleFindPath(args);
          
          case 'graph_find_similar':
            return await this.handleFindSimilar(args);
          
          case 'graph_search_content':
            return this.handleSearchContent(args);
          
          case 'graph_get_stats':
            return this.handleGetStats();
          
          case 'graph_check_integrity':
            return this.handleCheckIntegrity();
          
          case 'graph_rebuild_search_index':
            return this.handleRebuildSearchIndex();
          
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
    const node = this.api.getDocument(args.id);
    
    if (!node) {
      throw new Error(`Document not found: ${args.id}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(node, null, 2),
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
    const neighbors = this.api.getNeighbors(args.id, args.direction);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            node: args.id,
            direction: args.direction || 'both',
            count: neighbors.length,
            neighbors,
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

  private handleSearchContent(args: any) {
    const results = this.api.searchContent(args.query, args.limit);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            count: results.length,
            results,
          }, null, 2),
        },
      ],
    };
  }

  private handleGetStats() {
    const stats = this.api.getStats();
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Temporal Graph MCP Server running on stdio');
  }

  close(): void {
    this.api.close();
  }
}
