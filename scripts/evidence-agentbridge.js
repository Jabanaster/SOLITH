#!/usr/bin/env node
/**
 * AgentBridge V1.3 — Evidence Pack + Operator Runbook generator.
 *
 * Produces a local proof bundle:
 *   workflow/agentbridge/evidence/EVIDENCE_<timestamp>.md
 *   workflow/agentbridge/evidence/EVIDENCE_<timestamp>.json
 *
 * Proof-focused and boring on purpose:
 *   - git state, relay status, registry validation, a router sample,
 *     gate results, report links, operator runbook, safety notes.
 *
 * Relay safety: the relay task store (sqlite db + json fallback) is snapshotted
 * before the validation gates run and restored afterward, so generating evidence
 * never mutates relay state. The router sample uses the pure planTask() helper.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, 'workflow', 'agentbridge');
const EVIDENCE_DIR = path.join(WF_DIR, 'evidence');
const DOCS_DIR = path.join(ROOT, 'Docs');

const relay = require(path.join(WF_DIR, 'agentbridge.js'));

// Store files that hold relay state; snapshotted/restored around the gate run.
const STORE_FILES = [
    'agentbridge.db',
    'agentbridge.db-wal',
    'agentbridge.db-shm',
    'agentbridge.db-journal',
    'config.json'
];

const GATES = [
    { name: 'test:router', command: 'npm run test:router' },
    { name: 'test:codex-relay', command: 'npm run test:codex-relay' },
    { name: 'test:agentbridge-v11', command: 'npm run test:agentbridge-v11' },
    { name: 'smoke:agentbridge', command: 'npm run smoke:agentbridge' },
    { name: 'verify:agentbridge', command: 'npm run verify:agentbridge' }
];
if (!process.env.EVIDENCE_SKIP_BUILD) {
    GATES.push({ name: 'build', command: 'npm run build' });
}

function git(args) {
    try {
        return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
        return '';
    }
}

function tail(text, n) {
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim() !== '');
    return lines.slice(-n).join('\n');
}

function collectGitState() {
    const porcelain = git('status --porcelain');
    return {
        branch: git('rev-parse --abbrev-ref HEAD') || 'unknown',
        head: git('rev-parse HEAD') || 'unknown',
        headShort: git('rev-parse --short HEAD') || 'unknown',
        headSubject: git('log -1 --pretty=%s') || 'unknown',
        clean: porcelain === '',
        dirtyFiles: porcelain === '' ? [] : porcelain.split(/\r?\n/),
        tagsAtHead: (git('tag --points-at HEAD') || '').split(/\r?\n/).filter(Boolean),
        allTags: (git('tag --list') || '').split(/\r?\n/).filter(Boolean)
    };
}

function collectRelayStatus() {
    relay.initState();
    const activeTaskId = relay.store.getActiveTaskId();
    const taskMap = relay.store.loadAllTasks();
    const tasks = [...taskMap.entries()].map(([id, task]) => ({
        id,
        state: task.state || 'unknown',
        projectPath: task.projectPath || null,
        createdAt: task.createdAt || null,
        updatedAt: task.updatedAt || null,
        lastBuildResult: task.lastBuildResult || task.codexBuildResult || null
    }));
    // Newest first; rows missing createdAt (legacy schema) sort last.
    tasks.sort((a, b) => {
        if (a.createdAt && b.createdAt) {
            return String(b.createdAt).localeCompare(String(a.createdAt));
        }
        if (a.createdAt) {
            return -1;
        }
        if (b.createdAt) {
            return 1;
        }
        return String(b.id).localeCompare(String(a.id));
    });

    const recent = tasks.slice(0, 10);
    const activeTask = tasks.find((t) => t.id === activeTaskId) || null;
    const lastBuild = (activeTask && activeTask.lastBuildResult)
        || (tasks.find((t) => t.lastBuildResult) || {}).lastBuildResult
        || null;

    return {
        activeTaskId: activeTaskId || null,
        totalTasks: tasks.length,
        recentTasks: recent,
        activeTask,
        lastBuildResult: lastBuild
    };
}

function collectRegistryStatus() {
    const agents = relay.registry.loadAgents();
    const config = relay.registry.getRouterConfig();
    const validation = relay.registry.validateRegistry(agents, config);
    const codex = agents.find((a) => a.id === 'codex');
    const verifierLocked = config.locked_verifier === 'codex'
        && Boolean(codex && codex.canVerify && codex.enabled);
    const workshopPresent = agents.some((a) => a.id === 'workshop' && a.enabled);

    return {
        valid: validation.ok,
        errors: validation.errors,
        verifierLocked,
        lockedVerifier: config.locked_verifier,
        workshopRejected: !workshopPresent,
        manualDefault: config.manual_default === true,
        routerAdvisoryOnly: config.auto_advisory_only !== false,
        learningInfluenceRouting: Boolean(config.learning && config.learning.influence_routing),
        agents: agents.map((a) => ({
            id: a.id,
            role: a.role,
            enabled: a.enabled,
            ready: a.ready,
            canVerify: a.canVerify,
            priority: a.priority
        }))
    };
}

function collectRouterSample() {
    const sampleTask = 'implement a sample feature for the evidence pack';
    const plan = relay.planTask(sampleTask, ROOT);
    return { sampleTask, plan };
}

function collectReportLinks() {
    const candidates = [
        'Docs/AGENTBRIDGE_OPERATOR_RUNBOOK.md',
        'Docs/AGENTBRIDGE_V1.2_VALIDATION.md',
        'Docs/AGENTBRIDGE_V1_REAL_E2E.md',
        'Docs/AGENTBRIDGE_V1_BASELINE.md'
    ];
    return candidates
        .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
        .map((rel) => ({ path: rel, exists: true }));
}

function storeHash() {
    const hash = crypto.createHash('sha256');
    for (const file of STORE_FILES) {
        const full = path.join(WF_DIR, file);
        if (fs.existsSync(full)) {
            hash.update(file);
            hash.update(fs.readFileSync(full));
        }
    }
    return hash.digest('hex');
}

function snapshotStore() {
    const snapshot = {};
    for (const file of STORE_FILES) {
        const full = path.join(WF_DIR, file);
        snapshot[file] = fs.existsSync(full) ? fs.readFileSync(full) : null;
    }
    return snapshot;
}

function restoreStore(snapshot) {
    for (const file of STORE_FILES) {
        const full = path.join(WF_DIR, file);
        if (snapshot[file] === null) {
            if (fs.existsSync(full)) {
                fs.rmSync(full);
            }
        } else {
            fs.writeFileSync(full, snapshot[file]);
        }
    }
}

function runGate(gate) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let passed = false;
    let output = '';
    try {
        output = execSync(gate.command, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        });
        passed = true;
    } catch (error) {
        output = `${error.stdout || ''}\n${error.stderr || ''}`;
        passed = false;
    }
    const durationMs = Date.now() - t0;
    console.log(`  ${passed ? 'PASS' : 'FAIL'} ${gate.name} (${durationMs} ms)`);
    return {
        name: gate.name,
        command: gate.command,
        passed,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        summary: tail(output, 4)
    };
}

function runGatesProtected() {
    console.log('\nSnapshotting relay store and running gates...');
    const hashBefore = storeHash();
    const snapshot = snapshotStore();

    let results;
    try {
        results = GATES.map(runGate);
    } finally {
        restoreStore(snapshot);
    }

    const hashAfter = storeHash();
    return {
        results,
        relayState: {
            hashBefore,
            hashAfter,
            restored: hashBefore === hashAfter
        }
    };
}

function operatorRunbookSection() {
    const runbookPath = path.join(DOCS_DIR, 'AGENTBRIDGE_OPERATOR_RUNBOOK.md');
    if (fs.existsSync(runbookPath)) {
        return fs.readFileSync(runbookPath, 'utf8');
    }
    return '(Operator runbook not found at Docs/AGENTBRIDGE_OPERATOR_RUNBOOK.md)';
}

function renderMarkdown(data) {
    const g = data.git;
    const r = data.relay;
    const reg = data.registry;
    const lines = [];

    lines.push(`# AgentBridge Evidence Pack — ${data.generatedAt}`);
    lines.push('');
    lines.push('Local, advisory proof bundle. Generating this evidence does not mutate relay state.');
    lines.push('');

    lines.push('## 1. Git state');
    lines.push('');
    lines.push(`- Branch: \`${g.branch}\``);
    lines.push(`- HEAD: \`${g.headShort}\` — ${g.headSubject}`);
    lines.push(`- Full HEAD: \`${g.head}\``);
    lines.push(`- Working tree: ${g.clean ? 'clean' : `dirty (${g.dirtyFiles.length} file(s))`}`);
    lines.push(`- Tags at HEAD: ${g.tagsAtHead.length ? g.tagsAtHead.map((t) => `\`${t}\``).join(', ') : 'none'}`);
    lines.push(`- All tags: ${g.allTags.length ? g.allTags.map((t) => `\`${t}\``).join(', ') : 'none'}`);
    lines.push('');

    lines.push('## 2. Relay status');
    lines.push('');
    lines.push(`- Active task: ${r.activeTaskId ? `\`${r.activeTaskId}\`` : 'none'}`);
    lines.push(`- Total tasks: ${r.totalTasks}`);
    lines.push(`- Last build/verifier result: ${r.lastBuildResult || 'none'}`);
    lines.push('');
    if (r.recentTasks.length) {
        lines.push('| Task | State | Last build | Created |');
        lines.push('| --- | --- | --- | --- |');
        for (const t of r.recentTasks) {
            lines.push(`| ${t.id} | ${t.state} | ${t.lastBuildResult || '-'} | ${t.createdAt || '-'} |`);
        }
    } else {
        lines.push('No tasks recorded yet.');
    }
    lines.push('');

    lines.push('## 3. Registry status');
    lines.push('');
    lines.push(`- Validation: ${reg.valid ? 'PASS' : 'FAIL'}`);
    if (!reg.valid) {
        for (const err of reg.errors) {
            lines.push(`  - ${err}`);
        }
    }
    lines.push(`- Verifier locked to Codex: ${reg.verifierLocked ? 'yes' : 'no'} (locked_verifier=\`${reg.lockedVerifier}\`)`);
    lines.push(`- Workshop rejected: ${reg.workshopRejected ? 'yes' : 'no'}`);
    lines.push(`- Manual default: ${reg.manualDefault ? 'yes' : 'no'}`);
    lines.push(`- Router advisory only: ${reg.routerAdvisoryOnly ? 'yes' : 'no'}`);
    lines.push(`- Learning influences routing: ${reg.learningInfluenceRouting ? 'yes' : 'no (default)'}`);
    lines.push('');
    lines.push('| Agent | Role | Enabled | Ready | Verifier | Priority |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of reg.agents) {
        lines.push(`| ${a.id} | ${a.role} | ${a.enabled} | ${a.ready} | ${a.canVerify} | ${a.priority} |`);
    }
    lines.push('');

    lines.push('## 4. Router sample (advisory)');
    lines.push('');
    lines.push(`Sample task: "${data.router.sampleTask}"`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(data.router.plan, null, 2));
    lines.push('```');
    lines.push('');

    lines.push('## 5. Gate results');
    lines.push('');
    lines.push(`Relay state snapshot restored after gates: ${data.relayState.restored ? 'yes' : 'NO'}`);
    lines.push(`(store hash before \`${data.relayState.hashBefore.slice(0, 12)}\`, after \`${data.relayState.hashAfter.slice(0, 12)}\`)`);
    lines.push('');
    lines.push('| Gate | Result | Duration | Finished |');
    lines.push('| --- | --- | --- | --- |');
    for (const gate of data.gates) {
        lines.push(`| \`${gate.command}\` | ${gate.passed ? 'PASS' : 'FAIL'} | ${gate.durationMs} ms | ${gate.finishedAt} |`);
    }
    lines.push('');
    for (const gate of data.gates) {
        lines.push(`<details><summary>${gate.name} — ${gate.passed ? 'PASS' : 'FAIL'}</summary>`);
        lines.push('');
        lines.push('```');
        lines.push(gate.summary || '(no output captured)');
        lines.push('```');
        lines.push('');
        lines.push('</details>');
        lines.push('');
    }

    lines.push('## 6. Report links');
    lines.push('');
    for (const link of data.reportLinks) {
        lines.push(`- [${link.path}](../../../${link.path})`);
    }
    lines.push('');

    lines.push('## 7. Operator runbook');
    lines.push('');
    lines.push(operatorRunbookSection());
    lines.push('');

    lines.push('## 8. Safety notes');
    lines.push('');
    lines.push('- Manual is the default; nothing runs without an operator command.');
    lines.push('- The router is advisory only (`execution_allowed: false`); it never executes agents or mutates relay state.');
    lines.push('- Codex is the locked verifier; only Codex can mark a task passed.');
    lines.push('- Workshop is removed/rejected and fails registry validation if enabled.');
    lines.push('- This evidence run snapshotted and restored the relay task store, so relay state is unchanged.');
    lines.push('');

    return lines.join('\n');
}

function main() {
    console.log('=== evidence:agentbridge ===');
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const generatedAt = new Date().toISOString();

    console.log('Collecting git / relay / registry / router state...');
    const gitState = collectGitState();
    const relayStatus = collectRelayStatus();
    const registryStatus = collectRegistryStatus();
    const routerSample = collectRouterSample();
    const reportLinks = collectReportLinks();

    const gateRun = runGatesProtected();

    const data = {
        generatedAt,
        version: 'v1.3.0',
        git: gitState,
        relay: relayStatus,
        registry: registryStatus,
        router: routerSample,
        gates: gateRun.results,
        relayState: gateRun.relayState,
        reportLinks
    };

    const stamp = generatedAt.replace(/[:.]/g, '-');
    const mdPath = path.join(EVIDENCE_DIR, `EVIDENCE_${stamp}.md`);
    const jsonPath = path.join(EVIDENCE_DIR, `EVIDENCE_${stamp}.json`);

    fs.writeFileSync(mdPath, renderMarkdown(data));
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

    const allGatesPass = data.gates.every((gate) => gate.passed);

    console.log('\n=== Evidence Pack Summary ===');
    console.log(`Markdown: ${path.relative(ROOT, mdPath)}`);
    console.log(`JSON:     ${path.relative(ROOT, jsonPath)}`);
    console.log(`Git:      ${gitState.headShort} on ${gitState.branch} (${gitState.clean ? 'clean' : 'dirty'})`);
    console.log(`Registry: ${registryStatus.valid ? 'VALID' : 'INVALID'}, verifier locked=${registryStatus.verifierLocked}`);
    console.log(`Relay state restored: ${gateRun.relayState.restored}`);
    console.log(`Gates:    ${data.gates.filter((g) => g.passed).length}/${data.gates.length} passed`);

    if (!gateRun.relayState.restored) {
        console.error('ERROR: relay state was not restored to its original snapshot.');
        process.exit(1);
    }
    if (!allGatesPass) {
        console.error('One or more gates failed. See evidence pack for details.');
        process.exit(1);
    }

    console.log('\n=== evidence:agentbridge PASS ===');
}

main();
