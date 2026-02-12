import { NextRequest, NextResponse } from "next/server";
import { InferenceClient } from "@huggingface/inference";
import exifr from "exifr";
import { writeFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { tmpdir } from "os";
import path from "path";

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Local Python deepfake face model
const PYTHON_BIN =
  process.env.PYTHON_BIN ?? "/tmp/verilens-venv/bin/python3";
const CLASSIFY_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "classify.py",
);

// Remote HF Inference API for general AI-image detection
const HF_API_TOKEN = process.env.HF_API_TOKEN ?? "";
const AI_IMAGE_MODEL = "umm-maybe/AI-image-detector";
const hfClient = new InferenceClient(HF_API_TOKEN || undefined);

/* ------------------------------------------------------------------ */
/*  Python subprocess helper                                            */
/* ------------------------------------------------------------------ */

interface ClassifyResult {
  verdict: "fake" | "verified";
  confidence: number;
  scores: { artificial: number; human: number };
  error?: string;
}

function runClassifier(imagePath: string): Promise<ClassifyResult> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [CLASSIFY_SCRIPT, imagePath],
      {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, TOKENIZERS_PARALLELISM: "false" },
      },
      (err, stdout, stderr) => {
        if (stderr) {
          console.log("[scan:py:stderr]", stderr.slice(0, 500));
        }
        if (err) {
          console.error("[scan] Python classifier error:", err.message);
          try {
            const data = JSON.parse(stdout);
            if (data.error) return reject(new Error(data.error));
          } catch {
            /* ignore */
          }
          return reject(err);
        }
        try {
          const data = JSON.parse(stdout);
          if (data.error) return reject(new Error(data.error));
          resolve(data as ClassifyResult);
        } catch {
          reject(new Error("Failed to parse classifier output"));
        }
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/*  HF Inference API — general AI-image detector                       */
/* ------------------------------------------------------------------ */

interface HFClassifyResult {
  fakeScore: number;
  realScore: number;
  error?: string;
}

async function runHFClassifier(buffer: ArrayBuffer, mimeType: string): Promise<HFClassifyResult> {
  try {
    const blob = new Blob([buffer], { type: mimeType });
    const results = await hfClient.imageClassification({
      model: AI_IMAGE_MODEL,
      data: blob,
    });

    let fakeScore = 0;
    let realScore = 0;

    for (const pred of results) {
      const label = pred.label.toLowerCase();
      if (label === "artificial" || label === "ai" || label === "fake") {
        fakeScore += pred.score;
      } else if (label === "human" || label === "real") {
        realScore += pred.score;
      }
    }

    // Complement if only one side matched
    if (fakeScore === 0 && realScore > 0) fakeScore = 1 - realScore;
    else if (realScore === 0 && fakeScore > 0) realScore = 1 - fakeScore;

    return { fakeScore, realScore };
  } catch (err) {
    console.error("[scan] HF API classifier error:", err);
    return { fakeScore: 0, realScore: 0, error: String(err) };
  }
}

/* ------------------------------------------------------------------ */
/*  SynthID / digital-watermark detection                               */
/* ------------------------------------------------------------------ */

interface SynthIDResult {
  detected: boolean;
  confidence: number;
  signals: string[];
}

async function detectSynthID(buffer: ArrayBuffer): Promise<SynthIDResult> {
  const signals: string[] = [];
  const bytes = new Uint8Array(buffer);
  const ascii = new TextDecoder("ascii", { fatal: false }).decode(bytes);

  /* 1. C2PA / JUMBF with SynthID-specific assertions */
  const c2paPatterns = [
    { pattern: /c2pa\.hash\.synthid/i, label: "C2PA SynthID hash assertion" },
    { pattern: /steg\.synthid/i, label: "C2PA SynthID steganographic assertion" },
    { pattern: /c2pa\.soft\-binding/i, label: "C2PA soft-binding assertion (watermark)" },
    { pattern: /synthid/i, label: "SynthID marker in binary payload" },
    { pattern: /google[:\-]ai[:\-]watermark/i, label: "Google AI watermark identifier" },
  ];
  for (const { pattern, label } of c2paPatterns) {
    if (pattern.test(ascii)) signals.push(label);
  }

  /* 2. Google-specific XMP / IPTC metadata */
  try {
    const meta = await exifr.parse(buffer, {
      tiff: true, xmp: true, iptc: true, mergeOutput: true,
      translateKeys: true, translateValues: true,
    });
    if (meta) {
      const dst = String(meta.DigitalSourceType ?? meta.digitalSourceType ?? "").toLowerCase();
      if (dst.includes("trainedalgorithmicmedia"))
        signals.push("IPTC DigitalSourceType: trainedAlgorithmicMedia (SynthID-standard)");

      const allValues = JSON.stringify(meta).toLowerCase();
      if (/google[:\-]?ai/i.test(allValues) || /gimg:/i.test(allValues))
        signals.push("Google AI XMP namespace detected");
      if (/deepmind/i.test(allValues))
        signals.push("DeepMind reference found in metadata");
      if (meta.ContentCredentials || meta.contentCredentials)
        signals.push("ContentCredentials field present");

      const sw = String(meta.Software ?? meta.CreatorTool ?? "").toLowerCase();
      if (/\b(imagen|gemini|google\s*ai|dreambooth)\b/i.test(sw))
        signals.push(`Google AI tool detected in Software: "${meta.Software ?? meta.CreatorTool}"`);
    }
  } catch { /* Non-fatal */ }

  /* 3. PNG custom chunks (iTXt, tEXt, zTXt) */
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const keywords = ["synthid", "google:watermark", "ai:watermark", "c2pa", "content-credentials", "google-ai"];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const chunkLen =
        ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

      // Validate chunk bounds before reading data
      if (chunkLen < 0 || offset + 8 + chunkLen > bytes.length || offset + 12 + chunkLen > bytes.length) {
        break;
      }

      const chunkType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (chunkType === "tEXt" || chunkType === "iTXt" || chunkType === "zTXt") {
        const chunkData = new TextDecoder("ascii", { fatal: false })
          .decode(bytes.slice(offset + 8, offset + 8 + Math.min(chunkLen, 4096)));
        for (const kw of keywords) {
          if (chunkData.toLowerCase().includes(kw))
            signals.push(`PNG ${chunkType} chunk contains "${kw}"`);
        }
      }
      offset += 12 + chunkLen;
    }
  }

  /* 4. (Quantization heuristic removed from SynthID — handled in metadata) */

  const detected = signals.length > 0;
  let confidence = 0;
  if (detected) {
    const high = signals.filter(s =>
      /synthid|c2pa|google.*ai|deepmind|content.?credentials|trainedalgorithmicmedia/i.test(s),
    ).length;
    confidence = Math.min(98, 40 + high * 20 + (signals.length - high) * 8);
  }
  return { detected, confidence, signals };
}

/* ------------------------------------------------------------------ */
/*  General metadata / EXIF AI-marker detection                         */
/* ------------------------------------------------------------------ */

const AI_SOFTWARE_PATTERNS: RegExp[] = [
  /midjourney/i, /dall[·\-\s]?e/i, /stable[.\-\s]?diffusion/i,
  /imagen/i, /firefly/i, /leonardo\.ai/i, /nightcafe/i, /artbreeder/i,
  /dreamstudio/i, /comfyui/i, /automatic1111/i, /invoke\s?ai/i,
  /novelai/i, /\bflux\b/i, /\bgemini\b/i, /\bchatgpt\b/i, /\bopenai\b/i,
];

const AI_PARAM_PATTERNS: RegExp[] = [
  /\bnegative[_\s]prompt\b/i,
  /\bsampler\b.*\b(euler|ddim|dpm|lms|heun)\b/i,
  /\bsteps[:\s]+\d+/i, /\bcfg[_\s]scale[:\s]+\d/i,
  /\bseed[:\s]+\d{5,}/i,
  /\bmodel[:\s].*\b(sd|sdxl|flux|checkpoint)\b/i,
];

interface MetadataResult {
  isAI: boolean;
  confidence: number;
  markers: string[];
  tool?: string;
}

async function detectMetadata(buffer: ArrayBuffer): Promise<MetadataResult> {
  const markers: string[] = [];
  let tool: string | undefined;

  try {
    const meta = await exifr.parse(buffer, {
      tiff: true, xmp: true, iptc: true, icc: true, jfif: true, ihdr: true,
      translateKeys: true, translateValues: true, mergeOutput: true,
    });

    if (meta) {
      const dst = String(meta.DigitalSourceType ?? meta.digitalSourceType ?? "").toLowerCase();
      if (dst.includes("trainedalgorithmicmedia") || dst.includes("algorithmicmedia"))
        markers.push("DigitalSourceType: trainedAlgorithmicMedia (AI-generated indicator)");
      else if (dst.includes("compositesynthetic"))
        markers.push("DigitalSourceType: compositeSynthetic (synthetic composite)");

      const textFields: Record<string, string> = {
        Software: String(meta.Software ?? meta.software ?? ""),
        CreatorTool: String(meta.CreatorTool ?? meta.creatortool ?? ""),
        Creator: String(meta.Creator ?? meta.Artist ?? meta.Author ?? ""),
      };
      for (const [key, value] of Object.entries(textFields)) {
        if (!value) continue;
        for (const pattern of AI_SOFTWARE_PATTERNS) {
          if (pattern.test(value)) {
            markers.push(`${key}: "${value}"`);
            if (!tool) tool = value;
            break;
          }
        }
      }

      const descFields = [meta.ImageDescription, meta.Description, meta.UserComment, meta.Comment].filter(Boolean);
      for (const field of descFields) {
        const text = String(field);
        for (const p of AI_PARAM_PATTERNS) {
          if (p.test(text)) { markers.push("Generation parameters detected in metadata"); break; }
        }
      }

      const blob = Object.values(textFields).concat(descFields.map(String)).join(" ");
      if (/\bai[.\-\s]?generated\b/i.test(blob) || /\bsynthetically\s+generated\b/i.test(blob))
        markers.push("Explicit AI-generation declaration found in metadata");
    }
  } catch { /* Non-fatal */ }

  try {
    const ascii = new TextDecoder("ascii", { fatal: false }).decode(buffer);
    if (ascii.includes("c2pa") || ascii.includes("C2PA"))
      markers.push("C2PA Content Credentials detected (may include SynthID)");
    if (ascii.includes("jumb") || ascii.includes("jumd"))
      markers.push("JUMBF metadata container detected");
  } catch { /* ignore */ }

  /* JPEG quantization table heuristic (mild indicator) */
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 0; i < bytes.length - 70; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xdb) {
        const tableStart = i + 5;
        if (tableStart + 64 < bytes.length) {
          const unique = new Set(Array.from(bytes.slice(tableStart, tableStart + 64))).size;
          if (unique <= 4) {
            markers.push("JPEG quantization table is abnormally uniform (possible AI generation)");
            break;
          }
        }
      }
    }
  }

  const isAI = markers.length > 0;
  // Weight strong markers (software match, generation params, explicit declaration) more than heuristics
  const strongMarkers = markers.filter(m => !m.includes("quantization table") && !m.includes("JUMBF"));
  const confidence = isAI
    ? Math.min(95, 50 + strongMarkers.length * 15 + (markers.length - strongMarkers.length) * 5)
    : 0;
  return { isAI, confidence, markers, tool };
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const raw = formData.get("file");

    if (!raw || !(raw instanceof File))
      return NextResponse.json({ error: "No file provided." }, { status: 400 });

    const file: File = raw;

    if (file.size > MAX_UPLOAD_BYTES)
      return NextResponse.json({ error: "File too large (max 50 MB)." }, { status: 413 });

    if (!ALLOWED_MIME_TYPES.includes(file.type))
      return NextResponse.json({ error: "Unsupported file type. Upload PNG, JPG, or WEBP." }, { status: 415 });

    const buffer = await file.arrayBuffer();

    /* ── Phase 1 — SynthID watermark detection ──────────────────────── */
    const synthIDResult = await detectSynthID(buffer);

    if (synthIDResult.detected) {
      const metadataResult = await detectMetadata(buffer);
      const allMarkers = [...new Set([...synthIDResult.signals, ...metadataResult.markers])];
      const finalConf = metadataResult.isAI
        ? Math.min(99, Math.max(synthIDResult.confidence, metadataResult.confidence) + 5)
        : synthIDResult.confidence;

      return NextResponse.json({
        verdict: "fake" as const,
        confidence: finalConf,
        scores: { artificial: finalConf, human: Math.round((100 - finalConf) * 10) / 10 },
        detectionMethod: metadataResult.isAI ? "synthid+metadata" : "synthid",
        metadataMarkers: allMarkers,
      });
    }

    /* ── Phase 2 — General metadata / EXIF detection ────────────────── */
    const metadataResult = await detectMetadata(buffer);

    // Only short-circuit on metadata if we have strong evidence (not just quantization heuristic)
    const strongMetadataCount = metadataResult.markers.filter(
      (m) => !m.includes("quantization table") && !m.includes("JUMBF"),
    ).length;

    if (strongMetadataCount >= 2) {
      return NextResponse.json({
        verdict: "fake" as const,
        confidence: metadataResult.confidence,
        scores: { artificial: metadataResult.confidence, human: Math.round((100 - metadataResult.confidence) * 10) / 10 },
        detectionMethod: "metadata",
        metadataMarkers: metadataResult.markers,
      });
    }

    /* ── Phase 3 — AI forensics (dual model) ────────────────────────── */
    /*    Model A: Local PyTorch ViT — face deepfake detection             */
    /*    Model B: HF API — general AI-generated image detection           */
    /*    Final score = max(A, B) so we catch both deepfakes AND AI art.   */

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const tmpPath = path.join(tmpdir(), `verilens-${Date.now()}.${ext}`);
    await writeFile(tmpPath, Buffer.from(buffer));

    // Run both models in parallel for speed.
    const [localResult, hfResult] = await Promise.allSettled([
      runClassifier(tmpPath).finally(() => unlink(tmpPath).catch(() => {})),
      runHFClassifier(buffer, file.type),
    ]);

    const local = localResult.status === "fulfilled" ? localResult.value : null;
    const hf    = hfResult.status === "fulfilled" ? hfResult.value : null;

    if (local) {
      console.log("[scan] Local model:", JSON.stringify(local.scores));
    } else {
      console.error("[scan] Local model failed:", (localResult as PromiseRejectedResult).reason);
    }
    if (hf) {
      console.log("[scan] HF API model:", JSON.stringify({ fake: Math.round(hf.fakeScore * 1000) / 10, real: Math.round(hf.realScore * 1000) / 10 }));
    }

    // If both failed, fall back to metadata or error.
    if (!local && (!hf || hf.error)) {
      if (metadataResult.isAI) {
        return NextResponse.json({
          verdict: "fake" as const,
          confidence: metadataResult.confidence,
          scores: { artificial: metadataResult.confidence, human: Math.round((100 - metadataResult.confidence) * 10) / 10 },
          detectionMethod: "metadata",
          metadataMarkers: metadataResult.markers,
        });
      }
      return NextResponse.json(
        { error: "AI detection models unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    // Combine: take the maximum "fake" score from either model.
    const localFakePct  = local ? local.scores.artificial : 0;
    const localHumanPct = local ? local.scores.human : 100;
    const hfFakePct     = hf && !hf.error ? Math.round(hf.fakeScore * 1000) / 10 : 0;
    const hfHumanPct    = hf && !hf.error ? Math.round(hf.realScore * 1000) / 10 : 100;

    // Use the model with the HIGHER fake score (catches both deepfakes and AI art).
    let artificialPct: number;
    let humanPct: number;
    let dominantModel: string;

    if (hfFakePct > localFakePct) {
      artificialPct = hfFakePct;
      humanPct = hfHumanPct;
      dominantModel = "ai-image-detector";
    } else {
      artificialPct = localFakePct;
      humanPct = localHumanPct;
      dominantModel = "deepfake-detector";
    }

    let detectionMethod = "ai-forensics";

    // Metadata boost.
    if (metadataResult.isAI) {
      detectionMethod = "combined";
      if (artificialPct > humanPct) {
        artificialPct = Math.min(99.9, artificialPct * 1.1);
        humanPct = Math.round((100 - artificialPct) * 10) / 10;
      }
    }

    /* ── Phase 4 — Final verdict ────────────────────────────────────── */
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

    const finalArtificial = clamp(artificialPct);
    const finalHuman = clamp(humanPct);
    const verdict = finalHuman > 50 ? "verified" : "fake";
    const confidence = verdict === "verified" ? finalHuman : finalArtificial;

    console.log(`[scan] Final: ${verdict} (${confidence}%) via ${dominantModel}`);

    return NextResponse.json({
      verdict,
      confidence,
      scores: { artificial: finalArtificial, human: finalHuman },
      detectionMethod,
      ...(metadataResult.markers.length > 0 && { metadataMarkers: metadataResult.markers }),
    });
  } catch (err) {
    console.error("[scan] Unhandled error:", err instanceof Error ? err.stack : err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
