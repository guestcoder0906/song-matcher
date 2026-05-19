import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

const upload = multer({ dest: "uploads/" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/match-song", upload.single("media"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: "Spotify credentials are not configured. Please set them in the Secrets panel." 
        });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const uploadResult = await ai.files.upload({
        file: req.file.path,
        mimeType: req.file.mimetype,
      });

      // If it's a video, we need to poll until it's processed
      if (req.file.mimetype.startsWith("video/")) {
        let fileInfo = await ai.files.get({ name: uploadResult.name });
        while (fileInfo.state === "PROCESSING") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          fileInfo = await ai.files.get({ name: uploadResult.name });
        }
        if (fileInfo.state === "FAILED") {
          throw new Error("Video processing failed within Gemini.");
        }
      }

      const prompt = "Analyze this media and determine its \"vibe\" as it relates to music. Output purely a short phrase or list of keywords (maximum 5 words) that I can directly use as a Spotify search query to find songs that match the mood and content perfectly. Do not include any other text.";

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            fileData: {
              fileUri: uploadResult.uri,
              mimeType: uploadResult.mimeType,
            },
          },
          prompt,
        ],
      });

      const vibeKeywords = response.text?.trim() || "pop";

      // Clean up the uploaded file
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Failed to delete temp file:", err);
      });

      // Spotify Client Credentials Flow
      const authResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64"),
        },
        body: "grant_type=client_credentials",
      });

      const authData = await authResp.json();
      if (!authResp.ok || !authData.access_token) {
        throw new Error("Failed to authenticate with Spotify API: " + (authData.error_description || authData.error));
      }

      const token = authData.access_token;

      // Spotify Search
      // Often including random genres or broad vibe phrases is best
      const searchResp = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(vibeKeywords)}&type=track&limit=10`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      const searchData = await searchResp.json();
      
      if (!searchResp.ok) {
        throw new Error("Spotify search failed: " + (searchData.error?.message || "Unknown error"));
      }

      res.json({
        vibe: vibeKeywords,
        tracks: searchData.tracks?.items || [],
      });

    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "An expected error occurred." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
