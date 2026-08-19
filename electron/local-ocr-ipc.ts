import { desktopCapturer, ipcMain } from 'electron';
import { LocalOcrCaptureSchema, LocalOcrListSourcesSchema } from './ipc-validation.js';
import {
  extractBestNumericValue,
  normalizeNumericOcrText,
  type LocalOcrResult,
} from '../src/core/ocr/local-ocr.js';

const WINDOW_THUMBNAIL_SIZE = { width: 1920, height: 1080 };

export function registerLocalOcrIpc(): void {
  ipcMain.handle('local-ocr-list-window-sources', async (_event, payload: unknown) => {
    try {
      const parsed = LocalOcrListSourcesSchema.parse(payload ?? {});
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 420, height: 236 },
        fetchWindowIcons: true,
      });
      const target = parsed.targetName?.replace(/\.exe$/i, '').toLowerCase();
      return {
        success: true,
        sources: sources
          .filter((source) => !target || source.name.toLowerCase().includes(target))
          .map((source) => ({
            id: source.id,
            name: source.name,
            thumbnailDataUrl: source.thumbnail.toDataURL(),
            thumbnailSize: source.thumbnail.getSize(),
            captureSize: WINDOW_THUMBNAIL_SIZE,
            appIconDataUrl: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
          })),
      };
    } catch (error) {
      return { success: false, error: sanitizeOcrError(error, 'ocr_list_sources_failed') };
    }
  });

  ipcMain.handle('local-ocr-read-window-region', async (_event, payload: unknown) => {
    try {
      const parsed = LocalOcrCaptureSchema.parse(payload);
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: WINDOW_THUMBNAIL_SIZE,
        fetchWindowIcons: false,
      });
      const source = sources.find((candidate) => candidate.id === parsed.sourceId);
      if (!source) return { success: false, error: 'ocr_source_not_found' };
      if (source.thumbnail.isEmpty()) return { success: false, error: 'ocr_source_empty' };

      const size = source.thumbnail.getSize();
      const roi = clampRoi(parsed.roi, size);
      if (!roi) return { success: false, error: 'ocr_roi_out_of_bounds' };

      const cropped = source.thumbnail.crop(roi);
      const image = cropped.toPNG();
      const text = await recognizeNumericText(image);
      const result: LocalOcrResult = {
        text,
        normalizedText: normalizeNumericOcrText(text),
        value: extractBestNumericValue(text),
        readOnly: true,
        localOnly: true,
      };
      return { success: true, result, roi, sourceName: source.name };
    } catch (error) {
      return { success: false, error: sanitizeOcrError(error, 'ocr_read_failed') };
    }
  });
}

async function recognizeNumericText(image: Buffer): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.,/- ',
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
    });
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function clampRoi(
  roi: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  if (roi.x >= size.width || roi.y >= size.height) return null;
  const width = Math.min(roi.width, size.width - roi.x);
  const height = Math.min(roi.height, size.height - roi.y);
  if (width <= 0 || height <= 0) return null;
  return { x: roi.x, y: roi.y, width, height };
}

function sanitizeOcrError(error: unknown, fallback: string): string {
  // eslint-disable-next-line no-console
  console.error(`[local-ocr-ipc] ${fallback}:`, error);
  return fallback;
}
