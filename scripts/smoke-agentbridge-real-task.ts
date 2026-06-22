#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const relay = require('../workflow/agentbridge/agentbridge.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_PROJECT = path.join(ROOT, 'tmp', 'agentbridge-smoke-project');
const RELAY_OUTPUT = path.join(ROOT, 'workflow', 'agentbridge', 'output');

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function writeAgentOutput(agent: string, taskId: string, content: string): string {
    const directory = path.join(RELAY_OUTPUT, agent);
    fs.mkdirSync(directory, { recursive: true });
    const outputPath = path.join(directory, `${taskId}_${agent}_real_smoke_${Date.now()}.md`);
    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
}

function assertPrompt(promptPath: string): void {
    assert(fs.existsSync(promptPath), `Missing prompt: ${promptPath}`);
}

function assertProjectPrompt(promptPath: string, projectPath: string): void {
    assertPrompt(promptPath);
    const prompt = fs.readFileSync(promptPath, 'utf8');
    assert(prompt.includes(projectPath), `Prompt does not reference sample project: ${promptPath}`);
}

function run(): void {
    console.log('=== AgentBridge real task smoke test ===');
    process.chdir(ROOT);

    fs.rmSync(SAMPLE_PROJECT, { recursive: true, force: true });
    fs.mkdirSync(SAMPLE_PROJECT, { recursive: true });
    fs.writeFileSync(path.join(SAMPLE_PROJECT, 'hello.txt'), 'AgentBridge smoke project\n', 'utf8');

    relay.initState();
    relay.cmdCreate(SAMPLE_PROJECT);
    const taskId: string | null = relay.store.getActiveTaskId();
    assert(Boolean(taskId), 'Task was not created');
    const id = taskId as string;

    relay.cmdNext(id);
    assertPrompt(path.join(ROOT, 'workflow', 'agentbridge', 'prompts', 'claude', `${id}.md`));

    const claudeOutput = writeAgentOutput('claude', id, '# Claude Output\n\nAdded the requested sample file.\n');
    relay.cmdIngest('claude', claudeOutput, id);
    assert(relay.getTaskState(id) === 'waiting_chatgpt_review', 'Claude output did not advance to ChatGPT');

    relay.cmdNext(id);
    assertPrompt(path.join(ROOT, 'workflow', 'agentbridge', 'prompts', 'chatgpt', `${id}.md`));

    const chatgptOutput = writeAgentOutput('chatgpt', id, '# ChatGPT Review\n\nAPPROVED\n');
    relay.cmdIngest('chatgpt', chatgptOutput, id);
    assert(relay.getTaskState(id) === 'waiting_codex_build', 'ChatGPT approval did not advance to Codex');

    relay.cmdNext(id);
    assertProjectPrompt(path.join(ROOT, 'agents', 'codex', 'input', `${id}.md`), SAMPLE_PROJECT);

    const codexOutput = writeAgentOutput('codex', id, 'RESULT: PASS\n\nCOMMAND: smoke fixture inspection\n');
    relay.cmdIngest('codex', codexOutput, id);
    assert(relay.getTaskState(id) === 'passed', 'Codex PASS did not pass task');

    relay.cmdReport(id);
    const reportPath = path.join(ROOT, 'workflow', 'agentbridge', `FINAL_REPORT_${id}.md`);
    assert(fs.existsSync(reportPath), 'Final report was not created');
    const report = fs.readFileSync(reportPath, 'utf8');
    assert(report.includes(SAMPLE_PROJECT), 'Final report does not reference sample project');
    assert(report.includes('PASS'), 'Final report does not contain Codex PASS');

    console.log(`PASS ${id}`);
    console.log(`Sample project: ${SAMPLE_PROJECT}`);
    console.log(`Final report: ${reportPath}`);
}

try {
    run();
} catch (error) {
    console.error('SMOKE FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
}
