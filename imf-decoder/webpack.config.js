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
            template: './www/index.html',
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
                    from: 'www',
                    to: '.',
                    globOptions: {
                        ignore: ['**/*.html']
                    }
                },
                {
                    from: 'styles',  // Assuming your CSS is in a 'styles' directory
                    to: 'styles',
                    globOptions: {
                        ignore: ['**/*.map']
                    }
                }
            ]
        })
    ],
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
            watch: true,
            serveIndex: true,
            mimeTypes: {
                'css': 'text/css'
            }
        },
        hot: true,
        compress: true,
        port: 8092,
        historyApiFallback: true,
        headers: {
            'Access-Control-Allow-Origin': '*',
        }
    }
};