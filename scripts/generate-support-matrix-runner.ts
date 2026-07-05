import fs from 'node:fs';
import path from 'node:path';
import {
  createSupportMatrixReport,
  renderSupportMatrix,
  type SupportMatrixFormat,
} from '../src/core/game-profiles/index.js';

interface CliOptions {
  format: SupportMatrixFormat;
  outputPath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  let format: SupportMatrixFormat = 'markdown';
  let outputPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--format' || arg === '-f') && argv[i + 1]) {
      const value = argv[++i];
      if (value === 'markdown' || value === 'json') {
        format = value;
      } else {
        throw new Error(`Unsupported format: ${value}. Use markdown or json.`);
      }
      continue;
    }
    if ((arg === '--output' || arg === '-o') && argv[i + 1]) {
      outputPath = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { format, outputPath };
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = createSupportMatrixReport();
  const rendered = renderSupportMatrix(report, options.format);

  if (options.outputPath) {
    const resolvedOutputPath = path.resolve(options.outputPath);
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, rendered, 'utf-8');
    console.log(`Support matrix written: ${resolvedOutputPath}`);
    return;
  }

  process.stdout.write(rendered);
}

run();
