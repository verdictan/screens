import { createContext, useContext, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const UndoContext = createContext(null);
export const useUndo = () => useContext(UndoContext);
export function UndoProvider({ children }) {
  const pending = useRef(new Map());
  const finish = (id, commit) => {
    const action = pending.current.get(id);
    if (!action) return;
    clearTimeout(action.timer);
    pending.current.delete(id);
    toast.dismiss(id);
    action.resolve(commit);
  };
  useEffect(() => () => {
    for (const [id, action] of pending.current) {
      toast.dismiss(id);
      clearTimeout(action.timer);
      action.resolve(false);
    }
    pending.current.clear();
  }, []);
  function waitForUndo(text) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      pending.current.set(id, { resolve, timer: setTimeout(() => finish(id, true), 7000) });
      toast.custom(() => <div className="undo-toast" role="status"><span>{text}</span><Button variant="secondary" size="sm" onClick={() => finish(id, false)}>Undo</Button></div>, { id, duration: Infinity, dismissible: false });
    });
  }
  return (
    <UndoContext.Provider value={waitForUndo}>
      {children}
    </UndoContext.Provider>
  );
}
