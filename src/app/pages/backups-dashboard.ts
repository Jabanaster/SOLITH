export interface BackupDashboardItem {
  id: string;
  timestamp: string;
  filePath: string;
  originalHash: string;
  backupPath: string;
  recipeId?: string;
}

export interface BackupDashboardSummary {
  totalBackups: number;
  uniqueFiles: number;
  recipeLinkedBackups: number;
  latestTimestamp: string | null;
  latestFilePath: string | null;
}

export function buildBackupDashboardSummary(backups: BackupDashboardItem[]): BackupDashboardSummary {
  const totalBackups = backups.length;
  const uniqueFiles = new Set(backups.map(backup => backup.filePath.toLowerCase())).size;
  const recipeLinkedBackups = backups.filter(backup => Boolean(backup.recipeId)).length;
  const latest = [...backups].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] ?? null;

  return {
    totalBackups,
    uniqueFiles,
    recipeLinkedBackups,
    latestTimestamp: latest?.timestamp ?? null,
    latestFilePath: latest?.filePath ?? null,
  };
}
