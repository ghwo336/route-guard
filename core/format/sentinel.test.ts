import { describe, expect, it } from 'vitest';
import { recipientLabel } from './sentinel';

describe('recipientLabel', () => {
  it('names router sentinels', () => {
    expect(recipientLabel('0x0000000000000000000000000000000000000001')).toBe('본인 (MSG_SENDER)');
    expect(recipientLabel('0x0000000000000000000000000000000000000002')).toBe(
      '라우터 내부 보관 (ADDRESS_THIS)',
    );
  });

  it('keeps other addresses (checksummed) and junk as-is', () => {
    expect(recipientLabel('0xbadbadbadbadbadbadbadbadbadbadbadbadbad0')).toBe(
      '0xBAdBadbADBaDBADBadbADbaDBadBaDBADBadBAD0',
    );
    expect(recipientLabel('0x0000000000000000000000000000000000000003')).toBe(
      '0x0000000000000000000000000000000000000003',
    );
    expect(recipientLabel('nope')).toBe('nope');
  });
});
