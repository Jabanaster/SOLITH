#!/usr/bin/env node
/**
 * V1.2 registry-first advisory router tests.
 * Proves: registry loads/validates, Workshop absent, Codex verifier,
 * deterministic plans, manual default, auto advisory-only, learning non-influence,
 * local stub ready:false, registry-driven extensibility, detector + classifier.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const registry = require('../workflow/agentbridge/registry.js');
const router = require('../workflow/agentbridge/router.js');
const relay = require('../workflow/agentbridge/agentbridge.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tmp', 'agentbridge-router-fixtures');

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function baseConfig(): any {
    return clone(registry.DEFAULT_CONFIG);
}

function baseAgents(): any[] {
    return clone(registry.DEFAULT_AGENTS);
}

function makeFixtures(): { electron: string; node: string; python: string; generic: string } {
    fs.rmSync(FIXTURES, { recursive: true, force: true });
    fs.mkdirSync(FIXTURES, { recursive: true });

    const electron = path.join(FIXTURES, 'electron');
    fs.mkdirSync(electron, { recursive: true });
    fs.mkdirSync(path.join(electron, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(electron, 'package.json'), JSON.stringify({
        scripts: { build: 'electron-builder', test: 'vitest' },
        devDependencies: { electron: '^30.0.0' }
    }));

    const node = path.join(FIXTURES, 'node');
    fs.mkdirSync(node, { recursive: true });
    fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify({
        scripts: { build: 'vite build' },
        dependencies: { react: '^18.0.0' }
    }));

    const python = path.join(FIXTURES, 'python');
    fs.mkdirSync(python, { recursive: true });
    fs.writeFileSync(path.join(python, 'requirements.txt'), 'fastapi\n');

    const generic = path.join(FIXTURES, 'generic');
    fs.mkdirSync(generic, { recursive: true });

    return { electron, node, python, generic };
}

function routePlan(taskText: string, projectPath: string, agents: any[], config: any): any {
    return router.route(
        { description: taskText, projectPath },
        { agents, routerConfig: config, projectProfile: router.detectProject(projectPath), classification: router.classifyTask(taskText) }
    );
}

function run(): void {
    console.log('=== AgentBridge V1.2 Router Tests ===\n');

    process.chdir(ROOT);
    relay.initState();
    const fx = makeFixtures();

    // 1. registry loads
    const agents = registry.loadAgents();
    assert(Array.isArray(agents) && agents.length >= 3, 'registry should load agents');
    for (const id of ['claude', 'chatgpt', 'codex']) {
        assert(agents.some((a: any) => a.id === id), `registry should include ${id}`);
    }
    console.log('OK 1 registry loads');

    // 2. registry validates required fields (default registry is valid)
    const valid = registry.validateRegistry(agents, registry.getRouterConfig());
    assert(valid.ok === true, `default registry should validate: ${valid.errors.join('; ')}`);
    console.log('OK 2 registry validates required fields');

    // 3. malformed registry entries fail validation
    {
        const bad = baseAgents();
        delete bad[0].role;
        bad[1].capabilities = 'not-an-array';
        bad[2].priority = 'high';
        const result = registry.validateRegistry(bad, baseConfig());
        assert(result.ok === false, 'malformed registry should fail validation');
        assert(result.errors.length >= 3, 'malformed registry should report errors');
    }
    console.log('OK 3 malformed entries fail validation');

    // 4. Workshop is not a default active agent; enabled workshop fails validation
    {
        assert(!agents.some((a: any) => a.id === 'workshop'), 'workshop must not be a default agent');
        const withWorkshop = baseAgents();
        withWorkshop.push({
            id: 'workshop', displayName: 'Workshop', role: 'primary', capabilities: ['x'],
            allowedTaskTypes: ['implementation'], canVerify: false, canExecute: false, enabled: true, ready: true, priority: 1
        });
        const result = registry.validateRegistry(withWorkshop, baseConfig());
        assert(result.ok === false, 'enabled workshop must fail validation');
        assert(result.errors.some((e: string) => e.includes('workshop')), 'error must mention workshop');
    }
    console.log('OK 4 workshop rejected');

    // 5. Codex is the verifier
    {
        const plan = routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        assert(plan.agents.verifier === 'codex', 'verifier must be codex');
        assert(plan.locked_verifier === 'codex', 'locked verifier must be codex');
    }
    console.log('OK 5 codex is verifier');

    // 6. router returns deterministic plans
    {
        const a = routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        const b = routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        assert(JSON.stringify(a) === JSON.stringify(b), 'route must be deterministic');
    }
    console.log('OK 6 deterministic plans');

    // 7. manual mode is default
    {
        const plan = routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        assert(plan.mode.manual_default === true, 'manual mode must be default');
    }
    console.log('OK 7 manual default');

    // 8. auto mode is advisory only (execution never allowed)
    {
        const cfg = baseConfig();
        cfg.manual_default = false;
        const plan = routePlan('implement a feature', fx.node, baseAgents(), cfg);
        assert(plan.mode.auto_advisory_only === true, 'auto must be advisory only');
        assert(plan.execution_allowed === false, 'execution must never be allowed');
    }
    console.log('OK 8 auto advisory only');

    // 9. learning records do not influence routing by default
    {
        relay.store.recordOutcome({ taskType: 'implementation', route: { primary: 'claude' }, outcome: 'fail', loopCount: 5, buildResult: 'FAIL', timestamp: new Date().toISOString() });
        const records = relay.store.getAgentStats();
        assert(records.length > 0, 'learning records should be stored');
        const cfg = baseConfig();
        assert(cfg.learning.influence_routing === false, 'influence must be off by default');
        const planNoInfluence = routePlan('implement a feature', fx.node, baseAgents(), cfg);
        const planFresh = routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        assert(JSON.stringify(planNoInfluence) === JSON.stringify(planFresh), 'learning must not influence routing by default');
    }
    console.log('OK 9 learning records do not influence routing');

    // 10. local model reports ready:false
    {
        const local = agents.find((a: any) => a.id === 'local');
        assert(local && local.ready === false, 'local model must be a stub with ready:false');
        const cfg = registry.getRouterConfig();
        assert(cfg.local_model.ready === false, 'local_model config ready must be false');
    }
    console.log('OK 10 local model ready:false');

    // 11. adding a new registry agent does not require router code changes
    {
        const extended = baseAgents();
        extended.push({
            id: 'qwen', displayName: 'Qwen', role: 'primary', capabilities: ['implementation'],
            allowedTaskTypes: ['implementation', 'fix'], canVerify: false, canExecute: false,
            enabled: true, ready: true, priority: 200
        });
        const plan = routePlan('implement a feature', fx.node, extended, baseConfig());
        assert(plan.agents.primary === 'qwen', 'highest-priority new primary should be selected via data only');
        assert(plan.agents.verifier === 'codex', 'verifier remains codex');
    }
    console.log('OK 11 new agent routed via registry data');

    // 12. project detector returns expected profile
    {
        const e = router.detectProject(fx.electron);
        assert(e.project_type === 'electron-node', 'electron detected');
        assert(e.has_package_json === true, 'has_package_json');
        assert(e.has_electron === true, 'has_electron');
        assert(e.has_tests === true, 'has_tests');
        assert(e.has_build_script === true, 'has_build_script');
        assert(router.detectProject(fx.node).project_type === 'node', 'node detected');
        assert(router.detectProject(fx.python).project_type === 'python', 'python detected');
        assert(router.detectProject(fx.generic).project_type === 'generic', 'generic fallback');
    }
    console.log('OK 12 project detector returns expected profile');

    // 13. task classifier returns expected categories
    {
        assert(router.classifyTask('implement a new feature') === 'implementation', 'implementation');
        assert(router.classifyTask('please review this PR') === 'review', 'review');
        assert(router.classifyTask('verify the build passes') === 'verification', 'verification');
        assert(router.classifyTask('write unit tests with vitest') === 'test', 'test');
        assert(router.classifyTask('package the electron installer') === 'packaging', 'packaging');
        assert(router.classifyTask('update the readme documentation') === 'documentation', 'documentation');
        assert(router.classifyTask('') === 'unknown', 'unknown');
    }
    console.log('OK 13 task classifier returns expected categories');

    // 14. route output has the expected shape
    {
        const plan = routePlan('implement a feature', fx.electron, baseAgents(), baseConfig());
        for (const key of ['task_type', 'project', 'mode', 'agents', 'steps', 'reason', 'execution_allowed']) {
            assert(Object.prototype.hasOwnProperty.call(plan, key), `plan must include ${key}`);
        }
        assert(typeof plan.agents.primary === 'string', 'agents.primary string');
        assert(typeof plan.agents.reviewer === 'string', 'agents.reviewer string');
        assert(plan.agents.verifier === 'codex', 'agents.verifier codex');
        assert(Array.isArray(plan.steps) && plan.steps.length === 4, 'steps array of 4');
        assert(plan.execution_allowed === false, 'execution_allowed false');
    }
    console.log('OK 14 route output shape');

    // 15. router is pure: no files written
    {
        const before = countFiles(FIXTURES);
        routePlan('implement a feature', fx.node, baseAgents(), baseConfig());
        relay.planTask('implement a feature', fx.node);
        const after = countFiles(FIXTURES);
        assert(before === after, 'router must not write files');
    }
    console.log('OK 15 router is pure / no writes');

    console.log('\n=== Router Tests Complete ===');
}

function countFiles(dir: string): number {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countFiles(full);
        } else {
            count += 1;
        }
    }
    return count;
}

try {
    run();
} catch (error) {
    console.error('ROUTER TEST FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
}
