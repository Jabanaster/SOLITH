const fs = require('fs');
const path = require('path');

const RISK_PATTERNS = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/s\b/i,
    /\brmdir\s+\/s\b/i,
    /Remove-Item\s+-Recurse/i,
    /\bgit\s+push\b/i,
    /\bnpm\s+install\b/i,
    /\bpnpm\s+add\b/i,
    /\byarn\s+add\b/i,
    /\bpip\s+install\b/i,
    /\bedit\s+\.env\b/i,
    /\bsecrets?\b/i
];

function exists(projectPath, rel) {
    try {
        return fs.existsSync(path.join(projectPath, rel));
    } catch {
        return false;
    }
}

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

function hasUprojectFile(projectPath) {
    try {
        return fs.readdirSync(projectPath).some((file) => file.endsWith('.uproject'));
    } catch {
        return false;
    }
}

function detectProject(projectPath) {
    const profile = {
        type: 'generic',
        languages: [],
        gameEngine: 'none',
        frameworks: [],
        contextSize: 'small',
        hasTests: false,
        suggestedBuildCommand: '',
        markers: []
    };

    if (!projectPath || !fs.existsSync(projectPath)) {
        return profile;
    }

    const pkg = readPackageJson(projectPath);
    const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
    const scripts = pkg ? pkg.scripts || {} : {};

    // Unity
    if (exists(projectPath, 'Assets') && exists(projectPath, 'ProjectSettings')) {
        profile.type = 'unity';
        profile.gameEngine = 'Unity';
        profile.languages = ['C#'];
        profile.markers.push('Assets/', 'ProjectSettings/');
        if (exists(projectPath, 'Packages/manifest.json')) {
            profile.markers.push('Packages/manifest.json');
        }
        return profile;
    }

    // Unreal
    if (hasUprojectFile(projectPath) || (exists(projectPath, 'Source') && exists(projectPath, 'Config') && exists(projectPath, 'Content'))) {
        profile.type = 'unreal';
        profile.gameEngine = 'Unreal';
        profile.languages = ['C++'];
        profile.markers.push('*.uproject', 'Source/', 'Config/', 'Content/');
        return profile;
    }

    // Electron
    if (pkg && deps.electron) {
        profile.type = 'electron';
        profile.languages = ['TypeScript', 'JavaScript'];
        profile.frameworks.push('electron');
        profile.markers.push('package.json', 'electron');
        profile.hasTests = Boolean(scripts.test);
        profile.suggestedBuildCommand = scripts.build ? 'npm run build' : (scripts.test ? 'npm test' : '');
        return profile;
    }

    // Node / Vite / React
    if (pkg) {
        profile.type = 'node';
        profile.languages = ['TypeScript', 'JavaScript'];
        profile.markers.push('package.json');
        if (deps.vite) {
            profile.frameworks.push('vite');
        }
        if (deps.react) {
            profile.frameworks.push('react');
        }
        profile.hasTests = Boolean(scripts.test);
        profile.suggestedBuildCommand = scripts.build ? 'npm run build' : (scripts.test ? 'npm test' : '');
        return profile;
    }

    // Python / FastAPI
    const hasPyproject = exists(projectPath, 'pyproject.toml');
    const hasRequirements = exists(projectPath, 'requirements.txt');
    const hasMain = exists(projectPath, 'main.py');
    if (hasPyproject || hasRequirements || hasMain) {
        profile.type = 'python';
        profile.languages = ['Python'];
        if (hasPyproject) {
            profile.markers.push('pyproject.toml');
        }
        if (hasRequirements) {
            profile.markers.push('requirements.txt');
        }
        if (hasMain) {
            profile.markers.push('main.py');
        }
        let reqText = '';
        if (hasRequirements) {
            try {
                reqText = fs.readFileSync(path.join(projectPath, 'requirements.txt'), 'utf8');
            } catch {
                reqText = '';
            }
        }
        if (/fastapi/i.test(reqText)) {
            profile.frameworks.push('fastapi');
        }
        profile.hasTests = exists(projectPath, 'tests');
        profile.suggestedBuildCommand = profile.hasTests ? 'pytest' : '';
        return profile;
    }

    return profile;
}

function getTaskText(task) {
    const parts = [];
    if (task.description) {
        parts.push(task.description);
    }
    if (task.promptText) {
        parts.push(task.promptText);
    }
    if (Array.isArray(task.claudeOutputs)) {
        parts.push(task.claudeOutputs.join('\n'));
    }
    return parts.join('\n');
}

function classifyTask(task) {
    const text = getTaskText(task);
    const lower = text.toLowerCase();
    const signals = [];
    const riskFlags = [];

    for (const pattern of RISK_PATTERNS) {
        if (pattern.test(text)) {
            riskFlags.push(pattern.source);
        }
    }

    let cls = 'unknown';

    const has = (re) => {
        if (re.test(lower)) {
            signals.push(re.source);
            return true;
        }
        return false;
    };

    if (task.state === 'waiting_claude_fix') {
        signals.push('state:waiting_claude_fix');
        cls = 'fix';
    } else if (has(/\b(security|vulnerability|cve|injection|xss|csrf|exploit|secret)\b/)) {
        cls = 'security';
    } else if (has(/\b(review|audit|inspect|critique)\b/)) {
        cls = 'review_only';
    } else if (has(/\b(build|compile|run tests|verify|typecheck)\b/)) {
        cls = 'build_only';
    } else if (has(/\b(readme|documentation|\bdocs\b|comment|changelog)\b/)) {
        cls = 'docs';
    } else if (has(/\b(config|settings|yaml|\.env|tsconfig|eslint)\b/)) {
        cls = 'config';
    } else if (has(/\b(fix|bug|error|broken|repair|crash|regression)\b/)) {
        cls = 'fix';
    } else if (has(/\b(rename|typo|bump|whitespace|trivial)\b/)) {
        cls = 'trivial';
    } else if (has(/\b(implement|add|create|feature|write|build feature|refactor)\b/)) {
        cls = 'code';
    } else if (text.trim().length === 0) {
        cls = 'unknown';
    }

    const sizeHint = text.length > 600 || /\bmultiple files\b/i.test(text) ? 'large' : 'small';

    return { class: cls, sizeHint, signals, riskFlags };
}

function agentAvailable(agent, nowMs) {
    if (!agent || !agent.ready) {
        return false;
    }
    if (typeof agent.usedToday === 'number' && agent.usedToday >= agent.dailyBudget) {
        return false;
    }
    if (typeof agent.usedThisHour === 'number' && agent.usedThisHour >= agent.hourlyBudget) {
        return false;
    }
    if (agent.cooldownUntil && Date.parse(agent.cooldownUntil) > nowMs) {
        return false;
    }
    return true;
}

function getAgent(agents, id) {
    return agents.find((agent) => agent.id === id) || null;
}

function route(task, deps) {
    const agents = deps.agents;
    const registryConfig = deps.registryConfig;
    const codexConfig = deps.codexConfig || { codexBuildCommand: '' };
    const now = deps.now || Date.now();
    const projectProfile = deps.projectProfile || detectProject(task.projectPath);
    const classification = deps.classification || classifyTask(task);
    const bindings = registryConfig.roleBindings;
    const mode = registryConfig.routerMode || 'manual';
    const reasonCodes = ['REGISTRY_ROLE_BOUND'];

    const hasRisk = classification.riskFlags.length > 0;

    // Verifier — always codex (locked)
    const verifierAgent = 'codex';
    reasonCodes.push('VERIFIER_CODEX');

    // Coder
    const boundCoderId = bindings.PrimaryCoder;
    const localId = bindings.LocalCoder;
    const boundCoder = getAgent(agents, boundCoderId);
    const localAgent = getAgent(agents, localId);

    let effectiveCoderId = boundCoderId;
    let allowPremium = true;
    let useLocalModel = false;
    reasonCodes.push('PRIMARY_CODER_BOUND');

    if (hasRisk) {
        effectiveCoderId = boundCoderId;
        allowPremium = true;
        useLocalModel = false;
        reasonCodes.push('SAFETY_FORCE_REVIEW');
    } else if (boundCoder && boundCoder.premium && !agentAvailable(boundCoder, now)) {
        allowPremium = false;
        reasonCodes.push('BUDGET_LOW');
        if (registryConfig.preferLocalWhenOverBudget && localAgent && localAgent.ready) {
            useLocalModel = true;
            effectiveCoderId = localId;
            reasonCodes.push('LOCAL_FALLBACK_RECOMMENDED');
        } else {
            effectiveCoderId = boundCoderId;
            reasonCodes.push('LOCAL_DEFERRED');
        }
    } else {
        reasonCodes.push('BUDGET_OK');
    }

    // Reviewer
    const boundReviewerId = bindings.Reviewer;
    let reviewerEffective = boundReviewerId;
    if (hasRisk) {
        reviewerEffective = boundReviewerId;
        reasonCodes.push('REVIEW_FORCED_RISK');
    } else if (mode === 'manual') {
        reviewerEffective = boundReviewerId;
        reasonCodes.push('REVIEW_MANUAL_DEFAULT');
    } else if (classification.class === 'trivial') {
        reviewerEffective = 'skip';
        reasonCodes.push('REVIEW_SKIP_TRIVIAL');
    } else if (classification.class === 'build_only') {
        reviewerEffective = 'skip';
        reasonCodes.push('REVIEW_SKIP_BUILD_ONLY');
    } else {
        reviewerEffective = boundReviewerId;
        reasonCodes.push('REVIEW_REQUIRED');
    }

    // Build command source
    let buildCommandSource = 'none';
    let buildCommandPreview = '';
    if (codexConfig.codexBuildCommand) {
        buildCommandSource = 'config';
        buildCommandPreview = codexConfig.codexBuildCommand;
        reasonCodes.push('BUILD_FROM_CONFIG');
    } else if (projectProfile.suggestedBuildCommand) {
        buildCommandSource = 'detector';
        buildCommandPreview = projectProfile.suggestedBuildCommand;
        reasonCodes.push('BUILD_FROM_DETECTOR');
    } else {
        reasonCodes.push('BUILD_NONE');
    }

    // Confidence
    let confidence = 100;
    if (classification.class === 'unknown') {
        confidence -= 25;
    }
    if (projectProfile.type === 'generic') {
        confidence -= 10;
    }
    if (allowPremium === false) {
        confidence -= 20;
    }
    if (reasonCodes.includes('LOCAL_DEFERRED')) {
        confidence -= 15;
    }
    if (useLocalModel) {
        confidence -= 10;
    }
    if (confidence < 0) {
        confidence = 0;
    }

    const minConfidence = registryConfig.minimumConfidenceForAuto || 75;
    const needsHumanApproval = confidence < minConfidence;
    if (needsHumanApproval) {
        reasonCodes.push('LOW_CONFIDENCE');
    }

    return {
        taskId: task.taskId || null,
        mode,
        roles: {
            coder: 'PrimaryCoder',
            reviewer: 'Reviewer',
            verifier: 'Verifier'
        },
        agents: {
            coder: boundCoderId,
            reviewer: boundReviewerId,
            verifier: 'codex'
        },
        effectiveAgents: {
            coder: effectiveCoderId,
            reviewer: reviewerEffective,
            verifier: verifierAgent
        },
        projectProfile,
        taskClassification: classification,
        allowPremium,
        useLocalModel,
        confidence,
        needsHumanApproval,
        reasonCodes,
        buildCommandSource,
        buildCommandPreview,
        createdAt: new Date(now).toISOString()
    };
}

module.exports = {
    RISK_PATTERNS,
    detectProject,
    classifyTask,
    agentAvailable,
    route
};
