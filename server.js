#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import fs from 'fs/promises';

class SimpleMemoryServer {
  constructor() {
    this.memoryFile = process.env.MEMORY_FILE_PATH || './memory.json';
    this.memory = { entities: {}, relations: [], observations: {} };
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

  async handleRequest(request) {
    try {
      const { method, params } = request;
      
      switch (method) {
        case 'tools/list':
          return {
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
                          observations: { type: 'array', items: { type: 'string' } }
                        },
                        required: ['name', 'entityType', 'observations']
                      }
                    }
                  },
                  required: ['entities']
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
                inputSchema: { type: 'object', properties: {} }
              }
            ]
          };
          
        case 'tools/call':
          return await this.handleToolCall(params);
          
        case 'initialize':
          return {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'claude-cloud-memory', version: '1.0.0' }
          };
          
        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (error) {
      return { error: { message: error.message } };
    }
  }

  async handleToolCall(params) {
    const { name, arguments: args } = params;
    
    switch (name) {
      case 'create_entities':
        return await this.createEntities(args.entities);
      case 'search_nodes':
        return await this.searchNodes(args.query);
      case 'read_graph':
        return await this.readGraph();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
    return { 
      content: [{ 
        type: 'text', 
        text: `Created ${entities.length} entities successfully` 
      }] 
    };
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
    
    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} matching nodes:\n\n${JSON.stringify(results, null, 2)}`
      }]
    };
  }

  async readGraph() {
    const stats = {
      entities: Object.keys(this.memory.entities).length,
      relations: this.memory.relations.length,
      totalObservations: Object.values(this.memory.entities).reduce(
        (sum, entity) => sum + entity.observations.length, 0
      )
    };
    
    return {
      content: [{
        type: 'text',
        text: `Knowledge Graph Contents:\n\nStatistics:\n${JSON.stringify(stats, null, 2)}\n\nFull Graph:\n${JSON.stringify(this.memory, null, 2)}`
      }]
    };
  }
}

async function main() {
  const memoryServer = new SimpleMemoryServer();
  const port = process.env.PORT || 3000;
  
  const wss = new WebSocketServer({ port });
  
  wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    
    ws.on('message', async (data) => {
      try {
        const request = JSON.parse(data.toString());
        console.log('Received request:', request.method);
        
        const response = await memoryServer.handleRequest(request);
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: response
        }));
      } catch (error) {
        console.error('Error handling request:', error);
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id || null,
          error: { code: -32603, message: error.message }
        }));
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
  
  console.log(`🚀 Cloud Memory Server running on port ${port}`);
  console.log(`📡 WebSocket URL: wss://memory-server-production.up.railway.app`);
  console.log(`🧠 Memory will be persisted to: ${process.env.MEMORY_FILE_PATH || './memory.json'}`);
}

main().catch(console.error);