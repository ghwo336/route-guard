/**
 * Korean particle (조사) selection by whether the word ends in a final consonant (받침).
 * Works on what the word sounds like: Hangul by its last syllable, digits and Latin
 * letters by how they are read (e.g. "0" 영, "L" 엘). Trailing parentheticals are
 * ignored, so "UniversalRouter 2.0(0x66a9…a8af)" is judged by "2.0".
 */
export type JosaPair = '을/를' | '이/가' | '은/는' | '으로/로';

// digits read as 영 일 이 삼 사 오 육 칠 팔 구
const DIGIT_FINAL: Record<string, 'none' | 'rieul' | 'other'> = {
  '0': 'other', '1': 'rieul', '2': 'none', '3': 'other', '4': 'none',
  '5': 'none', '6': 'other', '7': 'rieul', '8': 'rieul', '9': 'none',
}; // prettier-ignore

// Latin letter names ending in a consonant: L 엘, M 엠, N 엔, R 알
const LATIN_FINAL: Record<string, 'rieul' | 'other'> = {
  l: 'rieul',
  m: 'other',
  n: 'other',
  r: 'rieul',
};

/** 'none' = no 받침, 'rieul' = ㄹ 받침 (matters for 으로/로), 'other' = any other 받침. */
export function finalSound(word: string): 'none' | 'rieul' | 'other' {
  let w = word.trim();
  // drop trailing "(…)" groups, then trailing punctuation / symbols
  for (let prev = ''; prev !== w;) {
    prev = w;
    // keep ')' so the next pass can drop the whole group
    w = w.replace(/\s*\([^()]*\)\s*$/, '').replace(/[^\p{L}\p{N})]+$/u, '');
  }
  const ch = w.at(-1);
  if (ch === undefined) return 'none';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (jong === 0) return 'none';
    return jong === 8 ? 'rieul' : 'other'; // 8 = ㄹ
  }
  if (ch in DIGIT_FINAL) return DIGIT_FINAL[ch]!;
  return LATIN_FINAL[ch.toLowerCase()] ?? 'none';
}

/** The particle alone, e.g. josa('주소', '을/를') === '를'. */
export function josa(word: string, pair: JosaPair): string {
  const f = finalSound(word);
  const [withFinal, withoutFinal] = pair.split('/') as [string, string];
  if (pair === '으로/로') return f === 'other' ? withFinal : withoutFinal;
  return f === 'none' ? withoutFinal : withFinal;
}

/** Word followed by its particle, e.g. withJosa('swap 호출', '을/를') === 'swap 호출을'. */
export function withJosa(word: string, pair: JosaPair): string {
  return `${word}${josa(word, pair)}`;
}
