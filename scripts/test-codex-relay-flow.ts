#!/usr/bin/env node
/**
 * Simulates Codex V1 relay flow:
 * create -> next -> Claude -> ingest -> ChatGPT APPROVED -> ingest -> Codex PASS -> report
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const relay = require('../workflow/agentbridge/agentbridge.js');

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'workflow', 'agentbridge', 'output');

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function writeTempOutput(agent: string, taskId: string, content: string): string {
    const dir = path.join(OUTPUT_DIR, agent);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${taskId}_${agent}_test_${Date.now()}.md`);
    fs.writeFileSync(filePath, content);
    return filePath;
}

function runTest(): void {
    console.log('=== AgentBridge V1 - Codex Relay Flow Test ===\n');

    process.chdir(PROJECT_ROOT);
    relay.initState();

    console.log('Step 1: Create task');
    relay.cmdCreate(PROJECT_ROOT);
    const taskId = relay.store.getActiveTaskId();
    assert(Boolean(taskId), 'Active task should be set after create');
    assert(relay.getTaskState(taskId) === 'created', 'Initial state should be created');
    console.log(`Created task: ${taskId}\n`);

    console.log('Step 2: next (Claude prompt)');
    relay.cmdNext(taskId);
    assert(relay.getTaskState(taskId) === 'waiting_claude_code', 'State should be waiting_claude_code');
    console.log('');

    console.log('Step 3: ingest claude');
    const claudeFile = writeTempOutput('claude', taskId, '# Claude Output\n\nImplemented feature.\n');
    relay.cmdIngest('claude', claudeFile, taskId);
    assert(relay.getTaskState(taskId) === 'waiting_chatgpt_review', 'State should be waiting_chatgpt_review');
    console.log('');

    console.log('Step 4: next (ChatGPT prompt)');
    relay.cmdNext(taskId);
    console.log('');

    console.log('Step 5: ingest chatgpt APPROVED');
    const chatgptFile = writeTempOutput('chatgpt', taskId, '# ChatGPT Review\n\nAPPROVED\n');
    relay.cmdIngest('chatgpt', chatgptFile, taskId);
    assert(relay.getTaskState(taskId) === 'waiting_codex_build', 'State should be waiting_codex_build');
    console.log('');

    console.log('Step 6: next (Codex prompt)');
    relay.cmdNext(taskId);
    console.log('');

    console.log('Step 7: ingest codex PASS');
    const codexFile = writeTempOutput('codex', taskId, 'RESULT: PASS\n\nCOMMAND: npm run typecheck\n');
    relay.cmdIngest('codex', codexFile, taskId);
    assert(relay.getTaskState(taskId) === 'passed', 'State should be passed');
    assert(relay.getLastBuildResult(taskId) === 'PASS', 'Build result should be PASS');
    console.log('');

    console.log('Step 8: report');
    relay.cmdReport(taskId);
    const reportPath = path.join(PROJECT_ROOT, 'workflow', 'agentbridge', `FINAL_REPORT_${taskId}.md`);
    assert(fs.existsSync(reportPath), 'Final report should exist');
    const report = fs.readFileSync(reportPath, 'utf8');
    assert(report.includes('Codex Build Result'), 'Report should include Codex build result');
    assert(report.includes('PASS'), 'Report should include PASS');
    console.log('');

    console.log('Step 9: status');
    relay.cmdStatus(taskId);
    console.log('');

    console.log('=== Test Complete ===');
}

try {
    runTest();
} catch (error) {
    console.error('TEST FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
}
