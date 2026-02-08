cd ~/mcp-bridge

# Update package.json
cat > package.json << 'EOF'
{
  "type": "module",
  "name": "multi-mcp-bridge",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  }
}
EOF

# Install dependencies
npm install

# Run the bridge
node multi-mcp-bridge.js
