// webpack.config.js
const path = require('path');
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: './js/index.ts',  // Changed to .ts extension
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        clean: true
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
                test: /\.(ts|tsx)$/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            compilerOptions: {
                                module: 'esnext',
                                moduleResolution: 'node'
                            }
                        }
                    }
                ],
                exclude: /node_modules/,
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ]
    },
    experiments: {
        asyncWebAssembly: true,
        topLevelAwait: true
    },
    mode: 'development',
    devtool: 'source-map',
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 3001,
        hot: true,
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './www/index.html',
            filename: 'index.html',
        }),
        new WasmPackPlugin({
            crateDirectory: path.resolve(__dirname, "."),
            outDir: 'pkg',
            extraArgs: '--target web',
            forceMode: 'development'
        }),
        new CopyWebpackPlugin({
            patterns: [
                { 
                    from: 'www',
                    to: '.', 
                    globOptions: {
                        ignore: ['**/*.html']
                    }
                }
            ]
        })
    ]
};