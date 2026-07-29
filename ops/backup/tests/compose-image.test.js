import { describe, it, expect } from 'vitest';
import { replaceCrmparserImageInCompose } from '../lib/compose-image.js';
import { resolveCrmparserImageRef } from '../lib/versions.js';

describe('compose-image', () => {
  it('replaceCrmparserImageInCompose updates ghcr image line', () => {
    const compose = `services:
  crmparser:
    image: ghcr.io/3au4uk-1/crmparserv2:latest
    ports:
      - "3000:3000"
`;
    const out = replaceCrmparserImageInCompose(
      compose,
      'ghcr.io/3au4uk-1/crmparserv2@sha256:abc',
    );
    expect(out).toContain('image: ghcr.io/3au4uk-1/crmparserv2@sha256:abc');
    expect(out).not.toContain(':latest');
  });

  it('replaceCrmparserImageInCompose throws when image line missing', () => {
    expect(() => replaceCrmparserImageInCompose('services:\n  other:\n    image: nginx\n', 'x')).toThrow(
      /not found/,
    );
  });
});

describe('resolveCrmparserImageRef', () => {
  it('returns digest-pinned ref when manifest has digest only', () => {
    expect(
      resolveCrmparserImageRef({
        crmparserImage: 'ghcr.io/3au4uk-1/crmparserv2:abc123',
        crmparserDigest: 'sha256:deadbeef',
      }),
    ).toBe('ghcr.io/3au4uk-1/crmparserv2:abc123@sha256:deadbeef');
  });

  it('returns image as-is when already digest-pinned', () => {
    const ref = 'ghcr.io/3au4uk-1/crmparserv2@sha256:abc';
    expect(resolveCrmparserImageRef({ crmparserImage: ref })).toBe(ref);
  });
});
