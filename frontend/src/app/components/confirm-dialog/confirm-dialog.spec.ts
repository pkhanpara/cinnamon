import { TestBed } from '@angular/core/testing';
import { ConfirmService } from './confirm-dialog';

async function open(): Promise<{ answer: Promise<boolean>; buttons: HTMLButtonElement[] }> {
  const answer = TestBed.inject(ConfirmService).ask({
    title: 'Delete "Main"?',
    message: 'Its imported holdings will be deleted too.',
    confirm: 'Delete',
    danger: true,
  });
  await new Promise((r) => setTimeout(r));
  TestBed.tick();
  const dialog = document.querySelector('[role=dialog]') as HTMLElement;
  expect(dialog.textContent).toContain('Delete "Main"?');
  expect(dialog.textContent).toContain('Its imported holdings will be deleted too.');
  return { answer, buttons: Array.from(dialog.querySelectorAll('button')) };
}

describe('ConfirmService', () => {
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove()));

  it('resolves true when the user confirms', async () => {
    const { answer, buttons } = await open();
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Delete']);
    buttons[1].click();
    TestBed.tick();
    expect(await answer).toBe(true);
  });

  it('resolves false on Cancel', async () => {
    const { answer, buttons } = await open();
    buttons[0].click();
    TestBed.tick();
    expect(await answer).toBe(false);
  });
});
