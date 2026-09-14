import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreferencesProvider } from "./app/preferences.js";
import { SessionProvider } from "./app/session.js";
import { ThemeProvider } from "./app/theme.js";
import { router } from "./routes.js";
import "./styles/tokens.css";

const queryClient = new QueryClient();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <PreferencesProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </QueryClientProvider>
      </PreferencesProvider>
    </ThemeProvider>
  </StrictMode>,
);
