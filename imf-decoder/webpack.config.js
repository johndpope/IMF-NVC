const path = require('path');
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        main: './js/index.ts',
        worker: './js/decoder/worker.ts'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        clean: true,
        webassemblyModuleFilename: "[hash].module.wasm"
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm', '.css'],
        alias: {
            '@': path.resolve(__dirname, 'js'),
            '@pkg': path.resolve(__dirname, 'pkg')
        }
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        transpileOnly: true
                    }
                },
                exclude: /node_modules/
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader'],
                sideEffects: true
            }
        ]
    },
    experiments: {
        asyncWebAssembly: true,
        topLevelAwait: true
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.html',  // Updated path
            filename: 'index.html',
        }),
        new WasmPackPlugin({
            crateDirectory: path.resolve(__dirname, "."),
            outDir: 'pkg',
            extraArgs: '--target web'
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'styles',  // Just the styles directory
                    to: 'styles',
                    noErrorOnMissing: true
                }
            ]
        })
    ],
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
            watch: true,
            serveIndex: true
        },
        devMiddleware: {
            mimeTypes: {
                'css': 'text/css'
            }
        },
        hot: true,
        compress: true,
        port: 'auto',
        historyApiFallback: true,
        headers: {
            'Access-Control-Allow-Origin': '*'
        }
    }
};