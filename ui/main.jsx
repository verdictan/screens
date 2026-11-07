import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { Toaster } from "./components/ui/sonner";
import { UndoProvider } from "./lib/undo";
createRoot(document.getElementById("root")).render(<UndoProvider><App /><Toaster position="bottom-right" /></UndoProvider>);
