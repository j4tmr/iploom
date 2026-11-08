import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { overlayStack } from "../core/overlay-stack.ts";
import { Icon, type IconName } from "./icon.tsx";
import { useOverlayLayer } from "./use-overlay-layer.ts";

export function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  ...props
}: {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className = "",
  ...props
}: {
  label: string;
  icon: IconName;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children render the control inside the label
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input select" {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
  dot,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue" | "violet";
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const percent = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <span
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span
        className="progress-fill"
        style={{ width: `${percent}%`, background: color }}
      />
    </span>
  );
}

export function EmptyState({
  icon = "sparkles",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
      </div>
      {children ? <div className="section-actions">{children}</div> : null}
    </div>
  );
}

/**
 * Elements a dialog may move focus to, in document order. Visibility is not
 * inspected: happy-dom has no layout, so `offsetParent`/`getBoundingClientRect`
 * would report every element hidden and break the trap in tests. Overlays that
 * hide a control use the `disabled`/`hidden` attributes this selector honors.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  wide,
  closeLabel = "Close",
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Accessible name for the header close button; callers pass `t("close")`. */
  closeLabel?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  // Escape and the backdrop both flow through the shared overlay stack, so a
  // dialog that opened on top of this one (the command palette) keeps Escape
  // for itself. The ref keeps the stable layer wired to the latest onClose.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  const requestClose = useCallback(() => latestClose.current(), []);
  const layer = useOverlayLayer(open, {
    onEscape: requestClose,
    onBackdrop: requestClose,
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  // Move focus into the dialog while it is open and hand it back to the
  // trigger on close. The dialog itself takes focus (it is tabIndex -1) so
  // screen readers announce the title instead of landing on the close button;
  // Tab then walks the controls through the trap below. A child marked
  // `autoFocus` keeps the focus React already moved to it during commit.
  //
  // The opener is captured during render, before the portal commits: React
  // applies a descendant's `autoFocus` while committing, so a passive effect
  // would read the dialog's own field as the previously focused element and
  // the restore would target a node that is unmounted by then.
  const opener = useRef<HTMLElement | SVGElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement || active instanceof SVGElement
        ? active
        : null;
  }
  wasOpen.current = open;
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus();
    }
    return () => {
      const target = opener.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only handles mouse dismissal; Escape is handled by the overlay stack
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          overlayStack.handleBackdrop(layer);
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const dialog = event.currentTarget;
          const focusables = focusableWithin(dialog);
          if (!focusables.length) {
            event.preventDefault();
            dialog.focus();
            return;
          }
          const first = focusables[0]!;
          const last = focusables[focusables.length - 1]!;
          const current = document.activeElement;
          const inside = current instanceof Node && dialog.contains(current);
          if (event.shiftKey) {
            // Shift-Tab from the first control (or from the dialog chrome,
            // which is not a tab stop itself) wraps to the last one.
            if (!inside || current === first || current === dialog) {
              event.preventDefault();
              last.focus();
            }
          } else if (!inside || current === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label={closeLabel} icon="close" onClick={requestClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

export function Cover({
  title,
  accent,
  size = "regular",
}: {
  title: string;
  accent: string;
  size?: "small" | "regular" | "large";
}) {
  const glyph = title.trim().slice(0, 1).toLocaleUpperCase() || "界";
  return (
    <span
      className={`cover cover-${size}`}
      style={{ "--cover": accent } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="cover-grid" />
      <span className="cover-glyph">{glyph}</span>
    </span>
  );
}

export function TagList({
  values,
  max = 4,
}: {
  values: string[];
  max?: number;
}) {
  return (
    <span className="tag-list">
      {values.slice(0, max).map((value) => (
        <span className="tag" key={value}>
          {value}
        </span>
      ))}
      {values.length > max ? (
        <span className="tag tag-more">+{values.length - max}</span>
      ) : null}
    </span>
  );
}

export function Toast({
  message,
  tone = "success",
}: {
  message: string;
  tone?: "success" | "error";
}) {
  return (
    <div className={`toast toast-${tone}`} role="status">
      <Icon name={tone === "success" ? "check" : "close"} size={16} />
      {message}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="field-grid">{children}</div>;
}

export function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
