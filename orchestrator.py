import requests
import json
import os
from datetime import datetime
from rich import print

CONFIG_FILE = "config.json"
LOG_DIR = "logs"

os.makedirs(LOG_DIR, exist_ok=True)


def load_config():
    with open(CONFIG_FILE, "r") as f:
        return json.load(f)


def log_event(data):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(LOG_DIR, f"log_{ts}.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def call_ollama(prompt, config, tools=None):
    payload = {
        "model": config["ollama"]["model"],
        "messages": [
            {"role": "system", "content": "You are a pentest assistant. Use tools when needed."},
            {"role": "user", "content": prompt}
        ],
        "stream": False
    }

    response = requests.post(config["ollama"]["url"], json=payload)
    return response.json()


def call_mcp_tool(server_url, tool_name, args):
    payload = {
        "tool": tool_name,
        "arguments": args
    }
    r = requests.post(server_url, json=payload, timeout=300)
    return r.json()


def main():
    config = load_config()

    print("[bold green]MCP CLI Orchestrator started[/bold green]")

    while True:
        user_input = input("\n> ")
        if user_input.lower() in ["exit", "quit"]:
            break

        # Step 1: ask LLM
        llm_response = call_ollama(user_input, config)

        message = llm_response.get("message", {})
        content = message.get("content", "")

        print(f"\n[cyan]LLM:[/cyan] {content}")

        log_data = {
            "input": user_input,
            "llm": llm_response
        }

        # Very simple tool call detection
        if "TOOL_CALL" in content:
            try:
                tool_data = json.loads(content.split("TOOL_CALL:")[1].strip())
                server = tool_data["server"]
                tool = tool_data["tool"]
                args = tool_data.get("args", {})

                server_url = config["servers"][server]["url"]

                print(f"[yellow]Running tool:[/yellow] {tool} on {server}")
                result = call_mcp_tool(server_url, tool, args)

                print("[magenta]Tool result:[/magenta]")
                print(result)

                log_data["tool_result"] = result

            except Exception as e:
                print(f"[red]Tool call failed:[/red] {e}")

        log_event(log_data)


if __name__ == "__main__":
    main()

