import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { Toggle } from '@/components/shared/Toggle';

interface ApiConfigToggleProps {
  useCustomApiConfig: boolean;
  setUseCustomApiConfig: (value: boolean) => void;
  hasEnvKey: boolean;
  serverManagedApi?: boolean;
  hasCustomKey?: boolean;
}

export const ApiConfigToggle: React.FC<ApiConfigToggleProps> = ({
  useCustomApiConfig,
  setUseCustomApiConfig,
  hasEnvKey,
  serverManagedApi = false,
  hasCustomKey = false,
}) => {
  const { t } = useI18n();
  const handleRowClick = () => {
    setUseCustomApiConfig(!useCustomApiConfig);
  };
  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleRowClick();
  };

  const isServerManaged = Boolean(serverManagedApi);
  const isGlobalKeyAvailable = hasEnvKey || isServerManaged;

  const resolveDescription = () => {
    if (useCustomApiConfig) {
      if (hasCustomKey) {
        return isGlobalKeyAvailable ? t('apiConfigOverridingEnvKey') : t('apiConfigUsingOwnKeys');
      }
      if (isServerManaged) {
        return t('apiConfigServerManagedWithCustomEnabled');
      }
      if (hasEnvKey) {
        return t('apiConfigOverridingEnvKey');
      }
      return t('apiConfigUsingOwnKeys');
    }

    if (isServerManaged) {
      return t('apiConfigServerManagedDesc');
    }
    if (hasEnvKey) {
      return t('apiConfigDefaultInfo');
    }
    return t('apiConfigMissingEnvKey');
  };

  return (
    <div
      className="flex items-center justify-between py-3 cursor-pointer group select-none relative z-10 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-border-focus)]"
      role="switch"
      tabIndex={0}
      aria-checked={useCustomApiConfig}
      aria-label={t('settingsUseCustomApi')}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
    >
      <div className="flex flex-col flex-grow pr-4">
        <span className="text-sm font-medium text-[var(--theme-text-primary)] flex items-center gap-2 group-hover:text-[var(--theme-text-link)] transition-colors">
          {t('settingsUseCustomApi')}
          {isServerManaged && !hasCustomKey && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--theme-bg-success)] text-[var(--theme-text-success)] border border-[var(--theme-text-success)]/25">
              <ShieldCheck size={10} /> {t('apiConfigServerActiveBadge')}
            </span>
          )}
          {!isServerManaged && hasEnvKey && !hasCustomKey && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--theme-bg-success)] text-[var(--theme-text-success)] border border-[var(--theme-text-success)]/25">
              <ShieldCheck size={10} /> {t('apiConfigEnvActiveBadge')}
            </span>
          )}
        </span>
        <span className="text-xs text-[var(--theme-text-secondary)] mt-0.5">{resolveDescription()}</span>
      </div>
      <div>
        <Toggle
          id="use-custom-api-config-toggle"
          checked={useCustomApiConfig}
          onChange={setUseCustomApiConfig}
          interactive={false}
        />
      </div>
    </div>
  );
};
