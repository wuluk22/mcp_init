# Create a directory for the bridge
mkdir ~/mcp-bridge
cd ~/mcp-bridge

# Save the bridge code as mcp-http-bridge.js
nano mcp-http-bridge.js
# Paste the code above, save and exit

# Initialize npm project
npm init -y

# Add "type": "module" to package.json
echo '{"type":"module","dependencies":{"express":"^4.18.2","cors":"^2.8.5"}}' > package.json

# Install dependencies
npm install

# Run the bridge
node mcp-http-bridge.js
```

You should see:
```
🌉 MCP stdio-to-HTTP Bridge
   Listening on: http://0.0.0.0:3000
   Bridging to: pentest-mcp (stdio)
