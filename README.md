# Temporal AI Agent Reference Implementation

This project implements a long running ReAct (Reasoning and Acting) agent using Temporal workflows.

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

   Copy `.env.example` to `.env` and fill in your OpenAI API key and Temporal server details.

5. **Run the Worker**:

   This starts the Temporal worker that will execute the workflows.

   ```bash
   npm run worker
   ```

6. **Start the Workflow**:

   This starts the client that will initiate the ReAct agent workflow.

   ```bash
   npm run client
   ```
