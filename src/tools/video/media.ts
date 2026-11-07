export type MaskShape = 'rect' | 'circle' | 'triangle' | 'path';
export type MaskPoint = { x: number; y: number };
export type Mask = {
  x: number;
  y: number;
  width: number;
  height: number;
  start: number;
  end: number;
  color: string;
  shape?: MaskShape;
  points?: MaskPoint[];
  filled?: boolean;
  stroke?: number;
};
export type Preview = { url: string; duration?: number; previewDuration?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
export type SplitClip = { id: string; start: string; end: string };

export const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff', 'wma'] as const;
export const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv'] as const;
export const isAudioFormat = (format: string) => (AUDIO_FORMATS as readonly string[]).includes(format);
export const isVideoFormat = (format: string) => (VIDEO_FORMATS as readonly string[]).includes(format);
export const isEven = (value: number) => Number.isInteger(value) && value % 2 === 0;
export const decimal = (value: number) => Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, '') : '0';
export const clock = (value: number) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe / 60) % 60;
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
};
export const maskShape = (mask: Mask): MaskShape => mask.shape || 'rect';
export const cropRect = (values: Record<string, string>, videoWidth: number, videoHeight: number) => {
  const number = (key: string, fallback: number) => {
    const value = Number(values[key]);
    return values[key] !== undefined && values[key] !== '' && Number.isFinite(value) ? value : fallback;
  };
  return {
    x: number('cropX', 0),
    y: number('cropY', 0),
    width: number('cropWidth', videoWidth),
    height: number('cropHeight', videoHeight),
  };
};
