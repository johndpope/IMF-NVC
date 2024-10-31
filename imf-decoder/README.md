# Install Rust toolchain if not installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install wasm-pack
cargo install wasm-pack



# Install runtime dependencies
npm install \
  @tensorflow/tfjs


wasm-pack build --target web --dev

# Start development server
npm start







# Run Rust unit tests
cargo test

# Run Wasm tests
wasm-pack test --headless --firefox

# Run benchmarks
cargo bench




# Terminal 1: Watch Rust changes
cargo watch -s "wasm-pack build --target web --dev"

# Terminal 2: Start webpack dev server
npm start



# Update Rust toolchain
rustup update stable

# Verify the new version (should be 1.73.0 or newer)
rustc --version

# Update wasm target
rustup target add wasm32-unknown-unknown --toolchain stable

# Clean previous builds
cargo clean

# Try building again
wasm-pack build --target web



## Memory leak detection 
```shell
RUST_BACKTRACE=1 RUST_LOG=debug cargo run --features "leak-detection"

# Enable memory logging
RUST_LOG=debug npm start
```
