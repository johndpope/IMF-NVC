# IMF-NVC
https://github.com/aadhithya/onnx-typecast/tree/master
```shell
rustup update stable
cargo install --git https://github.com/webonnx/wonnx.git wonnx-cli


nnx info ./public/imf_encoder_web.onnx > output.txt 2>&1
python -m onnxruntime.tools.check_onnx_model_mobile_usability quantized_imf_encoder_fixed.onnx  --log_level debug



pnpm install
pnpm dev

```