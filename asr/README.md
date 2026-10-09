# dali-asr

Modal app (T4 GPU, scale to zero) for batch meeting transcription and
speaker diarization. See `specs/meeting-transcription.md` ("dali-asr
(Modal, T4)") for the full design.

## One-time setup (admin)

1. Modal workspace, Starter plan, `staging` and `prod` environments.
2. `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` as GitHub secrets (used by
   `.github/workflows/deploy-asr.yml`).
3. Accept the gated terms for `pyannote/speaker-diarization-community-1`
   on Hugging Face, create a read token, and store it as Modal Secret
   `huggingface` with key `HF_TOKEN` in both environments. Weights are
   baked into the image at build time, so this token is never read at
   request time.
4. Modal Secret `dali-asr` per environment with key `DIARIZE_SECRET` —
   the same value must be set on the matching `dali-api` Fly app.
5. After the first deploy, copy the endpoint URL Modal prints into the
   matching `dali-api` Fly app as `DIARIZE_URL`.

## Deploy

```sh
cd asr
uv sync
uv run modal deploy modal_app.py --env staging
uv run modal deploy modal_app.py --env prod
```

The project is managed with [uv](https://docs.astral.sh/uv/); `uv sync`
creates `asr/.venv` from `pyproject.toml` + `uv.lock`. Model dependencies
(torch, onnx-asr, pyannote) are installed inside the Modal image only.

`deploy-asr.yml` does this automatically on push to `staging`/`prod`
when `asr/**` changes.

## Tests

Pure logic only (PCM assembly, request validation, response shaping,
HMAC signing) — no GPU, no torch, no Modal SDK needed:

```sh
cd asr
uv run pytest
```

## Benchmark

Run manually against a real T4, with a local WAV file (never uploads to
S3):

```sh
cd asr && uv run modal run bench.py --wav-path path/to/meeting.wav
```

Prints word/segment counts and transcribe/diarize stage timings.

## Known gaps to verify before the first real recording

- `_run_parakeet` assumes onnx-asr's `model.recognize(..., timestamps=True)`
  returns `result.timestamps` as `(word, start, end)` tuples. Confirm
  against the installed `onnx-asr` version with `bench.py` — this isn't
  unit-tested since it needs the real model.
- `_run_pyannote` assumes `pyannote.audio.Pipeline.__call__` accepts a
  `{"waveform": tensor, "sample_rate": int}` dict and that
  `Annotation.itertracks(yield_label=True)` yields `(turn, _, label)`.
  Same caveat — verify with `bench.py`.
