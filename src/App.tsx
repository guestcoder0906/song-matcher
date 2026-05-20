/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Upload, Music, Loader2, Image as ImageIcon, Video, X, Play, LogIn, Sparkles, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function App() {
  const [activeTab, setActiveTab] = useState<'vibe' | 'profile'>('vibe');
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ vibe: string; tracks: any[] } | null>(null);
  const [error, setError] = useState("");
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  const [profilePrompt, setProfilePrompt] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileResult, setProfileResult] = useState<string | null>(null);
  const [profileError, setProfileError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("spotify_token");
    const err = params.get("error");
    
    if (token) {
      setSpotifyToken(token);
      setActiveTab('profile');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (err) {
      setProfileError(err);
      setActiveTab('profile');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleLogin = () => {
    window.location.href = "/api/auth/spotify";
  };

  const profileTaste = async () => {
    if (!spotifyToken) return;
    setProfileLoading(true);
    setProfileError("");
    setProfileResult(null);

    try {
      const res = await fetch("/api/profile-taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: spotifyToken, prompt: profilePrompt }),
      });
      
      let data;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(res.ok ? "Invalid JSON response from server." : responseText || "Failed to analyze taste");
      }

      if (!res.ok) throw new Error(data.error || "Failed to analyze taste");
      setProfileResult(data.analysis);
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleFileChange = (newFile: File) => {
    setFile(newFile);
    setResult(null);
    setError("");
    setPlayingAudio(null);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    // Create preview
    if (preview) URL.revokeObjectURL(preview);
    const objectUrl = URL.createObjectURL(newFile);
    setPreview(objectUrl);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileChange(e.target.files[0]);
    }
  };

  const clearFile = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setResult(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const matchSong = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("media", file);

    try {
      const res = await fetch("/api/match-song", {
        method: "POST",
        body: formData,
      });

      let data;
      const responseText = await res.text();
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(res.ok ? "Invalid JSON response from server." : responseText || "Failed to match song");
      }
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to match song");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const togglePlay = (previewUrl: string | null) => {
    if (!previewUrl) return;
    
    if (playingAudio === previewUrl) {
      audioRef.current?.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = previewUrl;
        audioRef.current.play();
        setPlayingAudio(previewUrl);
      } else {
        const audio = new Audio(previewUrl);
        audio.onended = () => setPlayingAudio(null);
        audio.play();
        audioRef.current = audio;
        setPlayingAudio(previewUrl);
      }
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 px-4 py-12 md:py-20 font-sans">
      <div className="max-w-3xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-green-500/10 text-green-400 rounded-2xl mb-2">
            <Music className="w-8 h-8" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-br from-white to-neutral-400 bg-clip-text text-transparent">
            {activeTab === 'vibe' ? 'Vibe Matcher' : 'Music Profiler'}
          </h1>
          <p className="text-lg text-neutral-400 max-w-xl mx-auto">
            {activeTab === 'vibe' 
              ? 'Upload an image or video, and Gemini will analyze its mood to find the perfect Spotify soundtrack.' 
              : 'Connect your Spotify to let Gemini analyze your listening history and profile your personality.'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-8">
          <div className="bg-neutral-900 border border-neutral-800 rounded-full p-1 flex gap-1">
            <button
              onClick={() => setActiveTab('vibe')}
              className={`px-6 py-2 rounded-full font-medium transition-colors ${activeTab === 'vibe' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
            >
              Match a Vibe
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-6 py-2 rounded-full font-medium transition-colors ${activeTab === 'profile' ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
            >
              Profile My Taste
            </button>
          </div>
        </div>

        <div className={activeTab === 'vibe' ? 'block space-y-12' : 'hidden'}>
          {/* Upload Area */}
          <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 shadow-2xl backdrop-blur-sm"
        >
          <AnimatePresence mode="wait">
            {!file ? (
              <motion.div
                key="upload-zone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-neutral-700 hover:border-green-500/50 rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-colors group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileSelect}
                  accept="image/*,video/*"
                />
                <div className="p-4 bg-neutral-800 group-hover:bg-green-500/20 rounded-full transition-colors mb-4 text-neutral-400 group-hover:text-green-400">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-medium mb-2">Drop your media here</h3>
                <p className="text-neutral-500 text-sm">Supports images and short videos</p>
              </motion.div>
            ) : (
              <motion.div
                key="preview-zone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="relative rounded-2xl overflow-hidden bg-black/50 aspect-video md:aspect-[21/9] flex items-center justify-center group border border-neutral-800">
                  <button
                    onClick={clearFile}
                    className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-md transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  {file.type.startsWith("video/") ? (
                    <video src={preview!} className="w-full h-full object-contain" controls />
                  ) : (
                    <img src={preview!} alt="Upload preview" className="w-full h-full object-contain" />
                  )}
                </div>

                <button
                  onClick={matchSong}
                  disabled={loading}
                  className="w-full py-4 px-6 bg-green-500 hover:bg-green-400 text-black rounded-xl font-medium text-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing Vibe...
                    </>
                  ) : (
                    <>
                      <Music className="w-5 h-5" />
                      Find Matching Song
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-center"
            >
              <p>{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Area */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-4 border-b border-neutral-800">
                <h2 className="text-2xl font-semibold">Matched Tracks</h2>
                <div className="px-4 py-2 bg-neutral-900 rounded-full text-sm text-neutral-400 flex items-center gap-2 border border-neutral-800">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Detected vibe: <span className="text-neutral-200 font-medium capitalize">"{result.vibe}"</span>
                </div>
              </div>

              {result.tracks.length === 0 ? (
                <div className="text-center py-12 text-neutral-500">
                  <p>No tracks found for this vibe on Spotify. Try a different image!</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {result.tracks.map((track, i) => (
                    <motion.div
                      key={track.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-4 hover:bg-neutral-800/80 transition-colors"
                    >
                      <div className="relative w-16 h-16 md:w-20 md:h-20 shrink-0 rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group cursor-pointer" onClick={() => togglePlay(track.preview_url)}>
                        {track.album?.images?.[0]?.url ? (
                          <img 
                            src={track.album.images[0].url} 
                            alt={track.album.name} 
                            className={`w-full h-full object-cover transition-opacity ${playingAudio === track.preview_url ? 'opacity-50' : 'group-hover:opacity-75'}`} 
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-600">
                            <Music className="w-8 h-8" />
                          </div>
                        )}
                        
                        {track.preview_url && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            {playingAudio === track.preview_url ? (
                              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                                <div className="w-3 h-3 bg-black rounded-sm animate-pulse" />
                              </div>
                            ) : (
                              <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 drop-shadow-md transition-opacity fill-white" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <a 
                          href={track.external_urls?.spotify} 
                          target="_blank" 
                          rel="noreferrer"
                          className="font-medium text-lg text-white hover:text-green-400 transition-colors truncate block"
                        >
                          {track.name}
                        </a>
                        <p className="text-neutral-400 truncate">
                          {track.artists.map((a: any) => a.name).join(", ")}
                        </p>
                      </div>

                      {track.preview_url === null && (
                         <div className="hidden sm:block text-xs text-neutral-600 px-3 py-1 bg-neutral-800/50 rounded-full">
                           No preview
                         </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </div>

        <div className={activeTab === 'profile' ? 'block w-full max-w-2xl mx-auto mt-12' : 'hidden'}>
          {!spotifyToken ? (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-8 shadow-2xl backdrop-blur-sm text-center">
              <div className="w-16 h-16 bg-green-500/10 text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogIn className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-medium mb-3">Connect your account</h3>
              <p className="text-neutral-400 mb-8 max-w-md mx-auto">
                To profile your music taste, we need to securely connect to your Spotify account to analyze your top artists, tracks, and recently played songs.
              </p>
              <button
                onClick={handleLogin}
                className="py-3 px-8 bg-green-500 hover:bg-green-400 text-black rounded-full font-medium text-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
               >
                Connect with Spotify
              </button>
            </div>
          ) : (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-6 pb-6 border-b border-neutral-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-lg">Spotify Connected</h3>
                    <p className="text-xs text-green-400">Ready to analyze</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setSpotifyToken(null);
                    setProfileResult(null);
                  }}
                  className="text-sm text-neutral-500 hover:text-white transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <label className="block text-sm font-medium text-neutral-400">
                  Ask a question about yourself (optional)
                </label>
                <input
                  type="text"
                  value={profilePrompt}
                  onChange={(e) => setProfilePrompt(e.target.value)}
                  placeholder="e.g. What does my music say about my aesthetic?"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all"
                />
              </div>

              <button
                onClick={profileTaste}
                disabled={profileLoading}
                className="w-full py-4 px-6 bg-green-500 hover:bg-green-400 text-black rounded-xl font-medium text-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {profileLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing Data...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Profile My Taste
                  </>
                )}
              </button>

              <AnimatePresence>
                {profileError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center text-sm"
                  >
                    <p>{profileError}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {profileResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-8 pt-8 border-t border-neutral-800"
                  >
                    <div className="flex items-center gap-2 mb-4 text-green-400">
                      <Sparkles className="w-4 h-4" />
                      <h3 className="font-semibold text-sm uppercase tracking-wider">Analysis Complete</h3>
                    </div>
                    <div className="markdown-body text-neutral-300 leading-relaxed space-y-4">
                      <ReactMarkdown>{profileResult}</ReactMarkdown>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
