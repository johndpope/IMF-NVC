import json
import onnx
from onnxsim import simplify

def load_supported_ops(json_file):
    with open(json_file, 'r') as f:
        data = json.load(f)
    return set(op['name'] for op in data['supportedOperators'])

def audit_onnx_ops(model_file, webgpu_file, webgl_file):
    # Load the ONNX model
    model = onnx.load(model_file)
    
    # Optionally simplify the model
    model, check = simplify(model)
    if not check:
        print("Warning: Model simplification failed. Using original model.")
    
    # Extract operators from the model
    model_ops = set(node.op_type for node in model.graph.node)
    
    # Load supported operators for WebGPU and WebGL
    webgpu_ops = load_supported_ops(webgpu_file)
    webgl_ops = load_supported_ops(webgl_file)
    
    print(f"Total operators in the model: {len(model_ops)}")
    print("\nOperators used in the model:")
    for op in sorted(model_ops):
        webgpu_support = "Supported" if op in webgpu_ops else "Not supported"
        webgl_support = "Supported" if op in webgl_ops else "Not supported"
        print(f"- {op:<20} WebGPU: {webgpu_support:<15} WebGL: {webgl_support}")
    
    print("\nSummary:")
    print(f"WebGPU supported: {len(model_ops.intersection(webgpu_ops))}/{len(model_ops)} "
          f"({len(model_ops.intersection(webgpu_ops))/len(model_ops)*100:.2f}%)")
    print(f"WebGL supported: {len(model_ops.intersection(webgl_ops))}/{len(model_ops)} "
          f"({len(model_ops.intersection(webgl_ops))/len(model_ops)*100:.2f}%)")
    
    print("\nOperators not supported in WebGPU:")
    for op in sorted(model_ops - webgpu_ops):
        print(f"- {op}")
    
    print("\nOperators not supported in WebGL:")
    for op in sorted(model_ops - webgl_ops):
        print(f"- {op}")

if __name__ == "__main__":
    model_file = './public/imf_encoder.onnx'
    webgpu_file = "webgpu_supported_ops.json"
    webgl_file = "webgl_supported_ops.json"
    audit_onnx_ops(model_file, webgpu_file, webgl_file)