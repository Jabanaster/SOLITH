#!/usr/bin/env node
/**
 * Full AgentBridge validation: project compile + AgentBridge build + smoke checks.
 * Does not run Electron packaging.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

function run(command) {
    console.log(`\n> ${command}\n`);
    execSync(command, { cwd: ROOT, stdio: 'inherit' });
}

function smokeChecks() {
    console.log('\n=== AgentBridge smoke checks ===\n');

    const help = execSync('node workflow/agentbridge/agentbridge.js', {
        cwd: ROOT,
        encoding: 'utf8'
    });
    if (!help.includes('AgentBridge V1')) {
        fail('CLI help missing AgentBridge V1');
    }
    if (!help.includes('ingest <agent> <file> [taskId]')) {
        fail('CLI help missing ingest usage');
    }
    console.log('OK CLI help');

    const workshop = execSync('node workflow/agentbridge/agentbridge.js ingest workshop noop.md', {
        cwd: ROOT,
        encoding: 'utf8'
    });
    if (!workshop.includes('Workshop AI removed from V1')) {
        fail('Workshop ingest should be rejected');
    }
    console.log('OK Workshop rejected');

    const relay = require(path.join(ROOT, 'workflow/agentbridge/agentbridge.js'));
    if (relay.parseCodexResult('RESULT: NOT_RUN') !== 'NOT_RUN') {
        fail('parseCodexResult should detect NOT_RUN');
    }
    if (relay.parseCodexResult('RESULT: PASS') !== 'PASS') {
        fail('parseCodexResult should detect PASS');
    }
    if (relay.parseCodexResult('RESULT: FAIL') !== 'FAIL') {
        fail('parseCodexResult should detect FAIL');
    }
    console.log('OK Codex result parsing');

    const template = fs.readFileSync(path.join(ROOT, 'templates/codex-build.md'), 'utf8');
    if (!template.includes('PASS') || !template.includes('FAIL') || !template.includes('NOT_RUN')) {
        fail('codex-build template missing result markers');
    }
    console.log('OK codex-build template');

    if (relay.isDangerousCommand('git push') !== true) {
        fail('isDangerousCommand should flag git push');
    }
    if (relay.isDangerousCommand('node build.js') !== false) {
        fail('isDangerousCommand should allow safe command');
    }
    console.log('OK dangerous command guard');

    const codexConfig = relay.store.getCodexConfig();
    if (typeof codexConfig.allowCodexCommandExecution !== 'boolean') {
        fail('codex config missing allowCodexCommandExecution');
    }
    if (typeof codexConfig.codexBuildTimeoutMs !== 'number') {
        fail('codex config missing codexBuildTimeoutMs');
    }
    if (codexConfig.allowCodexCommandExecution !== false) {
        fail('codex command execution must default to disabled');
    }
    console.log('OK codex config defaults');

    const agents = relay.registry.loadAgents();
    for (const id of ['claude', 'chatgpt', 'codex', 'local']) {
        if (!agents.some((a) => a.id === id)) {
            fail(`registry missing seeded agent: ${id}`);
        }
    }
    const regConfig = relay.registry.getRegistryConfig();
    if (regConfig.roleBindings.Verifier !== 'codex') {
        fail('Verifier must be bound to codex');
    }
    if (regConfig.routerMode !== 'manual') {
        fail('routerMode must default to manual');
    }
    if (regConfig.learningInfluenceEnabled !== false) {
        fail('learning influence must default to disabled');
    }
    console.log('OK registry + router config defaults');

    const samplePlan = relay.router.route(
        { taskId: 'VERIFY', description: 'implement feature', state: 'created', projectPath: ROOT },
        { agents, registryConfig: regConfig, codexConfig, stats: [], now: Date.now() }
    );
    if (samplePlan.effectiveAgents.verifier !== 'codex') {
        fail('router must always select codex as verifier');
    }
    if (!Array.isArray(samplePlan.reasonCodes) || samplePlan.reasonCodes.length === 0) {
        fail('router must emit reason codes');
    }
    console.log('OK router produces advisory plan');

    console.log('OK relay module loads');
}

function main() {
    console.log('=== verify:agentbridge ===');

    run('npm run compile');
    run('npm run build:agentbridge');
    run('npm run smoke:agentbridge');
    smokeChecks();

    console.log('\n=== verify:agentbridge PASS ===');
}

main();
