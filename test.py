import onnx
import numpy as np
import os

def convert_int64_tensors(model_path, output_path):
    # Check if input file exists
    if not os.path.exists(model_path):
        print(f"Error: Input file '{model_path}' not found.")
        return

    try:
        model = onnx.load(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    for initializer in model.graph.initializer:
        if initializer.data_type == onnx.TensorProto.INT64:
            arr = np.frombuffer(initializer.raw_data, dtype=np.int64).reshape(initializer.dims)
            if arr.size == 0:
                print(f"Warning: Empty INT64 tensor found: {initializer.name}. Skipping conversion.")
                continue
            if np.min(arr) < -2**31 or np.max(arr) > 2**31 - 1:
                # Convert to float32 if values exceed INT32 range
                new_arr = arr.astype(np.float32)
                initializer.data_type = onnx.TensorProto.FLOAT
            else:
                # Convert to INT32
                new_arr = arr.astype(np.int32)
                initializer.data_type = onnx.TensorProto.INT32
            initializer.raw_data = new_arr.tobytes()
    
    # Update input/output tensors if necessary
    for tensor in list(model.graph.input) + list(model.graph.output):
        if tensor.type.tensor_type.elem_type == onnx.TensorProto.INT64:
            tensor.type.tensor_type.elem_type = onnx.TensorProto.INT32
    
    try:
        onnx.save(model, output_path)
        print(f"Converted model saved to: {output_path}")
    except Exception as e:
        print(f"Error saving converted model: {e}")

# Use the function
input_model_path = "./public/quantized_imf_encoder_web.onnx"
output_model_path = "./public/converted_imf_encoder.onnx"
convert_int64_tensors(input_model_path, output_model_path)