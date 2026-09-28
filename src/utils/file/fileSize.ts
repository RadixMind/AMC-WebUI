const FILE_SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats a file size in bytes into a human-readable string with binary units (B, KB, MB, GB, TB).
 *
 * @param sizeInBytes Size in bytes (must be a positive finite number).
 * @returns Human-readable size string (e.g. '512 B', '1.5 KB', '2.50 MB'), or an empty string if input is invalid or non-positive.
 */
export const formatFileSize = (sizeInBytes: number): string => {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) return '';
  if (sizeInBytes < 1024) return `${Math.round(sizeInBytes)} B`;

  let value = sizeInBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 1 : 2;
  return `${value.toFixed(decimals)} ${FILE_SIZE_UNITS[unitIndex]}`;
};
