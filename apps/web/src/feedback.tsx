import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "./ui";

// Confirmation for irreversible actions. Focus starts on Cancel so an Enter
// key press never confirms by accident.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="row">
        <button
          type="button"
          className="button secondary"
          autoFocus
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="button" className="button primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };
const ToastContext = createContext<(message: string, tone?: Tone) => void>(
  () => undefined,
);

// Non-blocking feedback. Messages sit in a polite live region so screen readers
// announce them without moving focus, and each one clears after a few seconds.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string, tone: Tone = "info") => {
    const id = next.current++;
    setItems((list) => [...list, { id, message, tone }]);
    window.setTimeout(
      () => setItems((list) => list.filter((t) => t.id !== id)),
      4000,
    );
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
