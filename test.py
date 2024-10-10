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




def find_int64_tensors(model_path):
    # Load the ONNX model
    model = onnx.load(model_path)
    
    int64_tensors = []
    
    # Check initializers
    for initializer in model.graph.initializer:
        if initializer.data_type == onnx.TensorProto.INT64:
            int64_tensors.append(f"Initializer: {initializer.name}")
    
    # Check input tensors
    for input_tensor in model.graph.input:
        if input_tensor.type.tensor_type.elem_type == onnx.TensorProto.INT64:
            int64_tensors.append(f"Input: {input_tensor.name}")
    
    # Check output tensors
    for output_tensor in model.graph.output:
        if output_tensor.type.tensor_type.elem_type == onnx.TensorProto.INT64:
            int64_tensors.append(f"Output: {output_tensor.name}")
    
    # Check intermediate tensors in nodes
    for node in model.graph.node:
        for output in node.output:
            for value_info in model.graph.value_info:
                if value_info.name == output and value_info.type.tensor_type.elem_type == onnx.TensorProto.INT64:
                    int64_tensors.append(f"Intermediate: {output} (Node: {node.op_type})")
    
    return int64_tensors

# Use the function
model_path = "./public/imf_encoder.onnx"
int64_tensors = find_int64_tensors(model_path)

if int64_tensors:
    print("Found INT64 tensors:")
    for tensor in int64_tensors:
        print(f"- {tensor}")
else:
    print("No INT64 tensors found in the model.")


    # # Use the function
# input_model_path = "./public/quantized_imf_encoder_web.onnx"
# output_model_path = "./public/converted_imf_encoder.onnx"
# convert_int64_tensors(input_model_path, output_model_path)
