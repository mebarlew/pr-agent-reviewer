import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("prAgent", {
  getAuthToken: () => ipcRenderer.invoke("auth-token"),
  showWindow: () => ipcRenderer.invoke("show-window"),
});
