"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, CheckCircle2, AlertTriangle, FileUp, Loader2, ScanLine, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";

export function Scanner() {
  const [activeTab, setActiveTab] = useState("verify");
  const [isScanning, setIsScanning] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<"verified" | "fake" | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [scores, setScores] = useState<{ artificial: number; human: number }>({ artificial: 0, human: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanTimestamp, setScanTimestamp] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [detectionMethod, setDetectionMethod] = useState<string | null>(null);
  const [metadataMarkers, setMetadataMarkers] = useState<string[]>([]);
  const [synthIDResult, setSynthIDResult] = useState<{ detected: boolean; confidence: number; signals: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanAbortControllerRef = useRef<AbortController | null>(null);
  const { isConnected } = useAccount();

  const scanId = useMemo(
    () => Math.random().toString(36).substring(2, 11).toUpperCase(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result]
  );

  // Manage preview object URL with proper cleanup
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (scanAbortControllerRef.current) {
        scanAbortControllerRef.current.abort();
      }
    };
  }, []);

  const validateFile = (selectedFile: File): boolean => {
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    const ALLOWED_TYPES = [
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
    ];

    if (selectedFile.size > MAX_SIZE) {
      setScanError("File too large. Maximum size is 50MB.");
      return false;
    }

    if (!ALLOWED_TYPES.includes(selectedFile.type)) {
      setScanError("Unsupported file type. Please upload SVG, PNG, JPG, WEBP, or MP4.");
      return false;
    }

    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setResult(null);
        setScanError(null);
      } else {
        // Clear input so user can retry same file if needed (after fixing error?)
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selectedFile = e.dataTransfer.files[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
        setResult(null);
        setScanError(null);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const startScan = async () => {
    if (!file) return;
    setIsScanning(true);
    setResult(null);
    setScanError(null);
    setScanTimestamp(null);

    // Create AbortController
    const controller = new AbortController();
    scanAbortControllerRef.current = controller;
    
    // Set timeout – first request may need to download the ONNX model (~120 s)
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 120_000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/scan", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Unexpected response (HTTP ${res.status}).`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Scan failed.");
      }

      // Basic validation
      if (!data.verdict || typeof data.confidence !== "number") {
        throw new Error("Invalid server response format.");
      }

      const safeScores =
        data.scores &&
        typeof data.scores === "object" &&
        typeof data.scores.human === "number" &&
        typeof data.scores.artificial === "number"
          ? data.scores
          : { human: 0, artificial: 0 };

      setResult(data.verdict);
      setConfidence(data.confidence);
      setScores(safeScores);
      setScanTimestamp(new Date().toLocaleString());
      setDetectionMethod(data.detectionMethod ?? null);
      setMetadataMarkers(Array.isArray(data.metadataMarkers) ? data.metadataMarkers : []);
      setSynthIDResult(data.synthID ?? null);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setScanError("Scan timed out. Please try again.");
      } else {
        setScanError(err instanceof Error ? err.message : "Network error. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      scanAbortControllerRef.current = null;
      setIsScanning(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setConfidence(0);
    setScores({ artificial: 0, human: 0 });
    setScanError(null);
    setScanTimestamp(null);
    setDetectionMethod(null);
    setMetadataMarkers([]);
    setSynthIDResult(null);
    setIsScanning(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    
    // Abort any ongoing scan
    if (scanAbortControllerRef.current) {
      scanAbortControllerRef.current.abort();
      scanAbortControllerRef.current = null;
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto perspective-1000">
      <Tabs defaultValue="verify" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-slate-900/50 backdrop-blur-sm border border-slate-800">
          <TabsTrigger value="verify">Verify (Consumer)</TabsTrigger>
          <TabsTrigger value="certify">Certify (Creator)</TabsTrigger>
        </TabsList>
        
        <TabsContent value="verify" className="mt-6 space-y-6">
          <Card className="border-slate-800 bg-slate-950/40 backdrop-blur-md overflow-hidden relative group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="h-5 w-5 text-primary" />
                Deepfake Detection Scanner
              </CardTitle>
              <CardDescription>
                Upload media to analyze authenticity using on-chain records and AI forensics.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!file ? (
                <div 
                  role="button"
                  tabIndex={0}
                  aria-label="Upload file, click or press Enter/Space"
                  className="border-2 border-dashed border-slate-700 rounded-lg p-10 text-center hover:border-primary/50 transition-colors cursor-pointer bg-slate-900/20 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-950"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={handleKeyDown}
                >
                  <input 
                    type="file" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept="image/*,video/*"
                  />
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 rounded-full bg-slate-900 shadow-inner">
                      <Upload className="h-8 w-8 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        Click to upload or drag and drop
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        SVG, PNG, JPG or MP4 (max. 50MB)
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-slate-900/50 aspect-video flex items-center justify-center">
                  <div className="absolute top-2 right-2 z-10">
                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-500/20 hover:text-red-400" onClick={reset}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {preview ? (
                    <img
                      src={preview}
                      alt="Preview"
                      className="absolute inset-0 w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <FileUp className="h-10 w-10 text-slate-500" />
                      <span className="text-sm text-slate-400">{file.name}</span>
                    </div>
                  )}

                  {/* Scanning Animation */}
                  <AnimatePresence>
                    {isScanning && (
                      <motion.div
                        initial={{ top: "0%" }}
                        animate={{ top: "100%" }}
                        transition={{ 
                          duration: 2, 
                          repeat: Infinity, 
                          ease: "linear",
                          repeatType: "loop" 
                        }}
                        className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_15px_rgba(34,197,94,0.6)] z-20"
                      />
                    )}
                  </AnimatePresence>
                  
                  {/* Scanning Grid Overlay */}
                  {isScanning && (
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20 pointer-events-none" />
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              {scanError && (
                <p className="text-sm text-red-400 text-center w-full">{scanError}</p>
              )}
              <Button 
                className="w-full gap-2" 
                size="lg" 
                onClick={startScan} 
                disabled={!file || isScanning || !!result}
              >
                {isScanning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing Forensics...
                  </>
                ) : result ? (
                  "Scan Complete"
                ) : (
                  <>
                    <ScanLine className="h-4 w-4" />
                    Start Verification
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="certify" className="mt-6">
          <Card className="border-slate-800 bg-slate-950/40 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Certify & Mint</CardTitle>
              <CardDescription>
                Anchor your original content to the blockchain to protect against unauthorized deepfakes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isConnected ? (
                <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/20 text-center">
                  <div className="p-3 rounded-full bg-red-500/10 mb-4">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-200">Wallet Connection Required</h3>
                  <p className="text-sm text-slate-400 max-w-xs mt-2 mb-4">
                    You must connect your wallet to sign the authenticity proof and mint the certificate.
                  </p>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-400">
                  <p>Creator tools unlocked for {activeTab}</p>
                  {/* Placeholder for Creator Flow */}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Results Card */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mt-6"
          >
            <Card className={cn(
              "border-l-4 backdrop-blur-xl shadow-2xl overflow-hidden",
              result === "verified" ? "border-l-primary border-slate-800 bg-slate-900/60" : "border-l-red-500 border-red-900/50 bg-red-950/10"
            )}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {result === "verified" ? (
                      <Badge variant="outline" className="border-primary text-primary bg-primary/10 px-3 py-1 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        VERIFIED AUTHENTIC
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="px-3 py-1 text-sm">
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                        POTENTIAL DEEPFAKE
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 font-mono">
                    ID: {scanId}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Confidence</p>
                    <p className={cn(
                      "text-2xl font-bold",
                      result === "verified" ? "text-primary" : "text-red-500"
                    )}>{confidence}% <span className="text-sm font-normal text-slate-400">{result === "verified" ? "Human" : "AI Generated"}</span></p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Timestamp</p>
                    <p className="text-sm font-mono text-slate-300">{scanTimestamp}</p>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-800/50">
                  {/* Detection Method */}
                  {detectionMethod && (
                    <div className="flex items-center gap-2 pb-2">
                      <span className="text-xs text-slate-500 uppercase tracking-wider">Method:</span>
                      <Badge variant="outline" className="text-xs font-mono border-slate-700 text-slate-300">
                        {detectionMethod === "synthid"
                          ? "SynthID Watermark"
                          : detectionMethod === "synthid+ai"
                            ? "SynthID + AI Forensics"
                            : detectionMethod === "metadata"
                              ? "SynthID / Metadata"
                              : detectionMethod === "combined"
                                ? "Metadata + AI Forensics"
                                : "AI Forensics"}
                      </Badge>
                    </div>
                  )}

                  {/* SynthID Result */}
                  {synthIDResult && synthIDResult.detected && (
                    <div className="pt-2 pb-2 border-t border-slate-800/50 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">SynthID Watermark</p>
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          DETECTED
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Watermark confidence:</span>
                        <span className="text-xs font-mono text-red-400">{synthIDResult.confidence}%</span>
                      </div>
                      {synthIDResult.signals.length > 0 && (
                        <ul className="space-y-1">
                          {synthIDResult.signals.map((s, i) => (
                            <li key={i} className="text-xs text-red-400/80 font-mono flex items-start gap-1.5">
                              <span className="mt-0.5 shrink-0">🛡️</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">Human Probability</span>
                      <span className="font-mono text-primary">{scores.human}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${scores.human}%` }} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">AI Generated Probability</span>
                      <span className="font-mono text-red-400">{scores.artificial}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5">
                      <div className="bg-red-500 h-1.5 rounded-full transition-all" style={{ width: `${scores.artificial}%` }} />
                    </div>
                  </div>

                  {/* Metadata Markers */}
                  {metadataMarkers.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/50 space-y-1.5">
                      <p className="text-xs text-slate-500 uppercase tracking-wider">SynthID / Metadata Signals</p>
                      <ul className="space-y-1">
                        {metadataMarkers.map((m, i) => (
                          <li key={i} className="text-xs text-amber-400/80 font-mono flex items-start gap-1.5">
                            <span className="mt-0.5 shrink-0">&#x26A0;</span>
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}