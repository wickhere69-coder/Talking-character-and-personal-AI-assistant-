import { AgentCore } from './agent/AgentCore';

async function testFullAgent() {
  const agent = new AgentCore();
  console.log("Starting full agent test with Grok 4.6...");

  const result = await agent.handleUserMessage("Who is the current President of the United States?", {
    modelProvider: "grok"
  });

  console.log("\n=== FULL AGENT RESULT ===");
  console.log("Model Used:", result.modelUsed);
  console.log("Status:", result.status);
  console.log("Tools Executed:", result.toolsExecuted?.map(t => t.name));
  console.log("Final Spoken Response:", result.response);
}

testFullAgent();
