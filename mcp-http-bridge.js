import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Store active sessions
const sessions = new Map();

// Generate session ID
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Create a new MCP stdio session
function createMCPSession() {
  const mcpProcess = spawn('pentest-mcp', [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const session = {
    process: mcpProcess,
    requestId: 0,
    pendingRequests: new Map()
  };

  let buffer = '';

  // Handle stdout - parse JSON-RPC responses
  mcpProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    
    // Split by newlines to handle multiple responses
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        const requestId = response.id;
        
        if (session.pendingRequests.has(requestId)) {
          const { resolve } = session.pendingRequests.get(requestId);
          session.pendingRequests.delete(requestId);
          resolve(response);
        }
      } catch (e) {
        console.error('Failed to parse MCP response:', line, e);
      }
    }
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error('MCP stderr:', data.toString());
  });

  mcpProcess.on('close', (code) => {
    console.log(`MCP process exited with code ${code}`);
  });

  return session;
}

// Send request to MCP and wait for response
async function sendMCPRequest(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++session.requestId;
    
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: method,
      params: params
    };

    // Store the resolve function
    session.pendingRequests.set(requestId, { resolve, reject });

    // Send to MCP process
    session.process.stdin.write(JSON.stringify(request) + '\n');

    // Timeout after 10 minutes
    setTimeout(() => {
      if (session.pendingRequests.has(requestId)) {
        session.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 600000);
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'MCP HTTP Bridge running' });
});

// Initialize a new session
app.post('/session/init', async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const session = createMCPSession();
    sessions.set(sessionId, session);

    // Initialize MCP
    const initResponse = await sendMCPRequest(session, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'mcp-http-bridge',
        version: '1.0.0'
      }
    });

    res.json({
      sessionId: sessionId,
      initResponse: initResponse
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List tools
app.post('/session/:sessionId/tools/list', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const response = await sendMCPRequest(session, 'tools/list');
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

    const response = await sendMCPRequest(session, 'tools/call', {
      name: name,
      arguments: args
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Close session
app.post('/session/:sessionId/close', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.process.kill();
    sessions.delete(sessionId);

    res.json({ message: 'Session closed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🌉 MCP stdio-to-HTTP Bridge');
  console.log(`   Listening on: http://0.0.0.0:${PORT}`);
  console.log(`   Bridging to: pentest-mcp (stdio)`);
  console.log('');
  console.log('Available endpoints:');
  console.log('   POST /session/init - Create new session');
  console.log('   POST /session/:id/tools/list - List tools');
  console.log('   POST /session/:id/tools/call - Call a tool');
  console.log('   POST /session/:id/close - Close session');
});
