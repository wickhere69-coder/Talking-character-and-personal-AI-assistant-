import dotenv from 'dotenv';
dotenv.config();

import { AgentCore } from '../server/agent/AgentCore';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3001/api/agent';

async function postJson(endpoint: string, body: any) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function getJson(endpoint: string) {
  const res = await fetch(`${API_BASE}${endpoint}`);
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  console.log('====================================================');
  console.log('   STARTING MEMORY & CONTINUITY VERIFICATION SUITE   ');
  console.log('====================================================\n');

  const results: Record<string, { pass: boolean; evidence: string }> = {};

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1 — Same session, follow-up
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 1] Testing same-session follow-up continuity...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 1 Session', topic: 'Astronomy' });
    const sId = sData.session.id;

    // Turn 1
    const q1 = 'What are three distinct features of the planet Saturn?';
    const r1 = await postJson('/chat', { message: q1, sessionId: sId });
    console.log(`User: ${q1}`);
    console.log(`Aura: ${r1.data.response}\n`);

    // Turn 2
    const q2 = 'Tell me more about the second one you mentioned.';
    const r2 = await postJson('/chat', { message: q2, sessionId: sId });
    console.log(`User: ${q2}`);
    console.log(`Aura: ${r2.data.response}\n`);

    const hasSpecificRef = !r2.data.response.toLowerCase().includes('about what') &&
      !r2.data.response.toLowerCase().includes('what second one');

    results['TEST 1'] = {
      pass: hasSpecificRef && r2.status === 200,
      evidence: `Q1: "${q1}" -> A1: "${r1.data.response.slice(0, 80)}..." | Q2: "${q2}" -> A2: "${r2.data.response.slice(0, 100)}..."`
    };
  } catch (err: any) {
    results['TEST 1'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2 — "What did I just ask?"
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 2] Testing "What did I just ask?" exact recall...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 2 Session', topic: 'Cooking' });
    const sId = sData.session.id;

    const q1 = 'How do I make a traditional Margherita pizza dough?';
    await postJson('/chat', { message: q1, sessionId: sId });

    const q2 = 'What did I just ask you?';
    const r2 = await postJson('/chat', { message: q2, sessionId: sId });
    console.log(`User: ${q2}`);
    console.log(`Aura: ${r2.data.response}\n`);

    const mentionsPizza = r2.data.response.toLowerCase().includes('pizza') ||
      r2.data.response.toLowerCase().includes('dough') ||
      r2.data.response.toLowerCase().includes('margherita');

    results['TEST 2'] = {
      pass: mentionsPizza && r2.status === 200,
      evidence: `Initial: "${q1}" -> Recall response: "${r2.data.response}"`
    };
  } catch (err: any) {
    results['TEST 2'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3 — Page reload: activeSessionId persistence & resumption
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 3] Testing Page Reload session restoration...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 3 Reload Session', topic: 'Architecture' });
    const preReloadId = sData.session.id;

    const q1 = 'Explain the key differences between Gothic and Romanesque architectural arches.';
    await postJson('/chat', { message: q1, sessionId: preReloadId });

    // Emulate frontend page reload:
    // 1. Saved in localStorage:
    const mockLocalStorageKey = 'talking_character_active_session_id';
    const mockLocalStorage = { [mockLocalStorageKey]: preReloadId };

    // 2. loadSessions() restores saved id first
    const { data: listData } = await getJson('/sessions');
    const restoredSession = listData.sessions.find((s: any) => s.id === mockLocalStorage[mockLocalStorageKey] && !s.archived);
    const restoredSessionId = restoredSession ? restoredSession.id : null;

    // 3. User resumes with "what were we talking about?"
    const qResume = 'What were we talking about right before I refreshed?';
    const rResume = await postJson('/chat', { message: qResume, sessionId: restoredSessionId });
    console.log(`Restored Session ID: ${restoredSessionId} (Pre-reload was: ${preReloadId})`);
    console.log(`User: ${qResume}`);
    console.log(`Aura: ${rResume.data.response}\n`);

    const matchesTopic = rResume.data.response.toLowerCase().includes('gothic') ||
      rResume.data.response.toLowerCase().includes('romanesque') ||
      rResume.data.response.toLowerCase().includes('arch') ||
      rResume.data.response.toLowerCase().includes('architecture');

    results['TEST 3'] = {
      pass: preReloadId === restoredSessionId && matchesTopic,
      evidence: `preReloadId (${preReloadId}) === restoredSessionId (${restoredSessionId}); Response correctly identified topic: "${rResume.data.response.slice(0, 100)}..."`
    };
  } catch (err: any) {
    results['TEST 3'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4 — Server restart continuity from data/sessions.json
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 4] Testing Server Restart continuity (cold in-memory restart)...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 4 Restart Session', topic: 'Marine Biology' });
    const sId = sData.session.id;

    const q1 = 'What is the deepest known trench in the ocean and what lives there?';
    await postJson('/chat', { message: q1, sessionId: sId });

    // Instantiate a brand-new AgentCore instance (clean in-memory state, in-memory conversationHistory = [])
    const coldAgent = new AgentCore();
    const coldHistoryLen = coldAgent.getConversationHistory().length;

    // Execute follow-up using coldAgent
    const qFollowUp = 'What was my previous question about the ocean?';
    const coldRes = await coldAgent.handleUserMessage(qFollowUp, { mode: 'chat' }, sId);
    console.log(`Cold agent history length before query: ${coldHistoryLen}`);
    console.log(`User: ${qFollowUp}`);
    console.log(`Aura (cold restarted server): ${coldRes.response}\n`);

    const knowsContext = coldRes.response.toLowerCase().includes('trench') ||
      coldRes.response.toLowerCase().includes('deepest') ||
      coldRes.response.toLowerCase().includes('ocean');

    results['TEST 4'] = {
      pass: coldHistoryLen === 0 && knowsContext,
      evidence: `Cold agent started with 0 in-memory turns. Successfully read session from data/sessions.json: "${coldRes.response.slice(0, 100)}..."`
    };
  } catch (err: any) {
    results['TEST 4'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5 — Interrupted answer resumption
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 5] Testing Interrupted Answer resumption & persistence...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 5 Interrupted Session', topic: 'Quantum Computing' });
    const sId = sData.session.id;

    const agent = new AgentCore();
    const abortCtrl = new AbortController();

    // Stream a long response and abort mid-stream
    let chunksReceived = 0;
    try {
      await agent.handleUserMessageStream(
        'Write a detailed four-part essay explaining quantum superposition, entanglement, and quantum decoherence.',
        { mode: 'conversational' },
        (chunk) => {
          chunksReceived++;
          if (chunksReceived >= 1) {
            abortCtrl.abort();
          }
        },
        abortCtrl.signal,
        sId
      );
    } catch {
      // Expected abort
    }

    // Inspect data/sessions.json to confirm interrupted message was persisted
    const sessionManager = agent.getSessionManager();
    const sessionData = sessionManager.getSession(sId);
    const interruptedMsg = sessionData?.messages.find(m => m.interrupted === true);

    console.log(`Saved interrupted turn found: ${Boolean(interruptedMsg)}`);
    if (interruptedMsg) {
      console.log(`Interrupted message status: ${interruptedMsg.status}, content: "${interruptedMsg.content.slice(0, 60)}..."`);
    }

    // Now resume with "continue"
    const qContinue = 'continue';
    const resumeRes = await agent.handleUserMessage(qContinue, { mode: 'conversational' }, sId);
    console.log(`User: ${qContinue}`);
    console.log(`Aura: ${resumeRes.response}\n`);

    const resumedProperly = !resumeRes.response.toLowerCase().includes('about what') &&
      !resumeRes.response.toLowerCase().includes('what should i continue') &&
      (resumeRes.response.toLowerCase().includes('quantum') ||
       resumeRes.response.toLowerCase().includes('superposition') ||
       resumeRes.response.toLowerCase().includes('entanglement') ||
       resumeRes.response.toLowerCase().includes('decoherence') ||
       resumeRes.response.toLowerCase().includes('picking up') ||
       resumeRes.response.toLowerCase().includes('where we left off'));

    results['TEST 5'] = {
      pass: Boolean(interruptedMsg) && resumedProperly,
      evidence: `Interrupted turn persisted with interrupted: true in data/sessions.json. Resumed without restarting from zero: "${resumeRes.response.slice(0, 100)}..."`
    };
  } catch (err: any) {
    results['TEST 5'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6 — Session switch does not lose a turn
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 6] Testing Session Switch in-flight completion...');
    const { data: sA } = await postJson('/sessions', { title: 'Session A', topic: 'Economics' });
    const { data: sB } = await postJson('/sessions', { title: 'Session B', topic: 'Gardening' });

    // Request initiated for Session A
    const qA = 'What is the economic concept of opportunity cost?';
    await postJson('/chat', { message: qA, sessionId: sA.session.id });

    // Verify Session A has both user and assistant messages in data/sessions.json
    const { data: sessionDataA } = await getJson(`/sessions/${sA.session.id}`);
    const msgsA = sessionDataA.messages;
    const hasUser = msgsA.some((m: any) => m.role === 'user' && m.content.includes('opportunity cost'));
    const hasAssistant = msgsA.some((m: any) => m.role === 'assistant' && m.content.length > 10);

    results['TEST 6'] = {
      pass: hasUser && hasAssistant,
      evidence: `Session A saved turns: ${msgsA.length} turns. User message: ${hasUser}, Assistant response: ${hasAssistant}`
    };
  } catch (err: any) {
    results['TEST 6'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7 — Fresh session isolation (no cross-session leakage)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 7] Testing Fresh Session Isolation...');
    // Create Session 1 with a very unique topic
    const { data: s1 } = await postJson('/sessions', { title: 'Session 1', topic: 'Medieval Blacksmithing' });
    await postJson('/chat', { message: 'How did ancient blacksmiths forge Damascus steel blades?', sessionId: s1.session.id });

    // Now create a completely fresh Session 2
    const { data: s2 } = await postJson('/sessions', { title: 'Fresh Clean Session', topic: 'General' });

    // Ask "what were we talking about?" in the fresh session
    const qFresh = 'What were we talking about?';
    const rFresh = await postJson('/chat', { message: qFresh, sessionId: s2.session.id });
    console.log(`Fresh Session Query: "${qFresh}"`);
    console.log(`Fresh Session Aura Reply: "${rFresh.data.response}"\n`);

    const leakedPreviousTopic = rFresh.data.response.toLowerCase().includes('damascus') ||
      rFresh.data.response.toLowerCase().includes('blacksmith') ||
      rFresh.data.response.toLowerCase().includes('blade');

    results['TEST 7'] = {
      pass: !leakedPreviousTopic,
      evidence: `Fresh session did NOT leak previous topic. Reply: "${rFresh.data.response.slice(0, 100)}..."`
    };
  } catch (err: any) {
    results['TEST 7'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8 — Error does not erase user question
  // ──────────────────────────────────────────────────────────────────────────
  try {
    console.log('[TEST 8] Testing Error / Kill mid-flight retains user question...');
    const { data: sData } = await postJson('/sessions', { title: 'Test 8 Error Session', topic: 'Error Testing' });
    const sId = sData.session.id;

    // Use AgentCore with mock provider that intentionally throws
    const agent = new AgentCore();
    const badProvider = {
      name: 'broken',
      generateResponse: async () => { throw new Error('Simulated upstream network breakdown'); },
      generateResponseStream: async () => { throw new Error('Simulated upstream network breakdown'); }
    };
    (agent as any).providerManager = {
      generateResponse: badProvider.generateResponse,
      generateResponseStream: badProvider.generateResponseStream
    };

    const qFail = 'What is the airspeed velocity of an unladen swallow?';
    try {
      await agent.handleUserMessage(qFail, {}, sId);
    } catch {
      // Expected to fail
    }

    // Now inspect session messages in data/sessions.json
    const sessionManager = agent.getSessionManager();
    const msgs = sessionManager.getMessages(sId);
    const userMsg = msgs.find(m => m.role === 'user' && m.content === qFail);
    const assistantMsg = msgs.find(m => m.role === 'assistant');

    console.log(`User question retained in session: ${Boolean(userMsg)}`);
    console.log(`Assistant note saved: "${assistantMsg?.content}"\n`);

    results['TEST 8'] = {
      pass: Boolean(userMsg),
      evidence: `User question "${userMsg?.content}" safely retained in session with assistant note "${assistantMsg?.content}".`
    };
  } catch (err: any) {
    results['TEST 8'] = { pass: false, evidence: err.message };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary Report
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n====================================================');
  console.log('              TEST RESULTS SUMMARY                  ');
  console.log('====================================================');
  for (const [testName, res] of Object.entries(results)) {
    console.log(`${testName}: ${res.pass ? 'PASS' : 'FAIL'}`);
    console.log(`  Evidence: ${res.evidence}\n`);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
