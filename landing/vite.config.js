import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Los logotipos oficiales se importan desde frontend/src/puertaya-brand.
  // La carpeta raíz del repositorio queda disponible durante el build.
});
