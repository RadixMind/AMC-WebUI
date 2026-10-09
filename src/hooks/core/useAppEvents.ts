import { usePwaLifecycle } from './usePwaLifecycle';
import { useGlobalShortcuts, type UseGlobalShortcutsProps } from './useGlobalShortcuts';

export type AppEventsProps = UseGlobalShortcutsProps;

/**
 * App event orchestration layer. Delegates the PWA lifecycle and global
 * keyboard shortcuts to dedicated hooks and forwards their combined state.
 */
export const useAppEvents = (props: AppEventsProps) => {
  const pwa = usePwaLifecycle({ language: props.appSettings.language });
  useGlobalShortcuts(props);
  return pwa;
};
