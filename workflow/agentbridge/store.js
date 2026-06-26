const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = path.join(process.cwd(), 'workflow', 'agentbridge');
const DB_PATH = path.join(WORKFLOW_DIR, 'agentbridge.db');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');

let db = null;
let useSqlite = false;

const CODEX_CONFIG_DEFAULTS = {
    codexBuildCommand: '',
    codexBuildTimeoutMs: 120000,
    allowCodexCommandExecution: false
};

function initStore() {
    fs.mkdirSync(WORKFLOW_DIR, { recursive: true });

    try {
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                task_id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
        `);
        useSqlite = true;
    } catch {
        useSqlite = false;
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify({ activeTaskId: null, nextTaskId: 0, tasks: {} }, null, 2));
        }
    }

    seedCodexConfigDefaults();
}

function seedCodexConfigDefaults() {
    for (const [key, value] of Object.entries(CODEX_CONFIG_DEFAULTS)) {
        if (getConfig(key) === null) {
            setConfig(key, String(value));
        }
    }
}

function readJsonConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { activeTaskId: null, nextTaskId: 0, tasks: {} };
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeJsonConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig(key) {
    if (useSqlite) {
        const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
        return row ? row.value : null;
    }
    const config = readJsonConfig();
    return config[key] ?? null;
}

function setConfig(key, value) {
    if (useSqlite) {
        db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, value);
        return;
    }
    const config = readJsonConfig();
    config[key] = value;
    writeJsonConfig(config);
}

function getActiveTaskId() {
    return getConfig('activeTaskId');
}

function setActiveTaskId(taskId) {
    setConfig('activeTaskId', taskId);
}

function getNextTaskIdCounter() {
    const raw = getConfig('nextTaskId');
    return raw ? parseInt(raw, 10) : 0;
}

function setNextTaskIdCounter(value) {
    setConfig('nextTaskId', String(value));
}

function loadAllTasks() {
    if (useSqlite) {
        const rows = db.prepare('SELECT task_id, data FROM tasks').all();
        const tasks = new Map();
        for (const row of rows) {
            tasks.set(row.task_id, JSON.parse(row.data));
        }
        return tasks;
    }
    const config = readJsonConfig();
    const tasks = new Map();
    for (const [taskId, data] of Object.entries(config.tasks || {})) {
        tasks.set(taskId, data);
    }
    return tasks;
}

function saveTask(taskId, taskData) {
    const serialized = JSON.stringify(taskData);
    if (useSqlite) {
        db.prepare('INSERT INTO tasks (task_id, data) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET data = excluded.data')
            .run(taskId, serialized);
        return;
    }
    const config = readJsonConfig();
    if (!config.tasks) {
        config.tasks = {};
    }
    config.tasks[taskId] = taskData;
    writeJsonConfig(config);
}

function getCodexConfig() {
    const timeoutRaw = getConfig('codexBuildTimeoutMs');
    return {
        codexBuildCommand: getConfig('codexBuildCommand') || '',
        codexBuildTimeoutMs: timeoutRaw ? parseInt(timeoutRaw, 10) : CODEX_CONFIG_DEFAULTS.codexBuildTimeoutMs,
        allowCodexCommandExecution: getConfig('allowCodexCommandExecution') === 'true'
    };
}

function setCodexConfig(partial) {
    if (partial.codexBuildCommand !== undefined) {
        setConfig('codexBuildCommand', String(partial.codexBuildCommand));
    }
    if (partial.codexBuildTimeoutMs !== undefined) {
        setConfig('codexBuildTimeoutMs', String(partial.codexBuildTimeoutMs));
    }
    if (partial.allowCodexCommandExecution !== undefined) {
        setConfig('allowCodexCommandExecution', String(Boolean(partial.allowCodexCommandExecution)));
    }
}

module.exports = {
    initStore,
    getConfig,
    setConfig,
    getActiveTaskId,
    setActiveTaskId,
    getNextTaskIdCounter,
    setNextTaskIdCounter,
    loadAllTasks,
    saveTask,
    getCodexConfig,
    setCodexConfig,
    useSqlite: () => useSqlite
};
