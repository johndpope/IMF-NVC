// import * as ort from 'onnxruntime-node';
// import * as sharp from 'sharp';
// import * as fs from 'fs';
// import * as http from 'http';
// import * as https from 'https';
// import * as url from 'url';

// export class ONNXModelLoader {
//   private session: ort.InferenceSession | null = null;

//   constructor() {
//     // Empty constructor or any necessary initialization
//   }

//   async loadModel(modelPathOrUrl: string): Promise<void> {
//     try {
//       console.log('Starting model load from:', modelPathOrUrl);

//       if (modelPathOrUrl.startsWith('http://') || modelPathOrUrl.startsWith('https://')) {
//         // Load model from URL
//         await this.loadModelFromUrl(modelPathOrUrl);
//       } else {
//         // Load model from local file system
//         this.session = await ort.InferenceSession.create(modelPathOrUrl);
//         console.log('Model loaded successfully from file system');
//       }
//     } catch (error) {
//       console.error('Error loading the model:', error);
//       throw error;
//     }
//   }

//   private async loadModelFromUrl(modelUrl: string): Promise<void> {
//     return new Promise((resolve, reject) => {
//       const parsedUrl = url.parse(modelUrl);
//       const protocol = parsedUrl.protocol === 'https:' ? https : http;

//       protocol.get(modelUrl, (response: any) => {
//         if (response.statusCode !== 200) {
//           reject(new Error(`Failed to get '${modelUrl}' (${response.statusCode})`));
//           return;
//         }

//         const contentLength = Number(response.headers['content-length']) || 0;
//         let receivedLength = 0;
//         const chunks: Buffer[] = [];

//         response.on('data', (chunk: Buffer) => {
//           chunks.push(chunk);
//           receivedLength += chunk.length;
//           if (contentLength) {
//             const progress = (receivedLength / contentLength) * 100;
//             console.log(`Downloading model... ${progress.toFixed(2)}%`);
//           } else {
//             console.log(`Downloading model... ${receivedLength} bytes received`);
//           }
//         });

//         response.on('end', async () => {
//           const modelBuffer = Buffer.concat(chunks);
//           this.session = await ort.InferenceSession.create(modelBuffer);
//           console.log('Model loaded successfully from URL');
//           resolve();
//         });

//         response.on('error', (err: any) => {
//           reject(err);
//         });
//       });
//     });
//   }

//   async runInference(
//     xCurrent: Float32Array,
//     xReference: Float32Array
//   ): Promise<[Float32Array, Float32Array, Float32Array]> {
//     if (!this.session) {
//       throw new Error('Model not loaded. Call loadModel() first.');
//     }

//     const tensorXCurrent = new ort.Tensor('float32', xCurrent, [1, 3, 256, 256]);
//     const tensorXReference = new ort.Tensor('float32', xReference, [1, 3, 256, 256]);

//     const feeds: Record<string, ort.Tensor> = {
//       x_current: tensorXCurrent,
//       x_reference: tensorXReference,
//     };

//     try {
//       const results = await this.session.run(feeds);
//       const fr = results['f_r'].data as Float32Array;
//       const tr = results['t_r'].data as Float32Array;
//       const tc = results['t_c'].data as Float32Array;

//       return [fr, tr, tc];
//     } catch (error) {
//       console.error('Error during inference:', error);
//       throw error;
//     }
//   }

//   // Helper method to convert image to Float32Array
//   static async imageToFloat32Array(imagePath: string): Promise<Float32Array> {
//     const { data, info } = await sharp(imagePath)
//       .resize(256, 256)
//       .removeAlpha()
//       .raw()
//       .toBuffer({ resolveWithObject: true });

//     const { width, height, channels } = info;
//     if (channels !== 3) {
//       throw new Error('Expected image to have 3 channels (RGB)');
//     }

//     const float32Data = new Float32Array(1 * 3 * 256 * 256); // Shape [1, 3, 256, 256]

//     // Rearranging data to match [C, H, W] format
//     for (let y = 0; y < height; y++) {
//       for (let x = 0; x < width; x++) {
//         const idx = y * width + x;
//         const dataIdx = idx * 3;

//         const r = data[dataIdx] / 255;
//         const g = data[dataIdx + 1] / 255;
//         const b = data[dataIdx + 2] / 255;

//         // Normalize and store in channel-first order
//         float32Data[0 * width * height + idx] = (r - 0.485) / 0.229; // Red channel
//         float32Data[1 * width * height + idx] = (g - 0.456) / 0.224; // Green channel
//         float32Data[2 * width * height + idx] = (b - 0.406) / 0.225; // Blue channel
//       }
//     }

//     return float32Data;
//   }
// }
