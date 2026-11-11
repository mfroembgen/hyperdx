import type { Option } from 'commander';

/** Keep the published upload flags accepted by Commander 15's single-character short flags. */
export function normalizeLegacyUploadFlags(
  argv: string[],
  options: readonly Option[],
): string[] {
  const normalized = [...argv];
  if (normalized[2] !== 'upload-sourcemaps') return normalized;

  for (let index = 3; index < normalized.length; index++) {
    const argument = normalized[index];
    if (argument === '--') break;
    if (argument === '-rid' || argument.startsWith('-rid=')) {
      normalized[index] = argument.replace('-rid', '--releaseId');
    } else if (argument === '-bp' || argument.startsWith('-bp=')) {
      normalized[index] = argument.replace('-bp', '--basePath');
    }
    const flag = normalized[index].split('=')[0];
    const option = options.find(
      candidate => candidate.short === flag || candidate.long === flag,
    );
    if (option?.required && !argument.includes('=')) index++;
  }
  return normalized;
}
