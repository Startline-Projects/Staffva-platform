"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ToastMessage {
  id: number;
  text: string;
}

interface ToastContextType {
  showToast: (msg: string) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: "#1C1B1A",
              color: "#fff",
              padding: "10px 18px",
              borderRadius: 9,
              fontSize: 13,
              fontFamily: "'DM Sans', sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 8,
              animation: "adc-toast-in 0.3s ease-out",
              boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}
          >
            <span style={{ fontSize: 15 }}>✓</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes adc-toast-in {
          from { transform: translateY(80px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
