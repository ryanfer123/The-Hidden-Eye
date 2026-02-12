#!/usr/bin/env python3
"""
Deepfake image classification script.
Called from the Next.js API route via subprocess.

Input:  path to an image file (argv[1])
Output: JSON to stdout with prediction scores
"""

import sys
import json
import os
import logging

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.WARNING)

# Disable unnecessary warnings/logs
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

MODEL_ID = "dima806/deepfake_vs_real_image_detection"

# Cache the pipeline globally (only loads once per process,
# but since we're called via subprocess each time, this is per-invocation).
_pipeline = None

def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from transformers import pipeline
        _pipeline = pipeline(
            "image-classification",
            model=MODEL_ID,
            device="cpu",
        )
    return _pipeline


def classify(image_path: str) -> dict:
    pipe = get_pipeline()
    results = pipe(image_path)

    fake_score = 0.0
    real_score = 0.0

    for pred in results:
        label = pred["label"].lower()
        score = float(pred["score"])
        if label in ("fake", "artificial", "deepfake", "ai"):
            fake_score += score
        elif label in ("real", "human", "realism"):
            real_score += score

    # Complement if only one side matched
    if fake_score == 0 and real_score > 0:
        fake_score = 1.0 - real_score
    elif real_score == 0 and fake_score > 0:
        real_score = 1.0 - fake_score

    # Fallback: if neither label matched, flag as unknown / low-confidence
    if fake_score == 0 and real_score == 0:
        logger.warning("No matching labels found in model output — defaulting to 50/50")
        fake_score = 0.5
        real_score = 0.5

    is_fake = fake_score > real_score
    confidence = fake_score if is_fake else real_score

    return {
        "verdict": "fake" if is_fake else "verified",
        "confidence": round(confidence * 100, 1),
        "scores": {
            "artificial": round(fake_score * 100, 1),
            "human": round(real_score * 100, 1),
        },
    }


def main():
    if len(sys.argv) < 2:
        json.dump({"error": "No image path provided"}, sys.stdout)
        sys.exit(1)

    image_path = sys.argv[1]

    # Resolve and restrict the image path to the system temp directory
    allowed_base = os.path.realpath(os.sep + "tmp")
    resolved_path = os.path.realpath(image_path)
    if not resolved_path.startswith(allowed_base + os.sep) and resolved_path != allowed_base:
        json.dump({"error": "invalid image path"}, sys.stdout)
        sys.exit(1)
    image_path = resolved_path

    if not os.path.isfile(image_path):
        json.dump({"error": "image file not found"}, sys.stdout)
        sys.exit(1)

    try:
        result = classify(image_path)
        json.dump(result, sys.stdout)
    except Exception as e:
        logger.exception("Classification failed for image")
        json.dump({"error": "internal server error"}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
