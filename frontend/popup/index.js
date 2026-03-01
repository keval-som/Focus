// Entry point for the React popup.
// Webpack resolves this file and bundles it into dist/popup.bundle.js.

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
