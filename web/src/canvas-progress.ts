export const PLAYER_CANVAS_PROGRESS_EVENT = 'bunnyland:3d-player-progress';

export interface CanvasProgress {
  active: boolean;
  loaded: number;
  total: number;
}

export function reportPlayerCanvasProgress(progress: CanvasProgress): void {
  window.dispatchEvent(new CustomEvent<CanvasProgress>(PLAYER_CANVAS_PROGRESS_EVENT, {
    detail: progress,
  }));
}
