const store = require('./store');

const ROLES = ['PrimaryCoder', 'Reviewer', 'Verifier', 'Planner', 'Auditor', 'LocalCoder'];

const DEFAULT_AGENTS = [
    {
        id: 'claude',
        displayName: 'Claude',
        roles: ['PrimaryCoder', 'Planner'],
        languages: ['TypeScript', 'JavaScript', 'Python', 'C#', 'C++', 'Markdown'],
        gameEngines: ['Unity', 'Unreal'],
        strength: 95,
        cost: 8,
        local: false,
        premium: true,
        ready: true,
        dailyBudget: 100,
        hourlyBudget: 20,
        usedToday: 0,
        usedThisHour: 0,
        cooldownUntil: '',
        priority: 10,
        estimatedContext: 200000,
        estimatedSpeed: 5
    },
    {
        id: 'chatgpt',
        displayName: 'ChatGPT',
        roles: ['Reviewer', 'Auditor', 'Planner'],
        languages: ['TypeScript', 'JavaScript', 'Python', 'C#', 'C++', 'Markdown'],
        gameEngines: ['Unity', 'Unreal'],
        strength: 92,
        cost: 7,
        local: false,
        premium: true,
        ready: true,
        dailyBudget: 100,
        hourlyBudget: 20,
        usedToday: 0,
        usedThisHour: 0,
        cooldownUntil: '',
        priority: 9,
        estimatedContext: 128000,
        estimatedSpeed: 6
    },
    {
        id: 'codex',
        displayName: 'Codex',
        roles: ['Verifier'],
        languages: ['TypeScript', 'JavaScript', 'Python', 'C#', 'C++', 'Markdown'],
        gameEngines: ['Unity', 'Unreal'],
        strength: 90,
        cost: 5,
        local: false,
        premium: false,
        ready: true,
        dailyBudget: 200,
        hourlyBudget: 40,
        usedToday: 0,
        usedThisHour: 0,
        cooldownUntil: '',
        priority: 8,
        estimatedContext: 128000,
        estimatedSpeed: 7
    },
    {
        id: 'local',
        displayName: 'Local Model',
        roles: ['LocalCoder', 'PrimaryCoder'],
        languages: ['TypeScript', 'JavaScript', 'Python', 'C#'],
        gameEngines: ['Unity'],
        strength: 70,
        cost: 1,
        local: true,
        premium: false,
        ready: false,
        dailyBudget: 1000,
        hourlyBudget: 200,
        usedToday: 0,
        usedThisHour: 0,
        cooldownUntil: '',
        priority: 5,
        estimatedContext: 32000,
        estimatedSpeed: 3
    }
];

const DEFAULT_REGISTRY_CONFIG = {
    roleBindings: {
        PrimaryCoder: 'claude',
        Reviewer: 'chatgpt',
        Verifier: 'codex',
        Planner: 'claude',
        Auditor: 'chatgpt',
        LocalCoder: 'local'
    },
    routerMode: 'manual',
    learningInfluenceEnabled: false,
    preferLocalWhenOverBudget: true,
    minimumConfidenceForAuto: 75
};

function seed() {
    if (store.getJson('agents', null) === null) {
        store.setJson('agents', DEFAULT_AGENTS);
    }
    if (store.getJson('registryConfig', null) === null) {
        store.setJson('registryConfig', DEFAULT_REGISTRY_CONFIG);
    }
}

function loadAgents() {
    seed();
    return store.getJson('agents', DEFAULT_AGENTS);
}

function saveAgents(agents) {
    store.setJson('agents', agents);
}

function getRegistryConfig() {
    seed();
    const stored = store.getJson('registryConfig', {});
    return {
        ...DEFAULT_REGISTRY_CONFIG,
        ...stored,
        roleBindings: { ...DEFAULT_REGISTRY_CONFIG.roleBindings, ...(stored.roleBindings || {}) }
    };
}

function setRegistryConfig(config) {
    store.setJson('registryConfig', config);
}

function getAgent(id, agents) {
    const list = agents || loadAgents();
    return list.find((agent) => agent.id === id) || null;
}

function getRoleBinding(role, config) {
    const cfg = config || getRegistryConfig();
    return cfg.roleBindings[role] || null;
}

function setRoleBinding(role, agentId) {
    if (role === 'Verifier' && agentId !== 'codex') {
        throw new Error('Verifier is locked to codex in V1.2');
    }
    const config = getRegistryConfig();
    config.roleBindings[role] = agentId;
    setRegistryConfig(config);
    return config;
}

function findCandidates(role, agents) {
    const list = agents || loadAgents();
    return list.filter((agent) => Array.isArray(agent.roles) && agent.roles.includes(role));
}

module.exports = {
    ROLES,
    DEFAULT_AGENTS,
    DEFAULT_REGISTRY_CONFIG,
    seed,
    loadAgents,
    saveAgents,
    getRegistryConfig,
    setRegistryConfig,
    getAgent,
    getRoleBinding,
    setRoleBinding,
    findCandidates
};
