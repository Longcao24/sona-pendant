---
title: Nuna Food Intake Server
emoji: 🍎
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Nuna food-intake inference server

AST (Audio Spectrogram Transformer) classifier for necklace-mic audio.
8 classes: Silence, Apple, Carrot, Cookie, Potato chips, Peanut, Talking, Drinking.

Endpoints: `GET /health`, `GET /labels`, `POST /classify` (WAV), `POST /classify_pcm` (raw int16 16k mono), `POST /classify_b64` (JSON base64 PCM).
