// vite.config.ts
import { sveltekit } from "file:///home/jse/Escritorio/gop/node_modules/@sveltejs/kit/src/exports/vite/index.js";
import { defineConfig } from "file:///home/jse/Escritorio/gop/node_modules/vite/dist/node/index.js";
import path from "path";
var vite_config_default = defineConfig({
  plugins: [sveltekit()],
  test: {
    globals: true,
    environment: "node"
  },
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib")
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".es": "text"
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9qc2UvRXNjcml0b3Jpby9nb3BcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL2pzZS9Fc2NyaXRvcmlvL2dvcC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9qc2UvRXNjcml0b3Jpby9nb3Avdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBzdmVsdGVraXQgfSBmcm9tICdAc3ZlbHRlanMva2l0L3ZpdGUnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuXHRwbHVnaW5zOiBbc3ZlbHRla2l0KCldLFxuXHR0ZXN0OiB7XG5cdFx0Z2xvYmFsczogdHJ1ZSxcblx0XHRlbnZpcm9ubWVudDogJ25vZGUnLFxuXHR9LFxuXHRyZXNvbHZlOiB7XG5cdFx0YWxpYXM6IHtcblx0XHRcdCRsaWI6IHBhdGgucmVzb2x2ZShcIi4vc3JjL2xpYlwiKSxcblx0XHR9LFxuXHR9LFxuXHRvcHRpbWl6ZURlcHM6IHtcblx0XHRlc2J1aWxkT3B0aW9uczoge1xuXHRcdFx0bG9hZGVyOiB7XG5cdFx0XHRcdCcuZXMnOiAndGV4dCcsXG5cdFx0XHR9LFxuXHRcdH0sXG5cdH0sXG59KTtcblxuY29uc3QgY29uZmlnID0ge1xuXHQvLyBcdTIwMjZcblx0c3NyOiB7XG5cdFx0bm9FeHRlcm5hbDogWyd0aHJlZSddXG5cdH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMFAsU0FBUyxpQkFBaUI7QUFDcFIsU0FBUyxvQkFBb0I7QUFDN0IsT0FBTyxVQUFVO0FBRWpCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzNCLFNBQVMsQ0FBQyxVQUFVLENBQUM7QUFBQSxFQUNyQixNQUFNO0FBQUEsSUFDTCxTQUFTO0FBQUEsSUFDVCxhQUFhO0FBQUEsRUFDZDtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1IsT0FBTztBQUFBLE1BQ04sTUFBTSxLQUFLLFFBQVEsV0FBVztBQUFBLElBQy9CO0FBQUEsRUFDRDtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ2IsZ0JBQWdCO0FBQUEsTUFDZixRQUFRO0FBQUEsUUFDUCxPQUFPO0FBQUEsTUFDUjtBQUFBLElBQ0Q7QUFBQSxFQUNEO0FBQ0QsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
