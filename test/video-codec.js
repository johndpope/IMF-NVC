// Note: This code should be run in a secure context (HTTPS) due to WebCodecs security requirements

const videoElement = document.createElement('video');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

let decoder, encoder;

async function setupVideoProcessing() {
  // Set up video decoder
  const decodeConfig = {
    codec: 'vp8',
    codedWidth: 640,
    codedHeight: 480,
  };

  decoder = new VideoDecoder({
    output: processFrame,
    error: (e) => console.error('Decoder error:', e),
  });

  await decoder.configure(decodeConfig);

  // Set up video encoder
  const encodeConfig = {
    codec: 'vp8',
    width: 640,
    height: 480,
    bitrate: 1_000_000, // 1 Mbps
    framerate: 30,
  };

  encoder = new VideoEncoder({
    output: processEncodedChunk,
    error: (e) => console.error('Encoder error:', e),
  });

  await encoder.configure(encodeConfig);
}

function processFrame(frame) {
  // Simple processing: invert colors
  canvas.width = frame.displayWidth;
  canvas.height = frame.displayHeight;
  ctx.drawImage(frame, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];         // Red
    data[i + 1] = 255 - data[i + 1]; // Green
    data[i + 2] = 255 - data[i + 2]; // Blue
  }

  ctx.putImageData(imageData, 0, 0);
  
  const processedFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });
  encoder.encode(processedFrame);
  processedFrame.close();
  frame.close();
}

function processEncodedChunk(chunk) {
  // Here you would typically send the encoded chunk to a server or save it
  console.log('Processed chunk:', chunk);
}

async function processVideo(videoFile) {
  await setupVideoProcessing();

  const reader = videoFile.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    decoder.decode(new EncodedVideoChunk({
      type: 'key',
      data: value,
      timestamp: performance.now(),
    }));
  }
}

// Usage:
document.getElementById('videoInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) processVideo(file);
});