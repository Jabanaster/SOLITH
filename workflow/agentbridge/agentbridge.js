const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const store = require('./store');
const registry = require('./registry');
const router = require('./router');

const PROJECT_ROOT = process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, 'workflow', 'agentbridge');
const PROMPTS_DIR = path.join(WORKFLOW_DIR, 'prompts');
const OUTPUT_DIR = path.join(WORKFLOW_DIR, 'output');
const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'templates');
const CODEX_INPUT_DIR = path.join(PROJECT_ROOT, 'agents', 'codex', 'input');
const CODEX_OUTPUT_DIR = path.join(PROJECT_ROOT, 'agents', 'codex', 'output');
const OUTPUT_CODEX_DIR = path.join(OUTPUT_DIR, 'codex');
const OUTPUT_WORKSHOP_DIR = path.join(OUTPUT_DIR, 'workshop');

let state = {
    tasks: new Map()
};

function nowIso() {
    return new Date().toISOString();
}

function defaultTask(projectPath = PROJECT_ROOT) {
    const created = nowIso();
    return {
        state: 'created',
        loopCount: 0,
        projectPath,
        currentAgent: 'claude',
        claudeOutputs: [],
        chatgptReview: null,
        codexBuildResult: null,
        lastOutput: null,
        lastOutputPath: null,
        lastBuildResult: null,
        buildResultSummary: null,
        unresolvedIssues: [],
        promptPaths: { claude: null, chatgpt: null, codex: null },
        outputPaths: { claude: [], chatgpt: [], codex: [] },
        finalReportPath: null,
        description: null,
        projectProfile: null,
        routePlan: null,
        projectId: path.basename(projectPath),
        workspaceId: 'default',
        branch: 'unknown',
        priority: 'normal',
        queue: 'default',
        createdAt: created,
        updatedAt: created
    };
}

function normalizeTask(task) {
    const skeleton = defaultTask(task.projectPath || PROJECT_ROOT);
    const merged = { ...skeleton, ...task };
    merged.promptPaths = { ...skeleton.promptPaths, ...(task.promptPaths || {}) };
    merged.outputPaths = { ...skeleton.outputPaths, ...(task.outputPaths || {}) };
    if (!Array.isArray(merged.claudeOutputs)) {
        merged.claudeOutputs = [];
    }
    if (!Array.isArray(merged.unresolvedIssues)) {
        merged.unresolvedIssues = [];
    }
    return merged;
}

function initState() {
    store.initStore();
    const loaded = store.loadAllTasks();
    const normalized = new Map();
    for (const [taskId, task] of loaded) {
        normalized.set(taskId, normalizeTask(task));
    }
    state.tasks = normalized;
}

function persistTask(taskId) {
    const task = state.tasks.get(taskId);
    if (task) {
        task.updatedAt = nowIso();
        task.currentAgent = getNextAgent(taskId);
        store.saveTask(taskId, task);
    }
}

function saveState() {
    for (const taskId of state.tasks.keys()) {
        persistTask(taskId);
    }
}

function generateTaskId() {
    const next = store.getNextTaskIdCounter() + 1;
    store.setNextTaskIdCounter(next);
    return `TASK_${String(next).padStart(3, '0')}`;
}

function ensureTask(taskId, projectPath = PROJECT_ROOT) {
    if (!state.tasks.has(taskId)) {
        state.tasks.set(taskId, defaultTask(projectPath));
        persistTask(taskId);
    }
    return state.tasks.get(taskId);
}

function getTaskState(taskId) {
    return state.tasks.get(taskId)?.state || 'created';
}

function setTaskState(taskId, newState) {
    ensureTask(taskId);
    const task = state.tasks.get(taskId);
    task.state = newState;
    persistTask(taskId);
}

function incrementLoopCount(taskId) {
    const task = ensureTask(taskId);
    task.loopCount++;
    persistTask(taskId);
}

function getLoopCount(taskId) {
    return state.tasks.get(taskId)?.loopCount || 0;
}

function taskExists(taskId) {
    return state.tasks.has(taskId);
}

function getLastBuildResult(taskId) {
    return state.tasks.get(taskId)?.lastBuildResult;
}

function setLastBuildResult(taskId, result, summary) {
    const task = ensureTask(taskId);
    task.lastBuildResult = result;
    task.codexBuildResult = result;
    if (summary !== undefined) {
        task.buildResultSummary = summary;
    } else {
        task.buildResultSummary = result;
    }
    persistTask(taskId);
}

function setLastOutput(taskId, output, outputPath) {
    const task = ensureTask(taskId);
    task.lastOutput = output;
    task.lastOutputPath = outputPath;
    persistTask(taskId);
}

function appendClaudeOutput(taskId, output) {
    const task = ensureTask(taskId);
    task.claudeOutputs.push(output);
    persistTask(taskId);
}

function setChatgptReview(taskId, review) {
    const task = ensureTask(taskId);
    task.chatgptReview = review;
    persistTask(taskId);
}

function getMaxLoops() {
    return parseInt(process.env.MAX_LOOPS || '3', 10);
}

function resolveTaskId(explicitTaskId) {
    if (explicitTaskId) {
        if (!taskExists(explicitTaskId)) {
            throw new Error(`Task not found: ${explicitTaskId}`);
        }
        return explicitTaskId;
    }

    const activeTaskId = store.getActiveTaskId();
    if (activeTaskId && taskExists(activeTaskId)) {
        return activeTaskId;
    }

    throw new Error('No taskId provided and no active task set. Use: agentbridge ingest <agent> <file> [taskId] or agentbridge create');
}

function resolveOutputDir(agent) {
    if (agent === 'codex') {
        return OUTPUT_CODEX_DIR;
    }
    return path.join(OUTPUT_DIR, agent);
}

function generatePrompt(taskId, agent, content) {
    const promptDir = path.join(PROMPTS_DIR, agent);
    const promptFile = path.join(promptDir, `${taskId}.md`);
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(promptFile, content);
    return promptFile;
}

function generateCodexPrompt(taskId) {
    const templatePath = path.join(TEMPLATE_DIR, 'codex-build.md');
    const task = ensureTask(taskId);
    let content;

    if (fs.existsSync(templatePath)) {
        content = fs.readFileSync(templatePath, 'utf8')
            .replace(/\{\{TASK_ID\}\}/g, taskId)
            .replace(/\{\{PROJECT_PATH\}\}/g, task.projectPath);
    } else {
        content = `# Codex Build — ${taskId}\n\nProject: ${task.projectPath}\n\nRun build/test. Report PASS, FAIL, or NOT_RUN.\n`;
    }

    fs.mkdirSync(CODEX_INPUT_DIR, { recursive: true });
    const codexInputFile = path.join(CODEX_INPUT_DIR, `${taskId}.md`);
    fs.writeFileSync(codexInputFile, content);

    const promptFile = path.join(PROMPTS_DIR, 'codex', `${taskId}.md`);
    fs.mkdirSync(path.dirname(promptFile), { recursive: true });
    fs.writeFileSync(promptFile, content);

    return codexInputFile;
}

function ingestFile(agent, filePath, taskId) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Output file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const outputDir = resolveOutputDir(agent);
    const outputFileName = `${taskId}_${agent}_${Date.now()}.md`;
    const outputPath = path.join(outputDir, outputFileName);

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, content);

    if (agent === 'codex') {
        fs.mkdirSync(CODEX_OUTPUT_DIR, { recursive: true });
        fs.copyFileSync(outputPath, path.join(CODEX_OUTPUT_DIR, outputFileName));
    }

    const task = ensureTask(taskId);
    if (task.outputPaths[agent]) {
        task.outputPaths[agent].push(outputPath);
    }

    setLastOutput(taskId, content, outputPath);
    return { content, outputPath };
}

function checkSafety(content) {
    const riskyPatterns = [
        /\brm\s+-rf\b/i,
        /\bdel\s+\/s\b/i,
        /\brmdir\s+\/s\b/i,
        /Remove-Item\s+-Recurse/i,
        /git\s+push\b/i,
        /npm\s+install\b/i,
        /pip\s+install\b/i,
        /\bedit\s+\.env\b/i,
        /\bdelete\s+files\b/i,
        /deleting\s+files\b/i,
        /moving\s+many\s+files\b/i
    ];

    for (const pattern of riskyPatterns) {
        if (pattern.test(content)) {
            return true;
        }
    }
    return false;
}

function parseCodexResult(content) {
    if (/\bNOT_RUN\b/i.test(content)) {
        return 'NOT_RUN';
    }
    if (/\bPASS\b/i.test(content) || /\bpassed\b/i.test(content)) {
        return 'PASS';
    }
    if (/\bFAIL\b/i.test(content) || /\bfailed\b/i.test(content)) {
        return 'FAIL';
    }
    return 'UNKNOWN';
}

function getNextStep(taskId) {
    const taskState = getTaskState(taskId);
    const nextAgent = getNextAgent(taskId);

    if (taskState === 'passed') {
        return 'Done';
    }
    if (taskState === 'stopped' || taskState === 'failed') {
        return 'Manual intervention required';
    }
    if (nextAgent) {
        return `Run ${nextAgent}, then agentbridge ingest ${nextAgent} <file>`;
    }
    return 'Run agentbridge next';
}

function writeFinalReport(taskId, reason) {
    const task = ensureTask(taskId);
    const reportFile = path.join(WORKFLOW_DIR, `FINAL_REPORT_${taskId}.md`);

    let content = `# Final Report - ${taskId}\n\n`;
    content += `## Task ID\n${taskId}\n\n`;
    content += `## Project Path\n${task.projectPath}\n\n`;
    content += `## Status\n${task.state}\n\n`;
    content += `## Reason\n${reason}\n\n`;
    content += `## Loop Count\n${task.loopCount}\n\n`;
    content += `## Claude Outputs\n`;
    if (task.claudeOutputs.length === 0) {
        content += `None\n\n`;
    } else {
        task.claudeOutputs.forEach((output, index) => {
            content += `### Claude Output ${index + 1}\n${output}\n\n`;
        });
    }
    content += `## ChatGPT Review\n${task.chatgptReview || 'None'}\n\n`;
    content += `## Codex Build Result\n${task.codexBuildResult || task.lastBuildResult || 'None'}\n\n`;
    content += `## Latest Codex Output\n${task.lastOutput || 'None'}\n\n`;
    content += `## Unresolved Issues\n`;
    if (task.unresolvedIssues.length === 0) {
        content += `None\n\n`;
    } else {
        task.unresolvedIssues.forEach((issue) => {
            content += `- ${issue}\n`;
        });
        content += '\n';
    }
    content += `## Next Step\n${getNextStep(taskId)}\n`;

    fs.writeFileSync(reportFile, content);
    task.finalReportPath = reportFile;
    store.saveTask(taskId, task);
    return reportFile;
}

// Records a learning record for a completed task. Storage only — never influences
// routing unless routerConfig.learning.influence_routing is enabled (default false).
function recordTaskOutcome(taskId, success) {
    const task = state.tasks.get(taskId);
    if (!task) {
        return;
    }
    const config = registry.getRouterConfig();
    if (!config.learning || config.learning.enabled === false) {
        return;
    }
    const taskType = router.classifyTask(task.description || '');
    store.recordOutcome({
        taskType,
        route: { primary: 'claude', reviewer: 'chatgpt', verifier: 'codex' },
        outcome: success ? 'pass' : 'fail',
        loopCount: task.loopCount,
        buildResult: task.lastBuildResult || null,
        timestamp: nowIso()
    });
}

function recordPromptPath(taskId, agent, promptPath) {
    const task = ensureTask(taskId);
    task.promptPaths[agent] = promptPath;
    persistTask(taskId);
    return promptPath;
}

function getNextPromptPath(taskId) {
    const taskState = getTaskState(taskId);

    switch (taskState) {
        case 'created':
            setTaskState(taskId, 'waiting_claude_code');
            return recordPromptPath(taskId, 'claude', generatePrompt(taskId, 'claude', `# Claude Code — ${taskId}\n\nWrite the implementation. No destructive commands. No package installs without approval.\n`));
        case 'waiting_chatgpt_review':
            return recordPromptPath(taskId, 'chatgpt', generatePrompt(taskId, 'chatgpt', `# ChatGPT Review — ${taskId}\n\nReview Claude output. Reply APPROVED or list issues.\n`));
        case 'waiting_claude_fix':
            return recordPromptPath(taskId, 'claude', generatePrompt(taskId, 'claude', `# Claude Fix — ${taskId}\n\nFix issues from review or Codex build failure.\n`));
        case 'waiting_codex_build':
            return recordPromptPath(taskId, 'codex', generateCodexPrompt(taskId));
        default:
            return null;
    }
}

function getNextAgent(taskId) {
    const taskState = getTaskState(taskId);

    switch (taskState) {
        case 'created':
        case 'waiting_claude_code':
        case 'waiting_claude_fix':
            return 'claude';
        case 'waiting_chatgpt_review':
            return 'chatgpt';
        case 'waiting_codex_build':
            return 'codex';
        default:
            return null;
    }
}

function cmdCreate(projectPath) {
    const taskId = generateTaskId();
    ensureTask(taskId, projectPath || PROJECT_ROOT);
    store.setActiveTaskId(taskId);
    console.log(`Created task: ${taskId}`);
    console.log(`Active task: ${taskId}`);
    console.log(`Project path: ${projectPath || PROJECT_ROOT}`);
    console.log(`State: ${getTaskState(taskId)}`);
}

function cmdNext(taskId) {
    if (!taskId) {
        console.log('Usage: agentbridge next <taskId>');
        return;
    }

    if (!taskExists(taskId)) {
        console.log(`Task ${taskId} does not exist`);
        return;
    }

    store.setActiveTaskId(taskId);
    const nextPromptPath = getNextPromptPath(taskId);
    if (nextPromptPath) {
        console.log(`Generated prompt: ${nextPromptPath}`);
        console.log(`State: ${getTaskState(taskId)}`);
        console.log(`Next required agent: ${getNextAgent(taskId)}`);
    } else {
        console.log('No next prompt available');
    }
}

function cmdIngest(agent, filePath, explicitTaskId) {
    if (!agent || !filePath) {
        console.log('Usage: agentbridge ingest <agent> <file> [taskId]');
        return;
    }

    if (agent === 'workshop') {
        console.log('Workshop AI removed from V1. Use: agentbridge ingest codex <file> [taskId]');
        return;
    }

    let taskId;
    try {
        taskId = resolveTaskId(explicitTaskId);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
        return;
    }

    store.setActiveTaskId(taskId);

    const { content, outputPath } = ingestFile(agent, filePath, taskId);
    console.log(`Ingested ${filePath}`);
    console.log(`Stored at ${outputPath}`);

    if (agent === 'claude') {
        if (checkSafety(content)) {
            const task = ensureTask(taskId);
            task.unresolvedIssues.push('Safety violation in Claude output');
            setTaskState(taskId, 'stopped');
            writeFinalReport(taskId, 'Safety violation detected in Claude output');
            recordTaskOutcome(taskId, false);
            console.log('SAFETY VIOLATION DETECTED!');
            console.log('Stopping task due to risky patterns in Claude output');
            return;
        }

        appendClaudeOutput(taskId, content);
        const priorState = getTaskState(taskId);
        if (priorState === 'waiting_claude_fix') {
            setTaskState(taskId, 'waiting_codex_build');
        } else {
            setTaskState(taskId, 'waiting_chatgpt_review');
        }
    } else if (agent === 'chatgpt') {
        setChatgptReview(taskId, content);
        if (/\bAPPROVED\b/i.test(content) || /\bapprove\b/i.test(content)) {
            setTaskState(taskId, 'waiting_codex_build');
        } else {
            const task = ensureTask(taskId);
            task.unresolvedIssues.push('ChatGPT review requested fixes');
            setTaskState(taskId, 'waiting_claude_fix');
        }
    } else if (agent === 'codex') {
        const result = parseCodexResult(content);
        setLastBuildResult(taskId, result);

        if (result === 'NOT_RUN') {
            const task = ensureTask(taskId);
            task.unresolvedIssues.push('Codex did not run build commands');
            setTaskState(taskId, 'stopped');
            writeFinalReport(taskId, 'Codex reported NOT_RUN — build not executed');
            recordTaskOutcome(taskId, false);
        } else if (result === 'PASS') {
            setTaskState(taskId, 'passed');
            writeFinalReport(taskId, 'Build passed successfully');
            recordTaskOutcome(taskId, true);
        } else if (result === 'FAIL') {
            incrementLoopCount(taskId);
            const task = ensureTask(taskId);
            task.unresolvedIssues.push('Codex build failed');
            const loopCount = getLoopCount(taskId);
            const maxLoops = getMaxLoops();

            if (loopCount >= maxLoops) {
                setTaskState(taskId, 'stopped');
                writeFinalReport(taskId, `Max loops (${maxLoops}) reached after Codex FAIL`);
                recordTaskOutcome(taskId, false);
            } else {
                setTaskState(taskId, 'waiting_claude_fix');
            }
        } else {
            const task = ensureTask(taskId);
            task.unresolvedIssues.push('Unknown Codex build result');
            setTaskState(taskId, 'failed');
            writeFinalReport(taskId, 'Unknown Codex build result');
            recordTaskOutcome(taskId, false);
        }
    } else {
        console.log(`Unknown agent: ${agent}`);
        process.exitCode = 1;
        return;
    }

    persistTask(taskId);
    console.log(`Task: ${taskId}`);
    console.log(`State: ${getTaskState(taskId)}`);
    console.log(`Loop count: ${getLoopCount(taskId)}`);
    console.log(`Latest Codex build result: ${getLastBuildResult(taskId) || 'None'}`);
    console.log(`Next required agent: ${getNextAgent(taskId) || 'None'}`);
}

const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/s\b/i,
    /\brmdir\s+\/s\b/i,
    /Remove-Item\s+-Recurse/i,
    /\bgit\s+push\b/i,
    /\bnpm\s+install\b/i,
    /\bpnpm\s+add\b/i,
    /\byarn\s+add\b/i,
    /\bpip\s+install\b/i,
    /curl\b[^\n]*\|\s*sh\b/i,
    /Invoke-WebRequest/i,
    /\biwr\b/i,
    /powershell\s+-enc/i
];

function isDangerousCommand(command) {
    return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function buildCodexRunContent(details) {
    const { result, command, exitCode, note, stdout, stderr } = details;
    const tail = (text) => {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return 'NONE';
        }
        const lines = trimmed.split(/\r?\n/);
        return lines.slice(-40).join('\n');
    };

    let content = `RESULT: ${result}\n\n`;
    content += `COMMAND: ${command || 'NONE'}\n\n`;
    content += `EXIT_CODE: ${exitCode === null || exitCode === undefined ? 'NONE' : exitCode}\n\n`;
    content += `NOTE: ${note || 'NONE'}\n\n`;
    content += `STDOUT:\n${tail(stdout)}\n\n`;
    content += `STDERR:\n${tail(stderr)}\n\n`;
    content += `LIKELY_CAUSE:\n${result === 'FAIL' ? (note || 'Command returned a nonzero exit code') : 'NONE'}\n`;
    return content;
}

function runCodexBuild(taskId) {
    const task = ensureTask(taskId);
    const config = store.getCodexConfig();

    let result = 'NOT_RUN';
    let executed = false;
    let blocked = false;
    let exitCode = null;
    let note = '';
    let stdout = '';
    let stderr = '';

    if (!config.allowCodexCommandExecution) {
        note = 'Codex command execution disabled (allowCodexCommandExecution=false)';
    } else if (!config.codexBuildCommand) {
        note = 'No codexBuildCommand configured';
    } else if (isDangerousCommand(config.codexBuildCommand)) {
        blocked = true;
        note = `Dangerous command blocked: ${config.codexBuildCommand}`;
    } else if (!fs.existsSync(task.projectPath)) {
        note = `Project root does not exist: ${task.projectPath}`;
    } else {
        executed = true;
        const execResult = spawnSync(config.codexBuildCommand, {
            cwd: task.projectPath,
            shell: true,
            timeout: config.codexBuildTimeoutMs,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024
        });

        stdout = execResult.stdout || '';
        stderr = execResult.stderr || '';

        if (execResult.error && execResult.error.code === 'ETIMEDOUT') {
            result = 'FAIL';
            note = `Command timed out after ${config.codexBuildTimeoutMs}ms`;
        } else if (execResult.error) {
            result = 'FAIL';
            note = `Command failed to start: ${execResult.error.message}`;
        } else if (execResult.status === 0) {
            result = 'PASS';
            exitCode = 0;
        } else {
            result = 'FAIL';
            exitCode = execResult.status;
            note = `Command exited with code ${execResult.status}`;
        }
    }

    const content = buildCodexRunContent({
        result,
        command: config.codexBuildCommand,
        exitCode,
        note,
        stdout,
        stderr
    });

    fs.mkdirSync(CODEX_OUTPUT_DIR, { recursive: true });
    const runFile = path.join(CODEX_OUTPUT_DIR, `${taskId}_run_${Date.now()}.md`);
    fs.writeFileSync(runFile, content);

    return { result, executed, blocked, exitCode, note, outputPath: runFile };
}

function cmdRunCodex(explicitTaskId) {
    let taskId;
    try {
        taskId = resolveTaskId(explicitTaskId);
    } catch (error) {
        console.log('Usage: agentbridge run-codex <taskId>');
        console.error(error.message);
        process.exitCode = 1;
        return null;
    }

    store.setActiveTaskId(taskId);
    const config = store.getCodexConfig();
    console.log(`Running Codex build for ${taskId}`);
    console.log(`Command: ${config.codexBuildCommand || 'NONE'}`);
    console.log(`Execution enabled: ${config.allowCodexCommandExecution}`);

    const outcome = runCodexBuild(taskId);
    console.log(`Codex result: ${outcome.result}`);
    if (outcome.blocked) {
        console.log('Command BLOCKED by dangerous pattern guard');
    }
    if (outcome.note) {
        console.log(`Note: ${outcome.note}`);
    }
    console.log(`Codex output written: ${outcome.outputPath}`);

    cmdIngest('codex', outcome.outputPath, taskId);
    return outcome;
}

function formatTask(taskId, task) {
    return {
        taskId,
        state: task.state,
        projectPath: task.projectPath,
        createdAt: task.createdAt || 'unknown',
        updatedAt: task.updatedAt || 'unknown'
    };
}

function cmdTasks(limitArg) {
    const limit = limitArg ? parseInt(limitArg, 10) : 20;
    const entries = [...state.tasks.entries()].map(([taskId, task]) => formatTask(taskId, task));
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const recent = entries.slice(0, limit);

    console.log('\n=== AgentBridge Tasks ===');
    if (recent.length === 0) {
        console.log('No tasks yet.');
        return;
    }
    const activeTaskId = store.getActiveTaskId();
    for (const entry of recent) {
        const activeMarker = entry.taskId === activeTaskId ? ' *' : '';
        console.log(`\n${entry.taskId}${activeMarker}`);
        console.log(`  State:       ${entry.state}`);
        console.log(`  Project:     ${entry.projectPath}`);
        console.log(`  Created:     ${entry.createdAt}`);
        console.log(`  Updated:     ${entry.updatedAt}`);
    }
}

function cmdShow(explicitTaskId) {
    let taskId;
    try {
        taskId = resolveTaskId(explicitTaskId);
    } catch (error) {
        console.log('Usage: agentbridge show <taskId>');
        console.error(error.message);
        process.exitCode = 1;
        return;
    }

    const task = state.tasks.get(taskId);

    console.log(`\n=== Task ${taskId} ===`);
    console.log(`State:            ${task.state}`);
    console.log(`Project path:     ${task.projectPath}`);
    console.log(`Current step:     ${getNextStep(taskId)}`);
    console.log(`Current agent:    ${getNextAgent(taskId) || 'None'}`);
    console.log(`Loop count:       ${task.loopCount}`);
    console.log(`Created:          ${task.createdAt || 'unknown'}`);
    console.log(`Updated:          ${task.updatedAt || 'unknown'}`);
    console.log(`Build result:     ${task.buildResultSummary || task.lastBuildResult || 'None'}`);
    console.log('\nPrompt paths:');
    console.log(`  claude:   ${task.promptPaths?.claude || 'None'}`);
    console.log(`  chatgpt:  ${task.promptPaths?.chatgpt || 'None'}`);
    console.log(`  codex:    ${task.promptPaths?.codex || 'None'}`);
    console.log('\nOutput paths:');
    for (const agent of ['claude', 'chatgpt', 'codex']) {
        const paths = task.outputPaths?.[agent] || [];
        if (paths.length === 0) {
            console.log(`  ${agent}: None`);
        } else {
            console.log(`  ${agent}:`);
            paths.forEach((p) => console.log(`    - ${p}`));
        }
    }
    const reportPath = task.finalReportPath;
    if (reportPath && fs.existsSync(reportPath)) {
        console.log(`\nFinal report:     ${reportPath}`);
    } else {
        console.log(`\nFinal report:     None`);
    }

    console.log('\nAdvisory route:   run `agentbridge router plan "<task>"` (router does not mutate task state)');
}

// ── V1.2 registry-first advisory router CLI ───────────────────────────────────

// Pure helper: builds the advisory plan for a task description. No writes, no
// execution, no relay state mutation. Used by the CLI and by smoke checks.
function planTask(taskText, projectPath) {
    const agents = registry.loadAgents();
    const routerConfig = registry.getRouterConfig();
    const cwd = projectPath || process.cwd();
    const projectProfile = router.detectProject(cwd);
    const classification = router.classifyTask(taskText);

    return router.route(
        { description: taskText, projectPath: cwd },
        { agents, routerConfig, projectProfile, classification }
    );
}

function cmdRouterPlan(taskText) {
    if (!taskText || !taskText.trim()) {
        console.log('Usage: agentbridge router plan "<task description>"');
        process.exitCode = 1;
        return;
    }
    const plan = planTask(taskText);
    console.log(JSON.stringify(plan, null, 2));
}

function cmdRegistryList() {
    const agents = registry.loadAgents();
    console.log(JSON.stringify(agents, null, 2));
}

function cmdRegistryValidate() {
    const agents = registry.loadAgents();
    const config = registry.getRouterConfig();
    const result = registry.validateRegistry(agents, config);

    console.log('\n=== Registry Validation ===');
    if (result.ok) {
        console.log(`OK  ${agents.length} agent(s) valid`);
        console.log(`OK  locked verifier: ${config.locked_verifier}`);
        console.log('OK  workshop absent as enabled agent');
        console.log('\nRegistry: VALID');
    } else {
        for (const error of result.errors) {
            console.log(`FAIL ${error}`);
        }
        console.log('\nRegistry: INVALID');
        process.exitCode = 1;
    }
}

function cmdLearningList() {
    const records = store.getAgentStats();
    const config = registry.getRouterConfig();
    console.log('\n=== Learning Records ===');
    console.log(`Learning enabled:   ${config.learning.enabled}`);
    console.log(`Influence routing:  ${config.learning.influence_routing} (default false)`);
    if (records.length === 0) {
        console.log('No records yet.');
        return;
    }
    for (const record of records) {
        console.log(`  [${record.timestamp || '?'}] type=${record.taskType} outcome=${record.outcome} loops=${record.loopCount} build=${record.buildResult}`);
    }
    console.log(`\nTotal: ${records.length} record(s)`);
}

function cmdStatus(taskId) {
    if (!taskId) {
        const activeTaskId = store.getActiveTaskId();
        console.log('Usage: agentbridge status [taskId]');
        console.log(`Active task: ${activeTaskId || 'None'}`);
        console.log('\nAll tasks:');
        for (const [tid, task] of state.tasks) {
            console.log(`  ${tid}: ${task.state} (loop: ${task.loopCount})`);
        }
        return;
    }

    if (!taskExists(taskId)) {
        console.log(`Task ${taskId} does not exist`);
        return;
    }

    const task = state.tasks.get(taskId);
    const nextAgent = getNextAgent(taskId);

    console.log('\n=== Task Status ===');
    console.log(`Active project: AgentBridge V1`);
    console.log(`Project path: ${task.projectPath}`);
    console.log(`Current task ID: ${taskId}`);
    console.log(`Current state: ${task.state}`);
    console.log(`Loop count: ${task.loopCount}`);
    console.log(`Next required agent: ${nextAgent || 'None'}`);
    console.log(`Latest Codex build result: ${task.lastBuildResult || 'None'}`);
    console.log(`Last output path: ${task.lastOutputPath || 'None'}`);
    console.log(`Next step: ${getNextStep(taskId)}`);
}

function cmdReport(taskId) {
    let resolvedTaskId = taskId;
    if (!resolvedTaskId) {
        try {
            resolvedTaskId = resolveTaskId();
        } catch (error) {
            console.log('Usage: agentbridge report [taskId]');
            console.error(error.message);
            process.exitCode = 1;
            return;
        }
    }

    if (!taskExists(resolvedTaskId)) {
        console.log(`Task ${resolvedTaskId} does not exist`);
        return;
    }

    const reportFile = writeFinalReport(resolvedTaskId, 'Report requested');
    console.log(`Final report written to: ${reportFile}`);
    console.log(fs.readFileSync(reportFile, 'utf8'));
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('AgentBridge V1 - File-based relay system');
        console.log('Claude = coder | ChatGPT = reviewer | Codex = builder/fixer/executor');
        console.log('Usage: agentbridge <command> [args]');
        console.log('');
        console.log('Commands:');
        console.log('  create [projectPath]         Create task and set active task');
        console.log('  next <taskId>                Generate next prompt');
        console.log('  ingest <agent> <file> [taskId]  Ingest agent output');
        console.log('  status [taskId]              Show task status');
        console.log('  report [taskId]              Show final report');
        console.log('  tasks [limit]                List recent tasks');
        console.log('  show <taskId>                Show full task details');
        console.log('  run-codex <taskId>           Run configured Codex build command');
        console.log('  router plan "<task>"         V1.2: advisory route plan (read-only)');
        console.log('  registry list                V1.2: list all registered agents');
        console.log('  registry validate            V1.2: validate registry entries');
        console.log('  learning list                V1.2: list learning records');
        return;
    }

    const [command, ...commandArgs] = args;

    switch (command) {
        case 'create':
            cmdCreate(commandArgs[0]);
            break;
        case 'next':
            cmdNext(commandArgs[0]);
            break;
        case 'ingest':
            cmdIngest(commandArgs[0], commandArgs[1], commandArgs[2]);
            break;
        case 'status':
            cmdStatus(commandArgs[0]);
            break;
        case 'report':
            cmdReport(commandArgs[0]);
            break;
        case 'tasks':
            cmdTasks(commandArgs[0]);
            break;
        case 'show':
            cmdShow(commandArgs[0]);
            break;
        case 'run-codex':
            cmdRunCodex(commandArgs[0]);
            break;
        case 'router':
            if (commandArgs[0] === 'plan') {
                cmdRouterPlan(commandArgs[1]);
            } else {
                console.log('Usage: agentbridge router plan "<task>"');
            }
            break;
        case 'registry':
            if (commandArgs[0] === 'list') {
                cmdRegistryList();
            } else if (commandArgs[0] === 'validate') {
                cmdRegistryValidate();
            } else {
                console.log('Usage: agentbridge registry list|validate');
            }
            break;
        case 'learning':
            if (commandArgs[0] === 'list') {
                cmdLearningList();
            } else {
                console.log('Usage: agentbridge learning list');
            }
            break;
        default:
            console.log(`Unknown command: ${command}`);
            console.log('Use "agentbridge" for help');
    }
}

const exported = {
    initState,
    generateTaskId,
    cmdCreate,
    cmdNext,
    cmdIngest,
    cmdStatus,
    cmdReport,
    cmdTasks,
    cmdShow,
    cmdRunCodex,
    cmdRouterPlan,
    cmdRegistryList,
    cmdRegistryValidate,
    cmdLearningList,
    planTask,
    runCodexBuild,
    isDangerousCommand,
    recordTaskOutcome,
    getTaskState,
    getNextAgent,
    getLastBuildResult,
    getLoopCount,
    taskExists,
    resolveTaskId,
    parseCodexResult,
    checkSafety,
    writeFinalReport,
    registry,
    router,
    store
};

if (require.main === module) {
    initState();
    parseArgs();
}

module.exports = exported;
