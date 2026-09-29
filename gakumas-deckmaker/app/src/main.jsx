import React from "react";
import { createRoot } from "react-dom/client";
import "./storage.js"; // window.storage を用意（App より先に読み込む）
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
