#!/bin/bash

echo "🧹 Cleaning up previous builds..."
rm -rf pkg
rm -rf dist
cargo clean

echo "📦 Building WASM with debug info..."
RUSTFLAGS="-C debuginfo=2" wasm-pack build --target web --dev


# Check if wasm-pack build was successful
if [ $? -ne 0 ]; then
    echo "❌ WASM build failed!"
    exit 1
fi

# Verify the pkg directory contents
echo "🔍 Verifying WASM build..."
if [ -f "pkg/imf_decoder_bg.wasm" ] && [ -f "pkg/imf_decoder.js" ]; then
    echo "✅ WASM files generated successfully"
    echo "📄 Generated files:"
    ls -lh pkg/
else
    echo "❌ WASM files missing!"
    exit 1
fi

echo "🔄 Killing previous Node processes..."
~/killnode.sh

echo "🚀 Starting development server..."
npm start