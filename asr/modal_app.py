"""dali-asr: Modal app for batch meeting transcription + speaker diarization.

See specs/meeting-transcription.md ("dali-asr (Modal, T4)", "Security",
"Modal setup") for the design this implements.

Deploy per environment:

    modal deploy asr/modal_app.py --env staging
    modal deploy asr/modal_app.py --env prod

Model choice: the spec's primary suggestion is `nemo_toolkit[asr]` for
Parakeet. This app uses `onnx-asr` instead (see the image definition
below for why) — `nvidia/parakeet-tdt-0.6b-v3` is one of onnx-asr's
supported pretrained models and returns word-level timestamps, at a
fraction of nemo_toolkit's dependency and image-build weight.

Pure logic (PCM assembly, request validation, response shaping, HMAC
signing) lives in pipeline.py so it's unit-testable without a GPU,
torch, or the Modal SDK. This module is the Modal wiring plus the
actual model calls — asr/tests exercises pipeline.process_channel with
fake transcribe/diarize callables instead of calling these for real.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import fastapi
import modal

import pipeline

logger = logging.getLogger("dali-asr")
logging.basicConfig(level=logging.INFO)

APP_NAME = "dali-asr"

ASR_MODEL_NAME = "nemo-parakeet-tdt-0.6b-v3"  # onnx-asr's name for nvidia/parakeet-tdt-0.6b-v3
DIARIZATION_MODEL_NAME = "pyannote/speaker-diarization-community-1"

CALLBACK_TIMEOUT_SECONDS = 30
CHUNK_FETCH_TIMEOUT_SECONDS = 30


def _bake_model_weights():
    """Build step: download both models into the image so no weights are
    fetched at runtime. Reads HF_TOKEN from the Modal Secret named
    "huggingface" — only needed here, never at request time.
    """
    import onnx_asr
    from pyannote.audio import Pipeline as DiarizationPipeline

    hf_token = os.environ["HF_TOKEN"]
    onnx_asr.load_model(ASR_MODEL_NAME)
    DiarizationPipeline.from_pretrained(DIARIZATION_MODEL_NAME, token=hf_token)


# Why onnx-asr instead of nemo_toolkit[asr]:
#   nemo_toolkit pulls in pytorch-lightning, hydra-core, omegaconf,
#   sentencepiece, braceexpand, editdistance, lhotse, webdataset, and more —
#   a large, fast-moving dependency tree that regularly breaks Docker builds
#   and adds minutes to every image build. deploy-asr.yml runs `modal deploy`
#   on every push to asr/**, so a heavy, fragile build directly slows and
#   risks every deploy. onnx-asr supports the same nvidia/parakeet-tdt-0.6b-v3
#   checkpoint (exported to ONNX) with word-level timestamps, via
#   onnxruntime-gpu instead of the NeMo/Lightning stack — torch is still
#   needed for pyannote.audio, but we avoid layering NeMo's tree on top of it.
# A lighter image also matches the spec's 30-60s cold start expectation.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.8.0",
        "torchaudio==2.8.0",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "onnx-asr[gpu,hub]",
        "pyannote.audio",
        "fastapi[standard]",
        "httpx",
        "numpy",
    )
    .add_local_python_source("pipeline")
    .run_function(
        _bake_model_weights,
        secrets=[modal.Secret.from_name("huggingface")],
        gpu="T4",
    )
)

app = modal.App(APP_NAME, image=image)


def _diarize_secret() -> str:
    return os.environ["DIARIZE_SECRET"]


# --- model calls (not unit-tested directly; GPU/weights required) ----------
#
# asr/tests mocks these out by injecting fake transcribe/diarize callables
# into pipeline.process_channel instead. The exact onnx-asr / pyannote call
# shapes below should be confirmed against the installed package versions
# (asr/bench.py is how the lead does that against a real deploy) before the
# first production recording.

_asr_model = None
_diarization_model = None


def _get_asr_model():
    global _asr_model
    if _asr_model is None:
        import onnx_asr

        _asr_model = onnx_asr.load_model(ASR_MODEL_NAME)
    return _asr_model


def _get_diarization_model():
    global _diarization_model
    if _diarization_model is None:
        import torch
        from pyannote.audio import Pipeline as DiarizationPipeline

        _diarization_model = DiarizationPipeline.from_pretrained(DIARIZATION_MODEL_NAME)
        _diarization_model.to(torch.device("cuda"))
    return _diarization_model


def _pcm_to_float32(pcm: bytes):
    import numpy as np

    return np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0


def _run_parakeet(pcm: bytes) -> list:
    """-> [{"start": s, "end": s, "text": w}, ...] word-level, relative to
    the start of this segment's PCM."""
    if not pcm:
        return []

    model = _get_asr_model()
    audio = _pcm_to_float32(pcm)
    result = model.recognize(audio, sample_rate=pipeline.SAMPLE_RATE_HZ, timestamps=True)
    return [{"start": start, "end": end, "text": word} for word, start, end in result.timestamps]


def _run_pyannote(pcm: bytes, max_speakers: Optional[int]) -> list:
    """-> [{"start": s, "end": s, "speaker": label}, ...] relative to the
    start of this segment's PCM."""
    if not pcm:
        return []

    import torch

    diarization_pipeline = _get_diarization_model()
    waveform = torch.from_numpy(_pcm_to_float32(pcm)).unsqueeze(0)
    kwargs = {"max_speakers": max_speakers} if max_speakers else {}
    annotation = diarization_pipeline({"waveform": waveform, "sample_rate": pipeline.SAMPLE_RATE_HZ}, **kwargs)

    return [
        {"start": turn.start, "end": turn.end, "speaker": speaker_label}
        for turn, _, speaker_label in annotation.itertracks(yield_label=True)
    ]


def _fetch_chunk(url: str) -> Optional[bytes]:
    """A chunk the client dropped (upload queue overflow) was never written,
    so its presigned URL 404s. That is a gap, not a failure: return None and
    assemble_segment_pcm fills it with silence so later timestamps stay
    absolute."""
    import httpx

    response = httpx.get(url, timeout=CHUNK_FETCH_TIMEOUT_SECONDS)
    if response.status_code in (403, 404):
        return None
    response.raise_for_status()
    return response.content


def _deliver_callback(callback_url: str, payload: dict) -> None:
    import json

    import httpx

    raw_body = json.dumps(payload).encode("utf-8")
    timestamp = int(time.time())
    signature = pipeline.sign_callback(_diarize_secret(), timestamp, raw_body)
    headers = {
        "Content-Type": "application/json",
        "X-Dali-Timestamp": str(timestamp),
        "X-Dali-Signature": signature,
    }
    response = httpx.post(callback_url, content=raw_body, headers=headers, timeout=CALLBACK_TIMEOUT_SECONDS)
    response.raise_for_status()


# --- the processing job -----------------------------------------------------


@app.function(gpu="T4", timeout=900, retries=1, secrets=[modal.Secret.from_name("dali-asr")])
def run_job(raw_body: dict) -> None:
    req = pipeline.parse_process_request(raw_body)
    job_start = time.monotonic()

    try:
        channels_out = {}
        for channel in req.channels:
            stage_start = time.monotonic()
            channels_out[channel.channel] = pipeline.process_channel(
                channel,
                fetch_chunk=_fetch_chunk,
                transcribe=_run_parakeet,
                diarize=_run_pyannote,
            )
            logger.info(
                "dali-asr: channel done recording_id=%s channel=%s segments=%d audio_s=%.1f stage_s=%.1f",
                req.recording_id,
                channel.channel,
                len(channel.segments),
                pipeline.channel_audio_seconds(channel),
                time.monotonic() - stage_start,
            )
        payload = pipeline.build_callback_body(req.recording_id, channels_out, error=None)
    except Exception:
        logger.exception(
            "dali-asr: processing failed recording_id=%s request=%s",
            req.recording_id,
            pipeline.redact_request(raw_body),
        )
        payload = pipeline.build_error_callback(req.recording_id, "processing_failed")

    _deliver_callback(req.callback_url, payload)
    logger.info(
        "dali-asr: job complete recording_id=%s total_s=%.1f",
        req.recording_id,
        time.monotonic() - job_start,
    )


# --- the public endpoint -----------------------------------------------------


@app.function(secrets=[modal.Secret.from_name("dali-asr")])
@modal.fastapi_endpoint(method="POST")
async def process(request: fastapi.Request) -> dict:
    if not pipeline.check_bearer_token(request.headers.get("authorization"), _diarize_secret()):
        raise fastapi.HTTPException(status_code=401, detail="unauthorized")

    try:
        body = await request.json()
    except Exception:
        raise fastapi.HTTPException(status_code=400, detail="invalid JSON body") from None

    try:
        req = pipeline.parse_process_request(body)
    except pipeline.ValidationError as exc:
        raise fastapi.HTTPException(status_code=400, detail=str(exc)) from None

    call = run_job.spawn(body)
    logger.info(
        "dali-asr: job spawned recording_id=%s channels=%s job_id=%s",
        req.recording_id,
        [c.channel for c in req.channels],
        call.object_id,
    )
    return {"jobId": call.object_id}
