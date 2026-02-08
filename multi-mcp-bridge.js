import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ============================================================================
// MCP SERVER REGISTRY - ADD YOUR SERVERS HERE
// ============================================================================

const MCP_SERVERS = {
  'pentest': {
    command: 'pentest-mcp',
    args: [],
    description: 'Professional penetration testing toolkit'
  },
  
  // Example: Add more servers like this:
  // 'filesystem': {
  //   command: 'npx',
  //   args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allow'],
  //   description: 'Filesystem operations'
  // },
  
  // 'brave-search': {
  //   command: 'npx',
  //   args: ['-y', '@modelcontextprotocol/server-brave-search'],
  //   description: 'Web search via Brave'
  // }
};

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const sessions = new Map();

function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

class MCPSession {
  constructor(serverName, serverConfig) {
    this.serverName = serverName;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.isInitialized = false;
    
    this.startProcess(serverConfig);
  }
  
  startProcess(config) {
    console.log(`Starting MCP server: ${this.serverName}`);
    console.log(`  Command: ${config.command} ${config.args.join(' ')}`);
    
    this.process = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Handle stdout responses
    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
    
    // Handle stderr (logs)
    this.process.stderr.on('data', (data) => {
      console.error(`[${this.serverName}] ${data.toString()}`);
    });
    
    // Handle process exit
    this.process.on('close', (code) => {
      console.log(`[${this.serverName}] Process exited with code ${code}`);
    });
  }
  
  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        const requestId = response.id;
        
        if (this.pendingRequests.has(requestId)) {
          const { resolve } = this.pendingRequests.get(requestId);
          this.pendingRequests.delete(requestId);
          resolve(response);
        }
      } catch (e) {
        console.error(`[${this.serverName}] Failed to parse:`, line);
      }
    }
  }
  
  async sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      
      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method: method,
        params: params
      };
      
      this.pendingRequests.set(requestId, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');
      
      // 10 minute timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 600000);
    });
  }
  
  async initialize() {
    if (this.isInitialized) return;
    
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'multi-mcp-bridge',
        version: '1.0.0'
      }
    });
    
    this.isInitialized = true;
  }
  
  destroy() {
    if (this.process) {
      this.process.kill();
    }
  }
}

// ============================================================================
// HTTP API ENDPOINTS
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    availableServers: Object.keys(MCP_SERVERS),
    activeSessions: sessions.size
  });
});

// List available MCP servers
app.get('/servers', (req, res) => {
  const serverList = Object.entries(MCP_SERVERS).map(([name, config]) => ({
    name: name,
    description: config.description,
    command: config.command
  }));
  
  res.json({ servers: serverList });
});

// Create a new session for a specific server
app.post('/session/create', async (req, res) => {
  try {
    const { server } = req.body;
    
    if (!server) {
      return res.status(400).json({ error: 'Server name required' });
    }
    
    if (!MCP_SERVERS[server]) {
      return res.status(404).json({ 
        error: 'Server not found',
        availableServers: Object.keys(MCP_SERVERS)
      });
    }
    
    const sessionId = generateSessionId();
    const session = new MCPSession(server, MCP_SERVERS[server]);
    
    // Initialize the session
    await session.initialize();
    
    sessions.set(sessionId, session);
    
    res.json({
      sessionId: sessionId,
      server: server,
      message: 'Session created and initialized'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List tools for a session
app.post('/session/:sessionId/tools/list', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const response = await session.sendRequest('tools/list');
    res.json(response);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call a tool
app.post('/session/:sessionId/tools/call', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { name, arguments: args } = req.body;
    const session = sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const response = await session.sendRequest('tools/call', {
      name: name,
      arguments: args || {}
    });
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Close a session
app.post('/session/:sessionId/close', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    session.destroy();
    sessions.delete(sessionId);
    
    res.json({ message: 'Session closed' });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session info
app.get('/session/:sessionId/info', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId: sessionId,
    server: session.serverName,
    isInitialized: session.isInitialized
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Multi-MCP Server Bridge                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Server: http://0.0.0.0:${PORT}`);
  console.log('');
  console.log('📋 Available MCP Servers:');
  Object.entries(MCP_SERVERS).forEach(([name, config]) => {
    console.log(`   • ${name}: ${config.description}`);
  });
  console.log('');
  console.log('🔌 Endpoints:');
  console.log('   GET  /health                      - Health check');
  console.log('   GET  /servers                     - List available servers');
  console.log('   POST /session/create              - Create session (body: {server: "name"})');
  console.log('   POST /session/:id/tools/list      - List tools');
  console.log('   POST /session/:id/tools/call      - Call tool');
  console.log('   POST /session/:id/close           - Close session');
  console.log('   GET  /session/:id/info            - Session info');
  console.log('');
});
