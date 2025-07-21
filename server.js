#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketTransport } from '@modelcontextprotocol/sdk/server/websocket.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import fs from 'fs/promises';

class CloudMemoryServer {
  constructor() {
    this.memoryFile = process.env.MEMORY_FILE_PATH || './memory.json';
    this.memory = { entities: {}, relations: [], observations: {} };
    this.server = new Server(
      {
        name: 'claude-cloud-memory',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );
    
    this.setupHandlers();
    this.loadMemory();
  }

  async loadMemory() {
    try {
      const data = await fs.readFile(this.memoryFile, 'utf8');
      this.memory = JSON.parse(data);
      console.log('Memory loaded successfully');
    } catch (error) {
      console.log('No existing memory file, starting fresh');
      await this.saveMemory();
    }
  }

  async saveMemory() {
    try {
      await fs.writeFile(this.memoryFile, JSON.stringify(this.memory, null, 2));
      console.log('Memory saved successfully');
    } catch (error) {
      console.error('Failed to save memory:', error);
    }
  }

  setupHandlers() {
    // Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_entities',
          description: 'Create entities in the knowledge graph memory',
          inputSchema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    entityType: { type: 'string' },
                    observations: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  },
                  required: ['name', 'entityType', 'observations']
                }
              }
            },
            required: ['entities']
          }
        },
        {
          name: 'create_relations',
          description: 'Create relations between entities',
          inputSchema: {
            type: 'object',
            properties: {
              relations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    relationType: { type: 'string' }
                  },
                  required: ['from', 'to', 'relationType']
                }
              }
            },
            required: ['relations']
          }
        },
        {
          name: 'add_observations',
          description: 'Add observations to existing entities',
          inputSchema: {
            type: 'object',
            properties: {
              observations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entityName: { type: 'string' },
                    contents: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  },
                  required: ['entityName', 'contents']
                }
              }
            },
            required: ['observations']
          }
        },
        {
          name: 'search_nodes',
          description: 'Search for nodes in the knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' }
            },
            required: ['query']
          }
        },
        {
          name: 'read_graph',
          description: 'Read the entire knowledge graph',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        let result;
        switch (name) {
          case 'create_entities':
            result = await this.createEntities(args.entities);
            break;
          case 'create_relations':
            result = await this.createRelations(args.relations);
            break;
          case 'add_observations':
            result = await this.addObservations(args.observations);
            break;
          case 'search_nodes':
            result = await this.searchNodes(args.query);
            break;
          case 'read_graph':
            result = await this.readGraph();
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        
        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { 
          content: [{ 
            type: 'text', 
            text: `Error executing ${name}: ${error.message}` 
          }] 
        };
      }
    });

    // Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'memory://graph',
          name: 'Knowledge Graph',
          description: 'Complete knowledge graph memory',
          mimeType: 'application/json'
        }
      ]
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      if (uri === 'memory://graph') {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.memory, null, 2)
          }]
        };
      }
      
      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  async createEntities(entities) {
    for (const entity of entities) {
      const { name, entityType, observations } = entity;
      
      this.memory.entities[name] = {
        name,
        entityType,
        observations: observations || [],
        createdAt: new Date().toISOString()
      };
    }
    
    await this.saveMemory();
    return `Created ${entities.length} entities successfully`;
  }

  async createRelations(relations) {
    for (const relation of relations) {
      this.memory.relations.push({
        ...relation,
        createdAt: new Date().toISOString()
      });
    }
    
    await this.saveMemory();
    return `Created ${relations.length} relations successfully`;
  }

  async addObservations(observations) {
    for (const obs of observations) {
      const { entityName, contents } = obs;
      
      if (this.memory.entities[entityName]) {
        this.memory.entities[entityName].observations.push(...contents);
      }
    }
    
    await this.saveMemory();
    return `Added observations to ${observations.length} entities successfully`;
  }

  async searchNodes(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    // Search entities
    for (const [name, entity] of Object.entries(this.memory.entities)) {
      if (name.toLowerCase().includes(lowerQuery) ||
          entity.entityType.toLowerCase().includes(lowerQuery) ||
          entity.observations.some(obs => obs.toLowerCase().includes(lowerQuery))) {
        results.push({ type: 'entity', ...entity });
      }
    }
    
    // Search relations
    for (const relation of this.memory.relations) {
      if (relation.from.toLowerCase().includes(lowerQuery) ||
          relation.to.toLowerCase().includes(lowerQuery) ||
          relation.relationType.toLowerCase().includes(lowerQuery)) {
        results.push({ type: 'relation', ...relation });
      }
    }
    
    return `Found ${results.length} matching nodes:\n\n${JSON.stringify(results, null, 2)}`;
  }

  async readGraph() {
    const stats = {
      entities: Object.keys(this.memory.entities).length,
      relations: this.memory.relations.length,
      totalObservations: Object.values(this.memory.entities).reduce(
        (sum, entity) => sum + entity.observations.length, 0
      )
    };
    
    return `Knowledge Graph Contents:\n\nStatistics:\n${JSON.stringify(stats, null, 2)}\n\nFull Graph:\n${JSON.stringify(this.memory, null, 2)}`;
  }
}

// Determine if we're running via stdio or WebSocket
const isWebSocket = process.env.PORT || process.argv.includes('--websocket');

async function main() {
  const memoryServer = new CloudMemoryServer();
  
  if (isWebSocket) {
    // WebSocket server for cloud deployment
    const port = process.env.PORT || 3000;
    const wss = new WebSocketServer({ port });
    
    wss.on('connection', (ws) => {
      console.log('New WebSocket MCP connection');
      const transport = new WebSocketTransport(ws);
      memoryServer.server.connect(transport);
    });
    
    console.log(`Cloud Memory MCP Server running on WebSocket port ${port}`);
    console.log(`Connect using: wss://memory-server-production.up.railway.app`);
  } else {
    // Stdio for local usage
    const transport = new StdioServerTransport();
    await memoryServer.server.connect(transport);
  }
}

main().catch(console.error);