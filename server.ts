import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

const upload = multer({ dest: "/tmp/uploads/" });
const userSpotifyCache = new Map<string, { data: string, timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

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
      config: {
        mimeType: req.file.mimetype,
      },
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

    const authDataText = await authResp.text();
    let authData;
    try {
      authData = JSON.parse(authDataText);
    } catch (e) {
      throw new Error("Invalid response from Spotify Auth API");
    }
    if (!authResp.ok || !authData.access_token) {
      throw new Error("Failed to authenticate with Spotify API: " + (authData.error_description || authData.error));
    }

    const token = authData.access_token;

    // Spotify Search
    const searchResp = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(vibeKeywords)}&type=track&limit=10`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    const searchDataText = await searchResp.text();
    let searchData;
    try {
      searchData = JSON.parse(searchDataText);
    } catch (e) {
      throw new Error("Invalid response from Spotify Search API");
    }
    
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

app.get("/api/auth/spotify", (req, res) => {
  const scope = "user-read-private user-read-email user-top-read user-read-recently-played playlist-read-private playlist-read-collaborative";
  const host = req.get("host");
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const defaultBaseUrl = `${protocol}://${host}`;
  const baseUrl = (process.env.APP_URL || defaultBaseUrl).replace(/\/$/, "");
  const redirect_uri = `${baseUrl}/api/auth/spotify/callback`;
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  
  if (!client_id) {
    return res.status(500).send("SPOTIFY_CLIENT_ID not configured.");
  }

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("client_id", client_id);
  authUrl.searchParams.append("scope", scope);
  authUrl.searchParams.append("redirect_uri", redirect_uri);
  authUrl.searchParams.append("show_dialog", "true");

  res.redirect(authUrl.toString());
});

app.get("/api/auth/spotify/callback", async (req, res) => {
  const code = req.query.code as string;
  const host = req.get("host");
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const defaultBaseUrl = `${protocol}://${host}`;
  const baseUrl = (process.env.APP_URL || defaultBaseUrl).replace(/\/$/, "");
  const redirect_uri = `${baseUrl}/api/auth/spotify/callback`;

  try {
    const authResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
      }).toString(),
    });

    const authDataText = await authResp.text();
    let authData;
    try {
      authData = JSON.parse(authDataText);
    } catch(e) {
      throw new Error("Invalid response from Spotify Auth API");
    }
    if (!authResp.ok) throw new Error(authData?.error_description || authData?.error || "Failed to get access token");

    res.redirect(`/?spotify_token=${authData.access_token}`);
  } catch (error: any) {
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/api/profile-taste", async (req, res) => {
  const { accessToken, prompt } = req.body;
  if (!accessToken) return res.status(400).json({ error: "No Spotify access token provided." });

  try {
    let spotifyDataString = "";

    if (userSpotifyCache.has(accessToken) && (Date.now() - userSpotifyCache.get(accessToken)!.timestamp) < CACHE_TTL_MS) {
      spotifyDataString = userSpotifyCache.get(accessToken)!.data;
    } else {
      const fetchSpotify = async (endpoint: string) => {
        const r = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (r.status === 429) {
          const retryAfter = r.headers.get('retry-after') || "5";
          throw new Error(`Spotify rate limit hit. Try again in ${retryAfter} seconds.`);
        }
        if (!r.ok) {
          console.warn(`Spotify API error on ${endpoint}`, r.status);
          return { items: [] };
        }
        const text = await r.text();
        try {
          return JSON.parse(text);
        } catch(e) {
          console.warn(`Spotify API returned non-JSON on ${endpoint}`);
          return { items: [] };
        }
      };
  
      const [topArtistsLong, topArtistsShort, topTracksLong, topTracksShort, playlists, recentlyPlayed] = await Promise.all([
        fetchSpotify('me/top/artists?time_range=long_term&limit=15'),
        fetchSpotify('me/top/artists?time_range=short_term&limit=10'),
        fetchSpotify('me/top/tracks?time_range=long_term&limit=15'),
        fetchSpotify('me/top/tracks?time_range=short_term&limit=10'),
        fetchSpotify('me/playlists?limit=10'),
        fetchSpotify('me/player/recently-played?limit=15')
      ]);
  
      const artistLong = topArtistsLong.items?.map((a: any) => a.name).join(", ");
      const artistShort = topArtistsShort.items?.map((a: any) => a.name).join(", ");
      const trackLong = topTracksLong.items?.map((t: any) => `${t.name} by ${t.artists?.[0]?.name}`).join(", ");
      const trackShort = topTracksShort.items?.map((t: any) => `${t.name} by ${t.artists?.[0]?.name}`).join(", ");
      const playlistNames = playlists.items?.map((p: any) => p.name).join(", ");
      const recentNames = recentlyPlayed.items?.map((i: any) => `${i.track?.name} by ${i.track?.artists?.[0]?.name}`).join(", ");

      spotifyDataString = `Top Artists (All Time): ${artistLong || "None"}
Top Artists (Recent Month): ${artistShort || "None"}
Top Tracks (All Time): ${trackLong || "None"}
Top Tracks (Recent Month): ${trackShort || "None"}
Public/Saved Playlists: ${playlistNames || "None"}
Recently Played: ${recentNames || "None"}`;

      userSpotifyCache.set(accessToken, { data: spotifyDataString, timestamp: Date.now() });
    }

    const finalPrompt = `You are an expert music psychologist and behavioral analyst. Here is a comprehensive overview of a user's Spotify history and habits:

${spotifyDataString}

User's query/prompt: "${prompt || "Tell me something I don't know about myself based on my music taste. Be specific, insightful, and slightly surprising. Do not be literal."}"

Provide a deep, highly accurate, and smart analysis based on the data. Do NOT simply list back the artists or tracks to the user. Present a psychological or aesthetic profile and explicitly answer their prompt if provided. Keep it engaging, perceptive, and diverse in your conclusions.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: finalPrompt,
    });

    res.json({ analysis: response.text });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to analyze taste." });
  }
});

export default app;

async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
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

if (!process.env.VERCEL) {
  startServer();
}
