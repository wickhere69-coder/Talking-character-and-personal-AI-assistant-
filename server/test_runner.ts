import dotenv from 'dotenv';
dotenv.config();
import { AgentCore } from './agent/AgentCore';

async function testFullAgent() {
  const agent = new AgentCore();

  console.log('=== TEST 1: GEMINI ENGINE - GENERAL KNOWLEDGE ===');
  try {
    const gkResult = await agent.handleUserMessage('Explain how photosynthesis works in a clear paragraph.', {
      modelProvider: 'gemini'
    });
    console.log('Gemini Model Used:', gkResult.modelUsed);
    console.log('Gemini Status:', gkResult.status);
    console.log('Gemini Tools Executed:', gkResult.toolsExecuted?.map(t => t.name));
    console.log('Gemini Response:', gkResult.response);
  } catch (err: any) {
    console.error('Gemini error:', err.message);
  }

  console.log('\n=== TEST 2: GEMINI ENGINE - LIVE NEWS / SEARCH ===');
  try {
    const newsResult = await agent.handleUserMessage('What is the latest news regarding space exploration?', {
      modelProvider: 'gemini'
    });
    console.log('Gemini Model Used:', newsResult.modelUsed);
    console.log('Gemini Status:', newsResult.status);
    console.log('Gemini Tools Executed:', newsResult.toolsExecuted?.map(t => t.name));
    console.log('Gemini Response:', newsResult.response);
  } catch (err: any) {
    console.error('Gemini error:', err.message);
  }

  console.log('\n=== TEST 2: GROK ENGINE ===');
  try {
    const grokResult = await agent.handleUserMessage('What is the capital of Japan? Answer in 3 words.', {
      modelProvider: 'grok'
    });
    console.log('Grok Model Used:', grokResult.modelUsed);
    console.log('Grok Status:', grokResult.status);
    console.log('Grok Response:', grokResult.response);
  } catch (err: any) {
    console.error('Grok error:', err.message);
  }

  console.log('\n=== TEST 3: INSTANT ENGINE ===');
  try {
    const instantResult = await agent.handleUserMessage('Hello, how are you?', {
      modelProvider: 'local_fallback'
    });
    console.log('Instant Model Used:', instantResult.modelUsed);
    console.log('Instant Response:', instantResult.response);
  } catch (err: any) {
    console.error('Instant error:', err.message);
  }
}

testFullAgent();
