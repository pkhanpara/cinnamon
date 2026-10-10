import { conversationMarkdown, isSafeUrl, renderMarkdown } from './markdown';

function dom(src: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(src);
  return div;
}

describe('renderMarkdown', () => {
  it('renders bold, lists, code and breaks', () => {
    const d = dom('**Up 3%** today\nsecond line\n\n- one\n- two\n\n`x`');
    expect(d.querySelector('strong')?.textContent).toBe('Up 3%');
    expect(d.querySelector('br')).not.toBeNull();
    expect([...d.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(d.querySelector('code')?.textContent).toBe('x');
  });

  it('keeps http(s) links and opens them safely in a new tab', () => {
    const a = dom('[Reuters](https://example.com/a)').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/a');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](java&#115;cript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](vbscript:msgbox)',
    '[x](/settings/users)',
    '[x](//evil.example)',
  ])('drops the href of %s but keeps the text', (src) => {
    const d = dom(src);
    const a = d.querySelector('a');
    expect(a?.hasAttribute('href') ?? false).toBe(false);
    expect(d.textContent).toContain('x');
  });

  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror=alert(1)>', 'img'],
    ['<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['![pixel](https://tracker.example/p.gif)', 'img'],
    ['<a href="https://x" onclick="alert(1)">y</a>', '[onclick]'],
  ])('neutralises %s', (src, selector) => {
    const d = dom(src);
    expect(d.querySelector(selector)).toBeNull();
    expect(d.querySelector('[onerror],[onclick],[style]')).toBeNull();
  });

  it('shows raw HTML as text instead of dropping it silently', () => {
    expect(dom('<script>alert(1)</script>').textContent).toContain('<script>alert(1)</script>');
  });

  it('copes with unfinished markdown mid-stream', () => {
    expect(dom('**half bold').textContent).toContain('half bold');
    expect(dom('```\ncode not closed').querySelector('pre')).not.toBeNull();
    expect(renderMarkdown('')).toBe('');
  });
});

describe('isSafeUrl', () => {
  it('accepts only absolute http(s)', () => {
    expect(isSafeUrl('https://a.example')).toBe(true);
    expect(isSafeUrl('HTTP://a.example')).toBe(true);
    expect(isSafeUrl('mailto:a@b.c')).toBe(false);
    expect(isSafeUrl('relative/path')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
  });
});

describe('conversationMarkdown', () => {
  it('writes a heading and one paragraph per non-empty turn, as markdown source', () => {
    const md = conversationMarkdown('NVDA', 'fake', [
      { role: 'user', text: 'Risks?' },
      { role: 'assistant', text: '- **Legal**: a lawsuit\n' },
      { role: 'assistant', text: '  ' },
    ]);
    expect(md).toBe('# Ask AI: NVDA\n\n**You:** Risks?\n\n**AI (fake):** - **Legal**: a lawsuit\n');
  });

  it('omits the model name when unknown', () => {
    expect(conversationMarkdown('X', null, [{ role: 'assistant', text: 'hi' }])).toContain(
      '**AI:** hi',
    );
  });
});
