# IMF-NVC

```shell
python -m onnxruntime.tools.onnxruntime_test.check_model_coverage --model_path ./public/imf_encoder.onnx
```


```shell
 python test.py
Total operators in the model: 15

Operators used in the model:
- Add                  WebGPU: Supported       WebGL: Supported
- Concat               WebGPU: Supported       WebGL: Supported
- Conv                 WebGPU: Supported       WebGL: Supported
- Div                  WebGPU: Supported       WebGL: Supported
- Gather               WebGPU: Supported       WebGL: Supported
- Gemm                 WebGPU: Supported       WebGL: Supported
- LeakyRelu            WebGPU: Supported       WebGL: Supported
- Mul                  WebGPU: Supported       WebGL: Supported
- Pad                  WebGPU: Supported       WebGL: Supported
- ReduceMean           WebGPU: Supported       WebGL: Supported
- Relu                 WebGPU: Supported       WebGL: Supported
- Reshape              WebGPU: Supported       WebGL: Supported
- Shape                WebGPU: Supported       WebGL: Supported
- Slice                WebGPU: Supported       WebGL: Supported
- Unsqueeze            WebGPU: Supported       WebGL: Supported

Summary:
WebGPU supported: 15/15 (100.00%)
WebGL supported: 15/15 (100.00%)

Operators not supported in WebGPU:

Operators not supported in WebGL:
```