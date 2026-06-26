#!/usr/bin/env node
/**
 * AgentBridge-only build validation.
 * Does not run Electron packaging.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const AGENTBRIDGE_JS = [
    'workflow/agentbridge/agentbridge.js',
    'workflow/agentbridge/store.js'
];

const REQUIRED_PATHS = [
    'templates/codex-build.md',
    'agents/codex/input',
    'agents/codex/output',
    'scripts/test-codex-relay-flow.ts',
    'scripts/test-agentbridge-v11.ts'
];

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

function checkSyntax(file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) {
        fail(`Missing file: ${file}`);
    }
    execSync(`node --check "${fullPath}"`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`OK syntax ${file}`);
}

function checkPaths() {
    for (const relPath of REQUIRED_PATHS) {
        const fullPath = path.join(ROOT, relPath);
        if (!fs.existsSync(fullPath)) {
            fail(`Missing path: ${relPath}`);
        }
        console.log(`OK path ${relPath}`);
    }
}

function main() {
    console.log('=== build:agentbridge ===\n');

    for (const file of AGENTBRIDGE_JS) {
        checkSyntax(file);
    }

    checkPaths();

    console.log('\nRunning test:codex-relay...\n');
    execSync('npm run test:codex-relay', { cwd: ROOT, stdio: 'inherit' });

    console.log('\nRunning test:agentbridge-v11...\n');
    execSync('npm run test:agentbridge-v11', { cwd: ROOT, stdio: 'inherit' });

    console.log('\n=== build:agentbridge PASS ===');
}

main();
