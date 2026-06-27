#!/usr/bin/env node
/**
 * V1.2 registry-first router tests.
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
    return clone(registry.DEFAULT_REGISTRY_CONFIG);
}

function baseAgents(): any[] {
    return clone(registry.DEFAULT_AGENTS);
}

function makeFixtures(): { node: string; unity: string; unreal: string; python: string; generic: string } {
    fs.rmSync(FIXTURES, { recursive: true, force: true });
    fs.mkdirSync(FIXTURES, { recursive: true });

    const node = path.join(FIXTURES, 'node');
    fs.mkdirSync(node, { recursive: true });
    fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify({
        scripts: { build: 'vite build', test: 'vitest' },
        dependencies: { react: '^18.0.0' },
        devDependencies: { vite: '^5.0.0' }
    }));

    const unity = path.join(FIXTURES, 'unity');
    fs.mkdirSync(path.join(unity, 'Assets'), { recursive: true });
    fs.mkdirSync(path.join(unity, 'ProjectSettings'), { recursive: true });

    const unreal = path.join(FIXTURES, 'unreal');
    fs.mkdirSync(unreal, { recursive: true });
    fs.writeFileSync(path.join(unreal, 'Game.uproject'), '{}');

    const python = path.join(FIXTURES, 'python');
    fs.mkdirSync(python, { recursive: true });
    fs.writeFileSync(path.join(python, 'requirements.txt'), 'fastapi==0.110.0\nuvicorn\n');
    fs.writeFileSync(path.join(python, 'main.py'), 'print("hi")\n');

    const generic = path.join(FIXTURES, 'generic');
    fs.mkdirSync(generic, { recursive: true });

    return { node, unity, unreal, python, generic };
}

function routePlan(task: any, agents: any[], config: any, codexConfig?: any): any {
    return router.route(task, {
        agents,
        registryConfig: config,
        codexConfig: codexConfig || { codexBuildCommand: '' },
        stats: [],
        now: 1782500000000
    });
}

function run(): void {
    console.log('=== AgentBridge V1.2 Router Tests ===\n');

    process.chdir(ROOT);
    relay.initState();
    const fx = makeFixtures();

    // 1. seeded agents exist
    const agents = registry.loadAgents();
    for (const id of ['claude', 'chatgpt', 'codex', 'local']) {
        assert(agents.some((a: any) => a.id === id), `registry should seed ${id}`);
    }
    console.log('OK 1 seeded agents exist');

    // 2. role bindings resolve
    const cfg = registry.getRegistryConfig();
    assert(cfg.roleBindings.PrimaryCoder === 'claude', 'PrimaryCoder -> claude');
    assert(cfg.roleBindings.Reviewer === 'chatgpt', 'Reviewer -> chatgpt');
    assert(cfg.roleBindings.Verifier === 'codex', 'Verifier -> codex');
    console.log('OK 2 role bindings resolve');

    // 3. synthetic agent routed without router code change
    {
        const synthAgents = baseAgents();
        synthAgents.push({
            id: 'qwen', displayName: 'Qwen', roles: ['PrimaryCoder'], languages: ['TS'], gameEngines: [],
            strength: 80, cost: 2, local: true, premium: false, ready: true,
            dailyBudget: 100, hourlyBudget: 20, usedToday: 0, usedThisHour: 0, cooldownUntil: '', priority: 6,
            estimatedContext: 32000, estimatedSpeed: 4
        });
        const synthConfig = baseConfig();
        synthConfig.roleBindings.PrimaryCoder = 'qwen';
        const plan = routePlan({ taskId: 'T', description: 'implement feature', state: 'created', projectPath: fx.node }, synthAgents, synthConfig);
        assert(plan.agents.coder === 'qwen', 'synthetic agent should be bound as coder');
        assert(plan.effectiveAgents.coder === 'qwen', 'synthetic agent should be effective coder');
    }
    console.log('OK 3 synthetic agent routed');

    // 4-7. detection
    assert(router.detectProject(fx.unity).type === 'unity', 'unity detected');
    assert(router.detectProject(fx.unity).gameEngine === 'Unity', 'unity engine');
    assert(router.detectProject(fx.unreal).type === 'unreal', 'unreal detected');
    assert(router.detectProject(fx.node).type === 'node', 'node detected');
    assert(router.detectProject(fx.node).frameworks.includes('react'), 'react framework');
    assert(router.detectProject(fx.generic).type === 'generic', 'generic fallback');
    assert(router.detectProject(fx.python).type === 'python', 'python detected');
    console.log('OK 4-7 project detection');

    // 8. classification
    const cls = (description: string, state = 'created') => router.classifyTask({ description, state }).class;
    assert(cls('implement a new feature') === 'code', 'code class');
    assert(cls('fix the bug in parser') === 'fix', 'fix class');
    assert(router.classifyTask({ description: 'x', state: 'waiting_claude_fix' }).class === 'fix', 'fix via state');
    assert(cls('please review this code') === 'review_only', 'review_only class');
    assert(cls('build the project and run tests') === 'build_only', 'build_only class');
    assert(cls('rename variable foo') === 'trivial', 'trivial class');
    assert(cls('fix the security vulnerability') === 'security', 'security class');
    assert(cls('update the readme documentation') === 'docs', 'docs class');
    assert(cls('update tsconfig settings') === 'config', 'config class');
    console.log('OK 8 classification');

    // 9. manual never skips review
    {
        const config = baseConfig();
        config.routerMode = 'manual';
        const plan = routePlan({ taskId: 'T', description: 'rename variable', state: 'created', projectPath: fx.node }, baseAgents(), config);
        assert(plan.effectiveAgents.reviewer === 'chatgpt', 'manual keeps reviewer');
        assert(plan.reasonCodes.includes('REVIEW_MANUAL_DEFAULT'), 'manual reason');
    }
    console.log('OK 9 manual never skips review');

    // 10. auto trivial skips review
    {
        const config = baseConfig();
        config.routerMode = 'auto';
        const plan = routePlan({ taskId: 'T', description: 'rename variable foo', state: 'created', projectPath: fx.node }, baseAgents(), config);
        assert(plan.effectiveAgents.reviewer === 'skip', 'auto trivial skips review');
        assert(plan.reasonCodes.includes('REVIEW_SKIP_TRIVIAL'), 'skip trivial reason');
    }
    console.log('OK 10 auto trivial skips review');

    // 11. risk flag forces review
    {
        const config = baseConfig();
        config.routerMode = 'auto';
        const plan = routePlan({ taskId: 'T', description: 'run git push to deploy', state: 'created', projectPath: fx.node }, baseAgents(), config);
        assert(plan.effectiveAgents.reviewer === 'chatgpt', 'risk forces reviewer');
        assert(plan.reasonCodes.includes('REVIEW_FORCED_RISK'), 'risk review reason');
        assert(plan.reasonCodes.includes('SAFETY_FORCE_REVIEW'), 'safety force reason');
        assert(plan.effectiveAgents.coder === 'claude', 'risk forces claude coder');
    }
    console.log('OK 11 risk flag forces review');

    // 12. verifier always codex
    {
        const plan = routePlan({ taskId: 'T', description: 'implement feature', state: 'created', projectPath: fx.node }, baseAgents(), baseConfig());
        assert(plan.effectiveAgents.verifier === 'codex', 'verifier always codex');
        assert(plan.reasonCodes.includes('VERIFIER_CODEX'), 'verifier reason');
    }
    console.log('OK 12 verifier always codex');

    // 13. budget low + local ready selects local
    {
        const agentsLow = baseAgents();
        const claude = agentsLow.find((a: any) => a.id === 'claude');
        claude.usedToday = claude.dailyBudget;
        const local = agentsLow.find((a: any) => a.id === 'local');
        local.ready = true;
        const config = baseConfig();
        const plan = routePlan({ taskId: 'T', description: 'implement feature', state: 'created', projectPath: fx.node }, agentsLow, config);
        assert(plan.useLocalModel === true, 'should use local');
        assert(plan.effectiveAgents.coder === 'local', 'effective coder local');
        assert(plan.reasonCodes.includes('LOCAL_FALLBACK_RECOMMENDED'), 'local fallback reason');
        assert(plan.allowPremium === false, 'premium blocked');
    }
    console.log('OK 13 budget low + local ready selects local');

    // 14. budget low + local not ready emits LOCAL_DEFERRED
    {
        const agentsLow = baseAgents();
        const claude = agentsLow.find((a: any) => a.id === 'claude');
        claude.usedToday = claude.dailyBudget;
        const plan = routePlan({ taskId: 'T', description: 'implement feature', state: 'created', projectPath: fx.node }, agentsLow, baseConfig());
        assert(plan.reasonCodes.includes('LOCAL_DEFERRED'), 'local deferred reason');
        assert(plan.effectiveAgents.coder === 'claude', 'defer to claude');
        assert(plan.useLocalModel === false, 'not using local');
    }
    console.log('OK 14 budget low + local not ready defers');

    // 15. confidence below threshold requires approval
    {
        const agentsLow = baseAgents();
        const claude = agentsLow.find((a: any) => a.id === 'claude');
        claude.usedToday = claude.dailyBudget;
        const config = baseConfig();
        config.minimumConfidenceForAuto = 75;
        const plan = routePlan({ taskId: 'T', description: '', state: 'created', projectPath: fx.generic }, agentsLow, config);
        assert(plan.confidence < 75, `confidence should be low, got ${plan.confidence}`);
        assert(plan.needsHumanApproval === true, 'needs approval');
        assert(plan.reasonCodes.includes('LOW_CONFIDENCE'), 'low confidence reason');
    }
    console.log('OK 15 low confidence requires approval');

    // 16. deterministic
    {
        const task = { taskId: 'T', description: 'implement feature', state: 'created', projectPath: fx.node };
        const a = routePlan(task, baseAgents(), baseConfig());
        const b = routePlan(task, baseAgents(), baseConfig());
        delete a.createdAt;
        delete b.createdAt;
        assert(JSON.stringify(a) === JSON.stringify(b), 'route should be deterministic');
    }
    console.log('OK 16 deterministic');

    // 17. pure / no file writes
    {
        const before = fs.existsSync(FIXTURES) ? countFiles(FIXTURES) : 0;
        routePlan({ taskId: 'PURE', description: 'implement feature', state: 'created', projectPath: fx.node }, baseAgents(), baseConfig());
        const after = countFiles(FIXTURES);
        assert(before === after, 'route must not write files');
        assert(!fs.existsSync(path.join(ROOT, 'workflow', 'agentbridge', 'route-plans', 'PURE.json')), 'route must not persist plan file');
    }
    console.log('OK 17 pure / no file writes');

    // 18. learning records but does not influence by default
    {
        const taskId = 'ROUTERLEARN';
        relay.store.recordOutcome({ agentId: 'claude', role: 'coder', projectType: 'node', taskType: 'code', success: false, loopCount: 3, buildResult: 'FAIL', createdAt: new Date().toISOString() });
        const stats = relay.store.getAgentStats();
        assert(stats.length > 0, 'stats recorded');
        const config = baseConfig();
        assert(config.learningInfluenceEnabled === false, 'learning influence off by default');
        const withStats = router.route({ taskId, description: 'implement feature', state: 'created', projectPath: fx.node }, {
            agents: baseAgents(), registryConfig: config, codexConfig: { codexBuildCommand: '' }, stats, now: 1782500000000
        });
        const noStats = router.route({ taskId, description: 'implement feature', state: 'created', projectPath: fx.node }, {
            agents: baseAgents(), registryConfig: config, codexConfig: { codexBuildCommand: '' }, stats: [], now: 1782500000000
        });
        delete withStats.createdAt;
        delete noStats.createdAt;
        assert(JSON.stringify(withStats) === JSON.stringify(noStats), 'learning must not influence routing by default');
    }
    console.log('OK 18 learning records but does not influence');

    // build command source
    {
        const fromConfig = routePlan({ taskId: 'T', description: 'implement', state: 'created', projectPath: fx.node }, baseAgents(), baseConfig(), { codexBuildCommand: 'npm run build' });
        assert(fromConfig.buildCommandSource === 'config', 'build from config');
        const fromDetector = routePlan({ taskId: 'T', description: 'implement', state: 'created', projectPath: fx.node }, baseAgents(), baseConfig(), { codexBuildCommand: '' });
        assert(fromDetector.buildCommandSource === 'detector', 'build from detector');
        const none = routePlan({ taskId: 'T', description: 'implement', state: 'created', projectPath: fx.generic }, baseAgents(), baseConfig(), { codexBuildCommand: '' });
        assert(none.buildCommandSource === 'none', 'build none');
    }
    console.log('OK build command source');

    // V1.2 — registry validation rejects malformed entries
    {
        const agents = relay.registry.loadAgents();
        for (const agent of agents) {
            const errors = relay.validateAgentEntry(agent);
            assert(errors.length === 0, `default agent ${agent.id} must pass validation, got: ${errors.join(', ')}`);
        }
        const badErrors = relay.validateAgentEntry({ id: '', displayName: 'Bad', roles: [], ready: 'yes', priority: null });
        assert(badErrors.length > 0, 'malformed entry must fail validation');
    }
    console.log('OK V1.2 registry validation rejects malformed entries');

    // V1.2 — workshop absent from default registry
    {
        const agents = relay.registry.loadAgents();
        assert(!agents.some((a: any) => a.id === 'workshop'), 'workshop must not be in default registry');
    }
    console.log('OK V1.2 workshop absent from default registry');

    // V1.2 — local model ready:false by default
    {
        const agents = relay.registry.loadAgents();
        const local = agents.find((a: any) => a.id === 'local');
        assert(!!local, 'local agent must exist in registry');
        assert(local.ready === false, 'local model must have ready:false by default');
    }
    console.log('OK V1.2 local model ready:false');

    // V1.2 — router plan CLI produces advisory shape with execution_allowed:false
    {
        let captured = '';
        const orig = process.stdout.write.bind(process.stdout);
        (process.stdout as any).write = (s: any) => { captured += String(s); return true; };
        relay.cmdRouterPlan('implement a new feature for the electron app');
        (process.stdout as any).write = orig;
        const plan = JSON.parse(captured.trim());
        assert(typeof plan.task_type === 'string', 'plan has task_type');
        assert(typeof plan.project === 'object', 'plan has project');
        assert(plan.mode.manual_default === true, 'manual_default is true');
        assert(plan.mode.auto_advisory_only === true, 'auto_advisory_only is true');
        assert(plan.agents.verifier === 'codex', 'plan verifier is codex');
        assert(Array.isArray(plan.steps) && plan.steps.length > 0, 'plan has non-empty steps');
        assert(plan.execution_allowed === false, 'execution_allowed must be false');
    }
    console.log('OK V1.2 router plan CLI shape');

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
