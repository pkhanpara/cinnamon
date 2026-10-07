export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser. Feed it decoded text in whatever pieces the network delivers;
 * it returns the events completed so far and keeps the unfinished tail for the next call.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    // A frame ends at a blank line. Accept \n, \r\n and \r line endings.
    for (;;) {
      const m = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!m) break;
      const frame = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      const ev = parseFrame(frame);
      if (ev) out.push(ev);
    }
    return out;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line === '' || line.startsWith(':')) continue; // comment / keep-alive
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
