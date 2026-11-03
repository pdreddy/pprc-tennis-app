import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import ClerkAuthProvider from "./auth/ClerkAuthProvider";
import { emergentAuth } from "./external-auth";
import "./style.css";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, refetchInterval: 15000 },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        {emergentAuth ? (
          <ClerkAuthProvider>
            <App />
          </ClerkAuthProvider>
        ) : (
          <App />
        )}
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
