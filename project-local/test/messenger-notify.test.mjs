/**
 * messenger/notify.ts — 알림 요약 추출(summarize) 단위 테스트
 *
 * 배경: last_assistant_message는 마크다운 원문이라 코드블록·불릿을 통째로
 * 담으면 알림이 장황해진다. summarize()는 코드블록을 걷어내고 첫 산문 문단만
 * 취해 마크다운 기호를 정리한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, clip } from '../src/messenger/notify.ts';

describe('summarize', () => {
  test('코드펜스 블록을 걷어낸다', () => {
    const input = [
      '이 디렉토리는 아무 역할도 하지 않습니다.',
      '',
      '```bash',
      'cp -r global/* ~/.claude/',
      'cp -r project-local/dist/* ~/.claude/dist/',
      '```',
    ].join('\n');
    const out = summarize(input, 200);
    assert.equal(out, '이 디렉토리는 아무 역할도 하지 않습니다.');
    assert.equal(out.includes('```'), false);
    assert.equal(out.includes('cp -r'), false);
  });

  test('헤더/불릿으로 시작하는 문단을 건너뛰고 첫 산문을 고른다', () => {
    const input = [
      '## 요약',
      '',
      '- 항목 1',
      '- 항목 2',
      '',
      '실제 결론은 이 문장이다.',
    ].join('\n');
    const out = summarize(input, 200);
    assert.equal(out, '실제 결론은 이 문장이다.');
  });

  test('인라인 마크다운 기호를 정리한다', () => {
    const input = '**중요**: `config.ts`를 보라. [문서](https://x.y)도 참고.';
    const out = summarize(input, 200);
    assert.equal(out, '중요: config.ts를 보라. 문서도 참고.');
  });

  test('상한을 넘으면 말줄임한다', () => {
    const out = summarize('가'.repeat(500), 100);
    assert.equal(out.length, 100);
    assert.equal(out.endsWith('…'), true);
  });

  test('산문이 하나도 없으면(전부 불릿) 첫 문단이라도 반환한다', () => {
    const out = summarize('- only\n- bullets', 200);
    assert.equal(out.length > 0, true);
  });

  test('빈 입력은 빈 문자열', () => {
    assert.equal(summarize('', 200), '');
    assert.equal(summarize('```\ncode\n```', 200), '');
  });

  test('clip은 순수 길이 자르기(회귀)', () => {
    assert.equal(clip('짧은 글', 100), '짧은 글');
    assert.equal(clip('가'.repeat(10), 5).length, 5);
  });
});
