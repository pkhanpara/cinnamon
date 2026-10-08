import { SseParser } from './sse';

describe('SseParser', () => {
  it('parses a complete frame', () => {
    expect(new SseParser().push('event: delta\ndata: {"text":"hi"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"hi"}' },
    ]);
  });

  it('waits for the blank line and handles frames split anywhere', () => {
    const p = new SseParser();
    const whole = 'event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {}\n\n';
    const out = [...whole].flatMap((ch) => p.push(ch)); // one character at a time
    expect(out.map((e) => e.event)).toEqual(['delta', 'done']);
  });

  it('does not emit an unfinished tail', () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: x')).toEqual([]);
    expect(p.push('\n\n')).toEqual([{ event: 'delta', data: 'x' }]);
  });

  it('returns several events from one chunk, in order', () => {
    const out = new SseParser().push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
    expect(out.map((e) => e.data)).toEqual(['1', '2']);
  });

  it('accepts CRLF, joins multi-line data, ignores comments and defaults the event name', () => {
    const out = new SseParser().push(': keep-alive\r\n\r\ndata: one\r\ndata: two\r\n\r\n');
    expect(out).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('drops frames without data', () => {
    expect(new SseParser().push('event: x\n\n')).toEqual([]);
  });
});
