#!/usr/bin/env node
/**
 * Test script for file-based relay flow
 * Simulates: new task -> next -> Claude -> ingest -> ChatGPT APPROVED -> ingest -> Workshop PASS -> report
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = process.cwd();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, 'workflow', 'agentbridge');
const PROMPTS_DIR = path.join(WORKFLOW_DIR, 'prompts');
const OUTPUT_DIR = path.join(WORKFLOW_DIR, 'output');

// State management
let state = {
    tasks: new Map(),
    nextTaskId: 0
};

function generateTaskId() {
    state.nextTaskId++;
    return `TASK_${String(state.nextTaskId).padStart(3, '0')}`;
}

function getTaskState(taskId) {
    return state.tasks.get(taskId)?.state || 'created';
}

function setTaskState(taskId, newState) {
    if (!state.tasks.has(taskId)) {
        state.tasks.set(taskId, { state: 'created', loopCount: 0, lastOutput: null, lastBuildResult: null });
    }
    state.tasks.set(taskId, { ...state.tasks.get(taskId), state: newState });
}

function incrementLoopCount(taskId) {
    const task = state.tasks.get(taskId);
    if (task) {
        task.loopCount++;
    }
}

function getLoopCount(taskId) {
    return state.tasks.get(taskId)?.loopCount || 0;
}

function taskExists(taskId) {
    return state.tasks.has(taskId);
}

function isCreated(taskId) {
    return getTaskState(taskId) === 'created';
}

function isWaitingFor(taskId, agent) {
    return getTaskState(taskId) === `waiting_${agent}`;
}

function checkSafety(content) {
    const riskyPatterns = [
        /\brm\s+-rf\b/,
        /\bdel\s+\/s\b/,
        /\brmdir\s+\/s\b/,
        /Remove-Item\s+-Recurse/,
        /git\s+push\b/,
        /npm\s+install\b/,
        /pip\s+install\b/,
        /\bedit\s+\.env\b/,
        /deleting\s+files\b/,
        /moving\s+many\s+files\b/
    ];
    
    for (const pattern of riskyPatterns) {
        if (pattern.test(content)) {
            return true;
        }
    }
    return false;
}

function writeFinalReport(taskId, reason) {
    const reportFile = path.join(WORKFLOW_DIR, `FINAL_REPORT_${taskId}.md`);
    let content = `# Final Report - ${taskId}\n\n`;
    content += `## Reason\n`;
    content += `${reason}\n\n`;
    content += `## Task State\n`;
    content += `State: ${getTaskState(taskId)}\n`;
    content += `Loop Count: ${getLoopCount(taskId)}\n\n`;
    content += `## Last Output\n`;
    content += `${getLastOutput(taskId)}\n\n`;
    content += `## Last Build Result\n`;
    content += `${getLastBuildResult(taskId)}\n`;
    
    fs.writeFileSync(reportFile, content);
    return reportFile;
}

function getNextPromptPath(taskId) {
    const state = getTaskState(taskId);
    
    switch (state) {
        case 'created':
            return generatePrompt(taskId, 'claude', 'Generate the next prompt for Claude');
        case 'waiting_claude_code':
            return generatePrompt(taskId, 'chatgpt', 'Review Claude\'s code');
        case 'waiting_chatgpt_review':
            if (getLastBuildResult(taskId) === 'PASS') {
                return generatePrompt(taskId, 'workshop', 'Build the project');
            } else {
                return generatePrompt(taskId, 'claude', 'Fix the issues identified by ChatGPT');
            }
        case 'waiting_claude_fix':
            return generatePrompt(taskId, 'workshop', 'Build the project after Claude\'s fix');
        default:
            return null;
    }
}

function getLastOutput(taskId) {
    return state.tasks.get(taskId)?.lastOutput;
}

function setLastOutput(taskId, output) {
    if (!state.tasks.has(taskId)) {
        state.tasks.set(taskId, { state: 'created', loopCount: 0, lastOutput: null, lastBuildResult: null });
    }
    state.tasks.set(taskId, { ...state.tasks.get(taskId), lastOutput: output });
}

function getLastBuildResult(taskId) {
    return state.tasks.get(taskId)?.lastBuildResult;
}

function setLastBuildResult(taskId, result) {
    if (!state.tasks.has(taskId)) {
        state.tasks.set(taskId, { state: 'created', loopCount: 0, lastOutput: null, lastBuildResult: null });
    }
    state.tasks.set(taskId, { ...state.tasks.get(taskId), lastBuildResult: result });
}

function getMaxLoops() {
    return parseInt(process.env.MAX_LOOPS || '3');
}

function generatePrompt(taskId, agent, content) {
    const promptDir = path.join(PROMPTS_DIR, agent);
    const promptFile = path.join(promptDir, `${taskId}.md`);
    
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(promptFile, content);
    
    return promptFile;
}

function ingestFile(agent, filePath, taskId) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Output file not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    const outputFileName = `${taskId}_${agent}_${Date.now()}.md`;
    const outputPath = path.join(OUTPUT_DIR, agent, outputFileName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);
    
    setLastOutput(taskId, content);
    
    return content;
}

function cmdStatus(taskId) {
    if (!taskId) {
        console.log('Usage: agentbridge status [taskId]');
        return;
    }
    
    if (!taskExists(taskId)) {
        console.log(`Task ${taskId} does not exist`);
        return;
    }
    
    const task = state.tasks.get(taskId);
    const nextAgent = getNextAgent(taskId);
    const nextPromptPath = getNextPromptPath(taskId);
    
    console.log(`\n=== Task Status ===`);
    console.log(`Active project: AgentBridge V1`);
    console.log(`Project type: File-based relay`);
    console.log(`Current task ID: ${taskId}`);
    console.log(`Task state: ${task.state}`);
    console.log(`Loop count: ${task.loopCount}`);
    console.log(`Next required agent: ${nextAgent}`);
    console.log(`Next prompt path: ${nextPromptPath || 'Not generated yet'}`);
    console.log(`Last output path: ${path.join(OUTPUT_DIR, task.lastOutput?.split('/').slice(-2).join('/')) || 'None'}`);
    console.log(`Last build result: ${task.lastBuildResult || 'None'}`);
}

function getNextAgent(taskId) {
    const state = getTaskState(taskId);
    
    switch (state) {
        case 'created':
        case 'waiting_chatgpt_review':
        case 'waiting_workshop_build':
        case 'waiting_claude_fix':
            return 'claude';
        case 'waiting_claude_code':
            return 'chatgpt';
        case 'waiting_claude_fix':
            return 'workshop';
        default:
            return null;
    }
}

function cmdReport(taskId) {
    if (!taskId) {
        console.log('Usage: agentbridge report [taskId]');
        return;
    }
    
    if (!taskExists(taskId)) {
        console.log(`Task ${taskId} does not exist`);
        return;
    }
    
    const reportFile = writeFinalReport(taskId, 'Report requested');
    console.log(`\n=== Final Report ===`);
    console.log(`Final report written to: ${reportFile}`);
    console.log(fs.readFileSync(reportFile, 'utf8'));
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
    
    const nextPromptPath = getNextPromptPath(taskId);
    if (nextPromptPath) {
        console.log(`Generated prompt: ${nextPromptPath}`);
    } else {
        console.log('No next prompt available');
    }
}

function cmdIngest(agent, filePath, taskId) {
    if (!agent || !filePath) {
        console.log('Usage: agentbridge ingest <agent> <filePath>');
        return;
    }
    
    const content = ingestFile(agent, filePath, taskId);
    console.log(`Ingested ${filePath}`);
    
    if (agent === 'claude') {
        if (checkSafety(content)) {
            console.log('SAFETY VIOLATION DETECTED!');
            console.log('Stopping task due to risky patterns in Claude output');
            setTaskState(taskId, 'stopped');
            writeFinalReport(taskId, 'Safety violation detected in Claude output');
            return;
        }
        setTaskState(taskId, 'waiting_chatgpt_review');
    } else if (agent === 'chatgpt') {
        if (content.includes('APPROVED') || content.includes('approved') || content.includes('approve')) {
            setTaskState(taskId, 'waiting_workshop_build');
        } else {
            setTaskState(taskId, 'waiting_claude_fix');
        }
    } else if (agent === 'workshop') {
        if (content.includes('PASS') || content.includes('passed')) {
            setTaskState(taskId, 'passed');
            writeFinalReport(taskId, 'Build passed successfully');
        } else if (content.includes('FAIL') || content.includes('failed')) {
            incrementLoopCount(taskId);
            const loopCount = getLoopCount(taskId);
            const maxLoops = getMaxLoops();
            
            if (loopCount >= maxLoops) {
                setTaskState(taskId, 'stopped');
                writeFinalReport(taskId, `Max loops (${maxLoops}) reached`);
            } else {
                setTaskState(taskId, 'waiting_claude_fix');
            }
        } else {
            console.log('Unknown build result, defaulting to waiting_claude_fix');
            setTaskState(taskId, 'waiting_claude_fix');
        }
    }
    
    console.log(`Next state: ${getTaskState(taskId)}`);
}

// Test flow
function runTest() {
    console.log('=== AgentBridge V1 - File Relay Flow Test ===\n');
    
    // Step 1: Create new task
    console.log('Step 1: Create new task');
    const taskId = generateTaskId();
    console.log(`Created task: ${taskId}`);
    console.log(`Initial state: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 2: Run next (generate Claude prompt)
    console.log('Step 2: Run "agentbridge next"');
    cmdNext(taskId);
    console.log(`State after next: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 3: Simulate Claude output
    console.log('Step 3: Simulate Claude output');
    const claudeOutputPath = path.join(OUTPUT_DIR, 'claude', 'TASK_0001_claude_1234567890.md');
    const claudeOutputContent = '# Claude Output\n\nGenerated code for TASK_0001\n\n```\ntypeScript code here\n```\n';
    fs.writeFileSync(claudeOutputPath, claudeOutputContent);
    console.log(`Claude output written to: ${claudeOutputPath}`);
    console.log('');
    
    // Step 4: Ingest Claude output
    console.log('Step 4: Run "agentbridge ingest claude"');
    cmdIngest('claude', claudeOutputPath, taskId);
    console.log(`State after ingest: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 5: Run next (generate ChatGPT review prompt)
    console.log('Step 5: Run "agentbridge next"');
    cmdNext(taskId);
    console.log(`State after next: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 6: Simulate ChatGPT review with APPROVED
    console.log('Step 6: Simulate ChatGPT review with APPROVED');
    const chatgptOutputPath = path.join(OUTPUT_DIR, 'chatgpt', 'TASK_0001_chatgpt_1234567890.md');
    const chatgptOutputContent = '# ChatGPT Review\n\nReview of TASK_0001 Claude output:\n\n✅ Code looks good\n✅ No issues found\n✅ APPROVED for build\n\nChatGPT has reviewed the code and approved it.';
    fs.writeFileSync(chatgptOutputPath, chatgptOutputContent);
    console.log(`ChatGPT output written to: ${chatgptOutputPath}`);
    console.log('');
    
    // Step 7: Ingest ChatGPT output
    console.log('Step 7: Run "agentbridge ingest chatgpt"');
    cmdIngest('chatgpt', chatgptOutputPath, taskId);
    console.log(`State after ingest: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 8: Run next (generate Workshop build prompt)
    console.log('Step 8: Run "agentbridge next"');
    cmdNext(taskId);
    console.log(`State after next: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 9: Simulate Workshop build with PASS
    console.log('Step 9: Simulate Workshop build with PASS');
    const workshopOutputPath = path.join(OUTPUT_DIR, 'workshop', 'TASK_0001_workshop_1234567890.md');
    const workshopOutputContent = '# Workshop Build Log\n\nBuilding TASK_0001...\n\nCompiling...\n✅ Build successful\n✅ PASS\n\nAll tests passed.';
    fs.writeFileSync(workshopOutputPath, workshopOutputContent);
    console.log(`Workshop output written to: ${workshopOutputPath}`);
    console.log('');
    
    // Step 10: Ingest Workshop output
    console.log('Step 10: Run "agentbridge ingest workshop"');
    cmdIngest('workshop', workshopOutputPath, taskId);
    console.log(`State after ingest: ${getTaskState(taskId)}`);
    console.log('');
    
    // Step 11: Run report
    console.log('Step 11: Run "agentbridge report"');
    cmdReport(taskId);
    console.log('');
    
    // Step 12: Show final status
    console.log('Step 12: Final status');
    cmdStatus(taskId);
    console.log('');
    
    console.log('=== Test Complete ===');
}

// Run the test
runTest();
