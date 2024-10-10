import torch
import torch.nn as nn
import torch.utils.mobile_optimizer as mobile_optimizer
import torch.onnx
import torch.quantization


class MyModel(nn.Module):
    def __init__(self):
        super(MyModel, self).__init__()
        self.conv1 = nn.Conv2d(3, 64, 3, 1, 1)
        self.relu = nn.ReLU()
        self.fc = nn.Linear(64 * 224 * 224, 10)

    def forward(self, x):
        x = self.relu(self.conv1(x))
        x = x.view(x.size(0), -1)
        x = self.fc(x)
        return x

model = MyModel()

example_input = torch.rand(1, 3, 224, 224)
traced_model = torch.jit.trace(model, example_input)


# scripted_model = torch.jit.script(model)


# optimized_model = mobile_optimizer.optimize_for_mobile(traced_model)
# optimized_model.save("mymodel_optimized.pt")


# quantized_model = torch.quantization.quantize_dynamic(
#     model, {torch.nn.Linear, torch.nn.Conv2d}, dtype=torch.qint8
# )
# quantized_scripted_model = torch.jit.script(quantized_model)
# optimized_quantized_model = mobile_optimizer.optimize_for_mobile(quantized_scripted_model)
# optimized_quantized_model.save("mymodel_quantized_optimized.pt")



# # Assuming 'model' is your PyTorch model
# dummy_input = torch.randn(1, 3, 224, 224)
# torch.onnx.export(model, dummy_input, "model.onnx")


# Assume 'model' is your PyTorch model
# Define qconfig
# qconfig = torch.quantization.get_default_qconfig('fbgemm')

# # Prepare model for static quantization
# model_prepared = torch.quantization.prepare(model, qconfig)

# Then quantize the ONNX model
from onnxruntime.quantization import quantize_dynamic, QuantType

model_fp32 = 'model.onnx'
model_quant = 'model_quant.onnx'
quantize_dynamic(model_fp32, model_quant, weight_type=QuantType.QUInt8)