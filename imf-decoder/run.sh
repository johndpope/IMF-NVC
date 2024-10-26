rm -rf pkg
rm -rf dist
cargo clean

# Build wasm
RUSTFLAGS="-C debuginfo=2" wasm-pack build --target web --dev

~/killnode.sh
# Start dev server
npm start