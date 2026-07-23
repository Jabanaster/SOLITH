import type { PlayerCorrelationEvent } from '../live-memory/live-correlation-watcher.js';

export interface OcrRegionOfInterest {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrDisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LocalOcrResult {
  text: string;
  normalizedText: string;
  value: number | null;
  confidence?: number;
  readOnly: true;
  localOnly: true;
}

export function normalizeNumericOcrText(text: string): string {
  return text
    .split(/\s+/)
    .map((token) => {
      const digitLike = /\d/.test(token);
      if (!digitLike) return '';
      return token
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/[Ss]/g, '5')
        .replace(/,/g, '')
        .replace(/[^\d.+\-\/]/g, '');
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function extractBestNumericValue(text: string): number | null {
  const normalized = normalizeNumericOcrText(text);
  const fraction = normalized.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
  if (fraction) {
    const current = Number(fraction[1]);
    return Number.isFinite(current) ? current : null;
  }

  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

export function buildOcrCorrelationEvent(result: LocalOcrResult): PlayerCorrelationEvent | null {
  if (result.value == null) return null;
  return {
    kind: 'ocr_value',
    label: 'OCR screen value',
    expectedDirection: 'changed',
    observedValue: result.value,
    observedAt: new Date().toISOString(),
  };
}

export function scaleDisplayRoiToCapture(
  displayRoi: OcrRegionOfInterest,
  displaySize: { width: number; height: number },
  captureSize: { width: number; height: number },
): OcrRegionOfInterest {
  if (displaySize.width <= 0 || displaySize.height <= 0) {
    throw new Error('ocr_display_size_invalid');
  }
  if (captureSize.width <= 0 || captureSize.height <= 0) {
    throw new Error('ocr_capture_size_invalid');
  }

  const xScale = captureSize.width / displaySize.width;
  const yScale = captureSize.height / displaySize.height;
  const x = clamp(Math.round(displayRoi.x * xScale), 0, captureSize.width - 1);
  const y = clamp(Math.round(displayRoi.y * yScale), 0, captureSize.height - 1);
  const width = clamp(Math.round(displayRoi.width * xScale), 1, captureSize.width - x);
  const height = clamp(Math.round(displayRoi.height * yScale), 1, captureSize.height - y);
  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
