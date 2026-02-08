import requests
import json

class MCPBridge:
    """
    Simple client for the Multi-MCP Bridge.
    
    Usage:
        bridge = MCPBridge("http://192.168.1.100:3000")
        
        # List available servers
        servers = bridge.list_servers()
        
        # Create session for a specific server
        session_id = bridge.create_session("pentest")
        
        # List tools
        tools = bridge.list_tools(session_id)
        
        # Call a tool
        result = bridge.call_tool(session_id, "nmap_scan", {"target": "192.168.1.1"})
        
        # Close session
        bridge.close_session(session_id)
    """
    
    def __init__(self, bridge_url):
        self.bridge_url = bridge_url.rstrip('/')
    
    def health(self):
        """Check bridge health and get status"""
        response = requests.get(f"{self.bridge_url}/health")
        return response.json()
    
    def list_servers(self):
        """List all available MCP servers"""
        response = requests.get(f"{self.bridge_url}/servers")
        return response.json()['servers']
    
    def create_session(self, server_name):
        """Create a new session for a specific MCP server"""
        response = requests.post(
            f"{self.bridge_url}/session/create",
            json={'server': server_name}
        )
        data = response.json()
        return data['sessionId']
    
    def list_tools(self, session_id):
        """List tools available in a session"""
        response = requests.post(
            f"{self.bridge_url}/session/{session_id}/tools/list"
        )
        data = response.json()
        return data.get('result', {}).get('tools', [])
    
    def call_tool(self, session_id, tool_name, arguments, timeout=600):
        """Call a tool in a session"""
        response = requests.post(
            f"{self.bridge_url}/session/{session_id}/tools/call",
            json={'name': tool_name, 'arguments': arguments},
            timeout=timeout
        )
        return response.json()
    
    def get_session_info(self, session_id):
        """Get information about a session"""
        response = requests.get(f"{self.bridge_url}/session/{session_id}/info")
        return response.json()
    
    def close_session(self, session_id):
        """Close a session"""
        response = requests.post(f"{self.bridge_url}/session/{session_id}/close")
        return response.json()


def format_tools_for_qwen(mcp_tools):
    """Convert MCP tool format to Qwen/Ollama format"""
    return [
        {
            "type": "function",
            "function": {
                "name": tool['name'],
                "description": tool.get('description', ''),
                "parameters": tool.get('inputSchema', {})
            }
        }
        for tool in mcp_tools
    ]


def chat_with_qwen(messages, tools, model="qwen2.5:7b"):
    """Send request to local Qwen via Ollama"""
    payload = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "stream": False
    }
    
    response = requests.post("http://localhost:11434/api/chat", json=payload, timeout=60)
    return response.json()


def main():
    # Configuration
    KALI_IP = "192.168.1.100"  # CHANGE THIS
    BRIDGE_URL = f"http://{KALI_IP}:3000"
    
    print("🔧 Multi-MCP Pentest Assistant")
    print("="*60)
    
    # Initialize bridge client
    bridge = MCPBridge(BRIDGE_URL)
    
    # Check connection
    try:
        health = bridge.health()
        print(f"✅ Connected to bridge")
        print(f"   Active sessions: {health['activeSessions']}")
    except:
        print(f"❌ Cannot connect to bridge at {BRIDGE_URL}")
        print("   Make sure it's running: node multi-mcp-bridge.js")
        return
    
    # List available servers
    servers = bridge.list_servers()
    print(f"\n📋 Available MCP servers ({len(servers)}):")
    for i, server in enumerate(servers, 1):
        print(f"   {i}. {server['name']}: {server['description']}")
    
    # Select server (for now, hardcode to 'pentest')
    server_name = 'pentest'
    print(f"\n🔌 Using server: {server_name}")
    
    # Create session
    try:
        session_id = bridge.create_session(server_name)
        print(f"✅ Session created: {session_id[:20]}...")
    except Exception as e:
        print(f"❌ Failed to create session: {e}")
        return
    
    try:
        # List tools
        mcp_tools = bridge.list_tools(session_id)
        print(f"✅ Available tools ({len(mcp_tools)}):")
        for tool in mcp_tools:
            desc = tool.get('description', 'No description')[:50]
            print(f"   • {tool['name']}: {desc}...")
        
        # Check Ollama
        try:
            requests.get("http://localhost:11434", timeout=2)
            print("✅ Ollama is running")
        except:
            print("❌ Ollama not running")
            return
        
        # Prepare for chat
        qwen_tools = format_tools_for_qwen(mcp_tools)
        messages = []
        
        print("\n" + "="*60)
        print("🤖 Ready! Type 'exit' to quit, 'tools' to list tools")
        print("="*60)
        print()
        
        # Main loop
        while True:
            user_input = input("You: ").strip()
            
            if user_input.lower() in ['exit', 'quit', 'q']:
                break
            
            if user_input.lower() == 'tools':
                for tool in mcp_tools:
                    print(f"  • {tool['name']}")
                continue
            
            if not user_input:
                continue
            
            messages.append({"role": "user", "content": user_input})
            
            # Agentic loop
            for iteration in range(10):
                response = chat_with_qwen(messages, qwen_tools)
                assistant_msg = response.get('message', {})
                messages.append(assistant_msg)
                
                # Handle tool calls
                if 'tool_calls' in assistant_msg and assistant_msg['tool_calls']:
                    print(f"\n🔨 Executing {len(assistant_msg['tool_calls'])} tool(s)...\n")
                    
                    for tool_call in assistant_msg['tool_calls']:
                        func = tool_call['function']
                        tool_name = func['name']
                        
                        # Parse arguments
                        if isinstance(func['arguments'], str):
                            tool_args = json.loads(func['arguments'])
                        else:
                            tool_args = func['arguments']
                        
                        print(f"  → {tool_name}")
                        print(f"    {json.dumps(tool_args, indent=4)}")
                        
                        # Call tool via bridge
                        result = bridge.call_tool(session_id, tool_name, tool_args)
                        
                        # Extract content from result
                        if 'result' in result:
                            content = result['result'].get('content', [])
                            result_text = '\n'.join([
                                item.get('text', str(item)) 
                                for item in content
                            ])
                        else:
                            result_text = json.dumps(result)
                        
                        print(f"    ✓ Done\n")
                        
                        messages.append({
                            "role": "tool",
                            "content": result_text
                        })
                    
                    continue
                
                # Show final response
                if 'content' in assistant_msg and assistant_msg['content']:
                    print(f"\n🤖 {assistant_msg['content']}\n")
                break
    
    finally:
        # Cleanup
        bridge.close_session(session_id)
        print("\n👋 Session closed")


if __name__ == "__main__":
    main()
