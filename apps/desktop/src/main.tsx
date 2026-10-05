import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startStore } from "./store.ts";
import "./styles.css";
startStore();
createRoot(document.getElementById("root")!).render(<App />);
