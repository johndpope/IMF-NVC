// webpack.worker.config.js
const path = require('path');

module.exports = {
    entry: './js/decoder/worker.ts',
    target: 'webworker',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'decoder.worker.js',
        clean: false
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm'],
        alias: {
            '@': path.resolve(__dirname, 'js'),
            '@pkg': path.resolve(__dirname, 'pkg')
        }
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            },
            {
                test: /\.wasm$/,
                type: "webassembly/async"
            }
        ]
    },
    experiments: {
        asyncWebAssembly: true,
        topLevelAwait: true
    },
    mode: 'development',
    devtool: 'source-map'
};