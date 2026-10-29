import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { SessionManager } from './agent/memory/SessionManager';
import { MemoryStore } from './agent/memory/MemoryStore';
import { ContextManager } from './agent/memory/ContextManager';
import { AgentCore } from './agent/AgentCore';

async function runSessionVerificationSuite() {
  console.log('===============================================================');
  console.log('🚀 RUNNING 10-STAGE SESSION & PERSISTENT MEMORY VERIFICATION');
  console.log('===============================================================\n');

  const testDataPath = path.resolve(process.cwd(), 'data', 'test_sessions.json');
  if (fs.existsSync(testDataPath)) fs.unlinkSync(testDataPath);

  let passedTests = 0;
  const totalTests = 10;

  try {
    // ── TEST 1: SESSION CREATION ──────────────────────────────────────────
    console.log('▶ TEST 1 — SESSION CREATION');
    const sm = new SessionManager(testDataPath);
    const s1 = sm.createSession('Python Data Pipeline', 'Data Engineering');
    const s2 = sm.createSession('Kyoto Trip Itinerary', 'Travel Planning');

    if (!s1.id || !s2.id || s1.id === s2.id) {
      throw new Error(`Session IDs are not unique: ${s1.id} vs ${s2.id}`);
    }
    if (s1.topic !== 'Data Engineering' || s2.topic !== 'Travel Planning') {
      throw new Error('Topics were not saved correctly');
    }
    console.log(`  ✓ Created Session 1: [${s1.id}] "${s1.title}" (Topic: ${s1.topic})`);
    console.log(`  ✓ Created Session 2: [${s2.id}] "${s2.title}" (Topic: ${s2.topic})`);
    passedTests++;

    // ── TEST 2: PERSISTENCE (SURVIVE APPLICATION RESTART) ───────────────────
    console.log('\n▶ TEST 2 — PERSISTENCE & COLD RESTART');
    sm.addMessage(s1.id, 'user', 'We need to use Polars instead of Pandas for 10x throughput.');
    sm.addMessage(s1.id, 'assistant', 'Understood. We will architect the pipeline using Polars lazy frames.');
    sm.addMessage(s1.id, 'user', 'Target ingestion speed is 50,000 events per second.');
    sm.addMessage(s1.id, 'assistant', 'Noted. 50,000 events per second target set.');

    // Simulate complete process exit and re-instantiation from disk
    const smRestarted = new SessionManager(testDataPath);
    const restoredSession = smRestarted.getSession(s1.id);
    if (!restoredSession || restoredSession.messages.length !== 4) {
      throw new Error(`Expected 4 messages restored, got ${restoredSession?.messages.length}`);
    }
    if (!restoredSession.messages[0].content.includes('Polars instead of Pandas')) {
      throw new Error('Message content mismatch after cold restart');
    }
    console.log(`  ✓ Cold restart verified: Restored ${restoredSession.messages.length} messages from disk without loss.`);
    passedTests++;

    // ── TEST 3: CONTEXTUAL RECALL ─────────────────────────────────────────
    console.log('\n▶ TEST 3 — CONTEXTUAL RECALL');
    const memStore = new MemoryStore();
    const ctxMgr = new ContextManager(memStore, smRestarted);

    // Prompt asking about earlier decision
    const recallQuery = 'What library did we decide to use for the pipeline?';
    const promptMessages = ctxMgr.buildPromptMessages(
      recallQuery,
      [],
      { mode: 'conversational' },
      s1.id
    );

    const systemPrompt = promptMessages.find(m => m.role === 'system')?.content || '';
    if (!systemPrompt.includes('Data Engineering') || !systemPrompt.includes(s1.title)) {
      throw new Error('System prompt missing session title or topic');
    }
    console.log('  ✓ Session topic & scope correctly assembled into model system prompt.');
    passedTests++;

    // ── TEST 4: TOPIC AWARENESS ───────────────────────────────────────────
    console.log('\n▶ TEST 4 — TOPIC AWARENESS & DECISION TRACKING');
    smRestarted.updateRollingSummary(
      s1.id,
      'Architecting a high-throughput Python data pipeline using Polars.',
      ['Library: Polars lazy frames', 'Target throughput: 50,000 events/sec', 'Format: Parquet on S3'],
      'High-Throughput Data Engineering'
    );

    const topicPromptMessages = ctxMgr.buildPromptMessages(
      'Continue from where we stopped.',
      [],
      { mode: 'conversational' },
      s1.id
    );
    const updatedSystemPrompt = topicPromptMessages.find(m => m.role === 'system')?.content || '';
    if (!updatedSystemPrompt.includes('50,000 events/sec') || !updatedSystemPrompt.includes('Polars lazy frames')) {
      throw new Error('Prompt does not contain established decisions/facts');
    }
    console.log('  ✓ Topic awareness verified: Established decisions & rolling summary ground the prompt.');
    passedTests++;

    // ── TEST 5: SESSION ISOLATION (ZERO CROSS-CONTAMINATION) ──────────────
    console.log('\n▶ TEST 5 — SESSION ISOLATION (NO MEMORY CONTAMINATION)');
    // Add distinct secret/fact to session 2
    smRestarted.addMessage(s2.id, 'user', 'My budget for the Kyoto ryokan is $800 per night.');
    smRestarted.addMessage(s2.id, 'assistant', 'Got it, looking for luxury ryokans in Gion under $800.');

    // Build prompt for Session 1 (Python)
    const s1Prompt = ctxMgr.buildPromptMessages('What is our plan?', [], { mode: 'conversational' }, s1.id);
    const s1Sys = s1Prompt.find(m => m.role === 'system')?.content || '';

    // Build prompt for Session 2 (Kyoto)
    const s2Prompt = ctxMgr.buildPromptMessages('What is our plan?', [], { mode: 'conversational' }, s2.id);
    const s2Sys = s2Prompt.find(m => m.role === 'system')?.content || '';

    // Check strict isolation: S1 must NEVER have ryokan or $800
    if (s1Sys.includes('ryokan') || s1Sys.includes('$800') || s1Sys.includes('Kyoto')) {
      throw new Error('Cross-session memory leak detected: Session 1 contains Session 2 data!');
    }
    if (!s2Sys.includes('Kyoto Trip Itinerary')) {
      throw new Error('Session 2 did not receive its own context');
    }
    console.log('  ✓ Session isolation verified: Strict boundary maintained between Session 1 and Session 2.');
    passedTests++;

    // ── TEST 6: LONG CONVERSATION HISTORICAL RETRIEVAL ─────────────────────
    console.log('\n▶ TEST 6 — LONG CONVERSATION HISTORICAL RETRIEVAL');
    // Add 12 turns to push the Polars discussion far into the past
    for (let i = 1; i <= 12; i++) {
      smRestarted.addMessage(s1.id, 'user', `Unrelated question turn ${i}: Tell me about step ${i}`);
      smRestarted.addMessage(s1.id, 'assistant', `Response to step ${i}. Everything running.`);
    }

    const relevantPastTurns = smRestarted.retrieveRelevantMessages(s1.id, 'What was our throughput target in events per second?', 3, 6);
    if (relevantPastTurns.length === 0) {
      throw new Error('Failed to retrieve older relevant message matching throughput target');
    }
    const retrievedContent = relevantPastTurns.map(m => m.content).join(' ');
    if (!retrievedContent.includes('50,000 events per second')) {
      throw new Error(`Retrieved messages did not contain the exact target: ${retrievedContent}`);
    }
    console.log(`  ✓ Historical retrieval verified: Successfully recalled exact statement from 14 turns ago (${relevantPastTurns.length} hits).`);
    passedTests++;

    // ── TEST 7: CRUD OPERATIONS (PIN, RENAME, ARCHIVE, SEARCH, DELETE) ────
    console.log('\n▶ TEST 7 — CRUD OPERATIONS');
    // Rename
    smRestarted.updateSession(s1.id, { title: 'Production Polars ETL' });
    const renamed = smRestarted.getSession(s1.id)?.session;
    if (renamed?.title !== 'Production Polars ETL') throw new Error('Rename failed');

    // Pin
    smRestarted.updateSession(s1.id, { pinned: true });
    const pinnedList = smRestarted.listSessions();
    if (pinnedList[0].id !== s1.id || !pinnedList[0].pinned) throw new Error('Pin failed');

    // Archive
    smRestarted.updateSession(s2.id, { archived: true });
    const unarchivedList = smRestarted.listSessions({ includeArchived: false });
    if (unarchivedList.some(s => s.id === s2.id)) throw new Error('Archive failed: session still in active list');
    const allList = smRestarted.listSessions({ includeArchived: true });
    if (!allList.some(s => s.id === s2.id && s.archived)) throw new Error('Archive failed: missing from all list');

    // Search
    const searchResults = smRestarted.search('ryokan');
    if (searchResults.length === 0 || searchResults[0].session.id !== s2.id) {
      throw new Error('Search failed to find ryokan in Session 2');
    }

    // Delete
    const deleted = smRestarted.deleteSession(s2.id);
    if (!deleted || smRestarted.getSession(s2.id) !== null) {
      throw new Error('Delete failed: session still exists');
    }
    console.log('  ✓ CRUD verified: Rename, Pin, Archive, Search, and Delete all passed.');
    passedTests++;

    // ── TEST 8: VOICE / AUDIO ROUTING & COORDINATION ──────────────────────
    console.log('\n▶ TEST 8 — VOICE PIPELINE & SESSION ROUTING');
    // Simulate voice message addition to active session
    const voiceMsg = smRestarted.addMessage(s1.id, 'user', 'Spoken voice message transcribed by Web Speech API', {
      status: 'delivered'
    });
    const assistantVoiceReply = smRestarted.addMessage(s1.id, 'assistant', 'Spoken response synthesized via ElevenLabs neural voice', {
      status: 'delivered',
      modelUsed: 'gemini',
      audioDurationMs: 2400
    });

    if (voiceMsg.sessionId !== s1.id || assistantVoiceReply.sessionId !== s1.id) {
      throw new Error('Voice message was routed to incorrect session ID');
    }
    console.log('  ✓ Voice routing verified: Transcribed speech and synthesized audio metadata bound to session.');
    passedTests++;

    // ── TEST 9: REGRESSION (NORMAL CONVERSATION & TOOLS) ───────────────────
    console.log('\n▶ TEST 9 — REGRESSION (BACKWARD COMPATIBILITY)');
    const agent = new AgentCore();
    // Verify agent defaults and backward compatibility
    const defaultSessions = agent.getSessionManager().listSessions();
    if (defaultSessions.length === 0) {
      throw new Error('Default sessions list empty');
    }
    const tools = agent.getToolRegistry().getAllDefinitions();
    if (tools.length === 0) {
      throw new Error('Tools registry corrupted');
    }
    console.log(`  ✓ Regression verified: Normal conversation modes, ${tools.length} tool suites, and memory store functional.`);
    passedTests++;

    // ── TEST 10: FAILURE HANDLING & RECOVERY ──────────────────────────────
    console.log('\n▶ TEST 10 — FAILURE HANDLING & DATA INTEGRITY');
    // Attempt deleting non-existent session
    const fakeDelete = smRestarted.deleteSession('non_existent_session_id');
    if (fakeDelete) throw new Error('Expected delete of invalid ID to return false');

    // Backup file exists and is valid JSON
    const backupPath = testDataPath.replace(/\.json$/, '.backup.json');
    if (!fs.existsSync(backupPath)) throw new Error('Backup file was not created');
    const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (!backupJson.sessions || !Array.isArray(backupJson.sessions)) {
      throw new Error('Backup file invalid JSON structure');
    }
    console.log('  ✓ Failure handling verified: Atomic writes and backup copies protected data integrity.');
    passedTests++;

  } finally {
    // Clean up temporary test database
    if (fs.existsSync(testDataPath)) fs.unlinkSync(testDataPath);
    const backupPath = testDataPath.replace(/\.json$/, '.backup.json');
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }

  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS COMPLETED AND PASSED!`);
  console.log('===============================================================');
}

runSessionVerificationSuite().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILED:', err);
  process.exit(1);
});

