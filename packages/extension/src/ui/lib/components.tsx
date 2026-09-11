import type { ComponentChildren, JSX } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { t } from './i18n';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  'aria-label'?: string;
  class?: string;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  type = 'button',
  class: cls,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={`btn btn-${variant}${cls ? ` ${cls}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={rest['aria-label']}
    >
      {children}
    </button>
  );
}

export interface CardProps {
  title?: ComponentChildren;
  description?: ComponentChildren;
  actions?: ComponentChildren;
  children: ComponentChildren;
  id?: string;
}

export function Card({ title, description, actions, children, id }: CardProps) {
  const headingId = useId();
  return (
    <section class="card" id={id} aria-labelledby={title ? headingId : undefined}>
      {(title || actions) && (
        <header class="card-head">
          <div>
            {title && (
              <h2 class="card-title" id={headingId}>
                {title}
              </h2>
            )}
            {description && <p class="card-desc">{description}</p>}
          </div>
          {actions && <div class="card-actions">{actions}</div>}
        </header>
      )}
      <div class="card-body">{children}</div>
    </section>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ComponentChildren;
  description?: ComponentChildren;
  disabled?: boolean;
  /** Stable value exposed as `data-toggle` so tests and e2e can target the input. */
  name?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, name }: ToggleProps) {
  const id = useId();
  return (
    <div class="toggle-row">
      <input
        class="toggle-input"
        type="checkbox"
        role="switch"
        id={id}
        name={name}
        data-toggle={name}
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <label class="toggle-label" for={id}>
        <span class="toggle-track" aria-hidden="true">
          <span class="toggle-knob" />
        </span>
        <span class="toggle-text">
          <span class="toggle-title">{label}</span>
          {description && <span class="toggle-desc">{description}</span>}
        </span>
      </label>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Rendered after the label, e.g. "(default)". */
  marker?: string;
}

export interface SegmentedProps<T extends string> {
  legend: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Exposed as `data-segmented` for tests. */
  name?: string;
}

/** Radiogroup rendered as a segmented control, with roving tabindex and arrow keys. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  disabled,
  name,
}: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const move = (delta: number) => {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[(index + delta + options.length) % options.length]?.focus();
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home': {
        event.preventDefault();
        const first = options[0];
        if (first) onChange(first.value);
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = options[options.length - 1];
        if (last) onChange(last.value);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div class="segmented-wrap">
      <div
        class="segmented"
        role="radiogroup"
        aria-label={legend}
        data-segmented={name}
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              class="segment"
              aria-checked={selected}
              data-value={option.value}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              title={option.description}
              onClick={() => onChange(option.value)}
            >
              <span class="segment-label">{option.label}</span>
              {option.marker && <span class="segment-marker">{option.marker}</span>}
            </button>
          );
        })}
      </div>
      <p class="segmented-desc" aria-live="polite">
        {options.find((o) => o.value === value)?.description ?? ''}
      </p>
    </div>
  );
}

export interface FieldProps {
  label: ComponentChildren;
  description?: ComponentChildren;
  children: (id: string) => ComponentChildren;
}

/** Label + optional description wrapper for a single form control. */
export function Field({ label, description, children }: FieldProps) {
  const id = useId();
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {label}
      </label>
      {children(id)}
      {description && <p class="field-desc">{description}</p>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <p class="spinner" role="status">
      {label ?? t('common_loading')}
    </p>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div class="errorbox" role="alert">
      <span>{error || t('common_error')}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          {t('common_retry')}
        </Button>
      )}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const level = ratio > 0.9 ? 'high' : ratio > 0.7 ? 'mid' : 'low';
  return (
    <div class="meter" role="img" aria-label={label} data-level={level}>
      <div class="meter-fill" style={`width:${(ratio * 100).toFixed(1)}%`} />
    </div>
  );
}
