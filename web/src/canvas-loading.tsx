interface CanvasLoadingProps {
  error?: string;
  label?: string;
}

export function CanvasLoading({ error = '', label = 'Loading 3D renderer…' }: CanvasLoadingProps) {
  const failed = Boolean(error);
  return <div
    class={`canvas-loading${failed ? ' failed' : ''}`}
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {!failed && <span class="canvas-loading-spinner" aria-hidden="true"></span>}
    <strong>{failed ? '3D renderer failed to load' : label}</strong>
    <span class="canvas-loading-detail">
      {failed ? error : 'The controls will remain available while the graphics library starts.'}
    </span>
    {!failed && <span class="canvas-loading-meter" aria-hidden="true"><span></span></span>}
  </div>;
}
