const videoElement = document.getElementById('originalVideo');
const canvas = document.getElementById('processedCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startProcessing');
const effectSelect = document.getElementById('effectSelect');
const videoInput = document.getElementById('videoInput');

let decoder, encoder;
let isProcessing = false;

console.log('Initial DOM elements:', { videoElement, canvas, startButton, effectSelect, videoInput });

async function setupVideoProcessing() {
    console.log('Setting up video processing...');
    console.log('videoElement.srcObject:', videoElement.srcObject);

    if (!videoElement.srcObject) {
        console.error('No video source available');
        return;
    }

    const videoTrack = videoElement.srcObject.getVideoTracks()[0];
    console.log('Video track:', videoTrack);

    if (!videoTrack) {
        console.error('No video track found');
        return;
    }

    const trackSettings = videoTrack.getSettings();
    console.log('Track settings:', trackSettings);

    const decodeConfig = {
        codec: 'vp8',
        codedWidth: trackSettings.width,
        codedHeight: trackSettings.height,
    };

    console.log('Decoder config:', decodeConfig);

    try {
        decoder = new VideoDecoder({
            output: processFrame,
            error: (e) => console.error('Decoder error:', e),
        });

        await decoder.configure(decodeConfig);
        console.log('Decoder configured successfully');
    } catch (error) {
        console.error('Error configuring decoder:', error);
        return;
    }

    const encodeConfig = {
        codec: 'vp8',
        width: trackSettings.width,
        height: trackSettings.height,
        bitrate: 2_000_000, // 2 Mbps
        framerate: trackSettings.frameRate,
    };

    console.log('Encoder config:', encodeConfig);

    try {
        encoder = new VideoEncoder({
            output: processEncodedChunk,
            error: (e) => console.error('Encoder error:', e),
        });

        await encoder.configure(encodeConfig);
        console.log('Encoder configured successfully');
    } catch (error) {
        console.error('Error configuring encoder:', error);
        return;
    }

    canvas.width = trackSettings.width;
    canvas.height = trackSettings.height;
    console.log('Canvas dimensions set:', { width: canvas.width, height: canvas.height });
}

function processFrame(frame) {
    // ... (rest of the processFrame function remains the same)
    console.log('Processing frame:', frame);
}

function processEncodedChunk(chunk) {
    console.log('Processed chunk:', chunk);
}

async function startVideoProcessing() {
    console.log('Starting video processing...');
    if (isProcessing) {
        console.log('Already processing, returning');
        return;
    }
    
    if (!videoElement.srcObject) {
        console.error('No video source available');
        return;
    }

    isProcessing = true;

    try {
        const videoTrack = videoElement.srcObject.getVideoTracks()[0];
        console.log('Video track for processing:', videoTrack);

        if (!videoTrack) {
            throw new Error('No video track found');
        }

        const trackProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
        const reader = trackProcessor.readable.getReader();
        console.log('Track processor and reader created');

        while (isProcessing) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('Reader finished');
                break;
            }
            console.log('Decoding frame');
            decoder.decode(value);
        }

        reader.releaseLock();
        console.log('Reader released');
    } catch (error) {
        console.error('Error during video processing:', error);
        isProcessing = false;
    }
}

videoInput.addEventListener('change', async (event) => {
    console.log('Video input changed');
    const file = event.target.files[0];
    if (file) {
        console.log('File selected:', file);
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia is not supported in this browser');
            }

            console.log('Requesting camera access...');
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            console.log('Camera access granted, stream:', stream);

            videoElement.srcObject = stream;
            console.log('Video element source set');

            await videoElement.play();
            console.log('Video playback started');

            await setupVideoProcessing();
            console.log('Video processing setup complete');

            startButton.disabled = false;
            console.log('Start button enabled');
        } catch (error) {
            console.error('Error setting up video:', error);
            alert(`Error setting up video: ${error.message}`);
        }
    }
});

startButton.addEventListener('click', startVideoProcessing);

effectSelect.addEventListener('change', () => {
    console.log('Effect changed to:', effectSelect.value);
});

// Check for WebCodecs support
if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
    console.error('WebCodecs API is not supported in this browser');
    alert('WebCodecs API is not supported in this browser. Please use a modern browser like Chrome or Edge.');
}

console.log('Script loaded and initialized');