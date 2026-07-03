"""One-shot deploy of the Nuna server to a Hugging Face Space.

Usage:
    HF_TOKEN=hf_xxx .venv/bin/python deploy_hf/deploy.py

Creates (or reuses) a Docker Space under your account, uploads the server code
+ the 8-class model (LFS), and prints the public URL. Re-run to redeploy.
"""
import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent
MODEL_SRC = HERE.parent.parent / "nuna_production_model_with_weighted_loss_16_20"
SPACE_NAME = os.environ.get("NUNA_SPACE", "nuna-food-intake")

token = os.environ.get("HF_TOKEN")
if not token:
    sys.exit("Set HF_TOKEN (write-scope token from hf.co/settings/tokens)")

api = HfApi(token=token)
user = api.whoami()["name"]
repo_id = f"{user}/{SPACE_NAME}"
print(f"[deploy] target space: {repo_id}")

# Stage the model inside the deploy dir so upload_folder ships one tree.
model_dst = HERE / "model"
if not model_dst.exists():
    print(f"[deploy] staging model from {MODEL_SRC} ...")
    shutil.copytree(MODEL_SRC, model_dst)

api.create_repo(repo_id=repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
print("[deploy] uploading (model is 345MB — a few minutes on first push) ...")
api.upload_folder(
    folder_path=str(HERE),
    repo_id=repo_id,
    repo_type="space",
    ignore_patterns=["deploy.py", "__pycache__", ".DS_Store"],
)
url = f"https://huggingface.co/spaces/{repo_id}"
print(f"[deploy] done. Space: {url}")
print(f"[deploy] API base (put in app Settings): https://{user}-{SPACE_NAME.replace('_','-')}.hf.space")
print("[deploy] first build takes ~5-10 min; watch the Space page logs.")
