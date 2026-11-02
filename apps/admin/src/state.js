// Shared view state; credentials stay in this browser session.
export const state = {
  publicUrl: undefined,
  token: sessionStorage.getItem("modai-token") || "",
  packages: [],
  documents: [],
  session: null,
  projectRecords: [],
  runRecords: [],
  keyRecords: [],
  currentView: "packages",
};
