const fs = require('fs');
const path = require('path');

// V1.2 deterministic, advisory-only router.
// route(task) -> plan. Pure: no execution, no relay state mutation, no agent calls.

const TASK_TYPES = ['implementation', 'review', 'verification', 'test', 'packaging', 'documentation', 'unknown'];

function readPackageJson(projectPath) {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
        return null;
    }
}

function exists(projectPath, rel) {
    try {
        return fs.existsSync(path.join(projectPath, rel));
    } catch {
        return false;
    }
}

// Deterministic, no external calls. Returns a normalized project profile.
function detectProject(projectPath) {
    const profile = {
        project_type: 'unknown',
        has_package_json: false,
        has_electron: false,
        has_tests: false,
        has_build_script: false
    };

    if (!projectPath || !fs.existsSync(projectPath)) {
        return profile;
    }

    const pkg = readPackageJson(projectPath);
    if (pkg) {
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const scripts = pkg.scripts || {};
        profile.has_package_json = true;
        profile.has_electron = Boolean(deps.electron);
        profile.has_build_script = Boolean(scripts.build);
        profile.has_tests = Boolean(scripts.test) || exists(projectPath, 'test') || exists(projectPath, 'tests');
        profile.project_type = profile.has_electron ? 'electron-node' : 'node';
        return profile;
    }

    if (exists(projectPath, 'Assets') && exists(projectPath, 'ProjectSettings')) {
        profile.project_type = 'unity';
        return profile;
    }

    if (exists(projectPath, 'pyproject.toml') || exists(projectPath, 'requirements.txt') || exists(projectPath, 'main.py')) {
        profile.project_type = 'python';
        profile.has_tests = exists(projectPath, 'tests');
        return profile;
    }

    profile.project_type = 'generic';
    return profile;
}

// Deterministic keyword/rule-based task classifier. Returns a category string.
function classifyTask(description) {
    const text = (typeof description === 'string' ? description : (description && description.description) || '').toLowerCase();

    if (!text.trim()) {
        return 'unknown';
    }

    const matches = (re) => re.test(text);

    if (matches(/\b(review|critique|audit|feedback|inspect)\b/)) {
        return 'review';
    }
    if (matches(/\b(package|packaging|installer|electron-builder|nsis|\.dmg|\.msi|release build|bundle)\b/)) {
        return 'packaging';
    }
    if (matches(/\b(verify|verification|validate|smoke check|build passes)\b/)) {
        return 'verification';
    }
    if (matches(/\b(test|unit test|integration test|jest|vitest|mocha|pytest|coverage)\b/)) {
        return 'test';
    }
    if (matches(/\b(doc|docs|documentation|readme|changelog|comment)\b/)) {
        return 'documentation';
    }
    if (matches(/\b(implement|implementation|add|create|feature|build|write|fix|bug|refactor|repair|error)\b/)) {
        return 'implementation';
    }
    return 'unknown';
}

function pickAgent(role, taskType, agents) {
    const candidates = agents
        .filter((agent) => agent.enabled && agent.role === role)
        .sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));

    if (candidates.length === 0) {
        return null;
    }
    const preferred = candidates.find((agent) => Array.isArray(agent.allowedTaskTypes) && agent.allowedTaskTypes.includes(taskType));
    return preferred || candidates[0];
}

function pickVerifier(lockedVerifierId, agents) {
    const locked = agents.find((agent) => agent.enabled && agent.canVerify && agent.id === lockedVerifierId);
    if (locked) {
        return locked;
    }
    return agents.find((agent) => agent.enabled && agent.canVerify) || null;
}

// route(task) -> plan. Advisory only. Deterministic.
// task: string | { description, projectPath }
// deps: { agents, routerConfig, projectProfile?, classification? }
function route(task, deps) {
    const description = typeof task === 'string' ? task : (task && task.description) || '';
    const projectPath = (typeof task === 'object' && task && task.projectPath) || (deps && deps.projectPath) || process.cwd();

    const agents = deps.agents;
    const config = deps.routerConfig;
    const projectProfile = deps.projectProfile || detectProject(projectPath);
    const taskType = deps.classification || classifyTask(description);

    const primary = pickAgent('primary', taskType, agents);
    const reviewer = pickAgent('reviewer', taskType, agents);
    const verifier = pickVerifier(config.locked_verifier, agents);

    const primaryId = primary ? primary.id : null;
    const reviewerId = reviewer ? reviewer.id : null;
    const verifierId = verifier ? verifier.id : config.locked_verifier;

    const primaryName = primary ? primary.displayName : 'Primary agent';
    const reviewerName = reviewer ? reviewer.displayName : 'Reviewer agent';
    const verifierName = verifier ? verifier.displayName : 'Verifier agent';

    const steps = [
        `${primaryName} proposes or implements the change`,
        `${reviewerName} reviews the result`,
        `${verifierName} verifies with tests/build`,
        'Human approves final acceptance'
    ];

    const reason = `task_type=${taskType}; primary=${primaryId} (role primary), reviewer=${reviewerId} (role reviewer), verifier=${verifierId} (locked). Advisory only; execution_allowed=false.`;

    return {
        task_type: taskType,
        project: projectProfile,
        mode: {
            manual_default: config.manual_default === true,
            auto_advisory_only: config.auto_advisory_only !== false
        },
        agents: {
            primary: primaryId,
            reviewer: reviewerId,
            verifier: verifierId
        },
        locked_verifier: config.locked_verifier,
        reason,
        steps,
        execution_allowed: false
    };
}

module.exports = {
    TASK_TYPES,
    detectProject,
    classifyTask,
    route
};
