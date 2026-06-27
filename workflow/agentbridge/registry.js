const store = require('./store');

// V1.2 registry-first design.
// Agents are data records. The router selects agents by role/priority/allowedTaskTypes
// from this data only, so a new agent can be added without changing router logic.

const AGENTS_KEY = 'registry.agents.v12';
const CONFIG_KEY = 'registry.config.v12';

const DEFAULT_AGENTS = [
    {
        id: 'claude',
        displayName: 'Claude',
        role: 'primary',
        capabilities: ['implementation', 'planning', 'fix'],
        allowedTaskTypes: ['implementation', 'fix', 'documentation', 'unknown'],
        canVerify: false,
        canExecute: false,
        enabled: true,
        ready: true,
        priority: 100
    },
    {
        id: 'chatgpt',
        displayName: 'ChatGPT',
        role: 'reviewer',
        capabilities: ['review', 'critique', 'advisory'],
        allowedTaskTypes: ['review', 'documentation', 'implementation', 'unknown'],
        canVerify: false,
        canExecute: false,
        enabled: true,
        ready: true,
        priority: 90
    },
    {
        id: 'codex',
        displayName: 'Codex',
        role: 'verifier',
        capabilities: ['verification', 'build', 'test'],
        allowedTaskTypes: ['verification', 'test', 'packaging'],
        canVerify: true,
        canExecute: false,
        enabled: true,
        ready: true,
        priority: 80
    },
    {
        id: 'local',
        displayName: 'Local Model',
        role: 'primary',
        capabilities: ['implementation'],
        allowedTaskTypes: ['implementation', 'fix'],
        canVerify: false,
        canExecute: false,
        enabled: false,
        ready: false,
        priority: 10
    }
];

const DEFAULT_CONFIG = {
    manual_default: true,
    auto_advisory_only: true,
    locked_verifier: 'codex',
    learning: {
        enabled: true,
        influence_routing: false
    },
    local_model: {
        enabled: false,
        ready: false
    }
};

const REQUIRED_STRING_FIELDS = ['id', 'displayName', 'role'];
const REQUIRED_ARRAY_FIELDS = ['capabilities', 'allowedTaskTypes'];
const REQUIRED_BOOLEAN_FIELDS = ['canVerify', 'canExecute', 'enabled'];

function seed() {
    if (store.getJson(AGENTS_KEY, null) === null) {
        store.setJson(AGENTS_KEY, DEFAULT_AGENTS);
    }
    if (store.getJson(CONFIG_KEY, null) === null) {
        store.setJson(CONFIG_KEY, DEFAULT_CONFIG);
    }
}

function loadAgents() {
    seed();
    return store.getJson(AGENTS_KEY, DEFAULT_AGENTS);
}

function saveAgents(agents) {
    store.setJson(AGENTS_KEY, agents);
}

function getRouterConfig() {
    seed();
    const stored = store.getJson(CONFIG_KEY, {});
    return {
        ...DEFAULT_CONFIG,
        ...stored,
        learning: { ...DEFAULT_CONFIG.learning, ...(stored.learning || {}) },
        local_model: { ...DEFAULT_CONFIG.local_model, ...(stored.local_model || {}) }
    };
}

function setRouterConfig(config) {
    store.setJson(CONFIG_KEY, config);
}

function getAgent(id, agents) {
    const list = agents || loadAgents();
    return list.find((agent) => agent.id === id) || null;
}

// Enabled agents advertising the given role, sorted deterministically:
// highest priority first, ties broken by id ascending.
function agentsByRole(role, agents) {
    const list = agents || loadAgents();
    return list
        .filter((agent) => agent.enabled && agent.role === role)
        .sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
}

function validateAgentEntry(agent, index) {
    const errors = [];
    const label = (agent && agent.id) ? agent.id : `entry[${index}]`;

    if (!agent || typeof agent !== 'object') {
        return [`${label}: not an object`];
    }
    for (const field of REQUIRED_STRING_FIELDS) {
        if (typeof agent[field] !== 'string' || !agent[field].trim()) {
            errors.push(`${label}: ${field} must be a non-empty string`);
        }
    }
    for (const field of REQUIRED_ARRAY_FIELDS) {
        if (!Array.isArray(agent[field])) {
            errors.push(`${label}: ${field} must be an array`);
        }
    }
    for (const field of REQUIRED_BOOLEAN_FIELDS) {
        if (typeof agent[field] !== 'boolean') {
            errors.push(`${label}: ${field} must be a boolean`);
        }
    }
    if (typeof agent.priority !== 'number' || Number.isNaN(agent.priority)) {
        errors.push(`${label}: priority must be a number`);
    }
    return errors;
}

// Validates the whole registry. Returns { ok, errors }.
function validateRegistry(agents, config) {
    const list = agents || loadAgents();
    const cfg = config || getRouterConfig();
    const errors = [];

    if (!Array.isArray(list) || list.length === 0) {
        return { ok: false, errors: ['registry must contain at least one agent'] };
    }

    const seenIds = new Set();
    for (let i = 0; i < list.length; i += 1) {
        const agent = list[i];
        errors.push(...validateAgentEntry(agent, i));
        if (agent && agent.id) {
            if (seenIds.has(agent.id)) {
                errors.push(`duplicate agent id: ${agent.id}`);
            }
            seenIds.add(agent.id);
        }
    }

    // Workshop must never be an active/enabled agent.
    const workshop = list.find((agent) => agent && agent.id === 'workshop');
    if (workshop && workshop.enabled) {
        errors.push('workshop must not be an enabled agent (removed/rejected)');
    }

    // Codex is the locked verifier.
    const verifiers = list.filter((agent) => agent && agent.enabled && agent.canVerify);
    if (verifiers.length === 0) {
        errors.push('no enabled verifier agent found');
    }
    if (verifiers.length > 1) {
        errors.push(`only one verifier allowed, found: ${verifiers.map((a) => a.id).join(', ')}`);
    }
    if (verifiers.length === 1 && verifiers[0].id !== cfg.locked_verifier) {
        errors.push(`verifier must be the locked verifier "${cfg.locked_verifier}", found "${verifiers[0].id}"`);
    }
    if (cfg.locked_verifier !== 'codex') {
        errors.push('locked_verifier must remain codex in V1.2');
    }

    // At least one enabled primary so the router can recommend a coder.
    if (agentsByRole('primary', list).length === 0) {
        errors.push('no enabled primary agent found');
    }

    return { ok: errors.length === 0, errors };
}

module.exports = {
    AGENTS_KEY,
    CONFIG_KEY,
    DEFAULT_AGENTS,
    DEFAULT_CONFIG,
    seed,
    loadAgents,
    saveAgents,
    getRouterConfig,
    setRouterConfig,
    getAgent,
    agentsByRole,
    validateAgentEntry,
    validateRegistry
};
