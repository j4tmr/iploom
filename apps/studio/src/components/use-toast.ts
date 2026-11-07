import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastMessage {
  message: string;
  tone: "success" | "error";
}

/**
 * One transient message at a time. Each notify replaces the previous timer and
 * dismisses the message on its own, so a toast can never inherit the lifetime
 * of an earlier one (or outlive the component that raised it).
 */
export function useToast(duration = 2600) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setToast(null);
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastMessage["tone"] = "success") => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setToast({ message, tone });
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setToast(null);
      }, duration);
    },
    [duration],
  );

  useEffect(() => dismiss, [dismiss]);

  return { toast, notify, dismiss };
}
