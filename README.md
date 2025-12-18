# Temporal AI Agent Reference Implementation

This project implements a long running ReAct (Reasoning and Acting) agent using Temporal entity workflows.

## Overview

The agent follows the ReAct pattern to break down complex queries into a series of thoughts, actions, and observations, allowing it to reason through problems step-by-step while leveraging external tools.

## Getting Started

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/bitovi/temporal-ai-agent
   cd temporal-ai-agent
   ```

2. **Install Dependencies**:

   This project uses `npm` for package management.

   ```bash
   npm install
   ```

3. **Start Temporal Server**:

   Ensure you have a Temporal server running locally or configure the connection to a remote server.

   The easiest way to do this is by installing the [Temporal CLI](https://docs.temporal.io/cli#install). Then run:

   ```bash
   npm run temporal
   ```

4. **Set Up Environment Variables**:

   Copy `.env.example` to `.env` and fill in your Temporal server details, OpenAI API key, Brave Search API key, and GitHub fine-grained personal access token.

   Check `mcp-servers.yaml` to ensure the MCP servers being used are to your liking. You may add or remove any arbitrary amount of them. If you remove Brave and Github, the API keys are no longer needed.

5. **Run the Worker**:

   This starts the Temporal worker that will execute the workflows.

   ```bash
   npm run worker
   ```

6. **Interact with the workflow using a simple GUI**:

   ```bash
   npm run server
   ```

   This serves a webpage that has several controls for the workflow and a `sse` endpoint to view the agent's thoughts. Using this GUI, you may begin new conversations with the agent, respond to its answers, and eventually end it.

   The webpage is available at http://localhost:3000/ by default.

   If you wish to manually start an entity workflow instead of using the server and webpage, this will start the client that will initiate a sample workflow.

   ```bash
   npm run client-agent-entity.ts
   ```


