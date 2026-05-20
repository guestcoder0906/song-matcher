import app from "./app";
import path from "path";

const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dynamic import to hide from Vercel tracer
    const viteModule = "vite";
    const { createServer: createViteServer } = await import(viteModule);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const expressModule = await import("express");
    const distPath = path.join(process.cwd(), "dist");
    app.use(expressModule.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

