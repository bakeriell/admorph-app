export enum EditorState {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  READY = 'READY',
  GENERATING = 'GENERATING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
  LOADING = 'LOADING'
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    }
  }
}

export type ToolType = 'STORY' | 'BACKGROUND' | 'CAR_REPLACE' | 'TEXT_EDITOR';

export interface TextBlock {
  text: string;
  box: [number, number, number, number];
}

export interface GeneratedImage {
  url: string;
  timestamp: number;
}

export enum AspectRatio {
  SQUARE = '1:1',
  STORY = '9:16',
  LANDSCAPE = '16:9'
}