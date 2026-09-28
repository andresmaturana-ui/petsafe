FROM python:3.11-slim
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user . .
# El mismo detector de cabezas que usa la app.
ADD --chown=user https://raw.githubusercontent.com/andresmaturana-ui/petsafe/main/public/models/pet-head.onnx pet-head.onnx
# Descarga DINOv2 al construir, así la primera foto no espera la descarga.
RUN python -c "from huggingface_hub import hf_hub_download as d; d('Xenova/dinov2-small', 'onnx/model_quantized.onnx'); d('Xenova/dinov2-small', 'preprocessor_config.json')"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
