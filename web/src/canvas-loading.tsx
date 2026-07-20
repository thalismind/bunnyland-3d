interface CanvasLoadingProps {
  error?: string;
  label?: string;
  loaded?: number;
  total?: number;
}

export function CanvasLoading({
  error = '',
  label = 'Loading 3D renderer…',
  loaded = 0,
  total = 0,
}: CanvasLoadingProps) {
  const failed = Boolean(error);
  const determinate = total > 0;
  const percent = determinate ? Math.min(100, Math.max(0, loaded / total * 100)) : 0;
  return <div
    class={`canvas-loading${failed ? ' failed' : ''}`}
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {!failed && <span class="canvas-loading-spinner" aria-hidden="true"></span>}
    <strong>{failed ? '3D renderer failed to load' : label}</strong>
    <span class="canvas-loading-detail">
      {failed
        ? error
        : determinate
          ? `${loaded} of ${total} scene assets loaded`
          : 'The controls will remain available while the graphics library starts.'}
    </span>
    {!failed && <span
      class={`canvas-loading-meter${determinate ? ' determinate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? total : undefined}
      aria-valuenow={determinate ? loaded : undefined}
    ><span style={determinate ? { width: `${percent}%` } : undefined}></span></span>}
  </div>;
}
