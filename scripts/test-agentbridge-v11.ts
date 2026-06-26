#!/usr/bin/env node
/**
 * V1.1 tests: task listing, show, run-codex (disabled/PASS/FAIL), dangerous command blocked.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const relay = require('../workflow/agentbridge/agentbridge.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'tmp', 'agentbridge-v11-project');

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function capture(fn: () => void): string {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
        lines.push(args.map((a) => String(a)).join(' '));
    };
    try {
        fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

function setup(): void {
    fs.rmSync(PROJECT, { recursive: true, force: true });
    fs.mkdirSync(PROJECT, { recursive: true });
    fs.writeFileSync(path.join(PROJECT, 'pass.js'), 'process.exit(0)\n');
    fs.writeFileSync(path.join(PROJECT, 'fail.js'), 'process.exit(1)\n');
}

function newTask(): string {
    relay.cmdCreate(PROJECT);
    return relay.store.getActiveTaskId() as string;
}

function run(): void {
    console.log('=== AgentBridge V1.1 Tests ===\n');

    process.chdir(ROOT);
    relay.initState();
    setup();

    // Test 1: task listing
    console.log('Test 1: task listing');
    const taskA = newTask();
    const taskB = newTask();
    const listing = capture(() => relay.cmdTasks('10'));
    assert(listing.includes(taskA), 'tasks listing should include taskA');
    assert(listing.includes(taskB), 'tasks listing should include taskB');
    assert(listing.includes('State:'), 'tasks listing should show state');
    assert(listing.includes('Project:'), 'tasks listing should show project path');
    console.log('OK task listing\n');

    // Test 2: show task
    console.log('Test 2: show task');
    const shown = capture(() => relay.cmdShow(taskB));
    assert(shown.includes(taskB), 'show should include task id');
    assert(shown.includes('State:'), 'show should include state');
    assert(shown.includes(PROJECT), 'show should include project path');
    assert(shown.includes('Prompt paths:'), 'show should include prompt paths');
    assert(shown.includes('Output paths:'), 'show should include output paths');
    console.log('OK show task\n');

    // Test 3: run-codex disabled -> NOT_RUN
    console.log('Test 3: run-codex disabled returns NOT_RUN');
    relay.store.setCodexConfig({ allowCodexCommandExecution: false, codexBuildCommand: 'node pass.js' });
    const disabledTask = newTask();
    const disabledOutcome = capture(() => {
        const outcome = relay.cmdRunCodex(disabledTask);
        assert(outcome.result === 'NOT_RUN', 'disabled run should be NOT_RUN');
        assert(outcome.executed === false, 'disabled run should not execute');
    });
    assert(relay.getTaskState(disabledTask) === 'stopped', 'NOT_RUN should stop the task');
    void disabledOutcome;
    console.log('OK run-codex disabled NOT_RUN\n');

    // Test 4: run-codex PASS with safe command
    console.log('Test 4: run-codex PASS with safe command');
    relay.store.setCodexConfig({ allowCodexCommandExecution: true, codexBuildCommand: 'node pass.js' });
    const passTask = newTask();
    let passResult = '';
    capture(() => {
        const outcome = relay.cmdRunCodex(passTask);
        passResult = outcome.result;
        assert(outcome.executed === true, 'PASS run should execute');
    });
    assert(passResult === 'PASS', 'safe zero-exit command should PASS');
    assert(relay.getTaskState(passTask) === 'passed', 'PASS should pass the task');
    console.log('OK run-codex PASS\n');

    // Test 5: run-codex FAIL with safe failing command
    console.log('Test 5: run-codex FAIL with safe failing command');
    relay.store.setCodexConfig({ allowCodexCommandExecution: true, codexBuildCommand: 'node fail.js' });
    const failTask = newTask();
    let failResult = '';
    capture(() => {
        const outcome = relay.cmdRunCodex(failTask);
        failResult = outcome.result;
        assert(outcome.executed === true, 'FAIL run should execute');
    });
    assert(failResult === 'FAIL', 'safe nonzero-exit command should FAIL');
    assert(relay.getLastBuildResult(failTask) === 'FAIL', 'task build result should be FAIL');
    assert(relay.getTaskState(failTask) === 'waiting_claude_fix', 'FAIL should route back to Claude fix');
    console.log('OK run-codex FAIL\n');

    // Test 6: dangerous command blocked
    console.log('Test 6: dangerous command blocked');
    relay.store.setCodexConfig({ allowCodexCommandExecution: true, codexBuildCommand: 'npm install' });
    const dangerTask = newTask();
    let dangerOutcome: { result: string; executed: boolean; blocked: boolean } = { result: '', executed: true, blocked: false };
    capture(() => {
        dangerOutcome = relay.cmdRunCodex(dangerTask);
    });
    assert(dangerOutcome.blocked === true, 'dangerous command should be blocked');
    assert(dangerOutcome.executed === false, 'dangerous command should not execute');
    assert(dangerOutcome.result === 'NOT_RUN', 'blocked command should be NOT_RUN');
    assert(relay.isDangerousCommand('git push') === true, 'git push should be dangerous');
    assert(relay.isDangerousCommand('rm -rf /') === true, 'rm -rf should be dangerous');
    assert(relay.isDangerousCommand('node pass.js') === false, 'safe command should not be dangerous');
    console.log('OK dangerous command blocked\n');

    // Restore safe defaults so real config stays disabled.
    relay.store.setCodexConfig({ allowCodexCommandExecution: false, codexBuildCommand: '' });

    console.log('=== V1.1 Tests Complete ===');
}

try {
    run();
} catch (error) {
    console.error('V1.1 TEST FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
}
