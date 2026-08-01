import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { type actionFields } from './play';

export type ActionFormField = ReturnType<typeof actionFields>[number];

export function ActionFormOverlay({ title, fields, initialTarget, onClose }: {
  title: string;
  fields: ActionFormField[];
  initialTarget: string;
  onClose: (value: Record<string, unknown> | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    fields.map(field => [
      field.key,
      field.candidates?.some(candidate => candidate.value === initialTarget) ? initialTarget : '',
    ]),
  ));
  const submit = useCallback((): void => {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.key]?.trim() || '';
      if (field.required && !value) {
        setError(`${field.label} is required.`);
        return;
      }
      if (value) {
        if (field.kind === 'number') payload[field.key] = Number(value);
        else if (field.kind === 'boolean') payload[field.key] = value === 'true';
        else payload[field.key] = value;
      }
    }
    onClose(payload);
  }, [fields, onClose, values]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
  }, []);
  return <dialog
    id="action-form-dialog"
    ref={dialogRef}
    aria-labelledby="action-form-title"
    onCancel={() => onClose(null)}
  >
    <form method="dialog" class="action-form-card" onSubmit={event => { event.preventDefault(); submit(); }}>
      <h2 id="action-form-title">{title}</h2>
      <div class="form-body">
        {fields.map((field, index) => <label class="form-field" key={field.key}>
          <span>{field.label}{field.required ? ' *' : ''}</span>
          {field.candidates ? <select
            data-field={index}
            value={values[field.key] || ''}
            onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))}
          >
            <option value="">Choose...</option>
            {field.candidates.map(candidate => <option key={candidate.value} value={candidate.value}>{candidate.icon} {candidate.label}</option>)}
          </select> : field.kind === 'boolean' ? <select
            data-field={index}
            value={values[field.key] || ''}
            onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))}
          >
            <option value="">Choose...</option><option value="true">yes</option><option value="false">no</option>
          </select> : <input
            data-field={index}
            type={field.kind === 'number' ? 'number' : 'text'}
            value={values[field.key] || ''}
            onInput={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))}
          />}
        </label>)}
        <div class="form-error" role="alert">{error}</div>
      </div>
      <div class="form-actions">
        <button type="button" data-form-cancel onClick={() => onClose(null)}>Cancel</button>
        <button type="submit" data-form-submit>Submit</button>
      </div>
    </form>
  </dialog>;
}
