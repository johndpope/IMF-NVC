import onnx

# Load the ONNX model
model_path = "./public/imf_encoder.onnx"   
model = onnx.load(model_path)

# Extract the ops from the model
ops = set()

for node in model.graph.node:
    ops.add(node.op_type)

# Print the unique ops used in the model
print(f"Operations used in the model: {ops}")
