import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AudioEditorContext, Bridge, ImageEditorContext, LocalFile, Settings, Snapshot, VideoEditorContext } from './types';

export const isTauriRuntime = isTauri();

function subscription<T>(eventName: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(eventName, event => callback(event.payload)).then(stop => {
    if (disposed) stop();
    else unlisten = stop;
  });
  return () => { disposed = true; unlisten?.(); };
}

export const tauriBridge: Bridge = {
  bootstrap: () => invoke<Snapshot>('bootstrap'),
  addFiles: () => invoke<LocalFile[]>('choose_files'),
  addFolder: () => invoke<LocalFile[]>('choose_folder'),
  // Native drop paths are handed off by the Rust window event bridge in Phase 4.
  droppedFiles: () => invoke<LocalFile[]>('consume_drop'),
  inspectPaths: (paths, recursive = false) => invoke<LocalFile[]>('inspect_paths', { paths, recursive }),
  enqueue: request => invoke('enqueue', { request }),
  cancel: id => invoke('cancel', { id }),
  retry: id => invoke('retry', { id }),
  copyDiagnostic: id => invoke('copy_diagnostic', { id }),
  saveSettings: (patch: Partial<Settings>) => invoke<Settings>('save_settings', { patch }),
  pickOutput: () => invoke<string | null>('pick_output'),
  reveal: path => invoke('reveal', { path }),
  openOutput: path => invoke('open_output', { path }),
  fileAction: request => invoke('file_action', { request }),
  preview: path => invoke('preview', { path }),
  previewContext: () => invoke<LocalFile>('preview_context'),
  closePreview: () => invoke('close_preview'),
  imagePreview: (path, operation, options) => invoke('image_preview', { path, operation, options }),
  openImageTool: request => invoke('open_image_tool', { request }),
  imageToolContext: () => invoke('image_tool_context'),
  onImageToolContext: callback => subscription<ImageEditorContext>('santra:editor-context', callback),
  applyImageTool: request => invoke('apply_image_tool', { request }),
  closeImageTool: () => invoke('close_image_tool'),
  videoToolContext: () => invoke('video_tool_context'),
  onVideoToolContext: callback => subscription<VideoEditorContext>('santra:editor-context', callback),
  openVideoTool: request => invoke('open_video_tool', { request }),
  applyVideoTool: request => invoke('apply_video_tool', { request }),
  closeVideoTool: () => invoke('close_video_tool'),
  audioToolContext: () => invoke('audio_tool_context'),
  onAudioToolContext: callback => subscription<AudioEditorContext>('santra:editor-context', callback),
  openAudioTool: request => invoke('open_audio_tool', { request }),
  applyAudioTool: request => invoke('apply_audio_tool', { request }),
  closeAudioTool: () => invoke('close_audio_tool'),
  finishGlobalWheel: async (page, notice) => { await invoke('finish_global_wheel', { page, notice }); },
  selectGlobalOperation: request => invoke('select_global_operation', { request }),
  handoffGlobalFiles: request => invoke('handoff_global_files', { request }),
  onWheelMode: callback => subscription<{ mode: string; newDrag: boolean }>('santra:wheel-mode', payload => callback(payload.mode, payload.newDrag)),
  currentWheelMode: () => invoke<string>('shell_wheel_mode'),
  onGlobalOperation: callback => subscription('santra:global-operation', callback),
  onGlobalFiles: callback => subscription('santra:global-files', callback),
  onGlobalNotice: callback => subscription('santra:global-notice', callback),
  onGlobalPage: callback => subscription('santra:global-page', callback),
  onUpdate: callback => subscription('santra:update', callback),
  onNativeDrop: (callback, onError) => {
    const stopDrop = subscription<{ x: number; y: number } | null>('santra:native-drop', position => {
      void invoke<LocalFile[]>('consume_drop').then(files => callback(files, position || undefined)).catch(error => onError?.(error instanceof Error ? error.message : String(error)));
    });
    const stopError = subscription<string>('santra:native-drop-error', message => onError?.(message));
    return () => { stopDrop(); stopError(); };
  },
  onNativeDragEnter: callback => subscription<LocalFile[]>('santra:native-drag-enter', callback),
  onNativeDragOver: callback => subscription<{ x: number; y: number }>('santra:native-drag-over', callback),
};
