export interface RuntimeProcessSummary {
  pid: number;
  executableName: string;
  executablePath?: string;
  selectedByUser: boolean;
}

export function assertExplicitProcessSelection(process: RuntimeProcessSummary): void {
  if (!process.selectedByUser) throw new Error('A target process must be explicitly selected by the user.');
  if (!process.pid || process.pid <= 0) throw new Error('Selected process must include a valid PID.');
  if (!process.executableName) throw new Error('Selected process must include an executable name.');
}
