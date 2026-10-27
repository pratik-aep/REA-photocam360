import type { Shot } from './CaptureScreen';

export type State =
  | { name: 'home' }
  | { name: 'capture' }
  | { name: 'processing'; shots: Shot[]; progress: number }
  | { name: 'viewer'; uri: string }
  | { name: 'error'; message: string; shots?: Shot[] };

export type Action =
  | { type: 'home' }
  | { type: 'capture' }
  | { type: 'upload'; shots: Shot[] }
  | { type: 'progress'; fraction: number }
  | { type: 'stitched'; uri: string }
  | { type: 'failed'; message: string }
  | { type: 'cancel' };

/**
 * Screen state. Captured shots stay attached to the processing/error states, so a failed or
 * cancelled upload can be retried instead of throwing away all the photos.
 */
export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'home':
      return { name: 'home' };
    case 'capture':
      return { name: 'capture' };
    case 'upload':
      return { name: 'processing', shots: action.shots, progress: 0 };
    case 'progress':
      return state.name === 'processing' ? { ...state, progress: action.fraction } : state;
    // Results only apply to the upload in flight; a late reply after Cancel is ignored.
    case 'stitched':
      return state.name === 'processing' ? { name: 'viewer', uri: action.uri } : state;
    case 'failed':
      return state.name === 'processing' ? { name: 'error', message: action.message, shots: state.shots } : state;
    case 'cancel':
      return state.name === 'processing' ? { name: 'error', message: 'Upload cancelled.', shots: state.shots } : state;
  }
}

const filesOf = (s: State): string[] =>
  s.name === 'processing' || s.name === 'error' ? (s.shots ?? []).map((x) => x.uri) : s.name === 'viewer' ? [s.uri] : [];

/** Files the previous state held that the next one no longer needs, so they can be deleted. */
export function releasedFiles(prev: State, next: State): string[] {
  const keep = new Set(filesOf(next));
  return filesOf(prev).filter((u) => !keep.has(u));
}
