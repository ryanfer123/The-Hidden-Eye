import { NextRequest, NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";

// Using dima806/deepfake_vs_real_image_detection as it is currently active/warm
// Alternative: prithivMLmods/Deep-Fake-Detector-v2-Model
const HF_MODEL = "dima806/deepfake_vs_real_image_detection";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const raw = formData.get("file");

    if (!raw || !(raw instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const file: File = raw;

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type" },
        { status: 415 }
      );
    }

    const hfToken = process.env.HF_API_TOKEN;
    if (!hfToken) {
       return NextResponse.json({ error: "Server configuration error: Missing API Token" }, { status: 500 });
    }

    const hf = new HfInference(hfToken);
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type });

    try {
      const result = await hf.imageClassification({
        model: HF_MODEL,
        data: blob,
      });

      // Normalize labels from different models
      // dima806 uses: "REAL" and "FAKE"
      // umm-maybe uses: "human" and "artificial"
      
      let artificialScore = 0;
      let humanScore = 0;

      // Find scores based on flexible label matching
      const fakePred = result.find(p => 
        p.label.toLowerCase() === "fake" || 
        p.label.toLowerCase() === "artificial" || 
        p.label.toLowerCase() === "ai"
      );
      
      const realPred = result.find(p => 
        p.label.toLowerCase() === "real" || 
        p.label.toLowerCase() === "human"
      );

      if (fakePred) artificialScore = fakePred.score;
      if (realPred) humanScore = realPred.score;

      // If we couldn't find standard labels, log the output for debugging
      if (!fakePred && !realPred) {
        console.error("Unexpected predictions format:", JSON.stringify(result));
        return NextResponse.json(
          {
            error: `Unable to classify image. Model returned unexpected labels: ${result.map(p => p.label).join(", ")}`,
          },
          { status: 422 }
        );
      }

      const isAI = artificialScore > humanScore;
      // If one label is missing, assume the other is complementary
      if (!fakePred) artificialScore = 1 - humanScore;
      if (!realPred) humanScore = 1 - artificialScore;

      const confidence = isAI ? artificialScore : humanScore;

      return NextResponse.json({
        verdict: isAI ? "fake" : "verified",
        confidence: Math.round(confidence * 1000) / 10,
        scores: {
          artificial: Math.round(artificialScore * 1000) / 10,
          human: Math.round(humanScore * 1000) / 10,
        },
      });

    } catch (err: any) {
      console.error("Hugging Face API error:", err);
      
      const status = err.statusCode || 502;
      const message = err.message || "Detection service unavailable";

      if (status === 503) {
        return NextResponse.json(
          { error: "Model is loading (cold start), please try again in ~20 seconds." },
          { status: 503 }
        );
      }
      
      if (status === 410 || status === 404) {
         return NextResponse.json(
          { error: `Model not found or unavailable (Status: ${status}).` },
          { status: status }
        );
      }

      return NextResponse.json(
        { error: `Detection service error: ${message}` },
        { status: status }
      );
    }

  } catch (err) {
    console.error("Scan API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
