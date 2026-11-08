import { parentPort, workerData } from "node:worker_threads";
import { Store } from "./store.mjs";
import { executeAutomaticLease } from "./automation.mjs";

if (parentPort) {
  const controller = new AbortController();
  parentPort.on("message", message => { if (message.type === "abort") controller.abort(Error(message.reason || "Capture interrupted")); });
  const store = new Store(workerData.directory);
  try {
    const result = await executeAutomaticLease(store, workerData.job, controller.signal, event => parentPort.postMessage({ type: "event", event }));
    parentPort.postMessage({ type: "result", result });
  } catch (error) { parentPort.postMessage({ type: "error", message: error.message, status: error.status }); }
  finally { store.close(); parentPort.close(); }
}
