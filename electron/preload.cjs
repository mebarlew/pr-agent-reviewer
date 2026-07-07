const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("prAgent", {
  getAuthToken: () => ipcRenderer.invoke("auth-token"),
});
