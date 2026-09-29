import React from 'react';

export interface LiveUiInteractionPendingFrameProps {
  label: string;
  baseFontSize?: number;
}

export const LiveUiInteractionPendingFrame: React.FC<LiveUiInteractionPendingFrameProps> = ({
  label,
  baseFontSize,
}) => (
  <div
    data-live-artifact-interaction-pending="true"
    aria-label={label}
    aria-live="polite"
    className="my-3 rounded-lg border border-[var(--theme-border-primary)] bg-[var(--theme-bg-model-message)] p-4 shadow-sm"
    style={baseFontSize ? { fontSize: `${baseFontSize}px` } : undefined}
  >
    <div className="space-y-3">
      <div className="h-3 w-40 rounded bg-[var(--theme-border-secondary)] animate-pulse" />
      <div className="grid gap-2">
        <div className="h-9 rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] animate-pulse" />
        <div className="h-9 rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-primary)] animate-pulse" />
      </div>
      <div className="ml-auto h-8 w-24 rounded-md bg-[var(--theme-bg-accent)]/40 animate-pulse" />
    </div>
  </div>
);
