import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  TrainerResearchAnalyzeCtSchema,
  TrainerResearchAnalyzeExeSchema,
  TrainerResearchImportDumpspaceSchema,
} from './ipc-validation.js';
import { importDefinitionDumpspace } from '../src/core/definitions/import-definition-dumpspace.js';
import { analyzeTrainerExecutable } from '../src/core/trainer-research/pe-analyzer.js';
import { analyzeCheatTableScripts } from '../src/core/script-research/ct-script-research.js';
import { buildDumpspaceImportSummary } from '../src/core/ue-research/dumpspace-import.js';
import { mergeDumpspaceWithScriptResearch } from '../src/core/ue-research/research-merge.js';

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerTrainerResearchIpc(): void {
  ipcMain.handle('trainer-research-pick-exe', async (event) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const win = BrowserWindow.fromWebContents(event.sender) ?? activeWindow();
      const result = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Select trainer executable (analysis only — never run from Solith)',
        properties: ['openFile'],
        filters: [{ name: 'Windows Executables', extensions: ['exe'] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' };
      }
      return { success: true, filePath: path.resolve(result.filePaths[0]) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('trainer-research-analyze-exe', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = TrainerResearchAnalyzeExeSchema.parse(payload);
      const analysis = analyzeTrainerExecutable(parsed.filePath);
      return { success: true, analysis };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('trainer-research-pick-dumpspace-folder', async (event) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const win = BrowserWindow.fromWebContents(event.sender) ?? activeWindow();
      const result = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Select UEDumper Dumpspace folder (OffsetsInfo.json, ClassesInfo.json, …)',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' };
      }
      const folderPath = path.resolve(result.filePaths[0]);
      const hasJson =
        fs.existsSync(path.join(folderPath, 'OffsetsInfo.json')) ||
        fs.existsSync(path.join(folderPath, 'ClassesInfo.json')) ||
        fs.existsSync(path.join(folderPath, 'StructsInfo.json'));
      if (!hasJson) {
        return {
          success: false,
          error: 'Selected folder is missing Dumpspace JSON (OffsetsInfo.json / ClassesInfo.json).',
        };
      }
      return { success: true, folderPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('trainer-research-import-dumpspace', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = TrainerResearchImportDumpspaceSchema.parse(payload);
      const dumpspaceDir = path.resolve(parsed.dumpspaceDir);
      if (!fs.existsSync(dumpspaceDir) || !fs.statSync(dumpspaceDir).isDirectory()) {
        return { success: false, errors: ['Dumpspace folder does not exist.'] };
      }
      const result = importDefinitionDumpspace({
        dumpspaceDir,
        title: parsed.title,
        executable: parsed.executable,
      });
      if (result.success === false) {
        return { success: false, errors: result.errors };
      }
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  });

  ipcMain.handle('trainer-research-pick-ct', async (event) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const win = BrowserWindow.fromWebContents(event.sender) ?? activeWindow();
      const result = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Select Cheat Engine table (.CT) for Script Research Analyzer',
        properties: ['openFile'],
        filters: [{ name: 'Cheat Engine Tables', extensions: ['ct', 'CT', 'xml'] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' };
      }
      const filePath = path.resolve(result.filePaths[0]);
      const xmlText = fs.readFileSync(filePath, 'utf8');
      return { success: true, filePath, xmlText };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('trainer-research-analyze-ct-scripts', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = TrainerResearchAnalyzeCtSchema.parse(payload);
      const report = await analyzeCheatTableScripts(parsed.xmlText, {
        title: parsed.title,
        executable: parsed.executable,
      });
      return { success: true, report };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('trainer-research-merge-ue-scripts', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const body = payload as {
        dumpspaceDir?: string;
        xmlText?: string;
        title?: string;
        executable?: string;
      };
      if (!body.dumpspaceDir || !body.xmlText) {
        return { success: false, error: 'dumpspaceDir and xmlText required' };
      }
      const dumpspaceDir = path.resolve(body.dumpspaceDir);
      const offsetsJson = fs.existsSync(path.join(dumpspaceDir, 'OffsetsInfo.json'))
        ? fs.readFileSync(path.join(dumpspaceDir, 'OffsetsInfo.json'), 'utf8')
        : undefined;
      const classesJson = fs.existsSync(path.join(dumpspaceDir, 'ClassesInfo.json'))
        ? fs.readFileSync(path.join(dumpspaceDir, 'ClassesInfo.json'), 'utf8')
        : undefined;
      const structsJson = fs.existsSync(path.join(dumpspaceDir, 'StructsInfo.json'))
        ? fs.readFileSync(path.join(dumpspaceDir, 'StructsInfo.json'), 'utf8')
        : undefined;
      const summary = buildDumpspaceImportSummary({
        title: body.title ?? 'UE Research',
        executable: body.executable ?? 'Game.exe',
        offsetsJson,
        classesJson,
        structsJson,
      });
      const scriptReport = await analyzeCheatTableScripts(body.xmlText, {
        title: body.title,
        executable: body.executable,
      });
      const merged = mergeDumpspaceWithScriptResearch(summary, scriptReport);
      return { success: true, merged, summary, scriptReport };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
