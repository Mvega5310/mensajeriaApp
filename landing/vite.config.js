import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Los logotipos viven en src/assets/brand (independientes de frontend/src/puertaya-brand).
});
