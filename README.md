# IMF-NVC

```shell
rustup update stable
cargo install --git https://github.com/webonnx/wonnx.git wonnx-cli

nnx info imf_encoder_web.onnx > output.txt 2>&1
python -m onnxruntime.tools.check_onnx_model_mobile_usability imf_encoder.onnx  --log_level debug

```