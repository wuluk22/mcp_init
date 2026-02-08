import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Store active MCP server process
let mcpProcess = null;

// Initialize MCP server as child process
function initMCPServer() {
  mcpProcess = spawn('node', ['build/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  return mcpProcess;
}

// Send request to MCP server and get response
async function sendMCPRequest(request) {
  return new Promise((resolve, reject) => {
    const process = initMCPServer();
    let response = '';
    
    process.stdout.on('data', (data) => {
      response += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      console.error('MCP Error:', data.toString());
    });
    
    process.on('close', (code) => {
      try {
        const jsonResponse = JSON.parse(response);
        resolve(jsonResponse);
      } catch (e) {
        reject(new Error('Invalid JSON response from MCP server'));
      }
    });
    
    // Send request
    process.stdin.write(JSON.stringify(request) + '\n');
    process.stdin.end();
  });
}

// List available tools
app.post('/tools/list', async (req, res) => {
  try {
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    };
    
    const response = await sendMCPRequest(request);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call a tool
app.post('/tools/call', async (req, res) => {
  try {
    const { name, arguments: args } = req.body;
    
    const request = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: name,
        arguments: args
      }
    };
    
    const response = await sendMCPRequest(request);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MCP HTTP Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Tools list: POST http://0.0.0.0:${PORT}/tools/list`);
  console.log(`   Call tool:  POST http://0.0.0.0:${PORT}/tools/call`);
});
