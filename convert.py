import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

# Load the model
model_path = "./public/imf_encoder_web.onnx"
quantized_model_path = "./public/quantized_imf_encoder_web.onnx"

# Load the ONNX model
model = onnx.load(model_path)

# Quantize the model
quantized_model = quantize_dynamic(
    model_path,
    quantized_model_path,
    weight_type=QuantType.QUInt8
)

print(f"Quantized model saved to: {quantized_model_path}")