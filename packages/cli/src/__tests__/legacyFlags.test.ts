import { Option } from 'commander';
import { describe, expect, it } from 'vitest';

import { normalizeLegacyUploadFlags } from '@/utils/legacyFlags';

const options = [new Option('-k, --serviceKey <string>')];
const prefix = ['bun', 'hdx', 'upload-sourcemaps'];

describe('legacy upload flags', () => {
  it('preserves release and base path flags under Commander 15', () => {
    expect(
      normalizeLegacyUploadFlags(
        [...prefix, '-rid', 'release', '-bp=/assets'],
        options,
      ),
    ).toEqual([...prefix, '--releaseId', 'release', '--basePath=/assets']);
  });

  it('preserves required option values that look like legacy flags', () => {
    expect(
      normalizeLegacyUploadFlags(
        [...prefix, '-k', '-rid', '-bp', '/assets'],
        options,
      ),
    ).toEqual([...prefix, '-k', '-rid', '--basePath', '/assets']);
  });

  it('preserves other commands and arguments after the option terminator', () => {
    const literal = [...prefix, '--', '-rid'];
    const otherCommand = ['bun', 'hdx', 'query', '-rid'];
    expect(normalizeLegacyUploadFlags(literal, options)).toEqual(literal);
    expect(normalizeLegacyUploadFlags(otherCommand, options)).toEqual(
      otherCommand,
    );
  });
});
