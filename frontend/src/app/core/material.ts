import { Provider } from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';

/**
 * Outlined, compact form fields without the required asterisk. Provided by the lazy pages that
 * host forms (Login, the Settings shell for its routed children) rather than in app.config,
 * where the import would pull Material's form-field code into the initial bundle (~60 kB).
 */
export const FORM_FIELD_DEFAULTS: Provider = {
  provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
  useValue: { appearance: 'outline', subscriptSizing: 'dynamic', hideRequiredMarker: true },
};
