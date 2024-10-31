import * as tf from '@tensorflow/tfjs';

// Ensure the model is loaded and available
export async function loadModel(modelUrl) {
  window.model = await tf.loadGraphModel(modelUrl);
}

export async function executeModelAsync(inputData, inputShape) {
  // Convert inputData (a Float32Array) to a tf.Tensor
  const inputTensor = tf.tensor(inputData, inputShape);

  // Run inference
  const outputTensor = await window.model.executeAsync(inputTensor);

  // Get data from the output tensor
  const outputData = await outputTensor.data();

  // Clean up tensors
  tf.dispose([inputTensor, outputTensor]);

  // Return output data as a Float32Array
  return new Float32Array(outputData);
}
