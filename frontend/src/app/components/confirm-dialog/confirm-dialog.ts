import { Injectable, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirming button, e.g. "Delete". */
  confirm: string;
  /** Destructive actions get a red confirming button. */
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">Cancel</button>
      <button mat-flat-button type="button" [class.danger]="data.danger" [mat-dialog-close]="true" cdkFocusInitial>
        {{ data.confirm }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .danger { --mat-button-filled-container-color: var(--loss); --mat-button-filled-label-text-color: #fff; }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(MAT_DIALOG_DATA);
}

/** In-app replacement for window.confirm: resolves true only when the user confirms. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  async ask(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmOptions, boolean>(ConfirmDialog, {
      data: options,
      width: '26rem',
      maxWidth: '92vw',
      autoFocus: 'dialog',
    });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
