import { describe, expect, it } from 'vitest';
import { finalSound, josa, withJosa } from './josa';

describe('josa', () => {
  it('Hangul by the last syllable', () => {
    expect(withJosa('swap 호출', '을/를')).toBe('swap 호출을');
    expect(withJosa('주문 사전 서명', '을/를')).toBe('주문 사전 서명을');
    expect(withJosa('호출 데이터', '을/를')).toBe('호출 데이터를');
    expect(withJosa('무제한', '이/가')).toBe('무제한이');
    expect(withJosa('사과', '은/는')).toBe('사과는');
    expect(withJosa('책', '은/는')).toBe('책은');
  });

  it('digits by how they are read', () => {
    expect(withJosa('0xBAdB…BAD0', '이/가')).toBe('0xBAdB…BAD0이'); // 영
    expect(withJosa('0x2222…2222', '이/가')).toBe('0x2222…2222가'); // 이
    expect(josa('…1', '을/를')).toBe('을'); // 일
    expect(josa('…3', '을/를')).toBe('을'); // 삼
    expect(josa('…4', '을/를')).toBe('를'); // 사
    expect(josa('…5', '을/를')).toBe('를'); // 오
    expect(josa('…6', '을/를')).toBe('을'); // 육
    expect(josa('…9', '을/를')).toBe('를'); // 구
  });

  it('Latin letters by their names (L M N R end in a consonant)', () => {
    expect(withJosa('100 USDC', '을/를')).toBe('100 USDC를');
    expect(withJosa('0.025 ETH', '을/를')).toBe('0.025 ETH를');
    expect(withJosa('SwapProxy', '이/가')).toBe('SwapProxy가');
    expect(withJosa('Permit2 서명', '이/가')).toBe('Permit2 서명이');
    expect(josa('…L', '을/를')).toBe('을');
    expect(josa('…m', '을/를')).toBe('을');
    expect(josa('…n', '이/가')).toBe('이');
    expect(josa('…R', '은/는')).toBe('은');
  });

  it('ignores trailing parentheticals and punctuation', () => {
    expect(withJosa('UniversalRouter 2.0(0x66a9…a8af)', '을/를')).toBe(
      'UniversalRouter 2.0(0x66a9…a8af)을',
    ); // 영
    expect(withJosa('SwapProxy (미검증)(0x02E5…b2a9)', '이/가')).toBe(
      'SwapProxy (미검증)(0x02E5…b2a9)가',
    );
    expect(withJosa('토큰 5 (decimals 알 수 없음)', '을/를')).toBe(
      '토큰 5 (decimals 알 수 없음)를',
    ); // 오
    expect(finalSound('주소.')).toBe('none');
    expect(finalSound('')).toBe('none');
    expect(finalSound('!!!')).toBe('none');
  });

  it('으로/로: ㄹ 받침 and no 받침 take 로', () => {
    expect(withJosa('router 0x2222…2222', '으로/로')).toBe('router 0x2222…2222로');
    expect(withJosa('0x…0001', '으로/로')).toBe('0x…0001로'); // 일 (ㄹ)
    expect(withJosa('0x…0000', '으로/로')).toBe('0x…0000으로'); // 영
    expect(withJosa('서울', '으로/로')).toBe('서울로');
    expect(withJosa('부산', '으로/로')).toBe('부산으로');
    expect(withJosa('바다', '으로/로')).toBe('바다로');
  });
});
